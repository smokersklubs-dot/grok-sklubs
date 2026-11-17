import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-google-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
// The fake Google below is only honoured because these tests run with NODE_ENV=test.
process.env.NODE_ENV = "test";
delete process.env.OPEN_SIGNUP;
delete process.env.GOOGLE_LOGIN_CLIENT_ID;
delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;

const CLIENT_ID = "fake-client.apps.googleusercontent.com";
const CLIENT_SECRET = "fake-secret-value-123";

/** A local OpenID provider playing Google: discovery, token endpoint (checks secret + PKCE), JWKS. */
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const otherKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;
const jwk = { ...publicKey.export({ format: "jwk" }), kid: "k1", use: "sig", alg: "RS256" };
const pending = new Map<string, { claims: Record<string, unknown>; challenge: string }>();
const fake = { base: "", tokenCalls: 0 };
const b64 = (v: unknown) => Buffer.from(JSON.stringify(v)).toString("base64url");
function idToken(claims: Record<string, unknown>, key = privateKey) {
  const head = b64({ alg: "RS256", kid: "k1", typ: "JWT" });
  const body = b64(claims);
  return `${head}.${body}.${sign("RSA-SHA256", Buffer.from(`${head}.${body}`), key).toString("base64url")}`;
}
const server = createServer(async (req, res) => {
  const url = new URL(req.url!, fake.base);
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const json = (v: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
  if (url.pathname === "/.well-known/openid-configuration") return json({ issuer: fake.base, authorization_endpoint: `${fake.base}/auth`, token_endpoint: `${fake.base}/token`, jwks_uri: `${fake.base}/certs` });
  if (url.pathname === "/certs") return json({ keys: [jwk] });
  if (url.pathname === "/token") {
    fake.tokenCalls += 1;
    const p = Object.fromEntries(new URLSearchParams(Buffer.concat(chunks).toString()));
    const entry = pending.get(p.code);
    pending.delete(p.code);
    if (!entry || p.client_id !== CLIENT_ID || p.client_secret !== CLIENT_SECRET || p.grant_type !== "authorization_code" || p.redirect_uri !== "https://sklubot.example/api/auth/google/callback") return json({ error: "invalid_grant" }, 400);
    if (createHash("sha256").update(p.code_verifier ?? "").digest("base64url") !== entry.challenge) return json({ error: "invalid_grant", error_description: "pkce" }, 400);
    const { __forge, ...claims } = entry.claims;
    return json({ access_token: "at", token_type: "Bearer", expires_in: 3600, id_token: idToken(claims, __forge ? otherKey : privateKey) });
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
fake.base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
process.env.GOOGLE_OIDC_DISCOVERY_URL = `${fake.base}/.well-known/openid-configuration`;
after(() => server.close());

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users } = await import("../src/store.js");
const { createSession, hashPassword } = await import("../src/auth.js");
const { workspaces, invites } = await import("../src/workspaces.js");

type Res = { status: number; json: any; text: string; headers: Headers; cookies: string[] };
async function call(method: string, url: string, opts: { body?: unknown; cookie?: string } = {}): Promise<Res> {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", ...(opts.cookie ? { cookie: opts.cookie } : {}) }, body: opts.body === undefined ? undefined : JSON.stringify(opts.body) });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* html */ }
  return { status: res.status, json, text, headers: res.headers, cookies: res.headers.getSetCookie().map((s) => s.split(";")[0]) };
}
const sessionOf = (r: Res) => r.cookies.find((c) => c.startsWith("sklubot_session=") && c.length > "sklubot_session=".length) ?? "";

let codeN = 0;
/** One trip through Google: start, "authorize" (the fake keeps the claims for the code), callback. */
async function viaGoogle(claims: Record<string, unknown>, opts: { start?: { method: "POST" | "GET"; url: string; body?: unknown; cookie?: string }; tamper?: (p: { state: string; flowCookie: string; nonce: string }) => { state: string; flowCookie: string; nonce: string } } = {}) {
  const st = opts.start ?? { method: "POST", url: "/auth/google/start", body: {} };
  const start = await call(st.method, st.url, { body: st.body, cookie: st.cookie });
  const authUrl = new URL(st.method === "POST" ? start.json.url : start.headers.get("location")!);
  assert.equal(authUrl.origin + authUrl.pathname, `${fake.base}/auth`);
  assert.equal(authUrl.searchParams.get("scope"), "openid email profile");
  assert.equal(authUrl.searchParams.get("code_challenge_method"), "S256");
  assert.equal(authUrl.searchParams.get("response_type"), "code");
  let p = { state: authUrl.searchParams.get("state")!, flowCookie: start.cookies.find((c) => c.startsWith("sklubot_google_flow="))!, nonce: authUrl.searchParams.get("nonce")! };
  if (opts.tamper) p = opts.tamper(p);
  const code = `code-${++codeN}`;
  pending.set(code, { challenge: authUrl.searchParams.get("code_challenge")!, claims: { iss: fake.base, aud: CLIENT_ID, exp: Math.floor(Date.now() / 1000) + 600, iat: Math.floor(Date.now() / 1000), nonce: p.nonce, email_verified: true, ...claims } });
  return call("GET", `/auth/google/callback?state=${encodeURIComponent(p.state)}&code=${code}`, { cookie: p.flowCookie });
}

// A fresh install with a setup code: the very first account cannot be created through Google without that code.
const { config } = await import("../src/config.js");
(config as { setupCode: string }).setupCode = "ABCD-1234";
process.env.GOOGLE_LOGIN_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_LOGIN_CLIENT_SECRET = CLIENT_SECRET;
const firstStatus = await call("GET", "/auth/google/status");
const noCode = await call("POST", "/auth/google/start", { body: {} });
const wrongCode = await call("POST", "/auth/google/start", { body: { setupCode: "nope" } });
const appFirst = await viaGoogle({ sub: "sub-first", email: "first@example.com" }, { start: { method: "GET", url: `/auth/google/start?app=1&code_challenge=${"a".repeat(43)}&code_challenge_method=S256` } });
const withCode = await call("POST", "/auth/google/start", { body: { setupCode: "abcd 1234" } });
const envView = { status: firstStatus.json, noCode: noCode.status, wrongCode: wrongCode.status, appFirst: appFirst.status, appText: appFirst.text, withCode: withCode.status, accounts: users.count() };
(config as { setupCode: string }).setupCode = "";
delete process.env.GOOGLE_LOGIN_CLIENT_ID;
delete process.env.GOOGLE_LOGIN_CLIENT_SECRET;

// The owner (first account) and a second, ordinary account.
const signup = await call("POST", "/auth/signup", { body: { email: "Owner@Example.com", password: "owner-password-1", name: "Owner" } });
assert.equal(signup.status, 200);
const ownerCookie = sessionOf(signup);
const ownerId = signup.json.user.id as string;
const other = users.create("member@example.com", "Member", hashPassword("member-password-1"));
const otherCookie = `sklubot_session=${createSession(other.id).token}`;

test("setup code: the first account through Google needs it (web), and the app is sent to the website", () => {
  assert.deepEqual(envView.status, { enabled: true });
  assert.equal(envView.noCode, 403);
  assert.equal(envView.wrongCode, 403);
  assert.equal(envView.appFirst, 403);
  assert.match(envView.appText, /must be created on the website/);
  assert.equal(envView.withCode, 200);
  assert.equal(envView.accounts, 0);
});

test("Google sign-in is hidden until configured; only the owner can see or change its settings", async () => {
  assert.deepEqual((await call("GET", "/auth/google/status")).json, { enabled: false });
  assert.equal((await call("POST", "/auth/google/start", { body: {} })).status, 404);
  assert.equal((await call("GET", "/settings/google-login", { cookie: otherCookie })).status, 403);
  assert.equal((await call("PUT", "/settings/google-login", { cookie: otherCookie, body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } })).status, 403);
  assert.equal((await call("GET", "/settings/google-login")).status, 401);
  const bad = await call("PUT", "/settings/google-login", { cookie: ownerCookie, body: { clientId: "nope", clientSecret: "x" } });
  assert.equal(bad.status, 400);
  const put = await call("PUT", "/settings/google-login", { cookie: ownerCookie, body: { clientId: CLIENT_ID, clientSecret: CLIENT_SECRET } });
  assert.equal(put.status, 200);
  assert.equal(put.json.redirectUri, "https://sklubot.example/api/auth/google/callback");
  const get = await call("GET", "/settings/google-login", { cookie: ownerCookie });
  assert.equal(get.json.clientId, CLIENT_ID);
  assert.equal(get.json.configured, true);
  // The secret is never sent back, and is encrypted at rest.
  assert.ok(!put.text.includes(CLIENT_SECRET) && !get.text.includes(CLIENT_SECRET));
  const row = q.get<{ secret_enc: string }>("SELECT secret_enc FROM google_login WHERE id = 1")!;
  assert.ok(!row.secret_enc.includes(CLIENT_SECRET));
  // Saving again without a secret keeps the saved one.
  assert.equal((await call("PUT", "/settings/google-login", { cookie: ownerCookie, body: { clientId: CLIENT_ID } })).status, 200);
  assert.deepEqual((await call("GET", "/auth/google/status")).json, { enabled: true });
});

test("an existing account is found by its verified email (any case), then by Google's sub", async () => {
  const r = await viaGoogle({ sub: "sub-owner", email: "OWNER@example.com", name: "O" });
  assert.equal(r.status, 302);
  assert.equal(r.headers.get("location"), "/");
  const session = sessionOf(r);
  assert.ok(session);
  assert.equal((await call("GET", "/me", { cookie: session })).json.user.id, ownerId);
  assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM google_identities WHERE sub = 'sub-owner'")?.user_id, ownerId);
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text = 'Signed in with Google'", ownerId));
  // Later: Google's address changed, the sub still matches.
  const again = await viaGoogle({ sub: "sub-owner", email: "renamed@gmail.com" });
  assert.equal(again.status, 302);
  assert.equal((await call("GET", "/me", { cookie: sessionOf(again) })).json.user.id, ownerId);
  // Password sign-in is unchanged.
  assert.equal((await call("POST", "/auth/login", { body: { email: "owner@example.com", password: "owner-password-1" } })).status, 200);
});

test("an unverified email, a wrong nonce, a wrong state or another browser are refused", async () => {
  const unverified = await viaGoogle({ sub: "sub-x", email: "member@example.com", email_verified: false });
  assert.equal(unverified.status, 403);
  assert.match(unverified.text, /not verified/);
  assert.equal(sessionOf(unverified), "");
  const nonce = await viaGoogle({ sub: "sub-x", email: "member@example.com" }, { tamper: (p) => ({ ...p, nonce: "wrong-nonce" }) });
  assert.equal(nonce.status, 403);
  assert.equal(sessionOf(nonce), "");
  const state = await viaGoogle({ sub: "sub-x", email: "member@example.com" }, { tamper: (p) => ({ ...p, state: "made-up-state" }) });
  assert.equal(state.status, 400);
  const browser = await viaGoogle({ sub: "sub-x", email: "member@example.com" }, { tamper: (p) => ({ ...p, flowCookie: "sklubot_google_flow=someone-else" }) });
  assert.equal(browser.status, 400);
  assert.equal(sessionOf(browser), "");
  // A token for another client, or signed with another key, is refused too.
  const aud = await viaGoogle({ sub: "sub-x", email: "member@example.com", aud: "another-client.apps.googleusercontent.com" });
  assert.equal(aud.status, 403);
  const forged = await viaGoogle({ sub: "sub-x", email: "member@example.com", __forge: true });
  assert.equal(forged.status, 403);
  assert.equal(q.get("SELECT 1 FROM google_identities WHERE sub = 'sub-x'"), undefined);
});

test("no account and sign-ups closed: refused with a clear page; an invitation for that address lets it in", async () => {
  const closed = await viaGoogle({ sub: "sub-new", email: "stranger@example.com" });
  assert.equal(closed.status, 403);
  assert.match(closed.text, /New accounts are closed/);
  assert.equal(users.byEmail("stranger@example.com"), null);

  const ws = workspaces.create(ownerId, "Team");
  const inv = invites.create(ws.id, ownerId, "guest@example.com", "member");
  const token = new URL(inv.link!).searchParams.get("invite")!;
  // The invitation is for guest@, not for someone else.
  const wrong = await viaGoogle({ sub: "sub-n2", email: "intruder@example.com" }, { start: { method: "POST", url: "/auth/google/start", body: { invite: token } } });
  assert.equal(wrong.status, 403);
  const ok = await viaGoogle({ sub: "sub-guest", email: "guest@example.com", name: "Guest" }, { start: { method: "POST", url: "/auth/google/start", body: { invite: token, locale: "fr" } } });
  assert.equal(ok.status, 302);
  const me = await call("GET", "/me", { cookie: sessionOf(ok) });
  assert.equal(me.json.user.email, "guest@example.com");
  const guest = users.byEmail("guest@example.com")!;
  assert.equal(guest.locale, "fr");
  assert.ok(q.get("SELECT 1 FROM workspace_members WHERE user_id = ? AND workspace_id = ?", guest.id, ws.id));
  assert.ok(q.get("SELECT 1 FROM bots WHERE user_id = ?", guest.id), "the new account has its first bot");
  // No usable password: password sign-in fails, Settings can set one, then Google can be unlinked.
  const cookie = sessionOf(ok);
  const acct = await call("GET", "/account/google", { cookie });
  assert.deepEqual({ linked: acct.json.linked, hasPassword: acct.json.hasPassword }, { linked: true, hasPassword: false });
  assert.equal((await call("DELETE", "/account/google", { cookie })).status, 409);
  assert.equal((await call("POST", "/auth/login", { body: { email: "guest@example.com", password: "" } })).status, 401);
  assert.equal((await call("POST", "/account/google/password", { cookie, body: { next: "short" } })).status, 400);
  assert.equal((await call("POST", "/account/google/password", { cookie, body: { next: "guest-password-1" } })).status, 200);
  assert.equal((await call("POST", "/account/google/password", { cookie, body: { next: "guest-password-2" } })).status, 409);
  assert.equal((await call("POST", "/auth/login", { body: { email: "guest@example.com", password: "guest-password-1" } })).status, 200);
  assert.equal((await call("DELETE", "/account/google", { cookie })).status, 200);
  assert.equal((await call("GET", "/account/google", { cookie })).json.linked, false);
});

test("mobile app: one-time code bound to the app's verifier, single use", async () => {
  const verifier = "v".repeat(20) + "-app-verifier-0123456789abcdef";
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const start = { method: "GET" as const, url: `/auth/google/start?app=1&code_challenge=${challenge}&code_challenge_method=S256` };
  assert.equal((await call("GET", "/auth/google/start?app=1&code_challenge=short&code_challenge_method=S256")).status, 400);

  const r1 = await viaGoogle({ sub: "sub-owner", email: "owner@example.com" }, { start });
  assert.equal(r1.status, 302);
  const back = new URL(r1.headers.get("location")!);
  assert.equal(`${back.protocol}//${back.host}`, "sklubot://auth");
  assert.equal(sessionOf(r1), "", "no browser session for the app flow");
  const code = back.searchParams.get("code")!;
  const wrong = await call("POST", "/auth/app/exchange", { body: { code, verifier: "w".repeat(50) } });
  assert.equal(wrong.status, 400);
  assert.equal(sessionOf(wrong), "");
  // The code was burned by the wrong attempt.
  assert.equal((await call("POST", "/auth/app/exchange", { body: { code, verifier } })).status, 400);

  const r2 = await viaGoogle({ sub: "sub-owner", email: "owner@example.com" }, { start });
  const code2 = new URL(r2.headers.get("location")!).searchParams.get("code")!;
  const ok = await call("POST", "/auth/app/exchange", { body: { code: code2, verifier } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.user.id, ownerId);
  assert.equal((await call("GET", "/me", { cookie: sessionOf(ok) })).json.user.id, ownerId);
  assert.equal((await call("POST", "/auth/app/exchange", { body: { code: code2, verifier } })).status, 400, "single use");
});

test("linking from Settings: a Google account already linked elsewhere is refused", async () => {
  const start = { method: "POST" as const, url: "/account/google/link", body: {}, cookie: otherCookie };
  const taken = await viaGoogle({ sub: "sub-owner", email: "member@example.com" }, { start });
  assert.equal(taken.status, 409);
  const ok = await viaGoogle({ sub: "sub-member", email: "member.perso@gmail.com" }, { start });
  assert.equal(ok.status, 302);
  assert.equal(ok.headers.get("location"), "/?google=linked");
  assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM google_identities WHERE sub = 'sub-member'")?.user_id, other.id);
});

test("mandatory e-mail verification (publicsignup.ts), open server without SMTP: an account held for its link is let in by Google (same address), its first bot appears; a new Google account is never held", async () => {
  const { bots } = await import("../src/store.js");
  const ps = await import("../src/publicsignup.js");
  const cfg = config as { openSignup: boolean };
  const was = cfg.openSignup;
  cfg.openSignup = true;
  delete process.env.EMAIL_VERIFICATION;
  try {
    // Password sign-ups are refused here (no SMTP): Google is the way in.
    const refused = await call("POST", "/auth/signup", { body: { email: "pw@example.org", password: "password-123" } });
    assert.equal(refused.status, 403); assert.equal(refused.json.code, "email_signup_closed");
    // A held account (made when the server still had SMTP): only the verification screen's routes answer.
    const held = users.create("held@example.org", "Held", hashPassword("held-password-1"));
    q.run("UPDATE users SET email_verify_pending = 1, onboarding_pending = 1, first_bot = ? WHERE id = ?", JSON.stringify({ name: "Nova", label: "" }), held.id);
    const heldCookie = `sklubot_session=${createSession(held.id).token}`;
    const blocked = await call("GET", "/bots", { cookie: heldCookie });
    assert.equal(blocked.status, 403); assert.equal(blocked.json.code, "email_unverified");
    // "Continuer avec Google" with the same address: verified, the first bot is made with the chosen name.
    const r = await viaGoogle({ sub: "sub-held", email: "held@example.org" });
    assert.equal(r.status, 302);
    assert.equal(ps.emailGateBlocks(held.id), false);
    assert.equal(bots.primary(held.id)?.name, "Nova");
    const me = await call("GET", "/me", { cookie: sessionOf(r) });
    assert.equal(me.json.user.id, held.id);
    assert.equal(me.json.user.emailUnverified, undefined);
    assert.equal(me.json.user.onboarding, true, "the first run comes after verification");
    assert.equal((await call("GET", "/bots", { cookie: heldCookie })).status, 200);
    // A brand-new account through Google: verified from the start, with its bot.
    const fresh = await viaGoogle({ sub: "sub-fresh", email: "fresh@example.org" });
    assert.equal(fresh.status, 302);
    const freshUser = users.byEmail("fresh@example.org")!;
    assert.equal(ps.emailGateBlocks(freshUser.id), false);
    assert.ok(bots.primary(freshUser.id));
  } finally { cfg.openSignup = was; }
});
