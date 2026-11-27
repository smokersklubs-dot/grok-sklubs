import type { Live, ServerEvent } from "./shared.js";

type Listener = (e: ServerEvent) => void;
const listeners = new Map<string, Set<Listener>>();

export function subscribe(userId: string, fn: Listener): () => void {
  let set = listeners.get(userId);
  if (!set) listeners.set(userId, (set = new Set()));
  set.add(fn);
  return () => {
    set.delete(fn);
    if (!set.size) listeners.delete(userId);
  };
}

function deliver(userId: string, event: ServerEvent) {
  for (const fn of listeners.get(userId) ?? []) {
    try { fn(event); } catch { /* a broken stream must not affect the others */ }
  }
}

/**
 * Wave 6: a bot shared to a workspace has more than one reader. Events about its conversation and state also go to the
 * people of the workspace who may see it (workspaces.ts registers who they are and how they see the bot). Only these
 * kinds travel: nothing about the owner's account (vault, apps, usage, settings) ever does.
 */
const FANOUT = new Set<ServerEvent["type"]>(["rows", "reset", "live", "bot", "cheer", "mail"]);
let audienceOf: ((botId: string) => string[]) | null = null;
let viewFor: ((userId: string, event: ServerEvent) => ServerEvent | null) | null = null;
const audienceCache = new Map<string, { users: string[]; at: number }>();
export function setAudience(fn: (botId: string) => string[], view: (userId: string, event: ServerEvent) => ServerEvent | null) { audienceOf = fn; viewFor = view; }
/** Memberships or shares changed: who may see which bot is looked up again. */
export const invalidateAudience = () => audienceCache.clear();
function audience(botId: string): string[] {
  if (!audienceOf) return [];
  const hit = audienceCache.get(botId);
  if (hit && Date.now() - hit.at < 5000) return hit.users;
  const users = audienceOf(botId);
  audienceCache.set(botId, { users, at: Date.now() });
  return users;
}

export function emit(userId: string, event: ServerEvent) {
  deliver(userId, event);
  if (!FANOUT.has(event.type)) return;
  const botId = event.type === "bot" ? event.bot.id : (event as { botId?: string }).botId;
  if (!botId) return;
  for (const other of audience(botId)) {
    if (other === userId || !listeners.has(other)) continue;
    const seen = viewFor ? viewFor(other, event) : null;
    if (seen) deliver(other, seen);
  }
}

// Live state is deliberately in-memory: after a restart every bot is idle.
const live = new Map<string, Live>();
const idle = (): Live => ({ running: false, activity: null, awaiting: null, startedAt: null, queued: 0 });

/**
 * Lanes (agent/lanes.ts): a bot may run up to 3 turns at once, one per thread. Each running turn keeps its own live state
 * here (the lane is the thread of the turn the call comes from: setLiveLane); the bot's own state shows its front task
 * — the main chat when it runs, else the oldest — exactly as with one turn, and `tasks` lists every task while two or
 * more run. With a single turn nothing changes.
 */
let laneThread: (botId: string) => number | null = () => null;
export const setLiveLane = (fn: (botId: string) => number | null) => { laneThread = fn; };
const lanes = new Map<string, Map<number, Live>>();
function frontOf(m: Map<number, Live>): number | null {
  if (!m.size) return null;
  if (m.has(0)) return 0;
  return [...m.entries()].sort((a, b) => (a[1].startedAt ?? 0) - (b[1].startedAt ?? 0))[0][0];
}
const tasksOf = (m: Map<number, Live>): Live["tasks"] => (m.size < 2 ? undefined
  : [...m.entries()].sort((a, b) => (a[0] === 0 ? -1 : b[0] === 0 ? 1 : (a[1].startedAt ?? 0) - (b[1].startedAt ?? 0))).map(([thread, l]) => ({ thread, running: l.running, activity: l.activity, awaiting: l.awaiting, startedAt: l.startedAt })));

export function getLive(botId: string): Live {
  const t = laneThread(botId);
  const own = t === null ? undefined : lanes.get(botId)?.get(t);
  return own ?? live.get(botId) ?? idle();
}

export function setLive(userId: string, botId: string, patch: Partial<Live>) {
  const t = laneThread(botId);
  let m = t === null ? undefined : lanes.get(botId);
  if (t !== null) {
    if (!m) lanes.set(botId, (m = new Map()));
    m.set(t, { ...(m.get(t) ?? idle()), ...patch });
  }
  const base = live.get(botId) ?? idle();
  const front = m ? frontOf(m) : null;
  const next: Live = t === null || front === t ? { ...base, ...patch } : { ...base };
  if (m && m.size >= 2) next.tasks = tasksOf(m); else if ("tasks" in next) delete next.tasks;
  live.set(botId, next);
  emit(userId, { type: "live", botId, live: next });
}

export function clearLive(userId: string, botId: string) {
  const t = laneThread(botId);
  const m = lanes.get(botId);
  if (t !== null && m && m.size && !m.has(t)) return; // this lane shows nothing: the other tasks' state stays
  if (t !== null && m && m.has(t) && m.size > 1) {
    const wasFront = frontOf(m) === t;
    m.delete(t);
    const base = live.get(botId) ?? idle();
    const front = frontOf(m)!;
    const next: Live = wasFront ? { ...idle(), ...(base.driving ? { driving: base.driving } : {}), ...m.get(front)! } : { ...base };
    if (m.size >= 2) next.tasks = tasksOf(m); else delete next.tasks;
    live.set(botId, next);
    emit(userId, { type: "live", botId, live: next });
    return;
  }
  lanes.delete(botId);
  live.delete(botId);
  emit(userId, { type: "live", botId, live: idle() });
}

/** Every bot with a live state right now (running, or waiting on the user). */
export function liveEntries(): [string, Live][] {
  return [...live.entries()];
}
