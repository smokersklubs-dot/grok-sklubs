/**
 * The languages of Sklubot — the single source of truth for the server, the web app and the mobile app
 * (web/src/i18n/index.ts, mobile/src/i18n/index.ts, server/src/lang/index.ts). How to add one: docs/LANGUES.md.
 *
 * English is the fallback everywhere: a text missing in a language is shown in English, never as a raw key.
 */
export const LOCALES = ["fr", "en", "es", "de", "it", "pt", "zh"] as const;
export type Locale = (typeof LOCALES)[number];

/** The language's own name, as shown in the language pickers. */
export const LOCALE_LABELS: Record<Locale, string> = {
  fr: "Français",
  en: "English",
  es: "Español",
  de: "Deutsch",
  it: "Italiano",
  pt: "Português",
  zh: "简体中文",
};

/** The language's name in English, for the AI prompts ("Write … in Spanish"). */
export const LOCALE_ENGLISH_NAMES: Record<Locale, string> = {
  fr: "French",
  en: "English",
  es: "Spanish",
  de: "German",
  it: "Italian",
  pt: "Portuguese",
  zh: "Simplified Chinese",
};

/** The `Intl` tag to format dates and numbers when no browser region is known. */
export const LOCALE_INTL: Record<Locale, string> = {
  fr: "fr-FR",
  en: "en-GB",
  es: "es-ES",
  de: "de-DE",
  it: "it-IT",
  pt: "pt-PT",
  zh: "zh-CN",
};

export function isLocale(v: unknown): v is Locale {
  return typeof v === "string" && (LOCALES as readonly string[]).includes(v);
}

/** The language's English name for a prompt; unknown values read as English. */
export function languageName(locale: unknown): string {
  return isLocale(locale) ? LOCALE_ENGLISH_NAMES[locale] : "English";
}

/**
 * A language tag (`es-MX`, `pt_BR`, `zh-Hans-CN`, `de`) or an Accept-Language header to one of our languages:
 * the first listed language we have wins; `null` when none matches.
 */
export function localeFromTag(tag: string | null | undefined): Locale | null {
  for (const part of String(tag ?? "").split(",")) {
    const code = part.trim().split(/[-_;]/)[0].toLowerCase();
    if (isLocale(code)) return code;
  }
  return null;
}

/**
 * Plural form for `_one` / `_other` texts without `Intl.PluralRules` (the mobile app's engine may lack it).
 * French and Portuguese count 0 and 1 as singular; Chinese has no plural form (always `_other`).
 */
export function pluralForm(locale: Locale, n: number): "one" | "other" {
  if (locale === "zh") return "other";
  if (locale === "fr" || locale === "pt") return Math.abs(n) < 2 ? "one" : "other";
  return n === 1 ? "one" : "other";
}

/** Languages without plural forms: their dictionaries need only the `_other` text of a pair. */
export const NO_PLURAL: readonly Locale[] = ["zh"];
