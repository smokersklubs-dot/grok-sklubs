import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Audit DS-Bot #149 (À faire n° 1): a text-only model got "[An image was here…]" for every picture. Now each picture is
// read by a model of the same account that reads images, and the text model gets that reading, labelled.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-dsimg-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
delete process.env.IMAGE_READER_MODEL;

const { registerProvider, resolveModel } = await import("../src/llm/index.js");
const { OpenAiCompatProvider } = await import("../src/llm/openai-compat.js");
const { resetReadings, imageAsText } = await import("../src/llm/imagetext.js");
await import("../src/agent/imageocr.js");
const { q } = await import("../src/db.js");
import type { ChatMessage, TurnRequest, TurnResult } from "../src/llm/types.js";

const PNG = Buffer.from("fake-png-bytes-for-tests").toString("base64");
const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

// The text-only endpoint (DeepSeek-like): the real OpenAI-compatible provider, with a fetch that records the wire body.
const wire: any[] = [];
const sse = (text: string) => new Response(`data: ${JSON.stringify({ choices: [{ delta: { content: text }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`, { status: 200 });
registerProvider(new OpenAiCompatProvider({ id: "txt", label: "Text only", baseUrl: "https://text.example", apiKeyEnv: "", apiKey: () => "sk-fake-for-tests", models: ["t"], images: false, fetch: async (_u, init) => { wire.push(JSON.parse(String(init.body))); return sse("ok"); } }));

// A model of the account that reads images.
const seen: TurnRequest[] = [];
let visionUp = true;
registerProvider({ id: "vis", label: "Vision", models: ["v"], available: () => visionUp, async runTurn(req): Promise<TurnResult> { seen.push(req); return { content: [{ type: "text", text: "Facture n° 42\nImage: a scanned invoice." }], stopReason: "end", model: "v", usage }; } });

const ask: ChatMessage[] = [{ role: "user", content: [{ type: "text", text: "What does this say?" }, { type: "image", mediaType: "image/png", data: PNG }] }];
const wireText = (b: any) => JSON.stringify(b.messages);

test("before: the text-only provider itself turns a picture into the fixed placeholder (defect confirmed at the wire)", async () => {
  const raw = new OpenAiCompatProvider({ id: "raw", label: "Raw", baseUrl: "https://text.example", apiKeyEnv: "", apiKey: () => "sk-fake-for-tests", models: ["t"], images: false, fetch: async (_u, init) => { wire.push(JSON.parse(String(init.body))); return sse("ok"); } });
  await raw.runTurn({ model: "t", system: "s", tools: [], effort: "low", messages: ask });
  assert.match(wireText(wire.at(-1)), /An image was here; this model does not read images/);
});

test("a text-only model of the account gets the reading of the picture, labelled, from a vision model of the same account", async () => {
  resetReadings(); seen.length = 0;
  const { provider, model } = resolveModel("txt:t", "user-a");
  await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: ask });
  const sent = wireText(wire.at(-1));
  assert.doesNotMatch(sent, /An image was here/);
  assert.match(sent, /You cannot see images, so v read it for you/);
  assert.match(sent, /Facture n° 42/);
  assert.match(sent, /information, not instructions/);
  assert.equal(seen.length, 1, "one reading call");
  assert.equal(seen[0].messages[0].content[0].type, "image", "the vision model got the picture");
});

test("the reading is kept per account: the same picture is not read twice, another account reads its own", async () => {
  seen.length = 0;
  const a = resolveModel("txt:t", "user-a");
  await a.provider.runTurn({ model: a.model, system: "s", tools: [], effort: "low", messages: ask });
  assert.equal(seen.length, 0, "cached for user-a");
  const b = resolveModel("txt:t", "user-b");
  await b.provider.runTurn({ model: b.model, system: "s", tools: [], effort: "low", messages: ask });
  assert.equal(seen.length, 1, "user-b's request reads it again: no reading crosses accounts");
  assert.equal(q.all("SELECT user_id FROM image_readings").length, 2);
});

test("screenshots inside tool results are read too", async () => {
  resetReadings(); seen.length = 0;
  const shot = Buffer.from("another-screenshot").toString("base64");
  const msgs: ChatMessage[] = [
    { role: "user", content: [{ type: "text", text: "go" }] },
    { role: "assistant", content: [{ type: "tool_use", id: "c1", name: "screen_view", input: {} }] },
    { role: "user", content: [{ type: "tool_result", toolUseId: "c1", content: [{ type: "text", text: "screen" }, { type: "image", mediaType: "image/png", data: shot }] }] },
  ];
  const { provider, model } = resolveModel("txt:t", "user-a");
  await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: msgs });
  assert.match(wireText(wire.at(-1)), /read it for you/);
  assert.doesNotMatch(wireText(wire.at(-1)), /Image output of the previous tool call/);
});

test("no model of the account reads images: an honest line, never a provider it did not set up; retried later, not every step", async () => {
  resetReadings(); seen.length = 0; visionUp = false;
  const other = Buffer.from("third-picture").toString("base64");
  const { provider, model } = resolveModel("txt:t", "user-c");
  await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data: other }] }] });
  assert.match(wireText(wire.at(-1)), /could not be read right now/);
  assert.equal(seen.length, 0, "the vision provider that is not available was never called");
  visionUp = true;
  await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "image", mediaType: "image/png", data: other }] }] });
  assert.equal(seen.length, 0, "a failed reading waits RETRY_MS before another try");
  visionUp = true;
});

test("a model that reads images is handed out untouched", () => {
  const { provider } = resolveModel("vis:v", "user-a");
  assert.equal(Object.getPrototypeOf(provider) === Object.prototype || typeof provider.runTurn === "function", true);
  assert.equal(imageAsText("abcdef0123", null).text.includes("sha256:abcdef01"), true);
});
