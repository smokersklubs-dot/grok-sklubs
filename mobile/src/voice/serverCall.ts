/**
 * A call through the server's voice services (same protocol as web/src/lib/voice.ts; server/src/voice/session.ts):
 *  app → server  text {"type":"hello","sampleRate":16000,"lang"} then binary 16 kHz Int16 LE frames (20 ms);
 *                text {"type":"played","id"} · {"type":"interrupt"} · {"type":"mute","on"} · {"type":"bye"}
 *  server → app  text ready · vad · partial · final · barge_in · error · audio (then one binary message: the WAV)
 * Auth: the session cookie in the WebSocket's headers (React Native's WebSocket takes `headers`, and adds the URL's own
 * origin as Origin, which the server accepts: node_modules/react-native/Libraries/WebSocket/WebSocket.js and
 * ReactAndroid/.../websocket/WebSocketModule.kt). On top of the web: a dropped connection is retried (1, 2, 4, 8, 15 s).
 * No React, no native code here: unit-tested with fakes.
 */
import { fromBase64, toBase64 } from "../lib/screen";
import { cutLast, handshakeStatus, reconnectDelay, withAssistantSentence, withFinal, withPartial, type CallLine } from "./text";

export interface WsLike {
  binaryType: string;
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: unknown }) => void) | null;
  onerror: ((e: { message?: string }) => void) | null;
  onclose: ((e: { code: number; reason?: string }) => void) | null;
  send(data: string | ArrayBuffer): void;
  close(code?: number, reason?: string): void;
}

/** The audio side (the native module, or a fake in tests). */
export interface AudioPort {
  startCapture(): boolean;
  stopCapture(): void;
  play(id: number, wavBase64: string): void;
  stopPlayback(): void;
  setVolume(v: number): void;
  onPcm(fn: (data: string, level: number) => void): () => void;
  onPlayed(fn: (id: number) => void): () => void;
}

export type CallStatus = "connecting" | "live" | "reconnecting" | "error";
export interface CallPatch { status?: CallStatus; error?: string | null; hearing?: boolean; speaking?: boolean; listening?: boolean; providers?: string; bargedAt?: number; startedAt?: number }

export interface ServerCallDeps {
  connect(): WsLike;
  audio: AudioPort;
  lang: string;
  patch(p: CallPatch): void;
  lines(fn: (l: CallLine[]) => CallLine[]): void;
  toast(message: string): void;
  /** Why it failed, in the user's words: "unavailable" (no voice service: the app may fall back), "ended", "session". */
  failed(reason: "unavailable" | "ended" | "session"): void;
  muted(): boolean;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

const OPEN = 1;

export class ServerCall {
  private ws: WsLike | null = null;
  private expect: { id: number; text: string } | null = null;
  private playing = new Set<number>();
  private loud = 0;
  private quiet = 0;
  private ducked = false;
  private closed = false;
  private attempt = 0;
  private everReady = false;
  private retryTimer: unknown = null;
  private offs: (() => void)[] = [];
  private lastError: string | undefined;

  constructor(private d: ServerCallDeps) {}

  start(): boolean {
    if (!this.d.audio.startCapture()) return false;
    this.offs.push(this.d.audio.onPcm((data, level) => this.onPcm(data, level)));
    this.offs.push(this.d.audio.onPlayed((id) => this.onPlayed(id)));
    this.open();
    return true;
  }

  private open() {
    this.d.patch({ status: this.everReady ? "reconnecting" : "connecting" });
    const ws = this.d.connect();
    ws.binaryType = "arraybuffer";
    this.ws = ws;
    this.lastError = undefined;
    ws.onopen = () => ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang: this.d.lang }));
    ws.onmessage = (e) => { if (this.ws === ws) this.onMessage(e.data); };
    ws.onerror = (e) => { this.lastError = e?.message; };
    ws.onclose = (e) => { if (this.ws === ws) this.onClose(e.code); };
  }

  private onPcm(data: string, level: number) {
    if (this.closed || this.d.muted()) return;
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(fromBase64(data).buffer as ArrayBuffer);
    // Instant duck: the user's voice over the bot's lowers it at once; the server decides whether it is a barge-in.
    const isLoud = level > 0.04;
    this.loud = isLoud ? this.loud + 1 : 0;
    this.quiet = isLoud ? 0 : this.quiet + 1;
    if (this.playing.size && this.loud >= 4 && !this.ducked) { this.ducked = true; this.d.audio.setVolume(0.15); }
    if (this.ducked && this.quiet >= 30) { this.ducked = false; this.d.audio.setVolume(1); }
  }

  private onPlayed(id: number) {
    if (!this.playing.delete(id)) return;
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify({ type: "played", id }));
    if (!this.playing.size) this.d.patch({ speaking: false });
  }

  private onMessage(data: unknown) {
    if (this.closed) return;
    if (typeof data !== "string") {
      const head = this.expect;
      this.expect = null;
      if (!head || !(data instanceof ArrayBuffer)) return;
      this.playing.add(head.id);
      this.d.audio.play(head.id, toBase64(new Uint8Array(data)));
      this.d.patch({ speaking: true });
      return;
    }
    let m: Record<string, unknown>;
    try { m = JSON.parse(data) as Record<string, unknown>; } catch { return; }
    switch (m.type) {
      case "ready":
        this.everReady = true;
        this.attempt = 0;
        this.d.patch({ status: "live", listening: true, error: null, providers: `${m.stt} · ${m.tts}` });
        break;
      case "vad": this.d.patch({ hearing: !!m.speaking }); break;
      case "partial": this.d.lines((l) => withPartial(l, String(m.text))); break;
      case "final": this.d.lines((l) => withFinal(l, "user", String(m.text))); break;
      case "audio":
        this.expect = { id: Number(m.id), text: String(m.text) };
        this.d.lines((l) => withAssistantSentence(l, String(m.text)));
        break;
      case "barge_in":
        this.stopAll();
        this.d.lines(cutLast);
        this.d.patch({ bargedAt: Date.now() });
        break;
      case "error": this.d.toast(String(m.message)); break;
    }
  }

  private onClose(code: number) {
    this.ws = null;
    if (this.closed) return;
    this.stopAll();
    const status = handshakeStatus(this.lastError);
    // Refusals that a retry cannot fix: no voice service (409 / 4409), no session, not allowed, bad audio format.
    if (code === 4409 || status === 409) { this.finish(); this.d.failed("unavailable"); return; }
    if (status === 401) { this.finish(); this.d.failed("session"); return; }
    if (status === 403 || status === 404 || code === 4400 || code === 4008 || code === 4000 || code === 1000) { this.finish(); this.d.failed("ended"); return; }
    const delay = reconnectDelay(this.attempt++);
    if (delay === null) { this.finish(); this.d.failed("ended"); return; }
    this.d.patch({ status: "reconnecting", hearing: false, speaking: false });
    const set = this.d.setTimer ?? ((fn: () => void, ms: number) => setTimeout(fn, ms));
    this.retryTimer = set(() => { this.retryTimer = null; if (!this.closed) this.open(); }, delay);
  }

  private stopAll() {
    this.playing.clear();
    this.expect = null;
    this.d.audio.stopPlayback();
    if (this.ducked) { this.ducked = false; this.d.audio.setVolume(1); }
    this.d.patch({ speaking: false });
  }

  /** The Interrupt button: same as speaking over the bot. */
  bargeIn() {
    this.stopAll();
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify({ type: "interrupt" }));
  }

  mute(on: boolean) {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify({ type: "mute", on }));
  }

  private finish() {
    this.closed = true;
    if (this.retryTimer !== null) (this.d.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.retryTimer);
    this.retryTimer = null;
    for (const off of this.offs) off();
    this.offs = [];
    this.d.audio.stopCapture();
    this.d.audio.stopPlayback();
  }

  /** Hang up: "bye", a normal close, nothing more is sent or played. */
  stop() {
    if (this.closed) return;
    const ws = this.ws;
    this.ws = null;
    this.finish();
    if (ws && ws.readyState === OPEN) { ws.send(JSON.stringify({ type: "bye" })); ws.close(1000, "bye"); }
    else ws?.close();
  }
}
