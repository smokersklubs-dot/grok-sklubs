import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

// "Ouverture publique" (publicsignup.ts): the landing page's data, Turnstile (a fake Siteverify), the sign-up rate limits
// and disposable addresses, e-mail verification (a fake SMTP server), the bots' wait for it, and the guided first run.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-public-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.TRUST_PROXY = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.OPEN_SIGNUP = "1";
process.env.TURNSTILE_SITE_KEY = "site-key-public";
process.env.TURNSTILE_SECRET_KEY = "secret-key-NEVER-SENT";
process.env.SIGNUP_PER_IP = "3";
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "EMAIL_VERIFICATION", "DISPOSABLE_EMAIL_BLOCK", "SIGNUP_GLOBAL"]) delete process.env[k];

const inbox: { to: string[]; subject: string; text: string }[] = [];
const smtp = new SMTPServer({
  authOptional: true, allowInsecureAuth: true, disabledCommands: ["STARTTLS", "AUTH"], logger: false, disableReverseLookup: true,
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", async () => { const p = await simpleParser(Buffer.concat(chunks)); inbox.push({ to: session.envelope.rcptTo.map((r) => r.address), subject: p.subject ?? "", text: p.text ?? "" }); cb(); });
  },
});
const smtpPort: number = await new Promise((r) => { const s = smtp.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)); });
after(() => new Promise<void>((r) => smtp.close(() => r())));

const printed: string[] = [];
for (const k of ["log", "error", "warn", "info"] as const) { const orig = console[k].bind(console); console[k] = (...a: unknown[]) => { printed.push(a.map(String).join(" ")); orig(...a); }; }

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, bots } = await import("../src/store.js");
const ps = await import("../src/publicsignup.js");
const { appCsp } = await import("../src/hardening.js");

// The fake Siteverify: records what it got, answers what the test says.
const verified: Record<string, unknown>[] = [];
let answer: { success: boolean; hostname?: string; action?: string; "error-codes"?: string[] } | "down" = { success: true, hostname: "sklubot.example", action: "signup" };
ps._setSiteverify(async (body) => { verified.push(body); if (answer === "down") throw new Error("unreachable"); return answer; });

type Res = { status: number; json: any; text: string; cookie: string };
let ipN = 0;
async function call(method: string, url: string, o: { body?: unknown; cookie?: string; ip?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? `203.0.113.${++ipN % 250}` };
  if (o.cookie) headers.cookie = o.cookie;
  const res = await api.request(url, { method, headers, body: o.body === undefined ? undefined : JSON.stringify(o.body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  const set = res.headers.getSetCookie().map((s) => s.split(";")[0]).find((s) => s.startsWith("sklubot_session=") && s.length > 20) ?? "";
  return { status: res.status, json, text, cookie: set };
}
const until = async <T>(probe: () => T | undefined | null | false, label: string): Promise<T> => {
  for (let i = 0; i < 400; i++) { const v = probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
};

// The owner: the first account (no Turnstile, no verification, no first run).
const owner = await call("POST", "/auth/signup", { body: { email: "owner@example.test", password: "owner-password-1", locale: "fr" } });
assert.equal(owner.status, 200, owner.text);

test("the owner (first account) needs no anti-robot check, no verification and no first run; existing accounts are grandfathered", () => {
  assert.equal(verified.length, 0);
  assert.equal(owner.json.user.emailUnverified, undefined);
  assert.equal(owner.json.user.onboarding, undefined);
  const r = q.get<{ email_verify_pending: number; onboarding_pending: number }>("SELECT email_verify_pending, onboarding_pending FROM users WHERE email = 'owner@example.test'")!;
  assert.deepEqual({ ...r }, { email_verify_pending: 0, onboarding_pending: 0 });
});

test("the landing page's data and /me: templates, the site key — never the secret", async () => {
  const me = await call("GET", "/me");
  assert.equal(me.json.landing, true);
  assert.equal(me.json.turnstileSiteKey, "site-key-public");
  const landing = await call("GET", "/public/landing?locale=fr");
  assert.equal(landing.status, 200);
  assert.ok(landing.json.templates.length >= 5);
  assert.ok(landing.json.templates[0].bots[0].look.shape);
  assert.equal(landing.json.hosted, null, "no plans outside hosted mode");
  assert.equal(landing.json.turnstile, true);
  for (const t of [me.text, landing.text]) { assert.ok(!t.includes("NEVER-SENT")); assert.ok(!/Consignes|instructions/.test(t), "no template instructions"); }
  // The app's CSP lets Turnstile's script and frame in only when it is configured.
  assert.match(appCsp([], { turnstile: true }), /script-src 'self' https:\/\/challenges\.cloudflare\.com;.*frame-src 'self' blob: https:\/\/challenges\.cloudflare\.com/);
  assert.doesNotMatch(appCsp([]), /cloudflare/);
});

test("Turnstile: no token, a refused token, Siteverify down, another site's token → no account; a good one → account", async () => {
  const body = (email: string, extra: Record<string, unknown> = {}) => ({ email, password: "password-123", locale: "en", ...extra });
  let r = await call("POST", "/auth/signup", { body: body("nobody1@example.org") });
  assert.equal(r.status, 400); assert.equal(r.json.code, "turnstile"); assert.match(r.json.error, /anti-robot/);
  answer = { success: false, "error-codes": ["invalid-input-response"] };
  r = await call("POST", "/auth/signup", { body: body("nobody2@example.org", { turnstileToken: "bad-token" }) });
  assert.equal(r.status, 403); assert.equal(r.json.code, "turnstile");
  answer = "down";
  r = await call("POST", "/auth/signup", { body: body("nobody3@example.org", { turnstileToken: "tok" }) });
  assert.equal(r.status, 403, "fail closed");
  answer = { success: true, hostname: "evil.example", action: "signup" };
  r = await call("POST", "/auth/signup", { body: body("nobody4@example.org", { turnstileToken: "tok" }) });
  assert.equal(r.status, 403, "solved on another site");
  answer = { success: true, hostname: "sklubot.example", action: "login" };
  r = await call("POST", "/auth/signup", { body: body("nobody5@example.org", { turnstileToken: "tok" }) });
  assert.equal(r.status, 403, "another action");
  r = await call("POST", "/auth/signup", { body: body("nobody6@example.org", { turnstileToken: "x".repeat(2049) }) });
  assert.equal(r.status, 400, "over 2048 characters: not even sent");
  for (const e of ["nobody1", "nobody2", "nobody3", "nobody4", "nobody5", "nobody6"]) assert.equal(users.byEmail(`${e}@example.org`), null);
  answer = { success: true, hostname: "sklubot.example", action: "signup" };
  const n = verified.length;
  r = await call("POST", "/auth/signup", { body: body("carol@example.org", { turnstileToken: "good-token" }), ip: "198.51.100.77" });
  assert.equal(r.status, 200, r.text);
  const sent = verified[n];
  assert.equal(sent.secret, "secret-key-NEVER-SENT");
  assert.equal(sent.response, "good-token");
  assert.equal(sent.remoteip, "198.51.100.77");
  assert.match(String(sent.idempotency_key), /^[0-9a-f-]{36}$/);
  assert.equal(verified.length, n + 1);
});

test("disposable addresses are refused (and allowed again with DISPOSABLE_EMAIL_BLOCK=0)", async () => {
  const r = await call("POST", "/auth/signup", { body: { email: "x@mailinator.com", password: "password-123", turnstileToken: "t" } });
  assert.equal(r.status, 400); assert.equal(r.json.code, "disposable_email");
  assert.equal(ps.disposableEmail("a@sub.yopmail.com"), true);
  assert.equal(ps.disposableEmail("a@gmail.com"), false);
  process.env.DISPOSABLE_EMAIL_BLOCK = "0";
  assert.equal(ps.disposableEmail("a@mailinator.com"), false);
  delete process.env.DISPOSABLE_EMAIL_BLOCK;
});

test("rate limits: SIGNUP_PER_IP attempts per address, then a refusal; another address goes on; SIGNUP_GLOBAL caps everyone", async () => {
  const ip = "192.0.2.10";
  const codes: number[] = [];
  for (let i = 0; i < 4; i++) codes.push((await call("POST", "/auth/signup", { body: { email: `burst${i}@example.org`, password: "password-123", turnstileToken: "t" }, ip })).status);
  assert.deepEqual(codes, [200, 200, 200, 403]);
  assert.equal(users.byEmail("burst3@example.org"), null);
  assert.equal((await call("POST", "/auth/signup", { body: { email: "other@example.org", password: "password-123", turnstileToken: "t" }, ip: "192.0.2.11" })).status, 200);
  process.env.SIGNUP_GLOBAL = "1";
  const r = await call("POST", "/auth/signup", { body: { email: "global@example.org", password: "password-123", turnstileToken: "t" }, ip: "192.0.2.12" });
  assert.equal(r.status, 403);
  delete process.env.SIGNUP_GLOBAL;
});

test("without SMTP, verification is skipped: the account is verified from the start", async () => {
  const carol = users.byEmail("carol@example.org")!;
  assert.equal(ps.emailUnverified(carol.id), false);
  assert.ok(q.get<{ email_verified_at: number | null }>("SELECT email_verified_at FROM users WHERE id = ?", carol.id)!.email_verified_at);
  assert.equal(inbox.length, 0);
});

let dana: Res;
test("with SMTP: a new account gets a single-use 24 h link (hashed), can sign in, but its bots wait; resend; confirm", async () => {
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(smtpPort); process.env.SMTP_TLS = "none"; process.env.SMTP_FROM = "robot@sklubot.example";
  assert.equal(ps.verificationActive(), true);
  dana = await call("POST", "/auth/signup", { body: { email: "dana@example.org", password: "password-123", locale: "fr", turnstileToken: "t" } });
  assert.equal(dana.status, 200, dana.text);
  assert.equal(dana.json.user.emailUnverified, true);
  assert.equal(dana.json.user.onboarding, true);
  const mail = await until(() => inbox.find((m) => m.to.includes("dana@example.org")), "verification e-mail");
  assert.match(mail.subject, /confirme ton adresse/);
  const token = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  const row = q.get<{ token_hash: string; expires_at: number; created_at: number }>("SELECT * FROM email_verifications WHERE user_id = ?", users.byEmail("dana@example.org")!.id)!;
  assert.notEqual(row.token_hash, token, "only the hash is stored");
  assert.equal(row.expires_at - row.created_at, 24 * 3_600_000);
  assert.ok(!printed.some((l) => l.includes(token)), "the token is never logged");

  // Signed in, but the bot does not work: a message gets a notice instead of a turn.
  const main = bots.primary(users.byEmail("dana@example.org")!.id)!;
  const sent = await call("POST", `/bots/${main.id}/messages`, { cookie: dana.cookie, body: { text: "Bonjour" } });
  assert.equal(sent.status, 200, sent.text);
  await until(() => q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ?", main.id).some((r) => /Confirme d'abord ton adresse e-mail/.test(r.body)), "the waiting notice");

  // Resend: a new link replaces the old one (the old one stops working); throttled.
  const resend = await call("POST", "/account/verify-email/resend", { cookie: dana.cookie });
  assert.equal(resend.status, 200); assert.equal(resend.json.verified, false);
  const mail2 = await until(() => inbox.filter((m) => m.to.includes("dana@example.org"))[1], "second e-mail");
  const token2 = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail2.text)![1];
  assert.equal((await call("POST", "/auth/verify-email", { body: { token } })).status, 400, "the replaced link");
  assert.equal((await call("POST", "/auth/verify-email", { body: { token: token2 }, cookie: "" })).status, 200);
  assert.equal((await call("POST", "/auth/verify-email", { body: { token: token2 } })).status, 400, "single use");
  assert.equal(ps.emailUnverified(main.userId), false);
  const me = await call("GET", "/me", { cookie: dana.cookie });
  assert.equal(me.json.user.emailUnverified, undefined);
  // Already verified: resend says so and sends nothing.
  assert.equal((await call("POST", "/account/verify-email/resend", { cookie: dana.cookie })).json.verified, true);
  // A link from another site is refused.
  const cross = await api.request("/auth/verify-email", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", host: "sklubot.example" }, body: JSON.stringify({ token: "x" }) });
  assert.equal(cross.status, 403);
});

test("an expired link does not verify", async () => {
  const eve = await call("POST", "/auth/signup", { body: { email: "eve@example.org", password: "password-123", turnstileToken: "t" } });
  const mail = await until(() => inbox.find((m) => m.to.includes("eve@example.org")), "e-mail");
  const token = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  q.run("UPDATE email_verifications SET expires_at = ? WHERE user_id = ?", Date.now() - 1, users.byEmail("eve@example.org")!.id);
  assert.equal((await call("POST", "/auth/verify-email", { body: { token } })).status, 400);
  assert.equal(ps.emailUnverified(users.byEmail("eve@example.org")!.id), true);
  // SMTP gone: verification can no longer happen, so the account is not held (the owner is warned by the Sentinelle).
  const host = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
  assert.equal(ps.emailUnverified(users.byEmail("eve@example.org")!.id), false);
  const { DETECTORS } = await import("../src/sentinel/detectors.js");
  const obs = await DETECTORS.find((d) => d.name === "public_signup")!.run({ now: Date.now() });
  assert.deepEqual(obs.map((o) => o.fingerprint).sort(), ["public_signup:no_mail"]);
  process.env.SMTP_HOST = host;
  assert.ok(eve.cookie);
});

test("Google sign-in counts as verified", () => {
  const u = users.create("gina@example.org", "Gina", "x", "en");
  ps.accountOpened(u, { first: false, verified: true });
  assert.equal(ps.emailUnverified(u.id), false);
  assert.equal(inbox.some((m) => m.to.includes("gina@example.org")), false);
  // An account waiting for its link is verified by a later Google sign-in (googlelogin.ts calls markVerified).
  const eve = users.byEmail("eve@example.org")!;
  q.run("UPDATE users SET email_verify_pending = 1 WHERE id = ?", eve.id);
  ps.markVerified(eve.id);
  assert.equal(ps.emailUnverified(eve.id), false);
});

test("first run: a template within the plan's room, careful bots, first one renamed; once only; or one assistant; or skip", async () => {
  const user = users.byEmail("dana@example.org")!;
  const r = await call("POST", "/onboarding/commit", { cookie: dana.cookie, body: { template: "boutique-en-ligne", name: "Mia" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.bots.length, 2);
  const mia = bots.byId(r.json.botId)!;
  assert.equal(mia.name, "Mia");
  assert.equal(mia.userId, user.id);
  assert.equal(mia.autonomy, "careful");
  assert.equal(mia.model, "");
  assert.ok(r.json.ideas.length >= 1);
  assert.equal((await call("GET", "/me", { cookie: dana.cookie })).json.user.onboarding, undefined);
  assert.equal((await call("POST", "/onboarding/commit", { cookie: dana.cookie, body: { template: "boutique-en-ligne" } })).status, 409);
  // "Un seul assistant": the main bot keeps its place and takes the name.
  const login = await call("POST", "/auth/login", { body: { email: "carol@example.org", password: "password-123" } });
  const one = await call("POST", "/onboarding/commit", { cookie: login.cookie, body: { name: "Rosa" } });
  assert.equal(one.status, 200, one.text);
  assert.equal(bots.byId(one.json.botId)!.name, "Rosa");
  assert.equal(bots.byId(one.json.botId)!.primary, true);
  assert.equal((await call("POST", "/onboarding/commit", { cookie: login.cookie, body: { template: "nope" } })).status, 409);
  const other = await call("POST", "/auth/login", { body: { email: "other@example.org", password: "password-123" } });
  assert.equal((await call("POST", "/onboarding/commit", { cookie: other.cookie, body: { template: "nope" } })).status, 404);
  assert.equal((await call("POST", "/onboarding/skip", { cookie: other.cookie })).status, 200);
  assert.equal((await call("GET", "/me", { cookie: other.cookie })).json.user.onboarding, undefined);
});
