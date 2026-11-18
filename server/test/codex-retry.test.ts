import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Codex: a resumed conversation that is gone (computer reset) is retried once as a fresh one — never after the turn
// already produced something. The engine's computer is a fake that plays Codex's real error output.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-cx-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
delete process.env.MAX_BOTS;

const { api } = await import("../src/routes.js");
const { CODEX_LOST_SESSION, setEngineHost } = await import("../src/agent/engine.js");
const { q } = await import("../src/db.js");
import type { Bot, Row } from "../src/shared.js";

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
// The exact words codex-cli 0.169.0 prints on standard error for `codex exec resume <unknown id>` (exit code 1).
const LOST = "Error: thread/resume: thread/resume failed: no rollout found for thread id 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b (code -32600)";

const execs: string[][] = [];
/** "lost": the resume fails as above. "lost-after-output": the resume first does something, then fails the same way. */
let mode: "lost" | "lost-after-output" | "always-lost" | "ok" = "ok";
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  async exec(_bot, args, _env, _cwd, input, _signal, onLine) {
    execs.push(args);
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    const resuming = args[1] === "exec" && args[2] === "resume";
    if ((resuming && mode === "lost") || mode === "always-lost") return { code: 1, stderr: LOST };
    if (resuming && mode === "lost-after-output") {
      emit({ type: "item.started", item: { id: "c1", type: "command_execution", command: "touch done.txt" } });
      emit({ type: "item.completed", item: { id: "c1", type: "command_execution", status: "completed", exit_code: 0 } });
      return { code: 1, stderr: LOST };
    }
    emit({ type: "thread.started", thread_id: "thread-fresh" });
    emit({ type: "item.completed", item: { type: "agent_message", text: `Fine: ${input.slice(-20)}` } });
    emit({ type: "turn.completed", usage: {} });
    return { code: 0, stderr: "" };
  },
});
after(() => setEngineHost(null));

let bot: Bot;
const idle = () => until(async () => !(await call("GET", "/bots")).json.live[bot.id]?.running, "idle");
const rowsOf = async (): Promise<Row[]> => (await call("GET", `/bots/${bot.id}/rows?limit=500`)).json.rows;
const saved = () => q.get<{ session_id: string }>("SELECT session_id FROM engine_sessions WHERE bot_id = ? AND engine = 'codex'", bot.id)?.session_id ?? null;

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "cx@example.com", password: "password-1", locale: "en" });
  bot = (await call("POST", "/bots", { name: "Cx" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "codex:default" })).status, 200);
});

test("the error Codex really prints for a lost conversation is recognised", () => {
  assert.match(LOST, CODEX_LOST_SESSION);
  assert.match("Cannot change this thread's model provider from `openai` to `sklubot_personal` on resume. (code -32600)", CODEX_LOST_SESSION);
  assert.doesNotMatch("Error: stream disconnected before completion", CODEX_LOST_SESSION);
});

test("a lost Codex conversation is forgotten and the turn runs once as a fresh conversation", async () => {
  q.run("INSERT INTO engine_sessions (bot_id, generation, engine, session_id) VALUES (?, ?, 'codex', 'gone-thread') ON CONFLICT DO UPDATE SET session_id = 'gone-thread'", bot.id, 0);
  q.run("UPDATE engine_sessions SET generation = (SELECT generation FROM bots WHERE id = ?) WHERE bot_id = ?", bot.id, bot.id);
  mode = "lost";
  const from = execs.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "after a reset" });
  await idle();
  const runs = execs.slice(from);
  assert.equal(runs.length, 2, runs.map((a) => a.join(" ")).join("\n"));
  assert.deepEqual(runs[0].slice(0, 3), ["codex", "exec", "resume"]);
  assert.ok(runs[0].includes("gone-thread"));
  assert.notEqual(runs[1][2], "resume", "the retry is a fresh conversation");
  assert.equal(saved(), "thread-fresh");
  const list = await rowsOf();
  assert.ok(list.some((r) => r.body.kind === "message" && r.body.text.includes("Fine:")));
  assert.equal(list.some((r) => r.body.kind === "notice" && r.body.tone === "warn" && /rollout/.test(r.body.text)), false, "no error shown");
});

test("never retried once the turn did something: the failure is shown instead", async () => {
  q.run("UPDATE engine_sessions SET session_id = 'gone-again' WHERE bot_id = ? AND engine = 'codex'", bot.id);
  mode = "lost-after-output";
  const from = execs.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "did work then failed" });
  await idle();
  assert.equal(execs.slice(from).length, 1, "not run a second time");
  const list = await rowsOf();
  assert.ok(list.some((r) => r.body.kind === "notice" && /no rollout found/.test(r.body.text)));
});

test("retried at most once, even if the fresh attempt fails the same way", async () => {
  q.run("UPDATE engine_sessions SET session_id = 'gone-third' WHERE bot_id = ? AND engine = 'codex'", bot.id);
  mode = "always-lost";
  const from = execs.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "third" });
  await idle();
  assert.equal(execs.slice(from).length, 2);
  assert.ok((await rowsOf()).some((r) => r.body.kind === "notice" && /no rollout found/.test(r.body.text)));
  mode = "ok";
});

test("a Bot API conversation starts independently of the owner's previous Codex project", async () => {
  q.run("INSERT OR REPLACE INTO engine_sessions (bot_id,generation,engine,session_id) SELECT id,generation,'codex','owner-project' FROM bots WHERE id=?", bot.id);
  const result = await call("POST", `/bots/${bot.id}/api-keys`, { name: "Artifact regression", scopes: ["write"] });
  const before = execs.length;
  const response = await api.request("/v1/bot/messages", { method: "POST",
    headers: { authorization: "Bearer " + result.json.secret, "content-type": "application/json" },
    body: JSON.stringify({ text: "Create a private calculator" }) });
  assert.equal(response.status, 202);
  await until(() => execs.length > before, "API turn");
  await idle();
  assert.ok(!execs[before].includes("resume"));
  assert.equal(saved(), "owner-project");
  assert.ok(q.get("SELECT 1 FROM engine_sessions WHERE bot_id=? AND engine=?", bot.id, "codex:api/" + result.json.key.id));
});
