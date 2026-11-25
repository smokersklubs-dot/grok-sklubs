import { api } from "../api";
import { useStore } from "../store";
import type { BotThemesView, ThemeColors } from "../types";

/**
 * L161 « thèmes créés par le bot »: the theme the owner applied (server botthemes.ts) is laid over the app's own tokens
 * (styles/tokens.css) with one <style> element: `:root { … }` for light, `:root[data-theme="dark"] { … }` for dark. The
 * colours were checked by the server (contrast, "#rrggbb" only); they are checked again here before they reach CSS.
 * Rescue shortcut: ?theme=origine in the address shows the app without the theme.
 */
const STYLE_ID = "bot-theme";
const TOKEN = /^--[a-z0-9-]+$/;
const HEX = /^#[0-9a-f]{6}$/i;

export const themeRescue = () => /(^|[?&])theme=origine(&|$)/.test(location.search);

export function themeCss(theme: { light: ThemeColors; dark: ThemeColors }): string {
  const block = (colors: ThemeColors) => Object.entries(colors).filter(([k, v]) => TOKEN.test(k) && typeof v === "string" && HEX.test(v)).map(([k, v]) => `${k}:${v};`).join("");
  return `:root{${block(theme.light)}}:root[data-theme="dark"]{${block(theme.dark)}}`;
}

export function applyCustomTheme(theme: { light: ThemeColors; dark: ThemeColors } | null): void {
  document.getElementById(STYLE_ID)?.remove();
  if (!theme || themeRescue()) return;
  const el = document.createElement("style");
  el.id = STYLE_ID;
  el.textContent = themeCss(theme);
  document.head.appendChild(el);
}

async function load(signedIn: boolean) {
  if (!signedIn) { applyCustomTheme(null); return; }
  try { applyCustomTheme((await api<BotThemesView>("GET", "/themes"))?.applied ?? null); } catch { /* the app's own colours */ }
}

/** main.tsx: follows the signed-in user (a theme belongs to an account). */
export function startCustomTheme(): void {
  let last = useStore.getState().user?.id ?? null;
  if (last) void load(true);
  useStore.subscribe((s) => {
    const id = s.user?.id ?? null;
    if (id === last) return;
    last = id;
    void load(!!id);
  });
}
