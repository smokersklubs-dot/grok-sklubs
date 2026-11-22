import { setLive } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { Block, TextBlock } from "../llm/index.js";
import type { Attachment } from "../shared.js";
import { bots, clip, rows, users, type BotRecord } from "../store.js";
import { LaneMap } from "./lanemap.js";
import { hostsIn, linkHint } from "./links.js";
import { noteLinksGiven } from "./linknudge.js";
import type { Turn } from "./loop.js";

/**
 * Notes typed while the bot works (« steering »): folded into the running turn at its next step (moved out of loop.ts).
 *
 * L94 — a note is written to disk (steer_notes) the moment it is sent and deleted once the turn has taken it in. A note
 * a restart caught before any turn read it is not lost: the chat shows it with « Reprendre ma note », which sends it
 * again as a new message (idea from Craft Anything's durable inbox; our own code).
 * L64 — a link typed in a note gets the same "open it on your screen" hint as a first message, and its site joins the
 * sites the turn may open (Turn.hosts) and the "link given but never opened" safety net (linknudge.ts).
 */
q.run("CREATE TABLE IF NOT EXISTS steer_notes (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, text TEXT NOT NULL, attachments TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'waiting', created_at INTEGER NOT NULL)");

interface Note { id: number | null; text: string; prepare: () => Promise<Block[]> }
const steering = new LaneMap<Note[]>();

/** Keeps a note for the turn running in `lane` ("bot~thread"); returns how many notes now wait for it. */
export function steer(bot: BotRecord, lane: string, thread: number, words: string, attachments: Attachment[], prepare: () => Promise<Block[]>): number {
  let id: number | null = null;
  try { id = Number(q.run("INSERT INTO steer_notes (bot_id, thread, text, attachments, created_at) VALUES (?, ?, ?, ?, ?)", bot.id, thread, words, JSON.stringify(attachments), Date.now()).lastInsertRowid); } catch { /* a bot that is not in the database: memory only */ }
  const list = steering.get(lane) ?? [];
  list.push({ id, text: words, prepare });
  steering.set(lane, list);
  setLive(bot.userId, bot.id, { queued: list.length });
  return list.length;
}

/**
 * The notes waiting for the current turn of this bot (its own lane), as blocks for the model. With `turn`: links typed in
 * them get the link hint and join the turn's sites (L64).
 */
export async function drainSteering(bot: BotRecord, turn?: Pick<Turn, "hosts" | "builtin">): Promise<Block[]> {
  const list = steering.get(bot.id) ?? [];
  if (!list.length) return [];
  steering.delete(bot.id);
  setLive(bot.userId, bot.id, { queued: 0 });
  const blocks: Block[] = [];
  for (const note of list) {
    blocks.push(...await note.prepare());
    if (turn) {
      for (const h of hostsIn(note.text)) turn.hosts.add(h);
      noteLinksGiven(turn, note.text);
      const hint = linkHint(note.text, turn.builtin.has("browser_open"), turn.builtin.has("video_frames"));
      if (hint) blocks.push({ type: "text", text: hint } satisfies TextBlock);
    }
  }
  forget(list);
  return blocks;
}

/** "Tout arrêter" (stopcommand.ts): the notes waiting in every lane of this bot are dropped. Returns how many. */
export function discardSteering(botId: string): number {
  let n = 0;
  for (const [lane, , list] of steering.lanesOf(botId)) { n += list.length; forget(list); steering.delete(lane); }
  const bot = bots.byId(botId);
  if (n && bot) setLive(bot.userId, bot.id, { queued: 0 });
  return n;
}

const forget = (list: Note[]) => { for (const n of list) if (n.id !== null) q.run("DELETE FROM steer_notes WHERE id = ?", n.id); };

/** After a restart: every note no turn read is shown in its chat with « Reprendre ma note » (never resent by itself). */
export function recoverNotes(): number {
  const left = q.all<{ id: number; bot_id: string; thread: number; text: string }>("SELECT id, bot_id, thread, text FROM steer_notes WHERE status = 'waiting' ORDER BY id");
  for (const n of left) {
    const bot = bots.byId(n.bot_id);
    if (!bot) { q.run("DELETE FROM steer_notes WHERE id = ?", n.id); continue; }
    q.run("UPDATE steer_notes SET status = 'offered' WHERE id = ?", n.id);
    const loc = users.localeOf(bot.userId);
    rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "The server restarted before I read your note: “{note}”. It is kept — press « Resume my note » to send it again.", { note: clip(n.text.replace(/\s+/g, " ").trim(), 160) }), action: { kind: "note", noteId: n.id, status: "pending" } }, n.thread || undefined);
  }
  return left.length;
}

/** « Reprendre ma note »: the kept note, once (its text, attachments and thread); null when it is gone or not this bot's. */
export function takeNote(botId: string, noteId: number): { text: string; attachments: Attachment[]; thread: number } | null {
  const r = q.get<{ text: string; attachments: string; thread: number }>("SELECT text, attachments, thread FROM steer_notes WHERE id = ? AND bot_id = ? AND status = 'offered'", noteId, botId);
  if (!r) return null;
  q.run("DELETE FROM steer_notes WHERE id = ?", noteId);
  let attachments: Attachment[] = [];
  try { attachments = JSON.parse(r.attachments) as Attachment[]; } catch { /* none */ }
  return { text: r.text, attachments, thread: r.thread };
}
