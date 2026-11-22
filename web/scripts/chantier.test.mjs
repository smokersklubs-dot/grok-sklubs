// « Chantier » (web/src/lib/chantiers.ts): the graph's levels (independent tasks side by side, a dependent task below
// every task it waits on), the layout, labels kept apart where links meet, durations and line lists.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { duration, fromLines, graphLayout, levels, NODE_W, STATE_TONE, toLines } from "../src/lib/chantiers.ts";
import { articleCardsPlan } from "../../server/src/chantierexample.ts";

const plan = articleCardsPlan({ research: "a", build: "b", review: "c" });

test("levels: independent tasks share level 0, a task sits below everything it waits on", () => {
  const lv = levels(plan.tasks.map((t) => t.key), plan.edges);
  assert.deepEqual(Object.fromEntries(lv), { recherche: 0, exigences: 0, export: 1, ensemble: 2 });
  // A cycle (refused by the server) does not hang the page.
  assert.ok(levels(["x", "y"], [{ from: "x", to: "y" }, { from: "y", to: "x" }]).size === 2);
});

test("layout: one row per level, no overlapping nodes, edge labels of meeting links far enough apart", () => {
  const g = graphLayout(plan);
  const row0 = g.nodes.filter((n) => n.level === 0);
  assert.equal(row0.length, 2);
  assert.ok(Math.abs(row0[0].x - row0[1].x) >= NODE_W);
  assert.ok(g.nodes.every((n) => n.x >= 0 && n.x + NODE_W <= g.width));
  const meet = g.edges.filter((e) => e.to === "export");
  assert.equal(meet.length, 2);
  assert.ok(Math.abs(meet[0].lx - meet[1].lx) >= 148, "labels (at most 148 px wide) do not cover each other");
  assert.deepEqual(g.edges.map((e) => e.artifact), plan.edges.map((e) => e.artifact));
});

test("helpers: durations, lines, a colour for every state", () => {
  assert.equal(duration(40_000), "40 s");
  assert.equal(duration(12 * 60_000), "12 min");
  assert.equal(duration(65 * 60_000), "1 h 05");
  assert.deepEqual(fromLines(" a \n\n b"), ["a", "b"]);
  assert.equal(toLines(["a", "b"]), "a\nb");
  for (const s of ["waiting", "running", "checking", "accepted", "repairing", "blocked", "stopped"]) assert.ok(STATE_TONE[s]);
});
