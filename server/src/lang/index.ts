/**
 * Server texts in every language. The server writes its texts in English (the English wording is the key); French
 * lives in the French maps next to the code (i18n.ts, *i18n.ts, local `FR` maps), every other language in one file
 * here (`lang/<code>.ts`, keyed by the same English wording). Missing text → English. How to add a language: docs/LANGUES.md.
 */
import { isLocale, localeFromTag, type Locale } from "../clientshared/locales.js";
import { de } from "./de.js";
import { es } from "./es.js";
import { it } from "./it.js";
import { pt } from "./pt.js";
import { zh } from "./zh.js";

/** The languages other than French and English: register a new dictionary here. */
const DICTS: Partial<Record<Locale, Record<string, string>>> = { es, de, it, pt, zh };

/**
 * One text in the reader's language: French from the caller's French map (`fr`), other languages from their file
 * here, English otherwise. Placeholders are left as they are (the caller fills them).
 */
export function localize(locale: Locale | string | undefined | null, english: string, fr?: Record<string, string>): string {
  if (locale === "fr") return fr?.[english] ?? english;
  if (!locale || locale === "en" || !isLocale(locale)) return english;
  return DICTS[locale]?.[english] ?? english;
}

/** Same as `localize`, then `{name}` placeholders filled from `vars` (missing ones become empty). */
export function localizeVars(locale: Locale | string | undefined | null, english: string, fr: Record<string, string> | undefined, vars: Record<string, string | number> = {}): string {
  return localize(locale, english, fr).replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));
}

/** The account language from a stored or posted value, else the browser's (Accept-Language), else English. */
export function pickLocale(value: unknown, acceptLanguage?: string | null): Locale {
  return isLocale(value) ? value : localeFromTag(acceptLanguage) ?? "en";
}

/** A stored value read back as a language (old rows hold "fr" or "en"; anything unknown reads as English). */
export const asLocale = (value: unknown): Locale => (isLocale(value) ? value : "en");

/** Texts kept per language next to the code (`{ fr, en, es }`): French and English required, the others optional (→ English). */
export type LocaleTexts<T> = { en: T; fr: T } & Partial<Record<Locale, T>>;

/** Picks a per-language variant from `{ fr, en, … }` (missing → English). */
export function byLocale<T>(locale: Locale | undefined, variants: { en: T } & Partial<Record<Locale, T>>): T {
  return (locale && variants[locale]) ?? variants.en;
}

export const languagesWithDictionary = (): Locale[] => Object.keys(DICTS) as Locale[];
