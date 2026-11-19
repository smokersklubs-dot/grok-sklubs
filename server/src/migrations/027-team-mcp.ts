import type { DatabaseSync } from "node:sqlite";
export function teamMcp(db: DatabaseSync) {
  db.exec(`CREATE TABLE team_mcp_keys (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    id TEXT NOT NULL UNIQUE, key_hash TEXT NOT NULL UNIQUE, scopes TEXT NOT NULL, created_at INTEGER NOT NULL, last_used_at INTEGER
  );`);
}
