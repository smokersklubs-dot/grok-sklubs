import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// L159: an app « pour tous mes bots » with per-bot opt-out (connectorbots.ts), a contact card in the vault
// (vaultcontacts.ts) and the verified registry of sites where a bot signed in (siteregistry.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l159-"));
process.env.SESSION_SECRET = "l159-secret-l159-secret-l159-secret-l";
process.env.NO_SCHEDULER = "1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const local = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const ch of req) chunks.push(ch as Buffer);
  const body = chunks.length ? Buffer.concat(chunks).toString() : "";
  const mcp = new McpServer({ name: "notes", version: "1.0.0" });
  mcp.registerTool("list_notes", { description: "List notes", inputSchema: {} }, async () => ({ content: [{ type: "text", text: "a note" }] }));
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await mcp.connect(transport);
  await transport.handleRequest(req, res, body ? JSON.parse(body) : undefined);
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const MCP = `http://127.0.0.1:${(local.address() as { port: number }).port}/mcp`;
after(async () => { const { connectors } = await import("../src/connectors.js"); await connectors.closeAll(); local.closeAllConnections(); local.close(); });

const { api } = await import("../src/routes.js");
const { connectors } = await import("../src/connectors.js");
const { rowScope } = await import("../src/store.js");
const { noteLoginTyped, noteSitePage, isPasswordField, sameSite } = await import("../src/siteregistry.js");
const { contactTools, cleanContact } = await import("../src/vaultcontacts.js");

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
const me = (await call("GET", "/me")).json.user;
const first = (await call("GET", "/bots")).json.bots[0];
const second = (await call("POST", "/bots", { name: "Scout" })).json.bot;

test("an app serves all my bots by default; one bot unticked loses its tools and cannot call it", async () => {
  const app = (await call("POST", "/connectors", { name: "Notes", url: MCP })).json.connector;
  assert.equal(app.status, "ready");
  const toolsOf = (botId: string) => rowScope.run({ botId, thread: 0 }, () => connectors.toolsFor(me.id)).then((l) => l.map((t) => t.remoteName));
  assert.deepEqual(await toolsOf(first.id), ["list_notes"]);
  assert.deepEqual(await toolsOf(second.id), ["list_notes"]);
  const r0 = await call("GET", `/connectors/${app.id}/bots`);
  assert.equal(r0.json.allBots, true);
  assert.deepEqual(r0.json.allowed.sort(), [first.id, second.id].sort());

  const r1 = await call("PUT", `/connectors/${app.id}/bots`, { allBots: true, bots: { [second.id]: false, bot_of_someone_else: false } });
  assert.deepEqual(r1.json.bots, { [second.id]: false });
  assert.deepEqual(r1.json.allowed, [first.id]);
  assert.deepEqual(await toolsOf(second.id), []);
  await assert.rejects(connectors.call(app.id, "list_notes", {}, second.id), /may not use this app/);
  assert.equal((await connectors.call(app.id, "list_notes", {}, first.id)).text.includes("a note"), true);

  // « Seulement les bots choisis »: only the ticked one; a bot created later does not get it.
  const r2 = await call("PUT", `/connectors/${app.id}/bots`, { allBots: false, bots: { [second.id]: true } });
  assert.deepEqual(r2.json.allowed, [second.id]);
  const third = (await call("POST", "/bots", { name: "Nova" })).json.bot;
  assert.deepEqual(await toolsOf(third.id), []);
  assert.deepEqual(await toolsOf(first.id), []);
  assert.deepEqual(await toolsOf(second.id), ["list_notes"]);
  // Another account: 404.
  assert.equal((await call("GET", `/connectors/${app.id}/bots`, undefined, "b")).status, 404);
  assert.equal((await call("PUT", `/connectors/${app.id}/bots`, { allBots: true }, "b")).status, 404);
});

test("contact cards: saved sealed, checked, reserved to some bots, read by the bot's tool", async () => {
  assert.throws(() => cleanContact({ label: "vide" }), /at least a name/);
  assert.throws(() => cleanContact({ fullName: "A", email: "pas-un-mail" }), /email/);
  assert.equal((await call("POST", "/vault/contacts", { label: "x", email: "bad" })).status, 400);
  const home = (await call("POST", "/vault/contacts", { label: "Maison", fullName: "Camille Martin", address1: "3 rue des Lilas", postalCode: "69001", city: "Lyon", country: "France", phone: "+33 6 00 00 00 00", email: "camille@example.com" })).json.contact;
  assert.equal(home.fields.city, "Lyon");
  const work = (await call("POST", "/vault/contacts", { label: "Bureau", company: "Atelier", address1: "1 quai", city: "Paris", bots: [second.id, "bot_unknown"] })).json.contact;
  assert.deepEqual(work.bots, [second.id]);
  assert.equal((await call("GET", "/vault/contacts", undefined, "b")).json.contacts.length, 0);
  assert.equal((await call("DELETE", `/vault/contacts/${home.id}`, undefined, "b")).status, 404);
  const { q } = await import("../src/db.js");
  const raw = q.get<{ data_enc: string }>("SELECT data_enc FROM vault_contacts WHERE id = ?", home.id)!;
  assert.ok(!raw.data_enc.includes("Lilas"), "sealed on disk");

  const tool = contactTools[0];
  const { bots, users } = await import("../src/store.js");
  const ctx = (botId: string) => ({ bot: bots.byId(botId)!, user: users.byId(me.id)!, depth: 0, signal: new AbortController().signal }) as any;
  assert.match((await tool.run({}, ctx(first.id))).content as string, /"Maison"/);
  assert.doesNotMatch((await tool.run({}, ctx(first.id))).content as string, /Bureau/);
  assert.match((await tool.run({ card: "maison" }, ctx(first.id))).content as string, /postalCode: 69001/);
  const refused = await tool.run({ card: "Bureau" }, ctx(first.id));
  assert.equal(refused.isError, true);
  assert.match(refused.content as string, /reserved to other bots/);
  // After outside content, each read asks first, single use; before, no card.
  assert.equal(tool.gate!({ card: "Maison" }, { botId: first.id, tainted: false }), null);
  const g = tool.gate!({ card: "Maison" }, { botId: first.id, tainted: true })!;
  assert.equal(g.strict, true);
  assert.equal(g.once, true);
  const upd = await call("PUT", `/vault/contacts/${home.id}`, { label: "Maison", fullName: "Camille M.", city: "Lyon" });
  assert.equal(upd.json.contact.fields.fullName, "Camille M.");
  assert.equal((await call("DELETE", `/vault/contacts/${work.id}`)).status, 200);
});

test("verified sites: « à vérifier » after the password, « connecté » once the page has no password field, « à reconnecter » when it comes back", async () => {
  assert.ok(isPasswordField({ role: "textbox", name: "Mot de passe" }));
  assert.ok(!isPasswordField({ role: "button", name: "Mot de passe oublié ?" }));
  assert.ok(sameSite("login.shop.example", "shop.example"));
  assert.ok(!sameSite("shop.example", "evil-shop.example"));
  const t0 = 1_000_000_000_000;
  noteLoginTyped(me.id, first.id, "shop.example", "Boutique", t0);
  let list = (await call("GET", "/sites")).json.sites;
  assert.deepEqual(list.map((s: any) => [s.host, s.status, s.botName]), [["shop.example", "checking", first.name]]);
  const loginPage = [{ role: "textbox", name: "E-mail" }, { role: "textbox", name: "Mot de passe" }];
  assert.equal(noteSitePage(first.id, "https://shop.example/login", loginPage, t0 + 5_000), null, "the sign-in page right after typing: still checking");
  assert.equal(noteSitePage(first.id, "https://other.example/", [], t0 + 6_000), null, "another site changes nothing");
  assert.equal(noteSitePage(first.id, "https://www.shop.example/compte", [{ role: "link", name: "Mes commandes" }], t0 + 9_000), "connected");
  list = (await call("GET", "/sites")).json.sites;
  assert.equal(list[0].status, "connected");
  assert.equal(list[0].verifiedAt, t0 + 9_000);
  assert.equal(noteSitePage(first.id, "https://shop.example/login", loginPage, t0 + 60_000), "reconnect");
  assert.equal((await call("GET", "/sites", undefined, "b")).json.sites.length, 0);
  assert.equal((await call("DELETE", `/sites/${first.id}/shop.example`, undefined, "b")).status, 404);
  assert.equal((await call("DELETE", `/sites/${first.id}/shop.example`)).status, 200);
  assert.equal((await call("GET", "/sites")).json.sites.length, 0);
});
