import { q } from "../db.js"; import { languageName } from "../clientshared/locales.js";
import type { Memory } from "../shared.js";
import { bots, clip, memories, now, paused, rows, users, type BotRecord } from "../store.js";
import { ask } from "./memory.js";
import { isExpired, isPinned, noteState, today, type MemoryUndo } from "./memorymarks.js";
import { memoryVerdict } from "./sensitive.js";
import { offerUndo } from "./undoable.js";
import { lt } from "./looptext.js";

/**
 * The daily memory tidy (audit DS-Bot #84, #77; À faire n° 7). At most once a day, for a bot whose notes changed since
 * its last tidy, a model reads the notes the BOT made (learned or saved by it: never imported ones, never ones the owner
 * edited, never pinned ones) and merges repeats, settles contradictions and sets aside what is over. Notes past their
 * last day are set aside without a model. Nothing is deleted (set aside = archived), one pass changes at most a fifth of
 * the notes, and the whole pass is ONE « Annuler » in the chat (undoable.ts kind "memory": all of it comes back, or
 * nothing when a note changed again). A change that touches a sensitive note is not applied: a card asks the owner.
 *
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/memory-tidy.js (installTidy: ENTRIES_MIN, SHARE_MAX, the budget, the merge / retire application, the
 * undo batch) and the tidySystem / tidyRequest prompts of ds-bot/src/host/memory-copy.js, Copyright 2026 Fei2411 and the
 * DS Bot contributors, Apache License 2.0; modified for Sklubot: TypeScript, Sklubot's notes in SQLite instead of
 * MEMORY.md files (no "move" / "about" topics), only the bot's own notes, a card for sensitive ones, Sklubot's undo line.
 */
q.run("CREATE TABLE IF NOT EXISTS memory_tidy (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, day TEXT NOT NULL, at INTEGER NOT NULL)");

/** Below this many open notes a tidy is not worth a model call. */
export const ENTRIES_MIN = 8;
export const SHARE_MAX = 5;

export const tidySystem = (who: string, max: number) => [
  `You tidy the long-term memory of ${who}, an AI teammate working for the user. Each note is one fact. Most notes should stay exactly as they are.`,
  'Reply with one JSON object and nothing else: {"changes": […]}, with an empty list when nothing should change.',
  `All changes together may touch at most ${max} notes. Work in this order:`,
  "1. Contradictions: when two notes disagree and one is clearly newer, retire the older. When you cannot tell, leave both.",
  "2. Repeats: merge notes that say the same thing, keeping every detail in one short note.",
  "3. Stale status: retire a status, a figure, or a plan that the notes themselves show is over.",
  "Never retire a preference, a decision, or a correction from the user because it is old.",
  "Each change is one of",
  '  {"op": "merge", "entries": [2, 7], "text": "…"}',
  '  {"op": "retire", "entry": 3, "why": "…"}',
].join("\n");
export const tidyRequest = (notes: Memory[], language: string) => [
  "The notes:",
  ...notes.map((m, i) => `[${i + 1}] (${new Date(m.createdAt).toISOString().slice(0, 10)}) ${m.text}`),
  "",
  `Write every merged note in ${language}.`,
].join("\n");

export function parseTidy(text: string): { op?: unknown; entries?: unknown; entry?: unknown; text?: unknown }[] | null {
  const start = text.indexOf("{"), end = text.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try { const v = JSON.parse(text.slice(start, end + 1)); return Array.isArray(v?.changes) ? v.changes : null; } catch { return null; }
}

/** The notes a tidy may touch: the bot's own, not pinned, not imported, never reworded by the owner (an end date they set is fine). */
export function tidyable(botId: string): Memory[] {
  const ownerEdited = new Set(q.all<{ memory_id: string }>("SELECT DISTINCT memory_id FROM memory_history WHERE bot_id = ? AND by = 'owner' AND action = 'edited' AND NOT (COALESCE(after, '') LIKE 'until %' OR after = 'no end date')", botId).map((r) => r.memory_id));
  return memories.list(botId, 5000).reverse().filter((m) => m.status !== "archived" && !isPinned(m) && m.source !== "import" && !ownerEdited.has(m.id));
}

/** Due: not tidied today, and a note was written since the last tidy. */
export function tidyDue(botId: string, day = today()): boolean {
  const last = q.get<{ day: string; at: number }>("SELECT day, at FROM memory_tidy WHERE bot_id = ?", botId);
  if (last?.day === day) return false;
  const newest = q.get<{ at: number | null }>("SELECT MAX(created_at) AS at FROM memories WHERE bot_id = ?", botId)?.at ?? 0;
  return !!newest && newest > (last?.at ?? 0);
}

export interface TidyResult { merged: number; retired: number; asked: number; undoId: string | null }

/** One tidy of one bot's memory. `force`: even if already done today (the tests and « Ranger maintenant »). */
export async function tidyMemory(bot: BotRecord, force = false): Promise<TidyResult> {
  const day = today();
  const none: TidyResult = { merged: 0, retired: 0, asked: 0, undoId: null };
  if (!force && !tidyDue(bot.id, day)) return none;
  const offered = tidyable(bot.id);
  const ended = offered.filter((m) => isExpired(m, day));
  const open = offered.filter((m) => !isExpired(m, day));
  let changes: NonNullable<ReturnType<typeof parseTidy>> = [];
  if (open.length >= ENTRIES_MIN) {
    const max = Math.max(1, Math.floor(offered.length / SHARE_MAX));
    const reply = await ask(bot, tidySystem(`one bot, ${bot.name}`, max), tidyRequest(open, languageName(users.localeOf(bot.userId))));
    changes = parseTidy(reply) ?? [];
  }
  // Applied against the notes as they are NOW: a note that changed while the model was answering is left alone.
  const undo: MemoryUndo = { notes: [] };
  const used = new Set<string>();
  const counts = { merged: 0, retired: 0, asked: 0 };
  let budget = Math.max(1, Math.floor(offered.length / SHARE_MAX));
  const unchanged = (m: Memory | undefined) => { const cur = m ? noteState(m.id) : null; return m && cur && cur.text === m.text && cur.status === m.status ? m : undefined; };
  const set = (m: Memory, f: { text?: string; status?: "archived" }) => {
    const before = noteState(m.id)!;
    if (f.text !== undefined) q.run("UPDATE memories SET text = ? WHERE id = ?", f.text, m.id);
    if (f.status) q.run("UPDATE memories SET status = ? WHERE id = ?", f.status, m.id);
    undo.notes.push({ id: m.id, before, after: noteState(m.id)! });
    used.add(m.id);
  };
  for (const m of ended) if (unchanged(m) && !m.category) { set(m, { status: "archived" }); counts.retired++; }
  const pick = (at: unknown) => unchanged(open[Number(at) - 1]);
  for (const c of changes) {
    const op = String(c?.op ?? "");
    if (op === "merge") {
      const list = [...new Set((Array.isArray(c.entries) ? c.entries : []).map(pick))];
      const text = clip(String(c.text ?? "").replace(/\s+/g, " ").trim(), 500);
      if (list.length < 2 || list.some((m) => !m || used.has(m.id)) || list.length > budget || !text) continue;
      const notes = list as Memory[];
      if (!notes.some((m) => m.category) && !memoryVerdict(bot.userId, text, false).ok) continue; // a merge never brings a secret in
      budget -= notes.length;
      if (notes.some((m) => m.category)) { askOwner(bot, notes[0], text); notes.forEach((m) => used.add(m.id)); counts.asked++; continue; }
      const [first, ...rest] = notes;
      set(first, { text });
      for (const m of rest) set(m, { status: "archived" });
      counts.merged += notes.length;
    } else if (op === "retire") {
      const m = pick(c.entry);
      if (!m || used.has(m.id) || budget < 1) continue;
      budget--;
      if (m.category) { used.add(m.id); counts.asked++; continue; } // a sensitive note is never set aside by the tidy
      set(m, { status: "archived" });
      counts.retired++;
    }
  }
  q.run("INSERT INTO memory_tidy (bot_id, day, at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET day = excluded.day, at = excluded.at", bot.id, day, now());
  if (!undo.notes.length && !counts.asked) return { ...counts, undoId: null };
  const loc = users.localeOf(bot.userId);
  const text = [undo.notes.length ? lt(loc, "I tidied my memory: {merged} merged, {retired} set aside.", { merged: counts.merged, retired: counts.retired }) : "", counts.asked ? lt(loc, "{n} change(s) touch a sensitive note: I ask you first.", { n: counts.asked }) : ""].filter(Boolean).join(" ");
  const undoId = undo.notes.length ? offerUndo(bot, { kind: "memory", ref: bot.id, before: undo, text }) : null;
  if (!undoId) rows.append(bot, { kind: "notice", tone: "info", text }, 0);
  return { ...counts, undoId };
}

/** A merge that touches a sensitive note: the owner decides on the "which is right?" card (nothing changed meanwhile). */
function askOwner(bot: BotRecord, m: Memory, text: string) {
  rows.append(bot, { kind: "card", card: { type: "memory", memoryId: m.id, oldText: m.text, newText: text, quote: "", status: "pending" } }, 0);
  bots.bumpUnread(bot.id);
}

/** The sweep (from memory.ts consolidationSweep, every minute): one due bot per call, never one that is busy or paused. */
let running = false;
export async function tidySweep(skip: (b: BotRecord) => boolean = () => false): Promise<void> {
  if (running || process.env.MEMORY_TIDY === "0") return;
  running = true;
  try {
    const due = q.all<{ id: string }>("SELECT id FROM bots WHERE kind = 'agent' AND hidden = 0").map((r) => bots.byId(r.id)).find((b) => !!b && !paused.get(b.id) && !skip(b) && tidyDue(b.id));
    if (due) await tidyMemory(due).catch((err) => console.error("[memory tidy]", (err as Error)?.message ?? err));
  } finally { running = false; }
}
