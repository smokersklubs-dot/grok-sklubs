import type { Bot, Task } from "../types";

const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });

export function clockTime(ts: number): string {
  return timeFmt.format(new Date(ts));
}

function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Label for the time dividers in a transcript. */
export function dividerLabel(ts: number, now = Date.now()): string {
  const d = new Date(ts);
  const today = new Date(now);
  const yesterday = new Date(now - 86_400_000);
  if (sameDay(d, today)) return `Today ${clockTime(ts)}`;
  if (sameDay(d, yesterday)) return `Yesterday ${clockTime(ts)}`;
  const opts: Intl.DateTimeFormatOptions = { weekday: "long", month: "long", day: "numeric" };
  if (d.getFullYear() !== today.getFullYear()) opts.year = "numeric";
  return `${new Intl.DateTimeFormat(undefined, opts).format(d)}, ${clockTime(ts)}`;
}

/** "just now", "5 min ago", "3 h ago", "2 d ago", or a date. */
export function relTime(ts: number, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - ts) / 1000));
  if (s < 45) return "just now";
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} h ago`;
  const d = Math.round(h / 24);
  if (d < 14) return `${d} d ago`;
  return shortDate(ts);
}

export function shortDate(ts: number): string {
  const d = new Date(ts);
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" };
  if (d.getFullYear() !== new Date().getFullYear()) opts.year = "numeric";
  return new Intl.DateTimeFormat(undefined, opts).format(d);
}

export function dateTime(ts: number, timeZone?: string): string {
  const opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" };
  try {
    return new Intl.DateTimeFormat(undefined, timeZone ? { ...opts, timeZone } : opts).format(new Date(ts));
  } catch {
    return new Intl.DateTimeFormat(undefined, opts).format(new Date(ts));
  }
}

/** Elapsed time: seconds, then minutes, then hours + minutes. */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

export function callClock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

export function duration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} sec`;
  const m = Math.floor(s / 60);
  return s % 60 ? `${m} min ${s % 60} sec` : `${m} min`;
}

export function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(bytes < 10_240 ? 1 : 0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
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

export function plural(n: number, one: string, many = one + "s"): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function compactNumber(n: number): string {
  return new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 }).format(n);
}

export function money(n: number): string {
  return new Intl.NumberFormat(undefined, { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: n < 1 ? 3 : 2 }).format(n);
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
    time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", ...tz }).format(new Date(ts));
    weekday = new Intl.DateTimeFormat(undefined, { weekday: "long", ...tz }).format(new Date(ts));
  } catch {
    time = clockTime(ts);
    weekday = new Intl.DateTimeFormat(undefined, { weekday: "long" }).format(new Date(ts));
  }
  const key = dayKey(ts, timeZone);
  if (key === dayKey(now, timeZone)) return `today ${time}`;
  if (key === dayKey(now + 86_400_000, timeZone)) return `tomorrow ${time}`;
  if (ts - now < 6 * 86_400_000 && ts > now) return `${weekday} ${time}`;
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
