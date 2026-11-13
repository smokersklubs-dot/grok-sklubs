import type { CSSProperties } from "react";
import type { AvatarColor } from "../types";

/** Our palette. "ink" follows the theme (dark on light, light on dark) via CSS variables. */
export const COLORS: Record<AvatarColor, { bg: string; fg: string; label: string }> = {
  ink: { bg: "var(--ink)", fg: "var(--ink-fg)", label: "Ink" },
  clay: { bg: "#a9634a", fg: "#ffffff", label: "Clay" },
  ember: { bg: "#dd5230", fg: "#ffffff", label: "Ember" },
  amber: { bg: "#c08310", fg: "#ffffff", label: "Amber" },
  moss: { bg: "#5a8739", fg: "#ffffff", label: "Moss" },
  teal: { bg: "#138a84", fg: "#ffffff", label: "Teal" },
  sky: { bg: "#2c86cf", fg: "#ffffff", label: "Sky" },
  indigo: { bg: "#525dd6", fg: "#ffffff", label: "Indigo" },
  plum: { bg: "#8c4ba6", fg: "#ffffff", label: "Plum" },
  rose: { bg: "#cf4576", fg: "#ffffff", label: "Rose" },
  slate: { bg: "#607086", fg: "#ffffff", label: "Slate" },
};

export function colorOf(color: string): { bg: string; fg: string; label: string } {
  return COLORS[color as AvatarColor] ?? COLORS.slate;
}

/** CSS custom properties that tint a subtree with a bot's colour. */
export function accentStyle(color: string): CSSProperties {
  const c = colorOf(color);
  return { "--accent": c.bg, "--accent-fg": c.fg } as CSSProperties;
}
