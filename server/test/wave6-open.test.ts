import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { execFile } from "node:child_process";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";

// Wave 6 (A-FAIRE L82, L169, L170, L181): several keys per provider with failover, the outbound network policy per bot,
// the open API (OpenAI-compatible chat, memories, OpenAPI file, deprecation headers, outgoing webhooks, headless command)
// and the import of local Claude Code / Codex / OpenClaw / Hermes setups. Fake servers only; a fresh DATA_DIR.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-wave6-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "w6script:w-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider, resolveModel } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows, rowScope, memories } = await import("../src/store.js");
const { _resetKeyRests, keyOrder } = await import("../src/providerkeys.js");
const { netRefusal, browserPolicy, applyBrowserPolicy, setBrowserPolicyWriter } = await import("../src/netpolicy.js");
const { runDueDeliveries, eventsOf, BACKOFF_MS } = await import("../src/outwebhooks.js");
const { PUBLIC_ROUTES, deprecationHeaders, openApiDocument } = await import("../src/openapi.js");
const { excludedWhy, memoryFacts, detectSource } = await import("../src/localimport.js");
const { apiLimits } = await import("../src/botapi.js");
const { RateWindow } = await import("../src/hardening.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** "call <tool> <json>" in the last user text makes one tool call; then the tool's answer is the reply. */
registerProvider({
  id: "w6script", label: "W6 script", models: ["w-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const result = last.content.find((b) => b.type === "tool_result") as Extract<Block, { type: "tool_result" }> | undefined;
    if (result) { const t = result.content.map((x) => (x.type === "text" ? x.text : "")).join(""); return { content: [{ type: "text", text: `TOOL: ${t}` }], stopReason: "end", model: "w-1", usage }; }
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const m = /call (\w+) (\{.*\})/.exec(said);
    if (m) return { content: [{ type: "tool_use", id: `t${Date.now()}`, name: m[1], input: JSON.parse(m[2]) }], stopReason: "tool_use", model: "w-1", usage };
    const words = said.split("\n").filter((l) => l.trim() && !l.startsWith("[")).pop() ?? "";
    const text = `Reply to: ${words}`;
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", model: "w-1", usage };
  },
});

const ORIGIN = process.env.PUBLIC_URL!;
const jars: Record<string, string> = {};
async function call(who: string | null, method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", ...extra };
  if (who && jars[who]) headers.cookie = jars[who];
  const res = await api.request(url, { method, headers, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && who) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json, headers: res.headers };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => T | undefined | false | Promise<T | undefined | false>, what: string, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
/** A local fake HTTP server; `handler` answers each request. */
async function fakeServer(handler: (req: http.IncomingMessage, body: string, res: http.ServerResponse) => void) {
  const server = http.createServer((req, res) => { let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => handler(req, b, res)); });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return { url: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => new Promise<void>((r) => server.close(() => r())) };
}
const lastReply = (botId: string) => { const b = bots.byId(botId)!; return q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'message' ORDER BY seq DESC LIMIT 1", botId, b.generation).map((r) => JSON.parse(r.body))[0]; };

let userA = "", userB = "", botA = "", botA2 = "", botB = "";
test("setup: two accounts", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123" })).json.user.id;
  userB = (await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123" })).json.user.id;
  botA = (await call("a", "POST", "/bots", { name: "Ada" })).json.bot.id;
  botA2 = (await call("a", "POST", "/bots", { name: "Bea" })).json.bot.id;
  botB = (await call("b", "GET", "/bots")).json.bots[0].id;
  assert.ok(userA && userB && botA && botA2 && botB);
});

// ── L82 ────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("L82: named extra keys, never sent back, a bot's choice first, failover on 429 to the next key, rest remembered", async () => {
  const seen: string[] = [];
  const fake = await fakeServer((req, _b, res) => {
    const auth = String(req.headers.authorization ?? "");
    seen.push(auth);
    if (auth === "Bearer sk-fake-main") { res.writeHead(429, { "content-type": "application/json", "retry-after": "30" }); res.end('{"error":{"message":"rate limited"}}'); return; }
    res.writeHead(200, { "content-type": "text/event-stream" });
    res.end(`data: ${JSON.stringify({ choices: [{ index: 0, delta: { content: `ok with ${auth.slice(7)}` }, finish_reason: "stop" }] })}\n\ndata: [DONE]\n\n`);
  });
  try {
    const made = await call("a", "POST", "/api-providers", { name: "Fake", baseUrl: fake.url, key: "sk-fake-main", models: [{ id: "m1" }] });
    assert.equal(made.status, 200, made.text);
    const pid = made.json.provider.id as string;
    const add = await call("a", "POST", `/api-providers/${pid}/keys`, { name: "Travail", key: "sk-fake-work" });
    assert.equal(add.status, 200, add.text);
    assert.ok(!add.text.includes("sk-fake-work") && !add.text.includes("sk-fake-main"), "keys are never sent back");
    assert.deepEqual(add.json.keys.map((k: any) => k.name), ["Main key", "Travail"]);
    assert.equal((await call("a", "POST", `/api-providers/${pid}/keys`, { name: "travail", key: "sk-fake-x" })).status, 409, "names are unique");
    assert.equal((await call("a", "POST", `/api-providers/${pid}/keys`, { name: "Perso", key: "has space" })).status, 400);
    // Isolation: B cannot list, add, or point B's bot at A's provider or keys.
    assert.equal((await call("b", "GET", `/api-providers/${pid}/keys`)).status, 404);
    assert.equal((await call("b", "POST", `/api-providers/${pid}/keys`, { name: "X", key: "sk-fake-b" })).status, 404);
    assert.equal((await call("b", "PUT", `/bots/${botB}/provider-keys`, { providerId: pid, keyId: "main" })).status, 404);
    assert.equal((await call("b", "PUT", `/bots/${botA}/provider-keys`, { providerId: pid, keyId: "main" })).status, 404);
    const workId = add.json.keys[1].id as string;
    assert.ok(!JSON.stringify(q.all("SELECT * FROM provider_keys")).includes("sk-fake-work"), "sealed at rest");

    // Without a choice: main first; 429 → the same call goes on with "Travail".
    const { provider, model } = resolveModel(`${pid}:m1`, userA);
    const req: TurnRequest = { model, system: "s", messages: [{ role: "user", content: [{ type: "text", text: "hi" }] }], tools: [], effort: "low" };
    const r1 = await rowScope.run({ botId: botA2, thread: 0 }, () => provider.runTurn(req));
    assert.equal((r1.content[0] as { text: string }).text, "ok with sk-fake-work");
    assert.deepEqual(seen, ["Bearer sk-fake-main", "Bearer sk-fake-work"]);
    assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE ?", userA, '%switched to "Travail"%'), "the switch is journaled by name");
    // The main key now rests: the next call starts with "Travail" directly.
    seen.length = 0;
    await rowScope.run({ botId: botA2, thread: 0 }, () => provider.runTurn(req));
    assert.deepEqual(seen, ["Bearer sk-fake-work"]);
    // A bot's choice goes first.
    _resetKeyRests();
    const ch = await call("a", "PUT", `/bots/${botA}/provider-keys`, { providerId: pid, keyId: workId });
    assert.equal(ch.status, 200, ch.text);
    assert.equal(keyOrder({ id: pid, userId: userA, mainKeyEnc: q.get<{ key_enc: string }>("SELECT key_enc FROM user_providers WHERE id = ?", pid)!.key_enc }, botA)[0].name, "Travail");
    seen.length = 0;
    await rowScope.run({ botId: botA, thread: 0 }, () => provider.runTurn(req));
    assert.deepEqual(seen, ["Bearer sk-fake-work"]);
    assert.equal((await call("a", "GET", `/bots/${botA}/provider-keys`)).json.choices[pid], workId);
    // Removing the key drops the choice.
    assert.equal((await call("a", "DELETE", `/api-providers/${pid}/keys/${workId}`)).status, 200);
    assert.equal((await call("a", "GET", `/bots/${botA}/provider-keys`)).json.choices[pid], undefined);
  } finally { await fake.close(); }
});

test("L82: subscriptions are never pooled: a key needs an API provider of the bot's own owner", async () => {
  // The only engines that use a subscription (claude-code:, codex:) are not "up-" providers: there is no key route for them.
  assert.equal((await call("a", "POST", "/api-providers/claude-code/keys", { name: "X", key: "sk-fake" })).status, 404);
  assert.equal((await call("a", "PUT", `/bots/${botA}/provider-keys`, { providerId: "codex", keyId: "main" })).status, 404);
});

// ── L169 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("L169: per-bot policy all / list / none and owner-blocked sites, refused before anything is sent, Chromium policy", async () => {
  let hits = 0;
  const page = await fakeServer((_req, _b, res) => { hits++; res.writeHead(200, { "content-type": "text/plain" }); res.end("hello page"); });
  try {
    const bot = bots.byId(botA)!;
    assert.equal(netRefusal(bot, "https://example.com/x"), null, "all by default");
    const put = await call("a", "PUT", `/bots/${botA}/network`, { mode: "list", hosts: "example.com\nhttps://docs.test/path, *.wiki.test" });
    assert.equal(put.status, 200, put.text);
    assert.deepEqual(put.json.policy, { mode: "list", hosts: ["example.com", "docs.test", "wiki.test"] });
    assert.equal(netRefusal(bot, "https://api.example.com/v1"), null, "subdomains covered");
    assert.match(netRefusal(bot, "https://other.test/")!, /not in the list/);
    assert.equal(netRefusal(bot, "http://127.0.0.1:7391/"), null, "the computer's own pages are not the internet");
    assert.equal((await call("b", "PUT", `/bots/${botA}/network`, { mode: "none" })).status, 404, "another account");
    const bl = await call("a", "PUT", "/network/blocked-sites", { hosts: ["docs.test"] });
    assert.deepEqual(bl.json.hosts, ["docs.test"]);
    assert.match(netRefusal(bot, "https://docs.test/a")!, /owner blocked docs.test/);
    assert.match(netRefusal(bots.byId(botA2)!, "https://www.docs.test/")!, /owner blocked/, "blocked for all the owner's bots");
    assert.equal(netRefusal(bots.byId(botB)!, "https://docs.test/"), null, "never another account's bots");
    assert.deepEqual(browserPolicy(bot), { URLBlocklist: ["*", "docs.test"], URLAllowlist: ["localhost", "127.0.0.1", "example.com", "wiki.test"] });
    let written = "";
    setBrowserPolicyWriter(async (_b, content) => { written = content; });
    assert.equal(await applyBrowserPolicy(bot, true), true);
    assert.deepEqual(JSON.parse(written).URLBlocklist, ["*", "docs.test"]);

    // A real tool call: web_fetch to a host outside the list is refused and the page is never reached.
    await call("a", "PUT", `/bots/${botA}/network`, { mode: "none" });
    const send = await call("a", "POST", `/bots/${botA}/messages`, { text: `call web_fetch {"url":"${page.url.replace("127.0.0.1", "localhost.test")}/a"}` });
    assert.ok(send.status < 300, send.text);
    const reply = await until(() => { const r = lastReply(botA); return r?.role === "assistant" && !r.streaming && /TOOL:/.test(r.text) ? r : undefined; }, "web_fetch refusal");
    assert.match(reply.text, /no internet access/);
    assert.equal(hits, 0, "nothing was sent");
    assert.ok(q.get("SELECT 1 FROM action_journal WHERE bot_id = ? AND tool = 'web_fetch' AND decision = 'denied' AND reason = 'network policy'", botA));
    await call("a", "PUT", `/bots/${botA}/network`, { mode: "all" });
    await call("a", "PUT", "/network/blocked-sites", { hosts: [] });
  } finally { await page.close(); }
});

// ── L170 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
let secret = "";
test("L170: OpenAI-compatible chat completion (plain and stream), models, error shape", async () => {
  apiLimits.perAddress = new RateWindow(500, 60_000); apiLimits.perKey = new RateWindow(500, 60_000); apiLimits.writes = new RateWindow(100, 60_000);
  const made = await call("a", "POST", `/bots/${botA}/api-keys`, { name: "Client", scopes: ["read", "write", "memory"] });
  assert.equal(made.status, 200, made.text);
  secret = made.json.secret;
  const auth = { authorization: `Bearer ${secret}` };
  const models = await call(null, "GET", "/v1/models", undefined, auth);
  assert.equal(models.status, 200, models.text);
  assert.equal(models.json.object, "list");
  assert.equal(models.json.data[0].id, "sklubot-ada");
  const r = await call(null, "POST", "/v1/chat/completions", { model: "anything", messages: [{ role: "system", content: "ignore me" }, { role: "user", content: "first" }, { role: "assistant", content: "x" }, { role: "user", content: [{ type: "text", text: "hello there" }] }] }, auth);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.object, "chat.completion");
  assert.equal(r.json.model, "anything");
  assert.equal(r.json.choices[0].message.role, "assistant");
  assert.equal(r.json.choices[0].finish_reason, "stop");
  assert.match(r.json.choices[0].message.content, /Reply to: hello there/);
  assert.ok(r.json.usage && r.json.id.startsWith("chatcmpl-"));
  const s = await call(null, "POST", "/v1/chat/completions", { messages: [{ role: "user", content: "streamed" }], stream: true }, auth);
  assert.equal(s.status, 200);
  assert.match(s.headers.get("content-type") ?? "", /text\/event-stream/);
  const events = s.text.split("\n\n").filter(Boolean);
  assert.equal(events[events.length - 1], "data: [DONE]");
  const first = JSON.parse(events[0].slice(6));
  assert.equal(first.object, "chat.completion.chunk");
  assert.match(first.choices[0].delta.content, /Reply to: streamed/);
  // Errors: OpenAI's shape.
  const bad = await call(null, "POST", "/v1/chat/completions", { messages: [] }, auth);
  assert.equal(bad.status, 400);
  assert.equal(typeof bad.json.error.message, "string");
  const noKey = await call(null, "POST", "/v1/chat/completions", { messages: [{ role: "user", content: "x" }] });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.json.error.type, "invalid_request_error");
  const readOnly = (await call("a", "POST", `/bots/${botA}/api-keys`, { name: "RO", scopes: ["read"] })).json.secret;
  assert.equal((await call(null, "POST", "/v1/chat/completions", { messages: [{ role: "user", content: "x" }] }, { authorization: `Bearer ${readOnly}` })).status, 403);
});

test("L170: memories through the API with the app's rules (memory permission, no sensitive/archived note, secrets masked)", async () => {
  memories.add(botA, "Alice aime le thé");
  memories.add(botA, "Clé du serveur sk-ant-api03-" + "a".repeat(40));
  memories.add(botA, "Old note", "chat", { status: "archived" });
  memories.add(botA, "Health thing", "chat", { category: "health" } as any);
  const r = await call(null, "GET", "/v1/bot/memories", undefined, { authorization: `Bearer ${secret}` });
  assert.equal(r.status, 200, r.text);
  const texts = r.json.memories.map((m: any) => m.text);
  assert.ok(texts.includes("Alice aime le thé"));
  assert.ok(!texts.some((t: string) => /Old note|Health thing/.test(t)));
  assert.ok(!r.text.includes("a".repeat(40)), "secret masked");
  const noMem = (await call("a", "POST", `/bots/${botA}/api-keys`, { name: "NoMem", scopes: ["read"] })).json.secret;
  assert.equal((await call(null, "GET", "/v1/bot/memories", undefined, { authorization: `Bearer ${noMem}` })).status, 403);
});

test("L170: the OpenAPI file matches the registered /v1 routes; deprecation headers", async () => {
  const doc = await call(null, "GET", "/v1/openapi.json");
  assert.equal(doc.status, 200);
  assert.equal(doc.json.openapi, "3.1.0");
  const registered = new Set((api.routes as { method: string; path: string }[]).filter((r) => r.path.startsWith("/v1/") && r.method !== "ALL" && !r.path.includes("*")).map((r) => `${r.method} ${r.path.replace(/:(\w+)/g, "{$1}")}`));
  const described = new Set(PUBLIC_ROUTES.map((r) => `${r.method} ${r.path}`));
  assert.deepEqual([...registered].filter((x) => !described.has(x)), [], "every route is described");
  assert.deepEqual([...described].filter((x) => !registered.has(x)), [], "every description is a route");
  for (const r of PUBLIC_ROUTES) assert.ok(doc.json.paths[r.path][r.method.toLowerCase()], r.path);
  const h = deprecationHeaders({ since: "2026-11-22T00:00:00Z", sunset: "2027-06-01T00:00:00Z", replacement: "/api/v1/bot/messages" });
  assert.equal(h.deprecation, `@${Date.parse("2026-11-22T00:00:00Z") / 1000}`);
  assert.equal(h.sunset, "Tue, 01 Jun 2027 00:00:00 GMT");
  assert.match(h.link, /successor-version/);
  const d = openApiDocument([{ method: "GET", path: "/v1/old", summary: "old", scopes: [], deprecated: { since: "2026-11-22", sunset: "2027-06-01" } }]);
  assert.equal((d.paths["/v1/old"].get as any).deprecated, true);
});

test("L170: outgoing webhooks: signed (Standard Webhooks), retried with backoff, logged, never twice, isolated", async () => {
  const got: { headers: http.IncomingHttpHeaders; body: string }[] = [];
  let fail = true;
  const hook = await fakeServer((req, body, res) => { got.push({ headers: req.headers, body }); res.writeHead(fail ? 500 : 204); res.end(); });
  try {
    const made = await call("a", "POST", `/bots/${botA2}/webhooks`, { url: `${hook.url}/in`, events: ["message.created", "approval.pending", "bogus"] });
    assert.equal(made.status, 200, made.text);
    assert.match(made.json.secret, /^whsec_/);
    assert.deepEqual(made.json.webhook.events, ["message.created", "approval.pending"]);
    assert.ok(!(await call("a", "GET", `/bots/${botA2}/webhooks`)).text.includes(made.json.secret), "secret shown once");
    assert.equal((await call("b", "GET", `/bots/${botA2}/webhooks`)).status, 404);
    assert.equal((await call("a", "POST", `/bots/${botA2}/webhooks`, { url: "ftp://x", events: ["message.created"] })).status, 400);

    const bot = bots.byId(botA2)!;
    const row = rows.append(bot, { kind: "message", role: "assistant", text: "Done! token sk-ant-api03-" + "b".repeat(40) });
    rows.append(bot, { kind: "message", role: "assistant", text: "streaming…", streaming: true });
    await until(() => q.get("SELECT 1 FROM webhook_deliveries"), "queued");
    assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM webhook_deliveries")!.n, 1, "only the finished reply");
    await runDueDeliveries();
    assert.equal(got.length, 1);
    const d1 = q.get<any>("SELECT * FROM webhook_deliveries")!;
    assert.equal(d1.status, "pending"); assert.equal(d1.attempts, 1); assert.equal(d1.last_status, 500);
    assert.ok(d1.next_at > Date.now() + BACKOFF_MS[0] - 2000, "backoff");
    // Due again: delivered, signature verifies.
    fail = false;
    q.run("UPDATE webhook_deliveries SET next_at = 0");
    await runDueDeliveries();
    const last = got[got.length - 1];
    const key = Buffer.from(made.json.secret.slice(6), "base64");
    const expect = createHmac("sha256", key).update(`${last.headers["webhook-id"]}.${last.headers["webhook-timestamp"]}.${last.body}`).digest("base64");
    assert.equal(last.headers["webhook-signature"], `v1,${expect}`);
    const payload = JSON.parse(last.body);
    assert.equal(payload.type, "message.created");
    assert.equal(payload.data.seq, row.seq);
    assert.ok(!last.body.includes("b".repeat(40)), "secrets masked");
    assert.equal(q.get<any>("SELECT status FROM webhook_deliveries")!.status, "done");
    // The same row emitted again is not queued twice.
    rows.append(bot, { kind: "event", event: "bot", text: "noise" });
    assert.equal(eventsOf([{ botId: botA2, generation: 0, seq: row.seq, rev: 1, createdAt: 0, body: { kind: "message", role: "assistant", text: "x" } }]).length, 1);
    const log = await call("a", "GET", `/bots/${botA2}/webhooks`);
    assert.equal(log.json.webhooks[0].deliveries[0].status, "done");
    // A delivery that keeps failing ends "failed" after the last backoff step.
    fail = true;
    assert.equal((await call("a", "POST", `/bots/${botA2}/webhooks/${made.json.webhook.id}/test`)).status, 200);
    for (let i = 0; i <= BACKOFF_MS.length; i++) { q.run("UPDATE webhook_deliveries SET next_at = 0 WHERE status = 'pending'"); await runDueDeliveries(); }
    assert.ok(q.get("SELECT 1 FROM webhook_deliveries WHERE status = 'failed' AND attempts = ?", BACKOFF_MS.length + 1));
  } finally { await hook.close(); }
});

test("L170: the headless command talks to a real server with the bot key", async () => {
  const { serve } = await import("@hono/node-server");
  const server = serve({ fetch: (req: Request) => { const u = new URL(req.url); u.pathname = u.pathname.replace(/^\/api/, ""); return api.fetch(new Request(u, req)); }, port: 0, hostname: "127.0.0.1" });
  await new Promise((r) => server.once("listening", r));
  const port = (server.address() as { port: number }).port;
  const run = (args: string[]) => promisify(execFile)(process.execPath, [path.resolve(import.meta.dirname, "../../scripts/sklubot.mjs"), ...args], { env: { ...process.env, SKLUBOT_URL: `http://127.0.0.1:${port}`, SKLUBOT_KEY: secret } });
  try {
    const ask = await run(["ask", "from the cli", "--timeout", "20"]);
    assert.match(ask.stdout, /Reply to: from the cli/);
    const who = JSON.parse((await run(["whoami"])).stdout);
    assert.equal(who.bot.name, "Ada");
    const mem = await run(["memories"]);
    assert.match(mem.stdout, /Alice aime le thé/);
    const spec = JSON.parse((await run(["openapi"])).stdout);
    assert.equal(spec.openapi, "3.1.0");
    await assert.rejects(promisify(execFile)(process.execPath, [path.resolve(import.meta.dirname, "../../scripts/sklubot.mjs"), "ask", "x"], { env: { ...process.env, SKLUBOT_URL: `http://127.0.0.1:${port}`, SKLUBOT_KEY: "" } }), (e: any) => e.code === 2);
  } finally { server.close(); }
});

// ── L181 ───────────────────────────────────────────────────────────────────────────────────────────────────────────
test("L181: rules: secret and settings files are never read; formats", () => {
  for (const p of [".env", "x/.env.local", "~/.codex/auth.json", ".claude/.credentials.json", "id_rsa", "server.pem", "openclaw-agent.sqlite", "my-token.txt"]) assert.equal(excludedWhy(p), "secret", p);
  for (const p of ["~/.codex/config.toml", "~/.hermes/config.yaml", "openclaw.json", ".claude/settings.json", ".claude/settings.local.json", ".claude.json", ".mcp.json"]) assert.equal(excludedWhy(p), "settings", p);
  assert.equal(excludedWhy("skills/x/SKILL.md"), null);
  assert.deepEqual(memoryFacts("Likes tea\n§\nLives in Lyon\n§\n"), ["Likes tea", "Lives in Lyon"]);
  assert.deepEqual(memoryFacts("# Memory\n\n- Uses Linux\n- Works at night\n"), ["Uses Linux", "Works at night"]);
  assert.equal(detectSource([".hermes/memories/MEMORY.md"]), "hermes");
  assert.equal(detectSource(["workspace/SOUL.md", "workspace/AGENTS.md"]), "openclaw");
  assert.equal(detectSource(["proj/CLAUDE.md"]), "claude-code");
  assert.equal(detectSource(["proj/AGENTS.md"]), "codex");
});

test("L181: Claude Code setup → preview (subagents as bots, skills, commands), secrets excluded, commit through the Grok commit", async () => {
  const files = [
    { path: "proj/CLAUDE.md", text: "Always answer in French. The deploy key is sk-ant-api03-" + "c".repeat(40) },
    { path: "proj/.claude/agents/reviewer.md", text: "---\nname: reviewer\ndescription: Reviews code changes\n---\nYou review diffs carefully." },
    { path: "proj/.claude/skills/release/SKILL.md", text: "---\nname: release\ndescription: When shipping a version\n---\n1. Bump\n2. Tag" },
    { path: "proj/.claude/commands/standup.md", text: "Summarise yesterday." },
    { path: "proj/.claude/settings.json", text: '{"env":{"OPENAI_API_KEY":"sk-fake"}}' },
    { path: "proj/.env", text: "ANTHROPIC_API_KEY=sk-fake" },
  ];
  const r = await call("a", "POST", "/import/local/preview", { files });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.source, "claude-code");
  assert.deepEqual(r.json.bots.map((b: any) => b.name), ["Claude Code", "reviewer"]);
  assert.match(r.json.bots[0].instructions, /Always answer in French/);
  assert.ok(!r.text.includes("c".repeat(40)), "secret masked");
  assert.ok(r.json.stripped.length >= 1);
  assert.deepEqual(r.json.bots[0].skills.map((s: any) => s.name).sort(), ["release", "standup"]);
  assert.deepEqual(r.json.excluded.filter((e: any) => e.why !== "unknown").map((e: any) => `${e.path}:${e.why}`).sort(), ["proj/.claude/settings.json:settings", "proj/.env:secret"]);
  assert.ok(!r.text.includes("sk-fake"), "excluded files are not read");
  const before = bots.list(userA).length;
  const commit = await call("a", "POST", "/import/grok/commit", { previewId: r.json.previewId, bots: [{ index: 1, include: true }] });
  assert.equal(commit.status, 200, commit.text);
  assert.equal(bots.list(userA).length, before + 1);
  const made = bots.byId(commit.json.report.bots[0].id)!;
  assert.equal(made.autonomy, "careful");
  // B cannot commit A's preview.
  const r2 = await call("a", "POST", "/import/local/preview", { files });
  assert.equal((await call("b", "POST", "/import/grok/commit", { previewId: r2.json.previewId, bots: [{ index: 0, include: true }] })).status, 400);
});

test("L181: Hermes and OpenClaw setups: identity, soul, memories, skills, Hermes cron as paused routines", async () => {
  const hermes = await call("a", "POST", "/import/local/preview", { files: [
    { path: ".hermes/SOUL.md", text: "You are calm and precise." },
    { path: ".hermes/memories/MEMORY.md", text: "Server is in Paris\n§\nBackups at 3am" },
    { path: ".hermes/memories/USER.md", text: "Name is Alice" },
    { path: ".hermes/skills/notes/obsidian/SKILL.md", text: "---\nname: obsidian\ndescription: Notes in the vault\n---\nOpen the vault." },
    { path: ".hermes/cron/jobs.json", text: JSON.stringify({ jobs: [{ name: "Morning brief", prompt: "Summarise the news", schedule: { kind: "cron", expr: "0 8 * * *", display: "0 8 * * *" } }] }) },
    { path: ".hermes/.env", text: "OPENROUTER_API_KEY=sk-fake" },
  ] });
  assert.equal(hermes.status, 200, hermes.text);
  assert.equal(hermes.json.source, "hermes");
  const hb = hermes.json.bots[0];
  assert.match(hb.personality, /calm and precise/);
  assert.deepEqual(hb.memories.map((m: any) => m.text), ["Name is Alice", "Server is in Paris", "Backups at 3am"]);
  assert.equal(hb.skills[0].name, "obsidian");
  assert.equal(hb.routines[0].cron, "0 8 * * *");
  const oc = await call("a", "POST", "/import/local/preview", { files: [
    { path: "workspace/IDENTITY.md", text: "# IDENTITY.md\n\n- **Name:** Nova\n- **Vibe:** warm" },
    { path: "workspace/SOUL.md", text: "Warm, short answers." },
    { path: "workspace/AGENTS.md", text: "Check the calendar every morning." },
    { path: "workspace/MEMORY.md", text: "- Prefers mornings\n- Has a cat" },
    { path: "workspace/memory/2026-11-01.md", text: "daily log" },
  ] });
  assert.equal(oc.status, 200, oc.text);
  assert.equal(oc.json.source, "openclaw");
  assert.equal(oc.json.bots[0].name, "Nova");
  assert.deepEqual(oc.json.bots[0].memories.map((m: any) => m.text), ["Prefers mornings", "Has a cat"]);
  assert.ok(oc.json.excluded.some((e: any) => e.why === "daily_log"));
  assert.equal((await call("a", "POST", "/import/local/preview", { files: [] })).status, 400);
});
