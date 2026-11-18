import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// OpenRouter as a provider (openrouter.ts, openrouterroutes.ts, apimodels.ts) against a fake OpenRouter: the catalog
// (pricing per token → per million, context, tools-only filter, routers and batch variants left out, "Recommandés", 6 h
// cache), the key sealed and never returned, the documented chat call (base URL, Bearer key, attribution headers), the
// reported cost recorded, a 402 told to the key's owner once, and isolation between accounts. Also « Connecter mon compte
// ChatGPT / Claude » (subscriptionconnect.ts): own bots only, no Linux computers → refused, the brain switch.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-or-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["HOSTED_MODE", "MAX_BOTS", "AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const KEY = "sk-or-v1-test-0123456789abcdefghijklmnop";
const seen: { method: string; path: string; headers: http.IncomingHttpHeaders; body: any }[] = [];
let modelsHits = 0;
const catalog = {
  data: [
    { id: "deepseek/deepseek-v4.1-flash", name: "DeepSeek: V4.1 Flash", created: 200, context_length: 1_000_000, architecture: { input_modalities: ["text"] }, pricing: { prompt: "0.0000003", completion: "0.0000012", input_cache_read: "0.000000006" }, supported_parameters: ["tools", "tool_choice"], endpoints: ["/api/v1/chat/completions"] },
    { id: "deepseek/deepseek-v4-flash", name: "DeepSeek: V4 Flash", created: 100, context_length: 1_000_000, pricing: { prompt: "0.0000003", completion: "0.0000012" }, supported_parameters: ["tools"] },
    { id: "google/gemini-3.8-flash", name: "Google: Gemini 3.8 Flash", created: 300, context_length: 2_000_000, architecture: { input_modalities: ["text", "image"] }, pricing: { prompt: "0.0000001", completion: "0.0000004" }, supported_parameters: ["tools"] },
    { id: "google/gemini-3.8-flash:batch", name: "Batch", created: 300, context_length: 2_000_000, pricing: { prompt: "0.00000005", completion: "0.0000002" }, supported_parameters: ["tools"] },
    { id: "anthropic/claude-sonnet-5.5", name: "Anthropic: Claude Sonnet 5.5", created: 400, context_length: 1_000_000, architecture: { input_modalities: ["text", "image"] }, pricing: { prompt: "0.000003", completion: "0.000015" }, supported_parameters: ["tools", "reasoning"] },
    { id: "some/no-tools-model", name: "No tools", created: 1, context_length: 8000, pricing: { prompt: "0.000001", completion: "0.000001" }, supported_parameters: ["temperature"] },
    { id: "openrouter/auto", name: "Auto router", created: 1, context_length: 2_000_000, pricing: { prompt: "-1", completion: "-1" }, supported_parameters: ["tools"] },
    { id: "foo/embeds-only", name: "Batch only", created: 1, context_length: 8000, pricing: { prompt: "0.000001", completion: "0.000001" }, supported_parameters: ["tools"], endpoints: ["/api/v1/embeddings"] },
  ],
};
let creditGone = false;
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const url = req.url ?? "";
    seen.push({ method: req.method ?? "", path: url, headers: req.headers, body: raw ? JSON.parse(raw) : null });
    if (req.method === "GET" && url.startsWith("/api/v1/models")) { modelsHits++; res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(catalog)); return; }
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 401, message: "No auth" } })); return; }
    if (req.method === "GET" && url === "/api/v1/key") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: { label: "k", limit: 10, limit_remaining: 7.5, usage: 2.5, is_free_tier: false } })); return; }
    if (req.method === "POST" && url === "/api/v1/chat/completions") {
      if (creditGone) { res.writeHead(402, { "content-type": "application/json" }).end(JSON.stringify({ error: { code: 402, message: "Insufficient credits", metadata: { limit_source: "openrouter_credits" } } })); return; }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ choices: [{ index: 0, delta: { content: "Bonjour depuis OpenRouter" } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ choices: [], usage: { prompt_tokens: 1000, completion_tokens: 50, total_tokens: 1050, cost: 0.0123, prompt_tokens_details: { cached_tokens: 0 } } });
      res.end("data: [DONE]\n\n");
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
const { mapCatalog, recommendedOf, resetOpenRouterCatalog, openRouterCatalog, OPENROUTER_HEADERS } = await import("../src/openrouter.js");
const { setConnectDeps } = await import("../src/subscriptionconnect.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";

const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, model: req.model }; },
};
registerProvider(scripted);

function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const me = client();
const other = client();
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (who: ReturnType<typeof client>, botId: string): Promise<Row[]> => (await who("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const idle = (who: ReturnType<typeof client>, botId: string) => until(async () => !(await who("GET", "/bots")).json.live[botId]?.running, "idle");

let mainBot = "";
let otherBot = "";
let providerId = "";
test("setup", async () => {
  assert.equal((await me("POST", "/auth/signup", { email: "or@example.com", password: "password-1", locale: "fr" })).status, 200);
  assert.equal((await other("POST", "/auth/signup", { email: "or2@example.com", password: "password-1", locale: "en" })).status, 200);
  mainBot = (await me("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
  otherBot = (await other("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
});

test("catalog mapping: prices per million, context, images, tools only, no routers / batch / non-chat models", () => {
  const m = mapCatalog(catalog);
  assert.deepEqual(m.map((x) => x.id).sort(), ["anthropic/claude-sonnet-5.5", "deepseek/deepseek-v4-flash", "deepseek/deepseek-v4.1-flash", "google/gemini-3.8-flash"]);
  const ds = m.find((x) => x.id === "deepseek/deepseek-v4.1-flash")!;
  assert.equal(ds.input, 0.3);
  assert.equal(ds.output, 1.2);
  assert.equal(ds.cached, 0.006);
  assert.equal(ds.contextWindow, 1_000_000);
  assert.equal(ds.images, false);
  assert.equal(m.find((x) => x.id === "google/gemini-3.8-flash")!.images, true);
  // The newest of each family that exists; a family missing from the catalog is skipped.
  assert.deepEqual(recommendedOf(m), ["deepseek/deepseek-v4.1-flash", "google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5"]);
});

test("the catalog route reads OpenRouter once (tools filter asked for) and keeps it 6 hours", async () => {
  resetOpenRouterCatalog();
  modelsHits = 0;
  const a = await me("GET", "/openrouter/catalog");
  assert.equal(a.status, 200, a.text);
  assert.equal(a.json.models.length, 4);
  assert.ok(a.json.recommended.includes("google/gemini-3.8-flash"));
  const b = await other("GET", "/openrouter/catalog");
  assert.equal(b.json.models.length, 4);
  assert.equal(modelsHits, 1, "cached server-side");
  const hit = seen.find((s) => s.path.startsWith("/api/v1/models"))!;
  assert.match(hit.path, /supported_parameters=tools/);
  await openRouterCatalog();
  assert.equal(modelsHits, 1);
});

test("the key: refused when wrong, sealed when saved, never sent back; the recommended models by default; others see nothing", async () => {
  assert.equal((await me("POST", "/openrouter/test", { key: "sk-or-wrong" })).json.ok, false);
  const ok = await me("POST", "/openrouter/test", { key: KEY });
  assert.equal(ok.json.ok, true);
  assert.equal(ok.json.remainingUsd, 7.5);
  assert.equal(ok.json.detail, "La clé fonctionne.");
  const keyCall = seen.filter((s) => s.path === "/api/v1/key").at(-1)!;
  assert.equal(keyCall.headers.authorization, `Bearer ${KEY}`);
  assert.equal((await me("PUT", "/openrouter", {})).status, 400, "a key first");
  const saved = await me("PUT", "/openrouter", { key: KEY });
  assert.equal(saved.status, 200, saved.text);
  providerId = saved.json.provider.id;
  assert.match(providerId, /^up-/);
  assert.equal(saved.json.provider.preset, "openrouter");
  assert.equal(saved.json.provider.hasKey, true);
  assert.deepEqual(saved.json.provider.models.map((m: any) => m.id), ["deepseek/deepseek-v4.1-flash", "google/gemini-3.8-flash", "anthropic/claude-sonnet-5.5"]);
  assert.ok(!saved.text.includes(KEY));
  assert.ok(!(await me("GET", "/openrouter")).text.includes(KEY));
  assert.ok(!(await me("GET", "/api-providers")).text.includes(KEY));
  assert.ok(!q.all<{ key_enc: string }>("SELECT key_enc FROM user_providers").some((r) => r.key_enc.includes(KEY)));
  // The saved key is used by Test when none is typed.
  assert.equal((await me("POST", "/openrouter/test", {})).json.ok, true);
  // Models: only ids of the catalog, prices from the catalog (never from the browser).
  const pick = await me("PUT", "/openrouter", { models: ["google/gemini-3.8-flash", "made/up", { id: "x" }, "deepseek/deepseek-v4.1-flash"] });
  assert.deepEqual(pick.json.provider.models.map((m: any) => m.id), ["google/gemini-3.8-flash", "deepseek/deepseek-v4.1-flash"]);
  assert.equal(pick.json.provider.models[0].input, 0.1);
  assert.equal(pick.json.provider.models[0].images, true);
  assert.ok((await me("GET", "/models")).json.models.some((m: any) => m.ref === `${providerId}:deepseek/deepseek-v4.1-flash`));
  // Isolation: the other account has no OpenRouter, cannot use, test or change this one.
  assert.equal((await other("GET", "/openrouter")).json.provider, null);
  assert.equal((await other("POST", "/openrouter/test", {})).status, 400);
  assert.ok(!(await other("GET", "/models")).json.models.some((m: any) => m.ref.startsWith(providerId)));
  assert.equal((await other("PATCH", `/api-providers/${providerId}`, { name: "mine" })).status, 404);
  assert.equal((await other("PATCH", `/bots/${otherBot}`, { model: `${providerId}:deepseek/deepseek-v4.1-flash` })).status, 200);
  seen.length = 0;
  await other("POST", `/bots/${otherBot}/messages`, { text: "hello" });
  await idle(other, otherBot);
  assert.equal(seen.filter((s) => s.path === "/api/v1/chat/completions").length, 0, "never runs on someone else's key");
});

test("a bot on OpenRouter: the documented call (base URL, key, attribution headers) and the reported cost recorded", async () => {
  assert.equal((await me("PATCH", `/bots/${mainBot}`, { model: `${providerId}:deepseek/deepseek-v4.1-flash` })).status, 200);
  seen.length = 0;
  await me("POST", `/bots/${mainBot}/messages`, { text: "Bonjour" });
  await idle(me, mainBot);
  const rows = await rowsOf(me, mainBot);
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("Bonjour depuis OpenRouter")), JSON.stringify(rows.slice(-3)));
  const call = seen.find((s) => s.path === "/api/v1/chat/completions")!;
  assert.equal(call.method, "POST");
  assert.equal(call.headers.authorization, `Bearer ${KEY}`);
  assert.equal(call.headers["http-referer"], OPENROUTER_HEADERS["HTTP-Referer"]);
  assert.equal(call.headers["x-openrouter-title"], "Sklubot");
  assert.equal(call.body.model, "deepseek/deepseek-v4.1-flash");
  assert.equal(call.body.stream, true);
  assert.ok(Array.isArray(call.body.tools) && call.body.tools[0].type === "function" && call.body.tools[0].function.name);
  const u = q.get<{ cost_usd: number; price_status: string; input_tokens: number }>("SELECT cost_usd, price_status, input_tokens FROM usage WHERE bot_id = ? ORDER BY rowid DESC LIMIT 1", mainBot)!;
  assert.equal(u.price_status, "reported");
  assert.equal(u.cost_usd, 0.0123);
  assert.equal(u.input_tokens, 1000);
});

test("402 (credit used up): a clear message, and the key's owner is told once on the main bot with a link to Models", async () => {
  creditGone = true;
  const before = (await rowsOf(me, mainBot)).length;
  await me("POST", `/bots/${mainBot}/messages`, { text: "encore" });
  await idle(me, mainBot);
  const fresh = (await rowsOf(me, mainBot)).slice(before);
  const told = fresh.filter((r) => r.body.kind === "notice" && /crédit OpenRouter est épuisé/.test(r.body.text));
  assert.ok(told.length >= 1, JSON.stringify(fresh.map((r) => r.body)));
  const card = told.find((r) => r.body.kind === "notice" && r.body.action?.kind === "settings");
  assert.ok(card && card.body.kind === "notice" && card.body.action?.kind === "settings" && card.body.action.section === "models");
  const again = (await rowsOf(me, mainBot)).length;
  await me("POST", `/bots/${mainBot}/messages`, { text: "et encore" });
  await idle(me, mainBot);
  const second = (await rowsOf(me, mainBot)).slice(again).filter((r) => r.body.kind === "notice" && r.body.action?.kind === "settings");
  assert.equal(second.length, 0, "the owner is told once");
  // The other account hears nothing of it.
  assert.ok(!(await rowsOf(other, otherBot)).some((r) => r.body.kind === "notice" && /OpenRouter/.test(r.body.text)));
  creditGone = false;
});

test("« Connecter mon compte ChatGPT / Claude »: refused without Linux computers; own bots only; status; brain switched", async () => {
  const info = await me("GET", "/connect-subscription");
  assert.equal(info.json.allowed, false);
  assert.equal(info.json.why, "computer");
  assert.equal((await me("POST", "/connect-subscription/start", { engine: "codex" })).status, 409);
  const logins: string[] = [];
  let signedIn = false;
  setConnectDeps({
    linux: () => true,
    login: async (bot, engine) => { logins.push(`${bot.id}:${engine}`); },
    status: async () => [{ engine: "codex", installed: true, signedIn, account: signedIn ? "me@example.com" : null, detail: null }, { engine: "claude-code", installed: true, signedIn: false, account: null, detail: null }],
  });
  const ok = await me("GET", "/connect-subscription");
  assert.equal(ok.json.allowed, true);
  assert.equal(ok.json.mainBotId, mainBot);
  assert.ok(!JSON.stringify(ok.json).includes(otherBot));
  // Someone else's bot: 404, nothing opened.
  assert.equal((await me("POST", "/connect-subscription/start", { engine: "codex", botId: otherBot })).status, 404);
  assert.equal((await me("GET", `/connect-subscription/status?bot=${otherBot}&engine=codex`)).status, 404);
  assert.equal((await me("POST", "/connect-subscription/use", { engine: "codex", botId: otherBot })).status, 404);
  assert.equal(logins.length, 0);
  const started = await me("POST", "/connect-subscription/start", { engine: "codex" });
  assert.equal(started.status, 200, started.text);
  assert.equal(started.json.botId, mainBot);
  assert.equal(started.json.defaultRef, "codex:default");
  assert.deepEqual(logins, [`${mainBot}:codex`]);
  assert.equal((await me("GET", `/connect-subscription/status?bot=${mainBot}&engine=codex`)).json.signedIn, false);
  signedIn = true;
  const st = (await me("GET", `/connect-subscription/status?bot=${mainBot}&engine=codex`)).json;
  assert.deepEqual(st, { signedIn: true, account: "me@example.com" });
  const used = await me("POST", "/connect-subscription/use", { engine: "claude-code", botId: mainBot });
  assert.equal(used.status, 200);
  assert.match(used.json.model, /^claude-code:/);
  assert.equal((await me("GET", "/bots")).json.bots.find((b: any) => b.id === mainBot).model, used.json.model);
  assert.equal((await other("GET", "/bots")).json.bots.find((b: any) => b.id === otherBot).model, `${providerId}:deepseek/deepseek-v4.1-flash`, "the other account's bot is untouched");
  setConnectDeps({ linux: () => false });
});
