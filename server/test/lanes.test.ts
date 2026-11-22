import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L99 — « jusqu'à 3 tâches en même temps par bot » (décision du propriétaire, 22/11/2026) : agent/lanes.ts,
// agent/lanemap.ts, agent/turnlocks.ts. Un modèle scénarisé tient un tour ouvert (« hold K ») jusqu'à ce que le test le
// libère, pour voir plusieurs tâches tourner en même temps.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-lanes-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;
delete process.env.BOT_PARALLEL_TASKS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const lanes = await import("../src/agent/lanes.js");
const locks = await import("../src/agent/turnlocks.js");
const { LaneMap } = await import("../src/agent/lanemap.js");
const { activeTurns, botQueue, bots, laneKey, paused, policies, rowScope, rows } = await import("../src/store.js");
const { getLive } = await import("../src/bus.js");
const { q } = await import("../src/db.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const memories = (id: string) => q.all<{ text: string }>("SELECT text FROM memories WHERE bot_id = ?", id).map((m) => m.text);

// ── Scripted model ──────────────────────────────────────────────────────────────────────────────────────────────
const gates = new Map<string, () => void>();
const gate = (k: string) => new Promise<void>((resolve) => gates.set(k, resolve));
const release = (k: string) => { const f = gates.get(k); gates.delete(k); f?.(); };
const started = new Set<string>();
let calls = 0;
const textOf = (b: Block[]) => b.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    calls++;
    const users = req.messages.filter((m) => m.role === "user");
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result") as { content: Block[] }[];
    // The command is in the last user message that has words (a tool result message has none).
    const said = [...users].reverse().map((m) => textOf(m.content)).find((t) => t.trim()) ?? "";
    const cmd = said.split("\n").filter((l) => !l.startsWith("[")).join("\n").trim();
    const hold = /hold (\w+)/.exec(cmd)?.[1];
    const wait = async () => {
      if (!hold) return;
      started.add(hold);
      await Promise.race([gate(hold), new Promise<void>((_, reject) => { if (req.signal?.aborted) reject(new Error("aborted")); req.signal?.addEventListener("abort", () => reject(new Error("aborted")), { once: true }); })]);
    };
    let content: Block[];
    if (results.length) {
      await wait();
      content = [{ type: "text", text: `Result: ${textOf(results[0].content)}` }];
    } else if (/^save (\S+)/m.test(cmd)) content = [{ type: "tool_use", id: `c${calls}`, name: "file_save", input: { filename: /^save (\S+)/m.exec(cmd)![1], content: "x" } }];
    else if (/^remember (.+)/m.test(cmd)) content = [{ type: "tool_use", id: `c${calls}`, name: "memory_save", input: { text: /^remember (.+)/m.exec(cmd)![1] } }];
    else { await wait(); content = [{ type: "text", text: `Echo: ${cmd}` }]; }
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: req.model, usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } };
  },
};
registerProvider(scripted);

let jar = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 500): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const allRows = (id: string) => q.all<{ seq: number; thread: number; body: string }>("SELECT seq, thread, body FROM rows WHERE bot_id = ? ORDER BY seq", id).map((r) => ({ seq: r.seq, thread: r.thread, body: JSON.parse(r.body) as Row["body"] }));
const replies = (id: string, thread?: number) => allRows(id).filter((r) => (thread === undefined || r.thread === thread) && r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).map((r) => (r.body as { text: string }).text);
const say = (id: string, text: string, thread?: number) => call("POST", `/bots/${id}/messages`, { text, ...(thread ? { thread } : {}) });
const fresh = async (name: string): Promise<Bot> => (await call("POST", "/bots", { name })).json.bot;
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const routine = (botId: string, name: string, text: string) => loop.enqueue(botId, { kind: "routine", name, text });
/** The thread a routine named `name` runs in (its message in the main chat). */
const routineThread = (botId: string, name: string) => allRows(botId).find((r) => r.body.kind === "message" && r.body.origin?.kind === "routine" && r.body.origin.name === name)?.seq;

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "lanes@example.com", password: "password-1", locale: "fr" })).status, 200);
});

test("a bot runs up to 3 tasks: 1 by default for a subscription bot or BOT_PARALLEL_TASKS=1", async () => {
  const bot = await fresh("Cap");
  assert.equal(lanes.laneCap(bot.id), 3);
  process.env.BOT_PARALLEL_TASKS = "1"; assert.equal(lanes.laneCap(bot.id), 1);
  process.env.BOT_PARALLEL_TASKS = "9"; assert.equal(lanes.laneCap(bot.id), 3, "never more than 3");
  delete process.env.BOT_PARALLEL_TASKS;
  q.run("UPDATE bots SET model = 'claude-code:sonnet' WHERE id = ?", bot.id);
  assert.equal(lanes.laneCap(bot.id), 1, "a subscription tool keeps one session per bot");
});

test("the owner's message is answered while a routine runs", async () => {
  const bot = await fresh("Ada");
  routine(bot.id, "Veille", "hold R1");
  await until(() => started.has("R1"), "routine started");
  await say(bot.id, "bonjour");
  await until(() => replies(bot.id, 0).includes("Echo: bonjour"), "owner answered during the routine");
  assert.ok(gates.has("R1"), "the routine is still running");
  assert.equal(getLive(bot.id).tasks?.length, undefined, "only one task left running after the owner's reply");
  release("R1");
  await idle(bot.id);
  const t = routineThread(bot.id, "Veille")!;
  assert.ok(replies(bot.id, t).some((x) => x.startsWith("Echo:") && x.includes("hold R1")), `the routine answered in its own thread: ${JSON.stringify(allRows(bot.id).map((r) => [r.seq, r.thread, r.body.kind, (r.body as any).text]))}`);
});

test("a 4th task waits for a free slot; the owner's chat never does", async () => {
  const bot = await fresh("Bea");
  routine(bot.id, "Un", "hold A");
  routine(bot.id, "Deux", "hold B");
  await until(() => started.has("A") && started.has("B"), "two background tasks");
  routine(bot.id, "Trois", "hold C");
  await say(bot.id, "hold M");
  await until(() => started.has("M"), "the owner's chat runs as the 3rd task");
  await until(() => getLive(bot.id).tasks?.length === 3, "3 tasks in the live state");
  await sleep(150);
  assert.ok(!started.has("C"), "the 4th task waits");
  assert.equal(loop.queuedBehind(bot.id), 1);
  release("A");
  await until(() => started.has("C"), "the 4th starts when one ends");
  for (const k of ["B", "C", "M"]) release(k);
  await idle(bot.id);
});

test("Stop in one lane leaves the others; stop without a thread stops all", async () => {
  const bot = await fresh("Cleo");
  routine(bot.id, "Longue", "hold S1");
  await say(bot.id, "hold S2");
  await until(() => started.has("S1") && started.has("S2"), "two tasks");
  const t = routineThread(bot.id, "Longue")!;
  assert.deepEqual(loop.runningThreads(bot.id).sort(), [0, t].sort());
  assert.equal((await call("POST", `/bots/${bot.id}/stop`, { thread: t })).status, 200);
  await until(() => loop.runningThreads(bot.id).length === 1, "the routine stopped");
  assert.deepEqual(loop.runningThreads(bot.id), [0], "the owner's chat still runs");
  assert.ok(allRows(bot.id).some((r) => r.thread === t && r.body.kind === "notice" && /Arrêté/.test((r.body as { text: string }).text)), "« Arrêté » in the routine's thread");
  await call("POST", `/bots/${bot.id}/stop`, {});
  await idle(bot.id);
  assert.deepEqual(loop.runningThreads(bot.id), []);
  gates.clear();
});

test("screen lock: one lane drives the screen; another waits, then is refused; free again when the first ends", async () => {
  const id = "bot_screenlock";
  locks.setLockWait(120);
  assert.equal(await locks.acquire(id, 0, "screen_click", { x: 1, y: 1 }), null, "main chat takes the screen");
  assert.equal(await locks.acquire(id, 0, "screen_type", { text: "a" }), null, "same lane: it keeps it");
  assert.equal(await locks.acquire(id, 7, "web_fetch", { url: "https://example.com" }), null, "no screen needed: runs at once");
  let waited = "";
  const t0 = Date.now();
  const refused = await locks.acquire(id, 7, "page_read", {}, { onWait: (r) => { waited = r; } });
  assert.equal(waited, "screen", "the waiting state names the screen");
  assert.ok(Date.now() - t0 >= 100, "it waited first");
  assert.match(refused!, /Another task of yours .* using your screen and browser/);
  // The holder ends: the other lane gets it while it waits.
  setTimeout(() => locks.releaseLane(id, 0), 40);
  assert.equal(await locks.acquire(id, 7, "screen_view", {}), null);
  assert.deepEqual(locks.heldBy(id), [{ resource: "screen", lane: laneKey(id, 7) }]);
  locks.releaseLane(id, 7);
  locks.setLockWait(60_000);
});

test("file lock: two tasks cannot write the same file; another file is fine", async () => {
  const bot = await fresh("Dora");
  locks.setLockWait(150);
  routine(bot.id, "Rapport", "save rapport.md then hold F1");
  await until(() => started.has("F1"), "the routine wrote and holds the file");
  await say(bot.id, "save rapport.md");
  await until(() => replies(bot.id, 0).some((t) => t.startsWith("Result:")), "owner's save answered");
  assert.match(replies(bot.id, 0).find((t) => t.startsWith("Result:"))!, /Another task of yours .*"rapport.md"/);
  await say(bot.id, "save autre.md");
  await until(() => replies(bot.id, 0).filter((t) => t.startsWith("Result:")).length === 2, "second save answered");
  assert.doesNotMatch(replies(bot.id, 0).filter((t) => t.startsWith("Result:"))[1], /Another task/);
  release("F1");
  await idle(bot.id);
  assert.deepEqual(locks.heldBy(bot.id), [], "everything let go at the end of the turns");
  locks.setLockWait(60_000);
});

test("approvals in two lanes: each waits on its own card; answering one resumes only its lane", async () => {
  const bot = await fresh("Eva");
  const owner = bots.byId(bot.id)!.userId;
  policies.set(owner, "memory_save", "needs_approval");
  const parent = rows.append(bots.byId(bot.id)!, { kind: "message", role: "assistant", text: "Un sujet à part." });
  await say(bot.id, "remember Chat Pixel");
  await say(bot.id, "remember Chien Rex", parent.seq);
  await until(() => paused.lanes(bot.id).length === 2, "two lanes wait on an approval");
  const cards = allRows(bot.id).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending" ? [{ thread: r.thread, id: r.body.card.approvalId }] : []));
  assert.deepEqual(cards.map((c) => c.thread).sort(), [0, parent.seq].sort(), "one card in the main chat, one in the thread");
  // A new message in the main chat waits for the main chat's card only: the thread's card does not hold it.
  const side = cards.find((c) => c.thread === parent.seq)!;
  assert.equal((await call("POST", `/approvals/${side.id}`, { decision: "allow" })).status, 200);
  await until(() => memories(bot.id).includes("Chien Rex"), "the thread's action ran");
  await until(() => paused.lanes(bot.id).length === 1, "the main chat still waits");
  assert.ok(!memories(bot.id).includes("Chat Pixel"));
  const main = cards.find((c) => c.thread === 0)!;
  await call("POST", `/approvals/${main.id}`, { decision: "allow" });
  await until(() => memories(bot.id).includes("Chat Pixel"), "the main chat's action ran");
  await idle(bot.id);
  assert.equal(paused.lanes(bot.id).length, 0);
  policies.remove(owner, "memory_save");
});

test("restart with two lanes running: each is picked back up in its own thread", async () => {
  const bot = await fresh("Fred");
  const parent = rows.append(bots.byId(bot.id)!, { kind: "message", role: "user", text: "Fil à part." });
  const a = botQueue.add(bot.id, { kind: "user", text: "travail principal" })!;
  const b = botQueue.add(bot.id, { kind: "user", text: "travail du fil", thread: parent.seq })!;
  botQueue.start(a); botQueue.start(b);
  activeTurns.begin(bot.id);
  activeTurns.begin(laneKey(bot.id, parent.seq));
  assert.equal(activeTurns.leftover().filter((m) => m.bot_id.startsWith(bot.id)).length, 2);
  loop.recoverInterruptedTurns();
  await until(() => botQueue.status(a) === "done" && botQueue.status(b) === "done", "both recovered");
  await idle(bot.id);
  assert.ok(replies(bot.id, 0).some((t) => t.includes("travail principal")), "main chat work done in the main chat");
  assert.ok(replies(bot.id, parent.seq).some((t) => t.includes("travail du fil")), "thread work done in its thread");
  const restarted = allRows(bot.id).filter((r) => r.body.kind === "notice" && /redémarré/.test((r.body as { text: string }).text)).map((r) => r.thread);
  assert.deepEqual(restarted.sort(), [0, parent.seq].sort(), "one notice in each lane");
  assert.equal(activeTurns.leftover().filter((m) => m.bot_id.startsWith(bot.id)).length, 0);
});

test("isolation: each lane sees only its own state; the live state lists the tasks; usage counts every lane", async () => {
  const m = new LaneMap<string>();
  m.set("bot_x", "main");
  rowScope.run({ botId: "bot_x", thread: 5 }, () => {
    assert.equal(m.get("bot_x"), undefined, "a turn in thread 5 does not see the main chat's entry");
    m.set("bot_x", "five");
    assert.equal(m.get(laneKey("bot_x", 0)), "main", "an explicit key reaches the main chat");
  });
  assert.equal(m.get("bot_x"), "main");
  assert.deepEqual(m.lanesOf("bot_x").map(([, t, v]) => [t, v]).sort(), [[0, "main"], [5, "five"]]);

  const bot = await fresh("Gil");
  const usage = () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage WHERE bot_id = ?", bot.id)?.n ?? 0;
  const before = usage();
  routine(bot.id, "Iso", "hold I1");
  await say(bot.id, "hold I2");
  await until(() => started.has("I1") && started.has("I2"), "two tasks");
  const live = await until(() => getLive(bot.id).tasks, "tasks in the live state");
  assert.equal(live[0].thread, 0, "the main chat first");
  assert.equal(live.length, 2);
  // Each turn's live state is its own: the routine's lane does not overwrite the bot's front (main chat) state.
  assert.equal(getLive(bot.id).thread ?? 0, 0);
  release("I1"); release("I2");
  await idle(bot.id);
  assert.equal(getLive(bot.id).tasks, undefined);
  assert.ok(usage() - before >= 2, "both lanes' model calls are counted");
});
