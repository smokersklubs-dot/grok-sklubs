/**
 * Voice activity detection on 16-bit mono PCM (wave 6), energy based with an adaptive noise floor. Small and
 * deterministic, so it can be tested with synthetic audio: no model, no native code.
 *
 *  - Each frame (20 ms at 16 kHz = 320 samples) gets its RMS level on a 0-1 scale.
 *  - While nobody speaks, the noise floor follows the level slowly (EMA); a frame is "voiced" when its level is above
 *    max(absMin, floor × ratio).
 *  - Speech starts after `startMs` of voiced frames (the 300 ms before are kept, so the first syllable is not lost), and
 *    ends after `endMs` of silence, or after `maxMs` in all.
 * The session raises `startMs` while the bot is talking (barge-in sensitivity), so a cough or the bot's own echo does
 * not cut it off.
 */
export interface VadOptions { sampleRate: number; frameMs: number; startMs: number; endMs: number; maxMs: number; absMin: number; ratio: number; prerollMs: number }
export const DEFAULT_VAD: VadOptions = { sampleRate: 16000, frameMs: 20, startMs: 100, endMs: 650, maxMs: 30_000, absMin: 0.015, ratio: 3, prerollMs: 300 };

export type VadEvent = { type: "start" } | { type: "end"; audio: Int16Array; ms: number };

export function rms(frame: Int16Array): number {
  if (!frame.length) return 0;
  let sum = 0;
  for (let i = 0; i < frame.length; i++) { const v = frame[i] / 32768; sum += v * v; }
  return Math.sqrt(sum / frame.length);
}

export class Vad {
  readonly o: VadOptions;
  private floor = 0.004;
  private voicedRun = 0;
  private silentRun = 0;
  private speaking = false;
  private pending = new Int16Array(0);
  private preroll: Int16Array[] = [];
  private utterance: Int16Array[] = [];
  private utteranceSamples = 0;
  private startMs: number;

  constructor(opts: Partial<VadOptions> = {}) {
    this.o = { ...DEFAULT_VAD, ...opts };
    this.startMs = this.o.startMs;
  }
  get frameSamples() { return Math.round((this.o.sampleRate * this.o.frameMs) / 1000); }
  get isSpeaking() { return this.speaking; }
  get noiseFloor() { return this.floor; }
  /** How long the user must speak before it counts (raised while the bot talks: barge-in sensitivity). */
  setStartMs(ms: number) { this.startMs = Math.max(this.o.frameMs, ms); }
  /** The audio of the utterance in progress (for interim transcripts). */
  current(): Int16Array { return concat(this.utterance); }

  /** Feeds any number of samples; returns what happened, in order. */
  push(samples: Int16Array): VadEvent[] {
    const out: VadEvent[] = [];
    const all = this.pending.length ? concat([this.pending, samples]) : samples;
    const n = this.frameSamples;
    let i = 0;
    for (; i + n <= all.length; i += n) this.frame(all.subarray(i, i + n), out);
    this.pending = all.slice(i);
    return out;
  }

  /** Ends whatever is in progress (the call is over, or the user muted). */
  flush(): VadEvent[] {
    if (!this.speaking) return [];
    return [this.finish()];
  }

  private frame(f: Int16Array, out: VadEvent[]) {
    const level = rms(f);
    const voiced = level > Math.max(this.o.absMin, this.floor * this.o.ratio);
    const copy = f.slice();
    if (!this.speaking) {
      if (!voiced) this.floor = this.floor * 0.95 + level * 0.05;
      this.preroll.push(copy);
      const keep = Math.ceil(this.o.prerollMs / this.o.frameMs) + Math.ceil(this.startMs / this.o.frameMs);
      while (this.preroll.length > keep) this.preroll.shift();
      this.voicedRun = voiced ? this.voicedRun + 1 : 0;
      if (this.voicedRun * this.o.frameMs >= this.startMs) {
        this.speaking = true;
        this.silentRun = 0;
        this.utterance = this.preroll;
        this.utteranceSamples = this.preroll.reduce((a, b) => a + b.length, 0);
        this.preroll = [];
        out.push({ type: "start" });
      }
      return;
    }
    this.utterance.push(copy);
    this.utteranceSamples += copy.length;
    this.silentRun = voiced ? 0 : this.silentRun + 1;
    const ms = (this.utteranceSamples / this.o.sampleRate) * 1000;
    if (this.silentRun * this.o.frameMs >= this.o.endMs || ms >= this.o.maxMs) out.push(this.finish());
  }

  private finish(): VadEvent {
    const audio = concat(this.utterance);
    this.speaking = false;
    this.voicedRun = 0;
    this.silentRun = 0;
    this.utterance = [];
    this.utteranceSamples = 0;
    return { type: "end", audio, ms: Math.round((audio.length / this.o.sampleRate) * 1000) };
  }
}

export function concat(parts: Int16Array[]): Int16Array {
  const total = parts.reduce((a, b) => a + b.length, 0);
  const out = new Int16Array(total);
  let at = 0;
  for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}

/** A 16-bit mono PCM WAV file (RIFF, WAVE_FORMAT_PCM): what whisper.cpp's server and OpenAI's API accept. */
export function wavOf(pcm: Int16Array, sampleRate = 16000): Buffer {
  const data = Buffer.from(pcm.buffer, pcm.byteOffset, pcm.byteLength);
  const h = Buffer.alloc(44);
  h.write("RIFF", 0); h.writeUInt32LE(36 + data.length, 4); h.write("WAVE", 8);
  h.write("fmt ", 12); h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22);
  h.writeUInt32LE(sampleRate, 24); h.writeUInt32LE(sampleRate * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34);
  h.write("data", 36); h.writeUInt32LE(data.length, 40);
  return Buffer.concat([h, data]);
}

/** Duration of a PCM WAV (to know roughly how long the bot will talk). 0 when it cannot be read. */
export function wavDurationMs(wav: Buffer): number {
  if (wav.length < 44 || wav.toString("ascii", 0, 4) !== "RIFF" || wav.toString("ascii", 8, 12) !== "WAVE") return 0;
  let at = 12;
  let byteRate = 0;
  while (at + 8 <= wav.length) {
    const id = wav.toString("ascii", at, at + 4);
    const size = wav.readUInt32LE(at + 4);
    if (id === "fmt ") byteRate = wav.readUInt32LE(at + 16);
    if (id === "data") return byteRate ? Math.round((Math.min(size, wav.length - at - 8) / byteRate) * 1000) : 0;
    at += 8 + size + (size % 2);
  }
  return 0;
}
