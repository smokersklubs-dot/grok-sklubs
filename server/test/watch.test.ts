import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// The turn watch (agent/watch.ts): the first-reply rescue (a turn whose AI says nothing for FIRST_REPLY_RESCUE_SEC gets one
// notice: Wait, Switch AI for this message, Check the connection), the stall notice (no progress for STALL_NOTICE_MIN:
// Keep waiting, Stop and resume), a subscription tool whose process is gone, and the waits that are never silence. Fake
// API providers and a fake subscription engine stay silent, stall or die on cue; the delays are made small by env.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-watch-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "slow:m1";
process.env.FIRST_REPLY_RESCUE_SEC = "0.3";
process.env.STALL_NOTICE_MIN = "0.025"; // 1.5 s
process.env.ENGINE_CPU_SAMPLE_SEC = "0.1";
process.env.ENGINE_TURN_TIMEOUT_MINUTES = "10";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost, ENGINE_SAMPLE, parseEngineSample, engineTurnOf } = await import("../src/agent/engine.js");
const { waitForApproval } = await import("../src/agent/loop.js");
const { closeLeftOpenWatchNotices, watching } = await import("../src/agent/watch.js");
const { rows, bots } = await import("../src/store.js");
const { config } = await import("../src/config.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row, WatchNoticeAction } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const lastWords = (req: TurnRequest) => {
  const last = req.messages[req.messages.length - 1];
  return last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
};
const abortable = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const t = setTimeout(resolve, ms);
  signal?.addEventListener("abort", () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true });
});

/** The bot's own API model: silent, late, or asking another bot and waiting for it, on cue. */
const slowCalls: string[] = [];
let slowAborts = 0;
registerProvider({
  id: "slow", label: "Slow", models: ["m1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const said = lastWords(req);
    const last = req.messages[req.messages.length - 1];
    const res = last.content.find((b) => b.type === "tool_result");
    const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "m1", usage }; };
    if (res && res.type === "tool_result") return say(`Done: ${res.content.map((c) => (c.type === "text" ? c.text : "")).join(" ").slice(0, 80)}`);
    slowCalls.push(said);
    try {
      const ask = /ask (\w+) and wait: (.*)/.exec(said);
      if (ask) return { content: [{ type: "tool_use", id: `c_${slowCalls.length}`, name: "bot_message", input: { bot: ask[1], message: ask[2], wait: true, wait_seconds: 20 } }] as Block[], stopReason: "tool_use", model: "m1", usage };
      const late = /answer after (\d+)ms/.exec(said);
      if (late) { await abortable(Number(late[1]), req.signal); return say("Late, but here."); }
      if (/never answer/.test(said)) { await abortable(60_000, req.signal); return say("never"); }
      return say("Quick answer.");
    } catch (err) { slowAborts++; throw err; }
  },
});
/** The backup model: answers at once. */
const backAsked: string[] = [];
registerProvider({
  id: "back", label: "Back", models: ["b1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const all = req.messages.map((m) => m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n")).join("\n---\n");
    backAsked.push(all);
    req.onText?.("Backup here.");
    return { content: [{ type: "text", text: "Backup here." }] as Block[], stopReason: "end", model: "b1", usage };
  },
});

// ── The fake computer of subscription bots ────────────────────────────────────
/** Per bot: whether its tool's process is gone, and the CPU time its process tree used (what ENGINE_SAMPLE reads). */
const procs = new Map<string, { gone: boolean; cpuMs: number; busy: boolean }>();
const engineInputs: string[] = [];
let ensureDelay = 0;
let engineExits = 0;
const hangUntilAbort = (signal: AbortSignal) => new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
setEngineHost({
  ensure: async () => { if (ensureDelay) await sleep(ensureDelay); },
  ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {}, hold: () => () => {},
  async sample(botId) {
    const p = procs.get(botId);
    if (!p) return null;
    if (p.busy) p.cpuMs += 400;
    return p.gone ? { gone: true } : { gone: false, cpuMs: p.cpuMs };
  },
  async exec(bot, _args, _env, _cwd, input, signal, onLine) {
    engineInputs.push(input);
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    const say = (text: string) => emit({ type: "assistant", message: { content: [{ type: "text", text }] } });
    const p = { gone: false, cpuMs: 1000, busy: false };
    procs.set(bot.id, p);
    try {
      emit({ type: "system", subtype: "init", session_id: `sess-${bot.id}` });
      if (/made no progress|stopped on your computer/.test(input)) say("Picked back up.");
      else if (/engine silent then speak/.test(input)) { await sleep(800); say("There you go."); }
      else if (/engine never answers/.test(input)) { await hangUntilAbort(signal); return { code: 130, stderr: "" }; }
      else if (/engine stuck/.test(input)) { say("Working on it."); await hangUntilAbort(signal); return { code: 130, stderr: "" }; }
      else if (/engine busy/.test(input)) { say("Crunching."); p.busy = true; await hangUntilAbort(signal); return { code: 130, stderr: "" }; }
      else if (/engine dies/.test(input)) {
        // Its process ends, but a helper it started still holds the output open: the run never returns by itself.
        say("Starting.");
        p.gone = true;
        await hangUntilAbort(signal);
        return { code: null, stderr: "" };
      } else if (/engine asks/.test(input)) {
        emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "t1", name: "mcp__sklubot__memory_save", input: { text: "x" } }] } });
        const turn = engineTurnOf(bot.id)!;
        const status = await waitForApproval(turn, { type: "tool_use", id: "t1", name: "memory_save", input: { text: "x" } }, { kind: "ask", policyKey: "memory_save", title: "Allow saving a memory?", reason: "save a memory", source: "Test" });
        emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "t1", content: status, is_error: false }] } });
        say(`Approval: ${status}.`);
      } else say("Engine fine.");
      emit({ type: "result", usage: {} });
      return { code: 0, stderr: "" };
    } finally { engineExits++; }
  },
});
after(() => { setEngineHost(null); });

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
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
type Notice = { seq: number; text: string; action?: any };
const noticesOf = async (id: string): Promise<Notice[]> => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => ({ seq: r.seq, text: (r.body as any).text, action: (r.body as any).action }));
const watchNotices = async (id: string, which?: "silent" | "stalled") => (await noticesOf(id)).filter((n) => n.action?.kind === "watch" && (!which || n.action.watch === which)) as (Notice & { action: WatchNoticeAction })[];
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant").map((r) => (r.body as { text: string }).text);
const running = async (id: string) => !!(await call("GET", "/bots")).json.live[id]?.running;
const idle = (id: string) => until(async () => !(await running(id)) && !watching(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const choose = (id: string, seq: number, choice: string) => call("POST", `/bots/${id}/rows/${seq}/watch`, { choice });

let api1: Bot, lone: Bot, helper: Bot, eng: Bot, solo: Bot;
test("setup: API bots (one with a backup model, one without) and subscription bots", async () => {
  await call("POST", "/auth/signup", { email: "watch@example.com", password: "password-1", locale: "fr" });
  api1 = (await call("POST", "/bots", { name: "Ada" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${api1.id}`, { model: "slow:m1", fallbackModels: ["back:b1"] })).status, 200);
  lone = (await call("POST", "/bots", { name: "Lou" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${lone.id}`, { model: "slow:m1", fallbackModels: [] })).status, 200);
  helper = (await call("POST", "/bots", { name: "Hugo" })).json.bot;
  eng = (await call("POST", "/bots", { name: "Eva" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${eng.id}`, { model: "claude-code:sonnet", fallbackModels: ["back:b1"] })).status, 200);
  solo = (await call("POST", "/bots", { name: "Sol" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${solo.id}`, { model: "claude-code:opus", fallbackModels: [] })).status, 200);
  assert.equal(config.firstReplyRescueMs, 300);
  assert.equal(config.stallNoticeMs, 1500);
});

test("ENGINE_SAMPLE's output is read as gone / alive with CPU ms / unknown", () => {
  assert.deepEqual(parseEngineSample("gone\n"), { gone: true });
  assert.deepEqual(parseEngineSample("alive 1980\n"), { gone: false, cpuMs: 1980 });
  assert.equal(parseEngineSample("none"), null);
  assert.equal(parseEngineSample(""), null);
});

test("API turn: silent past 20 s (here 0.3 s) → one notice with Wait and Switch AI; it settles when the answer comes", async () => {
  await say(api1.id, "please answer after 1000ms");
  const [n] = await until(async () => { const l = await watchNotices(api1.id, "silent"); return l.length ? l : null; }, "rescue notice");
  assert.equal(n.text, "Ada ne répond pas encore.");
  assert.equal(n.action.status, "pending");
  assert.ok(n.action.next, "the bot has a backup: Switch AI is offered");
  assert.equal(n.action.engine, undefined, "no subscription: no connection check");
  // "Wait": the buttons go, the line stays.
  assert.equal((await choose(api1.id, n.seq, "wait")).status, 200);
  assert.equal((await watchNotices(api1.id, "silent"))[0].action.status, "waiting");
  await idle(api1.id);
  const after = (await watchNotices(api1.id, "silent"));
  assert.equal(after.length, 1, "never more than one per turn");
  assert.equal(after[0].action.status, "settled");
  assert.equal(after[0].text, "Ada a commencé à répondre.");
  assert.deepEqual((await replies(api1.id)).slice(-1), ["Late, but here."]);
  assert.equal((await watchNotices(api1.id, "stalled")).length, 0);
  // Over: a choice now is refused.
  assert.equal((await choose(api1.id, n.seq, "switch")).status, 409);
});

test("API turn: Switch AI stops this call and the same message goes on with the next model, told nothing was done", async () => {
  const before = (await watchNotices(api1.id)).length;
  const aborts = slowAborts;
  await say(api1.id, "you will never answer this");
  const n = await until(async () => (await watchNotices(api1.id, "silent")).slice(before)[0], "rescue notice");
  assert.equal(n.action.status, "pending");
  assert.equal((await choose(api1.id, n.seq, "switch")).status, 200);
  await idle(api1.id);
  assert.equal(slowAborts, aborts + 1, "the silent call was stopped");
  assert.deepEqual((await replies(api1.id)).slice(-1), ["Backup here."]);
  assert.match(backAsked[backAsked.length - 1], /you will never answer this/, "the backup got the same message");
  const final = (await watchNotices(api1.id, "silent")).slice(before);
  assert.equal(final.length, 1);
  assert.equal(final[0].action.status, "switched");
  assert.match(final[0].text, /ce message est passé à/);
  assert.equal((await choose(api1.id, n.seq, "switch")).status, 409, "once only");
});

test("API turn without a backup model: no Switch AI (the route refuses it too); Stop ends the turn and the notice", async () => {
  await say(lone.id, "you will never answer this");
  const n = await until(async () => (await watchNotices(lone.id, "silent"))[0], "rescue notice");
  assert.equal(n.action.next, undefined);
  assert.equal((await choose(lone.id, n.seq, "switch")).status, 409);
  assert.equal((await choose(lone.id, n.seq, "stop")).status, 409, "stop belongs to the stall notice");
  // Silent long enough: the stall notice comes, the first one gives way (one set of buttons at a time).
  const s = await until(async () => (await watchNotices(lone.id, "stalled"))[0], "stall notice");
  assert.equal(s.text, "Lou semble bloqué depuis 1 min.");
  assert.equal((await watchNotices(lone.id, "silent"))[0].action.status, "over");
  await call("POST", `/bots/${lone.id}/stop`);
  await idle(lone.id);
  assert.equal((await watchNotices(lone.id, "stalled"))[0].action.status, "over");
});

test("a tool at work is not silence: a bot asking another bot and waiting gets no notice; the one asked (silent) does", async () => {
  const mine = (await watchNotices(api1.id)).length;
  await say(api1.id, "ask Hugo and wait: answer after 2200ms");
  await until(async () => (await replies(api1.id)).some((t) => t.startsWith("Done: Hugo answered")), "the answer", 1000);
  await idle(api1.id);
  assert.equal((await watchNotices(api1.id)).length, mine, "no notice for the bot that waited (longer than the stall delay)");
  const hugo = await watchNotices(helper.id);
  // Silent past both delays: the first notice gave way to the stall notice, which settled when the answer came.
  assert.deepEqual(hugo.map((n) => [n.action.watch, n.action.status]), [["silent", "over"], ["stalled", "settled"]]);
  assert.equal(hugo[1].text, "Hugo semblait bloqué depuis 1 min, puis a repris.");
});

test("subscription turn: silent → notice with Switch AI and the connection check; settles at the first words", async () => {
  await say(eng.id, "engine silent then speak");
  const n = await until(async () => (await watchNotices(eng.id, "silent"))[0], "rescue notice");
  assert.equal(n.action.engine, "claude-code");
  assert.ok(n.action.next);
  await idle(eng.id);
  const [done] = await watchNotices(eng.id, "silent");
  assert.equal(done.action.status, "settled");
  assert.deepEqual((await replies(eng.id)).slice(-1), ["There you go."]);
});

test("subscription turn: Switch AI stops the tool and the message goes to the backup model, told nothing happened yet", async () => {
  const before = (await watchNotices(eng.id)).length;
  const exits = engineExits;
  await say(eng.id, "engine never answers");
  const n = await until(async () => (await watchNotices(eng.id, "silent")).slice(before)[0], "rescue notice");
  assert.equal((await choose(eng.id, n.seq, "switch")).status, 200);
  await idle(eng.id);
  assert.equal(engineExits, exits + 1, "the tool's run ended");
  assert.deepEqual((await replies(eng.id)).slice(-1), ["Backup here."]);
  const told = backAsked[backAsked.length - 1];
  assert.match(told, /did not answer this message at all/);
  assert.match(told, /Nothing has been done or said for it yet/);
  assert.match(told, /engine never answers/);
  const notices = await noticesOf(eng.id);
  assert.ok(!notices.some((x) => /a échoué/.test(x.text)), "no 'failed' notice on top of the switched one");
  assert.equal((await watchNotices(eng.id, "silent")).slice(before)[0].action.status, "switched");
});

test("subscription turn stuck (no event, no CPU) → stall notice; Stop and resume stops it and picks the work back up", async () => {
  const before = (await watchNotices(solo.id)).length;
  await say(solo.id, "engine stuck please");
  const s = await until(async () => (await watchNotices(solo.id, "stalled")).slice(before)[0], "stall notice");
  assert.equal(s.action.status, "pending");
  assert.equal((await watchNotices(solo.id, "silent")).length, 0, "it had said something: no first-reply notice");
  // Keep waiting: buttons go; the line stays. Then Stop and resume still works from "waiting".
  assert.equal((await choose(solo.id, s.seq, "wait")).status, 200);
  assert.equal((await choose(solo.id, s.seq, "stop")).status, 200);
  await until(async () => (await replies(solo.id)).includes("Picked back up."), "the continuation");
  await idle(solo.id);
  const [done] = (await watchNotices(solo.id, "stalled")).slice(before);
  assert.equal(done.action.status, "stopped");
  assert.equal(done.text, "Sol semblait bloqué depuis 1 min : arrêté, et le travail reprend.");
  assert.match(engineInputs[engineInputs.length - 1], /made no progress/);
  assert.ok(!(await noticesOf(solo.id)).some((x) => x.text === "Arrêté."), "no plain 'Stopped.' line");
});

test("subscription turn whose process keeps using CPU is working, however quiet its stream", async () => {
  const before = (await watchNotices(solo.id)).length;
  await say(solo.id, "engine busy crunching");
  await until(async () => (await replies(solo.id)).includes("Crunching."), "first words");
  await sleep(2500);
  assert.equal((await watchNotices(solo.id)).length, before, "no stall notice while the CPU moves");
  await call("POST", `/bots/${solo.id}/stop`);
  await idle(solo.id);
});

test("subscription turn whose process is gone ends at once with a clear notice and Continue (not at the time limit)", async () => {
  const t0 = Date.now();
  await say(solo.id, "engine dies now");
  const gone = await until(async () => (await noticesOf(solo.id)).find((x) => x.action?.kind === "continue" && x.action.reason === "gone"), "gone notice");
  assert.ok(Date.now() - t0 < 5000, "well before the time limit");
  assert.equal(gone.text, "Claude Code s'est arrêté sur mon ordinateur sans finir ce tour. Ce que j'ai déjà fait est gardé. Appuie sur Continuer, ou dis-moi simplement de continuer, pour reprendre.");
  await idle(solo.id);
  assert.equal((await call("POST", `/bots/${solo.id}/rows/${gone.seq}/continue`)).status, 200);
  await until(async () => (await replies(solo.id)).filter((x) => x === "Picked back up.").length === 2, "continued");
  assert.match(engineInputs[engineInputs.length - 1], /stopped on your computer/);
  await idle(solo.id);
});

test("legitimate waits are never silence: an approval waiting inside a subscription turn, a computer that starts slowly", async () => {
  const before = (await watchNotices(eng.id)).length;
  await say(eng.id, "engine asks first");
  const card = await until(async () => (await rowsOf(eng.id)).find((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "approval card");
  await sleep(2200);
  assert.equal((await watchNotices(eng.id)).length, before, "no notice while the approval waits");
  const id = (card.body as any).card.approvalId;
  assert.equal((await call("POST", `/approvals/${id}`, { decision: "allow" })).status, 200);
  await until(async () => (await replies(eng.id)).includes("Approval: allowed."), "answered");
  await idle(eng.id);
  // The computer takes longer to start than both delays: the clock starts when the tool does.
  ensureDelay = 2000;
  try {
    await say(eng.id, "hello there");
    await until(async () => (await replies(eng.id)).filter((x) => x === "Engine fine.").length >= 1, "answer");
    await idle(eng.id);
  } finally { ensureDelay = 0; }
  assert.equal((await watchNotices(eng.id)).length, before, "no notice while the computer started");
});

test("a paused bot's held work and a restart leave no live buttons behind", async () => {
  // A notice left asking by a turn a restart ended becomes history.
  const b = bots.byId(lone.id)!;
  const row = rows.append(b, { kind: "notice", tone: "info", text: "Lou ne répond pas encore.", action: { kind: "watch", watch: "silent", status: "pending" } });
  assert.ok(closeLeftOpenWatchNotices() >= 1);
  const r = rows.get(b.id, row.generation, row.seq)!;
  assert.equal(r.body.kind === "notice" && r.body.action?.kind === "watch" ? r.body.action.status : "", "over");
  assert.equal((await choose(lone.id, row.seq, "wait")).status, 409);
});

test("ENGINE_SAMPLE in the desktop image: a live process tree's CPU, then gone", { skip: !dockerImage() && "no Docker or no sklubot-desktop image" }, () => {
  const script = `sh -c 'echo $$ > /tmp/sklubot-engine.pid; exec sh -c "yes > /dev/null & sleep 2; kill %1; sleep 1"' & sleep 1.5; ${ENGINE_SAMPLE}; sleep 2.5; ${ENGINE_SAMPLE}`;
  const out = execFileSync("docker", ["run", "--rm", "--network", "none", "--entrypoint", "sh", config.desktopImage, "-c", script], { encoding: "utf8", timeout: 60_000 }).trim().split("\n");
  const alive = parseEngineSample(out[0]);
  assert.ok(alive && !alive.gone && alive.cpuMs >= 500, `a busy child counts (${out[0]})`);
  assert.deepEqual(parseEngineSample(out[1]), { gone: true });
});

function dockerImage(): boolean {
  try { execFileSync("docker", ["image", "inspect", process.env.DESKTOP_IMAGE ?? "sklubot-desktop"], { stdio: "ignore", timeout: 10_000 }); return true; } catch { return false; }
}
