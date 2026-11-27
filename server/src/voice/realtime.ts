import { WebSocket } from "ws"; import { languageName } from "../clientshared/locales.js";
import { unseal } from "../auth.js";
import { q } from "../db.js";
import { hostedMode } from "../hosted.js";
import { now } from "../store.js";
import { recordServiceCost } from "../usage.js";
import { wavOf } from "./vad.js";
import { ownOpenAiKey, setRealtimeProbe } from "./providers.js";

/**
 * L167 — a real-time voice model for calls, as an OPTION (off by default; Settings → Voice). When it is on, and the account
 * already has an OpenAI key, a call talks to OpenAI's Realtime API instead of the speech-to-text → bot → text-to-speech
 * chain: it answers in a fraction of a second. Anything that needs the bot (its tools, files, memory, approvals, the web…)
 * is delegated to the bot through one function, `ask_bot`: the request is posted in the bot's chat as a voice message, the
 * bot works on it as usual (approvals and the floor unchanged: cards are answered on the screen), and its answer is read
 * out by the voice model. The voice model itself has no other tool and never acts.
 *
 * Keys: the account's OWN OpenAI key only — the one it saved for its OpenAI speech services (providers.ts ownOpenAiKey), or
 * the key of a provider it added for api.openai.com (Settings → Models). The server's OPENAI_API_KEY is used only outside
 * hosted mode (then the operator is the owner). The key stays on the server: the browser keeps streaming its microphone to
 * this server (voice/session.ts), which relays to OpenAI.
 *
 * Documented interfaces only (OpenAI, read 23/11/2026):
 *  - WebSocket `wss://api.openai.com/v1/realtime?model=<model>`, header `Authorization: Bearer <key>`
 *    https://developers.openai.com/api/docs/guides/realtime-websocket
 *  - `session.update` with `session.type: "realtime"`, `instructions`, `audio.input.format {type:"audio/pcm", rate:24000}`,
 *    `audio.input.turn_detection {type:"semantic_vad"}`, `audio.output.format {type:"audio/pcm", rate: 24000}`,
 *    `audio.output.voice`, `tools` ({type:"function", name, description, parameters}) and `tool_choice: "auto"`;
 *    client events `input_audio_buffer.append {audio: base64}`, `response.cancel`, `conversation.item.create` with an item
 *    `{type:"function_call_output", call_id, output}` then `response.create`; server events `response.output_audio.delta
 *    {delta}`, `response.output_audio_transcript.delta {delta}` / `.done {transcript}`, `input_audio_buffer.speech_started`, `response.done`
 *    (its output holds the `function_call` items: name, call_id, arguments)
 *    https://developers.openai.com/api/docs/guides/realtime-conversations
 *  - input transcription `session.audio.input.transcription {model}` and the event
 *    `conversation.item.input_audio_transcription.completed {transcript}`
 *    https://developers.openai.com/api/docs/guides/realtime-transcription
 *  - prices per 1M tokens (Realtime & Audio, Standard) https://developers.openai.com/api/docs/pricing
 */

export const REALTIME_MODELS = ["gpt-realtime-2.1-mini", "gpt-realtime-2.1", "gpt-realtime-mini", "gpt-realtime"] as const;
export type RealtimeModel = (typeof REALTIME_MODELS)[number];
/** Voices of the Realtime API's output (the same list as OpenAI's text-to-speech; providers.ts). */
export const REALTIME_VOICES = ["marin", "cedar", "alloy", "ash", "ballad", "coral", "echo", "sage", "shimmer", "verse"] as const;
/** $ per 1M tokens: text in, text cached, text out, audio in, audio cached, audio out. */
const PRICES: Record<RealtimeModel, [number, number, number, number, number, number]> = {
  "gpt-realtime-2.1-mini": [0.6, 0.06, 2.4, 10, 0.3, 20],
  "gpt-realtime-2.1": [4, 0.4, 24, 32, 0.4, 64],
  "gpt-realtime-mini": [0.6, 0.06, 2.4, 10, 0.3, 20],
  "gpt-realtime": [4, 0.4, 16, 32, 0.4, 64],
};
export const REALTIME_URL = () => process.env.OPENAI_REALTIME_URL || "wss://api.openai.com/v1/realtime";
export const RATE_IN = 16000;
export const RATE_OUT = 24000;

export interface RealtimeSettings { enabled: boolean; model: RealtimeModel; voice: string }
export interface RealtimeStatus extends RealtimeSettings { available: boolean; reason: "" | "off" | "no key" }

q.run("CREATE TABLE IF NOT EXISTS voice_realtime (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, enabled INTEGER NOT NULL DEFAULT 0, model TEXT NOT NULL, voice TEXT NOT NULL, updated_at INTEGER NOT NULL)");

export const realtimeSettings = {
  get(userId: string): RealtimeSettings {
    const r = q.get<{ enabled: number; model: string; voice: string }>("SELECT enabled, model, voice FROM voice_realtime WHERE user_id = ?", userId);
    return {
      enabled: !!r?.enabled,
      model: (REALTIME_MODELS as readonly string[]).includes(r?.model ?? "") ? r!.model as RealtimeModel : REALTIME_MODELS[0],
      voice: (REALTIME_VOICES as readonly string[]).includes(r?.voice ?? "") ? r!.voice : REALTIME_VOICES[0],
    };
  },
  /** Unknown values keep the current ones. */
  set(userId: string, f: Record<string, unknown>): RealtimeSettings {
    const cur = realtimeSettings.get(userId);
    const next: RealtimeSettings = {
      enabled: typeof f.enabled === "boolean" ? f.enabled : cur.enabled,
      model: (REALTIME_MODELS as readonly string[]).includes(f.model as string) ? f.model as RealtimeModel : cur.model,
      voice: (REALTIME_VOICES as readonly string[]).includes(f.voice as string) ? f.voice as string : cur.voice,
    };
    q.run("INSERT INTO voice_realtime (user_id, enabled, model, voice, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET enabled = excluded.enabled, model = excluded.model, voice = excluded.voice, updated_at = excluded.updated_at",
      userId, next.enabled ? 1 : 0, next.model, next.voice, now());
    return next;
  },
};

/** The account's own OpenAI key (see the module comment), or null. Never sent anywhere but to OpenAI. */
export function realtimeKey(userId: string): { key: string; payer: string } | null {
  const own = ownOpenAiKey(userId);
  if (own) return { key: own, payer: hostedMode() ? "own" : "" };
  for (const r of q.all<{ base_url: string; key_enc: string | null }>("SELECT base_url, key_enc FROM user_providers WHERE user_id = ? AND key_enc IS NOT NULL", userId)) {
    let host = "";
    try { host = new URL(r.base_url).hostname; } catch { /* not an address */ }
    if (host === "api.openai.com" && r.key_enc) { try { const k = unseal(r.key_enc); if (k) return { key: k, payer: hostedMode() ? "own" : "" }; } catch { /* unreadable */ } }
  }
  if (!hostedMode() && process.env.OPENAI_API_KEY) return { key: process.env.OPENAI_API_KEY, payer: "" };
  return null;
}

export function realtimeStatus(userId: string): RealtimeStatus {
  const s = realtimeSettings.get(userId);
  if (!s.enabled) return { ...s, available: false, reason: "off" };
  return realtimeKey(userId) ? { ...s, available: true, reason: "" } : { ...s, available: false, reason: "no key" };
}

setRealtimeProbe((userId) => realtimeStatus(userId).available);

/** What a call costs, from `response.done`'s usage (tokens by kind). */
export function realtimeCost(model: RealtimeModel, usage: any): number {
  const p = PRICES[model];
  const inD = usage?.input_token_details ?? {};
  const outD = usage?.output_token_details ?? {};
  const cached = inD.cached_tokens_details ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  const textIn = Math.max(0, n(inD.text_tokens) - n(cached.text_tokens)), audioIn = Math.max(0, n(inD.audio_tokens) - n(cached.audio_tokens));
  return (textIn * p[0] + n(cached.text_tokens) * p[1] + n(outD.text_tokens) * p[2] + audioIn * p[3] + n(cached.audio_tokens) * p[4] + n(outD.audio_tokens) * p[5]) / 1_000_000;
}

/** 16 kHz → 24 kHz (linear interpolation), keeping the position between chunks so the sound stays continuous. */
export class Upsampler {
  /** Position of the next output sample, in input samples of the current chunk (-1 = the last sample of the previous one). */
  private pos = 0;
  private last = 0;
  push(pcm: Int16Array): Int16Array {
    const step = RATE_IN / RATE_OUT;
    const n = pcm.length;
    const out: number[] = [];
    while (this.pos < n - 1) {
      const i = Math.floor(this.pos);
      const a = i < 0 ? this.last : pcm[i];
      const b = pcm[i + 1];
      out.push(Math.round(a + (b - a) * (this.pos - i)));
      this.pos += step;
    }
    this.pos -= n;
    if (n) this.last = pcm[n - 1];
    return Int16Array.from(out);
  }
}

export const ASK_BOT = "ask_bot";
const instructionsFor = (botName: string, locale: string) =>
  `You are the voice of ${botName}, the user's AI teammate, in a live phone-like call. Speak ${languageName(locale)}, in short spoken sentences (one to three), warm and plain; never read out code, links or lists. ` +
  `You cannot act, look anything up or remember anything yourself. For anything beyond small talk or a short general answer — doing something, the user's files, email, calendar, the web, memory, anything about their work — call ${ASK_BOT} with the user's request written out in full, after saying in a few words that you are asking. ` +
  `When ${ASK_BOT} answers, say the answer briefly; say that the full answer is written in the chat when it is long. If it says an approval waits, tell the user to answer it on the screen. Never invent results.`;

/** Something that behaves like the upstream WebSocket (the real one, or a fake in tests). */
export interface Upstream { send(data: string): void; close(): void; on(event: "message", fn: (data: Buffer | string) => void): void; on(event: "close" | "open", fn: () => void): void; on(event: "error", fn: (err: Error) => void): void }

export interface BridgeDeps {
  upstream: Upstream;
  /** To the browser: the same messages as the classic call (voice/session.ts protocol). */
  send(data: string | Buffer): void;
  /** Posts the request in the bot's chat and resolves with its answer (or a short "still working" sentence on timeout). */
  delegate(request: string): Promise<string>;
  model: RealtimeModel;
  voice: string;
  botName: string;
  locale: string;
  /** The cost of each response, written to the account's usage by the caller. */
  cost?(usd: number): void;
}

/**
 * One call over the Realtime API. Transport-free like VoiceSession: tests drive it with a fake upstream. Audio from the
 * model is sent to the browser in WAV pieces of about 0.5 s (the browser plays WAV one after the other, as for the classic
 * call); the user speaking cuts the model off (`barge_in`, `response.cancel`).
 */
export class RealtimeBridge {
  readonly transcript: { role: "user" | "assistant"; text: string }[] = [];
  private up = new Upsampler();
  private pending: Int16Array[] = [];
  private pendingSamples = 0;
  private audioId = 0;
  /** The words of the audio not yet sent (`response.output_audio_transcript.delta`): each WAV piece carries its caption. */
  private caption = "";
  private responding = false;
  private unplayed = new Set<number>();
  delegations = 0;
  closed = false;

  constructor(private d: BridgeDeps) {
    d.upstream.on("message", (raw) => this.onUpstream(String(raw)));
    d.upstream.on("error", (err) => this.json({ type: "error", message: `realtime: ${err.message}` }));
  }

  private json(o: Record<string, unknown>) { if (!this.closed) this.d.send(JSON.stringify(o)); }
  private up_(o: Record<string, unknown>) { if (!this.closed) this.d.upstream.send(JSON.stringify(o)); }

  /** The session's settings, sent once the upstream socket is open. */
  start() {
    this.up_({
      type: "session.update",
      session: {
        type: "realtime",
        instructions: instructionsFor(this.d.botName, this.d.locale),
        audio: {
          input: { format: { type: "audio/pcm", rate: RATE_OUT }, turn_detection: { type: "semantic_vad" }, transcription: { model: "gpt-4o-mini-transcribe" } },
          output: { format: { type: "audio/pcm", rate: RATE_OUT }, voice: this.d.voice },
        },
        tools: [{
          type: "function", name: ASK_BOT,
          description: "Ask the user's AI teammate (with its tools, files, memory and approvals) to do or find something. Returns its answer.",
          parameters: { type: "object", properties: { request: { type: "string", description: "The user's request, written out in full." } }, required: ["request"] },
        }],
        tool_choice: "auto",
      },
    });
  }

  /** Microphone audio from the browser (16 kHz PCM). */
  onAudio(pcm: Int16Array) {
    if (this.closed || !pcm.length) return;
    const up = this.up.push(pcm);
    this.up_({ type: "input_audio_buffer.append", audio: Buffer.from(up.buffer, up.byteOffset, up.byteLength).toString("base64") });
  }

  played(id: number) { this.unplayed.delete(id); }

  /** The Interrupt button, or the user speaking. */
  bargeIn() {
    this.pending = [];
    this.pendingSamples = 0;
    this.caption = "";
    this.unplayed.clear();
    this.json({ type: "barge_in" });
    if (this.responding) { this.up_({ type: "response.cancel" }); this.responding = false; }
  }

  /** A notice the voice model should pass on (an approval card waiting on the screen). */
  tell(text: string) {
    this.up_({ type: "conversation.item.create", item: { type: "message", role: "user", content: [{ type: "input_text", text: `[Note from the app, not the user] ${text}` }] } });
    this.up_({ type: "response.create" });
  }

  private flush() {
    if (!this.pendingSamples) return;
    const pcm = new Int16Array(this.pendingSamples);
    let at = 0;
    for (const p of this.pending) { pcm.set(p, at); at += p.length; }
    this.pending = [];
    this.pendingSamples = 0;
    const wav = wavOf(pcm, RATE_OUT);
    const id = ++this.audioId;
    this.unplayed.add(id);
    const text = this.caption.trim();
    this.caption = "";
    this.json({ type: "audio", id, text, mime: "audio/wav", ms: Math.round((pcm.length / RATE_OUT) * 1000) });
    if (!this.closed) this.d.send(wav);
  }

  private onUpstream(raw: string) {
    if (this.closed) return;
    let e: any;
    try { e = JSON.parse(raw); } catch { return; }
    switch (e?.type) {
      case "input_audio_buffer.speech_started":
        this.json({ type: "vad", speaking: true });
        this.bargeIn();
        break;
      case "input_audio_buffer.speech_stopped":
        this.json({ type: "vad", speaking: false });
        break;
      case "response.created":
        this.responding = true;
        break;
      case "response.output_audio.delta": {
        if (typeof e.delta !== "string") break;
        const b = Buffer.from(e.delta, "base64");
        const pcm = new Int16Array(b.buffer.slice(b.byteOffset, b.byteOffset + b.length - (b.length % 2)));
        this.pending.push(pcm);
        this.pendingSamples += pcm.length;
        if (this.pendingSamples >= RATE_OUT / 2) this.flush();
        break;
      }
      case "response.output_audio_transcript.delta":
        if (typeof e.delta === "string") this.caption += e.delta;
        break;
      case "response.output_audio.done":
        this.flush();
        break;
      case "response.output_audio_transcript.done":
        if (typeof e.transcript === "string" && e.transcript.trim()) this.transcript.push({ role: "assistant", text: e.transcript.trim() });
        break;
      case "conversation.item.input_audio_transcription.completed":
        if (typeof e.transcript === "string" && e.transcript.trim()) { this.transcript.push({ role: "user", text: e.transcript.trim() }); this.json({ type: "final", text: e.transcript.trim() }); }
        break;
      case "response.done": {
        this.flush();
        this.caption = "";
        this.responding = false;
        const r = e.response ?? {};
        if (r.usage && this.d.cost) this.d.cost(realtimeCost(this.d.model, r.usage));
        for (const item of Array.isArray(r.output) ? r.output : []) {
          if (item?.type !== "function_call" || typeof item.call_id !== "string") continue;
          let request = "";
          try { request = String(JSON.parse(item.arguments ?? "{}").request ?? "").trim(); } catch { /* bad arguments */ }
          const answer = item.name === ASK_BOT && request ? this.runDelegation(request) : Promise.resolve("Unknown function: only ask_bot exists.");
          void answer.then((output) => {
            this.up_({ type: "conversation.item.create", item: { type: "function_call_output", call_id: item.call_id, output: JSON.stringify({ answer: output }) } });
            this.up_({ type: "response.create" });
          });
        }
        break;
      }
      case "error":
        this.json({ type: "error", message: `realtime: ${String(e.error?.message ?? "error")}` });
        break;
    }
  }

  private runDelegation(request: string): Promise<string> {
    this.delegations++;
    return this.d.delegate(request).catch((err) => `The teammate could not answer: ${(err as Error).message}`);
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try { this.d.upstream.close(); } catch { /* already closed */ }
  }
}

/** Opens the upstream WebSocket with the account's key (header only; never in the URL or a log). */
export function openUpstream(key: string, model: RealtimeModel): WebSocket {
  return new WebSocket(`${REALTIME_URL()}?model=${encodeURIComponent(model)}`, { headers: { Authorization: `Bearer ${key}` }, maxPayload: 8 * 1024 * 1024 });
}

/** Writes a response's cost to the account's usage (label "openai realtime <model>"). */
export const recordRealtimeCost = (userId: string, botId: string, model: RealtimeModel, usd: number, payer: string) => {
  if (usd > 0) recordServiceCost(userId, botId, `openai realtime ${model}`, usd, payer);
};
