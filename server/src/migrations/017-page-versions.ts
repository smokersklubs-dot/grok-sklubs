import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 17 — pages published by bots get files next to their HTML and a history (pagefiles.ts). Additive only: two
 * new tables, no existing row is touched; the previous version of the code ignores them (a page then shows its HTML only).
 *
 * - page_files: the current text files of a page (style.css, app.js, data.json…), next to its HTML in the bot's library
 *   (`path` is the page's HTML path there, `file` the relative name the HTML refers to). Served at /p/<token>/<file>.
 * - page_versions: every publish, edit or restore of a page: its HTML and its files (JSON [{file, content}]) at that
 *   moment, `note` (published / edited / restored from a version). The oldest are dropped past the plan's limit.
 * Both go with their bot (ON DELETE CASCADE).
 */
export function pageVersions(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS page_files (
    bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, path TEXT NOT NULL, file TEXT NOT NULL,
    content TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, path, file)
  );
  CREATE TABLE IF NOT EXISTS page_versions (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, path TEXT NOT NULL,
    html TEXT NOT NULL, files TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS page_versions_by_page ON page_versions(bot_id, path, id);
  `);
}
