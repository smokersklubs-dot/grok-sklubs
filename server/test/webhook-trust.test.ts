import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L20: incoming webhooks you can trust (hooktrust.ts, hookroutes.ts). A delivery sent twice runs once; a webhook with a
// secret refuses unsigned or wrongly signed calls (GitHub, Stripe and Standard Webhooks formats), keeps the previous
// secret 24 h, logs every refusal; calls close together are grouped into one run; « Envoyer un exemple » checks
// everything without running; an old webhook without a secret keeps working (« non signé »). The secret is sealed.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-hooks-"));
process.env.SESSION_SECRET = "hooks-secret-hooks-secret-hooks-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { verifySignature, deliveryKeys, maskIp } = await import("../src/hooktrust.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const prompts: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    prompts.push(JSON.stringify(req.messages));
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" | "none" = "a", headers: Record<string, string> = {}) {
  const raw = typeof body === "string" ? body : body === undefined ? undefined : JSON.stringify(body);
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: who === "none" ? "" : cookies[who] ?? "", ...headers }, body: raw });
  const set = res.headers.get("set-cookie");
  if (set && who !== "none") cookies[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const runsOf = (id: string) => q.all<{ status: string }>("SELECT status FROM routine_runs WHERE routine_id = ?", id);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
const bot = (await call("GET", "/bots")).json.bots[0];
const t0 = Date.now();
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES ('r_legacy', ?, 'Legacy', 'legacy hook prompt', 'webhook', 'tok_legacy', ?)", bot.id, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES ('r_signed', ?, 'Signed', 'signed hook prompt', 'webhook', 'tok_signed', ?)", bot.id, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES ('r_burst', ?, 'Burst', 'burst hook prompt', 'webhook', 'tok_burst', ?)", bot.id, t0);

test("the same delivery sent twice runs once; a call without an id is never treated as a repeat", async () => {
  const h = { "x-github-delivery": "72d3162e-cc78-11e3-81ab-4c9367dc0958" };
  const first = await call("POST", "/hooks/tok_legacy", { action: "opened" }, "none", h);
  assert.deepEqual(first.json, { ok: true });
  const again = await call("POST", "/hooks/tok_legacy", { action: "opened" }, "none", h);
  assert.equal(again.status, 200, "a repeat is acknowledged (no retry storm)");
  assert.deepEqual(again.json, { ok: true, duplicate: true });
  await call("POST", "/hooks/tok_legacy", { n: 1 }, "none", { "webhook-id": "msg_1" });
  assert.equal((await call("POST", "/hooks/tok_legacy", { n: 1 }, "none", { "webhook-id": "msg_1" })).json.duplicate, true);
  // Old webhooks without any id or secret behave as before: every call runs.
  assert.deepEqual((await call("POST", "/hooks/tok_legacy", { plain: 1 }, "none")).json, { ok: true });
  await sleep(50);
  assert.deepEqual((await call("POST", "/hooks/tok_legacy", { plain: 1 }, "none")).json, { ok: true });
  // 4 runs started (two de-duplicated); "still running" skips count as starts too, so count non-duplicate starts.
  assert.equal(runsOf("r_legacy").length, 4);
  const view = (await call("GET", "/routines/r_legacy/hook")).json;
  assert.equal(view.signed, false, "an old webhook shows as unsigned");
  assert.equal(view.refusals.filter((r: any) => r.reason === "duplicate").length, 2);
});

test("a secret: unsigned and wrong calls refused (401, logged, rate budget untouched); GitHub, Stripe, Standard formats accepted", async () => {
  const made = await call("POST", "/routines/r_signed/hook/secret", {});
  assert.equal(made.status, 200);
  const secret: string = made.json.secret;
  assert.match(secret, /^whsec_/);
  assert.equal(made.json.signed, true);
  assert.equal((await call("GET", "/routines/r_signed/hook")).json.secret, undefined, "shown once only");
  // Stored sealed with the data key, never in clear.
  const stored = q.get<{ secret_enc: string }>("SELECT secret_enc FROM routine_hooks WHERE routine_id = 'r_signed'")!.secret_enc;
  assert.match(stored, /^v2:/);
  assert.ok(!stored.includes(secret.slice(6, 20)));

  for (let i = 0; i < 25; i++) assert.equal((await call("POST", "/hooks/tok_signed", { forged: i }, "none")).status, 401);
  const body = JSON.stringify({ ref: "main" });
  const gh = createHmac("sha256", secret).update(body).digest("hex");
  assert.equal((await call("POST", "/hooks/tok_signed", body, "none", { "x-hub-signature-256": `sha256=${"0".repeat(64)}` })).status, 401);
  const ok = await call("POST", "/hooks/tok_signed", body, "none", { "x-hub-signature-256": `sha256=${gh}`, "x-github-delivery": "d-1" });
  assert.equal(ok.status, 200, "25 forged calls did not use the hook's budget of 20 a minute");
  assert.deepEqual(ok.json, { ok: true });

  const ts = Math.floor(Date.now() / 1000);
  const stripe = createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
  assert.equal((await call("POST", "/hooks/tok_signed", body, "none", { "stripe-signature": `t=${ts},v1=${stripe}` })).status, 200);
  const old = ts - 3600;
  const stale = createHmac("sha256", secret).update(`${old}.${body}`).digest("hex");
  assert.equal((await call("POST", "/hooks/tok_signed", body, "none", { "stripe-signature": `t=${old},v1=${stale}` })).status, 401);
  // The same signed Stripe call replayed (no id header): refused as a repeat by its signature.
  assert.equal((await call("POST", "/hooks/tok_signed", body, "none", { "stripe-signature": `t=${ts},v1=${stripe}` })).json.duplicate, true);

  const key = Buffer.from(secret.slice(6), "base64");
  const sw = createHmac("sha256", key).update(`msg_9.${ts}.${body}`).digest("base64");
  assert.equal((await call("POST", "/hooks/tok_signed", body, "none", { "webhook-id": "msg_9", "webhook-timestamp": String(ts), "webhook-signature": `v1,${sw}` })).status, 200);

  const refusals = (await call("GET", "/routines/r_signed/hook")).json.refusals.map((r: any) => r.reason);
  assert.equal(refusals.filter((r: string) => r === "no_signature").length, 25);
  assert.ok(refusals.includes("bad_signature"));
  assert.ok(refusals.includes("stale_timestamp"));

  // A new secret: the previous one still works for 24 hours.
  const next = await call("POST", "/routines/r_signed/hook/secret", {});
  assert.ok(next.json.previousUntil > Date.now() + 23 * 3600_000);
  const body2 = JSON.stringify({ ref: "dev" });
  assert.equal((await call("POST", "/hooks/tok_signed", body2, "none", { "x-hub-signature-256": `sha256=${createHmac("sha256", secret).update(body2).digest("hex")}` })).status, 200);
  // A pasted secret (Stripe makes its own) is accepted and never sent back.
  const pasted = await call("POST", "/routines/r_signed/hook/secret", { secret: "whsec_fakeForTestsOnly123" });
  assert.equal(pasted.json.secret, undefined);
  assert.equal((await call("POST", "/routines/r_signed/hook/secret", { secret: "short" })).status, 400);
  // Turned off: back to the address alone.
  assert.equal((await call("DELETE", "/routines/r_signed/hook/secret")).json.signed, false);
  assert.equal((await call("POST", "/hooks/tok_signed", { unsigned: true }, "none")).status, 200);
});

test("« Envoyer un exemple » checks everything without running; a stranger gets 404", async () => {
  await call("POST", "/routines/r_signed/hook/secret", {});
  const before = runsOf("r_signed").length;
  const r = await call("POST", "/routines/r_signed/hook/test");
  assert.equal(r.status, 200);
  assert.equal(r.json.wouldRun, true);
  assert.deepEqual(r.json.checks.map((c: any) => [c.id, c.ok]), [["address", true], ["active", true], ["signature", true], ["bot", true]]);
  assert.deepEqual(r.json.headers, ["webhook-id", "webhook-timestamp", "webhook-signature"]);
  assert.match(r.json.preview, /signed hook prompt/);
  assert.equal(runsOf("r_signed").length, before, "nothing ran");
  for (const [method, url] of [["GET", "/routines/r_signed/hook"], ["POST", "/routines/r_signed/hook/test"], ["POST", "/routines/r_signed/hook/secret"], ["DELETE", "/routines/r_signed/hook/secret"], ["PUT", "/routines/r_signed/hook"]] as const) {
    assert.equal((await call(method, url, method === "GET" ? undefined : { groupSec: 10 }, "b")).status, 404, `${method} ${url}`);
  }
  // A paused routine: the call is refused and logged.
  q.run("UPDATE routines SET enabled = 0 WHERE id = 'r_legacy'");
  assert.equal((await call("POST", "/hooks/tok_legacy", {}, "none")).status, 404);
  assert.equal((await call("POST", "/routines/r_legacy/hook/test")).json.wouldRun, false);
  assert.ok((await call("GET", "/routines/r_legacy/hook")).json.refusals.some((x: any) => x.reason === "paused"));
  q.run("UPDATE routines SET enabled = 1 WHERE id = 'r_legacy'");
});

test("burst grouping: calls close together start one run with all of them", async () => {
  assert.equal((await call("PUT", "/routines/r_burst/hook", { groupSec: 7 })).status, 400);
  assert.equal((await call("PUT", "/routines/r_burst/hook", { groupSec: 10 })).json.groupSec, 10);
  for (let i = 1; i <= 3; i++) assert.deepEqual((await call("POST", "/hooks/tok_burst", { push: i }, "none")).json, { ok: true, grouped: true });
  assert.equal(runsOf("r_burst").length, 0, "nothing runs before the window closes");
  assert.equal((await call("GET", "/routines/r_burst/hook")).json.pending, 3);
  // Turning grouping off runs what waited, at once, as one run.
  await call("PUT", "/routines/r_burst/hook", { groupSec: 0 });
  assert.equal(runsOf("r_burst").length, 1);
  for (let i = 0; i < 400 && !prompts.some((p) => p.includes("burst hook prompt")); i++) await sleep(25);
  const p = prompts.find((x) => x.includes("burst hook prompt"))!;
  assert.match(p, /3 calls to this address arrived close together/);
  assert.match(p, /\\"push\\": 3/);
});

test("signature formats and delivery ids (unit)", () => {
  const raw = Buffer.from('{"a":1}');
  const h = (o: Record<string, string>) => (n: string) => o[n];
  assert.deepEqual(verifySignature(["s3cret-for-tests"], h({}), raw), { ok: false, reason: "no_signature" });
  const gh = createHmac("sha256", "s3cret-for-tests").update(raw).digest("hex");
  assert.deepEqual(verifySignature(["other-secret", "s3cret-for-tests"], h({ "x-hub-signature-256": `sha256=${gh}` }), raw), { ok: true, format: "github" });
  assert.deepEqual(verifySignature(["s3cret-for-tests"], h({ "x-hub-signature-256": "sha256=zz" }), raw), { ok: false, reason: "bad_signature" });
  assert.deepEqual(deliveryKeys(h({}), { id: "evt_1" }), [], "a Stripe-looking body without its signature header carries no id");
  assert.deepEqual(deliveryKeys(h({ "stripe-signature": "t=1,v1=ab" }), { id: "evt_1" })[0], "id:evt_1");
  assert.equal(deliveryKeys(h({ "x-hub-signature-256": "sha256=ab" }), {}).length, 0, "a body-only signature is not a delivery id");
  assert.equal(maskIp("203.0.113.50"), "203.0.x.x");
  assert.equal(maskIp("2001:db8:85a3::8a2e:370:7334"), "2001:db8:…");
});
