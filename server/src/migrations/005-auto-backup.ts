import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 5 — the in-app automatic off-server backup (autobackup.ts). Additive only: two new tables, nothing else is
 * touched; the previous version of the code ignores them.
 *
 * - instance_backup: the owner's settings (Settings → Account → "Sauvegarde automatique"). One row at most. The S3
 *   access key and secret key are sealed (auth.ts seal) and never sent back to the browser. `recipient` is the owner's
 *   age PUBLIC key (age1…): the server encrypts each backup for it and cannot decrypt it; the private key is never
 *   stored here. `failures` counts failed runs in a row; `alerted` is set once the owner was told (after two).
 *   `last_slot` is the local date (YYYY-MM-DD, in `timezone`) of the last scheduled run, so it runs once a day.
 * - backup_runs: one row per run (scheduled or "Sauvegarder maintenant"), for the history shown to the owner.
 */
export function autoBackup(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS instance_backup (
    id INTEGER PRIMARY KEY CHECK (id = 1), enabled INTEGER NOT NULL DEFAULT 1, provider TEXT NOT NULL DEFAULT 'other',
    endpoint TEXT NOT NULL, region TEXT NOT NULL DEFAULT '', bucket TEXT NOT NULL, path_style INTEGER NOT NULL DEFAULT 0,
    access_key_enc TEXT NOT NULL, secret_key_enc TEXT NOT NULL, prefix TEXT NOT NULL DEFAULT 'sklubot/', recipient TEXT NOT NULL,
    hour INTEGER NOT NULL DEFAULT 3, timezone TEXT NOT NULL DEFAULT 'UTC', keep_daily INTEGER NOT NULL DEFAULT 7,
    keep_weekly INTEGER NOT NULL DEFAULT 4, failures INTEGER NOT NULL DEFAULT 0, alerted INTEGER NOT NULL DEFAULT 0,
    last_slot TEXT, updated_at INTEGER NOT NULL, updated_by TEXT
  );
  CREATE TABLE IF NOT EXISTS backup_runs (
    id TEXT PRIMARY KEY, trigger TEXT NOT NULL, started_at INTEGER NOT NULL, finished_at INTEGER, ok INTEGER,
    object_key TEXT, bytes INTEGER, files INTEGER, duration_ms INTEGER, error TEXT
  );
  CREATE INDEX IF NOT EXISTS backup_runs_started ON backup_runs(started_at);`);
}
