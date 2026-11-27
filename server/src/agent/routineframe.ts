/**
 * L68 — the frame of a routine's turn: nobody is watching, never stop on a question (note it and finish the rest), a
 * routine made of several steps ends with a Done / Blocked / Skipped list, and the report says what could not be
 * confirmed. The tool routine_fail ends the run as FAILED with its reason, so a routine that did 2 of its 3 steps is not
 * "successful". (CopilotKit, agent-skills, Nightly, OMB — ideas only, our own words.)
 *
 * L54 (rest) — "nothing new" posts nothing: a run that stays quiet (stay_quiet, no words) or answers only "nothing new"
 * leaves no message in the chat (routinethread.ts turns its placeholder into a quiet event line).
 */
import type { BuiltinTool } from "./tools.js";
import { LaneMap } from "./lanemap.js";

export const ROUTINE_FRAME = [
  "Nobody is watching this run: never stop to ask a question. If you need the user, write the question in your report and finish everything else you can.",
  "If the instruction has several steps, end with one line per step: \"Done:\", \"Blocked:\" (and why) or \"Skipped:\" (and why).",
  "End with a short report and, when there is any, a line \"Not confirmed:\" with what you could not check.",
  "If there is nothing new and nothing for the user, call stay_quiet: nothing is posted.",
  "If the routine cannot be carried out, call routine_fail with the reason: the run then counts as failed, not done.",
].join(" ");

/** The opening of a routine run's first message (turn-request.ts). */
export const routineOpening = (name: string) => `[Your routine "${name}" is running now. ${ROUTINE_FRAME} Carry it out:]`;

/** A reply that only says there is nothing new (French or English): treated like stay_quiet. */
export function saysNothingNew(text: string): boolean {
  const t = text.trim().toLowerCase().replace(/[.!…\s]+$/u, "").replace(/\s+/g, " ");
  if (!t || t.length > 40) return false;
  return /^(rien de neuf|rien de nouveau|rien à signaler|rien a signaler|nothing new|nothing to report|no news)( pour l'instant| aujourd'hui| today| for now)?$/.test(t);
}

/** Reasons given by routine_fail, per running lane ("bot" or "bot~thread"). */
const failures = new LaneMap<string>();

/** The reason routine_fail gave in this bot's running turn (taken once), or "". */
export function takeRoutineFailure(botId: string): string {
  const own = failures.get(botId);
  if (own) { failures.delete(botId); return own; }
  // A subscription engine calls the tool from outside the turn's own async context (its MCP request): any lane of the bot.
  const other = failures.lanesOf(botId)[0];
  if (other) { failures.delete(other[0]); return other[2]; }
  return "";
}

export const routineFrameTools: BuiltinTool[] = [{
  spec: {
    name: "routine_fail",
    description: "Only during a routine run: end it as FAILED, with the reason (what could not be done and why). Use it when the routine's work could not be carried out, even partly done, instead of reporting a success.",
    inputSchema: { type: "object", properties: { reason: { type: "string", description: "What could not be done and why, in one or two sentences" } }, required: ["reason"] },
  },
  activity: "planning", label: "Routine failed", group: "routines",
  run: async (a, c) => {
    if (c.origin !== "routine") return { content: "routine_fail is only for a routine run. Say plainly what went wrong instead.", isError: true };
    const reason = String(a.reason ?? "").replace(/\s+/g, " ").trim().slice(0, 300);
    if (!reason) return { content: "Give the reason.", isError: true };
    failures.set(c.bot.id, reason);
    return { content: "Noted: this run will be recorded as failed with that reason. Finish with a short report of what was done and what was not.", summary: reason.slice(0, 80) };
  },
}];
