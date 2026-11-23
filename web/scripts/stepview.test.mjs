// L142 (src/lib/stepview.ts): the task card's running time and spend, a step's arguments.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { argLines, durationText, spendText } from "../src/lib/stepview.ts";

test("L142: a running time in short words", () => {
  assert.equal(durationText(-5), "0 s");
  assert.equal(durationText(44_600), "45 s");
  assert.equal(durationText(3 * 60_000 + 10_000), "3 min");
  assert.equal(durationText(65 * 60_000), "1 h 05");
});

test("L142: the spend keeps the estimate of unknown prices apart", () => {
  const fmt = (n) => `${n.toFixed(2)} $`;
  assert.deepEqual(spendText(0.031, 0, fmt), { cost: "0.03 $", estimate: "" });
  assert.deepEqual(spendText(0, 0.012, fmt), { cost: "0.00 $", estimate: "≈ +0.01 $" });
});

test("L142: every argument, objects as JSON", () => {
  assert.deepEqual(argLines({ url: "https://x.test", n: 3, opts: { a: [1] } }), [["url", "https://x.test"], ["n", "3"], ["opts", "{\n  \"a\": [\n    1\n  ]\n}"]]);
  assert.deepEqual(argLines({}), []);
});
