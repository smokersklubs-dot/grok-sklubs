/**
 * L162 + OpenClaw I3 — Slack as a channel to talk to a bot, through a Slack app of the owner's own, in Socket Mode
 * (no public address needed). Modelled on telegram.ts / telegramplus.ts: the owner links their Slack user with a code
 * from the Sklubot screen; approval questions come with ✅ / ❌ buttons (owner only, never a payment, a vault value or the
 * owner's computer); files the owner sends reach the bot's library and files the bot attaches go back; long replies are
 * split; 👀 on a message that arrives while the bot works (Slack offers bots no "typing…" outside its AI-assistant
 * surface). Anyone else in the workspace who writes to the bot gets an access code (channelaccess.ts) and, once the
 * owner approved them, talks to it as a member, never with the owner's rights (channelrelay.ts).
 *
 * Official Slack APIs only (https://docs.slack.dev):
 *  - Socket Mode: apps.connections.open with the app-level token xapp-… (connections:write) returns a WebSocket URL;
 *    every envelope is acknowledged with its envelope_id; "hello", "disconnect", "events_api", "interactive"
 *    (https://docs.slack.dev/apis/events-api/using-socket-mode/, https://docs.slack.dev/reference/methods/apps.connections.open/).
 *  - Events API "message" events of channel_type "im" (scope im:history) and "app_mention"
 *    (https://docs.slack.dev/reference/events/message.im/, https://docs.slack.dev/reference/events/app_mention/).
 *  - Web API with the bot token xoxb-…, JSON bodies (https://docs.slack.dev/apis/web-api/#posting-json): auth.test,
 *    chat.postMessage (chat:write; text recommended under 4,000 characters), chat.update, chat.postEphemeral, users.info
 *    (users:read), conversations.open (im:write), reactions.add (reactions:write), files.getUploadURLExternal +
 *    files.completeUploadExternal (files:write), url_private_download with the bot token (files:read).
 *  - Block Kit "actions" block with "button" elements; a press arrives as an interactive "block_actions" payload
 *    (https://docs.slack.dev/reference/block-kit/blocks/actions-block/, https://docs.slack.dev/reference/interaction-payloads/block_actions-payload/).
 * Every address can point at a local fake for tests (SLACK_API_URL, native/vendors.ts vendorUrl).
 */
import { getLive } from "./bus.js";
import { onTurnEvent } from "./agent/loop.js";
import { assertPublicUrl, guardedFetch } from "./net.js";
import { vendorUrl } from "./native/vendors.js";
import { newLinkCode, onApproved, type ContactRecord } from "./channelaccess.js";
import { answerApproval, ownerMessage, ownerWindowOf, registerContactSink, splitMessage, strangerMessage, type Sink } from "./channelrelay.js";
import { channelStore } from "./channelstore.js";
import { chText } from "./channeltext.js";
import type { SlackChannelStatus } from "./channeltypes.js";
import { storeBytes } from "./computer.js";
import { commandAnswer, privateApproval } from "./telegram.js";
import { audit, bots, users, type BotRecord } from "./store.js";
import type { Attachment } from "./shared.js";

interface Secret { botToken: string; appToken: string }
interface Info { team: string; teamId: string; botUserId: string; botUser: string; ownerId: string | null; ownerDm: string | null; linkCode: string | null; error: string | null }

const MAX_TEXT = 3900;
const MAX_DOWNLOAD = 20 * 1024 * 1024;
const MAX_UPLOAD = 50 * 1024 * 1024;

export class SlackError extends Error {}

const url = (method: string) => vendorUrl("slack", `https://slack.com/api/${method}`);
/** Same origin as Slack's file host (or the test fake): a file address handed back by Slack that our token may follow. */
const isSlackFileUrl = (raw: string) => { try { return new URL(raw).origin === new URL(vendorUrl("slack", "https://files.slack.com/")).origin; } catch { return false; } };

async function call<T = any>(token: string, method: string, body: Record<string, unknown> = {}, form = false): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    const res = await guardedFetch(url(method), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": form ? "application/x-www-form-urlencoded" : "application/json; charset=utf-8" },
      body: form ? new URLSearchParams(Object.entries(body).map(([k, v]) => [k, String(v)])).toString() : JSON.stringify(body),
      signal: AbortSignal.timeout(20_000),
    });
    // Rate limits: HTTP 429 with Retry-After in seconds (https://docs.slack.dev/apis/web-api/rate-limits/). Waited once.
    if (res.status === 429 && attempt === 0) { await new Promise((r) => setTimeout(r, Math.min(30, Number(res.headers.get("retry-after") ?? 1)) * 1000)); continue; }
    const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
    if (!data.ok) throw new SlackError(data.error ?? `Slack answered ${res.status}`);
    return data as T;
  }
}

const load = (botId: string) => channelStore.get<Secret, Info>(botId, "slack");
const patch = (botId: string, change: (i: Info) => Info) => channelStore.patch<Info>(botId, "slack", change);

// ── Sending ──────────────────────────────────────────────────────────────────────────────────────────────────────
async function post(token: string, channel: string, text: string, blocks?: unknown[]): Promise<string | null> {
  let last: string | null = null;
  const parts = splitMessage(text, MAX_TEXT);
  for (const [i, part] of parts.entries()) {
    const extra = blocks && i === parts.length - 1 ? { blocks: [{ type: "section", text: { type: "mrkdwn", text: part.slice(0, 3000) } }, ...blocks] } : {};
    const r = await call<{ ts?: string }>(token, "chat.postMessage", { channel, text: part, ...extra }).catch((err) => { console.error("[slack send]", (err as Error).message); return null; });
    last = r?.ts ?? last;
  }
  return last;
}

/** Uploads one file to a conversation: getUploadURLExternal, the bytes to the upload URL, completeUploadExternal. */
async function upload(token: string, channel: string, a: Pick<Attachment, "name" | "mime">, bytes: Buffer): Promise<boolean> {
  if (bytes.length > MAX_UPLOAD || !bytes.length) return false;
  const u = await call<{ upload_url: string; file_id: string }>(token, "files.getUploadURLExternal", { filename: a.name, length: bytes.length }, true);
  if (!isSlackFileUrl(u.upload_url)) throw new SlackError("unexpected upload address");
  const res = await guardedFetch(u.upload_url, { method: "POST", headers: { "content-type": a.mime || "application/octet-stream" }, body: new Uint8Array(bytes), signal: AbortSignal.timeout(120_000), redirect: "error" });
  if (!res.ok) return false;
  await call(token, "files.completeUploadExternal", { files: [{ id: u.file_id, title: a.name }], channel_id: channel });
  return true;
}

function sinkTo(botId: string, channel: string): Sink | null {
  const s = load(botId);
  if (!s) return null;
  const token = s.secret.botToken;
  return { text: async (t) => { await post(token, channel, t); }, file: (a, bytes) => upload(token, channel, a, bytes) };
}

/** The owner's direct-message conversation with the bot (opened once, kept). */
async function ownerDm(botId: string): Promise<string | null> {
  const s = load(botId);
  if (!s?.info.ownerId) return null;
  if (s.info.ownerDm) return s.info.ownerDm;
  const r = await call<{ channel?: { id?: string } }>(s.secret.botToken, "conversations.open", { users: s.info.ownerId }).catch(() => null);
  const id = r?.channel?.id ?? null;
  if (id) patch(botId, (i) => ({ ...i, ownerDm: id }));
  return id;
}

// ── Receiving ────────────────────────────────────────────────────────────────────────────────────────────────────
const names = new Map<string, { name: string; at: number }>();
async function nameOf(token: string, user: string): Promise<string> {
  const hit = names.get(user);
  if (hit && Date.now() - hit.at < 3600_000) return hit.name;
  const r = await call<{ user?: { real_name?: string; name?: string; profile?: { display_name?: string } } }>(token, "users.info", { user }, true).catch(() => null);
  const name = r?.user?.profile?.display_name || r?.user?.real_name || r?.user?.name || user;
  names.set(user, { name, at: Date.now() });
  if (names.size > 2000) names.delete(names.keys().next().value!);
  return name;
}

interface SlackFile { name?: string; mimetype?: string; size?: number; url_private_download?: string }
interface MessageEvent { type: string; channel_type?: string; channel: string; user?: string; text?: string; ts: string; thread_ts?: string; bot_id?: string; subtype?: string; files?: SlackFile[] }

const COMMANDS: Record<string, "tasks" | "status" | "stop" | "usage" | "memory" | "help"> = {
  taches: "tasks", "tâches": "tasks", tasks: "tasks", etat: "status", "état": "status", status: "status", stop: "stop", usage: "usage",
  memoire: "memory", "mémoire": "memory", memory: "memory", aide: "help", help: "help",
};

async function download(token: string, f: SlackFile): Promise<Buffer> {
  if ((f.size ?? 0) > MAX_DOWNLOAD) throw new RangeError("too large");
  if (!f.url_private_download || !isSlackFileUrl(f.url_private_download)) throw new SlackError("no file address");
  const res = await guardedFetch(f.url_private_download, { headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60_000), redirect: "error" });
  if (!res.ok) throw new SlackError(`file ${res.status}`);
  const bytes = Buffer.from(await res.arrayBuffer());
  if (bytes.length > MAX_DOWNLOAD) throw new RangeError("too large");
  return bytes;
}

export async function handleDm(botId: string, ev: MessageEvent) {
  const bot = bots.byId(botId);
  const s = load(botId);
  if (!bot || !s || !ev.user || ev.bot_id || ev.user === s.info.botUserId) return;
  if (ev.subtype && ev.subtype !== "file_share") return;
  const token = s.secret.botToken;
  const loc = users.localeOf(bot.userId);
  const reply = (t: string) => post(token, ev.channel, t);
  const text = (ev.text ?? "").trim();
  if (!s.info.ownerId) {
    // Not linked yet: only the person who has the code from the Sklubot screen can claim this bot.
    const code = text.replace(/^\/?start\s+/i, "").trim().toUpperCase();
    if (s.info.linkCode && code === s.info.linkCode) {
      patch(botId, (i) => ({ ...i, ownerId: ev.user!, ownerDm: ev.channel, linkCode: null }));
      audit(bot.userId, "channel", `${bot.name}: Slack linked (${s.info.team})`, bot.id);
      await reply(chText(loc, "✅ {bot} is linked to you here.", { bot: bot.name }));
    } else await reply(chText(loc, "🔒 To link this bot, send the code shown in Sklubot."));
    return;
  }
  if (ev.user !== s.info.ownerId) {
    const name = await nameOf(token, ev.user);
    await strangerMessage(bot, "slack", { id: ev.user, name, replyTo: ev.channel }, text, !!ev.files?.length, reply);
    return;
  }
  const cmd = /^[!/]([\p{L}]+)\s*$/u.exec(text)?.[1]?.toLowerCase();
  if (cmd && COMMANDS[cmd]) { await reply(commandAnswer(bot, COMMANDS[cmd])); audit(bot.userId, "channel", `${bot.name}: Slack !${cmd}`, bot.id); return; }
  if (getLive(bot.id).running) void call(token, "reactions.add", { channel: ev.channel, timestamp: ev.ts, name: "eyes" }).catch(() => {});
  const attachments: Attachment[] = [];
  for (const f of ev.files ?? []) {
    try {
      const bytes = await download(token, f);
      const name = String(f.name ?? "file").replace(/[/\\\0]/g, "_").slice(0, 200);
      attachments.push({ ...storeBytes(bot.id, "uploads", name, bytes), mime: f.mimetype || "application/octet-stream" });
      audit(bot.userId, "channel", `${bot.name}: Slack file received (${name})`, bot.id);
    } catch (err) {
      await reply(chText(loc, err instanceof RangeError ? "This file is over 20 MB: send it from the app instead." : "I could not get this file. Try again, or send it from the app."));
    }
  }
  const sink = sinkTo(botId, ev.channel);
  if (!sink) return;
  if (s.info.ownerDm !== ev.channel) patch(botId, (i) => ({ ...i, ownerDm: ev.channel }));
  const out = ownerMessage(bot, "slack", text, attachments, sink);
  if (out.paused) await reply(chText(loc, "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.", { bot: bot.name }));
}

interface BlockAction { type: string; user?: { id: string }; channel?: { id: string }; container?: { channel_id?: string; message_ts?: string }; message?: { ts?: string; text?: string }; actions?: { action_id?: string; value?: string }[] }

export async function handleAction(botId: string, p: BlockAction) {
  const bot = bots.byId(botId);
  const s = load(botId);
  if (!bot || !s || p.type !== "block_actions") return;
  const act = p.actions?.[0];
  if (!act || (act.action_id !== "sk_ap_y" && act.action_id !== "sk_ap_n") || !/^[\w-]{1,80}$/.test(act.value ?? "")) return;
  const token = s.secret.botToken;
  const channel = p.channel?.id ?? p.container?.channel_id ?? "";
  const ts = p.message?.ts ?? p.container?.message_ts ?? "";
  if (!p.user || p.user.id !== s.info.ownerId) {
    if (p.user && channel) await call(token, "chat.postEphemeral", { channel, user: p.user.id, text: chText(users.localeOf(bot.userId), "🔒 Only the owner of this bot can answer.") }).catch(() => {});
    return;
  }
  const said = answerApproval(bot, act.value!, act.action_id === "sk_ap_y", "Slack", privateApproval);
  // The buttons go away and the answer shows in their place.
  if (channel && ts) await call(token, "chat.update", { channel, ts, text: `${p.message?.text ?? ""}\n${said}`.trim(), blocks: [] }).catch(() => {});
}

// ── The connection ───────────────────────────────────────────────────────────────────────────────────────────────
interface Socket { ws: WebSocket | null; stopped: boolean; timer?: NodeJS.Timeout; tries: number }
const sockets = new Map<string, Socket>();

function connect(botId: string, sock: Socket) {
  if (sock.stopped) return;
  const retry = () => {
    if (sock.stopped) return;
    sock.tries = Math.min(sock.tries + 1, 6);
    sock.timer = setTimeout(() => connect(botId, sock), Math.min(60_000, Number(process.env.CHANNEL_RETRY_MS ?? 1000) * 2 ** sock.tries));
    sock.timer.unref?.();
  };
  void (async () => {
    const s = load(botId);
    if (!s || !bots.byId(botId)) { sock.stopped = true; sockets.delete(botId); return; }
    const j = await call<{ url?: string }>(s.secret.appToken, "apps.connections.open", {}, true);
    if (!j.url || !/^wss?:\/\//.test(j.url)) throw new SlackError("Slack did not open a Socket Mode connection");
    // The WebSocket address is checked like any outgoing request: public addresses only.
    await assertPublicUrl(j.url.replace(/^ws/, "http"));
    if (sock.stopped) return;
    const ws = new WebSocket(j.url);
    sock.ws = ws;
    ws.addEventListener("message", (m) => {
      let msg: any;
      try { msg = JSON.parse(String(m.data)); } catch { return; }
      // Every envelope is acknowledged at once, so Slack does not send it again.
      if (msg.envelope_id) ws.send(JSON.stringify({ envelope_id: msg.envelope_id }));
      if (msg.type === "hello") { sock.tries = 0; patch(botId, (i) => ({ ...i, error: null })); }
      else if (msg.type === "disconnect") ws.close();
      else if (msg.type === "events_api") void onEvent(botId, msg.payload?.event).catch((err) => console.error("[slack event]", (err as Error).message));
      else if (msg.type === "interactive") void handleAction(botId, msg.payload ?? {}).catch((err) => console.error("[slack action]", (err as Error).message));
    });
    ws.addEventListener("close", () => { if (sock.ws === ws) sock.ws = null; retry(); });
    ws.addEventListener("error", () => { /* "close" follows */ });
  })().catch((err) => {
    const msg = (err as Error).message;
    patch(botId, (i) => ({ ...i, error: msg }));
    // A revoked or wrong token will not get better by itself: stop until the owner connects again.
    if (/invalid_auth|not_authed|token_revoked|account_inactive/.test(msg)) { sock.stopped = true; sockets.delete(botId); return; }
    retry();
  });
}

async function onEvent(botId: string, ev: MessageEvent | undefined) {
  if (!ev) return;
  if (ev.type === "message" && ev.channel_type === "im") return handleDm(botId, ev);
  if (ev.type === "app_mention" && !ev.bot_id) {
    // In a shared channel the bot only points to its direct messages (where access is checked per person).
    const s = load(botId);
    const bot = bots.byId(botId);
    if (s && bot) await call(s.secret.botToken, "chat.postMessage", { channel: ev.channel, thread_ts: ev.thread_ts ?? ev.ts, text: chText(users.localeOf(bot.userId), "Write to me in a direct message.") }).catch(() => {});
  }
}

function startSocket(botId: string) {
  stopSocket(botId);
  const sock: Socket = { ws: null, stopped: false, tries: 0 };
  sockets.set(botId, sock);
  connect(botId, sock);
}
function stopSocket(botId: string) {
  const s = sockets.get(botId);
  if (!s) return;
  s.stopped = true;
  clearTimeout(s.timer);
  s.ws?.close();
  sockets.delete(botId);
}

const TOKENS = { bot: /^xoxb-[A-Za-z0-9-]{10,200}$/, app: /^xapp-[A-Za-z0-9-]{10,200}$/ };

export const slack = {
  status(bot: BotRecord): SlackChannelStatus {
    const i = channelStore.info<Info>(bot.id, "slack");
    return { connected: !!i, team: i?.team ?? null, botUser: i?.botUser ?? null, linked: !!i?.ownerId, linkCode: i && !i.ownerId ? i.linkCode : null, online: sockets.get(bot.id)?.ws?.readyState === WebSocket.OPEN, error: i?.error ?? null };
  },
  /** Checks the bot token with auth.test, seals both tokens, opens the Socket Mode connection. Tokens never go to a log. */
  async connect(bot: BotRecord, raw: { botToken?: unknown; appToken?: unknown }): Promise<SlackChannelStatus> {
    const botToken = String(raw.botToken ?? "").trim();
    const appToken = String(raw.appToken ?? "").trim();
    if (!TOKENS.bot.test(botToken)) throw new SlackError("The bot token starts with xoxb- (OAuth & Permissions → Bot User OAuth Token).");
    if (!TOKENS.app.test(appToken)) throw new SlackError("The app-level token starts with xapp- (Basic Information → App-Level Tokens, scope connections:write).");
    const me = await call<{ team?: string; team_id?: string; user_id?: string; user?: string }>(botToken, "auth.test").catch((err) => { throw new SlackError(`Slack refused the bot token (${(err as Error).message}).`); });
    await call(appToken, "apps.connections.open", {}, true).catch((err) => { throw new SlackError(`Slack refused the app-level token (${(err as Error).message}). Is Socket Mode on?`); });
    channelStore.set(bot.id, "slack", { botToken, appToken } satisfies Secret, { team: me.team ?? "", teamId: me.team_id ?? "", botUserId: me.user_id ?? "", botUser: me.user ?? "", ownerId: null, ownerDm: null, linkCode: newLinkCode(), error: null } satisfies Info);
    audit(bot.userId, "channel", `${bot.name}: Slack app connected (${me.team ?? "?"})`, bot.id);
    startSocket(bot.id);
    return slack.status(bot);
  },
  disconnect(bot: BotRecord) {
    stopSocket(bot.id);
    channelStore.remove(bot.id, "slack");
    audit(bot.userId, "channel", `${bot.name}: Slack disconnected`, bot.id);
  },
  start() {
    for (const id of channelStore.botsWith("slack")) if (bots.byId(id)) startSocket(id);
    // What the bot waits for (approvals with buttons, questions) and says on its own reaches the owner's Slack.
    onTurnEvent((e) => {
      const s = load(e.bot.id);
      if (!s?.info.ownerId) return;
      if (e.type === "reply" && ownerWindowOf(e.bot.id) === "slack") return; // already sent through the owner's window
      void (async () => {
        const dm = await ownerDm(e.bot.id);
        if (!dm) return;
        const loc = users.localeOf(e.bot.userId);
        if (e.type === "waiting") {
          const answerable = !!e.approvalId && !privateApproval(e.tool ?? "");
          const buttons = answerable ? [{ type: "actions", elements: [
            { type: "button", text: { type: "plain_text", text: `✅ ${chText(loc, "Yes")}` }, style: "primary", action_id: "sk_ap_y", value: e.approvalId },
            { type: "button", text: { type: "plain_text", text: `❌ ${chText(loc, "No")}` }, style: "danger", action_id: "sk_ap_n", value: e.approvalId },
          ] }] : undefined;
          await post(s.secret.botToken, dm, `⏳ ${e.text}${e.approvalId && !answerable ? `\n${chText(loc, "🔒 Answer in the app.")}` : ""}`, buttons);
          return;
        }
        await post(s.secret.botToken, dm, e.text);
      })().catch((err) => console.error("[slack notify]", (err as Error).message));
    });
  },
  stopAll() { for (const id of [...sockets.keys()]) stopSocket(id); },
};

// An approved person's replies go to their direct message with the bot; they hear when the owner approves them.
registerContactSink("slack", (bot, c: ContactRecord) => (c.replyTo ? sinkTo(bot.id, c.replyTo) : null));
onApproved("slack", (bot, c) => { if (c.replyTo) void sinkTo(bot.id, c.replyTo)?.text(chText(users.localeOf(bot.userId), "✅ The owner approved you: you can now write to {bot}.", { bot: bot.name })); });
