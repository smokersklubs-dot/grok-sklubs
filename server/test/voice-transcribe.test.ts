import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

/**
 * Server voice by default, and one-shot dictation (server/src/voice/transcribe.ts): POST /api/voice/transcribe takes one
 * 16 kHz mono WAV and answers { text } through the account's speech-to-text. The speech services are a local fake of
 * whisper.cpp's server (POST /inference, multipart `file`, `response_format=json`, `language`; answers {"text"}) and of
 * Fish Audio's POST /v1/asr (metered on the account's usage).
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-transcribe-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
for (const k of ["OPENAI_API_KEY", "HOSTED_MODE", "VOICE_LOCAL", "VOICE_STT_PROVIDER", "VOICE_TTS_PROVIDER", "VOICE_KOKORO_URL"]) delete process.env[k];

const seen: { url: string; body: Buffer; headers: IncomingMessage["headers"] }[] = [];
let failNext = false;
const fake = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  seen.push({ url: req.url!, body, headers: req.headers });
  res.setHeader("content-type", "application/json");
  if (failNext) { failNext = false; res.statusCode = 500; res.end("{}"); return; }
  if (req.url === "/inference" && req.method === "POST") { res.end(JSON.stringify({ text: "  bonjour Sklubot  " })); return; }
  if (req.url === "/v1/asr" && req.method === "POST") { res.end(JSON.stringify({ text: "salut", duration: 2, segments: [] })); return; }
  if (req.url === "/synthesize") { res.setHeader("content-type", "audio/wav"); res.end(wav(0.2)); return; }
  res.statusCode = 404; res.end("{}");
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const FAKE = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
process.env.VOICE_STT_URL = FAKE;
process.env.VOICE_TTS_URL = FAKE;
process.env.FISH_AUDIO_URL = FAKE;
after(() => { fake.closeAllConnections(); fake.close(); });

const { api } = await import("../src/routes.js");
const { users, bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
const { localVoiceUrl, LOCAL_STT_URL, LOCAL_TTS_URL } = await import("../src/config.js");
const { reachable } = await import("../src/voice/providers.js");
const { inspectWav, transcribeLimits, TRANSCRIBE_MAX_BYTES } = await import("../src/voice/transcribe.js");
const { emailGateAllows } = await import("../src/publicsignup.js");

/** A WAV of `seconds` of silence: 16-bit mono PCM at `rate`. */
function wav(seconds: number, rate = 16000, channels = 1): Buffer {
  const n = Math.round(seconds * rate) * channels;
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(channels, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2 * channels, 28); h.writeUInt16LE(2 * channels, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}

let n = 0;
function account(locale: "fr" | "en" = "fr") {
  const u = users.create(`t${++n}@example.com`, `T${n}`, hashPassword("password123"), locale);
  return { user: u, cookie: `${SESSION_COOKIE}=${createSession(u.id).token}` };
}
async function post(cookie: string, url: string, body: Uint8Array | ReadableStream | string, type = "audio/wav", extra: Record<string, string> = {}) {
  const init: RequestInit & { duplex?: string } = { method: "POST", headers: { "content-type": type, cookie, ...extra }, body: body as BodyInit };
  if (body instanceof ReadableStream) init.duplex = "half";
  const res = await api.request(url, init);
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
const get = async (cookie: string, url: string) => (await api.request(url, { headers: { cookie } })).json() as Promise<any>;

test("compose files: whisper.cpp, Piper and Kokoro run by default, on the internal voice network only, bounded and without privileges", () => {
  for (const file of ["docker-compose.coolify.yml", "docker-compose.vps.yml"]) {
    const y = readFileSync(path.join(import.meta.dirname, "../..", file), "utf8");
    // A service's block: from "  name:" to the next service (or the top-level networks:).
    const block = (name: string) => { const m = new RegExp(`\\n  ${name}:\\n([\\s\\S]*?)(?=\\n  [a-z][\\w-]*:\\n|\\nnetworks:)`).exec(y); assert.ok(m, `${file}: ${name}`); return m![1]; };
    assert.match(y, /VOICE_STT_URL: "\$\{SKLUBOT_VOICE_STT_URL:-http:\/\/whisper:8080\}"/, file);
    assert.match(y, /VOICE_TTS_URL: "\$\{SKLUBOT_VOICE_TTS_URL:-http:\/\/piper:5000\}"/, file);
    assert.match(y, /VOICE_LOCAL: "\$\{SKLUBOT_VOICE_LOCAL:-1\}"/, file);
    assert.doesNotMatch(y, /profiles: \["voice"\]/, `${file}: no "voice" profile any more`);
    // Kokoro too (by default since the bots' automatic voices): its address, its own opt-out, and an idle mode.
    assert.match(y, /VOICE_KOKORO_URL: "\$\{SKLUBOT_VOICE_KOKORO_URL:-http:\/\/kokoro:8880\}"/, file);
    assert.match(block("kokoro"), /KOKORO: "\$\{SKLUBOT_KOKORO:-1\}"/);
    assert.match(block("kokoro"), /DOWNLOAD_MODEL: "false"/, "nothing downloaded at start (no Internet on the voice network)");
    assert.match(block("kokoro"), /exec sleep infinity; fi; exec \.\/entrypoint\.sh/);
    assert.match(block("kokoro"), /mem_limit: "\$\{KOKORO_MEM_LIMIT:-2g\}"/);
    assert.match(block("kokoro"), /pids_limit: /); assert.match(block("kokoro"), /cpu_shares: 512/);
    for (const svc of ["whisper", "piper", "kokoro"]) {
      const b = block(svc);
      assert.doesNotMatch(b, /profiles:/, `${file}: ${svc} runs without a profile`);
      assert.match(`${b}\n`, /\n {4}networks:\n {6}- voice\n(?! {6}- )/, `${file}: ${svc} only on the internal voice network`);
      assert.doesNotMatch(b, /ports:|- default/, `${file}: ${svc} never published nor on the bots' / app's default network`);
      assert.match(b, /mem_limit: /, `${file}: ${svc} memory limit`);
      assert.match(b, /cap_drop: \[ALL\]/); assert.match(b, /no-new-privileges:true/); assert.match(b, /read_only: true/);
    }
    assert.match(block("whisper"), /whisper_models:\/models:ro/, "whisper reads its model read-only");
    assert.match(block("whisper"), /@sha256:[0-9a-f]{64}/, "pinned image");
    // Only the one-shot model download has Internet; it ends at once.
    const dl = block("whisper-model");
    assert.match(dl, /restart: "no"/); assert.match(dl, /cap_drop: \[ALL\]/); assert.match(dl, /WHISPER_MODEL: "\$\{WHISPER_MODEL:-small\}"/);
    assert.match(y, /voice:\n\s+name: sklubot_voice\n\s+internal: true/, `${file}: the voice network is internal`);
    // The bots' computers never join it (they have their own network, created by Sklubot).
    assert.doesNotMatch(block("sklubot").match(/BOTS_NETWORK: "([^"]+)"/)?.[1] ?? "", /voice/);
  }
  const piper = readFileSync(path.join(import.meta.dirname, "../../docker/piper/Dockerfile"), "utf8");
  assert.match(piper, /ARG PIPER_VOICES="fr_FR-siwis-medium /, "a French voice by default (the first one)");
  assert.match(piper, /CC BY 4\.0/, "its licence is written down");
});

test("SKLUBOT_VOICE_LOCAL=0 drops only the bundled addresses", () => {
  const saved = process.env.VOICE_LOCAL;
  try {
    delete process.env.VOICE_LOCAL;
    assert.equal(localVoiceUrl("http://whisper:8080/", LOCAL_STT_URL), "http://whisper:8080");
    process.env.VOICE_LOCAL = "1";
    assert.equal(localVoiceUrl(LOCAL_TTS_URL, LOCAL_TTS_URL), LOCAL_TTS_URL);
    process.env.VOICE_LOCAL = "0";
    assert.equal(localVoiceUrl(LOCAL_STT_URL, LOCAL_STT_URL), "");
    assert.equal(localVoiceUrl(LOCAL_TTS_URL, LOCAL_TTS_URL), "");
    assert.equal(localVoiceUrl("http://stt.internal:9000", LOCAL_STT_URL), "http://stt.internal:9000", "an address set by hand stays");
    assert.equal(localVoiceUrl("", LOCAL_STT_URL), "");
  } finally {
    if (saved === undefined) delete process.env.VOICE_LOCAL; else process.env.VOICE_LOCAL = saved;
  }
});

test("an operator service that does not answer stops counting (the app then uses the browser's speech)", async () => {
  const dead = createServer();
  await new Promise<void>((r) => dead.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(dead.address() as { port: number }).port}`;
  await new Promise<void>((r) => dead.close(() => r()));
  assert.equal(reachable(url), true, "unknown yet: up (the first call is not delayed)");
  for (let i = 0; i < 200 && reachable(url); i++) await new Promise((r) => setTimeout(r, 10));
  assert.equal(reachable(url), false);
  assert.equal(reachable(FAKE), true);
});

test("status: server voice by default; dictation offered whatever the call mode", async () => {
  const a = account();
  let r = await get(a.cookie, "/voice");
  assert.equal(r.status.mode, "server");
  assert.equal(r.status.dictation, true);
  await api.request("/voice", { method: "PUT", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ mode: "browser" }) });
  r = await get(a.cookie, "/voice");
  assert.equal(r.status.mode, "browser");
  assert.equal(r.status.dictation, true, "the browser's recognition may still fail: dictation can fall back to the server");
  // OpenAI chosen without any key: no speech-to-text, so no dictation.
  await api.request("/voice", { method: "PUT", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ mode: "auto", stt: { provider: "openai" } }) });
  r = await get(a.cookie, "/voice");
  assert.equal(r.status.dictation, false);
});

test("POST /voice/transcribe: a WAV through whisper.cpp, in the asked language; the answer trimmed", async () => {
  const a = account();
  const before = seen.length;
  const r = await post(a.cookie, "/voice/transcribe?lang=fr-FR", wav(1.5));
  assert.equal(r.status, 200, r.text);
  assert.deepEqual(r.json, { text: "bonjour Sklubot" });
  const sent = seen.slice(before).find((s) => s.url === "/inference")!;
  const body = sent.body.toString("latin1");
  assert.match(String(sent.headers["content-type"]), /^multipart\/form-data; boundary=/);
  assert.ok(body.includes('name="file"; filename="audio.wav"') && body.includes("RIFF"));
  assert.match(body, /name="response_format"\r\n\r\njson/);
  assert.match(body, /name="language"\r\n\r\nfr\r\n/);
  // With the bot: its owner's services (here the caller's own bot).
  const bot = bots.create(a.user.id, { name: "Dicté" } as any);
  assert.equal((await post(a.cookie, `/voice/transcribe?bot=${bot.id}`, wav(1))).json.text, "bonjour Sklubot");
});

test("limits: format, size (declared or streamed), length, too short; stranger's bot; rate", async () => {
  const a = account("en");
  assert.equal((await post(a.cookie, "/voice/transcribe", wav(1), "audio/webm")).status, 415);
  const r44 = await post(a.cookie, "/voice/transcribe", wav(1, 44100));
  assert.equal(r44.status, 415, "16 kHz only (the app resamples)");
  assert.equal(r44.json.code, "bad_format");
  assert.equal((await post(a.cookie, "/voice/transcribe", wav(1, 16000, 2))).status, 415, "mono only");
  assert.equal((await post(a.cookie, "/voice/transcribe", Buffer.from("RIFF....WAVEjunk"))).status, 415);
  assert.equal((await post(a.cookie, "/voice/transcribe", wav(1), "audio/wav", { "content-length": String(TRANSCRIBE_MAX_BYTES + 1) })).status, 413);
  // No declared length (streamed): cut off as soon as it goes over.
  const big = wav(70);
  const stream = new ReadableStream({ start(c) { for (let i = 0; i < big.length; i += 65536) c.enqueue(new Uint8Array(big.subarray(i, i + 65536))); c.close(); } });
  const r = await post(a.cookie, "/voice/transcribe", stream);
  assert.equal(r.status, 413);
  assert.equal(r.json.code, "too_long");
  const before = seen.length;
  assert.deepEqual((await post(a.cookie, "/voice/transcribe", wav(0.1))).json, { text: "" }, "too short: nothing to transcribe");
  assert.equal(seen.length, before, "and nothing sent to the service");
  // A stranger's bot does not exist for the caller.
  const other = account();
  const theirs = bots.create(other.user.id, { name: "Pas à toi" } as any);
  assert.equal((await post(a.cookie, `/voice/transcribe?bot=${theirs.id}`, wav(1))).status, 404);
  // The service fails: 502, in the caller's language.
  failNext = true;
  const f = await post(a.cookie, "/voice/transcribe", wav(1));
  assert.equal(f.status, 502);
  assert.equal(f.json.code, "stt_failed");
  // Rate: 12 a minute per caller.
  const c = account();
  const codes: number[] = [];
  for (let i = 0; i < 13; i++) codes.push((await post(c.cookie, "/voice/transcribe", wav(0.5))).status);
  assert.deepEqual(codes.slice(0, 12), Array(12).fill(200));
  assert.equal(codes[12], 429);
  assert.ok(transcribeLimits.perHour.limit >= 100 && transcribeLimits.perOwner.limit >= 12);
});

test("no speech-to-text configured: 409 no_stt with the way to Settings → Voice, in French", async () => {
  const a = account("fr");
  await api.request("/voice", { method: "PUT", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ stt: { provider: "openai" } }) });
  const r = await post(a.cookie, "/voice/transcribe", wav(1));
  assert.equal(r.status, 409);
  assert.equal(r.json.code, "no_stt");
  assert.match(r.json.error, /Réglages → Voix/);
});

test("metered like other voice use: Fish Audio's transcription is written to the account's usage", async () => {
  const a = account();
  await api.request("/voice", { method: "PUT", headers: { "content-type": "application/json", cookie: a.cookie }, body: JSON.stringify({ stt: { provider: "fish" }, fishKey: "fish-key-123" }) });
  const r = await post(a.cookie, "/voice/transcribe", wav(2));
  assert.equal(r.json.text, "salut");
  const asr = [...seen].reverse().find((s) => s.url === "/v1/asr")!;
  assert.equal(asr.headers.authorization, "Bearer fish-key-123");
  const lines = q.all<{ model: string; cost_usd: number }>("SELECT model, cost_usd FROM usage WHERE user_id = ?", a.user.id);
  assert.equal(lines.length, 1);
  assert.match(lines[0].model, /^fish:/);
  assert.ok(lines[0].cost_usd > 0);
});

test("the route is behind the e-mail gate, and the WAV check reads real chunk layouts", () => {
  assert.equal(emailGateAllows("POST", "/api/voice/transcribe"), false);
  // A LIST chunk before "data" (what some encoders write) is skipped.
  const plain = wav(1);
  const list = Buffer.concat([Buffer.from("LIST"), Buffer.from([4, 0, 0, 0]), Buffer.from("INFO")]);
  const withList = Buffer.concat([plain.subarray(0, 36), list, plain.subarray(36)]);
  assert.deepEqual(inspectWav(withList), { ok: true, seconds: 1 });
  assert.equal(inspectWav(Buffer.alloc(10)).ok, false);
});
