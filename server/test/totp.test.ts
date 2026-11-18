import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Two-factor sign-in (twofactor.ts, totp.ts): RFC 4226 / RFC 6238 test vectors, set-up with a code, the second step of
// every way in (password, one-time link, e-mail password reset), recovery codes used once, attempts limited, turning it
// off (password + code), other accounts kept out, "sign out of every other device" and the expiry sweep.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-totp-"));
process.env.SESSION_SECRET = "totp-secret-totp-secret-totp-secret-0123";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.TRUST_PROXY = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
for (const k of ["SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { SESSION_COOKIE, unseal, userForToken } = await import("../src/auth.js");
const { sha256, now } = await import("../src/store.js");
const { base32Decode, base32Encode, hotp, verifyTotp } = await import("../src/totp.js");
const tf = await import("../src/twofactor.js");

const ORIGIN = process.env.PUBLIC_URL!;
let ip = 0;
async function call(method: string, url: string, opts: { cookie?: string; body?: unknown; origin?: string | null; ip?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", host: "bots.example.test", "x-forwarded-for": opts.ip ?? `10.0.0.${++ip % 250}` };
  if (opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
  if (opts.cookie) headers.cookie = opts.cookie;
  const res = await api.request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body), redirect: "manual" });
  const cookies = res.headers.getSetCookie();
  const session = cookies.find((c) => c.startsWith(`${SESSION_COOKIE}=`) && !/Max-Age=0/i.test(c))?.split(";")[0] ?? null;
  const pending = cookies.find((c) => c.startsWith(`${tf.TWO_FACTOR_COOKIE}=`) && !/Max-Age=0/i.test(c))?.split(";")[0] ?? null;
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, session, pending, location: res.headers.get("location") };
}
const signup = async (email: string, password: string) => {
  const r = await call("POST", "/auth/signup", { body: { email, password, name: email.split("@")[0], locale: "fr", acceptTerms: true } });
  assert.equal(r.status, 200, r.text);
  return { id: r.json.user.id as string, cookie: r.session! };
};
const codeAt = (secret: string, at = Date.now()) => hotp(base32Decode(secret), Math.floor(at / 1000 / 30));
/** Forget which steps were used, so a test can sign in again within the same 30 seconds. */
const forgetSteps = (userId: string) => q.run("UPDATE two_factor SET last_step = 0 WHERE user_id = ?", userId);

const alice = await signup("alice@example.test", "alice-password-1");
const bob = await signup("bob@example.test", "bob-password-1");
let secret = "";
let recovery: string[] = [];

test("RFC 4226 appendix D (HOTP) and RFC 6238 appendix B (TOTP, SHA-1) test vectors", () => {
  const key = Buffer.from("12345678901234567890", "ascii");
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((c) => hotp(key, c)), ["755224", "287082", "359152", "969429", "338314", "254676", "287922", "162583", "399871", "520489"]);
  const vectors: [number, string][] = [[59, "94287082"], [1111111109, "07081804"], [1111111111, "14050471"], [1234567890, "89005924"], [2000000000, "69279037"], [20000000000, "65353130"]];
  for (const [t, code] of vectors) assert.equal(hotp(key, Math.floor(t / 30), 8), code, `T=${t}`);
  // The same key in base32, as an app would hold it; 6 digits are the last 6 of the 8-digit value.
  const b32 = base32Encode(key);
  assert.equal(b32, "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.deepEqual(base32Decode(b32), key);
  const at = 1111111111_000;
  assert.equal(verifyTotp(b32, "050471", at), Math.floor(1111111111 / 30));
  // ±1 step accepted, not ±2.
  assert.notEqual(verifyTotp(b32, hotp(key, Math.floor(1111111111 / 30) - 1), at), null);
  assert.notEqual(verifyTotp(b32, hotp(key, Math.floor(1111111111 / 30) + 1), at), null);
  assert.equal(verifyTotp(b32, hotp(key, Math.floor(1111111111 / 30) + 2), at), null);
  // A step already used is refused; junk is refused.
  assert.equal(verifyTotp(b32, "050471", at, Math.floor(1111111111 / 30)), null);
  for (const junk of ["", "12345", "1234567", "abcdef", "05047a"]) assert.equal(verifyTotp(b32, junk, at), null);
});

test("set-up: a seed and an otpauth URI, confirmed by a code; 10 recovery codes; the seed sealed with the data key", async () => {
  const st0 = await call("GET", "/account/2fa", { cookie: alice.cookie });
  assert.equal(st0.json.twoFactor.enabled, false);
  const s = await call("POST", "/account/2fa/setup", { cookie: alice.cookie });
  assert.equal(s.status, 200, s.text);
  secret = s.json.secret;
  assert.match(secret, /^[A-Z2-7]{32}$/);
  const uri = new URL(s.json.uri);
  assert.equal(uri.protocol, "otpauth:"); assert.equal(uri.hostname, "totp");
  assert.equal(decodeURIComponent(uri.pathname), "/Sklubot:alice@example.test");
  assert.equal(uri.searchParams.get("secret"), secret); assert.equal(uri.searchParams.get("issuer"), "Sklubot");
  assert.equal(uri.searchParams.get("digits"), "6"); assert.equal(uri.searchParams.get("period"), "30"); assert.equal(uri.searchParams.get("algorithm"), "SHA1");
  // Not on yet: signing in still needs the password only.
  assert.equal(tf.twoFactorOn(alice.id), false);
  const wrong = await call("POST", "/account/2fa/confirm", { cookie: alice.cookie, body: { code: "000000" } });
  assert.equal(wrong.status, 400);
  assert.match(wrong.json.error, /Ce code n'est pas le bon/);
  const ok = await call("POST", "/account/2fa/confirm", { cookie: alice.cookie, body: { code: codeAt(secret) } });
  assert.equal(ok.status, 200, ok.text);
  recovery = ok.json.recoveryCodes;
  assert.equal(recovery.length, 10);
  assert.ok(recovery.every((c) => /^[a-z2-7]{4}-[a-z2-7]{4}-[a-z2-7]{4}$/.test(c)) && new Set(recovery).size === 10);
  assert.deepEqual({ enabled: ok.json.twoFactor.enabled, recoveryLeft: ok.json.twoFactor.recoveryLeft }, { enabled: true, recoveryLeft: 10 });
  const row = q.get<{ secret_enc: string; pending_enc: string | null }>("SELECT secret_enc, pending_enc FROM two_factor WHERE user_id = ?", alice.id)!;
  assert.match(row.secret_enc, /^v2:s0:/); assert.ok(!row.secret_enc.includes(secret)); assert.equal(unseal(row.secret_enc), secret); assert.equal(row.pending_enc, null);
  // Recovery codes are stored hashed only.
  const hashes = q.all<{ code_hash: string }>("SELECT code_hash FROM two_factor_recovery WHERE user_id = ?", alice.id).map((r) => r.code_hash);
  assert.equal(hashes.length, 10);
  assert.ok(recovery.every((c) => !hashes.some((h) => h.includes(c.replace(/-/g, "")))));
  // Setting up again while it is on is refused.
  assert.equal((await call("POST", "/account/2fa/setup", { cookie: alice.cookie })).status, 409);
});

test("password sign-in: no session until the code; a wrong code costs an attempt; the right one opens the session", async () => {
  forgetSteps(alice.id);
  const first = await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } });
  assert.equal(first.status, 200);
  assert.equal(first.session, null, "no session cookie yet");
  assert.equal(first.json.user, undefined, "the account is not sent before the second step");
  assert.ok(first.json.twoFactor.token && first.json.twoFactor.expiresIn === 300);
  assert.ok(first.pending, "the pending token is also in a short-lived cookie (redirect flows)");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", alice.id)!.n, 1, "only the sign-up session exists");
  const bad = await call("POST", "/auth/2fa", { body: { token: first.json.twoFactor.token, code: "123456" } });
  assert.equal(bad.status, 400); assert.equal(bad.json.attemptsLeft, 4); assert.equal(bad.session, null);
  const good = await call("POST", "/auth/2fa", { body: { token: first.json.twoFactor.token, code: codeAt(secret) } });
  assert.equal(good.status, 200, good.text);
  assert.equal(good.json.user.id, alice.id);
  assert.ok(good.session && userForToken(good.session.split("=")[1])?.id === alice.id);
  // The challenge is single use; the same code is not accepted twice (RFC 6238 §5.2).
  assert.equal((await call("POST", "/auth/2fa", { body: { token: first.json.twoFactor.token, code: codeAt(secret) } })).status, 410);
  const again = await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } });
  const replay = await call("POST", "/auth/2fa", { body: { token: again.json.twoFactor.token, code: codeAt(secret) } });
  assert.equal(replay.status, 400, "a code already used is refused");
  // The browser form: the token from the cookie, from our own pages only.
  forgetSteps(alice.id);
  const web = await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } });
  assert.equal((await call("POST", "/auth/2fa", { cookie: web.pending!, origin: "https://evil.example", body: { code: codeAt(secret) } })).status, 403);
  const viaCookie = await call("POST", "/auth/2fa", { cookie: web.pending!, body: { code: codeAt(secret) } });
  assert.equal(viaCookie.status, 200, viaCookie.text);
  assert.ok(viaCookie.session);
  // A wrong password never reaches the second step.
  assert.equal((await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "nope-nope-1" } })).status, 401);
});

test("recovery codes: each works once, and the count goes down", async () => {
  const login = async () => (await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } })).json.twoFactor.token as string;
  const r1 = await call("POST", "/auth/2fa", { body: { token: await login(), code: recovery[0].toUpperCase() } });
  assert.equal(r1.status, 200, r1.text);
  assert.equal(r1.json.recoveryLeft, 9);
  const reuse = await call("POST", "/auth/2fa", { body: { token: await login(), code: recovery[0] } });
  assert.equal(reuse.status, 400);
  assert.equal(tf.twoFactorStatus({ id: alice.id, passHash: "scrypt$" } as any).recoveryLeft, 9);
  // Spaces or no dashes are fine.
  assert.equal((await call("POST", "/auth/2fa", { body: { token: await login(), code: ` ${recovery[1].replace(/-/g, "")} ` } })).status, 200);
});

test("attempts are limited: 5 wrong codes end the pending sign-in; the account and the address are throttled", async () => {
  const token = (await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } })).json.twoFactor.token;
  const statuses: number[] = [];
  for (let i = 0; i < 5; i++) statuses.push((await call("POST", "/auth/2fa", { body: { token, code: "000000" } })).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 410]);
  forgetSteps(alice.id);
  assert.equal((await call("POST", "/auth/2fa", { body: { token, code: codeAt(secret) } })).status, 410, "the right code is too late");
  // Per account: past 10 tries in a quarter hour, even fresh challenges are refused for a while.
  let throttled = false;
  for (let i = 0; i < 12 && !throttled; i++) {
    const t = (await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } })).json?.twoFactor?.token;
    if (!t) break;
    throttled = (await call("POST", "/auth/2fa", { body: { token: t, code: "000000" } })).status === 429;
  }
  assert.ok(throttled, "the account is throttled");
  // Per address: an unknown token from one address is refused after 30 tries.
  const codes: number[] = [];
  for (let i = 0; i < 32; i++) codes.push((await call("POST", "/auth/2fa", { ip: "10.9.9.9", body: { token: `made-up-${i}`, code: "000000" } })).status);
  assert.equal(codes.at(-1), 429);
});

test("the e-mail password reset and the one-time link do not get past two-factor", async () => {
  // Fresh throttles for alice (the previous test filled them): the second step is checked, not the throttle.
  const { users: userStore } = await import("../src/store.js");
  const carol = await signup("carol@example.test", "carol-password-1");
  const cs = (await call("POST", "/account/2fa/setup", { cookie: carol.cookie })).json.secret;
  assert.equal((await call("POST", "/account/2fa/confirm", { cookie: carol.cookie, body: { code: codeAt(cs) } })).status, 200);
  forgetSteps(carol.id);
  // Reset link (as sent by e-mail): the new password is saved, every device signed out, and no session without the code.
  const token = "reset-token-for-carol-0123456789";
  q.run("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), carol.id, now(), now() + 3600_000);
  const reset = await call("POST", "/auth/password/reset", { body: { token, password: "carol-new-password" } });
  assert.equal(reset.status, 200, reset.text);
  assert.equal(reset.session, null);
  assert.ok(reset.json.twoFactor?.token);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", carol.id)!.n, 0);
  assert.equal(tf.twoFactorOn(carol.id), true, "a reset does not turn two-factor off");
  const done = await call("POST", "/auth/2fa", { body: { token: reset.json.twoFactor.token, code: codeAt(cs) } });
  assert.equal(done.status, 200, done.text);
  // The one-time sign-in link printed on the server: redirects to the second step, with the pending cookie only.
  const link = "one-time-link-token-for-carol-01";
  q.run("INSERT INTO sign_in_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(link), carol.id, now() + 60_000);
  const l = await call("GET", `/auth/link?token=${link}`);
  assert.equal(l.status, 302); assert.equal(l.location, "/?second=1");
  assert.equal(l.session, null); assert.ok(l.pending);
  forgetSteps(carol.id);
  assert.equal((await call("POST", "/auth/2fa", { cookie: l.pending!, body: { code: codeAt(cs) } })).status, 200);
  // An account without two-factor signs in as before (one step).
  const b = await call("POST", "/auth/login", { body: { email: "bob@example.test", password: "bob-password-1" } });
  assert.equal(b.status, 200); assert.ok(b.session); assert.equal(b.json.user.id, bob.id);
  assert.equal(userStore.byId(carol.id)?.email, "carol@example.test");
});

test("isolation: another account's code or session cannot finish, change or turn off someone else's two-factor", async () => {
  const bs = (await call("POST", "/account/2fa/setup", { cookie: bob.cookie })).json.secret;
  assert.equal((await call("POST", "/account/2fa/confirm", { cookie: bob.cookie, body: { code: codeAt(bs) } })).status, 200);
  forgetSteps(alice.id); forgetSteps(bob.id);
  q.run("DELETE FROM login_challenges");
  // Bob's valid code does not finish Erin's pending sign-in (Erin: a fresh account, Alice is throttled by now).
  const erin = await signup("erin@example.test", "erin-password-1");
  const es = (await call("POST", "/account/2fa/setup", { cookie: erin.cookie })).json.secret;
  assert.equal((await call("POST", "/account/2fa/confirm", { cookie: erin.cookie, body: { code: codeAt(es) } })).status, 200);
  const t = (await call("POST", "/auth/login", { ip: "10.1.1.1", body: { email: "erin@example.test", password: "erin-password-1" } })).json?.twoFactor?.token;
  assert.ok(t, "erin gets a pending sign-in");
  assert.equal((await call("POST", "/auth/2fa", { ip: "10.1.1.2", body: { token: t, code: codeAt(bs) } })).status, 400);
  // Bob's routes only ever touch Bob: disabling with Alice's code fails, and Alice stays on.
  const off = await call("POST", "/account/2fa/disable", { cookie: bob.cookie, body: { password: "bob-password-1", code: codeAt(secret) } });
  assert.equal(off.status, 400);
  assert.equal(tf.twoFactorOn(alice.id), true);
  assert.equal((await call("GET", "/account/2fa", { cookie: bob.cookie })).json.twoFactor.recoveryLeft, 10);
  // Without a session: 401.
  for (const [m, u] of [["GET", "/account/2fa"], ["POST", "/account/2fa/setup"], ["POST", "/account/2fa/confirm"], ["POST", "/account/2fa/disable"], ["POST", "/account/2fa/recovery"], ["POST", "/account/sessions/revoke-others"]]) {
    assert.equal((await call(m, u, {})).status, 401, `${m} ${u}`);
  }
  // From another site, with Bob's cookie: refused before anything happens.
  assert.equal((await call("POST", "/account/2fa/disable", { cookie: bob.cookie, origin: "https://evil.example", body: { password: "bob-password-1", code: codeAt(bs) } })).status, 403);
  // The hosted administration route does not exist outside hosted mode.
  assert.equal((await call("POST", `/admin/customers/${alice.id}/sessions/revoke`, { cookie: alice.cookie })).status, 404);
});

test("regenerate recovery codes (needs a code from the app), turn off (needs the password and a code)", async () => {
  forgetSteps(alice.id);
  assert.equal((await call("POST", "/account/2fa/recovery", { cookie: alice.cookie, body: { code: recovery[5] } })).status, 400, "a recovery code cannot make new ones");
  const regen = await call("POST", "/account/2fa/recovery", { cookie: alice.cookie, body: { code: codeAt(secret) } });
  assert.equal(regen.status, 200, regen.text);
  assert.equal(regen.json.recoveryCodes.length, 10);
  assert.ok(!regen.json.recoveryCodes.includes(recovery[5]));
  assert.equal(regen.json.twoFactor.recoveryLeft, 10);
  const fresh = regen.json.recoveryCodes as string[];
  // The old codes no longer work.
  assert.equal(tf.checkSecondFactor(alice.id, recovery[5]), null);
  // Turning off: wrong password, then wrong code, then right.
  assert.equal((await call("POST", "/account/2fa/disable", { cookie: alice.cookie, body: { password: "wrong-password", code: fresh[0] } })).status, 401);
  assert.equal((await call("POST", "/account/2fa/disable", { cookie: alice.cookie, body: { password: "alice-password-1", code: "111111" } })).status, 400);
  assert.equal(tf.twoFactorOn(alice.id), true);
  const off = await call("POST", "/account/2fa/disable", { cookie: alice.cookie, body: { password: "alice-password-1", code: fresh[0] } });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.json.twoFactor.enabled, false);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ?", alice.id)!.n, 0);
  const plain = await call("POST", "/auth/login", { ip: "10.2.2.2", body: { email: "alice@example.test", password: "alice-password-1" } });
  assert.ok(plain.session, "one step again");
});

test("sign out of every other device; expired sessions and pending sign-ins are swept", async () => {
  const other1 = (await call("POST", "/auth/login", { ip: "10.3.3.3", body: { email: "alice@example.test", password: "alice-password-1" } })).session!;
  const other2 = (await call("POST", "/auth/login", { ip: "10.3.3.4", body: { email: "alice@example.test", password: "alice-password-1" } })).session!;
  const before = (await call("GET", "/account/2fa", { cookie: alice.cookie })).json.sessions;
  assert.ok(before >= 3);
  const r = await call("POST", "/account/sessions/revoke-others", { cookie: alice.cookie });
  assert.equal(r.status, 200, r.text);
  assert.ok(r.json.revoked >= 2); assert.equal(r.json.sessions, 1);
  assert.equal((await call("GET", "/account/2fa", { cookie: other1 })).status, 401);
  assert.equal((await call("GET", "/account/2fa", { cookie: other2 })).status, 401);
  assert.equal((await call("GET", "/account/2fa", { cookie: alice.cookie })).status, 200, "this device stays signed in");
  // Sweep: an expired session and an expired challenge are deleted; live ones stay.
  q.run("INSERT INTO sessions (token_hash, user_id, created_at, expires_at) VALUES ('old', ?, 1, 2)", alice.id);
  q.run("INSERT INTO login_challenges (token_hash, user_id, via, created_at, expires_at) VALUES ('oldch', ?, 'password', 1, 2)", alice.id);
  const swept = tf.sweepExpired();
  assert.ok(swept.sessions >= 1 && swept.challenges >= 1);
  assert.equal(q.get("SELECT 1 FROM sessions WHERE token_hash = 'old'"), undefined);
  assert.equal((await call("GET", "/account/2fa", { cookie: alice.cookie })).status, 200);
});

test("hosted mode: an operator signs an account out of every device (logged); a customer cannot", async () => {
  process.env.HOSTED_MODE = "1";
  try {
    const d = await signup("dave@example.test", "dave-password-1");
    // Bob is not an operator (Alice, the oldest account, is the owner): the route does not exist for him.
    assert.equal((await call("POST", `/admin/customers/${d.id}/sessions/revoke`, { cookie: bob.cookie })).status, 404);
    const r = await call("POST", `/admin/customers/${d.id}/sessions/revoke`, { cookie: alice.cookie });
    assert.equal(r.status, 200, r.text);
    assert.ok(r.json.revoked >= 1);
    assert.equal((await call("GET", "/account/2fa", { cookie: d.cookie })).status, 401);
    assert.ok(q.get("SELECT 1 FROM admin_audit WHERE action = 'sessions-revoke' AND target_id = ?", d.id), "in the administration log");
    assert.equal((await call("POST", "/admin/customers/nope/sessions/revoke", { cookie: alice.cookie })).status, 404);
  } finally { delete process.env.HOSTED_MODE; }
});
