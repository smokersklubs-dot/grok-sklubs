import { db, q } from "../db.js";
import type { Memory } from "../shared.js";
import { memories } from "../store.js";
import { rankNotes } from "./recall.js";
import { looksSecret } from "./sensitive.js";

/**
 * L67, the rest of « Apprentissage plus réactif et plus juste » (Sklubot's own code):
 *  - invisible characters (zero-width spaces and joiners, direction marks and overrides, soft hyphens, BOM, control
 *    characters) are removed from every note before it is kept: they hide text and break the comparison of notes;
 *  - `memory_save` says when the note is already there (and which one) instead of keeping it twice;
 *  - the learning pass shows the model the 20 notes CLOSEST to what it reads (by keywords), not the 200 latest: an old
 *    note on the same subject is the one that matters to avoid a duplicate, and the prompt stays small;
 *  - « Retiens surtout… »: the owner's own words on what this bot should pay attention to (or leave aside) when it learns.
 */
export const NEAR_NOTES = 20;
export const FOCUS_MAX = 500;

/** Removes invisible and control characters (keeps new lines and tabs), then tidies the spaces. */
export function cleanInvisible(text: string): string {
  return text
    .normalize("NFC")
    .replace(/[​-‏‪-‮⁠-⁤⁦-⁩­﻿᠎͏]/g, "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g, "")
    .replace(/[ \t  ]+/g, " ")
    .trim();
}

/** The notes of the bot closest to `text` (keywords), topped up with the newest ones, NEAR_NOTES at most. */
export function nearbyNotes(botId: string, text: string, limit = NEAR_NOTES): Memory[] {
  const all = memories.list(botId, 5000).filter((m) => m.status !== "archived");
  const near = rankNotes(all, text, { limit }).map((r) => r.note);
  const seen = new Set(near.map((m) => m.id));
  for (const m of all) { if (near.length >= limit) break; if (!seen.has(m.id)) { near.push(m); seen.add(m.id); } }
  return near;
}

/** An existing note (not archived) that already says this, or null. `same` is memory.ts `similar`. */
export function duplicateOf(botId: string, text: string, same: (a: string, b: string) => boolean): Memory | null {
  const all = memories.list(botId, 5000).filter((m) => m.status !== "archived");
  const candidates = [...rankNotes(all, text, { limit: 50 }).map((r) => r.note), ...all.slice(0, 200)];
  return candidates.find((m) => same(m.text, text)) ?? null;
}

// ── « Retiens surtout… » ─────────────────────────────────────────────────────────────────────────────────────────
db.exec("CREATE TABLE IF NOT EXISTS memory_focus (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, text TEXT NOT NULL, updated_at INTEGER NOT NULL)");
export const memoryFocus = (botId: string): string => q.get<{ text: string }>("SELECT text FROM memory_focus WHERE bot_id = ?", botId)?.text ?? "";
export function setMemoryFocus(botId: string, raw: unknown): string {
  if (typeof raw !== "string") throw new Error("Écris un texte.");
  const text = cleanInvisible(raw).slice(0, FOCUS_MAX);
  if (looksSecret(text)) throw new Error("Ce texte ressemble à un mot de passe ou une clé : il n'est pas gardé.");
  if (!text) { q.run("DELETE FROM memory_focus WHERE bot_id = ?", botId); return ""; }
  q.run("INSERT INTO memory_focus (bot_id, text, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET text = excluded.text, updated_at = excluded.updated_at", botId, text, Date.now());
  return text;
}
/** The lines added to the learning prompt (empty when the owner wrote nothing). Their words guide, the rules stay. */
export function focusPrompt(botId: string): string {
  const f = memoryFocus(botId);
  return f ? `\nThe user's own guidance on what to remember for this teammate (it guides the choice; the Skip rules above still apply): "${f.replace(/"/g, "'")}"\n` : "";
}
