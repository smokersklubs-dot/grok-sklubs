import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-live-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const { browserAvailable, closeAllDesktops, screen, computerState, initComputer } = await import("../src/computer.js");
await initComputer();
const { connectors } = await import("../src/connectors.js");
const { users } = await import("../src/store.js");

// A tiny local site and a tiny local tool server, so nothing here needs the internet.
const site = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<title>Test page</title><h1 id="h">Hello</h1><input id="q" autofocus><button onclick="document.getElementById('h').textContent='Clicked '+document.getElementById('q').value" style="position:absolute;left:100px;top:200px;width:120px;height:40px">Go</button>`);
});
const calls: unknown[] = [];
const toolServer = createServer(async (req, res) => {
  if (req.headers.authorization !== "Bearer s3cret") { res.statusCode = 401; res.end(); return; }
  const mcp = new McpServer({ name: "notes", version: "1.0.0" });
  mcp.registerTool("list_notes", { description: "List notes", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "note A, note B" }] }));
  mcp.registerTool("delete_note", { description: "Delete a note", inputSchema: {} }, async (args) => { calls.push(args); return { content: [{ type: "text", text: "deleted" }] }; });
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  await transport.handleRequest(req, res, chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : undefined);
});
const listen = (s: ReturnType<typeof createServer>) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as { port: number }).port)));
const sitePort = await listen(site);
const toolPort = await listen(toolServer);
after(async () => {
  await closeAllDesktops();
  await connectors.closeAll();
  for (const s of [site, toolServer]) { s.closeAllConnections(); s.close(); }
});

test("a bot can open a page, read it, type and click", { skip: !browserAvailable() && "no browser engine installed" }, async () => {
  const shot = await screen.open("bot_a", "usr_1", `http://127.0.0.1:${sitePort}/`);
  assert.equal(shot.title, "Test page");
  assert.ok(shot.data.length > 1000, "screenshot has content");
  await screen.type("bot_a", "usr_1", "sklubot");
  await screen.click("bot_a", "usr_1", 160, 220);
  assert.match((await screen.read("bot_a", "usr_1")).text, /Clicked sklubot/);
  assert.ok((await screen.peek("bot_a"))!.length > 1000);
  assert.equal(await screen.peek("bot_never_opened"), null, "the viewer never opens a browser by itself");
  assert.equal(computerState("usr_1").desktops.length, 1);
  await assert.rejects(screen.open("bot_a", "usr_1", "file:///etc/passwd"), /only http/);
  await screen.reset("bot_a");
  assert.equal(computerState("usr_1").desktops.length, 0);
});

test("a connector exposes remote tools, classifies them and calls them with the stored token", async () => {
  const user = users.create("kim@example.com", "Kim", "x");
  const bad = await connectors.add(user.id, "Notes", `http://127.0.0.1:${toolPort}/mcp`);
  assert.equal(bad.status, "error", "without the token the server refuses us");
  await connectors.remove(user.id, bad.id);
  const ok = await connectors.add(user.id, "Notes", `http://127.0.0.1:${toolPort}/mcp`, "s3cret");
  assert.equal(ok.status, "ready");
  assert.deepEqual(ok.tools.map((t) => [t.name, t.readOnly]), [["list_notes", true], ["delete_note", false]]);
  assert.equal(JSON.stringify(ok).includes("s3cret"), false, "the token never leaves the server");
  const tools = await connectors.toolsFor(user.id);
  assert.deepEqual(tools.map((t) => t.spec.name), ["app_notes__list_notes", "app_notes__delete_note"]);
  assert.deepEqual(await connectors.call(ok.id, "list_notes", {}), { text: "note A, note B", isError: false });
  await assert.rejects(connectors.add(user.id, "x", "ftp://example.com"), /http/);
});
