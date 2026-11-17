import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 12 — "Sentinelle" (sentinel/, page Surveillance): the health scanner's own tables, and three indexes that
 * keep its reads cheap. Additive only: new tables and indexes, no existing row is touched; the previous version of the
 * code ignores them.
 *
 * - sentinel_incidents: one row per incident. `fingerprint` is stable for the same problem (e.g. "tool_errors:<bot>:<tool>"):
 *   at most one incident per fingerprint is not resolved (partial unique index); once resolved, the same problem coming
 *   back opens a new row, so the history keeps each episode. `status`: open (first seen) → ongoing (seen again) →
 *   resolved (quiet for the quiet period). `acked_at`/`acked_by`: acknowledged by the owner or an operator (no more
 *   alerts for it). `params`: JSON for the explanation (numbers, a tool's name, a provider; never a message's text).
 *   `count`: the measure at the last scan; `peak`: its highest; `seen`: scans that saw it. `user_id`/`bot_id`: the
 *   account and bot it concerns, if any (deleted with the account).
 * - sentinel_samples: the measure per hour (the highest of that hour), for the 24-hour sparkline. Pruned after 8 days.
 * - sentinel_alerts: what was sent to whom (push and/or e-mail) — `ref` is an incident id or "digest:<day>", `kind`
 *   open / critical / resolved / digest. Unique per (user, ref, kind): never the same alert twice.
 * - sentinel_settings: each watcher's alert settings (JSON; Réglages → Surveillance).
 * - Indexes on action_journal(at), usage(at) and audit(at): the scanner reads the last hour or week across accounts.
 */
export function sentinel(db: DatabaseSync): void {
  db.exec(`
  CREATE TABLE IF NOT EXISTS sentinel_incidents (
    id TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, kind TEXT NOT NULL, severity TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open',
    params TEXT NOT NULL DEFAULT '{}', user_id TEXT REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT,
    count INTEGER NOT NULL DEFAULT 0, peak INTEGER NOT NULL DEFAULT 0, seen INTEGER NOT NULL DEFAULT 1,
    first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, resolved_at INTEGER, acked_at INTEGER, acked_by TEXT
  );
  CREATE UNIQUE INDEX IF NOT EXISTS sentinel_incidents_active ON sentinel_incidents(fingerprint) WHERE status != 'resolved';
  CREATE INDEX IF NOT EXISTS sentinel_incidents_status ON sentinel_incidents(status, last_at);
  CREATE TABLE IF NOT EXISTS sentinel_samples (
    incident_id TEXT NOT NULL REFERENCES sentinel_incidents(id) ON DELETE CASCADE, hour INTEGER NOT NULL, value INTEGER NOT NULL,
    PRIMARY KEY (incident_id, hour)
  );
  CREATE TABLE IF NOT EXISTS sentinel_alerts (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, ref TEXT NOT NULL,
    kind TEXT NOT NULL, channels TEXT NOT NULL DEFAULT '', at INTEGER NOT NULL, UNIQUE (user_id, ref, kind)
  );
  CREATE INDEX IF NOT EXISTS sentinel_alerts_user ON sentinel_alerts(user_id, at);
  CREATE TABLE IF NOT EXISTS sentinel_settings (
    user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, value TEXT NOT NULL DEFAULT '{}', updated_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS action_journal_at ON action_journal(at);
  CREATE INDEX IF NOT EXISTS usage_at ON usage(at);
  CREATE INDEX IF NOT EXISTS audit_at ON audit(at);`);
}
