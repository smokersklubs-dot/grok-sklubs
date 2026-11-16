import { createHash, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { readdirSync, statSync } from "node:fs";
import type { IncomingMessage } from "node:http";
import path from "node:path";
import type { Duplex } from "node:stream";
import { WebSocketServer, type RawData, type WebSocket } from "ws";
import { originAllowed, parseCookies, SESSION_COOKIE, userForToken } from "./auth.js";
import { emit } from "./bus.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { pushLater } from "./push.js";
import type { AppDownloads, DesktopDownload, Locale, RelayDevice, RelayDownloads } from "./shared.js";
import { audit, bots, clip, now, randomToken, rows, sha256, users, type UserRecord } from "./store.js";

/**
 * Server side of Sklubot Relais, protocol v1 (docs/RELAIS-PROTOCOLE.md). The relay is a small desktop app on the
 * user's own computer that opens one outgoing WebSocket to GET /api/relay/connect. Everything the server can ask of
 * it goes through `req` messages; consent is decided on the computer, never here (§1, §10). The server adds its own
 * approval cards on top (agent/mycomputer.ts).
 *
 * Robustness rules, as for the live screens (vnc.ts): whatever a connection sends — binary, broken JSON, a flood,
 * a message out of turn — it is answered with a close code, never with an exception that reaches the process.
 * The ws library (https://github.com/websockets/ws/blob/master/doc/ws.md) answers pings by itself and enforces
 * `maxPayload` (it closes with 1009 above it).
 */

export const CONNECT_PATH = "/api/relay/connect";
const VIEW_PATH = /^\/api\/relay\/devices\/([A-Za-z0-9_.:-]{1,64})\/view$/;
/** Relay → server messages may reach 4 MiB (§2); a little room for the JSON around a capture. */
const MAX_PAYLOAD = 5 * 1024 * 1024;
/** Server → relay messages above 256 KiB make the relay close the socket (§2): never send one. */
const MAX_OUTBOUND = 256 * 1024;
const HELLO_TIMEOUT_MS = 10_000;
const PAIR_TTL_MS = 10 * 60_000;
const PAIR_CODES_PER_CONNECTION = 3;
const ACK_TIMEOUT_MS = 30_000;
const PING_EVERY_MS = 30_000;
const ROTATE_EVERY_MS = 24 * 3600_000;
const FLOOD_PER_SEC = 200;
const MAX_UNAUTHENTICATED = 500;
const MAX_UNAUTHENTICATED_PER_IP = 10;
/** The pairing alphabet has no look-alikes (0/O, 1/I/L) (§4). */
const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const RELEASES_URL = "https://github.com/smokersklubs-dot/grok-sklubs/releases";

export const CLOSE = { NORMAL: 1000, TRY_LATER: 1013, UNAUTHORIZED: 4001, REVOKED: 4003, PAIR_EXPIRED: 4004, FLOOD: 4008, VERSION: 4009, REPLACED: 4010, INVALID: 4400 } as const;

type Json = Record<string, unknown>;
const isObj = (v: unknown): v is Json => !!v && typeof v === "object" && !Array.isArray(v);
const str = (v: unknown, max: number) => (typeof v === "string" ? v : "").replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩​-‏]/g, "").trim().slice(0, max);
const num = (v: unknown, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, v)) : null);
const BOT_ID = /^[A-Za-z0-9_.:-]{1,64}$/;

// ── Stored devices ───────────────────────────────────────────────────────────
interface DeviceRow {
  id: string; user_id: string; name: string; platform: string; arch: string; os_release: string; app_version: string; kind: string;
  token_hash: string; pending_hash: string | null; rotated_at: number; created_at: number; last_seen_at: number | null;
}
export const devices = {
  byId: (id: string) => q.get<DeviceRow>("SELECT * FROM relay_devices WHERE id = ?", id) ?? null,
  owned: (userId: string, id: string) => q.get<DeviceRow>("SELECT * FROM relay_devices WHERE id = ? AND user_id = ?", id, userId) ?? null,
  list: (userId: string) => q.all<DeviceRow>("SELECT * FROM relay_devices WHERE user_id = ? ORDER BY created_at", userId),
  count: (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM relay_devices WHERE user_id = ?", userId)?.n ?? 0,
};

/** Constant-time comparison of two hex digests. */
function sameHash(a: string, b: string | null): boolean {
  if (!b) return false;
  const x = Buffer.from(a, "hex");
  const y = Buffer.from(b, "hex");
  return x.length === y.length && x.length > 0 && timingSafeEqual(x, y);
}

function pairingCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += ALPHABET[randomInt(ALPHABET.length)];
  return s;
}
/** What the user typed → the stored form (8 characters, no dash, no spaces, upper case). */
export const normaliseCode = (raw: string) => String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

// ── Live connections ─────────────────────────────────────────────────────────
export interface RelayBot { id: string; name: string }
/** Protocol 1.2 (§13): the Android app says `device.kind: "phone"`; everything else is a computer. */
export type DeviceKind = "computer" | "phone";
const kindOf = (v: unknown): DeviceKind => (v === "phone" ? "phone" : "computer");
export type RelayResult = { ok: true; result: Json } | { ok: false; code: string; message: string; retryAfterMs?: number };
interface Pending { op: string; bot: RelayBot; finish: (r: RelayResult) => void }
interface Session { botId: string; botName: string; grant: "once" | "always" | "test"; since: number; sessionId: string }
interface Frame { seq: number; width: number; height: number; data: string; at: number }

const connections = new Set<Conn>();
/** The authenticated connection of each device (one at a time, §11). */
const online = new Map<string, Conn>();
/** Pending pairing codes → the connection that asked for them. */
const codes = new Map<string, Conn>();
/** Devices whose relay said bye (paused on the computer), until they connect again. In memory: after a restart they read as offline. */
const pausedAt = new Map<string, number>();
/** The last picture seen of each device (live view or a bot's screenshot), for viewers that join later. */
const lastFrames = new Map<string, Frame>();
let reqSeq = 0;

class Conn {
  phase: "hello" | "pairing" | "paired" | "online" | "closed" = "hello";
  deviceId = "";
  userId = "";
  info = { name: "", platform: "", arch: "", osRelease: "", appVersion: "", kind: "computer" as DeviceKind, capabilities: [] as string[], screen: null as { width: number; height: number } | null };
  locked = false;
  session: Session | null = null;
  asking: RelayDevice["asking"] = null;
  pending = new Map<string, Pending>();
  code: string | null = null;
  codesIssued = 0;
  rotating: string | null = null;
  rotatedAt = 0;
  view: { id: string | null; starting: boolean } | null = null;
  /** Frames forwarded to viewers and not yet acknowledged by all of them: seq → viewers still to answer. */
  frameWaits = new Map<number, { viewId: string; waiting: Set<Viewer>; timer: NodeJS.Timeout }>();
  viewRetry = 0;
  /** The last screenshot size, to turn coordinates in the picture into screen coordinates. */
  lastCapture: { width: number; height: number; screenWidth: number; screenHeight: number } | null = null;
  /** The user pressed "Stop" in the web app: the next session.ended is theirs. */
  stoppedFromWeb = false;
  lastBotId = "";
  alive = true;
  floodAt = 0;
  floodCount = 0;
  timer: NodeJS.Timeout | null = null;
  constructor(public ws: WebSocket, public ip: string) {}

  send(msg: Json): boolean {
    if (this.ws.readyState !== this.ws.OPEN) return false;
    const s = JSON.stringify(msg);
    if (Buffer.byteLength(s) > MAX_OUTBOUND) { console.error("[relay] message too large for the relay, not sent:", String(msg.type)); return false; }
    try { this.ws.send(s); return true; } catch { return false; }
  }

  close(code: number, reason: string) {
    if (this.phase === "closed") return;
    try { this.ws.close(code, reason.slice(0, 120)); } catch { /* already gone */ }
    // A peer that does not finish the closing handshake is cut off.
    setTimeout(() => { try { this.ws.terminate(); } catch { /* gone */ } }, 3000).unref();
  }
}

// ── Upgrade handlers (called from vnc.ts's single upgrade listener) ──────────
const deviceWss = new WebSocketServer({ noServer: true, maxPayload: MAX_PAYLOAD, perMessageDeflate: false });
const viewerWss = new WebSocketServer({ noServer: true, maxPayload: 64 * 1024, perMessageDeflate: false });

function refuse(socket: Duplex, status: number, text: string) {
  try { socket.write(`HTTP/1.1 ${status} ${text}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); } catch { /* closed */ }
  socket.destroy();
}

/** The client's address, as routes.ts reads it: behind our proxy (TRUST_PROXY=1), the last X-Forwarded-For entry. */
function ipOf(req: IncomingMessage): string {
  if (config.trustProxy) {
    const last = String(req.headers["x-forwarded-for"] ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? "local";
}

/** True when the request was one of ours (handled or refused); false lets the next handler look at it. */
export function relayUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): boolean {
  const pathname = new URL(req.url ?? "/", "http://local").pathname;
  if (pathname === CONNECT_PATH) {
    // The relay is a desktop app and sends no Origin. A web page always does: none may open a device connection
    // (a page could otherwise show a pairing code of its own and talk someone into typing it).
    if (req.headers.origin) { refuse(socket, 403, "Forbidden"); return true; }
    deviceWss.handleUpgrade(req, socket, head, (ws) => onDevice(ws, ipOf(req)));
    return true;
  }
  const view = VIEW_PATH.exec(pathname);
  if (view) {
    if (!originAllowed(req.headers.origin, req.headers.host)) { refuse(socket, 403, "Forbidden"); return true; }
    const user = userForToken(parseCookies(req.headers.cookie)[SESSION_COOKIE]);
    if (!user) { refuse(socket, 401, "Unauthorized"); return true; }
    const device = devices.owned(user.id, view[1]);
    if (!device) { refuse(socket, 404, "Not Found"); return true; }
    viewerWss.handleUpgrade(req, socket, head, (ws) => onViewer(ws, device));
    return true;
  }
  return false;
}

function onDevice(ws: WebSocket, ip: string) {
  const conn = new Conn(ws, ip);
  connections.add(conn);
  ws.on("error", () => { /* a broken peer: the close handler cleans up */ });
  ws.on("pong", () => { conn.alive = true; });
  const unauthenticated = [...connections].filter((c) => c.phase === "hello" || c.phase === "pairing" || c.phase === "paired");
  if (unauthenticated.length > MAX_UNAUTHENTICATED || unauthenticated.filter((c) => c.ip === ip).length > MAX_UNAUTHENTICATED_PER_IP) {
    conn.close(CLOSE.TRY_LATER, "too many connections");
  }
  conn.timer = setTimeout(() => { if (conn.phase === "hello") conn.close(CLOSE.INVALID, "hello expected"); }, HELLO_TIMEOUT_MS);
  ws.on("message", (data: RawData, isBinary: boolean) => {
    try { onMessage(conn, data, isBinary); } catch (err) {
      console.error("[relay]", (err as Error)?.message ?? err);
      conn.close(CLOSE.INVALID, "invalid message");
    }
  });
  ws.on("close", () => { try { onClosed(conn); } catch (err) { console.error("[relay] close", err); } });
}

const textOf = (data: RawData) => (Array.isArray(data) ? Buffer.concat(data) : Buffer.from(data as ArrayBuffer)).toString("utf8");
const BASE64 = /^[A-Za-z0-9+/]*={0,2}$/;

function onMessage(conn: Conn, data: RawData, isBinary: boolean) {
  if (conn.phase === "closed") return;
  const t = Date.now();
  if (t - conn.floodAt > 1000) { conn.floodAt = t; conn.floodCount = 0; }
  if (++conn.floodCount > FLOOD_PER_SEC) return conn.close(CLOSE.FLOOD, "too many messages");
  if (isBinary) return conn.close(CLOSE.INVALID, "binary messages are not used by protocol v1");
  let msg: unknown;
  try { msg = JSON.parse(textOf(data)); } catch { return conn.close(CLOSE.INVALID, "invalid JSON"); }
  if (!isObj(msg) || typeof msg.type !== "string") return conn.close(CLOSE.INVALID, "missing type");
  if (conn.phase === "hello") {
    if (msg.type !== "hello") return conn.close(CLOSE.INVALID, "hello expected");
    return onHello(conn, msg);
  }
  switch (msg.type) {
    case "hello": return conn.close(CLOSE.INVALID, "hello sent twice");
    case "token.ack": return onTokenAck(conn, msg);
    case "res": if (conn.phase === "online") onRes(conn, msg); return;
    case "frame": if (conn.phase === "online") onFrame(conn, msg); return;
    case "event": if (conn.phase === "online") onEvent(conn, msg); return;
    case "bye": if (conn.deviceId) pausedAt.set(conn.deviceId, now()); return;
    default: return; // unknown types are ignored (§1)
  }
}

// ── Hello, pairing, tokens ───────────────────────────────────────────────────
function onHello(conn: Conn, msg: Json) {
  if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }
  if (msg.v !== 1) return conn.close(CLOSE.VERSION, "unsupported version");
  const device = isObj(msg.device) ? msg.device : {};
  const app = isObj(msg.app) ? msg.app : {};
  const screen = isObj(msg.screen) ? msg.screen : {};
  const w = num(screen.width, 1, 100_000);
  const h = num(screen.height, 1, 100_000);
  conn.info = {
    name: str(device.name, 60) || "?", platform: str(device.platform, 20), arch: str(device.arch, 20), osRelease: str(device.osRelease, 40), appVersion: str(app.version, 20), kind: kindOf(device.kind),
    capabilities: Array.isArray(msg.capabilities) ? msg.capabilities.filter((c): c is string => typeof c === "string" && /^[a-z.]{1,40}$/.test(c)).slice(0, 64) : [],
    screen: w && h ? { width: Math.round(w), height: Math.round(h) } : null,
  };
  conn.locked = isObj(msg.state) && msg.state.locked === true;
  if (msg.auth === null || msg.auth === undefined) return startPairing(conn);
  const auth = msg.auth;
  if (!isObj(auth) || typeof auth.deviceId !== "string" || typeof auth.token !== "string" || auth.deviceId.length > 64 || auth.token.length > 512) return conn.close(CLOSE.UNAUTHORIZED, "unauthorized");
  const row = devices.byId(auth.deviceId);
  if (!row) return conn.close(CLOSE.UNAUTHORIZED, "unauthorized");
  const given = sha256(auth.token);
  if (sameHash(given, row.token_hash)) {
    // The relay kept the old token: a rotation it never saved is dropped.
    if (row.pending_hash) q.run("UPDATE relay_devices SET pending_hash = NULL WHERE id = ?", row.id);
  } else if (sameHash(given, row.pending_hash)) {
    // The relay saved the new token but its acknowledgement was lost: the new one is the token from now on.
    q.run("UPDATE relay_devices SET token_hash = pending_hash, pending_hash = NULL, rotated_at = ? WHERE id = ?", now(), row.id);
    row.rotated_at = now();
  } else return conn.close(CLOSE.UNAUTHORIZED, "unauthorized");
  goOnline(conn, row, true);
}

function goOnline(conn: Conn, row: DeviceRow, rotate: boolean) {
  conn.phase = "online";
  conn.deviceId = row.id;
  conn.userId = row.user_id;
  conn.rotatedAt = row.rotated_at;
  const older = online.get(row.id);
  online.set(row.id, conn);
  pausedAt.delete(row.id);
  if (older && older !== conn) older.close(CLOSE.REPLACED, "replaced by a newer connection");
  // The kind stays what it was at pairing: a computer's token cannot turn it into a phone, or the reverse.
  conn.info.kind = kindOf(row.kind);
  q.run("UPDATE relay_devices SET name = ?, platform = ?, arch = ?, os_release = ?, app_version = ?, last_seen_at = ? WHERE id = ?",
    conn.info.name, conn.info.platform, conn.info.arch, conn.info.osRelease, conn.info.appVersion, now(), row.id);
  conn.send({ type: "welcome", v: 1, deviceId: row.id, serverName: serverName(row.user_id) });
  if (rotate) rotateToken(conn);
  announce(row.user_id);
}

function serverName(userId: string): string {
  const u = users.byId(userId);
  return clip(u ? tr(u.locale, "{name}'s Sklubot", { name: u.name }) : "Sklubot", 80);
}

function startPairing(conn: Conn) {
  const fromHere = [...codes.values()].filter((c) => c.ip === conn.ip).length;
  if (codes.size >= MAX_UNAUTHENTICATED || fromHere >= 5) return conn.close(CLOSE.TRY_LATER, "too many pairings under way");
  conn.phase = "pairing";
  issueCode(conn);
}

function issueCode(conn: Conn) {
  if (conn.code) codes.delete(conn.code);
  conn.code = null;
  if (conn.phase !== "pairing") return;
  if (conn.codesIssued >= PAIR_CODES_PER_CONNECTION) return conn.close(CLOSE.PAIR_EXPIRED, "pairing code expired");
  conn.codesIssued++;
  let code = pairingCode();
  while (codes.has(code)) code = pairingCode();
  conn.code = code;
  codes.set(code, conn);
  conn.send({ type: "pair.code", code: `${code.slice(0, 4)}-${code.slice(4)}`, expiresAt: new Date(now() + PAIR_TTL_MS).toISOString() });
  if (conn.timer) clearTimeout(conn.timer);
  conn.timer = setTimeout(() => issueCode(conn), PAIR_TTL_MS);
  conn.timer.unref();
}

/**
 * The user typed a code in the web app. Every pending code is compared, in constant time, so the answer takes as long
 * whether a code exists or not. Returns the new device, or null when no pending code matches.
 */
export function confirmPairing(user: UserRecord, typed: string): RelayDevice | null {
  const wanted = createHash("sha256").update(normaliseCode(typed)).digest();
  let found: Conn | null = null;
  for (const [code, conn] of codes) {
    if (timingSafeEqual(createHash("sha256").update(code).digest(), wanted)) found = conn;
  }
  if (!found || found.phase !== "pairing" || found.ws.readyState !== found.ws.OPEN) return null;
  // Single use: the code is gone whatever happens next.
  if (found.code) codes.delete(found.code);
  found.code = null;
  if (found.timer) clearTimeout(found.timer);
  const id = `dev_${randomBytes(6).toString("hex")}`;
  const token = randomToken(32);
  const t = now();
  // The device exists from now on with this token: if the acknowledgement is lost, the relay (which saves the token
  // before acknowledging) can still come back with it.
  q.run("INSERT INTO relay_devices (id, user_id, name, platform, arch, os_release, app_version, kind, token_hash, rotated_at, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, user.id, found.info.name, found.info.platform, found.info.arch, found.info.osRelease, found.info.appVersion, found.info.kind, sha256(token), t, t, t);
  found.phase = "paired";
  found.deviceId = id;
  found.userId = user.id;
  found.send({ type: "paired", deviceId: id, token, serverName: serverName(user.id) });
  const conn = found;
  conn.timer = setTimeout(() => { if (conn.phase === "paired") conn.close(CLOSE.NORMAL, "no acknowledgement"); }, ACK_TIMEOUT_MS);
  conn.timer.unref();
  const label = deviceLabel(found.info.name, found.info.platform);
  const linked = found.info.kind === "phone" ? "Phone linked" : "Computer linked";
  audit(user.id, "computer", `${tr(user.locale, linked)}: ${label}`);
  pushLater(user.id, { kind: "computer", title: tr(user.locale, linked), body: tr(user.locale, "{device} is now linked to your Sklubot. Remove it in Settings → Computers if it wasn't you.", { device: label }), tag: `relay-${id}` });
  announce(user.id);
  return listDevices(user.id).find((d) => d.id === id) ?? null;
}

const PLATFORMS: Record<string, string> = { darwin: "macOS", win32: "Windows", linux: "Linux", android: "Android" };
const deviceLabel = (name: string, platform: string) => `${name}${PLATFORMS[platform] ? ` (${PLATFORMS[platform]})` : platform ? ` (${platform})` : ""}`;

function onTokenAck(conn: Conn, msg: Json) {
  if (msg.deviceId !== conn.deviceId || !conn.deviceId) return;
  if (conn.phase === "paired") {
    if (conn.timer) { clearTimeout(conn.timer); conn.timer = null; }
    const row = devices.byId(conn.deviceId);
    if (!row) return conn.close(CLOSE.REVOKED, "revoked");
    return goOnline(conn, row, false);
  }
  if (conn.phase === "online" && conn.rotating) {
    // Only now is the old token given up (§5): a cut at the wrong moment must not lock the device out.
    q.run("UPDATE relay_devices SET token_hash = pending_hash, pending_hash = NULL, rotated_at = ? WHERE id = ? AND pending_hash = ?", now(), conn.deviceId, conn.rotating);
    conn.rotating = null;
    conn.rotatedAt = now();
  }
}

function rotateToken(conn: Conn) {
  if (conn.phase !== "online" || conn.rotating) return;
  const token = randomToken(32);
  const hash = sha256(token);
  q.run("UPDATE relay_devices SET pending_hash = ? WHERE id = ?", hash, conn.deviceId);
  conn.rotating = hash;
  conn.send({ type: "token.rotate", token });
}

// ── Requests ─────────────────────────────────────────────────────────────────
function onRes(conn: Conn, msg: Json) {
  if (typeof msg.id !== "string") return;
  const p = conn.pending.get(msg.id);
  if (!p) return;
  conn.pending.delete(msg.id);
  if (msg.ok === true) {
    const result = isObj(msg.result) ? msg.result : {};
    if (p.op === "session.start" && typeof result.sessionId === "string" && (!conn.session || conn.session.botId !== p.bot.id)) {
      setSession(conn, { botId: p.bot.id, botName: p.bot.name, grant: grantOf(result.grant), since: now(), sessionId: str(result.sessionId, 64) });
    }
    if (p.op === "screen.capture") noteCapture(conn, result);
    return p.finish({ ok: true, result });
  }
  const e = isObj(msg.error) ? msg.error : {};
  const code = str(e.code, 40) || "internal";
  const retry = num(e.retryAfterMs, 0, 24 * 3600_000);
  if (code === "locked" && !conn.locked) { conn.locked = true; announce(conn.userId); }
  if (code === "no_session" && conn.session?.botId === p.bot.id) setSession(conn, null);
  p.finish({ ok: false, code, message: str(e.message, 500) || code, ...(retry !== null ? { retryAfterMs: retry } : {}) });
}

const grantOf = (g: unknown): Session["grant"] => (g === "always" || g === "test" ? g : "once");

function noteCapture(conn: Conn, r: Json) {
  const width = num(r.width, 1, 100_000), height = num(r.height, 1, 100_000);
  const sw = num(r.screenWidth, 1, 100_000), sh = num(r.screenHeight, 1, 100_000);
  if (width && height) conn.lastCapture = { width, height, screenWidth: sw ?? width, screenHeight: sh ?? height };
  if (typeof r.data === "string" && r.format !== "png" && width && height && BASE64.test(r.data)) {
    const at = now();
    lastFrames.set(conn.deviceId, { seq: 0, width, height, data: r.data, at });
    // Without a live view (a phone has none), whoever watches sees each screenshot the bot takes.
    if (!conn.view) tellViewers(conn.deviceId, { type: "frame", seq: 0, width, height, data: r.data, at, still: true });
  }
}

/**
 * Sends one request to a device and waits for its answer. Never throws: an offline device, a timeout or a stop
 * become a result with a code. Only shell.run can be cancelled on the computer (§6).
 */
export function relayRequest(deviceId: string, bot: RelayBot, op: string, args: Json, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RelayResult> {
  const conn = online.get(deviceId);
  if (!conn || conn.phase !== "online") return Promise.resolve({ ok: false, code: "offline", message: "the computer is not connected" });
  if (!BOT_ID.test(bot.id)) return Promise.resolve({ ok: false, code: "invalid_args", message: "invalid bot id" });
  const id = `r${++reqSeq}`;
  conn.lastBotId = bot.id;
  return new Promise((resolve) => {
    const finish = (r: RelayResult) => { clearTimeout(timer); opts.signal?.removeEventListener("abort", onAbort); conn.pending.delete(id); resolve(r); };
    const onAbort = () => { if (op === "shell.run") conn.send({ type: "cancel", id }); finish({ ok: false, code: "stopped", message: "stopped" }); };
    const timer = setTimeout(() => { if (op === "shell.run") conn.send({ type: "cancel", id }); finish({ ok: false, code: "timeout", message: "no answer from the computer in time" }); }, opts.timeoutMs ?? 30_000);
    if (opts.signal?.aborted) return onAbort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });
    conn.pending.set(id, { op, bot, finish });
    if (!conn.send({ type: "req", id, bot: { id: bot.id, name: clip(str(bot.name, 60) || bot.id, 60) }, op, args })) finish({ ok: false, code: "offline", message: "the computer is not connected" });
  });
}

// ── Events from the relay ────────────────────────────────────────────────────
function botOf(v: unknown): RelayBot | null {
  if (!isObj(v) || typeof v.id !== "string" || !BOT_ID.test(v.id)) return null;
  return { id: v.id, name: str(v.name, 60) || v.id };
}

const REASONS: Record<string, string> = {
  bot: "the bot released it", user_stop: "you pressed Stop on the computer", hotkey: "you pressed the Stop shortcut on the computer", idle: "nothing happened for 15 minutes",
  paused: "the relay was paused on the computer", disconnected: "the connection was lost", stopped: "the relay was closed",
};

function onEvent(conn: Conn, msg: Json) {
  const name = typeof msg.name === "string" ? msg.name : "";
  const bot = botOf(msg.bot);
  const user = users.byId(conn.userId);
  if (!user) return;
  const loc = user.locale;
  const device = devices.byId(conn.deviceId);
  const label = deviceLabel(device?.name ?? conn.info.name, conn.info.platform);
  switch (name) {
    case "relay.state":
      conn.locked = msg.locked === true;
      if (msg.session === null) setSession(conn, null, false);
      return announce(conn.userId);
    case "consent.requested":
      if (!bot) return;
      conn.asking = { botId: bot.id, botName: bot.name, kind: msg.kind === "command" ? "command" : "session", since: now() };
      announce(conn.userId);
      pushLater(user.id, { kind: "computer", title: label, body: tr(loc, msg.kind === "command" ? "{bot} asks to run a command: answer on that computer." : "{bot} asks to control this computer: answer on that computer.", { bot: bot.name }), botId: ownBotId(user.id, bot.id) ?? undefined, tag: `relay-${conn.deviceId}` });
      return;
    case "consent.decided": {
      conn.asking = null;
      announce(conn.userId);
      const d = String(msg.decision ?? "");
      if (bot && (d === "refuse" || d === "expired")) {
        const text = tr(loc, msg.kind === "command" ? (d === "refuse" ? "The command was refused on {device}." : "Nobody answered the command question on {device}.") : (d === "refuse" ? "Control of {device} was refused on the computer." : "Nobody answered the control question on {device}."), { device: label });
        chatLine(user.id, bot.id, text, "warn");
        audit(user.id, "computer", `${bot.name} : ${text}`, ownBotId(user.id, bot.id));
      }
      return;
    }
    case "session.started": {
      if (!bot) return;
      const grant = grantOf(msg.grant);
      setSession(conn, { botId: bot.id, botName: bot.name, grant, since: now(), sessionId: str(msg.sessionId, 64) });
      conn.lastBotId = bot.id;
      const text = tr(loc, grant === "always" ? "{bot} took control of {device} (always allowed on that computer)." : "{bot} took control of {device}.", { bot: bot.name, device: label });
      chatLine(user.id, bot.id, text, "info");
      audit(user.id, "computer", text, ownBotId(user.id, bot.id));
      pushLater(user.id, { kind: "computer", title: label, body: text, botId: ownBotId(user.id, bot.id) ?? undefined, tag: `relay-${conn.deviceId}` });
      return;
    }
    case "session.ended": {
      const was = conn.session;
      setSession(conn, null);
      const who = bot ?? (was ? { id: was.botId, name: was.botName } : null);
      if (!who) return;
      const reason = String(msg.reason ?? "");
      const fromWeb = conn.stoppedFromWeb;
      conn.stoppedFromWeb = false;
      const text = fromWeb ? tr(loc, "You stopped {bot}'s control of {device} from Sklubot.", { bot: who.name, device: label })
        : tr(loc, "{bot}'s control of {device} ended: {reason}.", { bot: who.name, device: label, reason: tr(loc, REASONS[reason] ?? "it ended") });
      chatLine(user.id, who.id, text, reason === "user_stop" || reason === "hotkey" ? "warn" : "info");
      audit(user.id, "computer", text, ownBotId(user.id, who.id));
      if (reason !== "bot" || fromWeb) pushLater(user.id, { kind: "computer", title: label, body: text, botId: ownBotId(user.id, who.id) ?? undefined, tag: `relay-${conn.deviceId}` });
      return;
    }
    case "relay.locked": {
      conn.locked = true;
      announce(conn.userId);
      const text = tr(loc, "Stop was pressed on {device}: bots can no longer use it until you allow control again on that computer.", { device: label });
      if (conn.lastBotId) chatLine(user.id, conn.lastBotId, text, "warn");
      audit(user.id, "computer", text, conn.lastBotId ? ownBotId(user.id, conn.lastBotId) : null);
      pushLater(user.id, { kind: "computer", title: label, body: text, tag: `relay-${conn.deviceId}` });
      return;
    }
    case "relay.unlocked":
      conn.locked = false;
      audit(user.id, "computer", tr(loc, "Control allowed again on {device}.", { device: label }));
      return announce(conn.userId);
    case "view.stopped": {
      if (conn.view && (conn.view.id === null || conn.view.id === msg.viewId)) {
        conn.view = null;
        clearFrameWaits(conn);
        tellViewers(conn.deviceId, { type: "status", view: "stopped", reason: str(msg.reason, 30) });
        // A viewer that fell behind made the relay give up: start again once, if someone still watches.
        if (msg.reason === "no_ack" && conn.viewRetry++ < 3) setTimeout(() => ensureView(conn), 1000).unref();
      }
      return;
    }
    default:
      return;
  }
}

function ownBotId(userId: string, botId: string): string | null {
  return bots.owned(userId, botId) ? botId : null;
}

/** A line in the bot's own chat (only for the user's own bots: a relay cannot write into anyone's chat). */
function chatLine(userId: string, botId: string, text: string, tone: "info" | "warn") {
  const bot = bots.owned(userId, botId);
  if (!bot || bot.kind !== "agent") return;
  rows.append(bot, { kind: "event", event: "relay", text, tone }, 0);
}

function setSession(conn: Conn, s: Session | null, tell = true) {
  conn.session = s;
  if (!s) {
    conn.view = null;
    clearFrameWaits(conn);
    tellViewers(conn.deviceId, { type: "status", view: "stopped", reason: "session_ended" });
  }
  if (tell) announce(conn.userId);
  if (s) ensureView(conn);
}

// ── Live view (§8) ───────────────────────────────────────────────────────────
interface Viewer { ws: WebSocket; deviceId: string; userId: string }
const viewers = new Map<string, Set<Viewer>>();

function onViewer(ws: WebSocket, device: DeviceRow) {
  const v: Viewer = { ws, deviceId: device.id, userId: device.user_id };
  let set = viewers.get(device.id);
  if (!set) viewers.set(device.id, (set = new Set()));
  set.add(v);
  ws.on("error", () => {});
  const conn = online.get(device.id);
  const last = lastFrames.get(device.id);
  const sendTo = (m: Json) => { try { if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(m)); } catch { /* gone */ } };
  // A phone (protocol 1.2) offers no live view: its viewers get the last screenshot a bot took.
  sendTo({ type: "status", view: conn?.view?.id ? "live" : conn?.session && conn.info.capabilities.includes("view.start") ? "starting" : "idle" });
  if (last) sendTo({ type: "frame", seq: 0, width: last.width, height: last.height, data: last.data, at: last.at, still: true });
  ws.on("message", (data: RawData, isBinary: boolean) => {
    if (isBinary) return;
    let m: unknown;
    try { m = JSON.parse(textOf(data)); } catch { return; }
    if (isObj(m) && m.type === "ack" && typeof m.seq === "number") viewerAck(v, m.seq);
  });
  ws.on("close", () => {
    set!.delete(v);
    if (!set!.size) viewers.delete(device.id);
    const c = online.get(device.id);
    if (c) { for (const seq of [...c.frameWaits.keys()]) viewerAck(v, seq, true); if (!viewers.get(device.id)?.size) stopView(c); }
  });
  if (conn) { conn.viewRetry = 0; ensureView(conn); }
}

function tellViewers(deviceId: string, m: Json) {
  const s = JSON.stringify(m);
  for (const v of viewers.get(deviceId) ?? []) { try { if (v.ws.readyState === v.ws.OPEN) v.ws.send(s); } catch { /* gone */ } }
}

/** Start the live view when someone watches and a session is open; nobody watching → no view (§8). */
function ensureView(conn: Conn) {
  if (conn.phase !== "online" || !conn.session || conn.locked || conn.view || !viewers.get(conn.deviceId)?.size) return;
  if (!conn.info.capabilities.includes("view.start")) return;
  const s = conn.session;
  conn.view = { id: null, starting: true };
  tellViewers(conn.deviceId, { type: "status", view: "starting" });
  void relayRequest(conn.deviceId, { id: s.botId, name: s.botName }, "view.start", { maxFps: 3, maxWidth: 1280, quality: 60 }, { timeoutMs: 15_000 }).then((r) => {
    if (!conn.view || !conn.view.starting) return;
    if (r.ok && typeof r.result.viewId === "string") {
      conn.view = { id: r.result.viewId, starting: false };
      tellViewers(conn.deviceId, { type: "status", view: "live" });
      if (!viewers.get(conn.deviceId)?.size) stopView(conn);
    } else {
      conn.view = null;
      tellViewers(conn.deviceId, { type: "status", view: "stopped", reason: r.ok ? "error" : r.code });
    }
  });
}

function stopView(conn: Conn) {
  if (!conn.view) return;
  const viewId = conn.view.id;
  conn.view = null;
  clearFrameWaits(conn);
  const s = conn.session;
  void relayRequest(conn.deviceId, s ? { id: s.botId, name: s.botName } : { id: "sklubot", name: "Sklubot" }, "view.stop", viewId ? { viewId } : {}, { timeoutMs: 10_000 });
}

function clearFrameWaits(conn: Conn) {
  for (const w of conn.frameWaits.values()) clearTimeout(w.timer);
  conn.frameWaits.clear();
}

function onFrame(conn: Conn, msg: Json) {
  const viewId = typeof msg.viewId === "string" ? msg.viewId.slice(0, 64) : "";
  const seq = num(msg.seq, 0, Number.MAX_SAFE_INTEGER);
  const width = num(msg.width, 1, 10_000), height = num(msg.height, 1, 10_000);
  if (!viewId || seq === null || !width || !height || typeof msg.data !== "string" || !BASE64.test(msg.data)) return;
  const watching = viewers.get(conn.deviceId);
  if (!watching?.size) {
    // Nobody looks any more: stop the view instead of acknowledging frames for no one.
    if (conn.view) stopView(conn);
    else void relayRequest(conn.deviceId, conn.session ? { id: conn.session.botId, name: conn.session.botName } : { id: "sklubot", name: "Sklubot" }, "view.stop", { viewId }, { timeoutMs: 10_000 });
    return;
  }
  if (conn.view && conn.view.id === null) conn.view = { id: viewId, starting: false };
  lastFrames.set(conn.deviceId, { seq, width, height, data: msg.data, at: now() });
  const payload = JSON.stringify({ type: "frame", seq, width, height, data: msg.data });
  const waiting = new Set<Viewer>();
  for (const v of watching) {
    if (v.ws.readyState !== v.ws.OPEN || v.ws.bufferedAmount > 4 * 1024 * 1024) continue; // a slow browser skips frames
    try { v.ws.send(payload); waiting.add(v); } catch { /* gone */ }
  }
  const ack = () => conn.send({ type: "view.ack", viewId, seq });
  if (!waiting.size) return ack();
  // Acknowledged once every viewer has shown it (flow control reaches the browser), or after 5 s at most.
  const timer = setTimeout(() => { conn.frameWaits.delete(seq); ack(); }, 5000);
  timer.unref();
  conn.frameWaits.set(seq, { viewId, waiting, timer });
}

function viewerAck(v: Viewer, seq: number, all = false) {
  const conn = online.get(v.deviceId);
  if (!conn) return;
  for (const [s, w] of conn.frameWaits) {
    if (!all && s > seq) continue;
    w.waiting.delete(v);
    if (!w.waiting.size) { clearTimeout(w.timer); conn.frameWaits.delete(s); conn.send({ type: "view.ack", viewId: w.viewId, seq: s }); }
  }
}

// ── Closing ──────────────────────────────────────────────────────────────────
function onClosed(conn: Conn) {
  const was = conn.phase;
  conn.phase = "closed";
  connections.delete(conn);
  if (conn.timer) clearTimeout(conn.timer);
  if (conn.code) codes.delete(conn.code);
  for (const p of [...conn.pending.values()]) p.finish({ ok: false, code: "offline", message: "the computer disconnected" });
  clearFrameWaits(conn);
  if (was !== "online" || online.get(conn.deviceId) !== conn) return;
  online.delete(conn.deviceId);
  q.run("UPDATE relay_devices SET last_seen_at = ? WHERE id = ?", now(), conn.deviceId);
  // A lost connection ends the control session on the computer (§9): say so in the bot's chat.
  if (conn.session) {
    const user = users.byId(conn.userId);
    if (user) {
      const label = deviceLabel(devices.byId(conn.deviceId)?.name ?? conn.info.name, conn.info.platform);
      const reason = pausedAt.has(conn.deviceId) ? REASONS.paused : REASONS.disconnected;
      const text = tr(user.locale, "{bot}'s control of {device} ended: {reason}.", { bot: conn.session.botName, device: label, reason: tr(user.locale, reason) });
      chatLine(user.id, conn.session.botId, text, "info");
      audit(user.id, "computer", text, ownBotId(user.id, conn.session.botId));
    }
    conn.session = null;
  }
  tellViewers(conn.deviceId, { type: "status", view: "offline" });
  announce(conn.userId);
}

// Heartbeat, and the daily token rotation on long-lived connections.
const heartbeat = setInterval(() => {
  for (const conn of connections) {
    if (!conn.alive) { try { conn.ws.terminate(); } catch { /* gone */ } continue; }
    conn.alive = false;
    try { conn.ws.ping(); } catch { /* gone */ }
    if (conn.phase === "online" && now() - conn.rotatedAt > ROTATE_EVERY_MS) rotateToken(conn);
  }
}, PING_EVERY_MS);
heartbeat.unref();

// ── What the web app and the bots use ────────────────────────────────────────
export function listDevices(userId: string): RelayDevice[] {
  return devices.list(userId).map((r) => {
    const c = online.get(r.id);
    return {
      id: r.id, name: r.name, platform: r.platform, arch: r.arch, osRelease: r.os_release, appVersion: r.app_version, kind: kindOf(r.kind),
      status: c ? "online" : pausedAt.has(r.id) ? "paused" : "offline",
      locked: !!c?.locked,
      session: c?.session ? { botId: c.session.botId, botName: c.session.botName, grant: c.session.grant, since: c.session.since } : null,
      asking: c?.asking ?? null,
      screen: c?.info.screen ?? null,
      capabilities: c?.info.capabilities ?? [],
      createdAt: r.created_at, lastSeenAt: c ? now() : r.last_seen_at,
    };
  });
}

export function announce(userId: string) {
  if (userId) emit(userId, { type: "relay", devices: listDevices(userId) });
}

/** The live connection of one of the user's devices (null when offline or not theirs). */
export function liveDevice(userId: string, deviceId: string): { session: Session | null; locked: boolean; screen: { width: number; height: number } | null; lastCapture: Conn["lastCapture"]; capabilities: string[]; kind: DeviceKind } | null {
  const c = online.get(deviceId);
  if (!c || c.userId !== userId || c.phase !== "online") return null;
  return { session: c.session, locked: c.locked, screen: c.info.screen, lastCapture: c.lastCapture, capabilities: c.info.capabilities, kind: c.info.kind };
}

/** True when every linked device of the user is a phone (no commands, files or window switching to offer then). */
export const onlyPhones = (userId: string) => { const all = devices.list(userId); return all.length > 0 && all.every((d) => kindOf(d.kind) === "phone"); };

/** The user removed a computer: the relay is told (revoke, then close 4003) and its token stops working. */
export function revokeDevice(userId: string, deviceId: string): boolean {
  const row = devices.owned(userId, deviceId);
  if (!row) return false;
  q.run("DELETE FROM relay_devices WHERE id = ?", row.id);
  for (const c of connections) {
    if (c.deviceId !== row.id) continue;
    c.send({ type: "revoke" });
    c.close(CLOSE.REVOKED, "revoked");
  }
  pausedAt.delete(row.id);
  lastFrames.delete(row.id);
  const loc = users.localeOf(userId);
  audit(userId, "computer", `${tr(loc, "Computer removed")}: ${deviceLabel(row.name, row.platform)}`);
  announce(userId);
  return true;
}

/** Bots the user stopped from the web app: they may not take control of that computer again on their own for a while. */
const holds = new Map<string, number>();
const HOLD_MS = 10 * 60_000;
export const heldBack = (botId: string, deviceId: string) => (holds.get(`${botId}:${deviceId}`) ?? 0) > now();
/** The user wrote to the bot: whatever they stopped before, they can now ask for again. */
export function userSpoke(botId: string) { for (const k of holds.keys()) if (k.startsWith(`${botId}:`)) holds.delete(k); }

/** "Stop" in the web app: ends the control session on the computer, cancels its commands, and holds the bot back. */
export function stopSession(userId: string, deviceId: string): boolean {
  const c = online.get(deviceId);
  if (!c || c.userId !== userId) return false;
  for (const [id, p] of c.pending) if (p.op === "shell.run") c.send({ type: "cancel", id });
  const s = c.session;
  if (!s) return true;
  holds.set(`${s.botId}:${deviceId}`, now() + HOLD_MS);
  c.stoppedFromWeb = true;
  void relayRequest(deviceId, { id: s.botId, name: s.botName }, "session.end", {}, { timeoutMs: 10_000 }).then((r) => {
    // An old relay that does not answer: the session is over for us all the same.
    if (!r.ok && c.session?.sessionId === s.sessionId) setSession(c, null);
  });
  const loc = users.localeOf(userId);
  audit(userId, "computer", tr(loc, "You stopped {bot}'s control of {device} from Sklubot.", { bot: s.botName, device: deviceLabel(devices.byId(deviceId)?.name ?? c.info.name, c.info.platform) }), ownBotId(userId, s.botId));
  return true;
}

/** Records the session a bot just opened (the relay's own event also says so). */
export function noteSession(deviceId: string, bot: RelayBot, grant: unknown, sessionId: unknown) {
  const c = online.get(deviceId);
  if (c && (!c.session || c.session.botId !== bot.id)) setSession(c, { botId: bot.id, botName: bot.name, grant: grantOf(grant), since: now(), sessionId: str(sessionId, 64) });
}

/** Screenshot data for the web app's "last seen" picture, when no live view runs. */
export const lastFrame = (deviceId: string) => lastFrames.get(deviceId) ?? null;

/**
 * Built relay files this server offers under /download/, and the releases page in any case. The Sklubot desktop app
 * (Sklubot-<version>-<os>.<ext>) has the relay built in, so it is offered here too, next to the older
 * Sklubot-Relais-* files.
 */
export function relayDownloads(dir = path.join(config.webDist, "download"), released: ReleasedFile[] = []): RelayDownloads {
  const files: RelayDownloads["files"] = [];
  try {
    for (const name of readdirSync(dir)) {
      if (!/^Sklubot-Relais-[\w.-]+\.(exe|zip|dmg|AppImage|deb|tar\.gz)$/.test(name)) continue;
      const platform = /win|\.exe$/i.test(name) ? "windows" : /mac|\.dmg$/i.test(name) ? "mac" : "linux";
      files.push({ name, url: `/download/${encodeURIComponent(name)}`, platform, size: statSync(path.join(dir, name)).size });
    }
  } catch { /* no download folder */ }
  for (const f of appDownloads(dir, released).desktop) files.push({ name: f.name, url: f.url, platform: f.os, size: f.size });
  return { files, releasesUrl: RELEASES_URL };
}

/** Sklubot-1.2.0-win.exe, Sklubot-1.2.0-mac.dmg, Sklubot-1.2.0-linux.AppImage… (companion/package.json artifactName). */
const DESKTOP_FILE = /^Sklubot-(\d+)\.(\d+)\.(\d+)-(win|mac|linux)\.(exe|zip|dmg|AppImage|deb)$/;
const OS_OF = { win: "windows", mac: "mac", linux: "linux" } as const;
/** The native Android app, complete edition (mobile/: sklubot-complet-<version>.apk), attached to a GitHub release. */
const ANDROID_FILE = /^sklubot-complet-(\d+)\.(\d+)\.(\d+)\.apk$/;
/** Release tags whose files the download page offers: the desktop workflow's, or one made by hand for the phone app. */
const RELEASE_TAG = /^(desktop|android|app)-v/;

/**
 * Everything the public download page (/telecharger) lists: the Android app when this server has it, the newest
 * desktop build of each kind found in web/dist/download/, and the GitHub releases page as the fallback.
 */
export function appDownloads(dir = path.join(config.webDist, "download"), released: ReleasedFile[] = []): AppDownloads {
  let names: string[] = [];
  try { names = readdirSync(dir); } catch { /* no download folder */ }
  const entries: ReleasedFile[] = [];
  for (const name of names) {
    if (!DESKTOP_FILE.test(name)) continue;
    try { const st = statSync(path.join(dir, name)); if (!st.isFile()) continue; entries.push({ name, url: `/download/${encodeURIComponent(name)}`, size: st.size }); } catch { continue; }
  }
  // Files on this server come first: at the same version they win over the copy attached to a GitHub release.
  entries.push(...released);
  const best = new Map<string, DesktopDownload & { rank: number }>();
  for (const e of entries) {
    const m = DESKTOP_FILE.exec(e.name);
    if (!m) continue;
    const rank = Number(m[1]) * 1e8 + Number(m[2]) * 1e4 + Number(m[3]);
    const kind = m[5] as DesktopDownload["kind"];
    const key = `${m[4]}.${kind}`;
    const cur = best.get(key);
    if (!cur || rank > cur.rank) best.set(key, { name: e.name, url: e.url, os: OS_OF[m[4] as keyof typeof OS_OF], kind, size: e.size, version: `${m[1]}.${m[2]}.${m[3]}`, rank });
  }
  const desktop = [...best.values()].map(({ rank: _rank, ...f }) => f).sort((a, b) => a.name.localeCompare(b.name));
  let android: AppDownloads["android"] = null;
  // The native app attached to a release (newest version) replaces the older WebView app this server may serve.
  let apkRank = -1;
  for (const e of released) {
    const m = ANDROID_FILE.exec(e.name);
    if (!m) continue;
    const rank = Number(m[1]) * 1e8 + Number(m[2]) * 1e4 + Number(m[3]);
    if (rank > apkRank) { apkRank = rank; android = { url: e.url, size: e.size, version: `${m[1]}.${m[2]}.${m[3]}`, name: e.name }; }
  }
  if (!android) try { const st = statSync(path.join(dir, "sklubot.apk")); if (st.isFile()) android = { url: "/download/sklubot.apk", size: st.size }; } catch { /* not on this server */ }
  return { android, desktop, releasesUrl: RELEASES_URL };
}

/**
 * Desktop builds and the Android app attached to this project's public GitHub releases (tags "desktop-v…" made by
 * the desktop workflow, or "android-v…" / "app-v…"): the download page links to them when this server has no copy of its own. Listed with GitHub's
 * "List releases" endpoint (https://docs.github.com/en/rest/releases/releases#list-releases): each asset has
 * name, size and browser_download_url. Refreshed in the background at most every 15 minutes; a failure keeps the
 * last list. RELEASE_DOWNLOADS=0 turns it off.
 */
export interface ReleasedFile { name: string; url: string; size: number }
const RELEASES_API = "https://api.github.com/repos/smokersklubs-dot/grok-sklubs/releases?per_page=20";
let releasedFiles: ReleasedFile[] = [];
let releasedAt = 0;
let releasing: Promise<void> | null = null;
export function releasedDesktopFiles(): ReleasedFile[] {
  if (process.env.RELEASE_DOWNLOADS !== "0" && !releasing && Date.now() - releasedAt > 15 * 60_000) {
    releasedAt = Date.now();
    releasing = (async () => {
      try {
        const res = await fetch(RELEASES_API, { headers: { accept: "application/vnd.github+json", "user-agent": "sklubot-server" }, signal: AbortSignal.timeout(10_000) });
        if (!res.ok) return;
        const list = (await res.json()) as { tag_name?: string; draft?: boolean; prerelease?: boolean; assets?: { name?: string; size?: number; browser_download_url?: string }[] }[];
        const files: ReleasedFile[] = [];
        for (const r of Array.isArray(list) ? list : []) {
          if (r.draft || r.prerelease || !RELEASE_TAG.test(String(r.tag_name ?? ""))) continue;
          for (const a of r.assets ?? []) {
            const url = String(a.browser_download_url ?? "");
            if (a.name && (DESKTOP_FILE.test(a.name) || ANDROID_FILE.test(a.name)) && url.startsWith("https://github.com/")) files.push({ name: a.name, url, size: Number(a.size) || 0 });
          }
        }
        releasedFiles = files;
      } catch { /* offline or rate-limited: keep the last list */ } finally { releasing = null; }
    })();
  }
  return releasedFiles;
}

/** For a localised label of the device in the bots' tools and cards. */
export const labelOf = (row: { name: string; platform: string }) => deviceLabel(row.name, row.platform);
export const deviceKindOf = (row: { kind?: string }) => kindOf(row.kind);
export const localeOfUser = (userId: string): Locale => users.localeOf(userId);

/** Tests: drop every connection at once. */
export function closeAllRelays() {
  for (const c of connections) { try { c.ws.terminate(); } catch { /* gone */ } }
}
