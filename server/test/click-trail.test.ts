import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L149: each click of the bot leaves a point (0–1 of the screen) in its live state, for the trail on the screen view.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-trail-"));
process.env.DESKTOP_RESOLUTION = "1280x800x24";
const { getLive, subscribe } = await import("../src/bus.js");
const { noteClick, traceClicks } = await import("../src/agent/clicktrail.js");
type Tool = Parameters<typeof traceClicks>[0];

const c = { bot: { id: "bot-trail" }, user: { id: "user-trail" } } as Parameters<typeof noteClick>[0];
const fake = (name: string, isError = false): Tool => ({ spec: { name, description: "", inputSchema: { type: "object", properties: {}, required: [] } }, activity: "computer", label: "", run: async () => ({ content: "done", isError }) });

test("L149: a click's point reaches the live state, as a share of the screen, and is sent to the viewer", () => {
  const seen: unknown[] = [];
  const stop = subscribe("user-trail", (e) => seen.push(e));
  noteClick(c, [640, 200], 1000);
  stop();
  assert.deepEqual(getLive("bot-trail").activity?.point, { x: 0.5, y: 0.25, at: 1000 });
  assert.equal(seen.length, 1, "one live event");
  noteClick(c, [5000, -3], 2000);
  assert.deepEqual(getLive("bot-trail").activity?.point, { x: 1, y: 0, at: 2000 }, "kept on the screen");
  noteClick(c, null, 3000);
  assert.equal(getLive("bot-trail").activity?.point?.at, 2000, "no point: nothing changes");
});

test("L149: screen_click and the end of screen_drag leave a point; a refused click and other tools do not", async () => {
  await traceClicks(fake("screen_click")).run({ x: 128, y: 80 }, c as never);
  assert.deepEqual(getLive("bot-trail").activity?.point?.x, 0.1);
  await traceClicks(fake("screen_drag")).run({ from_x: 0, from_y: 0, to_x: 1280, to_y: 400 }, c as never);
  assert.deepEqual([getLive("bot-trail").activity?.point?.x, getLive("bot-trail").activity?.point?.y], [1, 0.5]);
  await traceClicks(fake("screen_click", true)).run({ x: 0, y: 0 }, c as never);
  assert.equal(getLive("bot-trail").activity?.point?.x, 1, "refused: no point");
  const typing = fake("screen_type");
  assert.equal(traceClicks(typing), typing, "other tools are not wrapped");
});
