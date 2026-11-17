/**
 * Which way the composer's microphone (and a call's fallback) takes the user's voice, and the audio maths of the
 * recorded fallback. No imports and only erasable TypeScript, so web/scripts/dictation.test.mjs runs it in plain Node.
 *
 *  - "server": record the microphone (MediaRecorder), convert it here to a 16 kHz mono WAV and send it to the server's
 *    speech-to-text (POST /api/voice/transcribe). Preferred whenever the bot's owner has server voice for calls
 *    (status.mode "server"), and the way out when the browser has no recognition or its recognition fails.
 *  - "browser": the Web Speech API (Chrome, Edge, Safari on macOS…), as before.
 *  - "unavailable": neither — the app says so and points to Settings → Voice.
 */

export type DictationRoute = "server" | "browser" | "unavailable";

export interface DictationAbilities {
  /** The bot owner's calls go through the server (voiceStatus mode "server"). */
  serverMode: boolean;
  /** The server can transcribe a recorded clip (voiceStatus.dictation). */
  serverDictation: boolean;
  /** The browser has SpeechRecognition / webkitSpeechRecognition. */
  browser: boolean;
  /** The browser can record the microphone (getUserMedia + MediaRecorder + Web Audio). */
  recorder: boolean;
  /** The browser's recognition already failed with an error that recording can get around (fallbackError). */
  browserFailed: boolean;
}

export function dictationRoute(a: DictationAbilities): DictationRoute {
  const server = a.serverDictation && a.recorder;
  if (server && (a.serverMode || !a.browser || a.browserFailed)) return "server";
  if (a.browser && !a.browserFailed) return "browser";
  return "unavailable";
}

/**
 * Web Speech API errors that mean "this browser's recognition service cannot work here" (no Google service in Brave or
 * on many Android web views, Siri dictation off on iOS, no supported language…), so recording and sending the audio to
 * the server is worth trying. A refused microphone permission ("not-allowed") is not one of them: recording would be
 * refused too, so its own message stays. "no-speech" and "aborted" are ordinary and stay silent.
 */
const FALLBACK = ["network", "service-not-allowed", "audio-capture", "language-not-supported", "unsupported"];
export const fallbackError = (code: string): boolean => FALLBACK.includes(code);

/** Recorder formats, in order of preference: Chrome/Firefox/Android record WebM or Ogg Opus, Safari (iOS too) MP4/AAC. */
export const RECORDER_TYPES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4", "audio/ogg;codecs=opus", "audio/ogg", "audio/aac"];
export function pickRecorderType(supported: (type: string) => boolean): string {
  for (const t of RECORDER_TYPES) if (supported(t)) return t;
  return ""; // the browser's own default
}

export const TARGET_RATE = 16000;
/** The server accepts 60 s at most (server/src/voice/transcribe.ts): the recorder stops itself a little before. */
export const MAX_RECORD_MS = 58_000;

/**
 * Down-mixes to mono and resamples to 16 kHz: each output sample is the mean of the input samples it covers (a box
 * filter, enough against aliasing for speech recognition), or a linear interpolation when the source is slower.
 */
export function toMono16k(channels: Float32Array[], rate: number): Float32Array {
  const n = channels[0]?.length ?? 0;
  const mono = new Float32Array(n);
  for (const ch of channels) for (let i = 0; i < n; i++) mono[i] += ch[i] / channels.length;
  if (rate === TARGET_RATE) return mono;
  const ratio = rate / TARGET_RATE;
  const out = new Float32Array(Math.floor(n / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = i * ratio;
    if (ratio > 1) {
      const a = Math.floor(start);
      const b = Math.min(n, Math.max(a + 1, Math.floor(start + ratio)));
      let sum = 0;
      for (let j = a; j < b; j++) sum += mono[j];
      out[i] = sum / (b - a);
    } else {
      const a = Math.floor(start);
      const f = start - a;
      out[i] = mono[a] * (1 - f) + (mono[Math.min(n - 1, a + 1)] ?? 0) * f;
    }
  }
  return out;
}

/** A 16-bit PCM mono WAV (RIFF header, 44 bytes) of `samples` at `rate`. */
export function encodeWav(samples: Float32Array, rate = TARGET_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const v = new DataView(bytes.buffer);
  const ascii = (at: number, s: string) => { for (let i = 0; i < s.length; i++) bytes[at + i] = s.charCodeAt(i); };
  ascii(0, "RIFF"); v.setUint32(4, 36 + samples.length * 2, true); ascii(8, "WAVE");
  ascii(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, rate, true); v.setUint32(28, rate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ascii(36, "data"); v.setUint32(40, samples.length * 2, true);
  for (let i = 0; i < samples.length; i++) {
    const s = Math.max(-1, Math.min(1, samples[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return bytes;
}
