import { q } from "./db.js";
import { now } from "./store.js";

/**
 * L161 « Style par bot » (backlog A-FAIRE): how a bot talks to its owner — « Plus simple » (short sentences, no jargon,
 * one idea at a time), « Normal », or « Me contredire » (it questions the plan, says when it disagrees and why). One line
 * in the bot's instructions (agent/prompt.ts); nothing else changes, approvals and rules included.
 */
export const BOT_STYLES = ["simple", "normal", "challenge"] as const;
export type BotStyle = (typeof BOT_STYLES)[number];

q.run("CREATE TABLE IF NOT EXISTS bot_style (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, style TEXT NOT NULL, updated_at INTEGER NOT NULL)");

export function botStyle(botId: string): BotStyle {
  const s = q.get<{ style: string }>("SELECT style FROM bot_style WHERE bot_id = ?", botId)?.style;
  return (BOT_STYLES as readonly string[]).includes(s ?? "") ? (s as BotStyle) : "normal";
}
export function setBotStyle(botId: string, style: unknown): BotStyle {
  if (!(BOT_STYLES as readonly unknown[]).includes(style)) throw new Error("Choose simpler, normal or challenge.");
  q.run("INSERT INTO bot_style (bot_id, style, updated_at) VALUES (?, ?, ?) ON CONFLICT (bot_id) DO UPDATE SET style = excluded.style, updated_at = excluded.updated_at", botId, style as string, now());
  return style as BotStyle;
}

/** The instruction line for the style ("" for normal: the prompt of an existing bot stays exactly as it was). */
export function styleLine(botId: string): string {
  const s = botStyle(botId);
  if (s === "simple") return "## How to talk\nUse plain words and short sentences. No jargon: when a technical word is needed, explain it in a few words. One idea at a time, the most useful first.";
  if (s === "challenge") return "## How to talk\nDo not just agree. When a plan or an idea has a weak point, say so plainly, explain why, and suggest a better way. Ask the one question that matters before doing something costly or hard to undo. Stay kind and brief.";
  return "";
}
