/**
 * L177 — iPhone Live Activity: a bot's running task (name, step, elapsed time, « Stop ») on the Lock Screen and in the
 * Dynamic Island. OFF by default, on only when BOTH:
 * - the app was built with SKLUBOT_LIVE_ACTIVITY=1 (app.config.ts → `extra.liveActivity`, the widget target and the native
 *   module modules/sklubot-liveactivity), and
 * - the server has it on (LIVE_ACTIVITY_PUSH=1 and an APNs key, GET /api/live-activity): the server then keeps the Live
 *   Activity current while the app is in the background (server/src/liveactivity.ts).
 * Android and builds without the flag: everything here is a no-op.
 *
 * The app starts the Live Activity (ActivityKit can start one only from the app before iOS 17.2) and sends its push
 * token to the server; while the app is open it also updates it itself. What it shows comes from
 * server/src/clientshared/taskactivity.ts, shared with the server. Not tested on a device (no Apple account here).
 */
import { requireOptionalNativeModule } from "expo";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { sameState, stopUrl, taskActivityState, type LiveLike, type TaskActivityState } from "../../server/src/clientshared/taskactivity";

export interface StartAttributes { botId: string; botName: string; thread: number; stopUrl: string; stopLabel: string; runningLabel: string; waitingLabel: string }
interface Sub { remove(): void }
export interface LiveActivityNative {
  areEnabled(): boolean;
  list(): { id: string; botId: string; thread: number }[];
  start(attrs: StartAttributes, state: TaskActivityState, withPush: boolean): Promise<string>;
  update(id: string, state: TaskActivityState): Promise<boolean>;
  end(id: string, state: TaskActivityState): Promise<boolean>;
  addListener(name: "onPushToken", fn: (e: { id: string; botId: string; thread: number; token: string }) => void): Sub;
}

/** Built with the flag (app.config.ts `extra.liveActivity`), on an iPhone, with the native module linked. */
export function liveActivityBuilt(extra: unknown = Constants.expoConfig?.extra, os: string = Platform.OS, nativeOk = !!native): boolean {
  return os === "ios" && nativeOk && (extra as { liveActivity?: unknown } | undefined)?.liveActivity === true;
}
const native: LiveActivityNative | null = Platform.OS === "ios" ? requireOptionalNativeModule<LiveActivityNative>("SklubotLiveActivity") : null;

/** One running Live Activity, by `${botId}:${thread}`. */
export interface Shown { id: string; botId: string; thread: number; state: TaskActivityState }
export type Action =
  | { kind: "start"; key: string; botId: string; thread: number; botName: string; state: TaskActivityState }
  | { kind: "update"; key: string; id: string; state: TaskActivityState }
  | { kind: "end"; key: string; id: string; state: TaskActivityState };

export const keyOf = (botId: string, thread: number) => `${botId}:${thread}`;

/** The threads of a bot's live state that run or wait (the main chat is 0; lanes list every task). */
export function threadsOf(live: LiveLike): number[] {
  if (live.tasks?.length) return live.tasks.filter((t) => t.running || t.awaiting).map((t) => t.thread);
  return live.running || live.awaiting ? [live.thread ?? 0] : [];
}

/**
 * What to do so the Live Activities on screen match the bots' live state: start the new tasks, update the changed ones,
 * end the finished ones. At most `max` at once (the most recent tasks win; iOS also limits how many an app may show).
 */
export function plan(shown: Map<string, Shown>, bots: Record<string, { name: string }>, lives: Record<string, LiveLike>, label: (kind: string) => string, max = 3): Action[] {
  const wanted = new Map<string, { botId: string; thread: number; state: TaskActivityState }>();
  for (const [botId, live] of Object.entries(lives)) {
    if (!bots[botId]) continue;
    for (const thread of threadsOf(live)) {
      const state = taskActivityState(live, thread, label);
      if (state) wanted.set(keyOf(botId, thread), { botId, thread, state });
    }
  }
  const keep = [...wanted.entries()].sort((a, b) => (shown.has(b[0]) ? 1 : 0) - (shown.has(a[0]) ? 1 : 0) || b[1].state.startedAt - a[1].state.startedAt).slice(0, max);
  const kept = new Map(keep);
  const out: Action[] = [];
  for (const [key, s] of shown) if (!kept.has(key)) out.push({ kind: "end", key, id: s.id, state: { ...s.state, awaiting: false } });
  for (const [key, w] of kept) {
    const s = shown.get(key);
    if (!s) out.push({ kind: "start", key, botId: w.botId, thread: w.thread, botName: bots[w.botId].name, state: w.state });
    else if (!sameState(s.state, w.state)) out.push({ kind: "update", key, id: s.id, state: w.state });
  }
  return out;
}

type Call = <T = unknown>(method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE", path: string, body?: unknown) => Promise<T>;
export interface Texts { stop: string; running: string; waiting: string; label: (kind: string) => string }

/**
 * The controller: `sync` after every change of the bots' live state (state/store.ts), `reset` when signed out.
 * `api` and `nat` are injectable for tests.
 */
export function createLiveActivities(nat: LiveActivityNative | null = native, built = liveActivityBuilt()) {
  const shown = new Map<string, Shown>();
  const tokens = new Map<string, string>(); // activity id → last token sent
  let serverOn: boolean | null = null;
  let call: Call | null = null;
  let busy: Promise<void> = Promise.resolve();
  let sub: Sub | null = null;
  const on = () => built && !!nat;

  async function onToken(e: { id: string; botId: string; thread: number; token: string }) {
    if (!call) return;
    const replaces = tokens.get(e.id);
    tokens.set(e.id, e.token);
    try { await call("POST", `/bots/${encodeURIComponent(e.botId)}/live-activity`, { token: e.token, thread: e.thread, ...(replaces ? { replaces } : {}) }); } catch { /* the app keeps updating it while open */ }
  }

  return {
    /** Signed in: ask the server once, take back the Live Activities left from a previous run. */
    async connect(api: Call): Promise<boolean> {
      call = api;
      if (!on()) return false;
      try { serverOn = (await api<{ enabled: boolean }>("GET", "/live-activity")).enabled === true; } catch { serverOn = false; }
      if (!sub && nat) sub = nat.addListener("onPushToken", (e) => void onToken(e));
      try { for (const a of nat!.list()) shown.set(keyOf(a.botId, a.thread), { id: a.id, botId: a.botId, thread: a.thread, state: { step: "", steps: -1, startedAt: 0, awaiting: false } }); } catch { /* none */ }
      return serverOn;
    },
    /** Applies `plan`; one pass at a time, in order. */
    sync(bots: Record<string, { name: string }>, lives: Record<string, LiveLike>, texts: Texts): Promise<void> {
      if (!on() || !serverOn) return busy;
      busy = busy.then(async () => {
        try { if (!nat!.areEnabled()) return; } catch { return; }
        for (const a of plan(shown, bots, lives, texts.label)) {
          try {
            if (a.kind === "start") {
              const attrs: StartAttributes = { botId: a.botId, botName: a.botName, thread: a.thread, stopUrl: stopUrl(a.botId, a.thread), stopLabel: texts.stop, runningLabel: texts.running, waitingLabel: texts.waiting };
              const id = await nat!.start(attrs, a.state, true);
              shown.set(a.key, { id, botId: a.botId, thread: a.thread, state: a.state });
            } else if (a.kind === "update") {
              await nat!.update(a.id, a.state);
              shown.set(a.key, { ...shown.get(a.key)!, state: a.state });
            } else {
              await nat!.end(a.id, a.state);
              shown.delete(a.key);
              const token = tokens.get(a.id);
              tokens.delete(a.id);
              if (token && call) await call("DELETE", `/live-activity/${token}`).catch(() => undefined);
            }
          } catch { /* not allowed now (Live Activities off in Settings, too many): the chat still shows everything */ }
        }
      });
      return busy;
    },
    /** Signed out: every Live Activity ends; nothing is sent any more. */
    async reset(): Promise<void> {
      const all = [...shown.values()];
      shown.clear();
      tokens.clear();
      serverOn = null;
      call = null;
      sub?.remove(); sub = null;
      for (const s of all) await nat?.end(s.id, { ...s.state, awaiting: false }).catch(() => false);
    },
    shownCount: () => shown.size,
  };
}

export const liveActivities = createLiveActivities();
