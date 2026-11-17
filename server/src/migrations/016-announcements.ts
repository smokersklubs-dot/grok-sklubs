import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 16 — « Annonces » (announcements.ts): what the server's owner and hosted operators tell the people who use
 * it. Additive only: four new tables, no existing row is touched; the previous version of the code ignores them.
 *
 * - announcements: one row per announcement. `kind`: info / new / maintenance / important. `title` and `body` are plain
 *   text (never rendered as HTML or Markdown); `link_url` is an https address or ''. `audience`: JSON, one of
 *   {type:"everyone"}, {type:"plan",planId}, {type:"workspace",workspaceId}, {type:"accounts",userIds}. Shown from
 *   `starts_at` to `ends_at` (null: until archived). `site_banner`: a maintenance band on every page. `push` / `email`:
 *   sent once to each reader (announcement_sends). `archived_at`: taken down (kept for the log). `live_at`: when the
 *   readers' apps were told it is up (a scheduled one is told by the dispatch pass when it starts).
 * - announcement_reads: per reader, when they saw it in the bell (`seen_at`) and when they closed it (`dismissed_at`).
 * - announcement_sends: per announcement, reader and channel (push / email), sent, skipped (switched off, no device,
 *   no confirmed address) or failed. The primary key is what makes "once": a row is written before sending.
 * - announcement_log: who created, changed or archived what (the « Annonces » page shows the last ones).
 * - announcement_prefs: a reader's own choice to get announcements by e-mail (on by default when absent).
 */
export function announcements(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS announcements (
    id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL DEFAULT '',
    link_url TEXT NOT NULL DEFAULT '', link_label TEXT NOT NULL DEFAULT '', audience TEXT NOT NULL DEFAULT '{"type":"everyone"}',
    starts_at INTEGER NOT NULL, ends_at INTEGER, site_banner INTEGER NOT NULL DEFAULT 0,
    push INTEGER NOT NULL DEFAULT 0, email INTEGER NOT NULL DEFAULT 0,
    created_by TEXT NOT NULL, created_at INTEGER NOT NULL, updated_by TEXT NOT NULL, updated_at INTEGER NOT NULL,
    archived_at INTEGER, live_at INTEGER
  );
  CREATE INDEX IF NOT EXISTS announcements_open ON announcements(archived_at, starts_at);
  CREATE TABLE IF NOT EXISTS announcement_reads (
    announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    seen_at INTEGER, dismissed_at INTEGER, PRIMARY KEY (announcement_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS announcement_reads_user ON announcement_reads(user_id);
  CREATE TABLE IF NOT EXISTS announcement_sends (
    announcement_id TEXT NOT NULL REFERENCES announcements(id) ON DELETE CASCADE, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    channel TEXT NOT NULL, status TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY (announcement_id, user_id, channel)
  );
  CREATE TABLE IF NOT EXISTS announcement_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT, at INTEGER NOT NULL, actor_id TEXT NOT NULL, announcement_id TEXT NOT NULL,
    action TEXT NOT NULL, title TEXT NOT NULL DEFAULT ''
  );
  CREATE TABLE IF NOT EXISTS announcement_prefs (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, email INTEGER NOT NULL DEFAULT 1, updated_at INTEGER NOT NULL
  );`);
}
