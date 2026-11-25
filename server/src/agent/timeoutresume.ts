import { tr } from "../i18n.js"; import type { Locale } from "../shared.js";
import { audit, rows, type BotRecord } from "../store.js";
import { autoAfterTimeout } from "./autocontinue.js";
import { stepsSince } from "./stoprecap.js";
import type { Trigger } from "./turn-request.js";

/**
 * L72 — automatic continuation after the TIME limit of a subscription turn (Claude Code, Codex:
 * ENGINE_TURN_TIMEOUT_MINUTES; backlog A-FAIRE L72, OMB and Hermes audits; our own code). Moved out of loop.ts, which is at
 * its size limit.
 *
 * Before, a subscription turn stopped at its time limit always waited for « Continuer », even inside a routine or a
 * background task, or after « Continuer seul jusqu'au bout ». Now the same rule as the step limit applies
 * (autocontinue.ts): a routine or a helper's task gets the unattended allowance by itself, the owner's chat only when they
 * granted it; a continuation is used only when the stretch that just stopped made progress (the steps the chat shows for
 * that turn). The tool's own session is kept, so it picks up where it stopped. Otherwise: the usual notice with Continue.
 */
export interface TimeoutCtx {
  bot: BotRecord;
  locale: Locale;
  trigger: Trigger;
  thread: number;
  /** The turn's start (its steps are the chat's step rows since then). */
  since: number;
  limitMs: number;
  /** The continuation work, queued by loop.ts (passed in so this module does not import the loop). */
  carryOn: () => void;
}

/** Writes the notice and queues the continuation when allowed. True when the work carries on by itself. */
export function afterEngineTimeout(c: TimeoutCtx): boolean {
  const minutes = Math.round(c.limitMs / 60_000);
  const goalRound = c.trigger.kind === "system" && !!c.trigger.goalRound;
  const auto = goalRound ? { go: false as const } : autoAfterTimeout(c.bot, c.trigger.kind === "routine", c.thread, stepsSince(c.bot, c.thread, c.since));
  if (auto.go) {
    rows.append(c.bot, { kind: "notice", tone: "info", text: tr(c.locale, "I reached the {min}-minute limit of one turn on a subscription and the work is moving forward: I am carrying on on my own ({left} more time(s) at most).", { min: minutes, left: auto.left }) });
    audit(c.bot.userId, "system", `${c.bot.name}: subscription turn stopped at its time limit (${minutes} min), carried on by itself`, c.bot.id);
    c.carryOn();
    return true;
  }
  // Never a dead end: what the tool said and did so far is kept (and its session, resumed next turn); "Continue" — or simply
  // saying so — picks the work back up.
  rows.append(c.bot, { kind: "notice", tone: "warn", text: tr(c.locale, "I stopped this turn after {min} minutes: that is the time limit for one turn on a subscription. What I did so far is kept. Press Continue, or just tell me to continue, to pick it back up.", { min: minutes }), action: { kind: "continue", status: "pending", reason: "timeout" } });
  audit(c.bot.userId, "system", `${c.bot.name}: subscription turn stopped at its time limit (${minutes} min)`, c.bot.id);
  return false;
}
