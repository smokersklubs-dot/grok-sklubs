/*
 * Portions adapted from openclaw/openclaw (https://github.com/openclaw/openclaw, commit
 * 3c8c7bf781fbf3e2c614a446eee0ad3a87b400fd), Copyright (c) 2026 OpenClaw Foundation, MIT License; modified for Sklubot:
 * the pairing constants and code generator of src/pairing/pairing-store-model.ts (8 characters from an alphabet without
 * 0/O/1/I, 1 hour, 3 waiting) and the "a 4th request gets no code" rule of src/pairing/pairing-store.worker.ts, rewritten
 * on a SQLite table per bot and channel, approved from the owner's Sklubot screen instead of a command line, with a
 * "blocked" state and a thread of the bot's chat per approved person.
 *
 * L162 + OpenClaw I8 — who besides the owner may talk to a bot on Telegram, Slack or Discord:
 *  - someone unknown who writes gets a short code (valid 1 hour) and nothing reaches the bot; at most 3 requests wait per
 *    bot and channel, a 4th person is told to try later;
 *  - the owner sees the requests (with the code, to compare with what the person tells them), approves or refuses them,
 *    sees the allow-list and removes people from it; they may also add someone by their id directly;
 *  - an approved person's messages reach the bot as a workspace member's would (origin "member": never the owner's words,
 *    a careful turn, every action asks the owner), in a thread of the bot's chat of their own.
 */
import { randomInt } from "node:crypto";
import { q } from "./db.js";
import { pushLater } from "./push.js";
import { CHANNEL_LABEL, chText } from "./channeltext.js";
import { PAIRING, type ChannelContact, type ContactChannel, type ContactStatus } from "./channeltypes.js";
import { audit, bots, newId, now, rows, users, type BotRecord } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS channel_contacts (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, channel TEXT NOT NULL, external_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, code TEXT, expires_at INTEGER, reply_to TEXT,
  thread_seq INTEGER, thread_gen INTEGER, last_sent_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seen_at INTEGER,
  UNIQUE (bot_id, channel, external_id))`);

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
/** Human-friendly: 8 characters, upper case, no ambiguous ones (0O1I) — from OpenClaw's randomCode. */
function randomCode(): string {
  let out = "";
  for (let i = 0; i < PAIRING.codeLength; i++) out += CODE_ALPHABET[randomInt(0, CODE_ALPHABET.length)];
  return out;
}
/** The code the owner sends to link their own Slack or Discord account (same alphabet, 8 characters). */
export const newLinkCode = () => randomCode();
function uniqueCode(existing: Set<string>): string {
  for (let i = 0; i < 500; i++) { const c = randomCode(); if (!existing.has(c)) return c; }
  throw new Error("could not make a unique access code");
}

interface Row {
  id: string; bot_id: string; channel: string; external_id: string; name: string; status: string; code: string | null; expires_at: number | null;
  reply_to: string | null; thread_seq: number | null; thread_gen: number | null; last_sent_seq: number; created_at: number; updated_at: number; last_seen_at: number | null;
}
export interface ContactRecord extends ChannelContact { botId: string; replyTo: string | null; threadSeq: number | null; threadGen: number | null; lastSentSeq: number }
const toContact = (r: Row): ContactRecord => ({
  id: r.id, botId: r.bot_id, channel: r.channel as ContactChannel, externalId: r.external_id, name: r.name, status: r.status as ContactStatus,
  code: r.status === "pending" ? r.code : null, expiresAt: r.status === "pending" ? r.expires_at : null, createdAt: r.created_at, lastSeenAt: r.last_seen_at,
  replyTo: r.reply_to, threadSeq: r.thread_seq, threadGen: r.thread_gen, lastSentSeq: r.last_sent_seq,
});
export const publicContact = (c: ContactRecord): ChannelContact => ({ id: c.id, channel: c.channel, externalId: c.externalId, name: c.name, status: c.status, code: c.code, expiresAt: c.expiresAt, createdAt: c.createdAt, lastSeenAt: c.lastSeenAt });

const prune = (botId: string) => q.run("DELETE FROM channel_contacts WHERE bot_id = ? AND status = 'pending' AND expires_at < ?", botId, now());
const find = (botId: string, channel: ContactChannel, externalId: string) => {
  const r = q.get<Row>("SELECT * FROM channel_contacts WHERE bot_id = ? AND channel = ? AND external_id = ?", botId, channel, externalId);
  return r ? toContact(r) : null;
};
export const contactById = (botId: string, id: string) => { const r = q.get<Row>("SELECT * FROM channel_contacts WHERE bot_id = ? AND id = ?", botId, id); return r ? toContact(r) : null; };

export type Knock =
  | { state: "allowed"; contact: ContactRecord }
  | { state: "pending"; code: string; fresh: boolean }
  | { state: "full" }
  | { state: "blocked" };

/** Hooks: a channel tells an approved person they can write now. */
const approvedHooks = new Map<ContactChannel, (bot: BotRecord, c: ContactRecord) => void>();
export const onApproved = (channel: ContactChannel, fn: (bot: BotRecord, c: ContactRecord) => void) => { approvedHooks.set(channel, fn); };

export const access = {
  /**
   * Someone who is not the owner wrote on a channel: allowed (their reply address and name are refreshed), blocked,
   * waiting (same code as before), or a new request with a fresh code — unless 3 already wait on this channel.
   */
  knock(bot: BotRecord, channel: ContactChannel, externalId: string, name: string, replyTo: string): Knock {
    prune(bot.id);
    const t = now();
    const cur = find(bot.id, channel, externalId);
    const cleanName = name.replace(/\s+/g, " ").trim().slice(0, 80) || externalId;
    if (cur?.status === "allowed") {
      q.run("UPDATE channel_contacts SET reply_to = ?, name = CASE WHEN ? != '' THEN ? ELSE name END, last_seen_at = ?, updated_at = ? WHERE id = ?", replyTo, name.trim() ? cleanName : "", cleanName, t, t, cur.id);
      return { state: "allowed", contact: find(bot.id, channel, externalId)! };
    }
    if (cur?.status === "blocked") return { state: "blocked" };
    if (cur?.status === "pending") {
      q.run("UPDATE channel_contacts SET last_seen_at = ?, reply_to = ? WHERE id = ?", t, replyTo, cur.id);
      return { state: "pending", code: cur.code!, fresh: false };
    }
    const waiting = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM channel_contacts WHERE bot_id = ? AND channel = ? AND status = 'pending'", bot.id, channel)!.n;
    if (waiting >= PAIRING.maxPending) return { state: "full" };
    const codes = new Set(q.all<{ code: string }>("SELECT code FROM channel_contacts WHERE bot_id = ? AND status = 'pending'", bot.id).map((r) => r.code));
    const code = uniqueCode(codes);
    q.run("INSERT INTO channel_contacts (id, bot_id, channel, external_id, name, status, code, expires_at, reply_to, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)",
      newId("ctc"), bot.id, channel, externalId, cleanName, code, t + PAIRING.ttlMs, replyTo, t, t, t);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[channel]} access asked by ${cleanName} (${externalId})`, bot.id);
    const loc = users.localeOf(bot.userId);
    pushLater(bot.userId, { kind: "needs", title: bot.name, body: chText(loc, "{name} asks to talk to {bot} on {channel} (code {code}).", { name: cleanName, bot: bot.name, channel: CHANNEL_LABEL[channel], code }), botId: bot.id });
    bots.announce(bot);
    return { state: "pending", code, fresh: true };
  },
  /** The owner approves a waiting request by its code (what the person was given). Null when no such request waits. */
  approve(bot: BotRecord, code: string): ContactRecord | null {
    prune(bot.id);
    const clean = String(code ?? "").trim().toUpperCase();
    if (!/^[A-Z0-9]{8}$/.test(clean)) return null;
    const r = q.get<Row>("SELECT * FROM channel_contacts WHERE bot_id = ? AND status = 'pending' AND code = ?", bot.id, clean);
    if (!r) return null;
    q.run("UPDATE channel_contacts SET status = 'allowed', code = NULL, expires_at = NULL, updated_at = ? WHERE id = ?", now(), r.id);
    const c = contactById(bot.id, r.id)!;
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[c.channel]} access approved for ${c.name} (${c.externalId})`, bot.id);
    try { approvedHooks.get(c.channel)?.(bot, c); } catch (err) { console.error("[channel approved]", (err as Error).message); }
    return c;
  },
  /** The owner adds someone to the allow-list by their id on the service (they have not written yet). */
  allow(bot: BotRecord, channel: ContactChannel, externalId: string, name: string): ContactRecord {
    const t = now();
    const cur = find(bot.id, channel, externalId);
    const cleanName = name.replace(/\s+/g, " ").trim().slice(0, 80) || externalId;
    if (cur) q.run("UPDATE channel_contacts SET status = 'allowed', code = NULL, expires_at = NULL, name = ?, updated_at = ? WHERE id = ?", cleanName, t, cur.id);
    else q.run("INSERT INTO channel_contacts (id, bot_id, channel, external_id, name, status, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'allowed', ?, ?)", newId("ctc"), bot.id, channel, externalId, cleanName, t, t);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[channel]} ${cleanName} (${externalId}) added to the allow-list`, bot.id);
    return find(bot.id, channel, externalId)!;
  },
  /** Refuses a waiting request, or blocks someone: they get no code and nothing they write reaches the bot. */
  block(bot: BotRecord, id: string): boolean {
    const c = contactById(bot.id, id);
    if (!c) return false;
    q.run("UPDATE channel_contacts SET status = 'blocked', code = NULL, expires_at = NULL, updated_at = ? WHERE id = ?", now(), id);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[c.channel]} ${c.name} (${c.externalId}) ${c.status === "pending" ? "request refused" : "blocked"}`, bot.id);
    return true;
  },
  /** Removes someone from the list (revokes an approval, or lifts a block): they would have to ask again. */
  remove(bot: BotRecord, id: string): boolean {
    const c = contactById(bot.id, id);
    if (!c) return false;
    q.run("DELETE FROM channel_contacts WHERE id = ?", id);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[c.channel]} ${c.name} (${c.externalId}) ${c.status === "allowed" ? "access revoked" : "removed from the list"}`, bot.id);
    return true;
  },
  list(botId: string): ContactRecord[] {
    prune(botId);
    return q.all<Row>("SELECT * FROM channel_contacts WHERE bot_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'allowed' THEN 1 ELSE 2 END, created_at DESC LIMIT 300", botId).map(toContact);
  },
  /** The approved person whose conversation is this thread of the bot's chat. */
  byThread(botId: string, generation: number, threadSeq: number): ContactRecord | null {
    const r = q.get<Row>("SELECT * FROM channel_contacts WHERE bot_id = ? AND thread_gen = ? AND thread_seq = ? AND status = 'allowed'", botId, generation, threadSeq);
    return r ? toContact(r) : null;
  },
  /** DS-Bot item 4: this person is on the allow-list of this service (channelgroups.ts "approved people only"). */
  isAllowed: (botId: string, channel: ContactChannel, externalId: string) => find(botId, channel, externalId)?.status === "allowed",
  markSent: (id: string, seq: number) => q.run("UPDATE channel_contacts SET last_sent_seq = MAX(last_sent_seq, ?) WHERE id = ?", seq, id),
  /**
   * The thread of the bot's chat where this person's conversation lives: made on their first message (a short line in the
   * main chat it hangs on), made again after the chat was cleared.
   */
  threadFor(bot: BotRecord, c: ContactRecord): number {
    const fresh = bots.byId(bot.id) ?? bot;
    if (c.threadSeq && c.threadGen === fresh.generation && rows.get(fresh.id, fresh.generation, c.threadSeq)) return c.threadSeq;
    const label = chText(users.localeOf(fresh.userId), "Conversation with {name} on {channel}", { name: c.name, channel: CHANNEL_LABEL[c.channel] });
    const head = rows.append(fresh, { kind: "message", role: "user", text: `💬 ${label}`, origin: { kind: "member", id: `${c.channel}:${c.externalId}`, name: c.name } }, 0);
    q.run("UPDATE channel_contacts SET thread_seq = ?, thread_gen = ?, last_sent_seq = ? WHERE id = ?", head.seq, head.generation, head.seq, c.id);
    return head.seq;
  },
};
