import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";

// Without HOSTED_MODE the install behaves exactly as before the hosted mode existed: no plan, no terms, no limit, no
// metering field, the hosted routes answer like unknown addresses and the public pages fall through to the web app.
// (The rest of the suite, which runs with the mode off, proves the same for everything else.)
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-hosted-off-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "offscript:off-1";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { registerProvider, resolveModel } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const { routines } = await import("../src/routines.js");
const { storeBytes } = await import("../src/computer.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";

const provider: LlmProvider = {
  id: "offscript", label: "Off", models: ["off-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("reply");
    return { content: [{ type: "text", text: "reply" }], stopReason: "end", model: "off-1", usage: { inputTokens: 10, outputTokens: 10, cachedTokens: 0 } };
  },
};
registerProvider(provider);

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

test("off: sign-up needs no terms and makes no subscription; /me has no hosted field", async () => {
  assert.equal(hosted.hostedMode(), false);
  assert.equal((await call("POST", "/auth/signup", { email: "first@example.com", password: "password123" })).status, 200);
  cookie = "";
  const second = await call("POST", "/auth/signup", { email: "second@example.com", password: "password123" });
  assert.equal(second.status, 200, "a second account, without accepting anything");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions")!.n, 0);
  const me = (await call("GET", "/me")).json;
  assert.ok(!("hosted" in me));
});

test("off: every hosted route answers like an unknown address", async () => {
  for (const [m, u] of [["GET", "/plans"], ["GET", "/billing"], ["GET", "/admin/overview"], ["GET", "/admin/customers"], ["PUT", "/admin/settings"], ["GET", "/plan-invites/x"], ["POST", "/billing/webhook/stripe"]] as const) {
    const r = await call(m, u, {});
    assert.equal(r.status, 404, `${m} ${u}`);
    assert.deepEqual(r.json, { error: "No such endpoint." });
  }
});

test("off: /tarifs, /cgu… fall through to the web app like any other path", async () => {
  const app = new Hono();
  app.route("/", site);
  app.get("*", (c) => c.html("<!doctype html><title>SPA</title>"));
  for (const p of ["/tarifs", "/pricing", "/cgu", "/terms", "/mentions-legales", "/legal-notice"]) {
    const r = await app.request(p);
    assert.equal(r.status, 200);
    assert.equal(await r.text(), "<!doctype html><title>SPA</title>", p);
  }
});

test("off: no limit, no metering — the provider is handed out as is and usage lines carry no payer", async () => {
  const uid = q.get<{ id: string }>("SELECT id FROM users WHERE email = 'second@example.com'")!.id;
  for (let i = 0; i < 6; i++) assert.equal((await call("POST", "/bots", { name: `Bot ${i}` })).status, 200);
  const bot = (await call("GET", "/bots")).json.bots[0].id;
  for (let i = 0; i < 6; i++) routines.create(bot, { name: `r${i}`, prompt: "x", trigger: "webhook" });
  storeBytes(bot, "", "big.bin", Buffer.alloc(2_000_000));
  assert.equal(hosted.awakeLimitFor(uid), null);
  assert.equal(resolveModel("offscript:off-1", uid).provider, provider, "not wrapped");
  assert.equal(hosted.operatorBlock(uid), null);
  await call("POST", `/bots/${bot}/messages`, { text: "hi" });
  for (let i = 0; i < 400 && !q.get("SELECT 1 FROM usage WHERE user_id = ?", uid); i++) await new Promise((r) => setTimeout(r, 25));
  const line = q.get<{ payer: string; price_status: string }>("SELECT payer, price_status FROM usage WHERE user_id = ?", uid)!;
  assert.equal(line.payer, "", "written exactly as before");
  // The scheduler's status pass does nothing.
  assert.equal(hosted.hostedTick(), 0);
});

test("off: the owner's deep health check has no hosted section", async () => {
  cookie = "";
  assert.equal((await call("POST", "/auth/login", { email: "first@example.com", password: "password123" })).status, 200);
  const deep = await call("GET", "/health/deep");
  assert.equal(deep.status, 200);
  assert.ok(!("hosted" in deep.json.checks));
});
