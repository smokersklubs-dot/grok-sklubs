/**
 * L162 + OpenClaw I2 — Discord as a channel to talk to a bot, through a Discord application of the owner's own, over the
 * Gateway (no public address needed). Modelled on telegram.ts / telegramplus.ts: the owner links their Discord user by
 * sending the code from the Sklubot screen to the bot in a direct message; approval questions come with ✅ / ❌ buttons
 * (owner only, never a payment, a vault value or the owner's computer); files the owner sends reach the bot's library and
 * files the bot attaches go back; long replies are split under 2,000 characters; "typing…" while the bot works. Anyone
 * else who writes to the bot gets an access code (channelaccess.ts) and, once approved by the owner, talks to it as a
 * member, never with the owner's rights (channelrelay.ts). DS-Bot item 4 (channelgroups.ts): in a server channel the bot
 * answers only once the owner turned that channel on in Sklubot, when @mentioned or replied to (or every message, if set),
 * and only for the people the group's setting allows; approvals never go there, only to the owner's DM.
 *
 * Official Discord APIs only (https://discord.com/developers/docs):
 *  - Gateway: GET /gateway/bot, then wss …?v=10&encoding=json; Hello (op 10) → Identify (op 2) with the
 *    DIRECT_MESSAGES (1 << 12) and GUILD_MESSAGES (1 << 9) intents, plus MESSAGE_CONTENT (1 << 15, privileged) only while
 *    a server channel is set to "every message": without it Discord still gives the content of DMs and of messages that
 *    mention the bot (https://docs.discord.com/developers/events/gateway#message-content-intent); MESSAGE_CREATE carries
 *    `mentions` and, for a reply, `referenced_message` (https://docs.discord.com/developers/resources/message);
 *    GET /channels/{id} gives a server channel's name; a reply in a server channel carries message_reference; Heartbeat (op 1) every heartbeat_interval and Heartbeat ACK (op 11), Reconnect
 *    (op 7), Invalid Session (op 9), Dispatch (op 0) READY, MESSAGE_CREATE, INTERACTION_CREATE; close code 4004 =
 *    authentication failed (https://discord.com/developers/docs/events/gateway,
 *    https://discord.com/developers/docs/topics/opcodes-and-status-codes). Message content of direct messages is sent
 *    without the privileged MESSAGE_CONTENT intent (https://discord.com/developers/docs/events/gateway#message-content-intent).
 *  - REST with "Authorization: Bot <token>": GET /users/@me, GET /oauth2/applications/@me, POST /users/@me/channels
 *    (open a DM), POST /channels/{id}/messages (content up to 2,000 characters, components, files with payload_json),
 *    POST /channels/{id}/typing (https://discord.com/developers/docs/resources/message, /resources/channel,
 *    /resources/user). 429 answers carry retry_after (https://discord.com/developers/docs/topics/rate-limits).
 *  - Buttons: an action row (type 1) of buttons (type 2, custom_id up to 100 characters); a press arrives as an
 *    INTERACTION_CREATE of type 3 and is answered with POST /interactions/{id}/{token}/callback, type 7 (update the
 *    message) or type 4 with flag 64 (only the presser sees it)
 *    (https://discord.com/developers/docs/components/reference, https://discord.com/developers/docs/interactions/receiving-and-responding).
 * Every address can point at a local fake for tests (DISCORD_API_URL).
 */
import { getLive } from "./bus.js";
import { onTurnEvent } from "./agent/loop.js";
import { assertPublicUrl, guardedFetch } from "./net.js";
import { newLinkCode, onApproved, type ContactRecord } from "./channelaccess.js";
import { answerApproval, groupSaid, ownerMessage, ownerWindowOf, registerContactSink, splitMessage, strangerMessage, type Sink } from "./channelrelay.js";
import { groups, onGroupsChanged, registerGroupSink } from "./channelgroups.js";
import { channelStore } from "./channelstore.js";
import { chText } from "./channeltext.js";
import type { DiscordChannelStatus } from "./channeltypes.js";
import { storeBytes } from "./computer.js";
import { commandAnswer, privateApproval } from "./telegram.js";
import { audit, bots, users, type BotRecord } from "./store.js";
import type { Attachment } from "./shared.js";

interface Secret { token: string }
interface Info { botUserId: string; botUser: string; appId: string; ownerId: string | null; ownerDm: string | null; linkCode: string | null; error: string | null }

const MAX_TEXT = 1950;
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const MAX_UPLOAD = 10 * 1024 * 1024;
const DM_INTENTS = (1 << 12) | (1 << 9); // DIRECT_MESSAGES | GUILD_MESSAGES
const MESSAGE_CONTENT = 1 << 15;

export class DiscordError extends Error {}

const base = () => (process.env.DISCORD_API_URL ?? "https://discord.com/api/v10").replace(/\/$/, "");
const headers = (token: string) => ({ authorization: `Bot ${token}`, "user-agent": "DiscordBot (sklubot, 1.0)" });
/** Discord's file hosts (or the test fake): attachment addresses we download from. */
function isDiscordFileUrl(raw: string): boolean {
  try {
    const o = new URL(raw).origin;
    return o === "https://cdn.discordapp.com" || o === "https://media.discordapp.net" || (!!process.env.DISCORD_API_URL && o === new URL(base()).origin);
  } catch { return false; }
}

async function rest<T = any>(token: string, method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const isForm = body instanceof FormData;
    const res = await guardedFetch(`${base()}${path}`, {
      method, headers: { ...headers(token), ...(body !== undefined && !isForm ? { "content-type": "application/json" } : {}) },
      body: body === undefined ? undefined : isForm ? body : JSON.stringify(body), signal: AbortSignal.timeout(30_000),
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, Math.min(30, Number(data?.retry_after ?? 1)) * 1000)); continue; }
    if (!res.ok) throw new DiscordError(data?.message ? `${data.message} (${res.status})` : `Discord answered ${res.status}`);
    return data as T;
  }
}

const load = (botId: string) => channelStore.get<Secret, Info>(botId, "discord");
const patch = (botId: string, change: (i: Info) => Info) => channelStore.patch<Info>(botId, "discord", change);

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function post(token: string, channel: string, text: string, components?: unknown[], replyTo?: string): Promise<string | null> {
  let last: string | null = null;
  const parts = splitMessage(text, MAX_TEXT);
  for (const [i, part] of parts.entries()) {
    const extra = { ...(components && i === parts.length - 1 ? { components } : {}), ...(replyTo && i === 0 ? { message_reference: { message_id: replyTo, fail_if_not_exists: false } } : {}) };
    const m = await rest<{ id?: string }>(token, "POST", `/channels/${encodeURIComponent(channel)}/messages`, { content: part, allowed_mentions: { parse: [] }, ...extra }).catch((err) => { console.error("[discord send]", (err as Error).message); return null; });
    last = m?.id ?? last;
  }
  return last;
}

async function upload(token: string, channel: string, a: Pick<Attachment, "name" | "mime">, bytes: Buffer): Promise<boolean> {
  if (bytes.length > MAX_UPLOAD || !bytes.length) return false;
  const form = new FormData();
  form.set("payload_json", JSON.stringify({ attachments: [{ id: 0, filename: a.name }] }));
  form.set("files[0]", new Blob([new Uint8Array(bytes)], { type: a.mime || "application/octet-stream" }), a.name);
  await rest(token, "POST", `/channels/${encodeURIComponent(channel)}/messages`, form);
  return true;
}

function sinkTo(botId: string, channel: string): Sink | null {
  const s = load(botId);
  if (!s) return null;
  return { text: async (t) => { await post(s.secret.token, channel, t); }, file: (a, bytes) => upload(s.secret.token, channel, a, bytes) };
}

async function ownerDm(botId: string): Promise<string | null> {
  const s = load(botId);
  if (!s?.info.ownerId) return null;
  if (s.info.ownerDm) return s.info.ownerDm;
  const ch = await rest<{ id?: string }>(s.secret.token, "POST", "/users/@me/channels", { recipient_id: s.info.ownerId }).catch(() => null);
  if (ch?.id) patch(botId, (i) => ({ ...i, ownerDm: ch.id! }));
  return ch?.id ?? null;
}

/** "typing…" in the conversation while the bot works (each call shows it about 10 s), at most 10 minutes. */
function keepTyping(botId: string, token: string, channel: string) {
  const started = Date.now();
  const tick = () => {
    if (Date.now() - started > 10 * 60_000 || (Date.now() - started > 8000 && !getLive(botId).running)) return;
    void rest(token, "POST", `/channels/${encodeURIComponent(channel)}/typing`).catch(() => {});
    setTimeout(tick, 8000).unref();
  };
  tick();
}

// ── Receiving ────────────────────────────────────────────────────────────────────────────────────────────────────
interface DiscordAttachment { filename?: string; size?: number; url?: string; content_type?: string }
interface MessageCreate { id: string; channel_id: string; guild_id?: string; content?: string; author?: { id: string; username?: string; global_name?: string | null; bot?: boolean }; attachments?: DiscordAttachment[]; mentions?: { id: string }[]; referenced_message?: { author?: { id: string } } | null }

/** The message a group reply answers (the last one that called the bot there), and channel names, in memory. */
const lastCall = new Map<string, string>();
const channelNames = new Map<string, string>();
async function channelName(token: string, id: string): Promise<string> {
  const hit = channelNames.get(id);
  if (hit !== undefined) return hit;
  const ch = await rest<{ name?: string }>(token, "GET", `/channels/${encodeURIComponent(id)}`).catch(() => null);
  const name = ch?.name ? `#${ch.name}` : "";
  channelNames.set(id, name);
  if (channelNames.size > 2000) channelNames.delete(channelNames.keys().next().value!);
  return name;
}

/** DS-Bot item 4: a message in a server channel (channelgroups.ts decides whether it reaches the bot). */
async function handleGuildMessage(bot: BotRecord, s: { secret: Secret; info: Info }, m: MessageCreate) {
  const self = s.info.botUserId;
  const mentioned = (m.mentions ?? []).some((u) => u.id === self) || m.referenced_message?.author?.id === self;
  const text = (m.content ?? "").replaceAll(`<@${self}>`, "").replaceAll(`<@!${self}>`, "").trim();
  const token = s.secret.token;
  const name = await channelName(token, m.channel_id);
  const said = await groupSaid(bot, "discord", {
    chatId: m.channel_id, chatName: name, sender: { id: m.author!.id, name: m.author!.global_name || m.author!.username || m.author!.id },
    isOwner: !!s.info.ownerId && m.author!.id === s.info.ownerId, text, addressed: mentioned, hasFile: !!m.attachments?.length,
  }, (t) => post(token, m.channel_id, t, undefined, m.id));
  if (said === "taken") { lastCall.set(`${bot.id}:${m.channel_id}`, m.id); keepTyping(bot.id, token, m.channel_id); }
}

const COMMANDS: Record<string, "tasks" | "status" | "stop" | "usage" | "memory" | "help"> = {
  taches: "tasks", "tâches": "tasks", tasks: "tasks", etat: "status", "état": "status", status: "status", stop: "stop", usage: "usage",
  memoire: "memory", "mémoire": "memory", memory: "memory", aide: "help", help: "help",
};

async function download(f: DiscordAttachment): Promise<Buffer> {
  if ((f.size ?? 0) > MAX_DOWNLOAD) throw new RangeError("too large");
  if (!f.url || !isDiscordFileUrl(f.url)) throw new DiscordError("no file address");
  const res = await guardedFetch(f.url, { signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!res.ok) throw new DiscordError(`file ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new RangeError("too large");
  return bytes;
}

export async function handleMessage(botId: string, m: MessageCreate) {
  const bot = bots.byId(botId);
  const s = load(botId);
  if (!bot || !s || !m.author || m.author.bot || m.author.id === s.info.botUserId) return;
  if (m.guild_id) { await handleGuildMessage(bot, s, m); return; }
  const token = s.secret.token;
  const loc = users.localeOf(bot.userId);
  const reply = (t: string) => post(token, m.channel_id, t);
  const text = (m.content ?? "").trim();
  if (!s.info.ownerId) {
    const code = text.replace(/^\/?start\s+/i, "").trim().toUpperCase();
    if (s.info.linkCode && code === s.info.linkCode) {
      patch(botId, (i) => ({ ...i, ownerId: m.author!.id, ownerDm: m.channel_id, linkCode: null }));
      audit(bot.userId, "channel", `${bot.name}: Discord linked`, bot.id);
      await reply(chText(loc, "✅ {bot} is linked to you here.", { bot: bot.name }));
    } else await reply(chText(loc, "🔒 To link this bot, send the code shown in Sklubot."));
    return;
  }
  if (m.author.id !== s.info.ownerId) {
    await strangerMessage(bot, "discord", { id: m.author.id, name: m.author.global_name || m.author.username || m.author.id, replyTo: m.channel_id }, text, !!m.attachments?.length, reply);
    return;
  }
  const cmd = /^[!/]([\p{L}]+)\s*$/u.exec(text)?.[1]?.toLowerCase();
  if (cmd && COMMANDS[cmd]) { await reply(commandAnswer(bot, COMMANDS[cmd])); audit(bot.userId, "channel", `${bot.name}: Discord !${cmd}`, bot.id); return; }
  const attachments: Attachment[] = [];
  for (const f of m.attachments ?? []) {
    try {
      const bytes = await download(f);
      const name = String(f.filename ?? "file").replace(/[/\\\0]/g, "_").slice(0, 200);
      attachments.push({ ...storeBytes(bot.id, "uploads", name, bytes), mime: f.content_type || "application/octet-stream" });
      audit(bot.userId, "channel", `${bot.name}: Discord file received (${name})`, bot.id);
    } catch (err) {
      await reply(chText(loc, err instanceof RangeError ? "This file is over 20 MB: send it from the app instead." : "I could not get this file. Try again, or send it from the app."));
    }
  }
  const sink = sinkTo(botId, m.channel_id);
  if (!sink) return;
  if (s.info.ownerDm !== m.channel_id) patch(botId, (i) => ({ ...i, ownerDm: m.channel_id }));
  const out = ownerMessage(bot, "discord", text, attachments, sink);
  if (out.paused) await reply(chText(loc, "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.", { bot: bot.name }));
  else keepTyping(bot.id, token, m.channel_id);
}

interface Interaction { id: string; token: string; type: number; data?: { custom_id?: string }; user?: { id: string }; member?: { user?: { id: string } }; message?: { content?: string } }

export async function handleInteraction(botId: string, it: Interaction) {
  const bot = bots.byId(botId);
  const s = load(botId);
  if (!bot || !s || it.type !== 3) return;
  const respond = (body: unknown) => rest(s.secret.token, "POST", `/interactions/${encodeURIComponent(it.id)}/${encodeURIComponent(it.token)}/callback`, body).catch(() => {});
  const loc = users.localeOf(bot.userId);
  const m = /^ap:([\w-]{1,90}):([yn])$/.exec(it.data?.custom_id ?? "");
  if (!m) return;
  const presser = it.user?.id ?? it.member?.user?.id;
  if (!presser || presser !== s.info.ownerId) { await respond({ type: 4, data: { content: chText(loc, "🔒 Only the owner of this bot can answer."), flags: 64 } }); return; }
  const said = answerApproval(bot, m[1], m[2] === "y", "Discord", privateApproval);
  if (said === chText(loc, "🔒 This one must be answered in the app.")) { await respond({ type: 4, data: { content: said, flags: 64 } }); return; }
  // The buttons go away and the answer shows in the message.
  await respond({ type: 7, data: { content: `${it.message?.content ?? ""}\n${said}`.trim().slice(0, 2000), components: [] } });
}

// ── The Gateway connection ───────────────────────────────────────────────────────────────────────────────────────
interface Socket { ws: WebSocket | null; stopped: boolean; timer?: NodeJS.Timeout; beat?: NodeJS.Timeout; tries: number; seq: number | null; acked: boolean; content?: boolean; noContent?: boolean }
const sockets = new Map<string, Socket>();

function connect(botId: string, sock: Socket) {
  if (sock.stopped) return;
  const retry = () => {
    clearInterval(sock.beat);
    if (sock.stopped) return;
    sock.tries = Math.min(sock.tries + 1, 6);
    sock.timer = setTimeout(() => connect(botId, sock), Math.min(60_000, Number(process.env.CHANNEL_RETRY_MS ?? 1000) * 2 ** sock.tries));
    sock.timer.unref?.();
  };
  void (async () => {
    const s = load(botId);
    if (!s || !bots.byId(botId)) { sock.stopped = true; sockets.delete(botId); return; }
    const g = await rest<{ url?: string }>(s.secret.token, "GET", "/gateway/bot");
    if (!g.url || !/^wss?:\/\//.test(g.url)) throw new DiscordError("Discord did not give a Gateway address");
    await assertPublicUrl(g.url.replace(/^ws/, "http"));
    if (sock.stopped) return;
    const ws = new WebSocket(`${g.url.replace(/\/$/, "")}/?v=10&encoding=json`);
    sock.ws = ws;
    sock.seq = null;
    const send = (op: number, d: unknown) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ op, d })); };
    ws.addEventListener("message", (ev) => {
      let msg: { op: number; d: any; s?: number | null; t?: string | null };
      try { msg = JSON.parse(String(ev.data)); } catch { return; }
      if (typeof msg.s === "number") sock.seq = msg.s;
      if (msg.op === 10) {
        const every = Math.max(1000, Number(msg.d?.heartbeat_interval) || 41_250);
        sock.acked = true;
        clearInterval(sock.beat);
        // A heartbeat not acknowledged before the next one: the connection is dead (zombied), reconnect.
        sock.beat = setInterval(() => { if (!sock.acked) { ws.close(4000); return; } sock.acked = false; send(1, sock.seq); }, every);
        sock.beat.unref?.();
        sock.content = !sock.noContent && groups.wantsAll(botId, "discord");
        send(2, { token: s.secret.token, intents: DM_INTENTS | (sock.content ? MESSAGE_CONTENT : 0), properties: { os: process.platform, browser: "sklubot", device: "sklubot" } });
      } else if (msg.op === 11) sock.acked = true;
      else if (msg.op === 1) send(1, sock.seq);
      else if (msg.op === 7 || msg.op === 9) ws.close(4000);
      else if (msg.op === 0 && msg.t === "READY") { sock.tries = 0; patch(botId, (i) => ({ ...i, error: sock.noContent ? "MESSAGE_CONTENT_INTENT" : null, botUserId: msg.d?.user?.id ?? i.botUserId })); }
      else if (msg.op === 0 && msg.t === "MESSAGE_CREATE") void handleMessage(botId, msg.d).catch((err) => console.error("[discord message]", (err as Error).message));
      else if (msg.op === 0 && msg.t === "INTERACTION_CREATE") void handleInteraction(botId, msg.d).catch((err) => console.error("[discord interaction]", (err as Error).message));
    });
    ws.addEventListener("close", (ev) => {
      if (sock.ws === ws) sock.ws = null;
      clearInterval(sock.beat);
      // 4014 while asking for message content: the owner has not turned on that intent in the Developer Portal; carry
      // on without it (direct messages and mentions still work) and say so on the settings screen.
      if (ev.code === 4014 && sock.content) { sock.noContent = true; patch(botId, (i) => ({ ...i, error: "MESSAGE_CONTENT_INTENT" })); retry(); return; }
      // 4004 authentication failed, 4013/4014 invalid or disallowed intents: retrying will not help.
      if (ev.code === 4004 || ev.code === 4013 || ev.code === 4014) { patch(botId, (i) => ({ ...i, error: `Discord closed the connection (${ev.code})` })); sock.stopped = true; sockets.delete(botId); return; }
      retry();
    });
    ws.addEventListener("error", () => { /* "close" follows */ });
  })().catch((err) => {
    patch(botId, (i) => ({ ...i, error: (err as Error).message }));
    if (/\(401\)/.test((err as Error).message)) { sock.stopped = true; sockets.delete(botId); return; }
    retry();
  });
}

function startSocket(botId: string) {
  stopSocket(botId);
  const sock: Socket = { ws: null, stopped: false, tries: 0, seq: null, acked: true };
  sockets.set(botId, sock);
  connect(botId, sock);
}
function stopSocket(botId: string) {
  const s = sockets.get(botId);
  if (!s) return;
  s.stopped = true;
  clearTimeout(s.timer);
  clearInterval(s.beat);
  s.ws?.close();
  sockets.delete(botId);
}

export const discord = {
  status(bot: BotRecord): DiscordChannelStatus {
    const i = channelStore.info<Info>(bot.id, "discord");
    return {
      connected: !!i, botUser: i?.botUser ?? null, linked: !!i?.ownerId, linkCode: i && !i.ownerId ? i.linkCode : null,
      online: sockets.get(bot.id)?.ws?.readyState === WebSocket.OPEN, error: i?.error ?? null,
      // OAuth2 URL that adds the bot to a server (scope "bot"): https://discord.com/developers/docs/topics/oauth2#bot-authorization-flow
      inviteUrl: i?.appId ? `https://discord.com/oauth2/authorize?client_id=${encodeURIComponent(i.appId)}&scope=bot` : null,
    };
  },
  /** Checks the token (GET /users/@me), seals it, opens the Gateway connection. The token never goes to a log. */
  async connect(bot: BotRecord, raw: { token?: unknown }): Promise<DiscordChannelStatus> {
    const token = String(raw.token ?? "").trim();
    if (!/^[A-Za-z0-9_.-]{50,120}$/.test(token)) throw new DiscordError("That does not look like a Discord bot token (Developer Portal → your application → Bot → Reset Token).");
    const me = await rest<{ id?: string; username?: string; bot?: boolean }>(token, "GET", "/users/@me").catch((err) => { throw new DiscordError(`Discord refused this token (${(err as Error).message}).`); });
    if (!me.id || !me.bot) throw new DiscordError("This token is not a bot's.");
    const app = await rest<{ id?: string }>(token, "GET", "/oauth2/applications/@me").catch(() => ({ id: "" }));
    channelStore.set(bot.id, "discord", { token } satisfies Secret, { botUserId: me.id, botUser: me.username ?? "", appId: app.id ?? "", ownerId: null, ownerDm: null, linkCode: newLinkCode(), error: null } satisfies Info);
    audit(bot.userId, "channel", `${bot.name}: Discord bot ${me.username ?? "?"} connected`, bot.id);
    startSocket(bot.id);
    return discord.status(bot);
  },
  disconnect(bot: BotRecord) {
    stopSocket(bot.id);
    channelStore.remove(bot.id, "discord");
    audit(bot.userId, "channel", `${bot.name}: Discord disconnected`, bot.id);
  },
  start() {
    for (const id of channelStore.botsWith("discord")) if (bots.byId(id)) startSocket(id);
    onTurnEvent((e) => {
      const s = load(e.bot.id);
      if (!s?.info.ownerId) return;
      if (e.type === "reply" && ownerWindowOf(e.bot.id) === "discord") return;
      void (async () => {
        const dm = await ownerDm(e.bot.id);
        if (!dm) return;
        const loc = users.localeOf(e.bot.userId);
        if (e.type === "waiting") {
          const answerable = !!e.approvalId && !privateApproval(e.tool ?? "");
          const components = answerable ? [{ type: 1, components: [
            { type: 2, style: 3, label: `✅ ${chText(loc, "Yes")}`, custom_id: `ap:${e.approvalId}:y`.slice(0, 100) },
            { type: 2, style: 4, label: `❌ ${chText(loc, "No")}`, custom_id: `ap:${e.approvalId}:n`.slice(0, 100) },
          ] }] : undefined;
          await post(s.secret.token, dm, `⏳ ${e.text}${e.approvalId && !answerable ? `\n${chText(loc, "🔒 Answer in the app.")}` : ""}`, components);
          return;
        }
        await post(s.secret.token, dm, e.text);
      })().catch((err) => console.error("[discord notify]", (err as Error).message));
    });
  },
  stopAll() { for (const id of [...sockets.keys()]) stopSocket(id); },
};

// A group's replies go back to its channel, as an answer to the message that called the bot; a change of trigger
// reconnects (to ask for message content, or stop asking).
registerGroupSink("discord", (bot, g) => { const s = load(bot.id); return s ? { text: async (t) => { await post(s.secret.token, g.chatId, t, undefined, lastCall.get(`${bot.id}:${g.chatId}`)); } } : null; });
onGroupsChanged("discord", (botId) => { const sock = sockets.get(botId); if (sock && !!sock.content !== groups.wantsAll(botId, "discord")) startSocket(botId); });
// An approved person's replies go to their direct message with the bot; they hear when the owner approves them.
registerContactSink("discord", (bot, c: ContactRecord) => (c.replyTo ? sinkTo(bot.id, c.replyTo) : null));
onApproved("discord", (bot, c) => { if (c.replyTo) void sinkTo(bot.id, c.replyTo)?.text(chText(users.localeOf(bot.userId), "✅ The owner approved you: you can now write to {bot}.", { bot: bot.name })); });
