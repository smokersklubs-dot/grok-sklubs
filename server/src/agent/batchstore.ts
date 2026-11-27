import { q } from "../db.js";
import type { Card } from "../shared.js";

/**
 * L99 « lots en parallèle »: the tables of the batches (agent/batches.ts). Kept apart, with no other import, so the
 * background tasks (bgtasks.ts) can tell a batch's task from a task of their own without importing the batch logic.
 * Tables created at module load (house pattern).
 */
q.run(`CREATE TABLE IF NOT EXISTS batches (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'running', generation INTEGER NOT NULL, card_seq INTEGER, depth INTEGER NOT NULL DEFAULT 0,
  tainted INTEGER NOT NULL DEFAULT 0, level TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)`);
// `state`: queued (not started), started (its background task holds the live state), cancelled (stopped before it started).
q.run(`CREATE TABLE IF NOT EXISTS batch_items (
  batch_id TEXT NOT NULL REFERENCES batches(id) ON DELETE CASCADE, idx INTEGER NOT NULL, title TEXT NOT NULL, goal TEXT NOT NULL,
  task_id TEXT, state TEXT NOT NULL DEFAULT 'queued', extra TEXT, PRIMARY KEY (batch_id, idx))`);
q.run("CREATE INDEX IF NOT EXISTS batch_items_task ON batch_items(task_id)");

/** The batch a background task belongs to (null: a task of its own, with its own card). */
export const batchOfTask = (taskId: string): string | null =>
  q.get<{ b: string }>("SELECT batch_id AS b FROM batch_items WHERE task_id = ?", taskId)?.b ?? null;

/** SQL that leaves a batch's tasks out of the task list (they show on the batch card). */
export const NOT_BATCH_TASK = "id NOT IN (SELECT task_id FROM batch_items WHERE task_id IS NOT NULL)";

/**
 * L99: a batch task changed state. bgtasks.ts calls the listener batches.ts registers here; kept in this dependency-free
 * module so neither imports the other at load time (bgtasks → … → tools → batches → bgtasks was an import cycle).
 */
export type BatchTaskListener = (t: { id: string }, extra: Pick<Partial<Extract<Card, { type: "task" }>>, "question" | "approval">) => void;
let listener: BatchTaskListener | null = null;
export const setBatchListener = (fn: BatchTaskListener | null) => { listener = fn; };
export const batchListener = () => listener;
