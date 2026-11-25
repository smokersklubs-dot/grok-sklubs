import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { Locale } from "../shared.js";
import { botQueue, bots, laneKey, type BotRecord } from "../store.js";
import { bgTasks, stopTask } from "./bgtasks.js";
import { stopBatchesOf } from "./batches.js";
import { laneBusy, rowThread } from "./lanes.js";
import { discardSteering } from "./steering.js";
import { teammateLanes } from "./team.js";
import { dropWakes } from "./waitlater.js";

/**
 * L63 — « Stop » that really stops (backlog A-FAIRE L63; behaviour from the Nightly, Superbot, Timon T24, OMB and Noodle
 * audits, our own code).
 *
 * - Typed "stop" (or "arrête", "/stop"…) while the bot works is the Stop button: no model call, the conversation's turn
 *   stops, and so do the helpers and background tasks working for it and the teammates' threads answering a question it
 *   asked with wait (team.ts teammateLanes). The work waiting behind it is NOT dropped: the notice says how much waits.
 * - "Tout arrêter" (typed, or the button above the tasks): every turn of the bot, every helper, task and teammate thread
 *   working for it, AND its queue (messages, follow-ups and notes not started yet) are dropped. The notice gives the count.
 * What was already done is never undone or deleted; a stopped task can be resumed from its card.
 */

/** "stop" → the conversation; "all" → everything; null: not a stop command (sent to the bot as usual). */
export function stopCommand(raw: string): "stop" | "all" | null {
  const s = String(raw ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[!.…?⏹️\s]+/gu, " ").trim();
  if (!s || s.length > 30) return null;
  if (/^\/?(tout arreter|arrete tout|arretez tout|stop tout|stoppe tout|stop all|stop everything|stopall)$/.test(s)) return "all";
  if (/^\/?(stop|stoppe|stopper|stop stop|arrete|arretez|arrete toi|arrete-toi|stop ca|arrete ca|halt)$/.test(s)) return "stop";
  return null;
}
/** The ⏹ emoji alone counts too. */
export const isStopEmoji = (raw: string) => /^\s*⏹️?\s*$/u.test(String(raw ?? ""));

export interface StopReport { turns: number; helpers: number; tasks: number; teammates: number; dropped: number; waiting: number }

/** Queue rows cancelled by "Tout arrêter": runQueued (loop.ts) skips them if they come up in memory before being dropped. */
const cancelled = new Set<number>();
export const isCancelledJob = (id: number | null) => id !== null && cancelled.has(id);
/** L99: drops a worker's work that has not started yet (a batch task stopped before its turn began). */
export function dropPendingWork(botId: string): number {
  const pending = q.all<{ id: number }>("SELECT id FROM bot_queue WHERE bot_id = ? AND status = 'pending'", botId);
  for (const row of pending) { cancelled.add(row.id); botQueue.done(row.id); }
  return pending.length;
}

/** Whether anything of this bot runs or waits right now (only then does a typed "stop" mean Stop). */
export function hasWork(bot: BotRecord): boolean {
  if (laneBusy(bot.id) || q.get("SELECT 1 FROM bot_queue WHERE bot_id = ? AND status IN ('pending', 'running')", bot.id)) return true;
  if (bgTasks.forBot(bot.id).some((t) => t.state === "running" || t.state === "waiting")) return true;
  return bots.children(bot.id).some((h) => laneBusy(h.id));
}

/** The abort reason of a stop that writes its own notice (loop.ts then adds no "Stopped." of its own). */
export class ReportedStop extends Error { constructor() { super("stopped"); this.name = "ReportedStop"; } }
export const reportedStop = (signal: AbortSignal) => signal.aborted && signal.reason instanceof ReportedStop;

/**
 * Stops the bot's work: the turn of `thread` (undefined: every running turn of the bot), the helpers, background tasks and
 * teammates' threads working for it; with `dropQueue` ("Tout arrêter") its queue and notes too.
 * `ctl` is loop.ts's interrupt and running threads (passed in: this module must not import the loop).
 */
export async function stopWork(bot: BotRecord, opts: { dropQueue: boolean; thread?: number }, ctl: { interrupt: (key: string, reason?: Error) => boolean; runningThreads: (botId: string) => number[] }): Promise<StopReport> {
  // "Tout arrêter" writes the whole report itself; a plain Stop leaves the turn's own « Arrêté. » (or nothing, when the reply
  // was already delivered) and only adds a line when it stopped more, or when work still waits.
  const interrupt = (key: string) => (opts.dropQueue ? ctl.interrupt(key, new ReportedStop()) : ctl.interrupt(key));
  const r: StopReport = { turns: 0, helpers: 0, tasks: 0, teammates: 0, dropped: 0, waiting: 0 };
  // Teammates first: their lanes are forgotten once the asking turn stops (team.ts).
  for (const l of teammateLanes(bot.id)) if (interrupt(laneKey(l.toId, l.thread))) r.teammates++;
  for (const t of opts.thread === undefined ? ctl.runningThreads(bot.id) : [opts.thread]) if (interrupt(laneKey(bot.id, t))) r.turns++;
  for (const t of bgTasks.forBot(bot.id)) if (t.state === "running" || t.state === "waiting") { await stopTask(t); r.tasks++; }
  r.tasks += await stopBatchesOf(bot.id); // L99: a batch's tasks are not in that list (batches.ts)
  for (const h of bots.children(bot.id)) if (ctl.runningThreads(h.id).length && interrupt(h.id)) r.helpers++;
  const pending = q.all<{ id: number; trigger: string }>("SELECT id, trigger FROM bot_queue WHERE bot_id = ? AND status = 'pending' ORDER BY id", bot.id);
  if (opts.dropQueue) {
    for (const row of pending) { cancelled.add(row.id); botQueue.done(row.id); }
    r.dropped = pending.length + discardSteering(bot.id) + dropWakes(bot.id); // L97: planned "come back later" wakes too
  } else r.waiting = opts.thread === undefined ? pending.length : pending.filter((row) => rowThread(row) === opts.thread).length;
  return r;
}

/** The sentence the chat shows after a stop ("" after a plain Stop that stopped only the turn and left nothing waiting). */
export function stopText(loc: Locale, r: StopReport, all: boolean): string {
  const parts: string[] = [];
  if (r.helpers) parts.push(tr(loc, "{n} helper(s)", { n: r.helpers }));
  if (r.tasks) parts.push(tr(loc, "{n} background task(s)", { n: r.tasks }));
  if (r.teammates) parts.push(tr(loc, "{n} teammate(s) working for me", { n: r.teammates }));
  const also = parts.length ? tr(loc, " Also stopped: {list}.", { list: parts.join(", ") }) : "";
  if (all) return tr(loc, "Everything is stopped.", {}) + also + (r.dropped ? tr(loc, " {n} waiting message(s) or follow-up(s) were cancelled.", { n: r.dropped }) : tr(loc, " Nothing was waiting.", {})) + tr(loc, " What was already done is kept.", {});
  const more = also + (r.waiting ? tr(loc, " {n} message(s) still wait and will run next — « Stop all » cancels them.", { n: r.waiting }) : "");
  return more.trim();
}
