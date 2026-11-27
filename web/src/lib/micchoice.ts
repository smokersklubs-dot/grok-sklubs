/**
 * L154 « choix du micro et reconnexion » (Sklubot's own code). The microphone chosen for calls is remembered in this
 * browser (a per-viewer convenience: localStorage, wrapped, may be empty); it is asked as an `ideal` deviceId so an
 * unplugged microphone falls back to the default one instead of failing (MediaTrackConstraints, Media Capture and
 * Streams spec). When the microphone in use stops during a call (unplugged headset, Bluetooth gone: the track's
 * `ended` event), the call takes another one by itself and says so.
 */
const KEY = "sklubot.mic";

export function preferredMic(): string {
  try { return localStorage.getItem(KEY) ?? ""; } catch { return ""; }
}
export function setPreferredMic(id: string): void {
  try { if (id) localStorage.setItem(KEY, id); else localStorage.removeItem(KEY); } catch { /* private window: not kept */ }
}

/** The audio constraints of a call with the chosen microphone (if any) as an `ideal` device. */
export function micConstraints(base: MediaTrackConstraints, chosen = preferredMic()): MediaTrackConstraints {
  return chosen ? { ...base, deviceId: { ideal: chosen } } : base;
}

export interface Mic { id: string; label: string }
/** The microphones the browser shows (labels appear once the microphone was allowed). */
export async function listMics(): Promise<Mic[]> {
  if (!navigator.mediaDevices?.enumerateDevices) return [];
  try {
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === "audioinput" && d.deviceId).map((d, i) => ({ id: d.deviceId, label: d.label || `Micro ${i + 1}` }));
  } catch { return []; }
}

/** Calls `onLost` once when the microphone of `stream` stops on its own (not when we stop it). */
export function watchMic(stream: MediaStream, onLost: () => void): () => void {
  const track = stream.getAudioTracks()[0];
  if (!track) return () => undefined;
  let off = false;
  const ended = () => { if (!off) { off = true; onLost(); } };
  track.addEventListener("ended", ended);
  return () => { off = true; track.removeEventListener("ended", ended); };
}
