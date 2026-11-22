import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// nod points 3 et 4, L59, L60 : santé du modèle (au choix, au démarrage, à l'accueil), « à reconnecter » sur un 401,
// « en attente du modèle » après un silence, « nouvel essai n/N » pendant les essais. Modèles scénarisés.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-health-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "good:good-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;

const { registerProvider, ProviderError } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { callHooks } = await import("../src/llm/timeouts.js");
const { checkAtStartup, resetModelHealth, cachedHealth } = await import("../src/modelhealth.js");
const { subscribe } = await import("../src/bus.js");
const { setFailureTiming, resetFailureState } = await import("../src/agent/failures.js");
const { q } = await import("../src/db.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot } from "../src/shared.js";

setFailureTiming({ retryBaseMs: 30, retryMaxMs: 60, breakerOpenMs: 60_000 });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const said = (text: string): TurnResult => ({ content: [{ type: "text", text }], stopReason: "end", model: "x", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } });
let goodCalls = 0;
let flaky = 0;
const good: LlmProvider = {
  id: "good", label: "Bon", models: ["good-1"], available: () => true,
  async runTurn(req: TurnRequest) {
    goodCalls++;
    const last = req.messages.at(-1)!.content.find((b) => b.type === "text") as { text: string } | undefined;
    const words = (last?.text ?? "").replace(/^(\[[^\]]*\]\n)+/, "");
    if (/lent/.test(words)) await sleep(250);
    if (/instable/.test(words) && flaky++ < 2) throw new ProviderError("overloaded", { status: 529, transient: true });
    req.onText?.("OK");
    return said("OK");
  },
};
const bad: LlmProvider = {
  id: "bad", label: "Mauvais", models: ["bad-1"], available: () => true,
  async runTurn() { throw new ProviderError("Bad rejected the credentials.", { status: 401, transient: false }); },
};
const broke: LlmProvider = {
  id: "broke", label: "Fauché", models: ["broke-1"], available: () => true,
  async runTurn() { throw new ProviderError("Insufficient credit", { status: 402, transient: false, code: "out_of_credit" }); },
};
registerProvider(broke); registerProvider(bad); registerProvider(good);

const jars: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const fresh = async (name: string, model?: string, who = "a"): Promise<Bot> => {
  const bot = (await call("POST", "/bots", { name }, who)).json.bot as Bot;
  if (model) q.run("UPDATE bots SET model = ? WHERE id = ?", model, bot.id);
  return bot;
};
const userId = (email: string) => q.get<{ id: string }>("SELECT id FROM users WHERE email = ?", email)!.id;

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "health@example.com", password: "password-1", locale: "fr" });
  await call("POST", "/auth/signup", { email: "other@example.com", password: "password-2", locale: "en" }, "b");
});

test("nod 4: a working model reads ok, with the time it took; the result is kept a few minutes", async () => {
  const bot = await fresh("Sain", "good:good-1");
  const before = goodCalls;
  const r = await call("GET", `/bots/${bot.id}/model-health`);
  assert.equal(r.status, 200);
  assert.equal(r.json.health.status, "ok");
  assert.equal(typeof r.json.health.ms, "number");
  assert.equal(goodCalls, before + 1, "one tiny real request");
  await call("GET", `/bots/${bot.id}/model-health`);
  assert.equal(goodCalls, before + 1, "the second look uses the kept result");
  await call("GET", `/bots/${bot.id}/model-health?fresh=1`);
  assert.equal(goodCalls, before + 2, "fresh=1 (a model just chosen) checks again");
});

test("nod 4: a refused key (401) reads « à reconnecter », in plain French, with the page that fixes it", async () => {
  const bot = await fresh("Clef", "bad:bad-1");
  const h = (await call("GET", `/bots/${bot.id}/model-health`)).json.health;
  assert.equal(h.status, "reconnect");
  assert.equal(h.fix, "models");
  assert.match(h.reason, /reconnecter/);
  const credit = (await call("POST", "/models/check", { ref: "broke:broke-1" })).json.health;
  assert.equal(credit.status, "no_credit");
  assert.match(credit.reason, /crédit/);
  // English for an English account; another account never sees this bot.
  const theirs = await fresh("Theirs", "bad:bad-1", "b");
  assert.match((await call("GET", `/bots/${theirs.id}/model-health`, undefined, "b")).json.health.reason, /reconnecting/);
  assert.equal((await call("GET", `/bots/${bot.id}/model-health`, undefined, "b")).status, 404);
  assert.equal((await call("POST", "/models/check", { botId: bot.id }, "b")).status, 404);
});

test("nod 4: a 401 met during a real turn marks the model « à reconnecter » at once", async () => {
  resetModelHealth();
  const bot = await fresh("Tour", "bad:bad-1");
  await call("POST", `/bots/${bot.id}/messages`, { text: "bonjour" });
  await until(() => !loop.isBusy(bot.id), "idle");
  assert.equal(cachedHealth(userId("health@example.com"), "bad:bad-1")?.status, "reconnect");
});

test("nod 4: at start-up each distinct model in use is checked once per account", async () => {
  resetModelHealth();
  const n = await checkAtStartup(20, 0);
  assert.ok(n >= 3, `checked ${n}`);
  assert.equal(cachedHealth(userId("health@example.com"), "good:good-1")?.status, "ok");
  assert.equal(cachedHealth(userId("other@example.com"), "bad:bad-1")?.status, "reconnect");
});

test("nod 3: « en attente du modèle » after a silence, taken back when the model speaks", async () => {
  const bot = await fresh("Patient", "good:good-1");
  const captions: (string | null | undefined)[] = [];
  const stop = subscribe(userId("health@example.com"), (e) => { if (e.type === "live" && e.botId === bot.id) captions.push(e.live.caption); });
  const old = callHooks.slowMs;
  callHooks.slowMs = 60;
  try {
    await call("POST", `/bots/${bot.id}/messages`, { text: "réponds lent" });
    await until(() => !loop.isBusy(bot.id), "idle");
  } finally { callHooks.slowMs = old; stop(); }
  const i = captions.findIndex((c) => /En attente du modèle \(Bon good-1\)/.test(c ?? ""));
  assert.ok(i >= 0, `captions: ${JSON.stringify(captions)}`);
  assert.ok(captions.slice(i + 1).some((c) => !c || !/En attente/.test(c)), "taken back afterwards");
  assert.equal(old, 60_000, "60 s by default");
});

test("nod 3: « nouvel essai n/N » next to the indicator while the model is retried", async () => {
  const bot = await fresh("Essais", "good:good-1");
  const captions: string[] = [];
  const stop = subscribe(userId("health@example.com"), (e) => { if (e.type === "live" && e.botId === bot.id && e.live.caption) captions.push(e.live.caption); });
  try {
    await call("POST", `/bots/${bot.id}/messages`, { text: "instable" });
    await until(() => !loop.isBusy(bot.id), "idle");
  } finally { stop(); resetFailureState(); }
  assert.ok(captions.some((c) => /Nouvel essai 1\/\d+/.test(c)), JSON.stringify(captions));
  assert.ok(captions.some((c) => /Nouvel essai 2\/\d+/.test(c)), JSON.stringify(captions));
});
