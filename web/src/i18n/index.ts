/**
 * A tiny i18n layer: dictionaries, a `t()` lookup with `{name}` placeholders, plural forms, and a `useT()` hook that
 * re-renders its component when the language changes.
 *
 * Languages come from server/src/clientshared/locales.ts (one list for the server, web and mobile). French and English
 * are in the main bundle; every other language is its own file (`./es.ts`, …) loaded on demand, so the app does not
 * grow with each language. A text missing in a language falls back to English, never to the raw key.
 * How to add a language: docs/LANGUES.md.
 */
import { useSyncExternalStore } from "react";
import { LOCALE_LABELS, isLocale as isKnownLocale, localeFromTag, type Locale } from "../../../server/src/clientshared/locales";
import { en, type Dict } from "./en";
import { fr } from "./fr";

export type { Locale };
export type Key = keyof typeof en;
export type Vars = Record<string, string | number>;
/** Keys that come in `_one` / `_other` pairs, without the suffix. */
export type PluralKey = { [K in Key]: K extends `${infer Base}_one` ? Base : never }[Key];
/** Compile-time check: every `_one` key has its `_other`. */
export const PLURALS_COMPLETE: `${PluralKey}_other` extends Key ? true : false = true;

/** A language's texts; only French and English must be complete (the others fall back to English, key by key). */
export type PartialDict = Partial<Dict>;

/**
 * The languages loaded on demand: register a new dictionary here (one line), see docs/LANGUES.md.
 * Each loader is a separate chunk in the production build (npm run check:bundle -w web checks it).
 */
const LOADERS: Partial<Record<Locale, () => Promise<LangModule>>> = {
  es: () => import("./es").then((m) => ({ dict: m.es, side: m.side })),
};

/** A language file: its main texts, and its part of the component-local tables (`side`, see `sideText`). */
interface LangModule { dict: PartialDict; side?: SideTexts }
/** Per table name (web/src/i18n/sides.ts), the table's texts in one language. */
export type SideTexts = Record<string, Record<string, string>>;

const DICTS: Partial<Record<Locale, PartialDict>> = { en, fr };
const SIDES: Partial<Record<Locale, SideTexts>> = {};

/** The languages offered in the pickers: French, English and every language with a dictionary. */
export const LOCALES: { id: Locale; label: string }[] = (Object.keys(LOCALE_LABELS) as Locale[])
  .filter((id) => id === "fr" || id === "en" || LOADERS[id])
  .map((id) => ({ id, label: LOCALE_LABELS[id] }));
const STORAGE_KEY = "sklubot.locale";

/** A language the app can show (known and with a dictionary). */
export function isLocale(v: unknown): v is Locale {
  return isKnownLocale(v) && LOCALES.some((l) => l.id === v);
}

/** Before sign-in: the saved choice, else the browser language (es-MX → es, fr-CA → fr…), else English. */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const navs = typeof navigator !== "undefined" ? (navigator.languages?.length ? navigator.languages : [navigator.language || ""]) : [];
  for (const tag of navs) {
    const l = localeFromTag(tag);
    if (l && isLocale(l)) return l;
  }
  return "en";
}

let current: Locale = initialLocale();
/** Bumped when the current language's texts arrive, so `useT()` redraws. */
let version = 0;
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

/** Loads a language's dictionary once (French and English are always there). Never throws: on failure, English shows. */
function load(locale: Locale): Promise<void> {
  if (DICTS[locale] || !LOADERS[locale]) return Promise.resolve();
  return LOADERS[locale]!().then(
    (m) => {
      DICTS[locale] = m.dict;
      SIDES[locale] = m.side ?? {};
      // Already showing this language (in English while it loaded): redraw with its texts.
      if (locale === current) { version++; BOUND.clear(); for (const fn of listeners) fn(); }
    },
    () => undefined,
  );
}

/** Resolves once the starting language's texts are loaded (main.tsx waits for it before the first render). */
export const localeReady: Promise<void> = load(current);

export function getLocale(): Locale {
  return current;
}

let switching = 0;
/** Switch language everywhere: dictionaries, `<html lang>`, and the saved choice. Resolves once its texts are shown. */
export async function setLocale(next: Locale): Promise<void> {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable: the choice just won't persist on this device */
  }
  const ticket = ++switching;
  await load(next);
  if (ticket !== switching) return; // a later choice won
  if (typeof document !== "undefined") document.documentElement.lang = next;
  if (next === current) return;
  current = next;
  for (const fn of listeners) fn();
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function translate(locale: Locale, key: Key, vars?: Vars): string {
  const text = DICTS[locale]?.[key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Look up a text in the current language. */
export function t(key: Key, vars?: Vars): string {
  return translate(current, key, vars);
}

const rules = new Map<Locale, Intl.PluralRules>();
/**
 * Plural-aware lookup: picks `key_one` or `key_other` by the language's rules; `{n}` is the count.
 * Chinese has no singular form: `Intl` always answers "other" there, so a zh dictionary needs only `_other`.
 */
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  let pr = rules.get(current);
  if (!pr) rules.set(current, (pr = new Intl.PluralRules(current)));
  const form = pr.select(n) === "one" ? "one" : "other";
  return translate(current, `${key}_${form}` as Key, { n, ...vars });
}

/** The locale tag to give `Intl`: keeps the browser's region (en-GB, fr-CA, es-MX) when it matches the language. */
export function intlLocale(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith(current) ? nav : current;
}

const BOUND = new Map<Locale, typeof t>();
function boundFor(locale: Locale): typeof t {
  let fn = BOUND.get(locale);
  if (!fn) BOUND.set(locale, (fn = (key, vars) => translate(locale, key, vars)));
  return fn;
}

const sideCache = new Map<string, object>();
/**
 * A component-local table `{ fr: {…}, en: {…} }` (authText.ts, Hosted.tsx…, listed in web/src/i18n/sides.ts) in one
 * language: French and English from the table itself, any other language from its dictionary file's `side.<name>`,
 * text by text, with English for what is missing.
 */
export function sideText<F extends Record<string, string>>(name: string, table: { fr: F; en: { [K in keyof F]: string } }, locale: Locale): { [K in keyof F]: string } {
  type T = { [K in keyof F]: string };
  if (locale === "fr" || locale === "en") return table[locale];
  const extra = SIDES[locale]?.[name];
  if (!extra) return table.en;
  const id = `${locale}:${name}`;
  let merged = sideCache.get(id) as T | undefined;
  if (!merged) sideCache.set(id, (merged = { ...table.en, ...extra } as T));
  return merged;
}

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

const getVersion = () => version;
/** `const t = useT()` — re-renders on language change; the returned function changes identity with the language. */
export function useT(): typeof t {
  const locale = useLocale();
  useSyncExternalStore(subscribe, getVersion, getVersion);
  return boundFor(locale);
}
