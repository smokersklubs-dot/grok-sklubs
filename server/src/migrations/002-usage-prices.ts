import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 2 — AI cost for every model (SK-P0-06). Additive only: two new tables and two new columns with defaults; no
 * existing row is rewritten except to label the price status of old usage lines (a new column).
 *
 * - usage.price_status: how cost_usd was found — 'priced' (a known price), 'unknown' (no price: cost_usd is 0 and
 *   est_cost_usd holds the conservative estimate used for budgets), 'subscription' (a Claude/ChatGPT subscription tool:
 *   no per-token charge), 'reported' (the service gave the price itself). '' on lines written before this migration.
 * - usage.est_cost_usd: for an 'unknown' line, the estimate the budget and spend checkpoints count instead of 0.
 * - model_prices: prices the instance owner sets for the server's models (Settings → Models), in USD per million tokens.
 *   They take precedence over the built-in table (usage.ts). A row with all prices NULL is not stored.
 * - subscription_usage: the latest use of each account's subscription windows (Claude Code, Codex), as the tools report
 *   it. It used to live in memory only and was lost on every restart. Token counts of those turns are in `usage`.
 * - monitor: small facts the health checks keep (monitor.ts): the write probe of /api/health, and the like.
 */
export function usageAndPrices(db: DatabaseSync): void {
  const cols = (db.prepare("PRAGMA table_info(usage)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("price_status")) db.exec("ALTER TABLE usage ADD COLUMN price_status TEXT NOT NULL DEFAULT ''");
  if (!cols.includes("est_cost_usd")) db.exec("ALTER TABLE usage ADD COLUMN est_cost_usd REAL NOT NULL DEFAULT 0");
  // Old lines: subscription tools are recognisable by their model reference; the rest is left '' (not known then).
  db.exec("UPDATE usage SET price_status = 'subscription' WHERE price_status = '' AND (model LIKE 'claude-code:%' OR model LIKE 'codex:%')");
  db.exec(`
  CREATE TABLE IF NOT EXISTS model_prices (
    model TEXT PRIMARY KEY, input REAL, output REAL, cached REAL, note TEXT NOT NULL DEFAULT '',
    updated_by TEXT, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS subscription_usage (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, engine TEXT NOT NULL,
    five_hour REAL, seven_day REAL, resets_at INTEGER, at INTEGER NOT NULL,
    PRIMARY KEY (user_id, engine)
  );
  CREATE TABLE IF NOT EXISTS monitor (key TEXT PRIMARY KEY, value TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL);
  CREATE INDEX IF NOT EXISTS usage_user_model ON usage(user_id, model, at);`);
}
