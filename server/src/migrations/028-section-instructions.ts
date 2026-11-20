import type { DatabaseSync } from "node:sqlite";

export function sectionInstructions(db: DatabaseSync) {
  db.exec("ALTER TABLE bot_sections ADD COLUMN instructions TEXT NOT NULL DEFAULT ''");
}
