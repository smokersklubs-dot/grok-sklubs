import { browserAvailable, computerKind, shellAvailable } from "../computer.js";
import { config } from "../config.js";
import { TURN_CONTEXT_HEADING } from "../llm/cachelayout.js";
import type { PromptPart, PromptView } from "../memorytypes.js";
import { history, settings, type BotRecord, type UserRecord } from "../store.js";
import { historyChars } from "./memory.js";
import { memoryPrefs } from "./memoryprefs.js";
import { buildSystemPrompt, pickMemories, type PromptExtras } from "./prompt.js";
import { usableCount } from "./recall.js";
import { betweenTurnsChars } from "./compactlines.js";
import { defaultModelRef } from "../llm/index.js";

/**
 * L137 « Ce que reçoit ce bot »: the instructions the bot gets with its next message, cut into their parts in order
 * (each "## " heading starts one), with their size — so when a bot drifts or forgets, the owner sees what it was told.
 * Plus « Ce que ton bot voit de sa mémoire » (notes shown and left out, and what they cost) and L138's context gauge.
 *
 * Built with the same function as a real turn (prompt.ts buildSystemPrompt), from the server's own view of the tools:
 * the parts that depend on the turn (connected apps of that moment, the user's message for the recall) can differ a
 * little. Read only: nothing is written, no model is called. Tokens are estimated (characters / 4).
 */

export const CHARS_PER_TOKEN = 4;
const tokens = (chars: number) => Math.ceil(chars / CHARS_PER_TOKEN);

/** The parts of a system prompt, in order: an untitled opening, then one part per "## " heading. */
export function splitPrompt(prompt: string): PromptPart[] {
  const at = prompt.indexOf(TURN_CONTEXT_HEADING);
  const fixed = at >= 0 ? prompt.slice(0, at) : prompt;
  const turn = at >= 0 ? prompt.slice(at + TURN_CONTEXT_HEADING.length) : "";
  const cut = (text: string, kind: PromptPart["kind"]): PromptPart[] =>
    text.split(/\n\n(?=## )/).map((p) => p.trim()).filter(Boolean).map((p) => {
      const heading = /^## (.+)$/m.exec(p.split("\n")[0]);
      const title = heading ? heading[1].trim() : kind === "fixed" ? "Who the bot is" : "For this message";
      return { title: title.length > 120 ? `${title.slice(0, 117)}…` : title, text: p, chars: p.length, tokens: tokens(p.length), kind };
    });
  return [...cut(fixed, "fixed"), ...cut(turn, "turn")];
}

export function promptView(bot: BotRecord, user: UserRecord): PromptView {
  const extras: PromptExtras = { connectorNames: [], browser: browserAvailable(), shell: shellAvailable(), linux: computerKind() === "linux", preview: true };
  const parts = splitPrompt(buildSystemPrompt(bot, user, extras));
  const mem = pickMemories(bot);
  const memChars = mem.lines.reduce((n, l) => n + l.length + 1, 0);
  const total = usableCount(bot.id);
  const chars = historyChars(history.load(bot.id, bot.generation));
  const p = settings.profile(user.id);
  const compactAt = betweenTurnsChars(user.id, bot.model || defaultModelRef()); // the same line as memory.ts (compactlines.ts)
  return {
    parts,
    totalChars: parts.reduce((n, x) => n + x.chars, 0),
    totalTokens: parts.reduce((n, x) => n + x.tokens, 0),
    memory: { total, shown: mem.shown.size, hidden: Math.max(0, total - mem.shown.size), chars: memChars, tokens: tokens(memChars), lines: mem.lines },
    context: { chars, tokens: tokens(chars), compactAt, percent: compactAt > 0 ? Math.min(100, Math.round((chars / compactAt) * 100)) : 0 },
    profileShared: !!(p.name || p.timezone || p.company || p.preferences),
    noLearn: memoryPrefs.noLearn(bot.id),
  };
}
