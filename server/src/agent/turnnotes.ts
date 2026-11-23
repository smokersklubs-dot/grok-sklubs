import type { BotRecord } from "../store.js";
import { PLAN_MODE_NOTE, planModeOn } from "./planmode.js";
import { takeRecap } from "./stoprecap.js";
import type { Trigger } from "./turn-request.js";

/**
 * The lines put at the top of a new turn's message besides the feedback note (loop.ts, API and subscription turns alike):
 * L63 the recap of a turn the owner stopped (stoprecap.ts) and L79 the plan-mode reminder (planmode.ts). Moved out of
 * loop.ts, which is at its size limit.
 */
export function turnNotes(heard: string, bot: BotRecord, thread: number, trigger: Exclude<Trigger, { kind: "resume" }>): string {
  const recap = takeRecap(bot, thread, trigger);
  const plan = planModeOn(bot.id, thread) !== null ? PLAN_MODE_NOTE : "";
  return [heard, recap, plan].filter(Boolean).join("\n");
}
