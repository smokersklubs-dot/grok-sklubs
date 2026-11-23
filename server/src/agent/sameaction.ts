import type { ToolUseBlock } from "../llm/index.js";
import { groundable } from "./authorize.js";
import type { Turn } from "./loop.js";
import type { ToolOutput } from "./tools.js";

/**
 * L22 — the same successful change is never made twice in one turn. A model that calls the very same changing action
 * again (same tool, same canonical arguments: executions.ts actionHash) after it went through gets the first result back,
 * with a note, instead of a second send, post, creation or purchase. Nothing is asked or run a second time.
 *
 * Only actions that change something (authorize.ts groundable: the ones that carry the user's words) count. Left out on
 * purpose: pointer and keyboard actions on a screen (clicking "Next" twice is normal), commands (running the tests again
 * after a fix is normal), and failed calls (a new try after a failure goes through the usual path and loop guard).
 * The memory lives with the turn object only: a new turn starts empty, and nothing stored is read differently.
 */
const POINTER = /^(screen|element|my|browser|keyboard|mouse)_(click|type|key|keys|scroll|drag|move|press|open|focus|hover|select|navigate|back|wait)/;
const NEVER = new Set(["shell_run", "my_command", "my_command_stop", "progress_update", "stay_quiet", "message_react", "ask_user", "ask_takeover", "code_request"]);

const done = new WeakMap<object, Map<string, ToolOutput>>();

/** Whether a call of this tool counts as a change that must not be repeated in the same turn. */
export function dedupable(turn: Pick<Turn, "builtin" | "remote">, name: string): boolean {
  return !NEVER.has(name) && !POINTER.test(name) && groundable(turn, name);
}

/** After a call ran: a successful change is remembered for the rest of the turn. */
export function rememberAction(turn: Pick<Turn, "builtin" | "remote">, call: Pick<ToolUseBlock, "name">, hash: string, out: ToolOutput) {
  if (out.isError || !dedupable(turn, call.name)) return;
  let m = done.get(turn);
  if (!m) { m = new Map(); done.set(turn, m); }
  if (!m.has(hash)) m.set(hash, out);
}

export const ALREADY_DONE_NOTE = "[Already done earlier in this turn with exactly the same arguments: this is the first result again. It was NOT run a second time. Do not repeat it; go on with the next step or report.]";

/** The first result of this exact change when it already went through in this turn (with a note), else null. */
export function repeatedAction(turn: Pick<Turn, "builtin" | "remote">, call: Pick<ToolUseBlock, "name">, hash: string): ToolOutput | null {
  const first = done.get(turn)?.get(hash);
  if (!first || !dedupable(turn, call.name)) return null;
  const content = typeof first.content === "string" ? `${first.content}\n\n${ALREADY_DONE_NOTE}` : [...first.content, { type: "text" as const, text: ALREADY_DONE_NOTE }];
  return { content, summary: "already done", ...(first.outside ? { outside: first.outside } : {}) };
}
