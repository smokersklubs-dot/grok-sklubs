import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import type { Card, FileChange } from "../src/shared.js";
import type { ReviewFinding } from "../src/peerreviewtypes.js";

/**
 * L180 — banc de relecture de PR (idea: open-code-review's AACR-Bench of annotated PRs; the fixtures are ours).
 * Each case is a hand-annotated diff (where the real problem is, and its grid category) plus a recorded reviewer
 * answer. CI replays the answer through the whole Sklubot chain — file selection, lots, line anchoring, the
 * fact-checking pass, the verdict — and scores it: precision (findings that hit an annotation), recall (annotations
 * found) and anchoring (findings placed on a line). To score a real model, replace the recorded `answer` of a case with
 * what that model returned. Runs with the server tests, hence in CI. No model, no database file.
 */
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-bench-review-"));
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "bench-review-tests-local-secret-000";
process.env.NO_SCHEDULER = "1";
process.env.HOSTED_MODE = "0";
const { users, bots, rows } = await import("../src/store.js");
const { reviewChanges, reviewAsk } = await import("../src/peerreview.js");
const { snapRunner } = await import("../src/snapshots.js");

interface Annotation { path: string; start: number; end: number; category: string }
interface Case { name: string; goal: string; files: { path: string; diff: string }[]; annotations: Annotation[]; answer: unknown; reflection_remove: number[]; expectVerdict: string; expectSkipped?: Record<string, string> }
const bench: { cases: Case[] } = JSON.parse(readFileSync(new URL("./fixtures/bench/relecture-pr.json", import.meta.url), "utf8"));

/** A finding hits an annotation on the same file when their lines overlap (±1 line). */
function score(found: ReviewFinding[][], cases: Case[]) {
  let tp = 0, total = 0, matched = 0, annotations = 0, located = 0;
  cases.forEach((c, i) => {
    const fs = found[i];
    total += fs.length;
    located += fs.filter((f) => f.line > 0).length;
    annotations += c.annotations.length;
    const hit = (f: ReviewFinding, a: Annotation) => f.path === a.path && f.line > 0 && f.line <= a.end + 1 && f.endLine >= a.start - 1;
    tp += fs.filter((f) => c.annotations.some((a) => hit(f, a))).length;
    matched += c.annotations.filter((a) => fs.some((f) => hit(f, a))).length;
  });
  return { precision: total ? tp / total : 1, recall: annotations ? matched / annotations : 1, anchored: total ? located / total : 1 };
}

/** Measured on 22/11/2026 with the recorded answers (printed by the test). */
const FLOORS = { precision: 1, recall: 0.75, anchored: 1 };

test("PR review bench: precision, recall and anchoring of the recorded reviews through the real chain", async (t) => {
  const owner = users.create("bench-review@example.test", "User", "unused", "fr");
  const author = bots.create(owner.id, { name: "Auteur" });
  const reviewer = bots.create(owner.id, { name: "Relecteur" });
  const found: ReviewFinding[][] = [];
  for (const c of bench.cases) {
    const diffs = new Map(c.files.map((f) => [f.path, f.diff]));
    t.mock.method(snapRunner, "any", async (_b: string, args: string[]) =>
      args[0] === "diff" ? { code: 0, stdout: Buffer.from(diffs.get(args[3]) ?? ""), stderr: "" } : { code: 0, stdout: Buffer.from(""), stderr: "" });
    t.mock.method(reviewAsk, "run", async (_r: unknown, system: string) =>
      system.startsWith("You are a fact-checker") ? JSON.stringify({ remove: c.reflection_remove }) : JSON.stringify(c.answer));
    rows.append(author, { kind: "message", role: "user", text: c.goal }, 0);
    const files: FileChange[] = c.files.map((f) => ({ path: f.path, change: "modified", added: 1, removed: 1, binary: false, oldSize: 1, newSize: 1 }));
    const card: Extract<Card, { type: "files" }> = { type: "files", snapId: "tEND", baseId: "tBASE", status: "available", more: 0, files };
    const row = rows.append(author, { kind: "card", card });
    const review = await reviewChanges(author, reviewer, row, card, "fr");
    assert.equal(review.verdict, c.expectVerdict, c.name);
    assert.equal(review.coverage!.length, c.files.length, c.name);
    for (const [p, why] of Object.entries(c.expectSkipped ?? {})) assert.equal(review.coverage!.find((x) => x.path === p)?.reason, why, c.name);
    found.push(review.findings ?? []);
  }
  const s = score(found, bench.cases);
  console.log(`[banc relecture PR] précision=${s.precision.toFixed(2)} rappel=${s.recall.toFixed(2)} ancrage=${s.anchored.toFixed(2)} (${bench.cases.length} cas)`);
  assert.ok(s.precision >= FLOORS.precision, `precision ${s.precision}`);
  assert.ok(s.recall >= FLOORS.recall, `recall ${s.recall}`);
  assert.ok(s.anchored >= FLOORS.anchored, `anchored ${s.anchored}`);
});

test("the scorer: an unanchored finding never counts as a hit", () => {
  const c = { annotations: [{ path: "a.ts", start: 5, end: 5, category: "bug" }] } as Case;
  const f = (line: number): ReviewFinding => ({ path: "a.ts", line, endLine: line, side: "new", category: "bug", severity: "high", text: "x" });
  assert.deepEqual(score([[f(5)]], [c]), { precision: 1, recall: 1, anchored: 1 });
  assert.deepEqual(score([[f(0)]], [c]), { precision: 0, recall: 0, anchored: 0 });
  assert.deepEqual(score([[f(9)]], [c]), { precision: 0, recall: 0, anchored: 1 });
});
