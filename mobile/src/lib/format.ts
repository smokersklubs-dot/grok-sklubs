import type { Locale } from "../i18n";

const pad = (n: number) => String(n).padStart(2, "0");

export function clockTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS: Record<Locale, string[]> = {
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
};

/** "Aujourd'hui", "Hier", "12 mars", "12 mars 2025". */
export function dayLabel(at: number, locale: Locale, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at >= start) return locale === "fr" ? "Aujourd’hui" : "Today";
  if (at >= start - 86_400_000) return locale === "fr" ? "Hier" : "Yesterday";
  const m = MONTHS[locale][d.getMonth()];
  const base = locale === "fr" ? `${d.getDate()} ${m}` : `${m} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "à l'instant", "il y a 5 min", "il y a 3 h", then a date. */
export function relTime(at: number, locale: Locale, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  const fr = locale === "fr";
  if (s < 45) return fr ? "à l’instant" : "just now";
  const m = Math.round(s / 60);
  if (m < 60) return fr ? `il y a ${m} min` : `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return fr ? `il y a ${h} h` : `${h} h ago`;
  return dayLabel(at, locale, now);
}

/** Short time for a list: the clock today, else the day. */
export function listTime(at: number, locale: Locale, now = Date.now()): string {
  if (!at) return "";
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return at >= start ? clockTime(at) : dayLabel(at, locale, now);
}

export function fileSize(bytes: number, locale: Locale): string {
  const unit = locale === "fr" ? ["o", "Ko", "Mo", "Go"] : ["B", "KB", "MB", "GB"];
  let v = bytes;
  let i = 0;
  while (v >= 1024 && i < unit.length - 1) { v /= 1024; i++; }
  const n = i === 0 ? String(v) : v.toFixed(v < 10 ? 1 : 0);
  return `${locale === "fr" ? n.replace(".", ",") : n} ${unit[i]}`;
}

export const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(mime);
