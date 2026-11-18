import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 18 — two-factor sign-in (twofactor.ts). Additive only: three new tables, no existing row is touched; the
 * previous version of the code ignores them (it would then sign people in with their password alone).
 *
 * - two_factor: one row per account that set up (or is setting up) a code generator. `secret_enc`: the confirmed seed,
 *   sealed with the data key (datakey.ts); `pending_enc`: a seed shown for set-up, not yet confirmed by a code;
 *   `last_step`: the newest 30-second step a code was accepted for (RFC 6238 §5.2: a code works once).
 * - two_factor_recovery: the account's one-time recovery codes, hashed (never stored as they are); `used_at` once used.
 * - login_challenges: a sign-in that passed its first step (password, Google, e-mail reset, sign-in link) and waits for
 *   its code: only a hash of the token, 5 minutes, a handful of attempts. No session exists until the code is right.
 */
export function twoFactor(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS two_factor (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, secret_enc TEXT, pending_enc TEXT, pending_at INTEGER,
    enabled_at INTEGER, last_step INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS two_factor_recovery (
    user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, code_hash TEXT NOT NULL, used_at INTEGER,
    created_at INTEGER NOT NULL, PRIMARY KEY (user_id, code_hash)
  );
  CREATE TABLE IF NOT EXISTS login_challenges (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, via TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS login_challenges_user ON login_challenges(user_id);
  CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
  `);
}
