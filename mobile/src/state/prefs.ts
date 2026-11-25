import * as SecureStore from "expo-secure-store";
import { create } from "zustand";
import { setLocale, deviceLocale, type Locale } from "../i18n";

export type ThemePref = "system" | "light" | "dark";
export interface Prefs {
  theme: ThemePref;
  /** null: follow the phone (French unless the phone is in English). */
  locale: Locale | null;
  notify: boolean;
  /** L184: the owner's applied bot theme is used on the phone (off: the app's own colours, the rescue switch). */
  botTheme: boolean;
}
const KEY = "sklubot.prefs";
const DEFAULTS: Prefs = { theme: "system", locale: null, notify: true, botTheme: true };

/** Small, non-secret preferences, kept with the session in the device's secure storage (one JSON value). */
export const usePrefs = create<Prefs & { loaded: boolean; set(patch: Partial<Prefs>): void; load(): Promise<void> }>((set, get) => ({
  ...DEFAULTS,
  loaded: false,
  set(patch) {
    set(patch);
    const { theme, locale, notify, botTheme } = get();
    if (patch.locale !== undefined) setLocale(patch.locale ?? deviceLocale());
    SecureStore.setItemAsync(KEY, JSON.stringify({ theme, locale, notify, botTheme })).catch(() => undefined);
  },
  async load() {
    try {
      const raw = await SecureStore.getItemAsync(KEY);
      const p = raw ? (JSON.parse(raw) as Partial<Prefs>) : {};
      const next: Prefs = {
        theme: p.theme === "light" || p.theme === "dark" ? p.theme : "system",
        locale: p.locale === "fr" || p.locale === "en" ? p.locale : null,
        notify: p.notify !== false,
        botTheme: p.botTheme !== false,
      };
      setLocale(next.locale ?? deviceLocale());
      set({ ...next, loaded: true });
    } catch {
      set({ loaded: true });
    }
  },
}));
