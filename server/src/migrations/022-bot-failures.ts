import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 22 — « Coordinateur d'échecs » (agent/failures.ts). Additive only: one new table and two indexes; no existing
 * row is touched, and the previous version of the code ignores the table.
 *
 * bot_failures: one row per incident of a bot — a failure classified (`class`, plus the failing `tool` and the `provider`
 * when known), what was tried automatically (`tried`, JSON list of {action, at, ok, note}), where it stands (`status`:
 * auto, waiting, retrying, resolved, handed, dismissed; `resolved_by`: auto or user) and its card in the chat
 * (`generation`, `seq`, `thread`). The same failure again within 10 minutes updates the row (`count`, `last_at`) instead
 * of making a new one. `retries`: automatic new tries already made for it (bounded).
 */
export function botFailures(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_failures (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    class TEXT NOT NULL, tool TEXT NOT NULL DEFAULT '', provider TEXT NOT NULL DEFAULT '', detail TEXT NOT NULL DEFAULT '',
    tried TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL, resolved_by TEXT NOT NULL DEFAULT '',
    count INTEGER NOT NULL DEFAULT 1, retries INTEGER NOT NULL DEFAULT 0,
    generation INTEGER, seq INTEGER, thread INTEGER NOT NULL DEFAULT 0,
    first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, resolved_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS bot_failures_bot ON bot_failures(bot_id, last_at);
  CREATE INDEX IF NOT EXISTS bot_failures_user ON bot_failures(user_id, last_at);`);
}
