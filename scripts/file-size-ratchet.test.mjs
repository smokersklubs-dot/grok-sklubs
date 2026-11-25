// File-size ratchet: stops the giant source files from growing further.
//
// Every source file of web/src and server/src (.ts, .tsx, .css, .mjs, .js) of LISTED_FROM lines or more is listed in
// scripts/file-size-baseline.json with its line count. A listed file may grow by at most MARGIN lines over its count;
// any other file may not go over NEW_FILE_LIMIT lines. So a change that adds to a big file has to move code out
// into a new, smaller module instead (one file per feature, named after what it does, never "Wave12.tsx").
// The translation dictionaries are not counted (one line per text: they grow with every feature).
//
//   npm run check:size              # the check (also part of `npm test`)
//   npm run check:size:update       # rewrite the baseline from the files as they are now
//
// Update the baseline after splitting or shrinking a file (it lowers the counts, so the space freed is not quietly
// filled again), or, when a listed file really has to grow past its margin, in the same change, saying why.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const BASELINE = join(ROOT, "scripts/file-size-baseline.json");
const DIRS = ["web/src", "server/src"];
const EXT = /\.(ts|tsx|css|mjs|js)$/;
const EXEMPT = new Set(["web/src/i18n/fr.ts", "web/src/i18n/en.ts", "server/src/i18n.ts"]);
// Every language's dictionary file (web/src/i18n/<code>.ts, server/src/lang/<code>.ts, docs/LANGUES.md) is exempt too.
const EXEMPT_RE = /^(web\/src\/i18n|server\/src\/lang)\/[a-z]{2}\.ts$/;
export const LISTED_FROM = 1000;
export const MARGIN = 25;
export const NEW_FILE_LIMIT = 1500;

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

/** { "web/src/…": lines } for every counted file. */
export function measure() {
  const counts = {};
  for (const d of DIRS) {
    for (const f of walk(join(ROOT, d))) {
      const rel = relative(ROOT, f).split("\\").join("/");
      if (EXEMPT.has(rel) || EXEMPT_RE.test(rel)) continue;
      counts[rel] = readFileSync(f, "utf8").split("\n").length - 1;
    }
  }
  return counts;
}

/** The problems, in words: an empty list when every file is within its limit. */
export function check(counts, baseline) {
  const problems = [];
  for (const [file, lines] of Object.entries(counts).sort()) {
    const pinned = baseline[file];
    if (pinned !== undefined) {
      if (lines > pinned + MARGIN) problems.push(`${file} has ${lines} lines (baseline ${pinned}, margin ${MARGIN}): move code out into a new module instead of adding here`);
    } else if (lines > NEW_FILE_LIMIT) {
      problems.push(`${file} has ${lines} lines, over the ${NEW_FILE_LIMIT}-line limit for a file not in the baseline: split it`);
    }
  }
  return problems;
}

if (process.argv.includes("--update")) {
  const counts = measure();
  const listed = Object.fromEntries(Object.entries(counts).filter(([, n]) => n >= LISTED_FROM).sort(([a], [b]) => a.localeCompare(b)));
  writeFileSync(BASELINE, JSON.stringify(listed, null, 2) + "\n");
  console.log(`scripts/file-size-baseline.json: ${Object.keys(listed).length} files of ${LISTED_FROM} lines or more.`);
} else {
  test("source files stay a readable size (scripts/file-size-baseline.json)", () => {
    const baseline = JSON.parse(readFileSync(BASELINE, "utf8"));
    assert.deepEqual(check(measure(), baseline), []);
  });

  test("the ratchet itself: a listed file may not grow past its margin, a new file past the limit", () => {
    assert.deepEqual(check({ "a.ts": 1025, "b.ts": 1500 }, { "a.ts": 1000 }), []);
    assert.equal(check({ "a.ts": 1026 }, { "a.ts": 1000 }).length, 1);
    assert.equal(check({ "c.tsx": 1501 }, {}).length, 1);
  });
}
