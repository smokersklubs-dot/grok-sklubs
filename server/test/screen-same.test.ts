import assert from "node:assert/strict";
import { test } from "node:test";
import { noteShots, sameScreen } from "../src/agent/screendedup.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "../src/agent/tools.js";

// L65: screen_view skips a picture identical to the last one the model got in the same turn.
const pic = (data: string, text = "Current screen.\nPage: Shop — https://shop.example\nThe screenshot is 1280×800."): ToolOutput =>
  ({ content: [{ type: "text", text }, { type: "image", mediaType: "image/jpeg", data }], summary: "Shop" });
let next = "AAAA";
const view: BuiltinTool = noteShots({
  spec: { name: "screen_view", description: "", inputSchema: { type: "object", properties: {}, required: [] } }, activity: "computer", label: "",
  run: async (a, c) => sameScreen(c, a, pic(next)),
});
const click: BuiltinTool = noteShots({ ...view, spec: { ...view.spec, name: "screen_click" }, run: async () => pic(next, "Clicked at (1, 2).") });
const ctx = (turn: object) => ({ turn } as unknown as ToolContext);
const images = (o: ToolOutput) => (Array.isArray(o.content) ? o.content.filter((b) => b.type === "image").length : 0);
const words = (o: ToolOutput) => (typeof o.content === "string" ? o.content : o.content.map((b) => ("text" in b ? b.text : "")).join("\n"));

test("L65: the same picture twice in a turn comes back the second time as words; a changed one as a picture", async () => {
  const turn = {};
  next = "AAAA";
  assert.equal(images(await view.run({}, ctx(turn))), 1, "first look: a picture");
  const again = await view.run({}, ctx(turn));
  assert.equal(images(again), 0, "same pixels: no picture");
  assert.equal(again.summary, "unchanged");
  assert.match(words(again), /^Current screen\.\nThe screen is exactly the same as in your last screenshot.*fresh: true/);
  assert.match(words(again), /Page: Shop — https:\/\/shop\.example/, "the page line is kept");
  next = "BBBB";
  assert.equal(images(await view.run({}, ctx(turn))), 1, "changed: a picture");
});

test("L65: fresh: true always sends it; a new turn starts without memory; an action's picture counts as the last one", async () => {
  const turn = {};
  next = "CCCC";
  await view.run({}, ctx(turn));
  assert.equal(images(await view.run({ fresh: true }, ctx(turn))), 1, "fresh: true");
  assert.equal(images(await view.run({}, ctx({}))), 1, "another turn: a picture");
  next = "DDDD";
  await click.run({}, ctx(turn));
  assert.equal(images(await view.run({}, ctx(turn))), 0, "the click already showed this exact screen");
});

test("L65: without a turn (a tool run on its own) nothing is skipped", async () => {
  next = "EEEE";
  assert.equal(images(await view.run({}, {} as ToolContext)), 1);
  assert.equal(images(await view.run({}, {} as ToolContext)), 1);
});
