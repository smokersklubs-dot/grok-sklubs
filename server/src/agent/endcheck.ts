import { q } from "../db.js";
import { tr } from "../i18n.js";
import { clip, rows, users, type BotRecord } from "../store.js";
import { ask } from "./memory.js";
import { deliverableUrls, liveCheck } from "./livecheck.js";
import type { Trigger, Turn } from "./loop.js";

/**
 * L84 — an independent end check for unattended work (backlog A-FAIRE L84; behaviour from the Nightly, Noodle and ECC
 * audits, our own code).
 *
 * A routine run or a background task that ends with "here are the first 3 of 10" used to count as a success. Now, when
 * such a turn ends on its own words, a SEPARATE model call (no tools, the server's helper model, not the bot's own turn)
 * reads the task and the final report and answers one of: done / continue / needs_user / blocked.
 * - continue: the work is relaunched in the same conversation with the reason, at most MAX_RELAUNCHES times in a row; the
 *   relaunch is an ordinary turn of the bot, so every approval, the floor and the vault rules apply as usual;
 * - needs_user / blocked: a notice says so (and why) instead of a silent "done";
 * - done: nothing more.
 * Never for a turn that asked for an approval, waits for the user, stopped on the loop guard, failed or said nothing, and
 * never for the owner's own chat (only routines and background tasks: "first for unattended tasks"). Only a report that
 * reads as partial is checked (looksUnfinished): the check costs one small model call, not one per routine run.
 */
q.run("CREATE TABLE IF NOT EXISTS end_checks (bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, task TEXT NOT NULL, relaunches INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, thread))");

export const MAX_RELAUNCHES = 3;
export type EndVerdict = "done" | "continue" | "needs_user" | "blocked";

const CHECK_SYSTEM = "You check whether a piece of unattended work is really finished. You get the task and the worker's final report. Answer with ONE line of JSON only: {\"verdict\":\"done\"|\"continue\"|\"needs_user\"|\"blocked\",\"reason\":\"one short sentence\"}. done: the report shows the whole task done. continue: part of the task is clearly left and the worker could do it alone (e.g. 3 of 10 items). needs_user: only the user can decide or provide something. blocked: something outside the worker's reach stops it (an error, a missing access). When unsure between done and continue, answer done.";

/** The verdict in a model's answer (the first JSON object in it); null when unreadable. */
export function readVerdict(answer: string): { verdict: EndVerdict; reason: string } | null {
  const m = /\{[\s\S]*?\}/.exec(String(answer ?? ""));
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]) as { verdict?: unknown; reason?: unknown };
    const v = String(j.verdict ?? "");
    if (v !== "done" && v !== "continue" && v !== "needs_user" && v !== "blocked") return null;
    return { verdict: v, reason: clip(String(j.reason ?? "").replace(/\s+/g, " ").trim(), 240) };
  } catch { return null; }
}

/**
 * A cheap first sieve (no model call): only a report that reads as partial — "3 of 10", "the first…", "remaining",
 * "not yet", "next I will…", in French or English — is sent to the checker. A plain "done, here is the result" costs
 * nothing more than before.
 */
const PARTIAL = /\b\d+\s*(?:\/|of|out of|sur)\s*\d+\b|\b(?:first|premi[eè]re?s?)\s+\d+|\b(?:remaining|left to do|not yet|so far|partially|partial|for now|next,? i(?:'| wi)ll|to be continued|todo|still to)\b|\b(?:il reste|reste à|restant(?:e|s)?|pas encore|pour l'instant|jusqu'ici|en partie|partiel(?:le)?|à suivre|ensuite je|je continue(?:rai)?|prochaine étape)\b/i;
export const looksUnfinished = (report: string) => PARTIAL.test(report);

/** Whether this finished turn gets an end check. `asked`: the turn put an approval card in front of the owner. */
export function wantsEndCheck(bot: BotRecord, trigger: Trigger, turn: Pick<Turn, "lastText" | "waitsUser" | "loopStop" | "missingReport">, o: { taskHelper: boolean; asked: boolean }): boolean {
  if (!turn.lastText.trim() || turn.waitsUser || turn.loopStop || turn.missingReport || o.asked || !(looksUnfinished(turn.lastText) || deliverableUrls(turn.lastText).length)) return false; // L84: or it gives live deliverables (livecheck.ts)
  if (trigger.kind === "routine") return true;
  if (trigger.kind === "bot" && o.taskHelper) return true;
  // A continuation of such work (the step-limit, auto-continue or end-check relaunch): the conversation has a task on file.
  return trigger.kind === "system" && trigger.resumeOf === "steps" && !!q.get("SELECT 1 FROM end_checks WHERE bot_id = ? AND thread = ?", bot.id, threadOfTurn(trigger));
}
const threadOfTurn = (t: Trigger) => ("thread" in t && typeof t.thread === "number" ? t.thread : 0);

/**
 * Runs the check and acts on it. `relaunch` queues the continuation (loop.ts enqueue). Never throws: a failed check is the
 * old behaviour (the report stands).
 */
export async function endCheck(bot: BotRecord, trigger: Trigger, report: string, thread: number, relaunch: (text: string) => void, run: typeof ask = ask, live: typeof liveCheck = liveCheck): Promise<EndVerdict | null> {
  const known = q.get<{ task: string; relaunches: number }>("SELECT task, relaunches FROM end_checks WHERE bot_id = ? AND thread = ?", bot.id, thread);
  const task = trigger.kind === "routine" || trigger.kind === "bot" ? trigger.text : known?.task ?? "";
  if (!task) return null;
  if (!known || trigger.kind !== "system") q.run("INSERT INTO end_checks (bot_id, thread, task, relaunches, updated_at) VALUES (?, ?, ?, 0, ?) ON CONFLICT(bot_id, thread) DO UPDATE SET task = excluded.task, relaunches = CASE WHEN ? THEN end_checks.relaunches ELSE 0 END, updated_at = excluded.updated_at", bot.id, thread, clip(task, 6000), Date.now(), trigger.kind === "system" ? 1 : 0);
  let found: ReturnType<typeof readVerdict> = null;
  // L84: the live deliverables the report gives are opened first; a broken one is a precise reason to go back to work.
  const urls = deliverableUrls(report);
  const tested = urls.length ? await live(urls).catch(() => null) : null;
  if (tested?.problems.length) found = { verdict: "continue", reason: clip(`live check: ${tested.problems.join("; ")}`, 240) };
  else if (!looksUnfinished(report)) found = { verdict: "done", reason: "" };
  else try { found = readVerdict(await run(bot, CHECK_SYSTEM, `Task:\n${clip(task, 6000)}\n\nFinal report:\n${clip(report, 6000)}`)); } catch (err) { console.error(`[end check ${bot.name}]`, (err as Error)?.message ?? err); }
  if (!found) return null;
  const loc = users.localeOf(bot.userId);
  const done = (n: number) => q.run("UPDATE end_checks SET relaunches = ?, updated_at = ? WHERE bot_id = ? AND thread = ?", n, Date.now(), bot.id, thread);
  const used = q.get<{ relaunches: number }>("SELECT relaunches FROM end_checks WHERE bot_id = ? AND thread = ?", bot.id, thread)?.relaunches ?? 0;
  if (found.verdict === "continue") {
    if (used >= MAX_RELAUNCHES) {
      rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "End check: the work still looks unfinished ({reason}), and I already went back to it {n} times. Tell me how to go on.", { reason: found.reason, n: MAX_RELAUNCHES }) }, thread || undefined);
      q.run("DELETE FROM end_checks WHERE bot_id = ? AND thread = ?", bot.id, thread);
      return found.verdict;
    }
    done(used + 1);
    rows.append(bot, { kind: "notice", tone: "info", text: tr(loc, "End check: not finished yet ({reason}). I am going back to it ({n}/{max}).", { reason: found.reason, n: used + 1, max: MAX_RELAUNCHES }) }, thread || undefined);
    relaunch(`An independent check of your last report found the task not finished: ${found.reason}\nPick the work back up where you left off — do not redo what is done — and finish it, or say plainly what stops you. Anything risky still needs the user's approval as usual.`);
    return found.verdict;
  }
  q.run("DELETE FROM end_checks WHERE bot_id = ? AND thread = ?", bot.id, thread);
  if (found.verdict === "needs_user") rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "End check: this needs you before it can be finished — {reason}", { reason: found.reason }) }, thread || undefined);
  if (found.verdict === "blocked") rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "End check: this work is blocked — {reason}", { reason: found.reason }) }, thread || undefined);
  return found.verdict;
}

/** loop.ts, once a turn went through: the end check, in the background, when this turn wants one. */
export function maybeEndCheck(bot: BotRecord, trigger: Trigger, turn: Turn, o: { taskHelper: boolean; asked: boolean }, enqueue: (botId: string, t: Trigger) => void): void {
  if (!wantsEndCheck(bot, trigger, turn, o)) return;
  const thread = turn.thread;
  void endCheck(bot, trigger, turn.lastText, thread, (text) => enqueue(bot.id, { kind: "system", text, resumeOf: "steps", thread: thread || undefined, tainted: turn.tainted || undefined, depth: turn.depth, origin: turn.origin, spendScope: turn.spendKey }));
}
