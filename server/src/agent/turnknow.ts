import { createHash } from "node:crypto";
import { db, q } from "../db.js";
import { bots, clip, redactSecrets } from "../store.js";

/**
 * L137, the rest (Sklubot's own code, idea from the Timon clean-room notes T49, docs/cleanroom/10-timon.md):
 *  - « Ce que le bot savait quand il a décidé »: each time a turn's instructions are built (prompt.ts buildSystemPrompt,
 *    never for the read-only preview), a light snapshot is kept: the parts of the instructions in order with their size,
 *    and the notes it was shown (« What you remember »). A snapshot identical to the previous one of the bot is not
 *    written again; the last KEEP_PER_BOT per bot are kept. Known vault values are removed first (store.ts redactSecrets).
 *  - « Pourquoi ? » on a line of the detailed journal: what allowed the action (the user's words, the reviewer, a card…),
 *    the user's own last message before it, and what the bot knew at that moment (the snapshot in force). Built from what
 *    is recorded only: no model is asked, nothing is invented. Account isolation: only the asking user's own lines.
 */
export const KEEP_PER_BOT = 200;
const NOTES_HEADING = "## What you remember";

db.exec(`CREATE TABLE IF NOT EXISTS turn_knowledge (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, at INTEGER NOT NULL,
  hash TEXT NOT NULL, parts TEXT NOT NULL, notes TEXT NOT NULL);
  CREATE INDEX IF NOT EXISTS turn_knowledge_bot_at ON turn_knowledge (bot_id, at);`);

export interface KnowledgeSnapshot { at: number; parts: { title: string; chars: number }[]; notes: string[] }

/** The parts of the instructions ("## " headings, in order) and the note lines of « What you remember ». */
export function digestPrompt(prompt: string): { parts: { title: string; chars: number }[]; notes: string[] } {
  const blocks = prompt.split(/\n\n(?=## )/);
  const parts = blocks.map((b) => {
    const head = /^## (.+)$/m.exec(b.split("\n")[0]);
    return { title: clip(head ? head[1].trim() : "Who the bot is", 120), chars: b.length };
  });
  const mem = blocks.find((b) => b.startsWith(NOTES_HEADING));
  const notes = mem ? mem.split("\n").filter((l) => l.startsWith("- ")).map((l) => clip(l.slice(2), 400)) : [];
  return { parts, notes };
}

/** prompt.ts: the instructions of a real turn were just built. Never throws (it must not break a turn). */
export function noteKnowledge(botId: string, userId: string, prompt: string, at = Date.now()): boolean {
  try {
    const hash = createHash("sha256").update(prompt).digest("hex").slice(0, 32);
    const last = q.get<{ hash: string }>("SELECT hash FROM turn_knowledge WHERE bot_id = ? ORDER BY id DESC LIMIT 1", botId);
    if (last?.hash === hash) return false;
    const d = digestPrompt(prompt);
    q.run("INSERT INTO turn_knowledge (bot_id, at, hash, parts, notes) VALUES (?, ?, ?, ?, ?)", botId, at, hash,
      JSON.stringify(d.parts), JSON.stringify(d.notes.map((n) => redactSecrets(userId, n))));
    q.run("DELETE FROM turn_knowledge WHERE bot_id = ? AND id NOT IN (SELECT id FROM turn_knowledge WHERE bot_id = ? ORDER BY id DESC LIMIT ?)", botId, botId, KEEP_PER_BOT);
    return true;
  } catch { return false; }
}

/** The snapshot in force at `at` (the last one written before or at that moment), or null. */
export function knowledgeAt(botId: string, at: number): KnowledgeSnapshot | null {
  const r = q.get<{ at: number; parts: string; notes: string }>("SELECT at, parts, notes FROM turn_knowledge WHERE bot_id = ? AND at <= ? ORDER BY at DESC, id DESC LIMIT 1", botId, at);
  if (!r) return null;
  try { return { at: r.at, parts: JSON.parse(r.parts), notes: JSON.parse(r.notes) }; } catch { return null; }
}

export interface WhyAnswer {
  entry: { id: number; at: number; botId: string; botName: string; tool: string; label: string; decision: string; quote: string; reason: string; status: string };
  /** The user's own last message to this bot before the action (typed or spoken), if any. */
  userWords: { text: string; at: number } | null;
  knew: KnowledgeSnapshot | null;
}

/** « Pourquoi ? » for one line of the journal of `userId`; null when it is not theirs. */
export function whyEntry(userId: string, id: number): WhyAnswer | null {
  const r = q.get<any>("SELECT * FROM action_journal WHERE id = ? AND user_id = ?", id, userId);
  if (!r) return null;
  const bot = bots.byId(r.bot_id);
  const words = bot ? q.get<{ body: string; created_at: number }>(
    "SELECT body, created_at FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' AND created_at <= ? AND json_extract(body, '$.role') = 'user' AND (json_extract(body, '$.origin') IS NULL OR json_extract(body, '$.origin.kind') = 'voice') ORDER BY created_at DESC, seq DESC LIMIT 1",
    bot.id, bot.generation, r.at) : undefined;
  let userWords: WhyAnswer["userWords"] = null;
  if (words) { try { userWords = { text: clip(redactSecrets(userId, String(JSON.parse(words.body).text ?? "")), 600), at: words.created_at }; } catch { /* unreadable */ } }
  return {
    entry: { id: r.id, at: r.at, botId: r.bot_id, botName: bot?.name ?? "—", tool: r.tool, label: r.label, decision: r.decision, quote: r.quote, reason: r.reason, status: r.status },
    userWords,
    knew: knowledgeAt(r.bot_id, r.at),
  };
}
