import type { ToolSpec } from "../llm/types.js";

/**
 * The background-task tool descriptions, in a module of their own with no runtime imports: agent/tools.ts reads them while
 * it loads, and bgtasks.ts (which imports the model modes, then the engine, then the loop) is not always loaded first.
 */
/** At most this many background tasks run (or wait) at once per bot. */
export const MAX_BG_TASKS = 3;

/** Too many background tasks at once (bgtasks.ts startTask / resumeTask). */
export class TaskLimitError extends Error {}
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

/** Tool definitions (wired into the built-in list by tools.ts, group "tasks"). */
export const bgTaskToolSpecs = {
  start: { name: "task_start", description: `Start a background task for long work (research across several sources, a comparison, a report, a long check) so the main chat stays free. A worker of yours does it in its own conversation; the user follows it on a card (state, steps, Stop) and can reply to it there. Its report comes back to you when it is done. At most ${MAX_BG_TASKS} at once. Do not use it for quick questions.`, inputSchema: obj({ title: str("A short title for the card (a few words)"), goal: str("Everything the task needs: the goal, the context, what the report must contain, when it is done"), level: { type: "string", enum: ["light", "normal", "hard"], description: "Optional. light: simple, mechanical work (a cheaper, faster model of the user's); hard: demanding reasoning (their strongest model); normal (default): your usual model for tasks" } }, ["title", "goal"]) } satisfies ToolSpec,
  list: { name: "task_list", description: "List your background tasks with their state.", inputSchema: obj({}) } satisfies ToolSpec,
  stop: { name: "task_stop", description: "Stop one of your background tasks.", inputSchema: obj({ id: str("Task id") }, ["id"]) } satisfies ToolSpec,
};
