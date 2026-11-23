import { defaultModelRef } from "../llm/index.js";
import { bots, history, laneKey, paused, rows, users, type BotRecord } from "../store.js";
import { getLive } from "../bus.js";
import { q } from "../db.js";
import { betweenTurnsChars } from "./compactlines.js";

/**
 * L80, the rest of « Résumés de conversation » (Sklubot's own code):
 *  - a conversation longer than 200,000 characters is summarised in parts (each part into notes, then the notes into the
 *    sectioned summary), instead of having its start cut off; past LONG_PARTS parts (about 1.2 million characters) the
 *    very oldest part is still left out, and the summary says so;
 *  - `/compact <consigne>`: the owner summarises now, with their own words on what to keep in detail;
 *  - threads are summarised too, and « résumé à chaud »: while the owner is away (REST_MIN quiet minutes), a
 *    conversation already past REST_SHARE of its limit is summarised in the background, so the next message does not wait
 *    for it. Never while the bot works, waits or is held (the same holds as the learning pass).
 */
export const PART_CHARS = 150_000;
export const LONG_CHARS = 200_000;
export const LONG_PARTS = 8;
export const REST_MIN = 15;
export const REST_SHARE = 0.7;

export type Ask = (system: string, prompt: string) => Promise<string>;

/** The source split into parts of PART_CHARS (cut at a line end when one is near), at most LONG_PARTS, newest kept. */
export function splitSource(source: string): { parts: string[]; cut: boolean } {
  const parts: string[] = [];
  let rest = source;
  while (rest.length > PART_CHARS) {
    let at = rest.lastIndexOf("\n", PART_CHARS);
    if (at < PART_CHARS * 0.8) at = PART_CHARS;
    parts.push(rest.slice(0, at));
    rest = rest.slice(at);
  }
  if (rest) parts.push(rest);
  return parts.length > LONG_PARTS ? { parts: parts.slice(-LONG_PARTS), cut: true } : { parts, cut: false };
}

const guidance = (instruction?: string) => instruction?.trim()
  ? `\nThe user asked for this summary with these words (follow them for what to keep in detail; the sections and the rules stay): "${instruction.trim().replace(/"/g, "'").slice(0, 500)}"\n`
  : "";

/**
 * The summary text for `source` (the rendered conversation), checked by `problems`: asked once again with what was
 * wrong; throws when it still fails (nothing is replaced then).
 */
export async function writeSummary(ask: Ask, system: string, prompt: string, source: string, problems: (summary: string, sourceChars: number) => string[], instruction?: string): Promise<string> {
  let body = source;
  if (source.length > LONG_CHARS) {
    const { parts, cut } = splitSource(source);
    const notes: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const n = await ask(system, `${prompt}${guidance(instruction)}\n\nThis is part ${i + 1} of ${parts.length} of the conversation, oldest first. Notes on this part only.\n\nConversation (part ${i + 1}):\n${parts[i]}`);
      if (n.trim()) notes.push(`# Part ${i + 1}\n${n.trim()}`);
    }
    if (!notes.length) throw new Error("The summary of the long conversation came back empty; the conversation was kept whole.");
    body = `${cut ? "[The very oldest part of the conversation was too long to read and is left out.]\n" : ""}Notes already written on each part of the conversation, oldest first — merge them:\n\n${notes.join("\n\n")}`;
  }
  const full = (extra = "") => `${prompt}${guidance(instruction)}${extra}\n\nConversation:\n${body}`;
  let summary = await ask(system, full());
  let wrong = summary ? problems(summary, source.length) : ["empty"];
  if (wrong.length) {
    summary = await ask(system, full(`\n\nYour previous notes were refused (${wrong.join("; ")}). Write them again.`));
    wrong = summary ? problems(summary, source.length) : ["empty"];
    if (wrong.length) throw new Error(`The summary failed its check (${wrong.join("; ")}); the conversation was kept whole.`);
  }
  return summary;
}

/** "/compact" or "/résumer", with optional words after it; null for any other message. */
export function compactCommand(text: string): { instruction: string } | null {
  const m = /^\/(?:compact|compacter|r[ée]sumer|summari[sz]e)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? { instruction: (m[1] ?? "").trim() } : null;
}

export const compactDoneText = (fr: boolean, r: { changed: boolean; before: number; after: number }, error?: string) => error
  ? (fr ? `Je n'ai pas pu résumer la conversation : ${error}` : `I could not summarise the conversation: ${error}`)
  : r.changed ? "" : (fr ? "Rien à résumer pour l'instant : la conversation est encore courte." : "Nothing to summarise yet: the conversation is still short.");

// ── Résumé à chaud pendant le repos ──────────────────────────────────────────────────────────────────────────────
/** Conversations (bot, thread) past REST_SHARE of their limit whose last message is older than REST_MIN minutes. */
export function restDue(nowMs = Date.now(), share = REST_SHARE, quietMin = REST_MIN): { bot: BotRecord; thread: number }[] {
  const out: { bot: BotRecord; thread: number }[] = [];
  const cands = q.all<{ bot_id: string; thread: number; chars: number }>(
    "SELECT h.bot_id, h.thread, SUM(LENGTH(h.content)) AS chars FROM history h JOIN bots b ON b.id = h.bot_id AND b.generation = h.generation WHERE b.kind = 'agent' AND b.hidden = 0 GROUP BY h.bot_id, h.thread HAVING chars > 20000");
  for (const c of cands) {
    const bot = bots.byId(c.bot_id);
    if (!bot) continue;
    const line = betweenTurnsChars(bot.userId, bot.model || defaultModelRef());
    if (c.chars < line * share) continue;
    const last = q.get<{ at: number }>("SELECT MAX(created_at) AS at FROM rows WHERE bot_id = ? AND generation = ?", bot.id, bot.generation)?.at ?? 0;
    if (last > nowMs - quietMin * 60_000) continue;
    if (paused.get(bot.id) || paused.get(laneKey(bot.id, c.thread)) || getLive(bot.id).running) continue;
    out.push({ bot, thread: c.thread });
  }
  return out;
}

/**
 * One background summary per sweep (from memory.ts consolidationSweep, every minute). `busy` holds the same checks as
 * the learning pass; `compact` is memory.ts compactIfNeeded, run in the conversation's own queue.
 */
export async function restSummarySweep(busy: (b: BotRecord) => boolean, compact: (b: BotRecord, thread: number) => Promise<unknown>): Promise<number> {
  for (const { bot, thread } of restDue()) {
    if (busy(bot)) continue;
    try { await compact(bot, thread); return 1; } catch (err) { console.error("[rest summary]", (err as Error)?.message ?? err); return 0; }
  }
  return 0;
}

export const historyLen = (bot: BotRecord, thread: number) => history.count(bot.id, bot.generation, thread);
export const localeFr = (bot: BotRecord) => users.localeOf(bot.userId) === "fr";
export const noticeIn = (bot: BotRecord, thread: number, text: string) => { if (text) rows.append(bot, { kind: "notice", tone: "info", text }, thread || undefined); };
