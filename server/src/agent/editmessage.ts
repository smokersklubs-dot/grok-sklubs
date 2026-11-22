import { q } from "../db.js";
import type { Row } from "../shared.js";
import { clip, rows, type BotRecord } from "../store.js";

/**
 * L136 (rest) — edit a sent message, regenerate a reply, branch the conversation from a message (backlog A-FAIRE L136;
 * behaviour from the Hermes, nod, OMB, Timon T18-T20, Rakazo and Nightly audits, our own code).
 *
 * The bot's memory of a conversation (history) is append-only and replays as it was written; the chat rows are its
 * visible record. None of these actions rewrites the past:
 * - Edit: the old message stays, marked "edited" with a link to its new version (editedTo); the new version is a new row
 *   (editOf) and reaches the bot as a new message that says which earlier words it replaces.
 * - Regenerate: the latest reply of the conversation stays; the bot is asked, in a new turn, for a different version,
 *   which appears below it.
 * - Branch: a message of the main chat opens a thread on it whose first turn is told the conversation up to that message
 *   (branch_contexts, read by threadOpening in loop.ts). The main chat goes on untouched.
 * Each needs the conversation's lane to be idle (nothing running there), so a turn never sees its history move under it.
 */
q.run("CREATE TABLE IF NOT EXISTS branch_contexts (bot_id TEXT NOT NULL, generation INTEGER NOT NULL, thread INTEGER NOT NULL, context TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (bot_id, generation, thread))");

export class EditError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

const ownMessage = (r: Row | null) => !!r && r.body.kind === "message" && r.body.role === "user" && !r.body.origin && !r.body.streaming && r.body.text.trim().length > 0;

/** The text the bot gets for an edited message. */
export const editedText = (old: string, next: string) => `[The user edited one of their earlier messages. It said:\n«${clip(old, 2000)}»\nIt now says the text below. Answer the new version; what you said about the old one may no longer apply.]\n${next}`;

/** Edit: checks, writes the new row, marks the old one; returns the new row and the thread (the caller submits the turn). */
export function editMessage(bot: BotRecord, seq: number, text: string, busy: (thread: number) => boolean): { row: Row; thread: number; old: string } {
  const old = rows.get(bot.id, bot.generation, seq);
  if (!old || !ownMessage(old) || old.body.kind !== "message") throw new EditError(400, "Only a message you wrote can be edited.");
  if (old.body.editedTo) throw new EditError(409, "This message was already edited: edit its newest version.");
  const next = text.trim();
  if (!next) throw new EditError(400, "Write the new text.");
  if (next.length > 100_000) throw new EditError(400, "That message is too long.");
  if (next === old.body.text.trim()) throw new EditError(400, "The text did not change.");
  const thread = old.thread ?? 0;
  if (busy(thread)) throw new EditError(409, "The bot is working in this conversation: wait for it to finish, or stop it, then edit.");
  const row = rows.append(bot, { kind: "message", role: "user", text: next, editOf: seq }, thread || undefined);
  rows.rewrite(bot, bot.generation, seq, { ...old.body, editedTo: row.seq });
  return { row, thread, old: old.body.text };
}

/** The text of the follow-up that asks for another version of the last reply. */
export const REGENERATE_TEXT = "[The user asked for another answer: write a new, different version of your last reply (the old one stays visible above it). Keep what was right, improve the rest; do not repeat it word for word. Do not redo actions you already did — only the reply changes.]";

/** Regenerate: only the latest reply of its conversation, while it is idle. Returns its thread. */
export function checkRegenerate(bot: BotRecord, seq: number, busy: (thread: number) => boolean): number {
  const r = rows.get(bot.id, bot.generation, seq);
  if (!r || r.body.kind !== "message" || r.body.role !== "assistant" || r.body.origin || r.body.streaming) throw new EditError(400, "Only a reply of the bot can be written again.");
  const thread = r.thread ?? 0;
  const later = rows.recentMessages(bot.id, bot.generation, 5, thread).filter((m) => m.seq > seq && m.body.kind === "message");
  if (later.length) throw new EditError(409, "Only the latest reply can be written again.");
  if (busy(thread)) throw new EditError(409, "The bot is working in this conversation: wait for it to finish first.");
  return thread;
}

/** Branch: the conversation up to this message of the main chat, kept for the thread's first turn. Returns the thread. */
export function branchAt(bot: BotRecord, seq: number): number {
  const r = rows.get(bot.id, bot.generation, seq);
  if (!r || r.body.kind !== "message" || (r.thread ?? 0) !== 0) throw new EditError(400, "Only a message of the main chat can start a branch.");
  const before = rows.list(bot.id, bot.generation, 40, seq + 1, 0).filter((m) => m.body.kind === "message" && !m.body.streaming);
  const lines = before.map((m) => (m.body.kind === "message" ? `${m.body.role === "user" ? "User" : bot.name}: ${clip(m.body.text.replace(/\s+/g, " "), 800)}` : ""));
  q.run("INSERT INTO branch_contexts (bot_id, generation, thread, context, created_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(bot_id, generation, thread) DO NOTHING", bot.id, bot.generation, seq, clip(lines.join("\n"), 12_000), Date.now());
  return seq;
}

/** For threadOpening (loop.ts): the branch's earlier conversation, or "". */
export function branchContext(bot: BotRecord, thread: number): string {
  const c = q.get<{ context: string }>("SELECT context FROM branch_contexts WHERE bot_id = ? AND generation = ? AND thread = ?", bot.id, bot.generation, thread)?.context;
  return c ? `[This thread is a branch of your main chat: the user wants to try another direction from the message below. The conversation up to that message was:]\n${c}\n` : "";
}
