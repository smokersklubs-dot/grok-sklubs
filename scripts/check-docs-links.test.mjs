// L160 docs link checker: unit tests on small fixtures, plus the real docs must pass.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { anchorsOf, checkDoc, citedLines, docFiles, isDatedRecord, linksOf, slugify } from "./check-docs-links.mjs";

test("slugify follows GitHub heading ids (accents kept, punctuation dropped)", () => {
  assert.equal(slugify("Server-mediated voice (`server/src/voice/`)"), "server-mediated-voice-serversrcvoice");
  assert.equal(slugify("5. À faire (classé)"), "5-à-faire-classé");
  assert.deepEqual([...anchorsOf("# A\n## A\n```\n# not\n```\n<a id=\"x\"></a>")], ["a", "a-1", "x"]);
});

test("links in code are ignored, others found with their line", () => {
  assert.deepEqual(linksOf("see [a](b.md)\n`[c](d.md)`\n```\n[e](f.md)\n```\n[ref]: g.md"), [{ target: "b.md", line: 1 }, { target: "g.md", line: 6 }]);
  assert.deepEqual(citedLines("`x.ts:12` and `y.md` l.95-97"), [{ path: "x.ts", n: 12, line: 1 }, { path: "y.md", n: 97, line: 1 }]);
});

test("missing file, missing heading and line past the end fail; web links do not", () => {
  const root = mkdtempSync(join(tmpdir(), "docs-"));
  mkdirSync(join(root, "docs"));
  writeFileSync(join(root, "docs/B.md"), "# Titre là\n");
  writeFileSync(join(root, "code.ts"), "a\nb\nc\n");
  const md = "[ok](B.md#titre-là) [web](https://example.com) [gone](C.md) [anchor](B.md#nope) `code.ts:3` `code.ts:40`";
  const read = (p) => readFileSync(p, "utf8");
  const problems = checkDoc(root, join(root, "docs/A.md"), md, read);
  assert.equal(problems.length, 3, problems.join("\n"));
  assert.ok(problems[0].includes("missing file: C.md"));
  assert.ok(problems[1].includes("no heading #nope"));
  assert.ok(problems[2].includes("has 4 lines, line 40"));
  assert.ok(isDatedRecord("docs/audits/AUDIT-X.md", ""));
  assert.ok(!isDatedRecord("docs/VOIX.md", "# Voix\n"));
});

test("the real documents have no broken reference", () => {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const read = (p) => readFileSync(p, "utf8");
  const problems = docFiles(root).flatMap((f) => checkDoc(root, f, read(f), read));
  assert.deepEqual(problems, []);
});
