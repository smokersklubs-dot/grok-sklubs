import { guardedFetch } from "../net.js";
import type { KokoroVoice } from "../shared.js";
import { completeWav } from "./fish.js";

/**
 * Kokoro (free, self-hosted text-to-speech) through Kokoro-FastAPI, an OpenAI-compatible server around the Kokoro-82M
 * model. Read on 2026-11-17 from the project itself:
 *  - Project, image and endpoints: https://github.com/remsky/Kokoro-FastAPI (README "Quickest Start": CPU image
 *    ghcr.io/remsky/kokoro-fastapi-cpu, port 8880, models baked in; pinned in the compose files to v0.10.0).
 *  - `POST /v1/audio/speech` with JSON `{ model: "kokoro", input, voice, response_format, speed, stream }` —
 *    response_format one of mp3, opus, aac, flac, wav, pcm; `speed` 0.25–4.0; `stream` defaults to true. Schema:
 *    https://github.com/remsky/Kokoro-FastAPI/blob/v0.10.0/api/src/structures/schemas.py (OpenAISpeechRequest, RATE_MIN/MAX).
 *  - `GET /v1/audio/voices` → `{ voices: [{ id, name, overall_grade?, ... }], default_voice }`:
 *    https://github.com/remsky/Kokoro-FastAPI/blob/v0.10.0/api/src/routers/openai_compatible.py (list_voices).
 *  - Voice mixing: "af_bella(2)+af_sky(1)" (weighted) in the `voice` field — README "Voice Combination".
 *  - Voice ids: first letter = language (lang_code), second = f/m — https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md
 *    (a American English, b British English, e Spanish, f French, h Hindi, i Italian, j Japanese, p Brazilian
 *    Portuguese, z Mandarin Chinese).
 *  - Licences: Kokoro-FastAPI Apache-2.0 (its LICENSE file); Kokoro-82M weights Apache-2.0
 *    (https://huggingface.co/hexgrad/Kokoro-82M, "license: apache-2.0").
 * No key. Address: VOICE_KOKORO_URL (the operator's, e.g. http://kokoro:8880 on the compose's internal network — trusted,
 * fetched directly), or an address the user typed in Settings (through the outbound guard, never this server's network).
 */

/** Kokoro-FastAPI outputs 24 kHz audio (its README's PCM example sets framerate 24000). */
export const KOKORO_SAMPLE_RATE = 24000;
const LANGS: Record<string, string> = { a: "en-US", b: "en-GB", e: "es", f: "fr", h: "hi", i: "it", j: "ja", p: "pt-BR", z: "zh" };

/** The compose files' bundled Kokoro (on by default, internal network "voice"). */
export const LOCAL_KOKORO_URL = "http://kokoro:8880";
/**
 * The operator's Kokoro: VOICE_KOKORO_URL, except the bundled address while the local voice is off (VOICE_LOCAL=0,
 * SKLUBOT_VOICE_LOCAL=0) or Kokoro alone is (VOICE_KOKORO=0, SKLUBOT_KOKORO=0): its container then sleeps.
 */
export const kokoroEnvUrl = () => {
  const url = (process.env.VOICE_KOKORO_URL ?? "").trim().replace(/\/$/, "");
  return url === LOCAL_KOKORO_URL && (process.env.VOICE_LOCAL === "0" || process.env.VOICE_KOKORO === "0") ? "" : url;
};

/**
 * Kokoro voices given automatically to bots (voice/autovoice.ts), best first per language and gender: ids, genders and
 * grades from https://huggingface.co/hexgrad/Kokoro-82M/blob/main/VOICES.md (read 2026-11-17; Kokoro-82M and its voice
 * packs: Apache-2.0). Left out: the novelty "santa" voices. French has one voice (ff_siwis, trained on SIWIS, CC BY 4.0
 * data): French bots get it and the Piper French voices (voice/piper.ts).
 */
type AutoKokoro = { id: string; gender: "female" | "male"; language: string };
export const KOKORO_AUTO: (AutoKokoro & { name: string })[] = ([
  ...["af_heart", "af_bella", "af_nicole", "bf_emma", "af_aoede", "af_kore", "af_sarah", "af_alloy", "af_nova", "bf_isabella", "af_sky", "bf_alice", "bf_lily"].map((id) => ({ id, gender: "female" as const, language: "en" })),
  ...["am_fenrir", "am_michael", "am_puck", "bm_fable", "bm_george", "bm_lewis", "am_echo", "am_eric", "am_liam", "am_onyx", "bm_daniel"].map((id) => ({ id, gender: "male" as const, language: "en" })),
  { id: "ff_siwis", gender: "female", language: "fr" },
  { id: "ef_dora", gender: "female", language: "es" }, { id: "em_alex", gender: "male", language: "es" },
  { id: "if_sara", gender: "female", language: "it" }, { id: "im_nicola", gender: "male", language: "it" },
  { id: "pf_dora", gender: "female", language: "pt" }, { id: "pm_alex", gender: "male", language: "pt" },
  { id: "hf_alpha", gender: "female", language: "hi" }, { id: "hf_beta", gender: "female", language: "hi" }, { id: "hm_omega", gender: "male", language: "hi" }, { id: "hm_psi", gender: "male", language: "hi" },
  { id: "jf_alpha", gender: "female", language: "ja" }, { id: "jf_gongitsune", gender: "female", language: "ja" }, { id: "jf_nezumi", gender: "female", language: "ja" }, { id: "jf_tebukuro", gender: "female", language: "ja" }, { id: "jm_kumo", gender: "male", language: "ja" },
  { id: "zf_xiaobei", gender: "female", language: "zh" }, { id: "zf_xiaoni", gender: "female", language: "zh" }, { id: "zf_xiaoxiao", gender: "female", language: "zh" }, { id: "zf_xiaoyi", gender: "female", language: "zh" },
  { id: "zm_yunjian", gender: "male", language: "zh" }, { id: "zm_yunxi", gender: "male", language: "zh" }, { id: "zm_yunxia", gender: "male", language: "zh" }, { id: "zm_yunyang", gender: "male", language: "zh" },
] as AutoKokoro[]).map((v) => ({ ...v, name: kokoroVoiceOf(v.id).name }));
/** A base voice ("ff_siwis") or a documented weighted mix ("af_bella(2)+af_sky(1)"). */
export const validKokoroVoice = (v: string) => v.length <= 200 && /^[a-z]{2}_[a-z0-9_]+(\(\d+(\.\d+)?\))?([+-][a-z]{2}_[a-z0-9_]+(\(\d+(\.\d+)?\))?){0,4}$/.test(v);

export function kokoroVoiceOf(id: string, grade?: unknown): KokoroVoice {
  const lang = LANGS[id[0]] ?? "";
  const g = id[1] === "f" ? "female" : id[1] === "m" ? "male" : "";
  const name = id.includes("_") ? id.slice(id.indexOf("_") + 1).replace(/_/g, " ") : id;
  return { id, name: name.charAt(0).toUpperCase() + name.slice(1), language: lang, gender: g, grade: typeof grade === "string" ? grade.slice(0, 4) : "" };
}

export interface KokoroEndpoint { url: string; trusted: boolean }
const go = (e: KokoroEndpoint, url: string, init: RequestInit) => (e.trusted ? fetch(url, init) : guardedFetch(url, init));

export async function kokoroTts(e: KokoroEndpoint, o: { text: string; voice: string; speed?: number }, signal?: AbortSignal): Promise<Buffer> {
  const speed = Number(o.speed);
  const body = {
    model: "kokoro", input: o.text, voice: o.voice || "af_heart", response_format: "wav", stream: false,
    ...(Number.isFinite(speed) && speed > 0 && Math.abs(speed - 1) > 0.001 ? { speed: Math.min(4, Math.max(0.25, speed)) } : {}),
  };
  const res = await go(e, `${e.url}/v1/audio/speech`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body), signal: signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`Kokoro answered ${res.status}`);
  const audio = Buffer.from(await res.arrayBuffer());
  if (audio.length < 2) throw new Error("Kokoro: empty answer");
  return completeWav(audio, KOKORO_SAMPLE_RATE);
}

const cache = new Map<string, { at: number; voices: KokoroVoice[] }>();
export async function kokoroVoices(e: KokoroEndpoint): Promise<KokoroVoice[]> {
  const hit = cache.get(e.url);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.voices;
  const res = await go(e, `${e.url}/v1/audio/voices`, { signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`Kokoro answered ${res.status}`);
  const j = (await res.json()) as { voices?: unknown };
  const raw = Array.isArray(j.voices) ? j.voices : [];
  // Current shape [{id, name, overall_grade?}]; the legacy one (?legacy=true, before 0.3) was plain strings.
  const voices = raw.map((v) => (typeof v === "string" ? kokoroVoiceOf(v) : v && typeof v === "object" && typeof (v as { id?: unknown }).id === "string" ? kokoroVoiceOf((v as { id: string }).id, (v as { overall_grade?: unknown }).overall_grade) : null))
    .filter((v): v is KokoroVoice => !!v && validKokoroVoice(v.id)).slice(0, 500);
  cache.set(e.url, { at: Date.now(), voices });
  return voices;
}
export const clearKokoroCache = () => cache.clear();

/**
 * The voices this Kokoro really has, for the automatic voices (sync: what the last listing said, refreshed in the
 * background at most every 10 minutes; null while unknown — then the whole KOKORO_AUTO list is used).
 */
const known = new Map<string, { at: number; ids: Set<string> | null; busy: boolean }>();
export function kokoroVoiceIds(e: KokoroEndpoint, now = Date.now()): Set<string> | null {
  let h = known.get(e.url);
  if (!h) { h = { at: 0, ids: null, busy: false }; known.set(e.url, h); }
  if (!h.busy && now - h.at > 10 * 60_000) {
    const entry = h;
    entry.busy = true;
    kokoroVoices(e).then((v) => { entry.ids = new Set(v.map((x) => x.id)); }, () => undefined).finally(() => { entry.at = Date.now(); entry.busy = false; });
  }
  return h.ids;
}
export const clearKokoroIds = () => known.clear();
