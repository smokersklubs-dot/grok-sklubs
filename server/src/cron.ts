import { tr } from "./i18n.js";
import type { Locale } from "./shared.js";

/** Five-field cron (minute hour day-of-month month day-of-week) evaluated in an IANA timezone. */

interface Fields { minute: Set<number>; hour: Set<number>; dom: Set<number>; month: Set<number>; dow: Set<number>; domStar: boolean; dowStar: boolean }

function parseField(src: string, min: number, max: number): Set<number> {
  const out = new Set<number>();
  for (const part of src.split(",")) {
    const [range, stepRaw] = part.split("/");
    const step = stepRaw === undefined ? 1 : Number(stepRaw);
    if (!Number.isInteger(step) || step < 1) throw new Error(`bad step in "${part}"`);
    let lo: number, hi: number;
    if (range === "*") [lo, hi] = [min, max];
    else if (range.includes("-")) [lo, hi] = range.split("-").map(Number) as [number, number];
    else { lo = Number(range); hi = stepRaw === undefined ? lo : max; }
    if (!Number.isInteger(lo) || !Number.isInteger(hi) || lo < min || hi > max || lo > hi) throw new Error(`"${part}" is out of range ${min}-${max}`);
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out;
}

export function parseCron(expr: string): Fields {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) throw new Error("a schedule needs exactly five fields: minute hour day-of-month month day-of-week");
  const dow = parseField(parts[4], 0, 7);
  if (dow.has(7)) { dow.delete(7); dow.add(0); }
  return {
    minute: parseField(parts[0], 0, 59), hour: parseField(parts[1], 0, 23), dom: parseField(parts[2], 1, 31),
    month: parseField(parts[3], 1, 12), dow, domStar: parts[2] === "*", dowStar: parts[4] === "*",
  };
}

export function isValidTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

const WEEKDAYS: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
const formatters = new Map<string, Intl.DateTimeFormat>();

/** Wall-clock parts of an instant in a timezone. */
export function localParts(at: number, tz: string) {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
    formatters.set(tz, f);
  }
  const p: Record<string, string> = {};
  for (const part of f.formatToParts(new Date(at))) p[part.type] = part.value;
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, dow: WEEKDAYS[p.weekday] };
}

function matches(f: Fields, at: number, tz: string): boolean {
  const p = localParts(at, tz);
  if (!f.minute.has(p.minute) || !f.hour.has(p.hour) || !f.month.has(p.month)) return false;
  const dom = f.dom.has(p.day), dow = f.dow.has(p.dow);
  // Standard rule: when both day fields are restricted, either one matching is enough.
  return f.domStar || f.dowStar ? dom && dow : dom || dow;
}

/** First matching minute strictly after `after`, or null if none within about a year. */
export function nextRun(expr: string, tz: string, after: number): number | null {
  let f: Fields;
  try { f = parseCron(expr); } catch { return null; }
  if (!isValidTimezone(tz)) return null;
  let t = Math.floor(after / 60000) * 60000 + 60000;
  const limit = t + 366 * 24 * 3600 * 1000;
  while (t < limit) {
    const p = localParts(t, tz);
    if (!f.month.has(p.month) || !(f.domStar || f.dowStar ? f.dom.has(p.day) && f.dow.has(p.dow) : f.dom.has(p.day) || f.dow.has(p.dow))) {
      t += (60 - p.minute + (23 - p.hour) * 60) * 60000; // jump to the next local midnight
      continue;
    }
    if (!f.hour.has(p.hour)) { t += (60 - p.minute) * 60000; continue; }
    if (matches(f, t, tz)) return t;
    t += 60000;
  }
  return null;
}

const clock = (h: number, m: number, locale?: Locale) =>
  locale === "fr" ? `${h} h ${String(m).padStart(2, "0")}` : `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/** Plain-words rendering of common schedules; anything unusual shows the raw expression. */
export function describeCron(expr: string, locale?: Locale): string {
  const p = expr.trim().split(/\s+/);
  if (p.length !== 5) return expr;
  const [min, hour, dom, month, dow] = p;
  const fixedTime = /^\d+$/.test(min) && /^\d+$/.test(hour);
  if (dom === "*" && month === "*") {
    if (fixedTime && dow === "*") return tr(locale, "Every day at {time}", { time: clock(+hour, +min, locale) });
    if (fixedTime && dow === "1-5") return tr(locale, "Weekdays at {time}", { time: clock(+hour, +min, locale) });
    if (fixedTime && /^[0-7]$/.test(dow)) return tr(locale, "Every {day} at {time}", { day: tr(locale, DAY_NAMES[+dow % 7]), time: clock(+hour, +min, locale) });
    if (dow === "*" && min === "0" && hour === "*") return tr(locale, "Every hour");
    const everyMin = /^\*\/(\d+)$/.exec(min);
    if (dow === "*" && everyMin && hour === "*") return tr(locale, "Every {n} minutes", { n: everyMin[1] });
    const everyHour = /^\*\/(\d+)$/.exec(hour);
    if (dow === "*" && everyHour && /^\d+$/.test(min)) return tr(locale, "Every {n} hours", { n: everyHour[1] });
  }
  return expr;
}
