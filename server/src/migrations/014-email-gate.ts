import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 14 — mandatory e-mail verification (publicsignup.ts, docs/OUVERTURE-PUBLIQUE.md). Additive only.
 *
 * - users.first_bot: the first bot of a new account that must confirm its address is no longer created at sign-up but
 *   once the address is proven. Until then this holds the name and role chosen on the sign-up form (JSON, "null" for the
 *   defaults); NULL means nothing is waiting (every existing account). The previous version of the code ignores it.
 */
export function emailGate(db: DatabaseSync): void {
  const cols = new Set((db.prepare("PRAGMA table_info(users)").all() as { name: string }[]).map((c) => c.name));
  if (!cols.has("first_bot")) db.exec("ALTER TABLE users ADD COLUMN first_bot TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS users_verify_pending ON users(email_verify_pending, created_at)");
}
