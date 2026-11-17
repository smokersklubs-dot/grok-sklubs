import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 15 — "back to the subscription after its limit resets" (agent/sublimit.ts). Additive only: two new tables
 * and one index; no existing row is touched. The previous version of the code ignores both tables.
 *
 * - subscription_limits: one row per account and subscription engine (claude-code, codex) that is at its usage limit
 *   now, as the tool itself reported it in its own output. `until`: when the subscription is expected back (ms);
 *   `source`: "event" (the tool gave the reset time) or "default" (it did not: a conservative hour, looked at again then).
 *   The row is removed once `until` has passed and the bots are switched back.
 * - subscription_limit_bots: the bots that were told about that limit window (one notice per bot per window): the notice
 *   row (`generation`, `seq`), whether to push "Me prévenir à la reprise" (`notify`, on by default) and whether work of
 *   that bot waits for the subscription (`queued`).
 * - bot_queue gets a new status value, 'limited': work that waits for the subscription, kept in its order and run when
 *   the limit is over. The previous version of the code never selects such rows (they would wait until this version
 *   runs again); nothing else reads them.
 */
export function subscriptionLimits(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS subscription_limits (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, engine TEXT NOT NULL,
    until INTEGER NOT NULL, source TEXT NOT NULL, detected_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, engine)
  );
  CREATE TABLE IF NOT EXISTS subscription_limit_bots (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, engine TEXT NOT NULL,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER, seq INTEGER,
    notify INTEGER NOT NULL DEFAULT 1, queued INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, engine, bot_id)
  );
  CREATE INDEX IF NOT EXISTS bot_queue_limited ON bot_queue(status, bot_id, id);`);
}
