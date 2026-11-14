import { createCipheriv, createECDH, createHmac, createPrivateKey, generateKeyPairSync, randomBytes, sign, type KeyObject } from "node:crypto";
import { seal, unseal } from "./auth.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { PUSH_KINDS, type PushDevice, type PushKind, type PushSettings, type PushState } from "./shared.js";
import { clip, newId, now } from "./store.js";

/**
 * Real push notifications (Web Push), so a phone or a desktop hears about a bot even when Sklubot is closed.
 * Implemented from the standards, with no third-party library:
 *  - RFC 8030 (Generic Event Delivery Using HTTP Push): a POST to the subscription's endpoint, with a TTL header
 *    (section 5.2) and an Urgency header (section 5.3); 201 means accepted, 404/410 mean the subscription is gone.
 *  - RFC 8291 (Message Encryption for Web Push): ECDH P-256 + HKDF-SHA-256 with the subscription's auth secret, then
 *  - RFC 8188 (Encrypted Content-Encoding for HTTP), "aes128gcm", as a single record (RFC 8291 section 4).
 *  - RFC 8292 (VAPID): the server signs an ES256 JWT (aud = origin of the endpoint, exp ≤ 24 h, sub = contact) and
 *    sends `Authorization: vapid t=<jwt>, k=<public key>`.
 * The VAPID key pair is generated once and kept in the database, the private half sealed.
 * Delivery goes through guardedFetch like every other outgoing request: push services (fcm.googleapis.com,
 * updates.push.services.mozilla.com, web.push.apple.com, *.notify.windows.com…) are public hosts, so nothing is lost,
 * and an endpoint pointing into this server's own network is refused.
 */
const b64u = (b: Buffer) => b.toString("base64url");
const hmac = (key: Buffer, data: Buffer) => createHmac("sha256", key).update(data).digest();

// ── RFC 8291 / RFC 8188 encryption ───────────────────────────────────────────
/** Encrypts one push message for a subscription. `salt` and `senderPrivate` are only fixed in tests (RFC 8291 section 5 example). */
export function encryptPush(uaPublic: Buffer, authSecret: Buffer, plaintext: Buffer, fixed: { salt?: Buffer; senderPrivate?: Buffer } = {}): Buffer {
  const ecdh = createECDH("prime256v1");
  if (fixed.senderPrivate) ecdh.setPrivateKey(fixed.senderPrivate); else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey(); // uncompressed point, 65 octets
  const ecdhSecret = ecdh.computeSecret(uaPublic);
  const salt = fixed.salt ?? randomBytes(16);
  // RFC 8291 section 3.4: PRK_key = HMAC(auth_secret, ecdh_secret); IKM = HMAC(PRK_key, key_info || 0x01)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0", "latin1"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));
  // RFC 8188 section 2.2 / 2.3: PRK = HMAC(salt, IKM); CEK and NONCE from their info strings.
  const prk = hmac(salt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01", "latin1")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01", "latin1")).subarray(0, 12);
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // A single, last record: the plaintext, then the 0x02 delimiter (RFC 8188 section 2), no extra padding.
  const record = Buffer.concat([cipher.update(Buffer.concat([plaintext, Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  // Header (RFC 8188 section 2.1): salt (16) | rs (uint32) | idlen (1) | keyid = the sender's public key (RFC 8291 section 4).
  const header = Buffer.alloc(21);
  salt.copy(header, 0);
  header.writeUInt32BE(4096, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, record]);
}

// ── RFC 8292 VAPID ───────────────────────────────────────────────────────────
interface Vapid { publicKey: string; key: KeyObject }
let vapid: Vapid | null = null;

/** The server's VAPID key pair: made the first time it is needed, then read back from the database. */
export function vapidKeys(): Vapid {
  if (vapid) return vapid;
  let row = q.get<{ public: string; private_enc: string }>("SELECT public, private_enc FROM server_keys WHERE name = 'vapid'");
  if (!row) {
    const pair = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
    const jwk = pair.publicKey.export({ format: "jwk" }) as { x: string; y: string };
    const pub = b64u(Buffer.concat([Buffer.from([4]), Buffer.from(jwk.x, "base64url"), Buffer.from(jwk.y, "base64url")]));
    q.run("INSERT OR IGNORE INTO server_keys (name, public, private_enc, created_at) VALUES ('vapid', ?, ?, ?)", pub, seal(JSON.stringify(pair.privateKey.export({ format: "jwk" }))), now());
    row = q.get<{ public: string; private_enc: string }>("SELECT public, private_enc FROM server_keys WHERE name = 'vapid'")!;
  }
  const jwk = unseal(row.private_enc);
  if (!jwk) throw new Error("The push key cannot be opened (was SESSION_SECRET changed?).");
  vapid = { publicKey: row.public, key: createPrivateKey({ key: JSON.parse(jwk), format: "jwk" }) };
  return vapid;
}

/** Contact sent to push services in the token's `sub` claim (RFC 8292 section 2.1): VAPID_SUBJECT, else the public https address. */
function subject(): string {
  const set = (process.env.VAPID_SUBJECT ?? "").trim();
  if (/^(mailto:|https:)/i.test(set)) return set;
  return config.publicUrl.startsWith("https://") ? config.publicUrl : "mailto:push@sklubot.invalid";
}

export function vapidHeader(endpoint: string, at = Date.now()): string {
  const { publicKey, key } = vapidKeys();
  const head = b64u(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = b64u(Buffer.from(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(at / 1000) + 12 * 3600, sub: subject() })));
  // ES256 (RFC 7518 section 3.4): the signature is R || S, 64 octets, which Node gives with dsaEncoding "ieee-p1363".
  const sig = sign("sha256", Buffer.from(`${head}.${body}`), { key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${head}.${body}.${b64u(sig)}, k=${publicKey}`;
}

// ── Subscriptions and settings ───────────────────────────────────────────────
interface SubRow { id: string; user_id: string; endpoint: string; p256dh: string; auth_enc: string; label: string; enabled: number; created_at: number; last_ok_at: number | null; failures: number }
const toDevice = (r: SubRow): PushDevice => ({ id: r.id, label: r.label, enabled: !!r.enabled, createdAt: r.created_at, lastOkAt: r.last_ok_at, failures: r.failures });

export const DEFAULT_PUSH: PushSettings = { kinds: { needs: true, gem: true, reply: true, routine: true, computer: true }, quiet: { enabled: false, start: "22:00", end: "07:00", timezone: "UTC" } };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;

export function pushSettings(userId: string): PushSettings {
  const raw = q.get<{ push: string }>("SELECT push FROM settings WHERE user_id = ?", userId)?.push ?? "{}";
  let p: any = {};
  try { p = JSON.parse(raw); } catch { /* defaults */ }
  const kinds = { ...DEFAULT_PUSH.kinds };
  for (const k of PUSH_KINDS) if (typeof p?.kinds?.[k] === "boolean") kinds[k] = p.kinds[k];
  const qt = p?.quiet ?? {};
  return { kinds, quiet: { enabled: qt.enabled === true, start: HHMM.test(qt.start) ? qt.start : DEFAULT_PUSH.quiet.start, end: HHMM.test(qt.end) ? qt.end : DEFAULT_PUSH.quiet.end, timezone: typeof qt.timezone === "string" && qt.timezone ? qt.timezone : "UTC" } };
}
export function savePushSettings(userId: string, s: PushSettings) {
  q.run("UPDATE settings SET push = ? WHERE user_id = ?", JSON.stringify(s), userId);
}

export const push = {
  state: (userId: string): PushState => ({ publicKey: vapidKeys().publicKey, devices: push.devices(userId), settings: pushSettings(userId) }),
  devices: (userId: string) => q.all<SubRow>("SELECT * FROM push_subscriptions WHERE user_id = ? ORDER BY created_at", userId).map(toDevice),
  /** Saves (or takes over) a browser's subscription. The keys are checked for shape: a P-256 point and a 16-octet secret. */
  subscribe(userId: string, sub: { endpoint: unknown; keys?: { p256dh?: unknown; auth?: unknown } }, label: string): PushDevice {
    const endpoint = String(sub.endpoint ?? "");
    let url: URL;
    try { url = new URL(endpoint); } catch { throw new Error("That push subscription has no valid endpoint."); }
    const local = process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
    if (url.protocol !== "https:" && !(local && url.protocol === "http:")) throw new Error("Push endpoints must be https addresses.");
    if (endpoint.length > 2000) throw new Error("That push endpoint is too long.");
    const p256dh = Buffer.from(String(sub.keys?.p256dh ?? ""), "base64url");
    const auth = Buffer.from(String(sub.keys?.auth ?? ""), "base64url");
    if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) throw new Error("That push subscription has invalid keys.");
    const clean = clip(label.trim() || "Device", 60);
    const existing = q.get<SubRow>("SELECT * FROM push_subscriptions WHERE endpoint = ?", endpoint);
    if (existing) {
      q.run("UPDATE push_subscriptions SET user_id = ?, p256dh = ?, auth_enc = ?, label = ?, enabled = 1, failures = 0 WHERE id = ?", userId, b64u(p256dh), seal(b64u(auth)), clean, existing.id);
      return toDevice(q.get<SubRow>("SELECT * FROM push_subscriptions WHERE id = ?", existing.id)!);
    }
    const id = newId("psh");
    q.run("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_enc, label, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, endpoint, b64u(p256dh), seal(b64u(auth)), clean, now());
    return toDevice(q.get<SubRow>("SELECT * FROM push_subscriptions WHERE id = ?", id)!);
  },
  /** The device that holds this endpoint, for "this device" in the settings. */
  byEndpoint(userId: string, endpoint: string) { const r = q.get<SubRow>("SELECT * FROM push_subscriptions WHERE user_id = ? AND endpoint = ?", userId, endpoint); return r ? toDevice(r) : null; },
  update(userId: string, id: string, f: { enabled?: boolean; label?: string }): PushDevice | null {
    const r = q.get<SubRow>("SELECT * FROM push_subscriptions WHERE id = ? AND user_id = ?", id, userId);
    if (!r) return null;
    if (typeof f.enabled === "boolean") q.run("UPDATE push_subscriptions SET enabled = ? WHERE id = ?", f.enabled ? 1 : 0, id);
    if (typeof f.label === "string" && f.label.trim()) q.run("UPDATE push_subscriptions SET label = ? WHERE id = ?", clip(f.label.trim(), 60), id);
    return toDevice(q.get<SubRow>("SELECT * FROM push_subscriptions WHERE id = ?", id)!);
  },
  remove: (userId: string, id: string) => q.run("DELETE FROM push_subscriptions WHERE id = ? AND user_id = ?", id, userId).changes > 0,
  removeEndpoint: (userId: string, endpoint: string) => q.run("DELETE FROM push_subscriptions WHERE endpoint = ? AND user_id = ?", endpoint, userId).changes > 0,
};

// ── Is the user looking? ─────────────────────────────────────────────────────
/** Open app windows report whether they are visible (POST /presence). A reply is pushed only when none is. */
const presence = new Map<string, Map<string, { visible: boolean; at: number }>>();
const PRESENCE_MS = 75_000;
export function notePresence(userId: string, clientId: string, visible: boolean) {
  let m = presence.get(userId);
  if (!m) presence.set(userId, (m = new Map()));
  m.set(clip(clientId, 64), { visible, at: Date.now() });
  if (m.size > 50) { const oldest = [...m.entries()].sort((a, b) => a[1].at - b[1].at)[0]; m.delete(oldest[0]); }
}
export function appVisible(userId: string): boolean {
  const cut = Date.now() - PRESENCE_MS;
  return [...(presence.get(userId)?.values() ?? [])].some((p) => p.visible && p.at > cut);
}

/** Inside the user's quiet hours right now (local time in their timezone). */
export function inQuietHours(s: PushSettings, at = new Date()): boolean {
  if (!s.quiet.enabled) return false;
  let hm: string;
  try { hm = new Intl.DateTimeFormat("en-GB", { timeZone: s.quiet.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(at); } catch { return false; }
  const { start, end } = s.quiet;
  return start <= end ? hm >= start && hm < end : hm >= start || hm < end;
}

// ── Sending ──────────────────────────────────────────────────────────────────
export interface PushMessage { kind: PushKind | "test"; title: string; body: string; botId?: string; tag?: string }
const recent = new Map<string, number>();

/**
 * Sends a notification to every enabled device of a user, unless that kind is switched off, it is quiet hours
 * (a test always goes), or the same notification just went. Returns how many devices accepted it.
 */
export async function sendPush(userId: string, msg: PushMessage): Promise<number> {
  const settings = pushSettings(userId);
  if (msg.kind !== "test" && (!settings.kinds[msg.kind] || inQuietHours(settings))) return 0;
  const subs = q.all<SubRow>("SELECT * FROM push_subscriptions WHERE user_id = ? AND enabled = 1", userId);
  if (!subs.length) return 0;
  const tag = msg.tag ?? (msg.botId ? `${msg.kind}-${msg.botId}` : msg.kind);
  const key = `${userId}:${tag}:${msg.body}`;
  if (msg.kind !== "test" && (recent.get(key) ?? 0) > Date.now() - 10_000) return 0;
  recent.set(key, Date.now());
  if (recent.size > 2000) for (const [k, v] of recent) if (v < Date.now() - 60_000) recent.delete(k);
  // Kept well under the 4096 octets a push service must accept (RFC 8030 section 7.2 / RFC 8291 section 4).
  const payload = Buffer.from(JSON.stringify({ kind: msg.kind, title: clip(msg.title, 80), body: clip(msg.body.replace(/\s+/g, " ").trim(), 300), botId: msg.botId ?? null, tag, url: msg.botId ? `/?bot=${encodeURIComponent(msg.botId)}` : "/" }));
  let ok = 0;
  await Promise.all(subs.map(async (s) => {
    const auth = unseal(s.auth_enc);
    if (!auth) return;
    try {
      const res = await guardedFetch(s.endpoint, {
        method: "POST", redirect: "manual", signal: AbortSignal.timeout(15_000),
        headers: {
          ttl: String(msg.kind === "needs" ? 3600 : 24 * 3600), urgency: msg.kind === "needs" || msg.kind === "test" ? "high" : "normal",
          "content-encoding": "aes128gcm", "content-type": "application/octet-stream", authorization: vapidHeader(s.endpoint),
        },
        body: new Uint8Array(encryptPush(Buffer.from(s.p256dh, "base64url"), Buffer.from(auth, "base64url"), payload)),
      });
      await res.body?.cancel().catch(() => {});
      if (res.status === 404 || res.status === 410) { q.run("DELETE FROM push_subscriptions WHERE id = ?", s.id); return; }
      if (res.status >= 200 && res.status < 300) { ok++; q.run("UPDATE push_subscriptions SET last_ok_at = ?, failures = 0 WHERE id = ?", now(), s.id); return; }
      q.run("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", s.id);
    } catch (err) {
      q.run("UPDATE push_subscriptions SET failures = failures + 1 WHERE id = ?", s.id);
      if (!fetchProblem(err)) console.error("[push]", (err as Error)?.message ?? err);
    }
  }));
  return ok;
}

/** Fire and forget, for the places a bot does something worth a notification. */
export function pushLater(userId: string, msg: PushMessage) {
  void sendPush(userId, msg).catch((err) => console.error("[push]", err));
}
