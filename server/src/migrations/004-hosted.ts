import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 4 — the commercial "hosted mode" (SK-P0-11, -12, -13, SK-P1-01, -07, -08). Additive only: new tables, three
 * new columns with defaults, and the three default plans. Nothing here changes how the server behaves while HOSTED_MODE
 * is off (hosted.ts reads these tables only when it is on); the previous version of the code ignores all of it.
 *
 * - plans: what an account may use. kind 'free' (testers, no payment, operator keys, small budget), 'included' (paid,
 *   operator keys, monthly AI budget), 'byok' (the customer's own API keys only, never the operator's). Limits are NULL
 *   for "no limit". Edited by the instance owner (Settings → Administration); archived plans stay valid for the accounts
 *   that have them but are no longer offered.
 * - subscriptions: one row per customer account (the operator's own accounts have none). status 'trial' | 'active' |
 *   'past_due' | 'suspended'; dates in ms; provider 'manual' until a payment provider is plugged in (billing/provider.ts).
 * - credit_topups: AI budget the operator adds for one calendar month (YYYY-MM), on top of the plan's budget.
 * - hosted_settings: one JSON row (exchange rate, trial and grace days, contact address, estimates, legal details).
 * - plan_invites: invitation links that create an account on a given plan (hashed token, single use, expiry).
 * - admin_audit: what operators (and the scheduler) did to customer accounts. A record: lines are never changed.
 * - billing_events: provider webhook event ids already handled (idempotency of the payment webhooks: Paddle, credits.ts).
 * - users.server_role: 'operator' for accounts the owner made operators ('' otherwise). The owner (oldest account) is
 *   always an operator, whatever this column says.
 * - user_providers.shared_hosted: an operator's own API provider lent to hosted accounts whose plan uses operator keys.
 * - usage.payer: who pays for a usage line in hosted mode — 'operator', 'own' (the customer's own key), 'subscription'
 *   (a Claude / ChatGPT subscription tool) — or '' (written while hosted mode was off, or before this migration).
 */
export function hosted(db: DatabaseSync): void {
  const cols = (table: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
  if (!cols("users").includes("server_role")) db.exec("ALTER TABLE users ADD COLUMN server_role TEXT NOT NULL DEFAULT ''");
  if (!cols("user_providers").includes("shared_hosted")) db.exec("ALTER TABLE user_providers ADD COLUMN shared_hosted INTEGER NOT NULL DEFAULT 0");
  if (!cols("usage").includes("payer")) db.exec("ALTER TABLE usage ADD COLUMN payer TEXT NOT NULL DEFAULT ''");
  db.exec(`
  CREATE INDEX IF NOT EXISTS usage_payer ON usage(user_id, payer, at);
  CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, name_fr TEXT NOT NULL, name_en TEXT NOT NULL,
    description_fr TEXT NOT NULL DEFAULT '', description_en TEXT NOT NULL DEFAULT '',
    price_eur REAL NOT NULL DEFAULT 0, ai_budget_eur REAL NOT NULL DEFAULT 0,
    max_bots INTEGER, max_awake_computers INTEGER, storage_gb REAL, max_routines INTEGER,
    public INTEGER NOT NULL DEFAULT 1, position INTEGER NOT NULL DEFAULT 0, archived INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS subscriptions (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, plan_id TEXT NOT NULL,
    status TEXT NOT NULL, trial_ends_at INTEGER, period_end INTEGER, grace_ends_at INTEGER,
    provider TEXT NOT NULL DEFAULT 'manual', external_ref TEXT NOT NULL DEFAULT '',
    status_changed_at INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS subscriptions_status ON subscriptions(status);
  CREATE TABLE IF NOT EXISTS credit_topups (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL,
    amount_eur REAL NOT NULL, note TEXT NOT NULL DEFAULT '', by_id TEXT, at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS credit_topups_user ON credit_topups(user_id, month);
  CREATE TABLE IF NOT EXISTS hosted_settings (
    id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS plan_invites (
    id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, plan_id TEXT NOT NULL, email TEXT NOT NULL DEFAULT '' COLLATE NOCASE,
    created_by TEXT NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER, used_by TEXT, created_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS admin_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT NOT NULL, actor_label TEXT NOT NULL,
    target_id TEXT, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS admin_audit_target ON admin_audit(target_id, id);
  CREATE TRIGGER IF NOT EXISTS admin_audit_no_update BEFORE UPDATE ON admin_audit BEGIN SELECT RAISE(ABORT, 'the administration log cannot be edited'); END;
  CREATE TABLE IF NOT EXISTS billing_events (
    provider TEXT NOT NULL, event_id TEXT NOT NULL, received_at INTEGER NOT NULL, PRIMARY KEY (provider, event_id)
  );`);
  // The default plans (sensible starting points; the owner edits them in Settings → Administration).
  const t = Date.now();
  const seed = db.prepare(`INSERT OR IGNORE INTO plans (id, kind, name_fr, name_en, description_fr, description_en, price_eur, ai_budget_eur,
    max_bots, max_awake_computers, storage_gb, max_routines, public, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`);
  seed.run("free", "free", "Gratuit", "Free", "Pour essayer : les clés d'IA du service, un petit budget chaque mois.", "To try it out: the service's AI keys, a small budget each month.",
    0, 2, 2, 1, 1, 3, 0, t, t);
  seed.run("included", "included", "Tout inclus", "All included", "Les clés d'IA du service et un budget IA mensuel compris dans le prix.", "The service's AI keys and a monthly AI budget included in the price.",
    39, 20, 10, 2, 10, 30, 1, t, t);
  seed.run("byok", "byok", "J'apporte ma clé", "Bring your own key", "Tes propres clés d'API (DeepSeek, OpenAI…) : tu paies ton fournisseur directement.", "Your own API keys (DeepSeek, OpenAI…): you pay your provider directly.",
    15, 0, 10, 2, 10, 30, 2, t, t);
}
