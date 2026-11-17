#!/usr/bin/env node
// Contrast check of the design tokens (docs/DESIGN.md, "Accessibilité").
//
// Reads web/src/styles/tokens.css, builds the light theme (`:root { … }`) and the dark theme
// (`:root[data-theme="dark"] { … }`, and any `@media (prefers-color-scheme: dark)` block, should one appear), then
// measures the WCAG 2.x contrast ratio of every text/background pair listed in PAIRS below, in both themes.
// Exits with code 1, and a report, when a pair is under its threshold:
//   text  4.5:1  (normal text, WCAG 1.4.3)
//   large 3:1    (text ≥ 18.66px bold or ≥ 24px, WCAG 1.4.3)
//   ui    3:1    (an icon, a status dot, a focus ring, a control's state: WCAG 1.4.11)
//
//   npm run check:contrast -w web            # report, fails under the thresholds
//   node scripts/check-contrast.mjs --all    # also prints the pairs that pass
//
// A new token pair used for text belongs in PAIRS (with where it is used), so it is measured from then on.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

export const THRESHOLDS = { text: 4.5, large: 3, ui: 3 };

/**
 * [foreground, background, level, where it is used]. A name starting with "--" is a token; anything else is a literal
 * CSS colour written in the stylesheets (e.g. "#ffffff" for the white text of the red button).
 */
export const PAIRS = [
  // Public landing page (Landing.tsx, landing.css): the brand highlight on the page, on cards and on its soft fill.
  ["--brand", "--bg", "large", "landing headline highlight"],
  ["--brand", "--surface", "text", "landing eyebrows and step numbers on cards"],
  ["--brand", "--brand-soft", "text", "landing chips on the brand fill"],
  ["--brand", "--bg", "text", "landing eyebrow text on the page"],
  ["--text", "--brand-soft", "text", "landing text on the brand fill"],
  // Body text and secondary text on every surface.
  ["--text", "--bg", "text", "page text"],
  ["--text", "--surface", "text", "text in cards, panels, modals"],
  ["--text", "--surface-2", "text", "text on a raised row, hover, chips"],
  ["--text", "--surface-3", "text", "active tab, logo tiles"],
  ["--text-2", "--bg", "text", "secondary text on the page"],
  ["--text-2", "--surface", "text", "secondary text in cards (.muted, .card-sub)"],
  ["--text-2", "--surface-2", "text", "chips, segmented control"],
  ["--text-2", "--surface-3", "text", "tabs, logo tiles"],
  ["--text-3", "--bg", "text", "hints, timestamps on the page"],
  ["--text-3", "--surface", "text", "field hints, placeholders, loading text"],
  ["--text-3", "--surface-2", "text", "kbd, hints on raised rows"],
  // Buttons.
  ["--ink-fg", "--ink", "text", "primary button (.btn-primary), toast"],
  ["--accent-fg", "--accent", "text", "accent button (.btn-accent), toggle knob"],
  ["--on-strong", "--danger", "text", "red button (.btn-danger, armed confirm)"],
  ["--on-strong", "--info", "text", "count badge (.count-badge)"],
  ["--on-strong", "--warn", "text", "count badge needing attention (.count-badge.is-attention)"],
  ["--danger", "--surface", "text", "danger link and menu item, error text"],
  ["--danger", "--bg", "text", "error text on the page"],
  // Status colours on their soft backgrounds (notices, chips, callouts, banners).
  ["--danger", "--danger-soft", "text", "error note, error chip"],
  ["--warn", "--warn-soft", "text", "warning callout, attention chip"],
  ["--warn", "--surface", "text", "warning text in cards"],
  ["--ok", "--ok-soft", "text", "success callout, ready chip"],
  ["--ok", "--surface", "text", "success text in cards"],
  ["--info", "--info-soft", "text", "working chip, info notice"],
  ["--info", "--surface", "text", "info text in cards"],
  ["--text", "--warn-soft", "text", "body text inside a warning banner"],
  ["--text", "--danger-soft", "text", "body text inside an error banner"],
  ["--text", "--info-soft", "text", "body text inside an info banner"],
  ["--text-2", "--warn-soft", "text", "secondary text inside a warning banner"],
  // Non-text: focus ring, status dots, the "on" toggle.
  ["--focus", "--bg", "ui", "focus ring on the page"],
  ["--focus", "--surface", "ui", "focus ring in cards"],
  ["--accent", "--surface", "ui", "toggle switched on"],
  ["--danger", "--surface", "ui", "error dot"],
  ["--warn", "--surface", "ui", "attention dot"],
  ["--ok", "--surface", "ui", "ok / working dot"],
  ["--info", "--surface", "ui", "unread dot"],
];

/** `--name: value;` declarations of a block body. */
export function declarations(body) {
  const out = {};
  for (const [, name, value] of body.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) out[name] = value.trim();
  return out;
}

/** The body of the block opened at `open` (index of its "{"), braces balanced. */
function blockBody(css, open) {
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return css.slice(open + 1);
}

/**
 * The themes the stylesheet declares: `light` is every plain `:root` block; `dark` is light overlaid with the
 * `:root[data-theme="dark"]` blocks and the `:root` blocks inside `@media (prefers-color-scheme: dark)`.
 */
export function parseThemes(source) {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, "");
  const light = {};
  const dark = {};
  // Media blocks first, cut out so their inner `:root` is not read as the light theme.
  let rest = css;
  for (const m of css.matchAll(/@media[^{]*prefers-color-scheme:\s*dark[^{]*\{/g)) {
    const body = blockBody(css, m.index + m[0].length - 1);
    for (const inner of body.matchAll(/:root[^{]*\{([^}]*)\}/g)) Object.assign(dark, declarations(inner[1]));
    rest = rest.replace(m[0] + body + "}", "");
  }
  for (const m of rest.matchAll(/(:root[^{,]*)\{([^}]*)\}/g)) {
    const selector = m[1].trim();
    if (/data-theme\s*=\s*["']?dark/.test(selector)) Object.assign(dark, declarations(m[2]));
    else if (selector === ":root") Object.assign(light, declarations(m[2]));
  }
  return { light, dark: { ...light, ...dark } };
}

/** A token's value with `var(--x)` references followed (up to 10 levels). */
export function resolve(tokens, value) {
  let v = value;
  for (let i = 0; i < 10; i++) {
    const m = /^var\(\s*(--[\w-]+)\s*(?:,\s*(.+))?\)$/.exec(v.trim());
    if (!m) return v.trim();
    v = tokens[m[1]] ?? m[2] ?? "";
  }
  return v.trim();
}

/** #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba() → {r, g, b, a} (0–255, alpha 0–1); null for anything else. */
export function parseColor(value) {
  const v = value.trim().toLowerCase();
  if (v === "white") return { r: 255, g: 255, b: 255, a: 1 };
  if (v === "black") return { r: 0, g: 0, b: 0, a: 1 };
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    const h = hex[1].length <= 4 ? Array.from(hex[1], (c) => c + c).join("") : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  const rgb = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/.exec(v);
  if (rgb) {
    const a = rgb[4] === undefined ? 1 : rgb[4].endsWith("%") ? parseFloat(rgb[4]) / 100 : parseFloat(rgb[4]);
    return { r: +rgb[1], g: +rgb[2], b: +rgb[3], a };
  }
  return null;
}

/** A translucent colour painted over an opaque one. */
export function over(top, base) {
  const a = top.a;
  return { r: top.r * a + base.r * (1 - a), g: top.g * a + base.g * (1 - a), b: top.b * a + base.b * (1 - a), a: 1 };
}

/** WCAG 2.x relative luminance. */
export function luminance({ r, g, b }) {
  const lin = (c) => {
    const s = c / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.x contrast ratio, 1–21. */
export function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** Every pair measured in every theme: [{theme, fg, bg, level, where, ratio, min, ok, error?}]. */
export function measure(themes, pairs = PAIRS) {
  const results = [];
  for (const [theme, tokens] of Object.entries(themes)) {
    const pageBg = parseColor(resolve(tokens, tokens["--bg"] ?? "#ffffff")) ?? { r: 255, g: 255, b: 255, a: 1 };
    const color = (name) => {
      const raw = name.startsWith("--") ? tokens[name] : name;
      if (raw === undefined) return { error: `${name} is not defined` };
      const c = parseColor(resolve(tokens, raw));
      if (!c) return { error: `${name}: cannot read the colour "${raw}"` };
      return { c };
    };
    for (const [fgName, bgName, level, where] of pairs) {
      const min = THRESHOLDS[level];
      const fg = color(fgName);
      const bg = color(bgName);
      const error = fg.error ?? bg.error;
      if (error) {
        results.push({ theme, fg: fgName, bg: bgName, level, where, ratio: 0, min, ok: false, error });
        continue;
      }
      const base = bg.c.a < 1 ? over(bg.c, pageBg) : bg.c;
      const front = fg.c.a < 1 ? over(fg.c, base) : fg.c;
      const ratio = contrast(front, base);
      results.push({ theme, fg: fgName, bg: bgName, level, where, ratio, min, ok: ratio >= min });
    }
  }
  return results;
}

export function report(results, { all = false } = {}) {
  const lines = [];
  const failed = results.filter((r) => !r.ok);
  for (const r of results) {
    if (r.ok && !all) continue;
    const ratio = r.error ? r.error : `${r.ratio.toFixed(2)}:1`;
    lines.push(`${r.ok ? "ok  " : "FAIL"}  ${r.theme.padEnd(5)}  ${r.fg} on ${r.bg}  ${ratio} (min ${r.min}:1, ${r.level})  — ${r.where}`);
  }
  lines.push(failed.length ? `\n${failed.length} pair(s) under the threshold out of ${results.length}. Adjust the token in web/src/styles/tokens.css (both themes), then run again.` : `All ${results.length} pairs pass (${PAIRS.length} pairs × light and dark).`);
  return lines.join("\n");
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const themes = parseThemes(readFileSync(join(root, "src/styles/tokens.css"), "utf8"));
  const results = measure(themes);
  console.log(report(results, { all: process.argv.includes("--all") }));
  if (results.some((r) => !r.ok)) process.exit(1);
}
