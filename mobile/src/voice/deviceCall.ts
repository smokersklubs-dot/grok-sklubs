/**
 * A call with the phone's own speech, for a server without voice services (the web uses the browser's Web Speech
 * then: web/src/lib/call.ts): each finished utterance is sent as a voice message (POST /bots/:id/messages, origin
 * "voice"); the bot's next finished replies are read aloud; the server keeps a record of the call (POST /bots/:id/calls,
 * then /calls/:callId/end with the captions). Listening pauses while the bot speaks, so it does not hear itself.
 * No React, no native code: unit-tested with fakes.
 */
import type { Row } from "../api/types";
import type { Thread } from "../state/reducers";
import type { CallPatch } from "./serverCall";
import { speakable, transcriptOf, withFinal, withPartial, type CallLine } from "./text";

export interface SpeechPort {
  listen(lang: string): void;
  stopListening(): void;
  speak(id: string, text: string, lang: string, rate: number): void;
  stopSpeaking(): void;
  onSpeech(fn: (type: string, text: string | null, code: number | null) => void): () => void;
  onTts(fn: (type: string, id: string) => void): () => void;
}

export interface DeviceCallDeps {
  speech: SpeechPort;
  lang: string;
  rate: number;
  patch(p: CallPatch): void;
  lines(fn: (l: CallLine[]) => CallLine[]): void;
  getLines(): CallLine[];
  toast(message: string): void;
  /** "micBlocked": the recognizer has no microphone permission; "noSpeech": recognition keeps failing. */
  failed(reason: "micBlocked" | "noSpeech"): void;
  muted(): boolean;
  sendMessage(text: string): Promise<Row>;
  thread(): Thread | undefined;
  subscribe(fn: () => void): () => void;
  startRecord(): Promise<string>;
  endRecord(callId: string, transcript: { role: "user" | "assistant"; text: string }[]): Promise<unknown>;
  sendFailed(e: unknown): void;
  setTimer?: (fn: () => void, ms: number) => unknown;
  clearTimer?: (t: unknown) => void;
}

/** android.speech.SpeechRecognizer error codes (https://developer.android.com/reference/android/speech/SpeechRecognizer#constants). */
const ERR = { NETWORK_TIMEOUT: 1, NETWORK: 2, AUDIO: 3, SERVER: 4, CLIENT: 5, SPEECH_TIMEOUT: 6, NO_MATCH: 7, BUSY: 8, PERMISSIONS: 9 } as const;

export class DeviceCall {
  private closed = false;
  private listening = false;
  private speakingNow = false;
  private queue: string[] = [];
  private current: string | null = null;
  private spokenUpTo: number | null = null;
  private generation = -1;
  private failures = 0;
  private ttsId = 0;
  private callId: string | null = null;
  private recordEnded = false;
  private offs: (() => void)[] = [];
  private restart: unknown = null;

  constructor(private d: DeviceCallDeps) {}

  start() {
    this.offs.push(this.d.speech.onSpeech((type, text, code) => this.onSpeech(type, text, code)));
    this.offs.push(this.d.speech.onTts((type, id) => this.onTts(type, id)));
    const th = this.d.thread();
    this.generation = th?.generation ?? -1;
    this.offs.push(this.d.subscribe(() => this.checkReplies()));
    this.d.startRecord().then((id) => { this.callId = id; if (this.recordEnded) this.sendRecordEnd(); }, () => undefined);
    this.d.patch({ status: "live", startedAt: Date.now() });
    this.listen();
  }

  private shouldListen() { return !this.closed && !this.d.muted() && !this.speakingNow; }

  private listen() {
    this.clearRestart();
    if (this.listening || !this.shouldListen()) return;
    this.listening = true;
    this.d.speech.listen(this.d.lang);
    this.d.patch({ listening: true });
  }

  private later(ms: number) {
    this.clearRestart();
    const set = this.d.setTimer ?? ((fn: () => void, t: number) => setTimeout(fn, t));
    this.restart = set(() => { this.restart = null; this.listen(); }, ms);
  }

  private clearRestart() {
    if (this.restart === null) return;
    (this.d.clearTimer ?? ((t: unknown) => clearTimeout(t as ReturnType<typeof setTimeout>)))(this.restart);
    this.restart = null;
  }

  private onSpeech(type: string, text: string | null, code: number | null) {
    if (this.closed) return;
    if (type === "start") this.d.patch({ hearing: true });
    else if (type === "stop") this.d.patch({ hearing: false });
    else if (type === "partial") { if (!this.speakingNow) this.d.lines((l) => withPartial(l, text ?? "")); }
    else if (type === "final") {
      this.listening = false;
      this.failures = 0;
      this.d.patch({ hearing: false, listening: false });
      const said = (text ?? "").trim();
      if (said && !this.speakingNow) { this.d.lines((l) => withFinal(l, "user", said)); void this.send(said); }
      else this.d.lines((l) => withPartial(l, ""));
      this.later(150);
    } else if (type === "error") {
      this.listening = false;
      this.d.patch({ hearing: false, listening: false });
      if (code === ERR.PERMISSIONS) { this.stop(); this.d.failed("micBlocked"); return; }
      if (code === ERR.NO_MATCH || code === ERR.SPEECH_TIMEOUT) { this.failures = 0; this.later(150); return; }
      // Busy, network or a client error: retry a few times, slower each time.
      this.failures++;
      if (this.failures > 6) { this.stop(); this.d.failed("noSpeech"); return; }
      this.later(code === ERR.BUSY ? 400 : 500 * this.failures);
    }
  }

  private async send(text: string) {
    try {
      const row = await this.d.sendMessage(text);
      if (this.spokenUpTo === null) this.spokenUpTo = row.seq;
      this.checkReplies();
    } catch (e) { this.d.sendFailed(e); }
  }

  /** New finished replies of the bot after the first thing said in this call are read aloud, in order. */
  checkReplies() {
    if (this.closed) return;
    const th = this.d.thread();
    if (!th) return;
    if (th.generation !== this.generation) {
      // A new conversation started mid-call: sequence numbers start over.
      if (this.generation !== -1 && this.spokenUpTo !== null) this.spokenUpTo = -1;
      this.generation = th.generation;
    }
    if (this.spokenUpTo === null) return;
    let added = false;
    for (const row of th.rows) {
      if (row.seq <= this.spokenUpTo) continue;
      const b = row.body;
      if (b.kind !== "message" || b.role !== "assistant") continue;
      if (b.streaming) break;
      this.spokenUpTo = row.seq;
      const s = speakable(b.text);
      if (s) { this.queue.push(s); added = true; }
    }
    if (added && !this.speakingNow) this.speakNext();
  }

  private speakNext() {
    const text = this.queue.shift();
    if (text === undefined || this.closed) {
      this.speakingNow = false;
      this.current = null;
      this.d.patch({ speaking: false });
      this.listen();
      return;
    }
    this.speakingNow = true;
    if (this.listening) { this.listening = false; this.d.speech.stopListening(); }
    this.d.patch({ speaking: true, listening: false });
    this.d.lines((l) => withFinal(l, "assistant", text));
    const id = `u${++this.ttsId}`;
    this.current = id;
    this.d.speech.speak(id, text, this.d.lang, this.d.rate);
  }

  private onTts(type: string, id: string) {
    if (this.closed || id !== this.current) return;
    if (type === "done" || type === "error") { this.current = null; this.speakNext(); }
  }

  /** Stop the bot talking and listen at once. */
  bargeIn() {
    this.queue = [];
    if (this.speakingNow) { this.current = null; this.d.speech.stopSpeaking(); this.speakNext(); }
  }

  mute(on: boolean) {
    if (on) { this.clearRestart(); if (this.listening) { this.listening = false; this.d.speech.stopListening(); } this.d.lines((l) => withPartial(l, "")); this.d.patch({ listening: false }); }
    else this.listen();
  }

  private sendRecordEnd() {
    if (!this.callId) return;
    void this.d.endRecord(this.callId, transcriptOf(this.d.getLines())).catch(() => undefined);
    this.callId = null;
  }

  stop() {
    if (this.closed) return;
    this.closed = true;
    this.clearRestart();
    for (const off of this.offs) off();
    this.offs = [];
    this.queue = [];
    this.d.speech.stopListening();
    this.d.speech.stopSpeaking();
    this.recordEnded = true;
    this.sendRecordEnd();
  }
}
