/**
 * L20 — incoming webhooks you can trust (`POST /api/hooks/:token`, hookroutes.ts). What a webhook routine adds on top of
 * its secret address:
 *
 *  - De-duplication by delivery id: a sender that sends the same delivery again (GitHub, Stripe and most services retry
 *    on a timeout) does not start a second turn. Ids read, in order: `webhook-id` (Standard Webhooks), `X-GitHub-Delivery`,
 *    `X-Gitlab-Event-UUID`, `Idempotency-Key`, `X-Delivery-Id`, and Stripe's event id (`id` of the body) when the call
 *    carries a `Stripe-Signature`. A signed call is also de-duplicated by its signature (a replay with a changed id but
 *    the same signature; timestamped formats only). Kept DEDUPE_MS (7 days). A call with no id is never treated as a
 *    repeat (the same body may honestly be sent twice).
 *  - Optional HMAC-SHA256 signature, per webhook. The secret is created by Sklubot (shown once) or pasted from the
 *    service (Stripe and others create their own); it is stored sealed with the data key (datakey.ts, column
 *    `routine_hooks.secret_enc`, re-sealed by the key rotation like every *_enc column). Once a secret is set, an
 *    unsigned or wrongly signed call is refused (401) and logged, and does not use the hook's rate budget. A new secret
 *    keeps the previous one valid for 24 hours, so the service can be updated without losing calls. Formats:
 *      GitHub            X-Hub-Signature-256: sha256=<hex HMAC of the raw body>
 *                        https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries
 *      Stripe            Stripe-Signature: t=<unix s>,v1=<hex HMAC of "t.body">   (±5 min)
 *                        https://docs.stripe.com/webhooks#verify-manually
 *      Standard Webhooks webhook-id, webhook-timestamp, webhook-signature: v1,<base64 HMAC of "id.timestamp.body">  (±5 min)
 *                        key = base64 after "whsec_" — https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md
 *  - Burst grouping (optional, 10 s to 10 min): calls that come close together start one run with all of them.
 *    Waiting calls are kept in the database (`hook_pending`) so a restart does not lose them.
 *  - A log of refused calls per webhook (the last REFUSALS_KEPT): paused routine, too large, missing or wrong signature,
 *    out-of-window timestamp, too many calls, already received. The client address is stored masked.
 *  - « Envoyer un exemple »: a dry run of the whole check with a sample call signed with the stored secret; nothing runs.
 *
 * Webhooks created before this (token in the address only) keep working exactly as before; the page shows them as
 * « non signé ».
 */
import { createHmac, randomBytes, timingSafeEqual, createHash } from "node:crypto";
import { q } from "./db.js";
import { sealValue, unsealValue } from "./datakey.js";
import { now } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS routine_hooks (
  routine_id TEXT PRIMARY KEY REFERENCES routines(id) ON DELETE CASCADE,
  secret_enc TEXT, secret_set_at INTEGER, prev_secret_enc TEXT, prev_until INTEGER,
  group_sec INTEGER NOT NULL DEFAULT 0)`);
q.run(`CREATE TABLE IF NOT EXISTS hook_deliveries (
  routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE, delivery TEXT NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (routine_id, delivery))`);
q.run(`CREATE TABLE IF NOT EXISTS hook_refusals (
  id INTEGER PRIMARY KEY AUTOINCREMENT, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  at INTEGER NOT NULL, reason TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', ip TEXT NOT NULL DEFAULT '')`);
q.run(`CREATE TABLE IF NOT EXISTS hook_pending (
  id INTEGER PRIMARY KEY AUTOINCREMENT, routine_id TEXT NOT NULL REFERENCES routines(id) ON DELETE CASCADE,
  payload TEXT, at INTEGER NOT NULL)`);

export const DEDUPE_MS = 7 * 86400_000;
export const TOLERANCE_S = 300;
export const PREVIOUS_SECRET_MS = 24 * 3600_000;
export const REFUSALS_KEPT = 50;
export const GROUP_CHOICES = [0, 10, 30, 60, 300, 600] as const;
export const GROUP_MAX_CALLS = 50;

export type RefusalReason = "paused" | "too_large" | "no_signature" | "bad_signature" | "stale_timestamp" | "secret_unreadable" | "rate_limited" | "duplicate";
export interface HookRefusal { at: number; reason: RefusalReason; detail: string; ip: string }
export interface HookSettings { signed: boolean; secretSetAt: number | null; previousUntil: number | null; groupSec: number; refusals: HookRefusal[]; pending: number }

type HeaderGet = (name: string) => string | undefined;

interface HookRow { secret_enc: string | null; secret_set_at: number | null; prev_secret_enc: string | null; prev_until: number | null; group_sec: number }
const rowOf = (routineId: string) => q.get<HookRow>("SELECT * FROM routine_hooks WHERE routine_id = ?", routineId);
const ensure = (routineId: string) => q.run("INSERT OR IGNORE INTO routine_hooks (routine_id) VALUES (?)", routineId);

/** A new secret in the Standard Webhooks form ("whsec_" + base64 of 24 random bytes), usable as-is by GitHub too. */
export const newSecret = () => `whsec_${randomBytes(24).toString("base64")}`;

export const hookTrust = {
  settings(routineId: string): HookSettings {
    const r = rowOf(routineId);
    const prevUntil = r?.prev_secret_enc && r.prev_until && r.prev_until > now() ? r.prev_until : null;
    return {
      signed: !!r?.secret_enc, secretSetAt: r?.secret_enc ? r.secret_set_at ?? null : null, previousUntil: prevUntil, groupSec: r?.group_sec ?? 0,
      refusals: q.all<HookRefusal>("SELECT at, reason, detail, ip FROM hook_refusals WHERE routine_id = ? ORDER BY id DESC LIMIT ?", routineId, REFUSALS_KEPT),
      pending: q.get<{ n: number }>("SELECT COUNT(*) AS n FROM hook_pending WHERE routine_id = ?", routineId)?.n ?? 0,
    };
  },
  /** Sets the secret (pasted from the service, or a new one); the previous one stays valid PREVIOUS_SECRET_MS. */
  setSecret(routineId: string, secret: string) {
    ensure(routineId);
    const cur = rowOf(routineId);
    q.run("UPDATE routine_hooks SET secret_enc = ?, secret_set_at = ?, prev_secret_enc = ?, prev_until = ? WHERE routine_id = ?",
      sealValue(secret), now(), cur?.secret_enc ?? null, cur?.secret_enc ? now() + PREVIOUS_SECRET_MS : null, routineId);
  },
  /** Back to an unsigned webhook (its address alone is the key), as before L20. */
  clearSecret: (routineId: string) => q.run("UPDATE routine_hooks SET secret_enc = NULL, secret_set_at = NULL, prev_secret_enc = NULL, prev_until = NULL WHERE routine_id = ?", routineId),
  setGroup(routineId: string, sec: number) { ensure(routineId); q.run("UPDATE routine_hooks SET group_sec = ? WHERE routine_id = ?", sec, routineId); },
  /** The secrets a call may be signed with: the current one, then the previous one during its 24 hours. null: unreadable. */
  secrets(routineId: string): string[] | null {
    const r = rowOf(routineId);
    if (!r?.secret_enc) return [];
    const cur = unsealValue(r.secret_enc);
    if (cur === null) return null;
    const prev = r.prev_secret_enc && r.prev_until && r.prev_until > now() ? unsealValue(r.prev_secret_enc) : null;
    return prev ? [cur, prev] : [cur];
  },
  refuse(routineId: string, reason: RefusalReason, detail = "", ip = "") {
    q.run("INSERT INTO hook_refusals (routine_id, at, reason, detail, ip) VALUES (?, ?, ?, ?, ?)", routineId, now(), reason, detail.slice(0, 200), maskIp(ip));
    q.run("DELETE FROM hook_refusals WHERE routine_id = ? AND id NOT IN (SELECT id FROM hook_refusals WHERE routine_id = ? ORDER BY id DESC LIMIT ?)", routineId, routineId, REFUSALS_KEPT);
  },
  /** Atomically notes these delivery keys; false when one of them was already received (the call is a repeat). */
  claimDelivery(routineId: string, keys: string[]): boolean {
    if (!keys.length) return true;
    return q.tx(() => {
      q.run("DELETE FROM hook_deliveries WHERE at < ?", now() - DEDUPE_MS);
      const marks = keys.map((k) => k.slice(0, 300));
      if (marks.some((k) => q.get("SELECT 1 FROM hook_deliveries WHERE routine_id = ? AND delivery = ?", routineId, k))) return false;
      for (const k of marks) q.run("INSERT OR IGNORE INTO hook_deliveries (routine_id, delivery, at) VALUES (?, ?, ?)", routineId, k, now());
      return true;
    });
  },
  /** Burst grouping: keeps a call until its window closes. Returns how many calls now wait. */
  hold(routineId: string, payload: unknown): number {
    q.run("INSERT INTO hook_pending (routine_id, payload, at) VALUES (?, ?, ?)", routineId, payload === undefined ? null : JSON.stringify(payload), now());
    return q.get<{ n: number }>("SELECT COUNT(*) AS n FROM hook_pending WHERE routine_id = ?", routineId)?.n ?? 0;
  },
  /** Takes every waiting call of a routine (in order), removing them. */
  takePending(routineId: string): unknown[] {
    return q.tx(() => {
      const list = q.all<{ payload: string | null }>("SELECT payload FROM hook_pending WHERE routine_id = ? ORDER BY id", routineId);
      q.run("DELETE FROM hook_pending WHERE routine_id = ?", routineId);
      return list.map((r) => { if (r.payload === null) return null; try { return JSON.parse(r.payload); } catch { return r.payload; } });
    });
  },
  /** Routines with calls still waiting (after a restart). */
  pendingRoutines: () => q.all<{ routine_id: string }>("SELECT DISTINCT routine_id FROM hook_pending").map((r) => r.routine_id),
};

/** "203.0.113.50" → "203.0.x.x"; an IPv6 address keeps its first two groups. */
export function maskIp(ip: string): string {
  if (!ip) return "";
  const v4 = /^(?:::ffff:)?(\d+)\.(\d+)\.\d+\.\d+$/.exec(ip);
  if (v4) return `${v4[1]}.${v4[2]}.x.x`;
  const parts = ip.split(":").filter(Boolean);
  return parts.length ? `${parts.slice(0, 2).join(":")}:…` : "";
}

/** The delivery ids a call carries (see the header list above), plus the signature of a signed call. */
export function deliveryKeys(header: HeaderGet, payload: unknown): string[] {
  const keys: string[] = [];
  for (const h of ["webhook-id", "x-github-delivery", "x-gitlab-event-uuid", "idempotency-key", "x-delivery-id"]) {
    const v = header(h)?.trim();
    if (v) { keys.push(`id:${v}`); break; }
  }
  if (!keys.length && header("stripe-signature") && payload && typeof payload === "object" && typeof (payload as { id?: unknown }).id === "string") keys.push(`id:${(payload as { id: string }).id}`);
  // Only the timestamped formats: there, two honest calls never share a signature. (A GitHub-style signature covers the
  // body alone, so the same body sent again on purpose would look like a repeat.)
  const sig = header("stripe-signature") ?? header("webhook-signature");
  if (sig) keys.push(`sig:${createHash("sha256").update(sig).digest("hex")}`);
  return keys;
}

const hmac = (key: Buffer | string, data: Buffer) => createHmac("sha256", key).update(data).digest();
const same = (a: Buffer, b: Buffer) => a.length === b.length && timingSafeEqual(a, b);
const fromHex = (s: string) => (/^[0-9a-fA-F]+$/.test(s) && s.length % 2 === 0 ? Buffer.from(s, "hex") : Buffer.alloc(0));
const swKey = (secret: string): Buffer[] => {
  const keys: Buffer[] = [Buffer.from(secret, "utf8")];
  if (secret.startsWith("whsec_")) { const b = Buffer.from(secret.slice(6), "base64"); if (b.length) keys.unshift(b); }
  return keys;
};

export type Verdict = { ok: true; format: "github" | "stripe" | "standard" } | { ok: false; reason: "no_signature" | "bad_signature" | "stale_timestamp" };

/** Checks a call's signature against the webhook's secrets (raw body bytes, as received). */
export function verifySignature(secrets: string[], header: HeaderGet, raw: Buffer, at = Date.now()): Verdict {
  const fresh = (ts: number) => Number.isFinite(ts) && Math.abs(at / 1000 - ts) <= TOLERANCE_S;
  const gh = header("x-hub-signature-256");
  const st = header("stripe-signature");
  const sw = header("webhook-signature");
  if (!gh && !st && !sw) return { ok: false, reason: "no_signature" };
  if (sw) {
    const id = header("webhook-id") ?? "", ts = header("webhook-timestamp") ?? "";
    if (!fresh(Number(ts))) return { ok: false, reason: "stale_timestamp" };
    const content = Buffer.concat([Buffer.from(`${id}.${ts}.`, "utf8"), raw]);
    const given = sw.split(" ").map((p) => p.trim()).filter((p) => p.startsWith("v1,")).map((p) => Buffer.from(p.slice(3), "base64"));
    for (const s of secrets) for (const k of swKey(s)) { const want = hmac(k, content); if (given.some((g) => same(g, want))) return { ok: true, format: "standard" }; }
    return { ok: false, reason: "bad_signature" };
  }
  if (st) {
    const parts = st.split(",").map((p) => p.trim().split("="));
    const t = parts.find(([k]) => k === "t")?.[1] ?? "";
    if (!fresh(Number(t))) return { ok: false, reason: "stale_timestamp" };
    const content = Buffer.concat([Buffer.from(`${t}.`, "utf8"), raw]);
    const given = parts.filter(([k]) => k === "v1").map(([, v]) => fromHex(v ?? ""));
    for (const s of secrets) { const want = hmac(s, content); if (given.some((g) => same(g, want))) return { ok: true, format: "stripe" }; }
    return { ok: false, reason: "bad_signature" };
  }
  const given = fromHex(gh!.replace(/^sha256=/, ""));
  for (const s of secrets) if (same(given, hmac(s, raw))) return { ok: true, format: "github" };
  return { ok: false, reason: "bad_signature" };
}

/** The headers of a sample call signed the Standard Webhooks way with `secret` (« Envoyer un exemple »). */
export function signSample(secret: string, raw: Buffer, id: string, at = Date.now()): Record<string, string> {
  const ts = String(Math.floor(at / 1000));
  const sig = hmac(swKey(secret)[0], Buffer.concat([Buffer.from(`${id}.${ts}.`, "utf8"), raw])).toString("base64");
  return { "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": `v1,${sig}` };
}
