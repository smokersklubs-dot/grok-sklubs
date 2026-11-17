// A small, self-made soundtrack for the promo (no samples, no service): soft pad, plucked arpeggio, light kick,
// and sound effects placed on the timeline's events. Deterministic. Usage: node soundtrack.mjs out.wav
import { writeFileSync } from "node:fs";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const TL = require("../timeline.js");

const SR = 48000;
const DUR = TL.duration;
const N = Math.round(SR * DUR);
const L = new Float32Array(N), R = new Float32Array(N);
const BEAT = 60 / TL.bpm;

let seed = 12345;
const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
const midi = (m) => 440 * Math.pow(2, (m - 69) / 12);
function add(t0, len, fn, pan = 0, gain = 1) {
  const s0 = Math.max(0, Math.round(t0 * SR)), s1 = Math.min(N, Math.round((t0 + len) * SR));
  const gl = gain * Math.cos((pan + 1) * Math.PI / 4), gr = gain * Math.sin((pan + 1) * Math.PI / 4);
  for (let i = s0; i < s1; i++) { const v = fn((i - s0) / SR); L[i] += v * gl; R[i] += v * gr; }
}

/* ---------- Music ---------- */
// F maj7 – A m7 – D m7 – B♭ maj7, two bars each.
const CHORDS = [[53, 57, 60, 64], [57, 60, 64, 67], [50, 53, 57, 60], [46, 50, 53, 57]];
const BAR = BEAT * 4;
const chordAt = (t) => CHORDS[Math.floor(t / (BAR * 2)) % CHORDS.length];
// Overall energy: quiet hook, fuller body, resolve at the end.
const energy = (t) => (t < 4 ? 0.55 : t < 38 ? 1 : t < 43.6 ? 0.9 : Math.max(0, 1 - (t - 43.6) / 1.4));

// Pad: one note per chord tone, detuned saws through a soft low-pass, slow attack/release.
for (let c = 0; c * BAR * 2 < DUR; c++) {
  const t0 = c * BAR * 2;
  const notes = c * BAR * 2 >= 38 ? [53, 57, 60, 64, 72] : chordAt(t0 + 0.01);
  const len = Math.min(BAR * 2 + 1.2, DUR - t0);
  notes.forEach((m, k) => {
    const f = midi(m);
    let lp = 0;
    add(t0, len, (t) => {
      const env = Math.min(1, t / 1.0) * Math.min(1, Math.max(0, (len - t) / 1.2));
      let s = 0;
      for (const d of [-0.12, 0, 0.11]) { const ph = (t * f * Math.pow(2, d / 12)) % 1; s += 2 * ph - 1; }
      lp += 0.035 * (s / 3 - lp);
      return lp * env * 0.11 * energy(t0 + t);
    }, (k % 2 ? 0.35 : -0.35));
  });
}

// Bass: root on each bar, a soft sine.
for (let b = 0; b * BAR < DUR; b++) {
  const t0 = b * BAR;
  if (t0 < 4) continue;
  const root = (t0 >= 38 ? 53 : chordAt(t0 + 0.01)[0]) - 12;
  const f = midi(root);
  add(t0, BAR, (t) => Math.sin(2 * Math.PI * f * t) * Math.min(1, t / 0.02) * Math.exp(-t * 0.9) * 0.22 * energy(t0 + t));
}

// Plucked arpeggio, eighth notes, from the team scene.
for (let i = 0; i * BEAT / 2 < DUR; i++) {
  const t0 = i * BEAT / 2;
  if (t0 < 4 || t0 > 43.5) continue;
  const ch = t0 >= 38 ? [53, 57, 60, 64] : chordAt(t0);
  const m = ch[[0, 2, 1, 3, 2, 1, 3, 2][i % 8]] + 12;
  const f = midi(m);
  add(t0, 0.6, (t) => {
    const env = Math.min(1, t / 0.004) * Math.exp(-t * 7);
    return (Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(4 * Math.PI * f * t) * Math.exp(-t * 14)) * env * 0.07;
  }, (i % 2 ? 0.4 : -0.4));
}

// Kick on beats 1 and 3, a light shaker on the off-beats from the computer scene.
for (let i = 0; i * BEAT < DUR; i++) {
  const t0 = i * BEAT;
  if (t0 >= 4 && t0 < 43.5 && i % 2 === 0) {
    add(t0, 0.35, (t) => Math.sin(2 * Math.PI * (48 + 90 * Math.exp(-t * 30)) * t) * Math.exp(-t * 9) * 0.32);
  }
  const tOff = t0 + BEAT / 2;
  if (tOff >= 12 && tOff < 43.5) {
    let hp = 0, prev = 0;
    add(tOff, 0.08, (t) => { const n = rnd() * 2 - 1; hp = 0.6 * (hp + n - prev); prev = n; return hp * Math.exp(-t * 60) * 0.05; }, 0.2);
  }
}

/* ---------- Sound effects on the timeline ---------- */
const pop = (t0, pitch = 1) => add(t0, 0.14, (t) => Math.sin(2 * Math.PI * (320 + 900 * t / 0.14) * pitch * t) * Math.sin(Math.PI * t / 0.14) * 0.16);
const tick = (t0) => add(t0, 0.18, (t) => (Math.sin(2 * Math.PI * 1568 * t) + 0.5 * Math.sin(2 * Math.PI * 2349 * t)) * Math.exp(-t * 28) * 0.09, 0.15);
const chime = (t0) => [84, 88, 91].forEach((m, k) => add(t0 + k * 0.07, 1.2, (t) => Math.sin(2 * Math.PI * midi(m) * t) * Math.exp(-t * 3.5) * Math.min(1, t / 0.003) * 0.08, (k - 1) * 0.3));
const click = (t0) => add(t0, 0.03, (t) => (rnd() * 2 - 1) * Math.exp(-t * 300) * 0.25);
function whoosh(t0) {
  // Noise through three one-pole low-passes whose cutoff opens and closes: a soft air sweep.
  let a = 0, b = 0, c = 0;
  add(t0 - 0.3, 0.8, (t) => {
    const env = Math.sin(Math.PI * t / 0.8);
    const k = 0.004 + 0.05 * env;
    a += k * (rnd() * 2 - 1 - a); b += k * (a - b); c += k * (b - c);
    return c * env * 1.6;
  });
}
TL.scenes.slice(1).forEach((s) => whoosh(s.start));
TL.team.pops.forEach((t, i) => pop(t + 0.02, 1 + i * 0.06));
TL.team.speak.forEach((t, i) => { const f = midi(72 + [0, 3, 5, 7, 10][i]); add(t, 0.22, (x) => Math.sin(2 * Math.PI * f * x * (1 + 0.04 * Math.sin(2 * Math.PI * 14 * x))) * Math.sin(Math.PI * x / 0.22) * 0.06); });
[...TL.computer.checks, ...TL.computer.miniChecks].forEach(tick);
tick(TL.today.total + 1.2);
TL.today.rows.forEach((t) => tick(t + 0.05));
click(TL.safety.click);
chime(TL.safety.click + 0.25);
// A soft "question" two-note blip when the card arrives.
[76, 79].forEach((m, k) => add(TL.safety.card + 0.35 + k * 0.12, 0.25, (t) => Math.sin(2 * Math.PI * midi(m) * t) * Math.exp(-t * 10) * 0.07));
// Wake-up in the hook, bots and sparkles at the end.
[67, 71, 74].forEach((m, k) => add(TL.hook.wake + k * 0.06, 0.4, (t) => Math.sin(2 * Math.PI * midi(m) * t) * Math.exp(-t * 8) * 0.08));
for (let i = 0; i < 6; i++) pop(TL.cta.bots + i * 0.1, 1.1 + i * 0.05);
for (let i = 0; i < 26; i++) { const t0 = TL.cta.euphoric + rnd() * 1.6; const f = 2000 + rnd() * 2500; add(t0, 0.12, (t) => Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 35) * 0.035, rnd() * 1.6 - 0.8); }
chime(TL.cta.url);

/* ---------- Master: soft clip, fade, normalise, 16-bit WAV ---------- */
let peak = 0;
for (let i = 0; i < N; i++) {
  const fade = Math.min(1, i / (SR * 0.05), (N - i) / (SR * 0.6));
  L[i] = Math.tanh(L[i] * 1.2) * fade; R[i] = Math.tanh(R[i] * 1.2) * fade;
  peak = Math.max(peak, Math.abs(L[i]), Math.abs(R[i]));
}
const g = 0.7 / (peak || 1);
const buf = Buffer.alloc(44 + N * 4);
buf.write("RIFF", 0); buf.writeUInt32LE(36 + N * 4, 4); buf.write("WAVE", 8); buf.write("fmt ", 12);
buf.writeUInt32LE(16, 16); buf.writeUInt16LE(1, 20); buf.writeUInt16LE(2, 22); buf.writeUInt32LE(SR, 24);
buf.writeUInt32LE(SR * 4, 28); buf.writeUInt16LE(4, 32); buf.writeUInt16LE(16, 34); buf.write("data", 36); buf.writeUInt32LE(N * 4, 40);
for (let i = 0; i < N; i++) {
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, L[i] * g)) * 32767), 44 + i * 4);
  buf.writeInt16LE(Math.round(Math.max(-1, Math.min(1, R[i] * g)) * 32767), 46 + i * 4);
}
writeFileSync(process.argv[2], buf);
console.log("soundtrack", process.argv[2], DUR + " s");
