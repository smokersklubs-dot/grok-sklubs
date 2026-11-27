import { q } from "./db.js";
import { now } from "./store.js";

/**
 * L132 « Réponses courtes » as a bot setting, not a skill the bot has to read (a skill can be forgotten when a bot has
 * many): numbered rules (at most N sentences, at most M words) and the channels it applies to (the web chat, Telegram,
 * calls). The rule line goes into the per-turn part of the instructions only when the message being answered came from
 * one of the chosen channels (agent/prompt.ts), so the long cached part stays byte-identical. Off by default: the
 * instructions of an existing bot do not change.
 *
 * Which channel a turn answers (without touching the agent loop): a call's words are stored with origin "voice"; a
 * Telegram message is noted by telegram.ts the moment it is stored (noteChannel); anything else typed is the web chat.
 */
export const SHORT_CHANNELS = ["web", "telegram", "voice"] as const;
export type ShortChannel = (typeof SHORT_CHANNELS)[number];
export interface ShortReplies { enabled: boolean; maxSentences: number; maxWords: number; channels: ShortChannel[] }
export const SHORT_LIMITS = { sentences: [1, 10], words: [10, 300] } as const;
export const SHORT_DEFAULT: ShortReplies = { enabled: false, maxSentences: 3, maxWords: 60, channels: ["telegram", "voice"] };

q.run("CREATE TABLE IF NOT EXISTS bot_short_replies (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, enabled INTEGER NOT NULL, max_sentences INTEGER NOT NULL, max_words INTEGER NOT NULL, channels TEXT NOT NULL, updated_at INTEGER NOT NULL)");

export function shortReplies(botId: string): ShortReplies {
  const r = q.get<{ enabled: number; max_sentences: number; max_words: number; channels: string }>("SELECT * FROM bot_short_replies WHERE bot_id = ?", botId);
  if (!r) return { ...SHORT_DEFAULT, channels: [...SHORT_DEFAULT.channels] };
  let channels: ShortChannel[] = [];
  try { channels = (JSON.parse(r.channels) as unknown[]).filter((c): c is ShortChannel => (SHORT_CHANNELS as readonly unknown[]).includes(c)); } catch { /* none */ }
  return { enabled: r.enabled === 1, maxSentences: r.max_sentences, maxWords: r.max_words, channels };
}

/** Saves a change; an error in words (French) for a value out of range. */
export function setShortReplies(botId: string, input: Record<string, unknown>): ShortReplies {
  const cur = shortReplies(botId);
  const int = (v: unknown, [lo, hi]: readonly [number, number], label: string) => {
    if (v === undefined) return undefined;
    if (!Number.isInteger(v) || (v as number) < lo || (v as number) > hi) throw new Error(`${label} : choisis un nombre entre ${lo} et ${hi}.`);
    return v as number;
  };
  if (input.enabled !== undefined && typeof input.enabled !== "boolean") throw new Error("enabled doit valoir true ou false.");
  if (input.channels !== undefined && (!Array.isArray(input.channels) || input.channels.some((c) => !(SHORT_CHANNELS as readonly unknown[]).includes(c)))) throw new Error("Canaux possibles : web, telegram, voice.");
  const next: ShortReplies = {
    enabled: (input.enabled as boolean | undefined) ?? cur.enabled,
    maxSentences: int(input.maxSentences, SHORT_LIMITS.sentences, "Phrases") ?? cur.maxSentences,
    maxWords: int(input.maxWords, SHORT_LIMITS.words, "Mots") ?? cur.maxWords,
    channels: input.channels ? [...new Set(input.channels as ShortChannel[])] : cur.channels,
  };
  q.run("INSERT INTO bot_short_replies (bot_id, enabled, max_sentences, max_words, channels, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET enabled=excluded.enabled, max_sentences=excluded.max_sentences, max_words=excluded.max_words, channels=excluded.channels, updated_at=excluded.updated_at",
    botId, next.enabled ? 1 : 0, next.maxSentences, next.maxWords, JSON.stringify(next.channels), now());
  return next;
}

// ── The channel of the message being answered ────────────────────────────────────────────────────────────────────
const noted = new Map<string, { channel: ShortChannel; at: number }>();
/** telegram.ts: a message of the owner from Telegram was just stored. */
export const noteChannel = (botId: string, channel: ShortChannel, at = Date.now()) => { noted.set(botId, { channel, at }); };

/** The channel of the bot's latest message from its owner (any conversation of the bot). */
export function turnChannel(botId: string): ShortChannel {
  const r = q.get<{ created_at: number; body: string }>("SELECT created_at, body FROM rows WHERE bot_id = ? AND kind = 'message' AND json_extract(body, '$.role') = 'user' ORDER BY created_at DESC, seq DESC LIMIT 1", botId);
  if (!r) return "web";
  try { if (JSON.parse(r.body)?.origin?.kind === "voice") return "voice"; } catch { /* plain */ }
  const n = noted.get(botId);
  return n && n.at >= r.created_at - 1500 && n.at <= r.created_at + 60_000 ? n.channel : "web";
}

const CHANNEL_WORD: Record<ShortChannel, string> = { web: "the web chat", telegram: "Telegram", voice: "a voice call (it is read aloud)" };
/** The per-turn rule line, or "" when the setting is off or the channel is not chosen. */
export function shortRepliesLine(botId: string, channel: ShortChannel = turnChannel(botId)): string {
  const s = shortReplies(botId);
  if (!s.enabled || !s.channels.includes(channel)) return "";
  return `## Short replies (the owner's setting; this message came from ${CHANNEL_WORD[channel]})\n` +
    `Answer in at most ${s.maxSentences} sentence${s.maxSentences > 1 ? "s" : ""} and at most ${s.maxWords} words: the answer or the result first, no preamble, no headings or tables, a list only when asked. ` +
    `When the full answer needs more, give the short version and offer the rest in one question. Files, cards and approvals are not shortened.`;
}
