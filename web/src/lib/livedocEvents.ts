/**
 * Events of wave 7 that are not in the shared ServerEvent list (server/src/livedoc.ts, phonerequests.ts): read first by
 * events.ts and handed to whoever listens (the open shared document).
 */
import type { LiveDocEvent } from "../../../server/src/clientshared/livedoctypes";

type Listener = (ev: LiveDocEvent) => void;
const listeners = new Set<Listener>();
export function onLiveDoc(fn: Listener): () => void { listeners.add(fn); return () => listeners.delete(fn); }
/** True when the event was one of these (and was handed over). */
export function handleExtensionEvent(ev: { type?: unknown }): boolean {
  if (ev.type === "livedoc") { for (const f of listeners) f(ev as LiveDocEvent); return true; }
  return ev.type === "phoneRequests"; // the phone app's concern: nothing to do on the web
}
