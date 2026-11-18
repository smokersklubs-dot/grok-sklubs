import type { Context, Hono } from "hono";
import { createHash } from "node:crypto";
import { RateWindow } from "../hardening.js";
import { tr } from "../i18n.js";
import { bots, clip, rows, users, type BotRecord, type UserRecord } from "../store.js";
import { speechParts, speechText } from "../speechtext.js";
import { botAccess } from "../workspaces.js";
import { FishError } from "./fish.js";
import { botVoiceRow, ttsFor, voiceSettings } from "./providers.js";

/**
 * « Écouter les réponses »: a bot's reply read out in the bot's OWN voice — the voice of its calls (providers.ttsFor
 * with the speaking bot: its chosen Fish Audio / Kokoro / Piper voice, else the free voice given automatically, else the
 * account's default).
 *
 *   POST /api/bots/:id/rows/:seq/speak   { part?: number }   → the audio of that part (audio/wav)
 *     headers  X-Speak-Part, X-Speak-Parts (how many parts the reply has), X-Speak-Voice (the voice's name, URI-encoded),
 *              X-Speak-Provider, X-Speak-Cache (hit | miss)
 *     409 { code: "no_tts", lang }  the owner's server has no text-to-speech: the app uses the browser's own speech
 *     400 not a finished reply · 404 the bot (or the row) is not the caller's to read · 403 role · 429 too many
 *
 * The app asks for part 0, plays it while it asks for part 1, and so on (web/src/lib/listen.ts): the first words play
 * after one short sentence is synthesized, however long the reply. The text is cleaned for speech first (speechtext.ts:
 * no markdown, « bloc de code », « lien vers example.com », at most 4000 characters).
 *
 * Access: exactly who may read the chat (botAccess … canView: the owner, or a workspace member/viewer of a bot shared
 * with them); anyone else gets the same 404 as for a bot that does not exist. Whose services: the bot OWNER's, like a
 * call — so who pays is the owner's (a Fish Audio line written to the owner's usage with its payer by ttsFor; the
 * operator's OpenAI key metered in hosted mode, and only when the owner's plan lets the operator's keys pay).
 * In a group chat, a member bot's message is read with that member bot's voice.
 *
 * Limits: 60 parts a minute and 600 an hour per caller, 180 a minute on one owner's services, 3 at a time per caller.
 * Cache: each synthesized part, per (row, text, voice, speed), 15 minutes, 32 MB in all (oldest first out): playing a
 * reply again costs nothing.
 */

export const speakLimits = {
  perMinute: new RateWindow(60, 60_000),
  perHour: new RateWindow(600, 60 * 60_000),
  perOwner: new RateWindow(180, 60_000),
};
const MAX_IN_FLIGHT = 3;
const inFlight = new Map<string, number>();
const TTS_TIMEOUT_MS = 30_000;

const CACHE_TTL_MS = 15 * 60_000;
const CACHE_MAX_BYTES = 32 * 1024 * 1024;
const cache = new Map<string, { audio: Buffer; at: number }>();
let cacheBytes = 0;
function cacheGet(key: string, now = Date.now()): Buffer | null {
  const hit = cache.get(key);
  if (!hit) return null;
  cache.delete(key);
  if (now - hit.at > CACHE_TTL_MS) { cacheBytes -= hit.audio.length; return null; }
  cache.set(key, hit); // most recently used last
  return hit.audio;
}
function cachePut(key: string, audio: Buffer, now = Date.now()) {
  if (audio.length > CACHE_MAX_BYTES / 4) return;
  const old = cache.get(key);
  if (old) { cache.delete(key); cacheBytes -= old.audio.length; }
  cache.set(key, { audio, at: now });
  cacheBytes += audio.length;
  for (const [k, v] of cache) {
    if (cacheBytes <= CACHE_MAX_BYTES && now - v.at <= CACHE_TTL_MS) break;
    cache.delete(k);
    cacheBytes -= v.audio.length;
  }
}
/** Tests only. */
export function clearSpeakCache() { cache.clear(); cacheBytes = 0; inFlight.clear(); }
export const speakCacheBytes = () => cacheBytes;

/** The bot whose voice says this message: in a group chat, the member bot that wrote it (the same owner's only). */
function speakerOf(bot: BotRecord, origin: { kind: string; id: string } | undefined): BotRecord | null {
  if (origin?.kind === "bot") {
    const b = bots.byId(origin.id);
    return b && b.userId === bot.userId && b.kind === "agent" ? b : null;
  }
  return bot.kind === "agent" ? bot : null;
}

const mimeOf = (b: Buffer) => (b.toString("latin1", 0, 4) === "RIFF" ? "audio/wav" : b.toString("latin1", 0, 3) === "ID3" || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0) ? "audio/mpeg" : b.toString("latin1", 0, 4) === "OggS" ? "audio/ogg" : "audio/wav");

type Env = { Variables: { user: UserRecord } };

export function registerSpeakRoute(api: Hono<Env>) {
  api.post("/bots/:id/rows/:seq/speak", async (c: Context<Env>) => {
    const user = c.get("user");
    const say = (en: string) => tr(user.locale, en);
    const no = (status: 400 | 403 | 404 | 409 | 429 | 502, en: string, code: string, extra: Record<string, unknown> = {}) => c.json({ error: say(en), code, ...extra }, status);

    const access = botAccess(user.id, c.req.param("id") ?? "");
    if (!access) return no(404, "That bot does not exist.", "not_found");
    if (!access.canView) return no(403, "Your role in this workspace does not allow that.", "forbidden");
    const bot = access.bot;
    const seq = Number(c.req.param("seq"));
    const row = Number.isInteger(seq) && seq > 0 ? rows.get(bot.id, bot.generation, seq) : null;
    if (!row) return no(404, "That message does not exist.", "not_found");
    const body = row.body;
    if (body.kind !== "message" || body.role !== "assistant" || body.streaming || !body.text.trim()) return no(400, "Only a finished reply can be listened to.", "not_a_reply");
    const speaker = speakerOf(bot, body.origin);
    if (!speaker) return no(400, "Only a finished reply can be listened to.", "not_a_reply");

    const owner = bot.userId;
    const lang = speaker.voice.lang && speaker.voice.lang !== "auto" ? speaker.voice.lang : users.localeOf(owner);
    const parts = speechParts(speechText(body.text, lang));
    if (!parts.length) return no(400, "Only a finished reply can be listened to.", "not_a_reply");
    const b = (await c.req.json().catch(() => ({}))) as { part?: unknown };
    const part = Number(b?.part ?? c.req.query("part") ?? 0);
    if (!Number.isInteger(part) || part < 0 || part >= parts.length) return no(400, "That part of the reply does not exist.", "bad_part", { parts: parts.length });

    // The owner chose the browser's own speech for voice (Settings → Voice, mode "browser"): the app reads it so too.
    const tts = voiceSettings(owner).mode === "browser" ? null : ttsFor(owner, { botId: speaker.id });
    if (!tts) return no(409, "No speech service is configured.", "no_tts", { lang, parts: parts.length });

    const voice = botVoiceRow(owner, speaker);
    const s = voiceSettings(owner);
    const voiceKey = `${voice.provider}:${voice.voiceId}:${voice.auto ? "auto" : ""}:${s.tts.model}:${speaker.voice.rate}`;
    const textHash = createHash("sha256").update(parts[part]).digest("base64url").slice(0, 22);
    const key = `${owner}|${bot.id}|${row.generation}|${row.seq}|${speaker.id}|${voiceKey}|${part}|${textHash}`;
    const headers = (hit: boolean, audio: Buffer) => ({
      "content-type": mimeOf(audio), "cache-control": "no-store", "x-content-type-options": "nosniff",
      "x-speak-part": String(part), "x-speak-parts": String(parts.length), "x-speak-voice": encodeURIComponent(clip(voice.voiceName || "", 80)),
      "x-speak-provider": voice.provider, "x-speak-cache": hit ? "hit" : "miss",
    });

    if (speakLimits.perMinute.over(user.id) || speakLimits.perHour.over(user.id) || speakLimits.perOwner.over(owner))
      return no(429, "Too many replies listened to. Wait a minute and try again.", "rate_limited");
    const cached = cacheGet(key);
    if (cached) return new Response(new Uint8Array(cached), { headers: headers(true, cached) });
    if ((inFlight.get(user.id) ?? 0) >= MAX_IN_FLIGHT) return no(429, "Too many replies listened to. Wait a minute and try again.", "rate_limited");

    inFlight.set(user.id, (inFlight.get(user.id) ?? 0) + 1);
    try {
      const audio = await tts(parts[part], AbortSignal.timeout(TTS_TIMEOUT_MS));
      if (!audio.length) return no(502, "The voice service did not answer. Try again in a moment.", "tts_failed");
      cachePut(key, audio);
      return new Response(new Uint8Array(audio), { headers: headers(false, audio) });
    } catch (e) {
      const detail = clip(e instanceof FishError ? e.message : (e as Error).message, 200);
      return no(502, "The voice service did not answer. Try again in a moment.", "tts_failed", { detail, lang });
    } finally {
      const n = (inFlight.get(user.id) ?? 1) - 1;
      if (n <= 0) inFlight.delete(user.id); else inFlight.set(user.id, n);
    }
  });
}
