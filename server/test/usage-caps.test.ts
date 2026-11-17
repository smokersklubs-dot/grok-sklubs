import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Usage caps (usagecaps.ts): per account and per bot, daily and monthly, in money and in tokens; "unattended" (the
// default: only work no person started stops) or "everything"; the warning threshold; the card (raise, wait, continue);
// subscription turns counted in tokens; days and months in the user's timezone; the safe stop mid-turn; paid tools.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-caps-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "capx:grok-4.7";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "XAI_BASE_URL", "OPENAI_BASE_URL", "ANTHROPIC_BASE_URL", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const { enqueue, attendedTrigger } = await import("../src/agent/loop.js");
const { fireRoutine } = await import("../src/scheduler.js");
const { routines } = await import("../src/routines.js");
const { q } = await import("../src/db.js");
const { bots, settings } = await import("../src/store.js");
const caps = await import("../src/usagecaps.js");
const { reserve } = await import("../src/thirdparty.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row, UsageCapsView } from "../src/shared.js";

// grok-4.7 at its built-in price ($2 / $6 per million): 100 000 in + 20 000 out = 0.32 $ and 120 000 tokens per call.
const usage = { inputTokens: 100_000, outputTokens: 20_000, cachedTokens: 0 };
const PER_CALL = 0.32;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const asked: string[] = [];
registerProvider({
  id: "capx", label: "Caps test", models: ["grok-4.7"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const who = /You are (\w+)/.exec(req.system)?.[1] ?? "?";
    // The turn's own request: the last user message with words; the tool results after it are this turn's steps.
    let at = req.messages.length - 1;
    while (at > 0 && !(req.messages[at].role === "user" && req.messages[at].content.some((b) => b.type === "text"))) at--;
    const results = req.messages.slice(at).flatMap((m) => m.content).filter((b) => b.type === "tool_result").length;
    const firstAsk = req.messages[at].content.some((b) => b.type === "text" && /step thrice/.test((b as { text: string }).text));
    if (!last.content.some((b) => b.type === "tool_result")) asked.push(`${who}: ${said}`);
    // "step thrice": three steps in one turn (a harmless read each time), to cross a cap in the middle of a turn.
    if (firstAsk && results < 3) return { content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name: "memory_search", input: { query: "x" } }] as Block[], stopReason: "tool_use", model: "grok-4.7", usage };
    req.onText?.(`${who} ok`);
    return { content: [{ type: "text", text: `${who} ok` }] as Block[], stopReason: "end", model: "grok-4.7", usage };
  },
});

// A fake subscription engine: each turn reports 3 000 input + 1 000 output tokens (cost 0, as a subscription).
const engineInputs: string[] = [];
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {}, hold: () => () => {},
  async exec(_bot, _args, _env, _cwd, input, _signal, onLine) {
    engineInputs.push(input);
    onLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Engine ok" }] } }));
    onLine(JSON.stringify({ type: "result", usage: { input_tokens: 3000, output_tokens: 1000 } }));
    return { code: 0, stderr: "" };
  },
});
after(() => { setEngineHost(null); });

const jars: Record<string, string> = { a: "", b: "", c: "" };
async function call(method: string, url: string, body?: unknown, who: "a" | "b" | "c" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string, who: "a" | "b" | "c" = "a"): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`, undefined, who)).json.rows;
const running = async (id: string, who: "a" | "b" | "c" = "a") => !!(await call("GET", "/bots", undefined, who)).json.live[id]?.running;
const idle = (id: string, who: "a" | "b" | "c" = "a") => until(async () => !(await running(id, who)), "idle");
const notices = async (id: string, who: "a" | "b" | "c" = "a") => (await rowsOf(id, who)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const capCards = async (id: string, who: "a" | "b" | "c" = "a") => (await rowsOf(id, who)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "cap" ? [r.body.card as Extract<Card, { type: "cap" }>] : []));
const askedOf = (name: string) => asked.filter((a) => a.startsWith(`${name}: `));
const audits = () => q.all<{ text: string }>("SELECT text FROM audit ORDER BY id").map((r) => r.text);
const view = async (who: "a" | "b" | "c" = "a"): Promise<UsageCapsView> => (await call("GET", "/usage/caps", undefined, who)).json;
const setCap = (b: Record<string, unknown>, who: "a" | "b" | "c" = "a") => call("PUT", "/usage/caps", b, who);
const clearUsage = (userId: string) => { q.run("DELETE FROM usage WHERE user_id = ?", userId); q.run("DELETE FROM usage_caps WHERE user_id = ?", userId); q.run("DELETE FROM usage_cap_notices WHERE user_id = ?", userId); q.run("UPDATE usage_cap_stops SET status = 'waiting' WHERE user_id = ?", userId); };
async function say(bot: Bot, text: string, who: "a" | "b" | "c" = "a") {
  await call("POST", `/bots/${bot.id}/messages`, { text }, who);
  await until(() => askedOf(bot.name).some((a) => a.includes(text)), `${bot.name} heard "${text}"`);
  await idle(bot.id, who);
}

let owner = "", ada: Bot, bea: Bot, sub: Bot;
test("setup: an owner with three bots (one on a Claude subscription), and a stranger", async () => {
  owner = (await call("POST", "/auth/signup", { email: "owner@example.com", password: "password-1", locale: "en" })).json.user.id;
  await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
  ada = (await call("POST", "/bots", { name: "Ada" })).json.bot;
  bea = (await call("POST", "/bots", { name: "Bea" })).json.bot;
  sub = (await call("POST", "/bots", { name: "Sub" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" })).status, 200);
  const v = await view();
  assert.equal(v.timezone, "UTC");
  assert.deepEqual(v.account.caps, []);
  assert.ok(v.bots.some((b) => b.botId === ada.id));
});

test("caps are checked: units, periods, amounts, modes, thresholds; only the account's own bots; strangers see nothing", async () => {
  assert.equal((await setCap({ period: "week", unit: "usd", limit: 1 })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "eur", limit: 1 })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "usd", limit: -1 })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "tokens", limit: 12.5 })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "tokens", limit: 10 })).status, 400, "token caps start at 1000");
  assert.equal((await setCap({ period: "day", unit: "usd", limit: 1, mode: "sometimes" })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "usd", limit: 1, warnPercent: 100 })).status, 400);
  assert.equal((await setCap({ period: "day", unit: "usd", limit: 1, botId: ada.id }, "b")).status, 404, "not the stranger's bot");
  const ok = await setCap({ period: "month", unit: "usd", limit: 50, botId: ada.id });
  assert.equal(ok.status, 200);
  const capOf = ok.json.bots.find((b: { botId: string }) => b.botId === ada.id).caps[0];
  assert.equal(capOf.limit, 50);
  assert.equal(capOf.mode, "unattended", "the default mode");
  assert.equal(capOf.warnPercent, 80, "the default threshold");
  assert.equal(capOf.setBy, "self");
  const theirs = await view("b");
  assert.ok(!theirs.bots.some((b) => b.botId === ada.id));
  assert.deepEqual(theirs.account.caps, []);
  assert.ok(audits().some((t) => t.startsWith("Usage cap set: Ada's monthly spending cap 50.00 $")));
  assert.equal((await setCap({ period: "month", unit: "usd", limit: null, botId: ada.id })).status, 200);
  assert.deepEqual((await view()).bots.find((b) => b.botId === ada.id)!.caps, []);
});

test("which work is 'unattended': routines, bots, goals' later rounds, job reports, check-ins and mail; not a person's", () => {
  assert.equal(attendedTrigger({ kind: "user", text: "hi" }), true);
  assert.equal(attendedTrigger({ kind: "resume" }), true);
  assert.equal(attendedTrigger({ kind: "routine", name: "r", text: "x" }), false);
  assert.equal(attendedTrigger({ kind: "bot", fromName: "B", text: "x", depth: 1 }), false);
  assert.equal(attendedTrigger({ kind: "system", text: "x", goalRound: "g" }), false);
  assert.equal(attendedTrigger({ kind: "system", text: "x", jobIds: ["j"] }), false);
  assert.equal(attendedTrigger({ kind: "system", text: "x", unattended: true }), false);
  assert.equal(attendedTrigger({ kind: "system", text: "x", resumeOf: "steps", origin: "routine" }), false, "a routine continuing by itself");
  assert.equal(attendedTrigger({ kind: "system", text: "x", resumeOf: "steps", origin: "user" }), true, "Continue pressed by the user");
  assert.equal(attendedTrigger({ kind: "system", text: "x", resumeOf: "spend", origin: "routine" }), true, "the user continued at a spend checkpoint");
  assert.equal(attendedTrigger({ kind: "system", text: "The user connected X." }), true, "a card the user answered");
  assert.equal(attendedTrigger({ kind: "system", text: "x", unattended: true, byPerson: true }), true);
});

test("an account money cap (daily, 'unattended'): one warning at its threshold, then the card; routines skip quietly; the user's messages still run", async () => {
  clearUsage(owner);
  await setCap({ period: "day", unit: "usd", limit: 1, warnPercent: 60 });
  await say(ada, "first message");
  await say(ada, "second message"); // 0.64 $: past 60%
  const warn = (await notices(ada.id)).filter((t) => t.startsWith("Usage cap at 64%: the account's daily spending cap"));
  assert.equal(warn.length, 1, "one warning");
  assert.match(warn[0], /0\.64 \$ used of 1\.00 \$\. It resets on .*\(UTC\)/);
  await say(ada, "third message"); // 0.96 $: still under, no second warning
  assert.equal((await notices(ada.id)).filter((t) => t.startsWith("Usage cap at")).length, 1);
  await say(ada, "fourth message"); // 1.28 $: reached → the card
  let cards = await capCards(ada.id);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cap.period, "day");
  assert.equal(cards[0].cap.unit, "usd");
  assert.equal(cards[0].canRaise, true);
  assert.equal(cards[0].timezone, "UTC");
  assert.ok(cards[0].resetAt > Date.now() && cards[0].resetAt <= Date.now() + 86_400_000);
  assert.ok(audits().some((t) => t.startsWith("Usage cap reached: the account's daily spending cap (1.00 $, stops unattended work)")));
  // Routines (scheduled and webhooks) of any bot of the account: skipped, no model call, counted on the card.
  const t = Date.now();
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, created_at) VALUES ('r_daily', ?, 'Daily', 'daily routine prompt', 'cron', '0 9 * * *', ?)", bea.id, t);
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES ('r_hook', ?, 'Hook', 'webhook routine prompt', 'webhook', 'hooktoken_caps', ?)", bea.id, t);
  assert.equal(fireRoutine(routines.byId("r_daily")!), "capped");
  assert.equal(fireRoutine(routines.byId("r_daily")!), "capped");
  const hook = await call("POST", "/hooks/hooktoken_caps", { order: 1 });
  assert.deepEqual(hook.json, { ok: true, skipped: "usage_cap" });
  const skipped = q.all<{ note: string }>("SELECT note FROM routine_runs WHERE status = 'skipped'");
  assert.equal(skipped.length, 3);
  assert.match(skipped[0].note, /^A usage cap is reached \(the account's daily spending cap, 1\.00 \$\): skipped\. Runs start again on .* \(UTC\)\.$/);
  assert.equal(askedOf("Bea").length, 0, "no model call");
  assert.equal((await capCards(bea.id)).length, 0, "no second card for the same cap in another chat");
  cards = await capCards(ada.id);
  assert.equal(cards[0].skipped, 3);
  assert.equal(audits().filter((x) => x.includes("unattended work skipped while the account's daily spending cap is reached")).length, 1, "one journal line, not one per run");
  // A run queued before the cap was reached is let go the same way.
  const runId = q.get<{ id: string }>("SELECT id FROM routine_runs WHERE routine_id = 'r_daily' LIMIT 1")!.id;
  q.run("UPDATE routine_runs SET status = 'running' WHERE id = ?", runId);
  enqueue(bea.id, { kind: "routine", name: "Daily", text: "queued routine prompt", runId });
  await until(() => q.get<{ status: string }>("SELECT status FROM routine_runs WHERE id = ?", runId)!.status === "skipped", "queued run skipped");
  // "Run now" is the user's own: it runs under an "unattended" cap.
  assert.equal((await call("POST", "/routines/r_daily/run")).status, 200);
  await until(() => askedOf("Bea").some((a) => a.includes("daily routine prompt")), "run by hand");
  await idle(bea.id);
  // The user's own message runs, with one notice.
  await say(ada, "fifth message");
  await say(ada, "sixth message");
  const told = (await notices(ada.id)).filter((x) => x.startsWith("Usage cap reached (the account's daily spending cap, 1.00 $): work no one started is paused until"));
  assert.equal(told.length, 1, "one notice per cap and period");
  // A message from another bot (unattended) is set aside on the card; "Continue" runs it, as the user's own.
  enqueue(bea.id, { kind: "bot", fromName: "Ada", text: "please summarise the notes", depth: 1 });
  await until(async () => (await capCards(ada.id))[0].held === 1, "held on the card");
  assert.ok(!askedOf("Bea").some((a) => a.includes("summarise the notes")));
  const stopId = (await capCards(ada.id))[0].stopId;
  assert.equal((await call("POST", `/usage/caps/stops/${stopId}`, { action: "continue" }, "b")).status, 404, "a stranger cannot answer it");
  assert.equal((await call("POST", `/usage/caps/stops/${stopId}`, { action: "continue" })).status, 200);
  await until(() => askedOf("Bea").some((a) => a.includes("summarise the notes") && a.includes("the user asked you to go on now")), "held work ran");
  await idle(bea.id);
  assert.equal((await capCards(ada.id))[0].status, "continued");
  assert.equal((await call("POST", `/usage/caps/stops/${stopId}`, { action: "continue" })).status, 409, "answered once");
});

test("under a reached cap: goals' later rounds pause the goal, job reports wait, check-ins and mail are not run", async () => {
  const t = Date.now();
  // The cap of the test above is still reached (1 $ a day, "unattended").
  q.run("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, created_at, updated_at) VALUES ('g_bea', ?, ?, 1, 'Tidy the archive', 'active', 5, ?, ?)", bea.id, owner, t, t);
  enqueue(bea.id, { kind: "system", text: "goal round prompt", goalRound: "g_bea" });
  await until(async () => (await call("GET", `/bots/${bea.id}/goals`)).json.goals.find((x: { id: string }) => x.id === "g_bea")?.status === "paused", "goal paused");
  const g = (await call("GET", `/bots/${bea.id}/goals`)).json.goals.find((x: { id: string }) => x.id === "g_bea");
  assert.equal(g.reason, "a usage cap is reached");
  q.run("INSERT INTO bot_jobs (id, bot_id, user_id, command, status, started_at, ended_at, notified) VALUES ('job_bea', ?, ?, 'make build', 'done', ?, ?, 1)", bea.id, owner, t, t);
  enqueue(bea.id, { kind: "system", text: "job ended prompt", jobIds: ["job_bea"] });
  await until(() => q.get<{ notified: number }>("SELECT notified FROM bot_jobs WHERE id = 'job_bea'")!.notified === 0, "job report set back");
  enqueue(bea.id, { kind: "system", unattended: true, text: "A new email arrived at your address" });
  const { fireCheckin } = await import("../src/scheduler.js");
  fireCheckin(owner, 0);
  await sleep(200);
  for (const a of askedOf("Bea").concat(askedOf("Ada"))) assert.ok(!/goal round prompt|job ended prompt|A new email arrived|scheduled check-in/.test(a), a);
  q.run("UPDATE bot_goals SET status = 'stopped' WHERE id = 'g_bea'");
  q.run("UPDATE bot_jobs SET notified = 1 WHERE id = 'job_bea'");
});

test("'everything': the user's own message is refused, kept on the card; raising the cap there runs it", async () => {
  // Still over the 1 $ daily cap from the test above; now it stops everything.
  await setCap({ period: "day", unit: "usd", limit: 1, mode: "everything" });
  const before = askedOf("Ada").length;
  await call("POST", `/bots/${ada.id}/messages`, { text: "blocked message" });
  await until(async () => (await notices(ada.id)).some((x) => x.startsWith("Not run: the account's daily spending cap (1.00 $) is reached until")), "refusal notice");
  await idle(ada.id);
  assert.equal(askedOf("Ada").length, before, "no model call");
  const card = (await capCards(ada.id)).find((c) => c.status === "pending" && c.held === 1)!;
  assert.ok(card, "a card holds the message");
  assert.equal(card.cap.mode, "everything");
  // "Continue" while it still stops everything: refused.
  const still = await call("POST", `/usage/caps/stops/${card.stopId}`, { action: "continue" });
  assert.equal(still.status, 409);
  assert.match(still.json.error, /still stops this work/);
  // "Run now" by hand is refused too.
  assert.equal((await call("POST", "/routines/r_daily/run")).status, 409);
  // Raise: must be higher; then the message runs.
  assert.equal((await call("POST", `/usage/caps/stops/${card.stopId}`, { action: "raise", limit: 0.5 })).status, 400);
  assert.equal((await call("POST", `/usage/caps/stops/${card.stopId}`, { action: "raise", limit: 100 })).status, 200);
  await until(() => askedOf("Ada").some((a) => a.includes("blocked message")), "the kept message ran");
  await idle(ada.id);
  assert.equal((await capCards(ada.id)).find((c) => c.stopId === card.stopId)!.status, "raised");
  assert.equal((await view()).account.caps[0].limit, 100);
  assert.ok(audits().some((x) => x.startsWith("Usage cap raised from its card: the account's daily spending cap 1.00 $ → 100.00 $")));
});

test("'wait' on a card: it says so; nothing more is shown for that cap and period", async () => {
  clearUsage(owner);
  await setCap({ period: "day", unit: "usd", limit: 0.5 });
  await say(ada, "costly one");
  await say(ada, "costly two");
  const card = (await capCards(ada.id)).find((c) => c.status === "pending")!;
  assert.equal((await call("POST", `/usage/caps/stops/${card.stopId}`, { action: "wait" })).status, 200);
  assert.equal((await capCards(ada.id)).find((c) => c.stopId === card.stopId)!.status, "waiting");
  const n = (await capCards(ada.id)).length + (await capCards(bea.id)).length;
  assert.equal(fireRoutine(routines.byId("r_daily")!), "capped");
  assert.equal((await capCards(ada.id)).length + (await capCards(bea.id)).length, n, "no new card for background work");
});

test("a bot's token cap (monthly) counts that bot and its helpers only; the other bots go on", async () => {
  clearUsage(owner);
  await setCap({ period: "month", unit: "tokens", limit: 200_000, botId: bea.id });
  await say(bea, "bea work one"); // 120 000 tokens
  await say(bea, "bea work two"); // 240 000: reached
  const v = await view();
  const b = v.bots.find((x) => x.botId === bea.id)!;
  assert.equal(b.month.tokens, 240_000);
  assert.equal(b.caps[0].reached, true);
  assert.equal(v.bots.find((x) => x.botId === ada.id)!.month.tokens, 0);
  const card = (await capCards(bea.id)).find((c) => c.status === "pending")!;
  assert.equal(card.botName, "Bea");
  assert.equal(fireRoutine(routines.byId("r_daily")!), "capped", "Bea's routine");
  // A helper of Bea (a background task) counts against Bea's cap.
  const helper = bots.create(owner, { kind: "agent", name: "Bea helper", parentId: bea.id, hidden: true });
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status, est_cost_usd) VALUES (?, ?, ?, 'x', 1000, 0, 0, 0, 'priced', 0)", owner, helper.id, Date.now());
  assert.equal((await view()).bots.find((x) => x.botId === bea.id)!.month.tokens, 241_000, "the helper's tokens are Bea's");
  assert.ok(caps.blockingCap(helper, false), "the helper is held by its parent's cap");
  // Ada (no cap of her own) still works on her own.
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, created_at) VALUES ('r_ada', ?, 'Ada daily', 'ada routine prompt', 'cron', '0 9 * * *', ?)", ada.id, Date.now());
  assert.equal(fireRoutine(routines.byId("r_ada")!), "fired");
  await until(() => askedOf("Ada").some((a) => a.includes("ada routine prompt")), "Ada's routine ran");
  await idle(ada.id);
});

test("a subscription (Claude Code) turn is counted in tokens: a money cap does not stop it, a token cap does", async () => {
  clearUsage(owner);
  await setCap({ period: "day", unit: "usd", limit: 0.01, botId: sub.id });
  await setCap({ period: "day", unit: "tokens", limit: 6000, botId: sub.id });
  await call("POST", `/bots/${sub.id}/messages`, { text: "engine one" });
  await until(() => engineInputs.some((i) => i.includes("engine one")), "engine turn");
  await idle(sub.id);
  const line = q.get<{ input_tokens: number; output_tokens: number; cost_usd: number; price_status: string; model: string }>("SELECT * FROM usage WHERE bot_id = ? ORDER BY at DESC LIMIT 1", sub.id)!;
  assert.equal(line.model, "claude-code:sonnet");
  assert.equal(line.input_tokens, 3000);
  assert.equal(line.output_tokens, 1000);
  assert.equal(line.cost_usd, 0);
  assert.equal(line.price_status, "subscription");
  let states = (await view()).bots.find((b) => b.botId === sub.id)!.caps;
  assert.equal(states.find((s) => s.unit === "usd")!.used, 0);
  assert.equal(states.find((s) => s.unit === "tokens")!.used, 4000);
  assert.equal(states.some((s) => s.reached), false);
  await call("POST", `/bots/${sub.id}/messages`, { text: "engine two" });
  await until(() => engineInputs.some((i) => i.includes("engine two")), "engine turn 2");
  await idle(sub.id);
  states = (await view()).bots.find((b) => b.botId === sub.id)!.caps;
  assert.equal(states.find((s) => s.unit === "tokens")!.reached, true, "8 000 tokens ≥ 6 000");
  assert.equal(states.find((s) => s.unit === "usd")!.reached, false, "a subscription costs nothing in money");
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, created_at) VALUES ('r_sub', ?, 'Sub daily', 'sub routine prompt', 'cron', '0 9 * * *', ?)", sub.id, Date.now());
  const n = engineInputs.length;
  assert.equal(fireRoutine(routines.byId("r_sub")!), "capped");
  await sleep(100);
  assert.equal(engineInputs.length, n, "the subscription is not used");
});

test("a turn of unattended work that crosses a cap stops before its next step; its continuation waits on the card", async () => {
  clearUsage(owner);
  await setCap({ period: "day", unit: "usd", limit: 0.5, botId: ada.id });
  const runId = q.get<{ id: string }>("SELECT id FROM routine_runs WHERE routine_id = 'r_ada' LIMIT 1")!.id;
  enqueue(ada.id, { kind: "routine", name: "Ada daily", text: "please step thrice", runId });
  await until(() => askedOf("Ada").some((a) => a.includes("step thrice")), "routine started");
  await idle(ada.id);
  // Two calls (0.64 $) then the stop, before the third.
  const calls = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage WHERE bot_id = ?", ada.id)!.n;
  assert.equal(calls, 2);
  assert.ok((await notices(ada.id)).some((x) => x.startsWith("Stopped at a usage cap (Ada's daily spending cap, 0.50 $). What I did so far is kept.")));
  const card = (await capCards(ada.id)).find((c) => c.status === "pending")!;
  assert.equal(card.held, 1);
  assert.ok(audits().some((x) => x === "Ada: turn stopped at a usage cap before its next step"));
});

test("paid third-party tools reserve within the money cap that stops the work", () => {
  clearUsage(owner);
  caps.caps.set(owner, { botId: ada.id, period: "day", unit: "usd", limit: 1, mode: "everything", warnPercent: 80 }, "self", owner);
  const bot = bots.byId(ada.id)!;
  const ok = reserve({ userId: owner, botId: ada.id, tool: "t", provider: "p", maxUsd: 0.4, idemKey: "k1" });
  assert.equal(ok.kind, "reserved");
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status, est_cost_usd) VALUES (?, ?, ?, 'x', 0, 0, 0, 0.8, 'reported', 0)", owner, ada.id, Date.now());
  const no = reserve({ userId: owner, botId: ada.id, tool: "t", provider: "p", maxUsd: 0.4, idemKey: "k2" });
  assert.equal(no.kind, "refused");
  assert.equal(no.kind === "refused" && no.reason, "usage_cap");
  assert.match(no.kind === "refused" ? no.message : "", /Ada's daily spending cap of 1\.00 \$ has 0\.20 \$ left/);
  // An "unattended" cap leaves the user's own turn alone.
  caps.caps.set(owner, { botId: ada.id, period: "day", unit: "usd", limit: 1, mode: "unattended", warnPercent: 80 }, "self", owner);
  caps.markTurn(bot.id, true);
  assert.equal(reserve({ userId: owner, botId: ada.id, tool: "t", provider: "p", maxUsd: 0.4, idemKey: "k3" }).kind, "reserved");
  caps.markTurn(bot.id, false);
  assert.equal(reserve({ userId: owner, botId: ada.id, tool: "t", provider: "p", maxUsd: 0.4, idemKey: "k4" }).kind, "refused");
  caps.clearTurn(bot.id);
});

test("days and months are the user's: their timezone decides what counts, and when it resets", async () => {
  // Unit: Paris on 2026-12-01 00:30 local is 2026-11-30 23:30 UTC — already December there.
  const t = Date.UTC(2026, 10, 30, 23, 30);
  const day = caps.periodBounds("day", "Europe/Paris", t);
  assert.equal(day.key, "2026-12-01");
  assert.equal(day.start, Date.UTC(2026, 10, 30, 23, 0));
  assert.equal(day.end, Date.UTC(2026, 11, 1, 23, 0));
  const month = caps.periodBounds("month", "Europe/Paris", t);
  assert.equal(month.key, "2026-12");
  assert.equal(month.start, Date.UTC(2026, 10, 30, 23, 0));
  assert.equal(month.end, Date.UTC(2026, 11, 31, 23, 0));
  assert.equal(caps.periodBounds("month", "UTC", t).key, "2026-11");
  // A daylight-saving change: New York's 2026-11-01 is 25 hours long.
  const ny = caps.periodBounds("day", "America/New_York", Date.UTC(2026, 10, 1, 12));
  assert.equal(ny.end - ny.start, 25 * 3_600_000);
  // Auckland is ahead of UTC by 13 hours in November.
  assert.equal(caps.periodBounds("day", "Pacific/Auckland", Date.UTC(2026, 10, 17, 12)).key, "2026-11-18");
  // Integration: the user lives in Paris (their profile). A line at 23:50 Paris on Nov 30 belongs to November; one at
  // 00:10 on Dec 1 to December — although both are on Nov 30 in UTC.
  clearUsage(owner);
  assert.equal((await call("PUT", "/profile", { timezone: "Europe/Paris" })).status, 200);
  assert.equal(caps.userTimezone(owner), "Europe/Paris");
  caps.caps.set(owner, { botId: null, period: "day", unit: "tokens", limit: 1000, mode: "unattended", warnPercent: 80 }, "self", owner);
  caps.caps.set(owner, { botId: null, period: "month", unit: "tokens", limit: 1000, mode: "unattended", warnPercent: 80 }, "self", owner);
  const ins = (at: number, tokens: number) => q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status, est_cost_usd) VALUES (?, ?, ?, 'x', ?, 0, 0, 0, 'priced', 0)", owner, ada.id, at, tokens);
  ins(Date.UTC(2026, 10, 30, 22, 50), 5000); // 23:50 Paris, Nov 30
  const bot = bots.byId(ada.id)!;
  const at = (h: number, m: number) => Date.UTC(2026, 10, 30, h, m);
  assert.ok(caps.blockingCap(bot, false, at(22, 55)), "on Nov 30 (Paris) the 5 000 tokens count");
  assert.equal(caps.blockingCap(bot, false, at(23, 30)), null, "on Dec 1 (Paris) the day and the month start again");
  ins(Date.UTC(2026, 10, 30, 23, 10), 2000); // 00:10 Paris, Dec 1
  const s = caps.statesFor(bot, at(23, 30));
  assert.equal(s.find((x) => x.period === "day")!.used, 2000);
  assert.equal(s.find((x) => x.period === "month")!.used, 2000);
  assert.equal(s.find((x) => x.period === "month")!.periodKey, "2026-12");
  assert.equal(s.find((x) => x.period === "day")!.resetAt, Date.UTC(2026, 11, 1, 23, 0), "resets at midnight Paris time");
  // The text the user reads gives that time in their timezone.
  assert.equal(caps.whenText(Date.UTC(2026, 11, 1, 23, 0), "Europe/Paris", "en"), "2 December at 00:00 (Europe/Paris)");
  // In UTC the same usage is all in November.
  assert.equal((await call("PUT", "/profile", { timezone: "UTC" })).status, 200);
  assert.equal(caps.statesFor(bot, at(23, 30)).find((x) => x.period === "month")!.used, 7000);
  assert.equal((await view()).timezone, "UTC");
  clearUsage(owner);
});

test("the usage page: today and this month, for the account and per bot (helpers counted with their bot), with the budget", async () => {
  clearUsage(owner);
  settings.setBudget(owner, 20);
  await say(ada, "page one");
  const v = await view();
  assert.equal(v.account.today.tokens, 120_000);
  assert.equal(v.account.month.usd, PER_CALL);
  assert.equal(v.bots.find((b) => b.botId === ada.id)!.today.usd, PER_CALL);
  assert.equal(v.budget.usd, 20);
  assert.ok(v.budget.spentUsd >= PER_CALL);
  assert.ok(v.dayResetAt > Date.now() && v.monthResetAt >= v.dayResetAt);
  settings.setBudget(owner, null);
});

test("deleting a bot removes its caps", async () => {
  const tmp = (await call("POST", "/bots", { name: "Tmp" })).json.bot;
  await setCap({ period: "day", unit: "usd", limit: 3, botId: tmp.id });
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage_caps WHERE bot_id = ?", tmp.id)!.n, 1);
  assert.equal((await call("DELETE", `/bots/${tmp.id}`)).status, 200);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage_caps WHERE bot_id = ?", tmp.id)!.n, 0);
});
