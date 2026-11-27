// L146 « discussions côte à côte » (src/lib/sidechat.ts): which bot goes beside the selected one, and when.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { sideBotId, sideCandidates, SIDE_MIN_WIDTH } from "../src/lib/sidechat.ts";

test("L146: any other visible bot can go beside the main one", () => {
  const bots = [{ id: "a" }, { id: "b" }, { id: "h", hidden: true }, { id: "c" }];
  assert.deepEqual(sideCandidates(bots, "b").map((b) => b.id), ["a", "c"]);
  assert.deepEqual(sideCandidates(bots, null).map((b) => b.id), ["a", "b", "c"]);
});

test("L146: shown only when set, still there, not the main bot, and the window is wide enough", () => {
  const exists = (id) => id !== "gone";
  assert.equal(sideBotId("b", "a", exists, 1440), "b");
  assert.equal(sideBotId(null, "a", exists, 1440), null);
  assert.equal(sideBotId("a", "a", exists, 1440), null);
  assert.equal(sideBotId("gone", "a", exists, 1440), null);
  assert.equal(sideBotId("b", "a", exists, SIDE_MIN_WIDTH - 1), null);
  assert.equal(sideBotId("b", "a", exists, SIDE_MIN_WIDTH), "b");
});
