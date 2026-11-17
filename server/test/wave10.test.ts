import assert from "node:assert/strict";
import http from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Wave 10: goal mode (agent/goals.ts) for API turns and subscription (engine) turns, parallel read-only tools
// (loop.ts runParallel), and the goal / jobs routes.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w10-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.GOAL_MAX_ROUNDS = "3";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost, engineTurnOf } = await import("../src/agent/engine.js");
const { execute } = await import("../src/agent/loop.js");
const { goals, goalCommand, goalRoundPrompt } = await import("../src/agent/goals.js");
const { bots, policies, botQueue } = await import("../src/store.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

// ── A scripted model: what it does is decided per test ──────────────────────
type Plan = (req: TurnRequest, lastText: string, afterTool: boolean) => Block[];
let plan: Plan = () => [{ type: "text", text: "ok" }];
const seen: TurnRequest[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    const last = req.messages[req.messages.length - 1];
    const afterTool = last.content.some((b) => b.type === "tool_result");
    const lastText = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const content = plan(req, lastText, afterTool);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 }, model: req.model };
  },
};
registerProvider(scripted);
let n = 0;
const use = (name: string, input: Record<string, unknown>): Block => ({ type: "tool_use", id: `c${++n}`, name, input });

// ── Helpers ──────────────────────────────────────────────────────────────────
let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 800): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const goalCards = async (botId: string) => (await rowsOf(botId)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "goal" ? [r.body.card] : []));
const queueEmpty = (botId: string) => !botQueue.unfinished().some((r) => r.bot_id === botId);
const settle = async (botId: string) => {
  await until(async () => queueEmpty(botId) && !(await call("GET", "/bots")).json.live[botId]?.running, "the bot to settle");
  await new Promise((r) => setTimeout(r, 60));
  await until(async () => queueEmpty(botId) && !(await call("GET", "/bots")).json.live[botId]?.running, "the bot to settle (again)");
};

/** A plan that reports progress on every round and completes the goal on round `doneAt`. */
const roundsPlan = (doneAt: number): Plan => (_req, text, afterTool) => {
  if (afterTool) return [{ type: "text", text: "Round done." }];
  const m = /Round: (\d+)\/|round (\d+)\/\d+/.exec(text);
  const round = m ? Number(m[1] ?? m[2]) : 0;
  if (round >= doneAt) return [use("goal_update", { status: "complete", summary: "All pages checked.", evidence: "Ran the checker: 12/12 pages answer 200." })];
  return [use("goal_update", { status: "active", summary: `Round ${round} done.` })];
};

let bot: Bot;
let userId = "";
after(() => { setEngineHost(null); });

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "w10@example.com", password: "password-1", locale: "fr" })).status, 200);
  bot = (await call("POST", "/bots", { name: "Dix" })).json.bot;
  userId = bots.byId(bot.id)!.userId;
});

test("goal commands and the round prompt", () => {
  assert.equal(goalCommand("/objectif Vérifie toutes les pages"), "Vérifie toutes les pages");
  assert.equal(goalCommand("/goal  fix it\nand more"), "fix it\nand more");
  assert.equal(goalCommand("/objectif"), "");
  assert.equal(goalCommand("objectif: x"), null);
  const p = goalRoundPrompt({ objective: "Ship it", maxRounds: 20 }, 4);
  assert.match(p, /<goal_round>/);
  assert.match(p, /Round: 4\/20/);
  assert.match(p, /evidence/);
});

test("/objectif with nothing after it is refused before anything is written", async () => {
  const before = (await rowsOf(bot.id)).length;
  assert.equal((await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif   " })).status, 400);
  assert.equal((await rowsOf(bot.id)).length, before);
});

test("an API bot keeps working round after round until it marks the goal complete with evidence", async () => {
  plan = roundsPlan(3);
  seen.length = 0;
  const r = await call("POST", `/bots/${bot.id}/messages`, { text: "Vérifie que les 12 pages du site répondent", goal: true });
  assert.equal(r.status, 200);
  await settle(bot.id);
  const [card] = await goalCards(bot.id);
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 3);
  assert.equal(card.maxRounds, 3);
  assert.match(card.evidence ?? "", /12\/12/);
  // Round 1 is the user's own message, with the goal note; rounds 2 and 3 are the continuation prompt.
  const firsts = seen.filter((s) => !s.messages[s.messages.length - 1].content.some((b) => b.type === "tool_result"));
  assert.equal(firsts.length, 3);
  assert.match(JSON.stringify(firsts[0].messages[firsts[0].messages.length - 1]), /Goal mode is on/);
  assert.match(JSON.stringify(firsts[1].messages[firsts[1].messages.length - 1]), /<goal_round>[\s\S]*Round: 2\/3/);
  // goal_update is offered to the model.
  assert.ok(seen[0].tools.some((t) => t.name === "goal_update"));
});

test("evidence is required to mark a goal complete", async () => {
  plan = (_req, _text, afterTool) => (afterTool ? [{ type: "text", text: "ok" }] : [use("goal_update", { status: "complete", summary: "done" })]);
  await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif Range le dossier" });
  await until(async () => (await goalCards(bot.id)).some((c) => c.objective === "Range le dossier" && c.rounds >= 1), "first round");
  // Without evidence it stays active; stop it by hand.
  const card = (await goalCards(bot.id)).find((c) => c.objective === "Range le dossier")!;
  assert.notEqual(card.status, "complete");
  const stop = await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "stop" });
  assert.equal(stop.status, 200);
  await settle(bot.id);
  assert.equal((await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!.status, "stopped");
});

test("a goal stops at its round cap; Resume gives it more rounds", async () => {
  plan = roundsPlan(99);
  await call("POST", `/bots/${bot.id}/messages`, { text: "Traduis tout le site", goal: true });
  await settle(bot.id);
  let card = (await goalCards(bot.id)).find((c) => c.objective === "Traduis tout le site")!;
  assert.equal(card.status, "limit");
  assert.equal(card.rounds, 3);
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "resume" })).status, 200);
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "limit");
  assert.equal(card.rounds, 6);
  assert.equal(card.maxRounds, 6);
  // Answered: resuming a stopped goal is refused.
  await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "stop" });
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "resume" })).status, 409);
});

test("a goal waits on an approval: no new round starts until the user answers", async () => {
  policies.set(userId, "memory_save", "needs_approval");
  let saved = 0;
  plan = (_req, text, afterTool) => {
    if (afterTool) return [{ type: "text", text: "noted" }];
    const round = Number(/Round: (\d+)\//.exec(text)?.[1] ?? 1);
    if (round === 1 && !saved++) return [use("memory_save", { text: "The user's site has 12 pages.", user_quote: "Mémorise" })];
    return [use("goal_update", { status: "complete", summary: "Saved.", evidence: "memory saved and checked" })];
  };
  await call("POST", `/bots/${bot.id}/messages`, { text: "Mémorise les infos du site", goal: true });
  const approval = await until(async () => (await rowsOf(bot.id)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending" ? [r.body.card] : []))[0], "approval card");
  await new Promise((r) => setTimeout(r, 200));
  let card = (await goalCards(bot.id)).find((c) => c.objective === "Mémorise les infos du site")!;
  assert.equal(card.status, "active");
  assert.equal(card.rounds, 1, "no round while the approval waits");
  assert.equal(card.waiting, "approval");
  assert.equal((await call("POST", `/approvals/${approval.approvalId}`, { decision: "allow" })).status, 200);
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 2);
  policies.remove(userId, "memory_save");
});

test("a goal waits for the user's answer to a question, and pause / resume work", async () => {
  let asked = 0;
  plan = (_req, text, afterTool) => {
    if (afterTool) return [{ type: "text", text: "…" }];
    if (!asked++) return [use("ask_user", { question: "Quelle langue ?", options: ["fr", "en"] })];
    return roundsPlan(3)(_req, text, afterTool);
  };
  await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif Écris la doc" });
  await settle(bot.id);
  let card = (await goalCards(bot.id)).find((c) => c.objective === "Écris la doc")!;
  assert.equal(card.rounds, 1);
  assert.equal(card.waiting, "user");
  // The answer is a turn in the same conversation (round 2); then the goal goes on by itself to round 3.
  await call("POST", `/bots/${bot.id}/messages`, { text: "anglais" });
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 3);

  // Pause: an answer in the conversation runs as a plain turn, and no round starts on its own.
  asked = 0;
  await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif Relis la doc" });
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.objective === "Relis la doc")!;
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "pause" })).status, 200);
  await call("POST", `/bots/${bot.id}/messages`, { text: "anglais" });
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "paused");
  assert.equal(card.rounds, 1, "a paused goal runs no round");
  plan = roundsPlan(1);
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "resume" })).status, 200);
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 2);
});

test("the bot can propose a goal; nothing runs until the user accepts it", async () => {
  let proposed = false;
  plan = (_req, text, afterTool) => {
    if (afterTool) return [{ type: "text", text: "Je te propose un objectif." }];
    if (!proposed) { proposed = true; return [use("goal_propose", { objective: "Migrer les 40 articles du blog", max_rounds: 2 })]; }
    return roundsPlan(2)(_req, text, afterTool);
  };
  await call("POST", `/bots/${bot.id}/messages`, { text: "Peux-tu migrer le blog ?" });
  await settle(bot.id);
  let card = (await goalCards(bot.id)).find((c) => c.objective === "Migrer les 40 articles du blog")!;
  assert.equal(card.status, "proposed");
  assert.equal(card.rounds, 0);
  assert.equal(card.maxRounds, 2);
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "accept" })).status, 200);
  await settle(bot.id);
  card = (await goalCards(bot.id)).find((c) => c.goalId === card.goalId)!;
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 2);
  assert.equal((await call("POST", `/bots/${bot.id}/goals/${card.goalId}`, { action: "accept" })).status, 409);
});

test("one open goal per conversation: a new one replaces the old", async () => {
  plan = (_req, _t, afterTool) => (afterTool ? [{ type: "text", text: "ok" }] : [use("ask_user", { question: "?", options: ["a"] })]);
  await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif Premier" });
  await settle(bot.id);
  await call("POST", `/bots/${bot.id}/messages`, { text: "/objectif Second" });
  await settle(bot.id);
  const cards = await goalCards(bot.id);
  assert.equal(cards.find((c) => c.objective === "Premier")!.status, "stopped");
  assert.equal(cards.find((c) => c.objective === "Second")!.status, "active");
  await call("POST", `/bots/${bot.id}/goals/${cards.find((c) => c.objective === "Second")!.goalId}`, { action: "stop" });
  assert.equal(goals.openFor(bot.id, 0), null);
});

// ── Parallel read-only tools ─────────────────────────────────────────────────
let inFlight = 0, maxInFlight = 0;
const slow = http.createServer((req, res) => {
  inFlight++; maxInFlight = Math.max(maxInFlight, inFlight);
  setTimeout(() => { inFlight--; res.writeHead(200, { "content-type": "text/plain" }).end(`page ${req.url}`); }, 300);
});
await new Promise<void>((r) => slow.listen(0, "127.0.0.1", () => r()));
const PORT = (slow.address() as { port: number }).port;
after(() => slow.close());

test("consecutive read-only calls run side by side; results keep the model's order; others stay a barrier", async () => {
  const url = (p: string) => `http://127.0.0.1:${PORT}/${p}`;
  let results: Block[] = [];
  plan = (req, _t, afterTool) => {
    if (afterTool) { results = req.messages[req.messages.length - 1].content; return [{ type: "text", text: "read them" }]; }
    return [use("web_fetch", { url: url("a") }), use("web_fetch", { url: url("b") }), use("web_fetch", { url: url("c") }), use("memory_search", { query: "x" }), use("web_fetch", { url: url("d") })];
  };
  maxInFlight = 0;
  const t0 = Date.now();
  await call("POST", `/bots/${bot.id}/messages`, { text: `Lis ${url("")} et ses pages` });
  await settle(bot.id);
  const took = Date.now() - t0;
  assert.equal(maxInFlight, 3, "the three reads ran at the same time");
  assert.ok(took < 1500, `took ${took} ms`);
  const texts = results.filter((b) => b.type === "tool_result").map((b) => JSON.stringify(b));
  assert.equal(texts.length, 5);
  assert.match(texts[0], /page \/a/); assert.match(texts[1], /page \/b/); assert.match(texts[2], /page \/c/); assert.match(texts[4], /page \/d/);
  // Every call has its step row, done.
  const steps = (await rowsOf(bot.id)).filter((r) => r.body.kind === "step" && r.body.tool === "web_fetch").slice(-4);
  assert.ok(steps.every((r) => r.body.kind === "step" && r.body.status === "done"));
});

test("after outside content, opening a new site still asks, even inside a run of reads", async () => {
  plan = (_req, _t, afterTool) => (afterTool ? [{ type: "text", text: "ok" }] : [use("web_fetch", { url: `http://127.0.0.1:${PORT}/one` }), use("web_fetch", { url: `http://localhost:${PORT}/two` })]);
  maxInFlight = 0;
  await call("POST", `/bots/${bot.id}/messages`, { text: `Lis http://127.0.0.1:${PORT}/one` });
  const approval = await until(async () => (await rowsOf(bot.id)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending" ? [r.body.card] : []))[0], "approval for the new host");
  assert.match(approval.title, /localhost/);
  assert.equal(maxInFlight, 1, "the second read did not run with the first");
  await call("POST", `/approvals/${approval.approvalId}`, { decision: "deny" });
  await settle(bot.id);
});

// ── Goal mode on a subscription (engine) bot ─────────────────────────────────
test("an engine bot's goal: each round is a new engine turn, until goal_update says complete", async () => {
  const prompts: string[] = [];
  setEngineHost({
    ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {}, hold: () => () => {},
    async exec(b, _args, _env, _cwd, input, _signal, onLine) {
      prompts.push(input);
      const turn = engineTurnOf(b.id)!;
      assert.ok(turn.tools.some((t) => t.name === "goal_update"), "goal_update is offered to the engine");
      assert.ok(!turn.tools.some((t) => t.name === "job_output"), "engines keep their own background mechanisms");
      const round = Number(/Round: (\d+)\//.exec(input)?.[1] ?? 1);
      await execute(turn, { type: "tool_use", id: `e${round}`, name: "goal_update", input: round >= 2 ? { status: "complete", summary: "Fini", evidence: "tests verts" } : { status: "active", summary: "En cours" } });
      onLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: `Tour ${round}` }] } }));
      onLine(JSON.stringify({ type: "result", usage: {} }));
      return { code: 0, stderr: "" };
    },
  });
  const sub = (await call("POST", "/bots", { name: "Sub" })).json.bot as Bot;
  assert.equal((await call("PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" })).status, 200);
  await call("POST", `/bots/${sub.id}/messages`, { text: "/objectif Fais passer les tests" });
  await settle(sub.id);
  const [card] = await goalCards(sub.id);
  assert.equal(card.status, "complete");
  assert.equal(card.rounds, 2);
  assert.equal(prompts.length, 2);
  assert.match(prompts[0], /Goal mode is on/);
  assert.match(prompts[1], /<goal_round>[\s\S]*Round: 2\/3/);
});

test("jobs and goals routes answer for the owner only", async () => {
  assert.deepEqual((await call("GET", `/bots/${bot.id}/jobs`)).json.jobs, []);
  assert.ok(Array.isArray((await call("GET", `/bots/${bot.id}/goals`)).json.goals));
  assert.equal((await call("POST", `/bots/${bot.id}/goals/goal_nope`, { action: "pause" })).status, 404);
  assert.equal((await call("POST", `/bots/${bot.id}/goals/goal_nope`, { action: "explode" })).status, 400);
});
