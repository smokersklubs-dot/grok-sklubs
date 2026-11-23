// L158 « Créations » (web/src/lib/trajectory.ts): the trajectory card compares the last two renders by default; a pick
// toggles; a third pick replaces the oldest; « identiques » only for two consecutive renders, the second unchanged.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { defaultPair, pick, sameAsPrevious } from "../src/lib/trajectory.ts";

test("default pair: the last two, or the only one, or none", () => {
  assert.deepEqual(defaultPair([{ id: 1 }, { id: 2 }, { id: 3 }]), [2, 3]);
  assert.deepEqual(defaultPair([{ id: 7 }]), [7]);
  assert.deepEqual(defaultPair([]), []);
});

test("picks: toggle, at most two, the oldest pick goes", () => {
  assert.deepEqual(pick([2, 3], 3), [2]);
  assert.deepEqual(pick([2], 5), [2, 5]);
  assert.deepEqual(pick([2, 5], 9), [5, 9]);
  assert.deepEqual(pick([], 1), [1]);
});

test("identical note: consecutive renders, the second unchanged", () => {
  assert.equal(sameAsPrevious([{ n: 2, unchanged: false }, { n: 3, unchanged: true }]), true);
  assert.equal(sameAsPrevious([{ n: 1, unchanged: false }, { n: 3, unchanged: true }]), false);
  assert.equal(sameAsPrevious([{ n: 2, unchanged: false }, { n: 3, unchanged: false }]), false);
  assert.equal(sameAsPrevious([{ n: 3, unchanged: true }]), false);
});
