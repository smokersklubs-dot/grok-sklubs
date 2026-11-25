import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L154 (backlog A-FAIRE): a call's report kept across a restart of the server (calls.ts call_live), the bot's voice note
// (voice/voicenote.ts), and the reminder call to the OWNER's own phone (voice/remindercall.ts). Kokoro and Twilio are
// local FAKES recording every request; no real phone call is placed.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l154-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["OPENAI_API_KEY", "VOICE_STT_URL", "VOICE_TTS_URL", "HOSTED_MODE"]) delete process.env[k];

const wav = (bytes: number, fill = 0) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(bytes, 40);
  return Buffer.concat([h, Buffer.alloc(bytes, fill)]);
};
interface Seen { url: string; headers: IncomingMessage["headers"]; body: string }
const kokoroSeen: Seen[] = [];
const twilioSeen: Seen[] = [];
let twilioStatus = 201;
const server = (seen: Seen[], handle: (req: IncomingMessage, res: ServerResponse, body: string) => void) => createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const body = Buffer.concat(chunks).toString();
  seen.push({ url: req.url!, headers: req.headers, body });
  handle(req, res, body);
});
const kokoro = server(kokoroSeen, (req, res) => {
  if (req.url === "/v1/audio/speech") { res.setHeader("content-type", "audio/wav"); res.end(wav(4800, kokoroSeen.length)); return; }
  res.statusCode = 404; res.end();
});
const twilio = server(twilioSeen, (_req, res) => {
  res.setHeader("content-type", "application/json");
  res.statusCode = twilioStatus;
  res.end(JSON.stringify(twilioStatus < 300 ? { sid: "CA" + "0".repeat(32), status: "queued" } : { code: 20003, message: "Authenticate" }));
});
await new Promise<void>((r) => kokoro.listen(0, "127.0.0.1", () => r()));
await new Promise<void>((r) => twilio.listen(0, "127.0.0.1", () => r()));
process.env.VOICE_KOKORO_URL = `http://127.0.0.1:${(kokoro.address() as { port: number }).port}`;
process.env.TWILIO_API_BASE = `http://127.0.0.1:${(twilio.address() as { port: number }).port}`;
after(() => { for (const s of [kokoro, twilio]) { s.closeAllConnections(); s.close(); } });

const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { bots, rows, users } = await import("../src/store.js");
const { callStarted, callProgress, recoverCalls, _forgetLiveCalls, BROWSER_CALL_GRACE_MS } = await import("../src/calls.js");
const { voiceNoteTools, joinAudio } = await import("../src/voice/voicenote.js");
const { reminderCallTools, reminderTwiml } = await import("../src/voice/remindercall.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
await initComputer();

const lea = users.create("lea154@example.com", "Léa", hashPassword("password123"), "fr");
const max = users.create("max154@example.com", "Max", hashPassword("password123"), "en");
const cookieOf = (id: string) => `${SESSION_COOKIE}=${createSession(id).token}`;
const leaCookie = cookieOf(lea.id), maxCookie = cookieOf(max.id);
async function call(method: string, url: string, body?: unknown, as = leaCookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
let botId = "";
const ctx = (extra: Record<string, unknown> = {}) => ({ bot: bots.byId(botId)!, user: users.byId(lea.id)!, depth: 0, signal: new AbortController().signal, ...extra }) as any;
const callRows = () => { const b = bots.byId(botId)!; return rows.list(b.id, b.generation).filter((r: any) => r.body.kind === "event" && r.body.event === "call"); };

test("setup", async () => {
  botId = (await call("POST", "/bots", { name: "Juno" })).json.bot.id;
  assert.ok(botId);
});

test("a server call's report survives a restart: closed with its transcript and « (le serveur a redémarré) »", () => {
  const bot = bots.byId(botId)!;
  const id = callStarted(bot, "fr", "server");
  callProgress(id, [{ role: "user", text: "Rappelle-moi le devis" }, { role: "assistant", text: "C'est noté, demain 9 h." }]);
  _forgetLiveCalls(); // what a restart forgets
  assert.equal(recoverCalls(), 1);
  const ended = callRows().map((r: any) => r.body).find((b: any) => b.call?.id === id && b.call.phase === "ended");
  assert.ok(ended, "ended row written");
  assert.match(ended.text, /Appel vocal terminé · .*\(le serveur a redémarré\)/);
  assert.deepEqual(ended.call.transcript.map((l: any) => l.text), ["Rappelle-moi le devis", "C'est noté, demain 9 h."]);
  assert.equal(recoverCalls(), 0, "closed once");
});

test("a browser call waits for the app's own end after a restart (sent again from its outbox), then closes after the grace", async () => {
  const started = await call("POST", `/bots/${botId}/calls`);
  const id = started.json.callId;
  _forgetLiveCalls();
  assert.equal(recoverCalls(), 0, "a browser call is not closed at once");
  const end = await call("POST", `/bots/${botId}/calls/${id}/end`, { transcript: [{ role: "user", text: "Ça marche toujours ?" }] });
  assert.deepEqual(end.json, { ok: true }, "not a duplicate: the record was kept on disk");
  const ended = callRows().map((r: any) => r.body).find((b: any) => b.call?.id === id && b.call.phase === "ended");
  assert.deepEqual(ended.call.transcript, [{ role: "user", text: "Ça marche toujours ?" }]);
  // Another account cannot close someone else's kept call.
  const other = (await call("POST", `/bots/${botId}/calls`)).json.callId;
  _forgetLiveCalls();
  assert.equal((await call("POST", `/bots/${botId}/calls/${other}/end`, { transcript: [] }, maxCookie)).status, 404);
  assert.equal(recoverCalls(Date.now() + BROWSER_CALL_GRACE_MS + 1000), 1, "closed after the grace");
});

test("voice note: joined into one recording, stored, posted in the chat as audio; limits", async () => {
  const one = wav(100, 1), two = wav(200, 2);
  const j = joinAudio([one, two])!;
  assert.equal(j.ext, "wav");
  assert.equal(j.bytes.readUInt32LE(40), 300, "data sizes added");
  assert.equal(j.bytes.length, 44 + 300);
  assert.equal(joinAudio([one, Buffer.from("ID3abc")]), null, "mixed formats are not joined");
  const tool = voiceNoteTools[0];
  assert.equal((await tool.run({ text: "x".repeat(1501) }, ctx())).isError, true);
  assert.equal((await tool.run({ text: "" }, ctx())).isError, true);
  assert.equal((await call("PUT", `/bots/${botId}/voice/choice`, { provider: "kokoro", voiceId: "ff_siwis" })).status, 200);
  const before = kokoroSeen.length;
  const out = await tool.run({ text: "Bonjour Léa. Le devis est prêt. " + "Je t'explique les détails en quelques phrases. ".repeat(8), caption: "Le devis" }, ctx());
  assert.equal(out.isError, undefined, String(out.content));
  assert.ok(kokoroSeen.length - before >= 2, "several parts synthesized");
  const b = bots.byId(botId)!;
  const msg = rows.list(b.id, b.generation).map((r: any) => r.body).filter((x: any) => x.kind === "message" && x.attachments?.length).at(-1);
  assert.equal(msg.text, "Le devis");
  assert.match(msg.attachments[0].name, /^note-vocale-\d{12}\.wav$/);
  assert.equal(msg.attachments[0].mime, "audio/wav");
});

test("voice note without any speech service: a clear refusal, nothing posted", async () => {
  const maxBot = (await call("POST", "/bots", { name: "Nox" }, maxCookie)).json.bot.id;
  await call("PUT", "/voice", { mode: "browser" }, maxCookie);
  const out = await voiceNoteTools[0].run({ text: "Bonjour" }, { bot: bots.byId(maxBot)!, user: users.byId(max.id)!, depth: 0, signal: new AbortController().signal } as any);
  assert.equal(out.isError, true);
  assert.match(String(out.content), /No speech service/);
});

const SID = "AC" + "0".repeat(32);
test("reminder call settings: validated, secret never sent back, per account", async () => {
  assert.deepEqual((await call("GET", "/reminder-call")).json.configured, false);
  const bad = await call("PUT", "/reminder-call", { accountSid: "AC123", secret: "fake-secret", from: "+33100000000", to: "+33600000000" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /Account SID/);
  assert.match((await call("PUT", "/reminder-call", { accountSid: SID, secret: "fake-secret", from: "0612", to: "+33600000000" })).json.error, /format international/);
  assert.match((await call("PUT", "/reminder-call", { accountSid: SID, from: "+33100000000", to: "+33600000000" })).json.error, /Auth Token/);
  const ok = await call("PUT", "/reminder-call", { accountSid: SID, secret: "fake-secret-for-tests", from: "+33100000000", to: "+33600000000" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.configured, true);
  assert.ok(!ok.text.includes("fake-secret-for-tests"), "the secret is never sent back");
  assert.equal((await call("GET", "/reminder-call", undefined, maxCookie)).json.configured, false, "the other account sees nothing");
});

test("reminder call: only the owner's own number, the documented Twilio call, 10-minute gap; refused after outside content", async () => {
  const tool = reminderCallTools[0];
  assert.deepEqual(Object.keys((tool.spec.inputSchema as any).properties), ["message"], "the bot gives no number");
  const tainted = await tool.run({ message: "Rappel" }, ctx({ tainted: true }));
  assert.equal(tainted.isError, true);
  assert.match(String(tainted.content), /outside content/);
  assert.equal(twilioSeen.length, 0);
  const out = await tool.run({ message: "Appeler le comptable avant midi." }, ctx());
  assert.equal(out.isError, undefined, String(out.content));
  assert.equal(twilioSeen.length, 1);
  const req = twilioSeen[0];
  assert.equal(req.url, `/2010-04-01/Accounts/${SID}/Calls.json`);
  assert.equal(req.headers.authorization, `Basic ${Buffer.from(`${SID}:fake-secret-for-tests`).toString("base64")}`);
  const form = new URLSearchParams(req.body);
  assert.equal(form.get("To"), "+33600000000");
  assert.equal(form.get("From"), "+33100000000");
  assert.match(form.get("Twiml")!, /<Say language="fr-FR">Bonjour, ici Juno, de Sklubot\. Petit rappel : Appeler le comptable avant midi\.<\/Say>/);
  const again = await tool.run({ message: "Encore" }, ctx());
  assert.equal(again.isError, true);
  assert.match(String(again.content), /10 minutes/);
  assert.equal((await call("GET", "/reminder-call")).json.callsToday, 1);
  assert.equal(reminderTwiml("A<b>", "x & y", "en"), `<Response><Say language="en-US">Hello, this is A&lt;b&gt; from Sklubot. A reminder: x &amp; y</Say><Pause length="1"/><Say language="en-US">Once more: x &amp; y</Say></Response>`);
  // The other account has nothing set up: its bot cannot call anyone.
  const maxBot = (await call("POST", "/bots", { name: "Vox" }, maxCookie)).json.bot.id;
  const none = await tool.run({ message: "x" }, { bot: bots.byId(maxBot)!, user: users.byId(max.id)!, depth: 0, signal: new AbortController().signal } as any);
  assert.equal(none.isError, true);
  assert.equal(twilioSeen.length, 1);
  // Turned off: refused.
  await call("PUT", "/reminder-call", { enabled: false });
  assert.match((await call("POST", "/reminder-call/test")).json.error, /coupés/);
});
