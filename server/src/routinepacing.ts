/**
 * Routine pacing (scheduler.ts calls it; ideas from OpenClaw, Nightly, OMB, CopilotKit and the timon clean-room spec
 * T37 / T45 — our own code):
 *
 * L62 — a failed run is first tried again after a growing wait (5, 15, 30 minutes) before it counts as a failure; only
 * the FIRST failure after a success is said in the chat (one notice); after ROUTINE_FAIL_PAUSE counted failures in a row
 * the routine is no longer paused but SPACED: a due time is skipped until a growing gap since the last failure has passed
 * (1 h, 2 h, 4 h … at most a day), and one notice says so. A run that works again resets everything. Runs made up after
 * a restart are spread out instead of all starting at once.
 *
 * L183 — night work paced by quotas: a routine marked "heavy" (routineoptions.ts) whose bot's subscription is at its
 * usage limit (agent/sublimit.ts, the time the tool itself gave) does not run on the backup model nor wait in the queue:
 * it is set for the reset time; several heavy routines of one account waiting for the same window start 10 minutes apart.
 *
 * Pending tries live in a table, so a restart keeps them.
 */
import { q } from "./db.js";
import { now } from "./store.js";

q.run("CREATE TABLE IF NOT EXISTS routine_pacing (routine_id TEXT PRIMARY KEY, attempts INTEGER NOT NULL DEFAULT 0, due_at INTEGER, kind TEXT NOT NULL DEFAULT 'retry', last_error_at INTEGER, note TEXT NOT NULL DEFAULT '', user_id TEXT NOT NULL DEFAULT '')");

/** Waits before each new try of a failed run. */
export const RETRY_DELAYS_MS = [5 * 60_000, 15 * 60_000, 30 * 60_000];
/** First gap of a spaced routine, doubled at each further failure, at most a day. */
export const SPACING_BASE_MS = 3600_000;
export const SPACING_MAX_MS = 86_400_000;
/** Heavy routines waiting for the same quota window start this far apart. */
export const QUOTA_STAGGER_MS = 10 * 60_000;
/** Runs made up after a restart start this far apart. */
export const CATCHUP_STAGGER_MS = 30_000;

interface PacingRow { routine_id: string; attempts: number; due_at: number | null; kind: string; last_error_at: number | null; note: string; user_id: string }
const rowOf = (id: string) => q.get<PacingRow>("SELECT * FROM routine_pacing WHERE routine_id = ?", id);

/** What to do with a run that just failed. */
export type FailurePlan = { kind: "retry"; attempt: number; inMs: number } | { kind: "count" };

/**
 * A run failed: a new try is set (and the caller does NOT count the failure yet), unless the tries are used up or the
 * routine is already spaced out, then the failure counts (the tries start over for the next due time).
 */
export function planAfterFailure(routineId: string, alreadySpaced: boolean, note: string): FailurePlan {
  const cur = rowOf(routineId);
  const attempts = cur?.kind === "retry" ? cur.attempts : 0;
  const t = now();
  if (!alreadySpaced && attempts < RETRY_DELAYS_MS.length) {
    const inMs = RETRY_DELAYS_MS[attempts];
    q.run("INSERT INTO routine_pacing (routine_id, attempts, due_at, kind, last_error_at, note) VALUES (?, ?, ?, 'retry', ?, ?) ON CONFLICT(routine_id) DO UPDATE SET attempts = excluded.attempts, due_at = excluded.due_at, kind = 'retry', last_error_at = excluded.last_error_at, note = excluded.note",
      routineId, attempts + 1, t + inMs, t, note.slice(0, 300));
    return { kind: "retry", attempt: attempts + 1, inMs };
  }
  q.run("INSERT INTO routine_pacing (routine_id, attempts, due_at, kind, last_error_at, note) VALUES (?, 0, NULL, 'retry', ?, ?) ON CONFLICT(routine_id) DO UPDATE SET attempts = 0, due_at = NULL, kind = 'retry', last_error_at = excluded.last_error_at, note = excluded.note",
    routineId, t, note.slice(0, 300));
  return { kind: "count" };
}

/** A run went through: pending tries and spacing are forgotten. */
export function clearPacing(routineId: string): void { q.run("DELETE FROM routine_pacing WHERE routine_id = ?", routineId); }

/** The gap a routine with `failures` counted failures waits since its last failure (0: not spaced). */
export function spacingGap(failures: number, threshold: number): number {
  if (failures < threshold) return 0;
  return Math.min(SPACING_MAX_MS, SPACING_BASE_MS * 2 ** Math.min(10, failures - threshold));
}

/** A due time of a spaced routine that comes too soon after its last failure: skipped (returns when it may run again). */
export function spacedUntil(routineId: string, failures: number, threshold: number): number | null {
  const gap = spacingGap(failures, threshold);
  if (!gap) return null;
  const last = rowOf(routineId)?.last_error_at ?? 0;
  return now() < last + gap ? last + gap : null;
}

/** L183: sets a heavy routine to run at the subscription's reset, 10 minutes after the account's other waiting ones. */
export function deferForQuota(routineId: string, userId: string, until: number): number {
  const taken = q.all<{ due_at: number }>("SELECT due_at FROM routine_pacing WHERE kind = 'quota' AND user_id = ? AND routine_id <> ? AND due_at >= ?", userId, routineId, until).map((r) => r.due_at);
  let at = until;
  while (taken.some((x) => Math.abs(x - at) < QUOTA_STAGGER_MS)) at += QUOTA_STAGGER_MS;
  q.run("INSERT INTO routine_pacing (routine_id, attempts, due_at, kind, user_id) VALUES (?, 0, ?, 'quota', ?) ON CONFLICT(routine_id) DO UPDATE SET due_at = excluded.due_at, kind = 'quota', user_id = excluded.user_id", routineId, at, userId);
  return at;
}

/** Tries and quota windows that are due now: taken (their due time cleared), with what they are. */
export function takeDue(at = now()): { routineId: string; kind: "retry" | "quota"; attempt: number; note: string }[] {
  const due = q.all<PacingRow>("SELECT * FROM routine_pacing WHERE due_at IS NOT NULL AND due_at <= ?", at);
  for (const r of due) {
    if (r.kind === "quota") q.run("DELETE FROM routine_pacing WHERE routine_id = ?", r.routine_id);
    else q.run("UPDATE routine_pacing SET due_at = NULL WHERE routine_id = ?", r.routine_id);
  }
  return due.map((r) => ({ routineId: r.routine_id, kind: r.kind === "quota" ? "quota" : "retry", attempt: r.attempts, note: r.note }));
}

/** When the routine's next try or quota window is set (for the run log), or null. */
export const pendingTry = (routineId: string): { kind: string; at: number } | null => {
  const r = rowOf(routineId);
  return r?.due_at ? { kind: r.kind, at: r.due_at } : null;
};
