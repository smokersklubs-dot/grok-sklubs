/**
 * Renders Sklubot's real <Character> component (web/src/components/Character.tsx) to static SVG markup,
 * for each bot of the promo and each state it uses. Output: ../characters.js (window.CHAR = {...}).
 * Run: npx esbuild ... (see marketing/promo/README.md).
 */
import { renderToStaticMarkup } from "react-dom/server";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Character } from "../../../../web/src/components/Character";
import { Icon } from "../../../../web/src/components/Icon";

type B = { shape: string; color: string; name: string; character?: Record<string, unknown> };
export const BOTS: Record<string, B> = {
  juno: { name: "Juno", shape: "circle", color: "indigo", character: { eyes: "round", accessory: "antenna", cheeks: true } },
  seo: { name: "Max", shape: "cat", color: "teal", character: { accessory: "headset" } },
  prospect: { name: "Léa", shape: "pebble", color: "ember", character: { eyes: "oval", accessory: "cap" } },
  support: { name: "Noé", shape: "cloud", color: "sky", character: { accessory: "headset", cheeks: true } },
  social: { name: "Iris", shape: "bear", color: "plum", character: { accessory: "bow", eyes: "wide" } },
  admin: { name: "Oscar", shape: "squircle", color: "amber", character: { eyes: "visor", accessory: "sprout" } },
};
const STATES = ["idle", "working", "thinking", "waiting", "happy", "euphoric", "speaking", "sleeping"] as const;
const ICONS = ["check", "alert", "clock", "tasks", "globe", "smartphone", "monitor", "terminal", "folder", "mail", "search", "chart", "chat", "shield", "sun", "moon", "volume", "brain", "users", "send", "target", "lock", "cursor"] as const;
const out: Record<string, Record<string, string>> = {};
for (const [id, bot] of Object.entries(BOTS)) {
  out[id] = {};
  for (const st of STATES) out[id][st] = renderToStaticMarkup(<Character bot={bot} size={200} state={st} label={null} />);
}
const icons: Record<string, string> = {};
for (const n of ICONS) icons[n] = renderToStaticMarkup(<Icon name={n} size={24} />);
writeFileSync(process.argv[2], "window.ICON = " + JSON.stringify(icons) + ";\nwindow.CHAR = " + JSON.stringify(out) + ";\nwindow.BOTS = " + JSON.stringify(BOTS) + ";\n");
console.log("ok", Object.keys(out).length);

// Sklubot's design tokens, scoped so a scene can be light or dark on its own (.theme-light / .theme-dark).
const tokensPath = join(dirname(process.argv[2]), "../../../web/src/styles/tokens.css");
const tokens = readFileSync(tokensPath, "utf8").replace(':root[data-theme="dark"] {', ".theme-dark {").replace(":root {", ":root, .theme-light {");
writeFileSync(join(dirname(process.argv[2]), "tokens-scoped.css"), "/* Generated from web/src/styles/tokens.css by build/extract-characters.tsx. Do not edit. */\n" + tokens);
// The characters' own animations, copied as is.
writeFileSync(join(dirname(process.argv[2]), "character.css"), "/* Copied from web/src/styles/character.css by build/extract-characters.tsx. Do not edit. */\n" + readFileSync(join(dirname(tokensPath), "character.css"), "utf8"));
