import { proposeTheme } from "../botthemes.js";
import { THEME_TOKENS } from "../botthemetypes.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L161 « thèmes créés par le bot »: theme_propose (botthemes.ts). The bot never applies a theme: the owner does, in
 * Settings → General, and only one that passes the contrast check.
 */
const colors = (mode: string) => ({ type: "object", description: `Colours for ${mode} mode, "#rrggbb" each, by token. Tokens: ${THEME_TOKENS.join(", ")}. A token left out keeps the app's colour.`, additionalProperties: { type: "string" } });

export const themeTools: BuiltinTool[] = [{
  spec: {
    name: "theme_propose",
    description: "Propose a colour theme for the Sklubot app itself (its backgrounds, text, buttons, accent), in light and dark mode. It is checked at once: every text must stay readable (WCAG contrast 4.5:1, 3:1 for large text and controls) in both modes, otherwise you get the faint pairs to fix and nothing is saved. A saved theme is only a proposal: the user applies it in Settings → General. Status colours (red, orange, green, blue) cannot be changed.",
    inputSchema: { type: "object", properties: { name: { type: "string", description: "Short name, e.g. \"Sable\"" }, note: { type: "string", description: "One line on the idea behind it" }, light: colors("light"), dark: colors("dark") }, required: ["name"] },
  },
  activity: "writing", label: "Proposing a theme", detail: (a) => String(a.name ?? ""),
  run: async (a, c) => {
    const r = proposeTheme(c.bot, a);
    if ("errors" in r) return { content: `Not saved.\n${r.errors.join("\n")}\nFix these colours and propose it again.`, isError: true, summary: "contrast too low" };
    return { content: `Saved as a proposal ("${r.theme.name}"). The user can apply it in Settings → General → Proposed themes. Weakest pairs: light ${r.theme.check.light.fg} on ${r.theme.check.light.bg} ${r.theme.check.light.ratio}:1, dark ${r.theme.check.dark.fg} on ${r.theme.check.dark.bg} ${r.theme.check.dark.ratio}:1.`, summary: r.theme.name };
  },
}];
