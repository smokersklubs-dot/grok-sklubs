import type { Trigger } from "./loop.js";

/**
 * Usage caps: whether a person started this work (their message, their answer to an approval, a button they pressed),
 * as opposed to work no one started — routines and webhooks, goals' later rounds, bot-to-bot messages and background
 * tasks (a helper's work comes as another bot's message), background-job reports, check-ins, mail to the bot. Work that
 * continues other work (step limit, pause, stall) is what the work it continues was.
 */
export function attendedTrigger(trigger: Trigger): boolean {
  // Bot API (botapi.ts): no person is watching an outside program's call, so it is unattended work (docs/API-BOT.md).
  if (trigger.kind === "user") return !trigger.api;
  if (trigger.kind === "resume") return true;
  if (trigger.kind === "routine") return !!trigger.byHand;
  if (trigger.kind === "bot") return false;
  if (trigger.byPerson) return true;
  if (trigger.unattended || trigger.goalRound || trigger.jobIds?.length) return false;
  if (trigger.resumeOf === "spend") return true; // the user pressed "Continue" on a spend checkpoint
  if (trigger.resumeOf && trigger.origin) return trigger.origin === "user" || trigger.origin === "member" || trigger.origin === "resume";
  return true;
}
