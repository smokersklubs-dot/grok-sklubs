import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// The commercial hosted mode (HOSTED_MODE=1, server/src/hosted.ts): plans, sign-up with a plan and the terms, metering
// of the operator's keys and the hard stop at the end of the budget, "bring your own key" never on the operator's keys,
// lent providers, plan limits, statuses moved by the scheduler, suspended = read-only, subscription tools kept to their
// own account, the administration (operators only, every action logged), public pages and the payment webhooks.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-hosted-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "opscript:op-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "OPENAI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];

const { registerProvider, resolveModel, modelAvailable } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { config } = await import("../src/config.js");
const hosted = await import("../src/hosted.js");
const { ownerPrices } = await import("../src/usage.js");
const { routines } = await import("../src/routines.js");
const { fireRoutine } = await import("../src/scheduler.js");
const { storeBytes } = await import("../src/computer.js");
const { reserve, idemKeyOf } = await import("../src/thirdparty.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";

// The operator's model (a server .env provider): each call reports 1 000 input + 1 000 output tokens.
let opCalls = 0;
registerProvider({
  id: "opscript", label: "Operator", models: ["op-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    opCalls++;
    req.onText?.("operator reply");
    return { content: [{ type: "text", text: "operator reply" }], stopReason: "end", model: "op-1", usage: { inputTokens: 1000, outputTokens: 1000, cachedTokens: 0 } };
  },
});
// A model that first searches the conversation, then answers: the budget runs out between its two calls.
let stepCalls = 0;
registerProvider({
  id: "stepper", label: "Stepper", models: ["step-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    stepCalls++;
    const last = req.messages[req.messages.length - 1];
    const answered = last?.content.some((b) => b.type === "tool_result");
    return answered
      ? { content: [{ type: "text", text: "done" }], stopReason: "end", model: "step-1", usage: { inputTokens: 1000, outputTokens: 1000, cachedTokens: 0 } }
      : { content: [{ type: "tool_use", id: "c1", name: "conversation_search", input: { query: "hello" } }], stopReason: "tool_use", model: "step-1", usage: { inputTokens: 1000, outputTokens: 1000, cachedTokens: 0 } };
  },
});
ownerPrices.set("step-1", { input: 1200, output: 1200, cached: 1200 }, "test");
// 1 000 $ per million tokens → 2 $ per call (1.84 € at the default rate): one call spends the free plan's 2 € almost whole.
ownerPrices.set("op-1", { input: 1000, output: 1000, cached: 1000 }, "test");

// A fake OpenAI-compatible API (a customer's own key, or the operator's provider lent to hosted accounts).
const KEY = "sk-own-key-0123456789abcdefghijklmnop";
const OPKEY = "sk-operator-lent-0123456789abcdefghij";
const seen: { auth: string; path: string }[] = [];
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    seen.push({ auth: String(req.headers.authorization ?? ""), path: req.url ?? "" });
    if (req.headers.authorization !== `Bearer ${KEY}` && req.headers.authorization !== `Bearer ${OPKEY}`) { res.writeHead(401).end("{}"); return; }
    if (req.method === "GET" && req.url === "/models") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ data: [{ id: "own-1" }] })); return; }
    if (req.method === "POST" && req.url === "/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ choices: [{ index: 0, delta: { content: "own reply" } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ choices: [], usage: { prompt_tokens: 100, completion_tokens: 100 } });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const BASE = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
after(() => { fake.close(); });

const ORIGIN = process.env.PUBLIC_URL!;
function client() {
  let cookie = "";
  const fn = async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  return fn;
}
const owner = client(), free = client(), trial = client(), byok = client(), other = client();
const ids: Record<string, string> = {};
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (who: ReturnType<typeof client>, botId: string): Promise<Row[]> => (await who("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const idle = (who: ReturnType<typeof client>, botId: string) => until(async () => !(await who("GET", "/bots")).json.live[botId]?.running, "idle");
const mainBot = async (who: ReturnType<typeof client>) => (await who("GET", "/bots")).json.bots.find((b: any) => b.primary).id as string;
/** Sends a message and waits for the turn to end; returns the rows written after it. */
async function say(who: ReturnType<typeof client>, botId: string, text: string): Promise<Row[]> {
  const before = (await rowsOf(who, botId)).length;
  const r = await who("POST", `/bots/${botId}/messages`, { text });
  assert.equal(r.status, 200, r.text);
  await new Promise((res) => setTimeout(res, 50));
  await idle(who, botId);
  await until(async () => (await rowsOf(who, botId)).length > before + 1, "a reply or a notice");
  return (await rowsOf(who, botId)).slice(before);
}
const planNotice = (rows: Row[]) => rows.map((r) => r.body).find((b: any) => b.kind === "notice" && b.action?.kind === "plan") as any;

test("sign-up: the owner needs no plan; customers must accept the terms and start on a plan (free = active, paid = trial)", async () => {
  const o = await owner("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "fr" });
  assert.equal(o.status, 200);
  ids.owner = o.json.user.id;
  assert.equal(hosted.isOperator(ids.owner), true);
  assert.equal((await owner("GET", "/billing")).json.operator, true);
  assert.equal(hosted.subscriptions.get(ids.owner), null, "the operator has no subscription");
  // /me says hosted mode is on (and that the owner is an operator).
  assert.deepEqual((await owner("GET", "/me")).json.hosted.operator, true);

  const noTerms = await free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "free", locale: "fr" });
  assert.equal(noTerms.status, 400);
  assert.equal(noTerms.json.code, "terms");
  assert.match(noTerms.json.error, /CGU/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE email = 'free@example.com'")!.n, 0, "nothing was created");
  assert.equal((await free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "nope", acceptTerms: true })).status, 400);
  const f = await free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "free", acceptTerms: true, locale: "fr" });
  assert.equal(f.status, 200);
  ids.free = f.json.user.id;
  assert.equal(hosted.subscriptions.get(ids.free)!.status, "active");
  assert.equal(hosted.subscriptions.get(ids.free)!.planId, "free");

  const t = await trial("POST", "/auth/signup", { email: "trial@example.com", password: "password123", plan: "included", acceptTerms: true });
  ids.trial = t.json.user.id;
  const sub = hosted.subscriptions.get(ids.trial)!;
  assert.equal(sub.status, "trial");
  assert.ok(Math.abs(sub.trialEndsAt! - (Date.now() + 14 * 86_400_000)) < 60_000, "14 days of trial by default");
  // Audit: the plan and the accepted terms are recorded.
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE '%terms of service accepted%'", ids.trial));
  assert.ok(q.get("SELECT 1 FROM admin_audit WHERE target_id = ? AND action = 'signup'", ids.trial));
  // The public plan list for the sign-up form.
  const plans = (await other("GET", "/plans")).json;
  assert.deepEqual(plans.plans.map((p: any) => p.id), ["free", "included", "byok"]);
  assert.equal(plans.trialDays, 14);
});

test("a plan invitation: opens closed sign-ups, fixes the plan, is bound to its address and works once", async () => {
  const made = await owner("POST", "/admin/invites", { planId: "byok", email: "byok@example.com", days: 7 });
  assert.equal(made.status, 200, made.text);
  const token = new URL(made.json.invite.link).searchParams.get("plan_invite")!;
  assert.ok(!q.get("SELECT 1 FROM plan_invites WHERE token_hash = ?", token), "only a hash of the token is kept");
  assert.equal((await other("GET", `/plan-invites/${token}`)).json.invite.plan.id, "byok");
  (config as any).openSignup = false;
  try {
    assert.equal((await other("POST", "/auth/signup", { email: "stranger@example.com", password: "password123", acceptTerms: true })).status, 403, "closed");
    assert.equal((await other("POST", "/auth/signup", { email: "stranger@example.com", password: "password123", acceptTerms: true, planInvite: token })).status, 403, "another address");
    const k = await byok("POST", "/auth/signup", { email: "byok@example.com", password: "password123", acceptTerms: true, planInvite: token, plan: "included" });
    assert.equal(k.status, 200, k.text);
    ids.byok = k.json.user.id;
    assert.equal(hosted.subscriptions.get(ids.byok)!.planId, "byok", "the invitation's plan wins over the form");
    assert.equal((await other("GET", `/plan-invites/${token}`)).status, 404, "used up");
  } finally { (config as any).openSignup = true; }
});

test("metering: the operator's keys count against the plan's budget in €, and the turn stops with a way forward when it is spent", async () => {
  ids.freeBot = await mainBot(free);
  const first = await say(free, ids.freeBot, "bonjour");
  assert.ok(first.some((r: any) => r.body.kind === "message" && r.body.role === "assistant" && /operator reply/.test(r.body.text)));
  const line = q.get<{ payer: string; cost_usd: number }>("SELECT payer, cost_usd FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 1", ids.free)!;
  assert.equal(line.payer, "operator");
  assert.ok(Math.abs(line.cost_usd - 2) < 1e-9);
  const view = (await free("GET", "/billing")).json;
  assert.equal(view.plan.id, "free");
  assert.ok(Math.abs(view.spentEur - 1.84) < 0.01, `spent ${view.spentEur} €`);
  assert.equal(view.budgetEur, 2);
  // Second call: 1.84 € of 2 € — still allowed (the stop is at the budget's end), and it goes over.
  await say(free, ids.freeBot, "encore");
  const calls = opCalls;
  const stopped = await say(free, ids.freeBot, "et encore");
  assert.equal(opCalls, calls, "no call on the operator's keys once the budget is spent");
  const notice = planNotice(stopped);
  assert.ok(notice, "a notice with the way forward");
  assert.equal(notice.action.reason, "budget");
  assert.ok(notice.action.resetAt > Date.now(), "the date it starts again");
  assert.match(notice.text, /budget IA du mois/);
  // The wrapper stops any other work on the operator's keys too (memory, nudges, side requests…).
  await assert.rejects(resolveModel("opscript:op-1", ids.free).provider.runTurn({ model: "op-1", system: "", messages: [], tools: [], effort: "low" }), (e: Error) => e.name === "HostedStopError");
  // A top-up by the operator: the budget grows for this month and the bot answers again.
  const top = await owner("POST", `/admin/customers/${ids.free}/credit`, { amountEur: 20, note: "geste" });
  assert.equal(top.status, 200, top.text);
  assert.equal((await free("GET", "/billing")).json.budgetEur, 22);
  const again = await say(free, ids.freeBot, "merci");
  assert.ok(again.some((r: any) => r.body.kind === "message" && r.body.role === "assistant"));
  assert.ok(q.get("SELECT 1 FROM admin_audit WHERE target_id = ? AND action = 'credit'", ids.free));
});

test("bring your own key: never the operator's keys — a card without a key, the customer's own provider with one", async () => {
  const models = (await byok("GET", "/models")).json.models;
  assert.ok(!models.some((m: any) => m.ref.startsWith("opscript:")), "the server's models are not offered");
  assert.equal(modelAvailable("opscript:op-1", ids.byok), false);
  ids.byokBot = await mainBot(byok);
  const calls = opCalls;
  const stopped = await say(byok, ids.byokBot, "hello");
  assert.equal(opCalls, calls);
  assert.equal(planNotice(stopped)?.action.reason, "byok");
  // Their own key: the turn runs on it, the usage line says "own", and nothing counts against a budget.
  const p = await byok("POST", "/api-providers", { name: "Mine", baseUrl: BASE, key: KEY, models: [{ id: "own-1", input: 1, output: 1 }] });
  assert.equal(p.status, 200, p.text);
  const before = seen.length;
  const ran = await say(byok, ids.byokBot, "hello again");
  assert.ok(ran.some((r: any) => r.body.kind === "message" && r.body.role === "assistant" && /own reply/.test(r.body.text)), JSON.stringify(ran.map((r) => r.body)));
  assert.ok(seen.slice(before).some((s) => s.auth === `Bearer ${KEY}`));
  assert.equal(opCalls, calls, "still no call on the operator's keys");
  assert.equal(q.get<{ payer: string }>("SELECT payer FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 1", ids.byok)!.payer, "own");
  assert.equal((await byok("GET", "/billing")).json.spentEur, 0);
  // Even asked by name, the server's model resolves to the customer's own provider, never to the operator's.
  assert.ok(resolveModel("opscript:op-1", ids.byok).provider.id.startsWith("up-"));
  // Paid third-party tools on the server's keys are refused too.
  const r = reserve({ userId: ids.byok, botId: ids.byokBot, tool: "video", provider: "x", maxUsd: 1, idemKey: idemKeyOf(ids.byokBot, "video", "x", {}) });
  assert.equal(r.kind, "refused");
  assert.equal(hosted.operatorBlock(ids.byok), "byok");
});

test("the hard stop also ends a turn in the middle: the next model call after the budget is spent does not happen", async () => {
  const mid = client();
  assert.equal((await mid("POST", "/auth/signup", { email: "mid@example.com", password: "password123", plan: "free", acceptTerms: true })).status, 200);
  const bot = await mainBot(mid);
  q.run("UPDATE bots SET model = 'stepper:step-1' WHERE id = ?", bot);
  const rows = await say(mid, bot, "search then answer");
  assert.equal(stepCalls, 1, "the second call (2.40 $ already spent of a 2 € budget) was not made");
  assert.ok(rows.some((r: any) => r.body.kind === "step" && r.body.tool === "conversation_search"), "the first step ran");
  assert.equal(planNotice(rows)?.action.reason, "budget");
  assert.ok(!rows.some((r: any) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text === "done"));
});

test("an operator's provider lent to hosted accounts: usable by operator-key plans, its key never shown, paid by the operator", async () => {
  const p = await owner("POST", "/api-providers", { name: "DeepSeek du service", baseUrl: BASE, key: OPKEY, models: [{ id: "own-1", input: 1, output: 1 }] });
  ids.lent = p.json.provider.id;
  assert.ok(!(await free("GET", "/models")).json.models.some((m: any) => m.ref.startsWith(ids.lent)), "not lent yet");
  assert.equal((await free("PUT", `/admin/providers/${ids.lent}/lend`, { on: true })).status, 404, "customers cannot");
  assert.equal((await owner("PUT", `/admin/providers/${ids.lent}/lend`, { on: true })).status, 200);
  const fm = await free("GET", "/models");
  assert.ok(fm.json.models.some((m: any) => m.ref === `${ids.lent}:own-1` && m.provider === "DeepSeek du service"));
  assert.ok(!fm.text.includes(OPKEY) && !fm.text.includes(BASE), "neither its key nor its address");
  assert.ok(!(await byok("GET", "/models")).json.models.some((m: any) => m.ref.startsWith(ids.lent)), "never for bring-your-own-key");
  assert.equal((await free("GET", "/api-providers")).json.providers.length, 0, "not in the customer's own list");
  q.run("UPDATE bots SET model = ? WHERE id = ?", `${ids.lent}:own-1`, ids.freeBot);
  const before = seen.length;
  await say(free, ids.freeBot, "avec le fournisseur prêté");
  assert.ok(seen.slice(before).some((s) => s.auth === `Bearer ${OPKEY}`));
  assert.equal(q.get<{ payer: string }>("SELECT payer FROM usage WHERE user_id = ? ORDER BY id DESC LIMIT 1", ids.free)!.payer, "operator");
  q.run("UPDATE bots SET model = '' WHERE id = ?", ids.freeBot);
});

test("plan limits: bots, routines, storage and computers awake, refused server-side with a clear way forward", async () => {
  // Free plan: 2 bots (the main one + 1).
  assert.equal((await free("POST", "/bots", { name: "Deux" })).status, 200);
  const third = await free("POST", "/bots", { name: "Trois" });
  assert.equal(third.status, 403);
  assert.equal(third.json.code, "plan_limit");
  assert.equal(third.json.limit, "bots");
  assert.match(third.json.error, /Ton offre permet 2 bots/);
  // Routines: 3 active.
  for (let i = 0; i < 3; i++) routines.create(ids.freeBot, { name: `r${i}`, prompt: "x", trigger: "webhook" });
  assert.throws(() => routines.create(ids.freeBot, { name: "r4", prompt: "x", trigger: "webhook" }), (e: Error) => e.name === "PlanLimitError");
  const r0 = routines.forBot(ids.freeBot)[0];
  routines.update(r0.id, { enabled: false });
  routines.create(ids.freeBot, { name: "r4", prompt: "x", trigger: "webhook" });
  assert.throws(() => routines.update(r0.id, { enabled: true }), (e: Error) => e.name === "PlanLimitError", "turning one back on counts too");
  // Storage: the operator shrinks the free plan to 1 kB.
  assert.equal((await owner("PUT", "/admin/plans/free", { storageGb: 0.000001 })).status, 200);
  assert.throws(() => storeBytes(ids.freeBot, "", "big.bin", Buffer.alloc(5000)), (e: Error) => e.name === "PlanLimitError" && /storage/.test(e.message));
  assert.equal((await owner("PUT", "/admin/plans/free", { storageGb: 1 })).status, 200);
  storeBytes(ids.freeBot, "", "small.bin", Buffer.alloc(100));
  // Computers awake: 1 on the free plan (linux.ts makes room within it, then refuses with this error).
  const lim = hosted.awakeLimitFor(ids.free)!;
  assert.equal(lim.max, 1);
  assert.equal(lim.error().kind, "computers");
  assert.equal(hosted.awakeLimitFor(ids.owner), null, "no limit for an operator");
  // Operators have no limit at all.
  for (let i = 0; i < 4; i++) assert.equal((await owner("POST", "/bots", { name: `Owner ${i}` })).status, 200);
});

test("statuses: the scheduler moves trial → past_due → suspended by date, with lines in both logs", () => {
  const T = Date.now();
  const D = 86_400_000;
  const cases: [Parameters<typeof hosted.nextState>[0], "free" | "included", number, string | null][] = [
    [{ status: "trial", trialEndsAt: T + D, periodEnd: null, graceEndsAt: null }, "included", T, null],
    [{ status: "trial", trialEndsAt: T - 1, periodEnd: null, graceEndsAt: null }, "included", T, "past_due"],
    [{ status: "trial", trialEndsAt: T - 1, periodEnd: T + 30 * D, graceEndsAt: null }, "included", T, "active"],
    [{ status: "active", trialEndsAt: null, periodEnd: null, graceEndsAt: null }, "included", T, null],
    [{ status: "active", trialEndsAt: null, periodEnd: T - 1, graceEndsAt: null }, "included", T, "past_due"],
    [{ status: "past_due", trialEndsAt: null, periodEnd: T - D, graceEndsAt: T + D }, "included", T, null],
    [{ status: "past_due", trialEndsAt: null, periodEnd: T - D, graceEndsAt: T - 1 }, "included", T, "suspended"],
    [{ status: "past_due", trialEndsAt: null, periodEnd: T + D, graceEndsAt: T - 1 }, "included", T, "active"],
    [{ status: "suspended", trialEndsAt: null, periodEnd: null, graceEndsAt: T - D }, "included", T, null],
    [{ status: "trial", trialEndsAt: T - 1, periodEnd: null, graceEndsAt: null }, "free", T, "active"],
  ];
  for (const [sub, kind, t, want] of cases) assert.equal(hosted.nextState(sub, { kind }, t, 7)?.status ?? null, want, JSON.stringify({ sub, kind }));
  assert.equal(hosted.nextState({ status: "trial", trialEndsAt: T - 1, periodEnd: null, graceEndsAt: null }, { kind: "included" }, T, 7)!.graceEndsAt, T - 1 + 7 * D);

  q.run("UPDATE subscriptions SET trial_ends_at = ? WHERE user_id = ?", T - 1000, ids.trial);
  assert.ok(hosted.hostedTick() >= 1);
  const pd = hosted.subscriptions.get(ids.trial)!;
  assert.equal(pd.status, "past_due");
  assert.ok(pd.graceEndsAt! > T + 6 * D);
  q.run("UPDATE subscriptions SET grace_ends_at = ? WHERE user_id = ?", T - 1000, ids.trial);
  hosted.hostedTick();
  assert.equal(hosted.subscriptions.get(ids.trial)!.status, "suspended");
  const lines = q.all<{ actor_label: string; detail: string }>("SELECT actor_label, detail FROM admin_audit WHERE target_id = ? AND action = 'status' ORDER BY id", ids.trial);
  assert.deepEqual(lines.map((l) => l.detail), ["trial → past_due", "past_due → suspended"]);
  assert.equal(lines[0].actor_label, "scheduler");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text = 'Subscription status: past_due → suspended'", ids.trial));
  assert.throws(() => q.run("UPDATE admin_audit SET detail = 'x'"), /cannot be edited/);
});

test("suspended = read-only: sign in, look, export, change sign-in details, delete; nothing runs, routines skipped", async () => {
  const blocked = await trial("POST", "/bots", { name: "Nope" });
  assert.equal(blocked.status, 403);
  assert.equal(blocked.json.code, "suspended");
  assert.match(blocked.json.error, /read-only/);
  const bot = await mainBot(trial);
  assert.equal((await trial("POST", `/bots/${bot}/messages`, { text: "hi" })).status, 403);
  assert.equal((await trial("GET", "/bots")).status, 200);
  assert.equal((await trial("GET", "/export/data")).status, 200);
  assert.equal((await trial("PUT", "/prefs", { locale: "en" })).status, 200);
  assert.equal((await trial("POST", "/auth/login", { email: "trial@example.com", password: "password123" })).status, 200, "can sign in");
  const view = (await trial("GET", "/billing")).json;
  assert.equal(view.status, "suspended");
  // Its routines are skipped, with a note, and no model call.
  const r = routines.create(bot, { name: "daily", prompt: "x", trigger: "webhook" });
  const calls = opCalls;
  assert.equal(fireRoutine(routines.byId(r.id)!), "busy");
  assert.equal(q.get<{ status: string; note: string }>("SELECT status, note FROM routine_runs WHERE routine_id = ? ORDER BY at DESC LIMIT 1", r.id)!.status, "skipped");
  assert.equal(opCalls, calls);
  // The wrapper refuses any model, even the account's own.
  assert.throws(() => resolveModel("opscript:op-1", ids.trial), (e: any) => e.reason === "suspended");
  // The operator records a payment: active again, until the date given.
  const until = Date.now() + 31 * 86_400_000;
  assert.equal((await owner("POST", `/admin/customers/${ids.trial}/paid`, { until, reference: "virement 42" })).status, 200);
  const sub = hosted.subscriptions.get(ids.trial)!;
  assert.equal(sub.status, "active");
  assert.equal(sub.periodEnd, until);
  assert.equal((await trial("POST", "/bots", { name: "Back" })).status, 200);
  // "Pause" (agent/pause.ts) is separate from the suspension: both can hold a bot, each is lifted in its own place.
  assert.equal((await trial("POST", `/bots/${bot}/pause`)).status, 200);
  q.run("UPDATE subscriptions SET status = 'suspended' WHERE user_id = ?", ids.trial);
  assert.equal((await trial("POST", `/bots/${bot}/resume`)).status, 403, "a suspended account is read-only, pauses included");
  assert.equal(fireRoutine(routines.byId(r.id)!), "busy", "the suspension is checked first");
  q.run("UPDATE subscriptions SET status = 'active' WHERE user_id = ?", ids.trial);
  assert.equal(fireRoutine(routines.byId(r.id)!), "paused", "reactivated, the bot is still paused");
  assert.equal(opCalls, calls);
  const resumed = await trial("POST", `/bots/${bot}/resume`);
  assert.equal(resumed.status, 200);
  assert.equal((await trial("GET", "/bots")).json.bots.find((b: any) => b.id === bot).pause, null);
});

test("subscription tools: only for their own account — never started by a workspace member of another account", async () => {
  const ob = (await owner("POST", "/bots", { name: "Sub bot" })).json.bot.id;
  q.run("UPDATE bots SET model = 'claude-code:sonnet' WHERE id = ?", ob);
  const ws = (await owner("POST", "/workspaces", { name: "Studio" })).json.workspace.id;
  const inv = (await owner("POST", `/workspaces/${ws}/invites`, { email: "free@example.com", role: "member" })).json.invite;
  assert.equal((await free("POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") })).status, 200);
  assert.equal((await owner("PUT", `/bots/${ob}/share`, { workspaceId: ws, access: "all" })).status, 200);
  const before = (await rowsOf(owner, ob)).length;
  assert.equal((await free("POST", `/bots/${ob}/messages`, { text: "use your subscription" })).status, 200);
  const rows = await until(async () => { const all = await rowsOf(owner, ob); return planNotice(all.slice(before)) ? all.slice(before) : null; }, "the engines notice");
  assert.equal(planNotice(rows).action.reason, "engines");
  assert.equal(hosted.engineBlock(ids.owner, false), null, "its owner may");
  // The operator can also keep customers off subscription tools entirely.
  assert.equal((await owner("PUT", "/admin/settings", { subscriptionEngines: false })).status, 200);
  assert.equal(hosted.engineBlock(ids.free, false), "engines");
  assert.equal(hosted.engineBlock(ids.owner, false), null, "never the operator");
  assert.equal(hosted.subscriptionEnginesFor(ids.free), false);
  assert.equal((await owner("PUT", "/admin/settings", { subscriptionEngines: true })).status, 200);
});

test("administration: operators only (404 for anyone else), every action logged, the owner alone names operators", async () => {
  for (const [m, u] of [["GET", "/admin/overview"], ["GET", "/admin/customers"], ["PUT", `/admin/customers/${ids.free}/plan`], ["POST", "/admin/plans"], ["PUT", "/admin/settings"]] as const)
    assert.equal((await free(m, u, {})).status, 404, `${m} ${u}`);
  const ov = (await owner("GET", "/admin/overview")).json;
  const row = ov.customers.find((c: any) => c.id === ids.free);
  assert.equal(row.planId, "free");
  assert.ok(row.spentEur > 3 && row.budgetEur === 22);
  assert.ok(row.bots >= 2 && row.lastActivity > 0);
  assert.equal(ov.customers.find((c: any) => c.id === ids.owner).operator, true);
  // Plans: edit, create, refuse a bad one.
  assert.equal((await owner("PUT", "/admin/plans/included", { priceEur: 49, aiBudgetEur: 25 })).json.plan.priceEur, 49);
  assert.equal((await owner("POST", "/admin/plans", { id: "pro", kind: "included", nameFr: "Pro", nameEn: "Pro", priceEur: 99, aiBudgetEur: 60, maxBots: 50 })).status, 200);
  assert.equal((await owner("POST", "/admin/plans", { id: "Bad Id", kind: "included", nameFr: "x", nameEn: "x" })).status, 400);
  assert.equal((await owner("POST", "/admin/plans", { id: "weird", kind: "gold", nameFr: "x", nameEn: "x" })).status, 400);
  // Customer actions.
  assert.equal((await owner("PUT", `/admin/customers/${ids.free}/plan`, { planId: "pro" })).status, 200);
  assert.equal(hosted.subscriptions.get(ids.free)!.planId, "pro");
  assert.equal(hosted.subscriptions.get(ids.free)!.status, "trial", "from the free plan to a paid one: its trial starts");
  const ends = hosted.subscriptions.get(ids.free)!.trialEndsAt!;
  assert.equal((await owner("POST", `/admin/customers/${ids.free}/trial`, { days: 10 })).status, 200);
  assert.ok(Math.abs(hosted.subscriptions.get(ids.free)!.trialEndsAt! - (ends + 10 * 86_400_000)) < 5000);
  assert.equal((await owner("PUT", `/admin/customers/${ids.free}/status`, { status: "bogus" })).status, 400);
  assert.equal((await owner("PUT", `/admin/customers/${ids.owner}/plan`, { planId: "free" })).status, 409, "an operator has no plan");
  assert.equal((await owner("PUT", `/admin/customers/nobody/plan`, { planId: "free" })).status, 404);
  const actions = q.all<{ action: string }>("SELECT action FROM admin_audit WHERE target_id = ?", ids.free).map((r) => r.action);
  for (const a of ["signup", "credit", "plan", "trial"]) assert.ok(actions.includes(a), a);
  assert.ok(q.get("SELECT 1 FROM admin_audit WHERE action = 'plan-edit' AND detail LIKE 'included%'"));
  // Operators: the owner makes one; an operator who is not the owner cannot.
  assert.equal((await owner("PUT", `/admin/customers/${ids.byok}/operator`, { on: true })).status, 200);
  assert.equal((await byok("GET", "/admin/overview")).status, 200);
  assert.equal((await byok("PUT", `/admin/customers/${ids.free}/operator`, { on: true })).status, 403);
  assert.equal((await owner("PUT", `/admin/customers/${ids.byok}/operator`, { on: false })).status, 200);
  assert.equal((await byok("GET", "/admin/overview")).status, 404);
  // Settings: a contact address must be https or mailto.
  assert.equal((await owner("PUT", "/admin/settings", { contactUrl: "javascript:alert(1)" })).status, 400);
  assert.equal((await owner("PUT", "/admin/settings", { contactUrl: "mailto:ventes@example.com", usdToEur: 0.9, legal: { company: "Exemple SAS" } })).status, 200);
  assert.equal(hosted.hostedSettings.get().usdToEur, 0.9);
});

test("public pages: prices from the plans, legal templates marked as drafts, strict CSP; payment webhooks 501", async () => {
  const tarifs = await site.request("/tarifs");
  assert.equal(tarifs.status, 200);
  const html = await tarifs.text();
  assert.match(html, /Tout inclus/);
  assert.match(html, /49 €/);
  assert.match(html, /Pro/);
  assert.match(tarifs.headers.get("content-security-policy") ?? "", /default-src 'none'/);
  assert.ok(!/<script/i.test(html));
  assert.match(await (await site.request("/pricing")).text(), /All included/);
  const cgu = await (await site.request("/cgu")).text();
  assert.match(cgu, /Brouillon — à faire valider par un professionnel/);
  assert.match(cgu, /\[À COMPLÉTER\]/);
  assert.match(cgu, /quatorze \(14\) jours/);
  assert.match(cgu, /article 50/);
  assert.match(cgu, /\/confidentialite/);
  assert.match(cgu, /médiateur/);
  const ml = await (await site.request("/mentions-legales")).text();
  assert.match(ml, /Exemple SAS/);
  assert.match(ml, /Brouillon/);
  assert.match(await (await site.request("/terms")).text(), /Draft — to be checked by a professional/);
  assert.match(await (await site.request("/legal-notice")).text(), /Exemple SAS/);
  const hook = await other("POST", "/billing/webhook/stripe", { id: "evt_1" });
  assert.equal(hook.status, 501);
  assert.equal(hook.json.code, "not_implemented");
  assert.equal((await other("POST", "/billing/webhook/paddle", {})).status, 501);
  assert.equal((await other("POST", "/billing/webhook/manual", {})).status, 404);
  assert.equal((await other("POST", "/billing/webhook/acme", {})).status, 404);
});

test("the operator's deep health check counts customer accounts by status (hosted mode only)", async () => {
  const deep = await owner("GET", "/health/deep");
  assert.equal(deep.status, 200);
  assert.equal(deep.json.checks.hosted.state, "ok");
  assert.ok(deep.json.checks.hosted.detail.accounts.active >= 1);
  assert.equal((await free("GET", "/health/deep")).status, 404);
});

test("account deletion still works for a customer, and takes its subscription with it", async () => {
  assert.equal((await other("POST", "/auth/signup", { email: "gone@example.com", password: "password123", acceptTerms: true })).status, 200);
  const id = q.get<{ id: string }>("SELECT id FROM users WHERE email = 'gone@example.com'")!.id;
  assert.ok(hosted.subscriptions.get(id));
  q.run("UPDATE subscriptions SET status = 'suspended' WHERE user_id = ?", id);
  assert.equal((await other("DELETE", "/account", { password: "password123" })).status, 200);
  assert.equal(hosted.subscriptions.get(id), null);
});
