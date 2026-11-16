/**
 * The app's state: the server, the account, the bots and their live state, the open conversations, tasks.
 * Network effects live here; the pure updates are in reducers.ts.
 */
import { AppState } from "react-native";
import { create } from "zustand";
import { ApiClient, checkHealth } from "../api/client";
import { EventStream } from "../api/sse";
import type { Attachment, Bot, BotBundle, Live, MeResponse, Row, ServerEvent, Task, User } from "../api/types";
import { errText, getLocale, setLocale, t } from "../i18n";
import { cardReq } from "../lib/cardActions";
import { jsShouldNotify, liveClearBot, liveDisable, liveInFront, liveResume, liveSession, useLive } from "../live";
import { clearBot, notifyBot, rememberSeen } from "../notify";
import { relayResume, relaySetServer } from "../relay";
import { usePrefs } from "./prefs";
import { applyEvent, applyRowsPage, emptyThread, firstWords, PAGE, type Thread } from "./reducers";
import { loadOrigin, loadToken, saveOrigin, saveToken } from "./session";

export type Boot = "loading" | "server" | "signedOut" | "ready";

interface State {
  boot: Boot;
  origin: string | null;
  client: ApiClient | null;
  me: MeResponse | null;
  user: User | null;
  online: boolean;
  bots: Record<string, Bot>;
  live: Record<string, Live>;
  threads: Record<string, Thread>;
  bundles: Record<string, BotBundle>;
  tasks: Task[] | null;
  botsError: string | null;
  /** The chat on screen (no notification for it while the app is in front). */
  openBotId: string | null;

  init(): Promise<void>;
  setServer(origin: string): Promise<{ ok: true } | { ok: false; reason: "unreachable" | "notSklubot" }>;
  forgetServer(): Promise<void>;
  refreshMe(): Promise<void>;
  signIn(email: string, password: string): Promise<void>;
  signUp(fields: { email: string; password: string; name?: string; setupCode?: string; botName?: string; botLabel?: string }): Promise<void>;
  signOut(): Promise<void>;
  deleteAccount(password: string): Promise<void>;
  loadBots(): Promise<void>;
  loadRows(botId: string, force?: boolean): Promise<void>;
  loadEarlier(botId: string): Promise<void>;
  loadBundle(botId: string): Promise<void>;
  loadTasks(): Promise<void>;
  setOpenBot(botId: string | null): void;
  markRead(botId: string): Promise<void>;
  send(botId: string, text: string, attachments: Attachment[]): Promise<void>;
  stop(botId: string): Promise<void>;
  decide(approvalId: string, decision: "allow" | "always" | "deny"): Promise<void>;
  answer(botId: string, seq: number, answer: string): Promise<void>;
  dismissCard(botId: string, seq: number): Promise<void>;
  continueRow(botId: string, seq: number): Promise<void>;
  /** Any other JSON call of the API (the special cards, the bot's screen): same client, same session. */
  call<T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown): Promise<T>;
  applyEvent(ev: ServerEvent): void;
}

let stream: EventStream | null = null;
let appActive = AppState.currentState === "active";

function needClient(): ApiClient {
  const c = useStore.getState().client;
  if (!c) throw new Error("not connected");
  return c;
}

function makeClient(origin: string, token: string | null): ApiClient {
  return new ApiClient({
    origin,
    token,
    onToken: (tok) => { void saveToken(origin, tok); liveSession(origin, tok); },
    onUnauthorized: () => { void sessionLost(); },
  });
}

async function sessionLost() {
  const s = useStore.getState();
  if (s.boot !== "ready") return;
  stopStream();
  liveDisable();
  if (s.origin) await saveToken(s.origin, null);
  s.client?.setToken(null);
  useStore.setState({ boot: "signedOut", user: null, bots: {}, live: {}, threads: {}, bundles: {}, tasks: null });
  void s.refreshMe();
}

function startStream() {
  const c = useStore.getState().client;
  if (!c) return;
  stream?.stop();
  stream = new EventStream({
    url: () => c.url("/events"),
    headers: () => c.authHeaders(),
    onOpen: (reconnected) => {
      useStore.setState({ online: true });
      // Missed events while the stream was down: catch up from the server.
      if (reconnected) {
        const s = useStore.getState();
        void s.loadBots();
        if (s.openBotId) void s.loadRows(s.openBotId, true);
        void s.loadTasks();
      }
    },
    onDown: () => useStore.setState({ online: false }),
    onUnauthorized: () => { void sessionLost(); },
    onMessage: (data) => {
      let ev: ServerEvent;
      try { ev = JSON.parse(data) as ServerEvent; } catch { return; }
      if (!ev || typeof ev !== "object") return;
      if (ev.type === "hello") { stream?.resetBackoff(); return; }
      if (ev.type === "ping") return;
      useStore.getState().applyEvent(ev);
    },
  });
  stream.start();
}

function stopStream() {
  stream?.stop();
  stream = null;
}

liveInFront(appActive);
AppState.addEventListener("change", (next) => {
  const wasActive = appActive;
  appActive = next === "active";
  liveInFront(appActive);
  const s = useStore.getState();
  if (s.boot !== "ready") return;
  if (appActive && !wasActive) {
    // Back in front: a fresh connection (the old one may have been frozen by the system) and fresh data.
    startStream();
    void s.loadBots();
    if (s.openBotId) { void s.loadRows(s.openBotId, true); void s.markRead(s.openBotId); }
  }
  if (!appActive) void rememberSeen(Object.values(s.bots), s.live);
});

export const useStore = create<State>((set, get) => ({
  boot: "loading",
  origin: null,
  client: null,
  me: null,
  user: null,
  online: true,
  bots: {},
  live: {},
  threads: {},
  bundles: {},
  tasks: null,
  botsError: null,
  openBotId: null,

  async init() {
    await usePrefs.getState().load();
    const origin = await loadOrigin();
    if (!origin) { set({ boot: "server" }); return; }
    const token = await loadToken(origin);
    const client = makeClient(origin, token);
    relaySetServer(origin);
    set({ origin, client });
    try {
      const me = await client.get<MeResponse>(`/me?locale=${getLocale()}`);
      set({ me });
      if (me.user) await signedIn(me.user);
      else set({ boot: "signedOut" });
    } catch {
      // Offline at start: with a saved session, open the app anyway (it reconnects); without, the sign-in screen.
      if (token) {
        set({ boot: "ready", online: false });
        liveResume();
        startStream();
      } else set({ boot: "signedOut" });
    }
  },

  async setServer(origin) {
    const health = await checkHealth(origin);
    if (!health.ok) return health;
    if (get().origin !== origin) {
      stopStream();
      await saveOrigin(origin);
      relaySetServer(origin);
      const client = makeClient(origin, await loadToken(origin));
      set({ origin, client, user: null, me: null, bots: {}, live: {}, threads: {}, bundles: {}, tasks: null });
    }
    await get().refreshMe();
    const me = get().me;
    if (me?.user) await signedIn(me.user);
    else set({ boot: "signedOut" });
    return { ok: true };
  },

  async forgetServer() {
    stopStream();
    liveDisable();
    await saveOrigin(null);
    set({ boot: "server", user: null, me: null, bots: {}, live: {}, threads: {}, bundles: {}, tasks: null });
  },

  async refreshMe() {
    const c = get().client;
    if (!c) return;
    try { set({ me: await c.get<MeResponse>(`/me?locale=${getLocale()}`) }); } catch { /* the sign-in screen shows its own errors */ }
  },

  async signIn(email, password) {
    const r = await needClient().post<{ user: User }>("/auth/login", { email, password });
    await signedIn(r.user);
  },

  async signUp(fields) {
    const r = await needClient().post<{ user: User }>("/auth/signup", { ...fields, locale: getLocale() });
    await signedIn(r.user);
  },

  async signOut() {
    const { client, origin } = get();
    stopStream();
    liveDisable();
    try { await client?.post("/auth/logout"); } catch { /* signed out locally anyway */ }
    if (origin) await saveToken(origin, null);
    client?.setToken(null);
    set({ boot: "signedOut", user: null, bots: {}, live: {}, threads: {}, bundles: {}, tasks: null, openBotId: null });
    void get().refreshMe();
  },

  async deleteAccount(password) {
    const { client, origin } = get();
    await needClient().request("DELETE", "/account", { password });
    stopStream();
    liveDisable();
    if (origin) await saveToken(origin, null);
    client?.setToken(null);
    set({ boot: "signedOut", user: null, bots: {}, live: {}, threads: {}, bundles: {}, tasks: null, openBotId: null });
    void get().refreshMe();
  },

  async loadBots() {
    try {
      const r = await needClient().get<{ bots: Bot[]; live: Record<string, Live> }>("/bots");
      const bots: Record<string, Bot> = {};
      for (const b of r.bots) bots[b.id] = b;
      set({ bots, live: r.live ?? {}, botsError: null, online: true });
    } catch (e) {
      set({ botsError: errText(e) });
    }
  },

  async loadRows(botId, force = false) {
    const existing = get().threads[botId];
    if (existing && (existing.loading || (existing.loaded && !force))) return;
    set((s) => ({ threads: { ...s.threads, [botId]: { ...(s.threads[botId] ?? emptyThread(s.bots[botId]?.generation ?? 0)), loading: true, error: null } } }));
    try {
      const page = await needClient().get<{ generation: number; rows: Row[] }>(`/bots/${encodeURIComponent(botId)}/rows?limit=${PAGE}`);
      set((s) => (s.threads[botId] ? { threads: { ...s.threads, [botId]: applyRowsPage(s.threads[botId], page) } } : {}));
    } catch (e) {
      set((s) => (s.threads[botId] ? { threads: { ...s.threads, [botId]: { ...s.threads[botId], loading: false, error: errText(e) } } } : {}));
    }
  },

  async loadEarlier(botId) {
    const th = get().threads[botId];
    if (!th || !th.loaded || th.loadingEarlier || !th.hasMore || !th.rows.length) return;
    set((s) => ({ threads: { ...s.threads, [botId]: { ...th, loadingEarlier: true } } }));
    try {
      const page = await needClient().get<{ generation: number; rows: Row[] }>(`/bots/${encodeURIComponent(botId)}/rows?limit=${PAGE}&before=${th.rows[0].seq}`);
      set((s) => (s.threads[botId] ? { threads: { ...s.threads, [botId]: applyRowsPage(s.threads[botId], page, true) } } : {}));
    } catch {
      set((s) => (s.threads[botId] ? { threads: { ...s.threads, [botId]: { ...s.threads[botId], loadingEarlier: false } } } : {}));
    }
  },

  async loadBundle(botId) {
    const b = get().bots[botId];
    // The bundle is the owner's (a bot shared through a workspace has none).
    if (!b || b.access) return;
    try {
      const bundle = await needClient().get<BotBundle>(`/bots/${encodeURIComponent(botId)}/bundle`);
      set((s) => ({ bundles: { ...s.bundles, [botId]: bundle } }));
    } catch { /* the details screen shows its own empty state */ }
  },

  async loadTasks() {
    try {
      const r = await needClient().get<{ tasks: Task[] }>("/tasks");
      set({ tasks: r.tasks });
    } catch {
      if (get().tasks === null) set({ tasks: [] });
    }
  },

  setOpenBot(botId) {
    set({ openBotId: botId });
    if (botId) { void clearBot(botId); liveClearBot(botId); }
  },

  async markRead(botId) {
    set((s) => (s.bots[botId] ? { bots: { ...s.bots, [botId]: { ...s.bots[botId], unread: 0 } } } : {}));
    try { await needClient().post(`/bots/${encodeURIComponent(botId)}/read`); } catch { /* the next bot event restores the count */ }
  },

  async send(botId, text, attachments) {
    const r = await needClient().post<{ row: Row }>(`/bots/${encodeURIComponent(botId)}/messages`, { text, attachments: attachments.map((a) => a.path) });
    const th = get().threads[botId];
    if (th && r.row && r.row.generation === th.generation) set((s) => ({ threads: { ...s.threads, [botId]: applyRowsPage(s.threads[botId], { generation: th.generation, rows: [r.row] }) } }));
  },

  async stop(botId) {
    await needClient().post(`/bots/${encodeURIComponent(botId)}/stop`);
  },

  async decide(approvalId, decision) {
    const r = cardReq.decide(approvalId, decision);
    await needClient().post(r.path, r.body);
  },

  async answer(botId, seq, answer) {
    const r = cardReq.answer(botId, seq, answer);
    await needClient().post(r.path, r.body);
  },

  async dismissCard(botId, seq) {
    await needClient().post(cardReq.dismiss(botId, seq).path);
  },

  async continueRow(botId, seq) {
    await needClient().post(`/bots/${encodeURIComponent(botId)}/rows/${seq}/continue`);
  },

  call(method, path, body) {
    return needClient().request(method, path, method === "GET" ? undefined : body ?? {});
  },

  applyEvent(ev) {
    const s = get();
    const r = applyEvent({ bots: s.bots, live: s.live, threads: s.threads }, ev);
    if (r.state.bots !== s.bots || r.state.live !== s.live || r.state.threads !== s.threads) set(r.state);
    if (r.reloadBots) void s.loadBots();
    if (r.reloadTasks) void s.loadTasks();
    if (r.bundleOf && (s.bundles[r.bundleOf] || s.openBotId === r.bundleOf)) void s.loadBundle(r.bundleOf);
    // Opened chat in front: it is read as it comes.
    if (ev.type === "bot" && ev.bot.id === s.openBotId && appActive && ev.bot.unread > 0) void s.markRead(ev.bot.id);
    if (!usePrefs.getState().notify) return;
    // The background connection notifies while the app is not in front: not twice.
    if (!jsShouldNotify(appActive, useLive.getState().enabled)) return;
    for (const a of r.alerts) {
      if (appActive && s.openBotId === a.botId) continue;
      const bot = get().bots[a.botId];
      if (!bot) continue;
      void notifyBot(bot.id, bot.name, a.kind === "waiting" ? a.text || t("notify.waiting") : firstWords(a.text));
    }
  },
}));

async function signedIn(user: User) {
  setLocale(usePrefs.getState().locale ?? user.locale);
  useStore.setState({ user, boot: "ready", online: true });
  // A background connection, or the phone relay, that the system or an app update stopped comes back.
  liveResume();
  relayResume();
  const s = useStore.getState();
  await s.loadBots();
  void s.loadTasks();
  startStream();
}
