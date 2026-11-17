import { guardedFetch } from "../net.js";
import type { FishVoice } from "../shared.js";

/**
 * Fish Audio (https://fish.audio) through its OFFICIAL public API only, with the account's own API key. Voices are
 * referenced by their public id (`reference_id`); nothing of a voice model is ever downloaded, extracted or copied, and
 * no voice is cloned here. Every endpoint, header and field below is taken from Fish Audio's documentation, read on
 * 2026-11-17 (canonical index https://docs.fish.audio/llms.txt):
 *
 *  - Auth: `Authorization: Bearer <API key>` on every endpoint (securitySchemes BearerAuth in the OpenAPI schema,
 *    https://docs.fish.audio/api-reference/openapi.json, and https://docs.fish.audio/api-reference/introduction).
 *  - Text to speech: `POST https://api.fish.audio/v1/tts`, `Content-Type: application/json`, header `model` (s1, s2-pro,
 *    s2.1-pro [default], s2.1-pro-free, drama-3), JSON body TTSRequest: `text`, `reference_id`, `format` (wav | pcm |
 *    mp3 | opus), `sample_rate` (WAV/PCM: 8000, 16000, 24000, 32000, 44100; 16-bit mono), `latency` (normal | balanced |
 *    low), `normalize`, `language` (BCP-47, text normalization only), `prosody.speed` (0.5–2.0). The answer is the audio,
 *    sent with `Transfer-Encoding: chunked` (read as it streams).
 *    https://docs.fish.audio/api-reference/endpoint/openapi-v1/text-to-speech
 *    Latency modes: https://docs.fish.audio/developer-guide/best-practices/real-time-streaming ("Balanced: ~300ms").
 *    (The WebSocket mode, wss://api.fish.audio/v1/tts/live, needs MessagePack frames —
 *    https://docs.fish.audio/api-reference/endpoint/websocket/tts-live — it is not used: the call already streams per
 *    sentence, and the HTTP answer is itself streamed.)
 *  - Speech to text: `POST https://api.fish.audio/v1/asr`, multipart/form-data, field `audio` (one file), `language`
 *    (lowercase ISO 639-1), `ignore_timestamps` ("true"); header `model` (transcribe-1-pro recommended, transcribe-1);
 *    `tag_audio_events` and `diarize` only with transcribe-1-pro. Answer JSON `{ text, duration, ... }`.
 *    https://docs.fish.audio/api-reference/endpoint/openapi-v1/speech-to-text
 *  - Voice library: `GET https://api.fish.audio/model` with `page_size` (1–100), `page_number`, `title`, `language`,
 *    `self`, `licensed`, `sort_by` (score | task_count | created_at); answer `{ total, items: ModelEntity[], has_more }`
 *    with `_id`, `title`, `description`, `languages`, `tags`, `like_count`, `task_count`, `author.nickname`, `licensed`,
 *    `visibility`, `state`. https://docs.fish.audio/api-reference/endpoint/model/list-models
 *    One voice: `GET https://api.fish.audio/model/{id}` (same ModelEntity).
 *    https://docs.fish.audio/api-reference/endpoint/model/get-model
 *  - Prices: https://docs.fish.audio/developer-guide/models-pricing/pricing-and-rate-limits — TTS per million UTF-8
 *    bytes of input text (see TTS_USD_PER_MILLION_BYTES), ASR $0.36 per audio hour rounded up to the second.
 *
 * Address: FISH_AUDIO_URL (the operator's setting, e.g. a test double) is trusted and fetched directly; the default,
 * https://api.fish.audio, goes through the outbound guard (net.ts guardedFetch) like any public service.
 */

export const FISH_TTS_MODELS = ["s2.1-pro", "s2.1-pro-free", "s2-pro", "drama-3", "s1"] as const;
export const FISH_DEFAULT_TTS_MODEL = "s2.1-pro";
export const FISH_STT_MODELS = ["transcribe-1-pro", "transcribe-1"] as const;
export const FISH_DEFAULT_STT_MODEL = "transcribe-1-pro";
/** Sample rate asked for: one of the documented WAV rates, small enough for quick sentences, clear enough for speech. */
export const FISH_SAMPLE_RATE = 24000;

/** USD per million UTF-8 bytes of text (pricing page above, read 2026-11-17). */
const TTS_USD_PER_MILLION_BYTES: Record<string, number> = { "drama-3": 50, "s2.1-pro": 15, "s2.1-pro-free": 0, "s2-pro": 15, s1: 15 };
/** drama-3's launch price, "through November 30, 2026 (until December 1, 00:00 PT / 08:00 UTC)": $10 / M bytes. */
const DRAMA3_PROMO_UNTIL = Date.UTC(2026, 11, 1, 8, 0, 0);
const ASR_USD_PER_HOUR = 0.36;

export const fishBase = () => (process.env.FISH_AUDIO_URL || "https://api.fish.audio").replace(/\/$/, "");
const trusted = () => !!process.env.FISH_AUDIO_URL;
const go = (url: string, init: RequestInit) => (trusted() ? fetch(url, init) : guardedFetch(url, init));

export const fishTtsModel = (m: string) => ((FISH_TTS_MODELS as readonly string[]).includes(m) ? m : FISH_DEFAULT_TTS_MODEL);
export const fishSttModel = (m: string) => ((FISH_STT_MODELS as readonly string[]).includes(m) ? m : FISH_DEFAULT_STT_MODEL);

/** Cost of one synthesis in USD, from the published price per million UTF-8 bytes of the text. */
export function fishTtsCost(model: string, text: string, at = Date.now()): number {
  const m = fishTtsModel(model);
  const perMillion = m === "drama-3" && at < DRAMA3_PROMO_UNTIL ? 10 : TTS_USD_PER_MILLION_BYTES[m];
  return (Buffer.byteLength(text, "utf8") / 1_000_000) * perMillion;
}
/** Cost of one transcription: the audio's whole duration, rounded up to the second. */
export const fishAsrCost = (seconds: number) => (Math.ceil(Math.max(0, seconds)) / 3600) * ASR_USD_PER_HOUR;

export class FishError extends Error { constructor(public status: number, message: string) { super(message); } }

async function failure(res: Response, what: string): Promise<FishError> {
  let detail = "";
  try { const j = (await res.json()) as { message?: unknown }; if (typeof j.message === "string") detail = j.message.slice(0, 200); } catch { /* the edge may answer without JSON */ }
  const why = res.status === 401 ? "the API key was refused"
    : res.status === 402 ? "no API credit on this Fish Audio account (the free model s2.1-pro-free works without credit)"
      : res.status === 429 ? "too many requests at once for this Fish Audio account (concurrency limit)"
        : res.status === 404 ? "not found" : `answered ${res.status}`;
  return new FishError(res.status, `Fish Audio ${what}: ${why}${detail ? ` (${detail})` : ""}`);
}

/**
 * A WAV whose sizes may be unknown (a streamed header carries 0 or 0xFFFFFFFF): the RIFF and data sizes are set to what
 * actually arrived, so every player (and wavDurationMs) reads it. Raw PCM (no RIFF header) is wrapped as 16-bit mono.
 */
export function completeWav(buf: Buffer, sampleRate = FISH_SAMPLE_RATE): Buffer {
  if (buf.length >= 12 && buf.toString("ascii", 0, 4) === "RIFF" && buf.toString("ascii", 8, 12) === "WAVE") {
    const out = Buffer.from(buf);
    let at = 12;
    while (at + 8 <= out.length) {
      const id = out.toString("ascii", at, at + 4);
      if (id === "data") {
        let size = out.length - at - 8;
        size -= size % 2;
        out.writeUInt32LE(size, at + 4);
        out.writeUInt32LE(at + size, 4);
        return out.subarray(0, at + 8 + size);
      }
      const size = out.readUInt32LE(at + 4);
      at += 8 + size + (size % 2);
    }
    return out;
  }
  const data = buf.subarray(0, buf.length - (buf.length % 2));
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

export interface FishTtsOptions {
  text: string;
  /** The voice's public id in Fish Audio's library (`reference_id`); "" = Fish Audio's default voice. */
  voiceId: string;
  model?: string;
  /** BCP-47 tag of the text ("auto"/"" = detected per chunk); only used for number/date normalization. */
  language?: string;
  /** prosody.speed, 0.5–2.0 (1 = normal; not sent). */
  speed?: number;
  latency?: "normal" | "balanced" | "low";
}

/** The documented TTS request body (TTSRequest) for these options. */
export function fishTtsBody(o: FishTtsOptions): Record<string, unknown> {
  const lang = (o.language ?? "").trim();
  const speed = Number(o.speed);
  return {
    text: o.text,
    ...(o.voiceId ? { reference_id: o.voiceId } : {}),
    format: "wav",
    sample_rate: FISH_SAMPLE_RATE,
    latency: o.latency ?? "balanced",
    normalize: true,
    ...(lang && lang !== "auto" && /^[A-Za-z0-9_-]{1,35}$/.test(lang) ? { language: lang } : {}),
    ...(Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) > 0.001 ? { prosody: { speed: Math.min(2, Math.max(0.5, speed)) } } : {}),
  };
}

/** Text → WAV (16-bit mono, 24 kHz). The answer is read as it streams in; `signal` stops it (barge-in, hang-up). */
export async function fishTts(key: string, o: FishTtsOptions, signal?: AbortSignal): Promise<Buffer> {
  const res = await go(`${fishBase()}/v1/tts`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": "application/json", model: fishTtsModel(o.model ?? "") },
    body: JSON.stringify(fishTtsBody(o)),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, "text-to-speech");
  const chunks: Buffer[] = [];
  if (res.body) {
    const reader = res.body.getReader();
    for (;;) { const { value, done } = await reader.read(); if (done) break; if (value) chunks.push(Buffer.from(value)); }
  }
  const audio = Buffer.concat(chunks);
  if (audio.length < 2) throw new FishError(502, "Fish Audio text-to-speech: empty answer");
  return completeWav(audio);
}

/** Recording → text. `language`: a two-letter hint ("" = detected). */
export async function fishAsr(key: string, wav: Buffer, o: { language?: string; model?: string }, signal?: AbortSignal): Promise<{ text: string; duration: number }> {
  const model = fishSttModel(o.model ?? "");
  const fields: Record<string, string> = { ignore_timestamps: "true" };
  const lang = (o.language ?? "").toLowerCase().slice(0, 2);
  if (/^[a-z]{2}$/.test(lang)) fields.language = lang;
  // Pro only (the docs: send them only with transcribe-1-pro): no speaker markers, no [laughter]-style cues in a call.
  if (model === "transcribe-1-pro") { fields.tag_audio_events = "false"; fields.diarize = "false"; }
  const boundary = `----sklubotfish${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="audio"; filename="audio.wav"\r\nContent-Type: audio/wav\r\n\r\n`), wav, Buffer.from(`\r\n--${boundary}--\r\n`));
  const res = await go(`${fishBase()}/v1/asr`, {
    method: "POST",
    headers: { authorization: `Bearer ${key}`, "content-type": `multipart/form-data; boundary=${boundary}`, model },
    body: new Uint8Array(Buffer.concat(parts)),
    signal: signal ?? AbortSignal.timeout(30_000),
  });
  if (!res.ok) throw await failure(res, "speech-to-text");
  const j = (await res.json()) as { text?: unknown; duration?: unknown };
  const text = String(j.text ?? "").replace(/<\|speaker:\d+\|>/g, " ").replace(/\s+/g, " ").trim();
  return { text, duration: Number(j.duration) || 0 };
}

// ── The voice library ────────────────────────────────────────────────────────
interface ModelEntity {
  _id?: unknown; title?: unknown; description?: unknown; languages?: unknown; tags?: unknown; like_count?: unknown; task_count?: unknown;
  author?: { nickname?: unknown } | null; licensed?: unknown; visibility?: unknown; state?: unknown; type?: unknown;
}
const s = (v: unknown, max: number) => (typeof v === "string" ? v.slice(0, max) : "");
const list = (v: unknown, n: number, max: number) => (Array.isArray(v) ? v.filter((x) => typeof x === "string").slice(0, n).map((x) => (x as string).slice(0, max)) : []);
export function voiceOf(m: ModelEntity): FishVoice {
  return {
    id: s(m._id, 80), title: s(m.title, 120), description: s(m.description, 400), languages: list(m.languages, 12, 16), tags: list(m.tags, 12, 40),
    likes: Number(m.like_count) || 0, uses: Number(m.task_count) || 0, author: s(m.author?.nickname, 80), licensed: m.licensed === true,
    visibility: s(m.visibility, 12), state: s(m.state, 12),
  };
}
/** A Fish Audio voice id as the API shows them (hex-like); anything else is refused before any request. */
export const validVoiceId = (id: string) => /^[A-Za-z0-9_-]{6,80}$/.test(id);

export interface VoiceQuery { q?: string; language?: string; page?: number; self?: boolean; licensed?: boolean; sort?: "score" | "task_count" | "created_at" }
export interface VoicePage { items: FishVoice[]; total: number; hasMore: boolean; page: number }

/** Searches are cached briefly per key and query (the library changes slowly; the picker re-asks while typing). */
const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: VoicePage }>();
export const clearVoiceCache = () => cache.clear();

export async function fishVoices(key: string, cacheKey: string, qy: VoiceQuery): Promise<VoicePage> {
  const page = Math.max(1, Math.min(100, Math.floor(Number(qy.page) || 1)));
  const params = new URLSearchParams({ page_size: "20", page_number: String(page), sort_by: qy.sort ?? "score" });
  const title = (qy.q ?? "").trim().slice(0, 80);
  if (title) params.set("title", title);
  const lang = (qy.language ?? "").trim().toLowerCase();
  if (/^[a-z]{2,3}(-[a-z0-9]{2,8})?$/.test(lang)) params.set("language", lang);
  if (qy.self) params.set("self", "true");
  if (qy.licensed && !qy.self) params.set("licensed", "true");
  const id = `${cacheKey}|${params.toString()}`;
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const res = await go(`${fishBase()}/model?${params.toString()}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await failure(res, "voice library");
  const j = (await res.json()) as { total?: unknown; items?: unknown; has_more?: unknown };
  const items = (Array.isArray(j.items) ? (j.items as ModelEntity[]) : []).filter((m) => m && (m.type === undefined || m.type === "tts")).map(voiceOf).filter((v) => v.id);
  const total = Number(j.total) || 0;
  const value: VoicePage = { items, total, hasMore: typeof j.has_more === "boolean" ? j.has_more : page * 20 < total, page };
  if (cache.size > 500) cache.clear();
  cache.set(id, { at: Date.now(), value });
  return value;
}

export async function fishVoice(key: string, voiceId: string): Promise<FishVoice> {
  if (!validVoiceId(voiceId)) throw new FishError(400, "This is not a Fish Audio voice id.");
  const res = await go(`${fishBase()}/model/${encodeURIComponent(voiceId)}`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw await failure(res, "voice");
  return voiceOf((await res.json()) as ModelEntity);
}
