import { q } from "./db.js";
import { audit, now, users, type BotRecord } from "./store.js";

/**
 * L42 — who a bot may write to from its own address (Rakazo, Hermes audits).
 *
 * By default only its owner (the account's e-mail address), and the sender of a received mail it answers (reply_to_id,
 * a mail that was let through). Anyone else must be on the bot's « destinataires
 * autorisés » list, which the owner sees and edits in the bot's settings (Email tab): exact addresses (camille@x.fr) or
 * whole domains (@x.fr), 100 at most. A send to anyone else is refused before anything is built, with a reason that
 * tells the bot to ask its owner to add the address — the approval card is not enough on its own: a bot cannot widen the
 * list, only the owner in the app (PUT /bots/:id/email/recipients, securityroutes.ts).
 *
 * Additive table created here (house pattern, no numbered migration).
 */
q.run(`CREATE TABLE IF NOT EXISTS bot_email_recipients (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, list TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`);

export const MAX_RECIPIENTS_LISTED = 100;
const addrOf = (s: string) => (/<([^>]+)>/.exec(s)?.[1] ?? s).trim().toLowerCase();
/** Addresses and @domains, lower case, deduplicated, at most 100; anything else is dropped. */
export function cleanRecipients(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(/[\s,;]+/) : [];
  return [...new Set(list.map((s) => String(s).trim().toLowerCase()).filter((s) => /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/.test(s) || /^@[^@\s<>]+\.[^@\s<>]+$/.test(s)))].slice(0, MAX_RECIPIENTS_LISTED);
}

export const botRecipients = {
  get(botId: string): string[] {
    const r = q.get<{ list: string }>("SELECT list FROM bot_email_recipients WHERE bot_id = ?", botId);
    try { return r ? cleanRecipients(JSON.parse(r.list)) : []; } catch { return []; }
  },
  set(bot: BotRecord, raw: unknown): string[] {
    const list = cleanRecipients(raw);
    q.run("INSERT INTO bot_email_recipients (bot_id, list, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET list = excluded.list, updated_at = excluded.updated_at", bot.id, JSON.stringify(list), now());
    audit(bot.userId, "apps", `${bot.name}: allowed email recipients set (${list.length})`, bot.id);
    return list;
  },
  /** The owner's own address, always allowed (shown first in the settings). */
  owner: (bot: BotRecord) => users.byId(bot.userId)?.email.toLowerCase() ?? "",
};

/** null when every recipient is the owner or on the bot's list; else the refusal (English, read by the model). */
export function recipientProblem(bot: BotRecord, to: string[], answering?: string): string | null {
  const owner = botRecipients.owner(bot);
  // The sender of a mail the bot received (and that was not held) may be answered: they wrote to it first.
  const list = [...botRecipients.get(bot.id), ...(answering ? [addrOf(answering)] : [])];
  const out = to.map(addrOf).filter((a) => a !== owner && !list.some((l) => (l.startsWith("@") ? a.endsWith(l) : a === l)));
  if (!out.length) return null;
  return `${out.join(", ")} ${out.length > 1 ? "are" : "is"} not on this bot's allowed recipients. By default a bot writes only to its owner; ask them to add the address in the bot's settings (Email → Allowed recipients). Nothing was sent.`;
}
