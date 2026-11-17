import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Ouverture publique" off (the default: OPEN_SIGNUP and HOSTED_MODE unset): no landing page, no Turnstile even with keys,
// no verification even with SMTP, no first run, no free computers — the server behaves exactly as before.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-public-off-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.TURNSTILE_SITE_KEY = "site";
process.env.TURNSTILE_SECRET_KEY = "secret";
process.env.SMTP_HOST = "127.0.0.1";
process.env.SMTP_FROM = "robot@example.test";
for (const k of ["OPEN_SIGNUP", "HOSTED_MODE", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "ALLOWED_EMAILS"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, bots } = await import("../src/store.js");
const ps = await import("../src/publicsignup.js");
const { machineOf } = await import("../src/linux.js");
await import("../src/freecomputers.js");

let calls = 0;
ps._setSiteverify(async () => { calls++; return { success: false }; });

async function call(method: string, url: string, body?: unknown, cookie = "") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* */ }
  return { status: res.status, json, text, cookie: res.headers.getSetCookie().map((s) => s.split(";")[0]).find((s) => s.startsWith("sklubot_session=")) ?? "" };
}

test("off: no landing, no site key, the first account and an invited one sign up as before, without any check", async () => {
  const me = await call("GET", "/me");
  assert.equal(me.json.landing, undefined);
  assert.equal(me.json.turnstileSiteKey, undefined);
  assert.deepEqual(Object.keys(me.json).sort(), ["firstBot", "imageGeneration", "setupCodeRequired", "signupOpen", "user", "video"]);
  assert.equal((await call("GET", "/public/landing")).status, 404);
  const owner = await call("POST", "/auth/signup", { email: "owner@example.test", password: "password-123" });
  assert.equal(owner.status, 200);
  assert.deepEqual(Object.keys(owner.json.user).sort(), ["email", "id", "locale", "name"]);
  // Sign-ups are closed after the first account (as before); nothing about Turnstile or verification is asked.
  assert.equal((await call("POST", "/auth/signup", { email: "x@mailinator.com", password: "password-123" })).status, 403);
  assert.equal(calls, 0);
  assert.equal(ps.verificationActive(), false);
  // An account made another way is not held, and gets no first run.
  const u = users.create("late@example.test", "Late", "x", "en");
  ps.accountOpened(u, { first: false, verified: false });
  assert.equal(ps.emailUnverified(u.id), false);
  assert.equal(q.get<{ onboarding_pending: number }>("SELECT onboarding_pending FROM users WHERE id = ?", u.id)!.onboarding_pending, 0);
  assert.equal((await call("POST", "/onboarding/commit", { template: "secretariat" }, owner.cookie)).status, 409);
  const resend = await call("POST", "/account/verify-email/resend", undefined, owner.cookie);
  assert.equal(resend.status, 200); assert.equal(resend.json.verified, true);
  // Even a row marked pending is not held on a private server, and nothing is ever swept.
  q.run("UPDATE users SET email_verify_pending = 1 WHERE id = ?", u.id);
  assert.equal(ps.emailGateBlocks(u.id), false);
  assert.deepEqual(await ps.sweepUnverified(Date.now() + 1000 * 3_600_000), []);
  assert.ok(users.byId(u.id));
  // Every bot keeps its own computer (no free pool outside hosted mode).
  const main = bots.primary(users.byEmail("owner@example.test")!.id)!;
  assert.equal(machineOf(main.id), main.id);
});
