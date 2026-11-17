import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Usage caps in hosted mode (usagecaps.ts with HOSTED_MODE=1): the operator sets caps on a customer's account from the
// administration; they count only what the service's keys pay for, the customer sees them and cannot change or raise
// them; the customer's own caps stay theirs; the plan's AI budget and its hard stop keep working as before.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-caps-hosted-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "opcap:op-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "OPENAI_API_KEY", "XAI_API_KEY", "ANTHROPIC_API_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { ownerPrices } = await import("../src/usage.js");
const { routines } = await import("../src/routines.js");
const { fireRoutine } = await import("../src/scheduler.js");
const caps = await import("../src/usagecaps.js");
const { bots } = await import("../src/store.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Card, Row, UsageCapsView } from "../src/shared.js";

// The operator's model (a server .env provider): 1 000 + 1 000 tokens a call, at 10 $ per million → 0.02 $ a call.
let calls = 0;
registerProvider({
  id: "opcap", label: "Operator", models: ["op-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    calls++;
    req.onText?.("operator reply");
    return { content: [{ type: "text", text: "operator reply" }], stopReason: "end", model: "op-1", usage: { inputTokens: 1000, outputTokens: 1000, cachedTokens: 0 } };
  },
});
ownerPrices.set("op-1", { input: 10, output: 10, cached: 10 }, "test");

const ORIGIN = process.env.PUBLIC_URL!;
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const operator = client(), customer = client(), other = client();
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
type Client = ReturnType<typeof client>;
const rowsOf = async (who: Client, botId: string): Promise<Row[]> => (await who("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const idle = (who: Client, botId: string) => until(async () => !(await who("GET", "/bots")).json.live[botId]?.running, "idle");
async function say(who: Client, botId: string, text: string) {
  const n = calls;
  const before = (await rowsOf(who, botId)).length;
  assert.equal((await who("POST", `/bots/${botId}/messages`, { text })).status, 200);
  await until(async () => calls > n || (await rowsOf(who, botId)).length > before + 1, "a reply or a notice");
  await idle(who, botId);
}
const capCards = async (who: Client, botId: string) => (await rowsOf(who, botId)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "cap" ? [r.body.card as Extract<Card, { type: "cap" }>] : []));

const ids: Record<string, string> = {};
test("setup: the operator (the owner) and two customers", async () => {
  ids.operator = (await operator("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "en" })).json.user.id;
  ids.customer = (await customer("POST", "/auth/signup", { email: "cust@example.com", password: "password123", plan: "included", acceptTerms: true, locale: "en" })).json.user.id;
  ids.other = (await other("POST", "/auth/signup", { email: "other@example.com", password: "password123", plan: "free", acceptTerms: true, locale: "en" })).json.user.id;
  ids.bot = (await customer("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
});

test("only an operator sets a customer's caps; never on an operator's own account", async () => {
  assert.equal((await other("PUT", `/admin/customers/${ids.customer}/caps`, { period: "day", unit: "usd", limit: 1 })).status, 404, "a customer does not even see the route");
  assert.equal((await other("GET", `/admin/customers/${ids.customer}/caps`)).status, 404);
  assert.equal((await operator("PUT", `/admin/customers/${ids.operator}/caps`, { period: "day", unit: "usd", limit: 1 })).status, 409);
  assert.equal((await operator("PUT", `/admin/customers/${ids.customer}/caps`, { period: "fortnight", unit: "usd", limit: 1 })).status, 400);
  const r = await operator("PUT", `/admin/customers/${ids.customer}/caps`, { period: "day", unit: "usd", limit: 0.03 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.caps.length, 1);
  assert.equal(r.json.caps[0].setBy, "operator");
  assert.ok(r.json.audit.some((a: any) => a.action === "cap" && a.detail.startsWith("daily spending cap: 0.03 $")));
  // The customer sees it, read-only; setting their own cap of the same kind makes a second one, theirs.
  const v: UsageCapsView = (await customer("GET", "/usage/caps")).json;
  assert.equal(v.account.caps.length, 1);
  assert.equal(v.account.caps[0].setBy, "operator");
  const mine = await customer("PUT", "/usage/caps", { period: "day", unit: "usd", limit: 5 });
  assert.equal(mine.status, 200);
  assert.deepEqual(mine.json.account.caps.map((c: any) => `${c.setBy}:${c.limit}`).sort(), ["operator:0.03", "self:5"]);
  assert.equal((await customer("PUT", "/usage/caps", { period: "day", unit: "usd", limit: null })).status, 200);
  assert.equal((await customer("GET", "/usage/caps")).json.account.caps.length, 1, "removing their own leaves the operator's");
});

test("the operator's cap counts what the service's keys pay for only; reached, it stops unattended work; the customer cannot raise it", async () => {
  // The customer's own key paid for this: not the operator's business.
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status, est_cost_usd, payer) VALUES (?, ?, ?, 'own-1', 5, 5, 0, 9, 'priced', 0, 'own')", ids.customer, ids.bot, Date.now());
  assert.equal(caps.operatorCapsOf(ids.customer)[0].used, 0);
  await say(customer, ids.bot, "one");
  await say(customer, ids.bot, "two"); // 0.04 $ on the operator's keys
  const st = caps.operatorCapsOf(ids.customer)[0];
  assert.equal(st.used, 0.04);
  assert.equal(st.reached, true);
  const card = (await capCards(customer, ids.bot)).find((c) => c.status === "pending")!;
  assert.equal(card.cap.setBy, "operator");
  assert.equal(card.canRaise, false);
  const raise = await customer("POST", `/usage/caps/stops/${card.stopId}`, { action: "raise", limit: 10 });
  assert.equal(raise.status, 403);
  assert.match(raise.json.error, /operator/);
  // Unattended work stops; the customer's own message still runs ("unattended" is the default).
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, created_at) VALUES ('r_c', ?, 'Daily', 'daily prompt', 'cron', '0 9 * * *', ?)", ids.bot, Date.now());
  assert.equal(fireRoutine(routines.byId("r_c")!), "capped");
  const n = calls;
  await say(customer, ids.bot, "three");
  assert.equal(calls, n + 1);
  // The administration shows it measured.
  const admin = (await operator("GET", `/admin/customers/${ids.customer}/caps`)).json.caps;
  assert.equal(admin[0].reached, true);
  // Another customer is not affected.
  const otherBot = (await other("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
  assert.equal(caps.blockingCap(bots.byId(otherBot)!, false), null);
  // Out of hosted mode, an operator's cap does not apply (and is not listed).
  process.env.HOSTED_MODE = "0";
  try { assert.equal(caps.caps.list(ids.customer).length, 0); } finally { process.env.HOSTED_MODE = "1"; }
});

test("the plan's AI budget still stops the service's keys on its own (the caps neither replace nor hide it)", async () => {
  assert.equal((await operator("PUT", `/admin/customers/${ids.customer}/caps`, { period: "day", unit: "usd", limit: null })).status, 200);
  assert.equal(caps.operatorCapsOf(ids.customer).length, 0);
  // The trial budget: 0.05 €. What is spent already (0.06 $ ≈ 0.055 €) is past it.
  assert.equal((await operator("PUT", "/admin/settings", { trialBudgetEur: 0.05 })).status, 200);
  const n = calls;
  const before = (await rowsOf(customer, ids.bot)).length;
  assert.equal((await customer("POST", `/bots/${ids.bot}/messages`, { text: "after the budget" })).status, 200);
  await until(async () => (await rowsOf(customer, ids.bot)).slice(before).some((r) => r.body.kind === "notice" && (r.body as any).action?.kind === "plan" && (r.body as any).action.reason === "budget"), "the plan's budget notice");
  await idle(customer, ids.bot);
  assert.equal(calls, n, "no model call on the operator's keys");
});
