import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import { originAllowed, parseCookies, SESSION_COOKIE, userForToken } from "../auth.js";
import { getLive, subscribe } from "../bus.js";
import { callEnded, callStarted } from "../calls.js";
import { interrupt, submitMemberMessage, submitUserMessage } from "../agent/loop.js";
import { holdAndOffer, screen as screenSecrets } from "../pastedsecrets.js";
import { bots, rows, type BotRecord, type UserRecord } from "../store.js";
import { botAccess } from "../workspaces.js";
import { Vad, wavDurationMs, wavOf } from "./vad.js";
import { sttFor, ttsFor, voiceSettings, voiceStatus, type Stt, type Tts } from "./providers.js";
import { emailGateBlocks } from "../publicsignup.js";

/**
 * Server-mediated voice calls (wave 6). The browser streams the microphone as 16 kHz 16-bit mono PCM (from an
 * AudioWorklet) over a WebSocket; the server detects speech (vad.ts), transcribes each utterance (speech-to-text),
 * posts it to the bot as a voice message, and reads the bot's reply out sentence by sentence while it is still being
 * written (text-to-speech), so the first words play before the reply is finished.
 *
 * Barge-in: when the user starts speaking while the bot talks (or is still working on its answer to the call), the
 * server tells the browser to stop playback at once (`barge_in`), drops every sentence not yet played, and cancels the
 * bot's current generation (the turn is interrupted, as with Stop). The browser also stops playback on its own as soon
 * as it hears the user, so the cut is immediate; the server's decision is the one that cancels.
 *
 * Protocol (`GET /api/voice/:botId`, WebSocket, same-site Origin and the session cookie; docs/API.md):
 *  client → server  text  {"type":"hello","sampleRate":16000,"lang":"fr-FR"}   then binary PCM frames (Int16 LE)
 *                   text  {"type":"played","id":N} · {"type":"interrupt"} · {"type":"mute","on":bool} · {"type":"bye"}
 *  server → client  text  {"type":"ready","callId","stt","tts"} · {"type":"vad","speaking":bool} · {"type":"partial","text"}
 *                         {"type":"final","text"} · {"type":"barge_in"} · {"type":"audio","id","text","mime","ms"} (followed by
 *                         one binary message: the WAV) · {"type":"error","message"}
 */

export const VOICE_PATH = /^\/api\/voice\/([\w-]{1,80})$/;
export const SAMPLE_RATE = 16000;
const MIN_UTTERANCE_MS = 250;
const MAX_CALL_MS = 60 * 60_000;
/** Sentences being synthesized at once, ahead of playback (Fish Audio's smallest plan allows 5 concurrent requests). */
const PREFETCH = 2;

/** What can be read out: no code, links, markdown or ids — the words only. */
export function speakableText(s: string): string {
  return s
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`[^`]*`/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/^\s{0,3}(#{1,6}|>|[-*+]|\d+\.)\s+/gm, "")
    .replace(/[*_~|]+/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Complete sentences at the start of `buf` (all of it when `final`), and what is left to wait for. */
export function takeSentences(buf: string, final: boolean): { sentences: string[]; rest: string } {
  const sentences: string[] = [];
  let start = 0;
  for (let i = 0; i < buf.length; i++) {
    const ch = buf[i];
    let end = -1;
    if (ch === "\n") end = i;
    else if (".!?…:;".includes(ch)) {
      let j = i + 1;
      while (j < buf.length && "\"»”')".includes(buf[j])) j++;
      // A sentence ends at its punctuation only once a space follows (so "3.5" or "e.g." mid-stream wait).
      if (j < buf.length && /\s/.test(buf[j])) end = j;
    }
    if (end < 0) continue;
    const piece = buf.slice(start, end).trim();
    if (piece) sentences.push(piece);
    start = end + 1;
    i = end;
  }
  let rest = buf.slice(start);
  if (final && rest.trim()) { sentences.push(rest.trim()); rest = ""; }
  return { sentences, rest: final ? "" : rest.replace(/^\s+/, "") };
}

export interface SessionDeps {
  send(data: string | Buffer): void;
  stt: Stt;
  tts: Tts;
  /** Posts what the user said to the bot. */
  submit(text: string): void;
  /** Cancels the bot's current generation. */
  interrupt(): void;
  /** Whether the bot is working on something right now. */
  botBusy(): boolean;
  partials: boolean;
  bargeIn: { enabled: boolean; minSpeechMs: number };
}

export interface TranscriptLine { role: "user" | "assistant"; text: string }

/** One call: VAD, transcription, the reply read out, and barge-in. Transport-free, so tests drive it directly. */
export class VoiceSession {
  readonly vad = new Vad({ sampleRate: SAMPLE_RATE });
  readonly transcript: TranscriptLine[] = [];
  /** Bumped by each barge-in: speech prepared for an older epoch is dropped. */
  epoch = 0;
  muted = false;
  /** Audio sent to the browser and not yet reported as played. */
  private unplayed = new Set<number>();
  private ttsQueue: Promise<void> = Promise.resolve();
  private ttsPending = 0;
  private audioId = 0;
  /** Per assistant row: how much of its text was already handled, and rows cut off by a barge-in (never read further). */
  private cursor = new Map<number, number>();
  private silenced = new Set<number>();
  private buffers = new Map<number, string>();
  /** The user said something and the bot's answer to it has not finished being read out. */
  private awaitingReply = false;
  private partialTimer: ReturnType<typeof setInterval> | null = null;
  private partialBusy = false;
  closed = false;
  bargeIns = 0;

  constructor(private d: SessionDeps) {}

  /** The bot is talking (audio queued or playing). */
  get speaking() { return this.unplayed.size > 0 || this.ttsPending > 0; }

  private json(o: Record<string, unknown>) { if (!this.closed) this.d.send(JSON.stringify(o)); }

  onAudio(pcm: Int16Array) {
    if (this.closed || this.muted) return;
    // While the bot talks, the user must speak longer to cut it off (its own echo, a cough).
    this.vad.setStartMs(this.speaking ? this.d.bargeIn.minSpeechMs : 100);
    for (const e of this.vad.push(pcm)) {
      if (e.type === "start") {
        this.json({ type: "vad", speaking: true });
        if (this.d.bargeIn.enabled && (this.speaking || (this.awaitingReply && this.d.botBusy()))) this.bargeIn();
        this.startPartials();
      } else {
        this.stopPartials();
        this.json({ type: "vad", speaking: false });
        if (e.ms >= MIN_UTTERANCE_MS) void this.transcribe(e.audio);
      }
    }
  }

  /** The user cut the bot off (by voice, or with the Interrupt button). */
  bargeIn() {
    this.epoch++;
    this.bargeIns++;
    this.cut.abort();
    this.cut = new AbortController();
    this.unplayed.clear();
    for (const seq of this.cursor.keys()) this.silenced.add(seq);
    this.json({ type: "barge_in" });
    if (this.d.botBusy()) this.d.interrupt();
    this.awaitingReply = false;
  }

  played(id: number) { this.unplayed.delete(id); }

  setMuted(on: boolean) {
    this.muted = on;
    if (on) { this.vad.flush(); this.stopPartials(); }
  }

  private startPartials() {
    if (!this.d.partials || this.partialTimer) return;
    this.partialTimer = setInterval(() => {
      if (this.partialBusy || !this.vad.isSpeaking) return;
      const audio = this.vad.current();
      if (audio.length < SAMPLE_RATE * 0.8) return;
      this.partialBusy = true;
      this.d.stt(wavOf(audio, SAMPLE_RATE)).then((text) => { if (text && this.vad.isSpeaking) this.json({ type: "partial", text }); }, () => {}).finally(() => { this.partialBusy = false; });
    }, 1000);
  }
  private stopPartials() { if (this.partialTimer) clearInterval(this.partialTimer); this.partialTimer = null; }

  private async transcribe(audio: Int16Array) {
    let text = "";
    try { text = (await this.d.stt(wavOf(audio, SAMPLE_RATE))).trim(); } catch (err) { this.json({ type: "error", message: `speech-to-text: ${(err as Error).message}` }); return; }
    // Whisper's usual hallucinations on silence or noise are not words.
    if (!text || /^\[?(blank_audio|silence|music|musique|inaudible)\]?$/i.test(text) || /^[\s.…,!?-]*$/.test(text)) return;
    if (this.closed) return;
    this.transcript.push({ role: "user", text });
    this.json({ type: "final", text });
    this.awaitingReply = true;
    this.d.submit(text);
  }

  /** A bot reply row was written or grew. Complete sentences go to speech as they appear. */
  botText(seq: number, text: string, streaming: boolean) {
    if (this.closed || this.silenced.has(seq)) return;
    const done = this.cursor.get(seq) ?? 0;
    if (text.length < done) return;
    const fresh = (this.buffers.get(seq) ?? "") + text.slice(done);
    this.cursor.set(seq, text.length);
    const { sentences, rest } = takeSentences(fresh, !streaming);
    this.buffers.set(seq, rest);
    for (const s of sentences) {
      const say = speakableText(s);
      if (say) this.speak(say);
    }
    if (!streaming) { this.buffers.delete(seq); this.silenced.add(seq); this.cursor.delete(seq); }
  }

  /**
   * Sentences are synthesized ahead (up to PREFETCH at once, so the next one is ready when the current one ends — no gap
   * while the speech service works) and sent strictly in order. A barge-in (new epoch) drops every one not yet sent.
   */
  private prefetching = 0;
  private cut = new AbortController();
  private waiting: (() => void)[] = [];
  private slot(): Promise<void> {
    if (this.prefetching < PREFETCH) { this.prefetching++; return Promise.resolve(); }
    return new Promise((r) => this.waiting.push(() => { this.prefetching++; r(); }));
  }
  private release() { this.prefetching--; this.waiting.shift()?.(); }

  private speak(text: string) {
    const epoch = this.epoch;
    this.ttsPending++;
    const audio: Promise<Buffer | null> = this.slot().then(async () => {
      // Cancelled with its epoch (barge-in, hang-up): a sentence nobody will hear is not paid for to the end.
      try { return epoch !== this.epoch || this.closed ? null : await this.d.tts(text, AbortSignal.any([this.cut.signal, AbortSignal.timeout(30_000)])); } finally { this.release(); }
    });
    audio.catch(() => {}); // handled in order below
    this.ttsQueue = this.ttsQueue.then(async () => {
      try {
        if (epoch !== this.epoch || this.closed) return;
        const wav = await audio;
        if (!wav || epoch !== this.epoch || this.closed) return;
        const id = ++this.audioId;
        this.unplayed.add(id);
        const last = this.transcript[this.transcript.length - 1];
        if (last?.role === "assistant") last.text = `${last.text} ${text}`; else this.transcript.push({ role: "assistant", text });
        this.json({ type: "audio", id, text, mime: "audio/wav", ms: wavDurationMs(wav) });
        this.d.send(wav);
      } catch (err) {
        if (epoch !== this.epoch || this.closed) return; // cancelled by a barge-in or the hang-up: not an error
        this.json({ type: "error", message: `text-to-speech: ${(err as Error).message}` });
      } finally { this.ttsPending--; }
    });
  }

  /** Resolves once every sentence queued so far has been turned into audio (tests). */
  idle() { return this.ttsQueue; }

  close() {
    this.closed = true;
    this.cut.abort();
    this.stopPartials();
    this.unplayed.clear();
  }
}

// ── The WebSocket ───────────────────────────────────────────────────────────
const wss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024 });
const refuse = (socket: Duplex, code: number, text: string) => { socket.end(`HTTP/1.1 ${code} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); };

/** Upgrade route for `/api/voice/:botId` (registered with the server's single upgrade listener). */
export function voiceUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const m = VOICE_PATH.exec(new URL(req.url ?? "/", "http://local").pathname);
  if (!m) return false;
  if (!originAllowed(req.headers.origin, req.headers.host)) { refuse(socket, 403, "Forbidden"); return true; }
  const user = userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
  if (!user) { refuse(socket, 401, "Unauthorized"); return true; }
  if (emailGateBlocks(user.id)) { refuse(socket, 403, "Forbidden"); return true; }
  // The owner, or someone of the workspace whose role lets them talk to this bot (wave 6).
  const access = botAccess(user.id, m[1]);
  if (!access || !access.canTalk || access.bot.kind !== "agent") { refuse(socket, 404, "Not Found"); return true; }
  if (voiceStatus(access.bot.userId, access.bot.id).mode !== "server") { refuse(socket, 409, "Conflict"); return true; }
  wss.handleUpgrade(req, socket, head, (ws) => runCall(ws, access.bot, user, access.owner ? null : { role: access.role!, workspace: access.share!.workspaceName }));
  return true;
}

function runCall(ws: WebSocket, bot: BotRecord, user: UserRecord, member: { role: string; workspace: string } | null) {
  // The services and settings are the bot owner's: they pay for them and chose them.
  const settings = voiceSettings(bot.userId);
  let stt: Stt | null = null;
  let tts: Tts | null = null;
  let session: VoiceSession | null = null;
  let callId = "";
  const startSeq = (bots.byId(bot.id)?.nextSeq ?? 1) - 1;
  let frames = 0;
  let windowAt = Date.now();
  const send = (data: string | Buffer) => { if (ws.readyState === ws.OPEN) ws.send(data); };
  const off = subscribe(user.id, (e) => {
    if (!session || e.type !== "rows" || e.botId !== bot.id) return;
    for (const r of e.rows) {
      if (r.seq <= startSeq || (r.thread ?? 0) !== 0 || r.body.kind !== "message" || r.body.role !== "assistant") continue;
      session.botText(r.seq, r.body.text, !!r.body.streaming);
    }
  });
  const limit = setTimeout(() => ws.close(4000, "call too long"), MAX_CALL_MS);
  const finish = () => {
    clearTimeout(limit);
    off();
    session?.close();
    const fresh = bots.byId(bot.id);
    if (callId && fresh) callEnded(fresh, callId, session?.transcript ?? [], user.locale);
    callId = "";
  };
  ws.on("close", finish);
  ws.on("error", () => ws.terminate());
  ws.on("message", (data, isBinary) => {
    // Flood guard: 16 kHz audio comes in about 50 frames a second (20 ms each); far more is a flood.
    frames++;
    if (Date.now() - windowAt > 1000) { windowAt = Date.now(); frames = 0; }
    if (frames > 400) { ws.close(4008, "too fast"); return; }
    if (isBinary) {
      if (!session) return;
      const buf = data as Buffer;
      if (buf.length % 2 || buf.length > 32 * 1024) return;
      session.onAudio(new Int16Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.length)));
      return;
    }
    let msg: Record<string, unknown>;
    try { msg = JSON.parse(String(data)); } catch { ws.close(4400, "bad message"); return; }
    if (msg.type === "hello" && !session) {
      if (Number(msg.sampleRate) !== SAMPLE_RATE) { ws.close(4400, "16 kHz PCM only"); return; }
      stt = sttFor(bot.userId, typeof msg.lang === "string" ? msg.lang : undefined);
      // The bot speaks with its own voice when it has one (voice/botvoice.ts), else the account's.
      tts = ttsFor(bot.userId, { botId: bot.id });
      if (!stt || !tts) { ws.close(4409, "voice services unavailable"); return; }
      const current = bots.byId(bot.id)!;
      session = new VoiceSession({
        send, stt, tts, partials: settings.stt.provider === "whisper-cpp", bargeIn: settings.bargeIn,
        submit: (said) => {
          const b = bots.byId(bot.id);
          if (!b) return;
          // A secret spoken aloud (a password read out) is masked like a typed one; only the owner is offered the vault.
          const screened = screenSecrets(said, user.locale);
          const text = screened.text;
          if (member) {
            rows.append(b, { kind: "message", role: "user", text, origin: { kind: "member", id: user.id, name: user.name } });
            submitMemberMessage(b, text, { id: user.id, name: user.name, role: member.role, workspace: member.workspace }, true);
          } else {
            rows.append(b, { kind: "message", role: "user", text, origin: { kind: "voice", id: "", name: "Voice" } });
            if (screened.secrets.length) holdAndOffer(b, user.id, screened.secrets);
            submitUserMessage(b, text, true);
          }
        },
        interrupt: () => interrupt(bot.id),
        botBusy: () => getLive(bot.id).running,
      });
      callId = callStarted(current, user.locale);
      send(JSON.stringify({ type: "ready", callId, stt: settings.stt.provider, tts: voiceStatus(bot.userId, bot.id).tts ?? settings.tts.provider }));
      return;
    }
    if (!session) return;
    if (msg.type === "played") session.played(Number(msg.id));
    else if (msg.type === "interrupt") session.bargeIn();
    else if (msg.type === "mute") session.setMuted(msg.on === true);
    else if (msg.type === "bye") ws.close(1000, "bye");
  });
}
