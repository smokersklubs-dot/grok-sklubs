import assert from "node:assert/strict";
import type { Server } from "node:http";
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Spec 06 (bot HQ update): engine turns (tool-row matching, approvals, restart), first bot, team limit, deletion order,
// screen setup sharing. The engine's computer is a fake here; the desk test runs on the real one (desk.test.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-s06-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.FIRST_BOT_NAME = "Atlas";
process.env.APPROVAL_EXPIRE_MIN = "10";
process.env.DEFAULT_MODEL = "script:script-1";
delete process.env.FIRST_BOT_LABEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { setEngineHost, claimStep, restartSettled } = await import("../src/agent/engine.js");
const { enqueue, expireOrphanApprovals, decideApproval } = await import("../src/agent/loop.js");
const { retireBot, retireSteps } = await import("../src/agent/retire.js");
const { subscribe } = await import("../src/bus.js");
const { approvals, bots, paused, rows: rowStore, setMaxBots, users } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const { ensureDressed, linuxScreen, setDressRunner, setLookOverride } = await import("../src/linux.js");
const { workspaceOf } = await import("../src/computer.js");
const { serve } = await import("@hono/node-server");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Live, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** Scripted model for bots of ours: "call T {json}" → one tool, else an echo. */
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    if (!results.length && /call \w+ \{/.test(said)) {
      const m = /call (\w+) (\{[^\n]*\})/.exec(said)!;
      return { content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name: m[1], input: JSON.parse(m[2]) }], stopReason: "tool_use", model: "script-1", usage };
    }
    const text = results.length ? "Done." : `Echo: ${said}`;
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", model: "script-1", usage };
  },
});

// The tool endpoint for subscription bots, on a real HTTP port (it needs the raw request).
const http = serve({ fetch: site.fetch, port: 0 }) as unknown as Server;
await new Promise((r) => setTimeout(r, 50));
const port = (http.address() as { port: number }).port;
after(() => { http.closeAllConnections?.(); http.close(); setEngineHost(null); setDressRunner(null); });

let cookie = "";
async function call(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, headers: res.headers };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 800): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stepRow = (list: Row[], callId: string) => list.find((r) => r.body.kind === "step" && r.body.callId === callId)?.body as Extract<Row["body"], { kind: "step" }> | undefined;

/** One JSON-RPC tools/call to /mcp/<bot>, as the engine inside the computer would send it. */
async function mcp(botId: string, token: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp/${botId}`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).pop() ?? "{}";
  const msg = JSON.parse(data);
  return { text: (msg.result?.content ?? []).map((c: any) => c.text ?? "").join(" "), isError: !!msg.result?.isError };
}

// ── The fake computer of subscription bots: plays the tool's event stream and calls our tool endpoint ──
type Script = (o: { botId: string; token: string; prompt: string; emit: (e: unknown) => void; signal: AbortSignal }) => Promise<void>;
const files = new Map<string, string>();
let kills = 0, readyCalls = 0;
const scripts: { match: RegExp; run: Script }[] = [];
setEngineHost({
  ensure: async () => {},
  ready: async () => { readyCalls++; },
  awake: () => true,
  kill: async () => { kills++; },
  writeFile: async (botId, p, content) => { files.set(`${botId}:${p}`, content); },
  async exec(bot, _args, _env, _cwd, input, signal, onLine) {
    const token = /Bearer ([0-9a-f]+)/.exec(files.get(`${bot.id}:/root/.sklubot/mcp.json`) ?? "")?.[1] ?? "";
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    emit({ type: "system", subtype: "init", session_id: `sess-${bot.id}` });
    const script = scripts.find((s) => s.match.test(input));
    if (script) await script.run({ botId: bot.id, token, prompt: input, emit, signal });
    else emit({ type: "assistant", message: { content: [{ type: "text", text: "Fine." }] } });
    emit({ type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});

// ── Accounts ─────────────────────────────────────────────────────────────────
test("B-9: the first bot's name comes from the sign-up form, else the server's setting; the role is translated", async () => {
  const me = await call("GET", "/me", undefined, { "accept-language": "fr-FR" });
  assert.deepEqual(me.json.firstBot, { name: "Atlas", label: "Bras droit" });
  await call("POST", "/auth/signup", { email: "setting@example.com", password: "password-1", locale: "fr" });
  let list = (await call("GET", "/bots")).json.bots as Bot[];
  const main = list.find((b) => b.primary)!;
  assert.equal(main.name, "Atlas");
  assert.equal(main.label, "Bras droit");
  await call("POST", "/auth/logout");
  cookie = "";
  await call("POST", "/auth/signup", { email: "owner@example.com", password: "password-1", locale: "en", botName: "  Nova  Lee ", botLabel: "Partner" });
  list = (await call("GET", "/bots")).json.bots as Bot[];
  const mine = list.find((b) => b.primary)!;
  assert.equal(mine.name, "Nova Lee");
  assert.equal(mine.label, "Partner");
});

test("U-009: a used or expired sign-in link answers 410 with a plain page", async () => {
  const res = await api.request("/auth/link?token=nope");
  assert.equal(res.status, 410);
  assert.match(await res.text(), /expired or was already used/);
});

test("U-004: MAX_BOTS counts agent bots across every account; past it, a clear 409 and nothing is evicted", async () => {
  const before = bots.teamCount();
  setMaxBots(before + 1);
  try {
    const ok = await call("POST", "/bots", { name: "Fits" });
    assert.equal(ok.status, 200);
    const full = await call("POST", "/bots", { name: "Too many" });
    assert.equal(full.status, 409);
    assert.match(full.json.error, new RegExp(`team is full.*at most ${before + 1} bots.*Remove one`));
    // Group chats do not count.
    const main = ((await call("GET", "/bots")).json.bots as Bot[]).find((b) => b.primary)!;
    assert.equal((await call("POST", "/rooms", { name: "Room", botIds: [main.id, ok.json.bot.id] })).status, 200);
    // A new account would need a bot too: refused before anything is created.
    const saved = cookie; cookie = "";
    const signup = await call("POST", "/auth/signup", { email: "late@example.com", password: "password-1" });
    assert.equal(signup.status, 409);
    assert.equal(users.byEmail("late@example.com"), null);
    cookie = saved;
    assert.equal(bots.teamCount(), before + 1, "nobody was evicted");
  } finally { setMaxBots(0); }
});

// ── Subscription engine turns ────────────────────────────────────────────────
let engineBot: Bot;
const liveSeen: Live[] = [];
test("B-3 / U-001: tool calls on our endpoint are matched with the stream's rows first in, first out; B-7: the step counter", async () => {
  engineBot = (await call("POST", "/bots", { name: "Sub" })).json.bot;
  await call("PATCH", `/bots/${engineBot.id}`, { model: "claude-code:sonnet" });
  subscribe(users.byEmail("owner@example.com")!.id, (e) => { if (e.type === "live" && e.botId === engineBot.id) liveSeen.push(e.live); });
  let rowsDuring: Row[] = [];
  scripts.push({
    match: /go fifo/,
    run: async ({ botId, token, emit }) => {
      emit({ type: "assistant", message: { content: [
        { type: "tool_use", id: "t1", name: "mcp__sklubot__task_add", input: { title: "first" } },
        { type: "tool_use", id: "t2", name: "mcp__sklubot__TASK_ADD", input: { title: "second" } },
        { type: "tool_use", id: "t3", name: "ToolSearch", input: { query: "x" } },
      ] } });
      const a = mcp(botId, token, "task_add", { title: "first" });
      await sleep(120);
      const b = mcp(botId, token, "Task_Add", { title: "second" });
      await Promise.all([a, b]);
      rowsDuring = await rowsOf(botId);
      // The results come back in the other order, found by call id: what our side declared wins over the raw output.
      emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t2", content: "raw two" }, { type: "tool_result", tool_use_id: "t1", content: "raw one" }] } });
      emit({ type: "assistant", message: { content: [{ type: "text", text: "Both tracked." }] } });
    },
  });
  await call("POST", `/bots/${engineBot.id}/messages`, { text: "go fifo" });
  await until(async () => (await rowsOf(engineBot.id)).some((r) => r.body.kind === "message" && r.body.text === "Both tracked."), "the engine's reply");
  const during1 = stepRow(rowsDuring, "t1")!, during2 = stepRow(rowsDuring, "t2")!;
  assert.equal(during1.summary, "first", "the first call took the first row");
  assert.equal(during2.summary, "second");
  assert.equal(during1.tool, "task_add", "the engine's prefix and case are gone");
  const end = await rowsOf(engineBot.id);
  assert.equal(stepRow(end, "t1")!.status, "done");
  assert.equal(stepRow(end, "t1")!.summary, "first");
  assert.equal(stepRow(end, "t2")!.summary, "second");
  assert.equal(stepRow(end, "t3"), undefined, "the engine's tool search makes no row");
  assert.equal(Math.max(...liveSeen.map((l) => l.steps ?? 0)), 2, "two steps counted, the tool search not");
  assert.ok(liveSeen.some((l) => l.caption === "Finding the right tool"));
  assert.ok(readyCalls >= 1, "the screen was checked before the message went to the engine (B-2)");
});

test("B-3: a call with no row (no turn, or a session outside the app) still runs; no row is invented", async () => {
  assert.equal(await claimStep(engineBot.id, "task_add", 100), null);
});

let pendingResult: Promise<{ text: string; isError: boolean }> | null = null;
scripts.push({
  match: /go approve/,
  run: async ({ botId, token, emit }) => {
    emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "a1", name: "mcp__sklubot__memory_save", input: { text: "remember this" } }] } });
    pendingResult = mcp(botId, token, "memory_save", { text: "remember this" });
    const r = await pendingResult;
    emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a1", content: r.text, is_error: r.isError }] } });
  },
});
const pendingCard = async (botId: string) => until(async () => {
  const r = (await rowsOf(botId)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending");
  return r?.body.kind === "card" && r.body.card.type === "approval" ? { seq: r.seq, approvalId: r.body.card.approvalId } : null;
}, "a pending approval card");

test("B-5 / U-002: only a new user message expires an engine approval — not a routine, a bot's message or a system notice", async () => {
  pendingResult = null;
  await call("POST", `/bots/${engineBot.id}/messages`, { text: "go approve" });
  const card = await pendingCard(engineBot.id);
  let list = await rowsOf(engineBot.id);
  assert.equal(stepRow(list, "a1")!.status, "waiting", "the claimed row waits for the user");
  assert.ok(liveSeen.at(-1)!.awaiting, "live state: needs you");
  // Turns from a routine, another bot or a system notice queue up behind; none of them lapses the approval.
  enqueue(engineBot.id, { kind: "routine", name: "Daily", text: "routine work" });
  enqueue(engineBot.id, { kind: "bot", fromName: "Atlas", text: "hello from a teammate", depth: 1 });
  enqueue(engineBot.id, { kind: "system", text: "a notice" });
  await sleep(400);
  assert.equal(approvals.byId(card.approvalId)!.status, "pending");
  // The user writes: the approval lapses at once, the call returns, the row says "skipped".
  await call("POST", `/bots/${engineBot.id}/messages`, { text: "actually, never mind" });
  const r = await until(() => pendingResult, "the tool call");
  const out = await r;
  assert.equal(out.isError, true);
  assert.match(out.text, /not approved: the user sent a new message, or did not answer in time/);
  assert.equal(approvals.byId(card.approvalId)!.status, "expired");
  list = await until(async () => { const l = await rowsOf(engineBot.id); return stepRow(l, "a1")?.status === "denied" && l; }, "row denied");
  assert.equal(stepRow(list, "a1")!.summary, "skipped");
  const c = list.find((x) => x.seq === card.seq)!;
  assert.equal(c.body.kind === "card" && c.body.card.type === "approval" && c.body.card.status, "expired");
  // Let the queued turns (routine, teammate, notice, the user's message) run out.
  await until(async () => !(await call("GET", "/bots")).json.live[engineBot.id]?.running, "queue drained", 1600);
});

test("B-4: restarting the engine stops its turn, lapses its approvals and starts again in the background", async () => {
  pendingResult = null;
  await call("POST", `/bots/${engineBot.id}/messages`, { text: "go approve" });
  const card = await pendingCard(engineBot.id);
  const before = kills;
  const res = await call("POST", `/bots/${engineBot.id}/engine/restart`);
  assert.equal(res.status, 200);
  assert.equal(res.json.runtime.status, "starting");
  assert.equal(res.json.runtime.engine, "claude-code");
  assert.equal(approvals.byId(card.approvalId)!.status, "expired", "the source keeps them; we do not");
  await restartSettled(engineBot.id);
  assert.equal(kills, before + 1);
  const state = await call("GET", `/bots/${engineBot.id}/engine?runtime=1`);
  assert.equal(state.json.runtime.status, "ready");
  await until(async () => (await rowsOf(engineBot.id)).some((r) => r.body.kind === "notice" && r.body.text === "Stopped."), "the turn was stopped");
  // A bot of ours has no engine to restart.
  const plain = (await call("POST", "/bots", { name: "Plain" })).json.bot as Bot;
  assert.equal((await call("POST", `/bots/${plain.id}/engine/restart`)).status, 409);
});

test("B-5: after a server restart, approvals nobody waits for any more are marked expired; a paused turn's is kept", async () => {
  const owner = users.byEmail("owner@example.com")!;
  const bot = bots.byId(engineBot.id)!;
  const cardRow = rowStore.append(bot, { kind: "card", card: { type: "approval", approvalId: "apr_orphan", title: "t", detail: "", tool: "memory_save", source: "x", status: "pending" } });
  approvals.create(bot.id, owner.id, bot.generation, cardRow.seq, "memory_save", "apr_orphan");
  const plain = bots.create(owner.id, { name: "Paused one" });
  const heldRow = rowStore.append(plain, { kind: "card", card: { type: "approval", approvalId: "apr_held", title: "t", detail: "", tool: "x", source: "x", status: "pending" } });
  approvals.create(plain.id, owner.id, plain.generation, heldRow.seq, "x", "apr_held");
  paused.set(plain.id, { approvalId: "apr_held", pending: [], results: [], stepSeq: {}, generation: plain.generation, depth: 0, endTurn: false, system: "", tools: [], modelRef: "script:script-1" });
  assert.ok(expireOrphanApprovals() >= 1);
  assert.equal(approvals.byId("apr_orphan")!.status, "expired");
  assert.equal(approvals.byId("apr_held")!.status, "pending");
  const c = rowStore.get(bot.id, bot.generation, cardRow.seq)!;
  assert.equal(c.body.kind === "card" && c.body.card.type === "approval" && c.body.card.status, "expired");
  // A click on a card whose waiter is gone expires it instead of acting.
  const late = rowStore.append(bot, { kind: "card", card: { type: "approval", approvalId: "apr_late", title: "t", detail: "", tool: "memory_save", source: "x", status: "pending" } });
  approvals.create(bot.id, owner.id, bot.generation, late.seq, "memory_save", "apr_late");
  assert.equal(decideApproval(owner.id, "apr_late", "allow"), true);
  assert.equal(approvals.byId("apr_late")!.status, "expired");
  paused.clear(plain.id);
});

test("B-7: the step counter of a turn of ours counts its tool calls and starts at 0", async () => {
  const bot = (await call("POST", "/bots", { name: "Counter" })).json.bot as Bot;
  const seen: Live[] = [];
  const off = subscribe(users.byEmail("owner@example.com")!.id, (e) => { if (e.type === "live" && e.botId === bot.id) seen.push(e.live); });
  await call("POST", `/bots/${bot.id}/messages`, { text: 'call task_add {"title":"one"}' });
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "message" && r.body.text === "Done."), "the reply");
  off();
  assert.equal(seen.find((l) => l.running)?.steps, 0);
  assert.equal(Math.max(...seen.map((l) => l.steps ?? 0)), 1);
});

// ── Deleting a bot ───────────────────────────────────────────────────────────
test("U-003: deletion runs in order; a failing step is logged and does not stop the others nor the deletion", async () => {
  const owner = users.byEmail("owner@example.com")!;
  const bot = (await call("POST", "/bots", { name: "Doomed" })).json.bot as Bot;
  routines.create(bot.id, { name: "Every hour", prompt: "x", trigger: "cron", schedule: "0 * * * *", timezone: "UTC" });
  workspaceOf(bot.id);
  const order: string[] = [];
  const saved = retireSteps.map((s) => s.run);
  retireSteps.forEach((s, i) => { s.run = async (b) => { order.push(s.id); if (s.id === "screen" || s.id === "engine") throw new Error(`${s.id} broke`); return saved[i](b); }; });
  try {
    const report = await retireBot(bots.byId(bot.id)!);
    assert.deepEqual(order, ["turn", "routines", "helpers", "engine", "screen", "files", "record"]);
    assert.deepEqual(report.filter((r) => !r.ok).map((r) => r.step), ["engine", "screen"]);
    assert.equal(bots.byId(bot.id), null, "the bot is gone anyway");
    assert.deepEqual(routines.forBot(bot.id), []);
    assert.equal(existsSync(path.join(process.env.DATA_DIR!, "workspaces", bot.id)), false, "its files are gone");
    const log = (await call("GET", "/audit")).json.entries.map((e: { text: string }) => e.text).join("\n");
    assert.match(log, /Doomed: deletion step "screen" failed \(screen broke\); carried on/);
  } finally { retireSteps.forEach((s, i) => { s.run = saved[i]; }); }
  // Through the API: the same steps, then the roster.
  const other = (await call("POST", "/bots", { name: "Gone too" })).json.bot as Bot;
  assert.equal((await call("DELETE", `/bots/${other.id}`)).status, 200);
  assert.equal(bots.byId(other.id), null);
  void owner;
});

// ── Screen setup (U-005) ─────────────────────────────────────────────────────
test("U-005: a screen is set up once per server run, shared by concurrent callers; a failure is forgotten for a retry", async () => {
  let calls = 0, fail = false;
  setDressRunner(async () => { calls++; await sleep(80); return fail ? { code: 1, stderr: "boom" } : { code: 0, stderr: "" }; });
  setLookOverride("bot_share", { name: "Share", label: "", color: "teal", locale: "en", owner: "" });
  try {
    await Promise.all([ensureDressed("bot_share"), ensureDressed("bot_share"), ensureDressed("bot_share")]);
    assert.equal(calls, 1, "three callers, one setup");
    await ensureDressed("bot_share");
    assert.equal(calls, 1, "remembered for this server run");
    // A new look (rename, colour) is applied again.
    setLookOverride("bot_share", { name: "Shared", label: "", color: "teal", locale: "en", owner: "" });
    fail = true;
    await assert.rejects(Promise.all([ensureDressed("bot_share"), ensureDressed("bot_share")]), /boom/);
    assert.equal(calls, 2, "the failed attempt was shared too");
    fail = false;
    await ensureDressed("bot_share");
    assert.equal(calls, 3, "the failure was forgotten: the next request tried again");
    // A rename of a bot without a computer dresses nothing.
    await linuxScreen.redress("bot_share");
    await linuxScreen.redress("bot_without_screen");
    assert.equal(calls, 3);
  } finally { setLookOverride("bot_share", null); setDressRunner(null); }
});
