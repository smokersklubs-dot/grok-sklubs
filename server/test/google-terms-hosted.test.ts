import assert from "node:assert/strict";
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Hosted mode, Google first on the "Connexion ou inscription" screen: a NEW account through Google whose terms were not
// ticked is not created on the way back from Google — one step (name from Google, the terms) creates it; an existing
// account signs straight in; the step is single use and expires.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-google-terms-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
// The fake Google below is only honoured because these tests run with NODE_ENV=test.
process.env.NODE_ENV = "test";
process.env.OPEN_SIGNUP = "1";
process.env.HOSTED_MODE = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.SIGNUP_PER_IP = "100";
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

process.env.GOOGLE_LOGIN_CLIENT_ID = CLIENT_ID;
process.env.GOOGLE_LOGIN_CLIENT_SECRET = CLIENT_SECRET;
const hosted = await import("../src/hosted.js");
const owner = await call("POST", "/auth/signup", { body: { email: "owner@example.com", password: "owner-password-1" } });
assert.equal(owner.status, 200);
const post = (url: string, body: unknown) => api.request(url, { method: "POST", headers: { "content-type": "application/json", origin: "https://sklubot.example", host: "sklubot.example" }, body: JSON.stringify(body) }).then(async (r) => ({ status: r.status, json: await r.json().catch(() => null), cookie: r.headers.getSetCookie().map((s) => s.split(";")[0]).find((s) => s.startsWith("sklubot_session=") && s.length > 20) ?? "" }));

test("a new Google account without the terms ticked waits for the terms step; nothing is created before", async () => {
  const back = await viaGoogle({ sub: "sub-new", email: "new@example.com", name: "Nina Google" });
  assert.equal(back.status, 302);
  const loc = back.headers.get("location")!;
  assert.match(loc, /^\/\?google_signup=/);
  assert.equal(users.byEmail("new@example.com"), null);
  const token = decodeURIComponent(loc.split("=")[1]);
  const peek = await post("/auth/google/pending", { token });
  assert.deepEqual(peek.json, { email: "new@example.com", name: "Nina Google" });
  const no = await post("/auth/google/finish", { token, acceptTerms: false });
  assert.equal(no.status, 400);
  assert.equal(no.json.code, "terms");
  assert.equal(users.byEmail("new@example.com"), null);
  const yes = await post("/auth/google/finish", { token, acceptTerms: true, name: "Nina" });
  assert.equal(yes.status, 200);
  assert.ok(yes.cookie);
  const u = users.byEmail("new@example.com")!;
  assert.equal(u.name, "Nina");
  assert.equal(yes.json.user.onboarding, true, "straight to the first run");
  assert.equal(hosted.subscriptions.get(u.id)?.planId, "free");
  assert.ok(q.get("SELECT 1 AS x FROM audit WHERE user_id = ? AND text LIKE '%terms of service accepted%'", u.id));
  assert.equal((await post("/auth/google/finish", { token, acceptTerms: true })).status, 400, "single use");
});

test("terms ticked before Google: created at once; an existing account signs straight in", async () => {
  const first = await viaGoogle({ sub: "sub-ticked", email: "ticked@example.com" }, { start: { method: "POST", url: "/auth/google/start", body: { acceptTerms: true } } });
  assert.equal(first.headers.get("location"), "/");
  assert.ok(users.byEmail("ticked@example.com"));
  const again = await viaGoogle({ sub: "sub-new", email: "new@example.com" });
  assert.equal(again.headers.get("location"), "/");
});

test("a wrong or unknown step token says nothing", async () => {
  assert.equal((await post("/auth/google/pending", { token: "nope" })).status, 400);
  assert.equal((await post("/auth/google/finish", { token: "nope", acceptTerms: true })).status, 400);
});
