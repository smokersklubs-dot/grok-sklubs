import { q } from "../db.js";
import type { ToolUseBlock } from "../llm/index.js";
import { pushLater } from "../push.js";
import { runs } from "../routines.js";
import { activeTurns, audit, clip, laneDbKey, now, rows, turnKey, users, type BotRecord, type QueuedWork } from "../store.js";
import { external } from "./authorize.js";
import { gt } from "./guardtext.js";
import type { Turn } from "./loop.js";
import type { Trigger } from "./turn-request.js";

/**
 * L18 — after a restart, a turn that was in the middle of an action with no reservation of its own is not replayed
 * blindly. Actions that reach outside Sklubot through an app already get a reservation (executions.ts: cut off, they
 * become "uncertain" with a card and are never replayed). What had no such protection: acting on a screen (a click that
 * buys or publishes, typing into a form, a key press, a browser dialog), a command, a message sent to another bot or a
 * group. Once a turn starts one of those, a marker is on disk until the bot's next turn starts (the action may have gone
 * through even when the restart came a few steps later); a restart that finds one does not put the turn back in the queue:
 * the chat says which action was cut off, with "Continue", and the continuation tells the bot to check before redoing
 * anything. A routine run cut off that way is recorded as an error ("not replayed"). Idea from the Timon / Superbot /
 * Rakazo audits (behaviour only, our own code).
 *
 * Graceful stop: on SIGTERM / SIGINT (index.ts), turns finish the step they are in and wait at the next step boundary
 * (safePoint), so most restarts find no marker at all and their turns pick up cleanly; the server waits at most
 * GRACEFUL_STOP_SEC (20 s) for that.
 */
q.run(`CREATE TABLE IF NOT EXISTS turn_unprotected (
  bot_id TEXT NOT NULL, call_id TEXT NOT NULL, tool TEXT NOT NULL, label TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, started_at INTEGER NOT NULL,
  done INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (bot_id, call_id))`);

/** Tools that change something outside the conversation without a reservation (see the module note). */
export const UNPROTECTED = new Set(["screen_click", "screen_type", "screen_key", "screen_drag", "element_click", "element_type", "element_select", "browser_dialog", "shell_run", "bot_message", "room_post", "helper_message"]);

/** Whether this call, about to run, is one a restart must not replay blindly. Reserved calls are already protected. */
export function unprotected(turn: Pick<Turn, "builtin" | "remote">, call: Pick<ToolUseBlock, "name" | "input">, reserved: boolean): boolean {
  return !reserved && UNPROTECTED.has(call.name) && !external(turn, call.name, call.input);
}

/** Before an allowed call runs: marks it on disk when it is unprotected. */
export function beginUnprotected(turn: Turn, call: ToolUseBlock, reserved: boolean, label: string) {
  if (!unprotected(turn, call, reserved)) return;
  q.run("INSERT OR REPLACE INTO turn_unprotected (bot_id, call_id, tool, label, thread, started_at) VALUES (?, ?, ?, ?, ?, ?)", turn.bot.id, call.id, call.name, clip(label, 200), turn.thread ?? 0, now());
}

/** The call is over (done, failed or stopped): its marker stays for the rest of the turn, as finished. */
export function endUnprotected(botId: string, callId: string) {
  q.run("UPDATE turn_unprotected SET done = 1 WHERE bot_id = ? AND call_id = ?", botId, callId);
}

/** A new turn of this bot starts: the markers of its previous turn are history. */
// Lanes (lanes.ts): a bot may run a turn per thread at once, so a turn clears only its own thread's markers.
export function clearUnprotected(botId: string) { const [id, t] = turnKey(botId).split("~"); q.run("DELETE FROM turn_unprotected WHERE bot_id = ? AND thread = ?", id, Number(t) || 0); }

/** The unprotected actions of a lane's current turn ("bot~thread"; a bare bot id: the whole bot), oldest first (`done`: it had finished). */
export const unprotectedOf = (botId: string) => {
  const [id, t] = botId.split("~");
  return t === undefined ? q.all<{ tool: string; label: string; thread: number; done: number }>("SELECT tool, label, thread, done FROM turn_unprotected WHERE bot_id = ? ORDER BY started_at, rowid", id)
    : q.all<{ tool: string; label: string; thread: number; done: number }>("SELECT tool, label, thread, done FROM turn_unprotected WHERE bot_id = ? AND thread = ? ORDER BY started_at, rowid", id, Number(t) || 0);
};

/** What "Continue" tells the bot after such a restart (loop.ts continueAfterStepLimit, reason "restart"). */
export const RESTART_CHECK_TEXT = "Your last turn was cut off by a server restart in the middle of an action (a click, typing, a command or a message), and the user pressed Continue. That action may or may not have gone through. Before redoing anything, check the current state — the screen, the page, the app, what was sent — and never repeat what already went through. Then finish the work, or say plainly where things stand.";

/**
 * At start-up, for a bot whose turn the restart cut off: when it was in the middle of an unprotected action, the turn is
 * not replayed — the chat gets a notice with "Continue", the owner a push, a routine run is closed as an error — and true
 * is returned (the caller then drops the queued turn). Otherwise false: the usual recovery applies.
 */
export function holdAfterRestart(bot: BotRecord | null | undefined, botId: string, row: QueuedWork | undefined): boolean {
  const marks = unprotectedOf(botId);
  const [id, t] = botId.split("~");
  if (t === undefined) q.run("DELETE FROM turn_unprotected WHERE bot_id = ?", id); else q.run("DELETE FROM turn_unprotected WHERE bot_id = ? AND thread = ?", id, Number(t) || 0);
  if (!marks.length || !bot || bot.kind !== "agent") return false;
  // The action cut off in the middle if there is one, else the last one this turn had done.
  const m = marks.find((x) => !x.done) ?? marks[marks.length - 1];
  const loc = users.localeOf(bot.userId);
  const text = m.done
    ? gt(loc, "The server restarted during my work, after I had done “{action}”. I am not picking it up on my own, so nothing is done twice. Check where things stand, then press Continue: I will look at what is done before redoing anything.", { action: m.label })
    : gt(loc, "The server restarted while I was doing “{action}”. I am not redoing it on my own: it may already have gone through. Check it, then press Continue: I will look at what is done before redoing anything.", { action: m.label });
  rows.append(bot, { kind: "notice", tone: "warn", text, action: { kind: "continue", status: "pending", reason: "restart" } }, m.thread);
  let trigger: Trigger | null = null;
  try { trigger = row ? (JSON.parse(row.trigger) as Trigger) : null; } catch { trigger = null; }
  if (trigger?.kind === "routine" && trigger.runId) runs.finish(trigger.runId, "error", gt(loc, "Interrupted by a server restart during “{action}”: not replayed.", { action: m.label }));
  pushLater(bot.userId, { kind: "needs", title: bot.name, body: text, botId: bot.id });
  audit(bot.userId, "system", `${bot.name}: cut off by a restart during ${m.tool} (${m.label}) — not replayed, waiting for the owner`, bot.id);
  activeTurns.end(botId);
  return true;
}

/** Markers no turn owns any more (their bot's turn was not cut off, or was handled): cleared after the recovery. */
export function clearUnprotectedMarkers() { q.run("DELETE FROM turn_unprotected"); }

// ── Graceful stop ──────────────────────────────────────────────────────────────────────────────────────────────────
let stopping = false;
const parked = new Set<string>();
export const gracefulStopping = () => stopping;

/** A turn at a step boundary: during a graceful stop it waits here for good (the restart picks it up cleanly). */
export function safePoint(botId: string): Promise<void> | void {
  if (!stopping) return;
  parked.add(laneDbKey(botId));
  return new Promise<void>(() => { /* never resolves: the process is about to exit */ });
}

/**
 * Starts a graceful stop and waits until every running turn is parked at a step boundary (or has ended), at most
 * `timeoutMs`. Resolves with how many turns were still busy when it gave up (0: all clean).
 */
export async function gracefulStop(timeoutMs = Number(process.env.GRACEFUL_STOP_SEC ?? 20) * 1000, poll = 100): Promise<number> {
  stopping = true;
  const busy = () => activeTurns.leftover().filter((t) => !parked.has(t.bot_id)).length;
  const until = Date.now() + Math.max(0, timeoutMs);
  while (busy() > 0 && Date.now() < until) await new Promise((r) => setTimeout(r, poll));
  return busy();
}

/** Tests only: back to normal. */
export function resetGracefulStop() { stopping = false; parked.clear(); }
