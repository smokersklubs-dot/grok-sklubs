import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Turn control (backlog A-FAIRE L63, L64, L72, L78, L84, L94, L97…): typed "stop" and "Tout arrêter", links typed during
// a turn, side questions, notes kept on disk, automatic continuation, the end check and "come back later".
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-turnctl-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.MAX_STEPS = "4";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { stopCommand } = await import("../src/agent/stopcommand.js");
const { sideCommand } = await import("../src/agent/sidequestion.js");
const { recoverNotes } = await import("../src/agent/steering.js");
const { grantAuto, takeAuto, autoLeft } = await import("../src/agent/autocontinue.js");
const { readVerdict, looksUnfinished } = await import("../src/agent/endcheck.js");
const { fireDueWakes, MAX_CHAIN } = await import("../src/agent/waitlater.js");
const { enqueue } = await import("../src/agent/loop.js");
const { closeAllDesktops, initComputer } = await import("../src/computer.js");
await initComputer();
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every request the scripted model received: its system prompt, whether tools were offered, and all its text. */
let release = false;
let longSteps = 0;
let checks: string[] = [];
const seen: { system: string; tools: number; all: string; last: string }[] = [];
const textOf = (blocks: Block[]) => blocks.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n");
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const all = req.messages.map((m) => textOf(m.content)).join("\n");
    seen.push({ system: req.system, tools: req.tools.length, all, last: textOf(last.content) });
    const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage }; };
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    if (/side question/.test(req.system)) return say("Side: 42.");
    if (/You check whether a piece of unattended work/.test(req.system)) {
      const v = checks.shift() ?? "done";
      return say(`{"verdict":"${v}","reason":"${v === "continue" ? "7 items left" : v === "blocked" ? "no access" : "ok"}"}`);
    }
    const history = req.messages.map((m) => textOf(m.content)).join("\n");
    if (/LONGTASK/.test(history) && !/finished long task/.test(history)) {
      longSteps++;
      if (longSteps >= 10) return say("finished long task");
      return use("progress_update", { text: `long step ${longSteps}` });
    }
    if (/WAITFOR/.test(history) && !/\(chain over\)/.test(history)) {
      if (/You already waited \d+ times in a row/.test(textOf(last.content))) return say("(chain over) I stop waiting.");
      if (last.content.some((b) => b.type === "tool_result")) return say("waiting noted");
      return use("wait_until", { minutes: 5, reason: "the build to finish" });
    }
    const said = textOf(last.content);
    if (/work slowly/.test(said) || /keep waiting/.test(said)) {
      // Waits until stopped (or released by a note saying "release").
      for (let i = 0; i < 400 && !req.signal?.aborted && !release; i++) await sleep(25);
      if (req.signal?.aborted) throw new Error("aborted");
      return say("slow done");
    }
    if (/step once/.test(said)) return use("progress_update", { text: "step" });
    if (/Collect 10 items|An independent check of your last report/.test(said)) return say("Here are the first 3 of 10.");
    if (/Write the full report/.test(said)) return say("All done: the full report is attached.");
    return say(`ok: ${said.slice(-60)}`);
  },
});

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
test("setup", async () => {
  await call("POST", "/auth/signup", { email: "turnctl@example.com", password: "password-1", locale: "en" });
  bot = (await call("POST", "/bots", { name: "Worker" })).json.bot;
});

test("L63 contract: which typed words are a stop", () => {
  for (const s of ["stop", "Stop !", "STOP", "arrête", "Arrete.", "/stop", "stop stop"]) assert.equal(stopCommand(s), "stop", s);
  for (const s of ["tout arrêter", "Arrête tout !", "stop all", "/tout arreter"]) assert.equal(stopCommand(s), "all", s);
  for (const s of ["stop the music when you are done", "arrête de m'envoyer des mails le soir", "", "non-stop"]) assert.equal(stopCommand(s), null, s);
});

test("L63: a typed « stop » while working is the Stop button — no model call for it, one report notice", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "work slowly please" });
  await until(() => running(bot.id), "running");
  await until(() => seen.length > before, "the slow call");
  await call("POST", `/bots/${bot.id}/messages`, { text: "stop" });
  await idle(bot.id);
  const n = await notices(bot.id);
  assert.equal(n.filter((t) => /^Stopped\./.test(t)).length, 1, "exactly one Stopped notice (nothing else was stopped, nothing waits: no extra line)");
  assert.ok(!seen.slice(before).some((s) => /^stop$/m.test(s.last)), "the word stop never reached the model");
});

test("L63: a typed « stop » with nothing running goes to the bot as a normal message", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "stop" });
  await until(() => seen.length > before, "the model call");
  await idle(bot.id);
  assert.match(seen[seen.length - 1].last, /stop/);
});

test("L63: « Tout arrêter » drops the queue and says how much", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "work slowly again" });
  await until(() => running(bot.id), "running");
  // "/apres": its own turn after this one (queued, never folded into the running turn).
  await call("POST", `/bots/${bot.id}/messages`, { text: "/apres write the QUEUED-REPORT" });
  await until(() => q.get("SELECT 1 FROM bot_queue WHERE bot_id = ? AND status = 'pending' AND trigger LIKE '%QUEUED-REPORT%'", bot.id), "queued");
  const res = await call("POST", `/bots/${bot.id}/stop-all`);
  assert.equal(res.status, 200);
  assert.equal(res.json.report.dropped, 1);
  assert.equal(res.json.report.turns, 1);
  await idle(bot.id);
  await sleep(200);
  assert.ok(!seen.some((s) => /QUEUED-REPORT/.test(s.last)), "the cancelled message never ran");
  const n = await notices(bot.id);
  assert.ok(n.some((t) => /^Everything is stopped\. 1 waiting message\(s\) or follow-up\(s\) were cancelled\./.test(t)), n.join(" | "));
});

test("L78: /btw is answered on the side, without entering the running turn's history", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "work slowly on BIGJOB" });
  await until(() => running(bot.id), "running");
  await call("POST", `/bots/${bot.id}/messages`, { text: "/btw what is six times seven?" });
  const answer = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("Side answer")), "the side answer");
  assert.match(answer.body.kind === "message" ? answer.body.text : "", /↪ Side answer: Side: 42\./);
  const side = seen.find((s) => /side question/.test(s.system))!;
  assert.equal(side.tools, 0, "no tools for a side answer");
  assert.match(side.all, /BIGJOB/, "it sees the conversation");
  assert.ok(await running(bot.id), "the work goes on");
  await call("POST", `/bots/${bot.id}/stop`, {});
  await idle(bot.id);
  assert.ok(!seen.filter((s) => !/side question/.test(s.system)).some((s) => /six times seven/.test(s.all)), "the side question never joined the work's history");
});

test("L78 contract: side commands", () => {
  assert.deepEqual(sideCommand("/btw is it raining?"), { kind: "btw", text: "is it raining?" });
  assert.deepEqual(sideCommand("/après envoie le rapport"), { kind: "later", text: "envoie le rapport" });
  assert.deepEqual(sideCommand("traite ça après : le devis"), { kind: "later", text: "le devis" });
  assert.equal(sideCommand("/btw"), null);
  assert.equal(sideCommand("by the way, hello"), null);
});

test("L94 + L64: a note typed during the turn is kept on disk until read; its link gets the hint and the safety net", async () => {
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "keep waiting for my note" });
  await until(() => running(bot.id), "running");
  await call("POST", `/bots/${bot.id}/messages`, { text: "also look at https://sklubs-example.fr/page" });
  assert.ok(q.get("SELECT 1 FROM steer_notes WHERE bot_id = ? AND text LIKE '%sklubs-example%'", bot.id), "the note is on disk while unread");
  release = true;
  await until(() => seen.slice(before).some((s) => /you have not opened it/.test(s.last)), "the nudge");
  await idle(bot.id);
  release = false;
  assert.equal(q.get("SELECT 1 FROM steer_notes WHERE bot_id = ?", bot.id), undefined, "taken in: gone from disk");
  const later = seen.slice(before);
  assert.ok(later.some((s) => /open it in your own computer's browser with browser_open/.test(s.last) && /sklubs-example\.fr/.test(s.last)), "the note's link got the hint");
  assert.ok(later.some((s) => /\[System: the user gave you this link \(https:\/\/sklubs-example\.fr\/page\) and you have not opened it/.test(s.last)), "nudged once");
  assert.equal(later.filter((s) => /you have not opened it/.test(s.last)).length, 1, "only once");
});

test("L94: after a restart an unread note is offered back with « Reprendre ma note »", async () => {
  q.run("INSERT INTO steer_notes (bot_id, thread, text, attachments, created_at) VALUES (?, 0, 'NOTE-FROM-BEFORE', '[]', ?)", bot.id, Date.now());
  assert.equal(recoverNotes(), 1);
  const notice = (await rowsOf(bot.id)).find((r) => r.body.kind === "notice" && r.body.action?.kind === "note")!;
  assert.ok(notice, "a notice with the action");
  assert.match(notice.body.kind === "notice" ? notice.body.text : "", /NOTE-FROM-BEFORE/);
  const id = notice.body.kind === "notice" && notice.body.action?.kind === "note" ? notice.body.action.noteId : 0;
  const before = seen.length;
  const res = await call("POST", `/bots/${bot.id}/notes/${id}/send-again`, { seq: notice.seq });
  assert.equal(res.status, 200);
  await until(() => seen.slice(before).some((s) => /NOTE-FROM-BEFORE/.test(s.last)), "the note sent again");
  assert.equal((await call("POST", `/bots/${bot.id}/notes/${id}/send-again`, { seq: notice.seq })).status, 404, "only once");
  const done = (await rowsOf(bot.id)).find((r) => r.seq === notice.seq)!;
  assert.equal(done.body.kind === "notice" && done.body.action?.kind === "note" ? done.body.action.status : "", "done");
  await idle(bot.id);
});

test("L72 contract: an automatic continuation is used only while the work moves forward", () => {
  grantAuto("bot-x", 0, 3);
  assert.deepEqual(takeAuto("bot-x", 0, { calls: ["a", "b"], loopStopped: false }), { go: true, left: 2, used: 1 });
  assert.deepEqual(takeAuto("bot-x", 0, { calls: ["b", "a"], loopStopped: false }), { go: false, why: "progress" }, "the same calls again: no progress");
  assert.equal(autoLeft("bot-x", 0), 0, "and the grant is over");
  grantAuto("bot-x", 0, 3);
  assert.deepEqual(takeAuto("bot-x", 0, { calls: ["a"], loopStopped: false }), { go: false, why: "progress" }, "one call only");
  grantAuto("bot-x", 0, 3);
  assert.deepEqual(takeAuto("bot-x", 0, { calls: ["a", "b"], loopStopped: true }), { go: false, why: "progress" }, "loop guard");
  assert.deepEqual(takeAuto("bot-y", 0, { calls: ["a", "b"], loopStopped: false }), { go: false, why: "none" });
  grantAuto("bot-x", 0, 99);
  assert.equal(autoLeft("bot-x", 0), 10, "at most 10");
});

test("L72: « Continuer seul jusqu'au bout » carries a long chat task over the step limit by itself, then ends", async () => {
  longSteps = 0;
  await call("POST", `/bots/${bot.id}/messages`, { text: "do the LONGTASK" });
  const notice = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "notice" && r.body.action?.kind === "continue" && r.body.action.status === "pending"), "the step-limit notice");
  assert.equal(notice.body.kind === "notice" && notice.body.action?.kind === "continue" ? notice.body.action.auto : false, true, "« continue alone » is offered");
  await idle(bot.id);
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${notice.seq}/continue`, { auto: true })).status, 200);
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "message" && r.body.text === "finished long task"), "the end of the task", 800);
  await idle(bot.id);
  const n = await notices(bot.id);
  assert.equal(n.filter((t) => /the work is moving forward: I am carrying on on my own \(4 more time\(s\) at most\)/.test(t)).length, 1, n.join(" | "));
  assert.equal(autoLeft(bot.id, 0), 0, "the grant ended with the work");
});

const dbNotices = (id: string) => q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND kind = 'notice' ORDER BY seq", id).map((r) => JSON.parse(r.body).text as string);

test("L84 contract: only a report that reads as partial is checked", () => {
  for (const r of ["Here are the first 3 of 10.", "J'ai traité 4/12 factures.", "Il reste 3 fournisseurs à appeler.", "Pas encore de réponse du site.", "Done so far: the list."]) assert.equal(looksUnfinished(r), true, r);
  for (const r of ["All done: the report is attached.", "C'est fait, les 10 factures sont envoyées.", "Nothing new today."]) assert.equal(looksUnfinished(r), false, r);
});

test("L84: a routine whose report reads as finished costs no check", async () => {
  const b: Bot = (await call("POST", "/bots", { name: "Finisher" })).json.bot;
  const before = seen.length;
  enqueue(b.id, { kind: "routine", name: "Report", text: "Write the full report" });
  await until(() => seen.slice(before).some((s) => /Write the full report/.test(s.last)), "the routine");
  await idle(b.id); await sleep(150);
  assert.ok(!seen.slice(before).some((s) => /You check whether/.test(s.system)));
});

test("L84 contract: verdicts", () => {
  assert.deepEqual(readVerdict('Sure: {"verdict":"continue","reason":"3 of 10"}'), { verdict: "continue", reason: "3 of 10" });
  assert.equal(readVerdict('{"verdict":"maybe"}'), null);
  assert.equal(readVerdict("no json"), null);
});

test("L84: a routine that stops at 3 of 10 is checked, relaunched once, then accepted", async () => {
  const routineBot: Bot = (await call("POST", "/bots", { name: "Collector" })).json.bot;
  checks = ["continue", "done"];
  const before = seen.length;
  enqueue(routineBot.id, { kind: "routine", name: "Collect", text: "Collect 10 items" });
  await until(() => dbNotices(routineBot.id).some((t) => /End check: not finished yet \(7 items left\)\. I am going back to it \(1\/3\)\./.test(t)), "the end check notice");
  await until(() => seen.slice(before).some((s) => /An independent check of your last report found the task not finished: 7 items left/.test(s.last)), "the relaunch");
  await until(() => checks.length === 0 && !q.get("SELECT 1 FROM end_checks WHERE bot_id = ?", routineBot.id), "accepted");
  const checkCalls = seen.slice(before).filter((s) => /You check whether/.test(s.system));
  assert.equal(checkCalls.length, 2);
  assert.equal(checkCalls[0].tools, 0, "the checker has no tools");
  await idle(routineBot.id);
});

test("L84: at most 3 relaunches, then the owner is told", async () => {
  const b: Bot = (await call("POST", "/bots", { name: "Endless" })).json.bot;
  checks = ["continue", "continue", "continue", "continue"];
  enqueue(b.id, { kind: "routine", name: "Endless", text: "Collect 10 items" });
  await until(() => dbNotices(b.id).some((t) => /already went back to it 3 times/.test(t)), "the give-up notice", 1200);
  assert.equal(dbNotices(b.id).filter((t) => /I am going back to it/.test(t)).length, 3);
  await idle(b.id);
});

test("L84: the owner's own chat gets no end check", async () => {
  checks = ["continue"];
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "hello there" });
  await until(() => seen.length > before, "the reply");
  await idle(bot.id); await sleep(100);
  assert.ok(!seen.slice(before).some((s) => /You check whether/.test(s.system)));
  checks = [];
});

test("L97: wait_until frees the bot and wakes it in the same conversation; bounded chain", async () => {
  const b: Bot = (await call("POST", "/bots", { name: "Waiter" })).json.bot;
  await call("POST", `/bots/${b.id}/messages`, { text: "WAITFOR the build" });
  await until(() => q.get("SELECT 1 FROM wake_later WHERE bot_id = ?", b.id), "the wake on disk");
  await idle(b.id);
  assert.ok((await notices(b.id)).some((t) => /^⏰ I will come back to this in 5 min/.test(t)));
  assert.equal(await running(b.id), false, "free meanwhile");
  for (let i = 1; i < MAX_CHAIN + 1; i++) {
    const before = seen.length;
    assert.equal(await fireDueWakes(Date.now() + 6 * 60_000), 1);
    await until(() => seen.slice(before).some((s) => /\[You asked to be woken up here after about 5 min\. Your reason: the build to finish\]/.test(s.last)), `wake ${i}`);
    await idle(b.id);
  }
  // The 6 waits are used: the next one is refused and the bot says where things stand.
  await until(async () => (await rowsOf(b.id)).some((r) => r.body.kind === "message" && /chain over/.test(r.body.text)), "the refusal");
  assert.equal(q.get("SELECT 1 FROM wake_later WHERE bot_id = ?", b.id), undefined);
});

test("teardown", async () => { await closeAllDesktops(); });
