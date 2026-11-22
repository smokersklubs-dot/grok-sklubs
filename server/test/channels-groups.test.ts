import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

// DS-Bot item 4 (channelgroups.ts): Slack channels, Discord server channels and Telegram groups, against one fake server
// for the three services (no real network). A group is pending until the owner turns it on; the bot answers only when
// called (mention or reply) unless set to every message; only the people the group's setting allows; everything said
// there is a member's message in a thread of its own, the reply goes back to that group; approvals stay in the owner's
// DM; rate limits; blocked groups are silent.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-channels-groups-"));
process.env.SESSION_SECRET = "channels-groups-secret-channels-group";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.CHANNEL_RETRY_MS = "50";
process.env.TELEGRAM_RETRY_MS = "30";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const DTOKEN = "fake-for-tests." + "g".repeat(60);
const SBOT = "xoxb-fake-for-tests-0101", SAPP = "xapp-fake-for-tests-0102";
const dcalls: { method: string; path: string; body: any }[] = [];
const scalls: { method: string; body: any }[] = [];
const tsent: { method: string; body: any }[] = [];
const tupdates: any[] = [];
const identifies: any[] = [];
let dsockets: WsSocket[] = [], ssockets: WsSocket[] = [];
let port = 0, tUpdate = 1, tMsg = 500;
let closeNextWith = 0;

const local = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  res.setHeader("content-type", "application/json");
  const ct = String(req.headers["content-type"] ?? "");
  const body = ct.includes("json") ? JSON.parse(raw || "{}") : Object.fromEntries(new URLSearchParams(raw));
  if (url.pathname.startsWith("/discord/api/v10")) {
    const p = url.pathname.slice("/discord/api/v10".length);
    dcalls.push({ method: req.method ?? "", path: p, body });
    if (p === "/users/@me") return res.end(JSON.stringify({ id: "900000000000000009", username: "sklubot", bot: true }));
    if (p === "/oauth2/applications/@me") return res.end(JSON.stringify({ id: "800000000000000009" }));
    if (p === "/gateway/bot") return res.end(JSON.stringify({ url: `ws://127.0.0.1:${port}/discord-gw` }));
    if (p === "/users/@me/channels") return res.end(JSON.stringify({ id: "700000000000000001" }));
    if (p === "/channels/600000000000000001") return res.end(JSON.stringify({ id: "600000000000000001", name: "projet" }));
    if (/\/typing$/.test(p)) { res.statusCode = 204; res.end(); return; }
    return res.end(JSON.stringify({ id: String(Date.now()) }));
  }
  const sm = /^\/slack\/api\/([\w.]+)$/.exec(url.pathname);
  if (sm) {
    scalls.push({ method: sm[1], body });
    const ok = (o: Record<string, unknown> = {}) => res.end(JSON.stringify({ ok: true, ...o }));
    if (sm[1] === "apps.connections.open") return ok({ url: `ws://127.0.0.1:${port}/slack-socket` });
    if (sm[1] === "auth.test") return ok({ team: "Équipe", team_id: "T1", user_id: "UBOT0009", user: "sklubot" });
    if (sm[1] === "users.info") return ok({ user: { real_name: body.user === "UOWNER001" ? "Owner" : "Camille", profile: { display_name: "" } } });
    if (sm[1] === "conversations.open") return ok({ channel: { id: "DOWNER09" } });
    if (sm[1] === "conversations.info") return ok({ channel: { name: "general" } });
    if (sm[1] === "chat.postMessage") return ok({ ts: `${Date.now()}.0009` });
    return ok();
  }
  const tg = /^\/tg\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  if (tg) {
    const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
    if (tg[2] === "getUpdates") {
      for (let i = 0; i < 15 && !tupdates.some((u) => u.update_id >= body.offset); i++) await new Promise((r) => setTimeout(r, 20));
      return ok(tupdates.filter((u) => u.update_id >= body.offset));
    }
    tsent.push({ method: tg[2], body });
    if (tg[2] === "getMe") return ok({ id: 4242, is_bot: true, username: "groupes_test_bot" });
    return ok({ message_id: ++tMsg });
  }
  res.statusCode = 404; res.end("{}");
});
const dwss = new WebSocketServer({ noServer: true });
const swss = new WebSocketServer({ noServer: true });
local.on("upgrade", (req, sock, head) => {
  const target = req.url?.startsWith("/discord-gw") ? dwss : req.url?.startsWith("/slack-socket") ? swss : null;
  if (!target) { sock.destroy(); return; }
  target.handleUpgrade(req, sock, head, (ws) => target.emit("connection", ws, req));
});
dwss.on("connection", (ws) => {
  dsockets.push(ws);
  ws.on("message", (d) => {
    const j = JSON.parse(String(d));
    if (j.op === 2) {
      identifies.push(j.d);
      if (closeNextWith) { const code = closeNextWith; closeNextWith = 0; ws.close(code); return; }
      ws.send(JSON.stringify({ op: 0, t: "READY", s: 1, d: { user: { id: "900000000000000009" }, session_id: "s" } }));
    }
    if (j.op === 1) ws.send(JSON.stringify({ op: 11 }));
  });
  ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 300 } }));
});
swss.on("connection", (ws) => { ssockets.push(ws); ws.send(JSON.stringify({ type: "hello" })); });
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
port = (local.address() as { port: number }).port;
process.env.DISCORD_API_URL = `http://127.0.0.1:${port}/discord/api/v10`;
process.env.SLACK_API_URL = `http://127.0.0.1:${port}/slack`;
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${port}/tg`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { channels } = await import("../src/channelroutes.js");
const { telegram } = await import("../src/telegram.js");
const { tell } = await import("../src/agent/loop.js");
const { bots, approvals, rows } = await import("../src/store.js");
const { GROUP_LIMITS } = await import("../src/channelgrouptypes.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const seen: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    return { content: [{ type: "text", text: "Réponse du bot." }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});
const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies.a ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies.a = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(fn: () => T | Promise<T>, what: string, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as NonNullable<T>; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
}
const settle = (ms = 300) => new Promise((r) => setTimeout(r, ms));
after(() => { channels.stopAll(); telegram.stopAll(); for (const s of [...dsockets, ...ssockets]) s.terminate(); dwss.close(); swss.close(); local.closeAllConnections(); local.close(); });

channels.start();
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
const botId = (await call("GET", "/bots")).json.bots[0].id;
const groupsOf = async () => (await call("GET", `/bots/${botId}/channels`)).json.groups as any[];
const threadRows = (thread: number) => rows.list(botId, bots.byId(botId)!.generation, 400, undefined, thread);

// ── Discord ─────────────────────────────────────────────────────────────────────────────────────────────────────
let seq = 10;
const dispatch = (t: string, d: unknown) => dsockets.at(-1)!.send(JSON.stringify({ op: 0, t, s: ++seq, d }));
const OWNER = { id: "100000000000000009", username: "owner" };
const LEA = { id: "200000000000000009", username: "lea", global_name: "Léa" };
const GUILD = { guild_id: "500000000000000009" };
const CH = "600000000000000001";
const gmsg = (author: object, content: string, extra: Record<string, unknown> = {}) => { const id = String(++seq); dispatch("MESSAGE_CREATE", { id, channel_id: CH, author, content, attachments: [], mentions: [], ...GUILD, ...extra }); return id; };
const mention = { mentions: [{ id: "900000000000000009" }] };
const postsTo = (ch: string) => dcalls.filter((c) => c.method === "POST" && c.path === `/channels/${ch}/messages`);

test("Discord: connects with DM + server-message intents (no message content yet); the owner links", async () => {
  await call("PUT", `/bots/${botId}/channels/discord`, { token: DTOKEN });
  const id = await until(() => identifies[0], "identify");
  assert.equal(id.intents, (1 << 12) | (1 << 9));
  const code = (await call("GET", `/bots/${botId}/channels`)).json.discord.linkCode;
  dispatch("MESSAGE_CREATE", { id: "1", channel_id: "700000000000000001", author: OWNER, content: code, attachments: [] });
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.discord.linked, "linked");
});

test("Discord: a new server channel is ignored until the bot is called, then pending (told once, nothing reaches the bot)", async () => {
  const n = seen.length;
  gmsg(OWNER, "bavardage sans mention");
  await settle();
  assert.equal(postsTo(CH).length, 0);
  assert.equal((await groupsOf()).length, 0);
  gmsg(LEA, "<@900000000000000009> tu es là ?", mention);
  const told = await until(() => postsTo(CH).find((c) => /ne répond pas encore dans ce groupe/.test(c.body.content)), "pending notice");
  assert.ok(told.body.message_reference?.message_id, "answers the message that called it");
  gmsg(LEA, "<@900000000000000009> allô ?", mention);
  await settle();
  assert.equal(postsTo(CH).filter((c) => /ne répond pas encore/.test(c.body.content)).length, 1, "told at most once an hour");
  const g = (await groupsOf()).find((x) => x.channel === "discord");
  assert.deepEqual([g.status, g.name, g.trigger, g.who], ["pending", "#projet", "mention", "approved"]);
  assert.equal(seen.length, n, "nothing reached the bot");
});

test("Discord: turned on — only approved people, only when called; a member's message in the group's thread; the reply goes to the group", async () => {
  const g = (await groupsOf()).find((x) => x.channel === "discord");
  const r = await call("PATCH", `/bots/${botId}/channel-groups/${g.id}`, { status: "allowed" });
  assert.equal(r.json.groups.find((x: any) => x.id === g.id).status, "allowed");
  const n = seen.length;
  gmsg(LEA, "<@900000000000000009> donne-moi le code wifi", mention);
  await until(() => postsTo(CH).find((c) => /ne répond qu.aux personnes que son propriétaire a acceptées/.test(c.body.content)), "not approved");
  await settle();
  assert.equal(seen.length, n, "an unapproved person does not reach the bot");
  gmsg(OWNER, "quoi de neuf ?");
  await settle();
  assert.equal(seen.length, n, "not called: ignored in mention mode");
  const before = postsTo(CH).length;
  const called = gmsg(OWNER, "<@900000000000000009> fais le point du projet", mention);
  await until(() => seen.length > n, "group turn");
  const reply = await until(() => postsTo(CH).slice(before).find((c) => /Réponse du bot/.test(c.body.content)), "reply in the group");
  assert.equal(reply.body.message_reference.message_id, called);
  assert.ok(!postsTo("700000000000000001").some((c) => /Réponse du bot/.test(c.body.content)), "not sent to the owner's DM");
  const head = rows.list(botId, bots.byId(botId)!.generation, 400).find((x) => x.body.kind === "message" && /Groupe « #projet » sur Discord/.test(x.body.text))!;
  const said = threadRows(head.seq).find((x) => x.body.kind === "message" && x.body.text === "fais le point du projet")!;
  assert.equal(said.body.kind === "message" && said.body.origin?.kind, "member", "even the owner's words in a group are a member's");
  assert.match(JSON.stringify(seen.at(-1)!.messages), /fais le point du projet/);
  // A reply to one of the bot's messages calls it too.
  const k = seen.length;
  gmsg(OWNER, "et ensuite ?", { referenced_message: { author: { id: "900000000000000009" } } });
  await until(() => seen.length > k, "reply calls the bot");
});

test("Discord: an approval during group work goes to the owner's DM only, never into the group", async () => {
  const bot = bots.byId(botId)!;
  const a = approvals.create(bot.id, bot.userId, bot.generation, 1, "app_calendar__create", undefined, "dg1");
  const before = postsTo(CH).length;
  tell({ type: "waiting", bot, text: "Créer l'événement du groupe ?", approvalId: a.id, tool: "app_calendar__create" });
  await until(() => postsTo("700000000000000001").find((c) => /Créer l'événement du groupe/.test(c.body.content) && c.body.components), "approval in the DM");
  await settle();
  assert.ok(!postsTo(CH).slice(before).some((c) => /Créer l'événement/.test(c.body.content) || c.body.components), "no approval in the group");
});

test("Discord: 'everyone', 'every message' (asks for message content; falls back without it on 4014), rate limit, blocked", async () => {
  const g = (await groupsOf()).find((x) => x.channel === "discord");
  closeNextWith = 4014;
  const ids = identifies.length;
  await call("PATCH", `/bots/${botId}/channel-groups/${g.id}`, { trigger: "all", who: "everyone" });
  const withContent = await until(() => identifies.slice(ids).find((x) => x.intents & (1 << 15)), "identify with MESSAGE_CONTENT");
  assert.equal(withContent.intents, (1 << 12) | (1 << 9) | (1 << 15));
  await until(() => identifies.slice(ids).find((x) => x !== withContent && !(x.intents & (1 << 15))), "reconnected without it");
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.discord.error === "MESSAGE_CONTENT_INTENT", "error shown");
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.discord.online, "online again");
  const n = seen.length;
  gmsg(LEA, "sans mention, mais tout le monde peut parler");
  await until(() => seen.length > n, "Léa reaches the bot");
  // Rate limit per person: the 9th message in a minute is refused, said once.
  for (let i = 0; i < GROUP_LIMITS.perPersonPerMinute + 2; i++) gmsg(LEA, `message ${i}`);
  await until(() => postsTo(CH).find((c) => /Doucement/.test(c.body.content)), "slow down");
  await settle();
  const head = rows.list(botId, bots.byId(botId)!.generation, 400).find((x) => x.body.kind === "message" && /Groupe « #projet »/.test(x.body.text))!;
  const fromLea = threadRows(head.seq).filter((x) => x.body.kind === "message" && x.body.role === "user" && x.body.origin?.name?.startsWith("Léa"));
  assert.ok(fromLea.length <= GROUP_LIMITS.perPersonPerMinute, `at most ${GROUP_LIMITS.perPersonPerMinute} a minute (${fromLea.length})`);
  await call("PATCH", `/bots/${botId}/channel-groups/${g.id}`, { status: "blocked" });
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.discord.online, "online after the change");
  await settle();
  const before = postsTo(CH).length, k = seen.length;
  gmsg(OWNER, "<@900000000000000009> tu m'entends ?", mention);
  await settle(400);
  assert.equal(postsTo(CH).length, before, "a blocked group: silence");
  assert.equal(seen.length, k);
  assert.equal((await call("PATCH", `/bots/${botId}/channel-groups/nope`, { status: "allowed" })).status, 404);
});

// ── Slack ───────────────────────────────────────────────────────────────────────────────────────────────────────
let env = 0;
const sevent = (event: Record<string, unknown>) => ssockets.at(-1)!.send(JSON.stringify({ type: "events_api", envelope_id: `e${++env}`, payload: { event } }));
const sposts = (ch: string) => scalls.filter((c) => c.method === "chat.postMessage" && c.body.channel === ch);

test("Slack: app_mention in a new channel → pending; turned on, the owner's mention is answered in its thread, once", async () => {
  await call("PUT", `/bots/${botId}/channels/slack`, { botToken: SBOT, appToken: SAPP });
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.slack.online, "slack online");
  const code = (await call("GET", `/bots/${botId}/channels`)).json.slack.linkCode;
  sevent({ type: "message", channel_type: "im", channel: "DOWNER09", user: "UOWNER001", text: code, ts: "1.1" });
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.slack.linked, "slack linked");
  sevent({ type: "app_mention", channel: "CGEN0001", user: "UOWNER001", text: "<@UBOT0009> salut", ts: "10.1" });
  const told = await until(() => sposts("CGEN0001").find((c) => /ne répond pas encore/.test(c.body.text)), "pending in Slack");
  assert.equal(told.body.thread_ts, "10.1");
  const g = (await groupsOf()).find((x) => x.channel === "slack");
  assert.equal(g.name, "#general");
  await call("PATCH", `/bots/${botId}/channel-groups/${g.id}`, { status: "allowed" });
  const n = seen.length;
  // The same message comes twice (app_mention and message.channels): handled once.
  sevent({ type: "message", channel_type: "channel", channel: "CGEN0001", user: "UOWNER001", text: "<@UBOT0009> résume la semaine", ts: "11.1" });
  sevent({ type: "app_mention", channel: "CGEN0001", user: "UOWNER001", text: "<@UBOT0009> résume la semaine", ts: "11.1" });
  const reply = await until(() => sposts("CGEN0001").find((c) => /Réponse du bot/.test(c.body.text)), "reply in Slack");
  assert.equal(reply.body.thread_ts, "11.1");
  await settle();
  assert.equal(seen.length, n + 1, "one turn for the doubled event");
  // A reply in that thread calls the bot without a mention; a plain channel message does not.
  sevent({ type: "message", channel_type: "channel", channel: "CGEN0001", user: "UOWNER001", text: "rien à voir", ts: "12.1" });
  await settle();
  assert.equal(seen.length, n + 1);
  sevent({ type: "message", channel_type: "channel", channel: "CGEN0001", user: "UOWNER001", text: "et la suite ?", ts: "13.1", thread_ts: "11.1" });
  await until(() => seen.length > n + 1, "thread reply calls the bot");
});

// ── Telegram ────────────────────────────────────────────────────────────────────────────────────────────────────
const tpush = (u: Record<string, unknown>) => tupdates.push({ update_id: tUpdate++, ...u });
const tsaid = (chat: string, re: RegExp) => until(() => tsent.find((s) => s.method === "sendMessage" && s.body.chat_id === chat && re.test(s.body.text)), `telegram ${chat} ${re}`);
const GROUPCHAT = { id: -1001234, type: "supergroup", title: "Famille" };
const tmention = (from: object, text: string, extra: Record<string, unknown> = {}) => tpush({ message: { message_id: ++tMsg, text, chat: GROUPCHAT, from, entities: text.startsWith("@") ? [{ type: "mention", offset: 0, length: "@groupes_test_bot".length }] : [], ...extra } });

test("Telegram: a group @mention → pending; turned on, the owner's mention is answered in the group as a reply; a reply to the bot calls it", async () => {
  const status = await telegram.connect(bots.byId(botId)!, "777:fake");
  telegram.start();
  tpush({ message: { message_id: 1, text: `/start ${status.linkCode}`, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Owner" } } });
  await until(() => bots.byId(botId)!.telegramChatId === "42", "telegram linked");
  tmention({ id: 42, first_name: "Owner" }, "@groupes_test_bot bonjour");
  await tsaid("-1001234", /ne répond pas encore/);
  const g = (await groupsOf()).find((x) => x.channel === "telegram");
  assert.deepEqual([g.name, g.status], ["Famille", "pending"]);
  await call("PATCH", `/bots/${botId}/channel-groups/${g.id}`, { status: "allowed" });
  const n = seen.length;
  tpush({ message: { message_id: ++tMsg, text: "message sans mention", chat: GROUPCHAT, from: { id: 42, first_name: "Owner" } } });
  await settle();
  assert.equal(seen.length, n);
  tmention({ id: 42, first_name: "Owner" }, "@groupes_test_bot quel temps demain ?");
  const reply = await tsaid("-1001234", /Réponse du bot/);
  assert.ok(reply.body.reply_parameters?.message_id, "answers the message that called it");
  assert.match(JSON.stringify(seen.at(-1)!.messages), /quel temps demain \?/);
  assert.doesNotMatch(JSON.stringify(seen.at(-1)!.messages), /@groupes_test_bot quel/, "the mention is taken out of the text");
  const k = seen.length;
  tpush({ message: { message_id: ++tMsg, text: "et après-demain ?", chat: GROUPCHAT, from: { id: 42, first_name: "Owner" }, reply_to_message: { message_id: 3, from: { id: 4242, is_bot: true, username: "groupes_test_bot" } } } });
  await until(() => seen.length > k, "reply to the bot calls it");
  // A stranger in that group is told to ask in private; a button pressed in a group never answers an approval.
  tmention({ id: 99, first_name: "Inconnu" }, "@groupes_test_bot salut");
  await tsaid("-1001234", /ne répond qu'aux personnes/);
});
