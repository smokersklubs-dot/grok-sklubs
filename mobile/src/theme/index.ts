import { useColorScheme } from "react-native";
import { usePrefs } from "../state/prefs";

/** Sklubot design system: warm industrial neutrals, precise contrast and a restrained orange accent. */
const light = {
  bg: "#f5f3ef", surface: "#ffffff", surface2: "#f8f6f2", surface3: "#eeebe5",
  border: "#e8e3db", borderStrong: "#d5cec2",
  text: "#202329", text2: "#5e646d", text3: "#858b94",
  ink: "#202329", inkFg: "#ffffff",
  danger: "#c43c3c", dangerSoft: "#fbecec", warn: "#a96316", warnSoft: "#fbf1df",
  ok: "#287c50", okSoft: "#e6f4ec", info: "#2869a9", infoSoft: "#eaf1fa",
  focus: "#3b76e1", scrim: "rgba(22,24,28,0.46)", brand: "#e2552d",
  userBubble: "#252a31", userBubbleFg: "#ffffff",
};
const dark: typeof light = {
  bg: "#101215", surface: "#191d22", surface2: "#20252b", surface3: "#292f36",
  border: "#2b323a", borderStrong: "#3c4651",
  text: "#f1f3f5", text2: "#aeb6c0", text3: "#7d8792",
  ink: "#f1f3f5", inkFg: "#171a1e",
  danger: "#f07878", dangerSoft: "#3a2022", warn: "#e6ad62", warnSoft: "#35290f",
  ok: "#69ca94", okSoft: "#17301f", info: "#83b8f0", infoSoft: "#1a2a3d",
  focus: "#7aa7f5", scrim: "rgba(0,0,0,0.66)", brand: "#f06b45",
  userBubble: "#e8eaee", userBubbleFg: "#17181b",
};
export type Colors = typeof light;
export const radius = { sm: 8, md: 13, lg: 18, xl: 24 };

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
