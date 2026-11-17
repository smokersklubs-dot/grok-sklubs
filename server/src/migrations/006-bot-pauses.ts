import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 6 — "Pause" (pauses.ts, agent/pause.ts): the owner pauses one bot, one sidebar section, or every bot of the
 * account. Additive only: one new table. Nothing else changes; the previous version of the code ignores it.
 *
 * - bot_pauses: one row per pause the owner set. scope 'bot' (target = the bot's id), 'section' (target = the section's
 *   id: every bot filed under it, the ones moved there later included) or 'all' (target = ''). A bot is paused while any
 *   row covers it; a helper bot follows its parent. `by_id`: who set it (always the owner today).
 *
 * The bots' queue (bot_queue) gets a new status value, 'held': work that came for a paused bot, kept in its order and run
 * when the bot is resumed. The column is free text (no CHECK), so no change is needed; a previous version of the code
 * never picks 'held' rows up (they wait, harmlessly, until this version runs them).
 */
export function botPauses(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_pauses (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, scope TEXT NOT NULL, target TEXT NOT NULL DEFAULT '',
    since INTEGER NOT NULL, by_id TEXT, PRIMARY KEY (user_id, scope, target)
  );
  CREATE INDEX IF NOT EXISTS bot_queue_held ON bot_queue(bot_id, status, id);`);
}
