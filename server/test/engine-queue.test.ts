import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Subscription turns' time limit, the bot queue kept on disk, busy computers never put to sleep, the bot's effort passed
// to Claude Code / Codex, and the real Codex model list. The engine's computer is a fake here.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-eq-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
// 0.02 minutes = 1.2 s: long enough for a normal fake turn, short enough for a test.
process.env.ENGINE_TURN_TIMEOUT_MINUTES = "0.02";
process.env.CODEX_MODELS = "default,from-env";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { effortArgs, parseCodexCatalog, setCatalogRunner, setEngineHost, subscriptionChoices } = await import("../src/agent/engine.js");
const { enqueue, recoverInterruptedTurns } = await import("../src/agent/loop.js");
const { activeTurns, botQueue, users } = await import("../src/store.js");
const { ComputersBusyError, makeRoom } = await import("../src/linux.js");
const { q } = await import("../src/db.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** What the scripted model was asked, in order (the last text of each request). */
const asked: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const said = texts.join("\n");
    asked.push(said);
    const text = `Echo: ${said.slice(-60)}`;
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", model: "script-1", usage };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 800): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── The fake computer: records each command, plays a few scripted behaviours, counts holds ──
const execs: { args: string[]; input: string }[] = [];
let holds = 0, maxHolds = 0;
setEngineHost({
  ensure: async () => {},
  ready: async () => {},
  awake: () => true,
  kill: async () => {},
  writeFile: async () => {},
  hold: () => { holds++; maxHolds = Math.max(maxHolds, holds); let done = false; return () => { if (!done) { done = true; holds--; } }; },
  async exec(_bot, args, _env, _cwd, input, signal, onLine) {
    execs.push({ args, input });
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    if (input.includes("fixture final report")) {
      emit({ type: "assistant", message: { content: [{ type: "text", text: "Checking the fixture." }] } });
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "read-fixture", name: "Read", input: {} }] } });
      emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "read-fixture", content: "test data" }] } });
      const failed = input.includes("fixture final report failure");
      emit({ type: "result", is_error: failed, result: failed ? "The fixture failed." : "", usage: {} });
      return { code: failed ? 1 : 0, stderr: "" };
    }
    if (/hang forever/.test(input)) {
      // A tool that says a little, starts a step, then never returns until it is stopped.
      emit({ type: "system", subtype: "init", session_id: "sess-hang" });
      emit({ type: "stream_event", event: { delta: { type: "text_delta", text: "Starting the long job." } } });
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "h1", name: "Bash", input: { command: "sleep 99999" } }] } });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { code: 130, stderr: "" };
    }
    emit({ type: "assistant", message: { content: [{ type: "text", text: `Fine: ${input.slice(-40)}` }] } });
    emit({ type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});
after(() => { setEngineHost(null); setCatalogRunner(null); });

let sub: Bot;
let plain: Bot;
test("setup: an account, a subscription bot and a bot of ours", async () => {
  await call("POST", "/auth/signup", { email: "eq@example.com", password: "password-1", locale: "en" });
  sub = (await call("POST", "/bots", { name: "Sub" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" })).status, 200);
  plain = (await call("POST", "/bots", { name: "Plain" })).json.bot;
});

// ── 1. Time limit ────────────────────────────────────────────────────────────
test("a subscription turn past its time limit is stopped, told apart from Stop, keeps its work and offers Continue", async () => {
  await call("POST", `/bots/${sub.id}/messages`, { text: "please hang forever" });
  // Queued behind it: must run once the hung turn is stopped (the queue is not blocked forever).
  await sleep(100);
  enqueue(sub.id, { kind: "system", text: "after the hang" });
  const list = await until(async () => { const l = await rowsOf(sub.id); return l.some((r) => r.body.kind === "notice" && r.body.action?.kind === "continue") && l; }, "the time-limit notice", 400);
  const notice = list.find((r) => r.body.kind === "notice" && r.body.action?.kind === "continue")!;
  assert.ok(notice.body.kind === "notice");
  if (notice.body.kind !== "notice") return;
  assert.equal(notice.body.tone, "warn");
  assert.match(notice.body.text, /time limit/);
  assert.deepEqual(notice.body.action, { kind: "continue", status: "pending", reason: "timeout" });
  assert.equal(list.some((r) => r.body.kind === "notice" && r.body.text === "Stopped."), false, "not shown as the user's Stop");
  // What it said is kept; the step it was in says why it ended.
  assert.ok(list.some((r) => r.body.kind === "message" && r.body.text.includes("Starting the long job.")));
  const step = list.find((r) => r.body.kind === "step" && r.body.callId === "h1")!;
  assert.ok(step.body.kind === "step" && step.body.status === "error" && step.body.summary === "time limit reached");
  // The queued work ran next.
  await until(() => execs.some((e) => e.input.includes("after the hang")), "the queued work after the hang");
  // Continue: the work is picked back up, with a note that it was stopped at its time limit.
  assert.equal((await call("POST", `/bots/${sub.id}/rows/${notice.seq}/continue`)).status, 200);
  await until(() => execs.some((e) => e.input.includes("stopped because it reached its time limit")), "the continuation");
  assert.equal((await call("POST", `/bots/${sub.id}/rows/${notice.seq}/continue`)).status, 409, "once per notice");
  await until(async () => !(await call("GET", "/bots")).json.live[sub.id]?.running, "queue drained");
});

// ── 3. Busy computers ────────────────────────────────────────────────────────
test("a subscription turn holds its computer busy for its whole length, and releases it", async () => {
  maxHolds = 0;
  const before = execs.length;
  await call("POST", `/bots/${sub.id}/messages`, { text: "short job" });
  await until(() => execs.length > before && holds === 0 && maxHolds === 1, "held then released");
});

test("making room never puts a busy computer to sleep: the idle one goes, else it waits, else a clear error", async () => {
  type M = { id: string; busy: number; lastUsedAt: number };
  const freed: string[] = [];
  const room = (awake: M[], waitMs: number, take = () => {}) => makeRoom<M>({ max: 2, waitMs, stepMs: 20, awake: () => awake.filter((m) => !freed.includes(m.id)), take, pick: () => {}, free: async (m) => { freed.push(m.id); } });
  // Under the limit: nothing to do.
  await room([{ id: "a", busy: 1, lastUsedAt: 1 }], 0);
  assert.deepEqual(freed, []);
  // At the limit: the idle one goes even though the busy one is older.
  await room([{ id: "old-busy", busy: 1, lastUsedAt: 1 }, { id: "idle", busy: 0, lastUsedAt: 5 }], 0);
  assert.deepEqual(freed, ["idle"]);
  // All busy: waits until one is done.
  const later: M[] = [{ id: "b1", busy: 1, lastUsedAt: 1 }, { id: "b2", busy: 1, lastUsedAt: 2 }];
  setTimeout(() => { later[1].busy = 0; }, 100);
  const t0 = Date.now();
  await room(later, 2000);
  assert.ok(Date.now() - t0 >= 80, "it waited");
  assert.deepEqual(freed, ["idle", "b2"]);
  // All busy for too long: nothing evicted, a clear error.
  await assert.rejects(room([{ id: "c1", busy: 1, lastUsedAt: 1 }, { id: "c2", busy: 2, lastUsedAt: 2 }], 100), (err: unknown) => err instanceof ComputersBusyError && /never put to sleep/.test((err as Error).message));
  assert.deepEqual(freed, ["idle", "b2"]);
  // Two callers at once for the last slot: the slot is taken synchronously, so only one gets it without making room.
  const taken: string[] = [];
  const shared: M[] = [{ id: "s1", busy: 1, lastUsedAt: 1 }];
  const awake = () => [...shared, ...taken.map((id) => ({ id, busy: 1, lastUsedAt: 0 }))];
  const one = makeRoom<M>({ max: 2, waitMs: 60, stepMs: 20, awake, take: () => { taken.push("x"); }, pick: () => {}, free: async () => {} });
  const two = makeRoom<M>({ max: 2, waitMs: 60, stepMs: 20, awake, take: () => { taken.push("y"); }, pick: () => {}, free: async () => {} });
  const results = await Promise.allSettled([one, two]);
  assert.deepEqual(results.map((r) => r.status), ["fulfilled", "rejected"]);
  assert.deepEqual(taken, ["x"]);
});

// ── 4. Effort ────────────────────────────────────────────────────────────────
test("the bot's effort goes to Claude Code (--effort) and Codex (-c model_reasoning_effort), and nothing when unset", async () => {
  assert.deepEqual(effortArgs("claude-code", "high"), ["--effort", "high"]);
  assert.deepEqual(effortArgs("codex", "xhigh"), ["-c", 'model_reasoning_effort="xhigh"']);
  assert.deepEqual(effortArgs("claude-code", ""), []);
  assert.deepEqual(effortArgs("codex", undefined), []);
  assert.deepEqual(effortArgs("codex", "bogus"), []);
  await call("PATCH", `/bots/${sub.id}`, { effort: "high" });
  let before = execs.length;
  await call("POST", `/bots/${sub.id}/messages`, { text: "effort check claude" });
  const claude = await until(() => execs.slice(before).find((e) => e.input.includes("effort check claude")), "claude turn");
  const i = claude.args.indexOf("--effort");
  assert.ok(i > 0 && claude.args[i + 1] === "high", claude.args.join(" "));
  await until(async () => !(await call("GET", "/bots")).json.live[sub.id]?.running, "idle");
  await call("PATCH", `/bots/${sub.id}`, { model: "codex:default", effort: "low" });
  before = execs.length;
  await call("POST", `/bots/${sub.id}/messages`, { text: "effort check codex" });
  const codex = await until(() => execs.slice(before).find((e) => e.input.includes("effort check codex")), "codex turn");
  const j = codex.args.indexOf('model_reasoning_effort="low"');
  assert.ok(j > 0 && codex.args[j - 1] === "-c" && codex.args[0] === "codex" && codex.args.at(-1) === "-", codex.args.join(" "));
  await until(async () => !(await call("GET", "/bots")).json.live[sub.id]?.running, "idle");
  await call("PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" });
});

// ── 5. Real model list ───────────────────────────────────────────────────────
const CATALOG = JSON.stringify({ models: [
  { slug: "gpt-second", visibility: "list", priority: 5, supported_reasoning_levels: [{ effort: "low" }] },
  { slug: "gpt-first", visibility: "list", priority: 1 },
  { slug: "gpt-hidden", visibility: "hide", priority: 0 },
  { slug: "bad slug; rm -rf", visibility: "list", priority: 2 },
] });

test("the Codex catalog is read (listed models, by priority), cached 10 minutes, and the configured list is the fallback", async () => {
  assert.deepEqual(parseCodexCatalog(CATALOG), ["gpt-first", "gpt-second"]);
  assert.deepEqual(parseCodexCatalog("not json"), []);
  assert.deepEqual(parseCodexCatalog(JSON.stringify({ nope: 1 })), []);
  const owner = users.byEmail("eq@example.com")!;
  let reads = 0;
  setCatalogRunner(async () => { reads++; return CATALOG; });
  const codexOf = (list: { engine: string; model: string }[]) => list.filter((m) => m.engine === "codex").map((m) => m.model);
  const first = await subscriptionChoices(owner.id, sub.id);
  assert.deepEqual(codexOf(first), ["default", "gpt-first", "gpt-second"]);
  assert.ok(first.some((m) => m.ref === "claude-code:sonnet"), "Claude Code keeps its configured list (no documented way to list its models)");
  await subscriptionChoices(owner.id);
  assert.equal(reads, 1, "cached");
  // A failure (or a timeout, or nothing readable): the configured CODEX_MODELS.
  setCatalogRunner(async () => null);
  assert.deepEqual(codexOf(await subscriptionChoices(owner.id)), ["default", "from-env"]);
  setCatalogRunner(async () => { throw new Error("docker is gone"); });
  assert.deepEqual(codexOf(await subscriptionChoices(owner.id)), ["default", "from-env"]);
  setCatalogRunner(null);
});

// ── 2. Durable queue ─────────────────────────────────────────────────────────
const jobsOf = (botId: string) => q.all<{ id: number; status: string; trigger: string }>("SELECT id, status, trigger FROM bot_queue WHERE bot_id = ? ORDER BY id", botId);

test("queued work is written down, and marked done once it ran", async () => {
  const before = jobsOf(plain.id).length;
  enqueue(plain.id, { kind: "system", text: "written one" });
  enqueue(plain.id, { kind: "routine", name: "Daily", text: "written two" });
  await until(() => asked.some((a) => a.includes("written two")), "both ran");
  await until(() => jobsOf(plain.id).slice(before).every((j) => j.status === "done"), "marked done");
  const mine = jobsOf(plain.id).slice(before);
  assert.equal(mine.length, 2);
  assert.equal(JSON.parse(mine[1].trigger).kind, "routine");
});

test("after a restart, pending work runs again in order; done work never; the cut-off turn becomes its recovery, in its place", async () => {
  const at = Date.now();
  const add = (text: string, status: string) => Number(q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, ?, ?, ?)", plain.id, JSON.stringify({ kind: "system", text }), status, at).lastInsertRowid);
  // As a crashed server left it: one turn under way (it had acted), work queued behind it, and work already done.
  add("already done earlier", "done");
  const cut = add("the turn that was cut off", "running");
  add("replay first", "pending");
  add("replay second", "pending");
  activeTurns.begin(plain.id);
  activeTurns.acted(plain.id);
  const seen = asked.length;
  recoverInterruptedTurns();
  await until(() => asked.slice(seen).some((a) => a.includes("replay second")), "the replayed work");
  const order = asked.slice(seen);
  const iRecovery = order.findIndex((a) => a.includes("Never repeat an action that already went through"));
  const iFirst = order.findIndex((a) => a.includes("replay first"));
  const iSecond = order.findIndex((a) => a.includes("replay second"));
  assert.ok(iRecovery >= 0 && iRecovery < iFirst && iFirst < iSecond, `in order: ${order.join(" | ")}`);
  assert.equal(order.some((a) => a.includes("already done earlier")), false, "done work is not replayed");
  assert.deepEqual(order.filter((a) => a.includes("the turn that was cut off")), [order[iRecovery]]);
  const saved = JSON.parse(q.get<{ trigger: string }>("SELECT trigger FROM bot_queue WHERE id = ?", cut)!.trigger);
  assert.equal(saved.continuation, "restart_after_action");
  await until(() => botQueue.unfinished().filter((r) => r.bot_id === plain.id).length === 0, "all done");
  // A second recovery (nothing left) runs nothing again.
  const again = asked.length;
  recoverInterruptedTurns();
  await sleep(200);
  assert.equal(asked.length, again);
});

test("an interrupted reply stays in its thread, and one original routine run finishes", async () => {
  const { routines, runs } = await import("../src/routines.js");
  const { bots, rows } = await import("../src/store.js");
  const parent = rows.append(bots.byId(plain.id)!, { kind: "message", role: "user", text: "Thread fixture." });
  const makeRunning = (trigger: unknown) => {
    const id = botQueue.add(plain.id, trigger)!;
    botQueue.start(id);
    activeTurns.begin(plain.id);
    return id;
  };
  const id = makeRunning({ kind: "user", thread: parent.seq, text: "Report in this thread." });
  recoverInterruptedTurns();
  await until(() => botQueue.status(id) === "done", "thread recovery");
  const inThread = q.all<{thread: number}>("SELECT thread FROM rows WHERE bot_id = ? AND seq > ?", plain.id, parent.seq);
  assert.ok(inThread.length >= 2);
  assert.ok(inThread.every((row) => row.thread === parent.seq));
  const routine = routines.create(plain.id, { name: "Daily fixture", prompt: "Check the fixture.", trigger: "cron", schedule: "0 9 * * *", timezone: "Europe/Paris" });
  const runId = runs.start(routine.id);
  const job = makeRunning({ kind: "routine", name: routine.name, text: routine.prompt, runId });
  recoverInterruptedTurns();
  await until(() => botQueue.status(job) === "done", "routine recovery");
  assert.deepEqual(runs.list(routine.id).map((r) => [r.id, r.status]), [[runId, "done"]]);
});

test("a subscription failure after progress is an error in the routine history", async () => {
  const { routines, runs } = await import("../src/routines.js");
  const { fireRoutine } = await import("../src/scheduler.js");
  const r = routines.create(sub.id, { name: "Failure fixture", prompt: "fixture final report failure", trigger: "cron", schedule: "0 9 * * *", timezone: "Europe/Paris" });
  assert.equal(fireRoutine(r), "fired");
  await until(() => runs.list(r.id)[0]?.status !== "running", "routine ended");
  assert.equal(runs.list(r.id)[0].status, "error");
  assert.match(runs.list(r.id)[0].note, /fixture failed/);
});

test("a subscription that stops after its tool gives the user an explicit missing report", async () => {
  await call("POST", `/bots/${sub.id}/messages`, {text: "fixture final report missing"});
  await until(async () => (await rowsOf(sub.id)).some((r) => r.body.kind === "notice" && /Completion is unconfirmed/.test(r.body.text)), "missing final report");
});

test("after a restart, a job marked running whose turn had not started yet runs again; work still in memory is never doubled", async () => {
  const id = Number(q.run("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, ?, 'running', ?)", plain.id, JSON.stringify({ kind: "system", text: "started but not under way" }), Date.now()).lastInsertRowid);
  const seen = asked.length;
  recoverInterruptedTurns();
  await until(() => asked.slice(seen).some((a) => a.includes("started but not under way")), "rerun");
  await until(() => botQueue.status(id) === "done", "done");
  // A job this process holds (queued behind a slow turn) is not replayed by a recovery pass.
  enqueue(sub.id, { kind: "system", text: "please hang forever (in memory)" });
  enqueue(sub.id, { kind: "system", text: "behind the slow one" });
  await sleep(100);
  recoverInterruptedTurns();
  await until(() => execs.some((e) => e.input.includes("behind the slow one")), "it ran once the slow turn timed out");
  await sleep(300);
  assert.equal(execs.filter((e) => e.input.includes("behind the slow one")).length, 1, "exactly once");
  await until(async () => !(await call("GET", "/bots")).json.live[sub.id]?.running, "idle");
});

test("an old database gains the queue table without losing anything", () => {
  const cols = q.all<{ name: string }>("PRAGMA table_info(bot_queue)").map((c) => c.name);
  for (const c of ["id", "bot_id", "trigger", "status", "created_at", "started_at", "done_at"]) assert.ok(cols.includes(c), c);
});
