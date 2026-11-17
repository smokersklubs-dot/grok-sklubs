import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 10 — "Aujourd'hui" (today.ts): the account's settings for the Today page. Additive only: one column of the
 * settings table, '{}' for every existing account (= the default minutes table and no digest), so nothing changes for
 * them; the previous version of the code ignores the column.
 *
 * settings.today (JSON): `minutes` — the owner's overrides of the time-saved table (todayminutes.ts), whole minutes per
 * kind; `digest` — the optional daily summary {enabled, hour (0–23, the user's timezone), push, email}, off by default;
 * `lastSent` — the local day (YYYY-MM-DD) the digest last went out, so it goes once a day, also across a restart.
 */
export function today(db: DatabaseSync): void {
  const has = (db.prepare("PRAGMA table_info(settings)").all() as { name: string }[]).some((c) => c.name === "today");
  if (!has) db.exec("ALTER TABLE settings ADD COLUMN today TEXT NOT NULL DEFAULT '{}'");
}
