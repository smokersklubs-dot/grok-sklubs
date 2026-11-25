import { modelAvailable } from "../llm/index.js";
import { modelForRun, modelForWork } from "../routineplus.js";
import type { BotRecord } from "../store.js";
import { engineOf, isEngineRef } from "./engine.js";
import type { Trigger } from "./turn-request.js";
import { conversationEffort, conversationModel } from "../convs.js";
import { projectPreset } from "../projectpresets.js";
import { modeModelFor } from "./modelmodes.js";
import { boardModelForGoal } from "../workboardroles.js";

/**
 * nod item 2, hooked into the turn loop: a routine run (and its own continuations) runs on the model chosen for that
 * routine, else on the bot's model for routines; other background work no person started (check-ins, mail to the bot,
 * a task's report, a group-chat wake) runs on the bot's model for background work (routineplus.ts modelForWork). The
 * owner's own messages, a member's, the Bot API, goal rounds and resumed approvals keep the bot's own model.
 *
 * The turn simply runs with a copy of the bot whose `model` is the chosen one, so the backup chain, the engine/API choice
 * and the usage lines all follow it. A choice that cannot run is ignored (the bot's model stays): a model whose provider
 * is not set up, or a subscription engine the bot is not set up for (an API bot has no subscription session; a Claude
 * Code bot is not a Codex bot). Nothing stored changes: an existing conversation is read exactly as before.
 */
export function workKindOf(trigger: Trigger): { kind: "routine"; runId?: string } | { kind: "background" } | null {
  if (trigger.kind === "routine") return { kind: "routine", runId: trigger.runId };
  if (trigger.kind !== "system") return null;
  // A routine's own continuation (step limit, stall, cap) bills to its run: it stays on the routine's model.
  if (trigger.spendScope?.startsWith("routine:")) return { kind: "routine", runId: trigger.spendScope.slice(8) };
  if (trigger.unattended && !trigger.resumeOf && !trigger.goalRound && !trigger.spendScope && !trigger.byPerson) return { kind: "background" };
  return null;
}

/** The model this piece of work should run on, or the bot's own model when nothing else applies or can run. */
export function workModelFor(bot: BotRecord, trigger: Trigger): string {
  const board = trigger.kind === "system" ? boardModelForGoal(trigger.goalRound) : ""; // L163 T10: a board task's own model, else its role's (workboardroles.ts)
  if (board && board !== bot.model) return isEngineRef(board) ? (isEngineRef(bot.model) && engineOf(board) === engineOf(bot.model) ? board : bot.model) : modelAvailable(board, bot.userId) ? board : bot.model;
  const work = workKindOf(trigger);
  if (!work) return conversationChoice(bot, trigger);
  const ref = work.kind === "routine" ? modelForRun(bot, work.runId) : modelForWork(bot, "background");
  if (!ref || ref === bot.model) return bot.model;
  if (isEngineRef(ref)) return isEngineRef(bot.model) && engineOf(ref) === engineOf(bot.model) ? ref : bot.model;
  return modelAvailable(ref, bot.userId) ? ref : bot.model;
}

/** The bot as this turn sees it: the same record, with the work's model when it differs. */
export function withWorkModel(bot: BotRecord | null | undefined, trigger: Trigger): BotRecord | null | undefined {
  if (!bot || bot.kind !== "agent") return bot;
  const model = workModelFor(bot, trigger);
  const effort = conversationEffortFor(bot, trigger);
  return model === bot.model && effort === bot.effort ? bot : { ...bot, model, effort };
}

/**
 * L150 « Réflexion par conversation »: the reasoning level of the owner's own work in the open conversation — the level
 * chosen for that conversation, else its project's preset (projectpresets.ts), else the bot's own. Routines and background
 * work no person started keep the bot's level (same split as the model above).
 */
export function conversationEffortFor(bot: BotRecord, trigger: Trigger): BotRecord["effort"] {
  if (trigger.kind === "routine" || workKindOf(trigger)) return bot.effort;
  const chosen = conversationEffort(bot.id, bot.generation) || projectPreset(bot.userId, bot.sectionId).effort;
  return (chosen || bot.effort) as BotRecord["effort"];
}

/**
 * L150 « Modèle par conversation » (convs.ts): the owner's own messages, a member's and resumed work in the open
 * conversation run on the model chosen for it, when that model can run (same checks as above); else the bot's model.
 */
export function conversationChoice(bot: BotRecord, trigger: Trigger): string {
  if (trigger.kind === "routine") return bot.model;
  const ref = conversationModel(bot.id, bot.generation) || projectPreset(bot.userId, bot.sectionId).model; // L150 project preset
  if (!ref) return modeModelFor(bot, trigger); // L69 named modes (modelmodes.ts)
  if (ref === bot.model) return bot.model;
  if (isEngineRef(ref)) return isEngineRef(bot.model) && engineOf(ref) === engineOf(bot.model) ? ref : bot.model;
  return modelAvailable(ref, bot.userId) ? ref : bot.model;
}
