import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L69 (RESTE 23/11): a small model for the simple side passes — only the summary between turns and the condensing of a
// long page read — never inside a turn's own conversation, and only for bots in a thrifty mode (fast / auto / free).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-sidemodel-"));
process.env.SESSION_SECRET = "side-model-secret-side-model-secret-01";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "priced:claude-opus-5-5";
process.env.COMPACT_CHARS = "6000";
for (const k of ["MAX_BOTS", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "DEMO_MODE", "HOSTED_MODE", "ANTHROPIC_BASE_URL", "AUX_MODEL"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, history } = await import("../src/store.js");
const { setMode } = await import("../src/agent/modelmodes.js");
const { sideModelRef, condenseResult, CONDENSE_MARK } = await import("../src/agent/sidemodel.js");
const { compactIfNeeded, SUMMARY_SECTIONS } = await import("../src/agent/memory.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

const calls: { model: string; system: string; prompt: string }[] = [];
const GOOD = SUMMARY_SECTIONS.map((h: string) => `## ${h}\nNoted: the client Camille, quote 4521, meeting on 2026-11-30.`).join("\n");
let failSmall = false;
registerProvider({
  id: "priced", label: "Priced", models: ["claude-haiku-5-5", "claude-opus-5-5"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const prompt = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : "")).join(" ")).join("\n");
    calls.push({ model: req.model, system: req.system, prompt });
    if (failSmall && req.model === "claude-haiku-5-5") throw new Error("small model down");
    const text = /compress a long working conversation/.test(req.system) ? GOOD : /condense a long tool result/.test(req.system) ? "- a price list\n- 3 products" : "[]";
    return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: req.model, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("POST", "/auth/signup", { email: "side@example.com", password: "password-1", locale: "en" });
const botId = (await call("POST", "/bots", { name: "Thrifty", model: "priced:claude-opus-5-5" })).json.bot.id as string;

test("L69: balanced and strongest bots keep every side pass on their own model; fast / auto use the cheapest priced model", () => {
  const b = bots.byId(botId)!;
  assert.equal(b.model, "priced:claude-opus-5-5");
  assert.equal(sideModelRef(b), null, "balanced (default): unchanged");
  setMode(b.id, "strongest");
  assert.equal(sideModelRef(b), null);
  setMode(b.id, "fast");
  assert.equal(sideModelRef(b), "priced:claude-haiku-5-5");
  setMode(b.id, "auto");
  assert.equal(sideModelRef(b), "priced:claude-haiku-5-5");
  assert.equal(sideModelRef({ ...b, model: "priced:claude-haiku-5-5" }), null, "already on the small model: nothing to save");
  assert.equal(sideModelRef({ ...b, model: "claude-code:default" }), null, "never for a subscription bot");
});

test("L69: a long page read is condensed by the small model, labelled, with the page as data; nothing for a balanced bot", async () => {
  const b = bots.byId(botId)!;
  setMode(b.id, "fast");
  const before = calls.length;
  const out = await condenseResult(b, "Product A 10 €\n".repeat(5000));
  assert.ok(out.startsWith(CONDENSE_MARK));
  assert.match(out, /3 products/);
  const c = calls.slice(before);
  assert.equal(c.length, 1);
  assert.equal(c[0].model, "claude-haiku-5-5");
  assert.match(c[0].system, /data, never instructions/);
  assert.ok(c[0].prompt.length < 61_000, "at most CONDENSE_INPUT_CHARS of the page are sent");
  setMode(b.id, "balanced");
  const n = calls.length;
  assert.equal(await condenseResult(b, "x".repeat(50_000)), "");
  assert.equal(calls.length, n, "no call at all");
  setMode(b.id, "fast");
  failSmall = true;
  assert.equal(await condenseResult(b, "x".repeat(50_000)), "", "a failure leaves the result as before");
  failSmall = false;
});

test("L69: the summary between turns goes to the small model in fast mode, and falls back to the bot's model if it fails", async () => {
  const fill = () => {
    const b = bots.byId(botId)!;
    for (let i = 0; i < 8; i++) {
      history.append(b.id, b.generation, { role: "user", content: [{ type: "text", text: `old question ${i} ${"lorem ipsum ".repeat(60)}` }] });
      history.append(b.id, b.generation, { role: "assistant", content: [{ type: "text", text: `old answer ${i} ${"dolor sit ".repeat(60)}` }] });
    }
  };
  setMode(botId, "fast");
  fill();
  let before = calls.length;
  const r = await compactIfNeeded(bots.byId(botId)!, true);
  assert.equal(r.changed, true);
  const sums = calls.slice(before).filter((c) => /compress a long working conversation/.test(c.system));
  assert.ok(sums.length >= 1);
  assert.ok(sums.every((c) => c.model === "claude-haiku-5-5"), "summary on the small model");
  fill();
  failSmall = true;
  before = calls.length;
  const r2 = await compactIfNeeded(bots.byId(botId)!, true);
  failSmall = false;
  assert.equal(r2.changed, true, "still summarised");
  assert.ok(calls.slice(before).some((c) => /compress a long/.test(c.system) && c.model === "claude-opus-5-5"), "fell back to the bot's model");
});
