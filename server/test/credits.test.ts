import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Prepaid AI credits (credits.ts, billing/paddle.ts, hosted.ts "Prepaid credits"): a free account (0 € budget of its own)
// runs on the service's keys only with credits, stops with the "no credits left" card, credits carry over the month;
// a Paddle transaction with a fake Paddle (request checked: URL, headers, body, custom data, server amount), signed fake
// webhooks (bad signature refused, replays and duplicates ignored, credited once, only transactions this server made, the
// amount and currency it set, the account in its custom data), refunds and chargebacks, the /paiement page, payment off
// without the variables, and isolation between accounts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-credits-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.SIGNUP_PER_IP = "100";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "opcredit:op-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "OPENAI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY", "PADDLE_ENV", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN", "PADDLE_PRODUCT_ID", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const paddle = await import("../src/billing/paddle.js");
const { site } = await import("../src/routes.js");
const { ownerPrices } = await import("../src/usage.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Row } from "../src/shared.js";

let opCalls = 0;
registerProvider({
  id: "opcredit", label: "Operator", models: ["op-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    opCalls++;
    req.onText?.("operator reply");
    return { content: [{ type: "text", text: "operator reply" }], stopReason: "end", model: "op-1", usage: { inputTokens: 1000, outputTokens: 1000, cachedTokens: 0 } };
  },
});
// 2 $ per call = 1.84 € at the default rate.
ownerPrices.set("op-1", { input: 1000, output: 1000, cached: 1000 }, "test");

const ORIGIN = process.env.PUBLIC_URL!;
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie, ...headers }, body: body === undefined || method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const owner = client(), alice = client(), bob = client(), anon = client();
const ids: Record<string, string> = {};
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (who: ReturnType<typeof client>, botId: string): Promise<Row[]> => (await who("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function say(who: ReturnType<typeof client>, botId: string, text: string): Promise<Row[]> {
  const before = (await rowsOf(who, botId)).length;
  assert.equal((await who("POST", `/bots/${botId}/messages`, { text })).status, 200);
  await new Promise((r) => setTimeout(r, 50));
  await until(async () => !(await who("GET", "/bots")).json.live[botId]?.running, "idle");
  await until(async () => (await rowsOf(who, botId)).length > before + 1, "a reply or a notice");
  return (await rowsOf(who, botId)).slice(before);
}
const planNotice = (rows: Row[]) => rows.map((r) => r.body).find((b: any) => b.kind === "notice" && b.action?.kind === "plan") as any;

test("setup: everyone signs up on the free plan (0 € budget of its own)", async () => {
  assert.equal((await owner("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "fr" })).status, 200);
  const a = await alice("POST", "/auth/signup", { email: "alice@example.com", password: "password123", locale: "fr", acceptTerms: true });
  assert.equal(a.status, 200, a.text);
  ids.alice = a.json.user.id;
  const b = await bob("POST", "/auth/signup", { email: "bob@example.com", password: "password123", locale: "en", acceptTerms: true });
  ids.bob = b.json.user.id;
  assert.equal(hosted.subscriptions.get(ids.alice)?.planId, "free");
  assert.equal(hosted.plans.get("free")?.aiBudgetEur, 0, "migration 19: the free plan has no budget of its own");
  ids.aliceBot = (await alice("GET", "/bots")).json.bots.find((x: any) => x.primary).id;
  const v = (await alice("GET", "/billing/credits")).json;
  assert.equal(v.balanceEur, 0);
  assert.equal(v.payments, "off");
  assert.deepEqual(v.packs.map((p: any) => p.id), ["pack-500", "pack-1000", "pack-2000"]);
});

test("by default no Sklubot credits are sold: hidden in the view, checkout 404, the card says to connect an own account", async () => {
  assert.equal(hosted.hostedSettings.get().creditsForSale, false);
  assert.equal((await alice("GET", "/billing/credits")).json.creditsForSale, false);
  assert.equal((await alice("GET", "/me")).json.hosted.creditsForSale, false);
  const r = await alice("POST", "/billing/credits/checkout", { pack: "pack-1000" });
  assert.equal(r.status, 404);
  assert.equal(r.json.code, "payments_off");
  const n = planNotice(await say(alice, ids.aliceBot, "salut"));
  assert.equal(n.action.reason, "budget");
  assert.equal(n.action.credits, true);
  assert.equal(n.action.forSale, false);
  assert.match(n.text, /Connecte ton compte OpenRouter, ChatGPT ou Claude/);
  assert.doesNotMatch(n.text, /Achète des crédits/);
  // The owner turns selling on (Administration → Settings): the rest of this file is about selling credits.
  assert.equal((await owner("PUT", "/admin/settings", { creditsForSale: true })).status, 200);
  assert.equal((await alice("GET", "/billing/credits")).json.creditsForSale, true);
});

test("no credits: the service's keys do not run, and the card says to buy credits, connect a subscription or add a key", async () => {
  const before = opCalls;
  const rows = await say(alice, ids.aliceBot, "bonjour");
  assert.equal(opCalls, before, "no call on the operator's keys");
  const n = planNotice(rows);
  assert.equal(n.action.reason, "budget");
  assert.equal(n.action.credits, true);
  assert.equal(n.action.resetAt, undefined, "no 'wait until next month' for credits-only plans");
  assert.match(n.text, /plus de crédits/);
  assert.match(n.text, /abonnement Claude ou ChatGPT/);
});

test("payment off: checkout and webhook answer 503 with a clear message; the operator can still give credits", async () => {
  const r = await alice("POST", "/billing/credits/checkout", { pack: "pack-1000" });
  assert.equal(r.status, 503);
  assert.equal(r.json.code, "payments_off");
  assert.match(r.json.error, /pas encore disponible/);
  assert.equal((await anon("POST", "/billing/paddle/webhook", "{}")).status, 503);
  assert.equal((await anon("POST", "/billing/webhook/paddle", "{}")).status, 501, "the older address keeps saying 'not connected'");
  assert.equal((await anon("POST", "/billing/webhook/stripe", "{}")).status, 501, "Stripe is gone: an old webhook changes nothing");
  assert.notEqual((await site.request("/paiement")).headers.get("content-security-policy")?.includes("cdn.paddle.com"), true, "no pay page without Paddle");
  // Lasting credits by hand (Administration): the bot answers on the service's keys again.
  const g = await owner("POST", `/admin/customers/${ids.alice}/credit`, { amountEur: 3, lasting: true, note: "geste" });
  assert.equal(g.status, 200, g.text);
  assert.equal((await alice("GET", "/billing/credits")).json.balanceEur, 3);
  const before = opCalls;
  const rows = await say(alice, ids.aliceBot, "encore");
  assert.equal(opCalls, before + 1);
  assert.ok(rows.some((x: any) => x.body.kind === "assistant" || x.body.kind === "text" || /operator reply/.test(JSON.stringify(x.body))));
  const v = (await alice("GET", "/billing/credits")).json;
  assert.ok(Math.abs(v.balanceEur - (3 - 1.84)) < 0.02, `balance ${v.balanceEur}`);
  assert.equal(v.history[0].kind, "prepaid");
  // 1.16 € left: one more call goes over, the next is stopped.
  await say(alice, ids.aliceBot, "et encore");
  const after = opCalls;
  const stopped = await say(alice, ids.aliceBot, "stop ?");
  assert.equal(opCalls, after);
  assert.equal(planNotice(stopped)?.action.reason, "budget");
  assert.equal((await alice("GET", "/billing/credits")).json.balanceEur, 0);
});

test("credits carry over: a month that is over takes only what it spent beyond its budget, the rest stays", () => {
  const uid = ids.bob;
  const t0 = Date.UTC(2026, 8, 10); // September 2026
  q.run("INSERT INTO credit_topups (id, user_id, month, amount_eur, note, by_id, at, kind, source) VALUES ('top_carry', ?, '2026-09', 10, '', NULL, ?, 'prepaid', 'manual')", uid, t0);
  // 2.30 € spent in September on the service's keys (2.5 $ at 0.92).
  q.run("INSERT INTO usage (user_id, bot_id, model, input_tokens, output_tokens, cached_tokens, cost_usd, est_cost_usd, at, payer) VALUES (?, '', 'op-1', 0, 0, 0, 2.5, 0, ?, 'operator')", uid, t0 + 3600_000);
  const oct = Date.UTC(2026, 9, 5);
  assert.ok(Math.abs(hosted.prepaidAvailableEur(uid, oct) - 7.7) < 1e-6);
  assert.equal(q.get<{ c: number }>("SELECT consumed_eur AS c FROM credit_months WHERE user_id = ? AND month = '2026-09'", uid)?.c, 2.3);
  // Closed once: asking again changes nothing.
  hosted.prepaidAvailableEur(uid, oct);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM credit_months WHERE user_id = ?", uid)?.n, q.get<{ n: number }>("SELECT COUNT(DISTINCT month) AS n FROM credit_months WHERE user_id = ?", uid)?.n);
});

// ── Paddle ───────────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET = "pdl_ntfset_01testsecretforcredits_abcdefghijklmnop";
const PRODUCT = "pro_01hv0000000000000000000000";
const id26 = (prefix: string, n: number) => `${prefix}_01${String(n).padStart(24, "0")}`;
const created: { url: string; init: RequestInit; body: any }[] = [];
let nextTxn = 0;
let answer: ((body: any) => Response) | null = null;
paddle._setPaddleFetch(async (url, init) => {
  const body = JSON.parse(String(init.body));
  created.push({ url, init, body });
  if (answer) return answer(body);
  const id = id26("txn", ++nextTxn);
  return new Response(JSON.stringify({ data: { id, status: "draft", custom_data: body.custom_data, currency_code: "EUR", checkout: { url: `${body.checkout.url}?_ptxn=${id}` } }, meta: { request_id: "r" } }), { status: 201, headers: { "content-type": "application/json" } });
});
const txnEvent = (eventId: string, txnId: string, o: { total?: string; currency?: string; status?: string; user?: string; pack?: string; type?: string } = {}) => JSON.stringify({
  event_id: eventId, event_type: o.type ?? "transaction.completed", occurred_at: new Date().toISOString(), notification_id: `ntf_${eventId}`,
  data: { id: txnId, status: o.status ?? "completed", currency_code: o.currency ?? "EUR", custom_data: { sklubot_user: o.user ?? ids.bob, sklubot_pack: o.pack ?? "pack-1000" }, details: { totals: { subtotal: "833", tax: "167", total: o.total ?? "1000", currency_code: o.currency ?? "EUR" } } },
});
const adjEvent = (eventId: string, adjId: string, txnId: string, o: { action?: string; status?: string; total?: string; type?: string } = {}) => JSON.stringify({
  event_id: eventId, event_type: o.type ?? "adjustment.updated", occurred_at: new Date().toISOString(), notification_id: `ntf_${eventId}`,
  data: { id: adjId, action: o.action ?? "refund", type: "full", transaction_id: txnId, status: o.status ?? "approved", currency_code: "EUR", totals: { subtotal: "0", tax: "0", total: o.total ?? "1000", fee: "0", earnings: "0", currency_code: "EUR" } },
});
const hook = (raw: string, sig = paddle.signPaddlePayload(raw, SECRET), path = "/billing/paddle/webhook") => anon("POST", path, raw, { "paddle-signature": sig, origin: "" });
const configure = () => {
  process.env.PADDLE_ENV = "sandbox";
  process.env.PADDLE_API_KEY = "pdl_sdbx_apikey_fake-for-tests";
  process.env.PADDLE_WEBHOOK_SECRET = SECRET;
  process.env.PADDLE_CLIENT_TOKEN = "test_7d279f61a3499fed520f7cd8c08";
  process.env.PADDLE_PRODUCT_ID = PRODUCT;
};
const bal = async (who: ReturnType<typeof client>) => (await who("GET", "/billing/credits")).json.balanceEur as number;
const close = (a: number, b: number) => Math.abs(a - b) < 1e-6;
const firstTxn = id26("txn", 1);

test("configuration: every variable is needed, and keys of the other environment are refused", async () => {
  configure();
  assert.deepEqual(paddle.paddleProblems(), []);
  process.env.PADDLE_ENV = "";
  assert.ok(paddle.paddleProblems().includes("PADDLE_ENV"), "the environment is never guessed");
  process.env.PADDLE_ENV = "production";
  assert.deepEqual(paddle.paddleProblems().sort(), ["PADDLE_API_KEY", "PADDLE_CLIENT_TOKEN"], "sandbox key and token with production");
  configure();
  process.env.PADDLE_PRODUCT_ID = "pri_01hv0000000000000000000000";
  assert.deepEqual(paddle.paddleProblems(), ["PADDLE_PRODUCT_ID"]);
  delete process.env.PADDLE_WEBHOOK_SECRET;
  assert.equal((await bob("GET", "/billing/credits")).json.payments, "off");
  const ov = (await owner("GET", "/admin/overview")).json;
  assert.equal(ov.payments, false);
  assert.equal(ov.paymentsInfo.provider, "Paddle");
  assert.deepEqual(ov.paymentsInfo.missing.sort(), ["PADDLE_PRODUCT_ID", "PADDLE_WEBHOOK_SECRET"]);
  assert.ok(!JSON.stringify(ov).includes("pdl_sdbx_apikey"), "no secret in the overview");
  configure();
  const on = (await owner("GET", "/admin/overview")).json;
  assert.deepEqual([on.payments, on.paymentsInfo.env, on.paymentsInfo.missing], [true, "sandbox", []]);
});

test("checkout: only the owner's packs, the amount set by the server, the documented request", async () => {
  configure();
  assert.equal((await bob("GET", "/billing/credits")).json.payments, "paddle");
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-999999", amountEur: 1 })).status, 400, "unknown pack");
  assert.equal((await bob("POST", "/billing/credits/checkout", { amountEur: 1 })).status, 400, "an amount is never accepted");
  const r = await bob("POST", "/billing/credits/checkout", { pack: "pack-1000", amountEur: 0.01, userId: ids.alice });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.url, `https://bots.example.test/paiement?_ptxn=${firstTxn}`);
  const c = created.at(-1)!;
  assert.equal(c.url, "https://sandbox-api.paddle.com/transactions");
  assert.equal(c.init.method, "POST");
  const h = c.init.headers as Record<string, string>;
  assert.equal(h.authorization, `Bearer ${process.env.PADDLE_API_KEY}`);
  assert.equal(h["content-type"], "application/json");
  assert.equal(h["paddle-version"], "1");
  assert.equal(c.body.items.length, 1);
  const item = c.body.items[0];
  assert.equal(item.quantity, 1);
  assert.equal(item.price.product_id, PRODUCT);
  assert.deepEqual(item.price.unit_price, { amount: "1000", currency_code: "EUR" }, "cents as a string, from the server's pack");
  assert.equal(item.price.tax_mode, "internal");
  assert.deepEqual(item.price.quantity, { minimum: 1, maximum: 1 });
  assert.ok(item.price.name && item.price.description.length >= 2);
  assert.equal(c.body.currency_code, "EUR");
  assert.equal(c.body.collection_mode, "automatic");
  assert.deepEqual(c.body.custom_data, { sklubot_user: ids.bob, sklubot_pack: "pack-1000" }, "the caller, never a userId from the body");
  assert.deepEqual(c.body.checkout, { url: "https://bots.example.test/paiement" });
  assert.ok(!JSON.stringify(c.body).includes(process.env.PADDLE_WEBHOOK_SECRET!), "no secret in the request body");
  assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM credit_checkouts WHERE session_id = ?", firstTxn)?.user_id, ids.bob);
  // Live: the live API.
  process.env.PADDLE_ENV = "production"; process.env.PADDLE_API_KEY = "pdl_live_apikey_x"; process.env.PADDLE_CLIENT_TOKEN = "live_x";
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-500" })).status, 200);
  assert.equal(created.at(-1)!.url, "https://api.paddle.com/transactions");
  configure();
  // Paddle refuses, or answers a link to another site: the person gets a clear error, nothing is recorded.
  const n = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM credit_checkouts")!.n;
  answer = () => new Response(JSON.stringify({ error: { type: "request_error", code: "invalid_field", detail: "x" }, meta: {} }), { status: 400 });
  const bad = await bob("POST", "/billing/credits/checkout", { pack: "pack-500" });
  assert.deepEqual([bad.status, bad.json.code], [502, "paddle"]);
  answer = () => new Response(JSON.stringify({ data: { id: id26("txn", 900), status: "draft", checkout: { url: `https://evil.example/pay?_ptxn=${id26("txn", 900)}` } } }), { status: 201 });
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-500" })).status, 502, "never sends the browser to another site");
  answer = null;
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM credit_checkouts")!.n, n, "neither was recorded");
  // The operator has nothing to buy.
  assert.equal((await owner("POST", "/billing/credits/checkout", { pack: "pack-1000" })).status, 409);
});

test("/paiement: loads Paddle.js only there, with its own CSP, the client-side token and never the API key", async () => {
  const res = await site.request("/paiement?_ptxn=" + firstTxn, { headers: { "accept-language": "fr" } });
  assert.equal(res.status, 200);
  const csp = res.headers.get("content-security-policy") ?? "";
  assert.match(csp, /script-src 'nonce-[A-Za-z0-9+/=]+' https:\/\/cdn\.paddle\.com;/);
  assert.match(csp, /frame-ancestors 'none'/);
  const html = await res.text();
  assert.match(html, /<script src="https:\/\/cdn\.paddle\.com\/paddle\/v2\/paddle\.js"/);
  assert.match(html, /Paddle\.Environment\.set\("sandbox"\)/);
  assert.ok(html.includes(process.env.PADDLE_CLIENT_TOKEN!));
  assert.ok(!html.includes(process.env.PADDLE_API_KEY!) && !html.includes(SECRET), "no secret on the page");
  assert.match(html, /successUrl:c\.success/);
  assert.ok(html.includes("https://bots.example.test/?credits=success"));
  assert.match(html, /revendeur/);
  const nonce = /'nonce-([^']+)'/.exec(csp)![1];
  assert.equal((html.match(new RegExp(`nonce="${nonce.replace(/[+/=]/g, "\\$&")}"`, "g")) ?? []).length, 2, "both scripts carry the nonce");
  // The rest of the app keeps its own CSP (no Paddle there).
  assert.ok(!((await site.request("/tarifs")).headers.get("content-security-policy") ?? "").includes("paddle"));
});

test("webhook: a bad, missing or old signature is refused and changes nothing", async () => {
  const raw = txnEvent("evt_bad", firstTxn);
  const before = await bal(bob);
  assert.equal((await hook(raw, paddle.signPaddlePayload(raw, "pdl_ntfset_wrong"))).status, 400);
  assert.equal((await hook(raw, "")).status, 400);
  assert.equal((await hook(raw, `ts=${Math.floor(Date.now() / 1000)}`)).status, 400, "no h1");
  assert.equal((await hook(raw, paddle.signPaddlePayload(raw, SECRET).replace(";", ","))).status, 400, "Stripe-style separators are not Paddle's");
  assert.equal((await hook(raw, paddle.signPaddlePayload(raw, SECRET, Math.floor(Date.now() / 1000) - 3600))).status, 400, "replayed an hour later");
  // The body changed after signing.
  assert.equal((await hook(raw.replace('"1000"', '"100000"'), paddle.signPaddlePayload(raw, SECRET))).status, 400);
  // Two h1 while a secret is rotated: one good one is enough.
  const t = Math.floor(Date.now() / 1000);
  const good = paddle.signPaddlePayload(raw, SECRET, t).split("h1=")[1];
  assert.equal(paddle.verifyPaddleSignature(raw, `ts=${t};h1=${"0".repeat(64)};h1=${good}`, SECRET), null);
  assert.equal(await bal(bob), before);
  assert.equal(q.get("SELECT 1 AS x FROM billing_events WHERE provider = 'paddle' AND event_id = 'evt_bad'"), undefined, "a refused event is not recorded");
});

test("webhook: a paid transaction is credited once — same event twice, or paid then completed", async () => {
  const before = await bal(bob);
  const r = await hook(txnEvent("evt_1", firstTxn, { type: "transaction.paid", status: "paid" }));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.result, "credited");
  const after = (await bob("GET", "/billing/credits")).json;
  assert.ok(close(after.balanceEur, before + 10));
  assert.deepEqual([after.history[0].source, after.history[0].amountEur], ["payment", 10]);
  assert.equal((await hook(txnEvent("evt_1", firstTxn, { type: "transaction.paid", status: "paid" }))).json.duplicate, true);
  assert.equal((await hook(txnEvent("evt_2", firstTxn))).json.result, "duplicate", "transaction.completed for the same transaction");
  assert.ok(close(await bal(bob), before + 10));
  assert.equal(q.get<{ status: string }>("SELECT status FROM credit_checkouts WHERE session_id = ?", firstTxn)?.status, "paid");
  // Logged for the operator and the account, and told in its chat.
  assert.ok(hosted.adminLogList(50).some((e) => e.action === "credit" && e.detail.includes(firstTxn)));
  const bobBot = (await bob("GET", "/bots")).json.bots.find((x: any) => x.primary).id;
  assert.ok((await rowsOf(bob, bobBot)).some((x: any) => x.body.kind === "notice" && /credits added/.test(x.body.text)));
  // Other events are acknowledged and change nothing.
  assert.equal((await hook(JSON.stringify({ event_id: "evt_3", event_type: "customer.created", occurred_at: "", notification_id: "n", data: { id: "ctm_1" } }))).json.result, "ignored");
});

test("webhook: unpaid, unknown, tampered or someone else's transactions credit nothing (isolation)", async () => {
  const aliceBefore = await bal(alice), bobBefore = await bal(bob);
  const s = await alice("POST", "/billing/credits/checkout", { pack: "pack-500" });
  const tid = /txn_[a-z\d]{26}/.exec(s.json.url)![0];
  const forAlice = { user: ids.alice, pack: "pack-500", total: "500" };
  assert.equal((await hook(txnEvent("evt_10", tid, { ...forAlice, user: ids.bob }))).json.result, "ignored", "custom data naming another account");
  assert.equal((await hook(txnEvent("evt_11", tid, { ...forAlice, total: "50000" }))).json.result, "ignored", "another amount");
  assert.equal((await hook(txnEvent("evt_12", tid, { ...forAlice, total: "50" }))).json.result, "ignored", "a discount brought it down");
  assert.equal((await hook(txnEvent("evt_13", tid, { ...forAlice, currency: "USD" }))).json.result, "ignored", "another currency");
  assert.equal((await hook(txnEvent("evt_14", tid, { ...forAlice, pack: "pack-2000" }))).json.result, "ignored", "another pack");
  assert.equal((await hook(txnEvent("evt_15", tid, { ...forAlice, status: "ready" }))).json.result, "ignored", "not paid");
  assert.equal((await hook(txnEvent("evt_16", id26("txn", 999), forAlice))).json.result, "ignored", "not created by this server");
  assert.ok(hosted.adminLogList(100).some((e) => e.action === "credit-refused" && e.detail.includes(tid)), "the owner is told");
  assert.equal(await bal(bob), bobBefore);
  assert.equal(await bal(alice), aliceBefore);
  // The genuine event credits Alice, the account that created the transaction, with the amount the server set.
  assert.equal((await hook(txnEvent("evt_17", tid, forAlice))).json.result, "credited");
  const av = (await alice("GET", "/billing/credits")).json;
  // (Alice had already gone a little past her credits this month: that overrun comes off the new ones.)
  assert.ok(av.balanceEur > aliceBefore && av.balanceEur <= aliceBefore + 5);
  assert.deepEqual([av.history[0].source, av.history[0].amountEur], ["payment", 5]);
  assert.equal(await bal(bob), bobBefore);
  assert.ok(!(await bob("GET", "/billing/credits")).text.includes(tid), "each account sees only its own history");
  ids.aliceTxn = tid;
});

test("refunds: an approved refund removes the unspent credits once; pending, rejected and reversals only inform the owner", async () => {
  // Bob: 10 € bought (firstTxn), nothing spent on them. A refund waiting for Paddle's approval changes nothing yet.
  const start = await bal(bob);
  assert.equal((await hook(adjEvent("evt_20", "adj_1", firstTxn, { type: "adjustment.created", status: "pending_approval", total: "400" }))).json.result, "logged");
  assert.ok(close(await bal(bob), start));
  assert.ok(hosted.adminLogList(50).some((e) => e.action === "refund-pending" && e.detail.includes("adj_1")));
  // Approved (adjustment.updated): 4 € removed. Told twice (new event, same adjustment): removed once.
  assert.equal((await hook(adjEvent("evt_21", "adj_1", firstTxn, { total: "400" }))).json.result, "removed");
  assert.ok(close(await bal(bob), start - 4));
  assert.equal((await hook(adjEvent("evt_22", "adj_1", firstTxn, { total: "400" }))).json.result, "duplicate");
  assert.equal((await hook(adjEvent("evt_21", "adj_1", firstTxn, { total: "400" }))).json.duplicate, true);
  assert.ok(close(await bal(bob), start - 4));
  const v = (await bob("GET", "/billing/credits")).json;
  assert.deepEqual([v.history[0].source, v.history[0].amountEur], ["refund", -4]);
  const bobBot = (await bob("GET", "/bots")).json.bots.find((x: any) => x.primary).id;
  assert.ok((await rowsOf(bob, bobBot)).some((x: any) => x.body.kind === "notice" && /refunded/.test(x.body.text)));
  // A rejected refund, and a refund of someone else's transaction, change nothing.
  assert.equal((await hook(adjEvent("evt_23", "adj_2", firstTxn, { status: "rejected" }))).json.result, "logged");
  assert.equal((await hook(adjEvent("evt_24", "adj_3", id26("txn", 999)))).json.result, "ignored");
  // A chargeback for the full amount: never more than the transaction credited, all refunds together (10 - 4 = 6).
  assert.equal((await hook(adjEvent("evt_25", "adj_4", firstTxn, { action: "chargeback", total: "1000" }))).json.result, "removed");
  assert.ok(close(await bal(bob), start - 10));
  assert.equal((await hook(adjEvent("evt_26", "adj_5", firstTxn, { action: "chargeback_warning", total: "1000" }))).json.result, "removed");
  assert.ok(close(await bal(bob), start - 10), "nothing more: the whole transaction is already accounted for");
  assert.equal(q.get<{ status: string }>("SELECT status FROM credit_checkouts WHERE session_id = ?", firstTxn)?.status, "refunded");
  // A reversed chargeback is not re-credited automatically: the owner decides.
  assert.equal((await hook(adjEvent("evt_27", "adj_6", firstTxn, { action: "chargeback_reverse" }))).json.result, "logged");
  assert.ok(close(await bal(bob), start - 10));
  assert.ok(hosted.adminLogList(50).some((e) => e.action === "refund-reversed" && e.detail.includes("adj_6")));
  // A second payment event for the refunded transaction does not credit it again.
  assert.equal((await hook(txnEvent("evt_28", firstTxn))).json.result, "duplicate");
  assert.ok(close(await bal(bob), start - 10));
});

test("refunds: credits already spent cannot be taken back — the balance stays at 0 and the owner sees the gap", async () => {
  // Alice's 5 € pack: she has spent part of her credits. Refunding the whole pack leaves her at 0, never below.
  const before = await bal(alice);
  assert.ok(before < 5);
  assert.equal((await hook(adjEvent("evt_30", "adj_10", ids.aliceTxn, { total: "500" }))).json.result, "removed");
  assert.equal(await bal(alice), 0);
  const log = hosted.adminLogList(50).find((e) => e.action === "refund-unrecovered" && e.detail.includes("adj_10"));
  assert.ok(log, "the owner is told what was already spent");
  assert.equal(log!.targetId, ids.alice);
});

test("the older webhook address is the same handler once Paddle is configured; without the variables again, payment is off", async () => {
  const raw = txnEvent("evt_legacy", firstTxn);
  const r = await hook(raw, paddle.signPaddlePayload(raw, SECRET), "/billing/webhook/paddle");
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "duplicate");
  assert.equal((await anon("POST", "/billing/webhook/stripe", raw)).status, 501);
  for (const k of paddle.PADDLE_VARS) delete process.env[k];
  assert.equal((await bob("GET", "/billing/credits")).json.payments, "off");
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-500" })).status, 503);
  assert.equal((await hook(raw)).status, 503);
  assert.equal((await site.request("/paiement")).headers.get("content-security-policy")?.includes("cdn.paddle.com") ?? false, false);
});

test("admin settings: credit packs are validated (1 to 6 amounts between 1 and 1000 €)", async () => {
  const ok = await owner("PUT", "/admin/settings", { creditPacksEur: "20, 5, 50" });
  assert.deepEqual(ok.json.settings.creditPacksEur, [5, 20, 50]);
  const bad = await owner("PUT", "/admin/settings", { creditPacksEur: [0, 5] });
  assert.deepEqual(bad.json.settings.creditPacksEur, [5, 20, 50], "a bad list keeps the previous one");
  assert.deepEqual((await alice("GET", "/billing/credits")).json.packs.map((p: any) => p.amountEur), [5, 20, 50]);
});
