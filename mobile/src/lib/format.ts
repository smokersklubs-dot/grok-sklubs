import type { Locale } from "../i18n";

const pad = (n: number) => String(n).padStart(2, "0");

export function clockTime(at: number): string {
  const d = new Date(at);
  return `${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const MONTHS: Partial<Record<Locale, string[]>> & { en: string[] } = {
  fr: ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."],
  en: ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"],
  es: ["ene.", "feb.", "mar.", "abr.", "may.", "jun.", "jul.", "ago.", "sept.", "oct.", "nov.", "dic."],
  de: ["Jan.", "Feb.", "März", "Apr.", "Mai", "Juni", "Juli", "Aug.", "Sept.", "Okt.", "Nov.", "Dez."],
  it: ["gen", "feb", "mar", "apr", "mag", "giu", "lug", "ago", "set", "ott", "nov", "dic"],
};
/** Words of the dates below, per language (missing → English). */
const WORDS: Partial<Record<Locale, { today: string; yesterday: string; now: string; min: (n: number) => string; h: (n: number) => string }>> = {
  fr: { today: "Aujourd’hui", yesterday: "Hier", now: "à l’instant", min: (n) => `il y a ${n} min`, h: (n) => `il y a ${n} h` },
  es: { today: "Hoy", yesterday: "Ayer", now: "ahora mismo", min: (n) => `hace ${n} min`, h: (n) => `hace ${n} h` },
  de: { today: "Heute", yesterday: "Gestern", now: "gerade eben", min: (n) => `vor ${n} Min.`, h: (n) => `vor ${n} Std.` },
  it: { today: "Oggi", yesterday: "Ieri", now: "proprio ora", min: (n) => `${n} min fa`, h: (n) => `${n} h fa` },
};
const EN_WORDS = { today: "Today", yesterday: "Yesterday", now: "just now", min: (n: number) => `${n} min ago`, h: (n: number) => `${n} h ago` };
const words = (l: Locale) => WORDS[l] ?? EN_WORDS;
/** Day before month ("12 mars", "12 mar."): every language here but English. */
const dayFirst = (l: Locale) => l !== "en" && !!MONTHS[l];
/** Decimal comma: French, Spanish, German, Italian, Portuguese. */
const comma = (l: Locale) => l === "fr" || l === "es" || l === "de" || l === "it" || l === "pt";

/** "Aujourd'hui", "Hier", "12 mars", "12 mars 2025". */
export function dayLabel(at: number, locale: Locale, now = Date.now()): string {
  const d = new Date(at);
  const today = new Date(now);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (at >= start) return words(locale).today;
  if (at >= start - 86_400_000) return words(locale).yesterday;
  const m = (MONTHS[locale] ?? MONTHS.en)[d.getMonth()];
  const base = dayFirst(locale) ? `${d.getDate()} ${m}` : `${m} ${d.getDate()}`;
  return d.getFullYear() === today.getFullYear() ? base : `${base} ${d.getFullYear()}`;
}

/** "à l'instant", "il y a 5 min", "il y a 3 h", then a date. */
export function relTime(at: number, locale: Locale, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - at) / 1000));
  const w = words(locale);
  if (s < 45) return w.now;
  const m = Math.round(s / 60);
  if (m < 60) return w.min(m);
  const h = Math.round(m / 60);
  if (h < 24) return w.h(h);
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
  return `${comma(locale) ? n.replace(".", ",") : n} ${unit[i]}`;
}

export const isImage = (mime: string) => /^image\/(png|jpe?g|gif|webp|heic|heif|bmp)$/i.test(mime);
