import { emit } from "../bus.js";
import { tr } from "../i18n.js";
import { pauses, type PauseScope } from "../pauses.js";
import type { PauseResult } from "../shared.js";
import { audit, bots, type BotRecord, type UserRecord } from "../store.js";
import { GOAL_PAUSED_WITH_BOT, pauseGoalsOf, resumeGoalsAfterPause } from "./goals.js";
import { BotPaused, interrupt, isPaused, releaseHeld } from "./loop.js";

/**
 * "Pause" — what pausing and resuming do (the records are in pauses.ts).
 *
 * Pausing a bot, a section or every bot of the account, for each bot it now covers (helpers included):
 * - its running turn stops at a safe point, as Stop does (an API turn between two steps, a subscription turn's process is
 *   ended through the same abort signal); what it did is kept, and a continuation waits in its queue;
 * - its active goals are paused ("its bot is paused");
 * - from then on nothing new starts (loop.ts holdIfPaused): the owner's and members' messages, Telegram, mail, other bots'
 *   reports and approvals wait in its queue, in order; routine runs and webhooks are recorded as skipped; bot_message and
 *   rooms are told it is paused; background jobs keep running (they are the bot's own commands on its computer, stopping
 *   them could lose work) but their end does not wake it: jobs.ts tells it once it is resumed.
 * Resuming lifts the pause; every bot no longer covered by any pause gets its waiting work back in order, then its goals.
 *
 * Hosted mode's suspension (hosted.ts) is separate: both can hold a bot, and each is lifted in its own place.
 */
export class PauseError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); this.name = "PauseError"; }
}

/** Every bot of the account that can work (helpers included: they follow the bot they work for). */
const agentsOf = (userId: string): BotRecord[] => bots.list(userId, true).filter((b) => b.kind === "agent");

const label = (scope: PauseScope, user: UserRecord, target: string): string => {
  if (scope === "all") return tr(user.locale, "every bot");
  if (scope === "section") return tr(user.locale, "the section “{name}”", { name: target });
  return target;
};

/**
 * Pauses (`paused` true) or resumes one bot, one section or every bot of the owner's account. `target`: the bot's or the
 * section's id ("" for all); the caller checked that it is the owner's. `name`: what the audit line calls it.
 */
export function setPause(user: UserRecord, scope: PauseScope, target: string, paused: boolean, name = ""): PauseResult {
  const before = new Set(agentsOf(user.id).filter((b) => b.pause).map((b) => b.id));
  const changed = paused ? pauses.set(user.id, scope, target, user.id) : pauses.clear(user.id, scope, target);
  let stopped = 0;
  let released = 0;
  for (const bot of agentsOf(user.id)) {
    const now = isPaused(bot);
    if (paused && now) {
      // Stopped at a safe point, as Stop does; the continuation waits in its queue (loop.ts).
      if (interrupt(bot.id, new BotPaused())) stopped++;
      if (!before.has(bot.id)) pauseGoalsOf(bot, tr(user.locale, GOAL_PAUSED_WITH_BOT));
    } else if (!paused && !now && before.has(bot.id)) {
      released += releaseHeld(bot.id);
      resumeGoalsAfterPause(bots.byId(bot.id) ?? bot);
    }
  }
  if (changed) {
    const what = label(scope, user, name || target);
    audit(user.id, "system", paused ? `Paused: ${what}${stopped ? ` (${stopped} turn(s) stopped)` : ""}` : `Resumed: ${what}${released ? ` (${released} queued job(s) run)` : ""}`, scope === "bot" ? target : null);
  }
  // Every bot's badge, the sections' and the account's state (web: bots, sections, GET /pauses again).
  for (const bot of agentsOf(user.id)) if (before.has(bot.id) !== !!bot.pause) bots.announce(bot);
  emit(user.id, { type: "pauses" });
  return { state: pauses.state(user.id), stopped, released };
}

/**
 * A bot changed place (moved into or out of a section): a bot moved into a paused section is paused with it (its turn
 * stops), one moved out of it is free again (its waiting work runs).
 */
export function afterMove(user: UserRecord, botId: string, wasPaused: boolean) {
  const bot = bots.byId(botId);
  if (!bot || bot.kind !== "agent") return;
  const now = isPaused(bot);
  if (now === wasPaused) return;
  for (const b of [bot, ...bots.children(bot.id)]) {
    if (now) { interrupt(b.id, new BotPaused()); pauseGoalsOf(b, tr(user.locale, GOAL_PAUSED_WITH_BOT)); }
    else { releaseHeld(b.id); resumeGoalsAfterPause(b); }
  }
  emit(user.id, { type: "pauses" });
}

/** The line another bot (or a room) gets when it tries to hand work to a paused bot. */
export function pausedLine(bot: BotRecord): string {
  return `${bot.name} is paused by its owner right now: it takes no new work until they resume it. Do not route around it — carry on without it, or tell the user that ${bot.name} is paused.`;
}
