import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 9 — draft skills ("Importer depuis Grok Bot", grokimport.ts): a skill that arrived from outside and that the
 * user has not checked yet. A draft is listed in the bot's settings (with "Activate") but is never given to the bot: it
 * is left out of its prompt, of skill_read and of the skills its teammates share. Additive only: one column, 0 for every
 * existing skill, so nothing changes for them; the previous version of the code ignores the column (a draft would then
 * read as an ordinary skill, which is what it becomes once activated).
 */
export function skillDrafts(db: DatabaseSync): void {
  const has = (db.prepare("PRAGMA table_info(skills)").all() as { name: string }[]).some((c) => c.name === "draft");
  if (!has) db.exec("ALTER TABLE skills ADD COLUMN draft INTEGER NOT NULL DEFAULT 0");
}
