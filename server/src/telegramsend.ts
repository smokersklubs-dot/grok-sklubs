import { config } from "./config.js"; import { tr } from "./i18n.js";
import { rows, users, type BotRecord } from "./store.js"; import type { Locale } from "./shared.js";

/**
 * L76, the rest of « Telegram » (Sklubot's own code):
 *  - « Lien vers la carte »: a question or approval the bot waits on carries a link that opens this bot in the app
 *    (`${PUBLIC_URL}/?bot=<id>`, the address the push notifications already use), so a card that must be answered in the
 *    app (payment, own computer, vault…) is one tap away.
 *  - « Envoi vérifié et réessayé, avis si échec »: every message sent to Telegram is checked (`ok: true` in the answer),
 *    tried again when Telegram asks to wait (429 with `parameters.retry_after`, https://core.telegram.org/bots/api#responseparameters)
 *    or when the network or Telegram fails (5xx, no answer); a refusal that will not change (400 bad request, 403 the user
 *    blocked the bot) is not retried. When it still fails, a notice says so in the web chat: the reply is never lost
 *    silently, it is there in the app. At most one such notice per bot every NOTICE_EVERY_MS.
 */
export const SEND_TRIES = 3;
export const NOTICE_EVERY_MS = 10 * 60_000;
const MAX_WAIT_MS = 30_000;

export interface TelegramFailure extends Error { status?: number; retryAfter?: number }

/** Wait `retry_after` seconds (capped), else 1 s then 3 s; null = do not retry. */
export function retryDelay(err: TelegramFailure, attempt: number): number | null {
  if (err.status === 429) return Math.min(MAX_WAIT_MS, Math.max(1, err.retryAfter ?? 1) * 1000);
  if (err.status !== undefined && err.status < 500) return null;
  return attempt === 1 ? 1000 : 3000;
}

let sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
/** Tests: no real waiting. */
export const setSendSleep = (fn: (ms: number) => Promise<void>) => { sleep = fn; };

/** Runs `attempt` up to SEND_TRIES times; throws the last error. */
export async function withRetry<T>(attempt: () => Promise<T>, tries = SEND_TRIES): Promise<T> {
  let last: unknown;
  for (let i = 1; i <= tries; i++) {
    try { return await attempt(); } catch (err) {
      last = err;
      const wait = i < tries ? retryDelay(err as TelegramFailure, i) : null;
      if (wait === null) break;
      await sleep(wait);
    }
  }
  throw last;
}

/** The address that opens this bot (and its waiting card) in the app. */
export const cardLink = (botId: string) => `${config.publicUrl}/?bot=${encodeURIComponent(botId)}`;
export const cardLinkLine = (botId: string, locale: Locale) => tr(locale, "Open the card: {link}", { link: cardLink(botId) });

const lastNotice = new Map<string, number>();
/** After the retries failed: one notice in the web chat (the text stays in the app). Returns whether one was written. */
export function failedNotice(bot: BotRecord, err: unknown, now = Date.now()): boolean {
  if ((lastNotice.get(bot.id) ?? 0) > now - NOTICE_EVERY_MS) return false;
  lastNotice.set(bot.id, now);
  const loc = users.localeOf(bot.userId);
  const e = err as TelegramFailure;
  const why = e?.status === 403
    ? tr(loc, "Telegram refuses: the bot may have been blocked in Telegram.")
    : e?.status === 429 ? tr(loc, "Telegram asks to wait (too many messages).")
    : tr(loc, "Telegram is not answering for now.");
  rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "A message could not be sent to Telegram. {why} It stays readable here.", { why }) });
  return true;
}
