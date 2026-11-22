/**
 * L96 — a better organised team of bots (ideas from CopilotKit, the timon clean-room spec T48, Hermes, Ponytail, OMB;
 * our own code):
 *
 * - « Qui peut demander à qui »: per account, "open" (default: every bot may write to every other, as before) or
 *   "hierarchy": the main bot may ask anyone and anyone may ask the main bot; a helper asks only the bot that started it;
 *   bots of one section (a « département ») ask each other; across sections only the sections' leads ask each other. A
 *   section's lead is the one the owner picked (setSectionLead) or, by default, its oldest bot. A refusal says whom to ask
 *   instead, so the work goes up the chain rather than stopping.
 * - Helpers beyond MAX_HELPERS at work are QUEUED instead of refused: the request is kept (on disk) and starts when one
 *   of the running helpers has finished its work. At most MAX_HELPERS * 3 helpers exist at once (idle ones included).
 * - A helper's result comes back in a set form (Result / How I checked / What remains), routed to the bot that started it
 *   as before (loop.ts: its last words go back to the parent).
 */
import { q } from "../db.js";
import { bots, type BotRecord } from "../store.js";
import { MAX_HELPERS, startHelper } from "./team.js";
import { isBusy } from "./loop.js";

q.run("CREATE TABLE IF NOT EXISTS team_ask_policy (user_id TEXT PRIMARY KEY, mode TEXT NOT NULL DEFAULT 'open')");
q.run("CREATE TABLE IF NOT EXISTS section_leads (section_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL)");
q.run("CREATE TABLE IF NOT EXISTS helper_queue (id INTEGER PRIMARY KEY AUTOINCREMENT, parent_id TEXT NOT NULL, goal TEXT NOT NULL, label TEXT, depth INTEGER NOT NULL DEFAULT 0, tainted INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)");

export type AskMode = "open" | "hierarchy";
/** A function, not a constant: askrules.ts and team.ts import each other, so MAX_HELPERS may not be initialised yet when this file loads. */
export const helpersExistingMax = (): number => MAX_HELPERS * 3;

export const askMode = (userId: string): AskMode => (q.get<{ mode: string }>("SELECT mode FROM team_ask_policy WHERE user_id = ?", userId)?.mode === "hierarchy" ? "hierarchy" : "open");
export function setAskMode(userId: string, mode: AskMode): AskMode {
  q.run("INSERT INTO team_ask_policy (user_id, mode) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET mode = excluded.mode", userId, mode === "hierarchy" ? "hierarchy" : "open");
  return askMode(userId);
}

/** The lead of a section: the bot the owner picked (still in it), else its oldest agent bot. */
export function sectionLead(userId: string, sectionId: string): BotRecord | null {
  const members = bots.list(userId).filter((b) => b.kind === "agent" && !b.parentId && b.sectionId === sectionId);
  const picked = q.get<{ bot_id: string }>("SELECT bot_id FROM section_leads WHERE section_id = ? AND user_id = ?", sectionId, userId)?.bot_id;
  return members.find((b) => b.id === picked) ?? [...members].sort((a, b) => a.createdAt - b.createdAt)[0] ?? null;
}
export function setSectionLead(userId: string, sectionId: string, botId: string): void {
  q.run("INSERT INTO section_leads (section_id, user_id, bot_id) VALUES (?, ?, ?) ON CONFLICT(section_id) DO UPDATE SET bot_id = excluded.bot_id, user_id = excluded.user_id", sectionId, userId, botId);
}

/** Why `from` may not write to `to` under the account's rule, with whom to ask instead; null when it may. */
export function askRefusal(from: BotRecord, to: BotRecord): string | null {
  if (askMode(from.userId) !== "hierarchy") return null;
  if (from.parentId) {
    if (to.id === from.parentId) return null;
    const parent = bots.byId(from.parentId);
    return `As a helper you only report to ${parent?.name ?? "the bot that started you"}. Put what you need from ${to.name} in your report.`;
  }
  if (from.primary || to.primary) return null;
  if (from.sectionId && from.sectionId === to.sectionId) return null;
  const myLead = from.sectionId ? sectionLead(from.userId, from.sectionId) : null;
  const theirLead = to.sectionId ? sectionLead(to.userId, to.sectionId) : null;
  const iAmLead = !!myLead && myLead.id === from.id;
  if (iAmLead && theirLead && theirLead.id === to.id) return null;
  const main = bots.primary(from.userId);
  const via = iAmLead ? theirLead ?? main : myLead ?? main;
  return `The team works by hierarchy: you do not write to ${to.name} directly. Ask ${via?.name ?? "the main bot"}, who can pass it on.`;
}

/** The goal given to a helper, with the form its report must take. */
export const helperGoal = (goal: string) => `${goal}\n\n[When you are done, report in this form — Result: … / How I checked: … / What remains: … (or "nothing"). Your last message goes back automatically to the bot that started you.]`;

/** Helpers of a bot that are at work (a turn running or queued). */
export const busyHelpers = (parent: BotRecord) => bots.children(parent.id).filter((h) => isBusy(h.id)).length;

/**
 * helper_start: starts at once, or queues when MAX_HELPERS helpers are at work. "refused" only when too many helpers
 * exist at all (idle ones should be stopped first).
 */
export function requestHelper(parent: BotRecord, goal: string, label: string | undefined, depth: number, tainted: boolean): { started: BotRecord } | { queued: number } | { refused: string } {
  if (bots.children(parent.id).length >= helpersExistingMax()) return { refused: `You already have ${helpersExistingMax()} helpers. Stop the ones that finished (helper_stop) first.` };
  if (busyHelpers(parent) >= MAX_HELPERS) {
    q.run("INSERT INTO helper_queue (parent_id, goal, label, depth, tainted, created_at) VALUES (?, ?, ?, ?, ?, ?)", parent.id, goal, label ?? null, depth, tainted ? 1 : 0, Date.now());
    return { queued: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM helper_queue WHERE parent_id = ?", parent.id)!.n };
  }
  return { started: startHelper(parent, helperGoal(goal), label, depth, tainted) };
}

/** Starts queued helpers of this parent while fewer than MAX_HELPERS are at work. Returns how many started. */
export function startQueuedHelpers(parentId: string): number {
  const parent = bots.byId(parentId);
  if (!parent) { q.run("DELETE FROM helper_queue WHERE parent_id = ?", parentId); return 0; }
  let n = 0;
  while (n < MAX_HELPERS && busyHelpers(parent) < MAX_HELPERS && bots.children(parent.id).length < helpersExistingMax()) {
    const next = q.get<{ id: number; goal: string; label: string | null; depth: number; tainted: number }>("SELECT * FROM helper_queue WHERE parent_id = ? ORDER BY id LIMIT 1", parentId);
    if (!next) break;
    q.run("DELETE FROM helper_queue WHERE id = ?", next.id);
    startHelper(parent, helperGoal(next.goal), next.label ?? undefined, next.depth, !!next.tainted);
    n++;
  }
  return n;
}

/** A helper just reported: its parent's queue moves once the helper's turn has ended. */
export function helperFinished(parentId: string): void {
  setTimeout(() => { try { startQueuedHelpers(parentId); } catch (err) { console.error("[helper queue]", err); } }, 250).unref?.();
}
