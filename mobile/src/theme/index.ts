import { useColorScheme } from "react-native";
import { usePrefs } from "../state/prefs";

/** Sklubot's design tokens (web/src/styles/tokens.css), light and dark. */
const light = {
  bg: "#f4f2ee", surface: "#ffffff", surface2: "#f3f1ed", surface3: "#e9e6e0",
  border: "#e4e0d8", borderStrong: "#cdc8bd",
  text: "#1e2024", text2: "#5a5f67", text3: "#8a8f97",
  ink: "#23262b", inkFg: "#ffffff",
  danger: "#c43c3c", dangerSoft: "#fbecec", warn: "#b26a12", warnSoft: "#fbf1df",
  ok: "#2c8a57", okSoft: "#e6f4ec", info: "#2a6fb8", infoSoft: "#eaf1fa",
  focus: "#3b76e1", scrim: "rgba(24,22,18,0.38)", brand: "#e2552d",
  userBubble: "#23262b", userBubbleFg: "#ffffff",
};
const dark: typeof light = {
  bg: "#131416", surface: "#1a1c1f", surface2: "#222528", surface3: "#2c2f33",
  border: "#2b2e32", borderStrong: "#3d4146",
  text: "#eceef1", text2: "#a7adb5", text3: "#767c85",
  ink: "#e8eaee", inkFg: "#17181b",
  danger: "#ee6b6b", dangerSoft: "#3a2022", warn: "#e0a34a", warnSoft: "#35290f",
  ok: "#5cc28a", okSoft: "#17301f", info: "#79b0ee", infoSoft: "#1a2a3d",
  focus: "#7aa7f5", scrim: "rgba(0,0,0,0.58)", brand: "#e2552d",
  userBubble: "#e8eaee", userBubbleFg: "#17181b",
};
export type Colors = typeof light;
export const radius = { sm: 6, md: 10, lg: 14, xl: 20 };

/** Bot colours (web/src/lib/colors.ts). "ink" follows the theme. */
export const BOT_COLORS: Record<string, string> = {
  clay: "#a9634a", ember: "#dd5230", amber: "#c08310", moss: "#5a8739", teal: "#138a84",
  sky: "#2c86cf", indigo: "#525dd6", plum: "#8c4ba6", rose: "#cf4576", slate: "#607086",
};
export function botColor(color: string, custom: string | null | undefined, c: Colors): string {
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) return custom;
  if (color === "ink") return c.ink;
  return BOT_COLORS[color] ?? BOT_COLORS.slate;
}

export function useTheme(): { c: Colors; dark: boolean } {
  const system = useColorScheme();
  const pref = usePrefs((p) => p.theme);
  const isDark = pref === "dark" || (pref === "system" && system === "dark");
  return { c: isDark ? dark : light, dark: isDark };
}
export const themes = { light, dark };
