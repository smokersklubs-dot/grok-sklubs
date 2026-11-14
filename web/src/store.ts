import { create } from "zustand";
import { api, apiUpload, errText, setUnauthorizedHandler } from "./api";
import { getLocale, isLocale, setLocale as applyLocale, t } from "./i18n";
import { notifyBot } from "./lib/notify";
import type { Attachment, Bot, BotBundle, ComputerState, Connector, Live, Locale, Routine, Row, ServerEvent, Task, User } from "./types";

export type Theme = "system" | "light" | "dark";
export type ModalState =
  | null
  | { kind: "createBot" }
  | { kind: "createRoom" }
  | { kind: "search" }
  | { kind: "connectors"; prefill?: { name: string; botId: string; seq: number } };
export type BotSettingsTab = "general" | "skills" | "memories" | "routines" | "telegram";
export type AppSection = "general" | "computer" | "permissions" | "connectors" | "vault" | "pages" | "usage" | "checkins" | "activity" | "team" | "account";

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

export interface CallLine { id: number; role: "user" | "assistant"; text: string; final: boolean }
export interface CallState {
  botId: string;
  status: "connecting" | "live" | "error";
  error: string | null;
  muted: boolean;
  speaking: boolean;
  listening: boolean;
  startedAt: number | null;
  lines: CallLine[];
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
  /** Whether bots on this server can create images. */
  imageGeneration: boolean;
  locale: Locale;
  online: boolean;

  bots: Record<string, Bot>;
  live: Record<string, Live>;
  threads: Record<string, Thread>;
  bundles: Record<string, BotBundle>;
  tasks: Task[] | null;
  computer: ComputerState | null;
  connectors: Connector[] | null;
  connectorsError: string | null;
  usageTick: number;
  pagesTick: number;
  /** Bumped per bot on every `routines` event, so open run histories reload. */
  routineTicks: Record<string, number>;
  jump: Jump | null;
  history: HistoryTarget | null;

  selectedId: string | null;
  view: "chat" | "tasks";
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
  loadComputer(): Promise<void>;
  loadConnectors(): Promise<void>;
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
  setView(view: "chat" | "tasks"): void;
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
}

let toastTimer: number | undefined;
let started = false;
let uploadSeq = 0;
let toastSeq = 0;
let jumpSeq = 0;

const firstWords = (text: string, max = 120): string => {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};

export const useStore = create<Store>((set, get) => ({
  boot: "loading",
  user: null,
  signupOpen: false,
  imageGeneration: false,
  locale: getLocale(),
  online: true,

  bots: {},
  live: {},
  threads: {},
  bundles: {},
  tasks: null,
  computer: null,
  connectors: null,
  connectorsError: null,
  usageTick: 0,
  pagesTick: 0,
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
      const me = await api<{ user: User | null; signupOpen: boolean; imageGeneration?: boolean }>("GET", "/me");
      set({ imageGeneration: me.imageGeneration === true });
      if (me.user) {
        set({ signupOpen: me.signupOpen });
        await get().signedIn(me.user);
      } else {
        set({ boot: "signedOut", signupOpen: me.signupOpen });
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
      api<{ imageGeneration?: boolean }>("GET", "/me").then(
        (me) => set({ imageGeneration: me.imageGeneration === true }),
        () => undefined,
      );
    }
    try {
      await get().loadBots();
    } catch {
      /* the shell shows an empty state and the event stream will retry */
    }
    set({ boot: "ready" });
    void get().loadTasks();
    void get().loadComputer();
    void get().loadConnectors();
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
        if (view === "tasks") set({ view });
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
    set({ selectedId: id, view: "chat", mobileNav: false });
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

  async loadTasks() {
    try {
      const r = await api<{ tasks: Task[] }>("GET", "/tasks");
      set({ tasks: r.tasks });
    } catch {
      if (get().tasks === null) set({ tasks: [] });
    }
  },

  async loadComputer() {
    try {
      set({ computer: await api<ComputerState>("GET", "/computer") });
    } catch {
      /* keep the previous state */
    }
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
      case "connectors":
        void get().loadConnectors();
        break;
      case "usage":
        set((s) => ({ usageTick: s.usageTick + 1 }));
        break;
      case "pages":
        set((s) => ({ pagesTick: s.pagesTick + 1 }));
        break;
      default:
        break;
    }
  },

  resync() {
    const s = get();
    void s.loadBots().catch(() => undefined);
    void s.loadComputer();
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
