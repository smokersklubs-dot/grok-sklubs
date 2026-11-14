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

export function emit(userId: string, event: ServerEvent) {
  for (const fn of listeners.get(userId) ?? []) {
    try { fn(event); } catch { /* a broken stream must not affect the others */ }
  }
}

// Live state is deliberately in-memory: after a restart every bot is idle.
const live = new Map<string, Live>();
const idle = (): Live => ({ running: false, activity: null, awaiting: null, startedAt: null, queued: 0 });

export function getLive(botId: string): Live {
  return live.get(botId) ?? idle();
}

export function setLive(userId: string, botId: string, patch: Partial<Live>) {
  const next = { ...getLive(botId), ...patch };
  live.set(botId, next);
  emit(userId, { type: "live", botId, live: next });
}

export function clearLive(userId: string, botId: string) {
  live.delete(botId);
  emit(userId, { type: "live", botId, live: idle() });
}

/** Every bot with a live state right now (running, or waiting on the user). */
export function liveEntries(): [string, Live][] {
  return [...live.entries()];
}
