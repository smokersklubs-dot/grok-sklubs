import type { CSSProperties } from "react";
import type { AvatarColor } from "../types";

/** Our palette. "ink" follows the theme (dark on light, light on dark) via CSS variables. */
export const COLORS: Record<AvatarColor, { bg: string; fg: string }> = {
  ink: { bg: "var(--ink)", fg: "var(--ink-fg)" },
  clay: { bg: "#a9634a", fg: "#ffffff" },
  ember: { bg: "#dd5230", fg: "#ffffff" },
  amber: { bg: "#c08310", fg: "#ffffff" },
  moss: { bg: "#5a8739", fg: "#ffffff" },
  teal: { bg: "#138a84", fg: "#ffffff" },
  sky: { bg: "#2c86cf", fg: "#ffffff" },
  indigo: { bg: "#525dd6", fg: "#ffffff" },
  plum: { bg: "#8c4ba6", fg: "#ffffff" },
  rose: { bg: "#cf4576", fg: "#ffffff" },
  slate: { bg: "#607086", fg: "#ffffff" },
};

export function colorOf(color: string): { bg: string; fg: string } {
  return COLORS[color as AvatarColor] ?? COLORS.slate;
}

/** CSS custom properties that tint a subtree with a bot's colour. */
export function accentStyle(color: string): CSSProperties {
  const c = colorOf(color);
  return { "--accent": c.bg, "--accent-fg": c.fg } as CSSProperties;
}
