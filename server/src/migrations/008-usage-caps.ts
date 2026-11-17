import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 8 — usage caps (usagecaps.ts): daily and monthly limits on what an account, or one bot, uses — in money
 * and/or in tokens — with what a reached cap stops ("unattended": only work no person started; "everything"). Additive
 * only: three new tables and one index. Nothing existing is rewritten; the previous version of the code ignores them
 * (the monthly budget, settings.budget_usd, and the spend checkpoints stay exactly as they were).
 *
 * - usage_caps: one row per cap. `bot_id` '' = the whole account, else one bot (its helpers count with it). `period`
 *   'day' | 'month' (in the user's timezone); `unit` 'usd' | 'tokens'; `limit_value` (> 0); `mode` 'unattended' |
 *   'everything'; `warn_percent` (1–99, one notice when it is passed); `set_by` 'self' (the account's owner) or
 *   'operator' (hosted mode: the service's operator, on a customer's account; the customer cannot change it).
 * - usage_cap_notices: what was already said, so each warning, each "reached" card and each journal line comes once per
 *   cap, period and limit — also across a restart. `count`: how many pieces of work were skipped under it.
 * - usage_cap_stops: the card shown when a cap is reached, with the work it set aside (`held`, JSON list of
 *   {botId, trigger}) that "Continue" runs once the cap allows it.
 * - usage_bot: per-bot sums of `usage` over a period (the caps of one bot, the usage page's bars).
 */
export function usageCaps(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS usage_caps (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL DEFAULT '', period TEXT NOT NULL,
    unit TEXT NOT NULL, set_by TEXT NOT NULL DEFAULT 'self', limit_value REAL NOT NULL, mode TEXT NOT NULL DEFAULT 'unattended',
    warn_percent INTEGER NOT NULL DEFAULT 80, updated_by TEXT, updated_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, bot_id, period, unit, set_by)
  );
  CREATE TABLE IF NOT EXISTS usage_cap_notices (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, cap_key TEXT NOT NULL, period_key TEXT NOT NULL,
    kind TEXT NOT NULL, at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1,
    PRIMARY KEY (user_id, cap_key, period_key, kind)
  );
  CREATE TABLE IF NOT EXISTS usage_cap_stops (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, card_bot_id TEXT NOT NULL,
    cap_key TEXT NOT NULL, period_key TEXT NOT NULL, generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0,
    card_seq INTEGER, held TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS usage_cap_stops_pending ON usage_cap_stops(user_id, cap_key, period_key, status);
  CREATE INDEX IF NOT EXISTS usage_bot ON usage(bot_id, at);`);
}
