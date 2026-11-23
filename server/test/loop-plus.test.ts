import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Loop and turns, wave of 23/11 (backlog A-FAIRE L25, L52, L58, L59, L60, L63, L69, L72, L79, L84, L96): the owner's
// message passed to a helper at work, « Envoyer maintenant », the first message kept until a model answers, rate-limit
// budget / quota probe / checked backups, the recap reused after Stop, named model modes, automatic continuation after
// a subscription turn's time limit, plan mode and its review, the live-deliverable check, helpers inheriting their
// parent's instructions, plus the missing tests of L52 (the final-report pass, the summary between turns).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-loopplus-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.MAX_STEPS = "6";
process.env.COMPACT_CHARS = "6000";
for (const k of ["MAX_BOTS", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "DEMO_MODE", "HOSTED_MODE", "ANTHROPIC_BASE_URL"]) delete process.env[k];

const { registerProvider, ProviderError } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, botQueue, rows, users, history } = await import("../src/store.js");
const { interrupt, runningThreads } = await import("../src/agent/loop.js");
const { startHelper } = await import("../src/agent/team.js");
const { waitingNotes } = await import("../src/agent/steering.js");
const { RELAY_PREFIX } = await import("../src/agent/helperrelay.js");
const { heldCount } = await import("../src/agent/heldfirst.js");
const { checkModel } = await import("../src/modelhealth.js");
const { retryBudget, retryWait, isRateLimit, RATE_LIMIT_MIN_TRIES } = await import("../src/agent/reliability.js");
const { nextBackupIndex, verifyBackup, resetBackupChecks, knownBroken } = await import("../src/agent/backupmodels.js");
const { sweepProbes, probing, resetProbes, PROBE_MS } = await import("../src/agent/quotaprobe.js");
const { afterEngineTimeout } = await import("../src/agent/timeoutresume.js");
const { grantAuto, autoLeft } = await import("../src/agent/autocontinue.js");
const { planCommand, readReview, reviewPlan, approves } = await import("../src/agent/planmode.js");
const { modeModels, modeModelFor, difficultyOf, setMode, taskModel } = await import("../src/agent/modelmodes.js");
const { ownerPrices } = await import("../src/usage.js");
const { deliverableUrls, judgePage, liveCheck } = await import("../src/agent/livecheck.js");
const { endCheck } = await import("../src/agent/endcheck.js");
const { BlockedAddressError } = await import("../src/net.js");
const { inheritedBlock } = await import("../src/agent/helperinherit.js");
const { SUMMARY_SECTIONS } = await import("../src/agent/memory.js");
const SUMMARY_MARK = "[Automatic summary of the earlier conversation";
const { closeAllDesktops, initComputer } = await import("../src/computer.js");
await initComputer();
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const textOf = (blocks: Block[]) => blocks.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n");
const GOOD_SUMMARY = SUMMARY_SECTIONS.map((h: string) => `## ${h}\nNoted: the client Camille, quote 4521, meeting on 2026-11-30.`).join("\n");

/** Whether any model can be reached (L59 turns it off). */
let brain = false;
const seen: { provider: string; model: string; system: string; tools: number; all: string; last: string }[] = [];
let release = false;
let phase = "";

function scripted(id: string, models: string[], extra: Partial<LlmProvider> & { fail?: string } = {}): LlmProvider {
  return {
    id, label: id, models, available: () => brain, ...extra,
    async runTurn(req: TurnRequest): Promise<TurnResult> {
      if (extra.fail) throw new Error(extra.fail);
      const last = req.messages[req.messages.length - 1];
      const all = req.messages.map((m) => textOf(m.content)).join("\n");
      const lastText = textOf(last.content);
      seen.push({ provider: id, model: req.model, system: req.system, tools: req.tools.length, all, last: lastText });
      const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: req.model, usage }; };
      const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: req.model, usage });
      if (/^Health check/.test(req.system)) return say("OK");
      if (/compress a long working conversation/.test(req.system)) return say(GOOD_SUMMARY);
      if (/You compare a plan with the request/.test(req.system)) return say('{"verdict":"gaps","missing":["the contact form"],"extra":[],"note":"One point is missing."}');
      if (req.system.length < 2000) return say("[]"); // other helper calls (learning pass…)
      const hasResult = last.content.some((b) => b.type === "tool_result");
      if (/STOPME/.test(lastText)) { phase = "stop"; return use("memory_search", { query: "quarterly invoices" }); }
      if (phase === "stop" && hasResult) {
        phase = "";
        for (let i = 0; i < 400 && !req.signal?.aborted; i++) await sleep(25);
        throw new Error("aborted");
      }
      if (/REPORTME/.test(lastText)) { phase = "report"; return use("memory_search", { query: "report" }); }
      if (phase === "report" && hasResult) { phase = ""; return { content: [], stopReason: "end", model: req.model, usage }; }
      if (/Give the user a final text report/.test(lastText)) return say("Final report: the search ran, nothing else to verify.");
      if (/SAVE-NOTE/.test(lastText)) return use("memory_save", { text: "The user likes tea." });
      if (hasResult) return say(`result seen: ${lastText.slice(0, 300)}`);
      if (/work slowly/.test(lastText)) {
        for (let i = 0; i < 400 && !req.signal?.aborted && !release; i++) await sleep(25);
        if (req.signal?.aborted) throw new Error("aborted");
        return say("slow done");
      }
      return say(`ok: ${lastText.slice(-80)}`);
    },
  };
}
registerProvider(scripted("script", ["script-1"]));
registerProvider(scripted("priced", ["claude-haiku-5-5", "claude-opus-5-5", "mystery-9"]));
registerProvider(scripted("blind", ["b-1"], { readsImages: () => false } as Partial<LlmProvider>));
registerProvider(scripted("seer", ["s-1"]));
registerProvider(scripted("broken", ["x-1"], { fail: "This model does not support tools" }));

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const running = async (id: string) => !!(await call("GET", "/bots")).json.live[id]?.running;
const idle = (id: string) => until(async () => !(await running(id)), "idle");
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body.kind === "notice" ? r.body.text : ""));

let bot: Bot;
let userId = "";
test("setup", async () => {
  brain = true;
  await call("POST", "/auth/signup", { email: "loopplus@example.com", password: "password-1", locale: "en" });
  bot = (await call("POST", "/bots", { name: "Worker" })).json.bot;
  userId = bots.byId(bot.id)!.userId;
  brain = false;
});

test("L59: with no model at all, the owner's first message is kept (no error), then sent once a model answers", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "FIRSTWORDS hello" });
  await until(async () => (await notices(bot.id)).some((t) => /kept your message/.test(t)), "the kept notice");
  assert.equal(heldCount(userId), 1);
  assert.equal(seen.length, before, "no model call");
  assert.ok(!(await notices(bot.id)).some((t) => /Something went wrong/.test(t)), "no error notice");
  brain = true;
  const h = await checkModel(users.byId(userId)!, "script:script-1");
  assert.equal(h.status, "ok");
  await until(() => seen.slice(before).some((s) => /FIRSTWORDS/.test(s.last)), "the replayed message");
  await idle(bot.id);
  assert.equal(heldCount(userId), 0);
  assert.ok((await notices(bot.id)).some((t) => /sending the message I kept/.test(t)));
});

test("L63: after Stop, the owner's next message carries a recap of what the stopped turn did (once)", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "STOPME find the invoices" });
  await until(() => seen.some((s) => /quarterly invoices/.test(s.all) && s.all.includes("memory_search") || s.last.includes("STOPME")), "first call");
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "step" && r.body.tool === "memory_search"), "the step row");
  await call("POST", `/bots/${bot.id}/stop`, {});
  await idle(bot.id);
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "and now the summary please" });
  await until(() => seen.length > before, "next call");
  await idle(bot.id);
  const next = seen.slice(before).find((s) => /and now the summary/.test(s.last))!;
  assert.match(next.last, /Your previous turn in this conversation was stopped by the user/);
  assert.match(next.last, /memory_search \(query=quarterly invoices\)/);
  const again = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "one more thing" });
  await until(() => seen.length > again, "third call");
  await idle(bot.id);
  assert.doesNotMatch(seen[seen.length - 1].last, /Your previous turn/, "used once");
});

test("L58: « Envoyer maintenant » stops the step under way and the waiting note is answered at once", async () => {
  release = false;
  const stoppedBefore = (await notices(bot.id)).filter((t) => /^Stopped\.$/.test(t)).length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "work slowly SENDNOW" });
  await until(() => running(bot.id), "running");
  await until(() => seen.some((s) => /SENDNOW/.test(s.last)), "the slow call");
  await call("POST", `/bots/${bot.id}/messages`, { text: "NOTE-NOW what is the weather" });
  const notes = await until(() => { const n = waitingNotes(bot.id); return n.length ? n : null; }, "the waiting note");
  const before = seen.length;
  const r = await call("POST", `/bots/${bot.id}/notes/${notes[0].id}/send-now`);
  assert.equal(r.status, 200);
  assert.equal(r.json.state, "sent");
  await until(() => seen.slice(before).some((s) => /NOTE-NOW/.test(s.all)), "the note answered");
  await idle(bot.id);
  const n = await notices(bot.id);
  assert.ok(n.some((t) => /I stopped the step under way to read your message now/.test(t)));
  assert.equal(n.filter((t) => /^Stopped\.$/.test(t)).length, stoppedBefore, "its own line instead of « Stopped. »");
  assert.equal((await call("POST", `/bots/${bot.id}/notes/999999/send-now`)).status, 404);
});

test("L25: a message the owner types in the bot's chat also reaches its helper at work", async () => {
  release = false;
  const parent = bots.byId(bot.id)!;
  const helper = startHelper(parent, "work slowly HELPERJOB", "job", 0);
  await until(() => runningThreads(helper.id).length > 0, "helper running");
  await until(() => seen.some((s) => /HELPERJOB/.test(s.last)), "helper's call");
  await call("POST", `/bots/${bot.id}/messages`, { text: "RELAYED also check the prices" });
  const notes = await until(() => { const n = waitingNotes(helper.id); return n.length ? n : null; }, "relayed note");
  assert.ok(notes[0].text.startsWith(RELAY_PREFIX.replaceAll("{parent}", parent.name)));
  assert.match(notes[0].text, /RELAYED also check the prices/);
  assert.ok((await notices(bot.id)).some((t) => /Also passed to the helper at work/.test(t)));
  interrupt(helper.id);
  await until(() => runningThreads(helper.id).length === 0, "helper stopped");
  await idle(bot.id);
});

test("L52: the final-report pass of an API turn: tools taken away, a text report asked and shown", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "REPORTME look it up" });
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "message" && r.body.role === "assistant" && /Final report: the search ran/.test(r.body.text)), "the report");
  await idle(bot.id);
  const ask = seen.slice(before).find((s) => /Give the user a final text report/.test(s.last))!;
  assert.ok(ask, "the report was asked");
  assert.equal(ask.tools, 0, "no tools offered for the report");
});

test("L52: the summary between turns: a long conversation is summarised before the next turn's call", async () => {
  const b = bots.byId(bot.id)!;
  for (let i = 0; i < 8; i++) {
    history.append(b.id, b.generation, { role: "user", content: [{ type: "text", text: `old question ${i} ${"lorem ipsum ".repeat(60)}` }] });
    history.append(b.id, b.generation, { role: "assistant", content: [{ type: "text", text: `old answer ${i} ${"dolor sit ".repeat(60)}` }] });
  }
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "AFTERSUMMARY what was decided?" });
  await until(() => seen.slice(before).some((s) => /AFTERSUMMARY/.test(s.last)), "the turn");
  await idle(bot.id);
  const turn = seen.slice(before).find((s) => /AFTERSUMMARY/.test(s.last) && s.system.length >= 2000)!;
  assert.ok(turn.all.includes(SUMMARY_MARK), "the request starts from the summary");
  assert.ok(!turn.all.includes("old question 0"), "the oldest messages were replaced");
});

test("L60: a rate limit gets a longer budget and longer waits; other errors keep the account's", () => {
  const rate = new ProviderError("429 Too Many Requests", { status: 429, transient: true });
  const down = new ProviderError("502 Bad Gateway", { status: 502, transient: true });
  assert.ok(isRateLimit(rate) && !isRateLimit(down));
  assert.equal(retryBudget(rate, 2), RATE_LIMIT_MIN_TRIES);
  assert.equal(retryBudget(down, 2), 2);
  assert.equal(retryWait(down, 2, 2), null, "out of tries");
  assert.notEqual(retryWait(rate, 2, 2), null, "a rate limit still waits");
  assert.ok(retryWait(new ProviderError("x", { status: 429, transient: true, retryAfterMs: 120_000 }), 0, 2, 0)! >= 120_000, "a 2-minute Retry-After is honoured");
  assert.equal(retryWait(new ProviderError("x", { status: 502, transient: true, retryAfterMs: 120_000 }), 0, 2, 0), null, "not for a broken server");
});

test("L60: the next backup skips one known broken (refuses tools) and prefers one that reads pictures", async () => {
  resetBackupChecks();
  assert.equal(nextBackupIndex(["script:script-1", "blind:b-1", "seer:s-1"], 0, userId, true), 2, "pictures: the backup that sees comes first");
  assert.equal(nextBackupIndex(["script:script-1", "blind:b-1", "seer:s-1"], 0, userId, false), 1, "no pictures: the order");
  const v = await verifyBackup({ id: userId }, "broken:x-1");
  assert.equal(v.ok, false); assert.equal(v.tools, false);
  assert.ok(knownBroken(userId, "broken:x-1"));
  assert.equal(nextBackupIndex(["script:script-1", "broken:x-1", "seer:s-1"], 0, userId, false), 2);
  assert.equal(nextBackupIndex(["script:script-1", "broken:x-1"], 0, userId, false), 1, "all broken: the next one anyway, never a dead end");
  assert.equal(nextBackupIndex(["script:script-1"], 0, userId, false), 1, "none left");
});

test("L60: quota re-checked every 2 minutes: one waiting job goes through; back → lifted, limited again → stays", () => {
  resetProbes();
  const sub = bots.create(userId, { name: "Sub", model: "claude-code:sonnet" } as never);
  const now = Date.now();
  q.run("INSERT INTO subscription_limits (user_id, engine, until, source, detected_at) VALUES (?, 'claude-code', ?, 'default', ?) ON CONFLICT(user_id, engine) DO UPDATE SET until = excluded.until, source = excluded.source, detected_at = excluded.detected_at", userId, now + 3_600_000, now - PROBE_MS - 1000);
  const id = botQueue.add(sub.id, { kind: "user", text: "waiting work" })!;
  botQueue.limit(id);
  const reran: number[] = []; const lifted: string[] = [];
  const r1 = sweepProbes(now, (_b, list) => { reran.push(...list.map((x) => x.id)); return list.length; }, (u, e) => lifted.push(`${u}/${e}`));
  assert.deepEqual(r1, { started: 1, lifted: 0 });
  assert.deepEqual(reran, [id]);
  assert.ok(probing(userId, "claude-code", sub.id), "the probe job runs on the subscription");
  assert.deepEqual(sweepProbes(now + 1000, () => 0, () => undefined), { started: 0, lifted: 0 }, "one probe at a time, not before 2 minutes");
  botQueue.done(id);
  const r2 = sweepProbes(now + 2000, () => 0, (u, e) => lifted.push(`${u}/${e}`));
  assert.equal(r2.lifted, 1);
  assert.deepEqual(lifted, [`${userId}/claude-code`]);
  // A probe that met the limit again: the limit was marked anew (another time), nothing is lifted.
  resetProbes();
  const id2 = botQueue.add(sub.id, { kind: "user", text: "more waiting work" })!;
  botQueue.limit(id2);
  sweepProbes(now + PROBE_MS * 3, () => 1, () => undefined);
  q.run("UPDATE subscription_limits SET until = ? WHERE user_id = ?", now + 7_200_000, userId);
  botQueue.done(id2);
  assert.equal(sweepProbes(now + PROBE_MS * 3 + 1000, () => 0, () => { throw new Error("must not lift"); }).lifted, 0);
  q.run("DELETE FROM subscription_limits WHERE user_id = ?", userId);
});

test("L72: after a subscription turn's time limit, a routine carries on by itself while it makes progress; the chat only with a grant", () => {
  const b = bots.create(userId, { name: "Timed", model: "claude-code:sonnet" } as never);
  const since = Date.now() - 10;
  const step = (tool: string, args: Record<string, unknown>) => rows.append(b, { kind: "step", callId: `c${Math.random()}`, tool, label: tool, status: "done", args });
  step("Read", { file: "a.txt" }); step("Edit", { file: "a.txt" });
  let carried = 0;
  const ctx = (kind: "routine" | "user") => ({ bot: b, locale: "en" as const, trigger: kind === "routine" ? { kind: "routine" as const, text: "nightly", runId: "r1" } : { kind: "user" as const, text: "go" }, thread: 0, since, limitMs: 30 * 60_000, carryOn: () => { carried++; } });
  assert.equal(afterEngineTimeout(ctx("user")), false, "the owner's chat without « Continuer seul »: the notice with Continue");
  assert.equal(carried, 0);
  assert.equal(afterEngineTimeout(ctx("routine")), true, "a routine with progress: carries on");
  assert.equal(carried, 1);
  assert.equal(afterEngineTimeout(ctx("routine")), false, "the same stretch again is no progress");
  grantAuto(b.id, 0, 3);
  step("Bash", { cmd: "npm test" });
  assert.equal(afterEngineTimeout(ctx("user")), true, "with a grant and new progress: carries on");
  assert.equal(autoLeft(b.id, 0), 2);
  const n = rows.list(b.id, b.generation, 50).filter((r) => r.body.kind === "notice").map((r) => r.body);
  assert.ok(n.some((x) => x.kind === "notice" && x.action?.kind === "continue" && x.action.reason === "timeout"), "the Continue notice is kept when not carrying on");
  assert.ok(n.some((x) => x.kind === "notice" && /carrying on on my own/.test(x.text)));
});

test("L79 contract: « /plan » words and approvals", () => {
  assert.deepEqual(planCommand("/plan build the site"), { on: true, text: "build the site" });
  assert.deepEqual(planCommand("/plan off"), { on: false });
  assert.deepEqual(planCommand("/plan"), { on: true, text: "" });
  assert.equal(planCommand("plan the trip"), null);
  assert.ok(approves("Approve") && approves("Approuver avec une note : plus court") && !approves("Change it") && !approves("Le modifier"));
  assert.equal(readReview('{"verdict":"ok","missing":[],"extra":["a"],"note":"fine"}')!.verdict, "ok");
  assert.equal(readReview('{"verdict":"ok","missing":["x"]}')!.verdict, "gaps", "a missing point is never ok");
  assert.equal(readReview("no json"), null);
});

test("L79: in plan mode a tool that changes something is refused until a plan is approved; the model is told", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "/plan SAVE-NOTE remember my tea" });
  await until(() => seen.slice(before).some((s) => /result seen/.test(s.all) || /Plan mode is on/.test(s.last)), "the refused call");
  await idle(bot.id);
  const turn = seen.slice(before);
  assert.ok(turn.some((s) => /\[Plan mode is on for this conversation/.test(s.all)), "the turn is told");
  assert.ok(turn.some((s) => /Plan mode is on: nothing may be changed/.test(s.last)), "memory_save refused");
  assert.equal((await call("GET", `/bots/${bot.id}/plan-mode`)).json.on, true);
  const b = bots.byId(bot.id)!;
  rows.append(b, { kind: "card", card: { type: "question", question: "Plan", options: ["Approve", "Approve with a note", "Change it"], status: "answered", answer: "Approve", plan: { steps: ["save the note"], version: 1 } } });
  const again = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "SAVE-NOTE go ahead" });
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "step" && r.body.tool === "memory_save" && r.body.status === "done"), "the call ran");
  await idle(bot.id);
  assert.ok(!seen.slice(again).some((s) => /Plan mode is on: nothing may be changed/.test(s.last)), "allowed after approval");
  assert.equal((await call("GET", `/bots/${bot.id}/plan-mode`)).json.on, false, "plan mode ends once a plan is approved");
  assert.ok((await notices(bot.id)).some((t) => /Plan approved/.test(t)));
  assert.equal((await call("PUT", `/bots/${bot.id}/plan-mode`, { on: true })).json.on, true);
  assert.equal((await call("POST", `/bots/${bot.id}/messages`, { text: "/plan off" })).status, 200);
  assert.equal((await call("GET", `/bots/${bot.id}/plan-mode`)).json.on, false);
});

test("L79: « Relire mon plan contre la demande » lists what the plan leaves out, under the card", async () => {
  const b = bots.byId(bot.id)!;
  rows.append(b, { kind: "message", role: "user", text: "Build a site with 3 pages and a contact form" });
  const card = rows.append(b, { kind: "card", card: { type: "question", question: "Site plan", options: ["Approve", "Approve with a note", "Change it"], status: "pending", plan: { steps: ["home page", "about page", "prices page"], version: 1 } } });
  let prompt = "";
  const review = await reviewPlan(b, card.seq, async (_b, _s, p) => { prompt = p; return '{"verdict":"gaps","missing":["the contact form"],"extra":[],"note":"One point is missing."}'; });
  assert.equal(review.verdict, "gaps");
  assert.deepEqual(review.missing, ["the contact form"]);
  assert.match(prompt, /3 pages and a contact form/); assert.match(prompt, /1\. home page/);
  assert.ok((await notices(bot.id)).some((t) => /Plan review: some points.*Missing: the contact form/.test(t)));
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${card.seq}/plan-review`)).status, 200, "the route");
  assert.equal((await call("POST", `/bots/${bot.id}/rows/1/plan-review`)).status, 400, "not a plan card");
});

test("L69: named modes pick only the account's priced models; Auto by difficulty; a task can ask for a lighter model", async () => {
  const b = bots.byId(bot.id)!;
  const m = modeModels(b);
  assert.equal(m.fast, "priced:claude-haiku-5-5");
  assert.equal(m.strongest, "priced:claude-opus-5-5", "an unpriced model (mystery-9, script-1) is never picked");
  assert.equal(m.free, null);
  ownerPrices.set("mystery-9", { input: 0, output: 0, cached: 0 }, "test");
  assert.equal(modeModels(b).free, "priced:mystery-9");
  ownerPrices.set("mystery-9", { input: null, output: null, cached: null }, "test");
  assert.equal(difficultyOf("hi"), "easy");
  assert.equal(difficultyOf("Please analyse and compare these three supplier contracts for me"), "hard");
  assert.equal(difficultyOf("short", 1), "hard", "a file makes it hard");
  setMode(b.id, "auto");
  assert.equal(modeModelFor(b, { kind: "user", text: "hi" }), "priced:claude-haiku-5-5");
  assert.equal(modeModelFor(b, { kind: "user", text: "Please analyse and compare these three supplier contracts for me" }), "priced:claude-opus-5-5");
  assert.equal(modeModelFor(b, { kind: "user", text: "What time is the meeting tomorrow with the whole team, and who is bringing the coffee and the cakes?" }), b.model, "normal: the bot's own model");
  assert.equal(modeModelFor(b, { kind: "system", text: "x" }), b.model, "auto judges people's messages only");
  assert.equal(taskModel(b, "light", b.model), "priced:claude-haiku-5-5");
  assert.equal(taskModel(b, "normal", b.model), b.model);
  // Through the route and a real turn.
  assert.equal((await call("PUT", `/bots/${bot.id}/model-mode`, { mode: "nope" })).status, 400);
  const put = await call("PUT", `/bots/${bot.id}/model-mode`, { mode: "fast" });
  assert.equal(put.json.mode, "fast");
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "MODEFAST quick one" });
  await until(() => seen.slice(before).some((s) => /MODEFAST/.test(s.last)), "turn");
  await idle(bot.id);
  const t = seen.slice(before).find((s) => /MODEFAST/.test(s.last))!;
  assert.equal(`${t.provider}:${t.model}`, "priced:claude-haiku-5-5");
  assert.equal((await call("GET", `/bots/${bot.id}/model-mode`)).json.mode, "fast");
  await call("PUT", `/bots/${bot.id}/model-mode`, { mode: "balanced" });
});

test("L84 contract: the addresses a report gives and what counts as a broken page", () => {
  assert.deepEqual(deliverableUrls("Live at https://ex.com/a. Also https://ex.com/b, and https://ex.com/a again."), ["https://ex.com/a", "https://ex.com/b"]);
  assert.match(judgePage("u", 404, "text/html", "")!, /error 404/);
  assert.match(judgePage("u", 200, "text/html", "<title>404 Not Found</title><p>Not Found</p>")!, /error page/);
  assert.match(judgePage("u", 200, "text/html", "<html><body><div id=root></div></body></html>")!, /empty/);
  assert.match(judgePage("u", 200, "text/html", "<p>Total: undefined € — tax undefined</p>")!, /broken values/);
  assert.equal(judgePage("u", 200, "text/html", "<h1>Bakery</h1><p>Fresh bread every morning, open 7 days.</p>"), null);
  assert.equal(judgePage("u", 200, "image/png", ""), null);
});

test("L84: the end check opens the live deliverable; a broken page sends the work back with that reason", async () => {
  const fetcher = (async (url: string) => {
    if (url.includes("private")) throw new BlockedAddressError("10.0.0.1");
    if (url.includes("good")) return new Response("<h1>Shop</h1><p>All our products, with prices and photos.</p>", { status: 200, headers: { "content-type": "text/html" } });
    return new Response("Not Found", { status: 404, headers: { "content-type": "text/html" } });
  }) as never;
  const r = await liveCheck(["https://good.example/", "https://bad.example/x", "https://private.example/"], fetcher);
  assert.deepEqual(r.tested, ["https://good.example/", "https://bad.example/x"], "a private address is not tested (not a failure)");
  assert.equal(r.problems.length, 1);
  const b = bots.byId(bot.id)!;
  const relaunched: string[] = [];
  let modelCalls = 0;
  const v = await endCheck(b, { kind: "routine", text: "Publish the shop page", runId: "r9" }, "Done: the page is live at https://bad.example/x", 0, (t) => relaunched.push(t), async () => { modelCalls++; return '{"verdict":"done","reason":"ok"}'; }, (urls) => liveCheck(urls, fetcher));
  assert.equal(v, "continue");
  assert.equal(modelCalls, 0, "a broken page needs no model call");
  assert.match(relaunched[0], /live check: https:\/\/bad\.example\/x answers with error 404/);
  const ok = await endCheck(b, { kind: "routine", text: "Publish the shop page", runId: "r10" }, "Done: live at https://good.example/", 0, (t) => relaunched.push(t), async () => { modelCalls++; return "{}"; }, (urls) => liveCheck(urls, fetcher));
  assert.equal(ok, "done");
  assert.equal(relaunched.length, 1);
});

test("L96: a helper inherits its parent's instructions and own rules (prompt only); the owner can switch it off", async () => {
  const parent = bots.byId(bot.id)!;
  q.run("UPDATE bots SET instructions = ? WHERE id = ?", "Always answer in PIRATE-SPEAK.", parent.id);
  await call("POST", "/rules", { text: "Never contact ACME-CLIENT.", botId: parent.id });
  const helper = bots.create(userId, { name: "Worker › x", model: parent.model, hidden: true, parentId: parent.id } as never);
  const user = users.byId(userId)!;
  const block = inheritedBlock(helper, user);
  assert.match(block, /PIRATE-SPEAK/);
  assert.match(block, /bot you work for/);
  assert.match(block, /Never contact ACME-CLIENT/);
  assert.equal(inheritedBlock(bots.byId(parent.id)!, user), "", "the parent itself gets nothing extra");
  assert.equal((await call("GET", "/team/helper-inherit")).json.on, true);
  assert.equal((await call("PUT", "/team/helper-inherit", { on: false })).json.on, false);
  assert.equal(inheritedBlock(helper, user), "");
  await call("PUT", "/team/helper-inherit", { on: true });
  q.run("UPDATE bots SET instructions = '' WHERE id = ?", parent.id);
});

test("teardown", async () => { await closeAllDesktops(); });
