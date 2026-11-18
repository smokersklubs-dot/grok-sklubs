import type { DatabaseSync } from "node:sqlite";

export function uploadSessions(db: DatabaseSync) {
  // Keep the receipt until expiry even after a bot is removed, so the sweeper can unlink its staging file.
  db.exec(`CREATE TABLE upload_sessions (
    id TEXT PRIMARY KEY, owner TEXT NOT NULL, bot TEXT NOT NULL, name TEXT NOT NULL,
    total INTEGER NOT NULL, received INTEGER NOT NULL DEFAULT 0, receipt TEXT, touched INTEGER NOT NULL
  );
  CREATE INDEX upload_sessions_expiry ON upload_sessions(touched);
  CREATE INDEX upload_sessions_active ON upload_sessions(owner) WHERE receipt IS NULL;`);
}
