/**
 * L151 « Sons » (backlog A-FAIRE): a short chime when a bot finishes a reply or needs you, played by this device only
 * when the choice is on here (localStorage) and the window is in the background or another chat is open. Generated
 * with the Web Audio API (https://developer.mozilla.org/docs/Web/API/Web_Audio_API): no sound file, nothing fetched.
 */
const KEY = "sklubot.sounds";
const GAP_MS = 4000;
let last = 0;
let ctx: AudioContext | null = null;

export function soundsEnabled(): boolean {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
}
export function setSoundsEnabled(on: boolean): void {
  try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* not kept */ }
  if (on) playChime("reply", true);
}

/** "reply": two soft rising notes; "needs": two notes, the second higher and a little longer. */
export function playChime(kind: "reply" | "needs", force = false): void {
  if (!force && (!soundsEnabled() || Date.now() - last < GAP_MS)) return;
  last = Date.now();
  try {
    const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    ctx ??= new AC();
    const notes = kind === "needs" ? [660, 990] : [587, 784];
    notes.forEach((f, i) => {
      const o = ctx!.createOscillator(), g = ctx!.createGain();
      const t0 = ctx!.currentTime + i * 0.14, len = kind === "needs" && i === 1 ? 0.32 : 0.2;
      o.type = "sine"; o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(0.12, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + len);
      o.connect(g).connect(ctx!.destination); o.start(t0); o.stop(t0 + len + 0.02);
    });
  } catch { /* audio not allowed yet (no click on the page so far): silent */ }
}
