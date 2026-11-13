/**
 * A tiny i18n layer: two dictionaries, a `t()` lookup with `{name}` placeholders, plural forms,
 * and a `useT()` hook that re-renders its component when the language changes.
 */
import { useSyncExternalStore } from "react";
import type { Locale } from "../types";
import { en } from "./en";
import { fr } from "./fr";

export type { Locale };
export type Key = keyof typeof en;
export type Vars = Record<string, string | number>;
/** Keys that come in `_one` / `_other` pairs, without the suffix. */
export type PluralKey = { [K in Key]: K extends `${infer Base}_one` ? Base : never }[Key];
/** Compile-time check: every `_one` key has its `_other`. */
export const PLURALS_COMPLETE: `${PluralKey}_other` extends Key ? true : false = true;

export const LOCALES: { id: Locale; label: string }[] = [
  { id: "fr", label: "Français" },
  { id: "en", label: "English" },
];
const STORAGE_KEY = "sklubot.locale";
const DICTS: Record<Locale, Record<Key, string>> = { en, fr };

export function isLocale(v: unknown): v is Locale {
  return v === "fr" || v === "en";
}

/** Before sign-in: the saved choice, else the browser language (fr* → fr, otherwise en). */
function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (isLocale(saved)) return saved;
  } catch {
    /* storage unavailable */
  }
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let current: Locale = initialLocale();
const listeners = new Set<() => void>();
if (typeof document !== "undefined") document.documentElement.lang = current;

export function getLocale(): Locale {
  return current;
}

/** Switch language everywhere: dictionaries, `<html lang>`, and the saved choice. */
export function setLocale(next: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, next);
  } catch {
    /* storage unavailable: the choice just won't persist on this device */
  }
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
  const text = DICTS[locale][key] ?? en[key] ?? key;
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, name: string) => (name in vars ? String(vars[name]) : m));
}

/** Look up a text in the current language. */
export function t(key: Key, vars?: Vars): string {
  return translate(current, key, vars);
}

const rules = new Map<Locale, Intl.PluralRules>();
/** Plural-aware lookup: picks `key_one` or `key_other` by the language's rules; `{n}` is the count. */
export function tn(key: PluralKey, n: number, vars?: Vars): string {
  let pr = rules.get(current);
  if (!pr) rules.set(current, (pr = new Intl.PluralRules(current)));
  const form = pr.select(n) === "one" ? "one" : "other";
  return translate(current, `${key}_${form}` as Key, { n, ...vars });
}

/** The locale tag to give `Intl`: keeps the browser's region (en-GB, fr-CA) when it matches the language. */
export function intlLocale(): string {
  const nav = typeof navigator !== "undefined" ? navigator.language || "" : "";
  return nav.toLowerCase().startsWith(current) ? nav : current;
}

const BOUND: Record<Locale, typeof t> = {
  en: (key, vars) => translate("en", key, vars),
  fr: (key, vars) => translate("fr", key, vars),
};

export function useLocale(): Locale {
  return useSyncExternalStore(subscribe, getLocale, getLocale);
}

/** `const t = useT()` — re-renders on language change; the returned function changes identity with the language. */
export function useT(): typeof t {
  return BOUND[useLocale()];
}
