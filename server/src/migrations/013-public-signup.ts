import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 13 — "Ouverture publique" (publicsignup.ts, docs/OUVERTURE-PUBLIQUE.md): e-mail verification of new accounts
 * and the guided first run. Additive only: two columns with a default, one new table; no existing row changes meaning,
 * and the previous version of the code ignores all of it.
 *
 * - users.email_verify_pending: 1 while a NEW account created through public sign-up (OPEN_SIGNUP or HOSTED_MODE, with
 *   the server's SMTP configured) has not opened its verification link; its bots take no turns until then. Every account
 *   that exists when this step runs keeps the default 0: it is grandfathered as verified.
 * - users.email_verified_at: when the address was proven (link opened, or Google said `email_verified`); existing
 *   accounts get their creation time (grandfathered).
 * - users.onboarding_pending: 1 for a new public account until it finishes or skips the 3-step first run.
 * - email_verifications: verification links. Only a SHA-256 of the token is stored; single use (the row is deleted when
 *   it is used), 24 hours; a new link for the same account replaces the older one.
 */
export function publicSignup(db: DatabaseSync): void {
  const cols = new Set((db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("email_verify_pending")) db.exec("ALTER TABLE users ADD COLUMN email_verify_pending INTEGER NOT NULL DEFAULT 0");
  if (!cols.has("email_verified_at")) {
    db.exec("ALTER TABLE users ADD COLUMN email_verified_at INTEGER");
    db.exec("UPDATE users SET email_verified_at = created_at WHERE email_verified_at IS NULL");
  }
  if (!cols.has("onboarding_pending")) db.exec("ALTER TABLE users ADD COLUMN onboarding_pending INTEGER NOT NULL DEFAULT 0");
  db.exec(`
  CREATE TABLE IF NOT EXISTS email_verifications (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_verifications_user ON email_verifications(user_id);`);
}
