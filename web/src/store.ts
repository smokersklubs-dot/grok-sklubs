import { create } from "zustand";
import { api, apiUpload, errText, setUnauthorizedHandler } from "./api";
import { getLocale, isLocale, setLocale as applyLocale, t } from "./i18n";
import { notifyBot } from "./lib/notify";
import { startPresence } from "./lib/push";
import { playShout, startEuphoria } from "./lib/cheer";
import type { Attachment, Bot, BotBundle, BotSection, ComputerState, PauseState, Connector, Live, Locale, NativeAccount, NativeApp, NativeVendorSetup, ReactionEmoji, Recording, RelayDevice, RelayDownloads, Routine, Row, ServerEvent, Task, TodayReport, User, VideoStatus } from "./types";

export interface NativeState { apps: NativeApp[]; vendors: NativeVendorSetup[]; accounts: NativeAccount[] }

export type Theme = "system" | "light" | "dark";
export type ModalState =
  | null
  | { kind: "createBot" }
  | { kind: "createRoom" }
  | { kind: "search"; mode?: "chat" }
  | { kind: "duplicate"; botId: string }
  | { kind: "templates"; tab?: "gallery" | "file" | "url" }
  | { kind: "exportTemplate"; sectionId?: string; botIds?: string[] }
  | { kind: "connectors"; prefill?: { name: string; botId: string; seq: number } };
export type BotSettingsTab = "general" | "skills" | "memories" | "routines" | "localTools" | "reach" | "telegram" | "email" | "sharing" | "api";
export type AppSection = "shortcuts" | "general" | "today" | "surveillance" | "profile" | "models" | "notifications" | "computer" | "devices" | "permissions" | "rules" | "memory" | "skills" | "connectors" | "vault" | "keys" | "pages" | "usage" | "checkins" | "activity" | "team" | "workspaces" | "voice" | "email" | "account" | "subscription" | "admin";
/** Hosted mode (server/src/hosted.ts): only present when the server runs with HOSTED_MODE=1. */
export interface HostedInfo { operator: boolean; /** The owner sells Sklubot credits (off by default: "Mes comptes IA"). */ creditsForSale?: boolean; links: { pricing: string; terms: string; legal: string; privacy: string } }

/** A short message at the bottom of the window, optionally with one action (usually "Undo"). */
export interface Toast { id: number; text: string; action?: { label: string; run: () => void | Promise<void> } }
/** A message to scroll to and flash in the open conversation. */
export interface Jump { botId: string; seq: number; tick: number }
/** An earlier conversation shown read-only. */
export interface HistoryTarget { botId: string; generation: number; seq: number }

export interface Thread {
  generation: number;
  rows: Row[];
  loaded: boolean;
  loading: boolean;
  loadingEarlier: boolean;
  hasMore: boolean;
  error: string | null;
}

export interface CallLine { id: number; role: "user" | "assistant"; text: string; final: boolean; /** Wave 6: the bot was cut off in this line (barge-in). */ cut?: boolean }
export interface CallState {
  botId: string;
  status: "connecting" | "live" | "error";
  error: string | null;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
  startedAt: number | null;
  lines: CallLine[];
  /** Wave 6: "server" when the call goes through the server's speech services, else the browser's own speech. */
  pipeline?: "server" | "browser";
  /** Server pipeline: the user is being heard right now (voice activity). */
  hearing?: boolean;
  /** When the user last cut the bot off (barge-in), for the indicator. */
  bargedAt?: number | null;
  /** The error means the browser's own speech cannot work here: the call bar offers Settings → Voice. */
  voiceSettings?: boolean;
  /** Which speech services the server uses ("whisper-cpp · piper"). */
  providers?: string;
}

/** A file picked for the next message: uploaded straight away, sent by its `attachment.path`. */
export interface Upload {
  id: string;
  name: string;
  size: number;
  mime: string;
  status: "uploading" | "ready" | "error";
  /** Object URL for a local thumbnail (images only). */
  preview: string | null;
  attachment: Attachment | null;
  error: string | null;
}
export const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS = 10;

export const IDLE_LIVE: Live = { running: false, activity: null, awaiting: null, startedAt: null, queued: 0 };
const PAGE = 200;
const PREF_KEY = "sklubot.prefs";

interface Prefs { selectedId: string | null; detailsOpen: boolean; sidebarCollapsed: boolean; theme: Theme }

function readPrefs(): Prefs {
  const base: Prefs = { selectedId: null, detailsOpen: true, sidebarCollapsed: false, theme: "system" };
  try {
    const raw = localStorage.getItem(PREF_KEY);
    if (!raw) return base;
    const p = JSON.parse(raw) as Partial<Prefs>;
    return {
      selectedId: typeof p.selectedId === "string" ? p.selectedId : null,
      detailsOpen: typeof p.detailsOpen === "boolean" ? p.detailsOpen : true,
      sidebarCollapsed: typeof p.sidebarCollapsed === "boolean" ? p.sidebarCollapsed : false,
      theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
    };
  } catch {
    return base;
  }
}

function writePrefs(patch: Partial<Prefs>): void {
  try {
    localStorage.setItem(PREF_KEY, JSON.stringify({ ...readPrefs(), ...patch }));
  } catch {
    /* storage unavailable: preferences just won't persist */
  }
}

export function applyTheme(theme: Theme): void {
  const dark = theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.setAttribute("data-theme", dark ? "dark" : "light");
  // Keeps the phone status bar / installed-app title bar in step with the theme.
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", dark ? "#131416" : "#f4f2ee");
}

/** Merge rows by seq; an incoming row replaces a stored one when its rev is higher or equal. */
export function mergeRows(existing: Row[], incoming: Row[]): Row[] {
  if (incoming.length === 0) return existing;
  const bySeq = new Map<number, Row>();
  for (const r of existing) bySeq.set(r.seq, r);
  for (const r of incoming) {
    const cur = bySeq.get(r.seq);
    if (!cur || r.rev >= cur.rev) bySeq.set(r.seq, r);
  }
  return [...bySeq.values()].sort((a, b) => a.seq - b.seq);
}

const emptyThread = (generation: number): Thread => ({
  generation, rows: [], loaded: false, loading: false, loadingEarlier: false, hasMore: false, error: null,
});

const prefs = readPrefs();
const narrow = typeof window !== "undefined" && window.innerWidth < 1100;

interface Store {
  boot: "loading" | "signedOut" | "ready";
  user: User | null;
  signupOpen: boolean;
  /** A fresh install: the first account needs the setup code printed by the installer. */
  setupCodeRequired: boolean;
  /** The first bot a new account gets, as the server would name it (the sign-up form lets the person change it). */
  firstBot: { name: string; label: string };
  /** Whether bots on this server can create images. */
  imageGeneration: boolean;
  /** Hosted mode: the public pages to link and whether the signed-in person is an operator (null: not a hosted server). */
  hosted: HostedInfo | null;
  /** The signed-in person watches this server (its owner, or a hosted operator): the Surveillance page is theirs. */
  sentinel: boolean;
  /** OPEN_SIGNUP (server publicsignup.ts): the public landing page, and the Turnstile site key of the sign-up form. */
  publicSignup: { landing: boolean; turnstileSiteKey: string | null };
  /** How bots can make videos (Higgsfield app, a video API, or neither). */
  video: VideoStatus;
  /** The thread open in the side panel: the bot and the seq of the message it hangs on. */
  openThread: { botId: string; seq: number } | null;
  /** Demonstrations being recorded on bots' screens ("Show me how"), and the skills drafted from them. */
  recordings: Record<string, Recording | null>;
  locale: Locale;
  online: boolean;

  bots: Record<string, Bot>;
  live: Record<string, Live>;
  threads: Record<string, Thread>;
  bundles: Record<string, BotBundle>;
  tasks: Task[] | null;
  /** "Aujourd'hui": the last report loaded (the sidebar's badge counts its needs when it is today's). */
  today: TodayReport | null;
  computer: ComputerState | null;
  /** The user's own computers linked with Sklubot Relais (null until loaded), and where to download the app. */
  relay: RelayDevice[] | null;
  relayDownloads: RelayDownloads | null;
  /** The user's computer shown full size (live view), by device id. */
  relayViewerId: string | null;
  connectors: Connector[] | null;
  connectorsError: string | null;
  /** Built-in apps (Gmail, Outlook, Slack…): what they offer, the user's OAuth clients and signed-in accounts. */
  native: NativeState | null;
  usageTick: number;
  pagesTick: number;
  /** Bumped when the shared profile changes (Settings or a bot's profile_update). */
  profileTick: number;
  /** Bumped when the user's rules or the reviewer model change (wave 5). */
  rulesTick: number;
  /** Wave 6: workspaces changed (members, roles, shares). */
  workspacesTick: number;
  /** Wave 6: a bot's mailbox changed. */
  mailTick: Record<string, number>;
  /** Bumped when memory settings (sensitive topics, writing style) change. */
  memorySettingsTick: number;
  /** Bumped when vault items change on the server (a secret saved from a card, an import). */
  vaultTick: number;
  /** Bumped when a bot's local tool servers change ("localtools" event): its settings tab loads them again. */
  localToolsTick: Record<string, number>;
  /** Wave 7: key health, temporary links or reading logins changed. */
  wave7Tick: number;
  /** The user's own sidebar sections. */
  sections: BotSection[];
  /** "Pause": what the owner paused (GET /pauses); `all` while every bot is paused. */
  pauses: PauseState;
  /** Find in the open chat: highlighted matches, and the one shown (next / previous). */
  find: { botId: string; query: string; index: number } | null;
  /** Bumped per bot on every `routines` event, so open run histories reload. */
  routineTicks: Record<string, number>;
  jump: Jump | null;
  history: HistoryTarget | null;

  selectedId: string | null;
  view: "chat" | "tasks" | "today" | "surveillance" | "announcements" | "command";
  detailsOpen: boolean;
  sidebarCollapsed: boolean;
  mobileNav: boolean;
  theme: Theme;
  modal: ModalState;
  botSettings: { botId: string; tab: BotSettingsTab } | null;
  appSettings: AppSection | null;
  viewerBotId: string | null;
  /** The viewer opens straight in control mode (read once when it mounts). */
  viewerControl: boolean;
  toast: Toast | null;
  drafts: Record<string, string>;
  uploads: Record<string, Upload[]>;
  focusTick: number;
  call: CallState | null;

  init(): Promise<void>;
  signedIn(user: User): Promise<void>;
  logout(): Promise<void>;
  loadBots(): Promise<void>;
  selectBot(id: string): void;
  loadRows(id: string, force?: boolean): Promise<void>;
  loadEarlier(id: string): Promise<void>;
  addRows(botId: string, rows: Row[]): void;
  markRead(id: string): Promise<void>;
  loadBundle(id: string): Promise<void>;
  mutateBundle(id: string, fn: (b: BotBundle) => BotBundle): void;
  toggleRoutine(routine: Routine, enabled: boolean): Promise<void>;
  loadTasks(): Promise<void>;
  /** Loads the Today page's report for `date` (YYYY-MM-DD, the user's day; default: today). Throws on failure. */
  loadToday(date?: string): Promise<TodayReport>;
  loadComputer(): Promise<void>;
  loadRelay(): Promise<void>;
  openRelayViewer(deviceId: string): void;
  closeRelayViewer(): void;
  loadConnectors(): Promise<void>;
  loadNative(): Promise<void>;
  loadSections(): Promise<void>;
  loadPauses(): Promise<void>;
  /** Change a bot's place in the sidebar (pin, section, hidden) or mark it unread. */
  organise(botId: string, patch: { pinned?: boolean; sectionId?: string | null; listHidden?: boolean }): Promise<void>;
  markUnread(botId: string): Promise<void>;
  openFind(botId: string, query?: string): void;
  setFind(patch: Partial<{ query: string; index: number }>): void;
  closeFind(): void;
  upsertBot(bot: Bot): void;
  resetConversation(id: string): Promise<void>;
  applyEvent(ev: ServerEvent): void;
  resync(): void;

  /** Change the interface language; saved to the account when signed in. Rejects (and reverts) if saving fails. */
  setLocale(locale: Locale): Promise<void>;
  /** Start uploading files for the next message. Returns a message when some were refused. */
  attachFiles(botId: string, files: File[]): string | null;
  removeUpload(botId: string, id: string): void;
  clearUploads(botId: string, ids: string[]): void;
  setTheme(theme: Theme): void;
  setView(view: "chat" | "tasks" | "today" | "surveillance" | "announcements" | "command"): void;
  toggleDetails(open?: boolean): void;
  toggleSidebar(): void;
  setMobileNav(open: boolean): void;
  openModal(modal: ModalState): void;
  openBotSettings(botId: string, tab?: BotSettingsTab): void;
  closeBotSettings(): void;
  openAppSettings(section?: AppSection): void;
  closeAppSettings(): void;
  /** Open a bot's computer full size; `control` opens it straight in control mode. */
  openViewer(botId: string, opts?: { control?: boolean }): void;
  closeViewer(): void;
  /** Show a toast. With an action it stays about 6 s; without, about 2 s. */
  showToast(text: string, action?: Toast["action"]): void;
  dismissToast(): void;
  /** Open a bot and scroll its conversation to one message. */
  jumpTo(botId: string, seq: number): void;
  clearJump(): void;
  openHistory(target: HistoryTarget): void;
  closeHistory(): void;
  setDraft(botId: string, text: string): void;
  focusComposer(): void;
  /** Open the thread on one message in the side panel (and load its replies). */
  openThreadPanel(botId: string, seq: number): void;
  closeThread(): void;
  loadThread(botId: string, seq: number): Promise<void>;
  /** Put or take back one reaction on a message. */
  react(botId: string, seq: number, emoji: ReactionEmoji): Promise<void>;
  loadRecording(botId: string): Promise<void>;
  setRecording(botId: string, recording: Recording | null): void;
}

let toastTimer: number | undefined;
let started = false;
let uploadSeq = 0;
let toastSeq = 0;
let jumpSeq = 0;
/** A card or a notice came or changed: the Today badge is refreshed a few seconds later (once for a burst). */
let todayTimer: number | undefined;

const firstWords = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const useStore = create<Store>((set, get) => ({
  boot: "loading",
  user: null,
  signupOpen: false,
  setupCodeRequired: false,
  firstBot: { name: "Juno", label: "" },
  imageGeneration: false,
  hosted: null,
  sentinel: false,
  publicSignup: { landing: false, turnstileSiteKey: null },
  video: { provider: null, higgsfield: false },
  openThread: null,
  recordings: {},
  locale: getLocale(),
  online: true,

  bots: {},
  live: {},
  threads: {},
  bundles: {},
  tasks: null,
  today: null,
  computer: null,
  relay: null,
  relayDownloads: null,
  relayViewerId: null,
  connectors: null,
  connectorsError: null,
  native: null,
  usageTick: 0,
  pagesTick: 0,
  profileTick: 0,
  rulesTick: 0,
  workspacesTick: 0,
  mailTick: {},
  memorySettingsTick: 0,
  vaultTick: 0,
  localToolsTick: {},
  wave7Tick: 0,
  sections: [],
  pauses: { all: null, sections: [], bots: [] },
  find: null,
  routineTicks: {},
  jump: null,
  history: null,

  selectedId: prefs.selectedId,
  view: "chat",
  detailsOpen: prefs.detailsOpen && !narrow,
  sidebarCollapsed: prefs.sidebarCollapsed,
  mobileNav: false,
  theme: prefs.theme,
  modal: null,
  botSettings: null,
  appSettings: null,
  viewerBotId: null,
  viewerControl: false,
  toast: null,
  drafts: {},
  uploads: {},
  focusTick: 0,
  call: null,

  async init() {
    if (started) return;
    started = true;
    setUnauthorizedHandler(() => {
      if (get().boot === "ready") set({ boot: "signedOut", user: null });
    });
    try {
      const me = await api<{ user: User | null; signupOpen: boolean; setupCodeRequired?: boolean; imageGeneration?: boolean; video?: VideoStatus; firstBot?: { name: string; label: string }; hosted?: HostedInfo; sentinel?: boolean; landing?: boolean; turnstileSiteKey?: string }>("GET", `/me?locale=${get().locale}`);
      set({ publicSignup: { landing: me.landing === true, turnstileSiteKey: me.turnstileSiteKey ?? null }, imageGeneration: me.imageGeneration === true, video: me.video ?? { provider: null, higgsfield: false }, hosted: me.hosted ?? null, sentinel: me.sentinel === true, ...(me.firstBot ? { firstBot: me.firstBot } : {}) });
      if (me.user) {
        set({ signupOpen: me.signupOpen });
        await get().signedIn(me.user);
      } else {
        set({ boot: "signedOut", signupOpen: me.signupOpen, setupCodeRequired: me.setupCodeRequired === true });
      }
    } catch {
      set({ boot: "signedOut" });
    }
  },

  async signedIn(user) {
    set({ user });
    // Once signed in, the account's language wins over the device's.
    if (isLocale(user.locale)) {
      applyLocale(user.locale);
      set({ locale: user.locale });
    }
    if (get().boot === "signedOut") {
      // Signed in from the form: /me was read before there was a session, so read the server flags again.
      api<{ imageGeneration?: boolean; video?: VideoStatus; hosted?: HostedInfo; sentinel?: boolean }>("GET", "/me").then(
        (me) => set({ imageGeneration: me.imageGeneration === true, video: me.video ?? { provider: null, higgsfield: false }, hosted: me.hosted ?? null, sentinel: me.sentinel === true }),
        () => undefined,
      );
    }
    // Mandatory e-mail verification (server publicsignup.ts): an unconfirmed account gets only the confirmation page
    // (App.tsx); the server refuses everything else, so nothing is loaded until it is confirmed (VerifyEmail.tsx calls
    // signedIn again then).
    if (user.emailUnverified) {
      set({ boot: "ready" });
      return;
    }
    try {
      await get().loadBots();
    } catch {
      /* the shell shows an empty state and the event stream will retry */
    }
    set({ boot: "ready" });
    void get().loadTasks();
    void get().loadToday().catch(() => undefined);
    void get().loadComputer();
    void get().loadRelay();
    void get().loadConnectors();
    void get().loadSections();
    void get().loadPauses();
    // Opened from a push notification (/?bot=<id>): show that bot, then tidy the address.
    const wanted = new URLSearchParams(window.location.search).get("bot");
    if (wanted && get().bots[wanted]) get().selectBot(wanted);
    if (wanted) window.history.replaceState(null, "", window.location.pathname);
    // Opened from the daily digest (/?view=today): the Today page; from a Sentinelle alert (/?view=surveillance): Surveillance.
    const wantedView = new URLSearchParams(window.location.search).get("view");
    // « Centre de commandement »: /?view=command.
    if (wantedView === "today" || wantedView === "surveillance" || wantedView === "command") {
      get().setView(wantedView);
      window.history.replaceState(null, "", window.location.pathname);
    }
    // Wave 6: opened from a workspace invitation while signed in: join, then show the bots shared there.
    const invite = new URLSearchParams(window.location.search).get("invite");
    if (invite) {
      window.history.replaceState(null, "", window.location.pathname);
      api<{ workspace: { name: string } }>("POST", "/invites/accept", { token: invite }).then(
        (r) => { get().showToast(t("ws.joined", { ws: r.workspace.name })); void get().loadBots(); },
        (e: unknown) => get().showToast(errText(e)),
      );
    }
    startPresence();
    const { connectEvents } = await import("./events");
    connectEvents();
  },

  async logout() {
    try {
      await api("POST", "/auth/logout");
    } finally {
      window.location.reload();
    }
  },

  async loadBots() {
    const r = await api<{ bots: Bot[]; live: Record<string, Live> }>("GET", "/bots");
    const bots: Record<string, Bot> = {};
    for (const b of r.bots) bots[b.id] = b;
    set({ bots, live: r.live ?? {} });
    const cur = get().selectedId;
    if (!cur || !bots[cur]) {
      const list = [...r.bots].sort((a, b) => b.lastActivityAt - a.lastActivityAt);
      const next = list.find((b) => b.primary) ?? list[0] ?? null;
      if (next) {
        const view = get().view;
        get().selectBot(next.id);
        if (view !== "chat") set({ view });
      } else {
        set({ selectedId: null });
      }
    } else {
      void get().loadRows(cur);
      if (!get().bundles[cur]) void get().loadBundle(cur);
      if (bots[cur].unread > 0 && document.visibilityState === "visible") void get().markRead(cur);
    }
  },

  selectBot(id) {
    const bot = get().bots[id];
    if (!bot) return;
    writePrefs({ selectedId: id });
    set((st) => ({ selectedId: id, view: "chat", mobileNav: false, openThread: st.openThread?.botId === id ? st.openThread : null, find: st.find?.botId === id ? st.find : null }));
    void get().loadRows(id);
    void get().loadBundle(id);
    if (bot.unread > 0) void get().markRead(id);
  },

  async loadRows(id, force = false) {
    const existing = get().threads[id];
    if (existing && (existing.loading || (existing.loaded && !force))) return;
    set((s) => ({
      threads: { ...s.threads, [id]: { ...(s.threads[id] ?? emptyThread(s.bots[id]?.generation ?? 0)), loading: true, error: null } },
    }));
    try {
      const r = await api<{ generation: number; rows: Row[] }>("GET", `/bots/${id}/rows`);
      set((s) => {
        const cur = s.threads[id];
        if (!cur) return {};
        let rows = cur.rows;
        let generation = cur.generation;
        if (r.generation > cur.generation) {
          rows = r.rows;
          generation = r.generation;
        } else if (r.generation === cur.generation) {
          rows = mergeRows(cur.rows, r.rows);
        }
        const hasMore = cur.loaded ? cur.hasMore : r.rows.length >= PAGE;
        return { threads: { ...s.threads, [id]: { ...cur, generation, rows, loaded: true, loading: false, hasMore, error: null } } };
      });
    } catch (e) {
      set((s) => {
        const cur = s.threads[id];
        return cur ? { threads: { ...s.threads, [id]: { ...cur, loading: false, error: errText(e) } } } : {};
      });
    }
  },

  async loadEarlier(id) {
    const t = get().threads[id];
    if (!t || !t.loaded || t.loadingEarlier || !t.hasMore || t.rows.length === 0) return;
    const before = t.rows[0].seq;
    const patch = (p: Partial<Thread>) =>
      set((s) => (s.threads[id] ? { threads: { ...s.threads, [id]: { ...s.threads[id], ...p } } } : {}));
    patch({ loadingEarlier: true });
    try {
      const r = await api<{ generation: number; rows: Row[] }>("GET", `/bots/${id}/rows?limit=${PAGE}&before=${before}`);
      const cur = get().threads[id];
      if (!cur || r.generation !== cur.generation) {
        patch({ loadingEarlier: false });
        return;
      }
      patch({ rows: mergeRows(cur.rows, r.rows), hasMore: r.rows.length >= PAGE, loadingEarlier: false });
    } catch (e) {
      patch({ loadingEarlier: false });
      get().showToast(errText(e));
    }
  },

  addRows(botId, rows) {
    set((s) => {
      const t = s.threads[botId];
      if (!t) return {};
      const fresh = rows.filter((r) => r.generation === t.generation);
      return fresh.length ? { threads: { ...s.threads, [botId]: { ...t, rows: mergeRows(t.rows, fresh) } } } : {};
    });
  },

  async markRead(id) {
    set((s) => (s.bots[id] ? { bots: { ...s.bots, [id]: { ...s.bots[id], unread: 0 } } } : {}));
    try {
      await api("POST", `/bots/${id}/read`);
    } catch {
      /* the next bot event restores the true count */
    }
  },

  async loadBundle(id) {
    try {
      const bundle = await api<BotBundle>("GET", `/bots/${id}/bundle`);
      set((s) => ({ bundles: { ...s.bundles, [id]: bundle } }));
    } catch {
      /* panels show their own loading/empty states */
    }
  },

  mutateBundle(id, fn) {
    set((s) => (s.bundles[id] ? { bundles: { ...s.bundles, [id]: fn(s.bundles[id]) } } : {}));
  },

  async toggleRoutine(routine, enabled) {
    const swap = (r: Routine) =>
      get().mutateBundle(routine.botId, (b) => ({ ...b, routines: b.routines.map((x) => (x.id === r.id ? r : x)) }));
    swap({ ...routine, enabled });
    try {
      const r = await api<{ routine: Routine }>("PATCH", `/routines/${routine.id}`, { enabled });
      swap(r.routine);
    } catch (e) {
      swap(routine);
      throw e;
    }
  },

  async loadToday(date) {
    const r = await api<TodayReport>("GET", `/today${date ? `?date=${encodeURIComponent(date)}` : ""}`);
    set({ today: r });
    return r;
  },
  async loadTasks() {
    try {
      const r = await api<{ tasks: Task[] }>("GET", "/tasks");
      set({ tasks: r.tasks });
    } catch {
      if (get().tasks === null) set({ tasks: [] });
    }
  },

  async loadRelay() {
    try {
      const r = await api<{ devices: RelayDevice[]; downloads: RelayDownloads }>("GET", "/relay/devices");
      set({ relay: r.devices, relayDownloads: r.downloads });
    } catch {
      set((s) => ({ relay: s.relay ?? [] }));
    }
  },

  openRelayViewer(deviceId) {
    set({ relayViewerId: deviceId });
  },

  closeRelayViewer() {
    set({ relayViewerId: null });
  },

  async loadComputer() {
    try {
      set({ computer: await api<ComputerState>("GET", "/computer") });
    } catch {
      /* keep the previous state */
    }
  },

  async loadNative() {
    try {
      set({ native: await api<NativeState>("GET", "/native") });
    } catch {
      /* keep the previous state */
    }
  },

  async loadPauses() {
    try {
      set({ pauses: await api<PauseState>("GET", "/pauses") });
    } catch {
      /* keep the previous state */
    }
  },

  async loadSections() {
    try {
      const r = await api<{ sections: BotSection[] }>("GET", "/sections");
      set({ sections: r.sections });
    } catch {
      /* keep the previous list */
    }
  },

  async organise(botId, patch) {
    const before = get().bots[botId];
    if (!before) return;
    set((s) => ({ bots: { ...s.bots, [botId]: { ...before, ...patch } } }));
    try {
      const r = await api<{ bot: Bot }>("PATCH", `/bots/${botId}`, patch);
      get().upsertBot(r.bot);
    } catch (e) {
      get().upsertBot(before);
      get().showToast(errText(e));
    }
  },

  async markUnread(botId) {
    try {
      const r = await api<{ bot: Bot }>("POST", `/bots/${botId}/unread`);
      get().upsertBot(r.bot);
    } catch (e) {
      get().showToast(errText(e));
    }
  },

  openFind(botId, query = "") {
    set({ find: { botId, query, index: 0 } });
  },
  setFind(patch) {
    set((s) => (s.find ? { find: { ...s.find, ...patch, ...(patch.query !== undefined && patch.index === undefined ? { index: 0 } : {}) } } : {}));
  },
  closeFind() {
    set({ find: null });
  },

  async loadConnectors() {
    try {
      const r = await api<{ connectors: Connector[] }>("GET", "/connectors");
      set({ connectors: r.connectors, connectorsError: null });
    } catch (e) {
      set({ connectorsError: errText(e) });
    }
  },

  upsertBot(bot) {
    set((s) => ({ bots: { ...s.bots, [bot.id]: bot } }));
  },

  async resetConversation(id) {
    const r = await api<{ generation: number }>("POST", `/bots/${id}/reset`);
    set((s) => {
      const t = s.threads[id];
      if (!t || t.generation >= r.generation) return {};
      return { threads: { ...s.threads, [id]: { ...t, generation: r.generation, rows: [], hasMore: false } } };
    });
  },

  applyEvent(ev) {
    switch (ev.type) {
      case "rows": {
        if (ev.rows.some((r) => r.body.kind === "card" || r.body.kind === "notice")) {
          window.clearTimeout(todayTimer);
          todayTimer = window.setTimeout(() => { if (get().view !== "today") void get().loadToday().catch(() => undefined); }, 4000);
        }
        // A finished reply, for a bot that isn't the open one or while the window is hidden.
        const before = get();
        const hidden = document.visibilityState !== "visible";
        if (hidden || before.selectedId !== ev.botId || before.view !== "chat") {
          const known = before.threads[ev.botId];
          for (let i = ev.rows.length - 1; i >= 0; i--) {
            const row = ev.rows[i];
            const b = row.body;
            if (b.kind !== "message" || b.role !== "assistant" || b.streaming || !b.text.trim()) continue;
            const old = known && known.generation === ev.generation ? known.rows.find((r) => r.seq === row.seq) : undefined;
            // Already shown as finished: this is only a later revision of the same message.
            if (old && old.body.kind === "message" && !old.body.streaming) continue;
            const bot = before.bots[ev.botId];
            if (bot) notifyBot(bot.id, bot.name, firstWords(b.text), () => get().selectBot(bot.id));
            break;
          }
        }
        set((s) => {
          const t = s.threads[ev.botId];
          if (!t || ev.generation < t.generation) return {};
          const next: Thread =
            ev.generation > t.generation
              ? { ...t, generation: ev.generation, rows: mergeRows([], ev.rows), hasMore: false }
              : { ...t, rows: mergeRows(t.rows, ev.rows) };
          return { threads: { ...s.threads, [ev.botId]: next } };
        });
        break;
      }
      case "reset": {
        if (get().openThread?.botId === ev.botId) set({ openThread: null });
        set((s) => {
          const t = s.threads[ev.botId];
          if (!t || ev.generation <= t.generation) return {};
          return { threads: { ...s.threads, [ev.botId]: { ...t, generation: ev.generation, rows: [], hasMore: false } } };
        });
        break;
      }
      case "live": {
        const was = get().live[ev.botId]?.awaiting ?? null;
        set((s) => ({ live: { ...s.live, [ev.botId]: ev.live } }));
        if (!was && ev.live.awaiting && document.visibilityState !== "visible") {
          const bot = get().bots[ev.botId];
          if (bot) notifyBot(bot.id, bot.name, firstWords(ev.live.awaiting.reason || t("notify.waiting")), () => get().selectBot(bot.id));
        }
        break;
      }
      case "roster":
        void get().loadBots().catch(() => undefined);
        break;
      case "bot": {
        get().upsertBot(ev.bot);
        const s = get();
        if (ev.bot.id === s.selectedId && s.view === "chat" && ev.bot.unread > 0 && document.visibilityState === "visible") {
          void s.markRead(ev.bot.id);
        }
        break;
      }
      case "relay":
        set({ relay: ev.devices });
        break;
      case "computer":
        set({ computer: ev.computer });
        break;
      case "routines":
        set((s) => ({ routineTicks: { ...s.routineTicks, [ev.botId]: (s.routineTicks[ev.botId] ?? 0) + 1 } }));
        if (get().bundles[ev.botId] || get().selectedId === ev.botId) void get().loadBundle(ev.botId);
        break;
      case "memories":
        if (get().bundles[ev.botId] || get().selectedId === ev.botId) void get().loadBundle(ev.botId);
        break;
      case "tasks":
        if (get().bundles[ev.botId] || get().selectedId === ev.botId) void get().loadBundle(ev.botId);
        void get().loadTasks();
        break;
      case "native":
        void get().loadNative();
        break;
      case "sections":
        void get().loadSections();
        break;
      case "pauses":
        void get().loadPauses();
        void get().loadSections();
        void get().loadBots().catch(() => undefined);
        break;
      case "vault":
        set((s) => ({ vaultTick: s.vaultTick + 1 }));
        break;
      case "localtools":
        set((s) => ({ localToolsTick: { ...s.localToolsTick, [ev.botId]: (s.localToolsTick[ev.botId] ?? 0) + 1 } }));
        break;
      case "connectors":
        void get().loadConnectors();
        // Connecting or disconnecting Higgsfield changes how videos are made.
        api<{ video?: VideoStatus }>("GET", "/me").then((me) => me.video && set({ video: me.video }), () => undefined);
        break;
      case "recording":
        get().setRecording(ev.botId, ev.recording);
        break;
      case "usage":
        set((s) => ({ usageTick: s.usageTick + 1 }));
        break;
      case "pages":
        set((s) => ({ pagesTick: s.pagesTick + 1 }));
        break;
      case "profile":
        set((s) => ({ profileTick: s.profileTick + 1 }));
        break;
      case "rules":
        set((s) => ({ rulesTick: s.rulesTick + 1 }));
        break;
      case "workspaces":
        set((s) => ({ workspacesTick: s.workspacesTick + 1 }));
        break;
      case "health":
      case "publicLinks":
      case "reach":
        set((s) => ({ wave7Tick: s.wave7Tick + 1 }));
        break;
      case "mail":
        set((s) => ({ mailTick: { ...s.mailTick, [ev.botId]: (s.mailTick[ev.botId] ?? 0) + 1 } }));
        break;
      case "memorySettings":
        set((s) => ({ memorySettingsTick: s.memorySettingsTick + 1 }));
        break;
      case "cheer": {
        // The bot found a gem: its character goes wild for a few seconds (and may shout, once per cheer).
        const s = get();
        const look = s.bots[ev.botId]?.character;
        if (!look || look.euphoria === false) break;
        startEuphoria(ev.botId);
        // Not looking at this bot (another tab, another bot): a system notification so the gem is not missed.
        if (document.visibilityState !== "visible" || s.selectedId !== ev.botId) {
          const bot = s.bots[ev.botId];
          if (bot) notifyBot(bot.id, `💎 ${bot.name}`, firstWords(t("event.cheer", { reason: ev.reason })), () => get().selectBot(bot.id));
        }
        if (look.shout !== false && document.visibilityState === "visible") playShout(s.locale, { speak: !s.call });
        break;
      }
      default:
        break;
    }
  },

  resync() {
    const s = get();
    void s.loadBots().catch(() => undefined);
    void s.loadComputer();
    void s.loadRelay();
    void s.loadTasks();
    void s.loadConnectors();
    const id = s.selectedId;
    if (id && s.bots[id]) {
      void s.loadRows(id, true);
      void s.loadBundle(id);
    }
    // Threads of bots that aren't open are dropped so they reload fresh when next opened.
    set((st) => {
      const threads: Record<string, Thread> = {};
      const cur = st.selectedId;
      if (cur && st.threads[cur]) threads[cur] = st.threads[cur];
      return { threads };
    });
  },

  async setLocale(locale) {
    const before = get().locale;
    if (locale === before) return;
    applyLocale(locale);
    set({ locale });
    if (!get().user) return;
    try {
      const r = await api<{ user: User }>("PUT", "/prefs", { locale });
      set({ user: r.user });
    } catch (e) {
      if (get().locale === locale) {
        applyLocale(before);
        set({ locale: before });
      }
      throw e;
    }
  },

  attachFiles(botId, files) {
    let problem: string | null = null;
    let room = MAX_ATTACHMENTS - (get().uploads[botId]?.length ?? 0);
    const added: Upload[] = [];
    const patch = (id: string, p: Partial<Upload>) =>
      set((s) => ({ uploads: { ...s.uploads, [botId]: (s.uploads[botId] ?? []).map((u) => (u.id === id ? { ...u, ...p } : u)) } }));
    for (const file of files) {
      if (file.size > MAX_UPLOAD_BYTES) {
        problem = t("composer.tooBig", { name: file.name });
        continue;
      }
      if (room <= 0) {
        problem = t("composer.tooMany");
        break;
      }
      room--;
      const id = `u${++uploadSeq}`;
      const mime = file.type || "application/octet-stream";
      added.push({ id, name: file.name, size: file.size, mime, status: "uploading", preview: mime.startsWith("image/") ? URL.createObjectURL(file) : null, attachment: null, error: null });
      apiUpload<{ attachment: Attachment }>(`/bots/${botId}/uploads`, file).then(
        (r) => patch(id, { status: "ready", attachment: r.attachment }),
        (e: unknown) => patch(id, { status: "error", error: errText(e) }),
      );
    }
    if (added.length) set((s) => ({ uploads: { ...s.uploads, [botId]: [...(s.uploads[botId] ?? []), ...added] } }));
    return problem;
  },
  removeUpload(botId, id) {
    get().clearUploads(botId, [id]);
  },
  clearUploads(botId, ids) {
    set((s) => {
      const list = s.uploads[botId] ?? [];
      for (const u of list) if (ids.includes(u.id) && u.preview) URL.revokeObjectURL(u.preview);
      return { uploads: { ...s.uploads, [botId]: list.filter((u) => !ids.includes(u.id)) } };
    });
  },

  setTheme(theme) {
    writePrefs({ theme });
    applyTheme(theme);
    set({ theme });
  },
  setView(view) {
    set({ view, mobileNav: false });
    const s = get();
    if (view === "tasks") void s.loadTasks();
    else if (s.selectedId && s.bots[s.selectedId]?.unread) void s.markRead(s.selectedId);
  },
  toggleDetails(open) {
    const next = open ?? !get().detailsOpen;
    writePrefs({ detailsOpen: next });
    set({ detailsOpen: next });
  },
  toggleSidebar() {
    const next = !get().sidebarCollapsed;
    writePrefs({ sidebarCollapsed: next });
    set({ sidebarCollapsed: next });
  },
  setMobileNav(open) {
    set({ mobileNav: open });
  },
  openModal(modal) {
    set({ modal });
  },
  openBotSettings(botId, tab = "general") {
    set({ botSettings: { botId, tab } });
  },
  closeBotSettings() {
    set({ botSettings: null });
  },
  openAppSettings(section = "general") {
    set({ appSettings: section });
  },
  closeAppSettings() {
    set({ appSettings: null });
  },
  openViewer(botId, opts) {
    set({ viewerBotId: botId, viewerControl: !!opts?.control });
  },
  closeViewer() {
    set({ viewerBotId: null, viewerControl: false });
  },
  showToast(text, action) {
    window.clearTimeout(toastTimer);
    const id = ++toastSeq;
    set({ toast: { id, text, action } });
    toastTimer = window.setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, action ? 6000 : 2000);
  },
  dismissToast() {
    window.clearTimeout(toastTimer);
    set({ toast: null });
  },
  jumpTo(botId, seq) {
    if (!get().bots[botId]) return;
    get().selectBot(botId);
    set({ jump: { botId, seq, tick: ++jumpSeq } });
  },
  clearJump() {
    set({ jump: null });
  },
  openHistory(target) {
    set({ history: target });
  },
  closeHistory() {
    set({ history: null });
  },
  openThreadPanel(botId, seq) {
    set({ openThread: { botId, seq } });
    void get().loadThread(botId, seq);
  },
  closeThread() {
    set({ openThread: null });
  },
  async loadThread(botId, seq) {
    try {
      const r = await api<{ generation: number; rows: Row[] }>("GET", `/bots/${botId}/rows?thread=${seq}&limit=500`);
      // Thread replies live in the same list as the main chat (one sequence per conversation); views filter them.
      get().addRows(botId, r.rows);
    } catch (e) {
      get().showToast(errText(e));
    }
  },
  async react(botId, seq, emoji) {
    try {
      await api("POST", `/bots/${botId}/rows/${seq}/reactions`, { emoji });
    } catch (e) {
      get().showToast(errText(e));
    }
  },
  async loadRecording(botId) {
    try {
      const r = await api<{ recording: Recording | null }>("GET", `/bots/${botId}/teach`);
      get().setRecording(botId, r.recording);
    } catch {
      /* the viewer shows no recording */
    }
  },
  setRecording(botId, recording) {
    set((s) => ({ recordings: { ...s.recordings, [botId]: recording } }));
  },
  setDraft(botId, text) {
    set((s) => ({ drafts: { ...s.drafts, [botId]: text } }));
  },
  focusComposer() {
    set((s) => ({ focusTick: s.focusTick + 1 }));
  },
}));

/** Bots other than the primary, most recently active first. */
export function sortedBots(bots: Record<string, Bot>): Bot[] {
  return Object.values(bots).sort((a, b) => b.lastActivityAt - a.lastActivityAt || a.name.localeCompare(b.name));
}

export function primaryBot(bots: Record<string, Bot>): Bot | null {
  return Object.values(bots).find((b) => b.primary) ?? null;
}
