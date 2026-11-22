import { apiProviders } from "../apimodels.js";
import { config } from "../config.js";
import type { ChatMessage } from "../llm/index.js";
import { rows, type BotRecord } from "../store.js";
import { typedByUser } from "./grounding.js";

/**
 * When a long conversation is condensed, and what of it is never condensed (audit DS-Bot #72, #74, F14; À faire n° 9).
 *  - linesFor: the check line follows the model's window (a share of it, as before: COMPACT_RATIO) AND has an absolute
 *    ceiling (COMPACT_CAP_TOKENS, 380 000 by default): past a few hundred thousand tokens the provider's prefix cache no
 *    longer helps, so a 1 M-token model (DeepSeek) no longer waits until 800 000 tokens. Between turns too: the old fixed
 *    COMPACT_CHARS stays the most, and a smaller model's line is lower.
 *  - userWordsBlock: the user's own messages from the condensed part travel next to the summary WORD FOR WORD (newest
 *    kept first within a budget, shown oldest first), so a standing instruction is never paraphrased away.
 *
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/steward.js (linesFor, DEFAULT_CHECK_TOKENS, shorten, checkpointText), Copyright 2026 Fei2411 and the
 * DS Bot contributors, Apache License 2.0; modified for Sklubot: TypeScript, Sklubot's COMPACT_RATIO and window lookup,
 * the user's words read from the visible chat (only what the user typed, never a bot's, a routine's or a page's).
 */
export const DEFAULT_WINDOW = 200_000;
export const DEFAULT_CHECK_TOKENS = 380_000;
const HARD_SHARE = 0.95;
export const checkCap = () => { const n = Number(process.env.COMPACT_CAP_TOKENS); return Number.isInteger(n) && n > 0 ? n : DEFAULT_CHECK_TOKENS; };

export function linesFor(o: { window?: number; reserve?: number; checkRatio?: number; checkTokens?: number } = {}): { window: number; usable: number; hard: number; check: number } {
  const declared = Number.isInteger(o.window) && o.window! > 0 ? o.window! : DEFAULT_WINDOW;
  const room = Number.isInteger(o.reserve) && o.reserve! > 0 ? o.reserve! : 0;
  const usable = Math.max(declared - room, Math.floor(declared / 2));
  const hard = Math.floor(usable * HARD_SHARE);
  const ratio = typeof o.checkRatio === "number" && o.checkRatio > 0 && o.checkRatio < 1 ? o.checkRatio : 0.8;
  const cap = Number.isInteger(o.checkTokens) && o.checkTokens! > 0 ? o.checkTokens! : checkCap();
  return { window: declared, usable, hard, check: Math.min(Math.floor(usable * ratio), hard, cap) };
}

/** The in-turn check line, in tokens, for a model's window (loop.ts compactIfLong). */
export const compactAtTokens = (window: number) => linesFor({ window, checkRatio: config.compactRatio }).check;
/** The between-turns line, in characters (~4 per token): never above COMPACT_CHARS. */
export const compactAtChars = (window: number) => Math.min(config.compactChars, compactAtTokens(window) * 4);
/**
 * The between-turns line for a bot's model: linked to the window the user DECLARED for a model of their own provider
 * (Settings → Models); COMPACT_CHARS as before when no window is declared (the server-wide default window is a guess,
 * and the in-turn compaction already follows it).
 */
export const betweenTurnsChars = (userId: string, modelRef: string) => { const w = apiProviders.contextOf(userId, modelRef); return w ? compactAtChars(w) : config.compactChars; };

// ── The user's words, word for word ──
export const USER_WORDS_CHARS = 8_000;
const LINE_MAX = 1_500;
/** A long message keeps its start and its end, with a marker that says the cut is this view's (DS-Bot shorten). */
export function shorten(text: string, max = LINE_MAX): string {
  if (text.length <= max) return text;
  const head = Math.ceil((max * 2) / 3);
  return `${text.slice(0, head)}\n[… ${text.length - max} characters left out of this view …]\n${text.slice(text.length - (max - head))}`;
}

const textOf = (messages: ChatMessage[]) => messages.flatMap((m) => m.content.map((b) => (b.type === "text" ? b.text : ""))).join("\n");

/**
 * The block added after a summary: the user's own messages of that conversation (thread) that the kept part does not
 * already hold, newest first within the budget, shown oldest first. "" when there are none.
 */
export function userWordsBlock(bot: Pick<BotRecord, "id" | "generation">, kept: ChatMessage[], thread = 0, budget = USER_WORDS_CHARS): string {
  const keptText = textOf(kept);
  const mine = rows.recentMessages(bot.id, bot.generation, 400, thread).filter(typedByUser)
    .map((r) => (r.body.kind === "message" ? r.body.text.trim() : "")).filter((t) => t && !keptText.includes(t));
  const shown: string[] = [];
  let used = 0;
  for (let i = mine.length - 1; i >= 0; i--) {
    const line = `- ${shorten(mine[i])}`;
    if (shown.length && used + line.length > budget) break;
    shown.push(line);
    used += line.length;
  }
  if (!shown.length) return "";
  const more = shown.length < mine.length;
  return ["", "## The user's messages, word for word (oldest first)", ...(more ? ["(Older messages are not shown here; conversation search finds them.)"] : []), ...shown.reverse()].join("\n");
}
