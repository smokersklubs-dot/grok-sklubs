// L146 grille 2×2 et dispositions enregistrées (src/lib/sidechat.ts, src/lib/chatlayouts.ts).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { GRID_MIN_WIDTH, layoutClass, MAX_SIDE, parseSaved, SIDE_MIN_WIDTH, sideBotIds } from "../src/lib/sidechat.ts";
import { addLayout, applyLayout, MAX_LAYOUTS, parseLayouts, removeLayout } from "../src/lib/chatlayouts.ts";

const exists = (id) => id !== "gone";

test("L146 grid: up to 3 beside from 1 400 px, only the first under it, none under 1 100 px; gone and main bots skipped", () => {
  assert.deepEqual(sideBotIds(["b", "c", "d"], "a", exists, GRID_MIN_WIDTH), ["b", "c", "d"]);
  assert.deepEqual(sideBotIds(["b", "c", "d"], "a", exists, GRID_MIN_WIDTH - 1), ["b"]);
  assert.deepEqual(sideBotIds(["b", "c"], "a", exists, SIDE_MIN_WIDTH - 1), []);
  assert.deepEqual(sideBotIds(["a", "gone", "c"], "a", exists, 1600), ["c"]);
  assert.equal(MAX_SIDE, 3);
});

test("L146 grid: the window's class follows how many chats are beside", () => {
  assert.equal(layoutClass(0), "");
  assert.equal(layoutClass(1), "has-side");
  assert.equal(layoutClass(2), "has-grid has-grid-2");
  assert.equal(layoutClass(3), "has-grid has-grid-3");
  assert.equal(layoutClass(7), "has-grid has-grid-3");
});

test("L146 grid: what the device kept is read safely (old single id, list, junk)", () => {
  assert.deepEqual(parseSaved(null), []);
  assert.deepEqual(parseSaved("bot_abc"), ["bot_abc"], "the two-column version kept one id");
  assert.deepEqual(parseSaved('["b","c","b","d","e"]'), ["b", "c", "d"]);
  assert.deepEqual(parseSaved('["../x", 3, "ok"]'), ["ok"]);
  assert.deepEqual(parseSaved("{not json"), []);
  assert.deepEqual(parseSaved('{"a":1}'), []);
});

test("L146 layouts: save needs a name, a main bot and one beside; same name replaces; at most 8", () => {
  assert.equal(addLayout([], "", "a", ["b"]), null);
  assert.equal(addLayout([], "Matin", null, ["b"]), null);
  assert.equal(addLayout([], "Matin", "a", []), null);
  assert.equal(addLayout([], "Matin", "a", ["a"]), null, "the main bot is not also beside");
  let list = addLayout([], "  Matin  ", "a", ["b", "c", "d", "e"], 1000);
  assert.deepEqual(list.map((l) => [l.name, l.main, l.side]), [["Matin", "a", ["b", "c", "d"]]]);
  list = addLayout(list, "matin", "x", ["y"], 2000);
  assert.equal(list.length, 1);
  assert.equal(list[0].main, "x");
  for (let i = 0; i < MAX_LAYOUTS - 1; i++) list = addLayout(list, `L${i}`, "a", ["b"], 3000 + i);
  assert.equal(list.length, MAX_LAYOUTS);
  assert.equal(addLayout(list, "Encore", "a", ["b"]), null);
  assert.ok(addLayout(list, "L0", "a", ["c"]), "replacing one is still allowed when full");
  assert.equal(removeLayout(list, list[0].id).length, MAX_LAYOUTS - 1);
});

test("L146 layouts: applying skips deleted bots and says how many; malformed storage is dropped", () => {
  const l = { id: "x", name: "Soir", main: "gone", side: ["b", "gone2", "c"], savedAt: 1 };
  const r = applyLayout(l, (id) => !id.startsWith("gone"));
  assert.deepEqual(r, { main: "b", side: ["c"], skipped: 2 });
  assert.deepEqual(applyLayout({ ...l, side: [] }, () => false), { main: null, side: [], skipped: 1 });
  assert.deepEqual(parseLayouts("nope"), []);
  assert.deepEqual(parseLayouts(JSON.stringify([{ id: "1", name: "A", main: "a", side: ["b", 4] }, { id: "2", name: "", main: "a", side: [] }, null])).map((x) => [x.name, x.side]), [["A", ["b"]]]);
});
