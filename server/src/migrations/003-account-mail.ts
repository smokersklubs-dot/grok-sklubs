import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 3 — the server's own e-mails (SK-P0-10): forgotten password and change of e-mail address. Additive only:
 * three new tables, no existing row is touched.
 *
 * - instance_smtp: the SMTP account the server sends its own e-mails with, set by the instance owner (Settings →
 *   Account). One row at most. The password is sealed (auth.ts seal). SMTP_* environment variables take precedence
 *   over this row (accountmail.ts).
 * - password_resets: "Mot de passe oublié ?" links. Only a SHA-256 of the token is stored; single use (the row is
 *   deleted when it is used), 30 minutes. A new request for the same account replaces the older link.
 * - email_changes: a pending change of an account's e-mail address, confirmed by a link sent to the new address. Same
 *   rules as password_resets (hashed token, single use, 30 minutes, one pending change per account).
 */
export function accountMail(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS instance_smtp (
    id INTEGER PRIMARY KEY CHECK (id = 1), host TEXT NOT NULL, port INTEGER NOT NULL, tls_mode TEXT NOT NULL,
    username TEXT NOT NULL DEFAULT '', pass_enc TEXT, from_addr TEXT NOT NULL, updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS password_resets_user ON password_resets(user_id);
  CREATE TABLE IF NOT EXISTS email_changes (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    new_email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS email_changes_user ON email_changes(user_id);`);
}
