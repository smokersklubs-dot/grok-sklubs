import type { Context, Hono } from "hono";
import { RateWindow } from "../hardening.js";
import { clip, type UserRecord } from "../store.js";
import { tr } from "../i18n.js";
import { botAccess } from "../workspaces.js";
import { sttFor } from "./providers.js";

/**
 * One-shot dictation: `POST /api/voice/transcribe[?bot=<id>&lang=fr-FR]`, body = one WAV recording (16 kHz, 16-bit PCM,
 * mono — what the app makes from its microphone recording, web/src/lib/dictation.ts) → `{ text }`.
 *
 * Used by the composer's microphone when the browser has no speech recognition of its own or when it fails (iOS Safari,
 * Firefox, Brave, many Android web views answer "network" / "service-not-allowed"). The transcription goes through the
 * configured speech-to-text (whisper.cpp, OpenAI, Fish Audio: providers.sttFor), so it is metered like every other voice
 * use (Fish Audio's price written to the account's usage, the operator's OpenAI key metered in hosted mode).
 *
 * Whose services: with `bot`, that bot's owner's (as in a call; the caller must be allowed to talk to it — 404 when they
 * cannot see it, 403 when their role does not allow talking); without it, the caller's own. Behind the session, the
 * same-site Origin check and the e-mail gate like every /api route (routes.ts).
 *
 * Limits: 60 s of audio at most (≈ 1.9 MB), 0.25 s at least; 12 clips a minute and 120 an hour per caller, 60 a minute on
 * one account's services, 2 at a time per caller; the transcription itself gives up after 45 s.
 */

export const TRANSCRIBE_SAMPLE_RATE = 16000;
export const TRANSCRIBE_MAX_SECONDS = 60;
const MIN_SECONDS = 0.25;
/** 60 s of 16 kHz 16-bit mono, plus room for the header and a few extra chunks. */
export const TRANSCRIBE_MAX_BYTES = TRANSCRIBE_SAMPLE_RATE * 2 * TRANSCRIBE_MAX_SECONDS + 4096;
const STT_TIMEOUT_MS = 45_000;

export const transcribeLimits = {
  perMinute: new RateWindow(12, 60_000),
  perHour: new RateWindow(120, 60 * 60_000),
  perOwner: new RateWindow(60, 60_000),
};
const inFlight = new Map<string, number>();

/** The PCM layout and length of a WAV file, or a reason it is not one this route accepts. */
export function inspectWav(buf: Buffer): { ok: true; seconds: number } | { ok: false; reason: string } {
  if (buf.length < 44 || buf.toString("latin1", 0, 4) !== "RIFF" || buf.toString("latin1", 8, 12) !== "WAVE") return { ok: false, reason: "not a WAV file" };
  let fmt: { format: number; channels: number; rate: number; bits: number } | null = null;
  let at = 12;
  while (at + 8 <= buf.length) {
    const id = buf.toString("latin1", at, at + 4);
    const size = buf.readUInt32LE(at + 4);
    const body = at + 8;
    if (id === "fmt " && size >= 16 && body + 16 <= buf.length) {
      fmt = { format: buf.readUInt16LE(body), channels: buf.readUInt16LE(body + 2), rate: buf.readUInt32LE(body + 4), bits: buf.readUInt16LE(body + 14) };
    } else if (id === "data") {
      if (!fmt) return { ok: false, reason: "no format chunk" };
      if (fmt.format !== 1 || fmt.channels !== 1 || fmt.bits !== 16 || fmt.rate !== TRANSCRIBE_SAMPLE_RATE) return { ok: false, reason: "16 kHz 16-bit mono PCM only" };
      const bytes = Math.min(size, buf.length - body);
      return { ok: true, seconds: bytes / (TRANSCRIBE_SAMPLE_RATE * 2) };
    }
    at = body + size + (size % 2);
  }
  return { ok: false, reason: "no audio data" };
}

/** Reads the request body, stopping as soon as it is over `max` bytes (null then). */
async function readCapped(c: Context, max: number): Promise<Buffer | null> {
  const stream = c.req.raw.body;
  if (!stream) return Buffer.alloc(0);
  const reader = stream.getReader();
  const parts: Buffer[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => undefined); return null; }
    parts.push(Buffer.from(value));
  }
  return Buffer.concat(parts);
}

type Env = { Variables: { user: UserRecord } };

export function registerTranscribeRoute(api: Hono<Env>) {
  api.post("/voice/transcribe", async (c) => {
    const user = c.get("user");
    const say = (en: string) => tr(user.locale, en);
    const no = (status: 400 | 403 | 404 | 409 | 413 | 415 | 429 | 502, en: string, code: string) => c.json({ error: say(en), code }, status);

    // Whose speech services: the bot's owner's (talk right needed), else the caller's own.
    let owner = user.id;
    const botId = c.req.query("bot");
    if (botId) {
      const a = botAccess(user.id, botId);
      if (!a) return no(404, "That bot does not exist.", "not_found");
      if (!a.canTalk) return no(403, "Your role in this workspace does not allow that.", "forbidden");
      owner = a.bot.userId;
    }
    const type = (c.req.header("content-type") ?? "").split(";")[0].trim().toLowerCase();
    if (!["audio/wav", "audio/wave", "audio/x-wav"].includes(type)) return no(415, "Send the recording as a WAV file (16 kHz mono).", "bad_format");
    if (Number(c.req.header("content-length") ?? 0) > TRANSCRIBE_MAX_BYTES) return no(413, "This recording is too long (one minute at most).", "too_long");
    if (transcribeLimits.perMinute.over(user.id) || transcribeLimits.perHour.over(user.id) || transcribeLimits.perOwner.over(owner))
      return no(429, "Too many dictations. Wait a minute and try again.", "rate_limited");
    if ((inFlight.get(user.id) ?? 0) >= 2) return no(429, "Too many dictations. Wait a minute and try again.", "rate_limited");

    const stt = sttFor(owner, c.req.query("lang") || user.locale);
    if (!stt) return no(409, "Speech recognition is not set up on the server. Turn it on in Settings → Voice.", "no_stt");

    inFlight.set(user.id, (inFlight.get(user.id) ?? 0) + 1);
    try {
      const wav = await readCapped(c, TRANSCRIBE_MAX_BYTES);
      if (!wav) return no(413, "This recording is too long (one minute at most).", "too_long");
      const w = inspectWav(wav);
      if (!w.ok) return no(415, "Send the recording as a WAV file (16 kHz mono).", "bad_format");
      if (w.seconds > TRANSCRIBE_MAX_SECONDS + 0.5) return no(413, "This recording is too long (one minute at most).", "too_long");
      if (w.seconds < MIN_SECONDS) return c.json({ text: "" });
      try {
        const text = await stt(wav, AbortSignal.timeout(STT_TIMEOUT_MS));
        return c.json({ text: clip(text.trim(), 20_000) });
      } catch (e) {
        return c.json({ error: say("The speech recognition service did not answer. Try again in a moment."), code: "stt_failed", detail: clip((e as Error).message, 200) }, 502);
      }
    } finally {
      const n = (inFlight.get(user.id) ?? 1) - 1;
      if (n <= 0) inFlight.delete(user.id); else inFlight.set(user.id, n);
    }
  });
}
