// L150 « favoris » and « modèle retiré grisé » (lib/modelfavs.ts).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { FAVS_MAX, orderModels, parseFavs, retiredRefs, toggleFav } from "../src/lib/modelfavs.ts";

const models = [{ ref: "a:1" }, { ref: "b:2" }, { ref: "c:3" }, { ref: "d:4" }];

test("favourites first, in the order starred; the rest as listed; a star on a vanished model is ignored", () => {
  assert.deepEqual(orderModels(models, ["c:3", "gone:9", "a:1"]).map((m) => m.ref), ["c:3", "a:1", "b:2", "d:4"]);
  assert.deepEqual(orderModels(models, []).map((m) => m.ref), ["a:1", "b:2", "c:3", "d:4"]);
});

test("star and unstar; at most 12, the oldest goes", () => {
  assert.deepEqual(toggleFav(["a:1"], "b:2"), ["a:1", "b:2"]);
  assert.deepEqual(toggleFav(["a:1", "b:2"], "a:1"), ["b:2"]);
  const many = Array.from({ length: FAVS_MAX }, (_, i) => `m:${i}`);
  const next = toggleFav(many, "new:1");
  assert.equal(next.length, FAVS_MAX);
  assert.equal(next[0], "m:1");
  assert.equal(next.at(-1), "new:1");
});

test("retired: named but no longer listed; nothing before the list loads; defaults and empty names never", () => {
  assert.deepEqual(retiredRefs(models, ["a:1", "old:x", "", null, "codex:default", "old:x"]), ["old:x"]);
  assert.deepEqual(retiredRefs(null, ["old:x"]), []);
});

test("saved stars: bad JSON or a non-list gives none, non-strings are dropped", () => {
  assert.deepEqual(parseFavs("{"), []);
  assert.deepEqual(parseFavs('{"a":1}'), []);
  assert.deepEqual(parseFavs('["a:1", 3, null]'), ["a:1"]);
  assert.deepEqual(parseFavs(null), []);
});
