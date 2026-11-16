import { q } from "../db.js";
import { config } from "../config.js";
import { seal, unseal } from "../auth.js";
import { guardedFetch } from "../net.js";
import { meterOperatorUse, operatorBlock, unitEstimate } from "../hosted.js";
import { STT_PROVIDERS, TTS_PROVIDERS, type SttProvider, type TtsProvider, type VoiceSettings, type VoiceStatus } from "../shared.js";

/**
 * Speech services for server-mediated calls (wave 6). Two of each, documented interfaces only:
 *
 * Speech-to-text
 *  - "whisper-cpp": the whisper.cpp HTTP server (self-hosted, free). `POST {url}/inference`, multipart fields `file`
 *    (WAV), `response_format=json`, `temperature`, `language`; answers `{"text": "..."}`.
 *    https://github.com/ggml-org/whisper.cpp/tree/master/examples/server (and server.cpp, where the `language` field
 *    and the JSON answer are read and written).
 *  - "openai": OpenAI's `POST /v1/audio/transcriptions` (multipart `file`, `model`, `language`, `response_format=json`;
 *    models gpt-4o-mini-transcribe, gpt-4o-transcribe, whisper-1). Also what OpenAI-compatible self-hosted servers
 *    (e.g. Speaches / faster-whisper-server) expose. Paid when it is OpenAI's: optional, needs a key.
 *    https://developers.openai.com/api/reference/typescript/resources/audio/subresources/transcriptions/methods/create
 * Text-to-speech
 *  - "piper": Piper's HTTP server (`python3 -m piper.http_server`, OHF-Voice/piper1-gpl, self-hosted, free).
 *    `POST {url}/synthesize` with JSON `{text, voice?, length_scale?}` answers WAV audio.
 *    https://github.com/OHF-Voice/piper1-gpl/blob/main/docs/API_HTTP.md
 *  - "openai": OpenAI's `POST /v1/audio/speech` with JSON `{model, input, voice, response_format: "wav"}`
 *    (gpt-4o-mini-tts; voices alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse, marin, cedar).
 *    https://developers.openai.com/api/docs/guides/text-to-speech
 *
 * Addresses: the operator's (VOICE_STT_URL / VOICE_TTS_URL, usually the compose services on the internal network) are
 * trusted and fetched directly; an address the user typed in Settings goes through guardedFetch (never this server's
 * own network). API keys are sealed in the account's settings, or come from OPENAI_API_KEY; never sent anywhere else.
 */

export const DEFAULT_VOICE: VoiceSettings = {
  mode: "auto",
  stt: { provider: config.voiceSttProvider, url: "", model: "", language: "auto", hasKey: false },
  tts: { provider: config.voiceTtsProvider, url: "", model: "", voice: "", hasKey: false },
  bargeIn: { enabled: true, minSpeechMs: 250 },
};

interface Stored { mode?: string; stt?: Record<string, unknown>; tts?: Record<string, unknown>; bargeIn?: Record<string, unknown>; sttKeyEnc?: string; ttsKeyEnc?: string }
const read = (userId: string): Stored => { try { return JSON.parse(q.get<{ voice: string }>("SELECT voice FROM settings WHERE user_id = ?", userId)?.voice || "{}") as Stored; } catch { return {}; } };
const str = (v: unknown, max: number, fallback = "") => (typeof v === "string" ? v.trim().slice(0, max) : fallback);
const cleanUrl = (v: unknown) => { const s = str(v, 300); if (!s) return ""; try { const u = new URL(s); return /^https?:$/.test(u.protocol) ? s.replace(/\/$/, "") : ""; } catch { return ""; } };

export function voiceSettings(userId: string): VoiceSettings {
  const s = read(userId);
  const stt = s.stt ?? {};
  const tts = s.tts ?? {};
  const ms = Number(s.bargeIn?.minSpeechMs);
  return {
    mode: s.mode === "server" || s.mode === "browser" ? s.mode : "auto",
    stt: { provider: (STT_PROVIDERS as readonly string[]).includes(stt.provider as string) ? stt.provider as SttProvider : DEFAULT_VOICE.stt.provider, url: cleanUrl(stt.url), model: str(stt.model, 80), language: str(stt.language, 10, "auto") || "auto", hasKey: !!s.sttKeyEnc },
    tts: { provider: (TTS_PROVIDERS as readonly string[]).includes(tts.provider as string) ? tts.provider as TtsProvider : DEFAULT_VOICE.tts.provider, url: cleanUrl(tts.url), model: str(tts.model, 80), voice: str(tts.voice, 80), hasKey: !!s.ttsKeyEnc },
    bargeIn: { enabled: s.bargeIn?.enabled !== false, minSpeechMs: Number.isFinite(ms) ? Math.min(1500, Math.max(100, Math.round(ms))) : DEFAULT_VOICE.bargeIn.minSpeechMs },
  };
}

/** Saves the account's voice settings. `sttKey` / `ttsKey`: a new API key (sealed), "" keeps, null removes. */
export function saveVoiceSettings(userId: string, f: Record<string, any>): VoiceSettings {
  const cur = read(userId);
  const merged: Stored = {
    mode: f.mode ?? cur.mode,
    stt: { ...(cur.stt ?? {}), ...(f.stt && typeof f.stt === "object" ? f.stt : {}) },
    tts: { ...(cur.tts ?? {}), ...(f.tts && typeof f.tts === "object" ? f.tts : {}) },
    bargeIn: { ...(cur.bargeIn ?? {}), ...(f.bargeIn && typeof f.bargeIn === "object" ? f.bargeIn : {}) },
    sttKeyEnc: f.sttKey === null ? undefined : typeof f.sttKey === "string" && f.sttKey ? seal(f.sttKey.trim()) : cur.sttKeyEnc,
    ttsKeyEnc: f.ttsKey === null ? undefined : typeof f.ttsKey === "string" && f.ttsKey ? seal(f.ttsKey.trim()) : cur.ttsKeyEnc,
  };
  for (const part of [merged.stt!, merged.tts!]) { delete part.hasKey; delete part.key; }
  q.run("INSERT INTO settings (user_id, voice) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET voice = excluded.voice", userId, JSON.stringify(merged));
  return voiceSettings(userId);
}

/** `operatorKey`: the key is the server's own (OPENAI_API_KEY), so the operator pays (hosted mode meters it). */
interface Endpoint { url: string; trusted: boolean; key: string | null; operatorKey?: boolean }
function endpoint(userId: string, which: "stt" | "tts"): Endpoint | null {
  const s = voiceSettings(userId);
  const stored = read(userId);
  const provider = s[which].provider;
  const userUrl = s[which].url;
  if (provider === "openai") {
    const own = stored[which === "stt" ? "sttKeyEnc" : "ttsKeyEnc"] ? unseal(stored[which === "stt" ? "sttKeyEnc" : "ttsKeyEnc"]!) : null;
    // Hosted mode: the server's key only when the account's plan lets the operator's keys pay (else: its own key, or the
    // browser's voice).
    const server = !own && !operatorBlock(userId) ? process.env.OPENAI_API_KEY ?? null : null;
    const key = own ?? server;
    if (!key && !userUrl) return null;
    return userUrl ? { url: userUrl, trusted: false, key } : { url: config.openaiAudioUrl, trusted: true, key, operatorKey: !own && !!server };
  }
  if (userUrl) return { url: userUrl, trusted: false, key: null };
  const env = which === "stt" ? config.voiceSttUrl : config.voiceTtsUrl;
  const envProvider = which === "stt" ? config.voiceSttProvider : config.voiceTtsProvider;
  return env && envProvider === provider ? { url: env, trusted: true, key: null } : null;
}

export function voiceStatus(userId: string): VoiceStatus {
  const s = voiceSettings(userId);
  if (s.mode === "browser") return { mode: "browser", stt: null, tts: null, reason: "browser mode chosen" };
  const stt = endpoint(userId, "stt");
  const tts = endpoint(userId, "tts");
  if (!stt || !tts) return { mode: "browser", stt: stt ? s.stt.provider : null, tts: tts ? s.tts.provider : null, reason: !stt && !tts ? "no speech service configured" : !stt ? "no speech-to-text service" : "no text-to-speech service" };
  return { mode: "server", stt: s.stt.provider, tts: s.tts.provider, reason: "" };
}

const go = (e: Endpoint, url: string, init: RequestInit) => (e.trusted ? fetch(url, init) : guardedFetch(url, init));

/** multipart/form-data built by hand (fields first, then the file), so any fetch can send it as plain bytes. */
function multipart(fields: Record<string, string>, file: { name: string; field: string; type: string; data: Buffer }): { body: Buffer; type: string } {
  const boundary = `----sklubot${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
  const parts: Buffer[] = [];
  for (const [k, v] of Object.entries(fields)) parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${k}"\r\n\r\n${v}\r\n`));
  parts.push(Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="${file.field}"; filename="${file.name}"\r\nContent-Type: ${file.type}\r\n\r\n`), file.data, Buffer.from(`\r\n--${boundary}--\r\n`));
  return { body: Buffer.concat(parts), type: `multipart/form-data; boundary=${boundary}` };
}

export type Stt = (wav: Buffer, signal?: AbortSignal) => Promise<string>;
export type Tts = (text: string, signal?: AbortSignal) => Promise<Buffer>;

/** Length of a WAV recording in seconds, from its header (byte rate at offset 28); 0 when it is not a WAV. */
function wavSeconds(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("latin1", 0, 4) !== "RIFF") return 0;
  const byteRate = wav.readUInt32LE(28);
  return byteRate > 0 ? Math.max(0, wav.length - 44) / byteRate : 0;
}

export function sttFor(userId: string, lang?: string): Stt | null {
  const s = voiceSettings(userId);
  const e = endpoint(userId, "stt");
  if (!e) return null;
  const language = (s.stt.language !== "auto" ? s.stt.language : lang && lang !== "auto" ? lang : "").slice(0, 2);
  return async (wav, signal) => {
    if (s.stt.provider === "whisper-cpp") {
      const form = multipart({ response_format: "json", temperature: "0.0", ...(language ? { language } : { language: "auto" }) }, { field: "file", name: "audio.wav", type: "audio/wav", data: wav });
      const res = await go(e, `${e.url}/inference`, { method: "POST", headers: { "content-type": form.type }, body: new Uint8Array(form.body), signal: signal ?? AbortSignal.timeout(30_000) });
      if (!res.ok) throw new Error(`speech-to-text answered ${res.status}`);
      return String(((await res.json()) as { text?: string }).text ?? "").trim();
    }
    const form = multipart({ model: s.stt.model || "gpt-4o-mini-transcribe", response_format: "json", ...(language ? { language } : {}) }, { field: "file", name: "audio.wav", type: "audio/wav", data: wav });
    const res = await go(e, `${e.url}/v1/audio/transcriptions`, { method: "POST", headers: { "content-type": form.type, ...(e.key ? { authorization: `Bearer ${e.key}` } : {}) }, body: new Uint8Array(form.body), signal: signal ?? AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`speech-to-text answered ${res.status}`);
    if (e.operatorKey) meterOperatorUse(userId, null, "voice:speech-to-text", (wavSeconds(wav) / 60) * unitEstimate("sttUsdPerMinute"));
    return String(((await res.json()) as { text?: string }).text ?? "").trim();
  };
}

export function ttsFor(userId: string): Tts | null {
  const s = voiceSettings(userId);
  const e = endpoint(userId, "tts");
  if (!e) return null;
  return async (text, signal) => {
    const req = s.tts.provider === "piper"
      ? { url: `${e.url}/synthesize`, body: { text, ...(s.tts.voice ? { voice: s.tts.voice } : {}) } }
      : { url: `${e.url}/v1/audio/speech`, body: { model: s.tts.model || "gpt-4o-mini-tts", input: text, voice: s.tts.voice || "marin", response_format: "wav" } };
    const res = await go(e, req.url, { method: "POST", headers: { "content-type": "application/json", ...(e.key ? { authorization: `Bearer ${e.key}` } : {}) }, body: JSON.stringify(req.body), signal: signal ?? AbortSignal.timeout(30_000) });
    if (!res.ok) throw new Error(`text-to-speech answered ${res.status}`);
    if (e.operatorKey) meterOperatorUse(userId, null, "voice:text-to-speech", (text.length / 1000) * unitEstimate("ttsUsdPer1kChars"));
    return Buffer.from(await res.arrayBuffer());
  };
}
