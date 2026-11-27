import { q } from "./db.js";
import { clip, now } from "./store.js";

/**
 * L151 « Notifications plus sages » (backlog A-FAIRE).
 *  - A finished reply reaches the phone only when the computer has been idle for DESK_IDLE_MS (no key or pointer in any
 *    open window of the app for 30 s, or no window visible at all), and only when the work took MIN_WORK_MS or more:
 *    a quick answer the owner is waiting for in front of the screen never buzzes the phone.
 *  - « La cloche »: every notification Sklubot decided about is kept (the last KEEP per account), sent or held back with
 *    the reason, so nothing is lost when the phone stayed quiet. Read marks are the owner's.
 * Sounds are played by the app itself (web/src/lib/sounds.ts), a choice of this device.
 */
export const DESK_IDLE_MS = 30_000;
const envSec = Number(process.env.PUSH_MIN_WORK_SEC);
/** PUSH_MIN_WORK_SEC (default 20): below this a finished reply stays in the bell. */
export const MIN_WORK_MS = Number.isFinite(envSec) && envSec >= 0 && process.env.PUSH_MIN_WORK_SEC !== "" && process.env.PUSH_MIN_WORK_SEC !== undefined ? envSec * 1000 : 20_000;
export const KEEP = 200;

q.run(`CREATE TABLE IF NOT EXISTS notify_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, kind TEXT NOT NULL,
  title TEXT NOT NULL, body TEXT NOT NULL, bot_id TEXT, sent INTEGER NOT NULL, reason TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL, read_at INTEGER
)`);
q.run("CREATE INDEX IF NOT EXISTS notify_log_user ON notify_log(user_id, id)");

export type HeldReason = "" | "atDesk" | "quick" | "quiet" | "kindOff" | "muted" | "noDevice" | "repeat";
export interface BellItem { id: number; kind: string; title: string; body: string; botId: string | null; sent: boolean; reason: HeldReason; at: number; read: boolean }

export function logNotification(userId: string, m: { kind: string; title: string; body: string; botId?: string | null }, sent: boolean, reason: HeldReason = "") {
  if (m.kind === "test") return;
  q.run("INSERT INTO notify_log (user_id, kind, title, body, bot_id, sent, reason, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    userId, m.kind, clip(m.title, 80), clip(m.body.replace(/\s+/g, " ").trim(), 300), m.botId ?? null, sent ? 1 : 0, reason, now());
  q.run("DELETE FROM notify_log WHERE user_id = ? AND id <= (SELECT id FROM notify_log WHERE user_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?)", userId, userId, KEEP);
}

export function bell(userId: string, limit = 50): { items: BellItem[]; unread: number } {
  const items = q.all<{ id: number; kind: string; title: string; body: string; bot_id: string | null; sent: number; reason: string; at: number; read_at: number | null }>(
    "SELECT * FROM notify_log WHERE user_id = ? ORDER BY id DESC LIMIT ?", userId, Math.min(KEEP, Math.max(1, limit)),
  ).map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, botId: r.bot_id, sent: !!r.sent, reason: r.reason as HeldReason, at: r.at, read: r.read_at !== null }));
  const unread = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM notify_log WHERE user_id = ? AND read_at IS NULL", userId)!.n;
  return { items, unread };
}
export const markBellRead = (userId: string) => Number(q.run("UPDATE notify_log SET read_at = ? WHERE user_id = ? AND read_at IS NULL", now(), userId).changes);
export const clearBell = (userId: string) => Number(q.run("DELETE FROM notify_log WHERE user_id = ?", userId).changes);

// ── Is the owner at the computer? ──
const input = new Map<string, Map<string, { visible: boolean; inputAt: number; at: number }>>();
const SEEN_MS = 75_000;
/** An open window says whether it is visible and when the owner last typed or moved the pointer in it. */
export function noteDesk(userId: string, clientId: string, visible: boolean, idleMs: number | null, at = Date.now()) {
  let m = input.get(userId);
  if (!m) input.set(userId, (m = new Map()));
  const prev = m.get(clientId);
  // A window that does not say (an older app) counts as in use while visible, as before L151.
  const inputAt = typeof idleMs === "number" && Number.isFinite(idleMs) && idleMs >= 0 ? at - Math.min(idleMs, 86_400_000) : visible ? at : prev?.inputAt ?? 0;
  m.set(clip(clientId, 64), { visible, inputAt, at });
  if (m.size > 50) { const oldest = [...m.entries()].sort((a, b) => a[1].at - b[1].at)[0]; m.delete(oldest[0]); }
}
/** True when a visible window had a key or pointer action in the last 30 s. */
export function atDesk(userId: string, at = Date.now()): boolean {
  return [...(input.get(userId)?.values() ?? [])].some((p) => p.visible && p.at > at - SEEN_MS && p.inputAt > at - DESK_IDLE_MS);
}

/** The decision for a finished reply: push it, or why not (the reason goes to the bell). */
export function replyPushDecision(userId: string, startedAt: number | null | undefined, at = Date.now()): { push: boolean; reason: HeldReason } {
  if (atDesk(userId, at)) return { push: false, reason: "atDesk" };
  if (typeof startedAt === "number" && at - startedAt < MIN_WORK_MS) return { push: false, reason: "quick" };
  return { push: true, reason: "" };
}
