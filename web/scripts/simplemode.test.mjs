// L145 « mode Simple » (src/lib/simplemode.ts): which Settings sections stay listed.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { listedInSimple, SIMPLE_SECTIONS } from "../src/lib/simplemode.ts";

test("L145: Simple mode keeps the everyday sections, hides the advanced ones, never makes one unreachable", () => {
  assert.equal(listedInSimple("vault", false, false, "general"), true, "off: everything");
  assert.equal(listedInSimple("vault", true, false, "general"), false);
  assert.equal(listedInSimple("permissions", true, false, "general"), false);
  assert.equal(listedInSimple("models", true, false, "general"), true);
  assert.equal(listedInSimple("vault", true, true, "general"), true, "a search finds it");
  assert.equal(listedInSimple("vault", true, false, "vault"), true, "the open section stays");
  assert.ok(SIMPLE_SECTIONS.has("doctor") && SIMPLE_SECTIONS.has("account") && SIMPLE_SECTIONS.size === 14);
});
