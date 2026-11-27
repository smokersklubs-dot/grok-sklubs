// L142 « graphique 30 jours » (lib/usagechart.ts): a round top for the scale, bars in proportion, a spending day never
// invisible, the estimate drawn apart, the busiest day.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { bars, busiest, niceTop } from "../src/lib/usagechart.ts";

const day = (i, c, e = 0) => ({ day: `2026-11-${String(i).padStart(2, "0")}`, costUsd: c, estimatedUsd: e, turns: c || e ? 1 : 0 });

test("scale: 1, 2 or 5 × a power of ten, at least the busiest day", () => {
  assert.equal(niceTop(0), 0.01);
  assert.equal(niceTop(0.37), 0.5);
  assert.equal(niceTop(1), 1);
  assert.equal(niceTop(1.2), 2);
  assert.equal(niceTop(7.5), 10);
  assert.equal(niceTop(42), 50);
});

test("bars: in proportion, at least 2 px when something was spent, 0 when nothing, estimate apart", () => {
  const days = Array.from({ length: 30 }, (_, i) => day(i + 1, 0));
  days[3] = day(4, 1);
  days[9] = day(10, 0.0001);
  days[20] = day(21, 0.5, 0.5);
  const { top, bars: b } = bars(days, 100);
  assert.equal(top, 1);
  assert.equal(b.length, 30);
  assert.equal(b[3].costH, 100);
  assert.equal(b[9].costH, 2);
  assert.equal(b[0].costH, 0);
  assert.equal(b[20].costH, 50);
  assert.equal(b[20].estimateH, 50);
  assert.ok(b.every((x) => x.costH + x.estimateH <= 100 + 2));
  assert.equal(busiest(days).day, "2026-11-04");
  assert.equal(busiest(days.map((d) => ({ ...d, costUsd: 0, estimatedUsd: 0 }))), null);
});
