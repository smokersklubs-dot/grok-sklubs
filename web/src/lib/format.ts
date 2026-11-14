import type { Bot, Task } from "../types";
import { intlLocale, t } from "../i18n";

/** Intl formatters are cached per locale and option set. */
const dateFmts = new Map<string, Intl.DateTimeFormat>();
function dateFmt(opts: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = dateFmts.get(key);
  if (!f) dateFmts.set(key, (f = new Intl.DateTimeFormat(locale, opts)));
  return f;
}
const numFmts = new Map<string, Intl.NumberFormat>();
function numFmt(opts: Intl.NumberFormatOptions): Intl.NumberFormat {
  const locale = intlLocale();
  const key = `${locale}|${JSON.stringify(opts)}`;
  let f = numFmts.get(key);
  if (!f) numFmts.set(key, (f = new Intl.NumberFormat(locale, opts)));
  return f;
}

const CLOCK: Intl.DateTimeFormatOptions = { hour: "numeric", minute: "2-digit" };

export function clockTime(ts: number): string {
  return dateFmt(CLOCK).format(new Date(ts));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Label for the time dividers in a transcript. */
export function dividerLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  const time = clockTime(ts);
  if (sameDay(d, today)) return t("time.today", { time });
  if (sameDay(d, yesterday)) return t("time.yesterday", { time });
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return t("time.dateAt", { date: dateFmt(opts).format(d), time });
}

/** "just now", "5 min. ago", "3 hr. ago", "2 days ago" (in the current language), or a date. */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return t("time.justNow");
  const rtf = new Intl.RelativeTimeFormat(intlLocale(), { style: "short", numeric: "always" });
  const m = Math.round(s / 60);
  if (m < 60) return rtf.format(-m, "minute");
  const h = Math.round(m / 60);
  if (h < 24) return rtf.format(-h, "hour");
  const d = Math.round(h / 24);
  if (d < 14) return rtf.format(-d, "day");
  return shortDate(ts);
}

/** "Today", "Yesterday", or a full date: the heading of one day in a log. */
export function dayLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  if (sameDay(d, new Date(now))) return t("time.dayToday");
  if (sameDay(d, new Date(now - 86_400_000))) return t("time.dayYesterday");
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  if (d.getFullYear() !== new Date(now).getFullYear()) opts.year = "numeric";
  return dateFmt(opts).format(d);
}

export function shortDate(ts: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return dateFmt(opts).format(d);
}

export function dateTime(ts: number, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return dateFmt(timeZone ? { ...opts, timeZone } : opts).format(new Date(ts));
  } catch {
    return dateFmt(opts).format(new Date(ts));
  }
}

/** Elapsed time: seconds, then minutes, then hours + minutes. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return t("time.elapsedS", { s });
  const m = Math.floor(s / 60);
  if (m < 60) return t("time.elapsedM", { m });
  return t("time.elapsedHM", { h: Math.floor(m / 60), m: m % 60 });
}

export function callClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("time.durS", { s });
  const m = Math.floor(s / 60);
  return s % 60 ? t("time.durMS", { m, s: s % 60 }) : t("time.durM", { m });
}

/** How long a bot worked on a turn: "45 s", "2 min 10 s", "1 h 5 min". */
export function workDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return t("time.workS", { s });
  const m = Math.floor(s / 60);
  if (m >= 60) return t("time.workHM", { h: Math.floor(m / 60), m: m % 60 });
  return s % 60 ? t("time.workMS", { m, s: s % 60 }) : t("time.workM", { m });
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return t("size.b", { n: bytes });
  if (bytes < 1024 * 1024) return t("size.kb", { n: numFmt({ maximumFractionDigits: bytes < 10_240 ? 1 : 0 }).format(bytes / 1024) });
  return t("size.mb", { n: numFmt({ minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(bytes / (1024 * 1024)) });
}

export function hostName(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  const first = Array.from(parts[0])[0] ?? "";
  const last = parts.length > 1 ? (Array.from(parts[parts.length - 1])[0] ?? "") : "";
  return (first + last).toUpperCase();
}

export function botTitle(bot: Pick<Bot, "name" | "label">): string {
  return bot.label ? `${bot.name} · ${bot.label}` : bot.name;
}

export function compactNumber(n: number): string {
  return numFmt({ notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function money(n: number): string {
  return numFmt({ style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);
}

const TASK_RANK: Record<Task["state"], number> = { needs_input: 0, working: 1, done: 2 };
export function sortTasks(tasks: Task[]): Task[] {
  return [...tasks].sort((a, b) => TASK_RANK[a.state] - TASK_RANK[b.state] || b.updatedAt - a.updatedAt);
}

function dayKey(ts: number, timeZone?: string): string {
  try {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit", ...(timeZone ? { timeZone } : {}) }).format(new Date(ts));
  } catch {
    return new Intl.DateTimeFormat("en-CA", { year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(ts));
  }
}

/** "today 9:00 AM", "tomorrow 9:00 AM", "Friday 9:00 AM" or a date, in the given timezone. */
export function nextRunLabel(ts: number, timeZone?: string, now = Date.now()): string {
  let time: string;
  let weekday: string;
  const tz = timeZone ? { timeZone } : {};
  try {
    time = dateFmt({ ...CLOCK, ...tz }).format(new Date(ts));
    weekday = dateFmt({ weekday: "long", ...tz }).format(new Date(ts));
  } catch {
    time = clockTime(ts);
    weekday = dateFmt({ weekday: "long" }).format(new Date(ts));
  }
  const key = dayKey(ts, timeZone);
  if (key === dayKey(now, timeZone)) return t("time.nextToday", { time });
  if (key === dayKey(now + 86_400_000, timeZone)) return t("time.nextTomorrow", { time });
  if (ts - now < 6 * 86_400_000 && ts > now) return t("time.nextWeekday", { weekday, time });
  return dateTime(ts, timeZone);
}

/** Turn a tool slug such as "github__create_issue" into "Github · create issue". */
export function toolWords(slug: string): { app: string; action: string } {
  const m = slug.match(/^(.*?)(?:__|[:./])(.+)$/);
  const human = (s: string) => s.replace(/[_\-.:/]+/g, " ").trim();
  const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);
  if (!m) return { app: cap(human(slug)), action: "" };
  return { app: cap(human(m[1])), action: human(m[2]) };
}
