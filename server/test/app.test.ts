import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Isolated data folder and settings must be in place before the server modules load.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-test-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { nextRun, describeCron } = await import("../src/cron.js");
const { similar } = await import("../src/agent/memory.js");
const { looksReadOnly } = await import("../src/connectors.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

/**
 * A scripted stand-in for a model. The newest user text decides what it does:
 * "call <tool> <json>" asks for that tool; anything else is echoed back. After a tool result it reports it.
 */
const requests: TurnRequest[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      const body = r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : "";
      content = [{ type: "text", text: `Tool said: ${body}` }];
    } else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{.*\})/s.exec(said);
      content = m
        ? [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }]
        : [{ type: "text", text: `Echo: ${said}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 } };
  },
};
registerProvider(scripted);

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null>, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) {
    const v = await probe();
    if (v) return v;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`timed out waiting for ${label}`);
}
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming);

let primary: Bot;

test("the API refuses strangers", async () => {
  assert.equal((await call("GET", "/bots")).status, 401);
  assert.equal((await call("GET", "/me")).json.signupOpen, true);
});

test("the first account is created with a main bot, then signup closes", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "sam@example.com", password: "short" })).status, 400);
  const res = await call("POST", "/auth/signup", { email: "sam@example.com", name: "Sam", password: "correct horse" });
  assert.equal(res.status, 200);
  const list = (await call("GET", "/bots")).json.bots as Bot[];
  assert.equal(list.length, 1);
  assert.equal(list[0].primary, true);
  primary = list[0];
  const saved = cookie;
  cookie = "";
  assert.equal((await call("POST", "/auth/signup", { email: "eve@example.com", password: "long enough pw" })).status, 403);
  assert.equal((await call("POST", "/auth/login", { email: "sam@example.com", password: "wrong" })).status, 401);
  assert.equal((await call("POST", "/auth/login", { email: "SAM@example.com", password: "correct horse" })).status, 200);
  cookie = saved;
});

test("a message gets a streamed reply and is metered", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: "hello there" });
  const reply = await until(async () => lastAssistant(await rowsOf(primary.id)), "reply");
  assert.equal(reply.body.kind === "message" && reply.body.text, "Echo: hello there");
  const sys = requests[requests.length - 1].system;
  assert.match(sys, /You are Juno/);
  assert.match(sys, /Sam/);
  const usage = (await call("GET", "/usage")).json;
  assert.equal(usage.totals.turns >= 1, true);
});

test("tools run and their results go back to the model", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call memory_save {"text":"Sam works in Lyon."}' });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.startsWith("Tool said: Remembered"); }, "tool round trip");
  const bundle = (await call("GET", `/bots/${primary.id}/bundle`)).json;
  assert.equal(bundle.memories[0].text, "Sam works in Lyon.");
  const steps = (await rowsOf(primary.id)).filter((r) => r.body.kind === "step");
  assert.equal(steps[steps.length - 1].body.kind === "step" && steps[steps.length - 1].body.status, "done");
  // The memory now shows up in the next prompt.
  await call("POST", `/bots/${primary.id}/messages`, { text: "where do I work, in Lyon?" });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("where do I work"); }, "second reply");
  assert.match(requests[requests.length - 1].system, /Sam works in Lyon\./);
});

test("a careful bot asks before running a command, and remembers 'always'", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call shell_run {"command":"echo sklubot-ok"}' });
  const card = await until(async () => (await rowsOf(primary.id)).find((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "approval card");
  const live = (await call("GET", "/bots")).json.live[primary.id];
  assert.equal(live.running, false);
  assert.ok(live.awaiting);
  const approvalId = card.body.kind === "card" && card.body.card.type === "approval" ? card.body.card.approvalId : "";
  assert.equal((await call("POST", `/approvals/${approvalId}`, { decision: "always" })).status, 200);
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("sklubot-ok"); }, "command output");
  assert.deepEqual((await call("GET", "/policies")).json.policies, [{ tool: "shell_run", mode: "always_allow" }]);
  // Second time: no card.
  const before = (await rowsOf(primary.id)).filter((r) => r.body.kind === "card").length;
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call shell_run {"command":"echo again-ok"}' });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("again-ok"); }, "second command");
  assert.equal((await rowsOf(primary.id)).filter((r) => r.body.kind === "card").length, before);
  await call("DELETE", `/policies/${encodeURIComponent("shell_run")}`);
});

test("denying an approval tells the model no, and the shell never sees server secrets", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call shell_run {"command":"echo secret=$SESSION_SECRET"}' });
  const card = await until(async () => (await rowsOf(primary.id)).find((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "approval card");
  const id = card.body.kind === "card" && card.body.card.type === "approval" ? card.body.card.approvalId : "";
  await call("POST", `/approvals/${id}`, { decision: "deny" });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("did not allow"); }, "denial");
  // Trusted bots run it; the environment is scrubbed.
  await call("PATCH", `/bots/${primary.id}`, { autonomy: "trusted" });
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call shell_run {"command":"echo secret=[$SESSION_SECRET]"}' });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("secret=[]"); }, "scrubbed env");
});

test("a new message while an approval is open expires it", async () => {
  await call("PATCH", `/bots/${primary.id}`, { autonomy: "careful" });
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call shell_run {"command":"echo never"}' });
  const card = await until(async () => (await rowsOf(primary.id)).find((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"), "approval card");
  await call("POST", `/bots/${primary.id}/messages`, { text: "never mind" });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text === "Echo: never mind"; }, "follow-up");
  const now = (await rowsOf(primary.id)).find((r) => r.seq === card.seq)!;
  assert.equal(now.body.kind === "card" && now.body.card.status, "expired");
});

test("files saved by a bot appear in its library and cannot escape it", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call file_save {"filename":"../../notes/plan.md","content":"# Plan"}' });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("Saved as notes/plan.md"); }, "file saved");
  const root = (await call("GET", `/bots/${primary.id}/files`)).json.entries;
  assert.deepEqual(root.map((e: any) => [e.name, e.dir]), [["notes", true]]);
  assert.equal((await call("GET", `/bots/${primary.id}/files?path=../../../etc`)).status, 400);
  const res = await api.request(`/bots/${primary.id}/files/download?path=notes/plan.md`, { headers: { cookie } });
  assert.equal(await res.text(), "# Plan");
});

test("routines: created by the bot, listed, run on demand and by webhook", async () => {
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call routine_create {"name":"Morning brief","prompt":"Summarise my day.","kind":"cron","schedule":"0 9 * * 1-5","timezone":"Europe/Paris"}' });
  const list = await until(async () => { const r = (await call("GET", `/bots/${primary.id}/routines`)).json.routines; return r.length ? r : null; }, "routine");
  assert.equal(list[0].describe, "Weekdays at 9:00 AM");
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call routine_create {"name":"On deploy","prompt":"Note the deploy.","kind":"webhook"}' });
  const hook = await until(async () => (await call("GET", `/bots/${primary.id}/routines`)).json.routines.find((r: any) => r.trigger === "webhook"), "webhook routine");
  const token = hook.hookUrl.split("/").pop();
  const saved = cookie; cookie = "";
  assert.equal((await call("POST", `/hooks/${token}`, { version: "1.2.3" })).status, 200);
  assert.equal((await call("POST", `/hooks/nope`, {})).status, 404);
  cookie = saved;
  await until(async () => requests.some((r) => JSON.stringify(r.messages).includes("1.2.3") && JSON.stringify(r.messages).includes("On deploy")), "webhook turn");
  assert.equal((await call("POST", `/bots/${primary.id}/messages`, { text: 'call routine_create {"name":"Bad","prompt":"x","kind":"cron","schedule":"99 * * * *"}' })).status, 200);
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("Invalid schedule"); }, "schedule rejected");
});

test("bots message each other, helpers report back, rooms route by mention", async () => {
  const scout = (await call("POST", "/bots", { name: "Scout", label: "Researcher" })).json.bot as Bot;
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call bot_message {"bot":"scout","message":"Find the Q3 numbers."}' });
  const got = await until(async () => (await rowsOf(scout.id)).find((r) => r.body.kind === "message" && r.body.role === "user"), "delivery");
  assert.equal(got.body.kind === "message" && got.body.origin?.name, "Juno");

  await call("POST", `/bots/${primary.id}/messages`, { text: 'call helper_start {"goal":"Count the files.","label":"count"}' });
  await until(async () => (await rowsOf(primary.id)).some((r) => r.body.kind === "message" && r.body.origin?.kind === "bot" && r.body.text.startsWith("Echo:") && r.body.text.includes("Count the files.")), "helper report");
  assert.equal(((await call("GET", "/bots")).json.bots as Bot[]).some((b) => b.name.includes("›")), false, "helpers stay hidden");

  assert.equal((await call("POST", "/rooms", { name: "War room", botIds: [primary.id] })).status, 400);
  const roomId = (await call("POST", "/rooms", { name: "War room", botIds: [primary.id, scout.id] })).json.id;
  const seen = requests.length;
  await call("POST", `/bots/${roomId}/messages`, { text: "@Scout what do you think?" });
  await until(async () => requests.slice(seen).some((r) => r.system.includes("You are Scout") && JSON.stringify(r.messages).includes("War room")), "room dispatch to the mentioned bot");
  assert.equal(requests.slice(seen).some((r) => r.system.includes("You are Juno") && JSON.stringify(r.messages.slice(-1)).includes("what do you think")), false);
  assert.equal((await call("DELETE", `/bots/${primary.id}`)).status, 409);
  assert.equal((await call("DELETE", `/bots/${scout.id}`)).status, 200);
});

test("skills are injected, questions pause the turn, reset starts a fresh conversation", async () => {
  assert.equal((await call("POST", `/bots/${primary.id}/skills`, { name: "", body: "x" })).status, 400);
  await call("POST", `/bots/${primary.id}/skills`, { name: "Weekly report", description: "on Fridays", body: "1. Gather numbers\n2. Write it up" });
  await call("POST", `/bots/${primary.id}/messages`, { text: 'call ask_user {"question":"Which format?","options":["PDF","Doc"]}' });
  const card = await until(async () => (await rowsOf(primary.id)).find((r) => r.body.kind === "card" && r.body.card.type === "question" && r.body.card.status === "pending"), "question card");
  assert.match(requests[requests.length - 1].system, /Weekly report/);
  await call("POST", `/bots/${primary.id}/cards/${card.seq}/answer`, { answer: "PDF" });
  await until(async () => { const r = lastAssistant(await rowsOf(primary.id)); return r?.body.kind === "message" && r.body.text.includes("PDF"); }, "answer handled");
  const gen = (await call("POST", `/bots/${primary.id}/reset`)).json.generation;
  assert.equal(gen, 2);
  assert.equal((await rowsOf(primary.id)).length, 0);
  assert.equal((await call("GET", `/bots/${primary.id}/bundle`)).json.memories.length >= 1, true, "memories survive a reset");
});

test("schedule maths", () => {
  const at = Date.UTC(2030, 0, 4, 12, 0); // a Friday
  assert.equal(new Date(nextRun("0 9 * * 1-5", "Europe/Paris", at)!).toISOString(), "2030-01-07T08:00:00.000Z");
  assert.equal(new Date(nextRun("*/15 * * * *", "UTC", at)!).toISOString(), "2030-01-04T12:15:00.000Z");
  assert.equal(new Date(nextRun("30 6 1 * *", "America/New_York", at)!).toISOString(), "2030-02-01T11:30:00.000Z");
  assert.equal(nextRun("61 * * * *", "UTC", at), null);
  assert.equal(describeCron("0 */2 * * *"), "Every 2 hours");
  assert.equal(describeCron("15 8 * * 0"), "Every Sunday at 8:15 AM");
});

test("memory and connector heuristics", () => {
  assert.equal(similar("Sam works at Acme in Lyon.", "Sam works in Lyon at Acme"), true);
  assert.equal(similar("Sam works at Acme in Lyon.", "Sam prefers short emails."), false);
  assert.equal(looksReadOnly("list_issues"), true);
  assert.equal(looksReadOnly("createIssue"), false);
  assert.equal(looksReadOnly("getIssue"), true);
  assert.equal(looksReadOnly("delete_file", true), true);
});
