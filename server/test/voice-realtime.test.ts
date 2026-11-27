import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket, WebSocketServer } from "ws";

// L167 — the real-time voice model as an option (voice/realtime.ts, voice/realtimecall.ts): off by default, only the
// account's own key, the documented Realtime events, tool work delegated to the bot, approvals left to the screen.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-realtime-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.SKLUBOT_VOICE_LOCAL = "0";
process.env.VOICE_STT_PROVIDER = "openai";
process.env.VOICE_TTS_PROVIDER = "openai";
delete process.env.OPENAI_API_KEY;
delete process.env.HOSTED_MODE;

// ── A fake OpenAI Realtime endpoint: records what it gets, answers like the documented server events ──
const seen: { auth: string; url: string; events: any[] }[] = [];
const fake = new WebSocketServer({ port: 0, host: "127.0.0.1" });
fake.on("connection", (ws, req) => {
  const conn = { auth: String(req.headers.authorization ?? ""), url: String(req.url), events: [] as any[] };
  seen.push(conn);
  ws.on("message", (raw) => {
    const e = JSON.parse(String(raw));
    conn.events.push(e);
    // After the first audio: the user said something that needs the bot → a function call.
    if (e.type === "input_audio_buffer.append" && conn.events.filter((x) => x.type === "input_audio_buffer.append").length === 1) {
      ws.send(JSON.stringify({ type: "conversation.item.input_audio_transcription.completed", transcript: "Quel temps fait-il à Paris ?" }));
      ws.send(JSON.stringify({ type: "response.created" }));
      ws.send(JSON.stringify({ type: "response.done", response: { output: [{ type: "function_call", name: "ask_bot", call_id: "call_1", arguments: JSON.stringify({ request: "Quel temps fait-il à Paris ?" }) }], usage: { input_token_details: { audio_tokens: 1000, text_tokens: 200 }, output_token_details: { audio_tokens: 500, text_tokens: 20 } } } }));
    }
    if (e.type === "response.create") {
      const pcm = Buffer.alloc(24000); // 0.5 s of 24 kHz audio
      ws.send(JSON.stringify({ type: "response.created" }));
      ws.send(JSON.stringify({ type: "response.output_audio_transcript.delta", delta: "Il fait beau." }));
      ws.send(JSON.stringify({ type: "response.output_audio.delta", delta: pcm.toString("base64") }));
      ws.send(JSON.stringify({ type: "response.output_audio.done" }));
      ws.send(JSON.stringify({ type: "response.output_audio_transcript.done", transcript: "Il fait beau." }));
      ws.send(JSON.stringify({ type: "response.done", response: { output: [] } }));
    }
  });
});
await new Promise<void>((r) => fake.on("listening", () => r()));
process.env.OPENAI_REALTIME_URL = `ws://127.0.0.1:${(fake.address() as { port: number }).port}/v1/realtime`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { voiceUpgrade } = await import("../src/voice/session.js");
const { RealtimeBridge, Upsampler, realtimeCost, realtimeKey } = await import("../src/voice/realtime.js");
const { users } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";
await initComputer();

registerProvider({
  id: "talk", label: "Talk", models: ["t"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> {
    return { content: [{ type: "text", text: "Il fait 18 degrés et beau à Paris." }], stopReason: "end", model: "t", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

async function until<T>(probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}

test("upsampling 16 → 24 kHz keeps the length ratio across chunks and the shape of the signal", () => {
  const up = new Upsampler();
  let total = 0;
  for (let k = 0; k < 10; k++) { const pcm = new Int16Array(320).map((_, i) => Math.round(Math.sin(((k * 320 + i) / 16000) * 2 * Math.PI * 200) * 10000)); total += up.push(pcm).length; }
  assert.ok(Math.abs(total - 4800) <= 2, `3200 samples at 16 kHz → about 4800 at 24 kHz (got ${total})`);
  const ramp = new Upsampler().push(Int16Array.from([0, 300, 600, 900]));
  assert.deepEqual([...ramp], [0, 200, 400, 600, 800]);
});

test("cost from the documented usage fields and the published prices", () => {
  const usd = realtimeCost("gpt-realtime-2.1-mini", { input_token_details: { audio_tokens: 1_000_000, text_tokens: 0 }, output_token_details: { audio_tokens: 1_000_000, text_tokens: 0 } });
  assert.equal(usd, 30);
  assert.equal(realtimeCost("gpt-realtime", {}), 0);
});

test("the bridge: barge-in cancels the response, captions ride with the audio, an unknown function is refused", async () => {
  const toUp: any[] = [];
  const toBrowser: (string | Buffer)[] = [];
  const handlers: Record<string, (d: any) => void> = {};
  const upstream = { send: (d: string) => toUp.push(JSON.parse(d)), close: () => {}, on: (ev: string, fn: (d: any) => void) => { handlers[ev] = fn; } };
  const b = new RealtimeBridge({ upstream: upstream as never, send: (d) => toBrowser.push(d), delegate: async () => "x", model: "gpt-realtime-mini", voice: "marin", botName: "Nova", locale: "fr" });
  b.start();
  const s = toUp[0];
  assert.equal(s.type, "session.update");
  assert.equal(s.session.type, "realtime");
  assert.deepEqual(s.session.audio.input.format, { type: "audio/pcm", rate: 24000 });
  assert.equal(s.session.audio.output.voice, "marin");
  assert.deepEqual(s.session.tools.map((t: any) => t.name), ["ask_bot"]);
  assert.match(s.session.instructions, /French/);
  const ev = (o: unknown) => handlers.message(JSON.stringify(o));
  ev({ type: "response.created" });
  ev({ type: "response.output_audio_transcript.delta", delta: "Bonjour" });
  ev({ type: "response.output_audio.delta", delta: Buffer.alloc(24000).toString("base64") });
  const audio = toBrowser.map((d) => (typeof d === "string" ? JSON.parse(d) : null)).find((m) => m?.type === "audio");
  assert.equal(audio.text, "Bonjour");
  assert.equal(audio.ms, 500);
  ev({ type: "input_audio_buffer.speech_started" });
  assert.ok(toUp.some((e) => e.type === "response.cancel"), "the user speaking cuts the model off");
  assert.ok(toBrowser.some((d) => typeof d === "string" && JSON.parse(d).type === "barge_in"));
  ev({ type: "response.done", response: { output: [{ type: "function_call", name: "rm_rf", call_id: "c9", arguments: "{}" }] } });
  await until(() => toUp.find((e) => e.type === "conversation.item.create" && e.item.call_id === "c9"), "refusal sent");
  assert.equal(b.delegations, 0, "only ask_bot reaches the bot");
});

// ── The real call over the real WebSocket ──
const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
http.on("upgrade", (req, socket, head) => { socket.on("error", () => {}); if (!voiceUpgrade(req, socket, head)) socket.destroy(); });
await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
const PORT = (http.address() as { port: number }).port;
after(() => { http.closeAllConnections(); http.close(); fake.close(); });

const u = users.create("rt@example.com", "Rita", hashPassword("password123"), "fr");
const cookie = `${SESSION_COOKIE}=${createSession(u.id).token}`;
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text };
}

test("off by default; on without any key it is not available; the server's key is never used in hosted mode", async () => {
  const r = await call("GET", "/voice/realtime");
  assert.equal(r.json.realtime.enabled, false);
  assert.equal(r.json.realtime.reason, "off");
  assert.equal((await call("PUT", "/voice/realtime", { enabled: "yes" })).status, 400);
  const on = await call("PUT", "/voice/realtime", { enabled: true, model: "not-a-model", voice: "cedar" });
  assert.equal(on.json.realtime.enabled, true);
  assert.equal(on.json.realtime.model, "gpt-realtime-2.1-mini", "an unknown model keeps the default");
  assert.equal(on.json.realtime.voice, "cedar");
  assert.equal(on.json.realtime.available, false);
  assert.equal(on.json.realtime.reason, "no key");
  process.env.HOSTED_MODE = "1"; process.env.OPENAI_API_KEY = "sk-fake-operator";
  assert.equal(realtimeKey(u.id), null, "hosted mode: the operator's key never pays for this");
  delete process.env.HOSTED_MODE; delete process.env.OPENAI_API_KEY;
  // The account's own key, saved for its OpenAI speech services: available; the key is never sent back.
  const saved = await call("PUT", "/voice", { tts: { provider: "openai" }, ttsKey: "sk-fake-for-tests" });
  assert.ok(!saved.text.includes("sk-fake-for-tests"));
  const now = await call("GET", "/voice/realtime");
  assert.equal(now.json.realtime.available, true);
  assert.ok(!now.text.includes("sk-fake"));
});

test("a call over the real-time model: the key goes in the header, the request is delegated to the bot, its answer goes back, the call is recorded with its cost", async () => {
  const bot = (await call("POST", "/bots", { name: "Nova" })).json.bot as Bot;
  await call("PATCH", `/bots/${bot.id}`, { model: "talk:t" });
  assert.equal((await call("GET", `/bots/${bot.id}/voice`)).json.status.mode, "server");
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/voice/${bot.id}`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const msgs: any[] = [];
  const audio: Buffer[] = [];
  ws.on("message", (d, bin) => { if (bin) audio.push(d as Buffer); else msgs.push(JSON.parse(String(d))); });
  await new Promise((r) => ws.on("open", r));
  ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang: "fr-FR" }));
  const ready = await until(() => msgs.find((m) => m.type === "ready"), "ready");
  assert.equal(ready.stt, "realtime");
  assert.equal(ready.voice, "gpt-realtime-2.1-mini · cedar");
  await until(() => seen.length, "upstream opened");
  assert.equal(seen[0].auth, "Bearer sk-fake-for-tests");
  assert.match(seen[0].url, /\?model=gpt-realtime-2\.1-mini$/);
  ws.send(Buffer.from(new Int16Array(320).buffer));
  await until(() => msgs.find((m) => m.type === "final" && m.text === "Quel temps fait-il à Paris ?"), "user transcript");
  // Delegated: the request is in the bot's chat as a voice message, and the bot's answer went back as the function's output.
  const out = await until(() => seen[0].events.find((e) => e.type === "conversation.item.create" && e.item?.type === "function_call_output"), "function output");
  assert.equal(out.item.call_id, "call_1");
  assert.equal(JSON.parse(out.item.output).answer, "Il fait 18 degrés et beau à Paris.");
  const rows = (await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[];
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "user" && r.body.text === "Quel temps fait-il à Paris ?" && r.body.origin?.kind === "voice"));
  await until(() => msgs.find((m) => m.type === "audio" && m.text === "Il fait beau.") && audio.length, "spoken answer");
  assert.equal(audio[0].toString("ascii", 0, 4), "RIFF");
  assert.equal(audio[0].readUInt32LE(24), 24000, "a 24 kHz WAV");
  assert.ok(!msgs.some((m) => JSON.stringify(m).includes("sk-fake")), "the key never reaches the browser");
  ws.send(JSON.stringify({ type: "bye" }));
  const ended = await until(async () => ((await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[]).find((r) => r.body.kind === "event" && r.body.event === "call" && r.body.call?.phase === "ended"), "call recorded");
  const tr = (ended.body as { call: { transcript: { role: string; text: string }[] } }).call.transcript;
  assert.ok(tr.some((l) => l.role === "user" && l.text.includes("Paris")) && tr.some((l) => l.role === "assistant" && l.text === "Il fait beau."));
  const cost = q.get<{ c: number }>("SELECT SUM(cost_usd) AS c FROM usage WHERE user_id = ? AND model LIKE 'openai realtime%'", u.id)!.c;
  assert.ok(cost > 0, "the response's cost is in the account's usage");
});
