/** L161 « thèmes créés par le bot » (botthemes.ts). Client-safe. */
export const THEME_TOKENS = ["--bg", "--surface", "--surface-2", "--surface-3", "--border", "--border-strong", "--text", "--text-2", "--text-3", "--ink", "--ink-fg", "--accent", "--accent-fg", "--brand", "--brand-soft", "--focus"] as const;
export type ThemeToken = (typeof THEME_TOKENS)[number];
/** Colours of one mode, "#rrggbb" each; a token left out keeps the app's own colour. */
export type ThemeColors = Partial<Record<ThemeToken, string>>;
/** The weakest pair of a mode, as the contrast check measured it. */
export interface ThemeWorst { fg: string; bg: string; ratio: number; min: number }
export interface BotThemeView {
  id: string; name: string; note: string;
  /** The bot that proposed it (null: it is gone). */
  botId: string | null; botName: string;
  light: ThemeColors; dark: ThemeColors;
  applied: boolean; createdAt: number; appliedAt: number | null;
  /** Measured again on each read: every text/background pair of the app, both modes. */
  check: { ok: boolean; light: ThemeWorst; dark: ThemeWorst; failures: string[] };
}
export interface BotThemesView { themes: BotThemeView[]; applied: BotThemeView | null; tokens: readonly string[]; max: number }
