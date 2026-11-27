/**
 * L184 / L161: the theme the owner applied in the web app (Réglages → Général → Thèmes proposés), fetched after sign-in
 * and when Réglages opens (GET /api/themes, server botthemes.ts); cleared on sign-out. Laid over the colours by
 * useTheme (shared/botTheme.ts) unless « Thème du bot » is off in Réglages (prefs.botTheme, the phone's rescue switch).
 */
import { create } from "zustand";
import { appliedTheme, type AppliedTheme } from "../../shared/botTheme";

export const useBotTheme = create<{ applied: AppliedTheme | null }>(() => ({ applied: null }));

/** `call`: the store's API call (same session). A failure keeps the phone's own colours. */
export async function loadBotTheme(call: (method: "GET", path: string) => Promise<unknown>): Promise<void> {
  try { useBotTheme.setState({ applied: appliedTheme(await call("GET", "/themes")) }); } catch { /* the phone's own colours */ }
}
export const clearBotTheme = () => useBotTheme.setState({ applied: null });
