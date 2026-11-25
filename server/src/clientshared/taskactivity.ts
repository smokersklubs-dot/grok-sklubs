/**
 * L177 — iPhone Live Activity of a bot's running task: the pieces the server (liveactivity.ts) and the mobile app
 * (mobile/src/liveActivity.ts) must agree on. One source so the app's local updates and the server's pushes show the
 * same thing.
 *
 * `TaskActivityState` is the Live Activity's ContentState. Its JSON must decode with Swift's default `Codable` strategies
 * (Apple: "don't use any custom JSON encoding strategies … the system always decodes JSON payloads for Live Activity
 * updates using its default encoding strategies" —
 * https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications).
 * Hence no Date: `startedAt` is plain seconds since 1970 (a default-decoded Swift Date would read seconds since 2001).
 * The Swift twin is `ContentState` in mobile/targets/sklubot-live/SklubotTaskAttributes.swift and in
 * mobile/modules/sklubot-liveactivity/ios/SklubotLiveActivityModule.swift: same field names, same types.
 */

export interface TaskActivityState {
  /** What the bot is doing now (or what it waits for), one short line. Empty: the widget shows its own « En cours ». */
  step: string;
  /** Tool calls since the task started (Live.steps). */
  steps: number;
  /** When the task started, seconds since 1970 (the widget counts the elapsed time itself). */
  startedAt: number;
  /** The bot waits for the user (an approval, a question). */
  awaiting: boolean;
}

/** The part of the server's `Live` (shared.ts) this needs; structural so the mobile app can pass its own copy. */
export interface LiveLike {
  running: boolean;
  activity: { kind: string; detail?: string; since: number } | null;
  awaiting: { reason: string; since: number } | null;
  startedAt: number | null;
  caption?: string | null;
  thread?: number;
  steps?: number;
  tasks?: { thread: number; running: boolean; activity: LiveLike["activity"]; awaiting: LiveLike["awaiting"]; startedAt: number | null }[];
}

export const STEP_MAX = 80;
const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();
const clipStep = (s: string) => (s.length > STEP_MAX ? `${s.slice(0, STEP_MAX - 1)}…` : s);

/**
 * The state of the task of `thread` (0 = the main chat) in a bot's live state, or null when that task is not running
 * nor waiting any more (the Live Activity then ends). `label` turns an activity kind into words (the app's dictionary).
 */
export function taskActivityState(live: LiveLike, thread = 0, label: (kind: string) => string = () => ""): TaskActivityState | null {
  let lane: { running: boolean; activity: LiveLike["activity"]; awaiting: LiveLike["awaiting"]; startedAt: number | null; caption?: string | null; steps?: number } | null = null;
  const tasks = live.tasks ?? [];
  if (tasks.length) lane = tasks.find((t) => t.thread === thread) ?? null;
  else if ((live.thread ?? 0) === thread) lane = live;
  if (!lane || (!lane.running && !lane.awaiting)) return null;
  const front = lane === live || (live.thread ?? 0) === thread;
  const words = lane.awaiting ? lane.awaiting.reason : lane.activity?.detail || (front ? live.caption : "") || (lane.activity ? label(lane.activity.kind) : "");
  return {
    step: clipStep(oneLine(words ?? "")),
    steps: front ? Math.max(0, Math.floor(live.steps ?? 0)) : 0,
    startedAt: Math.floor((lane.startedAt ?? lane.activity?.since ?? Date.now()) / 1000),
    awaiting: !!lane.awaiting,
  };
}

export const sameState = (a: TaskActivityState | null, b: TaskActivityState | null) =>
  !!a && !!b && a.step === b.step && a.steps === b.steps && a.startedAt === b.startedAt && a.awaiting === b.awaiting;

/** The "Stop" link of the Live Activity: opens the app, which asks before stopping (App.tsx). */
export const stopUrl = (botId: string, thread = 0) => `sklubot://stop/${encodeURIComponent(botId)}?thread=${Math.max(0, Math.floor(thread))}`;

/** `sklubot://stop/<botId>?thread=<n>` → { botId, thread }; anything else → null. */
export function parseStopUrl(url: string): { botId: string; thread: number } | null {
  const m = /^sklubot:\/\/stop\/([^/?#]+)(?:\?thread=(\d{1,6}))?$/.exec(url.trim());
  if (!m) return null;
  let botId = "";
  try { botId = decodeURIComponent(m[1]); } catch { return null; }
  if (!/^[\w-]{1,64}$/.test(botId)) return null;
  return { botId, thread: m[2] ? Number(m[2]) : 0 };
}
