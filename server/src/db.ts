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

CREATE_EXTRA();
function CREATE_EXTRA() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS vault (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
    site TEXT NOT NULL DEFAULT '', username TEXT NOT NULL DEFAULT '', password_enc TEXT, note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );`);
  // Columns added after the first release: add them only where they are missing.
  const has = (table: string, column: string) => (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some((c) => c.name === column);
  if (!has("users", "locale")) db.exec("ALTER TABLE users ADD COLUMN locale TEXT NOT NULL DEFAULT 'en'");
  const add = (table: string, column: string, decl: string) => { if (!has(table, column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${decl}`); };
  add("bots", "character", "TEXT NOT NULL DEFAULT '{}'");
  add("bots", "room_rule", "TEXT NOT NULL DEFAULT 'lead'");
  add("bots", "disabled_tools", "TEXT NOT NULL DEFAULT '[]'");
  add("bots", "telegram_token_enc", "TEXT");
  add("bots", "telegram_username", "TEXT");
  add("bots", "telegram_chat_id", "TEXT");
  add("bots", "telegram_code", "TEXT");
  add("bots", "telegram_offset", "INTEGER NOT NULL DEFAULT 0");
  add("routines", "watch_kind", "TEXT");
  add("routines", "watch_target", "TEXT");
  add("routines", "watch_every_min", "INTEGER");
  add("routines", "watch_hash", "TEXT");
  add("routines", "watch_checked_at", "INTEGER");
  add("settings", "budget_warned", "TEXT NOT NULL DEFAULT ''");
  // OAuth sign-in for connectors: "none" | "token" | "oauth" (empty on older rows: read from token_enc), and the sealed tokens.
  add("connectors", "auth", "TEXT NOT NULL DEFAULT ''");
  add("connectors", "oauth_enc", "TEXT");
  // Threads: a reply in a thread carries the seq of the message it hangs on (0 = the main chat). The model-facing
  // history of a thread is kept apart from the main one, under the same number.
  add("rows", "thread", "INTEGER NOT NULL DEFAULT 0");
  add("history", "thread", "INTEGER NOT NULL DEFAULT 0");
  db.exec(`
  CREATE INDEX IF NOT EXISTS rows_thread ON rows(bot_id, generation, thread, seq);
  CREATE INDEX IF NOT EXISTS history_thread ON history(bot_id, generation, thread, id);
  -- Light feedback for a bot (the user reacted to one of its messages), handed to its next turn in that chat or thread, then dropped.
  CREATE TABLE IF NOT EXISTS feedback (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0, seq INTEGER NOT NULL, emoji TEXT NOT NULL, text TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS feedback_bot ON feedback(bot_id, generation, thread);`);
  db.exec(`
  CREATE TABLE IF NOT EXISTS routine_runs (
    id TEXT PRIMARY KEY, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'running', note TEXT NOT NULL DEFAULT ''
  );
  CREATE INDEX IF NOT EXISTS routine_runs_routine ON routine_runs(routine_id, at);
  CREATE TABLE IF NOT EXISTS audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    at INTEGER NOT NULL, bot_id TEXT, kind TEXT NOT NULL, text TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS audit_user ON audit(user_id, id);
  -- The activity log is a record: lines can be added, never changed.
  CREATE TRIGGER IF NOT EXISTS audit_no_update BEFORE UPDATE ON audit BEGIN SELECT RAISE(ABORT, 'the activity log cannot be edited'); END;
  CREATE TABLE IF NOT EXISTS sign_in_links (
    token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at INTEGER NOT NULL
  );
  CREATE TABLE IF NOT EXISTS pages (
    token TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, user_id TEXT NOT NULL,
    title TEXT NOT NULL, path TEXT NOT NULL, created_at INTEGER NOT NULL
  );
  -- OAuth sign-ins waiting for the browser to come back: one row per state, single use, 10 minutes.
  CREATE TABLE IF NOT EXISTS oauth_pending (
    state_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    connector_id TEXT NOT NULL REFERENCES connectors(id) ON DELETE CASCADE, verifier_enc TEXT NOT NULL,
    bot_id TEXT, seq INTEGER, expires_at INTEGER NOT NULL
  );
  -- A turn that is under way. Rows left here after a restart are turns that were cut off.
  CREATE TABLE IF NOT EXISTS active_turns (
    bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, started_at INTEGER NOT NULL, acted INTEGER NOT NULL DEFAULT 0
  );`);
}

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
