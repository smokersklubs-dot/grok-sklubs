import { getLocales } from "expo-localization";
import { useSyncExternalStore } from "react";
import { en } from "./en";
import { fr, type Key } from "./fr";

export type { Key };
export type Locale = "fr" | "en";
const DICTS: Record<Locale, Record<Key, string>> = { fr, en };

/** French by default; English when the phone is set to English (and nothing else was chosen). */
export function deviceLocale(): Locale {
  try {
    const code = getLocales()[0]?.languageCode;
    return code === "en" ? "en" : "fr";
  } catch {
    return "fr";
  }
}

let current: Locale = deviceLocale();
const listeners = new Set<() => void>();

export const getLocale = () => current;
export function setLocale(l: Locale) {
  if (l === current) return;
  current = l;
  for (const fn of listeners) fn();
}

export function translate(locale: Locale, key: Key, vars?: Record<string, string | number>): string {
  const s = DICTS[locale][key] ?? DICTS.fr[key] ?? key;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] !== undefined ? String(vars[k]) : m)) : s;
}

export const t = (key: Key, vars?: Record<string, string | number>) => translate(current, key, vars);

/** Plural forms: "<key>_one" / "<key>_other" (French counts 0 and 1 as singular). */
export function tn(base: string, n: number, locale: Locale = current): string {
  const one = locale === "fr" ? n <= 1 : n === 1;
  return translate(locale, `${base}_${one ? "one" : "other"}` as Key, { n });
}

/** Re-renders the component when the language changes. */
export function useT() {
  const locale = useSyncExternalStore((fn) => { listeners.add(fn); return () => listeners.delete(fn); }, getLocale, getLocale);
  return Object.assign((key: Key, vars?: Record<string, string | number>) => translate(locale, key, vars), {
    locale,
    n: (base: string, n: number) => tn(base, n, locale),
  });
}

/** The server answers in English for a few account errors (server/src/routes.ts): shown in the person's language. */
const SERVER_FR: Record<string, string> = {
  "Wrong email or password.": "E-mail ou mot de passe incorrect.",
  "Too many attempts. Wait a few minutes and try again.": "Trop de tentatives. Attends quelques minutes et réessaie.",
  "New accounts are closed on this server.": "Les inscriptions sont fermées sur ce serveur.",
  "An account with this email already exists.": "Un compte existe déjà avec cet e-mail.",
  "Enter a valid email address.": "Saisis une adresse e-mail valide.",
  "Choose a password of at least 8 characters.": "Choisis un mot de passe d’au moins 8 caractères.",
  "Please sign in.": "Connecte-toi.",
  "That request no longer exists.": "Cette demande n’existe plus.",
  "Write a message first.": "Écris d’abord un message.",
  "Files can be up to 1 GB.": "Les fichiers peuvent faire jusqu’à 1 Go.",
  "Files can be up to 96 MB.": "Les fichiers peuvent faire jusqu’à 96 Mo.",
  "Files can be up to 25 MB.": "Les fichiers peuvent faire jusqu’à 25 Mo.",
  "That file does not exist.": "Ce fichier n’existe pas.",
  "That file is empty.": "Ce fichier est vide.",
  "No file was sent.": "Aucun fichier n’a été envoyé.",
  "This address is not allowed to create an account on this server.": "Cette adresse ne peut pas créer de compte sur ce serveur.",
};

/** A readable message for any error thrown by the API client. */
export function errText(e: unknown): string {
  const err = e as { status?: number; serverMessage?: string | null; message?: string };
  if (err && err.status === 0) return t("api.unreachable");
  if (err && err.serverMessage) return current === "fr" ? SERVER_FR[err.serverMessage] ?? err.serverMessage : err.serverMessage;
  if (err && typeof err.status === "number") return t("api.failed", { status: err.status });
  return t("api.generic");
}
