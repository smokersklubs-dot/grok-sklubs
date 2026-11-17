/*
 * Sklubot voice capture (wave 6). Runs in the AudioWorklet: takes the microphone at the context's rate (often 48 kHz),
 * low-passed by the page, resamples it to 16 kHz mono (linear interpolation), converts it to 16-bit PCM and posts 20 ms frames (320 samples) to the page, with the
 * frame's level so the page can duck the bot's voice the instant the user speaks.
 * AudioWorkletProcessor: https://developer.mozilla.org/docs/Web/API/AudioWorkletProcessor
 */
class SklubotCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    // Input samples per output sample (3 at 48 kHz, 2.756 at 44.1 kHz). The page puts two low-pass filters (7 kHz) in
    // front of this node, so linear interpolation between neighbouring samples is clean (no aliasing, no jitter
    // between uneven groups as the old box average had at 44.1 kHz).
    this.step = sampleRate / 16000;
    this.t = 0;
    this.prev = 0;
    this.frame = new Int16Array(320);
    this.at = 0;
  }
  emit(v) {
    v = Math.max(-1, Math.min(1, v));
    this.frame[this.at++] = v < 0 ? v * 0x8000 : v * 0x7fff;
    if (this.at === this.frame.length) {
      let e = 0;
      for (let j = 0; j < this.frame.length; j++) { const s = this.frame[j] / 32768; e += s * s; }
      const out = this.frame;
      this.port.postMessage({ pcm: out.buffer, level: Math.sqrt(e / out.length) }, [out.buffer]);
      this.frame = new Int16Array(320);
      this.at = 0;
    }
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      const x = ch[i];
      // The segment from the previous sample (position 0) to this one (position 1): every output position inside it.
      while (this.t <= 1) {
        this.emit(this.prev + (x - this.prev) * this.t);
        this.t += this.step;
      }
      this.t -= 1;
      this.prev = x;
    }
    return true;
  }
}
registerProcessor("sklubot-capture", SklubotCapture);
