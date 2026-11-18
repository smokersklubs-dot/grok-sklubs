// Touch targets (docs/DESIGN.md, "Accessibilité"): on a touch screen (`@media (pointer: coarse)`) every button can be
// hit with a finger, at least 44 × 44 px. web/src/styles/base.css does it two ways: buttons and fields grow to
// `min-height: 44px`, compact controls get an invisible 44 × 44 px hit area (`::after`). This test reads every
// stylesheet of the app and fails when a button-like class (btn, icon-btn, tab, toggle, link, …-btn, …-x, …-tab,
// …-close) is in neither list, unless it always sits on a class that is (MODIFIERS, checked against the components).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const SRC = join(dirname(fileURLToPath(import.meta.url)), "../src");
const MIN = 44;

/** Classes that are buttons whatever their name. */
const ALWAYS = ["btn", "option", "files-row-head", "today-group-head", "icon-btn", "round-btn", "tab", "toggle", "link", "chip-link", "chip-button", "toast-action", "swatch", "menu-item", "check-row", "list-row-btn", "account-btn", "google-btn"];
const LOOKS_LIKE_BUTTON = /(^|-)(btn|x|tab|close)$/;
/** A class only ever used together with a covered one: [class, the covered class it sits on]. */
const MODIFIERS = {
  "pause-banner-btn": "btn",
  "gem-hunt-btn": "btn",
  "sidebar-close": "icon-btn",
  "app-settings-close": "icon-btn",
  "auth-btn": "btn",
  "onb-push-btn": "btn",
};

function files(dir, ext) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) { if (e.name !== "dev") out.push(...files(p, ext)); }
    else if (e.name.endsWith(ext)) out.push(p);
  }
  return out;
}

const strip = (css) => css.replace(/\/\*[\s\S]*?\*\//g, "");

/** The inner text of every `@media (pointer: coarse) { … }` block. */
export function coarseBlocks(css) {
  const blocks = [];
  for (const m of css.matchAll(/@media\s*\(\s*pointer:\s*coarse\s*\)\s*\{/g)) {
    let depth = 0;
    const open = m.index + m[0].length - 1;
    for (let i = open; i < css.length; i++) {
      if (css[i] === "{") depth++;
      else if (css[i] === "}" && --depth === 0) { blocks.push(css.slice(open + 1, i)); break; }
    }
  }
  return blocks;
}

/** Split on commas outside parentheses. */
function splitTop(list) {
  const out = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < list.length; i++) {
    if (list[i] === "(") depth++;
    else if (list[i] === ")") depth--;
    else if (list[i] === "," && depth === 0) { out.push(list.slice(start, i).trim()); start = i + 1; }
  }
  out.push(list.slice(start).trim());
  return out.filter(Boolean);
}

/** `:where(a, b)::after` → ["a::after", "b::after"]; any other selector as is. */
function expandWhere(sel) {
  if (!sel.startsWith(":where(")) return [sel];
  let depth = 0;
  for (let i = 6; i < sel.length; i++) {
    if (sel[i] === "(") depth++;
    else if (sel[i] === ")" && --depth === 0) return splitTop(sel.slice(7, i)).map((s) => s + sel.slice(i + 1));
  }
  return [sel];
}

/** Selectors of a block's rules, each split on top-level commas and `:where(…)` lists expanded. */
function rules(block) {
  const out = [];
  for (const [, sel, body] of block.matchAll(/([^{}]+)\{([^}]*)\}/g)) {
    out.push({ selectors: splitTop(sel.trim()).flatMap(expandWhere), body });
  }
  return out;
}

/** What the coarse blocks cover: selectors grown to 44 px, and selectors given a 44 × 44 hit area. */
export function coverage(css) {
  const grown = new Set();
  const hit = new Set();
  for (const block of coarseBlocks(css)) {
    for (const { selectors, body } of rules(block)) {
      const minH = /min-height:\s*(\d+)px/.exec(body);
      if (minH && +minH[1] >= MIN) selectors.forEach((s) => grown.add(s));
      const sized = new RegExp(`width:\\s*max\\(100%,\\s*${MIN}px\\)`).test(body) && new RegExp(`height:\\s*max\\(100%,\\s*${MIN}px\\)`).test(body);
      if (sized && /position:\s*absolute/.test(body)) selectors.filter((s) => s.endsWith("::after")).forEach((s) => hit.add(s.replace(/::after$/, "")));
    }
  }
  return { grown, hit };
}

const allCss = files(SRC, ".css").map((f) => ({ f, css: strip(readFileSync(f, "utf8")) }));
const css = allCss.map((x) => x.css).join("\n");
const { grown, hit } = coverage(css);
const covered = [...grown, ...hit];
/** A class is covered when a covered selector ends on it (`.btn`, `.segmented button` counts for "segmented"). */
const isCovered = (cls) => covered.some((s) => new RegExp(`\\.${cls}(?![\\w-])[^ >+~]*( button)?$`).test(s));

test("the coarse-pointer block exists and gives 44 × 44 px", () => {
  assert.ok(coarseBlocks(css).length > 0, "no @media (pointer: coarse) block in web/src");
  assert.ok(grown.has(".btn") && grown.has(".btn-small"), ".btn and .btn-small must grow to 44 px on touch screens");
  assert.ok(hit.has(".icon-btn"), ".icon-btn must get a 44 × 44 px hit area on touch screens");
});

test("every button-like class is covered on touch screens", () => {
  const candidates = new Set();
  for (const { css: c } of allCss) {
    for (const [, cls] of c.replace(/@media[^{]*\{/g, "").matchAll(/\.([a-z][a-z0-9-]*)/g)) {
      if (ALWAYS.includes(cls) || LOOKS_LIKE_BUTTON.test(cls)) candidates.add(cls);
    }
  }
  const problems = [];
  for (const cls of [...candidates].sort()) {
    if (isCovered(cls)) continue;
    if (MODIFIERS[cls]) continue;
    problems.push(`.${cls}: add it to the @media (pointer: coarse) block of web/src/styles/base.css (min-height: 44px, or the 44 × 44 hit-area list), or to MODIFIERS here if it always sits on a covered class`);
  }
  assert.deepEqual(problems, []);
});

test("each modifier always sits on its covered class", () => {
  const tsx = files(SRC, ".tsx").map((f) => readFileSync(f, "utf8").split("\n").map((line, i) => ({ f, i, line }))).flat();
  const problems = [];
  for (const [cls, base] of Object.entries(MODIFIERS)) {
    assert.ok(isCovered(base), `.${base} (base of .${cls}) is not covered`);
    const uses = tsx.filter(({ line }) => new RegExp(`className=[{"\`][^"\`]*\\b${cls}\\b`).test(line));
    for (const { f, i, line } of uses) {
      const classes = (/className=\{?["`]([^"`]*)["`]/.exec(line)?.[1] ?? "").split(/\s+/);
      const withBase = classes.includes(base);
      const viaIconButton = base === "icon-btn" && line.includes("<IconButton");
      if (!withBase && !viaIconButton) problems.push(`${f.slice(SRC.length + 1)}:${i + 1}: .${cls} without .${base}`);
    }
  }
  assert.deepEqual(problems, []);
});
