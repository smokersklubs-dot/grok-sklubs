import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocketServer, type WebSocket as WsSocket } from "ws";

// L162 + OpenClaw I3 (slack.ts): Slack in Socket Mode against a fake Slack (Web API + Socket Mode WebSocket, no real
// network): tokens checked and sealed, envelopes acknowledged, the owner links with the code, talks as the owner and gets
// the reply in their DM; approval questions carry buttons only the owner can press; someone else gets an access code and,
// once approved, talks as a member; files both ways.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-channels-slack-"));
process.env.SESSION_SECRET = "channels-slack-secret-channels-slack";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.CHANNEL_RETRY_MS = "50";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const BOT_TOKEN = "xoxb-fake-for-tests-0001";
const APP_TOKEN = "xapp-fake-for-tests-0002";
const calls: { method: string; auth: string; body: any }[] = [];
const acks: string[] = [];
let sockets: WsSocket[] = [];
let port = 0;
const local = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  if (url.pathname === "/files/report.txt") { res.end(req.headers.authorization === `Bearer ${BOT_TOKEN}` ? "contenu du fichier" : ""); return; }
  if (url.pathname === "/upload/F1") { calls.push({ method: "upload", auth: "", body: raw.toString() }); res.end("OK"); return; }
  const m = /^\/api\/([\w.]+)$/.exec(url.pathname);
  res.setHeader("content-type", "application/json");
  if (!m) { res.statusCode = 404; res.end("{}"); return; }
  const ct = String(req.headers["content-type"]);
  const body = ct.includes("json") ? JSON.parse(raw.toString() || "{}") : Object.fromEntries(new URLSearchParams(raw.toString()));
  const auth = String(req.headers.authorization ?? "");
  calls.push({ method: m[1], auth, body });
  const ok = (o: Record<string, unknown> = {}) => res.end(JSON.stringify({ ok: true, ...o }));
  if (m[1] === "apps.connections.open") return auth === `Bearer ${APP_TOKEN}` ? ok({ url: `ws://127.0.0.1:${port}/socket` }) : res.end(JSON.stringify({ ok: false, error: "invalid_auth" }));
  if (auth !== `Bearer ${BOT_TOKEN}`) return res.end(JSON.stringify({ ok: false, error: "invalid_auth" }));
  if (m[1] === "auth.test") return ok({ team: "Équipe Test", team_id: "T1", user_id: "UBOT0001", user: "sklubot" });
  if (m[1] === "users.info") return ok({ user: { real_name: body.user === "UCAMILLE1" ? "Camille Martin" : "Someone", profile: { display_name: "" } } });
  if (m[1] === "conversations.open") return ok({ channel: { id: "DOWNER01" } });
  if (m[1] === "chat.postMessage") return ok({ ts: `${Date.now()}.0001` });
  if (m[1] === "files.getUploadURLExternal") return ok({ upload_url: `http://127.0.0.1:${port}/upload/F1`, file_id: "F1" });
  return ok();
});
const wss = new WebSocketServer({ server: local, path: "/socket" });
wss.on("connection", (ws) => {
  sockets.push(ws);
  ws.on("message", (d) => { const j = JSON.parse(String(d)); if (j.envelope_id) acks.push(j.envelope_id); });
  ws.send(JSON.stringify({ type: "hello" }));
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
port = (local.address() as { port: number }).port;
process.env.SLACK_API_URL = `http://127.0.0.1:${port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { channels } = await import("../src/channelroutes.js");
const { tell } = await import("../src/agent/loop.js");
const { bots, approvals, rows } = await import("../src/store.js");
const { storeBytes } = await import("../src/computer.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const seen: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    return { content: [{ type: "text", text: "C'est noté." }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
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

let envelope = 0;
const event = (ev: Record<string, unknown>) => { const id = `env-${++envelope}`; sockets.at(-1)!.send(JSON.stringify({ type: "events_api", envelope_id: id, payload: { event: ev } })); return id; };
const dm = (user: string, channel: string, text: string, extra: Record<string, unknown> = {}) => event({ type: "message", channel_type: "im", channel, user, text, ts: `${Date.now()}.${++envelope}`, ...extra });
const posted = (channel: string, re: RegExp) => until(() => calls.find((c) => c.method === "chat.postMessage" && c.body.channel === channel && re.test(c.body.text)), `post to ${channel} matching ${re}`);

channels.start(); // what index.ts does at boot: approval questions and notices reach the owner's Slack
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
const botId = (await call("GET", "/bots")).json.bots[0].id;

test("connect: formats checked, both tokens verified with Slack, sealed (never in the database or the answer in clear)", async () => {
  assert.equal((await call("PUT", `/bots/${botId}/channels/slack`, { botToken: "xoxp-user-token", appToken: APP_TOKEN })).json.error, "Le jeton du bot commence par xoxb- (OAuth & Permissions → Bot User OAuth Token).");
  const bad = await call("PUT", `/bots/${botId}/channels/slack`, { botToken: "xoxb-fake-for-tests-wrong", appToken: APP_TOKEN });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Slack refuse le jeton du bot \(invalid_auth\)/);
  const ok = await call("PUT", `/bots/${botId}/channels/slack`, { botToken: BOT_TOKEN, appToken: APP_TOKEN });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.slack.connected, true);
  assert.equal(ok.json.slack.team, "Équipe Test");
  assert.equal(ok.json.slack.linked, false);
  assert.match(ok.json.slack.linkCode, /^[A-Z2-9]{8}$/);
  assert.ok(!JSON.stringify(ok.json).includes(BOT_TOKEN) && !JSON.stringify(ok.json).includes(APP_TOKEN));
  const stored = q.get<{ secret_enc: string; info: string }>("SELECT secret_enc, info FROM bot_channels WHERE bot_id = ? AND kind = 'slack'", botId)!;
  assert.ok(!stored.secret_enc.includes("xoxb") && !stored.info.includes("xoxb") && !stored.info.includes("xapp"), "sealed");
  assert.ok(!q.get("SELECT 1 FROM audit WHERE text LIKE '%xoxb%' OR text LIKE '%xapp%'"), "never in the audit");
  await until(() => sockets.length > 0, "Socket Mode connected");
  await until(async () => (await call("GET", `/bots/${botId}/channels`)).json.slack.online, "online");
});

test("envelopes are acknowledged; the owner links with the code; an app mention in a channel points to direct messages", async () => {
  const code = (await call("GET", `/bots/${botId}/channels`)).json.slack.linkCode;
  const before = dm("UOTHER01", "DOTHER01", "bonjour");
  await until(() => acks.includes(before), "ack");
  await posted("DOTHER01", /Pour relier ce bot/);
  dm("UOWNER01", "DOWNER01", code.toLowerCase());
  await posted("DOWNER01", /est relié à toi ici/);
  assert.equal((await call("GET", `/bots/${botId}/channels`)).json.slack.linked, true);
  event({ type: "app_mention", channel: "CGENERAL", user: "UOWNER01", text: "<@UBOT0001> salut", ts: "1.1" });
  const m = await posted("CGENERAL", /message privé/);
  assert.equal(m.body.thread_ts, "1.1");
});

test("the owner's message is theirs; the reply comes back to their DM; bot messages and edits are ignored", async () => {
  const n = seen.length;
  dm("UOWNER01", "DOWNER01", "Prépare le compte rendu de lundi");
  await until(() => seen.length > n, "turn ran");
  const row = rows.list(botId, bots.byId(botId)!.generation, 50).find((r) => r.body.kind === "message" && r.body.text === "Prépare le compte rendu de lundi")!;
  assert.equal(row.body.kind === "message" && row.body.origin, undefined, "the owner's own words (no member origin)");
  await posted("DOWNER01", /C'est noté/);
  const k = seen.length;
  dm("UBOT0001", "DOWNER01", "echo of myself");
  dm("UOWNER01", "DOWNER01", "edited", { subtype: "message_changed" });
  dm("UOWNER01", "DOWNER01", "from a bot", { bot_id: "B1" });
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(seen.length, k);
});

test("an approval question has ✅/❌ buttons; a press by someone else is refused; the owner's press answers it; payments never", async () => {
  const bot = bots.byId(botId)!;
  const a = approvals.create(bot.id, bot.userId, bot.generation, 1, "app_mail__send", undefined, "s1");
  tell({ type: "waiting", bot, text: "Envoyer le mail à Camille ?", approvalId: a.id, tool: "app_mail__send" });
  const msg = await posted("DOWNER01", /Envoyer le mail à Camille/);
  const buttons = msg.body.blocks.find((b: any) => b.type === "actions").elements;
  assert.deepEqual(buttons.map((b: any) => b.text.text), ["✅ Oui", "❌ Non"]);
  const press = (user: string, action: string, id: string) => sockets.at(-1)!.send(JSON.stringify({ type: "interactive", envelope_id: `i-${++envelope}`, payload: { type: "block_actions", user: { id: user }, channel: { id: "DOWNER01" }, message: { ts: "9.9", text: "Envoyer ?" }, actions: [{ action_id: action, value: id }] } }));
  press("UCAMILLE1", "sk_ap_y", a.id);
  await until(() => calls.find((c) => c.method === "chat.postEphemeral" && c.body.user === "UCAMILLE1"), "ephemeral refusal");
  assert.equal(approvals.byId(a.id)!.status, "pending");
  press("UOWNER01", "sk_ap_y", a.id);
  await until(() => approvals.byId(a.id)!.status !== "pending", "answered by the owner");
  const upd = await until(() => calls.find((c) => c.method === "chat.update" && c.body.ts === "9.9"), "buttons removed");
  assert.deepEqual(upd.body.blocks, []);
  assert.match(upd.body.text, /✅ Autorisé/);
  assert.ok(q.get("SELECT 1 FROM audit WHERE text LIKE '%approval answered from Slack (button yes)%'"));
  const pay = approvals.create(bot.id, bot.userId, bot.generation, 2, "card: Visa perso", undefined, "s2");
  tell({ type: "waiting", bot, text: "Payer 40 € ?", approvalId: pay.id, tool: "card: Visa perso" });
  const pm = await posted("DOWNER01", /Payer 40/);
  assert.equal(pm.body.blocks, undefined, "no buttons for a payment");
  assert.match(pm.body.text, /Réponds dans l'appli/);
  press("UOWNER01", "sk_ap_y", pay.id);
  await until(() => calls.filter((c) => c.method === "chat.update").length >= 2, "second update");
  assert.equal(approvals.byId(pay.id)!.status, "pending");
});

test("someone else gets a code, is approved, then talks as a member and gets the reply in their own DM", async () => {
  dm("UCAMILLE1", "DCAMILLE1", "Bonjour, je suis Camille");
  const m = await posted("DCAMILLE1", /code de demande : [A-Z2-9]{8}/);
  const code = /([A-Z2-9]{8})/.exec(m.body.text)![1];
  const req = (await call("GET", `/bots/${botId}/channels`)).json.contacts.find((c: any) => c.channel === "slack");
  assert.equal(req.name, "Camille Martin");
  await call("POST", `/bots/${botId}/contacts/approve`, { code });
  await posted("DCAMILLE1", /t'a accepté/);
  const n = seen.length;
  dm("UCAMILLE1", "DCAMILLE1", "Quand est la réunion ?");
  await until(() => seen.length > n, "member turn");
  assert.match(JSON.stringify(seen.at(-1)!.messages), /Message from Camille Martin \(Slack\)/);
  const row = q.get<{ body: string; thread: number }>("SELECT body, thread FROM rows WHERE bot_id = ? AND body LIKE '%Quand est la réunion%'", botId)!;
  assert.equal(JSON.parse(row.body).origin.kind, "member");
  assert.ok(row.thread > 0);
  await until(() => calls.filter((c) => c.method === "chat.postMessage" && c.body.channel === "DCAMILLE1" && /C'est noté/.test(c.body.text)).length === 1, "reply in Camille's DM");
  // A file from Camille is not downloaded.
  dm("UCAMILLE1", "DCAMILLE1", "", { subtype: "file_share", files: [{ name: "report.txt", size: 10, url_private_download: `http://127.0.0.1:${port}/files/report.txt` }] });
  await posted("DCAMILLE1", /Seul le propriétaire peut envoyer des fichiers/);
});

test("files: the owner's file reaches the bot's library; a file the bot attaches is uploaded to Slack", async () => {
  dm("UOWNER01", "DOWNER01", "Voici le fichier", { subtype: "file_share", files: [{ name: "report.txt", mimetype: "text/plain", size: 18, url_private_download: `http://127.0.0.1:${port}/files/report.txt` }] });
  const row = await until(() => rows.list(botId, bots.byId(botId)!.generation, 80).find((r) => r.body.kind === "message" && r.body.text === "Voici le fichier"), "file row");
  assert.equal(row.body.kind === "message" && row.body.attachments?.[0].name, "report.txt");
  // A file above 20 MB is refused with a reason.
  dm("UOWNER01", "DOWNER01", "", { subtype: "file_share", files: [{ name: "film.mov", size: 30 * 1024 * 1024, url_private_download: `http://127.0.0.1:${port}/files/film.mov` }] });
  await posted("DOWNER01", /dépasse 20 Mo/);
  // The bot's reply with an attachment, in the owner's window (the last owner message came from Slack).
  const bot = bots.byId(botId)!;
  const file = storeBytes(bot.id, "exports", "bilan.txt", Buffer.from("bilan"));
  rows.append(bot, { kind: "message", role: "assistant", text: "Voici le bilan.", attachments: [{ ...file, mime: "text/plain" }] }, 0);
  await until(() => calls.find((c) => c.method === "files.completeUploadExternal" && c.body.channel_id === "DOWNER01"), "upload completed");
  assert.ok(calls.some((c) => c.method === "upload" && c.body === "bilan"));
  assert.equal(calls.find((c) => c.method === "files.getUploadURLExternal")!.body.filename, "bilan.txt");
});

test("disconnect closes the connection and forgets the tokens", async () => {
  const r = await call("DELETE", `/bots/${botId}/channels/slack`);
  assert.equal(r.json.slack.connected, false);
  assert.equal(q.get("SELECT COUNT(*) AS n FROM bot_channels WHERE kind = 'slack'")!.n, 0);
});
