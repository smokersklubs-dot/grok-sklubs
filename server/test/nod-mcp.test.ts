import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// nod audit items 10 (fall back to the older HTTP+SSE transport; rename an app) and 17 (a private MCP address typed
// by the user, self-hosted only, its token sent to that address only). mcptransport.ts, connectors.ts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-nod-mcp-"));
process.env.SESSION_SECRET = "nod-mcp-secret-nod-mcp-secret-nod-mcp";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "ALLOW_PRIVATE_FETCH"]) delete process.env[k];

const { Server } = await import("@modelcontextprotocol/sdk/server/index.js");
const { SSEServerTransport } = await import("@modelcontextprotocol/sdk/server/sse.js");
const { ListToolsRequestSchema } = await import("@modelcontextprotocol/sdk/types.js");

// An old MCP server: HTTP+SSE only (GET /mcp opens the stream, POST /messages carries requests). A POST to /mcp — the
// Streamable HTTP transport — gets 405, as such servers answer.
const auths: string[] = [];
const transports = new Map<string, InstanceType<typeof SSEServerTransport>>();
const legacy = createServer(async (req, res: ServerResponse) => {
  auths.push(String(req.headers.authorization ?? ""));
  const url = new URL(req.url ?? "/", "http://x");
  if (url.pathname === "/mcp" && req.method === "GET") {
    const t = new SSEServerTransport("/messages", res);
    transports.set(t.sessionId, t);
    const s = new Server({ name: "old", version: "1.0.0" }, { capabilities: { tools: {} } });
    s.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: [{ name: "list_workflows", description: "List workflows", inputSchema: { type: "object", properties: {} } }] }));
    await s.connect(t);
    return;
  }
  if (url.pathname === "/messages" && req.method === "POST") { await transports.get(url.searchParams.get("sessionId") ?? "")?.handlePostMessage(req, res); return; }
  if (url.pathname === "/redirect") { res.writeHead(302, { location: "http://example.com/mcp" }).end(); return; }
  res.writeHead(405).end();
});
await new Promise<void>((r) => legacy.listen(0, "127.0.0.1", () => r()));
const LEGACY = `http://127.0.0.1:${(legacy.address() as { port: number }).port}`;
after(async () => { const { connectors } = await import("../src/connectors.js"); await connectors.closeAll(); legacy.closeAllConnections(); legacy.close(); });

const { api } = await import("../src/routes.js");
const { shouldFallBack, looksPrivateHost, checkPrivateConnectorUrl, fetchForConnector } = await import("../src/mcptransport.js");

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");

test("which failures fall back to HTTP+SSE: 4xx except 401 / 403", () => {
  assert.equal(shouldFallBack({ code: 405 }), true);
  assert.equal(shouldFallBack({ code: 404 }), true);
  assert.equal(shouldFallBack({ code: 400 }), true);
  assert.equal(shouldFallBack({ code: 401 }), false);
  assert.equal(shouldFallBack({ code: 403 }), false);
  assert.equal(shouldFallBack({ code: 500 }), false);
  assert.equal(shouldFallBack(new TypeError("fetch failed")), false);
});

test("a private address is refused unless the user ticks it; then the old SSE server connects and its token goes there only", async () => {
  const plain = await call("POST", "/connectors", { name: "n8n maison", url: `${LEGACY}/mcp`, token: "sk-fake-for-tests" });
  assert.equal(plain.json.connector.status, "error");
  assert.match(plain.json.connector.error, /private or local network/);
  assert.equal(auths.length, 0, "nothing was sent to the private address");
  const typed = await call("POST", "/connectors", { name: "n8n maison", url: `${LEGACY}/mcp`, token: "sk-fake-for-tests", privateNetwork: true });
  assert.equal(typed.status, 200);
  assert.equal(typed.json.connector.status, "ready", JSON.stringify(typed.json.connector));
  assert.deepEqual(typed.json.connector.tools.map((t: any) => t.name), ["list_workflows"], "connected through the HTTP+SSE fallback");
  assert.ok(auths.includes("Bearer sk-fake-for-tests"));
  // The connector's fetch reaches only that origin, and never follows a redirect.
  const f = fetchForConnector(typed.json.connector.id);
  await assert.rejects(f("http://127.0.0.1:1/other"), /only reach the address you typed/);
  await assert.rejects(f(`${LEGACY}/redirect`));
  // Renamed: the same app, a new name; another account cannot.
  const renamed = await call("PATCH", `/connectors/${typed.json.connector.id}`, { name: "  Mon n8n  " });
  assert.equal(renamed.json.connector.name, "Mon n8n");
  assert.equal((await call("GET", "/connectors")).json.connectors.find((k: any) => k.id === typed.json.connector.id).name, "Mon n8n");
  assert.equal((await call("PATCH", `/connectors/${typed.json.connector.id}`, { name: "x" }, "b")).status, 404);
  assert.equal((await call("PATCH", `/connectors/${typed.json.connector.id}`, { name: "   " })).status, 400);
});

test("what counts as the user's own network; public addresses and link-local are refused for the private option", () => {
  for (const h of ["localhost", "127.0.0.1", "192.168.1.20", "10.0.0.5", "100.101.102.103", "n8n.local", "box.tail1234.ts.net", "nas"]) assert.equal(looksPrivateHost(h), true, h);
  for (const h of ["example.com", "8.8.8.8"]) assert.equal(looksPrivateHost(h), false, h);
  assert.throws(() => checkPrivateConnectorUrl("https://example.com/mcp"), /not on a private network/);
  assert.throws(() => checkPrivateConnectorUrl("http://169.254.169.254/latest"), /Link-local/);
  assert.throws(() => checkPrivateConnectorUrl("http://user:pw@192.168.1.2/mcp"), /without a name or password/);
  assert.equal(checkPrivateConnectorUrl("http://192.168.1.2:5678/mcp"), "http://192.168.1.2:5678");
});

test("hosted mode never accepts a private address, even typed", async () => {
  process.env.HOSTED_MODE = "1";
  try {
    assert.throws(() => checkPrivateConnectorUrl("http://192.168.1.2/mcp"), /only possible on a Sklubot you host yourself/);
  } finally { delete process.env.HOSTED_MODE; }
});
