import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L150 (backlog A-FAIRE): reasoning level per conversation, model presets per project, a key with no credit refused when
// it is saved (OpenRouter GET /key, DeepSeek GET /user/balance), and the OpenRouter low-credit alert. Against FAKE
// providers only (a local HTTP server); no real account is used.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l150-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["HOSTED_MODE", "MAX_BOTS", "AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const GOOD = "sk-or-v1-fake-good-0123456789abcdef";
const EMPTY = "sk-or-v1-fake-empty-0123456789abcdef";
const DS_GOOD = "sk-fake-deepseek-good";
const DS_EMPTY = "sk-fake-deepseek-empty";
const hits: string[] = [];
let goodLeft = 7.5;
const fake = http.createServer((req, res) => {
  const url = req.url ?? "";
  const auth = req.headers.authorization ?? "";
  hits.push(`${req.method} ${url}`);
  const send = (status: number, body: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(body));
  if (url === "/api/v1/key") {
    if (auth === `Bearer ${GOOD}`) return send(200, { data: { label: "k", limit: 20, limit_remaining: goodLeft, usage: 1, is_free_tier: false } });
    if (auth === `Bearer ${EMPTY}`) return send(200, { data: { label: "k", limit: 5, limit_remaining: 0, usage: 5, is_free_tier: false } });
    return send(401, { error: { code: 401, message: "No auth" } });
  }
  if (url === "/api/v1/credits") return send(403, { error: { message: "Only management keys can perform this operation." } });
  if (url.startsWith("/api/v1/models")) return send(200, { data: [] });
  if (url === "/ds/user/balance") {
    if (auth === `Bearer ${DS_GOOD}`) return send(200, { is_available: true, balance_infos: [{ currency: "USD", total_balance: "12.50", granted_balance: "0", topped_up_balance: "12.50" }] });
    if (auth === `Bearer ${DS_EMPTY}`) return send(200, { is_available: false, balance_infos: [{ currency: "USD", total_balance: "0.00", granted_balance: "0", topped_up_balance: "0" }] });
    return send(401, { error: { message: "Authentication Fails" } });
  }
  send(404, {});
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const PORT = (fake.address() as { port: number }).port;
process.env.OPENROUTER_BASE_URL = `http://127.0.0.1:${PORT}/api/v1`;
after(() => { fake.close(); });

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, rows } = await import("../src/store.js");
const { withWorkModel } = await import("../src/agent/workmodel.js");
const { checkOpenRouterCredit, checkKeyCredit, creditKindOf } = await import("../src/providercredit.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";

const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1", "script-2"], available: () => true,
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
let botId = "";
let userId = "";
const userTurn = { kind: "user", text: "bonjour" } as any;
const routineTurn = { kind: "routine", runId: "r1" } as any;

test("setup", async () => {
  assert.equal((await me("POST", "/auth/signup", { email: "l150@example.com", password: "password-1", locale: "fr" })).status, 200);
  assert.equal((await other("POST", "/auth/signup", { email: "l150b@example.com", password: "password-1", locale: "en" })).status, 200);
  const b = (await me("GET", "/bots")).json.bots.find((x: any) => x.primary);
  botId = b.id;
  userId = bots.byId(botId)!.userId;
});

test("reasoning per conversation: saved, listed, used for the owner's turns only; a wrong level refused in French", async () => {
  const gen = bots.byId(botId)!.generation;
  const bad = await me("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "turbo" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /niveau de réflexion/);
  const ok = await me("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "xhigh" });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.conversations.find((c: any) => c.current).effort, "xhigh");
  const bot = bots.byId(botId)!;
  assert.equal(withWorkModel(bot, userTurn)!.effort, "xhigh", "the owner's own message");
  assert.equal(withWorkModel(bot, routineTurn)!.effort, bot.effort, "a routine keeps the bot's level");
  // Another account cannot touch it.
  assert.equal((await other("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "low" })).status, 404);
  // Back to the bot's own level.
  await me("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "" });
  assert.equal(withWorkModel(bots.byId(botId)!, userTurn)!.effort, bot.effort);
});

test("presets per project: model and level for the bots filed in it, under the conversation's own choice; owner only", async () => {
  const sec = (await me("POST", "/sections", { name: "Site" })).json.section;
  assert.equal((await me("PATCH", `/bots/${botId}`, { sectionId: sec.id })).status, 200);
  assert.deepEqual((await me("GET", `/sections/${sec.id}/model-preset`)).json, { model: "", effort: "" });
  const badModel = await me("PUT", `/sections/${sec.id}/model-preset`, { model: "nope:not-a-model" });
  assert.equal(badModel.status, 400);
  assert.match(badModel.json.error, /modèle disponible/);
  const put = await me("PUT", `/sections/${sec.id}/model-preset`, { model: "script:script-2", effort: "low" });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.json, { model: "script:script-2", effort: "low" });
  let seen = withWorkModel(bots.byId(botId)!, userTurn)!;
  assert.equal(seen.model, "script:script-2");
  assert.equal(seen.effort, "low");
  // The conversation's own choice wins.
  const gen = bots.byId(botId)!.generation;
  await me("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "high", model: "script:script-1" });
  seen = withWorkModel(bots.byId(botId)!, userTurn)!;
  assert.equal(seen.effort, "high");
  assert.equal(seen.model, "script:script-1");
  await me("PATCH", `/bots/${botId}/conversations/${gen}`, { effort: "", model: "" });
  // Routines keep the bot's own settings.
  assert.equal(withWorkModel(bots.byId(botId)!, routineTurn)!.effort, bots.byId(botId)!.effort);
  // Isolation: existence is checked first, the same 404 for another account.
  assert.equal((await other("GET", `/sections/${sec.id}/model-preset`)).status, 404);
  assert.equal((await other("PUT", `/sections/${sec.id}/model-preset`, { effort: "low" })).status, 404);
  // Empty preset removes it.
  assert.deepEqual((await me("PUT", `/sections/${sec.id}/model-preset`, { model: "", effort: "" })).json, { model: "", effort: "" });
  assert.equal(withWorkModel(bots.byId(botId)!, userTurn)!.model, bots.byId(botId)!.model);
});

test("a key with no credit is refused when saved: OpenRouter (limit_remaining 0), DeepSeek (is_available false); a good key passes", async () => {
  const empty = await me("PUT", "/openrouter", { key: EMPTY });
  assert.equal(empty.status, 400);
  assert.match(empty.json.error, /n'a plus de crédit/);
  const wrong = await me("PUT", "/openrouter", { key: "sk-or-v1-fake-wrong-000000000000" });
  assert.equal(wrong.status, 400);
  assert.match(wrong.json.error, /refusé cette clé/);
  assert.equal((await me("PUT", "/openrouter", { key: GOOD })).status, 200);
  const base = `http://127.0.0.1:${PORT}/ds`;
  const dsEmpty = await me("POST", "/api-providers", { name: "DeepSeek", baseUrl: base, key: DS_EMPTY, preset: "deepseek", models: [{ id: "deepseek-flash" }] });
  assert.equal(dsEmpty.status, 400, dsEmpty.text);
  assert.match(dsEmpty.json.error, /n'a plus de crédit/);
  const ds = await me("POST", "/api-providers", { name: "DeepSeek", baseUrl: base, key: DS_GOOD, preset: "deepseek", models: [{ id: "deepseek-flash" }] });
  assert.equal(ds.status, 200, ds.text);
  // An extra key with no credit on the same provider: refused too.
  const extra = await me("POST", `/api-providers/${ds.json.provider.id}/keys`, { name: "Vide", key: DS_EMPTY });
  assert.equal(extra.status, 400);
  // Changing the key of a saved provider is checked as well.
  assert.equal((await me("PATCH", `/api-providers/${ds.json.provider.id}`, { key: DS_EMPTY })).status, 400);
  // A provider with no documented free check is kept without any call to it.
  hits.length = 0;
  const generic = await me("POST", "/api-providers", { name: "Autre", baseUrl: `http://127.0.0.1:${PORT}/other/v1`, key: "sk-fake-other", models: [{ id: "m1" }] });
  assert.equal(generic.status, 200, generic.text);
  assert.deepEqual(hits, [], "no call made to an unknown provider");
});

test("the credit check keeps a key when the answer is unclear (network, unexpected answer)", async () => {
  assert.equal(creditKindOf("https://api.deepseek.com"), "deepseek");
  assert.equal(creditKindOf(`http://127.0.0.1:${PORT}/api/v1`), "openrouter");
  assert.equal(creditKindOf("https://api.example.com/v1"), "other");
  const v = await checkKeyCredit("deepseek", `http://127.0.0.1:${PORT}/missing`, DS_GOOD);
  assert.deepEqual(v, { ok: true, remainingUsd: null, known: false });
  const dead = await checkKeyCredit("deepseek", "http://127.0.0.1:9", DS_GOOD);
  assert.equal(dead.ok, true);
});

test("OpenRouter low-credit alert: once a day under the threshold, on the main bot, in French; threshold checked", async () => {
  assert.equal((await me("PUT", "/openrouter/credit-alert", { thresholdUsd: 0.2 })).status, 400);
  assert.equal((await me("PUT", "/openrouter/credit-alert", { thresholdUsd: 10 })).json.thresholdUsd, 10);
  const r1 = await checkOpenRouterCredit(userId);
  assert.deepEqual(r1, { leftUsd: 7.5, alerted: true });
  const main = bots.byId(botId)!;
  const notice: any = rows.list(main.id, main.generation).map((r: any) => r.body).find((b: any) => b.kind === "notice" && /crédit OpenRouter baisse/.test(b.text));
  assert.ok(notice, "notice shown");
  assert.match(notice.text, /il reste 7\.50 \$ \(alerte sous 10 \$\)/);
  assert.equal((await checkOpenRouterCredit(userId)).alerted, false, "not twice in a day");
  const view = (await me("GET", "/openrouter/credit-alert")).json;
  assert.equal(view.lastLeftUsd, 7.5);
  assert.equal(view.hasOpenRouter, true);
  // Above the threshold: no alert.
  await me("PUT", "/openrouter/credit-alert", { thresholdUsd: 5 });
  assert.equal((await checkOpenRouterCredit(userId)).alerted, false);
  // Off.
  await me("PUT", "/openrouter/credit-alert", { thresholdUsd: 0 });
  goodLeft = 0.1;
  assert.equal((await checkOpenRouterCredit(userId)).alerted, false);
  // The other account has no OpenRouter and sees only its own settings.
  const o = (await other("GET", "/openrouter/credit-alert")).json;
  assert.equal(o.hasOpenRouter, false);
  assert.equal(o.lastLeftUsd, null);
  assert.equal((await other("POST", "/openrouter/credit-alert/check")).json.alerted, false);
});
