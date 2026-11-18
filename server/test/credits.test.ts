import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Prepaid AI credits (credits.ts, billing/stripe.ts, hosted.ts "Prepaid credits"): a free account (0 € budget of its own)
// runs on the service's keys only with credits, stops with the "no credits left" card, credits carry over the month;
// Stripe Checkout with a fake Stripe (parameters checked), signed fake webhooks (bad signature refused, replays and
// duplicates ignored, credited once, only sessions this server made, the amount it set), payment off without the keys,
// and isolation between accounts.
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
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "OPENAI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY", "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "TURNSTILE_SITE_KEY", "TURNSTILE_SECRET_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const stripe = await import("../src/billing/stripe.js");
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
  assert.equal((await anon("POST", "/billing/stripe/webhook", "{}")).status, 503);
  assert.equal((await anon("POST", "/billing/webhook/stripe", "{}")).status, 501, "the older address keeps saying 'not connected'");
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

// ── Stripe ───────────────────────────────────────────────────────────────────────────────────────────────────────
const SECRET = "whsec_test_secret_for_credits";
const created: { url: string; init: RequestInit; params: URLSearchParams }[] = [];
let nextSession = 0;
stripe._setStripeFetch(async (url, init) => {
  const params = new URLSearchParams(String(init.body));
  created.push({ url, init, params });
  const id = `cs_test_${++nextSession}`;
  return new Response(JSON.stringify({ id, object: "checkout.session", url: `https://checkout.stripe.com/c/pay/${id}`, payment_status: "unpaid", amount_total: Number(params.get("line_items[0][price_data][unit_amount]")), currency: "eur" }), { status: 200, headers: { "content-type": "application/json" } });
});
const event = (id: string, sessionId: string, o: Record<string, unknown> = {}) => JSON.stringify({ id, object: "event", type: "checkout.session.completed", data: { object: { id: sessionId, object: "checkout.session", mode: "payment", payment_status: "paid", amount_total: 1000, currency: "eur", metadata: { userId: ids.bob, pack: "pack-1000" }, ...o } } });
const hook = (raw: string, sig = stripe.signStripePayload(raw, SECRET)) => anon("POST", "/billing/stripe/webhook", raw, { "stripe-signature": sig, origin: "" });

test("checkout: only the owner's packs, the amount set by the server, the documented parameters", async () => {
  process.env.STRIPE_SECRET_KEY = "sk_test_fake_key";
  process.env.STRIPE_WEBHOOK_SECRET = SECRET;
  assert.equal((await bob("GET", "/billing/credits")).json.payments, "stripe");
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-999999", amountEur: 1 })).status, 400, "unknown pack");
  assert.equal((await bob("POST", "/billing/credits/checkout", { amountEur: 1 })).status, 400, "an amount is never accepted");
  const r = await bob("POST", "/billing/credits/checkout", { pack: "pack-1000", amountEur: 0.01, userId: ids.alice });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.url, "https://checkout.stripe.com/c/pay/cs_test_1");
  const c = created.at(-1)!;
  assert.equal(c.url, "https://api.stripe.com/v1/checkout/sessions");
  assert.equal((c.init.headers as Record<string, string>).authorization, `Basic ${Buffer.from("sk_test_fake_key:").toString("base64")}`);
  assert.equal(c.params.get("mode"), "payment");
  assert.equal(c.params.get("line_items[0][price_data][currency]"), "eur");
  assert.equal(c.params.get("line_items[0][price_data][unit_amount]"), "1000");
  assert.equal(c.params.get("line_items[0][quantity]"), "1");
  assert.ok(c.params.get("line_items[0][price_data][product_data][name]"));
  assert.equal(c.params.get("metadata[userId]"), ids.bob, "the caller, never a userId from the body");
  assert.equal(c.params.get("client_reference_id"), ids.bob);
  assert.equal(c.params.get("success_url"), "https://bots.example.test/?credits=success&session_id={CHECKOUT_SESSION_ID}");
  assert.equal(c.params.get("cancel_url"), "https://bots.example.test/?credits=cancel");
  assert.equal(c.params.get("locale"), "en");
  assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM credit_checkouts WHERE session_id = 'cs_test_1'")?.user_id, ids.bob);
  // The operator has nothing to buy.
  assert.equal((await owner("POST", "/billing/credits/checkout", { pack: "pack-1000" })).status, 409);
});

test("webhook: a bad, missing or old signature is refused and changes nothing", async () => {
  const raw = event("evt_bad", "cs_test_1");
  const before = (await bob("GET", "/billing/credits")).json.balanceEur;
  assert.equal((await hook(raw, stripe.signStripePayload(raw, "whsec_wrong"))).status, 400);
  assert.equal((await hook(raw, "")).status, 400);
  assert.equal((await hook(raw, `t=${Math.floor(Date.now() / 1000)},v0=${"0".repeat(64)}`)).status, 400, "v0 is never accepted");
  assert.equal((await hook(raw, stripe.signStripePayload(raw, SECRET, Math.floor(Date.now() / 1000) - 3600))).status, 400, "replayed an hour later");
  // The body changed after signing.
  assert.equal((await hook(raw.replace("1000", "100000"), stripe.signStripePayload(raw, SECRET))).status, 400);
  assert.equal((await bob("GET", "/billing/credits")).json.balanceEur, before);
});

test("webhook: a paid session is credited once — same event twice, or another event for the same session", async () => {
  const before = (await bob("GET", "/billing/credits")).json.balanceEur;
  const r = await hook(event("evt_1", "cs_test_1"));
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.result, "credited");
  const after = (await bob("GET", "/billing/credits")).json;
  assert.ok(Math.abs(after.balanceEur - (before + 10)) < 1e-6);
  assert.equal(after.history[0].source, "stripe");
  assert.equal((await hook(event("evt_1", "cs_test_1"))).json.duplicate, true);
  const other = await hook(JSON.stringify({ ...JSON.parse(event("evt_2", "cs_test_1")), type: "checkout.session.async_payment_succeeded" }));
  assert.equal(other.json.result, "duplicate");
  assert.ok(Math.abs((await bob("GET", "/billing/credits")).json.balanceEur - (before + 10)) < 1e-6);
  assert.equal(q.get<{ status: string }>("SELECT status FROM credit_checkouts WHERE session_id = 'cs_test_1'")?.status, "paid");
  // Logged for the operator and the account, and told in its chat.
  assert.ok(hosted.adminLogList(50).some((e) => e.action === "credit" && /cs_test_1/.test(e.detail)));
  const bobBot = (await bob("GET", "/bots")).json.bots.find((x: any) => x.primary).id;
  assert.ok((await rowsOf(bob, bobBot)).some((x: any) => x.body.kind === "notice" && /credits added/.test(x.body.text)));
});

test("webhook: unpaid, unknown, tampered or someone else's sessions credit nothing (isolation)", async () => {
  const aliceBefore = (await alice("GET", "/billing/credits")).json.balanceEur;
  const bobBefore = (await bob("GET", "/billing/credits")).json.balanceEur;
  // Alice starts a checkout; a forged event for her session that names Bob, or another amount, credits nobody.
  const s = await alice("POST", "/billing/credits/checkout", { pack: "pack-500" });
  const sid = /cs_test_\d+/.exec(s.json.url)![0];
  assert.equal((await hook(event("evt_10", sid, { amount_total: 500, metadata: { userId: ids.bob } }))).json.result, "ignored");
  assert.equal((await hook(event("evt_11", sid, { amount_total: 50000, metadata: { userId: ids.alice } }))).json.result, "ignored");
  assert.equal((await hook(event("evt_12", sid, { amount_total: 500, currency: "usd", metadata: { userId: ids.alice } }))).json.result, "ignored");
  assert.equal((await hook(event("evt_13", sid, { amount_total: 500, payment_status: "unpaid", metadata: { userId: ids.alice } }))).json.result, "ignored");
  assert.equal((await hook(event("evt_14", "cs_not_ours", { amount_total: 500 }))).json.result, "ignored");
  assert.equal((await bob("GET", "/billing/credits")).json.balanceEur, bobBefore);
  assert.equal((await alice("GET", "/billing/credits")).json.balanceEur, aliceBefore);
  // The genuine event credits Alice, the account that created the session, with the amount the server set.
  assert.equal((await hook(event("evt_15", sid, { amount_total: 500, metadata: { userId: ids.alice } }))).json.result, "credited");
  // (Alice had already gone a little past her credits this month: that overrun comes off the new ones.)
  const av = (await alice("GET", "/billing/credits")).json;
  assert.ok(av.balanceEur > aliceBefore && av.balanceEur <= aliceBefore + 5);
  assert.deepEqual([av.history[0].source, av.history[0].amountEur], ["stripe", 5]);
  assert.equal((await bob("GET", "/billing/credits")).json.balanceEur, bobBefore);
  // Each account sees only its own history.
  assert.ok(!(await bob("GET", "/billing/credits")).text.includes(sid));
});

test("the older webhook address is the same handler once Stripe is configured; without the keys again, payment is off", async () => {
  const raw = event("evt_legacy", "cs_test_1");
  const r = await anon("POST", "/billing/webhook/stripe", raw, { "stripe-signature": stripe.signStripePayload(raw, SECRET) });
  assert.equal(r.status, 200);
  assert.equal(r.json.result, "duplicate");
  delete process.env.STRIPE_SECRET_KEY; delete process.env.STRIPE_WEBHOOK_SECRET;
  assert.equal((await bob("GET", "/billing/credits")).json.payments, "off");
  assert.equal((await bob("POST", "/billing/credits/checkout", { pack: "pack-500" })).status, 503);
});

test("admin settings: credit packs are validated (1 to 6 amounts between 1 and 1000 €)", async () => {
  const ok = await owner("PUT", "/admin/settings", { creditPacksEur: "20, 5, 50" });
  assert.deepEqual(ok.json.settings.creditPacksEur, [5, 20, 50]);
  const bad = await owner("PUT", "/admin/settings", { creditPacksEur: [0, 5] });
  assert.deepEqual(bad.json.settings.creditPacksEur, [5, 20, 50], "a bad list keeps the previous one");
  assert.deepEqual((await alice("GET", "/billing/credits")).json.packs.map((p: any) => p.amountEur), [5, 20, 50]);
});
