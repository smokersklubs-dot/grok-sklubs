import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 11 — "Accès API" (botapi.ts, docs/API-BOT.md): the owner's API keys for one bot. Additive only: one new table.
 * Nothing else changes; the previous version of the code ignores it (its keys then simply do not work).
 *
 * - bot_api_keys: one row per key. Only the SHA-256 of the key is kept (`key_hash`, unique); `prefix` is its first
 *   characters, shown so the owner can tell keys apart. `scopes`: a JSON list among "read", "write", "tasks".
 *   `last_used_at`: the last call that went through (written at most once a minute). `revoked_at`: set when the owner
 *   revokes it — the row stays, so the settings and the activity log can still name it; a revoked key never works again.
 *   A key goes with its bot and with its account (ON DELETE CASCADE).
 */
export function botApiKeys(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS bot_api_keys (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL, prefix TEXT NOT NULL,
    key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL,
    last_used_at INTEGER, revoked_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS bot_api_keys_bot ON bot_api_keys(bot_id, revoked_at);`);
}
