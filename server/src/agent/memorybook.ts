import { emit } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { Memory, MemoryStatus } from "../shared.js";
import { audit, clip, memories, now, rows, settings, type BotRecord, type UserRecord } from "../store.js";
import { rankNotes, RECALL_POOL } from "./recall.js";
import { explicitForget, looksSecret, sensitiveCategory } from "./sensitive.js";

/**
 * The life of a memory note after it is written (audits mem0 and claude-mem, « Gestion »):
 *  - every change is kept in its history: the text before and after an edit, a status change, a deletion, a restore, a
 *    note the bot set aside on the user's request (`memory_history`);
 *  - « Oublier » in the app puts the note in a bin for TRASH_DAYS days (`memory_trash`, the whole row): « Annuler » brings
 *    the SAME note back — same id, dates, excerpt, confidence, source and category — instead of a new one;
 *  - memory_forget: the bot sets notes aside (archived, never deleted) only when the user asked, in their own words typed
 *    in this conversation, in a turn of their own. The owner sees it: a line in the chat and in the activity log, and the
 *    note stays in Settings → Memory (« Archivées ») where they can bring it back.
 * Both tables go with their bot (ON DELETE CASCADE). Tables are created here, at load (the house pattern).
 */
q.run(`CREATE TABLE IF NOT EXISTS memory_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT, memory_id TEXT NOT NULL, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  at INTEGER NOT NULL, action TEXT NOT NULL, before TEXT, after TEXT, by TEXT NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS memory_history_note ON memory_history (memory_id, id)");
q.run(`CREATE TABLE IF NOT EXISTS memory_trash (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, row TEXT NOT NULL, deleted_at INTEGER NOT NULL)`);

/** Days a deleted note can still be brought back. */
export const TRASH_DAYS = 30;
/** memory_forget: notes set aside at most per call, and how close to the user's words a note must be (0–1). */
export const FORGET_MAX = 3;
export const FORGET_MIN_RELEVANCE = 0.5;
/** Longest note text. */
export const NOTE_CHARS = 500;

export type HistoryAction = "edited" | "status" | "confidence" | "deleted" | "restored" | "forgotten";
export interface HistoryEntry { at: number; action: HistoryAction; before: string | null; after: string | null; by: "owner" | "bot" }

export function noteHistory(memoryId: string, botId: string, action: HistoryAction, before: string | null, after: string | null, by: HistoryEntry["by"]) {
  q.run("INSERT INTO memory_history (memory_id, bot_id, at, action, before, after, by) VALUES (?, ?, ?, ?, ?, ?, ?)", memoryId, botId, now(), action, before, after, by);
}

/** The history of a note of the user's (kept or in the bin), oldest first; null when it is not theirs. */
export function historyOf(userId: string, memoryId: string): HistoryEntry[] | null {
  const mine = memories.owned(userId, memoryId) || q.get("SELECT 1 FROM memory_trash t JOIN bots b ON b.id = t.bot_id WHERE t.id = ? AND b.user_id = ?", memoryId, userId);
  if (!mine) return null;
  return q.all<any>("SELECT at, action, before, after, by FROM memory_history WHERE memory_id = ? ORDER BY id", memoryId)
    .map((r) => ({ at: r.at, action: r.action, before: r.before ?? null, after: r.after ?? null, by: r.by === "bot" ? "bot" : "owner" }));
}

export class NoteError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** The owner changes a note: its text (kept in the history), its status, its confidence. */
export function changeNote(user: UserRecord, memoryId: string, change: { text?: unknown; status?: unknown; confidence?: unknown }): Memory {
  const m = memories.owned(user.id, memoryId);
  if (!m) throw new NoteError(404, "That memory does not exist.");
  if (change.text === undefined && change.status === undefined && change.confidence === undefined) throw new NoteError(400, "Unknown status.");
  if (change.status !== undefined && !["active", "archived", "contested"].includes(String(change.status))) throw new NoteError(400, "Unknown status.");
  if (change.text !== undefined) {
    const text = clip(String(change.text ?? "").replace(/\s+/g, " ").trim(), NOTE_CHARS);
    if (!text) throw new NoteError(400, "Write what to remember.");
    // Secrets never go in memory, even typed by the owner: they belong in the vault (sensitive.ts).
    if (looksSecret(text)) throw new NoteError(400, "This looks like a secret (a password, a key or a card number): it is never kept in memory. Secrets go in the vault.");
    if (text !== m.text) {
      // The owner typed it: a sensitive topic is kept, with its category, so the recall still follows Settings → Memory.
      q.run("UPDATE memories SET text = ?, category = ? WHERE id = ?", text, sensitiveCategory(text), m.id);
      noteHistory(m.id, m.botId, "edited", m.text, text, "owner");
    }
  }
  // The user confirms a note themselves (or takes the confirmation back).
  if ((change.confidence === "confirmed" || change.confidence === "once") && change.confidence !== m.confidence) {
    memories.setConfidence(m.id, change.confidence);
    noteHistory(m.id, m.botId, "confidence", m.confidence, change.confidence, "owner");
  }
  if (change.status !== undefined && change.status !== m.status) {
    memories.setStatus(m.id, change.status as MemoryStatus);
    noteHistory(m.id, m.botId, "status", m.status, String(change.status), "owner");
  }
  emit(user.id, { type: "memories", botId: m.botId });
  return memories.owned(user.id, m.id)!;
}

/** « Oublier »: the note leaves the bot's memory at once, and waits TRASH_DAYS days in the bin, whole. */
export function trashNote(userId: string, memoryId: string): boolean {
  purgeTrash();
  const row = q.get<Record<string, unknown>>("SELECT m.* FROM memories m JOIN bots b ON b.id = m.bot_id WHERE m.id = ? AND b.user_id = ?", memoryId, userId);
  if (!row) return false;
  q.tx(() => {
    q.run("INSERT OR REPLACE INTO memory_trash (id, bot_id, row, deleted_at) VALUES (?, ?, ?, ?)", memoryId, String(row.bot_id), JSON.stringify(row), now());
    memories.removeOwned(userId, memoryId);
    noteHistory(memoryId, String(row.bot_id), "deleted", String(row.text), null, "owner");
  });
  emit(userId, { type: "memories", botId: String(row.bot_id) });
  return true;
}

/** « Annuler »: the very note comes back, as it was (same id and dates). */
export function restoreNote(userId: string, memoryId: string): Memory {
  const t = q.get<{ row: string; bot_id: string }>("SELECT t.row, t.bot_id FROM memory_trash t JOIN bots b ON b.id = t.bot_id WHERE t.id = ? AND b.user_id = ?", memoryId, userId);
  if (!t) throw new NoteError(404, "That memory can no longer be brought back.");
  if (q.get("SELECT 1 FROM memories WHERE id = ?", memoryId)) throw new NoteError(409, "That memory is already back.");
  const saved = JSON.parse(t.row) as Record<string, string | number | null>;
  // Only the columns the table has now (an older row may lack a newer column: it takes its default).
  const columns = q.all<{ name: string }>("PRAGMA table_info(memories)").map((c) => c.name).filter((c) => c in saved);
  q.tx(() => {
    q.run(`INSERT INTO memories (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`, ...columns.map((c) => saved[c] ?? null));
    q.run("DELETE FROM memory_trash WHERE id = ?", memoryId);
    noteHistory(memoryId, t.bot_id, "restored", null, String(saved.text ?? ""), "owner");
  });
  emit(userId, { type: "memories", botId: t.bot_id });
  return memories.owned(userId, memoryId)!;
}

/** Notes in the bin for more than TRASH_DAYS days are gone for good, with their history. */
export function purgeTrash(at = now()) {
  const old = q.all<{ id: string }>("SELECT id FROM memory_trash WHERE deleted_at < ?", at - TRASH_DAYS * 86400_000);
  for (const { id } of old) { q.run("DELETE FROM memory_trash WHERE id = ?", id); q.run("DELETE FROM memory_history WHERE memory_id = ?", id); }
}

/**
 * memory_forget. Never on the bot's own initiative: only in a turn the user started (not a routine's, a webhook's, a
 * teammate's, a member's or a program's) and only when the user's last message, typed in this conversation, asks to
 * forget. The closest notes to the words given (at most FORGET_MAX, FORGET_MIN_RELEVANCE at least) are archived, never
 * deleted. What the bot is told back follows the same rules as its prompt: a note on a sensitive topic the owner has not
 * allowed, or that looks like a secret, is not shown to it.
 */
export function forgetNotes(bot: BotRecord, user: UserRecord, query: string, ctx: { origin?: string; thread?: number }): { content: string; isError?: boolean; summary?: string } {
  if (ctx.origin !== "user") return { content: "Only the user can ask you to forget a note, in their own message to you. Nothing was changed.", isError: true, summary: "not asked" };
  if (!explicitForget(bot, ctx.thread ?? 0)) return { content: "The user's last message does not ask you to forget anything: never forget notes on your own. Nothing was changed.", isError: true, summary: "not asked" };
  const found = rankNotes(memories.usable(bot.id, RECALL_POOL), clip(query, 2000), { minRelevance: FORGET_MIN_RELEVANCE, limit: FORGET_MAX });
  if (!found.length) return { content: "No note matches these words: nothing was forgotten. Try memory_search with other words.", summary: "0" };
  const prefs = settings.memory(user.id);
  const shown: string[] = [];
  for (const { note } of found) {
    memories.setStatus(note.id, "archived");
    noteHistory(note.id, bot.id, "forgotten", note.status, "archived", "bot");
    audit(user.id, "system", `Note set aside by ${bot.name} at the user's request: "${clip(note.text, 80)}"`, bot.id);
    const category = note.category ?? sensitiveCategory(note.text);
    shown.push(looksSecret(note.text) || (category && !prefs.allowSensitive[category]) ? "(a note on a sensitive topic)" : note.text);
  }
  // The owner sees it in the chat (without the notes' words: a shared bot's chat may be read by others), and can undo it.
  rows.append(bot, { kind: "notice", tone: "info", text: tr(user.locale, found.length === 1 ? "1 note set aside at your request. It stays in Settings → Memory (Archived), where you can bring it back." : "{n} notes set aside at your request. They stay in Settings → Memory (Archived), where you can bring them back.", { n: String(found.length) }) }, ctx.thread ?? 0);
  emit(user.id, { type: "memories", botId: bot.id });
  return { content: `Set aside (archived; the user can bring them back in Settings → Memory):\n${shown.map((t) => `- ${t}`).join("\n")}`, summary: `${found.length} forgotten` };
}
