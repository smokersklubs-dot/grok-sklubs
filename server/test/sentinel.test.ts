import assert from "node:assert/strict";
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Sentinelle" (sentinel/) and the page "Surveillance": each detector on seeded data, stable fingerprints, the incident
// lifecycle (open → ongoing → resolved, acknowledged, a new episode after resolution), alerts (one per incident, an
// escalation, resolution, rate limit, quiet hours, the daily digest of info), owner-only routes, the link from
// "Aujourd'hui", and no model call anywhere in a scan.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-sentinel-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "spy:spy-1";
process.env.DISK_FREE_MIN_MB = "1";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "MAX_BOTS", "SENTINEL_EVERY_MIN", "SENTINEL_QUIET_MIN"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, users } = await import("../src/store.js");
const { BACKUP_STATUS_FILE } = await import("../src/monitor.js");
const { SESSION_COOKIE } = await import("../src/auth.js");
const signals = await import("../src/sentinel/signals.js");
const det = await import("../src/sentinel/detectors.js");
const sentinel = await import("../src/sentinel/index.js");
const alerts = await import("../src/sentinel/alerts.js");
const view = await import("../src/sentinel/view.js");
const { todayReport } = await import("../src/today.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { SentinelOverview, SentinelSettingsView } from "../src/shared.js";
import type { AlertSender } from "../src/sentinel/alerts.js";
import type { Detector, Observation } from "../src/sentinel/detectors.js";

// The only model of this server: any call to it during a scan would be a bug.
let modelCalls = 0;
registerProvider({
  id: "spy", label: "Spy", models: ["spy-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> { modelCalls++; return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "spy-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

const ORIGIN = process.env.PUBLIC_URL!;
type Who = "a" | "b" | "none";
const jars: Record<Who, string> = { a: "", b: "", none: "" };
async function call(who: Who, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && who !== "none" && set.startsWith(`${SESSION_COOKIE}=`)) jars[who] = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) as any };
}

const H = 3_600_000;
let userA = "", userB = "", botA = "", botB = "";
const sent: { userId: string; via: "push" | "mail"; title: string; body: string }[] = [];
const fake: AlertSender = {
  push: async (userId, title, body) => { sent.push({ userId, via: "push", title, body }); return 1; },
  mail: async (to, subject, text) => { sent.push({ userId: users.byEmail(to)!.id, via: "mail", title: subject, body: text }); },
  mailReady: () => true,
};
const clean = () => { for (const t of ["sentinel_samples", "sentinel_alerts", "sentinel_incidents", "sentinel_settings"]) q.run(`DELETE FROM ${t}`); sent.length = 0; signals.resetSignals(); };
const find = (list: Observation[], fp: string) => list.find((o) => o.fingerprint === fp);
const runOne = async (name: string, now = Date.now()) => (await det.DETECTORS.find((d) => d.name === name)!.run({ now }));

test("setup: A is the server's owner (oldest account), B another account", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password123" })).json.user.id;
  userB = (await call("b", "POST", "/auth/signup", { email: "bob@example.com", name: "Bob", password: "password123" })).json.user.id;
  botA = bots.list(userA, true)[0].id;
  botB = bots.list(userB, true)[0].id;
  assert.ok(userA && userB && botA && botB);
  assert.equal(view.canWatch(userA), true);
  assert.equal(view.canWatch(userB), false);
  assert.deepEqual(view.watchers(), [userA]);
});

// ── Detectors ────────────────────────────────────────────────────────────────────────────────────────────────────
test("tool_errors: failures per bot and tool in the last hour (5 → warn, 20 → critical), old ones and successes ignored", async () => {
  clean();
  const t = Date.now();
  const add = (bot: string, user: string, tool: string, status: string, at: number) => q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, decision, status) VALUES (?, ?, ?, ?, 'free', ?)", user, bot, at, tool, status);
  for (let i = 0; i < 4; i++) add(botA, userA, "web_fetch", "failed", t - 60_000);
  for (let i = 0; i < 10; i++) add(botA, userA, "web_fetch", "failed", t - 2 * H); // outside the window
  assert.equal((await runOne("tool_errors", t)).length, 0, "4 in the hour is not a spike");
  add(botA, userA, "web_fetch", "failed", t - 30_000);
  for (let i = 0; i < 20; i++) add(botA, userA, "web_fetch", "done", t - 30_000);
  let o = find(await runOne("tool_errors", t), `tool_errors:${botA}:web_fetch`)!;
  assert.equal(o.severity, "warn");
  assert.deepEqual(o.params, { tool: "web_fetch", failed: 5, total: 25 });
  assert.equal(o.userId, userA);
  for (let i = 0; i < 25; i++) add(botB, userB, "send_email", "failed", t - 10_000);
  const all = await runOne("tool_errors", t);
  assert.equal(find(all, `tool_errors:${botB}:send_email`)!.severity, "critical");
  o = find(all, `tool_errors:${botA}:web_fetch`)!;
  assert.equal(o.severity, "warn", "5 of 25 failing is not critical");
  q.run("DELETE FROM action_journal");
});

test("turn_failures: classified by provider and error class — Claude Code/Codex refresh token (auth), 429, context length", async () => {
  clean();
  assert.equal(signals.failureCode("OAuth token refresh failed: refresh token expired, please run /login"), "auth");
  assert.equal(signals.failureCode("Your access token could not be refreshed because your refresh token was already used"), "auth");
  assert.equal(signals.failureCode("boom", 401), "auth");
  assert.equal(signals.failureCode("Too Many Requests", 429), "rate_limit");
  assert.equal(signals.failureCode("rate limit exceeded"), "rate_limit");
  assert.equal(signals.failureCode("prompt is too long: 210000 tokens > 200000 maximum"), "context");
  assert.equal(signals.failureCode("x", 400, "context_length"), "context");
  assert.equal(signals.failureCode("Overloaded", 529), "overloaded");
  assert.equal(signals.failureCode("server error 502", 502), "server");
  assert.equal(signals.failureCode("fetch failed: ECONNRESET"), "network");
  assert.equal(signals.failureCode("something odd"), "other");
  signals.noteTurnFailure("claude_code", "OAuth error: refresh token expired");
  let all = await runOne("turn_failures");
  assert.equal(find(all, "turn_failures:claude_code:auth")!.severity, "warn");
  signals.noteTurnFailure("claude_code", "401 Unauthorized");
  signals.noteTurnFailure("claude_code", "Invalid API key");
  for (let i = 0; i < 4; i++) signals.noteTurnFailure("anthropic", "rate limited", 429);
  for (let i = 0; i < 3; i++) signals.noteTurnFailure("codex", "context window exceeded");
  all = await runOne("turn_failures");
  assert.equal(find(all, "turn_failures:claude_code:auth")!.severity, "critical");
  assert.equal(find(all, "turn_failures:claude_code:auth")!.count, 3);
  assert.equal(find(all, "turn_failures:anthropic:rate_limit"), undefined, "4 rate limits stay under 5");
  assert.equal(find(all, "turn_failures:codex:context")!.severity, "warn");
  signals.noteTurnFailure("anthropic", "rate limited", 429);
  assert.equal(find(await runOne("turn_failures"), "turn_failures:anthropic:rate_limit")!.severity, "warn");
  // Older than an hour: not counted.
  signals.resetSignals();
  for (let i = 0; i < 5; i++) signals.noteSignal("turn_failure", "openai:auth", Date.now() - 2 * H);
  assert.equal((await runOne("turn_failures")).length, 0);
});

test("engine_watch: stalls and ends of the subscription tool (audit, 6 h), slow first replies (signals)", async () => {
  clean();
  const t = Date.now();
  const add = (text: string, at = t - H) => q.run("INSERT INTO audit (user_id, at, bot_id, kind, text) VALUES (?, ?, ?, 'system', ?)", userA, at, botA, text);
  for (let i = 0; i < 3; i++) add("Juno: no progress for 5 min in the running turn");
  add("Juno: no progress for 5 min in the running turn", t - 7 * H);
  for (let i = 0; i < 2; i++) add("Juno: Claude Code ended without finishing the turn");
  for (let i = 0; i < 5; i++) signals.noteSignal("engine_silent", "engine");
  let all = await runOne("engine_watch", t);
  assert.equal(find(all, "engine_watch:stalled")!.severity, "warn");
  assert.equal(find(all, "engine_watch:stalled")!.count, 3);
  assert.equal(find(all, "engine_watch:gone"), undefined);
  assert.equal(find(all, "engine_watch:silent")!.severity, "info");
  add("Juno: Codex ended without finishing the turn");
  all = await runOne("engine_watch", t);
  assert.equal(find(all, "engine_watch:gone")!.count, 3);
  q.run("DELETE FROM audit WHERE kind = 'system'");
});

test("routine_failures, connector_auth, queue_stuck: from the routines, credential health and queue tables", async () => {
  clean();
  const t = Date.now();
  q.run("INSERT INTO routines (id, bot_id, name, prompt, created_at, failures) VALUES ('r_fail', ?, 'Veille', 'p', ?, 3)", botA, t);
  q.run("INSERT INTO routines (id, bot_id, name, prompt, created_at, failures, enabled, paused_reason) VALUES ('r_paused', ?, 'Rapport', 'p', ?, 5, 0, 'failed 5 times')", botB, t);
  q.run("INSERT INTO routines (id, bot_id, name, prompt, created_at, failures) VALUES ('r_ok', ?, 'Ok', 'p', ?, 1)", botA, t);
  const r = await runOne("routine_failures", t);
  assert.deepEqual(r.map((o) => o.fingerprint).sort(), ["routine_failures:r_fail", "routine_failures:r_paused"]);
  assert.equal(find(r, "routine_failures:r_paused")!.params.v, "paused");
  assert.equal(find(r, "routine_failures:r_paused")!.userId, userB);

  q.run("INSERT INTO credential_health (user_id, kind, ref_id, name, state) VALUES (?, 'connector', 'c1', 'Notion', 'broken')", userB);
  q.run("INSERT INTO credential_health (user_id, kind, ref_id, name, state) VALUES (?, 'vault', 'v1', 'OpenAI', 'ok')", userB);
  q.run("INSERT INTO native_accounts (id, user_id, app, label, status, error, created_at) VALUES ('na1', ?, 'gmail', 'perso', 'needs_auth', 'invalid_grant', ?)", userB, t);
  q.run("INSERT INTO native_accounts (id, user_id, app, label, status, created_at) VALUES ('na2', ?, 'gmail', 'new', 'needs_auth', ?)", userA, t);
  const c = await runOne("connector_auth", t);
  assert.deepEqual(c.map((o) => [o.fingerprint, o.count]), [[`connector_auth:${userB}`, 2]], "a never-signed-in account is not a failure");

  q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, '{}', 'pending', ?)", botA, t - 3 * H);
  q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, '{}', 'held', ?)", botA, t - 9 * H);
  q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, '{}', 'pending', ?)", botA, t - 60_000);
  let qs = await runOne("queue_stuck", t);
  assert.equal(qs[0].severity, "warn");
  assert.equal(qs[0].count, 1);
  q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, '{}', 'pending', ?)", botA, t - 7 * H);
  qs = await runOne("queue_stuck", t);
  assert.equal(qs[0].severity, "critical");
  q.run("DELETE FROM bot_queue"); q.run("DELETE FROM routines"); q.run("DELETE FROM credential_health"); q.run("DELETE FROM native_accounts");
});

test("disk_low and backup: free space thresholds; a failed or old backup", async () => {
  clean();
  const real = det.diskProbe.read;
  try {
    det.diskProbe.read = () => ({ freeMb: 100_000, totalMb: 200_000 });
    assert.equal((await runOne("disk_low")).length, 0);
    det.diskProbe.read = () => ({ freeMb: 5_000, totalMb: 200_000 });
    assert.equal((await runOne("disk_low"))[0].severity, "warn", "under 5 % free");
    det.diskProbe.read = () => ({ freeMb: 200, totalMb: 200_000 });
    const d = (await runOne("disk_low"))[0];
    assert.equal(d.severity, "critical");
    assert.equal(d.params.v, "full");
  } finally { det.diskProbe.read = real; }

  const file = path.join(process.env.DATA_DIR!, BACKUP_STATUS_FILE);
  const t = Date.now();
  assert.equal((await runOne("backup", t)).length, 0, "no backup record: nothing to say");
  writeFileSync(file, JSON.stringify({ at: t - H, ok: true }));
  assert.equal((await runOne("backup", t)).length, 0);
  writeFileSync(file, JSON.stringify({ at: t - 30 * H, ok: true }));
  assert.deepEqual((await runOne("backup", t)).map((o) => [o.fingerprint, o.severity, o.params.hours]), [["backup:old", "warn", 30]]);
  writeFileSync(file, JSON.stringify({ at: t - 80 * H, ok: true }));
  assert.equal((await runOne("backup", t))[0].severity, "critical");
  writeFileSync(file, JSON.stringify({ at: t - H, ok: false }));
  assert.deepEqual((await runOne("backup", t)).map((o) => [o.fingerprint, o.severity]), [["backup:failed", "critical"]]);
  rmSync(file);
});

test("docker: refused or unreachable Docker calls are classed (never a command's own failure)", async () => {
  clean();
  const { dockerTrouble } = await import("../src/linux.js");
  assert.equal(dockerTrouble('Error response from daemon: {"message":"Refused by Sklubot\'s Docker proxy: POST /build is not allowed"}'), "proxy_refused");
  assert.equal(dockerTrouble("Cannot connect to the Docker daemon at tcp://docker-proxy:2375. Is the docker daemon running?"), "daemon_unreachable");
  assert.equal(dockerTrouble("curl: (7) Failed to connect to localhost port 80: Connection refused"), null);
  for (let i = 0; i < 4; i++) signals.noteSignal("docker_error", "proxy_refused");
  assert.equal((await runOne("docker")).length, 0, "COMPUTER=browser: no ping, 4 errors under 5");
  signals.noteSignal("docker_error", "proxy_refused");
  assert.deepEqual((await runOne("docker")).map((o) => [o.fingerprint, o.severity]), [["docker:errors:proxy_refused", "warn"]]);
});

test("cost_spike: the last 24 h against the 7 days before (≥ 3× and ≥ 5 $ warn; ≥ 6× and ≥ 20 $ critical)", async () => {
  clean();
  const t = Date.now();
  const spend = (user: string, at: number, usd: number) => q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, 'm', 1, 1, 0, ?)", user, user === userA ? botA : botB, at, usd);
  for (let d = 1; d <= 7; d++) spend(userA, t - d * 24 * H - H, 2); // 2 $ a day
  spend(userA, t - H, 5);
  assert.equal((await runOne("cost_spike", t)).length, 0, "5 $ is 2.5× the baseline");
  spend(userA, t - 2 * H, 3);
  let o = find(await runOne("cost_spike", t), `cost_spike:${userA}`)!;
  assert.equal(o.severity, "warn");
  assert.deepEqual(o.params, { last: "8.00", base: "2.00", ratio: 4 });
  spend(userA, t - 3 * H, 15);
  o = find(await runOne("cost_spike", t), `cost_spike:${userA}`)!;
  assert.equal(o.severity, "critical");
  spend(userB, t - H, 4);
  assert.equal(find(await runOne("cost_spike", t), `cost_spike:${userB}`), undefined, "under 5 $: never a spike");
  q.run("DELETE FROM usage");
});

test("login_failures: a burst of refused passwords (counted by the sign-in route) is a possible attack", async () => {
  clean();
  for (let i = 0; i < 3; i++) assert.equal((await call("none", "POST", "/auth/login", { email: `nobody${i}@example.com`, password: "wrong-password" })).status, 401);
  assert.equal(signals.countSignals("login_failure", Date.now() - 60_000).reduce((a, s) => a + s.count, 0), 3);
  assert.equal((await runOne("login_failures")).length, 0);
  for (let i = 0; i < 20; i++) signals.noteSignal("login_failure", `203.0.113.${i % 4}`);
  const o = (await runOne("login_failures"))[0];
  assert.equal(o.severity, "warn");
  assert.equal(o.count, 23);
  assert.equal(o.params.sources, 5);
  for (let i = 0; i < 80; i++) signals.noteSignal("login_failure", "198.51.100.7");
  assert.equal((await runOne("login_failures"))[0].severity, "critical");
});

test("error_rate: the in-process error counter (console.error) and uncaught exceptions", async () => {
  clean();
  const original = console.error;
  console.error = () => {}; // keep the test's output clean; the counter wraps whatever console.error is
  try {
    signals.installErrorCounter();
    for (let i = 0; i < 29; i++) console.error("[x] boom", i);
    assert.equal((await runOne("error_rate")).length, 0);
    console.error("[x] one more");
    assert.deepEqual((await runOne("error_rate")).map((o) => [o.fingerprint, o.severity, o.count]), [["error_rate:log", "warn", 30]]);
    signals.noteSignal("uncaught", "exception");
    assert.ok(find(await runOne("error_rate"), "error_rate:uncaught"));
  } finally { console.error = original; }
});

test("hosted_budget (hosted mode only): customer accounts over their month's AI budget, read-only", async () => {
  clean();
  assert.equal((await runOne("hosted_budget")).length, 0, "off outside hosted mode");
  process.env.HOSTED_MODE = "1";
  try {
    const t = Date.now();
    q.run("INSERT OR IGNORE INTO subscriptions (user_id, plan_id, status, provider, external_ref, status_changed_at, created_at, updated_at) VALUES (?, 'free', 'active', 'manual', '', ?, ?, ?)", userB, t, t, t);
    const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions")!.n;
    assert.equal((await runOne("hosted_budget", t)).length, 0);
    q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, payer) VALUES (?, ?, ?, 'm', 1, 1, 0, 500, 'operator')", userB, botB, t);
    const o = (await runOne("hosted_budget", t))[0];
    assert.equal(o.severity, "info");
    assert.equal(o.count, 1);
    assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM subscriptions")!.n, before, "no subscription was created by the scan");
  } finally {
    delete process.env.HOSTED_MODE;
    q.run("DELETE FROM usage"); q.run("DELETE FROM subscriptions");
  }
});

// ── Fingerprints and lifecycle ───────────────────────────────────────────────────────────────────────────────────
let current: Observation[] = [];
let failing = false;
const fakeDetector: Detector = { name: "tool_errors", run: () => { if (failing) throw new Error("broken detector"); return current; } };
const obs = (count: number, severity: Observation["severity"] = "warn", tool = "web_fetch"): Observation => ({ fingerprint: `tool_errors:${botA}:${tool}`, kind: "tool_errors", severity, count, params: { tool, failed: count, total: count }, userId: userA, botId: botA });
const active = () => q.all<any>("SELECT * FROM sentinel_incidents WHERE status != 'resolved'");

test("fingerprints are stable: the same problem over several scans is one incident (open → ongoing), with its measure and peak", async () => {
  clean();
  const t = Date.now();
  // The real detector gives the same fingerprint for the same bot and tool whatever the count.
  q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, decision, status) VALUES (?, ?, ?, 'web_fetch', 'free', 'failed')", userA, botA, t);
  for (let i = 0; i < 5; i++) q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, decision, status) VALUES (?, ?, ?, 'web_fetch', 'free', 'failed')", userA, botA, t);
  const one = (await runOne("tool_errors", t))[0].fingerprint;
  for (let i = 0; i < 9; i++) q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, decision, status) VALUES (?, ?, ?, 'web_fetch', 'free', 'failed')", userA, botA, t);
  assert.equal((await runOne("tool_errors", t))[0].fingerprint, one);
  q.run("DELETE FROM action_journal");

  current = [obs(6)];
  const s1 = await sentinel.scan({ now: t, detectors: [fakeDetector], send: null });
  assert.equal(s1.opened, 1);
  let rows = active();
  assert.equal(rows.length, 1);
  assert.equal(rows[0].status, "open");
  const id = rows[0].id;
  current = [obs(12)];
  await sentinel.scan({ now: t + 10 * 60_000, detectors: [fakeDetector], send: null });
  current = [obs(8)];
  const s3 = await sentinel.scan({ now: t + 20 * 60_000, detectors: [fakeDetector], send: null });
  assert.equal(s3.opened, 0);
  rows = active();
  assert.equal(rows.length, 1);
  assert.deepEqual([rows[0].id, rows[0].status, rows[0].count, rows[0].peak, rows[0].seen], [id, "ongoing", 8, 12, 3]);
  // Its sparkline: the highest measure of each hour, 24 values.
  const line = view.sparklines([id], t + 20 * 60_000).get(id)!;
  assert.equal(line.length, 24);
  assert.ok(line.includes(12));
});

test("lifecycle: resolved after the quiet period, never while its detector fails; acknowledged; a new episode after resolution", async () => {
  clean();
  const t = Date.now();
  current = [obs(6)];
  await sentinel.scan({ now: t, detectors: [fakeDetector], send: null });
  const id = active()[0].id;
  current = [];
  // Quiet, but not for long enough yet.
  await sentinel.scan({ now: t + 10 * 60_000, detectors: [fakeDetector], send: null });
  assert.equal(active().length, 1);
  // The detector itself fails: the incident cannot be called resolved.
  failing = true;
  const broken = await sentinel.scan({ now: t + 60 * 60_000, detectors: [fakeDetector], send: null });
  assert.equal(broken.detectors[0].ok, false);
  assert.match(broken.detectors[0].error ?? "", /broken detector/);
  assert.equal(active().length, 1);
  failing = false;
  const r = await sentinel.scan({ now: t + 61 * 60_000, detectors: [fakeDetector], send: null });
  assert.equal(r.resolved, 1);
  assert.equal(active().length, 0);
  const done = q.get<any>("SELECT * FROM sentinel_incidents WHERE id = ?", id);
  assert.equal(done.status, "resolved");
  assert.equal(done.resolved_at, t + 61 * 60_000);
  // Back again: a new incident, the old one stays in the history.
  current = [obs(7)];
  await sentinel.scan({ now: t + 70 * 60_000, detectors: [fakeDetector], send: null });
  const again = active()[0];
  assert.notEqual(again.id, id);
  assert.equal(view.historyRows().length, 1);
  // Acknowledged: still active (and shown as such).
  assert.equal(sentinel.acknowledge(again.id, userA), true);
  assert.equal(view.stateOf(q.get<any>("SELECT * FROM sentinel_incidents WHERE id = ?", again.id)), "acknowledged");
  assert.equal(active().length, 1);
});

test("a detector that takes too long is given up (time box); the scan still finishes and reports it", async () => {
  clean();
  const slow: Detector = { name: "docker", run: () => new Promise(() => {}) };
  const limits = sentinel.SCAN_LIMITS as { detectorTimeoutMs: number };
  const before = limits.detectorTimeoutMs;
  limits.detectorTimeoutMs = 50;
  try {
    const r = await sentinel.scan({ detectors: [slow, fakeDetector], send: null });
    assert.deepEqual(r.detectors.map((d) => [d.name, d.ok]), [["docker", false], ["tool_errors", true]]);
  } finally { limits.detectorTimeoutMs = before; }
});

// ── Alerts ───────────────────────────────────────────────────────────────────────────────────────────────────────
const T0 = Date.UTC(2026, 10, 17, 14, 0, 0); // 14:00 UTC
const scanAt = (at: number, list: Observation[]) => { current = list; return sentinel.scan({ now: at, detectors: [fakeDetector], send: fake }); };

test("alerts: one per incident (push and e-mail), never twice; once more when it becomes critical; then its resolution", async () => {
  clean();
  current = [];
  view.sentinelSettings.save(userA, { digest: false });
  await scanAt(T0, [obs(6)]);
  assert.deepEqual(sent.map((s) => [s.userId, s.via]), [[userA, "push"], [userA, "mail"]], "only the owner is alerted, on both channels");
  assert.match(sent[0].title, /^Warning: The tool “web_fetch” keeps failing/);
  assert.match(sent[1].body, /https:\/\/bots\.example\.test\/\?view=surveillance/);
  sent.length = 0;
  await scanAt(T0 + 10 * 60_000, [obs(9)]);
  await scanAt(T0 + 20 * 60_000, [obs(9)]);
  assert.equal(sent.length, 0, "de-duplicated: the same incident never alerts twice");
  await scanAt(T0 + 30 * 60_000, [obs(25, "critical")]);
  assert.equal(sent.filter((s) => s.via === "push").length, 1);
  assert.match(sent[0].title, /^Incident escalated/);
  sent.length = 0;
  await scanAt(T0 + 40 * 60_000, [obs(25, "critical")]);
  assert.equal(sent.length, 0);
  // Quiet for 30 minutes: resolved, and said once.
  await scanAt(T0 + 80 * 60_000, []);
  assert.equal(sent.filter((s) => s.via === "push").length, 1);
  assert.match(sent[0].title, /^Incident resolved/);
  sent.length = 0;
  await scanAt(T0 + 90 * 60_000, []);
  assert.equal(sent.length, 0);
});

test("alerts: under the minimum severity, acknowledged, or with every channel off → none; French for a French owner", async () => {
  clean();
  view.sentinelSettings.save(userA, { digest: false, minSeverity: "critical" });
  await scanAt(T0, [obs(6)]);
  assert.equal(sent.length, 0, "warn under a critical minimum");
  await scanAt(T0 + 60_000, [obs(30, "critical")]);
  assert.equal(sent.filter((s) => s.via === "push").length, 1);
  sent.length = 0;
  // Acknowledged: its resolution is not announced either.
  sentinel.acknowledge(active()[0].id, userA);
  await scanAt(T0 + 2 * H, []);
  assert.equal(sent.length, 0);

  clean();
  q.run("UPDATE users SET locale = 'fr' WHERE id = ?", userA);
  view.sentinelSettings.save(userA, { digest: false, push: true, email: false });
  await scanAt(T0, [obs(6)]);
  assert.deepEqual(sent.map((s) => s.via), ["push"]);
  assert.match(sent[0].title, /^Attention : L'outil « web_fetch » échoue souvent/);
  assert.match(sent[0].body, /6 appels sur 6 ont échoué dans la dernière heure \(Juno\)/);
  q.run("UPDATE users SET locale = 'en' WHERE id = ?", userA);
  clean();
  view.sentinelSettings.save(userA, { digest: false, push: false, email: false });
  await scanAt(T0, [obs(30, "critical")]);
  assert.equal(sent.length, 0);
});

test("alerts: quiet hours hold them back, then they go once the quiet hours end", async () => {
  clean();
  view.sentinelSettings.save(userA, { digest: false, quiet: { enabled: true, start: "13:00", end: "15:00" }, timezone: "UTC" });
  await scanAt(T0, [obs(30, "critical")]); // 14:00 UTC
  await scanAt(T0 + 30 * 60_000, [obs(30, "critical")]);
  assert.equal(sent.length, 0);
  await scanAt(T0 + 70 * 60_000, [obs(30, "critical")]); // 15:10 UTC
  assert.equal(sent.filter((s) => s.via === "push").length, 1);
  assert.match(sent[0].title, /^Critical:/);
  // A time zone moves the quiet hours: 13:00–15:00 in Paris is 12:00–14:00 UTC in November.
  assert.equal(view.inQuiet({ ...view.DEFAULT_SETTINGS, quiet: { enabled: true, start: "13:00", end: "15:00" }, timezone: "Europe/Paris" }, T0 - 30 * 60_000), true);
  assert.equal(view.inQuiet({ ...view.DEFAULT_SETTINGS, quiet: { enabled: true, start: "22:00", end: "07:00" }, timezone: "UTC" }, Date.UTC(2026, 10, 17, 23, 0)), true);
  assert.equal(view.inQuiet({ ...view.DEFAULT_SETTINGS, quiet: { enabled: true, start: "22:00", end: "07:00" }, timezone: "UTC" }, T0), false);
});

test("alerts: rate limit — at most 4 notifications an hour; what is due at one scan goes in one notification", async () => {
  clean();
  view.sentinelSettings.save(userA, { digest: false, email: false });
  const list: Observation[] = [];
  for (let i = 0; i < 6; i++) {
    list.push(obs(6, "warn", `tool_${i}`));
    await scanAt(T0 + i * 60_000, [...list]);
  }
  assert.equal(sent.length, 4, "4 notifications in the hour, the 5th and 6th wait");
  assert.equal(alerts.sentLastHour(userA, T0 + 6 * 60_000), 4);
  sent.length = 0;
  await scanAt(T0 + 61 * 60_000, [...list]);
  assert.equal(sent.length, 1, "the two waiting incidents go together");
  assert.match(sent[0].title, /^2 new incidents/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sentinel_alerts WHERE user_id = ? AND kind = 'open'", userA)!.n, 6);
});

test("alerts: info never alerts at once; the daily digest lists it at the chosen hour, once a day", async () => {
  clean();
  view.sentinelSettings.save(userA, { digest: true, digestHour: 15, email: false, timezone: "UTC" });
  const info: Observation = { fingerprint: "hosted_budget", kind: "hosted_budget", severity: "info", count: 2, params: { n: 2 } };
  const infoDetector: Detector = { name: "hosted_budget", run: () => [info] };
  await sentinel.scan({ now: T0, detectors: [infoDetector], send: fake }); // 14:00: before the digest's hour
  assert.equal(sent.length, 0);
  await sentinel.scan({ now: T0 + 70 * 60_000, detectors: [infoDetector], send: fake }); // 15:10
  assert.equal(sent.length, 1);
  assert.match(sent[0].title, /^Monitoring: daily summary/);
  assert.match(sent[0].body, /Customer accounts out of AI budget/);
  await sentinel.scan({ now: T0 + 3 * H, detectors: [infoDetector], send: fake });
  assert.equal(sent.length, 1, "once a day");
  await sentinel.scan({ now: T0 + 25 * H, detectors: [infoDetector], send: fake }); // the next day, 15:00
  assert.equal(sent.length, 2);
});

// ── Routes, access, "Aujourd'hui" ────────────────────────────────────────────────────────────────────────────────
test("the page's routes are the owner's only: 401 without a session, 404 for another account, 200 for the owner", async () => {
  clean();
  current = [obs(30, "critical")];
  await sentinel.scan({ now: Date.now(), detectors: [fakeDetector], send: null });
  const id = active()[0].id;
  assert.equal((await call("none", "GET", "/surveillance")).status, 401);
  for (const [m, u] of [["GET", "/surveillance"], ["POST", "/surveillance/scan"], ["POST", `/surveillance/incidents/${id}/ack`], ["GET", "/surveillance/settings"], ["PUT", "/surveillance/settings"]] as const) {
    const r = await call("b", m, u, m === "PUT" ? { minSeverity: "info" } : undefined);
    assert.equal(r.status, 404, `${m} ${u}`);
    assert.ok(!JSON.stringify(r.json).includes("web_fetch"));
  }
  assert.equal(active()[0].acked_at, null, "B could not acknowledge it");
  assert.equal((await call("b", "GET", "/me")).json.sentinel, undefined);
  assert.equal((await call("a", "GET", "/me")).json.sentinel, true);

  const r = await call("a", "GET", "/surveillance");
  assert.equal(r.status, 200);
  const o = r.json as SentinelOverview;
  assert.equal(o.incidents.length, 1);
  assert.equal(o.incidents[0].severity, "critical");
  assert.equal(o.incidents[0].state, "open");
  assert.equal(o.incidents[0].sparkline.length, 24);
  assert.deepEqual(o.incidents[0].link, { kind: "bot", botId: botA });
  assert.match(o.incidents[0].fix, /Open the bot/);
  assert.deepEqual(o.counts, { info: 0, warn: 0, critical: 1 });
  assert.ok(o.health && o.health.checks.some((c) => c.name === "db"));

  // "Aujourd'hui": the owner gets a link to the open critical incident; B nothing.
  const need = todayReport(userA).needs.find((n) => n.kind === "incident");
  assert.ok(need);
  assert.deepEqual(need!.link, { kind: "surveillance", incidentId: id });
  assert.equal(todayReport(userB).needs.some((n) => n.kind === "incident"), false);

  const acked = await call("a", "POST", `/surveillance/incidents/${id}/ack`);
  assert.equal(acked.status, 200);
  assert.equal(acked.json.incidents[0].state, "acknowledged");
  assert.equal(acked.json.incidents[0].ackedBy, "Owner");
  assert.equal(todayReport(userA).needs.some((n) => n.kind === "incident"), false, "acknowledged: no longer waiting for the owner");
  assert.equal((await call("a", "POST", "/surveillance/incidents/inc_nope/ack")).status, 404);
});

test("settings: the owner's own, validated (Réglages → Surveillance)", async () => {
  const g = await call("a", "GET", "/surveillance/settings");
  assert.equal(g.status, 200);
  const v = g.json as SentinelSettingsView;
  assert.equal(v.email, "owner@example.com");
  assert.equal(typeof v.mailConfigured, "boolean");
  const put = await call("a", "PUT", "/surveillance/settings", { minSeverity: "info", quiet: { enabled: true, start: "23:00", end: "06:30" }, timezone: "Europe/Paris", digestHour: 8, push: false });
  assert.equal(put.status, 200);
  assert.deepEqual(put.json.settings, { push: false, email: true, minSeverity: "info", digest: true, digestHour: 8, quiet: { enabled: true, start: "23:00", end: "06:30" }, timezone: "Europe/Paris" });
  for (const bad of [{ minSeverity: "panic" }, { digestHour: 24 }, { quiet: { start: "25:00" } }, { timezone: "Mars/Olympus" }, { push: "yes" }]) {
    assert.equal((await call("a", "PUT", "/surveillance/settings", bad)).status, 400, JSON.stringify(bad));
  }
});

test("a whole scan with every detector calls no model and writes nothing but its own tables", async () => {
  clean();
  modelCalls = 0;
  const count = (t: string) => q.get<{ n: number }>(`SELECT COUNT(*) AS n FROM ${t}`)!.n;
  const watched = ["users", "bots", "rows", "usage", "action_journal", "audit", "routines", "bot_queue", "credential_health", "subscriptions", "push_subscriptions", "settings"];
  const before = Object.fromEntries(watched.map((t) => [t, count(t)]));
  signals.noteTurnFailure("claude_code", "refresh token expired");
  const r = await sentinel.scan({ send: fake });
  assert.equal(modelCalls, 0, "no model was called");
  assert.deepEqual(r.detectors.map((d) => d.name), det.DETECTORS.map((d) => d.name));
  assert.ok(r.detectors.every((d) => d.ok), JSON.stringify(r.detectors));
  assert.ok(r.observations.some((o) => o.fingerprint === "turn_failures:claude_code:auth"));
  assert.deepEqual(Object.fromEntries(watched.map((t) => [t, count(t)])), before);
  // And no Sentinelle source file imports the model layer.
  const dir = path.join(import.meta.dirname, "../src/sentinel");
  for (const f of readdirSync(dir)) assert.doesNotMatch(readFileSync(path.join(dir, f), "utf8"), /from "\.\.\/llm|from "\.\.\/agent\/|runTurn/, f);
});
