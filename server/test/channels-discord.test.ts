import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

// L162 + OpenClaw I2 (discord.ts): Discord over the Gateway against a fake Discord (REST + Gateway WebSocket, no real
// network): Hello → Identify with the DIRECT_MESSAGES intent, heartbeats, READY; the owner links with the code and talks
// as the owner ("typing…" shown, reply in their DM); approval buttons only the owner can press (an ephemeral refusal for
// anyone else); someone else gets an access code and, once approved, talks as a member; server channels are ignored.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-channels-discord-"));
process.env.SESSION_SECRET = "channels-discord-secret-channels-disc";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.CHANNEL_RETRY_MS = "50";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const TOKEN = "fake-for-tests." + "x".repeat(60);
const calls: { method: string; path: string; auth: string; body: any }[] = [];
const fromBot: any[] = [];
let sockets: WsSocket[] = [];
let port = 0;
const local = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const bytes = Buffer.concat(chunks);
  const raw = bytes.toString("utf8");
  res.setHeader("content-type", "application/json");
  const auth = String(req.headers.authorization ?? "");
  if (url.pathname === "/attachments/plan.txt") { res.end("le plan"); return; }
  const p = url.pathname.replace(/^\/api\/v10/, "");
  const body = String(req.headers["content-type"]).includes("json") ? JSON.parse(raw || "{}") : { multipart: bytes.toString("latin1") };
  calls.push({ method: req.method ?? "", path: p, auth, body });
  if (auth !== `Bot ${TOKEN}`) { res.statusCode = 401; res.end(JSON.stringify({ message: "401: Unauthorized", code: 0 })); return; }
  if (p === "/users/@me") return res.end(JSON.stringify({ id: "900000000000000001", username: "sklubot", bot: true }));
  if (p === "/oauth2/applications/@me") return res.end(JSON.stringify({ id: "800000000000000001" }));
  if (p === "/gateway/bot") return res.end(JSON.stringify({ url: `ws://127.0.0.1:${port}` }));
  if (p === "/users/@me/channels") return res.end(JSON.stringify({ id: "700000000000000042" }));
  if (/\/typing$/.test(p)) { res.statusCode = 204; res.end(); return; }
  return res.end(JSON.stringify({ id: String(Date.now()) }));
});
const wss = new WebSocketServer({ server: local, path: "/" });
wss.on("connection", (ws) => {
  sockets.push(ws);
  ws.on("message", (d) => {
    const j = JSON.parse(String(d));
    fromBot.push(j);
    if (j.op === 2) ws.send(JSON.stringify({ op: 0, t: "READY", s: 1, d: { user: { id: "900000000000000001" }, session_id: "s" } }));
    if (j.op === 1) ws.send(JSON.stringify({ op: 11 }));
  });
  ws.send(JSON.stringify({ op: 10, d: { heartbeat_interval: 200 } }));
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
port = (local.address() as { port: number }).port;
process.env.DISCORD_API_URL = `http://127.0.0.1:${port}/api/v10`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { channels } = await import("../src/channelroutes.js");
const { tell } = await import("../src/agent/loop.js");
const { bots, approvals, rows } = await import("../src/store.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const seen: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    return { content: [{ type: "text", text: "Entendu." }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
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
after(() => { channels.stopAll(); for (const s of sockets) s.terminate(); wss.close(); local.closeAllConnections(); local.close(); });

let seq = 10;
const dispatch = (t: string, d: unknown) => sockets.at(-1)!.send(JSON.stringify({ op: 0, t, s: ++seq, d }));
const dm = (author: { id: string; username: string; global_name?: string }, channel: string, content: string, extra: Record<string, unknown> = {}) =>
  dispatch("MESSAGE_CREATE", { id: String(++seq), channel_id: channel, author, content, attachments: [], ...extra });
const posted = (channel: string, re: RegExp) => until(() => calls.find((c) => c.method === "POST" && c.path === `/channels/${channel}/messages` && re.test(c.body.content ?? "")), `post to ${channel} matching ${re}`);
const OWNER = { id: "100000000000000001", username: "owner" };
const LEA = { id: "200000000000000002", username: "lea", global_name: "Léa" };

channels.start();
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
const botId = (await call("GET", "/bots")).json.bots[0].id;

test("connect: token checked and sealed; Gateway Identify with the DIRECT_MESSAGES intent; heartbeats; invite link", async () => {
  assert.equal((await call("PUT", `/bots/${botId}/channels/discord`, { token: "short" })).status, 400);
  const bad = await call("PUT", `/bots/${botId}/channels/discord`, { token: "fake-for-tests." + "y".repeat(60) });
  assert.match(bad.json.error, /^Discord refuse ce jeton/);
  const ok = await call("PUT", `/bots/${botId}/channels/discord`, { token: TOKEN });
  assert.equal(ok.json.discord.connected, true);
  assert.equal(ok.json.discord.inviteUrl, "https://discord.com/oauth2/authorize?client_id=800000000000000001&scope=bot");
  assert.ok(!JSON.stringify(ok.json).includes(TOKEN));
  assert.ok(!q.get<{ secret_enc: string }>("SELECT secret_enc FROM bot_channels WHERE kind = 'discord'")!.secret_enc.includes("fake-for-tests"), "sealed");
  const identify = await until(() => fromBot.find((m) => m.op === 2), "identify");
  assert.equal(identify.d.intents, 4096);
  assert.equal(identify.d.token, TOKEN);
  await until(() => fromBot.some((m) => m.op === 1), "heartbeat");
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.discord.online, "online");
});

test("the owner links by DM; their messages are theirs, with typing and the reply in their DM; server channels ignored", async () => {
  const code = (await call("GET", `/bots/${botId}/channels`)).json.discord.linkCode;
  dm(OWNER, "700000000000000042", `start ${code}`);
  await posted("700000000000000042", /est relié à toi ici/);
  const n = seen.length;
  dm(OWNER, "700000000000000042", "Réserve une salle pour jeudi");
  await until(() => seen.length > n, "turn ran");
  await until(() => calls.find((c) => c.path === "/channels/700000000000000042/typing"), "typing");
  await posted("700000000000000042", /Entendu/);
  const row = rows.list(botId, bots.byId(botId)!.generation, 50).find((r) => r.body.kind === "message" && r.body.text === "Réserve une salle pour jeudi")!;
  assert.equal(row.body.kind === "message" && row.body.origin, undefined);
  const k = seen.length;
  dm(OWNER, "600000000000000001", "dans un serveur", { guild_id: "500000000000000001" });
  dm({ id: "300000000000000003", username: "otherbot", bot: true } as any, "700000000000000043", "bip");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, k);
  assert.ok(!calls.some((c) => c.path === "/channels/600000000000000001/messages"));
});

test("approval buttons: someone else's press gets an ephemeral refusal; the owner's press answers and removes them", async () => {
  const bot = bots.byId(botId)!;
  const a = approvals.create(bot.id, bot.userId, bot.generation, 1, "app_calendar__create", undefined, "d1");
  tell({ type: "waiting", bot, text: "Créer l'événement ?", approvalId: a.id, tool: "app_calendar__create" });
  const m = await posted("700000000000000042", /Créer l'événement/);
  const btns = m.body.components[0].components;
  assert.deepEqual(btns.map((b: any) => [b.label, b.custom_id]), [["✅ Oui", `ap:${a.id}:y`], ["❌ Non", `ap:${a.id}:n`]]);
  dispatch("INTERACTION_CREATE", { id: "i1", token: "tok1", type: 3, data: { custom_id: `ap:${a.id}:y` }, user: LEA, message: { content: "Créer ?" } });
  const refused = await until(() => calls.find((c) => c.path === "/interactions/i1/tok1/callback"), "refusal");
  assert.equal(refused.body.type, 4);
  assert.equal(refused.body.data.flags, 64);
  assert.equal(approvals.byId(a.id)!.status, "pending");
  dispatch("INTERACTION_CREATE", { id: "i2", token: "tok2", type: 3, data: { custom_id: `ap:${a.id}:n` }, user: OWNER, message: { content: "Créer ?" } });
  const done = await until(() => calls.find((c) => c.path === "/interactions/i2/tok2/callback"), "answer");
  assert.equal(done.body.type, 7);
  assert.deepEqual(done.body.data.components, []);
  assert.match(done.body.data.content, /❌ Refusé/);
  assert.notEqual(approvals.byId(a.id)!.status, "pending", "answered (no turn waits on this test approval, so it is closed)");
  assert.ok(q.get("SELECT 1 FROM audit WHERE text LIKE '%approval answered from Discord (button no)%'"));
});

test("someone else: access code, approval by the owner, then a member's message with the reply in their own DM", async () => {
  dm(LEA, "700000000000000077", "Salut !");
  const m = await posted("700000000000000077", /code de demande : [A-Z2-9]{8}/);
  const code = /([A-Z2-9]{8})/.exec(m.body.content)![1];
  assert.equal((await call("GET", `/bots/${botId}/channels`)).json.contacts.find((c: any) => c.channel === "discord").name, "Léa");
  await call("POST", `/bots/${botId}/contacts/approve`, { code });
  await posted("700000000000000077", /t'a accepté/);
  const n = seen.length;
  dm(LEA, "700000000000000077", "Tu peux me dire l'heure du rendez-vous ?");
  await until(() => seen.length > n, "member turn");
  assert.match(JSON.stringify(seen.at(-1)!.messages), /Message from Léa \(Discord\)/);
  await posted("700000000000000077", /Entendu/);
  dm(LEA, "700000000000000077", "", { attachments: [{ filename: "plan.txt", size: 7, url: `http://127.0.0.1:${port}/attachments/plan.txt` }] });
  await posted("700000000000000077", /Seul le propriétaire peut envoyer des fichiers/);
});

test("the owner's attachment reaches the library; disconnect forgets the token", async () => {
  dm(OWNER, "700000000000000042", "Le plan", { attachments: [{ filename: "plan.txt", size: 7, content_type: "text/plain", url: `http://127.0.0.1:${port}/attachments/plan.txt` }] });
  const row = await until(() => rows.list(botId, bots.byId(botId)!.generation, 80).find((r) => r.body.kind === "message" && r.body.text === "Le plan"), "file row");
  assert.equal(row.body.kind === "message" && row.body.attachments?.[0].name, "plan.txt");
  dm(OWNER, "700000000000000042", "", { attachments: [{ filename: "x.bin", size: 1, url: "https://evil.example/x.bin" }] });
  await posted("700000000000000042", /pas pu récupérer ce fichier/);
  const r = await call("DELETE", `/bots/${botId}/channels/discord`);
  assert.equal(r.json.discord.connected, false);
});
