import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

/**
 * L180 — banc de rappel de mémoire en français (idea: mem0's recall benchmarks; fixtures are ours and fictitious).
 * 30 notes, 30 everyday questions, each expecting one note. Score = recall@3 (expected note in the first 3) and MRR.
 * The floor below is the score measured when the bench was added (22/11/2026): a change that lowers it fails CI; a
 * change that raises it should raise the floor. Runs with the server tests (`npm run test -w server`), hence in CI.
 * Only the keyword ranking (agent/recall.ts rankNotes) is measured: no model, no database file.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-bench-recall-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
const { rankNotes } = await import("../src/agent/recall.js");

interface Bench { notes: { id: string; text: string }[]; queries: { q: string; expect: string[] }[] }
const bench: Bench = JSON.parse(readFileSync(new URL("./fixtures/bench/memoire-fr.json", import.meta.url), "utf8"));
const NOW = Date.UTC(2026, 10, 22);

/** Measured on 22/11/2026: recall@3 = 0.93, MRR = 0.88 (misses: an allergy asked as « allergie alimentaire », the dentist asked as « docteur pour les dents »). */
const RECALL_AT_3_FLOOR = 0.9;
const MRR_FLOOR = 0.85;

function scoreRecall(b: Bench, k = 3) {
  const notes = b.notes.map((n) => ({ ...n, createdAt: NOW - 86400_000, status: "active" as const, confidence: "once" as const }));
  let hits = 0, rr = 0;
  const misses: string[] = [];
  for (const { q, expect } of b.queries) {
    const ranked = rankNotes(notes, q, { now: NOW, limit: 10, minRelevance: 0 }).map((r) => r.note.id);
    const pos = ranked.findIndex((id) => expect.includes(id));
    if (pos >= 0 && pos < k) hits++;
    else misses.push(q);
    if (pos >= 0) rr += 1 / (pos + 1);
  }
  return { recallAtK: hits / b.queries.length, mrr: rr / b.queries.length, misses };
}

test("French memory recall bench: recall@3 and MRR stay at or above the measured floor", () => {
  assert.equal(bench.notes.length, 30);
  assert.equal(bench.queries.length, 30);
  const s = scoreRecall(bench);
  console.log(`[bench mémoire FR] recall@3=${s.recallAtK.toFixed(2)} MRR=${s.mrr.toFixed(2)} manqués=${s.misses.length}: ${s.misses.join(" | ")}`);
  assert.ok(s.recallAtK >= RECALL_AT_3_FLOOR, `recall@3 ${s.recallAtK} < ${RECALL_AT_3_FLOOR}`);
  assert.ok(s.mrr >= MRR_FLOOR, `MRR ${s.mrr} < ${MRR_FLOOR}`);
});

test("the scorer itself: a perfect and an empty ranking", () => {
  const tiny: Bench = { notes: [{ id: "a", text: "La comptable s'appelle Mme Dupont" }, { id: "b", text: "Le chien s'appelle Pixel" }], queries: [{ q: "comptable", expect: ["a"] }, { q: "zzz inconnu", expect: ["b"] }] };
  const s = scoreRecall(tiny, 1);
  assert.equal(s.recallAtK, 0.5);
  assert.equal(s.mrr, 0.5);
  assert.deepEqual(s.misses, ["zzz inconnu"]);
});
