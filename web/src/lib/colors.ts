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

/** Readable text on a "#rrggbb" background: dark on light colours, white otherwise. */
function textOn(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const lin = (c: number) => { const x = c / 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; };
  const l = 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return l > 0.45 ? "#17181b" : "#ffffff";
}

/** CSS custom properties that tint a subtree with a bot's colour (its free colour when it has one). */
export function accentStyle(color: string, custom?: string | null): CSSProperties {
  if (custom && /^#[0-9a-f]{6}$/i.test(custom)) return { "--accent": custom, "--accent-fg": textOn(custom) } as CSSProperties;
  const c = colorOf(color);
  return { "--accent": c.bg, "--accent-fg": c.fg } as CSSProperties;
}
