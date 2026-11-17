import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Accès API" (botapi.ts, botmcp.ts, docs/API-BOT.md): per-bot API keys (shown once, kept hashed, scoped, revocable,
// limited in number), the REST API under /api/v1 (Bearer key), its interplay with Pause, usage caps and hosted mode,
// approval safety (a program's words are never the owner's), and the MCP control server through the official SDK client.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-botapi-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "apiscript:api-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { SESSION_COOKIE } = await import("../src/auth.js");
const { apiLimits, MAX_KEYS_PER_BOT } = await import("../src/botapi.js");
const { RateWindow } = await import("../src/hardening.js");
const { bots, paused, rows, sha256, users } = await import("../src/store.js");
const { newTurn } = await import("../src/agent/loop.js");
const { authorize } = await import("../src/agent/authorize.js");
const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
const { StreamableHTTPClientTransport } = await import("@modelcontextprotocol/sdk/client/streamableHttp.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** Every prompt the model was given (the last user text of each turn). */
const prompts: string[] = [];
registerProvider({
  id: "apiscript", label: "Api script", models: ["api-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    prompts.push(said);
    if (/slowly/.test(said)) await new Promise((r) => setTimeout(r, 1200));
    const words = said.split("\n").filter((l) => l.trim() && !l.startsWith("[")).pop() ?? "";
    const text = `Reply to: ${words}`;
    req.onText?.(text);
    return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "api-1", usage };
  },
});

const ORIGIN = process.env.PUBLIC_URL!;
const jars: Record<string, string> = {};
async function call(who: string | null, method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", ...extra };
  if (who && jars[who]) headers.cookie = jars[who];
  const res = await api.request(url, { method, headers, body: body === undefined || method === "GET" ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && who && set.startsWith(`${SESSION_COOKIE}=`)) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json, headers: res.headers };
}
/** A call with a Bot API key (no session). */
const key = (secret: string, method: string, url: string, body?: unknown) => call(null, method, url, body, { authorization: `Bearer ${secret}` });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(fn: () => Promise<T | undefined | false> | T | undefined | false, what: string, ms = 8000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as T; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
const resetLimits = () => { apiLimits.perAddress = new RateWindow(120, 60_000); apiLimits.perKey = new RateWindow(60, 60_000); apiLimits.writes = new RateWindow(10, 60_000); };

let userA = "", userB = "";
let botA = "", botA2 = "", botB = "";
async function newKey(who: string, bot: string, scopes: string[], name = "Script") {
  const r = await call(who, "POST", `/bots/${bot}/api-keys`, { name, scopes });
  assert.equal(r.status, 200, r.text);
  return r.json as { secret: string; key: { id: string; prefix: string; scopes: string[] } };
}

test("setup: two accounts, A with two bots, B with one", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123" })).json.user.id;
  userB = (await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123" })).json.user.id;
  botA = (await call("a", "POST", "/bots", { name: "Ada" })).json.bot.id;
  botA2 = (await call("a", "POST", "/bots", { name: "Bea" })).json.bot.id;
  botB = (await call("b", "GET", "/bots")).json.bots[0].id;
  assert.ok(botA && botA2 && botB);
});

test("keys: shown once, stored as a SHA-256 with a display prefix, validated, capped per bot, audited", async () => {
  const made = await newKey("a", botA, ["read", "write", "bogus", "read"], "Mon script");
  assert.match(made.secret, /^sk_bot_[A-Za-z0-9_-]{43}$/, "sk_bot_ + 32 random bytes (base64url)");
  assert.deepEqual(made.key.scopes, ["read", "write"], "unknown scopes dropped, each once");
  assert.equal(made.key.prefix, made.secret.slice(0, 13));
  const row = q.get<{ key_hash: string; prefix: string }>("SELECT key_hash, prefix FROM bot_api_keys WHERE id = ?", made.key.id)!;
  assert.equal(row.key_hash, sha256(made.secret));
  assert.ok(!JSON.stringify(q.all("SELECT * FROM bot_api_keys")).includes(made.secret), "the key itself is stored nowhere");
  // Listed afterwards: never the key again.
  const list = await call("a", "GET", `/bots/${botA}/api-keys`);
  assert.equal(list.status, 200);
  assert.ok(!list.text.includes(made.secret));
  assert.equal(list.json.keys[0].prefix, made.key.prefix);
  assert.equal(list.json.mcpUrl, "https://bots.example.test/api/v1/mcp");
  assert.equal(list.json.max, MAX_KEYS_PER_BOT);
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE '%API key \"Mon script\" created%'", userA));
  // Validation.
  assert.equal((await call("a", "POST", `/bots/${botA}/api-keys`, { name: "", scopes: ["read"] })).status, 400);
  assert.equal((await call("a", "POST", `/bots/${botA}/api-keys`, { name: "x", scopes: ["admin", "delete"] })).status, 400, "no scope but read/write/tasks");
  assert.equal((await call("a", "POST", `/bots/${botA}/api-keys`, { name: "x".repeat(61), scopes: ["read"] })).status, 400);
  // At most N live keys; a revoked key frees its place.
  for (let i = 1; i < MAX_KEYS_PER_BOT; i++) await newKey("a", botA2, ["read"], `k${i}`);
  const tenth = await newKey("a", botA2, ["read"], "k10");
  const over = await call("a", "POST", `/bots/${botA2}/api-keys`, { name: "k11", scopes: ["read"] });
  assert.equal(over.status, 409);
  assert.equal(over.json.code, "too_many_keys");
  assert.equal((await call("a", "DELETE", `/bots/${botA2}/api-keys/${tenth.key.id}`)).status, 200);
  await newKey("a", botA2, ["read"], "k11");
  // Only the owner: another account gets 404 on A's bot (and never A's keys).
  const strange = await call("b", "GET", `/bots/${botA}/api-keys`);
  assert.equal(strange.status, 404);
  assert.ok(!strange.text.includes(made.key.prefix));
  assert.equal((await call("b", "DELETE", `/bots/${botA}/api-keys/${made.key.id}`)).status, 404);
  assert.equal((await call("b", "DELETE", `/bots/${botB}/api-keys/${made.key.id}`)).status, 404, "B cannot revoke A's key through B's own bot either");
  assert.equal(q.get<{ r: number | null }>("SELECT revoked_at AS r FROM bot_api_keys WHERE id = ?", made.key.id)!.r, null);
});

test("REST: send a message, wait for the reply, read the conversation (words only), as an outside program", async () => {
  resetLimits();
  const { secret, key: k } = await newKey("a", botA, ["read", "write"], "Zapier");
  const info = await key(secret, "GET", "/v1/bot");
  assert.equal(info.status, 200);
  assert.equal(info.json.bot.id, botA);
  assert.deepEqual(info.json.key.scopes, ["read", "write"]);
  assert.equal(info.headers.get("cache-control"), "no-store");
  const sent = await key(secret, "POST", "/v1/bot/messages", { text: "Bonjour, résume ta journée" });
  assert.equal(sent.status, 202, sent.text);
  assert.equal(sent.json.status, "queued");
  const waited = await key(secret, "GET", `/v1/bot/messages/${sent.json.seq}/wait?timeout=10`);
  assert.equal(waited.status, 200);
  assert.equal(waited.json.status, "done");
  assert.equal(waited.json.reply, "Reply to: Bonjour, résume ta journée");
  // The model was told plainly that a program, not the owner, wrote this.
  assert.ok(prompts.some((p) => p.includes('Message sent through the Bot API by the program "Zapier"') && p.includes("not your owner typing")));
  // In the owner's chat: the message carries origin "api" (never the owner's own words).
  const row = rows.get(botA, bots.byId(botA)!.generation, sent.json.seq)!;
  assert.deepEqual(row.body.kind === "message" && row.body.origin, { kind: "api", id: k.id, name: "Zapier" });
  // Reading: messages and replies only, oldest first, with a cursor.
  const read = await key(secret, "GET", "/v1/bot/messages?after=0");
  assert.equal(read.status, 200);
  assert.ok(read.json.messages.some((m: any) => m.from === "api" && m.name === "Zapier" && m.text === "Bonjour, résume ta journée"));
  assert.ok(read.json.messages.some((m: any) => m.from === "bot" && m.text.startsWith("Reply to:")));
  assert.ok(read.json.messages.every((m: any) => ["seq", "thread", "role", "from", "name", "text", "at"].every((f) => f in m) && Object.keys(m).length === 7));
  const next = await key(secret, "GET", `/v1/bot/messages?after=${read.json.next}`);
  assert.deepEqual(next.json.messages, []);
  // The key's last use is noted.
  assert.ok(q.get<{ t: number | null }>("SELECT last_used_at AS t FROM bot_api_keys WHERE id = ?", k.id)!.t);
});

test("REST: long-polling waits while the bot works, and answers at once when it is done or times out", async () => {
  resetLimits();
  const { secret } = await newKey("a", botA, ["read", "write"], "Lent");
  const sent = await key(secret, "POST", "/v1/bot/messages", { text: "answer slowly please" });
  const quick = await key(secret, "GET", `/v1/bot/messages/${sent.json.seq}/wait?timeout=0`);
  assert.equal(quick.json.status, "working");
  const t0 = Date.now();
  const waited = await key(secret, "GET", `/v1/bot/messages/${sent.json.seq}/wait?timeout=10`);
  assert.equal(waited.json.status, "done");
  assert.ok(Date.now() - t0 >= 300, "it waited for the reply");
  assert.equal((await key(secret, "GET", "/v1/bot/messages/999999/wait")).status, 404);
  // The bot waits for its owner's approval: nobody outside can answer it, the wait says so at once.
  paused.set(botA, { approvalId: "apr_x" });
  const asks = await key(secret, "GET", `/v1/bot/messages/${sent.json.seq}/wait?timeout=10`);
  assert.equal(asks.json.status, "needs_approval");
  paused.clear(botA);
});

test("scopes: each route needs its permission; no key reaches approvals, settings or anything outside /v1", async () => {
  resetLimits();
  const ro = await newKey("a", botA, ["read"], "Lecture");
  const r1 = await key(ro.secret, "POST", "/v1/bot/messages", { text: "hi" });
  assert.equal(r1.status, 403);
  assert.equal(r1.json.code, "scope");
  assert.equal((await key(ro.secret, "POST", "/v1/bot/tasks", { objective: "x" })).json.code, "scope");
  assert.equal((await key(ro.secret, "GET", "/v1/bot/messages")).status, 200);
  const wo = await newKey("a", botA, ["write"], "Ecriture");
  assert.equal((await key(wo.secret, "GET", "/v1/bot/messages")).json.code, "scope");
  assert.equal((await key(wo.secret, "GET", "/v1/bot/messages/1/wait")).json.code, "scope");
  // A key is not a session: every route of the app answers 401 to it (approvals, settings, vault, bots, keys…).
  const all = await newKey("a", botA, ["read", "write", "tasks"], "Tout");
  for (const [m, u] of [["GET", "/bots"], ["POST", "/approvals/apr_x"], ["PATCH", `/bots/${botA}`], ["DELETE", `/bots/${botA}`], ["GET", "/vault"], ["GET", "/connectors"], ["GET", `/bots/${botA}/api-keys`], ["POST", `/bots/${botA}/api-keys`], ["GET", `/bots/${botA2}/rows`], ["POST", `/bots/${botA}/pause`]] as const)
    assert.equal((await key(all.secret, m, u, {})).status, 401, `${m} ${u}`);
  // Wrong, malformed or missing keys.
  assert.equal((await key("sk_bot_nope", "GET", "/v1/bot")).status, 401);
  assert.equal((await key(all.secret + "x", "GET", "/v1/bot")).status, 401);
  const none = await call(null, "GET", "/v1/bot");
  assert.equal(none.status, 401);
  assert.match(none.headers.get("www-authenticate") ?? "", /Bearer/);
  // A session cookie is not a key either.
  assert.equal((await call("a", "GET", "/v1/bot")).status, 401);
});

test("revoke: a revoked key stops at once; a bot's keys go with the bot", async () => {
  resetLimits();
  const k = await newKey("a", botA, ["read"], "Bientôt révoquée");
  assert.equal((await key(k.secret, "GET", "/v1/bot")).status, 200);
  const after = await call("a", "DELETE", `/bots/${botA}/api-keys/${k.key.id}`);
  assert.equal(after.status, 200);
  assert.ok(after.json.keys.find((x: any) => x.id === k.key.id).revokedAt, "kept in the list, marked revoked");
  assert.equal((await key(k.secret, "GET", "/v1/bot")).status, 401);
  assert.equal((await call("a", "DELETE", `/bots/${botA}/api-keys/${k.key.id}`)).status, 404, "already revoked");
  assert.ok(q.get("SELECT 1 FROM audit WHERE user_id = ? AND text LIKE '%API key \"Bientôt révoquée\" revoked%'", userA));
  const temp = (await call("a", "POST", "/bots", { name: "Temp" })).json.bot.id;
  const tk = await newKey("a", temp, ["read"], "Temp");
  assert.equal((await call("a", "DELETE", `/bots/${temp}`)).status, 200);
  assert.equal((await key(tk.secret, "GET", "/v1/bot")).status, 401);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_api_keys WHERE bot_id = ?", temp)!.n, 0);
});

test("rate limits: per key for messages (10/min), per key overall, per address; with Retry-After", async () => {
  resetLimits();
  const botC = (await call("a", "POST", "/bots", { name: "Cara" })).json.bot.id;
  const { secret } = await newKey("a", botC, ["read", "write"], "Rafale");
  for (let i = 0; i < 10; i++) assert.equal((await key(secret, "POST", "/v1/bot/messages", { text: `m${i}` })).status, 202);
  const over = await key(secret, "POST", "/v1/bot/messages", { text: "one too many" });
  assert.equal(over.status, 429);
  assert.equal(over.json.code, "rate_limited");
  assert.equal(over.headers.get("retry-after"), "60");
  assert.equal((await key(secret, "GET", "/v1/bot")).status, 200, "reading still works");
  apiLimits.perKey = new RateWindow(3, 60_000);
  for (let i = 0; i < 3; i++) assert.equal((await key(secret, "GET", "/v1/bot")).status, 200);
  assert.equal((await key(secret, "GET", "/v1/bot")).status, 429);
  apiLimits.perAddress = new RateWindow(2, 60_000);
  await call(null, "GET", "/v1/bot", undefined, { authorization: "Bearer sk_bot_guess1" });
  await call(null, "GET", "/v1/bot", undefined, { authorization: "Bearer sk_bot_guess2" });
  assert.equal((await call(null, "GET", "/v1/bot", undefined, { authorization: "Bearer sk_bot_guess3" })).status, 429, "guessing keys is slowed down");
  resetLimits();
  // Body limits and validation.
  assert.equal((await key(secret, "POST", "/v1/bot/messages", { text: "x".repeat(20_001) })).status, 413);
  assert.equal((await key(secret, "POST", "/v1/bot/messages", "{not json")).status, 400);
  assert.equal((await key(secret, "POST", "/v1/bot/messages", { text: "  " })).status, 400);
  assert.equal((await key(secret, "POST", "/v1/bot/messages", { text: "hi", thread: 999999 })).status, 400);
});

test("Pause, usage caps and hosted mode: refused up front with a code, nothing queued", async () => {
  resetLimits();
  const { secret } = await newKey("a", botA, ["read", "write", "tasks"], "Gardes");
  const count = () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id = ? AND kind = 'message'", botA)!.n;
  // Pause.
  assert.equal((await call("a", "POST", `/bots/${botA}/pause`)).status, 200);
  const before = count();
  const p = await key(secret, "POST", "/v1/bot/messages", { text: "hello?" });
  assert.equal(p.status, 409);
  assert.equal(p.json.code, "paused");
  assert.equal((await key(secret, "POST", "/v1/bot/tasks", { objective: "x" })).json.code, "paused");
  assert.equal((await key(secret, "GET", "/v1/bot")).json.bot.paused, true);
  assert.equal(count(), before, "nothing written");
  assert.equal((await call("a", "POST", `/bots/${botA}/resume`)).status, 200);
  // A usage cap that stops unattended work: API work is unattended, so it is refused (the owner's own messages still run).
  q.run("INSERT INTO usage_caps (user_id, bot_id, period, unit, limit_value, mode, updated_at) VALUES (?, '', 'day', 'usd', 0, 'unattended', ?)", userA, Date.now());
  const c = await key(secret, "POST", "/v1/bot/messages", { text: "capped?" });
  assert.equal(c.status, 429);
  assert.equal(c.json.code, "usage_cap");
  assert.ok(c.json.resetAt > Date.now());
  assert.equal((await call("a", "POST", `/bots/${botA}/messages`, { text: "the owner still talks" })).status, 200);
  q.run("DELETE FROM usage_caps WHERE user_id = ?", userA);
  // Hosted mode: a suspended account (B, not the operator) is read-only through the API too.
  const bk = await newKey("b", botB, ["read", "write"], "B script");
  process.env.HOSTED_MODE = "1";
  try {
    const { subscriptions } = await import("../src/hosted.js");
    subscriptions.ensure(userB);
    q.run("UPDATE subscriptions SET status = 'suspended' WHERE user_id = ?", userB);
    const s = await key(bk.secret, "POST", "/v1/bot/messages", { text: "hi" });
    assert.equal(s.status, 403);
    assert.equal(s.json.code, "suspended");
    assert.equal((await key(bk.secret, "GET", "/v1/bot")).status, 200, "reading stays possible");
  } finally {
    delete process.env.HOSTED_MODE;
    q.run("UPDATE subscriptions SET status = 'active' WHERE user_id = ?", userB);
  }
});

test("tasks: a goal set by a program is the program's (origin api, careful), readable by its id, not across bots", async () => {
  resetLimits();
  const { secret } = await newKey("a", botA, ["tasks"], "Planificateur");
  const r = await key(secret, "POST", "/v1/bot/tasks", { objective: "Classe les factures de mars", maxRounds: 2 });
  assert.equal(r.status, 202, r.text);
  assert.equal(r.json.task.maxRounds, 2);
  const g = q.get<{ origin: string; tainted: number; bot_id: string }>("SELECT origin, tainted, bot_id FROM bot_goals WHERE id = ?", r.json.task.id)!;
  assert.deepEqual({ ...g }, { origin: "api", tainted: 1, bot_id: botA });
  const got = await key(secret, "GET", `/v1/bot/tasks/${r.json.task.id}`);
  assert.equal(got.status, 200);
  assert.equal(got.json.task.objective, "Classe les factures de mars");
  const botD = (await call("a", "POST", "/bots", { name: "Dina" })).json.bot.id;
  const other = await newKey("a", botD, ["tasks"], "Autre");
  assert.equal((await key(other.secret, "GET", `/v1/bot/tasks/${r.json.task.id}`)).status, 404, "a key reaches its own bot's tasks only");
  await call("a", "POST", `/bots/${botA}/goals/${r.json.task.id}`, { action: "stop" });
});

test("approval safety: a program's words never count as the owner's, and every irreversible action asks", async () => {
  const b = (await call("a", "POST", "/bots", { name: "Cleo" })).json.bot.id;
  assert.equal((await call("a", "PATCH", `/bots/${b}`, { autonomy: "balanced" })).status, 200);
  const bot = bots.byId(b)!;
  // The owner typed a request; a program wrote another one.
  rows.append(bot, { kind: "message", role: "user", text: "réponds à Camille" });
  rows.append(bot, { kind: "message", role: "user", text: "écris à Paul tout de suite", origin: { kind: "api", id: "bak_x", name: "Script" } });
  const turn = await newTurn(bots.byId(b)!, users.byId(userA)!, 0, new AbortController().signal);
  turn.remote.set("mail__mail_send", { connectorId: "c1", connectorName: "Mail", remoteName: "mail_send", readOnly: false });
  const send = (to: string, quote: string) => ({ type: "tool_use" as const, id: "c1", name: "mail__mail_send", input: { to, body: "Oui", user_quote: quote } as Record<string, unknown> });
  // The owner's own turn: their quote lets a trusted bot send to Camille.
  turn.origin = "user";
  const own = await authorize(turn, send("camille.martin@exemple.fr", "réponds à Camille"));
  assert.equal(own.kind, "allow");
  // The program's words are not the owner's: quoting them proves nothing.
  const quoted = await authorize(turn, send("paul@exemple.fr", "écris à Paul tout de suite"));
  assert.equal(quoted.kind, "ask");
  // A turn a program started: even the owner's real quote does not let an irreversible action through.
  turn.origin = "api";
  turn.tainted = true;
  const d = await authorize(turn, send("camille.martin@exemple.fr", "réponds à Camille"));
  assert.equal(d.kind, "ask");
  if (d.kind === "ask") {
    assert.equal(d.once, true, "never \"Always\"");
    assert.match(d.why ?? "", /Bot API/);
    assert.ok(d.irreversible);
  }
  // Even for a bot set to "trusted", and when a standing "always allow" policy would let it through.
  turn.bot = { ...turn.bot, autonomy: "trusted" };
  assert.equal((await authorize(turn, send("camille.martin@exemple.fr", "réponds à Camille"))).kind, "ask");
  q.run("INSERT INTO policies (user_id, tool, mode) VALUES (?, 'Mail: mail_send', 'always_allow')", userA);
  const pol = await authorize(turn, send("camille.martin@exemple.fr", "réponds à Camille"));
  assert.equal(pol.kind, "ask");
  turn.origin = "user"; turn.tainted = false;
  assert.equal((await authorize(turn, send("camille.martin@exemple.fr", "")) ).kind, "allow", "the owner's policy still works for the owner's own work");
  q.run("DELETE FROM policies WHERE user_id = ? AND tool = 'Mail: mail_send'", userA);
  // Something that can be undone is judged as usual (no extra card): a read-only tool.
  turn.origin = "api";
  turn.remote.set("mail__mail_search", { connectorId: "c1", connectorName: "Mail", remoteName: "mail_search", readOnly: true });
  assert.notEqual((await authorize(turn, { type: "tool_use", id: "c2", name: "mail__mail_search", input: { q: "x" } })).kind, "block");
});

test("MCP: exactly five tools (fewer for a narrower key), called through the official SDK client", async () => {
  resetLimits();
  const connect = async (secret: string) => {
    const client = new Client({ name: "test", version: "1.0.0" });
    const transport = new StreamableHTTPClientTransport(new URL("https://bots.example.test/v1/mcp"), {
      requestInit: { headers: { authorization: `Bearer ${secret}` } },
      fetch: (url, init) => api.request(new URL(String(url)).pathname, init as RequestInit),
    });
    await client.connect(transport);
    return client;
  };
  const botM = (await call("a", "POST", "/bots", { name: "Mia" })).json.bot.id;
  const full = await newKey("a", botM, ["read", "write", "tasks"], "Claude Code");
  const client = await connect(full.secret);
  const names = (await client.listTools()).tools.map((t) => t.name);
  assert.deepEqual(names, ["list_bots", "send_message", "wait_reply", "read_messages", "create_task"]);
  const listed = await client.callTool({ name: "list_bots", arguments: {} });
  const bots0 = JSON.parse((listed.content as any)[0].text).bots;
  assert.deepEqual(bots0.map((b: any) => b.id), [botM], "only the key's own bot");
  const sent = await client.callTool({ name: "send_message", arguments: { text: "Salut depuis MCP" } });
  assert.ok(!sent.isError, JSON.stringify(sent));
  const seq = JSON.parse((sent.content as any)[0].text).seq;
  const reply = await client.callTool({ name: "wait_reply", arguments: { seq, timeout_seconds: 10 } });
  const r = JSON.parse((reply.content as any)[0].text);
  assert.equal(r.status, "done");
  assert.equal(r.reply, "Reply to: Salut depuis MCP");
  const read = await client.callTool({ name: "read_messages", arguments: { after: seq - 1 } });
  assert.ok(JSON.parse((read.content as any)[0].text).messages.some((m: any) => m.text === "Salut depuis MCP"));
  const other = await client.callTool({ name: "send_message", arguments: { text: "x", bot_id: botA2 } });
  assert.equal(other.isError, true, "another bot is out of reach");
  const unknown = await client.callTool({ name: "delete_bot", arguments: {} });
  assert.equal(unknown.isError, true);
  await client.close();
  // A read-only key: the tools it may use, and a refusal for the rest.
  const ro = await newKey("a", botM, ["read"], "Lecteur MCP");
  const roClient = await connect(ro.secret);
  assert.deepEqual((await roClient.listTools()).tools.map((t) => t.name), ["list_bots", "wait_reply", "read_messages"]);
  const refused = await roClient.callTool({ name: "send_message", arguments: { text: "x" } });
  assert.equal(refused.isError, true);
  assert.match((refused.content as any)[0].text, /write/);
  await roClient.close();
  // No key, a wrong key, a revoked key: no connection at all.
  await assert.rejects(connect("sk_bot_wrong"));
  await call("a", "DELETE", `/bots/${botM}/api-keys/${full.key.id}`);
  await assert.rejects(connect(full.secret));
  assert.equal((await key(ro.secret, "GET", "/v1/mcp")).status, 405);
});

test("isolation: a key reaches only its own bot of its own account", async () => {
  resetLimits();
  const kb = await newKey("b", botB, ["read", "write", "tasks"], "B");
  const info = await key(kb.secret, "GET", "/v1/bot");
  assert.equal(info.json.bot.id, botB);
  const read = await key(kb.secret, "GET", "/v1/bot/messages?after=0&limit=200");
  assert.ok(!read.text.includes("Bonjour") && !read.text.includes("Alice") && !read.text.includes("Ada"));
  // Thread ids and seqs are the key's own bot's: a seq of A's conversation names nothing of A's.
  const aSeq = q.get<{ seq: number }>("SELECT MAX(seq) AS seq FROM rows WHERE bot_id = ?", botA)!.seq;
  const w = await key(kb.secret, "GET", `/v1/bot/messages/${aSeq}/wait?timeout=0`);
  assert.ok([404, 200].includes(w.status));
  assert.ok(!w.text.includes("Bonjour") && !w.text.includes("Ada"));
  const aGoal = q.get<{ id: string }>("SELECT id FROM bot_goals WHERE bot_id = ? LIMIT 1", botA)!.id;
  assert.equal((await key(kb.secret, "GET", `/v1/bot/tasks/${aGoal}`)).status, 404);
  // A's bots never got B's messages.
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id IN (?, ?) AND body LIKE '%\"name\":\"B\"%'", botA, botA2)!.n, 0);
});
