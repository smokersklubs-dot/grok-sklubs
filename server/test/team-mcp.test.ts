import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Hono } from "hono";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-team-mcp-"));
process.env.DB_PATH = ":memory:";
process.env.SESSION_SECRET = "team-mcp-unique-test-only-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.HOSTED_MODE = "0";
const fixtureModel = "team-mcp-test:local";
process.env.DEFAULT_MODEL = fixtureModel;
process.env.AUX_MODEL = fixtureModel;
for (const name of [
  "ANTHROPIC_API_KEY",
  "OPENAI_API_KEY",
  "XAI_API_KEY",
  "FALLBACK_MODEL",
  "FALLBACK_MODELS",
])
  process.env[name] = "";
const { registerProvider } = await import("../src/llm/index.js");
registerProvider({
  id: "team-mcp-test",
  label: "Local MCP fixture",
  models: ["local"],
  available: () => true,
  async runTurn() {
    return {
      content: [{ type: "text", text: "Sklubot local fixture reply." }],
      stopReason: "end",
      model: "local",
      usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 },
    };
  },
});
const { q } = await import("../src/db.js");
const { users, bots, rows } = await import("../src/store.js");
const { registerTeamMcp, registerTeamMcpOwner } = await import("../src/teammcp.js");
const { findSecrets } = await import("../src/shared.js");
const { screen, holdAndOffer } = await import("../src/pastedsecrets.js");
const { teamClaudeSetup } = await import("../../web/src/lib/teamClaudeSetup.js");
const owner = users.create("team@example.test", "Owner", "unused", "en"),
  outside = users.create("other@example.test", "Other", "unused", "en");
const agent = bots.create(owner.id, { name: "Jiren", model: fixtureModel }),
  foreign = bots.create(outside.id, { name: "Foreign confidential" });
bots.create(owner.id, { name: "Hidden confidential", hidden: true });
bots.create(owner.id, { name: "Group room", kind: "room" });
rows.append(agent, { kind: "message", role: "user", text: "A visible instruction" }, 0);
rows.append(foreign, { kind: "message", role: "user", text: "private outside document" }, 0);
const app = new Hono<any>();
registerTeamMcp(app);
app.use("*", async (c, next) => {
  const who = c.req.header("fixture-user");
  if (!who) return c.json({ error: "session" }, 401);
  c.set("user", who === "owner" ? owner : outside);
  await next();
});
registerTeamMcpOwner(app);
const manage = (method: string, body?: unknown, who = "owner") =>
  app.request("/team-mcp", {
    method,
    headers: { "fixture-user": who, "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
async function connect(secret: string) {
  const client = new Client({ name: "official-sdk-test", version: "1" });
  const transport = new StreamableHTTPClientTransport(new URL("https://fixture.invalid/v1/team/mcp"), {
    requestInit: { headers: { authorization: "Bearer " + secret } },
    fetch: (url, init) => app.request(new URL(String(url)).pathname, init as RequestInit),
  });
  await client.connect(transport);
  return client;
}
const unpack = (result: any) => JSON.parse(result.content[0].text);
test("one owner grant reaches future personal agents with required bot ids and explicit scopes", async () => {
  assert.equal((await manage("POST", { scopes: [] })).status, 400);
  assert.equal((await manage("POST", { scopes: ["read", "approvals"] })).status, 400);
  const response = await manage("POST", { scopes: ["read"] });
  assert.equal(response.status, 201);
  const issued = (await response.json()) as any;
  assert.equal(findSecrets(issued.secret).length, 1);
  const pasted = screen("Mon accès " + issued.secret, "fr");
  assert.ok(!pasted.text.includes(issued.secret));
  holdAndOffer(agent, owner.id, pasted.secrets);
  assert.ok(
    rows
      .list(agent.id, agent.generation, 100)
      .some((r) => r.body.kind === "notice" && /Sklubot team token hidden/.test(r.body.text)),
  );
  assert.ok(!JSON.stringify(q.get("SELECT * FROM team_mcp_keys")).includes(issued.secret));
  assert.ok(!(await (await manage("GET")).text()).includes(issued.secret));
  assert.equal((await manage("POST", { scopes: ["write"] })).status, 409);
  assert.equal((await manage("DELETE", { id: issued.grant.id }, "outside")).status, 404);
  const api = await connect(issued.secret);
  try {
    const added = bots.create(owner.id, { name: "deisng" });
    const tools = (await api.listTools()).tools;
    assert.deepEqual(
      tools.map((t) => t.name),
      ["list_bots", "wait_reply", "read_messages"],
    );
    assert.ok(
      tools
        .filter((t) => t.name !== "list_bots")
        .every((t) => t.inputSchema.required?.includes("bot_id")),
    );
    const list = unpack(await api.callTool({ name: "list_bots", arguments: {} }));
    assert.deepEqual(list.bots.map((b: any) => b.id).sort(), [agent, added].map((b) => b.id).sort());
    for (const bad of [{}, { bot_id: foreign.id }, { bot_id: "missing" }]) {
      const r = await api.callTool({ name: "read_messages", arguments: bad });
      assert.equal(r.isError, true);
      assert.ok(!JSON.stringify(r).includes("private outside"));
    }
    const messages = unpack(
      await api.callTool({ name: "read_messages", arguments: { bot_id: agent.id } }),
    );
    assert.equal(messages.messages[0].text, "A visible instruction");
    for (const name of ["send_message", "create_task", "approve", "read_file"])
      assert.equal((await api.callTool({ name, arguments: { bot_id: agent.id } })).isError, true);
    assert.equal((await manage("DELETE", { id: issued.grant.id })).status, 200);
    await assert.rejects(() => api.listTools());
  } finally {
    await api.close();
  }
});
test("an outside writer starts work through the bot API, respects an unattended cap, cannot approve", async () => {
  const issue = (await (await manage("POST", { scopes: ["write", "tasks"] })).json()) as any;
  const api = await connect(issue.secret);
  try {
    assert.deepEqual(
      (await api.listTools()).tools.map((t) => t.name),
      ["list_bots", "send_message", "create_task"],
    );
    q.run(
      "INSERT INTO usage_caps(user_id,bot_id,period,unit,limit_value,mode,updated_at) VALUES(?,'','day','usd',0,'unattended',?)",
      owner.id,
      Date.now(),
    );
    for (const [name, args] of [
      ["send_message", { text: "hello" }],
      ["create_task", { objective: "hello" }],
    ] as const) {
      const result = await api.callTool({ name, arguments: { ...args, bot_id: agent.id } });
      assert.equal(result.isError, true);
      assert.match(JSON.stringify(result), /usage_cap/);
    }
    q.run("DELETE FROM usage_caps WHERE user_id=?", owner.id);
    const sent = unpack(
      await api.callTool({ name: "send_message", arguments: { text: "Hello!", bot_id: agent.id } }),
    );
    const row = rows.get(agent.id, agent.generation, sent.seq);
    assert.ok(row?.body.kind === "message" && row.body.origin?.kind === "api");
    const replied = () =>
      rows
        .list(agent.id, agent.generation, 30)
        .some(
          (r) =>
            r.body.kind === "message" &&
            r.body.role === "assistant" &&
            r.body.text === "Sklubot local fixture reply.",
        );
    const deadline = Date.now() + 8000;
    while (!replied() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 30));
    assert.ok(replied(), "the message was answered by the isolated local fixture model");
    assert.equal(
      (await api.callTool({ name: "approve", arguments: { bot_id: agent.id } })).isError,
      true,
    );
    assert.equal(
      (await api.callTool({ name: "read_messages", arguments: { bot_id: agent.id } })).isError,
      true,
    );
  } finally {
    await api.close();
    await manage("DELETE", { id: issue.grant.id });
  }
});
test("installation templates keep Sklubot tokens out of command history and reject external cleartext endpoints", () => {
  assert.throws(() => teamClaudeSetup("http://insecure.example", "windows"));
  assert.match(teamClaudeSetup("https://bots.example", "windows"), /Read-Host .* -AsSecureString/);
  assert.match(teamClaudeSetup("https://bots.example", "bash"), /read -rsp/);
  for (const p of ["windows", "bash"] as const)
    assert.match(
      teamClaudeSetup("https://bots.example", p),
      /https:\/\/bots\.example\/api\/v1\/team\/mcp/,
    );
});
