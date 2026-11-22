/*
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * Copyright 2026 Fei2411 and the DS Bot contributors, Apache License 2.0; the group gating of
 * ds-bot/src/host/im/index.js (onMessage: "a group message is only taken when the bot is mentioned", an unbound group
 * answered once with "this group is not bound yet, pick it in Settings", a paired sender required) — itself following
 * dsh-im (https://github.com/xmanrui/dsh-im), Copyright (c) 2026 xmanrui, MIT License. Modified for Sklubot: rewritten
 * in TypeScript on a SQLite table per bot, channel and group chat; the owner turns a group on from the Sklubot screen
 * (never from the group itself); a trigger setting (mention or reply / every message) and a "who may make the bot
 * speak" setting per group; rate limits; every message of a group is a workspace member's (a careful turn, every action
 * asks the owner, privately), in a thread of the bot's chat of its own.
 *
 * DS-Bot item 4 (docs/audits/AUDIT-DS-BOT.md #124) — Slack channels, Discord server channels and Telegram groups:
 *  - a group the bot was added to is "pending" the first time someone mentions it there: nothing reaches the bot, the
 *    group is told once (at most once an hour) that the owner must turn it on in Sklubot, and the owner sees the request;
 *  - the owner turns it on ("allowed"), refuses it ("blocked": silence) or removes it; at most 10 requests wait per bot
 *    and service;
 *  - trigger: "mention" (default) — the bot answers only when it is @mentioned or someone replies to one of its
 *    messages; "all" — every message (needs the service's extra permission, see docs/CANAUX.md);
 *  - who: "approved" (default) — the owner and the people on the bot's allow-list for that service; "everyone" — anyone
 *    in that group. Someone else who mentions the bot is told once an hour to ask for access in a direct message;
 *  - what anyone says there, the owner included, is a member's message (origin "member"): never the owner's own words,
 *    so it can never answer an approval, and every action asks the owner in the app or in their direct messages — an
 *    approval is never posted in a group (channelrelay.ts and the services' onTurnEvent only write to the owner's DM);
 *  - at most 30 messages a minute per group and 8 per person in it; files are not taken in a group (send them in a DM);
 *  - the bot's finished replies in the group's thread go back to that group, once (last_sent_seq).
 */
import { q } from "./db.js";
import { isPaused, submitMemberMessage } from "./agent/loop.js";
import { pushLater } from "./push.js";
import { screen as screenSecrets } from "./pastedsecrets.js";
import { access } from "./channelaccess.js";
import { CHANNEL_LABEL, chText } from "./channeltext.js";
import type { ContactChannel } from "./channeltypes.js";
import type { ChannelGroup, GroupStatus, GroupTrigger, GroupWho } from "./channelgrouptypes.js";
import { GROUP_LIMITS } from "./channelgrouptypes.js";
import { audit, bots, newId, now, rows, users, type BotRecord } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS channel_groups (
  id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, channel TEXT NOT NULL, chat_id TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, trigger TEXT NOT NULL DEFAULT 'mention', who TEXT NOT NULL DEFAULT 'approved',
  thread_seq INTEGER, thread_gen INTEGER, last_sent_seq INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, last_seen_at INTEGER,
  UNIQUE (bot_id, channel, chat_id))`);

interface Row {
  id: string; bot_id: string; channel: string; chat_id: string; name: string; status: string; trigger: string; who: string;
  thread_seq: number | null; thread_gen: number | null; last_sent_seq: number; created_at: number; updated_at: number; last_seen_at: number | null;
}
export interface GroupRecord extends ChannelGroup { botId: string; threadSeq: number | null; threadGen: number | null; lastSentSeq: number }
const toGroup = (r: Row): GroupRecord => ({
  id: r.id, botId: r.bot_id, channel: r.channel as ContactChannel, chatId: r.chat_id, name: r.name, status: r.status as GroupStatus,
  trigger: r.trigger === "all" ? "all" : "mention", who: r.who === "everyone" ? "everyone" : "approved",
  createdAt: r.created_at, lastSeenAt: r.last_seen_at, threadSeq: r.thread_seq, threadGen: r.thread_gen, lastSentSeq: r.last_sent_seq,
});
export const publicGroup = (g: GroupRecord): ChannelGroup => ({ id: g.id, channel: g.channel, chatId: g.chatId, name: g.name, status: g.status, trigger: g.trigger, who: g.who, createdAt: g.createdAt, lastSeenAt: g.lastSeenAt });

const find = (botId: string, channel: ContactChannel, chatId: string) => {
  const r = q.get<Row>("SELECT * FROM channel_groups WHERE bot_id = ? AND channel = ? AND chat_id = ?", botId, channel, chatId);
  return r ? toGroup(r) : null;
};
const byId = (botId: string, id: string) => { const r = q.get<Row>("SELECT * FROM channel_groups WHERE bot_id = ? AND id = ?", botId, id); return r ? toGroup(r) : null; };

// ── Rate limits and "said once an hour" notices (memory only: a restart forgets them, which is harmless) ──────────
const hits = new Map<string, number[]>();
function tooFast(key: string, max: number): boolean {
  const t = Date.now();
  const list = (hits.get(key) ?? []).filter((x) => t - x < 60_000);
  list.push(t);
  hits.set(key, list);
  if (hits.size > 5000) hits.delete(hits.keys().next().value!);
  return list.length > max;
}
const told = new Map<string, number>();
/** True when this notice was not said in the last hour (and records it now). */
function sayOnce(key: string): boolean {
  const t = Date.now();
  if ((told.get(key) ?? 0) > t - GROUP_LIMITS.noticeEveryMs) return false;
  told.set(key, t);
  if (told.size > 5000) told.delete(told.keys().next().value!);
  return true;
}

/** How a service posts into one group chat. */
export interface GroupSink { text(text: string): Promise<void> }
const sinks = new Map<ContactChannel, (bot: BotRecord, g: GroupRecord) => GroupSink | null>();
export const registerGroupSink = (channel: ContactChannel, fn: (bot: BotRecord, g: GroupRecord) => GroupSink | null) => { sinks.set(channel, fn); };
export const groupSinkFor = (bot: BotRecord, g: GroupRecord) => sinks.get(g.channel)?.(bot, g) ?? null;

/** Services that must reconnect when a group's trigger changes (Discord asks for message content only when needed). */
const changedHooks = new Map<ContactChannel, (botId: string) => void>();
export const onGroupsChanged = (channel: ContactChannel, fn: (botId: string) => void) => { changedHooks.set(channel, fn); };

/** One message seen in a group chat, as a service read it. */
export interface GroupMessage {
  chatId: string;
  chatName: string;
  sender: { id: string; name: string };
  /** The sender is the owner linked on this service. */
  isOwner: boolean;
  text: string;
  /** @mentioned, or a reply to one of the bot's own messages. */
  addressed: boolean;
  hasFile: boolean;
}

export type GroupOutcome = "ignored" | "told" | "taken" | "limited";

/**
 * A message in a group chat where the bot is. Decides, in this order: is the group known and on, is the bot addressed
 * (per the group's trigger), may this person make it speak (per the group's "who"), not too fast; then hands the text
 * to the bot as a member's message in the group's thread. `reply` answers in the group.
 */
export async function groupMessage(bot: BotRecord, channel: ContactChannel, m: GroupMessage, reply: (t: string) => Promise<unknown>): Promise<GroupOutcome> {
  const loc = users.localeOf(bot.userId);
  const t = now();
  let g = find(bot.id, channel, m.chatId);
  const name = m.chatName.replace(/\s+/g, " ").trim().slice(0, 80) || m.chatId;
  if (!g) {
    // A group is only asked about when someone speaks to the bot there; idle chatter in a new group is ignored.
    if (!m.addressed) return "ignored";
    const waiting = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM channel_groups WHERE bot_id = ? AND channel = ? AND status = 'pending'", bot.id, channel)!.n;
    if (waiting >= GROUP_LIMITS.maxPending) return "ignored";
    q.run("INSERT INTO channel_groups (id, bot_id, channel, chat_id, name, status, created_at, updated_at, last_seen_at) VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?)", newId("grp"), bot.id, channel, m.chatId, name, t, t, t);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[channel]} group "${name}" (${m.chatId}) asks to be turned on`, bot.id);
    pushLater(bot.userId, { kind: "needs", title: bot.name, body: chText(loc, "{bot} was called in the group “{group}” on {channel}: turn it on in Sklubot if you want it to answer there.", { bot: bot.name, group: name, channel: CHANNEL_LABEL[channel] }), botId: bot.id });
    bots.announce(bot);
    sayOnce(`${bot.id}:${channel}:${m.chatId}:off`);
    await reply(chText(loc, "🔒 {bot} does not answer in this group yet: its owner must turn the group on in Sklubot.", { bot: bot.name }));
    return "told";
  }
  q.run("UPDATE channel_groups SET last_seen_at = ?, name = CASE WHEN ? != '' THEN ? ELSE name END WHERE id = ?", t, m.chatName.trim() ? name : "", name, g.id);
  if (g.status === "blocked") return "ignored";
  if (g.status === "pending") {
    if (m.addressed && sayOnce(`${bot.id}:${channel}:${m.chatId}:off`)) { await reply(chText(loc, "🔒 {bot} does not answer in this group yet: its owner must turn the group on in Sklubot.", { bot: bot.name })); return "told"; }
    return "ignored";
  }
  if (g.trigger === "mention" && !m.addressed) return "ignored";
  const allowedPerson = m.isOwner || g.who === "everyone" || access.isAllowed(bot.id, channel, m.sender.id);
  if (!allowedPerson) {
    if (m.addressed && sayOnce(`${bot.id}:${channel}:${m.chatId}:who:${m.sender.id}`)) {
      await reply(chText(loc, "🔒 {name}, {bot} only answers people its owner approved. Write to it in a direct message to ask for access.", { name: m.sender.name, bot: bot.name }));
      return "told";
    }
    return "ignored";
  }
  if (tooFast(`g:${g.id}`, GROUP_LIMITS.perGroupPerMinute) || tooFast(`g:${g.id}:${m.sender.id}`, GROUP_LIMITS.perPersonPerMinute)) {
    if (sayOnce(`${bot.id}:${g.id}:slow`)) await reply(chText(loc, "Slow down a little: too many messages in a minute."));
    return "limited";
  }
  // A pasted secret is masked: a group is no place for it, and the vault is the owner's, filled in the app.
  const text = screenSecrets(m.text.trim(), loc).text;
  if (m.hasFile && !text) { await reply(chText(loc, "🔒 Files are not taken in a group: send them to {bot} in a direct message.", { bot: bot.name })); return "told"; }
  if (!text) return "ignored";
  if (text.length > 20_000) { await reply(chText(loc, "That message is too long.")); return "told"; }
  const fresh = bots.byId(bot.id) ?? bot;
  const thread = groups.threadFor(fresh, g);
  g = byId(bot.id, g.id) ?? g;
  const who = `${m.sender.name} (${g.name}, ${CHANNEL_LABEL[channel]})`;
  const id = `${channel}:group:${g.chatId}:${m.sender.id}`;
  rows.append(fresh, { kind: "message", role: "user", text, origin: { kind: "member", id, name: who } }, thread);
  const role = m.isOwner
    ? `your owner, writing in the shared group chat "${g.name}" on ${CHANNEL_LABEL[channel]}: everyone in that group reads your reply; anything you do still asks your owner privately`
    : `someone in the group chat "${g.name}" on ${CHANNEL_LABEL[channel]} where your owner turned you on; everyone in that group reads your reply`;
  submitMemberMessage(fresh, text, { id, name: who, role, workspace: `${CHANNEL_LABEL[channel]} · ${g.name}` }, false, thread);
  if (isPaused(fresh)) await reply(chText(loc, "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.", { bot: bot.name }));
  return "taken";
}

export const groups = {
  list(botId: string): GroupRecord[] {
    return q.all<Row>("SELECT * FROM channel_groups WHERE bot_id = ? ORDER BY CASE status WHEN 'pending' THEN 0 WHEN 'allowed' THEN 1 ELSE 2 END, created_at DESC LIMIT 200", botId).map(toGroup);
  },
  byId,
  /** The owner's settings for one group: turned on / off (blocked), trigger, who. Null when there is no such group. */
  update(bot: BotRecord, id: string, change: { status?: unknown; trigger?: unknown; who?: unknown }): GroupRecord | null {
    const g = byId(bot.id, id);
    if (!g) return null;
    const status: GroupStatus = change.status === "allowed" || change.status === "blocked" || change.status === "pending" ? change.status : g.status;
    const trigger: GroupTrigger = change.trigger === "all" || change.trigger === "mention" ? change.trigger : g.trigger;
    const who: GroupWho = change.who === "everyone" || change.who === "approved" ? change.who : g.who;
    q.run("UPDATE channel_groups SET status = ?, trigger = ?, who = ?, updated_at = ? WHERE id = ?", status, trigger, who, now(), id);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[g.channel]} group "${g.name}" — ${status}, answers ${trigger === "all" ? "every message" : "when mentioned"}, ${who === "everyone" ? "anyone there" : "approved people only"}`, bot.id);
    if (trigger !== g.trigger || status !== g.status) { try { changedHooks.get(g.channel)?.(bot.id); } catch (err) { console.error("[group changed]", (err as Error).message); } }
    return byId(bot.id, id);
  },
  remove(bot: BotRecord, id: string): boolean {
    const g = byId(bot.id, id);
    if (!g) return false;
    q.run("DELETE FROM channel_groups WHERE id = ?", id);
    audit(bot.userId, "channel", `${bot.name}: ${CHANNEL_LABEL[g.channel]} group "${g.name}" removed`, bot.id);
    try { changedHooks.get(g.channel)?.(bot.id); } catch { /* reconnects later */ }
    return true;
  },
  /** Some group of this bot on this service answers every message (Discord then asks for the message content intent). */
  wantsAll: (botId: string, channel: ContactChannel) => !!q.get("SELECT 1 FROM channel_groups WHERE bot_id = ? AND channel = ? AND status = 'allowed' AND trigger = 'all'", botId, channel),
  byThread(botId: string, generation: number, threadSeq: number): GroupRecord | null {
    const r = q.get<Row>("SELECT * FROM channel_groups WHERE bot_id = ? AND thread_gen = ? AND thread_seq = ? AND status = 'allowed'", botId, generation, threadSeq);
    return r ? toGroup(r) : null;
  },
  markSent: (id: string, seq: number) => q.run("UPDATE channel_groups SET last_sent_seq = MAX(last_sent_seq, ?) WHERE id = ?", seq, id),
  /** The thread of the bot's chat where this group's conversation lives (made on its first message, again after a reset). */
  threadFor(bot: BotRecord, g: GroupRecord): number {
    const fresh = bots.byId(bot.id) ?? bot;
    if (g.threadSeq && g.threadGen === fresh.generation && rows.get(fresh.id, fresh.generation, g.threadSeq)) return g.threadSeq;
    const label = chText(users.localeOf(fresh.userId), "Group “{name}” on {channel}", { name: g.name, channel: CHANNEL_LABEL[g.channel] });
    const head = rows.append(fresh, { kind: "message", role: "user", text: `👥 ${label}`, origin: { kind: "member", id: `${g.channel}:group:${g.chatId}`, name: g.name } }, 0);
    q.run("UPDATE channel_groups SET thread_seq = ?, thread_gen = ?, last_sent_seq = ? WHERE id = ?", head.seq, head.generation, head.seq, g.id);
    return head.seq;
  },
};

