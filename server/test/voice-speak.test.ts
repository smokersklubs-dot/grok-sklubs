import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

/**
 * « Écouter les réponses » (server/src/voice/speak.ts, speechtext.ts): POST /bots/:id/rows/:seq/speak reads a bot's
 * reply in the bot's own voice. Fish Audio and Kokoro are local fakes recording every request (the same documented
 * shapes as voice-fish-kokoro.test.ts).
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-speak-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.MAX_STEPS = "8";
for (const k of ["OPENAI_API_KEY", "VOICE_STT_URL", "VOICE_TTS_URL", "HOSTED_MODE"]) delete process.env[k];

const KEY = "fish-speak-key-SECRET-42";
const wav = (bytes: number) => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + bytes, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(24000, 24); h.writeUInt32LE(48000, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(bytes, 40);
  return Buffer.concat([h, Buffer.alloc(bytes)]);
};
interface Seen { url: string; headers: IncomingMessage["headers"]; body: any }
const fishSeen: Seen[] = [];
const kokoroSeen: Seen[] = [];
const fake = (seen: Seen[], ok: (req: IncomingMessage) => boolean) => createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  let body: any = null; try { body = JSON.parse(Buffer.concat(chunks).toString()); } catch { /* not JSON */ }
  seen.push({ url: req.url!, headers: req.headers, body });
  if (!ok(req)) { res.statusCode = 401; res.end("{}"); return; }
  if (req.url === "/v1/audio/voices") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ voices: [{ id: "ff_siwis" }, { id: "am_michael" }] })); return; }
  if (body && (req.url === "/v1/tts" || req.url === "/v1/audio/speech")) { res.setHeader("content-type", "audio/wav"); res.end(wav(4800)); return; }
  res.statusCode = 404; res.end();
});
const fish = fake(fishSeen, (req) => req.headers.authorization === `Bearer ${KEY}`);
const kokoro = fake(kokoroSeen, () => true);
await new Promise<void>((r) => fish.listen(0, "127.0.0.1", () => r()));
await new Promise<void>((r) => kokoro.listen(0, "127.0.0.1", () => r()));
process.env.FISH_AUDIO_URL = `http://127.0.0.1:${(fish.address() as { port: number }).port}`;
process.env.VOICE_KOKORO_URL = `http://127.0.0.1:${(kokoro.address() as { port: number }).port}`;
after(() => { for (const s of [fish, kokoro]) { s.closeAllConnections(); s.close(); } });

const REPLY = "# Bonjour\n\nVoici **le plan** :\n\n- Le site [officiel](https://www.example.com/a?b=1) est prêt.\n- Voir https://github.com/x/y/issues/1 pour le détail.\n\n```js\nconsole.log('secret code')\n```\n\n" +
  "Une deuxième partie, assez longue pour dépasser la première, avec des mots et encore des mots. ".repeat(6) + "Fin.";
const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { speakLimits, clearSpeakCache } = await import("../src/voice/speak.js");
const { speechText, speechParts, SPEECH_MAX_CHARS } = await import("../src/speechtext.js");
const { RateWindow } = await import("../src/hardening.js");
const { users } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

await initComputer();
registerProvider({
  id: "speakf", label: "Speak", models: ["t"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.(REPLY);
    return { content: [{ type: "text", text: REPLY }], stopReason: "end", model: "t", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const lea = users.create("lea@example.com", "Léa", hashPassword("password123"), "fr");
const cookie = `${SESSION_COOKIE}=${createSession(lea.id).token}`;
const max = users.create("max@example.com", "Max", hashPassword("password123"), "en");
const maxCookie = `${SESSION_COOKIE}=${createSession(max.id).token}`;
const vera = users.create("vera@example.com", "Vera", hashPassword("password123"), "fr");
const veraCookie = `${SESSION_COOKIE}=${createSession(vera.id).token}`;
async function call(method: string, url: string, body?: unknown, as = cookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString()); } catch { /* audio */ }
  return { status: res.status, json, text: buf.toString(), buf, headers: res.headers };
}
async function replyOf(botId: string): Promise<number> {
  await call("POST", `/bots/${botId}/messages`, { text: "Fais le point." });
  for (let i = 0; i < 800; i++) {
    const r = (await call("GET", `/bots/${botId}/rows`)).json.rows.find((x: any) => x.body.kind === "message" && x.body.role === "assistant" && !x.body.streaming);
    if (r) return r.seq;
    await new Promise((res) => setTimeout(res, 25));
  }
  throw new Error("no reply");
}
const usageLines = (userId: string) => q.all<{ model: string; cost_usd: number; bot_id: string }>("SELECT model, cost_usd, bot_id FROM usage WHERE user_id = ? AND model LIKE 'fish:%' ORDER BY id", userId);

test("text cleaned for speech: no markdown, « bloc de code », links said by their host, capped, cut in parts", () => {
  const s = speechText(REPLY, "fr");
  assert.ok(s.startsWith("Bonjour. Voici le plan: Le site officiel est prêt. Voir lien vers github.com pour le détail. bloc de code."), s);
  for (const bad of ["#", "**", "```", "console.log", "https://", "example.com/a"]) assert.ok(!s.includes(bad), bad);
  assert.equal(speechText("Run `npm test` now.", "en"), "Run npm test now.");
  assert.equal(speechText("```\nx\n```", "en"), "code block.");
  assert.equal(speechText("| A | B |\n|---|---|\n| 1 | 2 |", "en"), "A, B. 1, 2.");
  const long = speechText("Une phrase. ".repeat(1000), "fr");
  assert.ok(long.length <= SPEECH_MAX_CHARS + 40 && long.endsWith("La suite est à l'écran."));
  const parts = speechParts(s);
  assert.ok(parts.length >= 2 && parts[0].length <= 160, "a short first part, so playback starts fast");
  assert.equal(parts.join(" "), s, "nothing lost between parts");
  assert.ok(speechParts("a ".repeat(900).trim()).every((p) => p.length <= 420), "a sentence with no end is still cut");
});

let botId = "";
let seq = 0;
test("the bot's own Fish Audio voice reads the reply, part by part; the owner pays once (cached after)", async () => {
  await call("PUT", "/voice", { fishKey: KEY, tts: { provider: "piper" } });
  botId = (await call("POST", "/bots", { name: "Juno" })).json.bot.id;
  await call("PATCH", `/bots/${botId}`, { model: "speakf:t", voice: { name: "", rate: 1.1, lang: "fr-FR" } });
  assert.equal((await call("PUT", `/bots/${botId}/voice/choice`, { provider: "fish", voiceId: "voice0001fr", name: "Camille" })).status, 200);
  seq = await replyOf(botId);
  const parts = speechParts(speechText(REPLY, "fr-FR"));
  const before = fishSeen.length;
  const r = await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 0 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get("content-type"), "audio/wav");
  assert.equal(r.buf.toString("ascii", 0, 4), "RIFF");
  assert.equal(r.headers.get("x-speak-parts"), String(parts.length));
  assert.equal(r.headers.get("x-speak-provider"), "fish");
  assert.equal(decodeURIComponent(r.headers.get("x-speak-voice")!), "Camille");
  const sent = fishSeen.slice(before);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].url, "/v1/tts");
  assert.equal(sent[0].body.reference_id, "voice0001fr", "the bot's own voice");
  assert.equal(sent[0].body.text, parts[0], "the cleaned first part only");
  assert.deepEqual(sent[0].body.prosody, { speed: 1.1 }, "the bot's speaking rate");
  assert.ok(!sent[0].body.text.includes("secret code"));
  const lines = usageLines(lea.id);
  assert.equal(lines.length, 1);
  assert.equal(lines[0].bot_id, botId);
  assert.ok(Math.abs(lines[0].cost_usd - (Buffer.byteLength(parts[0]) / 1e6) * 15) < 1e-12, "Fish Audio's price, on the owner's usage");
  // The same part again: from the cache, nothing spent.
  const again = await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 0 });
  assert.equal(again.headers.get("x-speak-cache"), "hit");
  assert.equal(fishSeen.length, before + 1);
  assert.equal(usageLines(lea.id).length, 1);
  // The next part.
  const p1 = await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 1 });
  assert.equal(p1.status, 200);
  assert.equal(fishSeen.at(-1)!.body.text, parts[1]);
  assert.equal((await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: parts.length })).status, 400);
});

test("a bot with a Kokoro voice speaks with Kokoro; no voice at all → 409 no_tts (the app uses the browser's)", async () => {
  const k = (await call("POST", "/bots", { name: "Kiki" })).json.bot.id;
  await call("PATCH", `/bots/${k}`, { model: "speakf:t" });
  await call("PUT", `/bots/${k}/voice/choice`, { provider: "kokoro", voiceId: "am_michael" });
  const s = await replyOf(k);
  const before = kokoroSeen.length;
  const r = await call("POST", `/bots/${k}/rows/${s}/speak`, {});
  assert.equal(r.status, 200, r.text);
  assert.equal(r.headers.get("x-speak-provider"), "kokoro");
  const sent = kokoroSeen.slice(before).find((x) => x.url === "/v1/audio/speech")!;
  assert.equal(sent.body.voice, "am_michael");
  // Max chose the browser's own speech (no server voice for his bots, even the free one given automatically).
  await call("PUT", "/voice", { mode: "browser" }, maxCookie);
  const m = (await call("POST", "/bots", { name: "Mute" }, maxCookie)).json.bot.id;
  await call("PATCH", `/bots/${m}`, { model: "speakf:t" }, maxCookie);
  await call("POST", `/bots/${m}/messages`, { text: "hi" }, maxCookie);
  let ms = 0;
  for (let i = 0; i < 800 && !ms; i++) { ms = (await call("GET", `/bots/${m}/rows`, undefined, maxCookie)).json.rows.find((x: any) => x.body.role === "assistant" && !x.body.streaming)?.seq ?? 0; if (!ms) await new Promise((res) => setTimeout(res, 25)); }
  const none = await call("POST", `/bots/${m}/rows/${ms}/speak`, {}, maxCookie);
  assert.equal(none.status, 409);
  assert.equal(none.json.code, "no_tts");
  assert.equal(none.json.lang, "en");
});

test("access: as reading the chat — others get 404, a workspace viewer listens with the owner's voice (owner pays)", async () => {
  // Max, a stranger: Léa's bot does not exist for him, whatever the row.
  for (const s of [seq, 1, 999]) assert.equal((await call("POST", `/bots/${botId}/rows/${s}/speak`, {}, maxCookie)).status, 404);
  assert.equal((await call("POST", `/bots/does-not-exist/rows/1/speak`, {})).status, 404);
  assert.equal((await call("POST", `/bots/${botId}/rows/999/speak`, {})).status, 404);
  // The user's own message is not a reply.
  const userRow = (await call("GET", `/bots/${botId}/rows`)).json.rows.find((x: any) => x.body.role === "user").seq;
  assert.equal((await call("POST", `/bots/${botId}/rows/${userRow}/speak`, {})).json.code, "not_a_reply");
  // Without a session.
  assert.equal((await api.request(`/bots/${botId}/rows/${seq}/speak`, { method: "POST" })).status, 401);
  // Vera, a viewer of Léa's workspace the bot is shared with: she may read the chat, so she may listen.
  const ws = (await call("POST", "/workspaces", { name: "Studio" })).json.workspace.id;
  const inv = (await call("POST", `/workspaces/${ws}/invites`, { email: "vera@example.com", role: "viewer" })).json.invite;
  assert.equal((await call("POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") }, veraCookie)).status, 200);
  assert.equal((await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 2 }, veraCookie)).status, 404, "not shared yet");
  assert.equal((await call("PUT", `/bots/${botId}/share`, { workspaceId: ws, access: "all" })).status, 200);
  const before = usageLines(lea.id).length;
  const v = await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 2 }, veraCookie);
  assert.equal(v.status, 200, v.text);
  assert.equal(fishSeen.at(-1)!.body.reference_id, "voice0001fr");
  assert.equal(usageLines(lea.id).length, before + 1, "the owner's usage (her key, her voice)");
  assert.equal(usageLines(vera.id).length, 0);
});

test("rate limited per caller (and per owner's services)", async () => {
  const saved = speakLimits.perMinute;
  speakLimits.perMinute = new RateWindow(3, 60_000);
  try {
    const codes: number[] = [];
    for (let i = 0; i < 5; i++) codes.push((await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 0 })).status);
    assert.deepEqual(codes, [200, 200, 200, 429, 429]);
    const r = await call("POST", `/bots/${botId}/rows/${seq}/speak`, { part: 0 });
    assert.equal(r.json.code, "rate_limited");
    assert.match(r.json.error, /Trop de réponses écoutées/);
  } finally { speakLimits.perMinute = saved; clearSpeakCache(); }
});

test("« Lire les réponses à voix haute »: a bot setting, off by default, kept by patches that do not name it", async () => {
  const get = async () => (await call("GET", "/bots")).json.bots.find((b: any) => b.id === botId).voice;
  assert.ok(!(await get()).readAloud);
  await call("PATCH", `/bots/${botId}`, { voice: { name: "", rate: 1.1, lang: "fr-FR", readAloud: true } });
  assert.equal((await get()).readAloud, true);
  await call("PATCH", `/bots/${botId}`, { voice: { name: "x", rate: 1, lang: "fr-FR" } });
  assert.equal((await get()).readAloud, true, "an older app's patch does not turn it off");
  await call("PATCH", `/bots/${botId}`, { voice: { name: "x", rate: 1, lang: "fr-FR", readAloud: false } });
  assert.ok(!(await get()).readAloud);
  // A stranger cannot change it.
  assert.equal((await call("PATCH", `/bots/${botId}`, { voice: { readAloud: true } }, maxCookie)).status, 404);
});
