// The contrast check (scripts/check-contrast.mjs): its parser and maths, and the app's own tokens passing it.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { contrast, measure, parseColor, parseThemes, PAIRS } from "./check-contrast.mjs";

test("WCAG ratios: black on white is 21, white on white is 1, #767676 on white is about 4.54", () => {
  const white = parseColor("#fff");
  assert.equal(contrast(parseColor("#000000"), white).toFixed(1), "21.0");
  assert.equal(contrast(white, white), 1);
  assert.equal(contrast(parseColor("#767676"), white).toFixed(2), "4.54");
});

test("themes: :root is light; [data-theme=dark] and @media (prefers-color-scheme: dark) override it; var() is followed", () => {
  const css = `:root { --bg: #ffffff; --text: #111111; --accent: var(--text); }
    :root[data-theme="dark"] { --bg: #000000; }
    @media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { --text: #eeeeee; } }`;
  const { light, dark } = parseThemes(css);
  assert.equal(light["--bg"], "#ffffff");
  assert.equal(light["--text"], "#111111");
  assert.equal(dark["--bg"], "#000000");
  assert.equal(dark["--text"], "#eeeeee");
  const r = measure({ light, dark }, [["--accent", "--bg", "text", "accent text"]]);
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
});

test("a pair under its threshold, or an unknown token, fails", () => {
  const themes = { light: { "--bg": "#ffffff", "--text-3": "#aaaaaa" } };
  const [low, missing] = measure(themes, [["--text-3", "--bg", "text", "hint"], ["--nope", "--bg", "text", "x"]]);
  assert.equal(low.ok, false);
  assert.equal(missing.ok, false);
  assert.match(missing.error, /not defined/);
});

test("Sklubot's tokens pass every listed pair, in light and dark", () => {
  const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "../src/styles/tokens.css"), "utf8");
  const results = measure(parseThemes(css));
  assert.equal(results.length, PAIRS.length * 2);
  assert.deepEqual(results.filter((r) => !r.ok).map((r) => `${r.theme} ${r.fg} on ${r.bg}: ${r.ratio.toFixed(2)}`), []);
});
