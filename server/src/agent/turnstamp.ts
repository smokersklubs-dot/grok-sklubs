/**
 * L92 — "demain veut dire demain chez toi". The web and mobile apps send the browser's / phone's IANA time zone with each
 * request (header X-Time-Zone). When the user's shared profile has no time zone, the last one their device sent is kept
 * here and the time stamp at the top of each message the bot receives also gives the local time there. A time zone in the
 * profile always wins (the user chose it); nothing is written into the profile on its own.
 */
import { q } from "../db.js";
import { isValidTimezone } from "../cron.js";
import { settings } from "../store.js";

q.run("CREATE TABLE IF NOT EXISTS browser_timezones (user_id TEXT PRIMARY KEY, tz TEXT NOT NULL, at INTEGER NOT NULL)");

/** Keeps the device's time zone of an account (ignored when missing, too long or unknown). */
export function noteBrowserTimezone(userId: string, tz: string | undefined | null): void {
  const v = (tz ?? "").trim();
  if (!v || v.length > 64 || !isValidTimezone(v)) return;
  q.run("INSERT INTO browser_timezones (user_id, tz, at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET tz = excluded.tz, at = excluded.at", userId, v, Date.now());
}

export const browserTimezone = (userId: string): string | null => q.get<{ tz: string }>("SELECT tz FROM browser_timezones WHERE user_id = ?", userId)?.tz ?? null;

/** The stamp put before each message the bot receives: UTC, plus the local time when only the device's zone is known. */
export function stampLine(userId: string, at = Date.now()): string {
  const utc = new Date(at).toISOString().slice(0, 16).replace("T", " ");
  const tz = settings.profile(userId).timezone ? null : browserTimezone(userId);
  if (!tz) return `[${utc} UTC]`;
  const local = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).format(at);
  return `[${utc} UTC — ${local} in ${tz}, the time zone of the user's device]`;
}
