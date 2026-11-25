// L64 « l'écran du bot s'ouvre tout seul » (src/lib/autoscreenrule.ts): when the bot starts using its browser or screen,
// its screen comes into view — the panel on a wide window, « Voir l'écran » on a phone — once per run, only for the bot
// that is open in the chat.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { screenAction, startsUsingScreen, WIDE_FROM } from "../src/lib/autoscreenrule.ts";

const idle = { running: false, activity: null };
const thinking = { running: true, activity: { kind: "thinking" } };
const browsing = { running: true, activity: { kind: "browsing" } };
const computer = { running: true, activity: { kind: "computer" } };
const ctx = { shown: true, busy: false, hasScreen: true, alreadyThisRun: false, width: 1440 };

test("L64: only the start of browser or screen use counts", () => {
  assert.equal(startsUsingScreen(thinking, browsing), true);
  assert.equal(startsUsingScreen(undefined, computer), true);
  assert.equal(startsUsingScreen(idle, browsing), true);
  assert.equal(startsUsingScreen(browsing, computer), false, "still on its screen: nothing new");
  assert.equal(startsUsingScreen(thinking, thinking), false);
  assert.equal(startsUsingScreen(browsing, { running: false, activity: { kind: "browsing" } }), false);
});

test("L64: panel on a wide window, « Voir l'écran » on a phone; never twice in a run, never for another bot", () => {
  assert.equal(screenAction(thinking, browsing, ctx), "panel");
  assert.equal(screenAction(thinking, browsing, { ...ctx, width: WIDE_FROM - 1 }), "toast");
  assert.equal(screenAction(thinking, browsing, { ...ctx, width: 390 }), "toast");
  assert.equal(screenAction(thinking, browsing, { ...ctx, alreadyThisRun: true }), null);
  assert.equal(screenAction(thinking, browsing, { ...ctx, shown: false }), null);
  assert.equal(screenAction(thinking, browsing, { ...ctx, busy: true }), null, "large view open or tab hidden");
  assert.equal(screenAction(thinking, browsing, { ...ctx, hasScreen: false }), null);
  assert.equal(screenAction(thinking, thinking, ctx), null);
});
