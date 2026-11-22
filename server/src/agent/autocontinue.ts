import { createHash } from "node:crypto";
import { q } from "../db.js";

/**
 * L72 — automatic continuation, bounded by progress (backlog A-FAIRE L72; behaviour from the OMB and Hermes audits, our
 * own code).
 *
 * A turn stops at the step limit (and a subscription turn at its time limit) so a bot cannot run away. Before, only a
 * routine carried on, once; everything else waited for « Continuer », so a 3-hour task stopped at night until a click.
 * Now:
 * - « Continuer seul jusqu'au bout » under the notice (or a routine / background task) grants up to N automatic
 *   continuations for that conversation (AUTO_DEFAULT; a routine or task gets AUTO_UNATTENDED by itself);
 * - each one is used only if the turn that just stopped made PROGRESS: at least two different tool calls, no loop-guard
 *   stop, and a set of calls different from the previous stretch (a bot doing exactly the same thing again is not making
 *   progress). No progress, or none left: the usual notice with « Continuer » — never a silent stop, never an endless run.
 * The grant lives on disk (auto_continue), so it survives a restart, and ends when the conversation's work ends.
 */
q.run("CREATE TABLE IF NOT EXISTS auto_continue (bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, remaining INTEGER NOT NULL, used INTEGER NOT NULL DEFAULT 0, last_mark TEXT NOT NULL DEFAULT '', granted_at INTEGER NOT NULL, PRIMARY KEY (bot_id, thread))");

export const AUTO_DEFAULT = 5;
export const AUTO_UNATTENDED = 3;
export const AUTO_MAX = 10;

/** « Continuer seul »: up to `n` automatic continuations for this conversation (replaces an earlier grant). */
export function grantAuto(botId: string, thread: number, n = AUTO_DEFAULT): void {
  const left = Math.max(1, Math.min(AUTO_MAX, Math.floor(n)));
  q.run("INSERT INTO auto_continue (bot_id, thread, remaining, granted_at) VALUES (?, ?, ?, ?) ON CONFLICT(bot_id, thread) DO UPDATE SET remaining = excluded.remaining, used = 0, last_mark = '', granted_at = excluded.granted_at", botId, thread, left, Date.now());
}
/** A routine's or background task's turn: the unattended allowance, unless one is already running for it. */
export function ensureUnattended(botId: string, thread: number): void {
  if (!q.get("SELECT 1 FROM auto_continue WHERE bot_id = ? AND thread = ?", botId, thread)) grantAuto(botId, thread, AUTO_UNATTENDED);
}
export function endAuto(botId: string, thread: number): void { q.run("DELETE FROM auto_continue WHERE bot_id = ? AND thread = ?", botId, thread); }
export const autoLeft = (botId: string, thread: number) => q.get<{ remaining: number }>("SELECT remaining FROM auto_continue WHERE bot_id = ? AND thread = ?", botId, thread)?.remaining ?? 0;

/** What a turn did, for the progress test: the distinct tool calls it made (Turn.repeats keys) and whether the guard stopped it. */
export interface Stretch { calls: Iterable<string>; loopStopped: boolean }

/** A mark of the calls of a stretch: the same set twice in a row is no progress. */
const markOf = (calls: string[]) => createHash("sha256").update(calls.slice().sort().join("\n")).digest("hex").slice(0, 16);

/**
 * At the step (or time) limit: whether to carry on by itself now. Uses one continuation when it does. `why` says, for the
 * notice, why not ("none": no grant or none left; "progress": the stretch made no progress).
 */
export function takeAuto(botId: string, thread: number, s: Stretch): { go: true; left: number; used: number } | { go: false; why: "none" | "progress" } {
  const row = q.get<{ remaining: number; used: number; last_mark: string }>("SELECT remaining, used, last_mark FROM auto_continue WHERE bot_id = ? AND thread = ?", botId, thread);
  if (!row || row.remaining <= 0) return { go: false, why: "none" };
  const calls = [...new Set(s.calls)];
  const mark = markOf(calls);
  if (s.loopStopped || calls.length < 2 || mark === row.last_mark) { endAuto(botId, thread); return { go: false, why: "progress" }; }
  q.run("UPDATE auto_continue SET remaining = remaining - 1, used = used + 1, last_mark = ? WHERE bot_id = ? AND thread = ?", mark, botId, thread);
  return { go: true, left: row.remaining - 1, used: row.used + 1 };
}

/** Turns that stopped at the step limit (their conversation's grant must outlive them). */
const atLimit = new WeakSet<object>();
export const markAtLimit = (turn: object) => { atLimit.add(turn); };
export const wasAtLimit = (turn: object) => atLimit.has(turn);
