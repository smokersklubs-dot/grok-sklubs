import { q } from "../db.js";
import { config } from "../config.js";
import { seal, unseal } from "../auth.js";
import { guardedFetch } from "../net.js";
import { hostedMode, meterOperatorUse, operatorBlock, unitEstimate } from "../hosted.js";
import { bots } from "../store.js";
import { recordServiceCost } from "../usage.js";
import { STT_PROVIDERS, TTS_PROVIDERS, type BotVoiceChoice, type SttProvider, type TtsProvider, type VoiceSettings, type VoiceStatus } from "../shared.js";
import { botVoices } from "./botvoice.js";
import { fishAsr, fishAsrCost, fishBase, fishSttModel, fishTts, fishTtsCost, fishTtsModel } from "./fish.js";
import { kokoroEnvUrl, kokoroTts, type KokoroEndpoint } from "./kokoro.js";

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
 *  - "fish": Fish Audio's official API (voice/fish.ts, every endpoint cited there), with the account's own key — both
 *    `POST /v1/tts` (a voice of its library by `reference_id`) and `POST /v1/asr`. A bot can have its own Fish Audio voice
 *    (voice/botvoice.ts): it speaks with it whatever the account's default provider, as long as the account has a key.
 *    Priced from Fish Audio's published price list and written to the account's usage (usage.recordServiceCost).
 *  - "kokoro": the self-hosted Kokoro-FastAPI server (voice/kokoro.ts, sources cited there), free, no key: the operator's
 *    VOICE_KOKORO_URL (compose profile "kokoro", internal network) or an address the user typed. Bots can have their own
 *    Kokoro voice too.
 *
 * Addresses: the operator's (VOICE_STT_URL / VOICE_TTS_URL: by default the bundled whisper.cpp and Piper of the compose
 * files, on the internal network "voice"; SKLUBOT_VOICE_LOCAL=0 turns them off) are trusted and fetched directly; an address the user typed in Settings goes through guardedFetch (never this server's
 * own network). API keys are sealed in the account's settings, or come from OPENAI_API_KEY; never sent anywhere else.
 */

export const DEFAULT_VOICE: VoiceSettings = {
  mode: "auto",
  stt: { provider: config.voiceSttProvider, url: "", model: "", language: "auto", hasKey: false },
  tts: { provider: config.voiceTtsProvider, url: "", model: "", voice: "", hasKey: false },
  bargeIn: { enabled: true, minSpeechMs: 250 },
};

interface Stored { mode?: string; stt?: Record<string, unknown>; tts?: Record<string, unknown>; bargeIn?: Record<string, unknown>; sttKeyEnc?: string; ttsKeyEnc?: string; fishKeyEnc?: string }
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
    fish: { hasKey: !!s.fishKeyEnc },
  };
}

/** The account's Fish Audio key (sealed in its settings), or null. Never leaves the server except to Fish Audio. */
export function fishKey(userId: string): string | null {
  const enc = read(userId).fishKeyEnc;
  if (!enc) return null;
  try { return unseal(enc); } catch { return null; }
}

/** Saves the account's voice settings. `sttKey` / `ttsKey` / `fishKey`: a new API key (sealed), "" keeps, null removes. */
export function saveVoiceSettings(userId: string, f: Record<string, any>): VoiceSettings {
  const cur = read(userId);
  const merged: Stored = {
    mode: f.mode ?? cur.mode,
    stt: { ...(cur.stt ?? {}), ...(f.stt && typeof f.stt === "object" ? f.stt : {}) },
    tts: { ...(cur.tts ?? {}), ...(f.tts && typeof f.tts === "object" ? f.tts : {}) },
    bargeIn: { ...(cur.bargeIn ?? {}), ...(f.bargeIn && typeof f.bargeIn === "object" ? f.bargeIn : {}) },
    sttKeyEnc: f.sttKey === null ? undefined : typeof f.sttKey === "string" && f.sttKey ? seal(f.sttKey.trim()) : cur.sttKeyEnc,
    ttsKeyEnc: f.ttsKey === null ? undefined : typeof f.ttsKey === "string" && f.ttsKey ? seal(f.ttsKey.trim()) : cur.ttsKeyEnc,
    fishKeyEnc: f.fishKey === null ? undefined : typeof f.fishKey === "string" && f.fishKey.trim() ? seal(f.fishKey.trim().slice(0, 300)) : cur.fishKeyEnc,
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
  if (provider === "fish") {
    // Fish Audio's own address only (voice/fish.ts); the account's key, never the server's.
    const key = fishKey(userId);
    return key ? { url: fishBase(), trusted: !!process.env.FISH_AUDIO_URL, key } : null;
  }
  if (provider === "kokoro" && which === "tts") {
    if (userUrl) return { url: userUrl, trusted: false, key: null };
    if (kokoroEnvUrl()) return { url: kokoroEnvUrl(), trusted: true, key: null };
  }
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
  return env && envProvider === provider && reachable(env) ? { url: env, trusted: true, key: null } : null;
}

/**
 * Whether the operator's own speech service answers (the bundled whisper.cpp may still be downloading its model, or the
 * services were switched off with SKLUBOT_VOICE_LOCAL=0 on a hand-made setup): any HTTP answer counts as up, only a
 * failed connection as down. Checked in the background, at most every 30 s; never checked yet = up, so the first call
 * is not delayed. A service that is down makes the app use the browser's own speech instead of failing every call.
 */
const health = new Map<string, { up: boolean; at: number; busy: boolean }>();
export function reachable(url: string, now = Date.now()): boolean {
  let h = health.get(url);
  if (!h) { h = { up: true, at: 0, busy: false }; health.set(url, h); }
  if (!h.busy && now - h.at > 30_000) {
    const entry = h;
    entry.busy = true;
    fetch(`${url}/`, { signal: AbortSignal.timeout(3000) })
      .then((r) => { void r.body?.cancel().catch(() => undefined); entry.up = true; }, () => { entry.up = false; })
      .finally(() => { entry.at = Date.now(); entry.busy = false; });
  }
  return h.up;
}

/** Where Kokoro answers for this account: its own Kokoro address (Settings → Voice), else the server's, else nowhere. */
export function kokoroEndpoint(userId: string): KokoroEndpoint | null {
  const s = voiceSettings(userId);
  if (s.tts.provider === "kokoro") { const e = endpoint(userId, "tts"); if (e) return { url: e.url, trusted: e.trusted }; }
  return kokoroEnvUrl() ? { url: kokoroEnvUrl(), trusted: true } : null;
}

/** The bot's own voice, when it has one AND the account can use it (a Fish Audio key is saved; Kokoro is reachable). */
export function botVoiceFor(userId: string, botId?: string | null): BotVoiceChoice | null {
  if (!botId) return null;
  const v = botVoices.get(botId);
  if (!v) return null;
  return (v.provider === "fish" ? fishKey(userId) : kokoroEndpoint(userId)) ? v : null;
}

/** What a call will use. With `botId`: that bot's own voice counts as its text-to-speech (it speaks with it). */
export function voiceStatus(userId: string, botId?: string | null): VoiceStatus {
  const s = voiceSettings(userId);
  // One-shot dictation (POST /voice/transcribe) only needs speech-to-text, whatever the call mode: the app uses it when
  // the browser has no recognition of its own, or when it fails (iOS Safari, Firefox, Brave, many Android web views).
  const stt = endpoint(userId, "stt");
  const dictation = !!stt;
  if (s.mode === "browser") return { mode: "browser", stt: null, tts: null, reason: "browser mode chosen", dictation };
  const own = botVoiceFor(userId, botId);
  const tts = own ? true : endpoint(userId, "tts");
  const ttsName = own ? own.provider : s.tts.provider;
  if (!stt || !tts) return { mode: "browser", stt: stt ? s.stt.provider : null, tts: tts ? ttsName : null, reason: !stt && !tts ? "no speech service configured" : !stt ? "no speech-to-text service" : "no text-to-speech service", dictation };
  return { mode: "server", stt: s.stt.provider, tts: ttsName, reason: "", dictation };
}

/** Who pays a Fish Audio line: the account's own key ("own" in hosted mode; nothing to say otherwise). */
const ownPayer = () => (hostedMode() ? "own" : "");
const usageBot = (userId: string, botId?: string | null) => botId ?? bots.primary(userId)?.id ?? "";

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
    if (s.stt.provider === "fish") {
      const model = fishSttModel(s.stt.model);
      const r = await fishAsr(e.key!, wav, { language, model }, signal);
      recordServiceCost(userId, usageBot(userId), `fish:${model}`, fishAsrCost(r.duration || wavSeconds(wav)), ownPayer());
      return r.text;
    }
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

export interface TtsFor {
  /** The bot that speaks: its own voice (voice/botvoice.ts), speaking rate and language; its usage line. */
  botId?: string | null;
  /** Another voice to try (the picker's "Listen"), instead of the bot's or the account's: with `provider`. */
  voiceId?: string;
  provider?: "fish" | "kokoro";
}

/** Text-to-speech for the account (and, with `botId`, in that bot's own voice when it has one). */
export function ttsFor(userId: string, opts: TtsFor = {}): Tts | null {
  const s = voiceSettings(userId);
  const bot = opts.botId ? bots.byId(opts.botId) : null;
  const botLang = bot?.voice.lang && bot.voice.lang !== "auto" ? bot.voice.lang : "";
  const speed = bot?.voice.rate ?? 1;
  const fish = (key: string, voiceId: string, language: string): Tts => {
    const model = fishTtsModel(s.tts.provider === "fish" ? s.tts.model : "");
    return async (text, signal) => {
      const wav = await fishTts(key, { text, voiceId, model, language, speed }, signal);
      recordServiceCost(userId, usageBot(userId, opts.botId), `fish:${model}`, fishTtsCost(model, text), ownPayer());
      return wav;
    };
  };
  const kokoro = (e: KokoroEndpoint, voice: string): Tts => (text, signal) => kokoroTts(e, { text, voice, speed }, signal);
  // A voice being tried, or the bot's own voice: its provider, whatever the account's default one.
  const own = opts.voiceId ? { provider: opts.provider ?? "fish", voiceId: opts.voiceId, language: "" } : botVoiceFor(userId, opts.botId);
  if (own) {
    if (own.provider === "kokoro") { const e = kokoroEndpoint(userId); return e ? kokoro(e, own.voiceId) : null; }
    const key = fishKey(userId);
    return key ? fish(key, own.voiceId, own.language || botLang) : null;
  }
  const e = endpoint(userId, "tts");
  if (!e) return null;
  if (s.tts.provider === "fish") return fish(e.key!, s.tts.voice, botLang);
  if (s.tts.provider === "kokoro") return kokoro({ url: e.url, trusted: e.trusted }, s.tts.voice);
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
