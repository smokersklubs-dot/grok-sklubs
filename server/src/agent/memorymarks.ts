import { emit } from "../bus.js";
import { q } from "../db.js";
import type { Memory, MemoryStatus } from "../shared.js";
import { clip, memories, users, type BotRecord } from "../store.js";
import { noteHistory } from "./memorybook.js";
import { lt } from "./looptext.js";
import { offerUndo, setMemoryUndo } from "./undoable.js";

/**
 * Pinned notes, end dates, and notes that change when the user changes their mind (audit DS-Bot #81, #82, F5; À faire
 * n° 5). Idea from DS-Bot's memory entries (`pinned`, `until`, ds-bot/src/host/memory-entries.js, Apache-2.0): our own
 * code on Sklubot's notes.
 *  - pinned: the automatic passes (learning, tidy) never change, merge or retire it; it is shown first in the prompt.
 *  - until (YYYY-MM-DD): the note holds through that day; after it, it leaves the prompt and memory_search
 *    (store.ts memories.usable) and the daily tidy archives it (memorytidy.ts). Nothing is deleted.
 *  - a change of mind in the user's own words ("finalement je préfère…", "from now on…") updates the note IN PLACE
 *    (same id, its history keeps the old words) with « Annuler » in the chat, instead of a second, duplicate note. A
 *    pinned or sensitive note is never changed this way: the "which is right?" card is shown as before.
 */
const DAY = /^\d{4}-\d{2}-\d{2}$/;
export const today = (at = Date.now()) => new Date(at).toISOString().slice(0, 10);
/** A real calendar day, or null. */
export function cleanDay(v: unknown): string | null {
  const s = String(v ?? "").trim();
  if (!DAY.test(s)) return null;
  const d = new Date(`${s}T00:00:00Z`);
  return Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== s ? null : s;
}
export const isExpired = (m: Pick<Memory, "until">, day = today()) => !!m.until && m.until < day;
export const isPinned = (m: Pick<Memory, "pinned">) => !!m.pinned;

/** Pin / unpin, set or clear the last day. `by`: who did it (kept in the note's history). */
export function setMarks(userId: string, m: Memory, marks: { pinned?: boolean; until?: string | null }, by: "owner" | "bot"): Memory {
  if (typeof marks.pinned === "boolean" && marks.pinned !== !!m.pinned) {
    q.run("UPDATE memories SET pinned = ? WHERE id = ?", marks.pinned ? 1 : 0, m.id);
    noteHistory(m.id, m.botId, "status", m.pinned ? "pinned" : "unpinned", marks.pinned ? "pinned" : "unpinned", by);
  }
  if (marks.until !== undefined && (marks.until ?? null) !== (m.until ?? null)) {
    q.run("UPDATE memories SET until_day = ? WHERE id = ?", marks.until, m.id);
    noteHistory(m.id, m.botId, "edited", m.until ? `until ${m.until}` : "no end date", marks.until ? `until ${marks.until}` : "no end date", by);
  }
  return memories.owned(userId, m.id) ?? m;
}

/** Words with which the user says a fact changed (accents kept: they are matched on the user's own excerpt). */
export const CHANGE_OF_MIND = /\b(?:finalement|désormais|dorénavant|à partir de maintenant|maintenant je|en fait je|plutôt que|à la place|plus jamais|je ne (?:\S+ ){0,2}plus\b|j['’]ai changé d['’]avis|changed my mind|from now on|instead|no longer|not anymore|any ?more|now i|actually i)\b/i;
export const saysChangeOfMind = (quote: string) => CHANGE_OF_MIND.test(quote);

interface NoteState { text: string; quote: string; status: MemoryStatus; category: string | null; confidence: string }
const stateOf = (id: string): NoteState | null => q.get<NoteState>("SELECT text, quote, status, category, confidence FROM memories WHERE id = ?", id) ?? null;

/**
 * The note takes the new words in place (same id, date and history: the old words stay in it). The chat gets one line
 * with « Annuler » (undoable.ts kind "memory"). Returns false when the note may not be changed automatically.
 */
export function updateInPlace(bot: BotRecord, m: Memory, text: string, quote: string, why: "changed" | "card" = "changed"): boolean {
  if (why === "changed" && (isPinned(m) || m.category)) return false;
  const before = stateOf(m.id);
  if (!before) return false;
  const t = clip(text.trim(), 500);
  q.run("UPDATE memories SET text = ?, quote = ?, status = 'active' WHERE id = ?", t, clip(quote, 500), m.id);
  memories.confirm(m.id);
  noteHistory(m.id, m.botId, "edited", m.text, t, why === "card" ? "owner" : "bot");
  const after = stateOf(m.id)!;
  if (why === "changed") offerUndo(bot, { kind: "memory", ref: m.id, before: { notes: [{ id: m.id, before, after }] }, text: lt(users.localeOf(bot.userId), "Memory updated: “{old}” is now “{text}”.", { old: clip(m.text, 120), text: clip(t, 120) }) });
  emit(bot.userId, { type: "memories", botId: bot.id });
  return true;
}

/** What one undoable memory change holds: each note as it was before and right after. */
export interface MemoryUndo { notes: { id: string; before: NoteState; after: NoteState }[] }

/**
 * « Annuler » of a memory change (one note, or a whole tidy batch): all of it comes back, or nothing — when a note changed
 * again since, it is left as it reads and false is returned.
 */
export function undoMemoryChange(bot: BotRecord, u: MemoryUndo): boolean {
  const same = (a: NoteState | null, b: NoteState) => !!a && a.text === b.text && a.status === b.status;
  if (!u.notes.length || u.notes.some((n) => !same(stateOf(n.id), n.after))) return false;
  q.tx(() => {
    for (const n of u.notes) {
      q.run("UPDATE memories SET text = ?, quote = ?, status = ?, confidence = ? WHERE id = ? AND bot_id = ?", n.before.text, n.before.quote, n.before.status, n.before.confidence, n.id, bot.id);
      noteHistory(n.id, bot.id, "restored", n.after.text, n.before.text, "owner");
    }
  });
  emit(bot.userId, { type: "memories", botId: bot.id });
  return true;
}
export const noteState = stateOf;
setMemoryUndo(undoMemoryChange);
