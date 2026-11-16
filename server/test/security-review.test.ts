import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { Hono } from "hono";

// Fixes of the internal security review (Part A): headers and body limits (M3, M7), start-up check (M6), the
// visitor's address (L1), sealed values (L2), the desk test (L4), webhooks (L7), secrets in responses (M4), the disk
// quota and watchdog (M2), the bots' own socket routes (H2).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-review-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.OPEN_SIGNUP = "1";
process.env.TRUST_PROXY = "1";

const { appCsp, bodyLimitFor, inlineScriptHashes, limitBodies, openSetupProblem, RateWindow, securityHeaders } = await import("../src/hardening.js");
const { clientAddress, fromTrustedProxy } = await import("../src/net.js");
const { seal, unseal } = await import("../src/auth.js");
const { binaryHoldsSecret } = await import("../src/egress.js");
const { scrubSecret } = await import("../src/apiconnectors.js");
const { quotaPossible, parseDockerSize } = await import("../src/linux.js");
const { api, botLinkRoutes } = await import("../src/routes.js");

test("M3: the app's CSP — own scripts and the inline start-up script by hash, no remote pictures, no framing, no plugins", () => {
  const html = '<html><head><script>(function(){document.documentElement.lang="fr"})();</script></head><body><script type="module" src="/assets/x.js"></script></body></html>';
  const hashes = inlineScriptHashes(html);
  assert.equal(hashes.length, 1);
  assert.equal(hashes[0], `'sha256-${createHash("sha256").update('(function(){document.documentElement.lang="fr"})();').digest("base64")}'`);
  const csp = appCsp(hashes);
  for (const part of ["default-src 'self'", `script-src 'self' ${hashes[0]}`, "img-src 'self' data: blob:", "connect-src 'self' wss:", "frame-ancestors 'none'", "object-src 'none'", "base-uri 'none'"]) assert.ok(csp.includes(part), part);
  assert.doesNotMatch(csp, /script-src[^;]*unsafe-inline/);
  // The real built page, when there is one: its inline script is covered.
  const built = path.resolve("..", "web", "dist", "index.html");
  try { const page = readFileSync(built, "utf8"); assert.ok(inlineScriptHashes(page).length >= 1); } catch { /* not built in this checkout */ }
});

test("M3: security headers on every response, without replacing a page's own stricter policy", async () => {
  const app = new Hono();
  app.use("*", securityHeaders(appCsp()));
  app.get("/", (c) => c.text("hi"));
  app.get("/own", (c) => c.text("page", 200, { "content-security-policy": "sandbox", "referrer-policy": "no-referrer" }));
  const r = await app.request("/");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.equal(r.headers.get("referrer-policy"), "same-origin");
  assert.equal(r.headers.get("x-frame-options"), "DENY");
  assert.match(r.headers.get("content-security-policy")!, /frame-ancestors 'none'/);
  const own = await app.request("/own");
  assert.equal(own.headers.get("content-security-policy"), "sandbox");
  assert.equal(own.headers.get("referrer-policy"), "no-referrer");
});

test("M7: bodies are limited per route — 1 MB of JSON, 26 MB for uploads — before any handler reads them", async () => {
  assert.equal(bodyLimitFor("/api/bots/b1/uploads"), 26 * 1024 * 1024);
  assert.equal(bodyLimitFor("/api/bots/b1/rows"), 1024 * 1024);
  assert.equal(bodyLimitFor("/egress/b1/k/h/x"), 21 * 1024 * 1024);
  assert.equal(bodyLimitFor("/api/hooks/abc"), 256 * 1024);
  const app = new Hono();
  app.use("*", limitBodies);
  let read = 0;
  app.post("*", async (c) => { read += (await c.req.text()).length; return c.json({ ok: true }); });
  const big = "x".repeat(1024 * 1024 + 10);
  assert.equal((await app.request("/api/settings", { method: "POST", body: big, headers: { "content-type": "application/json" } })).status, 413);
  // A body sent without a length (streamed) is counted as it arrives.
  const stream = new ReadableStream({ start(ctl) { ctl.enqueue(new TextEncoder().encode(big)); ctl.close(); } });
  assert.equal((await app.request("/api/settings", { method: "POST", body: stream, duplex: "half" } as RequestInit)).status, 413);
  assert.equal(read, 0);
  assert.equal((await app.request("/api/bots/b1/uploads", { method: "POST", body: big })).status, 200);
});

test("M6: a fresh install open to others refuses to start without SETUP_CODE; existing installs and local ones always start", () => {
  assert.match(openSetupProblem({ users: 0, setupCode: "", publicUrl: "https://bots.example.com" })!, /SETUP_CODE/);
  assert.equal(openSetupProblem({ users: 3, setupCode: "", publicUrl: "https://bots.example.com" }), null, "production already has accounts");
  assert.equal(openSetupProblem({ users: 0, setupCode: "abc123", publicUrl: "https://bots.example.com" }), null);
  for (const url of ["http://localhost:8787", "http://127.0.0.1:3000", "http://[::1]:8787/"]) assert.equal(openSetupProblem({ users: 0, setupCode: "", publicUrl: url }), null, url);
});

test("L1: X-Forwarded-For is only believed from the reverse proxy's own address", () => {
  // From a private address (Caddy, Traefik on a Docker network): the last entry, the one the proxy added.
  assert.equal(clientAddress(true, "172.18.0.5", "6.6.6.6, 203.0.113.9"), "203.0.113.9");
  assert.equal(clientAddress(true, "::ffff:10.0.1.2", "203.0.113.9"), "203.0.113.9");
  // From the internet directly: the connection's own address, whatever the header says.
  assert.equal(clientAddress(true, "81.2.69.160", "1.2.3.4"), "81.2.69.160");
  assert.equal(clientAddress(true, "2001:4860::1", "1.2.3.4"), "2001:4860::1");
  // Without TRUST_PROXY: never.
  assert.equal(clientAddress(false, "172.18.0.5", "1.2.3.4"), "172.18.0.5");
  assert.equal(fromTrustedProxy("192.168.1.10"), true);
  assert.equal(fromTrustedProxy("8.8.8.8"), false);
  assert.equal(fromTrustedProxy("not an address"), false);
});

test("L2: sealed values use a full 16-byte tag; older values still open; a shortened tag is refused", () => {
  const sealed = seal("token-123");
  assert.equal(Buffer.from(sealed.split(".")[1], "base64").length, 16);
  assert.equal(unseal(sealed), "token-123");
  // A value sealed the old way (no explicit length: also 16 bytes) opens the same.
  const key = createHash("sha256").update("connector-tokens:" + process.env.SESSION_SECRET).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update("old-value", "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const old = [iv, tag, body].map((b) => b.toString("base64")).join(".");
  assert.equal(unseal(old), "old-value");
  // The same value with its tag cut to 4 bytes (which GCM alone would check) is refused.
  assert.equal(unseal([iv, tag.subarray(0, 4), body].map((b) => b.toString("base64")).join(".")), null);
});

test("L7: webhooks are rate-limited per address and per hook", async () => {
  const w = new RateWindow(3, 60_000);
  assert.deepEqual([w.over("k", 0), w.over("k", 1), w.over("k", 2), w.over("k", 3)], [false, false, false, true]);
  assert.equal(w.over("k", 60_001), false, "a new window");
  const small = new RateWindow(1, 1000, 2);
  small.over("a"); small.over("b"); small.over("c");
  assert.equal(small.over("a"), false, "the table stays bounded: the oldest key was dropped");
  let status = 0;
  for (let i = 0; i < 70 && status !== 429; i++) status = (await api.request("/hooks/not-a-real-token", { method: "POST", headers: { "x-forwarded-for": "203.0.113.50" }, body: "{}" })).status;
  assert.equal(status, 429);
  assert.equal((await api.request("/hooks/not-a-real-token", { method: "POST", headers: { "x-forwarded-for": "203.0.113.51" }, body: "{}" })).status, 404);
});

test("L4: the desk test belongs to the server's owner (the earliest account)", async () => {
  const jar: Record<string, string> = {};
  const call = async (who: string, method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar[who] ?? "", origin: "http://localhost:8787", host: "localhost:8787" }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) jar[who] = set.split(";")[0];
    return { status: res.status, json: await res.json().catch(() => null) };
  };
  assert.equal((await call("owner", "POST", "/auth/signup", { email: "owner@example.com", password: "password-1" })).status, 200);
  assert.equal((await call("guest", "POST", "/auth/signup", { email: "guest@example.com", password: "password-1" })).status, 200);
  assert.equal((await call("guest", "GET", "/computer/desk-test")).status, 403);
  assert.equal((await call("guest", "POST", "/computer/desk-test")).status, 403);
  assert.equal((await call("guest", "GET", "/computer/desk-test/shots/x.jpg")).status, 403);
  assert.equal((await call("owner", "GET", "/computer/desk-test")).status, 200);
  // Part B: another account's shared computer is not even visible.
  assert.equal((await call("guest", "POST", "/computer/shared/shc_not_mine/reset")).status, 409); // no Linux computers in this test
});

test("M4: a secret echoed back by an API is hidden (text) or the response refused (binary)", () => {
  const secret = "sk_live_ABCDEF123456";
  assert.equal(scrubSecret(`{"echo":"${secret}","b64":"${Buffer.from(secret).toString("base64")}"}`, secret), '{"echo":"[hidden]","b64":"[hidden]"}');
  assert.equal(binaryHoldsSecret(Buffer.concat([Buffer.from([0, 1, 2]), Buffer.from(secret), Buffer.from([255])]), secret), true);
  assert.equal(binaryHoldsSecret(Buffer.from(Buffer.from(secret).toString("base64")), secret), true);
  assert.equal(binaryHoldsSecret(Buffer.from([0, 1, 2, 3, 4, 5]), secret), false);
  // secret_use itself runs its response through scrubSecret (agent/tools.ts).
  const src = readFileSync(path.resolve("src", "agent", "tools.ts"), "utf8");
  const run = src.slice(src.indexOf('tool("secret_use"'), src.indexOf("];", src.indexOf('tool("secret_use"')));
  assert.match(run, /content: scrubSecret\(`Status \$\{res\.status\}/);
});

test("M2: the disk quota is only tried where Docker supports it; container sizes are read from docker ps", () => {
  assert.equal(quotaPossible("overlay2", "xfs"), true);
  assert.equal(quotaPossible("overlay2", "extfs"), false);
  assert.equal(quotaPossible("overlayfs", ""), false);
  assert.equal(quotaPossible("btrfs", ""), true);
  assert.equal(quotaPossible("zfs", ""), true);
  assert.equal(parseDockerSize("12.3MB (virtual 3.55GB)"), 12.3e6);
  assert.equal(parseDockerSize("1.5GB (virtual 5GB)"), 1.5e9);
  assert.equal(parseDockerSize("0B (virtual 1GB)"), 0);
  assert.equal(parseDockerSize("garbage"), 0);
});

test("H2: a computer's socket serves only its bots' tool endpoint and relay; the web port no longer serves them", async () => {
  const link = botLinkRoutes((id) => id === "bot_mine");
  assert.equal((await link.request("/mcp/bot_other", { method: "POST", body: "{}" })).status, 404);
  assert.equal((await link.request("/egress/bot_other/k/h/x")).status, 404);
  assert.equal((await link.request("/api/health")).status, 404);
  assert.equal((await link.request("/mcp/bot_mine", { method: "GET" })).status, 405);
  // On the web port: socket mode is the default inside a container (DATA_VOLUME); here the server runs as in
  // development (network mode), so the routes are still there, as before.
  const { site } = await import("../src/routes.js");
  assert.equal((await site.request("/mcp/bot_x", { method: "GET" })).status, 405);
});

test("Info: the Codex tool's MCP token goes through a private file read by the wrapper, never `docker exec -e`", async () => {
  const { ENGINE_WRAPPER, SECRET_ENV_FILE, secretEnvFile } = await import("../src/agent/engine.js");
  const { execFileSync } = await import("node:child_process");
  const { existsSync, writeFileSync } = await import("node:fs");
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-wrap-"));
  const file = path.join(dir, "turn-secrets.env");
  writeFileSync(file, secretEnvFile({ SKLUBOT_MCP_TOKEN: "abc123'quote" }), { mode: 0o600 });
  const wrapper = ENGINE_WRAPPER.split(SECRET_ENV_FILE).join(file).replace("/tmp/sklubot-engine.pid", path.join(dir, "pid"));
  const out = execFileSync("sh", ["-c", wrapper, "sh", "sh", "-c", 'printf %s "$SKLUBOT_MCP_TOKEN"']).toString();
  assert.equal(out, "abc123'quote");
  assert.equal(existsSync(file), false, "the file is gone before the tool runs");
  // And the Codex turn no longer passes it as an exec variable.
  const src = readFileSync(path.resolve("src", "agent", "engine.ts"), "utf8");
  assert.doesNotMatch(src, /host\.exec\(bot, args, \{ SKLUBOT_MCP_TOKEN/);
  assert.match(src, /writeFile\(bot\.id, SECRET_ENV_FILE, secretEnvFile\(\{ SKLUBOT_MCP_TOKEN: token \}\)\)/);
});
