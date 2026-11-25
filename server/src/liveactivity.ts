import { createPrivateKey, sign as signData } from "node:crypto";
import { readFileSync } from "node:fs";
import http2 from "node:http2";
import type { Context, Hono } from "hono";
import { subscribe } from "./bus.js";
import { sameState, taskActivityState, type TaskActivityState } from "./clientshared/taskactivity.js";
import { q } from "./db.js";
import { fail } from "./routeinput.js";
import type { BotRecord, UserRecord } from "./store.js";
import { now } from "./store.js";

/**
 * L177 — iPhone Live Activity: the server keeps a bot's running task up to date on the Lock Screen and in the Dynamic
 * Island with ActivityKit push notifications sent to APNs. OFF by default; on only with LIVE_ACTIVITY_PUSH=1 and an APNs
 * key (docs/BOUTIQUES.md, « Live Activity »). The app (mobile/src/liveActivity.ts) starts the Live Activity itself and
 * sends its push token here; the server only updates and ends it.
 *
 * Apple documentation followed (read 25/11/2026):
 * - payload, headers, priorities, end and dismissal-date:
 *   https://developer.apple.com/documentation/activitykit/starting-and-updating-live-activities-with-activitykit-push-notifications
 *   (`apns-push-type: liveactivity`, `apns-topic: <bundle id>.push-type.liveactivity`, `apns-priority` 5 or 10,
 *   `aps.timestamp` seconds since 1970, `aps.event` "update" / "end", `aps.content-state`, `aps.dismissal-date`);
 * - authentication token: https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 *   (JWT, ES256, header `kid`, claims `iss` = Team ID and `iat`; refresh no more than once every 20 minutes and no less
 *   than once every 60 minutes);
 * - HTTP/2 to api.push.apple.com / api.sandbox.push.apple.com, POST /3/device/<token>:
 *   https://developer.apple.com/documentation/usernotifications/sending-notification-requests-to-apns
 * - responses: https://developer.apple.com/documentation/usernotifications/handling-notification-responses-from-apns
 *   (410 Unregistered / ExpiredToken, 400 BadDeviceToken: drop the token, never retry).
 *
 * Not tested against the real APNs nor on a device (no Apple account here): the payload and the JWT are unit-tested.
 */

// ── Settings (environment, read when used so tests can set them) ─────────────────────────────────────────────────
export interface ApnsSettings { keyPem: string; keyId: string; teamId: string; bundleId: string; sandbox: boolean }
export function liveActivitySettings(env = process.env): { enabled: false; reason: string } | ({ enabled: true } & ApnsSettings) {
  if (env.LIVE_ACTIVITY_PUSH !== "1") return { enabled: false, reason: "off" };
  const keyId = env.APNS_KEY_ID?.trim() ?? "", teamId = env.APNS_TEAM_ID?.trim() ?? "", bundleId = env.APNS_BUNDLE_ID?.trim() ?? "";
  if (!/^[A-Z0-9]{10}$/.test(keyId) || !/^[A-Z0-9]{10}$/.test(teamId) || !/^[A-Za-z0-9.-]{3,155}$/.test(bundleId) || !env.APNS_KEY_FILE) return { enabled: false, reason: "missing settings" };
  let keyPem = "";
  try { keyPem = readFileSync(env.APNS_KEY_FILE, "utf8"); } catch { return { enabled: false, reason: "key file unreadable" }; }
  if (!/-----BEGIN PRIVATE KEY-----/.test(keyPem)) return { enabled: false, reason: "key file is not a .p8 key" };
  return { enabled: true, keyPem, keyId, teamId, bundleId, sandbox: env.APNS_SANDBOX === "1" };
}

// ── Authentication token (ES256 JWT) ─────────────────────────────────────────────────────────────────────────────
const b64url = (b: Buffer | string) => Buffer.from(b).toString("base64url");
/** The provider token: header {alg: ES256, kid}, claims {iss: Team ID, iat: seconds}. JOSE wants the raw r||s signature. */
export function apnsJwt(keyPem: string, keyId: string, teamId: string, iatSeconds: number): string {
  const head = b64url(JSON.stringify({ alg: "ES256", kid: keyId })), claims = b64url(JSON.stringify({ iss: teamId, iat: iatSeconds }));
  const sig = signData("sha256", Buffer.from(`${head}.${claims}`), { key: createPrivateKey(keyPem), dsaEncoding: "ieee-p1363" });
  return `${head}.${claims}.${b64url(sig)}`;
}
/** Renewed after 40 minutes: inside Apple's 20–60 minute window. */
export const JWT_LIFETIME_MS = 40 * 60_000;
let jwtCache: { token: string; at: number; keyId: string } | null = null;
function providerToken(s: ApnsSettings, at = now()): string {
  if (!jwtCache || jwtCache.keyId !== s.keyId || at - jwtCache.at >= JWT_LIFETIME_MS) jwtCache = { token: apnsJwt(s.keyPem, s.keyId, s.teamId, Math.floor(at / 1000)), at, keyId: s.keyId };
  return jwtCache.token;
}

// ── Payload ──────────────────────────────────────────────────────────────────────────────────────────────────────
/** After the end, the Live Activity leaves the Lock Screen after this long (default would be up to four hours). */
export const DISMISS_AFTER_S = 10 * 60;
export function activityPayload(event: "update" | "end", state: TaskActivityState, at = now()): { aps: Record<string, unknown> } {
  const ts = Math.floor(at / 1000);
  return { aps: { timestamp: ts, event, "content-state": state, ...(event === "end" ? { "dismissal-date": ts + DISMISS_AFTER_S } : {}) } };
}
export function apnsHeaders(s: Pick<ApnsSettings, "bundleId">, priority: 5 | 10, jwt: string): Record<string, string> {
  return { ":method": "POST", "apns-push-type": "liveactivity", "apns-topic": `${s.bundleId}.push-type.liveactivity`, "apns-priority": String(priority), authorization: `bearer ${jwt}`, "content-type": "application/json" };
}

// ── Sending (replaceable in tests) ───────────────────────────────────────────────────────────────────────────────
export interface ApnsRequest { host: string; path: string; headers: Record<string, string>; body: string }
export type ApnsTransport = (r: ApnsRequest) => Promise<{ status: number; reason?: string }>;
const sessions = new Map<string, http2.ClientHttp2Session>();
const realTransport: ApnsTransport = (r) => new Promise((resolve) => {
  let s = sessions.get(r.host);
  if (!s || s.closed || s.destroyed) {
    s = http2.connect(`https://${r.host}`);
    s.on("error", () => sessions.delete(r.host));
    s.on("close", () => sessions.delete(r.host));
    s.setTimeout(5 * 60_000, () => s?.close()); // idle connection closed; the next push opens a new one
    sessions.set(r.host, s);
  }
  const req = s.request({ ...r.headers, ":path": r.path });
  let status = 0, data = "";
  req.setTimeout(15_000, () => req.close(http2.constants.NGHTTP2_CANCEL));
  req.on("response", (h) => { status = Number(h[":status"]) || 0; });
  req.on("data", (d) => { data += d; });
  req.on("end", () => { let reason: string | undefined; try { reason = JSON.parse(data).reason; } catch { /* empty body on 200 */ } resolve({ status, reason }); });
  req.on("error", (e) => resolve({ status: 0, reason: e.message }));
  req.end(r.body);
});
let transport: ApnsTransport = realTransport;
export const setApnsTransport = (fn: ApnsTransport | null) => { transport = fn ?? realTransport; };

/** Answers after which a token is useless: dropped, never retried (Apple's list). */
const DEAD = new Set(["BadDeviceToken", "Unregistered", "ExpiredToken", "DeviceTokenNotForTopic"]);
export const deadToken = (status: number, reason?: string) => status === 410 || (!!reason && DEAD.has(reason));

// ── Tokens (one per running Live Activity) ───────────────────────────────────────────────────────────────────────
q.run("CREATE TABLE IF NOT EXISTS live_activity_tokens (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, thread INTEGER NOT NULL, created_at INTEGER NOT NULL)");
q.run("CREATE INDEX IF NOT EXISTS live_activity_tokens_bot ON live_activity_tokens (user_id, bot_id)");
interface TokenRow { token: string; user_id: string; bot_id: string; thread: number; created_at: number }
/** A token lives at most as long as a Live Activity can (12 hours of activity; Apple ends it after 8). */
export const TOKEN_MAX_AGE_MS = 12 * 3600_000;

/** Pushes per token: what was last sent, and an update held back by the pace below. */
const sent = new Map<string, { state: TaskActivityState; at: number }>();
const held = new Map<string, ReturnType<typeof setTimeout>>();
const latest = new Map<string, TaskActivityState | null>();
/** Ordinary updates (priority 5) at most every 15 s per Live Activity; waiting for the user and the end go at once (10). */
export const MIN_GAP_MS = 15_000;

/** What to send for one token given the bot's live state: nothing, an update (priority 5 or 10), or the end. */
export function decide(prev: { state: TaskActivityState; at: number } | undefined, next: TaskActivityState | null, at: number):
  { kind: "none" } | { kind: "wait"; ms: number } | { kind: "update"; priority: 5 | 10 } | { kind: "end" } {
  if (!next) return { kind: "end" };
  if (prev && sameState(prev.state, next)) return { kind: "none" };
  if (!prev || prev.state.awaiting !== next.awaiting) return { kind: "update", priority: 10 };
  const gap = at - prev.at;
  return gap >= MIN_GAP_MS ? { kind: "update", priority: 5 } : { kind: "wait", ms: MIN_GAP_MS - gap };
}

async function send(row: TokenRow, event: "update" | "end", state: TaskActivityState, priority: 5 | 10): Promise<boolean> {
  const s = liveActivitySettings();
  if (!s.enabled) return false;
  const host = s.sandbox ? "api.sandbox.push.apple.com" : "api.push.apple.com";
  const res = await transport({ host, path: `/3/device/${row.token}`, headers: apnsHeaders(s, priority, providerToken(s)), body: JSON.stringify(activityPayload(event, state)) });
  if (res.status === 403 && res.reason === "ExpiredProviderToken") jwtCache = null;
  if (deadToken(res.status, res.reason)) { forget(row.token); return false; }
  return res.status === 200;
}

function forget(token: string) {
  const t = held.get(token);
  if (t) clearTimeout(t);
  held.delete(token); sent.delete(token);
  const row = q.get<TokenRow>("SELECT * FROM live_activity_tokens WHERE token = ?", token);
  q.run("DELETE FROM live_activity_tokens WHERE token = ?", token);
  if (row) dropWatchIfIdle(row.user_id);
}

/** One token, one live state: applies `decide` (the last state is kept so a held update sends what is current). */
async function sync(row: TokenRow, state: TaskActivityState | null): Promise<void> {
  const at = now();
  if (at - row.created_at > TOKEN_MAX_AGE_MS) { forget(row.token); return; }
  const d = decide(sent.get(row.token), state, at);
  if (d.kind === "none") return;
  if (d.kind === "wait") {
    latest.set(row.token, state);
    if (!held.has(row.token)) {
      const t = setTimeout(() => { held.delete(row.token); void sync(row, latest.get(row.token) ?? null); }, d.ms);
      t.unref?.();
      held.set(row.token, t);
    }
    return;
  }
  const t = held.get(row.token);
  if (t) { clearTimeout(t); held.delete(row.token); }
  if (d.kind === "end") {
    const last = sent.get(row.token)?.state ?? { step: "", steps: 0, startedAt: Math.floor(at / 1000), awaiting: false };
    await send(row, "end", { ...last, awaiting: false }, 10).catch(() => false);
    forget(row.token);
    return;
  }
  sent.set(row.token, { state: state!, at });
  await send(row, "update", state!, d.priority).catch(() => false);
}

// ── Watching the bots' live state (bus.ts), only for accounts with a Live Activity ──────────────────────────────
const watches = new Map<string, () => void>();
function watch(userId: string) {
  if (watches.has(userId)) return;
  watches.set(userId, subscribe(userId, (e) => {
    if (e.type !== "live") return;
    for (const row of q.all<TokenRow>("SELECT * FROM live_activity_tokens WHERE user_id = ? AND bot_id = ?", userId, e.botId)) void sync(row, taskActivityState(e.live, row.thread));
  }));
}
function dropWatchIfIdle(userId: string) {
  if (q.get("SELECT 1 FROM live_activity_tokens WHERE user_id = ?", userId)) return;
  watches.get(userId)?.();
  watches.delete(userId);
}
/** After a restart every bot is idle (bus.ts): the Live Activities left from before are ended at the next start. */
export function resumeLiveActivities(): number {
  const rows = q.all<TokenRow>("SELECT * FROM live_activity_tokens");
  if (!liveActivitySettings().enabled) return 0;
  for (const row of rows) void sync(row, null);
  return rows.length;
}
setTimeout(() => { try { resumeLiveActivities(); } catch { /* the next start tries again */ } }, 10_000).unref?.();

/** A Live Activity push token from ActivityKit: hex, 32 bytes or more (Apple gives no fixed length). */
export const validToken = (t: unknown): t is string => typeof t === "string" && /^[0-9a-f]{32,400}$/i.test(t) && t.length % 2 === 0;

export function registerLiveActivityRoutes<E extends { Variables: { user: UserRecord } }>(api: Hono<E>, ownBot: (c: Context<E>) => BotRecord) {
  /** The app asks once whether to send its tokens here. */
  api.get("/live-activity", (c) => c.json({ enabled: liveActivitySettings().enabled }));
  /** A token for the task `thread` of one of the user's bots (a new token for the same Live Activity replaces `replaces`). */
  api.post("/bots/:id/live-activity", async (c) => {
    const bot = ownBot(c);
    if (!liveActivitySettings().enabled) fail(409, "Live Activities are off on this server.");
    const b = (await c.req.json().catch(() => ({}))) as { token?: unknown; thread?: unknown; replaces?: unknown };
    if (!validToken(b.token)) fail(400, "That is not a Live Activity token.");
    const token = (b.token as string).toLowerCase();
    const thread = Number.isInteger(b.thread) && (b.thread as number) >= 0 ? (b.thread as number) : 0;
    const userId = c.get("user").id;
    if (validToken(b.replaces)) {
      const old = (b.replaces as string).toLowerCase();
      if (q.get("SELECT 1 FROM live_activity_tokens WHERE token = ? AND user_id = ?", old, userId)) { const s = sent.get(old); forget(old); if (s) sent.set(token, s); }
    }
    const other = q.get<{ user_id: string }>("SELECT user_id FROM live_activity_tokens WHERE token = ?", token);
    if (other && other.user_id !== userId) fail(409, "That token is already used.");
    q.run("INSERT OR REPLACE INTO live_activity_tokens (token, user_id, bot_id, thread, created_at) VALUES (?, ?, ?, ?, ?)", token, userId, bot.id, thread, now());
    watch(userId);
    return c.json({ ok: true });
  });
  /** The app ended the Live Activity itself (or the user swiped it away). */
  api.delete("/live-activity/:token", (c) => {
    const token = c.req.param("token").toLowerCase();
    if (!q.get("SELECT 1 FROM live_activity_tokens WHERE token = ? AND user_id = ?", token, c.get("user").id)) fail(404, "That Live Activity does not exist.");
    forget(token);
    return c.json({ ok: true });
  });
}

/** Tests: forget the pace and cached token. */
export function resetLiveActivityState() {
  for (const t of held.values()) clearTimeout(t);
  held.clear(); sent.clear(); latest.clear(); jwtCache = null;
}
