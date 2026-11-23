// « Tableau de travail » (web/src/lib/workboard.ts): columns (« à relire » with « en cours », an unknown state in « faites »),
// ideas order, the start date sent WITH its time zone, the files the browser refuses before sending.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { byColumn, REFUSED_EXT, sizeText, sortIdeas, withZone } from "../src/lib/workboard.ts";

const task = (id, column, priority = 3, createdAt = 0) => ({ id, column, priority, createdAt });

test("columns: review shows with running, sorted by priority then age", () => {
  const c = byColumn([task("a", "waiting", 3), task("b", "review", 2), task("c", "running", 1), task("d", "waiting", 1), task("e", "done")]);
  assert.deepEqual(c.running.map((t) => t.id), ["c", "b"]);
  assert.deepEqual(c.waiting.map((t) => t.id), ["d", "a"]);
  assert.deepEqual(c.review, []);
  assert.deepEqual(c.done.map((t) => t.id), ["e"]);
});

test("ideas: open ones first by urgency, done ones last", () => {
  const s = sortIdeas([{ number: 1, urgency: "idea", progress: "todo" }, { number: 2, urgency: "critical", progress: "done" }, { number: 3, urgency: "bug", progress: "partial" }]);
  assert.deepEqual(s.map((i) => i.number), [3, 1, 2]);
});

test("the start date keeps its time zone (the server refuses one without)", () => {
  assert.equal(withZone("2026-11-23T09:00", -60), "2026-11-23T09:00+01:00");
  assert.equal(withZone("2026-11-23T09:00", 300), "2026-11-23T09:00-05:00");
  assert.equal(withZone("2026-11-23T09:00", 0), "2026-11-23T09:00+00:00");
  assert.equal(withZone(""), null);
  assert.equal(withZone("demain"), null);
});

test("files refused before sending; sizes in words", () => {
  for (const n of ["page.html", "x.SVG", "a.zip", "setup.exe", "run.sh"]) assert.ok(REFUSED_EXT.test(n), n);
  for (const n of ["plan.png", "devis.pdf", "notes.docx", "data.csv"]) assert.ok(!REFUSED_EXT.test(n), n);
  assert.equal(sizeText(2048), "2 Ko");
  assert.equal(sizeText(3 * 1024 * 1024), "3.0 Mo");
});
