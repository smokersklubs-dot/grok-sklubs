import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// SK-P0-03: isolation between accounts, route by route. Account A (the server's owner) owns everything below; B is a
// stranger; V is a viewer of A's workspace, to which A shared ONE bot (bot1), not the other (bot2).
// Every route of the Hono apps (api.routes and site.routes) is discovered at run time: a route added later is tested
// too, and one with a parameter this file does not know fails the suite until it is added to `resolve` below.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-iso-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "isoscript:iso-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { seal, SESSION_COOKIE } = await import("../src/auth.js");
const { workspaceOf } = await import("../src/computer.js");
const { emit } = await import("../src/bus.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "isoscript", label: "Iso", models: ["iso-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ALPHASECRET reply");
    return { content: [{ type: "text", text: "ALPHASECRET reply" }], stopReason: "end", model: "iso-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const ORIGIN = process.env.PUBLIC_URL!;
const MARK = /alphasecret/i;
type Who = "a" | "b" | "v";
const jars: Record<Who, string> = { a: "", b: "", v: "" };
async function call(app: typeof api | typeof site, who: Who | null, method: string, url: string, body?: unknown, signal?: AbortSignal) {
  const headers: Record<string, string> = { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test" };
  if (who) headers.cookie = jars[who];
  const res = await app.request(url, { method, headers, body: body === undefined || method === "GET" || method === "HEAD" ? undefined : JSON.stringify(body), signal });
  const set = res.headers.get("set-cookie");
  // Only the session cookie is kept (a sign-in with Google, for one, sets a cookie of its own).
  if (set && who && set.startsWith(`${SESSION_COOKIE}=`)) jars[who] = set.split(";")[0];
  const text = method === "HEAD" ? "" : await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, text, json };
}
const A = (m: string, u: string, b?: unknown) => call(api, "a", m, u, b);

// ── A's resources ────────────────────────────────────────────────────────────────────────────────────────────────
const ids: Record<string, string> = {};
let userA = "", userB = "", userV = "";
const t = Date.now();

test("setup: A owns one of everything, V is a viewer of A's workspace with bot1 shared, B is a stranger", async () => {
  userA = (await call(api, "a", "POST", "/auth/signup", { email: "alice.alphasecret@example.com", name: "Alice ALPHASECRET", password: "password123" })).json.user.id;
  userB = (await call(api, "b", "POST", "/auth/signup", { email: "bob@example.com", name: "Bob", password: "password123" })).json.user.id;
  userV = (await call(api, "v", "POST", "/auth/signup", { email: "vera@example.com", name: "Vera", password: "password123" })).json.user.id;
  ids.bot1 = (await A("POST", "/bots", { name: "ALPHASECRET One" })).json.bot.id;
  ids.bot2 = (await A("POST", "/bots", { name: "ALPHASECRET Two" })).json.bot.id;
  ids.room = (await A("POST", "/rooms", { name: "ALPHASECRET Room", members: [ids.bot1, ids.bot2] })).json?.bot?.id ?? "";
  if (!ids.room) { ids.room = "a_room"; q.run("INSERT INTO bots (id, user_id, kind, name, shape, color, members, created_at, updated_at) VALUES (?, ?, 'room', 'ALPHASECRET Room', 'pebble', 'indigo', ?, ?, ?)", ids.room, userA, JSON.stringify([ids.bot1, ids.bot2]), t, t); }
  // A chat with real rows on both bots (a message and the model's reply).
  for (const b of [ids.bot1, ids.bot2]) {
    await A("POST", `/bots/${b}/messages`, { text: "ALPHASECRET hello" });
    for (let i = 0; i < 400 && !(await A("GET", `/bots/${b}/rows`)).json.rows.some((r: any) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming); i++) await new Promise((r) => setTimeout(r, 25));
  }
  // A library file on each bot.
  for (const b of [ids.bot1, ids.bot2]) { const ws = workspaceOf(b); mkdirSync(ws, { recursive: true }); writeFileSync(path.join(ws, "ALPHA.txt"), "ALPHASECRET file"); }
  const ins = (sql: string, ...p: (string | number | null)[]) => q.run(sql, ...p);
  for (const b of ["bot1", "bot2"]) {
    const bot = ids[b];
    ins("INSERT INTO memories (id, bot_id, text, created_at) VALUES (?, ?, 'ALPHASECRET memory', ?)", ids[`mem_${b}`] = `a_mem_${b}`, bot, t);
    ins("INSERT INTO skills (id, bot_id, name, body, created_at, updated_at) VALUES (?, ?, 'alphasecret-skill', 'ALPHASECRET body', ?, ?)", ids[`skill_${b}`] = `a_skill_${b}`, bot, t, t);
    ins("INSERT INTO tasks (id, bot_id, title, created_at, updated_at) VALUES (?, ?, 'ALPHASECRET task', ?, ?)", `a_task_${b}`, bot, t, t);
    ins("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES (?, ?, 'ALPHASECRET routine', 'ALPHASECRET prompt', 'webhook', ?, ?)", ids[`routine_${b}`] = `a_routine_${b}`, bot, `hooktoken_${b}`, t);
    ins("INSERT INTO routine_runs (id, routine_id, at, note) VALUES (?, ?, ?, 'ALPHASECRET run')", `a_run_${b}`, `a_routine_${b}`, t);
    ins("INSERT INTO approvals (id, bot_id, user_id, seq, generation, tool, created_at) VALUES (?, ?, ?, 1, 1, 'send_email', ?)", ids[`approval_${b}`] = `a_appr_${b}`, bot, userA, t);
    ins("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, created_at, updated_at) VALUES (?, ?, ?, 1, 'ALPHASECRET goal', 'active', 5, ?, ?)", ids[`goal_${b}`] = `a_goal_${b}`, bot, userA, t, t);
    ins("INSERT INTO bot_jobs (id, bot_id, user_id, command, started_at) VALUES (?, ?, ?, 'echo ALPHASECRET', ?)", ids[`job_${b}`] = `a_job_${b}`, bot, userA, t);
    ins("INSERT INTO pages (token, bot_id, user_id, title, path, created_at) VALUES (?, ?, ?, 'ALPHASECRET page', 'ALPHA.txt', ?)", ids[`page_${b}`] = `a_page_${b}`, bot, userA, t);
    ins("INSERT INTO public_links (id, user_id, bot_id, path, mime, size, token_hash, expires_at, created_at) VALUES (?, ?, ?, 'ALPHA.txt', 'text/plain', 16, ?, ?, ?)", ids[`link_${b}`] = `a_link_${b}`, userA, bot, `hash_${b}`, t + 3_600_000, t);
    ins("INSERT INTO executions (id, bot_id, user_id, tool, label, action_hash, status, started_at) VALUES (?, ?, ?, 'send_email', 'ALPHASECRET action', 'h', 'uncertain', ?)", ids[`exec_${b}`] = `a_exec_${b}`, bot, userA, t);
    ins("INSERT INTO spend_checkpoints (id, worker_id, card_bot_id, scope_key, generation, spent_usd, threshold_usd, created_at) VALUES (?, ?, ?, 'chat:0', 1, 6, 5, ?)", ids[`spend_${b}`] = `a_spend_${b}`, bot, bot, t);
    ins("INSERT INTO bg_tasks (id, bot_id, title, goal, generation, created_at, updated_at) VALUES (?, ?, 'ALPHASECRET bg', 'ALPHASECRET', 1, ?, ?)", ids[`bg_${b}`] = `a_bg_${b}`, bot, t, t);
    ins("INSERT INTO nudges (id, bot_id, matter, title, body, created_at, updated_at) VALUES (?, ?, 'm', 'ALPHASECRET nudge', 'ALPHASECRET', ?, ?)", ids[`nudge_${b}`] = `a_nudge_${b}`, bot, t, t);
    ins("INSERT INTO inbound_mail (id, bot_id, from_addr, to_addr, subject, text, status, received_at) VALUES (?, ?, 'x@example.com', 'y@example.com', 'ALPHASECRET mail', 'ALPHASECRET', 'held', ?)", ids[`mail_${b}`] = `a_mail_${b}`, bot, t);
    ins("INSERT INTO local_tool_servers (id, user_id, bot_id, name, command, created_at) VALUES (?, ?, ?, 'alphasecret-tool', 'true', ?)", ids[`ltool_${b}`] = `a_ltool_${b}`, userA, bot, t);
  }
  q.run("UPDATE pages SET visibility = 'private' WHERE token = ?", ids.page_bot2);
  ins("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('a_vault', ?, 'ALPHASECRET vault', 'alice', ?, ?)", userA, seal("ALPHASECRET password"), t);
  ins("INSERT INTO connectors (id, user_id, name, url, token_enc, created_at) VALUES ('a_conn', ?, 'ALPHASECRET connector', 'https://mcp.example.com', ?, ?)", userA, seal("ALPHASECRET token"), t);
  ins("INSERT INTO bot_sections (id, user_id, name, created_at) VALUES ('a_section', ?, 'ALPHASECRET section', ?)", userA, t);
  ins("INSERT INTO rules (id, user_id, text, created_at) VALUES ('a_rule', ?, 'ALPHASECRET rule', ?)", userA, t);
  ins("INSERT INTO rule_changes (id, user_id, action, rule_id, text, created_at) VALUES ('a_rulechange', ?, 'add', 'a_rule', 'ALPHASECRET rule', ?)", userA, t);
  ins("INSERT INTO relay_devices (id, user_id, name, token_hash, rotated_at, created_at) VALUES ('a_relay', ?, 'ALPHASECRET laptop', 'h', ?, ?)", userA, t, t);
  ins("INSERT INTO push_subscriptions (id, user_id, endpoint, p256dh, auth_enc, label, created_at) VALUES ('a_push', ?, 'https://push.example.com/alpha', 'k', 'a', 'ALPHASECRET phone', ?)", userA, t);
  ins("INSERT INTO native_clients (user_id, vendor, client_id, updated_at) VALUES (?, 'google', 'alphasecret-client', ?)", userA, t);
  ins("INSERT INTO native_accounts (id, user_id, app, label, created_at) VALUES ('a_native', ?, 'gmail', 'ALPHASECRET gmail', ?)", userA, t);
  ins("INSERT INTO api_connectors (id, user_id, name, base_url, host, secret, created_at) VALUES ('a_apiconn', ?, 'ALPHASECRET api', 'https://api.example.com', 'api.example.com', 'a_vault', ?)", userA, t);
  ins("INSERT INTO user_providers (id, user_id, name, base_url, key_enc, created_at, updated_at) VALUES ('up-alpha', ?, 'ALPHASECRET provider', 'https://llm.example.com', ?, ?, ?)", userA, seal("ALPHASECRET key"), t, t);
  ins("INSERT INTO shared_computers (id, user_id, name, created_at) VALUES ('a_shared', ?, 'ALPHASECRET shared', ?)", userA, t);
  ins("INSERT INTO policies (user_id, tool, mode) VALUES (?, 'web_fetch', 'ask')", userA);
  // The workspace: V is a viewer, bot1 is shared with everyone of it, bot2 is not shared.
  ids.ws = (await A("POST", "/workspaces", { name: "ALPHASECRET Studio" })).json.workspace.id;
  const inv = (await A("POST", `/workspaces/${ids.ws}/invites`, { email: "vera@example.com", role: "viewer" })).json.invite;
  assert.equal((await call(api, "v", "POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") })).status, 200);
  ids.invite = (await A("POST", `/workspaces/${ids.ws}/invites`, { email: "later@example.com", role: "member" })).json.invite.id;
  assert.equal((await A("PUT", `/bots/${ids.bot1}/share`, { workspaceId: ids.ws, access: "all" })).status, 200);
  ins("INSERT INTO workspace_resources (workspace_id, kind, resource_id, shared_by, created_at) VALUES (?, 'connector', 'a_conn', ?, ?)", ids.ws, userA, t);
  assert.equal((await call(api, "v", "GET", "/bots")).json.bots.some((b: any) => b.id === ids.bot1), true, "V sees the shared bot");
});

/** A's value for a route parameter, from the static segment before it. Unknown → the suite fails (add it here). */
function resolve(routePath: string, param: string, bot: "bot1" | "bot2"): string | undefined {
  const segs = routePath.split("/");
  const i = segs.indexOf(`:${param}`);
  const prev = segs[i - 1] ?? "";
  const prev2 = segs[i - 2] ?? "";
  const b = bot;
  const table: Record<string, string> = {
    "bots:id": ids[b], "rows:seq": "1", "cards:seq": "1", "goals:goalId": ids[`goal_${b}`], "jobs:jobId": ids[`job_${b}`],
    "takeover:takeoverId": "tk_alpha", "approvals:approvalId": ids[`approval_${b}`], "skills:id": ids[`skill_${b}`],
    "memories:id": ids[`mem_${b}`], "routines:id": ids[`routine_${b}`], "calls:callId": "call_alpha", "history:generation": "1",
    "pages:token": ids[`page_${b}`], "shots:name": "shot-1.png", "shared:sid": "a_shared", "vault:id": "a_vault",
    "reach:channel": "telegram", "public-links:id": ids[`link_${b}`], "local-tools:id": ids[`ltool_${b}`],
    "connectors:id": "a_conn", "clients:vendor": "google", "accounts:id": "a_native", "policies:tool": "web_fetch",
    "rooms:id": ids.room, "model-prices:model": "alpha-model", "rules:id": "a_rule", "changes:id": "a_rulechange",
    "spend:id": ids[`spend_${b}`], "api-connectors:id": "a_apiconn", "executions:id": ids[`exec_${b}`],
    "bgtasks:taskId": ids[`bg_${b}`], "nudges:nudgeId": ids[`nudge_${b}`], "workspaces:wid": ids.ws, "members:uid": userA,
    "invites:iid": ids.invite, "resources:kind": "connector", "mail:mailId": ids[`mail_${b}`], "api-providers:id": "up-alpha",
    "sections:id": "a_section", "invites:token": "not-a-real-invite", "hooks:token": "hooktoken_" + b, "native:vendor": "google",
    "mcp:botId": ids[b], "egress:botId": ids[b], "l:token": "not-a-real-link", "p:token": ids[`page_${b}`],
  };
  if (param === "action" && prev2 === "reach") return "login";
  if (param === "rid" && prev2 === "resources") return "a_conn";
  if (prev === "devices" && param === "id") return prev2 === "relay" ? "a_relay" : prev2 === "push" ? "a_push" : undefined;
  if (prev === "credentials" || (prev2 === "credentials" && param === "kind")) return param === "kind" ? "connector" : "a_conn";
  if (param === "id" && prev === ":kind") return "a_conn";
  return table[`${prev}:${param}`];
}
function fill(routePath: string, bot: "bot1" | "bot2"): string {
  let out = routePath.replace(/\/\*$/, "/anything");
  for (const m of routePath.matchAll(/:([A-Za-z]+)/g)) {
    const v = resolve(routePath, m[1], bot);
    if (v === undefined) throw new Error(`isolation.test.ts does not know the parameter :${m[1]} of ${routePath} — add A's value for it to resolve()`);
    out = out.replace(`:${m[1]}`, encodeURIComponent(v));
  }
  // Query parameters some routes read (?bot=, ?path=, ?q=…), always pointing at A's things.
  return `${out}${out.includes("?") ? "&" : "?"}bot=${ids[bot]}&path=ALPHA.txt&q=ALPHASECRET&thread=0`;
}

/**
 * Routes that answer without a session on purpose: their own credential is in the URL (a hook token, a page or link
 * token, an invitation) or they say nothing about anyone. They are still called below: with A's tokens unknown to B
 * (not-a-real-…) they must say nothing; with A's real hook token they do what a hook does (that token IS the secret).
 */
const PUBLIC = new Set(["POST /hooks/:token", "GET /invites/:token", "GET /native/:vendor/callback", "GET /p/:token", "GET /l/:token", "HEAD /l/:token"]);
/** The bots' own channel (engine token or socket): never a browser session. Refused without that token. */
const BOT_CHANNEL = new Set(["POST /mcp/:botId", "GET /mcp/:botId", "DELETE /mcp/:botId", "ALL /egress/:botId/*"]);
/**
 * Answers that are not 403/404 but say nothing about A: the same answer for an id that does not exist, checked before
 * any lookup, or scoped to the caller. Each with why; the body must match, and A's thing must still be there (last test).
 */
const NOT_REVEALING: Record<string, { status: number; body?: RegExp; why: string }> = {
  "GET /relay/devices/:id/last": { status: 204, why: "no picture: the same for a device that is not the caller's (listDevices(user) first)" },
  "POST /relay/devices/:id/stop": { status: 409, body: /not connected/, why: "stopSession(user, id) only finds the caller's own devices" },
  "POST /computer/shared/:sid/sleep": { status: 409, body: /need the bots' Linux computers/, why: "linuxOnly() before any lookup (this test runs without Docker); with Linux, ownShared() answers 404" },
  "POST /computer/shared/:sid/reset": { status: 409, body: /need the bots' Linux computers/, why: "as above" },
  "DELETE /computer/shared/:sid": { status: 409, body: /need the bots' Linux computers/, why: "as above" },
  "POST /health/credentials/:kind/:id/check": { status: 200, body: /^\{"items":\[\]\}$/, why: "checks the caller's own credentials of that kind: none here" },
  "POST /connectors/:id/oauth/start": { status: 400, body: /does not exist/, why: "connectors.startSignIn(user, id): the same 'does not exist' as for an unknown id" },
  "POST /native/accounts/:id/signin": { status: 400, body: /does not exist/, why: "looked up among the caller's accounts" },
  "PATCH /native/accounts/:id": { status: 400, body: /does not exist/, why: "looked up among the caller's accounts" },
  "DELETE /memories/:id": { status: 200, body: /^\{"ok":true\}$/, why: "memories.removeOwned(user, id): deletes only the caller's, idempotent" },
  "DELETE /pages/:token": { status: 200, body: /^\{"ok":true\}$/, why: "pages.remove(user, token): only the caller's, idempotent" },
  "DELETE /connectors/:id": { status: 200, body: /^\{"ok":true\}$/, why: "connectors.remove(user, id): only the caller's, idempotent" },
  // The parameter is a name in the caller's own settings, not an id of someone else's thing.
  "PUT /native/clients/:vendor": { status: 400, body: /client ID/, why: "the caller's own OAuth client for that vendor (validated first)" },
  "DELETE /native/clients/:vendor": { status: 200, body: /^\{"ok":true\}$/, why: "removes the caller's own client for that vendor" },
  "DELETE /policies/:tool": { status: 200, body: /^\{"ok":true\}$/, why: "removes the caller's own policy for that tool" },
  // In-process requests have no socket, so the bots' tool endpoint answers 503 before its own token check.
  "POST /mcp/:botId": { status: 503, why: "no socket in an in-process request; the engine token check is covered in security.test.ts" },
};
/** Bodies for routes that validate their input before looking the resource up, so the lookup itself is reached. */
const BODY: Record<string, unknown> = { "POST /approvals/:approvalId": { decision: "deny" } };

/**
 * Routes a workspace VIEWER may use on a bot shared with their workspace (accessBot(c, "view") in routes.ts), with the
 * status they get. Everything else on that bot is 403 (the viewer may not) or 404.
 */
const VIEWER_SHARED: Record<string, number> = {
  "GET /bots/:id/rows": 200,
  "POST /bots/:id/read": 200, // answers ok without changing anything: the unread mark is the owner's
};
/** Workspace routes a viewer of A's workspace may read (the workspace itself, not A's private things). */
const VIEWER_WORKSPACE: Record<string, number> = {
  "GET /workspaces/:wid/members": 200,
};

interface RouteRef { app: typeof api | typeof site; method: string; path: string; key: string }
function discover(): RouteRef[] {
  const seen = new Set<string>();
  const out: RouteRef[] = [];
  for (const [app, list] of [[api, api.routes], [site, site.routes]] as const) {
    for (const r of list) {
      if (r.method === "ALL" && (r.path === "/*" || r.path === "*")) continue; // middleware
      const key = `${r.method} ${r.path}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ app, method: r.method, path: r.path, key });
    }
  }
  // Reads first, deletions last, so a leak in one route cannot hide the others.
  const rank = (m: string) => (m === "GET" || m === "HEAD" ? 0 : m === "DELETE" ? 2 : 1);
  return out.sort((x, y) => rank(x.method) - rank(y.method));
}
const methodOf = (m: string) => (m === "ALL" ? "POST" : m);
const leakIn = (text: string) => MARK.test(text) || text.includes(userA) || text.includes("alice.alphasecret");

test("the route table is discovered (and is the whole API)", () => {
  const all = discover();
  assert.ok(all.length > 230, `found ${all.length} routes`);
  assert.ok(all.filter((r) => r.path.includes(":")).length > 150);
});

test("B, a stranger, gets 403/404 on every parameterised route with A's ids, and never A's data", async () => {
  const problems: string[] = [];
  let tried = 0;
  for (const bot of ["bot1", "bot2"] as const) {
    for (const r of discover().filter((x) => x.path.includes(":"))) {
      const url = fill(r.path, bot);
      const res = await call(r.app, "b", methodOf(r.method), url, BODY[r.key] ?? {});
      tried++;
      if (PUBLIC.has(r.key)) {
        // A page shared "with the link" is public by design (its token is the secret); a private one is not.
        if (r.key === "GET /p/:token") { if (res.status !== (bot === "bot1" ? 200 : 404) || (bot === "bot2" && leakIn(res.text))) problems.push(`${r.key} (${bot}, ${bot === "bot1" ? "link" : "private"}) → ${res.status}`); continue; }
        if (leakIn(res.text)) problems.push(`${r.key} (${bot}) → ${res.status} LEAKS: ${res.text.slice(0, 160)}`);
        const want = r.key === "POST /hooks/:token" ? [200] : r.key === "GET /native/:vendor/callback" ? [400] : [404, 410];
        if (!want.includes(res.status)) problems.push(`${r.key} (${bot}) public route → ${res.status}`);
        continue;
      }
      if (leakIn(res.text)) problems.push(`${r.key} (${bot}) → ${res.status} LEAKS: ${res.text.slice(0, 160)}`);
      const nr = NOT_REVEALING[r.key];
      if (nr) { if (res.status !== nr.status || (nr.body && !nr.body.test(res.text))) problems.push(`${r.key} (${bot}) → ${res.status} ${res.text.slice(0, 120)} (expected the non-revealing ${nr.status})`); continue; }
      if (BOT_CHANNEL.has(r.key)) { if (![401, 403, 404, 405].includes(res.status)) problems.push(`${r.key} (${bot}) → ${res.status}`); continue; }
      if (![403, 404].includes(res.status)) problems.push(`${r.key} (${bot}) → ${res.status} ${res.text.slice(0, 120)}`);
    }
  }
  assert.ok(tried > 300);
  assert.deepEqual(problems, []);
});

test("without a session, every non-public route says 401 (and nothing else)", async () => {
  const problems: string[] = [];
  for (const r of discover().filter((x) => x.app === api && !PUBLIC.has(x.key))) {
    const res = await call(api, null, methodOf(r.method), fill(r.path, "bot1"), {});
    if (leakIn(res.text)) problems.push(`${r.key} LEAKS`);
    // A handful of public routes have no parameter (health, me, downloads, sign-in, forgot-password status…): they must not leak either.
    if (res.status !== 401 && !/^(GET \/(health|me|downloads|auth\/link|connectors\/oauth\/callback|auth\/google.*|auth\/password\/status)|POST \/auth\/.*)$/.test(r.key)) problems.push(`${r.key} → ${res.status}`);
  }
  assert.deepEqual(problems, []);
});

test("B's own lists and searches (routes without a parameter) show nothing of A", async () => {
  const problems: string[] = [];
  for (const r of discover().filter((x) => x.app === api && (x.method === "GET") && !x.path.includes(":") && x.path !== "/events")) {
    const res = await call(api, "b", "GET", fill(r.path, "bot1"));
    if (leakIn(res.text)) problems.push(`${r.key} → ${res.status} LEAKS: ${res.text.slice(0, 160)}`);
  }
  assert.deepEqual(problems, []);
});

test("V, a viewer of A's workspace: the shared bot only through the allowed routes, the other bot not at all", async () => {
  const problems: string[] = [];
  for (const bot of ["bot1", "bot2"] as const) {
    for (const r of discover().filter((x) => x.app === api && x.path.includes(":") && !PUBLIC.has(x.key))) {
      const res = await call(api, "v", methodOf(r.method), fill(r.path, bot), BODY[r.key] ?? {});
      const onBot = r.path.startsWith("/bots/:id");
      const expected = bot === "bot1" && onBot ? VIEWER_SHARED[r.key] : r.path.startsWith("/workspaces/:wid") ? VIEWER_WORKSPACE[r.key] : undefined;
      if (expected !== undefined) {
        if (res.status !== expected) problems.push(`${r.key} (${bot}) allowed for a viewer: expected ${expected}, got ${res.status}`);
        continue;
      }
      const nr = NOT_REVEALING[r.key];
      if (nr ? res.status !== nr.status || (nr.body && !nr.body.test(res.text)) : ![403, 404].includes(res.status)) problems.push(`${r.key} (${bot}) → ${res.status} ${res.text.slice(0, 120)}`);
      // On the unshared bot, nothing at all may come back, not even its name.
      if (bot === "bot2" && leakIn(res.text)) problems.push(`${r.key} (bot2) LEAKS: ${res.text.slice(0, 160)}`);
    }
  }
  assert.deepEqual(problems, []);
  // What V does see of bot1 is that bot's chat, not A's other things.
  const rows = await call(api, "v", "GET", `/bots/${ids.bot1}/rows`);
  assert.equal(rows.status, 200);
  assert.ok(!rows.text.includes(ids.bot2));
});

test("events (SSE): B receives nothing of A, V nothing about the unshared bot", async () => {
  const read = async (who: Who) => {
    const ctrl = new AbortController();
    const res = await api.request("/events", { headers: { cookie: jars[who] }, signal: ctrl.signal });
    const reader = res.body!.getReader();
    let got = "";
    const pump = (async () => { try { for (;;) { const { value, done } = await reader.read(); if (done) break; got += new TextDecoder().decode(value); } } catch { /* aborted */ } })();
    return { stop: async () => { ctrl.abort(); await reader.cancel().catch(() => {}); await pump; return got; } };
  };
  const b = await read("b");
  const v = await read("v");
  // A's activity: a message to each bot, a changed memory, a usage update, and a direct event for A.
  await A("POST", `/bots/${ids.bot2}/messages`, { text: "ALPHASECRET again" });
  await A("PATCH", `/memories/${ids.mem_bot2}`, { text: "ALPHASECRET changed" });
  emit(userA, { type: "usage" });
  await new Promise((r) => setTimeout(r, 800));
  const gotB = await b.stop();
  const gotV = await v.stop();
  assert.match(gotB, /"type":"hello"/, "B's stream was open");
  assert.ok(!leakIn(gotB) && !gotB.includes(ids.bot1) && !gotB.includes(ids.bot2), `B got: ${gotB.slice(0, 300)}`);
  assert.ok(!gotV.includes(ids.bot2) && !leakIn(gotV.replace(/"[^"]*ALPHASECRET One[^"]*"/g, "")), `V got: ${gotV.slice(0, 300)}`);
});

test("A's things are all still there (nothing B or V tried changed them)", async () => {
  const n = (sql: string, ...p: string[]) => q.get<{ n: number }>(sql, ...p)!.n;
  assert.equal(n("SELECT COUNT(*) AS n FROM bots WHERE user_id = ? AND kind = 'agent' AND name LIKE 'ALPHASECRET%'", userA), 2);
  assert.equal(n("SELECT COUNT(*) AS n FROM vault WHERE user_id = ?", userA), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM connectors WHERE user_id = ?", userA), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM memories WHERE id IN ('a_mem_bot1', 'a_mem_bot2')"), 2);
  assert.equal(n("SELECT COUNT(*) AS n FROM workspaces WHERE id = ?", ids.ws), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM workspace_members WHERE workspace_id = ? AND user_id = ? AND role = 'viewer'", ids.ws, userV), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM bot_shares WHERE bot_id = ?", ids.bot1), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", userB) >= 1, true);
  // The routes allowed to answer 200 to B (NOT_REVEALING) left A's things alone.
  assert.equal(n("SELECT COUNT(*) AS n FROM pages WHERE token IN (?, ?)", ids.page_bot1, ids.page_bot2), 2);
  assert.equal(n("SELECT COUNT(*) AS n FROM native_clients WHERE user_id = ?", userA), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM policies WHERE user_id = ?", userA), 1);
  assert.equal(n("SELECT COUNT(*) AS n FROM shared_computers WHERE id = 'a_shared'"), 1);
  assert.equal(q.get<{ name: string }>("SELECT name FROM workspaces WHERE id = ?", ids.ws)!.name, "ALPHASECRET Studio");
});
