/**
 * L184 / L161 « thème du bot » on the phone: the colour theme the owner applied in the web app (server botthemes.ts,
 * GET /api/themes → applied) laid over the phone's own colours (src/theme). The server already checked every
 * text/background pair against the WCAG thresholds in both modes; here only "#rrggbb" values of the tokens the phone uses
 * are taken (the same rule as web/src/lib/customtheme.ts), anything else keeps the phone's colour. Status colours (red,
 * orange, green, blue) are never themed. The user's bubble follows the ink, as on the web.
 */
export type ThemeColorsLike = Partial<Record<string, string>>;
export interface AppliedTheme { light: ThemeColorsLike; dark: ThemeColorsLike }

/** Web design token → the phone's colour names (src/theme/index.ts). */
export const TOKEN_TO_PHONE: Record<string, readonly string[]> = {
  "--bg": ["bg"], "--surface": ["surface"], "--surface-2": ["surface2"], "--surface-3": ["surface3"],
  "--border": ["border"], "--border-strong": ["borderStrong"],
  "--text": ["text"], "--text-2": ["text2"], "--text-3": ["text3"],
  "--ink": ["ink", "userBubble"], "--ink-fg": ["inkFg", "userBubbleFg"], "--brand": ["brand"], "--focus": ["focus"],
};
const HEX = /^#[0-9a-f]{6}$/i;

/** The phone's colours with the theme's checked values on top (a new object; `base` is not changed). */
export function withBotTheme<C extends Record<string, string>>(base: C, colors: ThemeColorsLike | null | undefined): C {
  if (!colors) return base;
  const out: Record<string, string> = { ...base };
  for (const [token, names] of Object.entries(TOKEN_TO_PHONE)) {
    const v = colors[token];
    if (typeof v === "string" && HEX.test(v)) for (const n of names) if (n in out) out[n] = v.toLowerCase();
  }
  return out as C;
}

/** The applied theme from GET /api/themes, or null when there is none or it is not well formed. */
export function appliedTheme(view: unknown): AppliedTheme | null {
  const a = (view as { applied?: { light?: unknown; dark?: unknown } | null } | null)?.applied;
  if (!a || typeof a.light !== "object" || typeof a.dark !== "object" || !a.light || !a.dark) return null;
  return { light: a.light as ThemeColorsLike, dark: a.dark as ThemeColorsLike };
}
