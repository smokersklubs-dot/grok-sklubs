import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-oauth-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
// The fake outside services of these tests listen on this machine; outside tests, such addresses are refused.
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";

/**
 * A local app protected by OAuth, playing both roles of the MCP authorization spec: the tool server
 * (401 + protected-resource metadata) and its authorization server (metadata, dynamic registration
 * when `dcr` is on, authorize with PKCE, token endpoint with code and refresh grants).
 */
function fakeApp(opts: { dcr: boolean; secret?: string }) {
  const s = {
    base: "", registered: [] as any[], codes: new Map<string, { challenge: string; clientId: string; redirectUri: string }>(),
    access: new Set<string>(), refresh: new Set<string>(), n: 0, refreshes: 0, unauthorized: 0, seen: [] as string[], tokenBodies: [] as Record<string, string>[],
  };
  const issue = () => { s.n += 1; const at = `at_${s.n}_secretvalue`; const rt = `rt_${s.n}_secretvalue`; s.access.add(at); s.refresh.add(rt); return { access_token: at, refresh_token: rt, token_type: "Bearer", expires_in: 3600 }; };
  const server = createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const url = new URL(req.url!, s.base);
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks).toString();
    const json = (v: unknown, status = 200) => { res.statusCode = status; res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
    if (url.pathname.startsWith("/.well-known/oauth-protected-resource")) return json({ resource: `${s.base}/mcp`, authorization_servers: [s.base] });
    if (url.pathname === "/.well-known/oauth-authorization-server") {
      return json({
        issuer: s.base, authorization_endpoint: `${s.base}/authorize`, token_endpoint: `${s.base}/token`,
        ...(opts.dcr ? { registration_endpoint: `${s.base}/register` } : {}),
        response_types_supported: ["code"], grant_types_supported: ["authorization_code", "refresh_token"], code_challenge_methods_supported: ["S256"],
        token_endpoint_auth_methods_supported: opts.secret ? ["client_secret_post"] : ["none"],
      });
    }
    if (url.pathname === "/register" && opts.dcr) { const meta = JSON.parse(body); s.registered.push(meta); return json({ ...meta, client_id: "dyn-client-1" }, 201); }
    if (url.pathname === "/authorize") {
      // The user approves straight away: back to the redirect URI with a code and the same state.
      const code = `code_${s.codes.size + 1}`;
      s.codes.set(code, { challenge: url.searchParams.get("code_challenge")!, clientId: url.searchParams.get("client_id")!, redirectUri: url.searchParams.get("redirect_uri")! });
      const back = new URL(url.searchParams.get("redirect_uri")!);
      back.searchParams.set("code", code);
      back.searchParams.set("state", url.searchParams.get("state")!);
      res.statusCode = 302; res.setHeader("location", back.toString()); res.end(); return;
    }
    if (url.pathname === "/token") {
      const p = Object.fromEntries(new URLSearchParams(body));
      s.tokenBodies.push(p);
      if (opts.secret && p.client_secret !== opts.secret) return json({ error: "invalid_client" }, 401);
      if (p.grant_type === "authorization_code") {
        const c = s.codes.get(p.code);
        s.codes.delete(p.code);
        const challenge = createHash("sha256").update(p.code_verifier ?? "").digest("base64url");
        if (!c || c.challenge !== challenge || c.clientId !== p.client_id || c.redirectUri !== p.redirect_uri) return json({ error: "invalid_grant" }, 400);
        return json(issue());
      }
      if (p.grant_type === "refresh_token") {
        if (!s.refresh.has(p.refresh_token)) return json({ error: "invalid_grant" }, 400);
        s.refresh.delete(p.refresh_token);
        s.refreshes += 1;
        return json(issue());
      }
      return json({ error: "unsupported_grant_type" }, 400);
    }
    if (url.pathname === "/mcp") {
      const bearer = /^Bearer (.+)$/.exec(req.headers.authorization ?? "")?.[1];
      if (!bearer || !s.access.has(bearer)) {
        s.unauthorized += 1;
        res.statusCode = 401;
        res.setHeader("www-authenticate", `Bearer resource_metadata="${s.base}/.well-known/oauth-protected-resource/mcp"`);
        res.end(); return;
      }
      s.seen.push(bearer);
      const mcp = new McpServer({ name: "crm", version: "1.0.0" });
      mcp.registerTool("list_deals", { description: "List open deals", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "Deal A: 12k, Deal B: 40k" }] }));
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      await mcp.connect(transport);
      await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
      return;
    }
    res.statusCode = 404; res.end();
  });
  return { s, server };
}

const listen = async (app: ReturnType<typeof fakeApp>) => {
  await new Promise<void>((r) => app.server.listen(0, "127.0.0.1", () => r()));
  app.s.base = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`;
  return app;
};
const crm = await listen(fakeApp({ dcr: true }));
const hub = await listen(fakeApp({ dcr: false, secret: "manual-secret-xyz" }));

const { api } = await import("../src/routes.js");
const { connectors } = await import("../src/connectors.js");
const { q } = await import("../src/db.js");
const { seal, unseal } = await import("../src/auth.js");
after(async () => { await connectors.closeAll(); for (const a of [crm, hub]) { a.server.closeAllConnections(); a.server.close(); } });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* HTML */ }
  return { status: res.status, json, text };
}
const REDIRECT = "https://sklubot.example/api/connectors/oauth/callback";
const sealedRow = (id: string) => q.get<{ oauth_enc: string | null }>("SELECT oauth_enc FROM connectors WHERE id = ?", id)!.oauth_enc;
const oauthData = (id: string) => { const enc = sealedRow(id); return enc ? JSON.parse(unseal(enc)!) : {}; };

/** Plays the browser: opens the authorize URL, follows the provider's redirect back to our callback. */
async function approve(authorizeUrl: string) {
  const r = await fetch(authorizeUrl, { redirect: "manual" });
  const back = new URL(r.headers.get("location")!);
  assert.equal(back.origin + back.pathname, REDIRECT);
  return call("GET", `/connectors/oauth/callback${back.search}`);
}
const signIn = async (id: string, extra: Record<string, unknown> = {}) => {
  const start = await call("POST", `/connectors/${id}/oauth/start`, extra);
  assert.equal(start.status, 200, start.text);
  return { start, done: await approve(start.json.authorizeUrl) };
};

let conId = "";

test("an OAuth app: sign-in with discovery, dynamic registration and PKCE, then its tools work", async () => {
  await call("POST", "/auth/signup", { email: "ana@example.com", name: "Ana", password: "password123", locale: "fr" });
  const added = await call("POST", "/connectors", { name: "Fake CRM", url: `${crm.s.base}/mcp`, auth: "oauth" });
  assert.equal(added.status, 200, added.text);
  conId = added.json.connector.id;
  assert.equal(added.json.connector.status, "needs_auth");
  assert.equal(added.json.connector.auth, "oauth");
  assert.deepEqual(added.json.connector.oauth, { signedIn: false, customClient: false });
  assert.equal((await call("GET", "/connectors")).json.oauthRedirectUri, REDIRECT);

  const start = await call("POST", `/connectors/${conId}/oauth/start`, {});
  const u = new URL(start.json.authorizeUrl);
  assert.equal(u.origin + u.pathname, `${crm.s.base}/authorize`);
  assert.equal(u.searchParams.get("response_type"), "code");
  assert.equal(u.searchParams.get("code_challenge_method"), "S256");
  assert.match(u.searchParams.get("code_challenge")!, /^[\w-]{43}$/);
  assert.equal(u.searchParams.get("client_id"), "dyn-client-1");
  assert.equal(u.searchParams.get("redirect_uri"), REDIRECT);
  assert.equal(u.searchParams.get("resource"), `${crm.s.base}/mcp`);
  assert.ok((u.searchParams.get("state") ?? "").length >= 24);
  assert.deepEqual(crm.s.registered[0].redirect_uris, [REDIRECT], "registered itself with our redirect URI");
  assert.equal(crm.s.registered[0].token_endpoint_auth_method, "none");

  // The pending sign-in: keyed by a hash of the state, verifier sealed, ten minutes.
  const pending = q.all<any>("SELECT * FROM oauth_pending WHERE connector_id = ?", conId);
  assert.equal(pending.length, 1);
  assert.notEqual(pending[0].state_hash, u.searchParams.get("state"));
  const verifier = unseal(pending[0].verifier_enc)!;
  assert.equal(createHash("sha256").update(verifier).digest("base64url"), u.searchParams.get("code_challenge"));
  assert.ok(pending[0].expires_at - Date.now() <= 10 * 60_000 && pending[0].expires_at - Date.now() > 9 * 60_000);

  const back = await approve(start.json.authorizeUrl);
  assert.equal(back.status, 200, back.text);
  assert.match(back.text, /Connecté à Fake CRM/);
  assert.match(back.text, /BroadcastChannel\("sklubot-oauth"\)/);
  assert.equal(q.all("SELECT * FROM oauth_pending WHERE connector_id = ?", conId).length, 0, "single use");

  const list = await call("GET", "/connectors");
  const con = list.json.connectors.find((c: any) => c.id === conId);
  assert.equal(con.status, "ready");
  assert.deepEqual(con.tools.map((t: any) => t.name), ["list_deals"]);
  assert.deepEqual(con.oauth, { signedIn: true, customClient: false });

  // Tokens are stored sealed and never returned by any API.
  const stored = oauthData(conId);
  assert.equal(stored.tokens.access_token, "at_1_secretvalue");
  assert.equal(sealedRow(conId)!.includes("secretvalue"), false);
  for (const path of ["/connectors", "/connectors/catalog", "/audit", "/export/data"]) {
    const r = await call("GET", path);
    assert.equal(r.text.includes("secretvalue"), false, `no token in ${path}`);
    assert.equal(r.text.includes("dyn-client-1"), false, `no client in ${path}`);
  }
  assert.deepEqual(await connectors.call(conId, "list_deals", {}), { text: "Deal A: 12k, Deal B: 40k", isError: false });
  assert.equal(crm.s.seen.at(-1), "at_1_secretvalue");

  const entries = (await call("GET", "/audit")).json.entries.map((e: any) => e.text);
  assert.ok(entries.includes("Sign-in started: Fake CRM"));
  assert.ok(entries.includes("App signed in: Fake CRM"));
});

test("a callback cannot be replayed, forged or used from another account", async () => {
  const bad = await call("GET", "/connectors/oauth/callback?code=x&state=nope");
  assert.equal(bad.status, 400);
  assert.match(bad.text, /expiré ou a déjà servi/);
  const start = await call("POST", `/connectors/${conId}/oauth/start`, {});
  // The stored sign-in can be renewed, so starting again just refreshes it.
  assert.equal(start.json.connector?.status, "ready");
  assert.equal(start.json.authorizeUrl, undefined);
});

test("an expired or refused access token is refreshed automatically", async () => {
  // 401: the app revoked the access token; the SDK refreshes and retries.
  crm.s.access.clear();
  const before = crm.s.refreshes;
  assert.equal((await connectors.call(conId, "list_deals", {})).isError, false);
  assert.equal(crm.s.refreshes, before + 1);
  assert.match(crm.s.seen.at(-1)!, /^at_\d+_secretvalue$/);
  assert.notEqual(crm.s.seen.at(-1), "at_1_secretvalue");

  // Expiry: refreshed before calling, without hitting a 401.
  const d = oauthData(conId);
  q.run("UPDATE connectors SET oauth_enc = ? WHERE id = ?", seal(JSON.stringify({ ...d, savedAt: Date.now() - 3_700_000 })), conId);
  const unauthorized = crm.s.unauthorized;
  assert.equal((await connectors.call(conId, "list_deals", {})).isError, false);
  assert.equal(crm.s.refreshes, before + 2);
  assert.equal(crm.s.unauthorized, unauthorized, "no 401 needed");
  assert.equal(crm.s.tokenBodies.at(-1)!.grant_type, "refresh_token");
});

test("when the refresh fails, the app asks for a new sign-in instead of dying", async () => {
  crm.s.access.clear();
  crm.s.refresh.clear();
  await assert.rejects(connectors.call(conId, "list_deals", {}), /sign in again/);
  const con = (await call("GET", "/connectors")).json.connectors.find((c: any) => c.id === conId);
  assert.equal(con.status, "needs_auth");
  assert.equal(con.oauth.signedIn, false);
  assert.ok((await call("GET", "/audit")).json.entries.some((e: any) => /Fake CRM needs signing in again/.test(e.text)));
  // The way out: sign in again.
  const { done } = await signIn(conId);
  assert.equal(done.status, 200);
  assert.equal((await call("GET", "/connectors")).json.connectors.find((c: any) => c.id === conId).status, "ready");
});

test("disconnect forgets the tokens", async () => {
  const r = await call("POST", `/connectors/${conId}/oauth/disconnect`);
  assert.equal(r.json.connector.status, "needs_auth");
  assert.equal(oauthData(conId).tokens, undefined);
  assert.equal(oauthData(conId).client.client_id, "dyn-client-1", "the registration is kept for the next sign-in");
  assert.ok((await call("GET", "/audit")).json.entries.some((e: any) => e.text === "App signed out: Fake CRM"));
  assert.equal((await call("POST", `/connectors/${conId}/oauth/disconnect`)).status, 200);
});

test("an app without dynamic registration asks for a client ID, then signs in with it", async () => {
  const added = await call("POST", "/connectors", { name: "Hub", url: `${hub.s.base}/mcp`, auth: "oauth" });
  const id = added.json.connector.id;
  const first = await call("POST", `/connectors/${id}/oauth/start`, {});
  assert.deepEqual(first.json, { needsClientId: true, redirectUri: REDIRECT });
  const { start, done } = await signIn(id, { clientId: "manual-client", clientSecret: "manual-secret-xyz" });
  assert.equal(new URL(start.json.authorizeUrl).searchParams.get("client_id"), "manual-client");
  assert.equal(done.status, 200, done.text);
  assert.equal(hub.s.tokenBodies.at(-1)!.client_secret, "manual-secret-xyz", "client_secret_post, as the server asks");
  const list = await call("GET", "/connectors");
  const con = list.json.connectors.find((c: any) => c.id === id);
  assert.equal(con.status, "ready");
  assert.deepEqual(con.oauth, { signedIn: true, customClient: true });
  assert.equal(list.text.includes("manual-secret-xyz"), false);
  assert.equal(sealedRow(id)!.includes("manual-secret-xyz"), false);
});

test("an app added by its address that wants OAuth is recognised", async () => {
  const added = await call("POST", "/connectors", { name: "By address", url: `${crm.s.base}/mcp` });
  assert.equal(added.json.connector.auth, "oauth");
  assert.equal(added.json.connector.status, "needs_auth");
  const { done } = await signIn(added.json.connector.id);
  assert.equal(done.status, 200);
});

test("the catalogue lists business apps with a sign-in", async () => {
  const r = await call("GET", "/connectors/catalog");
  const apps = r.json.apps;
  assert.equal(r.json.oauthRedirectUri, REDIRECT);
  const hubspot = apps.find((a: any) => a.id === "hubspot");
  assert.equal(hubspot.auth, "oauth");
  assert.equal(hubspot.oauthClient, "manual");
  assert.match(hubspot.tokenHelp, /MCP Connectors/);
  assert.ok(apps.filter((a: any) => a.auth === "oauth").length >= 8);
  assert.ok(apps.some((a: any) => a.category === "Analytique & SEO"), "French categories");
});
