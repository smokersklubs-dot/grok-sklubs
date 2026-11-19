import type { DatabaseSync } from "node:sqlite";

export function studioAndGithub(db: DatabaseSync) {
  db.exec(`CREATE TABLE studio_exports (
    id TEXT PRIMARY KEY, bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
    generation INTEGER NOT NULL, project TEXT NOT NULL, version INTEGER NOT NULL, thread INTEGER NOT NULL,
    narration INTEGER NOT NULL, language TEXT NOT NULL, locale TEXT NOT NULL, story TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'queued', lease TEXT, expires INTEGER NOT NULL DEFAULT 0,
    attempts INTEGER NOT NULL DEFAULT 0, file TEXT, error TEXT, updated INTEGER NOT NULL,
    UNIQUE(bot,generation,project,version,thread,narration,language)
  );
  CREATE INDEX studio_exports_queue ON studio_exports(state,updated);
  CREATE TABLE github_watches (
    bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, repo TEXT NOT NULL COLLATE NOCASE,
    connector TEXT, PRIMARY KEY(bot,repo)
  );
  CREATE TABLE peer_reviews(id TEXT PRIMARY KEY, bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL,
    seq INTEGER NOT NULL,started INTEGER NOT NULL,result TEXT,error TEXT,UNIQUE(bot,generation,seq));
  CREATE TABLE github_discussions (source TEXT PRIMARY KEY, bot TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, seq INTEGER NOT NULL);`);
}
