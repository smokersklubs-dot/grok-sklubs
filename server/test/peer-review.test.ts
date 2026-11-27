import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Card, FileChange } from "../src/shared.js";

// L77 « Relecture entre bots »: lots instead of « 12 files then stop », per-file coverage, the user's goal, read-only
// look-ups, line anchors, the fact-checking pass and lenient JSON. The reviewer is scripted (reviewAsk.run): no model.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-peerreview-"));
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "peer-review-tests-local-secret-0000";
process.env.NO_SCHEDULER = "1";
process.env.HOSTED_MODE = "0";
const { users, bots, rows } = await import("../src/store.js");
const { reviewChanges, reviewAsk } = await import("../src/peerreview.js");
const { snapRunner } = await import("../src/snapshots.js");
const { whyExcluded, packBatches, isSecretPath } = await import("../src/reviewselect.js");
const { locateInDiff, locateInFile, anchorFindings } = await import("../src/reviewanchor.js");
const { lenientJson } = await import("../src/reviewprompt.js");
const { listedPathOk } = await import("../src/snapshots.js");

const owner = users.create("peer-review@example.test", "User", "unused", "fr");
const author = bots.create(owner.id, { name: "Auteur" });
const reviewer = bots.create(owner.id, { name: "Relecteur" });
const fc = (path: string, extra: Partial<FileChange> = {}): FileChange => ({ path, change: "modified", added: 3, removed: 1, binary: false, oldSize: 10, newSize: 20, ...extra });
const diffOf = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -10,3 +10,4 @@ export function f() {\n   const a = 1;\n-  return a;\n+  const total = a + other;\n+  return total;\n }\n`;
function cardWith(files: FileChange[]): { row: ReturnType<typeof rows.append>; card: Extract<Card, { type: "files" }> } {
  rows.append(author, { kind: "message", role: "user", text: "Ajoute le total des factures sans casser l'export CSV." }, 0);
  rows.append(author, { kind: "step", callId: "c" + Math.random(), tool: "run", label: "t", status: "done", args: { command: "npm test" }, summary: "12 tests passed" });
  const card: Extract<Card, { type: "files" }> = { type: "files", snapId: "tEND", baseId: "tBASE", status: "available", more: 0, files };
  return { row: rows.append(author, { kind: "card", card }), card };
}
function fakeDisk(t: any, files: Record<string, string> = {}, pad = 0) {
  const calls: string[][] = [];
  t.mock.method(snapRunner, "any", async (_bot: string, args: string[]) => {
    calls.push(args);
    if (args[0] === "diff") return { code: 0, stdout: Buffer.from(diffOf(args[3]) + " // context\n".repeat(pad)), stderr: "" };
    if (args[0] === "show") return { code: 0, stdout: Buffer.from(files[args[2]] ?? ""), stderr: "" };
    if (args[0] === "grep") return { code: 0, stdout: Buffer.from(`refs/sk/${args[1]}:src/caller.ts:7:  total(invoices);\nrefs/sk/${args[1]}:.env:1:${args[2]}=x\n`), stderr: "" };
    return { code: 1, stdout: Buffer.from(""), stderr: "" };
  });
  return calls;
}
const approve = (paths: string[]) => JSON.stringify({ verdict: "approved", summary: "Rien de grave.", files: paths.map((path) => ({ path, status: "reviewed" })), findings: [] });
const pathsOf = (prompt: string) => (JSON.parse(prompt).review_files as { path: string }[]).map((f) => f.path);

test("selection: secrets, generated and binary files are skipped with their reason; tests are reviewed", () => {
  assert.equal(whyExcluded(fc(".env"), listedPathOk), "secret");
  assert.equal(whyExcluded(fc("config/.env.production"), listedPathOk), "secret");
  assert.equal(whyExcluded(fc(".env.example"), listedPathOk), null);
  assert.equal(whyExcluded(fc("home/.ssh/id_ed25519"), listedPathOk), "secret");
  assert.equal(whyExcluded(fc("package-lock.json"), listedPathOk), "generated");
  assert.equal(whyExcluded(fc("web/dist/app.js"), listedPathOk), "generated");
  assert.equal(whyExcluded(fc("lib/jquery.min.js"), listedPathOk), "generated");
  assert.equal(whyExcluded(fc("logo.png", { binary: true }), listedPathOk), "binary");
  assert.equal(whyExcluded(fc("src/total.test.ts"), listedPathOk), null);
  assert.equal(whyExcluded(fc("../escape.ts"), listedPathOk), "unavailable");
  assert.equal(isSecretPath("src/keys.ts"), false);
});

test("lots: same folder together, bounded size, overflow returned instead of silently dropped", () => {
  const files = Array.from({ length: 30 }, (_, i) => ({ path: `d${i % 3}/f${i}.ts`, diff: "x".repeat(5000), truncated: false }));
  const { batches, over } = packBatches(files, 6, 24_000);
  assert.equal(batches.length, 6);
  assert.ok(batches.every((b) => b.reduce((n, f) => n + f.diff.length, 0) <= 24_000));
  assert.equal(batches.flat().length + over.length, 30);
  assert.ok(batches.every((b) => new Set(b.map((f) => f.path.split("/")[0])).size <= 2));
  const small = packBatches(files.slice(0, 4).map((f) => ({ ...f, diff: "y" })));
  assert.equal(small.batches.length, 1);
  assert.equal(small.over.length, 0);
});

test("anchors: new side first, old side for removed code, whole file fallback, unique relocation, else line 0", async () => {
  const d = diffOf("a.ts");
  assert.deepEqual(locateInDiff(d, "const total = a + other;"), [11, 11, "new"]);
  assert.deepEqual(locateInDiff(d, "+  const total = a + other;\n  return total;"), [11, 12, "new"]);
  assert.deepEqual(locateInDiff(d, "return a;"), [11, 11, "old"]);
  assert.equal(locateInDiff(d, "nothing like this"), null);
  assert.deepEqual(locateInFile("line\n\n  const z = 3;\nnext", "const z = 3;"), [3, 3]);
  const base = { line: 0, endLine: 0, side: "new" as const, category: "bug" as const, severity: "high" as const, text: "t" };
  const diffs = new Map([["a.ts", d], ["b.ts", "@@ -1,1 +1,2 @@\n x\n+const unique = 1;\n"]]);
  const out = await anchorFindings(
    [
      { finding: { ...base, path: "a.ts" }, code: "const unique = 1;" },
      { finding: { ...base, path: "a.ts" }, code: "const far = 9;" },
      { finding: { ...base, path: "a.ts" }, code: "not anywhere" },
    ],
    diffs,
    async () => "a\nb\nconst far = 9;\n",
  );
  assert.deepEqual([out[0].path, out[0].line], ["b.ts", 2]);
  assert.deepEqual([out[1].path, out[1].line, out[1].side], ["a.ts", 3, "new"]);
  assert.deepEqual([out[2].line, out[2].endLine], [0, 0]);
});

test("lenient JSON: fences, text around, trailing comma and a raw line break do not lose the verdict", () => {
  assert.equal(lenientJson('```json\n{"verdict":"approved","summary":"ok",}\n```').verdict, "approved");
  assert.equal(lenientJson('Voici : {"verdict":"changes","summary":"ligne 1\nligne 2"} merci').summary, "ligne 1\nligne 2");
  assert.equal(lenientJson("pas du JSON"), null);
});

test("30 files: every file ends reviewed or skipped with a reason, in several lots, nothing cut at 12", async (t) => {
  const listed = [...Array.from({ length: 26 }, (_, i) => fc(`src/m${i % 4}/file${i}.ts`)), fc("package-lock.json"), fc(".env"), fc("logo.png", { binary: true }), fc("src/total.test.ts")];
  const { row, card } = cardWith(listed);
  const calls = fakeDisk(t, {}, 300);
  const prompts: string[] = [];
  t.mock.method(reviewAsk, "run", async (_r: unknown, system: string, prompt: string) => {
    prompts.push(prompt);
    assert.match(system, /bug|risk|load|test/);
    return approve(pathsOf(prompt));
  });
  const review = await reviewChanges(author, reviewer, row, card, "fr");
  assert.equal(review.coverage!.length, 30);
  assert.equal(review.coverage!.filter((c) => c.status === "reviewed").length, 27);
  assert.deepEqual(Object.fromEntries(review.coverage!.filter((c) => c.status === "skipped").map((c) => [c.path, c.reason])), { "package-lock.json": "generated", ".env": "secret", "logo.png": "binary" });
  assert.ok(review.batches! >= 2, "split into lots");
  assert.equal(prompts.length, review.batches);
  assert.equal(review.verdict, "approved");
  assert.equal(review.partial, false);
  assert.equal(review.goal, true);
  assert.match(prompts[0], /total des factures/);
  assert.match(prompts[0], /12 tests passed/);
  assert.ok(!calls.some((a) => a.includes(".env") || a.includes("package-lock.json")), "secret and lock files are never read");
  assert.ok(!prompts.some((p) => p.includes('"path":".env"') && p.includes("review_files\":[{\"path\":\".env")));
});

test("look-ups, grid findings anchored to lines, the fact-checking pass and the verdict", async (t) => {
  const { row, card } = cardWith([fc("src/total.ts"), fc("src/caller.ts")]);
  const calls = fakeDisk(t, { "src/caller.ts": "import { total } from './total';\n// usage\n\nexport const x = total([]);\n" });
  let round = 0;
  const seen: string[] = [];
  t.mock.method(reviewAsk, "run", async (_r: unknown, system: string, prompt: string) => {
    seen.push(prompt);
    if (system.startsWith("You are a fact-checker")) {
      const comments = JSON.parse(prompt).comments;
      assert.equal(comments.length, 3);
      return '{"remove":[1,2]}'; // 1 is a style-like bug proven wrong; 2 is a risk: never removed
    }
    round++;
    if (round === 1) return JSON.stringify({ lookups: [{ tool: "read_file", path: "src/caller.ts" }, { tool: "search", query: "total(" }, { tool: "read_file", path: ".env" }] });
    return JSON.stringify({
      verdict: "changes",
      summary: "Le total ignore les factures annulées.",
      files: [{ path: "src/total.ts", status: "reviewed" }, { path: "src/caller.ts", status: "reviewed" }],
      findings: [
        { path: "src/total.ts", code: "const total = a + other;", category: "bug", severity: "high", text: "`other` n'est pas défini." },
        { path: "src/total.ts", code: "return total;", category: "bug", severity: "low", text: "Variable inutile." },
        { path: "src/caller.ts", code: "export const x = total([]);", category: "risk", severity: "medium", text: "Appel sans contrôle." },
        { path: "elsewhere.ts", code: "x", category: "bug", severity: "high", text: "Hors du lot : ignoré." },
      ],
    });
  });
  const review = await reviewChanges(author, reviewer, row, card, "fr");
  assert.equal(review.lookups, 3);
  assert.match(seen[1], /1\| import \{ total \}/, "the whole caller file came back with line numbers");
  assert.match(seen[1], /src\/caller\.ts.*total\(invoices\)/);
  assert.doesNotMatch(seen[1], /"path":"\.env".*"content"/);
  assert.match(seen[1], /not readable/);
  assert.ok(!calls.some((a) => a[0] === "show" && a[2] === ".env"));
  assert.equal(review.dropped, 1);
  assert.equal(review.findings!.length, 2);
  const [first, second] = review.findings!;
  assert.deepEqual([first.path, first.line, first.severity, first.category], ["src/total.ts", 11, "high", "bug"]);
  assert.deepEqual([second.path, second.category, second.line], ["src/caller.ts", "risk", 4], "not in caller.ts's diff: found in the whole file read from the snapshot");
  assert.equal(review.verdict, "changes");
});

test("an unreadable first answer gets one retry; a reviewer that never answers fails the lot, not silently", async (t) => {
  const { row, card } = cardWith([fc("src/a.ts")]);
  fakeDisk(t);
  let n = 0;
  t.mock.method(reviewAsk, "run", async (_r: unknown, _s: string, prompt: string) => {
    n++;
    if (n === 1) return "je ne sais pas";
    assert.equal(JSON.parse(prompt).previous_answer_invalid, true);
    return approve(["src/a.ts"]);
  });
  assert.equal((await reviewChanges(author, reviewer, row, card, "fr")).verdict, "approved");
  t.mock.method(reviewAsk, "run", async () => "toujours pas");
  const again = cardWith([fc("src/b.ts")]);
  await assert.rejects(reviewChanges(author, reviewer, again.row, again.card, "fr"), /verdict exploitable/);
});
