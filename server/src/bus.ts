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
