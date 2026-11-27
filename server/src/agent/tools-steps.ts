import type { ToolSpec, ToolUseBlock } from "../llm/index.js";
import { LOADED_PREFIX, RUN_STEPS, searchTools, TOOL_SEARCH } from "../llm/toolsearch.js";
import { clip } from "../store.js";
import type { Turn } from "./loop.js";
import type { BuiltinTool, ToolOutput } from "./tools.js";

/**
 * Two tools that save model calls, kept apart from tools.ts:
 *
 * - tool_search (Hermes audit, gap 4): loads the full definitions of tools that are only listed by name (llm/toolsearch.ts
 *   says how each provider receives them). It changes nothing and needs no permission.
 * - run_steps (owner's idea, "code mode" without code): several read-only calls in one step. Each step is judged by the
 *   same authorize() as a normal call, with the outside-content mark carried from one step to the next; the first step
 *   that would not simply be allowed stops the batch, and the bot is told to make that call on its own, where the normal
 *   path asks the user. Only tools that read and are safe to repeat qualify: never one that changes something, asks the
 *   user or acts on a screen. Results come back as one compact block.
 */
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

/** At most this many steps per batch, and this many characters kept from each step's result. */
export const MAX_STEPS = 8;
export const STEP_CHARS = 4000;

const turnOf = (ctx: { turn?: unknown }) => (ctx.turn ?? null) as Turn | null;

/** Whether a tool may run inside run_steps: a built-in read-only tool, or an app tool that only reads. */
export async function batchable(turn: Turn, name: string): Promise<boolean> {
  if (name === RUN_STEPS) return false;
  if (name === TOOL_SEARCH) return true;
  const { parallelSafe } = await import("./loop.js");
  if (turn.builtin.has(name)) return parallelSafe(turn, name);
  const r = turn.remote.get(name);
  if (!r) return false;
  return r.native ? r.native.risk === "read" : !!r.readOnly && !r.command;
}

const textOf = (out: ToolOutput) => (typeof out.content === "string" ? out.content : out.content.map((b) => (b.type === "text" ? b.text : "[image]")).join("\n"));

export const stepTools: BuiltinTool[] = [
  {
    spec: {
      name: TOOL_SEARCH,
      description: "Load the full definition of tools that are only listed by name. Give exact tool names (comma-separated) or a few words about what you need; the tools found can be called for the rest of this turn.",
      inputSchema: obj({ query: { type: "string", description: "Exact tool names, or words describing the job" }, limit: { type: "integer", description: "How many tools at most (default 5, at most 20)" } }, ["query"]),
    },
    activity: "planning", label: "Finding a tool", parallel: true,
    run: async (a, ctx) => {
      const turn = turnOf(ctx);
      if (!turn) return { content: "Every tool is already available here.", summary: "nothing to load" };
      const found = searchTools(turn.tools, String(a.query ?? ""), typeof a.limit === "number" ? a.limit : 5);
      if (!found.length) return { content: `No tool matched "${clip(String(a.query ?? ""), 80)}". Try other words or an exact name from the list.`, summary: "no match" };
      const specs = found.map((t) => JSON.stringify({ name: t.name, description: t.description, input_schema: t.inputSchema })).join("\n");
      return { content: `${LOADED_PREFIX} ${found.map((t) => t.name).join(", ")}\n${specs}`, summary: found.map((t) => t.name).join(", ") };
    },
  },
  {
    spec: {
      name: RUN_STEPS,
      description: `Run up to ${MAX_STEPS} read-only tool calls in one step (searches, reads, lookups) and get their results together. Only tools that just read qualify; a step that would need the user's approval stops the batch — then make that call on its own.`,
      inputSchema: obj({
        steps: { type: "array", description: "The calls, in order", items: { type: "object", properties: { tool: { type: "string" }, input: { type: "object" } }, required: ["tool"] } },
      }, ["steps"]),
    },
    activity: "reading", label: "Several reads at once",
    run: async (a, ctx) => {
      const turn = turnOf(ctx);
      if (!turn) return { content: "run_steps is not available here: make the calls one by one.", isError: true };
      const steps = (Array.isArray(a.steps) ? a.steps : []).slice(0, MAX_STEPS) as { tool?: unknown; input?: unknown }[];
      if (!steps.length) return { content: "Give at least one step.", isError: true };
      const { runReserved } = await import("./loop.js");
      const { authorize } = await import("./authorize.js");
      const { actionHash } = await import("./executions.js");
      const parts: string[] = [];
      let ran = 0;
      let stopped = "";
      let outside = false;
      for (const [i, s] of steps.entries()) {
        const name = String(s.tool ?? "");
        const input = s.input && typeof s.input === "object" && !Array.isArray(s.input) ? (s.input as Record<string, unknown>) : {};
        if (!(await batchable(turn, name))) { stopped = `Step ${i + 1} (${name || "?"}) is not a read-only tool: call it on its own.`; break; }
        const call: ToolUseBlock = { type: "tool_use", id: `${ctx.thread ?? 0}-steps-${Date.now().toString(36)}-${i}`, name, input };
        // The same judgement as a call of its own: an "ask" or a refusal stops the batch here (nothing is ever skipped).
        const verdict = await authorize(turn, call);
        if (verdict.kind !== "allow") { stopped = `Step ${i + 1} (${name}) needs the user's approval: call ${name} on its own so they are asked.`; break; }
        const out = await runReserved(turn, call, verdict.grant, "", actionHash(name, input), () => {});
        ran++;
        outside ||= !!turn.builtin.get(name)?.outside || turn.remote.has(name) || !!out.outside;
        parts.push(`### Step ${i + 1}: ${name}${out.isError ? " (failed)" : ""}\n${clip(textOf(out), STEP_CHARS)}`);
      }
      if (stopped) parts.push(stopped);
      const left = Array.isArray(a.steps) && a.steps.length > MAX_STEPS ? `\n(${a.steps.length - MAX_STEPS} more steps were not run: at most ${MAX_STEPS} at once.)` : "";
      return { content: parts.join("\n\n") + left, summary: `${ran}/${steps.length}`, isError: ran === 0 && !!stopped, outside: outside || undefined };
    },
  },
];
