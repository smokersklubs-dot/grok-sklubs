/**
 * L162: what Slack, Discord and Telegram share once a message is in — kept here so each channel only speaks its service.
 *
 *  - The owner (the one account linked with the code from the Sklubot screen) talks to the bot as in the app: their words
 *    are the owner's (submitUserMessage), and the bot's replies in the main chat go back to the channel until the owner
 *    types in the app again (an "owner window").
 *  - An approved person (channelaccess.ts) talks in a thread of the bot's chat of their own. Their message is a workspace
 *    member's (origin "member", submitMemberMessage): never the owner's words, a careful turn, no approval for them to
 *    answer — every action asks the owner. A secret they paste is masked and dropped (the vault is the owner's), files
 *    from them are refused (the bot's library is the owner's), at most 20 messages a minute.
 *  - Every finished reply of the bot in a person's thread is sent to them, once (last_sent_seq), files included.
 */
import { subscribe } from "./bus.js";
import { decideApproval, isPaused, submitMemberMessage, submitUserMessage } from "./agent/loop.js";
import { holdAndOffer, screen as screenSecrets } from "./pastedsecrets.js";
import { access, type ContactRecord } from "./channelaccess.js";
import { groupMessage, groupSinkFor, groups, type GroupMessage } from "./channelgroups.js";
import { CHANNEL_LABEL, chText } from "./channeltext.js";
import type { ContactChannel } from "./channeltypes.js";
import { readLibraryFile } from "./computer.js";
import { approvals, audit, bots, clip, rows, users, type BotRecord } from "./store.js";
import type { Attachment, Row } from "./shared.js";

/** How a channel sends to one conversation. */
export interface Sink {
  text(text: string): Promise<void>;
  /** Sends one file; false when the service refuses it (too big). */
  file?(a: Attachment, bytes: Buffer): Promise<boolean>;
}

const contactSinks = new Map<ContactChannel, (bot: BotRecord, c: ContactRecord) => Sink | null>();
/** A channel says how to reach an approved person (their DM). */
export const registerContactSink = (channel: ContactChannel, fn: (bot: BotRecord, c: ContactRecord) => Sink | null) => { contactSinks.set(channel, fn); };

const rate = new Map<string, number[]>();
function tooFast(key: string, max = 20): boolean {
  const t = Date.now();
  const list = (rate.get(key) ?? []).filter((x) => t - x < 60_000);
  list.push(t);
  rate.set(key, list);
  if (rate.size > 5000) rate.delete(rate.keys().next().value!);
  return list.length > max;
}

export type ContactSaid = { ok: true; paused: boolean } | { ok: false; reply: string };

/** An approved person's text message: into their thread, as a member's message, and a careful turn of its own. */
export function contactMessage(bot: BotRecord, c: ContactRecord, raw: string): ContactSaid {
  const loc = users.localeOf(bot.userId);
  if (tooFast(`${bot.id}:${c.id}`)) return { ok: false, reply: chText(loc, "Slow down a little: too many messages in a minute.") };
  // A secret pasted by someone else is masked and dropped: the vault it could go in is the owner's, not theirs.
  const text = screenSecrets(raw.trim(), loc).text;
  if (!text) return { ok: false, reply: "" };
  if (text.length > 20_000) return { ok: false, reply: chText(loc, "That message is too long.") };
  watchUser(bot.userId);
  const thread = access.threadFor(bot, c);
  const fresh = bots.byId(bot.id) ?? bot;
  const name = `${c.name} (${CHANNEL_LABEL[c.channel]})`;
  rows.append(fresh, { kind: "message", role: "user", text, origin: { kind: "member", id: `${c.channel}:${c.externalId}`, name } }, thread);
  submitMemberMessage(fresh, text, { id: `${c.channel}:${c.externalId}`, name, role: `an outside contact your owner approved on ${CHANNEL_LABEL[c.channel]}`, workspace: CHANNEL_LABEL[c.channel] }, false, thread);
  return { ok: true, paused: isPaused(fresh) };
}

/**
 * Someone other than the owner wrote: an approved person's message goes in (text only), anyone else gets their access
 * code (or is told to wait, or nothing when blocked). `reply` answers in the same conversation.
 */
export async function strangerMessage(bot: BotRecord, channel: ContactChannel, who: { id: string; name: string; replyTo: string }, text: string, hasFile: boolean, reply: (t: string) => Promise<unknown>) {
  const loc = users.localeOf(bot.userId);
  const k = access.knock(bot, channel, who.id, who.name, who.replyTo);
  if (k.state === "blocked") return;
  if (k.state === "full") { await reply(chText(loc, "🔒 Too many requests are waiting for the owner. Try again in an hour.")); return; }
  if (k.state === "pending") {
    await reply(k.fresh ? chText(loc, "🔒 {bot} only talks to people its owner approved. Your request code: {code} (valid 1 hour). Give it to the owner so they can approve you in Sklubot.", { bot: bot.name, code: k.code }) : chText(loc, "🔒 Your request is waiting for the owner. Your code: {code}.", { code: k.code }));
    return;
  }
  // The bot's library is its owner's: a file from someone else is not stored.
  if (hasFile) { await reply(chText(loc, "🔒 Only the owner can send files to {bot}. Write your message as text.", { bot: bot.name })); if (!text.trim()) return; }
  const said = contactMessage(bot, k.contact, text);
  if (!said.ok) { if (said.reply) await reply(said.reply); return; }
  if (said.paused) await reply(chText(loc, "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.", { bot: bot.name }));
}

/** DS-Bot item 4: a message in a group chat (channelgroups.ts); the group's replies are routed from here. */
export function groupSaid(bot: BotRecord, channel: ContactChannel, m: GroupMessage, reply: (t: string) => Promise<unknown>) {
  watchUser(bot.userId);
  return groupMessage(bot, channel, m, reply);
}

/** The owner's own message from a channel: their words, as in the app; the replies come back through `sink`. */
export function ownerMessage(bot: BotRecord, channel: "slack" | "discord", raw: string, attachments: Attachment[], sink: Sink): { paused: boolean } {
  const loc = users.localeOf(bot.userId);
  // A pasted secret is masked before it is stored or sent to a model; the card to save it waits in the web chat.
  const screened = screenSecrets(raw.trim(), loc);
  const text = screened.text || (attachments.length ? chText(loc, "(file: {name})", { name: attachments.map((a) => a.name).join(", ") }) : "");
  if (!text) return { paused: false };
  const row = rows.append(bot, { kind: "message", role: "user", text, ...(attachments.length ? { attachments } : {}) }, 0);
  if (screened.secrets.length) holdAndOffer(bot, bot.userId, screened.secrets);
  ownerSaid(bot, channel, sink, row.seq);
  submitUserMessage(bot, text, false, attachments);
  return { paused: isPaused(bot) };
}

/**
 * ✅ / ❌ pressed under an approval question on Slack or Discord. Only the linked owner may answer (checked by the caller
 * and again here by the account), never a payment, a vault value or the owner's own computer (telegram.ts privateApproval).
 */
export function answerApproval(bot: BotRecord, approvalId: string, allow: boolean, channel: string, isPrivate: (tool: string) => boolean): string {
  const loc = users.localeOf(bot.userId);
  const a = approvals.byId(approvalId);
  if (!a || a.status !== "pending" || a.botId !== bot.id || a.userId !== bot.userId) return chText(loc, "This request was already answered.");
  if (isPrivate(a.tool)) return chText(loc, "🔒 This one must be answered in the app.");
  decideApproval(bot.userId, a.id, allow ? "allow" : "deny");
  audit(bot.userId, "channel", `${bot.name}: approval answered from ${channel} (button ${allow ? "yes" : "no"})`, bot.id);
  return chText(loc, allow ? "✅ Allowed" : "❌ Refused");
}

// ── The owner's window ───────────────────────────────────────────────────────────────────────────────────────────
interface Window { channel: string; sink: Sink; until: number; own: Set<number>; lastSent: number }
const windows = new Map<string, Window>();
/**
 * The owner wrote from a channel (their row is `seq`): the bot's next replies in the main chat go back there, until the
 * owner types in the app (another user message of the main chat), or 30 minutes pass.
 */
export function ownerSaid(bot: BotRecord, channel: string, sink: Sink, seq: number) {
  watchUser(bot.userId);
  const cur = windows.get(bot.id);
  const own = cur && cur.channel === channel ? cur.own : new Set<number>();
  own.add(seq);
  windows.set(bot.id, { channel, sink, until: Date.now() + 30 * 60_000, own, lastSent: Math.max(cur?.lastSent ?? 0, seq) });
}
export const ownerWindowOf = (botId: string) => windows.get(botId)?.channel ?? null;

// ── Replies going out ────────────────────────────────────────────────────────────────────────────────────────────
const watched = new Set<string>();
const finished = (r: Row) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming && (!!r.body.text.trim() || !!r.body.attachments?.length);

/** Listens to one account's conversation rows (once): sends the bot's finished replies to the right channel. */
export function watchUser(userId: string) {
  if (watched.has(userId)) return;
  watched.add(userId);
  subscribe(userId, (e) => {
    if (e.type !== "rows") return;
    for (const r of e.rows) void route(e.botId, r).catch((err) => console.error("[channel reply]", (err as Error).message));
  });
}

async function route(botId: string, raw: Row) {
  // DS-Bot item 8: a view card (chart, table, form…) goes out as its plain-text fallback, once (seq checks below).
  const r: Row = raw.body.kind === "card" && raw.body.card.type === "view" && raw.body.card.status !== "answered" && raw.body.card.status !== "dismissed" ? { ...raw, body: { kind: "message", role: "assistant", text: raw.body.card.fallback } } : raw;
  if (r.body.kind !== "message") return;
  const bot = bots.byId(botId);
  if (!bot || r.generation !== bot.generation) return;
  if (r.thread) {
    if (!finished(r)) return;
    // DS-Bot item 4: a group chat's thread — the reply goes back into that group (text only), once.
    const g = groups.byThread(bot.id, r.generation, r.thread);
    if (g) { if (r.seq <= g.lastSentSeq) return; const gs = groupSinkFor(bot, g); if (!gs) return; groups.markSent(g.id, r.seq); await deliver(bot, { text: gs.text }, r); return; }
    const c = access.byThread(bot.id, r.generation, r.thread);
    if (!c || r.seq <= c.lastSentSeq) return;
    const sink = contactSinks.get(c.channel)?.(bot, c);
    if (!sink) return;
    access.markSent(c.id, r.seq);
    await deliver(bot, sink, r);
    return;
  }
  const w = windows.get(bot.id);
  if (!w) return;
  if (Date.now() > w.until) { windows.delete(bot.id); return; }
  // The owner typed in the app (a plain user row that is not one of theirs from the channel): the window closes.
  if (r.body.role === "user") { if (!r.body.origin && !w.own.has(r.seq) && r.seq > w.lastSent) windows.delete(bot.id); return; }
  if (!finished(r) || r.seq <= w.lastSent) return;
  w.lastSent = r.seq;
  await deliver(bot, w.sink, r);
}

async function deliver(bot: BotRecord, sink: Sink, r: Row) {
  if (r.body.kind !== "message") return;
  if (r.body.text.trim()) await sink.text(r.body.text);
  for (const a of r.body.attachments ?? []) {
    let ok = false;
    try { ok = sink.file ? await sink.file(a, readLibraryFile(bot.id, a.path)) : false; } catch (err) { console.error("[channel file]", (err as Error).message); }
    if (!ok) await sink.text(chText(users.localeOf(bot.userId), sink.file ? "“{name}” is too big for this channel. It is in the app." : "“{name}” is in the app.", { name: clip(a.name, 80) }));
  }
}

/** Splits a reply for a service that limits a message to `max` characters (Slack, Discord); see telegramplus.ts. */
export { splitTelegram as splitMessage } from "./telegramplus.js";
