import type { Row } from "../src/api/types";
import { setLocale } from "../src/i18n";
import { fromBase64, toBase64 } from "../src/lib/screen";
import type { Thread } from "../src/state/reducers";
import { DeviceCall, type DeviceCallDeps } from "../src/voice/deviceCall";
import { ServerCall, type CallPatch, type ServerCallDeps, type WsLike } from "../src/voice/serverCall";
import { cutLast, handshakeStatus, reconnectDelay, recognitionLang, speakable, transcriptOf, withAssistantSentence, withFinal, withPartial, type CallLine } from "../src/voice/text";

setLocale("fr");

class FakeWs implements WsLike {
  binaryType = "blob";
  readyState = 0;
  sent: (string | ArrayBuffer)[] = [];
  closedWith: number | null = null;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onerror: ((e: { message?: string }) => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  send(d: string | ArrayBuffer) { this.sent.push(d); }
  close(code?: number) { this.closedWith = code ?? 1005; this.readyState = 3; }
  open() { this.readyState = 1; this.onopen?.(); }
  msg(m: unknown) { this.onmessage?.({ data: typeof m === "string" || m instanceof ArrayBuffer ? m : JSON.stringify(m) }); }
  drop(code = 1006, message?: string) { if (message) this.onerror?.({ message }); this.readyState = 3; this.onclose?.({ code }); }
  json() { return this.sent.filter((s): s is string => typeof s === "string").map((s) => JSON.parse(s)); }
}

function serverSetup(over: Partial<ServerCallDeps> = {}) {
  const sockets: FakeWs[] = [];
  const state: CallPatch = {};
  let lines: CallLine[] = [];
  const audio = {
    capturing: false, played: [] as [number, string][], stops: 0, volume: 1,
    pcm: null as null | ((d: string, l: number) => void), done: null as null | ((id: number) => void),
    startCapture() { this.capturing = true; return true; }, stopCapture() { this.capturing = false; },
    play(id: number, b: string) { this.played.push([id, b]); }, stopPlayback() { this.stops++; }, setVolume(v: number) { this.volume = v; },
    onPcm(fn: (d: string, l: number) => void) { this.pcm = fn; return () => { this.pcm = null; }; },
    onPlayed(fn: (id: number) => void) { this.done = fn; return () => { this.done = null; }; },
  };
  const timers: (() => void)[] = [];
  const failures: string[] = [];
  let muted = false;
  const call = new ServerCall({
    connect: () => { const w = new FakeWs(); sockets.push(w); return w; },
    audio, lang: "fr-FR",
    patch: (p) => Object.assign(state, p),
    lines: (fn) => { lines = fn(lines); },
    toast: () => undefined,
    failed: (r) => failures.push(r),
    muted: () => muted,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => undefined,
    ...over,
  });
  return { call, sockets, state, audio, timers, failures, getLines: () => lines, setMuted: (m: boolean) => { muted = m; } };
}

describe("server voice call (same protocol as the web)", () => {
  it("says hello at 16 kHz, streams the microphone, plays and acknowledges the replies", () => {
    const s = serverSetup();
    expect(s.call.start()).toBe(true);
    const ws = s.sockets[0];
    expect(ws.binaryType).toBe("arraybuffer");
    expect(s.state.status).toBe("connecting");
    ws.open();
    expect(ws.json()[0]).toEqual({ type: "hello", sampleRate: 16000, lang: "fr-FR" });
    ws.msg({ type: "ready", callId: "c", stt: "whisper-cpp", tts: "piper" });
    expect(s.state).toMatchObject({ status: "live", listening: true, providers: "whisper-cpp · piper" });
    const frame = new Uint8Array(640).map((_, i) => i & 255);
    s.audio.pcm!(toBase64(frame), 0.01);
    const bin = ws.sent.find((x) => x instanceof ArrayBuffer) as ArrayBuffer;
    expect(Array.from(new Uint8Array(bin))).toEqual(Array.from(frame));
    ws.msg({ type: "final", text: "Bonjour" });
    ws.msg({ type: "audio", id: 1, text: "Salut.", mime: "audio/wav", ms: 500 });
    const wav = new Uint8Array([82, 73, 70, 70, 1, 2, 3]);
    ws.msg(wav.buffer);
    ws.msg({ type: "audio", id: 2, text: "Ça va ?", mime: "audio/wav", ms: 500 });
    ws.msg(new Uint8Array([9]).buffer);
    expect(s.audio.played.map(([id, b]) => [id, Array.from(fromBase64(b))])).toEqual([[1, Array.from(wav)], [2, [9]]]);
    expect(s.state.speaking).toBe(true);
    expect(s.getLines().map((l) => [l.role, l.text])).toEqual([["user", "Bonjour"], ["assistant", "Salut. Ça va ?"]]);
    s.audio.done!(1);
    expect(s.state.speaking).toBe(true);
    s.audio.done!(2);
    expect(s.state.speaking).toBe(false);
    expect(ws.json().filter((m) => m.type === "played")).toEqual([{ type: "played", id: 1 }, { type: "played", id: 2 }]);
  });

  it("ducks the bot when the user speaks over it, stops on barge-in, and interrupts on demand", () => {
    const s = serverSetup();
    s.call.start();
    const ws = s.sockets[0];
    ws.open();
    ws.msg({ type: "ready", stt: "a", tts: "b" });
    ws.msg({ type: "audio", id: 1, text: "Long", mime: "audio/wav", ms: 900 });
    ws.msg(new Uint8Array([1]).buffer);
    for (let i = 0; i < 4; i++) s.audio.pcm!(toBase64(new Uint8Array(640)), 0.2);
    expect(s.audio.volume).toBe(0.15);
    ws.msg({ type: "barge_in" });
    expect(s.audio.stops).toBe(1);
    expect(s.audio.volume).toBe(1);
    expect(s.getLines()[0].cut).toBe(true);
    s.call.bargeIn();
    expect(ws.json().some((m) => m.type === "interrupt")).toBe(true);
  });

  it("sends nothing while muted, and tells the server", () => {
    const s = serverSetup();
    s.call.start();
    const ws = s.sockets[0];
    ws.open();
    s.setMuted(true);
    s.call.mute(true);
    s.audio.pcm!(toBase64(new Uint8Array(640)), 0.5);
    expect(ws.sent.some((x) => x instanceof ArrayBuffer)).toBe(false);
    expect(ws.json()).toContainEqual({ type: "mute", on: true });
  });

  it("reconnects a dropped call, then gives up after five tries", () => {
    const s = serverSetup();
    s.call.start();
    s.sockets[0].open();
    s.sockets[0].msg({ type: "ready", stt: "a", tts: "b" });
    s.sockets[0].drop(1006);
    expect(s.state.status).toBe("reconnecting");
    expect(s.timers).toHaveLength(1);
    s.timers[0]();
    expect(s.sockets).toHaveLength(2);
    s.sockets[1].open();
    expect(s.sockets[1].json()[0].type).toBe("hello");
    s.sockets[1].msg({ type: "ready", stt: "a", tts: "b" });
    expect(s.state.status).toBe("live");
    for (let i = 0; i < 6; i++) { s.sockets[s.sockets.length - 1].drop(1006); s.timers[s.timers.length - 1]?.(); }
    expect(s.failures).toEqual(["ended"]);
    expect(s.audio.capturing).toBe(false);
  });

  it("does not retry refusals: no voice service, no session", () => {
    const a = serverSetup();
    a.call.start();
    a.sockets[0].drop(1006, "Expected HTTP 101 response but was '409 Conflict'");
    expect(a.failures).toEqual(["unavailable"]);
    expect(a.timers).toHaveLength(0);
    const b = serverSetup();
    b.call.start();
    b.sockets[0].open();
    b.sockets[0].drop(4409);
    expect(b.failures).toEqual(["unavailable"]);
    const c = serverSetup();
    c.call.start();
    c.sockets[0].drop(1006, "Expected HTTP 101 response but was '401 Unauthorized'");
    expect(c.failures).toEqual(["session"]);
  });

  it("hangs up with bye and a normal close", () => {
    const s = serverSetup();
    s.call.start();
    const ws = s.sockets[0];
    ws.open();
    s.call.stop();
    expect(ws.json().pop()).toEqual({ type: "bye" });
    expect(ws.closedWith).toBe(1000);
    expect(s.audio.capturing).toBe(false);
    expect(s.audio.pcm).toBeNull();
    ws.drop(1000);
    expect(s.failures).toEqual([]);
  });
});

function row(seq: number, role: "user" | "assistant", text: string, streaming = false): Row {
  return { botId: "b", generation: 1, seq, rev: seq, createdAt: seq, body: { kind: "message", role, text, streaming } } as Row;
}

function deviceSetup() {
  let thread: Thread = { generation: 1, rows: [row(1, "assistant", "old reply")], loaded: true, loading: false, loadingEarlier: false, hasMore: false, error: null };
  const listeners = new Set<() => void>();
  const state: CallPatch = {};
  let lines: CallLine[] = [];
  const sent: string[] = [];
  const said: [string, string][] = [];
  const ended: { id: string; transcript: unknown }[] = [];
  const failures: string[] = [];
  const timers: (() => void)[] = [];
  let speech: ((type: string, text: string | null, code: number | null) => void) | null = null;
  let tts: ((type: string, id: string) => void) | null = null;
  let listens = 0;
  let stops = 0;
  let muted = false;
  let seq = 1;
  const deps: DeviceCallDeps = {
    speech: {
      listen: () => { listens++; }, stopListening: () => { stops++; },
      speak: (id, text) => { said.push([id, text]); }, stopSpeaking: () => undefined,
      onSpeech: (fn) => { speech = fn; return () => { speech = null; }; },
      onTts: (fn) => { tts = fn; return () => { tts = null; }; },
    },
    lang: "fr-FR", rate: 1,
    patch: (p) => Object.assign(state, p),
    lines: (fn) => { lines = fn(lines); },
    getLines: () => lines,
    toast: () => undefined,
    failed: (r) => failures.push(r),
    muted: () => muted,
    sendMessage: async (text) => { sent.push(text); const r = row(++seq, "user", text); thread = { ...thread, rows: [...thread.rows, r] }; return r; },
    thread: () => thread,
    subscribe: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
    startRecord: async () => "call1",
    endRecord: async (id, transcript) => { ended.push({ id, transcript }); },
    sendFailed: () => undefined,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => undefined,
  };
  const push = (r: Row) => { thread = { ...thread, rows: [...thread.rows.filter((x) => x.seq !== r.seq), r] }; listeners.forEach((l) => l()); };
  return {
    call: new DeviceCall(deps), state, sent, said, ended, failures, timers, push,
    speech: (t: string, x: string | null = null, c: number | null = null) => speech!(t, x, c),
    tts: (t: string, id: string) => tts!(t, id),
    listens: () => listens, stops: () => stops, lines: () => lines, setMuted: (m: boolean) => { muted = m; }, nextSeq: () => ++seq,
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("device voice call (the phone's own speech, like the web's browser mode)", () => {
  it("sends each utterance as a voice message and reads only the new finished replies, without listening meanwhile", async () => {
    const d = deviceSetup();
    d.call.start();
    expect(d.listens()).toBe(1);
    expect(d.state.status).toBe("live");
    d.speech("partial", "Quel");
    expect(d.lines()).toMatchObject([{ text: "Quel", final: false }]);
    d.speech("final", "Quel temps fait-il ?");
    await flush();
    expect(d.sent).toEqual(["Quel temps fait-il ?"]);
    d.push(row(3, "assistant", "Il fait **beau**", true));
    expect(d.said).toEqual([]);
    d.push(row(3, "assistant", "Il fait **beau** : voir https://meteo.fr"));
    expect(d.said.map((x) => x[1])).toEqual(["Il fait beau : voir lien"]);
    expect(d.state.speaking).toBe(true);
    // The restart planned after the utterance must not listen while the bot talks.
    d.timers.forEach((t) => t());
    const before = d.listens();
    d.tts("done", d.said[0][0]);
    expect(d.state.speaking).toBe(false);
    expect(d.listens()).toBe(before + 1);
    expect(d.lines().map((l) => [l.role, l.text])).toEqual([["user", "Quel temps fait-il ?"], ["assistant", "Il fait beau : voir lien"]]);
  });

  it("keeps listening after silence, stops for a missing permission, gives up after repeated failures", () => {
    const a = deviceSetup();
    a.call.start();
    a.speech("error", null, 7);
    a.timers.pop()!();
    expect(a.listens()).toBe(2);
    a.speech("error", null, 9);
    expect(a.failures).toEqual(["micBlocked"]);
    const b = deviceSetup();
    b.call.start();
    for (let i = 0; i < 7; i++) { b.speech("error", null, 2); b.timers.pop()?.(); }
    expect(b.failures).toEqual(["noSpeech"]);
  });

  it("mutes, barges in, and closes the call record with the captions", async () => {
    const d = deviceSetup();
    d.call.start();
    await flush();
    d.setMuted(true);
    d.call.mute(true);
    expect(d.stops()).toBe(1);
    d.setMuted(false);
    d.call.mute(false);
    d.speech("final", "Raconte");
    await flush();
    d.push(row(d.nextSeq(), "assistant", "Il était une fois."));
    d.push(row(d.nextSeq(), "assistant", "La suite."));
    expect(d.said).toHaveLength(1);
    d.call.bargeIn();
    expect(d.said).toHaveLength(1);
    expect(d.state.speaking).toBe(false);
    d.call.stop();
    await flush();
    expect(d.ended).toEqual([{ id: "call1", transcript: [{ role: "user", text: "Raconte" }, { role: "assistant", text: "Il était une fois." }] }]);
  });
});

describe("call text helpers", () => {
  it("speaks words only", () => {
    expect(speakable("# Titre\n- un `x`\n```js\ncode\n```\n[site](https://a.b)")).toBe("Titre un x (code non lu) site");
  });
  it("picks the recognition language", () => {
    expect(recognitionLang({ name: "", rate: 1, lang: "en-GB" }, "fr")).toBe("en-GB");
    expect(recognitionLang({ name: "", rate: 1, lang: "auto" }, "fr")).toBe("fr-FR");
    expect(recognitionLang(undefined, "en")).toBe("en-US");
  });
  it("builds captions like the web", () => {
    let l: CallLine[] = [];
    l = withPartial(l, "bon");
    l = withFinal(l, "user", "bonjour");
    l = withAssistantSentence(l, "Salut.");
    l = withAssistantSentence(l, "Ça va ?");
    l = cutLast(l);
    l = withAssistantSentence(l, "Oui ?");
    expect(l.map((x) => [x.role, x.text, !!x.cut])).toEqual([["user", "bonjour", false], ["assistant", "Salut. Ça va ?", true], ["assistant", "Oui ?", false]]);
    expect(transcriptOf([...l, { id: 99, role: "user", text: "par", final: false }])).toHaveLength(3);
  });
  it("reads refused handshakes and the retry schedule", () => {
    expect(handshakeStatus("Expected HTTP 101 response but was '409 Conflict'")).toBe(409);
    expect(handshakeStatus("Expected HTTP 101 response but was '401 Unauthorized'")).toBe(401);
    expect(handshakeStatus("Failed to connect to /10.0.2.2:8799")).toBeNull();
    expect(handshakeStatus(undefined)).toBeNull();
    expect([0, 1, 2, 3, 4, 5].map(reconnectDelay)).toEqual([1000, 2000, 4000, 8000, 15000, null]);
  });
});
