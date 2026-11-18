import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { simpleParser } from "mailparser";
import { SMTPServer } from "smtp-server";

// "Recevoir un lien de connexion par e-mail" (emaillink.ts): the same answer for every address (no enumeration), a
// sign-in link for an account, a sign-up link for a new address that only creates the account once the profile step
// (name, terms in hosted mode) is sent, single use, 15 minutes, only a hash stored, rate limits, disposable domains,
// Turnstile, closed sign-ups, the two-factor gate, the activity log — with a fake SMTP server and a fake Siteverify.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-emaillink-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.TRUST_PROXY = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.OPEN_SIGNUP = "1";
process.env.HOSTED_MODE = "1";
process.env.TURNSTILE_SITE_KEY = "site-key";
process.env.TURNSTILE_SECRET_KEY = "secret-key";
process.env.SIGNUP_PER_IP = "100";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "EMAIL_VERIFICATION", "DISPOSABLE_EMAIL_BLOCK", "SIGNUP_GLOBAL"]) delete process.env[k];

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
process.env.SMTP_HOST = "127.0.0.1"; process.env.SMTP_PORT = String(smtpPort); process.env.SMTP_TLS = "none"; process.env.SMTP_FROM = "robot@sklubot.example";

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, sha256 } = await import("../src/store.js");
const ps = await import("../src/publicsignup.js");
const hosted = await import("../src/hosted.js");
let turnstileOk = true;
ps._setSiteverify(async () => ({ success: turnstileOk, hostname: "sklubot.example", action: "signup" }));

type Res = { status: number; json: any; text: string; cookie: string };
let ipN = 0;
async function call(method: string, url: string, o: { body?: unknown; cookie?: string; ip?: string } = {}): Promise<Res> {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": o.ip ?? `198.51.100.${++ipN % 250}`, origin: "https://sklubot.example", host: "sklubot.example" };
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
const linkIn = (text: string) => /\/\?email_link=([A-Za-z0-9_%-]+)/.exec(text)?.[1] ?? "";
/** The link e-mails sent to an address (not the sign-up's address confirmation). */
const linksTo = (addr: string) => inbox.filter((m) => m.to.includes(addr) && linkIn(m.text));
const mailTo = (addr: string, n: number) => until(() => linksTo(addr).length >= n && linksTo(addr)[n - 1], `mail ${n} to ${addr}`);

const owner = await call("POST", "/auth/signup", { body: { email: "owner@example.test", password: "owner-password-1", locale: "fr" } });
assert.equal(owner.status, 200, owner.text);
const member = await call("POST", "/auth/signup", { body: { email: "member@example.test", password: "member-password-1", locale: "fr", acceptTerms: true, turnstileToken: "t" } });
assert.equal(member.status, 200, member.text);

test("the answer is the same for an account and a new address; each gets its own link (only a hash kept)", async () => {
  const a = await call("POST", "/auth/email-link", { body: { email: "member@example.test", locale: "fr", turnstileToken: "t" } });
  const b = await call("POST", "/auth/email-link", { body: { email: "new.person@example.org", locale: "fr", turnstileToken: "t" } });
  assert.equal(a.status, 200); assert.equal(b.status, 200);
  assert.deepEqual(a.json, b.json);
  assert.deepEqual(a.json, { ok: true });
  const m1 = await mailTo("member@example.test", 1);
  const m2 = await mailTo("new.person@example.org", 1);
  assert.match(m1.subject, /lien de connexion/);
  assert.match(m2.subject, /crée ton compte/);
  const t1 = decodeURIComponent(linkIn(m1.text));
  assert.ok(t1.length >= 40);
  // Only the hash is stored.
  assert.equal(q.get("SELECT 1 AS x FROM sign_in_links WHERE token_hash = ?", t1) ?? null, null);
  assert.ok(q.get("SELECT 1 AS x FROM sign_in_links WHERE token_hash = ?", sha256(t1)));
  assert.equal(users.byEmail("new.person@example.org"), null, "nothing is created before the link is opened");
});

test("an account's link signs it in once; a second use or a wrong token is refused", async () => {
  const m = linksTo("member@example.test")[0];
  const token = decodeURIComponent(linkIn(m.text));
  const r = await call("POST", "/auth/email-link/use", { body: { token } });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.user.email, "member@example.test");
  assert.ok(r.cookie);
  assert.equal((await call("POST", "/auth/email-link/use", { body: { token } })).status, 400);
  assert.equal((await call("POST", "/auth/email-link/use", { body: { token: "not-a-real-token" } })).status, 400);
  const log = q.all<{ text: string }>("SELECT text FROM audit WHERE user_id = ? ORDER BY at", users.byEmail("member@example.test")!.id).map((x) => x.text);
  assert.ok(log.includes("Sign-in link sent by e-mail"));
  assert.ok(log.includes("Signed in with an e-mail link"));
});

test("a new address: the link asks for the profile first (not used up), then creates a verified account with the terms", async () => {
  const m = linksTo("new.person@example.org")[0];
  const token = decodeURIComponent(linkIn(m.text));
  const peek = await call("POST", "/auth/email-link/use", { body: { token } });
  assert.equal(peek.status, 200);
  assert.deepEqual(peek.json, { profile: { email: "new.person@example.org", terms: true } });
  assert.equal(users.byEmail("new.person@example.org"), null);
  // Without the terms (hosted mode): refused, and the link still works.
  const noTerms = await call("POST", "/auth/email-link/use", { body: { token, profile: true, name: "Nouvelle" } });
  assert.equal(noTerms.status, 400);
  assert.equal(noTerms.json.code, "terms");
  const r = await call("POST", "/auth/email-link/use", { body: { token, profile: true, name: "Nouvelle Personne", acceptTerms: true } });
  assert.equal(r.status, 200, r.text);
  const u = users.byEmail("new.person@example.org")!;
  assert.equal(u.name, "Nouvelle Personne");
  assert.equal(r.json.user.emailUnverified, undefined, "the link proved the address");
  assert.equal(r.json.user.onboarding, true);
  assert.equal(hosted.subscriptions.get(u.id)?.planId, "free", "everyone starts on the free plan");
  assert.equal((await call("GET", "/bots", { cookie: r.cookie })).json.bots.filter((b: any) => b.primary).length, 1);
  assert.equal((await call("POST", "/auth/email-link/use", { body: { token, profile: true, acceptTerms: true } })).status, 400, "single use");
});

test("expired links do nothing; the address and IP are rate limited", async () => {
  await call("POST", "/auth/email-link", { body: { email: "late@example.org", turnstileToken: "t" } });
  const m = await mailTo("late@example.org", 1);
  const token = decodeURIComponent(linkIn(m.text));
  q.run("UPDATE email_link_signups SET expires_at = ? WHERE token_hash = ?", Date.now() - 1, sha256(token));
  assert.equal((await call("POST", "/auth/email-link/use", { body: { token } })).status, 400);
  // Per address: 3 per quarter hour (the 4th is refused, whatever the address is).
  for (let i = 0; i < 3; i++) assert.equal((await call("POST", "/auth/email-link", { body: { email: "spam@example.org", turnstileToken: "t" } })).status, 200);
  assert.equal((await call("POST", "/auth/email-link", { body: { email: "spam@example.org", turnstileToken: "t" } })).status, 403);
  // Per IP: 10.
  const ip = "192.0.2.77";
  for (let i = 0; i < 10; i++) await call("POST", "/auth/email-link", { ip, body: { email: `ip${i}@example.org`, turnstileToken: "t" } });
  assert.equal((await call("POST", "/auth/email-link", { ip, body: { email: "ip-last@example.org", turnstileToken: "t" } })).status, 403);
});

test("anti-robot checks for every address: disposable domains and Turnstile; closed sign-ups send nothing to a new address", async () => {
  assert.equal((await call("POST", "/auth/email-link", { body: { email: "x@mailinator.com", turnstileToken: "t" } })).status, 400);
  turnstileOk = false;
  assert.equal((await call("POST", "/auth/email-link", { body: { email: "member@example.test", turnstileToken: "t" } })).status, 403);
  assert.equal((await call("POST", "/auth/email-link", { body: { email: "new2@example.org", turnstileToken: "t" } })).status, 403);
  turnstileOk = true;
  const { config } = await import("../src/config.js");
  (config as { openSignup: boolean }).openSignup = false;
  try {
    const before = inbox.length;
    const r = await call("POST", "/auth/email-link", { body: { email: "closed@example.org" } });
    assert.deepEqual(r.json, { ok: true });
    await new Promise((res) => setTimeout(res, 300));
    assert.equal(inbox.slice(before).filter((x) => x.to.includes("closed@example.org")).length, 0);
  } finally { (config as { openSignup: boolean }).openSignup = true; }
});

test("two-factor on: the link opens the second step, not a session", async () => {
  const u = users.byEmail("member@example.test")!;
  q.run("INSERT INTO two_factor (user_id, secret_enc, enabled_at, updated_at) VALUES (?, 'sealed', ?, ?)", u.id, Date.now(), Date.now());
  const n = linksTo("member@example.test").length;
  await call("POST", "/auth/email-link", { body: { email: "member@example.test", turnstileToken: "t" } });
  const m = await mailTo("member@example.test", n + 1);
  const r = await call("POST", "/auth/email-link/use", { body: { token: decodeURIComponent(linkIn(m.text)) } });
  assert.equal(r.status, 200);
  assert.ok(r.json.twoFactor?.token);
  assert.equal(r.cookie, "");
  q.run("DELETE FROM two_factor WHERE user_id = ?", u.id);
});

test("a request from another site is refused", async () => {
  const res = await api.request("/auth/email-link", { method: "POST", headers: { "content-type": "application/json", origin: "https://evil.example", host: "sklubot.example" }, body: JSON.stringify({ email: "member@example.test" }) });
  assert.equal(res.status, 403);
});
