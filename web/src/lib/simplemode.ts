/**
 * L145 « mode Simple » (pure part tested in scripts/simplemode.test.mjs): Settings shows only the everyday sections;
 * the advanced ones (computer, devices, vault, rules, permissions, keys…) step aside. Nothing is switched off: a search
 * in Settings still finds every section, and the section open now always stays listed. Remembered on this device.
 * Ideas only (Nightly Labs, Noah: « mode simple »): our own code.
 */
import { create } from "zustand";

/** The everyday sections kept in Simple mode. */
export const SIMPLE_SECTIONS = new Set(["general", "profile", "notifications", "voice", "today", "team", "memory", "pages", "models", "connectors", "account", "usage", "doctor", "subscription"]);

/** Whether a section is listed: always outside Simple mode, when searched for, when open, or when it is an everyday one. */
export function listedInSimple(id: string, simple: boolean, searching: boolean, current: string): boolean {
  return !simple || searching || id === current || SIMPLE_SECTIONS.has(id);
}

const KEY = "sklubot.simpleMode";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
export const useSimpleMode = create<{ simple: boolean; set: (on: boolean) => void }>((set) => ({
  simple: typeof localStorage === "undefined" ? false : read(),
  set: (on) => { try { if (on) localStorage.setItem(KEY, "1"); else localStorage.removeItem(KEY); } catch { /* not kept */ } set({ simple: on }); },
}));
