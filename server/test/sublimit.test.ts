import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Back to the subscription after its limit resets (agent/sublimit.ts): what the tools say is read (Claude Code's
// rate_limit_event, Codex's usage-limit message), the account's engine is "limited until T", new turns go straight to the
// backup model (one notice per bot per window) or wait in the durable queue with "Me prévenir à la reprise", and at T
// (a fake clock here) the bots go back to the subscription and the waiting work runs in order. The computer is a fake.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-sublimit-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "back:b1";
process.env.ENGINE_TURN_TIMEOUT_MINUTES = "10";
for (const k of ["FALLBACK_MODELS", "FALLBACK_MODEL", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const sl = await import("../src/agent/sublimit.js");
const { botQueue } = await import("../src/store.js");
const { isBusy } = await import("../src/agent/loop.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row, SubLimitNoticeAction, SubscriptionLimitView } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** The backup API model: what it was asked (the whole request), in order. */
const backAsked: string[] = [];
registerProvider({
  id: "back", label: "Back", models: ["b1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    backAsked.push(req.messages.map((m) => m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n")).join("\n---\n"));
    req.onText?.("Backup here.");
    return { content: [{ type: "text", text: "Backup here." }] as Block[], stopReason: "end", model: "b1", usage };
  },
});

// ── The fake computer: plays the tool's own limit events on cue ──
const execs: { botId: string; args: string[]; input: string }[] = [];
/** Unix seconds the next Claude limit event says it resets at (null: an event without resetsAt). */
let claudeReset: number | null = null;
/** Whether the Claude subscription is at its limit for the fake (the reset makes it answer again). */
let claudeAtLimit = true;
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  async exec(bot, args, _env, _cwd, input, _signal, onLine) {
    execs.push({ botId: bot.id, args, input });
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    if (args[0] === "claude" && claudeAtLimit && /hit the limit/.test(input)) {
      emit({ type: "system", subtype: "init", session_id: "s1" });
      if (/say something/.test(input)) emit({ type: "assistant", message: { content: [{ type: "text", text: "Half of the work is done." }] } });
      emit({ type: "rate_limit_event", rate_limit_info: { status: "rejected", ...(claudeReset !== null ? { resetsAt: claudeReset } : {}), rateLimitType: "five_hour", isUsingOverage: false }, uuid: "u", session_id: "s1" });
      emit({ type: "result", subtype: "success", is_error: true, result: "You've hit your session limit · resets 6pm", usage: {} });
      return { code: 1, stderr: "" };
    }
    if (args[0] === "claude" && /a warning only/.test(input)) {
      emit({ type: "rate_limit_event", rate_limit_info: { status: "allowed_warning", resetsAt: Math.floor(Date.now() / 1000) + 3600, utilization: 0.92 }, uuid: "u", session_id: "s1" });
      emit({ type: "assistant", message: { content: [{ type: "text", text: "Fine despite the warning." }] } });
      emit({ type: "result", usage: {} });
      return { code: 0, stderr: "" };
    }
    if (args[0] === "codex" && /hit the limit/.test(input)) {
      emit({ type: "thread.started", thread_id: "t1" });
      emit({ type: "turn.started" });
      emit({ type: "error", message: "You’ve hit your usage limit. Try again later." });
      emit({ type: "turn.failed", error: { message: "You’ve hit your usage limit. Try again later." } });
      return { code: 1, stderr: "" };
    }
    emit({ type: args[0] === "codex" ? "item.completed" : "assistant", ...(args[0] === "codex" ? { item: { type: "agent_message", text: `Engine: ${input.slice(-30)}` } } : { message: { content: [{ type: "text", text: `Engine: ${input.slice(-30)}` }] } }) });
    emit(args[0] === "codex" ? { type: "turn.completed", usage: {} } : { type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});
after(() => { setEngineHost(null); sl.setLimitClock(null); });

const jars: Record<string, string> = { a: "", b: "" };
async function call(who: "a" | "b", method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const A = (m: string, u: string, b?: unknown) => call("a", m, u, b);
const rowsOf = async (botId: string): Promise<Row[]> => (await A("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const notices = (list: Row[]) => list.filter((r) => r.body.kind === "notice").map((r) => (r.body.kind === "notice" ? r.body.text : ""));
const idle = (botId: string) => until(() => !isBusy(botId), "the bot idle");
const limitRow = (userId: string, engine: string) => q.get<{ until: number; source: string }>("SELECT until, source FROM subscription_limits WHERE user_id = ? AND engine = ?", userId, engine);

let userA = "";
let withBackup: Bot, solo: Bot, cdx: Bot;
test("setup: an account with a Claude bot that has a backup model, one that has none, and a Codex bot", async () => {
  userA = (await A("POST", "/auth/signup", { email: "sl@example.com", password: "password-1", locale: "fr" })).json.user.id;
  await call("b", "POST", "/auth/signup", { email: "other@example.com", password: "password-1", locale: "en" });
  withBackup = (await A("POST", "/bots", { name: "Ada" })).json.bot;
  assert.equal((await A("PATCH", `/bots/${withBackup.id}`, { model: "claude-code:sonnet", fallbackModels: ["back:b1"] })).status, 200);
  solo = (await A("POST", "/bots", { name: "Solo" })).json.bot;
  assert.equal((await A("PATCH", `/bots/${solo.id}`, { model: "claude-code:opus", fallbackModels: [] })).status, 200);
  cdx = (await A("POST", "/bots", { name: "Cody" })).json.bot;
  assert.equal((await A("PATCH", `/bots/${cdx.id}`, { model: "codex:default", fallbackModels: ["back:b1"] })).status, 200);
});

// ── What the tools say ──────────────────────────────────────────────────────────
test("detection: only Claude Code's 'rejected' without usage credits is a limit; Codex's message gives its time", () => {
  assert.deepEqual(sl.claudeLimitFrom({ status: "rejected", resetsAt: 1_900_000_000 }), { resetsAt: 1_900_000_000_000 });
  assert.deepEqual(sl.claudeLimitFrom({ status: "rejected" }), { resetsAt: null });
  assert.equal(sl.claudeLimitFrom({ status: "allowed_warning", resetsAt: 1_900_000_000 }), null);
  assert.equal(sl.claudeLimitFrom({ status: "allowed" }), null);
  assert.equal(sl.claudeLimitFrom({ status: "rejected", isUsingOverage: true }), null, "usage credits carry the turn");
  assert.equal(sl.claudeLimitFrom({ status: "rejected", overageStatus: "allowed" }), null);
  assert.deepEqual(sl.claudeLimitFromText("Claude AI usage limit reached|1900000000"), { resetsAt: 1_900_000_000_000 });
  assert.deepEqual(sl.claudeLimitFromText("You've hit your weekly limit · resets Mon 9am"), { resetsAt: null });
  assert.equal(sl.claudeLimitFromText("API Error: 500"), null);
  const now = Date.UTC(2026, 10, 17, 9, 0);
  assert.deepEqual(sl.codexLimitFrom("You’ve hit your usage limit. Try again at 3:15 PM.", now), { resetsAt: Date.UTC(2026, 10, 17, 15, 15) });
  assert.deepEqual(sl.codexLimitFrom("You’ve hit your usage limit. Upgrade to Pro (https://chatgpt.com/explore/pro), visit https://chatgpt.com/settings/usage to purchase more credits or try again at Nov 18th, 2026 12:05 AM.", now), { resetsAt: Date.UTC(2026, 10, 18, 0, 5) });
  assert.deepEqual(sl.codexLimitFrom("You've hit your usage limit. Try again later.", now), { resetsAt: null });
  assert.deepEqual(sl.codexLimitFrom("Usage limit reached. try again in 90 seconds", now), { resetsAt: now + 90_000 });
  assert.equal(sl.codexLimitFrom("stream disconnected before completion", now), null);
});

test("a warning from Claude Code (allowed_warning) is not a failure: the turn finishes on the subscription", async () => {
  const before = backAsked.length;
  await A("POST", `/bots/${withBackup.id}/messages`, { text: "a warning only, please" });
  await until(async () => (await rowsOf(withBackup.id)).some((r) => r.body.kind === "message" && r.body.text.includes("Fine despite the warning.")), "the reply");
  await sleep(100);
  assert.equal(backAsked.length, before, "no backup");
  assert.equal(limitRow(userA, "claude-code"), undefined, "no limit");
});

// ── With a backup model ─────────────────────────────────────────────────────────
test("a limit event with resetsAt: the engine is limited until then, and the turn carries on with the backup", async () => {
  claudeReset = Math.floor(Date.now() / 1000) + 2 * 3600;
  const runs = execs.length;
  await A("POST", `/bots/${withBackup.id}/messages`, { text: "please hit the limit now" });
  const list = await until(async () => { const l = await rowsOf(withBackup.id); return l.some((r) => r.body.kind === "message" && r.body.text === "Backup here.") && l; }, "the backup's reply");
  assert.equal(execs.length, runs + 1, "the tool ran once");
  const lim = limitRow(userA, "claude-code")!;
  assert.equal(lim.source, "event");
  assert.equal(lim.until, claudeReset * 1000 + sl.RESET_MARGIN_MS);
  const said = notices(list).filter((t) => /à sa limite jusqu'à/.test(t));
  assert.equal(said.length, 1);
  assert.match(said[0], /^Ton abonnement Claude est à sa limite jusqu'à .*\d\d:\d\d : je passe par /);
  assert.equal(notices(list).some((t) => /a échoué|failed/.test(t)), false, "not shown as a failure");
  assert.match(backAsked[backAsked.length - 1], /usage limit until/);
});

test("while limited: new turns skip the subscription and go straight to the backup, with no second notice", async () => {
  await idle(withBackup.id);
  const runs = execs.length;
  const asked = backAsked.length;
  await A("POST", `/bots/${withBackup.id}/messages`, { text: "second message while limited" });
  await until(() => backAsked.length > asked && backAsked[backAsked.length - 1].includes("second message while limited"), "the backup");
  await sleep(100);
  assert.equal(execs.length, runs, "the subscription tool was not called");
  assert.equal(notices(await rowsOf(withBackup.id)).filter((t) => /à sa limite/.test(t)).length, 1, "one notice per bot per window");
});

test("Codex without a reset time: a conservative hour, source 'default'", async () => {
  const t0 = Date.now();
  await A("POST", `/bots/${cdx.id}/messages`, { text: "codex, hit the limit" });
  await until(async () => (await rowsOf(cdx.id)).some((r) => r.body.kind === "message" && r.body.text === "Backup here."), "the backup's reply");
  const lim = limitRow(userA, "codex")!;
  assert.equal(lim.source, "default");
  assert.ok(lim.until >= t0 + sl.DEFAULT_LIMIT_MS && lim.until <= Date.now() + sl.DEFAULT_LIMIT_MS);
  assert.ok(notices(await rowsOf(cdx.id)).some((t) => /^Ton abonnement ChatGPT est à sa limite jusqu'à/.test(t)));
});

// ── Without a backup model ──────────────────────────────────────────────────────
let waitSeq = 0;
test("no backup: the work waits in the durable queue, in order, with one notice and 'Me prévenir à la reprise' on", async () => {
  await idle(cdx.id);
  const runs = execs.length;
  // The account's Claude is already limited: the message is held before the tool is even started.
  await A("POST", `/bots/${solo.id}/messages`, { text: "first waiting" });
  await A("POST", `/bots/${solo.id}/messages`, { text: "second waiting" });
  const list = await until(async () => { const l = await rowsOf(solo.id); return botQueue.limitedFor(solo.id).length === 2 && l; }, "two jobs waiting");
  assert.equal(execs.length, runs, "the subscription tool was not called");
  const waiting = list.filter((r) => r.body.kind === "notice" && r.body.action?.kind === "sublimit");
  assert.equal(waiting.length, 1, "one notice per bot per window");
  const action = (waiting[0].body as { action: SubLimitNoticeAction }).action;
  assert.equal(action.notify, true, "on by default");
  assert.equal(action.status, "waiting");
  assert.match((waiting[0].body as { text: string }).text, /Je n'ai pas de modèle de secours : ton travail attend ici/);
  waitSeq = waiting[0].seq;
  // Kept on disk in their order (a restart keeps them waiting: replay does not pick 'limited' rows).
  const rowsWaiting = botQueue.limitedFor(solo.id).map((r) => JSON.parse(r.trigger).text);
  assert.deepEqual(rowsWaiting, ["first waiting", "second waiting"]);
  assert.equal(botQueue.unfinished().some((r) => r.bot_id === solo.id), false);
  assert.equal(list.some((r) => r.body.kind === "message" && r.body.role === "assistant"), false, "nothing dropped, nothing answered");
});

test("'Me prévenir à la reprise' can be switched off and on by the owner only", async () => {
  assert.equal((await A("POST", `/bots/${solo.id}/rows/${waitSeq}/sublimit`, { notify: false })).status, 200);
  let row = (await rowsOf(solo.id)).find((r) => r.seq === waitSeq)!;
  assert.equal((row.body as { action: SubLimitNoticeAction }).action.notify, false);
  assert.equal(q.get<{ notify: number }>("SELECT notify FROM subscription_limit_bots WHERE bot_id = ?", solo.id)!.notify, 0);
  assert.equal((await A("POST", `/bots/${solo.id}/rows/${waitSeq}/sublimit`, { notify: true })).status, 200);
  row = (await rowsOf(solo.id)).find((r) => r.seq === waitSeq)!;
  assert.equal((row.body as { action: SubLimitNoticeAction }).action.notify, true);
  assert.equal((await A("POST", `/bots/${solo.id}/rows/${waitSeq}/sublimit`, { notify: "yes" })).status, 400);
  assert.equal((await A("POST", `/bots/${solo.id}/rows/1/sublimit`, { notify: true })).status, 409, "not such a notice");
  assert.equal((await call("b", "POST", `/bots/${solo.id}/rows/${waitSeq}/sublimit`, { notify: false })).status, 404, "a stranger");
  assert.equal(q.get<{ notify: number }>("SELECT notify FROM subscription_limit_bots WHERE bot_id = ?", solo.id)!.notify, 1);
});

test("Today and Surveillance show the limited subscriptions with their reset time", async () => {
  const today = (await A("GET", "/today")).json;
  const limits: SubscriptionLimitView[] = today.limits;
  assert.deepEqual(limits.map((l) => l.engine).sort(), ["claude-code", "codex"]);
  const claude = limits.find((l) => l.engine === "claude-code")!;
  assert.equal(claude.until, limitRow(userA, "claude-code")!.until);
  assert.equal(claude.queued, 2);
  assert.equal(claude.bots, 2);
  const surv = (await A("GET", "/surveillance")).json;
  assert.equal(surv.limits.length, 2);
  assert.equal(surv.limits[0].account, null, "the owner's own account");
  assert.equal((await call("b", "GET", "/today")).json.limits.length, 0, "another account sees none of it");
});

// ── At T ────────────────────────────────────────────────────────────────────────
test("at T (fake clock): back to the subscription, one notice per bot, waiting work runs in order", async () => {
  const lim = limitRow(userA, "claude-code")!;
  const first = Math.min(lim.until, limitRow(userA, "codex")!.until);
  sl.setLimitClock(() => first - 1000);
  assert.equal(sl.sweepLimits(), 0, "not yet");
  sl.setLimitClock(() => lim.until + 1000);
  const runs = execs.length;
  assert.equal(sl.sweepLimits(), 2, "Claude's and Codex's windows are both over");
  assert.equal(limitRow(userA, "claude-code"), undefined);
  // The waiting work ran on the subscription, in its order.
  await until(() => execs.filter((e) => e.botId === solo.id).length === 2, "both waiting jobs");
  assert.deepEqual(execs.slice(runs).filter((e) => e.botId === solo.id).map((e) => /first waiting/.test(e.input) ? 1 : /second waiting/.test(e.input) ? 2 : 0), [1, 2]);
  assert.equal(botQueue.limitedFor(solo.id).length, 0);
  const soloRows = await rowsOf(solo.id);
  assert.equal(notices(soloRows).filter((t) => /^Ton abonnement Claude est de nouveau disponible/.test(t)).length, 1);
  assert.ok(notices(soloRows).includes("Ton abonnement Claude est de nouveau disponible. Je reprends ce qui attendait."));
  assert.equal((soloRows.find((r) => r.seq === waitSeq)!.body as { action: SubLimitNoticeAction }).action.status, "back");
  assert.equal(notices(await rowsOf(withBackup.id)).filter((t) => t === "Ton abonnement Claude est de nouveau disponible.").length, 1);
  // A new turn of the bot with a backup goes to the subscription again.
  await idle(withBackup.id);
  const asked = backAsked.length;
  await A("POST", `/bots/${withBackup.id}/messages`, { text: "after the reset" });
  await until(() => execs.some((e) => e.botId === withBackup.id && /after the reset/.test(e.input)), "the subscription again");
  await sleep(100);
  assert.equal(backAsked.filter((x, i) => i >= asked && x.includes("after the reset")).length, 0);
  // A second sweep posts nothing more.
  assert.equal(sl.sweepLimits(), 0);
  assert.equal(notices(await rowsOf(solo.id)).filter((t) => /de nouveau disponible/.test(t)).length, 1);
  sl.setLimitClock(null);
});

test("a limit hit during a turn with no backup: the job itself waits (no work done twice), then runs at T", async () => {
  claudeReset = null;
  await idle(solo.id);
  const runs = execs.filter((e) => e.botId === solo.id).length;
  await A("POST", `/bots/${solo.id}/messages`, { text: "solo will hit the limit" });
  await until(() => botQueue.limitedFor(solo.id).length === 1, "the job waiting");
  assert.equal(execs.filter((e) => e.botId === solo.id).length, runs + 1);
  const lim = limitRow(userA, "claude-code")!;
  assert.equal(lim.source, "default");
  assert.equal(JSON.parse(botQueue.limitedFor(solo.id)[0].trigger).text, "solo will hit the limit", "the same message, nothing was done");
  const list = await rowsOf(solo.id);
  assert.equal(list.filter((r) => r.body.kind === "notice" && r.body.action?.kind === "sublimit" && r.body.action.status === "waiting").length, 1);
  assert.equal(notices(list).some((t) => /Something went wrong|Quelque chose/.test(t)), false);
  // At T: the job runs again on the subscription (the fake now answers normally).
  claudeAtLimit = false;
  sl.setLimitClock(() => lim.until + 1);
  sl.sweepLimits();
  sl.setLimitClock(null);
  await until(() => execs.filter((e) => e.botId === solo.id).length === runs + 2, "the job again");
});

test("a limit hit after the tool already said something: what waits is a continuation, never the same work again", async () => {
  await idle(solo.id);
  claudeAtLimit = true;
  await A("POST", `/bots/${solo.id}/messages`, { text: "say something, then hit the limit" });
  await until(() => botQueue.limitedFor(solo.id).length === 1, "the continuation waiting");
  const waiting = JSON.parse(botQueue.limitedFor(solo.id)[0].trigger);
  assert.equal(waiting.kind, "system");
  assert.equal(waiting.text, sl.LIMIT_CONTINUE_TEXT);
  assert.ok((await rowsOf(solo.id)).some((r) => r.body.kind === "message" && r.body.text === "Half of the work is done."), "what it said is kept");
  claudeAtLimit = false;
  const at = limitRow(userA, "claude-code")!.until + 1;
  sl.setLimitClock(() => at);
  sl.sweepLimits();
  sl.setLimitClock(null);
  await until(() => execs.some((e) => e.botId === solo.id && e.input.includes("usage limit in the middle of your last turn")), "the continuation on the subscription");
});

test("Pause still applies: work released at T for a paused bot is set aside until it is resumed", async () => {
  await idle(solo.id);
  claudeAtLimit = true;
  await A("POST", `/bots/${solo.id}/messages`, { text: "paused later, hit the limit" });
  await until(() => botQueue.limitedFor(solo.id).length === 1, "waiting for the subscription");
  assert.equal((await A("POST", `/bots/${solo.id}/pause`)).status, 200);
  claudeAtLimit = false;
  const runs = execs.filter((e) => e.botId === solo.id).length;
  const at = limitRow(userA, "claude-code")!.until + 1;
  sl.setLimitClock(() => at);
  sl.sweepLimits();
  sl.setLimitClock(null);
  await until(() => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_queue WHERE bot_id = ? AND status = 'held'", solo.id)!.n === 1, "held by the pause");
  assert.equal(execs.filter((e) => e.botId === solo.id).length, runs, "not run while paused");
  assert.equal((await A("POST", `/bots/${solo.id}/resume`)).status, 200);
  await until(() => execs.filter((e) => e.botId === solo.id).length === runs + 1, "run once resumed");
});

test("never another login: every engine run used the same command, no sign-in or account switch", () => {
  assert.ok(execs.length > 0);
  for (const e of execs) {
    assert.ok(e.args[0] === "claude" || e.args[0] === "codex");
    assert.equal(e.args.some((a) => /^(login|logout|auth)$/.test(a) || /CLAUDE_CONFIG_DIR|CODEX_HOME|api[-_]?key/i.test(a)), false);
  }
});
