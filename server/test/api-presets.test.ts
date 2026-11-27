import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L175 — publishing and backlogs elsewhere, under approval: Linear and Netlify through their official tool servers
// (catalog.ts), X, Instagram and Trello through ready API connectors (apipresets.ts) whose token the owner types on the card.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-apip-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { API_PRESETS, presetOf } = await import("../src/apipresets.js");
const { apiTools, apiConnectors, cleanBase, cleanEndpoints, matchEndpoint } = await import("../src/apiconnectors.js");
const { CATALOG, catalogFor } = await import("../src/catalog.js");
const { users, bots, rows } = await import("../src/store.js");

test("catalogue: Linear and Netlify official servers, signed in with OAuth, in both languages", () => {
  for (const [id, url] of [["linear", "https://mcp.linear.app/mcp"], ["netlify", "https://mcp.netlify.com/mcp"]] as const) {
    const app = CATALOG.find((a) => a.id === id)!;
    assert.equal(app.url, url); assert.equal(app.auth, "oauth"); assert.equal(app.oauthClient, "dynamic");
    const fr = catalogFor("fr").find((a) => a.id === id)!;
    assert.match(fr.description, /avec ton accord/);
    assert.notEqual(fr.description, app.description, `${id} is translated`);
  }
});

test("presets: official https hosts, clean endpoints, every change marked as asked", () => {
  assert.deepEqual(API_PRESETS.map((p) => p.id), ["x", "instagram", "trello"]);
  const hosts: Record<string, string> = { x: "api.x.com", instagram: "graph.instagram.com", trello: "api.trello.com" };
  for (const p of API_PRESETS) {
    assert.equal(cleanBase(p.baseUrl)?.host, hosts[p.id], p.id);
    assert.equal(cleanEndpoints(p.endpoints).length, p.endpoints.length, `${p.id}: every endpoint passes the connector's own check`);
    for (const e of p.endpoints.filter((x) => x.method !== "GET")) assert.match(e.description, /asks/, `${p.id} ${e.method} ${e.path}`);
    assert.match(p.docs, /^https:\/\/(docs\.x\.com|developers\.facebook\.com|developer\.atlassian\.com)\//);
    assert.doesNotMatch(JSON.stringify(p), /sk-|ghp_|EAAG/, "no real-looking key");
  }
  assert.equal(presetOf("X")?.id, "x");
  assert.equal(presetOf("nope"), undefined);
});

test("api_connector_propose with a preset: the vendor's address and endpoints on the card, the owner's own token, pending until approved", async () => {
  const user = users.create("presets@example.com", "P", "x", "fr");
  const bot = bots.create(user.id, { name: "Rose" });
  const ctx = { bot, user, tainted: false, depth: 0, signal: new AbortController().signal } as any;
  const propose = apiTools.find((t) => t.spec.name === "api_connector_propose")!;
  assert.deepEqual((propose.spec.inputSchema as any).required, ["name"]);
  const r = await propose.run({ name: "", preset: "instagram", base_url: "https://evil.example.org" }, ctx);
  assert.equal(r.isError, undefined, String(r.content));
  const conn = apiConnectors.list(user.id)[0];
  assert.equal(conn.name, "Instagram"); assert.equal(conn.host, "graph.instagram.com", "the preset's address wins over anything else given");
  assert.equal(conn.status, "pending");
  assert.ok(matchEndpoint(conn, "POST", "/17841400000000000/media_publish"));
  assert.equal(matchEndpoint(conn, "DELETE", "/17841400000000000"), null);
  const card = rows.list(bot.id, bots.byId(bot.id)!.generation ?? 0).map((x: any) => x.body?.card).find((c: any) => c?.type === "apiconnector");
  assert.equal(card.preset, "instagram"); assert.equal(card.secret, "Instagram access token"); assert.equal(card.secretSaved, false);
});
