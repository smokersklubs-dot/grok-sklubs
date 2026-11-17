/**
 * Server-mediated voice calls (wave 6). The microphone goes to the server as 16 kHz PCM over a WebSocket (captured by
 * public/voice-worklet.js); the server detects speech, transcribes it, posts it to the bot and sends the reply back as
 * audio, sentence by sentence. Barge-in: as soon as the user speaks over the bot, its voice is ducked here at once, and
 * stopped for good when the server confirms (`barge_in`) — the server also cancels the bot's generation.
 * Protocol: server/src/voice/session.ts and docs/API.md.
 */
import { t } from "../i18n";
import { useStore, type CallLine, type CallState } from "../store";
import { voiceStarted, voiceStopped } from "./voiceLevel";

interface Conn {
  botId: string;
  ws: WebSocket;
  ctx: AudioContext;
  stream: MediaStream;
  node: AudioWorkletNode;
  gain: GainNode;
  sources: Map<number, AudioBufferSourceNode>;
  /** The next audio header waiting for its binary WAV. */
  expect: { id: number; text: string } | null;
  playAt: number;
  loudFrames: number;
  quietFrames: number;
  ducked: boolean;
  closed: boolean;
}

let conn: Conn | null = null;
let lineId = 100_000;
/**
 * An AudioContext made and resumed INSIDE the click that starts the call. Phones (iOS Safari, Chrome on Android) keep a
 * context created later — after the network round-trips — suspended: the bot's voice would stay silent and, on iOS,
 * the microphone would send nothing. startServerCall takes it over; dropPrimedAudio releases it when the call goes
 * through the browser's own speech instead.
 */
let primed: AudioContext | null = null;
export function primeCallAudio(): void {
  dropPrimedAudio();
  if (typeof AudioContext === "undefined") return;
  try { primed = new AudioContext(); void primed.resume().catch(() => undefined); } catch { primed = null; }
}
export function dropPrimedAudio(): void {
  const p = primed;
  primed = null;
  if (p && p.state !== "closed") void p.close().catch(() => undefined);
}

const getCall = (): CallState | null => useStore.getState().call;
function patch(p: Partial<CallState>): void {
  useStore.setState((s) => (s.call ? { call: { ...s.call, ...p } } : {}));
}
function setLines(fn: (lines: CallLine[]) => CallLine[]): void {
  useStore.setState((s) => (s.call ? { call: { ...s.call, lines: fn(s.call.lines) } } : {}));
}

export const serverCallActive = () => !!conn && !conn.closed;

function stopAll(c: Conn): void {
  for (const s of c.sources.values()) {
    try { s.stop(); } catch { /* already ended */ }
  }
  c.sources.clear();
  c.playAt = 0;
  c.gain.gain.setValueAtTime(1, c.ctx.currentTime);
  c.ducked = false;
  voiceStopped();
  patch({ speaking: false });
}

/**
 * Opens a call through the server. Resolves false when it cannot (the caller falls back to the browser's speech).
 * `onEarlyFail`: the connection closed before the call was ready (the server's voice stopped answering in between);
 * returns true when the caller took over (the browser's own speech), else the call bar shows the error.
 */
export async function startServerCall(botId: string, lang: string, onEarlyFail?: () => boolean): Promise<boolean> {
  let stream: MediaStream;
  try {
    // Echo cancellation keeps the bot's own voice out of the microphone (otherwise it would cut itself off).
    stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 } });
  } catch {
    dropPrimedAudio();
    patch({ status: "error", error: t("call.micDenied") });
    return true;
  }
  const ctx = primed && primed.state !== "closed" ? primed : new AudioContext();
  primed = null;
  await ctx.resume().catch(() => undefined);
  try {
    await ctx.audioWorklet.addModule("/voice-worklet.js");
  } catch {
    stream.getTracks().forEach((tr) => tr.stop());
    void ctx.close();
    return false;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  const ws = new WebSocket(`${proto}//${location.host}/api/voice/${encodeURIComponent(botId)}`);
  ws.binaryType = "arraybuffer";
  const source = ctx.createMediaStreamSource(stream);
  const node = new AudioWorkletNode(ctx, "sklubot-capture");
  const gain = ctx.createGain();
  gain.connect(ctx.destination);
  // Anti-aliasing before the worklet brings the microphone down to 16 kHz: two 7 kHz low-pass filters (24 dB/octave),
  // so the voice reaches speech-to-text clean instead of with folded-back hiss. BiquadFilterNode: Web Audio API.
  const lp1 = ctx.createBiquadFilter();
  const lp2 = ctx.createBiquadFilter();
  for (const f of [lp1, lp2]) { f.type = "lowpass"; f.frequency.value = 7000; f.Q.value = 0.707; }
  source.connect(lp1);
  lp1.connect(lp2);
  lp2.connect(node);
  // Some engines (WebKit) only run a node that leads to the speakers: the capture node gets a silent path there.
  const sink = ctx.createGain();
  sink.gain.value = 0;
  node.connect(sink);
  sink.connect(ctx.destination);
  const c: Conn = { botId, ws, ctx, stream, node, gain, sources: new Map(), expect: null, playAt: 0, loudFrames: 0, quietFrames: 0, ducked: false, closed: false };
  conn = c;
  patch({ pipeline: "server" });

  node.port.onmessage = (e: MessageEvent<{ pcm: ArrayBuffer; level: number }>) => {
    if (c.closed) return;
    const call = getCall();
    if (call?.muted) return;
    if (ws.readyState === WebSocket.OPEN) ws.send(e.data.pcm);
    // Instant duck: the user's voice over the bot's lowers it right away; the server decides whether it is a barge-in.
    const loud = e.data.level > 0.04;
    c.loudFrames = loud ? c.loudFrames + 1 : 0;
    c.quietFrames = loud ? 0 : c.quietFrames + 1;
    if (c.sources.size && c.loudFrames >= 4 && !c.ducked) { c.ducked = true; c.gain.gain.setTargetAtTime(0.15, ctx.currentTime, 0.02); }
    if (c.ducked && c.quietFrames >= 30) { c.ducked = false; c.gain.gain.setTargetAtTime(1, ctx.currentTime, 0.05); }
  };

  let ready = false;
  ws.onopen = () => ws.send(JSON.stringify({ type: "hello", sampleRate: 16000, lang }));
  ws.onmessage = (e) => {
    if (c.closed) return;
    if (typeof e.data !== "string") {
      const head = c.expect;
      c.expect = null;
      if (head) void play(c, head.id, e.data as ArrayBuffer);
      return;
    }
    const m = JSON.parse(e.data) as Record<string, any>;
    if (m.type === "ready") { ready = true; patch({ status: "live", listening: true, startedAt: getCall()?.startedAt ?? Date.now(), providers: m.voice ? String(m.voice) : `${m.stt} · ${m.tts}` }); }
    else if (m.type === "vad") patch({ hearing: !!m.speaking });
    else if (m.type === "partial") setLines((lines) => [...lines.filter((l) => l.final), { id: ++lineId, role: "user", text: String(m.text), final: false }]);
    else if (m.type === "final") setLines((lines) => [...lines.filter((l) => l.final), { id: ++lineId, role: "user", text: String(m.text), final: true }]);
    else if (m.type === "audio") {
      c.expect = { id: Number(m.id), text: String(m.text) };
      setLines((lines) => {
        const finals = lines.filter((l) => l.final);
        const last = finals[finals.length - 1];
        // Sentences of the same reply join one caption line.
        if (last?.role === "assistant" && !last.cut) return [...finals.slice(0, -1), { ...last, text: `${last.text} ${m.text}` }];
        return [...finals, { id: ++lineId, role: "assistant", text: String(m.text), final: true }];
      });
    } else if (m.type === "barge_in") {
      stopAll(c);
      setLines((lines) => lines.map((l, i) => (i === lines.length - 1 && l.role === "assistant" ? { ...l, cut: true } : l)));
      patch({ bargedAt: Date.now() });
    } else if (m.type === "error") useStore.getState().showToast(String(m.message));
  };
  ws.onclose = (e) => {
    if (c.closed) return;
    teardown(c);
    if (e.code === 1000) return;
    if (!ready && onEarlyFail?.()) return;
    patch({ status: "error", error: e.code === 4409 || e.code === 1006 ? t("call.serverUnavailable") : t("call.ended"), listening: false, speaking: false });
  };
  return true;
}

async function play(c: Conn, id: number, data: ArrayBuffer): Promise<void> {
  let buf: AudioBuffer;
  try {
    buf = await c.ctx.decodeAudioData(data);
  } catch {
    c.ws.send(JSON.stringify({ type: "played", id }));
    return;
  }
  if (c.closed) return;
  const src = c.ctx.createBufferSource();
  src.buffer = buf;
  src.connect(c.gain);
  const at = Math.max(c.ctx.currentTime + 0.02, c.playAt);
  c.playAt = at + buf.duration;
  c.sources.set(id, src);
  src.onended = () => {
    c.sources.delete(id);
    if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "played", id }));
    if (!c.sources.size) { voiceStopped(); patch({ speaking: false }); }
  };
  src.start(at);
  voiceStarted();
  patch({ speaking: true });
}

/** The Interrupt button: same as speaking over the bot. */
export function serverBargeIn(): void {
  const c = conn;
  if (!c || c.closed) return;
  stopAll(c);
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "interrupt" }));
}

export function serverMute(on: boolean): void {
  const c = conn;
  if (!c || c.closed) return;
  if (c.ws.readyState === WebSocket.OPEN) c.ws.send(JSON.stringify({ type: "mute", on }));
}

function teardown(c: Conn): void {
  c.closed = true;
  stopAll(c);
  c.node.port.onmessage = null;
  try { c.node.disconnect(); } catch { /* */ }
  c.stream.getTracks().forEach((tr) => tr.stop());
  void c.ctx.close().catch(() => undefined);
  if (conn === c) conn = null;
}

export function endServerCall(): void {
  const c = conn;
  if (!c) return;
  if (c.ws.readyState === WebSocket.OPEN) { c.ws.send(JSON.stringify({ type: "bye" })); c.ws.close(1000, "bye"); }
  teardown(c);
}
