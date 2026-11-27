/** L99 « lots en parallèle » (agent/batches.ts): wire types shared with the web app (type-only). */

/** One task of a batch: waiting its turn, at work, waiting for the owner, finished, failed, or stopped / cancelled. */
export type BatchItemState = "queued" | "running" | "waiting" | "done" | "failed" | "stopped";

export interface BatchItemView {
  title: string;
  state: BatchItemState;
  /** Its report (clipped), once done; why it failed. */
  result?: string;
  /** A question it asked (it waits for the owner). */
  question?: string;
  /** An action it waits on: answered from the batch card. */
  approval?: { approvalId: string; title: string; detail: string; irreversible?: string };
}

/**
 * A batch the bot launched (batch_start): up to 20 tasks, at most `parallel` at once (the bot's task lanes, 3 at most),
 * one summary in the main chat at the end. « Stop » cancels the tasks not started yet and stops the ones at work.
 */
export interface BatchCard {
  type: "batch"; batchId: string; title: string;
  state: "running" | "done" | "stopped";
  parallel: number;
  items: BatchItemView[];
}

/** What a batch has cost so far (GET /bots/:id/batches/:batchId). */
export interface BatchCost { batchId: string; costUsd: number; estimatedUsd: number; turns: number; durationMs: number; endedAt: number | null }
