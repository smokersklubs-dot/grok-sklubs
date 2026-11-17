import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

// A voice per bot without any setting: free Piper voices given automatically (voice/autovoice.ts, voice/piper.ts),
// a full call turn through fake whisper.cpp + Piper servers, and "give all my bots a Fish voice" (voice/fishbulk.ts)
// against a fake Fish Audio API.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-botvoices-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.MAX_STEPS = "8";
delete process.env.OPENAI_API_KEY;
delete process.env.VOICE_LOCAL;

const SR = 16000;
function wav(ms: number, rate = 22050): Buffer {
  const n = Math.round((rate * ms) / 1000);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + n * 2, 4); h.write("WAVE", 8); h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(rate, 24); h.writeUInt32LE(rate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write("data", 36); h.writeUInt32LE(n * 2, 40);
  return Buffer.concat([h, Buffer.alloc(n * 2)]);
}

// ── Fake whisper.cpp (/inference) and Piper (/synthesize, /voices, /) on one address, as on the compose's network ──
const synth: Record<string, unknown>[] = [];
let sttHits = 0;
const speech = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  if (req.url === "/inference" && req.method === "POST") {
    assert.ok(raw.toString("latin1").includes('name="file"; filename="audio.wav"'));
    sttHits++;
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ text: "Bonjour, tu m'entends ?" }));
    return;
  }
  if (req.url === "/synthesize" && req.method === "POST") {
    const body = JSON.parse(raw.toString()) as Record<string, unknown>;
    // What piper-tts 1.8.0's /synthesize reads: text, voice, speaker_id (an integer), length_scale, noise_scale, noise_w_scale.
    for (const k of Object.keys(body)) assert.ok(["text", "voice", "speaker_id", "length_scale", "noise_scale", "noise_w_scale"].includes(k), `unknown field ${k}`);
    if ("speaker_id" in body) assert.equal(typeof body.speaker_id, "number");
    synth.push(body);
    res.setHeader("content-type", "audio/wav");
    res.end(wav(300));
    return;
  }
  if (req.url === "/voices") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ "fr_FR-siwis-medium": {}, "fr_FR-upmc-medium": {}, "fr_FR-mls-medium": {}, "en_GB-vctk-medium": {} })); return; }
  if (req.url === "/") { res.end("<html>piper</html>"); return; }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => speech.listen(0, "127.0.0.1", () => r()));
const SPEECH = `http://127.0.0.1:${(speech.address() as { port: number }).port}`;
process.env.VOICE_STT_URL = SPEECH;
process.env.VOICE_TTS_URL = SPEECH;
process.env.VOICE_STT_PROVIDER = "whisper-cpp";
process.env.VOICE_TTS_PROVIDER = "piper";

// ── Fake Fish Audio: the library (GET /model) and text-to-speech (counted: proposing must not spend) ──
let fishTtsCalls = 0;
let fishLibraryCalls = 0;
const lib = (id: string, title: string, tags: string[], uses: number, extra: Record<string, unknown> = {}) => ({ _id: id, title, description: "", languages: ["fr"], tags, like_count: Math.round(uses / 10), task_count: uses, author: { nickname: "auteur" }, state: "trained", type: "tts", ...extra });
const LIBRARY = [
  lib("celeb000001", "Emmanuel Macron", ["male", "politician"], 900000),
  lib("celeb000002", "Voix de Goku", ["male", "anime"], 800000),
  lib("celeb000003", "Marie Dupont", ["female"], 700000),
  lib("celeb000004", "Narratrice douce", ["female", "celebrity"], 650000),
  lib("asmr0000001", "Chuchotement ASMR", ["female", "asmr"], 600000),
  lib("fem00000001", "Jeune femme calme", ["female", "conversational"], 500000),
  lib("fem00000002", "Voix professionnelle", ["female", "professional"], 400000),
  lib("male0000001", "Narrateur posé", ["male", "narration"], 450000),
  lib("male0000002", "Homme chaleureux", ["male", "friendly"], 300000),
  lib("neut0000001", "Voix claire", ["conversational"], 200000),
  lib("engl0000001", "Calm narrator", ["male", "narration"], 100000, { languages: ["en"] }),
];
const fish = createServer(async (req, res) => {
  for await (const _ of req) { /* drain */ }
  if (req.headers.authorization !== "Bearer fk-test") { res.statusCode = 401; res.end("{}"); return; }
  const u = new URL(req.url ?? "/", "http://x");
  if (u.pathname === "/model") {
    fishLibraryCalls++;
    const lang = u.searchParams.get("language") ?? "";
    const items = LIBRARY.filter((m) => !lang || m.languages.includes(lang));
    res.setHeader("content-type", "application/json");
    res.end(JSON.stringify({ total: items.length, items, has_more: false }));
    return;
  }
  if (u.pathname === "/v1/tts") { fishTtsCalls++; res.setHeader("content-type", "audio/wav"); res.end(wav(200, 24000)); return; }
  res.statusCode = 404; res.end("{}");
});
await new Promise<void>((r) => fish.listen(0, "127.0.0.1", () => r()));
process.env.FISH_AUDIO_URL = `http://127.0.0.1:${(fish.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { voiceUpgrade } = await import("../src/voice/session.js");
const { users } = await import("../src/store.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
const { PIPER_MODELS, PIPER_VOICES, PIPER_DEFAULT_MODELS, piperBody, availablePiperVoices, validPiperVoice } = await import("../src/voice/piper.js");
const { assignVoices, genderHint, hashId } = await import("../src/voice/autovoice.js");
const { KOKORO_AUTO } = await import("../src/voice/kokoro.js");
const { reachable } = await import("../src/voice/providers.js");
const { isImitation, fishCandidates, proposeFish } = await import("../src/voice/fishbulk.js");
const { voiceOf } = await import("../src/voice/fish.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, BotVoiceRow, FishBulkProposal } from "../src/shared.js";

await initComputer();
registerProvider({
  id: "talk", label: "Talk", models: ["t"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const parts = ["Oui, je t'entends très bien. ", "Que puis-je faire pour toi ?"];
    let text = "";
    for (const p of parts) { text += p; req.onText?.(p); await new Promise((r) => setTimeout(r, 10)); }
    return { content: [{ type: "text", text }], stopReason: "end", model: "t", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const http = createServer((_req, res) => { res.statusCode = 404; res.end(); });
http.on("upgrade", (req, socket, head) => { socket.on("error", () => {}); if (!voiceUpgrade(req, socket, head)) socket.destroy(); });
await new Promise<void>((r) => http.listen(0, "127.0.0.1", () => r()));
const PORT = (http.address() as { port: number }).port;
after(() => { for (const s of [http, speech, fish]) { s.closeAllConnections(); s.close(); } });

const owner = users.create("owner@example.com", "Owner", hashPassword("password123"), "fr");
const stranger = users.create("other@example.com", "Other", hashPassword("password123"), "fr");
const cookie = `${SESSION_COOKIE}=${createSession(owner.id).token}`;
const cookieB = `${SESSION_COOKIE}=${createSession(stranger.id).token}`;
async function call(method: string, url: string, body?: unknown, as = cookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
}
async function until<T>(probe: () => T | undefined | false | null | Promise<T | undefined | false | null>, label: string, tries = 1600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const tone = (ms: number, amp = 0.3, freq = 220) => { const n = Math.round((SR * ms) / 1000); const a = new Int16Array(n); for (let i = 0; i < n; i++) a[i] = Math.round(Math.sin((2 * Math.PI * freq * i) / SR) * amp * 32767); return a; };
const silence = (ms: number) => new Int16Array(Math.round((SR * ms) / 1000));
async function stream(ws: WebSocket, pcm: Int16Array) {
  for (let i = 0; i < pcm.length; i += 320) { ws.send(Buffer.from(pcm.slice(i, i + 320).buffer)); await new Promise((r) => setTimeout(r, 4)); }
}

// ── Pure parts ──────────────────────────────────────────────────────────────────────────────────────────────────
const mkBot = (id: string, name: string, at: number, extra: Partial<Bot> = {}) => ({ id, kind: "agent" as const, name, label: "", voice: { name: "", rate: 1, lang: "auto" }, createdAt: at, ...extra });

test("Piper requests: the documented /synthesize fields, voice and speaker of the catalogue, pace from the bot's rate", () => {
  assert.deepEqual(piperBody({ text: "Salut", voiceId: "" }), { text: "Salut" }, "no voice: Piper's default, nothing else");
  assert.deepEqual(piperBody({ text: "Salut", voiceId: "fr_FR-siwis-medium" }), { text: "Salut", voice: "fr_FR-siwis-medium" }, "single speaker: no speaker_id");
  assert.deepEqual(piperBody({ text: "Salut", voiceId: "fr_FR-mls-medium#62" }), { text: "Salut", voice: "fr_FR-mls-medium", speaker_id: 62 });
  assert.deepEqual(piperBody({ text: "Salut", voiceId: "fr_FR-upmc-medium#1", rate: 1.25 }), { text: "Salut", voice: "fr_FR-upmc-medium", speaker_id: 1, length_scale: 0.8 }, "faster bot: shorter phonemes");
  const v1 = piperBody({ text: "Salut", voiceId: "fr_FR-mls-medium#3", variant: 1 });
  assert.equal(v1.length_scale, 0.92); assert.equal(v1.noise_scale, 0.5); assert.equal(v1.noise_w_scale, 0.6);
  assert.deepEqual(piperBody({ text: "x", voiceId: "en_US-lessac-medium" }), { text: "x", voice: "en_US-lessac-medium" }, "a name typed in Settings → Voice is sent as is");
  assert.ok(!validPiperVoice("../../etc/passwd") && !validPiperVoice("fr_FR-mls-medium#99999") && validPiperVoice("fr_FR-mls-medium#124"));
});

test("licences: only permissive, commercial-use voices are shipped, and they are written down", () => {
  const allowed = new Set(["CC BY 4.0", "CC BY-SA 4.0", "CC0", "MIT"]);
  for (const m of PIPER_MODELS) assert.ok(allowed.has(m.licence), `${m.id}: ${m.licence}`);
  for (const v of PIPER_VOICES) {
    const m = PIPER_MODELS.find((x) => x.id === v.model);
    assert.ok(m, `${v.id} has a model`);
    assert.ok(v.speaker < m!.speakers, `${v.id}: speaker within the model`);
    assert.ok(v.gender === "female" ? v.f0 >= 165 : v.f0 <= 140, `${v.id}: pitch ${v.f0} Hz fits ${v.gender}`);
  }
  assert.equal(new Set(PIPER_VOICES.map((v) => v.id)).size, PIPER_VOICES.length, "no voice twice");
  assert.equal(new Set(PIPER_VOICES.map((v) => `${v.language}:${v.name}`)).size, PIPER_VOICES.length, "distinct names per language");
  for (const lang of ["fr", "en"]) for (const g of ["female", "male"]) assert.ok(PIPER_VOICES.filter((v) => v.language === lang && v.gender === g).length >= 8, `${lang} ${g}`);
  const docker = readFileSync(path.join(import.meta.dirname, "../../docker/piper/Dockerfile"), "utf8");
  assert.equal(/ARG PIPER_VOICES="([^"]+)"/.exec(docker)?.[1], PIPER_DEFAULT_MODELS.join(" "), "the image ships the catalogue's models");
  assert.doesNotMatch(docker.replace(/^#.*$/gm, ""), /tom-medium|ryan|semaine|lessac/);
  const doc = readFileSync(path.join(import.meta.dirname, "../../docs/VOIX.md"), "utf8");
  for (const m of PIPER_MODELS) { assert.ok(doc.includes(m.id), `docs/VOIX.md lists ${m.id}`); assert.ok(doc.includes(m.licence), `docs/VOIX.md gives ${m.licence}`); assert.ok(doc.includes(m.card), `docs/VOIX.md links ${m.id}'s model card`); }
  for (const out of ["fr_FR-tom-medium", "AGPL", "CC BY-NC-SA"]) assert.ok(doc.includes(out), `docs/VOIX.md says why ${out} is left out`);
});

test("automatic voices: stable, distinct within an account, gendered by name, in the bot's language", () => {
  const own = () => null;
  const bots10 = Array.from({ length: 10 }, (_, i) => mkBot(`bot_${i}_${hashId(String(i)).toString(36)}`, `Bot ${i}`, 1000 + i));
  const a = assignVoices({ bots: bots10, locale: "fr", own, models: null });
  assert.equal(a.size, 10);
  const pairs = (m: typeof a) => [...m.values()].map((x) => `${x.voice.id}|${x.variant}`);
  assert.equal(new Set(pairs(a)).size, 10, "ten bots, ten different voices");
  for (const v of a.values()) assert.equal(v.voice.language, "fr");
  // Same input in another order: same voices (sorted by creation); a new bot never moves the others.
  const again = assignVoices({ bots: [...bots10].reverse(), locale: "fr", own, models: null });
  for (const b of bots10) assert.equal(again.get(b.id)!.voice.id, a.get(b.id)!.voice.id);
  const more = [...bots10, ...Array.from({ length: 30 }, (_, i) => mkBot(`late_${i}`, `Late ${i}`, 5000 + i))];
  const b = assignVoices({ bots: more, locale: "fr", own, models: null });
  for (const x of bots10) assert.deepEqual([b.get(x.id)!.voice.id, b.get(x.id)!.variant], [a.get(x.id)!.voice.id, a.get(x.id)!.variant]);
  assert.equal(new Set(pairs(b)).size, 40, "forty bots: still all different (voice × pace variant)");
  // Gender hints.
  assert.equal(genderHint({ name: "Léa", label: "", voice: { name: "", rate: 1, lang: "auto" } }), "female");
  assert.equal(genderHint({ name: "Hugo le comptable", label: "", voice: { name: "", rate: 1, lang: "auto" } }), "male");
  assert.equal(genderHint({ name: "Nova", label: "Assistante commerciale", voice: { name: "", rate: 1, lang: "auto" } }), "female");
  assert.equal(genderHint({ name: "Nova", label: "", voice: { name: "Thomas", rate: 1, lang: "auto" } }), "male", "the browser voice it had");
  assert.equal(genderHint({ name: "Atlas", label: "Recherche", voice: { name: "", rate: 1, lang: "auto" } }), null);
  const g = assignVoices({ bots: [mkBot("g1", "Léa", 1), mkBot("g2", "Hugo", 2), mkBot("g3", "Emma", 3, { voice: { name: "", rate: 1, lang: "en-GB" } })], locale: "fr", own, models: null });
  assert.equal(g.get("g1")!.gender, "female"); assert.equal(g.get("g2")!.gender, "male");
  assert.equal(g.get("g3")!.voice.language, "en"); assert.equal(g.get("g3")!.gender, "female");
  // A bot with its own voice gets none; a Piper voice chosen by hand is not given to another bot.
  const chosen = PIPER_VOICES.find((v) => v.language === "fr" && v.gender === "female")!;
  const solo = [mkBot("c1", "Léa", 1), ...Array.from({ length: 9 }, (_, i) => mkBot(`f${i}`, ["Emma", "Chloé", "Manon", "Inès", "Jade", "Louise", "Lina", "Zoé", "Eva"][i], 10 + i))];
  const h = assignVoices({ bots: solo, locale: "fr", own: (id) => (id === "c1" ? { provider: "piper", voiceId: chosen.id, name: "", author: "", language: "" } : null), models: null });
  assert.ok(!h.has("c1"));
  assert.ok(![...h.values()].some((x) => x.voice.id === chosen.id && x.variant === 0), "the chosen voice stays that bot's");
  // Only the models this Piper has.
  const few = assignVoices({ bots: bots10, locale: "fr", own, models: new Set(["fr_FR-siwis-medium", "fr_FR-upmc-medium"]) });
  for (const v of few.values()) assert.ok(["fr_FR-siwis-medium", "fr_FR-upmc-medium"].includes(v.voice.id.split("#")[0]));
  assert.equal(new Set(pairs(few)).size, 10, "three voices, ten bots: pace variants keep them apart");
  assert.equal(availablePiperVoices(new Set()).length, 0);
  assert.equal(assignVoices({ bots: bots10, locale: "fr", own, models: new Set() }).size, 0, "no Piper model: no automatic voice");
});

test("with Kokoro: its voices first (quality), French mixes ff_siwis with Piper's, other languages get native voices", () => {
  const own = () => null;
  const en = Array.from({ length: 6 }, (_, i) => mkBot(`en${i}`, ["Emma", "Oliver", "Grace", "Harry", "Lucy", "Jack"][i], i, { voice: { name: "", rate: 1, lang: "en-US" } }));
  const fr = Array.from({ length: 4 }, (_, i) => mkBot(`fr${i}`, ["Léa", "Chloé", "Hugo", "Manon"][i], 10 + i));
  const es = [mkBot("es0", "Lucia", 20, { voice: { name: "", rate: 1, lang: "es-ES" } }), mkBot("de0", "Hans", 21, { voice: { name: "", rate: 1, lang: "de-DE" } })];
  const a = assignVoices({ bots: [...en, ...fr, ...es], locale: "fr", own, models: null, kokoro: null });
  for (const b of en) { const v = a.get(b.id)!; assert.equal(v.voice.provider, "kokoro", b.name); assert.equal(v.voice.language, "en"); assert.equal(v.variant, 0); }
  assert.equal(a.get("en0")!.voice.id, "af_heart", "the best voice to the first bot");
  assert.equal(a.get("en1")!.gender, "male");
  const frVoices = fr.map((b) => a.get(b.id)!.voice);
  assert.equal(frVoices.filter((v) => v.provider === "kokoro").length, 1, "one French Kokoro voice (ff_siwis)…");
  assert.equal(frVoices.find((v) => v.provider === "kokoro")!.id, "ff_siwis");
  assert.ok(frVoices.filter((v) => v.provider === "piper").length === 3, "…then Piper's French voices");
  assert.equal(new Set(frVoices.map((v) => v.id)).size, 4);
  assert.equal(a.get("fr2")!.gender, "male"); assert.equal(a.get("fr2")!.voice.provider, "piper", "no male French Kokoro voice");
  assert.deepEqual([a.get("es0")!.voice.provider, a.get("es0")!.voice.id], ["kokoro", "ef_dora"]);
  assert.equal(a.get("de0")!.voice.language, "fr", "no German voice: the account's language");
  // Kokoro down (false): the same bots fall back to Piper; a Kokoro with fewer voices: only those.
  const down = assignVoices({ bots: [...en, ...fr], locale: "fr", own, models: null, kokoro: false });
  assert.ok([...down.values()].every((v) => v.voice.provider === "piper"));
  assert.equal(new Set([...down.values()].map((v) => `${v.voice.id}|${v.variant}`)).size, 10);
  const few = assignVoices({ bots: en, locale: "fr", own, models: null, kokoro: new Set(["af_bella"]) });
  assert.equal([...few.values()].filter((v) => v.voice.provider === "kokoro").length, 1);
  assert.ok(KOKORO_AUTO.every((v) => !/santa/.test(v.id)), "no novelty voice");
});

test("Fish Audio filter: imitations of real people and characters are left out, everyday voices preferred", () => {
  const items = LIBRARY.map((m) => voiceOf(m));
  for (const id of ["celeb000001", "celeb000002", "celeb000003", "celeb000004"]) assert.ok(isImitation(items.find((v) => v.id === id)!), id);
  for (const id of ["fem00000001", "fem00000002", "male0000001", "male0000002", "neut0000001"]) assert.ok(!isImitation(items.find((v) => v.id === id)!), id);
  const c = fishCandidates(items, "fr").map((v) => v.id);
  assert.ok(!c.some((id) => id.startsWith("celeb") || id.startsWith("asmr") || id.startsWith("engl")), JSON.stringify(c));
  const p = proposeFish([mkBot("p1", "Léa", 1), mkBot("p2", "Hugo", 2), mkBot("p3", "Chloé", 3), mkBot("p4", "Arthur", 4)], "fr", new Map([["fr", fishCandidates(items, "fr")]]));
  assert.equal(p.length, 4);
  assert.equal(new Set(p.map((x) => x.voice.id)).size, 4, "a different voice per bot");
  assert.deepEqual(p.map((x) => x.voice.id.slice(0, 3)), ["fem", "mal", "fem", "mal"], "matched to the bot's likely gender");
});

// ── Through the server ──────────────────────────────────────────────────────────────────────────────────────────
let lea: Bot; let hugo: Bot;

test("out of the box: the server voice is detected and each bot already has its own named voice", async () => {
  lea = (await call("POST", "/bots", { name: "Léa" })).json.bot;
  hugo = (await call("POST", "/bots", { name: "Hugo" })).json.bot;
  for (const b of [lea, hugo]) await call("PATCH", `/bots/${b.id}`, { model: "talk:t" });
  const st = (await call("GET", "/voice")).json.status;
  assert.equal(st.mode, "server", JSON.stringify(st));
  const list = (await call("GET", "/voice/bots")).json as { bots: BotVoiceRow[]; piper: { available: boolean } };
  assert.equal(list.piper.available, true);
  const rl = list.bots.find((r) => r.botId === lea.id)!;
  const rh = list.bots.find((r) => r.botId === hugo.id)!;
  assert.ok(rl.auto && rh.auto && rl.provider === "piper");
  assert.equal(rl.gender, "female"); assert.equal(rh.gender, "male");
  assert.notEqual(rl.voiceId, rh.voiceId);
  assert.ok(rl.licence.startsWith("CC"));
  const s = (await call("GET", `/bots/${lea.id}/voice`)).json.status;
  assert.equal(s.mode, "server");
  assert.equal(s.voice, rl.voiceName, "the call button's tooltip names the voice");
  // "Listen" (no voice id): the bot's own automatic voice, sent to Piper with its model and speaker.
  synth.length = 0;
  const pv = await call("POST", `/bots/${hugo.id}/voice/preview`, {});
  assert.equal(pv.status, 200); assert.equal(pv.type, "audio/wav");
  assert.equal(synth[0].voice, rh.voiceId.split("#")[0]);
  // The free voices route and a hand-picked one.
  const voices = (await call("GET", "/voice/piper/voices")).json;
  assert.equal(voices.available, true); assert.equal(voices.voices.length, PIPER_VOICES.length);
  const pick = PIPER_VOICES.find((v) => v.model === "fr_FR-upmc-medium" && v.gender === "male")!;
  const put = await call("PUT", `/bots/${hugo.id}/voice/choice`, { provider: "piper", voiceId: pick.id });
  assert.equal(put.status, 200); assert.equal(put.json.choice.name, "Pierre");
  assert.equal((await call("PUT", `/bots/${hugo.id}/voice/choice`, { provider: "piper", voiceId: "fr_FR-mls-medium#../x" })).status, 400);
  assert.equal((await call("GET", "/voice/bots")).json.bots.find((r: BotVoiceRow) => r.botId === hugo.id).voiceName, "Pierre");
  await call("PUT", `/bots/${hugo.id}/voice/choice`, { voiceId: null });
  assert.equal((await call("GET", "/voice/bots")).json.bots.find((r: BotVoiceRow) => r.botId === hugo.id).voiceId, rh.voiceId, "back to the same automatic voice");
});

test("a full call turn: the user's audio is transcribed, the bot answers, and its reply comes back spoken in ITS voice", async () => {
  const row = (await call("GET", "/voice/bots")).json.bots.find((r: BotVoiceRow) => r.botId === lea.id) as BotVoiceRow;
  const ws = new WebSocket(`ws://127.0.0.1:${PORT}/api/voice/${lea.id}`, { headers: { cookie, origin: `http://127.0.0.1:${PORT}` } });
  const msgs: any[] = []; const audio: Buffer[] = [];
  ws.on("message", (d, bin) => { if (bin) audio.push(d as Buffer); else msgs.push(JSON.parse(String(d))); });
  await new Promise<void>((r, j) => { ws.on("open", () => r()); ws.on("unexpected-response", (_q, res) => j(new Error(`HTTP ${res.statusCode}`))); });
  synth.length = 0;
  ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang: "fr-FR" }));
  const ready = await until(() => msgs.find((m) => m.type === "ready"), "ready");
  assert.deepEqual([ready.stt, ready.tts, ready.voice], ["whisper-cpp", "piper", row.voiceName]);
  await stream(ws, new Int16Array([...silence(300), ...tone(800), ...silence(900)]));
  await until(() => msgs.find((m) => m.type === "final"), "transcript");
  assert.equal(msgs.find((m) => m.type === "final").text, "Bonjour, tu m'entends ?");
  await until(() => msgs.filter((m) => m.type === "audio").length >= 2 && audio.length >= 2, "spoken reply");
  assert.deepEqual(msgs.filter((m) => m.type === "audio").map((m) => m.text), ["Oui, je t'entends très bien.", "Que puis-je faire pour toi ?"]);
  for (const a of audio) assert.equal(a.toString("ascii", 0, 4), "RIFF");
  const [model, speaker] = row.voiceId.split("#");
  for (const body of synth) {
    assert.equal(body.voice, model);
    if (speaker !== undefined) assert.equal(body.speaker_id, Number(speaker)); else assert.ok(!("speaker_id" in body));
  }
  assert.ok(sttHits >= 1);
  ws.send(JSON.stringify({ type: "bye" }));
  await new Promise((r) => ws.on("close", r));
});

test("Fish Audio for all bots: a proposal that spends nothing, saved only on confirmation, never on someone else's bots", async () => {
  assert.equal((await call("POST", "/voice/fish/bulk/propose")).status, 409, "no key: nothing");
  await call("PUT", "/voice", { fishKey: "fk-test" });
  const before = fishTtsCalls;
  const r = await call("POST", "/voice/fish/bulk/propose");
  assert.equal(r.status, 200, r.text);
  const props = r.json.proposals as FishBulkProposal[];
  assert.equal(props.length, 2);
  assert.ok(fishLibraryCalls >= 1);
  assert.equal(fishTtsCalls, before, "proposing reads the library only: no credit spent");
  assert.equal(new Set(props.map((p) => p.voice.id)).size, 2);
  assert.ok(!props.some((p) => /^(celeb|asmr)/.test(p.voice.id)));
  assert.ok(props.find((p) => p.botId === lea.id)!.voice.id.startsWith("fem"));
  assert.ok(props.find((p) => p.botId === hugo.id)!.voice.id.startsWith("male"));
  // Nothing saved yet.
  assert.ok((await call("GET", "/voice/bots")).json.bots.every((x: BotVoiceRow) => x.provider === "piper"));
  const items = props.map((p) => ({ botId: p.botId, voiceId: p.voice.id, name: p.voice.title, author: p.voice.author, language: "fr" }));
  // A stranger (with a key of their own) cannot give voices to the owner's bots, nor see them.
  await call("PUT", "/voice", { fishKey: "fk-test" }, cookieB);
  const b = await call("POST", "/voice/fish/bulk/apply", { items }, cookieB);
  assert.equal(b.status, 200); assert.equal(b.json.applied, 0);
  assert.ok(!b.text.includes(lea.id) && !b.text.includes("Léa"));
  assert.ok(!(await call("GET", "/voice/bots", undefined, cookieB)).text.includes(lea.id));
  assert.ok(!(await call("POST", "/voice/fish/bulk/propose", undefined, cookieB)).text.includes(lea.id));
  assert.ok((await call("GET", "/voice/bots")).json.bots.every((x: BotVoiceRow) => x.provider === "piper"), "still untouched");
  // The owner confirms.
  const ok = await call("POST", "/voice/fish/bulk/apply", { items: [...items, { botId: "nope", voiceId: "zzzzzzzz" }, { botId: lea.id, voiceId: "bad id!" }] });
  assert.equal(ok.json.applied, 2);
  const rows = ok.json.bots as BotVoiceRow[];
  assert.equal(rows.find((x) => x.botId === lea.id)!.provider, "fish");
  assert.equal(rows.find((x) => x.botId === lea.id)!.voiceName, props.find((p) => p.botId === lea.id)!.voice.title);
  assert.equal(fishTtsCalls, before, "confirming spends nothing either");
  assert.equal((await call("GET", `/bots/${lea.id}/voice`)).json.status.tts, "fish");
  // Bots that already speak with Fish Audio are not proposed again.
  assert.deepEqual((await call("POST", "/voice/fish/bulk/propose")).json.proposals, []);
});

test("isolation of the voice routes: a stranger gets 404 on the owner's bots and only their own list", async () => {
  for (const [m, u, body] of [["GET", `/bots/${lea.id}/voice/choice`], ["PUT", `/bots/${lea.id}/voice/choice`, { provider: "piper", voiceId: "fr_FR-siwis-medium" }], ["POST", `/bots/${lea.id}/voice/preview`, { provider: "piper", voiceId: "fr_FR-siwis-medium" }]] as const) {
    const r = await call(m, u, body, cookieB);
    assert.equal(r.status, 404, `${m} ${u}`);
    assert.ok(!r.text.includes("Léa"));
  }
  const mine = (await call("GET", "/voice/bots", undefined, cookieB)).json.bots as BotVoiceRow[];
  assert.ok(mine.every((x) => x.botId !== lea.id && x.botId !== hugo.id));
  for (const u of ["/voice/bots", "/voice/piper/voices"]) assert.equal((await api.request(u)).status, 401, `${u} needs a session`);
  assert.equal((await api.request("/voice/fish/bulk/apply", { method: "POST" })).status, 401);
});

test("Kokoro by default: an English bot speaks with a Kokoro voice; when Kokoro stops answering, Piper takes over", async () => {
  const seen: Record<string, unknown>[] = [];
  const kokoro = createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    if (req.url === "/v1/audio/voices") { res.setHeader("content-type", "application/json"); res.end(JSON.stringify({ voices: KOKORO_AUTO.map((v) => ({ id: v.id, name: v.id })) })); return; }
    if (req.url === "/v1/audio/speech" && req.method === "POST") { seen.push(JSON.parse(Buffer.concat(chunks).toString())); res.setHeader("content-type", "audio/wav"); res.end(wav(200, 24000)); return; }
    res.statusCode = 404; res.end();
  });
  await new Promise<void>((r) => kokoro.listen(0, "127.0.0.1", () => r()));
  const url = `http://127.0.0.1:${(kokoro.address() as { port: number }).port}`;
  process.env.VOICE_KOKORO_URL = url;
  try {
    const ava = (await call("POST", "/bots", { name: "Ava" })).json.bot as Bot;
    await call("PATCH", `/bots/${ava.id}`, { voice: { name: "", rate: 1, lang: "en-US" } });
    const row = (await call("GET", "/voice/bots")).json.bots.find((r: BotVoiceRow) => r.botId === ava.id) as BotVoiceRow;
    assert.deepEqual([row.provider, row.auto, row.gender, row.licence], ["kokoro", true, "female", "Apache-2.0"]);
    assert.equal((await call("POST", `/bots/${ava.id}/voice/preview`, {})).status, 200);
    assert.equal(seen.at(-1)!.voice, row.voiceId);
    assert.equal(seen.at(-1)!.model, "kokoro");
    // Kokoro goes away: the next health check (at most 30 s later) marks it down, and the bot speaks with Piper.
    kokoro.closeAllConnections(); kokoro.close();
    reachable(url, Date.now() + 60_000);
    await until(() => !reachable(url), "Kokoro marked down");
    const after = (await call("GET", "/voice/bots")).json.bots.find((r: BotVoiceRow) => r.botId === ava.id) as BotVoiceRow;
    assert.equal(after.provider, "piper");
    synth.length = 0;
    assert.equal((await call("POST", `/bots/${ava.id}/voice/preview`, {})).status, 200);
    assert.ok(String(synth.at(-1)!.voice).startsWith("en_GB-vctk"), "an English Piper voice");
    // SKLUBOT_KOKORO=0 / SKLUBOT_VOICE_LOCAL=0 drop the bundled address.
    process.env.VOICE_KOKORO_URL = "http://kokoro:8880";
    process.env.VOICE_KOKORO = "0";
    const { kokoroEnvUrl } = await import("../src/voice/kokoro.js");
    assert.equal(kokoroEnvUrl(), "");
    delete process.env.VOICE_KOKORO;
    assert.equal(kokoroEnvUrl(), "http://kokoro:8880");
  } finally { delete process.env.VOICE_KOKORO_URL; delete process.env.VOICE_KOKORO; kokoro.closeAllConnections(); kokoro.close(); }
});
