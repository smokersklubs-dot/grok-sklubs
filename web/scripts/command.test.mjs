// « Centre de commandement » (web/src/lib/command.ts): filters by name, state and team, counts, the order of the cards,
// the links kept when cards are hidden, and the connectors' geometry (edges facing each other, label off the cards).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { connector, filterCards, fold, isLiveLink, sortCards, stateCounts, teamOf, visibleLinks, LIVE_LINK_MS } from "../src/lib/command.ts";

const card = (botId, name, state, extra = {}) => ({ botId, name, label: "", state, shared: null, sectionId: null, lastActivityAt: 0, ...extra });
const cards = [
  card("a", "Ada", "working", { label: "Rédactrice", sectionId: "s1", lastActivityAt: 5 }),
  card("b", "Béa", "waiting", { sectionId: "s1", lastActivityAt: 1 }),
  card("c", "Cid", "idle", { lastActivityAt: 9 }),
  card("d", "Dot", "error", { shared: { workspaceName: "Studio", ownerName: "Max", role: "viewer" } }),
];
const all = { query: "", state: "all", team: "all" };

test("search ignores case and accents, and also looks at the role", () => {
  assert.equal(fold("Équipe Béa"), "equipe bea");
  assert.deepEqual(filterCards(cards, { ...all, query: "bea" }).map((c) => c.botId), ["b"]);
  assert.deepEqual(filterCards(cards, { ...all, query: "REDACT" }).map((c) => c.botId), ["a"]);
  assert.deepEqual(filterCards(cards, { ...all, query: "  " }).length, 4);
});

test("filters by state and by team (a section, no section, shared with you)", () => {
  assert.deepEqual(filterCards(cards, { ...all, state: "waiting" }).map((c) => c.botId), ["b"]);
  assert.deepEqual(filterCards(cards, { ...all, team: "s1" }).map((c) => c.botId), ["a", "b"]);
  assert.deepEqual(filterCards(cards, { ...all, team: "none" }).map((c) => c.botId), ["c"]);
  assert.deepEqual(filterCards(cards, { ...all, team: "shared" }).map((c) => c.botId), ["d"]);
  assert.equal(teamOf(cards[3]), "shared");
  assert.deepEqual(filterCards(cards, { query: "a", state: "working", team: "s1" }).map((c) => c.botId), ["a"]);
});

test("counts per state, and who needs you comes first", () => {
  assert.deepEqual(stateCounts(cards), { all: 4, working: 1, waiting: 1, error: 1, paused: 0, idle: 1 });
  assert.deepEqual(sortCards(cards).map((c) => c.botId), ["b", "d", "a", "c"]);
  const same = [card("x", "Zed", "idle", { lastActivityAt: 1 }), card("y", "Amy", "idle", { lastActivityAt: 3 })];
  assert.deepEqual(sortCards(same).map((c) => c.botId), ["y", "x"], "newest activity first");
});

test("a link shows only when both its bots are on screen; it is live for a while after its last exchange", () => {
  const links = [{ from: "a", to: "b", lastAt: 0 }, { from: "a", to: "c", lastAt: 0 }];
  assert.deepEqual(visibleLinks(links, new Set(["a", "b"])).map((l) => l.to), ["b"]);
  assert.equal(isLiveLink({ lastAt: 1000 }, 1000 + LIVE_LINK_MS - 1), true);
  assert.equal(isLiveLink({ lastAt: 1000 }, 1000 + LIVE_LINK_MS), false);
});

test("connectors: side by side they join the facing sides, one above the other the facing edges", () => {
  const a = { x: 0, y: 0, w: 300, h: 200 }, b = { x: 350, y: 0, w: 300, h: 200 };
  const h = connector(a, b);
  assert.deepEqual([h.from, h.to], [{ x: 300, y: 100 }, { x: 350, y: 100 }]);
  assert.match(h.d, /^M300,100 C/);
  assert.deepEqual(h.mid, { x: 325, y: 100 });
  // Right to left: from a's left side.
  const back = connector(b, a);
  assert.deepEqual([back.from, back.to], [{ x: 350, y: 100 }, { x: 300, y: 100 }]);
  const below = { x: 0, y: 240, w: 300, h: 200 };
  const v = connector(a, below);
  assert.deepEqual([v.from, v.to], [{ x: 150, y: 200 }, { x: 150, y: 240 }]);
});

test("the label goes on a part of the curve that no card covers, or nowhere", () => {
  const a = { x: 0, y: 0, w: 300, h: 200 }, c = { x: 700, y: 0, w: 300, h: 200 };
  const middle = { x: 348, y: 0, w: 304, h: 200 };
  const r = connector(a, c, [a, c, middle]);
  assert.ok(r.mid, "a free point exists in the gaps");
  assert.ok(r.mid.x < 342 || r.mid.x > 658, `label at ${r.mid.x} is off the middle card`);
  const wall = { x: -1000, y: -1000, w: 3000, h: 3000 };
  assert.equal(connector(a, c, [wall]).mid, null);
});
