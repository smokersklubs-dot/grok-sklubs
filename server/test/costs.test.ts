import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// SK-P0-06: every model call is priced from a known source, or marked "unknown" and counted conservatively.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-costs-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "XAI_BASE_URL", "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "DEFAULT_MODEL"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { costOf, costEstimate, noteSubscription, priceInfo, summary, UNKNOWN_ESTIMATE } = await import("../src/usage.js");
const { q } = await import("../src/db.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

/** A provider that answers as `model` and reports 100 000 input / 20 000 output tokens per call. */
const fake = (id: string, model: string): LlmProvider => ({
  id, label: id, models: [model], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ok");
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model, usage: { inputTokens: 100_000, outputTokens: 20_000, cachedTokens: 0 } };
  },
});
registerProvider(fake("fakexai", "grok-4.7"));
registerProvider(fake("fakemystery", "mystery-1"));

const jars: Record<string, string> = { a: "", b: "" };
async function call(who: "a" | "b", method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("a", "GET", `/bots/${botId}/rows`)).json.rows;
const usageLines = () => q.all<{ model: string; cost_usd: number; price_status: string; est_cost_usd: number }>("SELECT model, cost_usd, price_status, est_cost_usd FROM usage ORDER BY id");
let userA = "", bot: Bot;

async function turn(model: string, text: string): Promise<void> {
  await call("a", "PATCH", `/bots/${bot.id}`, { model });
  const before = usageLines().length;
  await call("a", "POST", `/bots/${bot.id}/messages`, { text });
  await until(async () => usageLines().length > before && !(await call("a", "GET", "/bots")).json.live?.[bot.id]?.running, `turn on ${model}`);
}

test("set up two accounts (the first is the server's owner)", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "owner@example.com", password: "password123" })).json.user.id;
  assert.equal((await call("b", "POST", "/auth/signup", { email: "other@example.com", password: "password123" })).status, 200);
  bot = (await call("a", "GET", "/bots")).json.bots[0];
});

test("built-in prices come from the official pages, with their tiers", () => {
  // xAI grok-4.7: $2 in / $6 out per million; ≥ 200k prompt tokens: $4 / $12 for all tokens.
  assert.equal(costOf("grok-4.7", { inputTokens: 100_000, outputTokens: 20_000, cachedTokens: 0 }), 0.2 + 0.12);
  assert.equal(costOf("grok-4.7", { inputTokens: 200_000, outputTokens: 10_000, cachedTokens: 0 }), 0.8 + 0.12);
  // Claude Haiku 5.5: $0.10 / $0.50; prompts over 100,000 tokens: $0.50 / $2.50.
  assert.equal(costOf("claude-haiku-5-5", { inputTokens: 100_000, outputTokens: 0, cachedTokens: 0 }), 0.01);
  assert.equal(costOf("claude-haiku-5-5", { inputTokens: 100_001, outputTokens: 0, cachedTokens: 0 }).toFixed(6), (100_001 * 0.5 / 1e6).toFixed(6));
  // OpenAI gpt-5 (Standard): $1.25 in / $0.125 cached / $10 out.
  assert.equal(costOf("gpt-5", { inputTokens: 1_000_000, outputTokens: 100_000, cachedTokens: 200_000 }), 0.8 * 1.25 + 1 + 0.2 * 0.125);
  assert.match(priceInfo("gpt-5")!.source!, /developers\.openai\.com/);
  // Another address for the same model names: the built-in price no longer applies (that service bills its own).
  process.env.OPENAI_BASE_URL = "https://openrouter.example/v1";
  assert.equal(priceInfo("gpt-5"), null);
  delete process.env.OPENAI_BASE_URL;
  // Subscription tools are never "unknown".
  assert.deepEqual(costEstimate("claude-code:sonnet", { inputTokens: 5, outputTokens: 5, cachedTokens: 0 }), { cost: 0, status: "subscription", estimate: 0 });
});

test("a turn on grok-4.7 is billed more than 0 $", async () => {
  await turn("fakexai:grok-4.7", "bonjour");
  const last = usageLines().at(-1)!;
  assert.equal(last.model, "grok-4.7");
  assert.equal(last.price_status, "priced");
  assert.ok(last.cost_usd > 0.3, String(last.cost_usd));
});

test("a model without a price: tokens counted, cost unknown, budget counts the conservative estimate, one notice", async () => {
  await turn("fakemystery:mystery-1", "salut");
  const last = usageLines().at(-1)!;
  assert.equal(last.price_status, "unknown");
  assert.equal(last.cost_usd, 0);
  assert.equal(last.est_cost_usd, (100_000 * UNKNOWN_ESTIMATE[0] + 20_000 * UNKNOWN_ESTIMATE[1]) / 1e6);
  const s = summary(userA);
  assert.deepEqual(s.unknownModels, ["mystery-1"]);
  assert.equal(s.totals.unknownTokens, 120_000);
  assert.ok(s.totals.estimatedUsd > 0);
  const notices = (await rowsOf(bot.id)).filter((r) => r.body.kind === "notice" && /mystery-1/.test(r.body.text));
  assert.equal(notices.length, 1);
  // Shown as "unknown" to everyone; only the owner may set a price.
  const listB = (await call("b", "GET", "/model-prices")).json;
  assert.equal(listB.owner, false);
  assert.equal((await call("b", "PUT", "/model-prices/mystery-1", { input: 1, output: 2 })).status, 403);
  const listA = (await call("a", "GET", "/model-prices")).json;
  assert.equal(listA.owner, true);
  assert.equal(listA.models.find((m: any) => m.model === "mystery-1").origin, null);
  assert.equal(listA.models.find((m: any) => m.model === "grok-4.7").origin, "builtin");
  assert.equal((await call("a", "PUT", "/model-prices/mystery-1", { input: "x" })).status, 400);
});

test("a budget of 0.01 $ stops the next turn with the usual notice", async () => {
  assert.equal((await call("a", "PUT", "/usage/budget", { budgetUsd: 0.01 })).status, 200);
  const before = usageLines().length;
  await call("a", "PATCH", `/bots/${bot.id}`, { model: "fakemystery:mystery-1" });
  await call("a", "POST", `/bots/${bot.id}/messages`, { text: "encore" });
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "notice" && /budget is used up/.test(r.body.text)), "budget notice");
  assert.equal(usageLines().length, before, "no model call once the budget is spent");
  await call("a", "PUT", "/usage/budget", { budgetUsd: null });
});

test("unknown spend alone reaches a budget (counted at the estimate, not at 0 $)", async () => {
  q.run("DELETE FROM usage WHERE price_status <> 'unknown'");
  assert.equal(summary(userA).totals.costUsd, 0);
  assert.equal((await call("a", "PUT", "/usage/budget", { budgetUsd: 0.5 })).json.nearBudget, true);
  await call("a", "PUT", "/usage/budget", { budgetUsd: null });
});

test("the owner's price replaces 'unknown' for the calls that follow", async () => {
  const r = await call("a", "PUT", "/model-prices/mystery-1", { input: 1, output: 3, cached: 0.1 });
  assert.equal(r.status, 200);
  assert.equal(r.json.models.find((m: any) => m.model === "mystery-1").origin, "owner");
  await turn("fakemystery:mystery-1", "et maintenant");
  const last = usageLines().at(-1)!;
  assert.equal(last.price_status, "priced");
  assert.equal(last.cost_usd, 0.1 + 0.06);
  // The owner's price also wins over a built-in one; clearing it brings the built-in back.
  await call("a", "PUT", "/model-prices/grok-4.7", { input: 9, output: 9 });
  assert.equal(priceInfo("grok-4.7")!.origin, "owner");
  await call("a", "PUT", "/model-prices/grok-4.7", { input: null, output: null, cached: null });
  assert.equal(priceInfo("grok-4.7")!.origin, "builtin");
});

test("subscription windows are stored, not kept in memory only, and show this month's tokens", () => {
  noteSubscription(userA, { engine: "claude-code", fiveHour: 0.42, sevenDay: 0.1, resetsAt: 123, at: Date.now() });
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status) VALUES (?, ?, ?, 'claude-code:sonnet', 700, 30, 0, 0, 'subscription')", userA, bot.id, Date.now());
  const row = q.get<{ five_hour: number }>("SELECT five_hour FROM subscription_usage WHERE user_id = ? AND engine = 'claude-code'", userA)!;
  assert.equal(row.five_hour, 0.42);
  const sub = summary(userA).subscriptions.find((s) => s.engine === "claude-code")!;
  assert.equal(sub.fiveHour, 0.42);
  assert.equal(sub.inputTokens, 700);
  assert.equal(sub.turns, 1);
  // Another account sees none of it.
  const other = q.get<{ id: string }>("SELECT id FROM users WHERE email = 'other@example.com'")!.id;
  assert.deepEqual(summary(other).subscriptions, []);
});
