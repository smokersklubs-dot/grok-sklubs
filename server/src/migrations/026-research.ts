import type { DatabaseSync } from "node:sqlite";

export function research(db: DatabaseSync) {
  db.exec(`CREATE TABLE research_reports (
    id TEXT PRIMARY KEY, bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, thread INTEGER NOT NULL, request_id TEXT NOT NULL,
    brief TEXT NOT NULL, sections TEXT NOT NULL DEFAULT '[]', state TEXT NOT NULL DEFAULT 'queued',
    lease TEXT, expires INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL,
    UNIQUE(bot, generation, request_id)
  );
  CREATE INDEX research_pending ON research_reports(state, updated);
  CREATE TABLE research_x_accounts (
    owner TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, token_enc TEXT NOT NULL
  );`);
}
