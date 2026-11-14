/**
 * An approximate "how loud is the bot right now" level (0–1) for the speaking animation.
 * Speech synthesis gives no audio samples, so the call code reports word boundaries; between them
 * (or with voices that report none) a gentle pseudo-random wobble keeps the mouth moving.
 */

let speaking = false;
let lastWord = 0;

export function voiceStarted(): void {
  speaking = true;
  lastWord = performance.now();
}

export function voiceWord(): void {
  lastWord = performance.now();
}

export function voiceStopped(): void {
  speaking = false;
}

export function getVoiceLevel(): number {
  if (!speaking) return 0;
  const now = performance.now();
  const sinceWord = now - lastWord;
  // A syllable-ish wobble (3–6 Hz) under an envelope that peaks just after each word starts.
  const wobble = 0.5 + 0.5 * Math.sin(now / 58) * Math.sin(now / 131 + 1.3);
  const envelope = sinceWord < 900 ? 1 - sinceWord / 1400 : 0.55;
  return Math.max(0, Math.min(1, 0.15 + 0.85 * wobble * envelope));
}
