import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 21 — prepaid AI credits (hosted mode, docs/MODE-HEBERGE.md "Crédits").
 *  - credit_topups.kind: 'month' (what every row was until now: AI budget the operator adds for one calendar month) or
 *    'prepaid' (credits bought or given that do not end with the month: they are spent once the plan's budget and the
 *    month's top-ups are used up, then carried over).
 *  - credit_topups.source: 'manual' (the operator, Administration) or 'stripe' (a paid Stripe Checkout Session).
 *  - credit_topups.external_ref: the Stripe Checkout Session id of a purchase; unique when set, so one payment can never
 *    be credited twice (whatever arrives twice: the same event, or two events for the same session).
 *  - credit_checkouts: the Checkout Sessions this server created (who, which pack, how much). A webhook only credits a
 *    session found here, to the account that created it, for the amount the server set — never what a client sends.
 *  - credit_months: how much of the prepaid credits each closed calendar month used (written once, when the month is
 *    over and looked at), so the balance carries over without walking all past usage again.
 *  - email_link_signups: "Recevoir un lien de connexion par e-mail" for an address with no account yet (emaillink.ts):
 *    what the sign-up form held (name, language, plan, terms), kept until the link is opened (15 minutes, single use,
 *    only a SHA-256 of the token). Nothing is created before the link proves the address.
 *  - users.push_prompt: the first run's "Active les notifications" step and the Today banner (pushprompt.ts): '' (not
 *    asked yet), 'enabled' or 'dismissed' — asked once, remembered on the server.
 * Additive only: the previous version of the code reads credit_topups as before (it ignores the new columns, and every
 * existing row keeps the meaning it had).
 */
export function prepaidCredits(db: DatabaseSync): void {
  const cols = (db.prepare("PRAGMA table_info(credit_topups)").all() as { name: string }[]).map((c) => c.name);
  if (!cols.includes("kind")) db.exec("ALTER TABLE credit_topups ADD COLUMN kind TEXT NOT NULL DEFAULT 'month'");
  if (!cols.includes("source")) db.exec("ALTER TABLE credit_topups ADD COLUMN source TEXT NOT NULL DEFAULT 'manual'");
  if (!cols.includes("external_ref")) db.exec("ALTER TABLE credit_topups ADD COLUMN external_ref TEXT NOT NULL DEFAULT ''");
  const ucols = (db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name);
  if (!ucols.includes("push_prompt")) db.exec("ALTER TABLE users ADD COLUMN push_prompt TEXT NOT NULL DEFAULT ''");
  db.exec(`
  CREATE TABLE IF NOT EXISTS email_link_signups (
    token_hash TEXT PRIMARY KEY, email TEXT NOT NULL COLLATE NOCASE, payload TEXT NOT NULL DEFAULT '{}',
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS credit_topups_ref ON credit_topups(external_ref) WHERE external_ref <> '';
  CREATE INDEX IF NOT EXISTS credit_topups_kind ON credit_topups(user_id, kind, at);
  CREATE TABLE IF NOT EXISTS credit_checkouts (
    session_id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, pack_id TEXT NOT NULL,
    amount_eur REAL NOT NULL, status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL, paid_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS credit_checkouts_user ON credit_checkouts(user_id, created_at);
  CREATE TABLE IF NOT EXISTS credit_months (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, month TEXT NOT NULL, consumed_eur REAL NOT NULL,
    closed_at INTEGER NOT NULL, PRIMARY KEY (user_id, month)
  );`);
}
