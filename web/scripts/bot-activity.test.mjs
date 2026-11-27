// L146 « filtre d'activité dans la liste des bots » (lib/botactivity.ts): waiting for you wins over working, counts per
// state, an unknown saved filter falls back to « Tous ».
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityCounts, activityOf, matches, parseFilter } from "../src/lib/botactivity.ts";

const bots = [{ id: "a", unread: 0 }, { id: "b", unread: 2 }, { id: "c", unread: 0 }, { id: "d", unread: 0 }];
const live = { a: { running: true, awaiting: null }, c: { running: true, awaiting: { reason: "x" } } };

test("activity: waiting for you (a question, an approval, an unread reply) before working, else resting", () => {
  assert.equal(activityOf(bots[0], live.a), "working");
  assert.equal(activityOf(bots[1], undefined), "waiting");
  assert.equal(activityOf(bots[2], live.c), "waiting");
  assert.equal(activityOf(bots[3], undefined), "idle");
  assert.deepEqual(activityCounts(bots, live), { all: 4, waiting: 2, working: 1, idle: 1 });
  assert.deepEqual(bots.filter((b) => matches(b, live[b.id], "waiting")).map((b) => b.id), ["b", "c"]);
  assert.equal(bots.filter((b) => matches(b, live[b.id], "all")).length, 4);
});

test("saved filter: a known value is kept, anything else is « all »", () => {
  assert.equal(parseFilter("working"), "working");
  assert.equal(parseFilter("busy"), "all");
  assert.equal(parseFilter(null), "all");
});
