import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { WORK_FR } from "../src/worki18n.js";

// Every text the wave-7 modules write for the owner (wt("…"), and the messages of their errors, translated by the routes)
// has its French line in worki18n.ts.
const SRC = path.join(path.dirname(fileURLToPath(import.meta.url)), "../src");
const FILES = ["workboard.ts", "workboardroutes.ts", "flows.ts", "automations.ts", "teammemory.ts", "workroutes.ts", "agent/worklessons.ts"];
const PATTERNS = [/\bwt\([^,]+,\s*"((?:[^"\\]|\\.)+)"/g, /new (?:Board|Flow|Automation|TeamMemory|Lesson)Error\(\d+,\s*"((?:[^"\\]|\\.)+)"/g, /\b(?:bad|refuse)\("((?:[^"\\]|\\.)+)"\)/g, /: wt\(loc, "((?:[^"\\]|\\.)+)"/g];

test("every owner-facing text of the work board, flows, automations, team memory and lessons has its French line", () => {
  const missing = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(path.join(SRC, f), "utf8");
    for (const re of PATTERNS) for (const m of src.matchAll(re)) { const en = JSON.parse(`"${m[1]}"`); if (!(en in WORK_FR)) missing.add(`${f}: ${en}`); }
  }
  assert.deepEqual([...missing], []);
});

test("the French lines keep every {placeholder} of the English", () => {
  for (const [en, fr] of Object.entries(WORK_FR)) {
    const vars = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    assert.equal(vars(fr), vars(en), en);
  }
});
