import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w6voice-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.MAX_STEPS = "8";
delete process.env.OPENAI_API_KEY;

// ── Fake speech services: a whisper.cpp-like /inference and a Piper-like /synthesize ──
const SR = 16000;
const sttCalls: { bytes: number; language: string }[] = [];
/**
 * What the fake transcriber "hears" depends on the tone in the audio (zero crossings), so interim (partial) requests
 * and final ones agree: 220 Hz "bonjour", 330 Hz "raconte une histoire", 440 Hz "stop", silence: the test sentence.
 */
const heard: string[] = [];
function hear(wavBytes: Buffer): string {
  const pcm = new Int16Array(wavBytes.buffer.slice(wavBytes.byteOffset + 44, wavBytes.byteOffset + wavBytes.length - (wavBytes.length % 2)));
  // Zero crossings with hysteresis (noise never reaches ±2000), over the span where the tone is.
  let state = 0; let flips = 0; let first = -1; let last = -1;
  for (let i = 0; i < pcm.length; i++) {
    const v = pcm[i];
    if (Math.abs(v) > 2000) { if (first < 0) first = i; last = i; }
    if (v > 2000 && state !== 1) { if (state) flips++; state = 1; } else if (v < -2000 && state !== -1) { if (state) flips++; state = -1; }
  }
  if (first < 0 || last - first < 1600) return "bonjour ceci est un test";
  const hz = (flips / 2) / ((last - first) / SR);
  return hz < 275 ? "bonjour" : hz < 385 ? "raconte une histoire" : "stop";
}
let ttsCalls: string[] = [];
function wav(ms: number): Buffer {
  const n = Math.round((SR * ms) / 1000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(SR, 24); h.writeUInt32LE(SR * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}
const speech = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  if (req.url === "/inference" && req.method === "POST") {
    const body = raw.toString("latin1");
    assert.match(String(req.headers["content-type"]), /^multipart\/form-data; boundary=/);
    assert.ok(body.includes('name="file"; filename="audio.wav"') && body.includes("RIFF") && body.includes('name="response_format"\r\n\r\njson'));
    const language = /name="language"\r\n\r\n([^\r]*)/.exec(body)?.[1] ?? "";
    sttCalls.push({ bytes: raw.length, language });
    // Utterances shorter than ~1.5 s are partial snapshots in these tests? No: partials only run for >0.8 s, so answer by size.
    res.setHeader("content-type", "application/json");
    const fileAt = raw.indexOf(Buffer.from("RIFF"));
    const end = raw.lastIndexOf(Buffer.from("\r\n--"));
    res.end(JSON.stringify({ text: hear(raw.subarray(fileAt, end)) }));
    return;
  }
  if (req.url === "/synthesize" && req.method === "POST") {
    const { text } = JSON.parse(raw.toString());
    ttsCalls.push(text);
    await new Promise((r) => setTimeout(r, 20));
    res.setHeader("content-type", "audio/wav");
    res.end(wav(400));
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => speech.listen(0, "127.0.0.1", () => r()));
const SPEECH = `http://127.0.0.1:${(speech.address() as { port: number }).port}`;
process.env.VOICE_STT_URL = SPEECH;
process.env.VOICE_TTS_URL = SPEECH;
process.env.VOICE_STT_PROVIDER = "whisper-cpp";
process.env.VOICE_TTS_PROVIDER = "piper";

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { Vad, rms, wavOf, wavDurationMs } = await import("../src/voice/vad.js");
const { VoiceSession, takeSentences, speakableText, voiceUpgrade } = await import("../src/voice/session.js");
const { users } = await import("../src/store.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

await initComputer();

/** A slow, streaming model: "long" answers in many sentences over ~2 s (so it can be interrupted); else one sentence. */
let modelCalls = 0;
let aborted = 0;
registerProvider({
  id: "talk", label: "Talk", models: ["t"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    modelCalls++;
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ");
    const long = said.includes("raconte");
    const parts = long ? Array.from({ length: 20 }, (_, i) => `Phrase numéro ${i + 1} de l'histoire. `) : ["Bonjour, je t'écoute. ", "Que puis-je faire ?"];
    let text = "";
    for (const p of parts) {
      if (req.signal?.aborted) { aborted++; throw new Error("aborted"); }
      text += p;
      req.onText?.(p);
      await new Promise((r) => setTimeout(r, long ? 140 : 10));
    }
    return { content: [{ type: "text", text }], stopReason: "end", model: "t", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

// ── Synthetic audio ──
const tone = (ms: number, amp = 0.3, freq = 220) => { const n = Math.round((SR * ms) / 1000); const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * amp * 32767); return a; };
const noise = (ms: number, amp = 0.003) => { const n = Math.round((SR * ms) / 1000); const a = new Int16Array(n); let s = 7; for (let i = 0; i < n; i++) { s = (s * 1103515245 + 12345) & 0x7fffffff; a[i] = Math.round(((s / 0x7fffffff) * 2 - 1) * amp * 32767); } return a; };
const join = (...p: Int16Array[]) => { const out = new Int16Array(p.reduce((a, b) => a + b.length, 0)); let at = 0; for (const x of p) { out.set(x, at); at += x.length; } return out; };

async function until<T>(probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, label: string, tries = 1600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}

test("VAD: silence and noise stay quiet, a short click is ignored, speech starts and ends, with pre-roll", () => {
  const vad = new Vad();
  assert.deepEqual(vad.push(noise(2000)), []);
  assert.ok(vad.noiseFloor < 0.01, `noise floor ${vad.noiseFloor}`);
  assert.deepEqual(vad.push(join(tone(40), noise(500))), [], "a 40 ms click is not speech");
  const ev = vad.push(join(tone(600), noise(900)));
  assert.deepEqual(ev.map((e) => e.type), ["start", "end"]);
  const end = ev[1] as { type: "end"; audio: Int16Array; ms: number };
  // The utterance holds the speech (600 ms), some pre-roll and the trailing silence before the end was called.
  assert.ok(end.ms >= 600 + 600 && end.ms <= 600 + 650 + 400, `utterance ${end.ms} ms`);
  assert.ok(rms(end.audio.subarray(0, 320)) < 0.05, "starts with the pre-roll, not mid-word");
  // Frames can arrive in any sizes.
  const v2 = new Vad();
  const all = join(noise(300), tone(500), noise(800));
  const out = [];
  for (let i = 0; i < all.length; i += 137) out.push(...v2.push(all.subarray(i, i + 137)));
  assert.deepEqual(out.map((e) => e.type), ["start", "end"]);
  // A raised start threshold (bot talking) needs longer speech.
  const v3 = new Vad();
  v3.setStartMs(300);
  assert.deepEqual(v3.push(join(noise(300), tone(200), noise(300))), []);
  assert.deepEqual(v3.push(join(tone(400))).map((e) => e.type), ["start"]);
  // Too long: cut at maxMs.
  const v4 = new Vad({ maxMs: 1000 });
  assert.deepEqual(v4.push(tone(1500)).map((e) => e.type), ["start", "end", "start"], "cut at 1 s, then the next utterance starts");
  // WAV helpers.
  assert.equal(wavDurationMs(wavOf(tone(500))), 500);
});

test("speech text: sentences come out as they complete; markdown, links and code are not read", () => {
  assert.deepEqual(takeSentences("Bonjour. Comment ça va", false), { sentences: ["Bonjour."], rest: "Comment ça va" });
  assert.deepEqual(takeSentences("Bonjour. Comment ça va", true), { sentences: ["Bonjour.", "Comment ça va"], rest: "" });
  assert.deepEqual(takeSentences("Liste :\n- un\n", false).sentences, ["Liste :", "- un"]);
  assert.equal(speakableText("**Voici** [le lien](https://x.fr) et `code` ```js\nx\n``` https://y.fr fin"), "Voici le lien et fin");
});

test("barge-in logic: speaking while the bot talks stops its audio, drops what was not played, cancels the generation", async () => {
  const sent: (string | Buffer)[] = [];
  let interrupted = 0;
  let busy = true;
  const submitted: string[] = [];
  const s = new VoiceSession({
    send: (d) => sent.push(d), stt: async () => "attends", tts: async () => { await new Promise((r) => setTimeout(r, 30)); return wav(300); },
    submit: (t) => submitted.push(t), interrupt: () => { interrupted++; busy = false; }, botBusy: () => busy, partials: false, bargeIn: { enabled: true, minSpeechMs: 200 },
  });
  s.botText(5, "Première phrase. Deuxième phrase. Troisième", true);
  await s.idle();
  const audios = () => sent.filter((d) => typeof d === "string" && JSON.parse(d).type === "audio").length;
  assert.equal(audios(), 2);
  assert.ok(s.speaking);
  // A 100 ms sound while the bot talks is not enough (threshold raised to 200 ms)…
  s.onAudio(join(noise(200), tone(100), noise(200)));
  assert.equal(s.bargeIns, 0);
  // …speaking for real is.
  s.botText(5, "Première phrase. Deuxième phrase. Troisième phrase. Quatrième.", true);
  s.onAudio(tone(300));
  assert.equal(s.bargeIns, 1);
  assert.equal(interrupted, 1);
  assert.ok(sent.some((d) => typeof d === "string" && JSON.parse(d).type === "barge_in"));
  await s.idle();
  // What was queued before the barge-in never reaches the browser; the rest of that reply is never read.
  const before = audios();
  s.botText(5, "Première phrase. Deuxième phrase. Troisième phrase. Quatrième. Cinquième.", false);
  await s.idle();
  assert.equal(audios(), before);
  assert.ok(!s.speaking);
  // The user's words are transcribed and posted.
  s.onAudio(noise(900));
  await until(() => submitted.length, "utterance posted");
  assert.deepEqual(submitted, ["attends"]);
  // A new reply after that is read out again.
  s.botText(9, "Très bien.", false);
  await s.idle();
  assert.equal(audios(), before + 1);
  // Barge-in can be turned off.
  const quiet = new VoiceSession({ send: () => {}, stt: async () => "", tts: async () => wav(300), submit: () => {}, interrupt: () => { throw new Error("no"); }, botBusy: () => true, partials: false, bargeIn: { enabled: false, minSpeechMs: 200 } });
  quiet.botText(1, "Une phrase.", false);
  await quiet.idle();
  quiet.onAudio(tone(500));
  assert.equal(quiet.bargeIns, 0);
});

// ── The real WebSocket against the real server ──
const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
http.on("upgrade", (req, socket, head) => { socket.on("error", () => {}); if (!voiceUpgrade(req, socket, head)) socket.destroy(); });
await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
const PORT = (http.address() as { port: number }).port;
after(() => { http.closeAllConnections(); http.close(); speech.closeAllConnections(); speech.close(); });

const u = users.create("vic@example.com", "Vic", hashPassword("password123"), "fr");
const cookie = `${SESSION_COOKIE}=${createSession(u.id).token}`;
async function call(method: string, url: string, body?: unknown, as = cookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}
function open(botId: string, headers: Record<string, string> = { cookie, origin: `http://127.0.0.1:${PORT}` }): Promise<{ ws: WebSocket; msgs: any[]; audio: Buffer[]; status?: number }> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/voice/${botId}`, { headers });
    const msgs: any[] = [];
    const audio: Buffer[] = [];
    ws.on("message", (d, bin) => { if (bin) audio.push(d as Buffer); else msgs.push(JSON.parse(String(d))); });
    ws.on("unexpected-response", (_req, res) => resolve({ ws, msgs, audio, status: res.statusCode }));
    ws.on("open", () => resolve({ ws, msgs, audio }));
  });
}
/** Streams PCM like the AudioWorklet does: 20 ms frames, a little faster than real time. */
async function stream(ws: WebSocket, pcm: Int16Array) {
  for (let i = 0; i < pcm.length; i += 320) { ws.send(Buffer.from(pcm.slice(i, i + 320).buffer)); await new Promise((r) => setTimeout(r, 4)); }
}

test("WebSocket protocol: hello, an utterance transcribed and posted, the reply streamed back as audio, barge-in cancels the bot, the call is recorded", async () => {
  const bot = (await call("POST", "/bots", { name: "Voix" })).json.bot as Bot;
  await call("PATCH", `/bots/${bot.id}`, { model: "talk:t" });
  assert.equal((await call("GET", "/voice")).json.status.mode, "server");
  const { ws, msgs, audio } = await open(bot.id);
  ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang: "fr-FR" }));
  const ready = await until(() => msgs.find((m) => m.type === "ready"), "ready");
  assert.equal(ready.stt, "whisper-cpp");
  assert.equal(ready.tts, "piper");
  // First utterance: a short request.
  await stream(ws, join(noise(300), tone(700), noise(900)));
  await until(() => msgs.find((m) => m.type === "final" && m.text === "bonjour"), "final transcript");
  assert.ok(msgs.some((m) => m.type === "vad" && m.speaking === true));
  assert.equal(sttCalls.at(-1)!.language, "fr");
  // The reply is read out sentence by sentence, each as one audio message followed by its WAV.
  await until(() => msgs.filter((m) => m.type === "audio").length >= 2 && audio.length >= 2, "reply audio");
  assert.deepEqual(ttsCalls.slice(0, 2), ["Bonjour, je t'écoute.", "Que puis-je faire ?"]);
  assert.equal(audio[0].toString("ascii", 0, 4), "RIFF");
  for (const m of msgs.filter((x) => x.type === "audio")) ws.send(JSON.stringify({ type: "played", id: m.id }));
  // The user's words are in the chat as a voice message.
  const rowsNow = (await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[];
  assert.ok(rowsNow.some((r) => r.body.kind === "message" && r.body.role === "user" && r.body.text === "bonjour" && r.body.origin?.kind === "voice"));
  // Second utterance asks for a long story; the user cuts in while it is being read.
  ttsCalls = [];
  await stream(ws, join(tone(700, 0.3, 330), noise(900)));
  await until(() => ttsCalls.length >= 2, "story being read");
  const before = msgs.filter((m) => m.type === "barge_in").length;
  await stream(ws, join(tone(600, 0.3, 440)));
  await until(() => msgs.filter((m) => m.type === "barge_in").length > before, "barge-in");
  // The generation is cancelled: the model stops writing, the bot goes idle, the story is not read any further.
  await until(() => aborted >= 1, `generation cancelled (calls ${modelCalls}, tts ${JSON.stringify(ttsCalls)}, msgs ${JSON.stringify(msgs.map((m) => m.type + (m.text ? ":" + m.text : "")))})`);
  await until(async () => !(await call("GET", "/bots")).json.live[bot.id]?.running || null, "bot idle");
  const readSoFar = ttsCalls.length;
  assert.ok(readSoFar < 20, `only part of the story was read (${readSoFar})`);
  await stream(ws, noise(900));
  await until(() => msgs.find((m) => m.type === "final" && m.text === "stop"), `stop transcribed ${JSON.stringify(msgs.map((m) => m.type + (m.text ? ":" + m.text : "")))}`);
  // Hanging up records the call with its transcript.
  ws.send(JSON.stringify({ type: "bye" }));
  await until(async () => ((await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[]).find((r) => r.body.kind === "event" && r.body.event === "call" && r.body.call?.phase === "ended"), "call ended row");
  const ended = ((await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[]).find((r) => r.body.kind === "event" && r.body.call?.phase === "ended")!;
  const tr = (ended.body as { call: { transcript: { role: string; text: string }[] } }).call.transcript;
  assert.ok(tr.some((l) => l.role === "user" && l.text === "bonjour"));
  assert.ok(tr.some((l) => l.role === "assistant" && l.text.includes("je t'écoute")));
});

test("WebSocket guards: another site, no session, someone else's bot, wrong format; no service means the browser mode", async () => {
  const bot = (await call("POST", "/bots", { name: "Garde" })).json.bot as Bot;
  assert.equal((await open(bot.id, { cookie, origin: "https://evil.example" })).status, 403);
  assert.equal((await open(bot.id, { origin: `http://127.0.0.1:${PORT}` })).status, 401);
  const other = users.create("eve@example.com", "Eve", hashPassword("password123"), "en");
  assert.equal((await open(bot.id, { cookie: `${SESSION_COOKIE}=${createSession(other.id).token}`, origin: `http://127.0.0.1:${PORT}` })).status, 404);
  const { ws } = await open(bot.id);
  const closed = new Promise<number>((r) => ws.on("close", (code) => r(code)));
  ws.send(JSON.stringify({ type: "hello", sampleRate: 48000 }));
  assert.equal(await closed, 4400);
  // Browser mode chosen (or nothing configured): no server call, the app falls back to the browser's own speech.
  const r = await call("PUT", "/voice", { mode: "browser" });
  assert.equal(r.json.status.mode, "browser");
  assert.equal((await open(bot.id)).status, 409);
  const back = await call("PUT", "/voice", { mode: "auto", tts: { provider: "openai" } });
  assert.equal(back.json.status.mode, "browser", "OpenAI chosen without a key: not available");
  assert.equal(back.json.status.reason, "no text-to-speech service");
  // A key is sealed, never returned.
  const keyed = await call("PUT", "/voice", { ttsKey: "sk-test-123" });
  assert.equal(keyed.json.settings.tts.hasKey, true);
  assert.ok(!JSON.stringify(keyed.json).includes("sk-test-123"));
  await call("PUT", "/voice", { tts: { provider: "piper" }, ttsKey: null });
  // The test endpoint speaks and transcribes through the services.
  const t = await call("POST", "/voice/test");
  assert.equal(t.json.ok, true, t.text);
  assert.equal(t.json.heard, "bonjour ceci est un test");
});
