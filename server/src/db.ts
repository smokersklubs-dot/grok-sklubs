import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";

mkdirSync(path.dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");

// Idempotent schema: safe to run on every start, so existing databases upgrade in place.
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE COLLATE NOCASE, name TEXT NOT NULL,
  pass_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS bots (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind TEXT NOT NULL DEFAULT 'agent', name TEXT NOT NULL, label TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '', instructions TEXT NOT NULL DEFAULT '',
  shape TEXT NOT NULL, color TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'personal',
  is_primary INTEGER NOT NULL DEFAULT 0, effort TEXT NOT NULL DEFAULT 'medium',
  model TEXT NOT NULL DEFAULT '', autonomy TEXT NOT NULL DEFAULT 'careful',
  voice TEXT NOT NULL DEFAULT '{}', generation INTEGER NOT NULL DEFAULT 1,
  next_seq INTEGER NOT NULL DEFAULT 1, rev INTEGER NOT NULL DEFAULT 0, unread INTEGER NOT NULL DEFAULT 0,
  hidden INTEGER NOT NULL DEFAULT 0, parent_id TEXT, members TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS bots_user ON bots(user_id);
CREATE TABLE IF NOT EXISTS rows (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL,
  seq INTEGER NOT NULL, rev INTEGER NOT NULL, kind TEXT NOT NULL, body TEXT NOT NULL, created_at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, generation, seq)
);
CREATE TABLE IF NOT EXISTS history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS history_bot ON history(bot_id, generation, id);
CREATE TABLE IF NOT EXISTS paused (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, state TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS approvals (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
  seq INTEGER NOT NULL, generation INTEGER NOT NULL, tool TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending',
  created_at INTEGER NOT NULL, resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS policies (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, tool TEXT NOT NULL, mode TEXT NOT NULL,
  PRIMARY KEY (user_id, tool)
);
CREATE TABLE IF NOT EXISTS memories (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  text TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'chat', created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS skills (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '', body TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, title TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'working', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS routines (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, name TEXT NOT NULL,
  prompt TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'cron', schedule TEXT NOT NULL DEFAULT '',
  timezone TEXT NOT NULL DEFAULT 'UTC', run_at INTEGER, hook_token TEXT, enabled INTEGER NOT NULL DEFAULT 1,
  last_run_at INTEGER, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS connectors (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  url TEXT NOT NULL, token_enc TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  checkins TEXT NOT NULL DEFAULT '{}', budget_usd REAL
);
CREATE TABLE IF NOT EXISTS usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, at INTEGER NOT NULL,
  model TEXT NOT NULL, input_tokens INTEGER NOT NULL, output_tokens INTEGER NOT NULL, cached_tokens INTEGER NOT NULL,
  cost_usd REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS usage_user ON usage(user_id, at);
CREATE TABLE IF NOT EXISTS consolidation (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, mark INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS compactions (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  generation INTEGER NOT NULL, at INTEGER NOT NULL, before_items INTEGER NOT NULL, after_items INTEGER NOT NULL
);
`);

type Param = string | number | null | bigint;
export const q = {
  all<T = Record<string, unknown>>(sql: string, ...p: Param[]): T[] {
    return db.prepare(sql).all(...p) as T[];
  },
  get<T = Record<string, unknown>>(sql: string, ...p: Param[]): T | undefined {
    return db.prepare(sql).get(...p) as T | undefined;
  },
  run(sql: string, ...p: Param[]) {
    return db.prepare(sql).run(...p);
  },
  tx<T>(fn: () => T): T {
    db.exec("BEGIN IMMEDIATE");
    try {
      const out = fn();
      db.exec("COMMIT");
      return out;
    } catch (e) {
      db.exec("ROLLBACK");
      throw e;
    }
  },
};
