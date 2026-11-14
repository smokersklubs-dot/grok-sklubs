/*
 * Sklubot voice capture (wave 6). Runs in the AudioWorklet: takes the microphone at the context's rate (often 48 kHz),
 * downsamples it to 16 kHz mono, converts it to 16-bit PCM and posts 20 ms frames (320 samples) to the page, with the
 * frame's level so the page can duck the bot's voice the instant the user speaks.
 * AudioWorkletProcessor: https://developer.mozilla.org/docs/Web/API/AudioWorkletProcessor
 */
class SklubotCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.ratio = sampleRate / 16000;
    this.acc = 0;
    this.sum = 0;
    this.count = 0;
    this.frame = new Int16Array(320);
    this.at = 0;
  }
  process(inputs) {
    const ch = inputs[0] && inputs[0][0];
    if (!ch) return true;
    for (let i = 0; i < ch.length; i++) {
      // Box filter over each group of input samples, then one output sample (simple, enough for speech).
      this.sum += ch[i];
      this.count++;
      this.acc += 1;
      if (this.acc >= this.ratio) {
        this.acc -= this.ratio;
        const v = Math.max(-1, Math.min(1, this.sum / this.count));
        this.sum = 0;
        this.count = 0;
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
    }
    return true;
  }
}
registerProcessor("sklubot-capture", SklubotCapture);
