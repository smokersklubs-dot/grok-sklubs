import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L143 (routine floor: at most one run every 15 minutes, no cap on the number of routines on a self-hosted server) and
// L99 (parallel batches: up to 20 tasks, at most 3 at a time per bot, one card, one summary, Stop, costs counted).
// A scripted model plays the bot and its workers; nothing outside this machine is called.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pace-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS", "BOT_PARALLEL_TASKS", "HOSTED"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { routines } = await import("../src/routines.js");
const { cronMinGapMinutes, belowFloor, nextFlooredRun, tooSoon, watchEvery, ROUTINE_FLOOR_MIN } = await import("../src/routinefloor.js");
const { startBatch, freeSlots, BatchError, MAX_BATCH_ITEMS } = await import("../src/agent/batches.js");
const { bgTasks } = await import("../src/agent/bgtasks.js");
const { bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { BatchCard, Bot, Row } from "../src/shared.js";

/** Workers of a batch wait this long (or until stopped); `hold` keeps them working until released. */
let workerDelay = 120;
let running = 0, maxRunning = 0;
const workerTexts: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const results = last.content.filter((b) => b.type === "tool_result");
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    let content: Block[];
    if (/of a batch .* runs in parallel/.test(said)) {
      workerTexts.push(said);
      running++; maxRunning = Math.max(maxRunning, running);
      try {
        await new Promise<void>((resolve) => { const t = setTimeout(resolve, workerDelay); req.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }, { once: true }); });
      } finally { running--; }
      content = [{ type: "text", text: `Report for: ${said.split("\n")[0]}` }];
    } else if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : ""}` }];
    } else {
      const m = /call (\w+) (\{.*\})/s.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${Math.random().toString(36).slice(2)}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said.slice(0, 2000)}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 1200): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const batchCard = async (botId: string, id: string): Promise<BatchCard | null> => {
  for (const r of await rowsOf(botId)) if (r.body.kind === "card" && r.body.card.type === "batch" && r.body.card.batchId === id) return r.body.card;
  return null;
};
const idle = (botId: string) => until(async () => !(await call("GET", "/bots")).json.live[botId]?.running, "idle");

let bot: Bot;
test("setup", async () => {
  await call("POST", "/auth/signup", { email: "pace@example.com", password: "password-1", locale: "fr" });
  bot = (await call("POST", "/bots", { name: "Pace" })).json.bot;
  assert.ok(bot?.id);
});

// ── L143 ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("L143: the shortest gap of a schedule, and which ones are under the 15-minute floor", () => {
  assert.equal(ROUTINE_FLOOR_MIN, 15);
  assert.equal(cronMinGapMinutes("* * * * *"), 1);
  assert.equal(cronMinGapMinutes("*/10 * * * *"), 10);
  assert.equal(cronMinGapMinutes("*/15 * * * *"), 15);
  assert.equal(cronMinGapMinutes("0,5 9 * * *"), 5);
  assert.equal(cronMinGapMinutes("0 9 * * 1-5"), 1440);
  assert.equal(cronMinGapMinutes("0 */2 * * *"), 120);
  assert.equal(cronMinGapMinutes("0,50 0,23 * * *"), 10, "from 23:50 to 0:00 the next day");
  assert.equal(belowFloor("*/5 * * * *"), true);
  assert.equal(belowFloor("*/15 * * * *"), false);
  assert.equal(belowFloor("not a schedule"), false, "an unreadable schedule is refused elsewhere");
  assert.equal(watchEvery(5), 15);
  assert.equal(watchEvery(60), 60);
});

test("L143: the bot cannot create a routine more frequent than every 15 minutes; a watch is raised to 15", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: 'call routine_create {"name":"Spam","prompt":"Check.","kind":"cron","schedule":"*/5 * * * *","timezone":"Europe/Paris"}' });
  await idle(bot.id);
  let list = await rowsOf(bot.id);
  const said = [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant");
  assert.match(said?.body.kind === "message" ? said.body.text : "", /Too frequent: a routine runs at most once every 15 minutes, and this schedule would run every 5 minutes/);
  assert.equal(routines.forBot(bot.id).length, 0, "nothing was created");
  await call("POST", `/bots/${bot.id}/messages`, { text: 'call routine_create {"name":"Quart","prompt":"Check.","kind":"cron","schedule":"*/15 * * * *","timezone":"Europe/Paris"}' });
  await idle(bot.id);
  assert.equal(routines.forBot(bot.id).length, 1, "every 15 minutes is allowed");
  await call("POST", `/bots/${bot.id}/messages`, { text: 'call routine_create {"name":"Page","prompt":"Look.","kind":"watch","watch_url":"https://example.com/","every_minutes":5}' });
  await idle(bot.id);
  const watch = routines.forBot(bot.id).find((r) => r.trigger === "watch")!;
  assert.equal(watch.watch?.everyMin, 15);
  list = await rowsOf(bot.id);
  const note = [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant");
  assert.match(note?.body.kind === "message" ? note.body.text : "", /Checks were set to every 15 minutes, the minimum/);
});

test("L143: an existing frequent routine is kept, slowed to 15 minutes and labelled; editing its schedule below the floor is refused in French", async () => {
  const old = routines.create(bot.id, { name: "Ancienne", prompt: "Old.", trigger: "cron", schedule: "*/5 * * * *", timezone: "UTC" });
  const view = (await call("GET", `/bots/${bot.id}/routines`)).json.routines.find((r: any) => r.id === old.id);
  assert.ok(view, "kept, never deleted");
  assert.match(view.describe, /au plus toutes les 15 minutes$/);
  // The scheduler leaves at least 15 minutes after the last scheduled run.
  const slot = Math.floor(Date.now() / 60_000) * 60_000;
  q.run("UPDATE routines SET last_slot = ?, last_run_at = ? WHERE id = ?", String(slot), slot, old.id);
  const next = nextFlooredRun(routines.byId(old.id)!, slot);
  assert.ok(next !== null && next - slot >= 15 * 60_000 && next - slot < 20 * 60_000, `next run ${next && (next - slot) / 60_000} min later`);
  assert.equal(tooSoon(routines.byId(old.id)!, slot + 5 * 60_000), true);
  assert.equal(tooSoon(routines.byId(old.id)!, slot + 15 * 60_000), false);
  assert.equal(tooSoon(routines.byId(old.id)!, slot), false, "the same slot again is the slot claim's business (\"claimed\")");
  // A rename still works on the old routine (its schedule is not touched).
  assert.equal((await call("PUT", `/routines/${old.id}`, { name: "Ancienne 2" })).status, 200);
  const refused = await call("PUT", `/routines/${old.id}`, { schedule: "*/2 * * * *" });
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /^Une routine tourne au plus une fois toutes les 15 minutes/);
  assert.equal((await call("PUT", `/routines/${old.id}`, { schedule: "*/20 * * * *" })).status, 200);
  assert.doesNotMatch((await call("GET", `/bots/${bot.id}/routines`)).json.routines.find((r: any) => r.id === old.id).describe, /au plus/);
});

test("L143: no cap on the number of routines on a self-hosted server", () => {
  for (let i = 0; i < 25; i++) routines.create(bot.id, { name: `R${i}`, prompt: `Task ${i}.`, trigger: "cron", schedule: `${i} 8 * * *`, timezone: "UTC" });
  assert.ok(routines.forBot(bot.id).filter((r) => r.enabled).length >= 25);
});

// ── L99 ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("L99: a batch runs at most 3 at a time, shows on one card, and ends with ONE summary", async () => {
  maxRunning = 0;
  workerDelay = 150;
  const items = Array.from({ length: 7 }, (_, i) => ({ title: `Concurrent ${i + 1}`, goal: `Search for competitor number ${i + 1}.` }));
  await call("POST", `/bots/${bot.id}/messages`, { text: `call batch_start ${JSON.stringify({ title: "Concurrents", items, context: "Prices in euros." })}` });
  const id = await until(() => q.get<{ id: string }>("SELECT id FROM batches WHERE bot_id = ?", bot.id)?.id, "the batch");
  const first = await until(() => batchCard(bot.id, id), "the card");
  assert.equal(first.items.length, 7);
  assert.equal(first.parallel, 3);
  const done = await until(async () => { const c = await batchCard(bot.id, id); return c?.state === "done" && c; }, "the batch done");
  assert.ok(done.items.every((i) => i.state === "done" && i.result?.startsWith("Report for:")), JSON.stringify(done.items.map((i) => i.state)));
  assert.equal(maxRunning, 3, "never more than 3 at once, and really in parallel");
  assert.ok(workerTexts.some((t) => t.includes("Context for the whole batch:\nPrices in euros.")), "the shared context reaches each task");
  assert.equal(bgTasks.forBot(bot.id).length, 0, "the batch's tasks stay off the task list");
  // One summary request reaches the bot, with every report.
  const summary = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes('Your batch "Concurrents" is finished: 7 of 7 tasks done')), "the summary turn");
  assert.ok(summary);
  const cost = await call("GET", `/bots/${bot.id}/batches/${id}`);
  assert.equal(cost.status, 200);
  assert.ok(cost.json.turns >= 7, `turns counted: ${cost.json.turns}`);
  assert.equal(typeof cost.json.costUsd, "number");
  await idle(bot.id);
});

test("L99: Stop cancels the tasks not started and stops the ones at work; no summary after a stop", async () => {
  workerDelay = 60_000;
  const parent = bots.byId(bot.id)!;
  const b = startBatch(parent, "Long", Array.from({ length: 6 }, (_, i) => ({ title: `L${i}`, goal: `Long task ${i}.` })), { depth: 0 });
  await until(() => running === 3, "3 at work");
  const before = (await rowsOf(bot.id)).length;
  const stopped = await call("POST", `/bots/${bot.id}/batches/${b.id}/stop`);
  assert.equal(stopped.status, 200);
  const card = await until(async () => { const c = await batchCard(bot.id, b.id); return c?.state === "stopped" && c.items.every((i) => i.state === "stopped") && c; }, "all stopped");
  assert.equal(card.items.length, 6);
  await until(() => running === 0, "workers stopped");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM batch_items WHERE batch_id = ? AND task_id IS NOT NULL", b.id)!.n, 3, "the 3 queued never started");
  assert.ok(!(await rowsOf(bot.id)).slice(before).some((r) => r.body.kind === "message" && r.body.role === "assistant" && /Your batch "Long"/.test(r.body.text)), "no summary");
  workerDelay = 150;
});

test("L99: limits — 2 to 20 tasks, one batch at a time, never from a helper; a subscription bot runs one at a time", async () => {
  const parent = bots.byId(bot.id)!;
  assert.throws(() => startBatch(parent, "One", [{ title: "a", goal: "x" }], { depth: 0 }), BatchError);
  assert.throws(() => startBatch(parent, "Many", Array.from({ length: MAX_BATCH_ITEMS + 1 }, (_, i) => ({ title: `t${i}`, goal: "x" })), { depth: 0 }), BatchError);
  workerDelay = 60_000;
  const b = startBatch(parent, "Busy", [{ title: "a", goal: "x" }, { title: "b", goal: "y" }], { depth: 0 });
  assert.throws(() => startBatch(parent, "Second", [{ title: "a", goal: "x" }, { title: "b", goal: "y" }], { depth: 0 }), /still under way/);
  // « Tout arrêter » on the bot stops its batch too, even before the workers' first turn began.
  assert.equal((await call("POST", `/bots/${bot.id}/stop-all`)).status, 200);
  assert.equal(q.get<{ state: string }>("SELECT state FROM batches WHERE id = ?", b.id)?.state, "stopped");
  await new Promise((r) => setTimeout(r, 400));
  await until(() => running === 0, "workers stopped");
  workerDelay = 150;
  const helper = bots.byId(bgTasks.byId(q.get<{ t: string }>("SELECT task_id AS t FROM batch_items WHERE batch_id = ? AND task_id IS NOT NULL", b.id)!.t)!.helperId!)!;
  assert.throws(() => startBatch(helper, "Nested", [{ title: "a", goal: "x" }, { title: "b", goal: "y" }], { depth: 1 }), /cannot start a batch/);
  // A bot on a subscription tool has one lane: its batch runs one task at a time.
  const sub = (await call("POST", "/bots", { name: "Abo" })).json.bot as Bot;
  q.run("UPDATE bots SET model = 'claude-code:default' WHERE id = ?", sub.id);
  assert.equal(freeSlots(sub.id), 1);
  // Another user's batch is not reachable.
  const other = await call("GET", `/bots/${bot.id}/batches/bat_nope`);
  assert.equal(other.status, 404);
});
