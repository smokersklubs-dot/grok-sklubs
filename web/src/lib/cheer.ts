/**
 * Euphoria: when a bot finds a real gem (its `celebrate` tool → a `cheer` event), its character goes
 * wild for a few seconds, and may shout with joy. A tiny standalone store so that both the main store
 * (which receives the event) and botState (which derives the character state) can use it without
 * importing each other.
 *
 * The shout is an original sound synthesised with the Web Audio API (no audio files): a rising
 * "whoo-hoo" glide sung through two vowel formants, then a sparkly arpeggio. Browsers only allow
 * audio after a user gesture, so the audio context is created (or resumed) on the first pointer or
 * key press; before that, the shout fails silently.
 */
import { intlTag, t } from "../i18n";
import { create } from "zustand";
import type { Locale } from "../types";

export const EUPHORIA_MS = 6000;

export const useCheer = create<{ until: Record<string, number> }>(() => ({ until: {} }));

/** Start (or extend) a bot's euphoria. */
export function startEuphoria(botId: string, ms = EUPHORIA_MS): void {
  useCheer.setState((s) => ({ until: { ...s.until, [botId]: Date.now() + ms } }));
}

/** Stop a bot's euphoria now (the editor preview, when another state is picked). */
export function stopEuphoria(botId: string): void {
  useCheer.setState((s) => {
    if (!(botId in s.until)) return s;
    const until = { ...s.until };
    delete until[botId];
    return { until };
  });
}

/* ---------- The shout ---------- */

type AudioCtor = typeof AudioContext;
let ctx: AudioContext | null = null;

function audioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: AudioCtor }).webkitAudioContext ?? null;
}

function ensureContext(): AudioContext | null {
  try {
    if (!ctx) {
      const Ctor = audioCtor();
      if (!Ctor) return null;
      ctx = new Ctor();
    }
    if (ctx.state === "suspended") void ctx.resume().catch(() => undefined);
    return ctx;
  } catch {
    return null;
  }
}

// Unlock audio on the first gesture, so a cheer that arrives later (over the event stream) can be heard.
if (typeof window !== "undefined") {
  const unlock = () => {
    ensureContext();
    window.removeEventListener("pointerdown", unlock, true);
    window.removeEventListener("keydown", unlock, true);
  };
  window.addEventListener("pointerdown", unlock, true);
  window.addEventListener("keydown", unlock, true);
}

/** One sung syllable: a buzzy source through two vowel formants, with a pitch glide and vibrato. */
function syllable(ac: AudioContext, out: AudioNode, at: number, dur: number, f0: number, f1: number, peak: number): void {
  const osc = ac.createOscillator();
  osc.type = "sawtooth";
  osc.frequency.setValueAtTime(f0, at);
  osc.frequency.exponentialRampToValueAtTime(f1, at + dur * 0.7);
  osc.frequency.exponentialRampToValueAtTime(f1 * 0.94, at + dur);
  const vib = ac.createOscillator();
  vib.frequency.value = 7;
  const vibGain = ac.createGain();
  vibGain.gain.value = f1 * 0.018;
  vib.connect(vibGain).connect(osc.frequency);
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.04);
  env.gain.setValueAtTime(peak, at + dur * 0.65);
  env.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  // "oo" vowel: formants near 350 Hz and 900 Hz.
  for (const [freq, q, g] of [[380, 6, 1], [950, 9, 0.45]] as const) {
    const bp = ac.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = freq;
    bp.Q.value = q;
    const fg = ac.createGain();
    fg.gain.value = g;
    osc.connect(bp).connect(fg).connect(env);
  }
  env.connect(out);
  osc.start(at);
  vib.start(at);
  osc.stop(at + dur + 0.05);
  vib.stop(at + dur + 0.05);
}

/** A bright bell-like note for the arpeggio. */
function bell(ac: AudioContext, out: AudioNode, at: number, freq: number, peak: number): void {
  const env = ac.createGain();
  env.gain.setValueAtTime(0.0001, at);
  env.gain.exponentialRampToValueAtTime(peak, at + 0.01);
  env.gain.exponentialRampToValueAtTime(0.0001, at + 0.42);
  env.connect(out);
  for (const [mult, type, g] of [[1, "triangle", 1], [2, "sine", 0.35], [3.01, "sine", 0.12]] as const) {
    const o = ac.createOscillator();
    o.type = type;
    o.frequency.value = freq * mult;
    const og = ac.createGain();
    og.gain.value = g;
    o.connect(og).connect(env);
    o.start(at);
    o.stop(at + 0.45);
  }
}

let lastShout = 0;

/**
 * A short joyful shout: "whoo-hoo" + sparkles, and, where speech synthesis exists and nothing else is
 * speaking, a short joyful word in the user's language. Fails silently (no gesture yet, no audio…).
 */
export function playShout(locale: Locale, opts: { speak?: boolean } = {}): void {
  if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
  const now = Date.now();
  if (now - lastShout < 1200) return;
  lastShout = now;
  const ac = ensureContext();
  if (ac && ac.state !== "closed") {
    try {
      const t0 = ac.currentTime + 0.03;
      const master = ac.createGain();
      master.gain.value = 0.9;
      master.connect(ac.destination);
      // "Whoo…" rising, then a higher "…hoo!".
      syllable(ac, master, t0, 0.34, 300, 640, 0.5);
      syllable(ac, master, t0 + 0.36, 0.42, 470, 900, 0.55);
      // Sparkly arpeggio climbing over the end of the shout.
      const notes = [1046.5, 1318.5, 1568, 2093, 2637, 3136];
      notes.forEach((f, i) => bell(ac, master, t0 + 0.62 + i * 0.065, f, 0.16 - i * 0.012));
    } catch {
      /* audio unavailable */
    }
  }
  if (opts.speak === false) return;
  try {
    const synth = typeof window !== "undefined" ? window.speechSynthesis : undefined;
    if (!synth || synth.speaking || synth.pending) return;
    const u = new SpeechSynthesisUtterance(t("cheer.shout"));
    u.lang = intlTag(locale);
    u.rate = 1.15;
    u.pitch = 1.8;
    u.volume = 0.8;
    window.setTimeout(() => {
      try {
        synth.speak(u);
      } catch {
        /* ignore */
      }
    }, 1050);
  } catch {
    /* speech unavailable */
  }
}
