import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// bot_message with wait: true — ask a teammate and get the answer in the same turn; fall back to the ordinary message
// on timeout; refuse a wait that could never end; the route survives in the durable queue.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ask-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "script:script-1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { waitsOn } = await import("../src/agent/team.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Tool results the asking bot received, in order. */
const results: { text: string; isError: boolean }[] = [];
/** What the answering bot's prompt said, in order. */
const answerPrompts: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const res = last.content.find((b) => b.type === "tool_result");
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const who = /You are (\w+)/.exec(req.system)?.[1];
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage }; };
    if (res && res.type === "tool_result") {
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
      if (who === "Asker") results.push({ text, isError: !!res.isError });
      return say(`Done: ${text.slice(0, 200)}`);
    }
    if (who === "Asker") {
      const m = /ask (\w+) (\d+)s: (.*)/.exec(said);
      if (m) return use("bot_message", { bot: m[1], message: m[3], wait: true, wait_seconds: Number(m[2]) });
      return say(`Asker heard: ${said.slice(-80)}`);
    }
    if (who === "Helper") {
      answerPrompts.push(said);
      if (/ask back/.test(said)) return use("bot_message", { bot: "Asker", message: "and you?", wait: true, wait_seconds: 2 });
      if (/slowly/.test(said)) await sleep(1500);
      if (/say nothing/.test(said)) return use("stay_quiet", { reason: "nothing" });
      return say(/2\+2/.test(said) ? "It is 4." : "Answer from Helper.");
    }
    return say("ok");
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
const idle = (id: string) => until(async () => !(await call("GET", "/bots")).json.live[id]?.running, "idle");

let asker: Bot, helper: Bot;
test("setup: two bots", async () => {
  await call("POST", "/auth/signup", { email: "ask@example.com", password: "password-1", locale: "en" });
  asker = (await call("POST", "/bots", { name: "Asker" })).json.bot;
  helper = (await call("POST", "/bots", { name: "Helper" })).json.bot;
});

test("wait: the teammate's answer comes back into the same turn, and its turn is told someone waits", async () => {
  await call("POST", `/bots/${asker.id}/messages`, { text: "ask Helper 5s: what is 2+2?" });
  await until(() => results.length >= 1, "the waited answer");
  assert.match(results[0].text, /Helper answered:\nIt is 4\./);
  assert.equal(results[0].isError, false);
  assert.match(answerPrompts[0], /waiting for your answer right now/);
  await idle(asker.id); await idle(helper.id);
  // The answer is in the tool result, not repeated as a message in the asker's chat.
  const mine = await rowsOf(asker.id);
  assert.equal(mine.some((r) => r.body.kind === "message" && r.body.role === "user" && r.body.origin?.kind === "bot"), false);
  assert.ok(mine.some((r) => r.body.kind === "message" && r.body.text.includes("Done: Helper answered")));
  // The message is in the helper's chat as usual, and its queue row kept the route (so a restart still delivers it).
  const queued = q.all<{ trigger: string }>("SELECT trigger FROM bot_queue WHERE bot_id = ?", helper.id).map((r) => JSON.parse(r.trigger));
  assert.ok(queued.some((t) => t.kind === "bot" && t.ask && t.ask.fromId === asker.id));
});

test("timeout: the wait ends, the tool says so, and the answer arrives later as an ordinary message", async () => {
  const before = results.length;
  await call("POST", `/bots/${asker.id}/messages`, { text: "ask Helper 1s: answer slowly please" });
  await until(() => results.length > before, "the timeout result");
  assert.match(results[before].text, /No answer from Helper within 1 seconds.*later as a new message/);
  await until(async () => (await rowsOf(asker.id)).some((r) => r.body.kind === "message" && r.body.role === "user" && r.body.origin?.kind === "bot" && r.body.text === "Answer from Helper."), "the late answer as a message");
  await idle(asker.id); await idle(helper.id);
});

test("no answer: a teammate that stays quiet is reported as such", async () => {
  const before = results.length;
  await call("POST", `/bots/${asker.id}/messages`, { text: "ask Helper 5s: say nothing" });
  await until(() => results.length > before, "the silent result");
  assert.match(results[before].text, /without an answer/);
  assert.equal(results[before].isError, true);
  await idle(asker.id); await idle(helper.id);
});

test("deadlock: a bot cannot wait on a bot that waits for it; the asker still gets an answer", async () => {
  const before = results.length;
  await call("POST", `/bots/${asker.id}/messages`, { text: "ask Helper 5s: please ask back" });
  await until(() => results.length > before, "the asker's result");
  // Helper tried to wait on Asker, which waits on Helper: refused at once, so Helper answered and Asker got it in time.
  assert.match(results[before].text, /Helper answered:\nDone: Asker is itself waiting for your answer/);
  await idle(asker.id); await idle(helper.id);
  assert.equal(waitsOn(asker.id, helper.id), false, "nobody waits any more");
});

test("hops: a wait never goes past MAX_HOPS", async () => {
  // A message from a bot at the last hop: the asker's turn starts at depth 3, so it may not message (wait or not).
  const { enqueue } = await import("../src/agent/loop.js");
  const before = results.length;
  enqueue(asker.id, { kind: "bot", fromName: "Helper", text: "ask Helper 5s: what is 2+2?", depth: 3 });
  await until(() => results.length > before, "the hop refusal");
  assert.match(results[before].text, /bounced between bots too many times/);
  await idle(asker.id);
});

test("after a restart (nobody waits any more), the answer of a replayed turn still reaches the asker as a message", async () => {
  const { settleAsk } = await import("../src/agent/team.js");
  const { bots } = await import("../src/store.js");
  settleAsk(bots.byId(helper.id)!, { id: "ask_from_before_the_restart", fromId: asker.id }, { lastText: "Answer after restart.", tainted: false, depth: 1, failed: "", paused: false });
  await until(async () => (await rowsOf(asker.id)).some((r) => r.body.kind === "message" && r.body.origin?.kind === "bot" && r.body.text === "Answer after restart."), "the replayed answer");
  await idle(asker.id);
  // Never to a bot of another account.
  const { users } = await import("../src/store.js");
  const other = users.create("other-ask@example.com", "Other", "x", "en");
  const foreign = bots.create(other.id, { name: "Foreign" });
  settleAsk(bots.byId(helper.id)!, { id: "x", fromId: foreign.id }, { lastText: "leak?", tainted: false, depth: 1, failed: "", paused: false });
  await sleep(100);
  assert.equal((await import("../src/store.js")).rows.list(foreign.id, foreign.generation, 50).some((r) => r.body.kind === "message" && r.body.text === "leak?"), false);
});
