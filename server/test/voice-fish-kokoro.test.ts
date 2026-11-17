import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * Fish Audio and Kokoro as speech providers, and a voice per bot (server/src/voice/fish.ts, kokoro.ts, botvoice.ts,
 * routes.ts). Both services are local fakes that record every request, checked against the providers' documentation:
 *  - Fish Audio: https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech , .../speech-to-text ,
 *    https://docs.fish.audio/api-reference/endpoint/model/list-models , .../get-model
 *  - Kokoro-FastAPI v0.10.0: /v1/audio/speech (OpenAISpeechRequest) and /v1/audio/voices.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-fishvoice-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.MAX_STEPS = "8";
for (const k of ["OPENAI_API_KEY", "VOICE_STT_URL", "VOICE_TTS_URL", "HOSTED_MODE"]) delete process.env[k];

const SR = 24000;
const KEY = "fish-test-key-SECRET-123";
/** A WAV as a streaming server sends it: sizes unknown (0xFFFFFFFF), the samples in several chunks. */
function streamedWavHeader(): Buffer {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(0xffffffff, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(0xffffffff, 40);
  return h;
}

interface Seen { method: string; url: string; headers: IncomingMessage["headers"]; body: Buffer }
const fishSeen: Seen[] = [];
const LIB = [
  { _id: "voice0001fr", type: "tts", title: "Camille", description: "Voix douce et posée", languages: ["fr"], tags: ["calm", "female"], like_count: 1234, task_count: 99000, author: { _id: "a1", nickname: "Studio Lumière", avatar: "" }, licensed: true, visibility: "public", state: "trained", created_at: "", updated_at: "", mark_count: 0, shared_count: 0 },
  { _id: "voice0002en", type: "tts", title: "Narrator", description: "Deep narrator", languages: ["en"], tags: ["narration"], like_count: 87, task_count: 500, author: { _id: "a2", nickname: "Maker", avatar: "" }, licensed: false, visibility: "public", state: "trained", created_at: "", updated_at: "", mark_count: 0, shared_count: 0 },
];
const fish = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  fishSeen.push({ method: req.method!, url: req.url!, headers: req.headers, body });
  if (req.headers.authorization !== `Bearer ${KEY}`) { res.statusCode = 401; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 401, message: "Invalid token" })); return; }
  if (req.url === "/v1/tts" && req.method === "POST") {
    const j = JSON.parse(body.toString());
    if (j.reference_id === "needscredit1") { res.statusCode = 402; res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ status: 402, message: "No payment" })); return; }
    // Chunked, like the documented answer (Transfer-Encoding: chunked); an odd split on purpose.
    res.setHeader("content-type", "audio/wav");
    res.write(streamedWavHeader().subarray(0, 30));
    await new Promise((r) => setTimeout(r, 5));
    res.write(Buffer.concat([streamedWavHeader().subarray(30), Buffer.alloc(SR / 10 + 1)]));
    await new Promise((r) => setTimeout(r, 5));
    res.end(Buffer.alloc(SR / 10 + 1)); // 0.2 s of samples in all (2 × 2401 bytes, one odd byte dropped)
    return;
  }
  if (req.url === "/v1/asr" && req.method === "POST") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ text: "bonjour", duration: 1.2, segments: [] }));
    return;
  }
  const u = new URL(req.url!, "http://x");
  if (u.pathname === "/model" && req.method === "GET") {
    const title = u.searchParams.get("title") ?? "";
    const items = LIB.filter((m) => !title || m.title.toLowerCase().includes(title.toLowerCase()));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ total: items.length, items, has_more: false }));
    return;
  }
  const one = /^\/model\/([\w-]+)$/.exec(u.pathname);
  if (one && req.method === "GET") {
    const m = LIB.find((x) => x._id === one[1]);
    res.statusCode = m ? 200 : 404;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify(m ?? { status: 404, message: "Not found" }));
    return;
  }
  res.statusCode = 404; res.end();
});
const kokoroSeen: Seen[] = [];
const kokoro = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  kokoroSeen.push({ method: req.method!, url: req.url!, headers: req.headers, body: Buffer.concat(chunks) });
  if (req.url === "/v1/audio/voices") {
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ voices: [{ id: "af_heart", name: "af_heart", overall_grade: "A" }, { id: "ff_siwis", name: "ff_siwis", overall_grade: "B-" }, { id: "jm_kumo", name: "jm_kumo" }], default_voice: "af_heart" }));
    return;
  }
  if (req.url === "/v1/audio/speech" && req.method === "POST") {
    const h = streamedWavHeader();
    h.writeUInt32LE(36 + 4800, 4); h.writeUInt32LE(4800, 40);
    res.setHeader("content-type", "audio/wav");
    res.end(Buffer.concat([h, Buffer.alloc(4800)]));
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => fish.listen(0, "127.0.0.1", () => r()));
await new Promise<void>((r) => kokoro.listen(0, "127.0.0.1", () => r()));
process.env.FISH_AUDIO_URL = `http://127.0.0.1:${(fish.address() as { port: number }).port}`;
process.env.VOICE_KOKORO_URL = `http://127.0.0.1:${(kokoro.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { voiceUpgrade, VoiceSession } = await import("../src/voice/session.js");
const { completeWav, fishTtsBody, fishTtsCost, fishAsrCost } = await import("../src/voice/fish.js");
const { kokoroVoiceOf, validKokoroVoice } = await import("../src/voice/kokoro.js");
const { wavDurationMs } = await import("../src/voice/vad.js");
const { users } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot } from "../src/shared.js";

await initComputer();
registerProvider({
  id: "talkf", label: "Talk", models: ["t"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const text = "Bonjour, je t'écoute. Que puis-je faire ?";
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", model: "t", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
http.on("upgrade", (req, socket, head) => { socket.on("error", () => {}); if (!voiceUpgrade(req, socket, head)) socket.destroy(); });
await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
const PORT = (http.address() as { port: number }).port;
after(() => { for (const s of [http, fish, kokoro]) { s.closeAllConnections(); s.close(); } });

const u = users.create("lea@example.com", "Léa", hashPassword("password123"), "fr");
const cookie = `${SESSION_COOKIE}=${createSession(u.id).token}`;
const other = users.create("max@example.com", "Max", hashPassword("password123"), "en");
const otherCookie = `${SESSION_COOKIE}=${createSession(other.id).token}`;
async function call(method: string, url: string, body?: unknown, as = cookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const buf = Buffer.from(await res.arrayBuffer());
  const text = buf.toString();
  let json: any = null; try { json = JSON.parse(text); } catch { /* audio */ }
  return { status: res.status, json, text, buf, type: res.headers.get("content-type") ?? "" };
}
async function until<T>(probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, label: string, tries = 1200): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const lastFish = (p: string) => [...fishSeen].reverse().find((s) => s.url.startsWith(p))!;

test("documented request shapes: TTS body, streamed WAV completed, published prices", () => {
  assert.deepEqual(fishTtsBody({ text: "Salut.", voiceId: "voice0001fr", language: "fr-FR", speed: 1.2 }),
    { text: "Salut.", reference_id: "voice0001fr", format: "wav", sample_rate: 24000, latency: "balanced", normalize: true, language: "fr-FR", prosody: { speed: 1.2 } });
  // Speed 1 and "auto" are not sent (the API's own defaults); speed is clamped to the documented 0.5–2.0.
  assert.deepEqual(fishTtsBody({ text: "x", voiceId: "", language: "auto", speed: 1 }), { text: "x", format: "wav", sample_rate: 24000, latency: "balanced", normalize: true });
  assert.deepEqual((fishTtsBody({ text: "x", voiceId: "", speed: 9 }) as any).prosody, { speed: 2 });
  const wav = completeWav(Buffer.concat([streamedWavHeader(), Buffer.alloc(4801)]));
  assert.equal(wav.readUInt32LE(40), 4800);
  assert.equal(wav.readUInt32LE(4), 36 + 4800);
  assert.equal(wavDurationMs(wav), 100);
  assert.equal(wavDurationMs(completeWav(Buffer.alloc(4800))), 100, "raw PCM is wrapped as 24 kHz 16-bit mono");
  // $15 per million UTF-8 bytes (s2.1-pro); "é" is two bytes. Free model: 0. drama-3: $10 promo until 2026-12-01 08:00 UTC, then $50.
  assert.equal(fishTtsCost("s2.1-pro", "é".repeat(500_000)), 15);
  assert.equal(fishTtsCost("s2.1-pro-free", "abc"), 0);
  assert.equal(fishTtsCost("drama-3", "a".repeat(1_000_000), Date.UTC(2026, 10, 20)), 10);
  assert.equal(fishTtsCost("drama-3", "a".repeat(1_000_000), Date.UTC(2026, 11, 2)), 50);
  assert.equal(fishAsrCost(3599.2), 0.36, "rounded up to the second, $0.36 per hour");
  // Kokoro ids: language and gender from the documented prefix; weighted mixes accepted, junk refused.
  assert.deepEqual(kokoroVoiceOf("ff_siwis", "B-"), { id: "ff_siwis", name: "Siwis", language: "fr", gender: "female", grade: "B-" });
  assert.equal(kokoroVoiceOf("am_michael").language, "en-US");
  assert.ok(validKokoroVoice("af_bella(2)+af_sky(1)"));
  assert.ok(!validKokoroVoice("../etc") && !validKokoroVoice("af_bella; rm"));
});

test("account settings: the Fish Audio key is sealed, never returned; the test speaks and transcribes through Fish Audio", async () => {
  assert.equal((await call("GET", "/voice/fish/voices")).status, 409, "no key yet");
  const r = await call("PUT", "/voice", { stt: { provider: "fish", language: "fr" }, tts: { provider: "fish", model: "s2.1-pro", voice: "voice0002en" }, fishKey: KEY });
  assert.equal(r.status, 200);
  assert.equal(r.json.settings.fish.hasKey, true);
  assert.equal(r.json.status.mode, "server");
  assert.deepEqual([r.json.status.stt, r.json.status.tts], ["fish", "fish"]);
  for (const res of [r, await call("GET", "/voice")]) assert.ok(!res.text.includes(KEY), "the key never comes back");
  assert.ok(!q.get<{ voice: string }>("SELECT voice FROM settings WHERE user_id = ?", u.id)!.voice.includes(KEY), "stored sealed");
  const before = fishSeen.length;
  const t = await call("POST", "/voice/test");
  assert.equal(t.json.ok, true, t.text);
  assert.equal(t.json.heard, "bonjour");
  const [tts, asr] = fishSeen.slice(before);
  // TTS: POST /v1/tts, bearer key, JSON, the model header, the documented body.
  assert.equal(tts.url, "/v1/tts");
  assert.equal(tts.headers.authorization, `Bearer ${KEY}`);
  assert.match(String(tts.headers["content-type"]), /^application\/json/);
  assert.equal(tts.headers.model, "s2.1-pro");
  const tb = JSON.parse(tts.body.toString());
  assert.deepEqual(Object.keys(tb).sort(), ["format", "latency", "normalize", "reference_id", "sample_rate", "text"]);
  assert.equal(tb.reference_id, "voice0002en");
  assert.equal(tb.text, "Bonjour, ceci est un test de voix.");
  // ASR: POST /v1/asr, multipart with the `audio` file, the model header, pro-only fields with the pro model.
  assert.equal(asr.url, "/v1/asr");
  assert.equal(asr.headers.model, "transcribe-1-pro");
  assert.equal(asr.headers.authorization, `Bearer ${KEY}`);
  const form = asr.body.toString("latin1");
  assert.match(String(asr.headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.ok(form.includes('name="audio"; filename="audio.wav"') && form.includes("RIFF"));
  for (const [k, v] of [["ignore_timestamps", "true"], ["language", "fr"], ["tag_audio_events", "false"], ["diarize", "false"]]) assert.ok(form.includes(`name="${k}"\r\n\r\n${v}\r\n`), k);
  // The usage: one priced line per service, on the account's own key.
  const lines = q.all<{ model: string; cost_usd: number; price_status: string }>("SELECT model, cost_usd, price_status FROM usage WHERE user_id = ? ORDER BY id", u.id);
  const ttsLine = lines.find((l) => l.model === "fish:s2.1-pro")!;
  assert.equal(ttsLine.price_status, "reported");
  assert.ok(Math.abs(ttsLine.cost_usd - (Buffer.byteLength("Bonjour, ceci est un test de voix.") / 1e6) * 15) < 1e-12);
  assert.ok(Math.abs(lines.find((l) => l.model === "fish:transcribe-1-pro")!.cost_usd - (2 / 3600) * 0.36) < 1e-12, "1.2 s billed as 2 s");
  // Removing the key: back to the browser.
  const off = await call("PUT", "/voice", { fishKey: null });
  assert.equal(off.json.settings.fish.hasKey, false);
  assert.equal(off.json.status.mode, "browser");
  await call("PUT", "/voice", { fishKey: KEY });
});

test("voice library: search through GET /model with the documented parameters, cached briefly, a pasted id checked", async () => {
  const before = fishSeen.length;
  const r = await call("GET", "/voice/fish/voices?q=cam&language=fr&licensed=1");
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json.items.map((v: any) => [v.id, v.title, v.author, v.likes, v.licensed, v.languages[0]]), [["voice0001fr", "Camille", "Studio Lumière", 1234, true, "fr"]]);
  const seen = fishSeen.slice(before);
  assert.equal(seen.length, 1);
  const url = new URL(seen[0].url, "http://x");
  assert.equal(url.pathname, "/model");
  assert.deepEqual(Object.fromEntries(url.searchParams), { page_size: "20", page_number: "1", sort_by: "score", title: "cam", language: "fr", licensed: "true" });
  assert.equal(seen[0].headers.authorization, `Bearer ${KEY}`);
  assert.ok(!r.text.includes(KEY));
  await call("GET", "/voice/fish/voices?q=cam&language=fr&licensed=1");
  assert.equal(fishSeen.length, before + 1, "the same search within a minute is answered from the cache");
  assert.equal((await call("GET", "/voice/fish/voice?id=../../x")).status, 400);
  assert.equal((await call("GET", "/voice/fish/voice?id=unknown0001")).status, 404);
  const one = await call("GET", "/voice/fish/voice?id=voice0002en");
  assert.equal(one.json.voice.title, "Narrator");
  assert.equal(lastFish("/model/").url, "/model/voice0002en");
  // Another account has its own (no) key: nothing of Léa's is used.
  assert.equal((await call("GET", "/voice/fish/voices?q=cam", undefined, otherCookie)).status, 409);
});

test("a voice per bot: chosen, previewed in the bot's language, used in a call (with its speaking rate); others cannot touch it", async () => {
  // The account's default speaks with piper, which is not set up: only the bot's own voice makes calls possible.
  await call("PUT", "/voice", { tts: { provider: "piper" } });
  const bot = (await call("POST", "/bots", { name: "Juno" })).json.bot as Bot;
  await call("PATCH", `/bots/${bot.id}`, { model: "talkf:t", voice: { name: "", rate: 1.2, lang: "fr-FR" } });
  assert.equal((await call("GET", `/bots/${bot.id}/voice`)).json.status.mode, "browser");
  const c0 = await call("GET", `/bots/${bot.id}/voice/choice`);
  assert.deepEqual([c0.json.choice, c0.json.fish.hasKey, c0.json.kokoro.available], [null, true, true]);
  assert.equal((await call("PUT", `/bots/${bot.id}/voice/choice`, { provider: "fish", voiceId: "bad id!" })).status, 400);
  const set = await call("PUT", `/bots/${bot.id}/voice/choice`, { provider: "fish", voiceId: "voice0001fr", name: "Camille", author: "Studio Lumière", language: "fr-FR" });
  assert.deepEqual(set.json.choice, { provider: "fish", voiceId: "voice0001fr", name: "Camille", author: "Studio Lumière", language: "fr-FR" });
  assert.equal(set.json.status.mode, "server");
  assert.equal(set.json.status.tts, "fish");
  // Another account: as if the bot did not exist.
  for (const [m, p] of [["GET", "choice"], ["PUT", "choice"], ["POST", "preview"]] as const) assert.equal((await call(m, `/bots/${bot.id}/voice/${p}`, { voiceId: "voice0002en" }, otherCookie)).status, 404);
  // "Listen": another voice, a short sample in the bot's language, as WAV.
  const pv = await call("POST", `/bots/${bot.id}/voice/preview`, { provider: "fish", voiceId: "voice0002en" });
  assert.equal(pv.status, 200, pv.text);
  assert.equal(pv.type, "audio/wav");
  assert.equal(pv.buf.toString("ascii", 0, 4), "RIFF");
  const pb = JSON.parse(lastFish("/v1/tts").body.toString());
  assert.equal(pb.reference_id, "voice0002en");
  assert.match(pb.text, /^Bonjour, je suis Juno/);
  assert.deepEqual(pb.prosody, { speed: 1.2 }, "the bot's speaking rate");
  // A Fish Audio refusal is explained (no credit), not a bare 500.
  const broke = await call("POST", `/bots/${bot.id}/voice/preview`, { provider: "fish", voiceId: "needscredit1" });
  assert.equal(broke.status, 502);
  assert.match(broke.json.error, /no API credit/);
  // The call: the reply is read with the bot's voice.
  const ttsBefore = fishSeen.filter((s) => s.url === "/v1/tts").length;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/voice/${bot.id}`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const msgs: any[] = [];
  const audio: Buffer[] = [];
  ws.on("message", (d, bin) => { if (bin) audio.push(d as Buffer); else msgs.push(JSON.parse(String(d))); });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang: "fr-FR" }));
  const ready = await until(() => msgs.find((m) => m.type === "ready"), "ready");
  assert.deepEqual([ready.stt, ready.tts], ["fish", "fish"]);
  // 0.7 s of a tone between silences: one utterance.
  const pcm = new Int16Array(16000 * 2);
  for (let i = 4800; i < 4800 + 11200; i++) pcm[i] = Math.round(Math.sin((2 * Math.PI * 220 * i) / 16000) * 0.3 * 32767);
  for (let i = 0; i < pcm.length; i += 320) { ws.send(Buffer.from(pcm.slice(i, i + 320).buffer)); await new Promise((r) => setTimeout(r, 3)); }
  await until(() => msgs.filter((m) => m.type === "audio").length >= 2 && audio.length >= 2, `reply read out ${JSON.stringify(msgs)}`);
  const calls = fishSeen.filter((s) => s.url === "/v1/tts").slice(ttsBefore).map((s) => JSON.parse(s.body.toString()));
  assert.deepEqual(calls.map((b) => b.text), ["Bonjour, je t'écoute.", "Que puis-je faire ?"]);
  for (const b of calls) { assert.equal(b.reference_id, "voice0001fr"); assert.equal(b.language, "fr-FR"); assert.deepEqual(b.prosody, { speed: 1.2 }); }
  assert.equal(wavDurationMs(audio[0]), 100, "a complete WAV reaches the browser (sizes fixed)");
  ws.close(1000);
  // Back to the account's voice.
  const reset = await call("PUT", `/bots/${bot.id}/voice/choice`, { voiceId: null });
  assert.equal(reset.json.choice, null);
  assert.equal(reset.json.status.mode, "browser");
  // A deleted bot takes its voice with it.
  await call("PUT", `/bots/${bot.id}/voice/choice`, { provider: "fish", voiceId: "voice0001fr" });
  await call("DELETE", `/bots/${bot.id}`);
  assert.equal(q.get("SELECT 1 FROM bot_voices WHERE bot_id = ?", bot.id), undefined);
});

test("Kokoro: voice list, a bot's Kokoro voice (documented speech request), account default on Kokoro; no key ever", async () => {
  const list = await call("GET", "/voice/kokoro/voices");
  assert.equal(list.status, 200, list.text);
  assert.deepEqual(list.json.voices.map((v: any) => [v.id, v.language, v.gender]), [["af_heart", "en-US", "female"], ["ff_siwis", "fr", "female"], ["jm_kumo", "ja", "male"]]);
  assert.equal(kokoroSeen.at(-1)!.url, "/v1/audio/voices");
  const bot = (await call("POST", "/bots", { name: "Kiki" })).json.bot as Bot;
  await call("PATCH", `/bots/${bot.id}`, { voice: { name: "", rate: 0.8, lang: "auto" } });
  assert.equal((await call("PUT", `/bots/${bot.id}/voice/choice`, { provider: "kokoro", voiceId: "not a voice" })).status, 400);
  const set = await call("PUT", `/bots/${bot.id}/voice/choice`, { provider: "kokoro", voiceId: "ff_siwis", name: "Siwis", author: "Kokoro-82M" });
  assert.equal(set.json.status.tts, "kokoro");
  const pv = await call("POST", `/bots/${bot.id}/voice/preview`, {});
  assert.equal(pv.status, 200, pv.text);
  assert.equal(wavDurationMs(pv.buf), 100);
  const sent = kokoroSeen.at(-1)!;
  assert.equal(sent.url, "/v1/audio/speech");
  assert.equal(sent.headers.authorization, undefined, "Kokoro takes no key");
  const body = JSON.parse(sent.body.toString());
  assert.deepEqual(body, { model: "kokoro", input: "Bonjour, je suis Kiki. Voici ma voix : est-ce qu'elle te plaît ?", voice: "ff_siwis", response_format: "wav", stream: false, speed: 0.8 });
  // A documented weighted mix can be previewed and chosen.
  assert.equal((await call("POST", `/bots/${bot.id}/voice/preview`, { provider: "kokoro", voiceId: "af_bella(2)+af_sky(1)" })).status, 200);
  assert.equal(JSON.parse(kokoroSeen.at(-1)!.body.toString()).voice, "af_bella(2)+af_sky(1)");
  // The account's default voice on Kokoro (the server's address).
  const acc = await call("PUT", "/voice", { tts: { provider: "kokoro", voice: "af_heart", url: "" } });
  assert.equal(acc.json.status.tts, "kokoro");
  const t = await call("POST", "/voice/test");
  assert.equal(t.json.ok, true, t.text);
  assert.equal(JSON.parse(kokoroSeen.at(-1)!.body.toString()).voice, "af_heart");
});

test("the call's speech is cancelled on barge-in: the speech service gets an abort signal, and no error is shown", async () => {
  const sent: (string | Buffer)[] = [];
  let aborted = 0;
  const s = new VoiceSession({
    send: (d) => sent.push(d), stt: async () => "",
    tts: (_text, signal) => new Promise<Buffer>((resolve, reject) => {
      const timer = setTimeout(() => resolve(completeWav(Buffer.alloc(4800))), 400);
      signal?.addEventListener("abort", () => { clearTimeout(timer); aborted++; reject(new Error("aborted")); });
    }),
    submit: () => {}, interrupt: () => {}, botBusy: () => false, partials: false, bargeIn: { enabled: true, minSpeechMs: 200 },
  });
  s.botText(1, "Une. Deux. Trois. Quatre.", false);
  await new Promise((r) => setTimeout(r, 50));
  s.bargeIn();
  await s.idle();
  assert.equal(aborted, 2, "the two sentences being synthesized ahead were cancelled");
  assert.ok(!sent.some((d) => typeof d === "string" && JSON.parse(d).type === "error"));
  assert.ok(!sent.some((d) => typeof d === "string" && JSON.parse(d).type === "audio"));
});
