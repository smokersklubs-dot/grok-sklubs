/** « Écouter »: one reply read part by part (voice/listen.ts wires it to the server and the voice module). Pure: unit-tested. */
import { toBase64 } from "../lib/screen";
import { speakable } from "./text";

export type ListenStatus = "idle" | "loading" | "playing" | "error";
export interface Part { kind: "audio"; wav: Uint8Array; parts: number }
export type Fetched = Part | { kind: "device" } | { kind: "error"; message: string | null };
export interface ListenDeps {
  fetchPart(n: number): Promise<Fetched>;
  play(id: number, wavBase64: string): void;
  stopPlayback(): void;
  onPlayed(fn: (id: number) => void): () => void;
  speak(id: string, text: string): void;
  stopSpeaking(): void;
  onTts(fn: (type: string, id: string) => void): () => void;
  set(p: { status: ListenStatus; part?: number; parts?: number }): void;
  done(): void;
}

let ids = 1;
/** One reply being read. Transport-free, so tests drive it. */
export class ReplyListener {
  private parts = 1;
  private part = 0;
  private playing = -1;
  private ttsId = "";
  private next: Promise<Fetched> | null = null;
  private offs: (() => void)[] = [];
  stopped = false;

  constructor(private d: ListenDeps, private text: string) {
    this.offs.push(d.onPlayed((id) => { if (id === this.playing) void this.advance(); }));
    this.offs.push(d.onTts((type, id) => { if (id === this.ttsId && (type === "done" || type === "error")) this.finish(); }));
  }

  async start(): Promise<void> {
    this.d.set({ status: "loading", part: 0, parts: 0 });
    await this.playPart(this.d.fetchPart(0));
  }

  private async playPart(p: Promise<Fetched>): Promise<void> {
    const got = await p;
    if (this.stopped) return;
    if (got.kind === "device") { this.ttsId = `listen-${ids++}`; this.d.set({ status: "playing", part: 0, parts: 1 }); this.d.speak(this.ttsId, speakable(this.text)); return; }
    if (got.kind === "error") { this.d.set({ status: "error" }); this.cleanup(); return; }
    this.parts = got.parts;
    this.next = this.part + 1 < this.parts ? this.d.fetchPart(this.part + 1) : null;
    this.playing = ids++;
    this.d.set({ status: "playing", part: this.part, parts: this.parts });
    this.d.play(this.playing, toBase64(got.wav));
  }

  private async advance(): Promise<void> {
    if (this.stopped) return;
    this.part++;
    if (this.part >= this.parts || !this.next) { this.finish(); return; }
    const p = this.next;
    this.next = null;
    await this.playPart(p);
  }

  private finish(): void {
    if (this.stopped) return;
    this.cleanup();
    this.d.done();
  }

  private cleanup(): void {
    this.stopped = true;
    for (const off of this.offs) off();
    this.offs = [];
  }

  stop(): void {
    if (this.stopped) return;
    this.cleanup();
    this.d.stopPlayback();
    if (this.ttsId) this.d.stopSpeaking();
  }
}

