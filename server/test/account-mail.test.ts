import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

// SK-P0-10: the server's own e-mails — "Mot de passe oublié ?", change of address, the owner's SMTP settings.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-accmail-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.TRUST_PROXY = "1";
// The fake SMTP server of these tests listens on this machine.
process.env.ALLOW_PRIVATE_FETCH = "1";
for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_TLS", "SMTP_USER", "SMTP_PASS", "SMTP_FROM", "OPEN_SIGNUP", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

// ── A fake SMTP server (the owner's provider), local: AUTH required, captures each message ──
interface Got { from: string; to: string[]; subject: string; text: string; user: string }
const inbox: Got[] = [];
const smtp = new SMTPServer({
  authOptional: false, allowInsecureAuth: true, disabledCommands: ["STARTTLS"], logger: false, disableReverseLookup: true,
  onAuth(auth, _s, cb) { if (auth.username === "mailer@example.test" && auth.password === "app-password-16ch") cb(null, { user: auth.username }); else cb(new Error("Invalid credentials")); },
  onData(stream, session, cb) {
    const chunks: Buffer[] = [];
    stream.on("data", (c: Buffer) => chunks.push(c));
    stream.on("end", async () => {
      const p = await simpleParser(Buffer.concat(chunks));
      inbox.push({ from: session.envelope.mailFrom ? session.envelope.mailFrom.address : "", to: session.envelope.rcptTo.map((r) => r.address), subject: p.subject ?? "", text: p.text ?? "", user: String(session.user) });
      cb();
    });
  },
});
const smtpPort: number = await new Promise((r) => { const s = smtp.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)); });
after(() => new Promise<void>((r) => smtp.close(() => r())));

// Everything the server prints while these tests run: a token or password must never appear in it.
const printed: string[] = [];
for (const k of ["log", "error", "warn", "info"] as const) {
  const orig = console[k].bind(console);
  console[k] = (...a: unknown[]) => { printed.push(a.map(String).join(" ")); orig(...a); };
}

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { sha256, users } = await import("../src/store.js");
const { createSession, hashPassword } = await import("../src/auth.js");

type Res = { status: number; json: any; text: string; cookies: string[] };
let ipN = 0;
async function call(method: string, url: string, opts: { body?: unknown; cookie?: string; ip?: string; origin?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? `198.51.100.${++ipN % 250}` };
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.origin) headers.origin = opts.origin;
  const res = await api.request(url, { method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, cookies: res.headers.getSetCookie().map((s) => s.split(";")[0]) };
}
const sessionOf = (r: Res) => r.cookies.find((c) => c.startsWith("sklubot_session=") && c.length > "sklubot_session=".length) ?? "";
async function until<T>(probe: () => T | undefined | null | false, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const settle = () => new Promise((r) => setTimeout(r, 300));
const linkIn = (text: string, param: string) => new RegExp(`https://sklubot\\.example/\\?${param}=([A-Za-z0-9_-]+)`).exec(text)?.[1] ?? "";
const auditOf = (userId: string) => q.all<{ text: string }>("SELECT text FROM audit WHERE user_id = ? ORDER BY id", userId).map((r) => r.text);

// The owner is the first account (signed up); the others are made directly.
const signup = await call("POST", "/auth/signup", { body: { email: "owner@example.test", password: "owner-password-1", locale: "fr" } });
assert.equal(signup.status, 200, signup.text);
let ownerCookie = sessionOf(signup);
const owner = users.byEmail("owner@example.test")!;
const alice = users.create("alice@example.test", "Alice", hashPassword("alice-password-1"), "en");
let aliceCookie = `sklubot_session=${createSession(alice.id).token}`;
const carol = users.create("carol@example.test", "Carol", hashPassword("carol-password-1"), "en");
const dave = users.create("dave@example.test", "Dave", hashPassword("dave-password-1"), "en");
const bob = users.create("bob@example.test", "Bob", hashPassword("bob-password-1"), "fr");
const bobCookie = `sklubot_session=${createSession(bob.id).token}`;
// Created with Google: no password yet (googlelogin.ts NO_PASSWORD_PREFIX), linked by Google's account id.
const gina = users.create("gina@example.test", "Gina", "google$not-a-password", "fr");
const ginaCookie = `sklubot_session=${createSession(gina.id).token}`;
q.run("INSERT INTO google_identities (sub, user_id, email, linked_at) VALUES (?, ?, ?, ?)", "google-sub-gina", gina.id, "gina@example.test", Date.now());

test("without an SMTP account: forgot password says so, and a change of address applies directly after the password", async () => {
  assert.deepEqual((await call("GET", "/auth/password/status")).json, { mail: false });
  const r = await call("POST", "/auth/password/forgot", { body: { email: "zed@example.test", locale: "fr" } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /ne peut pas encore envoyer d'e-mails/);

  const view = await call("GET", "/account/email", { cookie: bobCookie });
  assert.deepEqual(view.json, { email: "bob@example.test", pending: null, mail: false, hasPassword: true });
  assert.equal((await call("POST", "/account/email", { cookie: bobCookie, body: { password: "nope", email: "bobby@example.test" } })).status, 401);
  // Uniqueness ignores case.
  const taken = await call("POST", "/account/email", { cookie: bobCookie, body: { password: "bob-password-1", email: "ALICE@example.test" } });
  assert.equal(taken.status, 409);
  assert.match(taken.json.error, /déjà utilisée/);
  const ok = await call("POST", "/account/email", { cookie: bobCookie, body: { password: "bob-password-1", email: "Bobby@Example.test" } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.applied, true);
  assert.equal(ok.json.user.email, "bobby@example.test");
  assert.equal(users.byId(bob.id)!.email, "bobby@example.test");
  assert.ok(auditOf(bob.id).some((t) => /changed from bob@example\.test to bobby@example\.test \(no e-mail server/.test(t)));
  assert.equal(inbox.length, 0, "nothing is sent");
  // Signing in uses the new address.
  assert.equal((await call("POST", "/auth/login", { body: { email: "bobby@example.test", password: "bob-password-1" } })).status, 200);
});

test("SMTP settings: owner only, the password is sealed and never returned, the test e-mail goes to the owner", async () => {
  assert.equal((await call("GET", "/settings/smtp", { cookie: aliceCookie })).status, 403);
  assert.equal((await call("PUT", "/settings/smtp", { cookie: aliceCookie, body: { host: "127.0.0.1", port: smtpPort, tlsMode: "none", from: "x@example.test" } })).status, 403);
  // State-changing requests from another site are refused (the session middleware's Origin check).
  assert.equal((await call("PUT", "/settings/smtp", { cookie: ownerCookie, origin: "https://evil.example", body: {} })).status, 403);

  const bad = await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "smtp gmail", port: 465, tlsMode: "tls", from: "x@example.test" } });
  assert.equal(bad.status, 400);
  assert.equal((await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "127.0.0.1", port: smtpPort, tlsMode: "weird", from: "x@example.test" } })).status, 400);

  // Wrong password first: the test e-mail fails with the server's answer, never the password.
  let r = await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "127.0.0.1", port: smtpPort, tlsMode: "none", username: "mailer@example.test", password: "wrong-pass-123", from: "mailer@example.test" } });
  assert.equal(r.status, 200, r.text);
  const failed = await call("POST", "/settings/smtp/test", { cookie: ownerCookie });
  assert.equal(failed.status, 502);
  assert.match(failed.json.error, /Le serveur SMTP a refusé/);
  assert.ok(!failed.text.includes("wrong-pass-123"));

  r = await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "127.0.0.1", port: smtpPort, tlsMode: "none", username: "mailer@example.test", password: "app-password-16ch", from: "mailer@example.test" } });
  assert.deepEqual(r.json, { configured: true, source: "saved", host: "127.0.0.1", port: smtpPort, tlsMode: "none", username: "mailer@example.test", hasPassword: true, from: "mailer@example.test" });
  assert.ok(!r.text.includes("app-password-16ch"));
  assert.ok(!JSON.stringify(q.all("SELECT * FROM instance_smtp")).includes("app-password-16ch"), "sealed at rest");
  // An empty password keeps the saved one.
  r = await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "127.0.0.1", port: smtpPort, tlsMode: "none", username: "mailer@example.test", password: "", from: "mailer@example.test" } });
  assert.equal(r.json.hasPassword, true);

  const sent = await call("POST", "/settings/smtp/test", { cookie: ownerCookie });
  assert.equal(sent.status, 200, sent.text);
  const mail = inbox.find((m) => m.to.includes("owner@example.test"))!;
  assert.ok(mail, "test e-mail received");
  assert.equal(mail.user, "mailer@example.test");
  assert.equal(mail.from, "mailer@example.test");
  assert.match(mail.subject, /e-mail de test/);
  assert.deepEqual((await call("GET", "/auth/password/status")).json, { mail: true });
});

test("the environment wins over the saved settings, and the page says so", async () => {
  process.env.SMTP_HOST = "smtp.env.example";
  process.env.SMTP_PORT = "465";
  process.env.SMTP_USER = "env@example.test";
  process.env.SMTP_PASS = "env-secret";
  try {
    const v = await call("GET", "/settings/smtp", { cookie: ownerCookie });
    assert.deepEqual(v.json, { configured: true, source: "env", host: "smtp.env.example", port: 465, tlsMode: "tls", username: "env@example.test", hasPassword: true, from: "env@example.test" });
    assert.ok(!v.text.includes("env-secret"));
    assert.equal((await call("PUT", "/settings/smtp", { cookie: ownerCookie, body: { host: "127.0.0.1", port: 25, tlsMode: "none", from: "a@example.test" } })).status, 409);
  } finally {
    for (const k of ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS"]) delete process.env[k];
  }
});

test("forgot password: the same answer whether the account exists or not; only a hash is stored", async () => {
  const before = inbox.length;
  const known = await call("POST", "/auth/password/forgot", { body: { email: "Alice@Example.test", locale: "fr" } });
  const unknown = await call("POST", "/auth/password/forgot", { body: { email: "nobody@example.test", locale: "fr" } });
  assert.equal(known.status, 200);
  assert.equal(known.status, unknown.status);
  assert.equal(known.text, unknown.text);
  const mail = await until(() => inbox.slice(before).find((m) => m.to.includes("alice@example.test")), "reset e-mail");
  await settle();
  assert.equal(inbox.slice(before).filter((m) => m.to.includes("nobody@example.test")).length, 0);
  // The account's language (Alice: English), and the link.
  assert.match(mail.subject, /choose a new password/);
  const token = linkIn(mail.text, "reset");
  assert.ok(token.length >= 40, mail.text);
  assert.ok(/valid 30 minutes/.test(mail.text));
  const stored = q.all<{ token_hash: string; expires_at: number; created_at: number }>("SELECT * FROM password_resets WHERE user_id = ?", alice.id);
  assert.equal(stored.length, 1);
  assert.notEqual(stored[0].token_hash, token);
  assert.ok(!JSON.stringify(stored).includes(token));
  assert.equal(stored[0].expires_at - stored[0].created_at, 30 * 60_000);
  assert.ok(auditOf(alice.id).includes("Password reset e-mail requested"));
});

test("reset: link checked, single use, every session revoked, then signed in with the new password", async () => {
  const before = inbox.length;
  await call("POST", "/auth/password/forgot", { body: { email: "alice@example.test" } });
  const mail = await until(() => inbox.slice(before).find((m) => m.to.includes("alice@example.test")), "reset e-mail");
  const token = linkIn(mail.text, "reset");
  // A new request replaced the older link.
  assert.equal(q.all("SELECT * FROM password_resets WHERE user_id = ?", alice.id).length, 1);

  assert.deepEqual((await call("POST", "/auth/password/reset/check", { body: { token } })).json, { valid: true });
  assert.deepEqual((await call("POST", "/auth/password/reset/check", { body: { token: "made-up" } })).json, { valid: false });
  // Cross-site: refused.
  assert.equal((await call("POST", "/auth/password/reset", { origin: "https://evil.example", body: { token, password: "evil-password-1" } })).status, 403);
  // Too short: refused, and the link is not used up.
  assert.equal((await call("POST", "/auth/password/reset", { body: { token, password: "short" } })).status, 400);
  assert.deepEqual((await call("POST", "/auth/password/reset/check", { body: { token } })).json, { valid: true });

  const other = `sklubot_session=${createSession(alice.id).token}`;
  assert.equal((await call("GET", "/account/email", { cookie: aliceCookie })).status, 200);
  const done = await call("POST", "/auth/password/reset", { body: { token, password: "alice-new-password" } });
  assert.equal(done.status, 200, done.text);
  assert.equal(done.json.user.email, "alice@example.test");
  const fresh = sessionOf(done);
  assert.ok(fresh);
  // Every earlier session is gone; the new one works.
  assert.equal((await call("GET", "/account/email", { cookie: aliceCookie })).status, 401);
  assert.equal((await call("GET", "/account/email", { cookie: other })).status, 401);
  assert.equal((await call("GET", "/account/email", { cookie: fresh })).status, 200);
  aliceCookie = fresh;
  // Single use.
  const again = await call("POST", "/auth/password/reset", { body: { token, password: "another-password" } });
  assert.equal(again.status, 400);
  assert.match(again.json.error, /expired or was already used/);
  assert.equal((await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-password-1" } })).status, 401);
  assert.equal((await call("POST", "/auth/login", { body: { email: "alice@example.test", password: "alice-new-password" } })).status, 200);
  assert.ok(auditOf(alice.id).some((t) => /Password reset with an e-mail link/.test(t)));
});

test("an expired link is refused", async () => {
  const before = inbox.length;
  await call("POST", "/auth/password/forgot", { body: { email: "carol@example.test" } });
  const token = linkIn((await until(() => inbox.slice(before).find((m) => m.to.includes("carol@example.test")), "reset e-mail")).text, "reset");
  q.run("UPDATE password_resets SET expires_at = ? WHERE user_id = ?", Date.now() - 1, carol.id);
  assert.deepEqual((await call("POST", "/auth/password/reset/check", { body: { token } })).json, { valid: false });
  assert.equal((await call("POST", "/auth/password/reset", { body: { token, password: "carol-other-password" } })).status, 400);
  assert.equal((await call("POST", "/auth/login", { body: { email: "carol@example.test", password: "carol-password-1" } })).status, 200);
});

test("a changed password (Settings) withdraws the pending reset links", async () => {
  const before = inbox.length;
  await call("POST", "/auth/password/forgot", { body: { email: "dave@example.test" } });
  const token = linkIn((await until(() => inbox.slice(before).find((m) => m.to.includes("dave@example.test")), "reset e-mail")).text, "reset");
  const cookie = `sklubot_session=${createSession(dave.id).token}`;
  assert.equal((await call("PUT", "/account/password", { cookie, body: { current: "dave-password-1", next: "dave-second-password" } })).status, 200);
  assert.deepEqual((await call("POST", "/auth/password/reset/check", { body: { token } })).json, { valid: false });
});

test("an account created with Google sets its first password through the link, and keeps its Google link", async () => {
  const before = inbox.length;
  await call("POST", "/auth/password/forgot", { body: { email: "gina@example.test" } });
  const mail = await until(() => inbox.slice(before).find((m) => m.to.includes("gina@example.test")), "reset e-mail");
  assert.match(mail.subject, /nouveau mot de passe/, "in the account's language (French)");
  const done = await call("POST", "/auth/password/reset", { body: { token: linkIn(mail.text, "reset"), password: "gina-first-password" } });
  assert.equal(done.status, 200, done.text);
  assert.equal((await call("GET", "/account/google", { cookie: ginaCookie })).status, 401, "old session revoked");
  const g = await call("GET", "/account/google", { cookie: sessionOf(done) });
  assert.equal(g.json.hasPassword, true);
  assert.equal(g.json.linked, true);
});

test("rate limits: the same refusal for a known and an unknown address", async () => {
  for (let i = 0; i < 3; i++) await call("POST", "/auth/password/forgot", { body: { email: "owner@example.test" } });
  for (let i = 0; i < 3; i++) await call("POST", "/auth/password/forgot", { body: { email: "ghost@example.test" } });
  const a = await call("POST", "/auth/password/forgot", { body: { email: "owner@example.test", locale: "en" } });
  const b = await call("POST", "/auth/password/forgot", { body: { email: "ghost@example.test", locale: "en" } });
  assert.equal(a.status, 403);
  assert.equal(a.text, b.text);
  // Per client address too.
  let last: Res | null = null;
  for (let i = 0; i < 11; i++) last = await call("POST", "/auth/password/forgot", { ip: "203.0.113.9", body: { email: `x${i}@example.test` } });
  assert.equal(last!.status, 403);
  // Cross-site: refused before anything else.
  assert.equal((await call("POST", "/auth/password/forgot", { origin: "https://evil.example", body: { email: "alice@example.test" } })).status, 403);
  await settle();
});

test("change of address with e-mail: confirmation to the new address, notice to the old one, applied on the link", async () => {
  const ginaSession = `sklubot_session=${createSession(gina.id).token}`;
  // A password is needed (Gina has one now); a wrong one is refused.
  assert.equal((await call("POST", "/account/email", { cookie: ginaSession, body: { password: "nope", email: "gina.new@example.test" } })).status, 401);
  const before = inbox.length;
  const r = await call("POST", "/account/email", { cookie: ginaSession, body: { password: "gina-first-password", email: "Gina.New@example.test" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.applied, false);
  assert.equal(r.json.pending.email, "gina.new@example.test");
  const confirm = await until(() => inbox.slice(before).find((m) => m.to.includes("gina.new@example.test")), "confirmation");
  const notice = await until(() => inbox.slice(before).find((m) => m.to.includes("gina@example.test")), "notice");
  assert.match(confirm.subject, /confirme ta nouvelle adresse/);
  assert.match(notice.text, /gina\.new@example\.test/);
  assert.ok(!notice.text.includes("email_change="), "the old address never gets the link");
  assert.equal(users.byId(gina.id)!.email, "gina@example.test", "nothing changes before the link");
  assert.equal((await call("GET", "/account/email", { cookie: ginaSession })).json.pending.email, "gina.new@example.test");

  const token = linkIn(confirm.text, "email_change");
  assert.equal((await call("POST", "/auth/email/confirm", { origin: "https://evil.example", body: { token } })).status, 403);
  const ok = await call("POST", "/auth/email/confirm", { body: { token } });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(users.byId(gina.id)!.email, "gina.new@example.test");
  assert.equal((await call("POST", "/auth/email/confirm", { body: { token } })).status, 400, "single use");
  // The Google link is kept (by Google's account id), and signing in uses the new address.
  assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM google_identities WHERE sub = 'google-sub-gina'")!.user_id, gina.id);
  assert.equal((await call("POST", "/auth/login", { body: { email: "gina.new@example.test", password: "gina-first-password" } })).status, 200);
  assert.ok(auditOf(gina.id).some((t) => /changed from gina@example\.test to gina\.new@example\.test \(confirmed by e-mail\)/.test(t)));
});

test("change to an address that has an account: the same answer, no e-mail to it, and the link could not apply anyway", async () => {
  const before = inbox.length;
  const r = await call("POST", "/account/email", { cookie: aliceCookie, body: { password: "alice-new-password", email: "owner@example.test" } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.applied, false);
  await until(() => inbox.slice(before).find((m) => m.to.includes("alice@example.test")), "notice to the old address");
  await settle();
  assert.equal(inbox.slice(before).filter((m) => m.to.includes("owner@example.test")).length, 0);
  // Even with the link, an address that has an account is never taken over.
  q.run("UPDATE email_changes SET token_hash = ? WHERE user_id = ?", sha256("known-test-token"), alice.id);
  const taken = await call("POST", "/auth/email/confirm", { body: { token: "known-test-token", locale: "en" } });
  assert.equal(taken.status, 409);
  assert.equal(users.byId(alice.id)!.email, "alice@example.test");
  await call("POST", "/account/email", { cookie: aliceCookie, body: { password: "alice-new-password", email: "alice2@example.test" } });
  // Cancel works.
  assert.deepEqual((await call("DELETE", "/account/email/pending", { cookie: aliceCookie })).json, { pending: null });
  assert.equal(q.all("SELECT * FROM email_changes WHERE user_id = ?", alice.id).length, 0);
});

test("an account without a password must choose one before changing its address", async () => {
  const noPass = users.create("nopass@example.test", "N", "google$x", "en");
  const cookie = `sklubot_session=${createSession(noPass.id).token}`;
  const r = await call("POST", "/account/email", { cookie, body: { password: "", email: "np2@example.test" } });
  assert.equal(r.status, 409);
  assert.match(r.json.error, /Choose a password first/);
});

test("nothing printed by the server holds a token or a password", async () => {
  // A send that fails (SMTP gone) is logged without the link.
  q.run("UPDATE instance_smtp SET port = 1");
  await call("POST", "/auth/password/forgot", { body: { email: "alice@example.test" } });
  await until(() => printed.some((l) => /password reset e-mail not sent/.test(l)), "failure logged");
  const all = printed.join("\n");
  assert.ok(!/reset=|email_change=/.test(all), all);
  for (const secret of ["app-password-16ch", "alice-new-password", "gina-first-password", "dave-second-password"]) assert.ok(!all.includes(secret), secret);
  for (const r of q.all<{ token_hash: string }>("SELECT token_hash FROM password_resets")) assert.match(r.token_hash, /^[0-9a-f]{64}$/);
});
