import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

// "Ouverture publique" (publicsignup.ts): the landing page's data, Turnstile (a fake Siteverify), the sign-up rate limits
// and disposable addresses, MANDATORY e-mail verification (a fake SMTP server): no SMTP → password sign-ups refused, the
// held account's 403s and its deadline, the first bot made only once verified, the sweep of expired accounts, and the
// guided first run.
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

test("without SMTP: password sign-ups are refused with a clear message (Turnstile not spent); Google sign-ups still work; the Sentinelle says critical", async () => {
  const n = verified.length;
  const r = await call("POST", "/auth/signup", { body: { email: "nomail@example.org", password: "password-123", locale: "fr", turnstileToken: "t" } });
  assert.equal(r.status, 403, r.text);
  assert.equal(r.json.code, "email_signup_closed");
  assert.match(r.json.error, /Les inscriptions par e-mail sont fermées tant que les e-mails du serveur ne sont pas réglés — utilise « Continuer avec Google »/);
  assert.equal(users.byEmail("nomail@example.org"), null);
  assert.equal(verified.length, n, "the single-use Turnstile token was not used");
  // Google proves the address: such an account is not held (googlelogin.ts calls accountOpened with verified: true).
  const g = users.create("googler@example.org", "G", "x", "en");
  assert.equal(ps.accountOpened(g, { first: false, verified: true }), false);
  assert.equal(ps.emailGateBlocks(g.id), false);
  const { DETECTORS } = await import("../src/sentinel/detectors.js");
  const obs = await DETECTORS.find((d) => d.name === "public_signup")!.run({ now: Date.now() });
  assert.deepEqual(obs.map((o) => [o.fingerprint, o.severity]), [["public_signup:no_mail", "critical"]]);
  // The operator may turn verification off explicitly (EMAIL_VERIFICATION=0): sign-ups work, verified from the start; warned.
  process.env.EMAIL_VERIFICATION = "0";
  const off = await call("POST", "/auth/signup", { body: { email: "carol@example.org", password: "password-123", turnstileToken: "t" } });
  assert.equal(off.status, 200, off.text);
  assert.equal(off.json.user.emailUnverified, undefined);
  assert.ok(bots.primary(off.json.user.id), "its first bot right away");
  const obs2 = await DETECTORS.find((d) => d.name === "public_signup")!.run({ now: Date.now() });
  assert.deepEqual(obs2.map((o) => [o.fingerprint, o.severity]), [["public_signup:no_verification", "warn"]]);
  delete process.env.EMAIL_VERIFICATION;
  // From here on the server can send e-mails.
  process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(smtpPort); process.env.SMTP_TLS = "none"; process.env.SMTP_FROM = "robot@sklubot.example";
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
  r = await call("POST", "/auth/signup", { body: body("frank@example.org", { turnstileToken: "good-token" }), ip: "198.51.100.77" });
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

let dana: Res;
test("with SMTP: a held account — link valid until its deadline (hashed, single use), no bot yet, 403 email_unverified everywhere but resend/confirm; confirming makes its first bot", async () => {
  assert.equal(ps.verificationActive(), true);
  dana = await call("POST", "/auth/signup", { body: { email: "dana@example.org", password: "password-123", locale: "fr", turnstileToken: "t", botName: "Iris", botLabel: "Assistante" } });
  assert.equal(dana.status, 200, dana.text);
  assert.equal(dana.json.user.emailUnverified, true);
  assert.equal(dana.json.user.onboarding, true);
  const id = dana.json.user.id as string;
  const created = q.get<{ created_at: number }>("SELECT created_at FROM users WHERE id = ?", id)!.created_at;
  assert.equal(dana.json.user.emailVerifyDeadline, created + 5 * 3_600_000, "deleted 5 h after sign-up by default");
  assert.equal(bots.primary(id), null, "no bot before the address is confirmed");
  const mail = await until(() => inbox.find((m) => m.to.includes("dana@example.org")), "verification e-mail");
  assert.match(mail.subject, /confirme ton adresse/);
  assert.match(mail.text, /dans les 5 heure\(s\), le compte et ses données sont supprimés/);
  const token = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  const row = q.get<{ token_hash: string; expires_at: number; created_at: number }>("SELECT * FROM email_verifications WHERE user_id = ?", id)!;
  assert.notEqual(row.token_hash, token, "only the hash is stored");
  assert.equal(row.expires_at, created + 5 * 3_600_000, "the link lives until the account's deadline, no longer");
  assert.ok(!printed.some((l) => l.includes(token)), "the token is never logged");

  // Signed in (and again with the password), but held: every other route answers 403 email_unverified.
  const login = await call("POST", "/auth/login", { body: { email: "dana@example.org", password: "password-123" } });
  assert.equal(login.status, 200); assert.equal(login.json.user.emailUnverified, true);
  for (const [method, url] of [["GET", "/bots"], ["POST", "/bots"], ["POST", "/onboarding/commit"], ["GET", "/today"], ["POST", "/workspaces"], ["GET", "/usage"]] as const) {
    const res = await call(method, url, { cookie: dana.cookie, ...(method === "GET" ? {} : { body: {} }) });
    assert.equal(res.status, 403, `${method} ${url}`);
    assert.equal(res.json.code, "email_unverified");
    assert.match(res.json.error, /Confirme ton adresse e-mail pour utiliser Sklubot/);
  }
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", id)!.n, 0);

  // Resend: a new link replaces the old one (the old one stops working) and does not go past the deadline; throttled.
  const resend = await call("POST", "/account/verify-email/resend", { cookie: dana.cookie });
  assert.equal(resend.status, 200); assert.equal(resend.json.verified, false);
  const mail2 = await until(() => inbox.filter((m) => m.to.includes("dana@example.org"))[1], "second e-mail");
  const token2 = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail2.text)![1];
  assert.equal(q.get<{ expires_at: number }>("SELECT expires_at FROM email_verifications WHERE user_id = ?", id)!.expires_at, created + 5 * 3_600_000, "a resend does not extend the deadline");
  assert.equal((await call("POST", "/auth/verify-email", { body: { token } })).status, 400, "the replaced link");
  assert.equal((await call("POST", "/auth/verify-email", { body: { token: token2 }, cookie: "" })).status, 200);
  assert.equal((await call("POST", "/auth/verify-email", { body: { token: token2 } })).status, 400, "single use");
  assert.equal(ps.emailGateBlocks(id), false);
  const me = await call("GET", "/me", { cookie: dana.cookie });
  assert.equal(me.json.user.emailUnverified, undefined);
  assert.equal(me.json.user.emailVerifyDeadline, undefined);
  // The first bot now exists, with the name and role chosen on the form; the app opens.
  const main = bots.primary(id)!;
  assert.equal(main.name, "Iris"); assert.equal(main.label, "Assistante");
  assert.equal((await call("GET", "/bots", { cookie: dana.cookie })).status, 200);
  // Already verified: resend says so and sends nothing.
  assert.equal((await call("POST", "/account/verify-email/resend", { cookie: dana.cookie })).json.verified, true);
  // A link from another site is refused.
  const cross = await api.request("/auth/verify-email", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", host: "sklubot.example" }, body: JSON.stringify({ token: "x" }) });
  assert.equal(cross.status, 403);
});

test("an expired link does not verify; SMTP gone later: the account stays held (Google is the way out), resend says why", async () => {
  const eve = await call("POST", "/auth/signup", { body: { email: "eve@example.org", password: "password-123", turnstileToken: "t" } });
  const mail = await until(() => inbox.find((m) => m.to.includes("eve@example.org")), "e-mail");
  const token = /\?verify_email=([A-Za-z0-9_-]+)/.exec(mail.text)![1];
  q.run("UPDATE email_verifications SET expires_at = ? WHERE user_id = ?", Date.now() - 1, users.byEmail("eve@example.org")!.id);
  assert.equal((await call("POST", "/auth/verify-email", { body: { token } })).status, 400);
  assert.equal(ps.emailGateBlocks(users.byEmail("eve@example.org")!.id), true);
  const host = process.env.SMTP_HOST; delete process.env.SMTP_HOST;
  assert.equal(ps.emailGateBlocks(users.byEmail("eve@example.org")!.id), true, "strict: never let in without proof");
  const r = await call("POST", "/account/verify-email/resend", { cookie: eve.cookie });
  assert.equal(r.status, 409); assert.equal(r.json.code, "no_mail");
  process.env.SMTP_HOST = host;
});

test("Google sign-in counts as verified, and verifies an account waiting for its link (its first bot appears)", () => {
  const u = users.create("gina@example.org", "Gina", "x", "en");
  ps.accountOpened(u, { first: false, verified: true });
  assert.equal(ps.emailGateBlocks(u.id), false);
  assert.equal(inbox.some((m) => m.to.includes("gina@example.org")), false);
  const eve = users.byEmail("eve@example.org")!;
  assert.equal(bots.primary(eve.id), null);
  ps.markVerified(eve.id); // what googlelogin.ts does for an existing account with Google's verified address
  assert.equal(ps.emailGateBlocks(eve.id), false);
  assert.ok(bots.primary(eve.id));
});

test("the owner is never held, and accounts unconfirmed past UNVERIFIED_ACCOUNT_TTL_HOURS are deleted (with a line in the owner's log)", async () => {
  const ownerId = owner.json.user.id as string;
  const fresh = await call("POST", "/auth/signup", { body: { email: "late@example.org", password: "password-123", turnstileToken: "t" } });
  assert.equal(fresh.status, 200);
  const late = fresh.json.user.id as string;
  const old = users.byEmail("burst0@example.org")!.id;
  // Even marked pending, the owner passes.
  q.run("UPDATE users SET email_verify_pending = 1 WHERE id = ?", ownerId);
  assert.equal(ps.emailGateBlocks(ownerId), false);
  assert.equal((await call("GET", "/bots", { cookie: owner.cookie })).status, 200);
  ps.markVerified(users.byEmail("other@example.org")!.id); // confirmed: kept (the first run below uses it)
  // Before the deadline: nothing goes.
  assert.deepEqual(await ps.sweepUnverified(), []);
  // 5 h and a minute later: every held account but the owner and the confirmed ones is deleted.
  const done = await ps.sweepUnverified(Date.now() + 5 * 3_600_000 + 60_000);
  assert.ok(done.includes("late@example.org") && done.includes("burst0@example.org"), done.join(","));
  assert.equal(users.byId(late), null); assert.equal(users.byId(old), null);
  assert.ok(users.byId(ownerId)); assert.ok(users.byEmail("dana@example.org")); assert.ok(users.byEmail("carol@example.org"));
  assert.ok(q.all<{ text: string }>("SELECT text FROM audit WHERE user_id = ?", ownerId).some((a) => /Unverified account late@example\.org deleted automatically/.test(a.text)));
  assert.equal((await call("GET", "/me", { cookie: fresh.cookie })).json.user, null, "its session is gone");
  // The delay is the operator's (in hours), and a sign-up's link follows it.
  process.env.UNVERIFIED_ACCOUNT_TTL_HOURS = "2";
  const two = await call("POST", "/auth/signup", { body: { email: "two@example.org", password: "password-123", turnstileToken: "t" } });
  const created = q.get<{ created_at: number }>("SELECT created_at FROM users WHERE id = ?", two.json.user.id)!.created_at;
  assert.equal(two.json.user.emailVerifyDeadline, created + 2 * 3_600_000);
  assert.equal(q.get<{ expires_at: number }>("SELECT expires_at FROM email_verifications WHERE user_id = ?", two.json.user.id)!.expires_at, created + 2 * 3_600_000);
  delete process.env.UNVERIFIED_ACCOUNT_TTL_HOURS;
  q.run("UPDATE users SET email_verify_pending = 0 WHERE id = ?", ownerId);
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
  q.run("UPDATE users SET onboarding_pending = 1 WHERE email = 'carol@example.org'");
  const one = await call("POST", "/onboarding/commit", { cookie: login.cookie, body: { name: "Rosa" } });
  assert.equal(one.status, 200, one.text);
  assert.equal(bots.byId(one.json.botId)!.name, "Rosa");
  assert.equal(bots.byId(one.json.botId)!.primary, true);
  assert.equal((await call("POST", "/onboarding/commit", { cookie: login.cookie, body: { template: "nope" } })).status, 409);
  const other = await call("POST", "/auth/login", { body: { email: "other@example.org", password: "password-123" } });
  ps.markVerified(users.byEmail("other@example.org")!.id);
  assert.equal((await call("POST", "/onboarding/commit", { cookie: other.cookie, body: { template: "nope" } })).status, 404);
  assert.equal((await call("POST", "/onboarding/skip", { cookie: other.cookie })).status, 200);
  assert.equal((await call("GET", "/me", { cookie: other.cookie })).json.user.onboarding, undefined);
});
