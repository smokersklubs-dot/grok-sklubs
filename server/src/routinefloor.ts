import { q } from "./db.js";
import { nextRun, parseCron } from "./cron.js";
import { tr } from "./i18n.js";
import type { Locale } from "./shared.js";

/**
 * The routine floor (backlog L143, owner decision 25/11/2026): a routine runs at most once every 15 minutes.
 *  - A new or changed scheduled routine whose schedule would run more often is refused, with a clear message.
 *  - A watch (page or file) is checked at most every 15 minutes: a shorter interval is raised to 15, and said so.
 *  - Routines that already exist with a shorter schedule are kept (never deleted): the scheduler leaves at least 15
 *    minutes between two scheduled runs, and their description says « au plus toutes les 15 minutes ».
 * Not concerned: routines started by an event (webhook, an email, a Slack message, a calendar event, an email to the
 * bot's own address) — each event is its own run — and « Lancer maintenant », which is the owner's own click.
 * No limit on the NUMBER of routines on a self-hosted server; the hosted offer keeps its plan's limit (hosted.ts).
 * Idea from CopilotKit / OpenBot's routine floor (audit AUDIT-COPILOTKIT-OPENBOT.md, line 97); our own code.
 */
export const ROUTINE_FLOOR_MIN = 15;
const FLOOR_MS = ROUTINE_FLOOR_MIN * 60_000;

/**
 * The shortest gap, in minutes, between two runs of a five-field schedule — a lower bound: the times of day it fires,
 * one after the other, and from the last one of a day to the first one of the next day (counted as if every day fired,
 * so it can only be lower than the real gap, never higher). Throws on a schedule that cannot be read.
 */
export function cronMinGapMinutes(expr: string): number {
  const f = parseCron(expr);
  const times: number[] = [];
  for (const h of [...f.hour].sort((a, b) => a - b)) for (const m of [...f.minute].sort((a, b) => a - b)) times.push(h * 60 + m);
  let gap = 1440 - times[times.length - 1] + times[0];
  for (let i = 1; i < times.length; i++) gap = Math.min(gap, times[i] - times[i - 1]);
  return gap;
}

/** True when this schedule would run more often than the floor allows (an unreadable schedule is not this check's business). */
export function belowFloor(expr: string): boolean {
  try { return cronMinGapMinutes(expr) < ROUTINE_FLOOR_MIN; } catch { return false; }
}

/** The refusal for a too frequent schedule, for the owner's screen (fixed words: translated by tr). */
export const FLOOR_REFUSAL = "Routines run at most once every 15 minutes: choose a schedule with at least 15 minutes between two runs (for example every 15 minutes, or every hour).";

/** The refusal the bot reads (routine_create / routine_update), with what to do instead. */
export function floorRefusalForBot(expr: string): string {
  let n = 1;
  try { n = cronMinGapMinutes(expr); } catch { /* checked elsewhere */ }
  return `Too frequent: a routine runs at most once every ${ROUTINE_FLOOR_MIN} minutes, and this schedule would run every ${n} minute${n === 1 ? "" : "s"}. Use at least ${ROUTINE_FLOOR_MIN} minutes between runs (e.g. "*/15 * * * *"). To react at once to something, use a watch, a webhook or an email / slack routine instead. Tell the user about this limit.`;
}

/** The note added to the description of an existing routine that is kept but slowed down to the floor. */
export const floorNote = (expr: string, locale?: Locale): string => (belowFloor(expr) ? tr(locale, " · at most every 15 minutes") : "");

/** A watch's interval between checks, never under the floor. */
export const watchEvery = (everyMin: number): number => Math.max(ROUTINE_FLOOR_MIN, Math.round(Number(everyMin) || 30));

/** The scheduled slot that fired last (cron routines), else the last run's start; 0 when it never ran. */
function lastScheduled(routineId: string, lastRunAt: number | null): number {
  const slot = Number(q.get<{ s: string | null }>("SELECT last_slot AS s FROM routines WHERE id = ?", routineId)?.s ?? "");
  return Number.isFinite(slot) && slot > 0 ? slot : lastRunAt ?? 0;
}

/**
 * The next due time of a scheduled routine, at least 15 minutes after its last scheduled run (cron minute granularity:
 * a slot exactly 15 minutes later is allowed). Same as nextRun for a schedule that respects the floor.
 */
export function nextFlooredRun(r: { id: string; schedule: string; timezone: string; lastRunAt: number | null }, at: number): number | null {
  const last = lastScheduled(r.id, r.lastRunAt);
  return nextRun(r.schedule, r.timezone, Math.max(at, last ? last + FLOOR_MS - 60_000 : 0));
}

/**
 * A due slot that comes less than 15 minutes after the last scheduled run (a made-up run after a restart…). The same slot
 * again, or an older one, is not this check's business: the scheduler's slot claim answers it ("claimed", never twice).
 */
export function tooSoon(r: { id: string; lastRunAt: number | null }, slot: number): boolean {
  const last = lastScheduled(r.id, r.lastRunAt);
  return last > 0 && slot > last && slot - last <= FLOOR_MS - 60_000; // 14 minutes or less after it (slots are whole minutes)
}
