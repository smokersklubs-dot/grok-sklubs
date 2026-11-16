import { randomUUID } from "node:crypto";
import { tr } from "./i18n.js";
import { maskSecrets, type Card, type Locale, type SecretFound } from "./shared.js";
import { hideForAWhile, now, rows, type BotRecord } from "./store.js";

/**
 * A secret the user pasted in a chat message (a key, a token, a password). Before the message is stored or reaches any
 * model, the secret is cut out of it and replaced by "[secret masqué]"; the value is held here, in memory only, for 30
 * minutes, while a card offers to put it in the vault (sealed, with the host it may be sent to) or to forget it. It is
 * never written to the chat, the bot's history, the activity log, memory or a log line. A server restart forgets it.
 */

const TTL_MS = 30 * 60_000;
const MAX_HELD_PER_USER = 20;
interface Held { userId: string; botId: string; value: string; until: number }
const held = new Map<string, Held>();

function sweep() {
  const t = now();
  for (const [id, h] of held) if (h.until <= t) held.delete(id);
}

export const placeholderFor = (locale: Locale) => tr(locale, "[secret hidden]");

/** What the card says about the value without showing it: only a well-known format prefix. */
const PREFIX = /^(sk-ant-|sk-proj-|sk-or-|sk_live_|sk_test_|rk_live_|sk-|ghp_|gho_|ghs_|ghu_|ghr_|github_pat_|glpat-|xox[abeprs]-|AKIA|ASIA|AIza|xai-|hf_|eyJ)/;
/** A name and host to suggest for well-known formats (the user can change both). */
function suggest(value: string): { name: string; host: string } {
  if (value.startsWith("sk-ant-")) return { name: "Anthropic", host: "api.anthropic.com" };
  if (value.startsWith("sk-or-")) return { name: "OpenRouter", host: "openrouter.ai" };
  if (/^(sk|rk)_(live|test)_/.test(value)) return { name: "Stripe", host: "api.stripe.com" };
  if (/^(gh[pousr]_|github_pat_)/.test(value)) return { name: "GitHub", host: "api.github.com" };
  if (value.startsWith("glpat-")) return { name: "GitLab", host: "gitlab.com" };
  if (/^xox/.test(value)) return { name: "Slack", host: "slack.com" };
  if (value.startsWith("AIza")) return { name: "Google", host: "googleapis.com" };
  if (value.startsWith("xai-")) return { name: "xAI", host: "api.x.ai" };
  if (value.startsWith("hf_")) return { name: "Hugging Face", host: "huggingface.co" };
  return { name: "", host: "" };
}

export interface Screened { text: string; secrets: SecretFound[] }

/** Cuts the secrets out of a message (nothing is held: see hold()). */
export function screen(text: string, locale: Locale): Screened {
  return maskSecrets(text, placeholderFor(locale));
}

/**
 * Holds the secrets of a masked message and shows one card each, after the message (owner only: the vault is theirs).
 * Each value is also hidden from anything shown or sent for a while, should it come back by another way.
 */
export function holdAndOffer(bot: BotRecord, userId: string, found: SecretFound[], thread = 0) {
  sweep();
  for (const s of found.slice(0, 5)) {
    hideForAWhile(userId, s.value, TTL_MS);
    const mine = [...held.entries()].filter(([, h]) => h.userId === userId);
    if (mine.length >= MAX_HELD_PER_USER) held.delete(mine[0][0]);
    const pendingId = `ps_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    held.set(pendingId, { userId, botId: bot.id, value: s.value, until: now() + TTL_MS });
    const card: Card = { type: "pastedsecret", pendingId, kind: s.kind, hint: s.kind === "password" ? "" : (PREFIX.exec(s.value)?.[1] ?? ""), length: s.value.length, ...suggest(s.value), status: "pending", expiresAt: now() + TTL_MS };
    rows.append(bot, { kind: "card", card }, thread);
  }
}

/** The held value, for the user who pasted it (taken out: it is held no longer). Null when gone (expired, restarted). */
export function takeHeld(userId: string, botId: string, pendingId: string): string | null {
  sweep();
  const h = held.get(pendingId);
  if (!h || h.userId !== userId || h.botId !== botId) return null;
  held.delete(pendingId);
  return h.value;
}
export const forgetHeld = (pendingId: string) => { held.delete(pendingId); };
/** For tests: how many values are held right now. */
export const heldCount = () => { sweep(); return held.size; };
