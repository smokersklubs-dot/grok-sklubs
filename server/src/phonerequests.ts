import { createHash, randomBytes } from "node:crypto";
import sharp from "sharp";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { pushLater } from "./push.js";
import type { ServerEvent } from "./shared.js";
import { audit, clip, newId, now } from "./store.js";

/**
 * L177 — the owner's phone as a tool: a photo from its camera, or its position, for a bot that asks.
 *
 * Every request is approved ON THE PHONE by the owner, at the moment: the Sklubot app shows « {bot} voudrait une photo :
 * {raison} » with « Prendre la photo » / « Refuser » (or « Partager ma position » / « Refuser »). Nothing is ever taken in
 * the background: the app only answers when the owner taps, the camera is the system camera (expo-image-picker
 * launchCameraAsync) and the position is read by the phone's browser only after the owner taps « Partager ma position »
 * on a one-time page (the system asks its own permission too). A request lasts 3 minutes, then expires; one at a time
 * per bot. The bot gets the photo (reduced to 1600 px) or the coordinates, nothing else; the result is not kept here.
 *
 * Why the position goes through a page: the Expo app has no location module yet, and adding one changes the native
 * build; the phone's browser Geolocation API (https://www.w3.org/TR/geolocation/) asks the owner itself. Tables here.
 */
q.run(`CREATE TABLE IF NOT EXISTS phone_requests (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, bot_name TEXT NOT NULL, kind TEXT NOT NULL, reason TEXT NOT NULL, status TEXT NOT NULL, page_token TEXT, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, answered_at INTEGER)`);
q.run("CREATE INDEX IF NOT EXISTS phone_requests_user ON phone_requests (user_id, status)");

export type PhoneKind = "photo" | "location";
export type PhoneStatus = "pending" | "done" | "refused" | "expired";
export interface PhoneRequest { id: string; botId: string; botName: string; kind: PhoneKind; reason: string; status: PhoneStatus; createdAt: number; expiresAt: number }
export type PhoneAnswer = { kind: "photo"; data: string; mediaType: "image/jpeg" } | { kind: "location"; latitude: number; longitude: number; accuracy: number | null } | { kind: "refused" } | { kind: "expired" };

export const REQUEST_MS = 3 * 60_000;
let requestMs = REQUEST_MS;
/** Tests only. */
export const setPhoneRequestMs = (ms: number | null) => { requestMs = ms ?? REQUEST_MS; };
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

const toReq = (r: any): PhoneRequest => ({ id: r.id, botId: r.bot_id, botName: r.bot_name, kind: r.kind, reason: r.reason, status: r.status, createdAt: r.created_at, expiresAt: r.expires_at });
const tokenHash = (t: string) => createHash("sha256").update(t).digest("hex");
const waiting = new Map<string, (a: PhoneAnswer) => void>();
const changed = (userId: string) => emit(userId, { type: "phoneRequests" } as unknown as ServerEvent);

function expireOld() { q.run("UPDATE phone_requests SET status = 'expired' WHERE status = 'pending' AND expires_at < ?", now()); }

function finish(userId: string, id: string, status: PhoneStatus, answer: PhoneAnswer) {
  q.run("UPDATE phone_requests SET status = ?, answered_at = ?, page_token = NULL WHERE id = ? AND status = 'pending'", status, now(), id);
  waiting.get(id)?.(answer);
  waiting.delete(id);
  changed(userId);
}

export const phoneRequests = {
  /** The owner's requests still waiting (the phone shows them). */
  pending(userId: string): PhoneRequest[] { expireOld(); return q.all("SELECT * FROM phone_requests WHERE user_id = ? AND status = 'pending' ORDER BY created_at", userId).map(toReq); },
  get(userId: string, id: string): PhoneRequest | null { expireOld(); const r = q.get("SELECT * FROM phone_requests WHERE id = ? AND user_id = ?", id, userId); return r ? toReq(r) : null; },

  /**
   * A bot asks: the request is shown on the phone, and this waits for the owner's answer (or 3 minutes). One at a time
   * per bot: a second one while the first waits is refused.
   */
  async ask(bot: { id: string; userId: string; name: string }, kind: PhoneKind, reason: string, signal?: AbortSignal): Promise<PhoneAnswer | { kind: "busy" }> {
    expireOld();
    if (q.get("SELECT 1 FROM phone_requests WHERE bot_id = ? AND status = 'pending'", bot.id)) return { kind: "busy" };
    const id = newId("phr"), t = now();
    q.run("INSERT INTO phone_requests (id, user_id, bot_id, bot_name, kind, reason, status, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)", id, bot.userId, bot.id, clip(bot.name, 60), kind, clip(reason.trim() || "—", 300), t, t + requestMs);
    audit(bot.userId, "computer", `${bot.name} asked for ${kind === "photo" ? "a photo" : "the position"} of the phone`, bot.id);
    changed(bot.userId);
    pushLater(bot.userId, { kind: "needs", title: bot.name, body: kind === "photo" ? `Demande une photo : ${clip(reason, 120)}` : `Demande ta position : ${clip(reason, 120)}`, botId: bot.id, tag: `phone-${id}` });
    return await new Promise<PhoneAnswer>((resolve) => {
      const timer = setTimeout(() => finish(bot.userId, id, "expired", { kind: "expired" }), requestMs);
      const onAbort = () => finish(bot.userId, id, "expired", { kind: "expired" });
      signal?.addEventListener("abort", onAbort, { once: true });
      waiting.set(id, (a) => { clearTimeout(timer); signal?.removeEventListener("abort", onAbort); resolve(a); });
    });
  },

  refuse(userId: string, id: string): boolean {
    const r = phoneRequests.get(userId, id);
    if (!r || r.status !== "pending") return false;
    finish(userId, id, "refused", { kind: "refused" });
    return true;
  },

  /** The photo the owner just took on the phone (base64 JPEG/PNG/HEIC as the camera gave it), reduced to 1600 px JPEG. */
  async photo(userId: string, id: string, base64: unknown): Promise<"ok" | "gone" | "bad"> {
    const r = phoneRequests.get(userId, id);
    if (!r || r.status !== "pending" || r.kind !== "photo") return "gone";
    if (typeof base64 !== "string" || !base64 || base64.length > (MAX_PHOTO_BYTES * 4) / 3) return "bad";
    let jpeg: Buffer;
    try { jpeg = await sharp(Buffer.from(base64, "base64")).rotate().resize({ width: 1600, height: 1600, fit: "inside", withoutEnlargement: true }).jpeg({ quality: 80 }).toBuffer(); } catch { return "bad"; }
    finish(userId, id, "done", { kind: "photo", data: jpeg.toString("base64"), mediaType: "image/jpeg" });
    return "ok";
  },

  /** A one-time page link for « Partager ma position » (the phone's browser reads the position after the owner's tap). */
  locationLink(userId: string, id: string): string | null {
    const r = phoneRequests.get(userId, id);
    if (!r || r.status !== "pending" || r.kind !== "location") return null;
    const token = randomBytes(24).toString("base64url");
    q.run("UPDATE phone_requests SET page_token = ? WHERE id = ?", tokenHash(token), id);
    return token;
  },
  /** The request a page token belongs to, if it still waits. */
  byToken(token: string): PhoneRequest & { userId: string } | null {
    expireOld();
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    const r = q.get<any>("SELECT * FROM phone_requests WHERE page_token = ? AND status = 'pending' AND kind = 'location'", tokenHash(token));
    return r ? { ...toReq(r), userId: r.user_id } : null;
  },
  location(token: string, body: Record<string, unknown>): "ok" | "gone" | "bad" {
    const r = phoneRequests.byToken(token);
    if (!r) return "gone";
    const lat = Number(body.latitude), lon = Number(body.longitude), acc = body.accuracy === undefined || body.accuracy === null ? null : Number(body.accuracy);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || Math.abs(lat) > 90 || Math.abs(lon) > 180 || (acc !== null && (!Number.isFinite(acc) || acc < 0))) return "bad";
    finish(r.userId, r.id, "done", { kind: "location", latitude: Math.round(lat * 1e6) / 1e6, longitude: Math.round(lon * 1e6) / 1e6, accuracy: acc === null ? null : Math.round(acc) });
    return "ok";
  },
  locationRefused(token: string): boolean { const r = phoneRequests.byToken(token); if (!r) return false; finish(r.userId, r.id, "refused", { kind: "refused" }); return true; },
};

/** Its Content-Security-Policy: only its own inline script (by nonce) and its own address. */
export const locationCsp = (nonce: string) => `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`;

/** The page the phone opens for « Partager ma position » (French and English, no outside script). */
export function locationPage(req: PhoneRequest, token: string, locale: "fr" | "en", nonce: string): string {
  const fr = locale === "fr";
  const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`);
  const t = fr
    ? { title: "Partager ta position", ask: `${esc(req.botName)} voudrait savoir où tu es`, why: "Raison :", share: "Partager ma position", refuse: "Refuser", done: "C'est envoyé. Tu peux fermer cette page.", no: "Refusé. Rien n'a été envoyé.", err: "Ta position n'a pas pu être lue (autorisation refusée ou indisponible). Rien n'a été envoyé." }
    : { title: "Share your location", ask: `${esc(req.botName)} would like to know where you are`, why: "Reason:", share: "Share my location", refuse: "Refuse", done: "Sent. You can close this page.", no: "Refused. Nothing was sent.", err: "Your location could not be read (permission refused or unavailable). Nothing was sent." };
  const url = `/api/phone/where/${token}`;
  return `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${t.title}</title>
<style>:root{color-scheme:light dark;--bg:#f4f2ee;--fg:#1d1d1f;--mut:#5b5b60;--acc:#c2401c}@media (prefers-color-scheme:dark){:root{--bg:#131416;--fg:#f2f2f2;--mut:#b4b4b8;--acc:#ff8a5c}}
body{margin:0;font:17px/1.45 system-ui,sans-serif;background:var(--bg);color:var(--fg);padding:24px 16px}main{max-width:420px;margin:0 auto}h1{font-size:22px}p{color:var(--mut)}
button{display:block;width:100%;min-height:48px;margin:12px 0;border-radius:12px;border:0;font:600 17px system-ui;cursor:pointer}#s{background:var(--acc);color:#fff}#r{background:transparent;color:var(--fg);border:1px solid var(--mut)}</style></head>
<body><main><h1>${t.ask}</h1><p>${t.why} ${esc(req.reason)}</p><button id="s">${t.share}</button><button id="r">${t.refuse}</button><p id="m" role="status"></p></main>
<script nonce="${nonce}">const m=document.getElementById('m'),b=[...document.querySelectorAll('button')];const end=(x)=>{m.textContent=x;b.forEach(e=>e.disabled=true)};
const post=(d)=>fetch(${JSON.stringify(url)},{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(d)});
document.getElementById('r').onclick=()=>post({refuse:true}).then(()=>end(${JSON.stringify(t.no)}));
document.getElementById('s').onclick=()=>{if(!navigator.geolocation){post({refuse:true});return end(${JSON.stringify(t.err)})}navigator.geolocation.getCurrentPosition((p)=>post({latitude:p.coords.latitude,longitude:p.coords.longitude,accuracy:p.coords.accuracy}).then(()=>end(${JSON.stringify(t.done)})),()=>{post({refuse:true});end(${JSON.stringify(t.err)})},{enableHighAccuracy:true,timeout:20000,maximumAge:0})};</script></body></html>`;
}
