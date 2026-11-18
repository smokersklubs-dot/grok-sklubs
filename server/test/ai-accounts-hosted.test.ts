import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Hosted mode, « Mes comptes IA »: each account brings its own OpenRouter / ChatGPT / Claude account. A free account
// adds its own OpenRouter key and its bots run on it (payer "own", never the operator's budget); the ChatGPT / Claude
// sign-in follows the hosted rules (engineBlock / subscriptionEnginesFor): refused when the owner turned subscriptions
// off, for a suspended account, and on a plan with disposable free computers.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-aiacc-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.SIGNUP_PER_IP = "100";
process.env.HOSTED_MODE = "1";
process.env.FREE_PLAN_COMPUTER = "personal";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "opx:op-1";
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "MAX_BOTS"]) delete process.env[k];

const KEY = "sk-or-v1-hosted-0123456789abcdefghijkl";
let chats = 0;
const fake = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    if (req.url?.startsWith("/api/v1/models")) {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek", created: 1, context_length: 1000000, pricing: { prompt: "0.0000003", completion: "0.0000012" }, supported_parameters: ["tools"] }] }));
      return;
    }
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end("{}"); return; }
    if (req.url === "/api/v1/chat/completions") {
      chats++;
      res.writeHead(200, { "content-type": "text/event-stream" });
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: "own key reply" } }] })}\n\n`);
      res.write(`data: ${JSON.stringify({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
      res.end(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15, cost: 0.5 } })}\n\ndata: [DONE]\n\n`);
      return;
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${(fake.address() as { port: number }).port}/api/v1`;
after(() => { fake.close(); });

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const { setConnectDeps } = await import("../src/subscriptionconnect.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";

let opCalls = 0;
registerProvider({
  id: "opx", label: "Operator", models: ["op-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { opCalls++; return { content: [{ type: "text", text: "op" }], stopReason: "end", model: req.model, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});
setConnectDeps({ linux: () => true, login: async () => {}, status: async () => [] });

const ORIGIN = process.env.PUBLIC_URL!;
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const owner = client();
const alice = client();
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const ids: Record<string, string> = {};

test("setup: the owner and a customer on the free plan", async () => {
  assert.equal((await owner("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "fr" })).status, 200);
  const a = await alice("POST", "/auth/signup", { email: "alice@example.com", password: "password123", locale: "fr", acceptTerms: true });
  assert.equal(a.status, 200, a.text);
  ids.alice = a.json.user.id;
  assert.equal(hosted.subscriptions.get(ids.alice)?.planId, "free");
  ids.bot = (await alice("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
});

test("a free account's own OpenRouter key works: its bot runs on it, the line is paid by the account, not the operator", async () => {
  const saved = await alice("PUT", "/openrouter", { key: KEY });
  assert.equal(saved.status, 200, saved.text);
  const pid = saved.json.provider.id;
  assert.equal((await alice("PATCH", `/bots/${ids.bot}`, { model: `${pid}:deepseek/deepseek-v4.1-flash` })).status, 200);
  const before = opCalls;
  await alice("POST", `/bots/${ids.bot}/messages`, { text: "bonjour" });
  await until(async () => !(await alice("GET", "/bots")).json.live[ids.bot]?.running && chats > 0, "the reply");
  const rows: Row[] = (await alice("GET", `/bots/${ids.bot}/rows?limit=200`)).json.rows;
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("own key reply")), JSON.stringify(rows.slice(-3).map((r) => r.body)));
  assert.equal(opCalls, before, "the operator's keys are not used");
  const line = q.get<{ payer: string; cost_usd: number; price_status: string }>("SELECT payer, cost_usd, price_status FROM usage WHERE user_id = ? ORDER BY rowid DESC LIMIT 1", ids.alice)!;
  assert.equal(line.payer, "own");
  assert.equal(line.price_status, "reported");
  assert.equal(line.cost_usd, 0.5);
  // The operator's own budget view of this account counts nothing on the service's keys.
  assert.equal(hosted.spentEur(ids.alice), 0);
});

test("ChatGPT / Claude sign-in follows the hosted rules", async () => {
  assert.equal((await alice("GET", "/connect-subscription")).json.allowed, true);
  assert.equal((await alice("POST", "/connect-subscription/start", { engine: "claude-code" })).status, 200);
  // The owner turns subscriptions off for customers.
  assert.equal((await owner("PUT", "/admin/settings", { subscriptionEngines: false })).status, 200);
  const off = await alice("GET", "/connect-subscription");
  assert.equal(off.json.allowed, false);
  assert.equal(off.json.why, "engines");
  assert.match(off.json.whyText, /pas disponibles/);
  const r = await alice("POST", "/connect-subscription/start", { engine: "codex" });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "engines");
  assert.equal((await alice("POST", "/connect-subscription/use", { engine: "codex", botId: ids.bot })).status, 403);
  // The operator is never blocked.
  assert.equal((await owner("GET", "/connect-subscription")).json.allowed, true);
  assert.equal((await owner("PUT", "/admin/settings", { subscriptionEngines: true })).status, 200);
  // Disposable free computers (FREE_PLAN_COMPUTER unset): no place for a sign-in.
  delete process.env.FREE_PLAN_COMPUTER;
  assert.equal((await alice("GET", "/connect-subscription")).json.why, "engines");
  process.env.FREE_PLAN_COMPUTER = "personal";
  // A suspended account.
  hosted.subscriptions.update(ids.alice, { status: "suspended" });
  assert.equal((await alice("GET", "/connect-subscription")).json.why, "suspended");
  hosted.subscriptions.update(ids.alice, { status: "active" });
  assert.equal((await alice("GET", "/connect-subscription")).json.allowed, true);
});
