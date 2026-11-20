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
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "isoscript:iso-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
// These tests meter a free plan that uses the operator's keys with a 2 € budget (migration 4's default); migration 19
// turns the seeded "Gratuit" plan into "own key only" (0 €), so the budget is put back for them.
q.run("UPDATE plans SET ai_budget_eur = 2 WHERE id = 'free'");
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
  userA = (await call(api, "a", "POST", "/auth/signup", { email: "alice.alphasecret@example.com", name: "Alice ALPHASECRET", password: "password123", acceptTerms: true })).json.user.id;
  userB = (await call(api, "b", "POST", "/auth/signup", { email: "bob@example.com", name: "Bob", password: "password123", acceptTerms: true })).json.user.id;
  userV = (await call(api, "v", "POST", "/auth/signup", { email: "vera@example.com", name: "Vera", password: "password123", acceptTerms: true })).json.user.id;
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
    const upload = await A("POST", `/bots/${bot}/uploads/start`, { name: "ALPHASECRET.mp4", size: 4096 });
    assert.equal(upload.status, 200, upload.text);
    ids[`upload_${b}`] = upload.json.id;
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
    ins("INSERT INTO bot_failures (id, user_id, bot_id, class, detail, status, first_at, last_at) VALUES (?, ?, ?, 'tool_error', 'ALPHASECRET failure', 'waiting', ?, ?)", ids[`failure_${b}`] = `a_fail_${b}`, userA, bot, t, t);
    ins("INSERT INTO spend_checkpoints (id, worker_id, card_bot_id, scope_key, generation, spent_usd, threshold_usd, created_at) VALUES (?, ?, ?, 'chat:0', 1, 6, 5, ?)", ids[`spend_${b}`] = `a_spend_${b}`, bot, bot, t);
    ins("INSERT INTO bg_tasks (id, bot_id, title, goal, generation, created_at, updated_at) VALUES (?, ?, 'ALPHASECRET bg', 'ALPHASECRET', 1, ?, ?)", ids[`bg_${b}`] = `a_bg_${b}`, bot, t, t);
    ins("INSERT INTO nudges (id, bot_id, matter, title, body, created_at, updated_at) VALUES (?, ?, 'm', 'ALPHASECRET nudge', 'ALPHASECRET', ?, ?)", ids[`nudge_${b}`] = `a_nudge_${b}`, bot, t, t);
    ins("INSERT INTO inbound_mail (id, bot_id, from_addr, to_addr, subject, text, status, received_at) VALUES (?, ?, 'x@example.com', 'y@example.com', 'ALPHASECRET mail', 'ALPHASECRET', 'held', ?)", ids[`mail_${b}`] = `a_mail_${b}`, bot, t);
    ins("INSERT INTO local_tool_servers (id, user_id, bot_id, name, command, created_at) VALUES (?, ?, ?, 'alphasecret-tool', 'true', ?)", ids[`ltool_${b}`] = `a_ltool_${b}`, userA, bot, t);
  }
  q.run("UPDATE pages SET visibility = 'private' WHERE token = ?", ids.page_bot2);
  // Usage caps (usagecaps.ts): a cap of A's on bot1, and the card of a reached cap with work set aside on it.
  ins("INSERT INTO usage_caps (user_id, bot_id, period, unit, limit_value, updated_at) VALUES (?, ?, 'day', 'usd', 7, ?)", userA, ids.bot1, t);
  ins("INSERT INTO usage_cap_stops (id, user_id, card_bot_id, cap_key, period_key, generation, held, created_at) VALUES ('a_capstop', ?, ?, 'self:account:day:usd', '2026-01-01@7', 1, ?, ?)", userA, ids.bot1, JSON.stringify([{ botId: ids.bot1, trigger: { kind: "user", text: "ALPHASECRET held" } }]), t);
  // "Accès API": a key of A's on each bot (read, write, tasks), made through the owner's route.
  for (const b of ["bot1", "bot2"]) {
    const made = await A("POST", `/bots/${ids[b]}/api-keys`, { name: "ALPHASECRET key", scopes: ["read", "write", "tasks"] });
    assert.equal(made.status, 200, made.text);
    ids[`apikey_${b}`] = made.json.key.id;
    ids[`apisecret_${b}`] = made.json.secret;
  }
  // "Surveillance" (sentinel/): an incident about A's bot1 — only the server's owner (A) may see or acknowledge it.
  ins("INSERT INTO sentinel_incidents (id, fingerprint, kind, severity, status, params, user_id, bot_id, count, peak, seen, first_at, last_at) VALUES ('a_incident', ?, 'tool_errors', 'critical', 'open', ?, ?, ?, 25, 25, 1, ?, ?)",
    `tool_errors:${ids.bot1}:alphasecret_tool`, JSON.stringify({ tool: "alphasecret_tool", failed: 25, total: 25 }), userA, ids.bot1, t, t);
  // « Annonces » (announcements.ts): one written by A (the owner) for A's account only — nobody else may read or close it.
  const ann = await A("POST", "/announcements-admin", { kind: "important", title: "ALPHASECRET notice", body: "ALPHASECRET body", audience: { type: "accounts", emails: ["alice.alphasecret@example.com"] } });
  assert.equal(ann.status, 200, ann.text);
  ids.ann = ann.json.id;
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
  // OpenRouter (openrouterroutes.ts): A's own, with its key; B's /openrouter, /openrouter/test and /connect-subscription see nothing of it.
  ins("INSERT INTO user_providers (id, user_id, name, base_url, key_enc, models, preset, created_at, updated_at) VALUES ('up-alphaor', ?, 'ALPHASECRET OpenRouter', 'https://openrouter.ai/api/v1', ?, '[]', 'openrouter', ?, ?)", userA, seal("ALPHASECRET orkey"), t, t);
  ins("INSERT INTO shared_computers (id, user_id, name, created_at) VALUES ('a_shared', ?, 'ALPHASECRET shared', ?)", userA, t);
  ins("INSERT INTO policies (user_id, tool, mode) VALUES (?, 'web_fetch', 'ask')", userA);
  // The instance's automatic backup (autobackup.ts), set by A, the owner: bucket keys sealed, owner-only routes.
  ins("INSERT INTO instance_backup (id, endpoint, region, bucket, access_key_enc, secret_key_enc, prefix, recipient, updated_at, updated_by) VALUES (1, 'https://s3.gra.io.cloud.ovh.net', 'gra', 'alphasecret-bucket', ?, ?, 'alphasecret/', 'age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwj', ?, ?)", seal("ALPHASECRET-AK"), seal("ALPHASECRET-SK"), t, userA);
  // The workspace: V is a viewer, bot1 is shared with everyone of it, bot2 is not shared.
  ids.ws = (await A("POST", "/workspaces", { name: "ALPHASECRET Studio" })).json.workspace.id;
  const inv = (await A("POST", `/workspaces/${ids.ws}/invites`, { email: "vera@example.com", role: "viewer" })).json.invite;
  assert.equal((await call(api, "v", "POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") })).status, 200);
  ids.invite = (await A("POST", `/workspaces/${ids.ws}/invites`, { email: "later@example.com", role: "member" })).json.invite.id;
  assert.equal((await A("PUT", `/bots/${ids.bot1}/share`, { workspaceId: ids.ws, access: "all" })).status, 200);
  ins("INSERT INTO workspace_resources (workspace_id, kind, resource_id, shared_by, created_at) VALUES (?, 'connector', 'a_conn', ?, ?)", ids.ws, userA, t);
  assert.equal((await call(api, "v", "GET", "/bots")).json.bots.some((b: any) => b.id === ids.bot1), true, "V sees the shared bot");
  // Hosted mode (isolation-hosted.test.ts runs this file with HOSTED_MODE=1): A, the owner, is an operator with a plan
  // invitation of its own; B and V are customers. Off, the administration routes do not exist (404) and nothing is made.
  ids.planInvite = (await A("POST", "/admin/invites", { planId: "free", email: "later@example.com" })).json?.invite?.id ?? "pinv_none";
  if (HOSTED) assert.notEqual(ids.planInvite, "pinv_none", "the operator made a plan invitation");
});

/** A's value for a route parameter, from the static segment before it. Unknown → the suite fails (add it here). */
function resolve(routePath: string, param: string, bot: "bot1" | "bot2"): string | undefined {
  const segs = routePath.split("/");
  const i = segs.indexOf(`:${param}`);
  const prev = segs[i - 1] ?? "";
  const prev2 = segs[i - 2] ?? "";
  const b = bot;
  const table: Record<string, string> = {
    "research:report": "alpha-report",
    "studio-mp4:job": "7f72c1e2-97d1-440a-accc-2f672603972a",
    "uploads:uploadId": ids[`upload_${b}`],
    "bots:id": ids[b], "rows:seq": "1", "cards:seq": "1", "goals:goalId": ids[`goal_${b}`], "jobs:jobId": ids[`job_${b}`],
    "takeover:takeoverId": "tk_alpha", "approvals:approvalId": ids[`approval_${b}`], "skills:id": ids[`skill_${b}`],
    "memories:id": ids[`mem_${b}`], "routines:id": ids[`routine_${b}`], "calls:callId": "call_alpha", "history:generation": "1",
    "pages:token": ids[`page_${b}`], "shots:name": "shot-1.png", "shared:sid": "a_shared", "vault:id": "a_vault",
    "reach:channel": "telegram", "public-links:id": ids[`link_${b}`], "local-tools:id": ids[`ltool_${b}`],
    "connectors:id": "a_conn", "installed:id": "a_conn", "clients:vendor": "google", "accounts:id": "a_native", "policies:tool": "web_fetch",
    "rooms:id": ids.room, "model-prices:model": "alpha-model", "rules:id": "a_rule", "changes:id": "a_rulechange",
    "spend:id": ids[`spend_${b}`], "api-connectors:id": "a_apiconn", "executions:id": ids[`exec_${b}`],
    "bgtasks:taskId": ids[`bg_${b}`], "nudges:nudgeId": ids[`nudge_${b}`], "workspaces:wid": ids.ws, "members:uid": userA,
    "invites:iid": ids.invite, "resources:kind": "connector", "mail:mailId": ids[`mail_${b}`], "api-providers:id": "up-alpha",
    "sections:id": "a_section", "invites:token": "not-a-real-invite", "hooks:token": "hooktoken_" + b, "native:vendor": "google",
    "mcp:botId": ids[b], "egress:botId": ids[b], "l:token": "not-a-real-link", "p:token": ids[`page_${b}`],
    // Hosted mode (hosted.ts / hostedroutes.ts): A's account, A's plan invitation, A's provider; the public ones.
    "customers:uid": userA, "plans:planId": "free", "invites:inviteId": ids.planInvite, "providers:pid": "up-alpha",
    "plan-invites:token": "not-a-real-invite", "webhook:provider": "stripe",
    // Usage caps: the card of a reached cap.
    "stops:stopId": "a_capstop",
    // "Accès API" (botapi.ts): A's key of the bot, a message of A's conversation, a goal of A's bot.
    "api-keys:keyId": ids[`apikey_${b}`] ?? "bak_none", "messages:seq": "1", "tasks:taskId": ids[`goal_${b}`],
    // "Surveillance" (sentinel/): A's incident.
    "incidents:incidentId": "a_incident",
    // « Annonces »: A's announcement (for A only), on the readers' route and on the authors' ones.
    "announcements:annId": ids.ann, "announcements-admin:annId": ids.ann,
    // Pages (pageroutes.ts): a version of A's page; a signed address that is not valid.
    "versions:id": "1", "v:id": "1", ":id:sig": "1700000000.not-a-real-signature-not-a-real", "s:sig": "1700000000.not-a-real-signature-not-a-real",
    // « Bibliothèque de compétences »: a bundled skill (adding it acts on the caller's own bots only).
    "skills-library:id": "methode-de-travail",
    // « Coordinateur d'échecs » (agent/failures.ts): an incident of A's bot.
    "failures:failureId": ids[`failure_${b}`],
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
const PUBLIC = new Set(["POST /hooks/:token", "GET /invites/:token", "GET /native/:vendor/callback", "GET /p/:token", "GET /p/:token/", "GET /p/:token/*", "GET /p/:token/s/:sig/*", "GET /p/:token/v/:id/:sig/*", "GET /l/:token", "HEAD /l/:token", "GET /plan-invites/:token", "POST /billing/webhook/:provider"]);
/** Whether this run is the hosted-mode one (isolation-hosted.test.ts). */
const HOSTED = process.env.HOSTED_MODE === "1";
/**
 * The Bot API (botapi.ts, botmcp.ts): a bot's API key (Bearer) is its only credential; a session cookie is not one. Every
 * route under /v1 answers 401 to a session alone (and to no credential at all); keys themselves are tested below.
 */
const BOT_KEY = (key: string) => / \/v1\//.test(key);
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
  // The parameter is the id of a skill bundled with Sklubot (the same for everyone): it is added to the caller's own bots.
  "POST /skills-library/:id/add": { status: 200, body: /^\{"report":\{"added":\[.*\],"already":\[.*\]\}\}$/, why: "addFromLibrary(user, id): only the caller's own bots" },
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
  // « Écouter les réponses » (voice/speak.ts): who may read the chat may listen to it. Row 1 is A's own message, not a reply.
  "POST /bots/:id/rows/:seq/speak": 400,
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
        if (r.key === "GET /p/:token" || r.key === "GET /p/:token/") { if (res.status !== (bot === "bot1" ? 200 : 404) || (bot === "bot2" && leakIn(res.text))) problems.push(`${r.key} (${bot}, ${bot === "bot1" ? "link" : "private"}) → ${res.status}`); continue; }
        if (leakIn(res.text)) problems.push(`${r.key} (${bot}) → ${res.status} LEAKS: ${res.text.slice(0, 160)}`);
        // The payment webhook of a provider that is planned but not written: 501 in hosted mode (nothing changes), else 404.
        const want = r.key === "POST /hooks/:token" ? [200] : r.key === "GET /native/:vendor/callback" ? [400] : r.key === "POST /billing/webhook/:provider" ? [HOSTED ? 501 : 404] : [404, 410];
        if (!want.includes(res.status)) problems.push(`${r.key} (${bot}) public route → ${res.status}`);
        continue;
      }
      if (leakIn(res.text)) problems.push(`${r.key} (${bot}) → ${res.status} LEAKS: ${res.text.slice(0, 160)}`);
      const nr = NOT_REVEALING[r.key];
      if (nr) { if (res.status !== nr.status || (nr.body && !nr.body.test(res.text))) problems.push(`${r.key} (${bot}) → ${res.status} ${res.text.slice(0, 120)} (expected the non-revealing ${nr.status})`); continue; }
      if (BOT_CHANNEL.has(r.key)) { if (![401, 403, 404, 405].includes(res.status)) problems.push(`${r.key} (${bot}) → ${res.status}`); continue; }
      if (BOT_KEY(r.key)) { if (res.status !== 401) problems.push(`${r.key} (${bot}) → ${res.status} (a session is not an API key)`); continue; }
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
    if (res.status !== 401 && !/^(GET \/(health|me|downloads|plans|public\/landing|auth\/link|connectors\/oauth\/callback|auth\/google.*|auth\/password\/status)|POST \/auth\/.*|POST \/billing\/paddle\/webhook)$/.test(r.key)) problems.push(`${r.key} → ${res.status}`);
  }
  assert.deepEqual(problems, []);
});

test("B's own lists and searches (routes without a parameter) show nothing of A", async t => {
  // The marker also occurs in real public repository names. Keep the public GitHub service deterministic.
  const original = globalThis.fetch;
  t.mock.method(globalThis, "fetch", (input: RequestInfo | URL, init?: RequestInit) => {
    if (String(input).startsWith("https://api.github.com/search/repositories?")) {
      return Promise.resolve(Response.json({ items: [{ full_name: "public/example", description: "Public fixture", license: null }] }));
    }
    return original(input, init);
  });
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
      if (BOT_KEY(r.key)) { if (res.status !== 401) problems.push(`${r.key} (${bot}) → ${res.status} (a session is not an API key)`); continue; }
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

test("the automatic backup's routes (owner only): B and V get 403 on every one, and nothing of A's settings", async () => {
  const problems: string[] = [];
  const routes = discover().filter((r) => r.app === api && r.path.startsWith("/settings/backup"));
  assert.ok(routes.length >= 6, `found ${routes.length} backup routes`);
  for (const who of ["b", "v"] as const) {
    for (const r of routes) {
      const res = await call(api, who, methodOf(r.method), fill(r.path, "bot1"), { endpoint: "https://x.example", bucket: "abc-bucket", region: "x", accessKey: "k", secretKey: "s", recipient: "age1zvkyg2lqzraa2lnjvqej32nkuu0ues2s82hzrye869xeexvn73equnujwj", hour: 3, timezone: "UTC", keepDaily: 1, keepWeekly: 0 });
      if (res.status !== 403 || leakIn(res.text)) problems.push(`${who} ${r.key} → ${res.status} ${res.text.slice(0, 120)}`);
    }
  }
  assert.deepEqual(problems, []);
  // A sees the settings, never the keys.
  const mine = await A("GET", "/settings/backup");
  assert.equal(mine.status, 200);
  assert.equal(mine.json.bucket, "alphasecret-bucket");
  assert.ok(!mine.text.includes("ALPHASECRET-SK") && !mine.text.includes("ALPHASECRET-AK"));
});

test("Surveillance (sentinel/): owner only — B and V get 404 on every route and see nothing of A's incidents", async () => {
  const routes = discover().filter((r) => r.app === api && r.path.startsWith("/surveillance")).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /surveillance", "GET /surveillance/settings", "POST /surveillance/incidents/:incidentId/ack", "POST /surveillance/scan", "PUT /surveillance/settings"]);
  const problems: string[] = [];
  for (const who of ["b", "v"] as const) {
    for (const r of discover().filter((x) => x.app === api && x.path.startsWith("/surveillance"))) {
      const res = await call(api, who, methodOf(r.method), fill(r.path, "bot1"), { minSeverity: "info" });
      if (res.status !== 404 || leakIn(res.text) || res.text.includes("a_incident")) problems.push(`${who} ${r.key} → ${res.status} ${res.text.slice(0, 120)}`);
    }
    assert.equal((await call(api, who, "GET", "/me")).json.sentinel, undefined);
  }
  assert.deepEqual(problems, []);
  assert.equal(q.get<{ acked_at: number | null }>("SELECT acked_at FROM sentinel_incidents WHERE id = 'a_incident'")!.acked_at, null, "nobody but A acknowledged it");
  // A, the server's owner, sees it — with the bot's name, since it is A's own bot.
  const mine = await A("GET", "/surveillance");
  assert.equal(mine.status, 200);
  assert.ok(mine.json.incidents.some((i: any) => i.id === "a_incident" && /ALPHASECRET One/.test(i.explanation)));
});

test("Annonces (announcements.ts): authors' routes are the owner's only (404 for B and V); readers see only what is theirs", async () => {
  const routes = discover().filter((r) => r.app === api && r.path.startsWith("/announcements")).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /announcements", "GET /announcements-admin", "POST /announcements-admin", "POST /announcements-admin/:annId/archive", "POST /announcements-admin/preview", "POST /announcements/:annId/dismiss", "POST /announcements/seen", "PUT /announcements-admin/:annId", "PUT /announcements/prefs"]);
  const problems: string[] = [];
  const draft = { kind: "info", title: "Hello", body: "", audience: { type: "everyone" } };
  for (const who of ["b", "v"] as const) {
    for (const r of discover().filter((x) => x.app === api && x.path.startsWith("/announcements-admin"))) {
      const res = await call(api, who, methodOf(r.method), fill(r.path, "bot1"), draft);
      if (res.status !== 404 || leakIn(res.text)) problems.push(`${who} ${r.key} → ${res.status} ${res.text.slice(0, 120)}`);
    }
    const dis = await call(api, who, "POST", `/announcements/${ids.ann}/dismiss`, {});
    if (dis.status !== 404 || leakIn(dis.text)) problems.push(`${who} dismiss → ${dis.status}`);
    await call(api, who, "POST", "/announcements/seen", { ids: [ids.ann] });
    const feed = await call(api, who, "GET", "/announcements");
    if (feed.status !== 200 || leakIn(feed.text) || feed.text.includes(ids.ann) || feed.json.canAuthor !== false) problems.push(`${who} feed → ${feed.status} ${feed.text.slice(0, 160)}`);
  }
  assert.deepEqual(problems, []);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcement_reads WHERE announcement_id = ?", ids.ann)!.n, 0, "nobody but A marked it");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM announcements")!.n, 1, "B and V created nothing");
  const mine = await A("GET", "/announcements");
  assert.equal(mine.status, 200);
  assert.ok(mine.json.canAuthor && mine.json.items.some((i: any) => i.id === ids.ann));
});

test("Pause (agent/pause.ts): owner only — B and V get 404 on A's bots and section, and 'everything' pauses only their own", async () => {
  const routes = discover().filter((r) => r.app === api && /pause|resume/.test(r.path)).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /pauses", "POST /bots/:id/pause", "POST /bots/:id/resume", "POST /pauses/all", "POST /sections/:id/pause", "POST /sections/:id/resume"]);
  for (const who of ["b", "v"] as const) {
    for (const bot of ["bot1", "bot2"] as const) {
      for (const action of ["pause", "resume"]) {
        const res = await call(api, who, "POST", `/bots/${ids[bot]}/${action}`, {});
        assert.equal(res.status, 404, `${who} ${action} ${bot}`);
        assert.ok(!leakIn(res.text));
      }
    }
    assert.equal((await call(api, who, "POST", "/sections/a_section/pause", {})).status, 404);
    assert.equal((await call(api, who, "PATCH", "/sections/a_section", { instructions: "outside" })).status, 404);
    // Their own "pause everything" and their own state: nothing of A's.
    assert.equal((await call(api, who, "POST", "/pauses/all", { paused: true })).status, 200);
    const mine = await call(api, who, "GET", "/pauses");
    assert.ok(!leakIn(mine.text) && !mine.text.includes(ids.bot1) && !mine.text.includes("a_section"));
    assert.equal((await call(api, who, "POST", "/pauses/all", { paused: false })).status, 200);
  }
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_pauses WHERE user_id = ?", userA)!.n, 0, "nothing of A's was paused");
  assert.equal((await A("GET", "/bots")).json.bots.find((b: any) => b.id === ids.bot1).pause, null);
});

test("Bot API keys (botapi.ts): A's key of bot1 reaches bot1 only; B's key reaches nothing of A; every /v1 route is covered", async () => {
  const v1 = discover().filter((r) => r.app === api && r.path.startsWith("/v1/"));
  assert.deepEqual(v1.map((r) => r.key).sort(), ["DELETE /v1/mcp", "DELETE /v1/team/mcp", "GET /v1/bot", "GET /v1/bot/messages", "GET /v1/bot/messages/:seq/wait", "GET /v1/bot/tasks/:taskId", "GET /v1/mcp", "GET /v1/team/mcp", "POST /v1/bot/messages", "POST /v1/bot/tasks", "POST /v1/mcp", "POST /v1/team/mcp"], "a new /v1 route must be added to this test");
  const withKey = (secret: string, method: string, url: string, body?: unknown) =>
    api.request(url, { method, headers: { "content-type": "application/json", authorization: `Bearer ${secret}`, accept: "application/json, text/event-stream" }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) }).then(async (r) => ({ status: r.status, text: await r.text() }));
  // B makes a key of B's own bot.
  const bBot = (await call(api, "b", "GET", "/bots")).json.bots[0].id;
  const bKey = (await call(api, "b", "POST", `/bots/${bBot}/api-keys`, { name: "B key", scopes: ["read", "write", "tasks"] })).json.secret as string;
  const problems: string[] = [];
  for (const r of v1) {
    const url = fill(r.path, "bot1").replace(/\?.*$/, "") + (r.path.endsWith("/wait") ? "?timeout=0" : "");
    const body = r.path === "/v1/mcp" ? { jsonrpc: "2.0", id: 1, method: "tools/list", params: {} } : r.path.endsWith("/tasks") ? { objective: "probe" } : { text: "probe" };
    const b = await withKey(bKey, methodOf(r.method), url, body);
    if (leakIn(b.text) || b.text.includes(ids.bot1) || b.text.includes(ids.bot2)) problems.push(`B's key: ${r.key} → ${b.status} LEAKS ${b.text.slice(0, 160)}`);
    const a = await withKey(ids.apisecret_bot1, methodOf(r.method), url, body);
    if (a.text.includes(ids.bot2) || /ALPHASECRET Two/.test(a.text)) problems.push(`A's bot1 key: ${r.key} → ${a.status} reaches bot2 ${a.text.slice(0, 160)}`);
    if (a.status >= 500) problems.push(`A's bot1 key: ${r.key} → ${a.status}`);
  }
  assert.deepEqual(problems, []);
  // The keys' management routes: owner only (B and V were refused above); A's keys are intact and A's bots got no message from B.
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_api_keys WHERE user_id = ? AND revoked_at IS NULL", userA)!.n, 2);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows WHERE bot_id IN (?, ?) AND body LIKE '%\"B key\"%'", ids.bot1, ids.bot2)!.n, 0);
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
  assert.equal(q.get<{ bucket: string }>("SELECT bucket FROM instance_backup WHERE id = 1")?.bucket, "alphasecret-bucket");
  // Usage caps: A's cap and A's card are untouched.
  assert.equal(q.get<{ limit_value: number }>("SELECT limit_value FROM usage_caps WHERE user_id = ? AND bot_id = ?", userA, ids.bot1)?.limit_value, 7);
  assert.equal(q.get<{ status: string }>("SELECT status FROM usage_cap_stops WHERE id = 'a_capstop'")?.status, "pending");
});

test("usage caps: B can neither read nor set A's caps (nor cap A's bot), nor answer A's cap card", async () => {
  const B = (m: string, u: string, b?: unknown) => call(api, "b", m, u, b);
  const mine = await B("GET", "/usage/caps");
  assert.equal(mine.status, 200);
  assert.ok(!leakIn(mine.text) && !mine.text.includes(ids.bot1), "B's view shows nothing of A");
  assert.equal((await B("PUT", "/usage/caps", { botId: ids.bot1, period: "day", unit: "usd", limit: 1 })).status, 404);
  assert.equal((await B("POST", "/usage/caps/stops/a_capstop", { action: "continue" })).status, 404);
  assert.equal((await call(api, "v", "POST", "/usage/caps/stops/a_capstop", { action: "wait" })).status, 404, "a viewer of A's workspace neither");
  assert.equal((await call(api, "v", "PUT", "/usage/caps", { botId: ids.bot1, period: "day", unit: "usd", limit: 1 })).status, 404);
  assert.equal(q.get<{ limit_value: number }>("SELECT limit_value FROM usage_caps WHERE user_id = ? AND bot_id = ?", userA, ids.bot1)?.limit_value, 7);
  assert.equal(q.get<{ status: string }>("SELECT status FROM usage_cap_stops WHERE id = 'a_capstop'")?.status, "pending");
});

test("Aujourd'hui (today.ts): B sees nothing of A; V sees only the shared bot's chat-visible results, never the other bot nor A's lists or costs", async () => {
  const routes = discover().filter((r) => r.app === api && r.path.startsWith("/today")).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /today", "GET /today/settings", "PUT /today/settings"]);
  // Something finished today on each bot, A's own records (task list, journal, usage) and an approval waiting on bot1.
  const now = Date.now();
  for (const b of ["bot1", "bot2"] as const) {
    q.run("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, evidence, created_at, updated_at) VALUES (?, ?, ?, 1, ?, 'complete', 5, 'ALPHASECRET evidence', ?, ?)", `a_done_${b}`, ids[b], userA, `ALPHASECRET goal done ${b}`, now, now);
    q.run("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES (?, ?, 'ALPHASECRET task done', 'done', ?, ?)", `a_tdone_${b}`, ids[b], now, now);
    q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, label, decision, status) VALUES (?, ?, ?, 'bot_email_send', 'ALPHASECRET email', 'words', 'done')", userA, ids[b], now);
  }
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, 'x:y', 5, 5, 0, 4.2)", userA, ids.bot1, now);
  const own = await A("GET", "/today");
  assert.equal(own.status, 200);
  assert.ok(own.text.includes("ALPHASECRET goal done bot2") && own.text.includes("ALPHASECRET email"), "A sees A's day");
  const b = await call(api, "b", "GET", "/today?date=");
  assert.equal(b.status, 200);
  assert.ok(!leakIn(b.text) && !b.text.includes(ids.bot1) && !b.text.includes(ids.bot2), `B got: ${b.text.slice(0, 200)}`);
  const v = await call(api, "v", "GET", "/today");
  assert.equal(v.status, 200);
  assert.deepEqual(v.json.done.map((g: any) => g.botId), [ids.bot1]);
  assert.ok(v.text.includes("ALPHASECRET goal done bot1"));
  for (const s of [ids.bot2, "goal done bot2", "ALPHASECRET task done", "ALPHASECRET email", "a_appr_"]) assert.ok(!v.text.includes(s), `V saw ${s}`);
  assert.equal(v.json.cost.usd, 0, "V's own costs, not A's");
  assert.deepEqual(v.json.needs, [], "a viewer answers nothing for A");
  // Settings are per account: B's change is B's alone.
  assert.equal((await call(api, "b", "PUT", "/today/settings", { minutes: { goal: 1 }, digest: { enabled: true } })).status, 200);
  assert.equal((await A("GET", "/today")).json.minutes.table.goal, 30);
  assert.equal((await A("GET", "/today/settings")).json.digest.enabled, false);
});

test("Centre de commandement (command.ts): B sees nothing of A; V only the shared bot, without A's tasks, costs, incidents, computer or owner actions", async () => {
  const routes = discover().filter((r) => r.app === api && r.path.startsWith("/command")).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /command"]);
  const own = await A("GET", "/command");
  assert.equal(own.status, 200);
  const ownIds = own.json.cards.map((c: any) => c.botId);
  assert.ok(ownIds.includes(ids.bot1) && ownIds.includes(ids.bot2) && !ownIds.includes(ids.room), "A sees A's bots (not the group chat as a card)");
  assert.ok(own.json.cards.find((c: any) => c.botId === ids.bot2).incidents >= 1, "A sees A's incidents");
  const b = await call(api, "b", "GET", "/command");
  assert.equal(b.status, 200);
  assert.ok(!leakIn(b.text) && !b.text.includes(ids.bot1) && !b.text.includes(ids.bot2) && !b.text.includes(ids.room), `B got: ${b.text.slice(0, 200)}`);
  const v = await call(api, "v", "GET", "/command");
  assert.equal(v.status, 200);
  // V's own first bot, and of A's only the shared one.
  assert.deepEqual(v.json.cards.filter((c: any) => c.shared).map((c: any) => c.botId), [ids.bot1]);
  const c = v.json.cards.find((x: any) => x.botId === ids.bot1);
  assert.equal(c.usage, null);
  assert.equal(c.incidents, null);
  assert.equal(c.computer, null);
  assert.deepEqual(c.can, { pause: false, stop: false, chat: true, computer: false, incidents: false });
  for (const s of [ids.bot2, ids.room, "ALPHASECRET Two", "ALPHASECRET Room", "ALPHASECRET task", "ALPHASECRET failure", "echo ALPHASECRET"]) assert.ok(!v.text.includes(s), `V saw ${s}`);
  assert.equal(v.json.kpis.incidents, 0);
  assert.equal(v.json.kpis.usage.usd, 0, "V's own consumption, not A's");
});

test("public sign-up (publicsignup.ts): the landing data, the first run and the verification routes only touch the caller", async () => {
  const routes = discover().filter((r) => r.app === api && /^\/(public\/|onboarding\/|account\/verify-email|auth\/verify-email)/.test(r.path)).map((r) => r.key).sort();
  assert.deepEqual(routes, ["GET /public/landing", "POST /account/verify-email/resend", "POST /auth/verify-email", "POST /onboarding/commit", "POST /onboarding/skip"]);
  const aBots = q.all<{ id: string; name: string }>("SELECT id, name FROM bots WHERE user_id = ? ORDER BY id", userA);
  // The landing page's data is public and says nothing of anyone (templates and plans only).
  const landing = await call(api, null, "GET", "/public/landing");
  assert.equal(landing.status, 200);
  assert.ok(!leakIn(landing.text) && !landing.text.includes(ids.bot1));
  // B's first run creates B's bots (or meets B's plan limit), never A's; a second one is refused.
  const first = await call(api, "b", "POST", "/onboarding/commit", { template: "secretariat", name: "Alphasecret clone" });
  assert.ok([200, 403].includes(first.status), first.text);
  assert.ok(!first.text.includes(userA) && !first.text.includes(ids.bot1));
  if (first.status === 200) assert.equal(q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", first.json.botId)!.user_id, userB);
  assert.equal((await call(api, "b", "POST", "/onboarding/skip")).status, 200);
  assert.equal((await call(api, "b", "POST", "/onboarding/commit", { template: "secretariat" })).status, 409);
  // A verification link cannot be guessed, and resending is about the caller only (B is not held: nothing to confirm).
  assert.equal((await call(api, "b", "POST", "/auth/verify-email", { token: "not-a-real-token" })).status, 400);
  const resend = await call(api, "b", "POST", "/account/verify-email/resend");
  assert.equal(resend.status, 200); assert.equal(resend.json.verified, true);
  assert.deepEqual(q.all<{ id: string; name: string }>("SELECT id, name FROM bots WHERE user_id = ? ORDER BY id", userA), aBots, "A's bots are untouched");
});

test("mandatory e-mail verification: an unconfirmed account gets 403 email_unverified on EVERY session route but the few that let it confirm, sign out, export or leave", async () => {
  const { users: userStore } = await import("../src/store.js");
  const { createSession } = await import("../src/auth.js");
  const ps = await import("../src/publicsignup.js");
  // U: a new public account that has not opened its link yet (verification on: EMAIL_VERIFICATION not 0).
  const u = userStore.create("ursula.unverified@example.com", "Ursula", "x", "en");
  q.run("UPDATE users SET email_verify_pending = 1, first_bot = 'null' WHERE id = ?", u.id);
  const saved = process.env.EMAIL_VERIFICATION;
  delete process.env.EMAIL_VERIFICATION;
  const cookie = `${SESSION_COOKIE}=${createSession(u.id).token}`;
  try {
    assert.equal(ps.emailGateBlocks(u.id), true);
    assert.equal(ps.emailGateBlocks(userA), false, "the owner is never held");
    const asU = async (method: string, url: string) => {
      const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie }, body: method === "GET" || method === "HEAD" ? undefined : "{}" });
      const text = method === "HEAD" ? "" : await res.text();
      let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
      return { status: res.status, json, text };
    };
    const problems: string[] = [];
    let held = 0, allowed = 0;
    for (const r of discover().filter((x) => x.app === api)) {
      // Only routes behind the session check: those that answer 401 to nobody (the public ones are tested above).
      const anon = await call(api, null, methodOf(r.method), fill(r.path, "bot1"), {});
      if (anon.status !== 401 || BOT_KEY(r.key)) continue;
      const method = methodOf(r.method);
      if (method === "GET" && r.path === "/events") { if (ps.emailGateAllows("GET", "/events")) problems.push("events allowed"); held++; continue; }
      const res = await asU(method, fill(r.path, "bot1"));
      if (leakIn(res.text)) problems.push(`${r.key} LEAKS`);
      if (ps.emailGateAllows(method, r.path)) {
        allowed++;
        if (res.json?.code === "email_unverified") problems.push(`${r.key} should stay open to a held account`);
      } else {
        held++;
        if (res.status !== 403 || res.json?.code !== "email_unverified") problems.push(`${r.key} → ${res.status} ${res.text.slice(0, 100)} (expected 403 email_unverified)`);
      }
    }
    assert.deepEqual(problems, []);
    assert.ok(held > 200, `held on ${held} routes`);
    assert.deepEqual(allowed, 8, "resend, the address (read, change, cancel), delete, export, language");
    // What it may do: read itself (with the deadline), resend (no SMTP here: says so), its language; nothing was created.
    const me = await asU("GET", "/me");
    assert.equal(me.json.user.emailUnverified, true);
    assert.ok(me.json.user.emailVerifyDeadline > Date.now());
    assert.equal((await asU("POST", "/account/verify-email/resend")).status, 409);
    assert.equal((await asU("PUT", "/prefs")).status, 200);
    assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", u.id)!.n, 0, "no bot before verification");
    // Confirmed: everything opens, and the first bot appears.
    ps.markVerified(u.id);
    const after = await asU("GET", "/bots");
    assert.equal(after.status, 200);
    assert.equal(after.json.bots.filter((b: any) => b.primary).length, 1, "the first bot is made once the address is proven");
  } finally {
    if (saved === undefined) delete process.env.EMAIL_VERIFICATION; else process.env.EMAIL_VERIFICATION = saved;
  }
});

test("« Écouter » (POST /bots/:id/rows/:seq/speak): a reply is heard by whoever may read the chat, through its owner's voice only", async () => {
  const reply = (await A("GET", `/bots/${ids.bot1}/rows`)).json.rows.find((r: any) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).seq;
  // A (no speech service on this server): the app is told to use the browser's own voice; nothing of A in the answer to V.
  const own = await A("POST", `/bots/${ids.bot1}/rows/${reply}/speak`, {});
  assert.equal(own.status, 409);
  assert.equal(own.json.code, "no_tts");
  const v = await call(api, "v", "POST", `/bots/${ids.bot1}/rows/${reply}/speak`, {});
  assert.equal(v.status, 409, "the viewer reads the chat, so may listen to it");
  assert.ok(!leakIn(v.text));
  // B, a stranger, and V on the bot that is not shared: as if it did not exist.
  for (const [who, bot] of [["b", ids.bot1], ["b", ids.bot2], ["v", ids.bot2]] as const) {
    const r = await call(api, who, "POST", `/bots/${bot}/rows/${reply}/speak`, {});
    assert.equal(r.status, 404);
    assert.ok(!leakIn(r.text));
  }
});

test("dictation (POST /voice/transcribe?bot=): only someone who may talk to the bot uses its owner's speech services", async () => {
  // B, a stranger: A's bots do not exist for them. V, a viewer: sees bot1 but may not talk to it; bot2 is not shared.
  assert.equal((await call(api, "b", "POST", `/voice/transcribe?bot=${ids.bot1}`, {})).status, 404);
  assert.equal((await call(api, "v", "POST", `/voice/transcribe?bot=${ids.bot1}`, {})).status, 403);
  assert.equal((await call(api, "v", "POST", `/voice/transcribe?bot=${ids.bot2}`, {})).status, 404);
  for (const who of ["b", "v"] as const) assert.ok(!MARK.test((await call(api, who, "POST", `/voice/transcribe?bot=${ids.bot1}`, {})).text));
  // Without a session, nothing.
  assert.equal((await call(api, null, "POST", "/voice/transcribe", {})).status, 401);
});
