/**
 * L177 — a bot asks for a photo or the phone's position (server/src/phonerequests.ts). The request shows here; NOTHING is
 * taken unless the owner taps « Prendre la photo » / « Partager ma position » at that moment. Never in the background:
 * the camera is the system camera, opened by the tap; the position is read by the phone's browser after another tap,
 * on a one-time page (the system asks its own permission too). Pure helpers: unit-tested.
 */
export type PhoneKind = "photo" | "location";
export interface PhoneRequest { id: string; botId: string; botName: string; kind: PhoneKind; reason: string; status: string; createdAt: number; expiresAt: number }

/** The requests still worth showing, oldest first (the server already drops expired ones; this guards the clock). */
export function visibleRequests(list: unknown, now = Date.now()): PhoneRequest[] {
  if (!Array.isArray(list)) return [];
  return list
    .filter((r): r is PhoneRequest => !!r && typeof r === "object" && typeof (r as PhoneRequest).id === "string" && ((r as PhoneRequest).kind === "photo" || (r as PhoneRequest).kind === "location"))
    .filter((r) => r.status === "pending" && r.expiresAt > now)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** Seconds left before the request lapses (0 when over). */
export const secondsLeft = (r: Pick<PhoneRequest, "expiresAt">, now = Date.now()) => Math.max(0, Math.ceil((r.expiresAt - now) / 1000));
export const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

/** The one-time location page's full address (the server answers a path under /api). */
export function locationPageUrl(origin: string, path: unknown): string | null {
  if (typeof path !== "string" || !/^\/api\/phone\/where\/[A-Za-z0-9_-]{20,64}$/.test(path)) return null;
  return `${origin.replace(/\/+$/, "")}${path}`;
}

/** The server said the requests changed (event "phoneRequests" on the live channel, state/store.ts). */
const listeners = new Set<() => void>();
export function onPhoneRequests(fn: () => void): () => void { listeners.add(fn); return () => { listeners.delete(fn); }; }
/** True when the event was this one (and listeners were told). */
export function phoneRequestsEvent(ev: { type?: unknown }): boolean {
  if (ev.type !== "phoneRequests") return false;
  for (const f of listeners) f();
  return true;
}
