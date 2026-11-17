import { guardedFetch } from "../net.js";
import type { PiperVoiceInfo } from "../shared.js";

/**
 * The free voices of the bundled Piper service (docker/piper/Dockerfile), and how a request picks one of them.
 *
 * Piper's HTTP server, as pinned (piper-tts 1.8.0, OHF-Voice/piper1-gpl, src/piper/http_server.py at tag v1.8.0, and
 * docs/API_HTTP.md, both read on 2026-11-17): `POST /synthesize` with JSON
 *   `text` (required) · `voice` (optional, a model name found in --data-dir; loaded on first use, then kept in memory;
 *   an unknown name falls back to the default voice) · `speaker_id` (optional, an integer, for multi-speaker models;
 *   overrides `speaker`) · `length_scale` (optional, phoneme length: > 1 slower, < 1 faster) · `noise_scale` /
 *   `noise_w_scale` (optional, variability). Answer: a WAV file (16-bit mono, the model's sample rate).
 *   `GET /voices` lists the models present in the data directories (`{ "<name>": <voice config>, … }`).
 * So ONE process serves every model of the image (no router needed); memory grows with each model actually used.
 *
 * Every model below was checked on its MODEL_CARD at https://huggingface.co/rhasspy/piper-voices (2026-11-17), and only
 * permissive licences that allow commercial use are shipped. The speakers' pitch was measured on a synthesized sentence
 * (median F0) to sort them into female and male voices: the numbers are kept below for reference.
 *
 *  | Model               | Speakers | Licence (dataset)                       | Source of the data                                   |
 *  |---------------------|---------:|-----------------------------------------|------------------------------------------------------|
 *  | fr_FR-siwis-medium  |        1 | CC BY 4.0                               | SIWIS, University of Edinburgh DataShare 10283/2353   |
 *  | fr_FR-upmc-medium   |        2 | CC BY-SA 4.0                            | UPMC "pierre" data, github.com/marytts/upmc-pierre-data |
 *  | fr_FR-mls-medium    |      125 | CC BY 4.0                               | Multilingual LibriSpeech, openslr.org/94             |
 *  | en_GB-vctk-medium   |      109 | CC BY 4.0                               | CSTR VCTK corpus, University of Edinburgh            |
 *
 * Share-alike (fr_FR-upmc-medium): the condition applies to the model and to derivatives OF THE MODEL, which Sklubot
 * redistributes unmodified, with its licence and attribution (docs/VOIX.md). Speech it produces is used as audio in a
 * call; it does not make Sklubot a derivative of the model. (This is a reading of the licence, not legal advice.)
 * Left out on purpose: fr_FR-tom-medium (AGPLv3), en_US-ryan-* and en_GB-semaine-medium (CC BY-NC-SA: no commercial
 * use), en_US-lessac-* (Blizzard 2013 licence, research use). fr_FR-gilles-low (CC0) is allowed but not shipped (low
 * quality, 16 kHz; and every model costs ~150 MB of RAM once used): add it with PIPER_VOICES if wanted.
 */

export interface PiperModel { id: string; lang: "fr" | "en"; speakers: number; licence: string; dataset: string; card: string }
export const PIPER_MODELS: PiperModel[] = [
  { id: "fr_FR-siwis-medium", lang: "fr", speakers: 1, licence: "CC BY 4.0", dataset: "SIWIS (University of Edinburgh)", card: "https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/siwis/medium/MODEL_CARD" },
  { id: "fr_FR-upmc-medium", lang: "fr", speakers: 2, licence: "CC BY-SA 4.0", dataset: "UPMC pierre (MaryTTS)", card: "https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/upmc/medium/MODEL_CARD" },
  { id: "fr_FR-mls-medium", lang: "fr", speakers: 125, licence: "CC BY 4.0", dataset: "Multilingual LibriSpeech (OpenSLR 94)", card: "https://huggingface.co/rhasspy/piper-voices/blob/main/fr/fr_FR/mls/medium/MODEL_CARD" },
  { id: "en_GB-vctk-medium", lang: "en", speakers: 109, licence: "CC BY 4.0", dataset: "CSTR VCTK (University of Edinburgh)", card: "https://huggingface.co/rhasspy/piper-voices/blob/main/en/en_GB/vctk/medium/MODEL_CARD" },
];
/** The models the Dockerfile downloads by default (its PIPER_VOICES), the first one being the server's default voice. */
export const PIPER_DEFAULT_MODELS = PIPER_MODELS.map((m) => m.id);

/** [model, speaker id or -1, name shown, gender, measured median F0 in Hz]. Names are invented first names, not the readers'. */
type Row = [string, number, string, "female" | "male", number];
const ROWS: Row[] = [
  // French, female
  ["fr_FR-siwis-medium", -1, "Siwis", "female", 216],
  ["fr_FR-upmc-medium", 0, "Jessica", "female", 237],
  ["fr_FR-mls-medium", 19, "Camille", "female", 190],
  ["fr_FR-mls-medium", 69, "Léa", "female", 193],
  ["fr_FR-mls-medium", 18, "Chloé", "female", 199],
  ["fr_FR-mls-medium", 3, "Manon", "female", 204],
  ["fr_FR-mls-medium", 14, "Inès", "female", 208],
  ["fr_FR-mls-medium", 62, "Margaux", "female", 212],
  ["fr_FR-mls-medium", 22, "Juliette", "female", 216],
  ["fr_FR-mls-medium", 25, "Alix", "female", 220],
  // French, male
  ["fr_FR-upmc-medium", 1, "Pierre", "male", 131],
  ["fr_FR-mls-medium", 6, "Antoine", "male", 89],
  ["fr_FR-mls-medium", 52, "Hugo", "male", 94],
  ["fr_FR-mls-medium", 80, "Louis", "male", 100],
  ["fr_FR-mls-medium", 36, "Mathis", "male", 105],
  ["fr_FR-mls-medium", 16, "Gabriel", "male", 108],
  ["fr_FR-mls-medium", 13, "Arthur", "male", 110],
  ["fr_FR-mls-medium", 0, "Jules", "male", 112],
  ["fr_FR-mls-medium", 10, "Raphaël", "male", 115],
  ["fr_FR-mls-medium", 42, "Victor", "male", 119],
  // English (British), female
  ["en_GB-vctk-medium", 74, "Emma", "female", 192],
  ["en_GB-vctk-medium", 90, "Olivia", "female", 195],
  ["en_GB-vctk-medium", 3, "Grace", "female", 201],
  ["en_GB-vctk-medium", 17, "Sophie", "female", 206],
  ["en_GB-vctk-medium", 18, "Lucy", "female", 210],
  ["en_GB-vctk-medium", 11, "Ella", "female", 223],
  ["en_GB-vctk-medium", 6, "Amelia", "female", 237],
  ["en_GB-vctk-medium", 1, "Isla", "female", 238],
  // English (British), male
  ["en_GB-vctk-medium", 102, "Oliver", "male", 83],
  ["en_GB-vctk-medium", 97, "Harry", "male", 88],
  ["en_GB-vctk-medium", 20, "George", "male", 92],
  ["en_GB-vctk-medium", 26, "Jack", "male", 97],
  ["en_GB-vctk-medium", 12, "Noah", "male", 101],
  ["en_GB-vctk-medium", 7, "Leo", "male", 105],
  ["en_GB-vctk-medium", 95, "Henry", "male", 109],
  ["en_GB-vctk-medium", 60, "Thomas", "male", 112],
];

export const piperVoiceId = (model: string, speaker: number) => (speaker >= 0 ? `${model}#${speaker}` : model);

/** The catalogue of free voices, in the order above (each language: female voices, then male ones). */
export const PIPER_VOICES: PiperVoiceInfo[] = ROWS.map(([model, speaker, name, gender, f0]) => {
  const m = PIPER_MODELS.find((x) => x.id === model)!;
  return { id: piperVoiceId(model, speaker), model, speaker, name, gender, language: m.lang, licence: m.licence, f0 };
});
const byId = new Map(PIPER_VOICES.map((v) => [v.id, v]));
export const piperVoice = (id: string): PiperVoiceInfo | null => byId.get(id) ?? null;

/** A Piper voice name (`<lang>_<REGION>-<name>-<quality>`), optionally with `#<speaker id>`: also a model not listed above. */
export const validPiperVoice = (id: string) => /^[a-z]{2,3}_[A-Z]{2}-[a-z0-9_]{1,40}-(x_low|low|medium|high)(#\d{1,4})?$/.test(id);

export function parsePiperVoice(id: string): { model: string; speaker: number } | null {
  if (!validPiperVoice(id)) return null;
  const [model, sp] = id.split("#");
  return { model, speaker: sp === undefined ? -1 : Number(sp) };
}

export interface PiperRequest {
  text: string;
  /** "" = the server's default voice (no `voice` field). */
  voiceId: string;
  /** The bot's speaking rate (1 = normal): sent as length_scale = 1 / rate. */
  rate?: number;
  /** A small, stable variation of pace and expressiveness (several bots on the same voice still sound different). */
  variant?: number;
}

/** Pace and variability per variant: [length_scale factor, noise_scale, noise_w_scale]. Variant 0 = the voice's defaults. */
export const PIPER_VARIANTS: [number, number | null, number | null][] = [[1, null, null], [0.92, 0.5, 0.6], [1.09, 0.8, 0.9], [0.96, 0.75, 1.0], [1.05, 0.55, 0.7]];

/** The documented `/synthesize` body for a voice of this catalogue (or any Piper voice name). */
export function piperBody(r: PiperRequest): Record<string, unknown> {
  const body: Record<string, unknown> = { text: r.text };
  const v = r.voiceId ? parsePiperVoice(r.voiceId) : null;
  if (v) {
    body.voice = v.model;
    if (v.speaker >= 0) body.speaker_id = v.speaker;
  } else if (r.voiceId && !r.voiceId.includes("#")) body.voice = r.voiceId; // a name typed in Settings → Voice, as before
  const [len, noise, noiseW] = PIPER_VARIANTS[Math.abs(Math.floor(r.variant ?? 0)) % PIPER_VARIANTS.length];
  const rate = Number(r.rate);
  const scale = (Number.isFinite(rate) && rate > 0 ? 1 / Math.min(2, Math.max(0.5, rate)) : 1) * len;
  if (Math.abs(scale - 1) > 0.001) body.length_scale = Math.round(scale * 1000) / 1000;
  if (noise !== null) body.noise_scale = noise;
  if (noiseW !== null) body.noise_w_scale = noiseW;
  return body;
}

export interface PiperEndpoint { url: string; trusted: boolean }
const go = (e: PiperEndpoint, url: string, init: RequestInit) => (e.trusted ? fetch(url, init) : guardedFetch(url, init));

/** Text → WAV through Piper's `/synthesize`. */
export async function piperTts(e: PiperEndpoint, r: PiperRequest, signal?: AbortSignal): Promise<Buffer> {
  const res = await go(e, `${e.url}/synthesize`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(piperBody(r)), signal: signal ?? AbortSignal.timeout(30_000) });
  if (!res.ok) throw new Error(`text-to-speech answered ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

/**
 * The models this Piper server really has (`GET /voices`), so a bot is only given a voice that exists there (an image
 * built with fewer voices, or another Piper). Cached 10 minutes; null while unknown (then the whole catalogue is used:
 * a missing model makes Piper fall back to its default voice, never an error).
 */
const installed = new Map<string, { at: number; models: Set<string> | null; busy: boolean }>();
export function piperModels(e: PiperEndpoint, now = Date.now()): Set<string> | null {
  let h = installed.get(e.url);
  if (!h) { h = { at: 0, models: null, busy: false }; installed.set(e.url, h); }
  if (!h.busy && now - h.at > 10 * 60_000) {
    const entry = h;
    entry.busy = true;
    go(e, `${e.url}/voices`, { signal: AbortSignal.timeout(5000) })
      .then(async (r) => { if (!r.ok) return; const j = (await r.json()) as unknown; if (j && typeof j === "object" && !Array.isArray(j)) entry.models = new Set(Object.keys(j).filter((k) => validPiperVoice(k))); })
      .catch(() => undefined)
      .finally(() => { entry.at = Date.now(); entry.busy = false; });
  }
  return h.models;
}
/** Waits for the list (tests, and the voices route that wants it right away). */
export async function piperModelsNow(e: PiperEndpoint): Promise<Set<string> | null> {
  piperModels(e);
  for (let i = 0; i < 60 && installed.get(e.url)?.busy; i++) await new Promise((r) => setTimeout(r, 50));
  return installed.get(e.url)?.models ?? null;
}
export const clearPiperModels = () => installed.clear();

/** The catalogue voices this server can speak with (all of them while the list is unknown). */
export function availablePiperVoices(models: Set<string> | null): PiperVoiceInfo[] {
  return models ? PIPER_VOICES.filter((v) => models.has(v.model)) : PIPER_VOICES;
}
