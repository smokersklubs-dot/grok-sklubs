import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// A subscription turn whose tool already reported the end of its turn (Codex `turn.completed`) is a finished turn: a
// process that does not exit by itself afterwards is ended after a short grace, and neither that nor a Stop pressed
// meanwhile adds "Stopped." under the reply. Codex's non-fatal `error` items never fail the turn, and its skills-budget
// warning stays out of the chat. The engine's computer is a fake that plays Codex's JSON events.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ef-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ENGINE_EXIT_GRACE_SEC = "0.6";
delete process.env.MAX_BOTS;

const { api } = await import("../src/routes.js");
const { EngineFinished, setEngineHost } = await import("../src/agent/engine.js");
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

// The warning codex-cli prints as a non-fatal `error` item when the computer holds too many skills.
const SKILLS = "Exceeded skills context budget. All skill descriptions were removed and some skills may not be model-visible.";
let warning = SKILLS;
const reasons: unknown[] = [];
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  async exec(_bot, _args, _env, _cwd, input, signal, onLine) {
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    emit({ type: "thread.started", thread_id: "thread-1" });
    emit({ type: "item.completed", item: { id: "w1", type: "error", message: warning } });
    emit({ type: "item.completed", item: { id: "m1", type: "agent_message", text: `Done: ${input.slice(-12)}` } });
    emit({ type: "turn.completed", usage: {} });
    // The process does not exit by itself (a helper holds its output open): it only ends when stopped.
    await new Promise<void>((resolve) => { if (signal.aborted) resolve(); else signal.addEventListener("abort", () => resolve(), { once: true }); });
    reasons.push(signal.reason);
    return { code: 130, stderr: "" };
  },
});
after(() => setEngineHost(null));

let bot: Bot;
const idle = () => until(async () => !(await call("GET", "/bots")).json.live[bot.id]?.running, "idle");
const rowsOf = async (): Promise<Row[]> => (await call("GET", `/bots/${bot.id}/rows?limit=500`)).json.rows;
const notices = (list: Row[]) => list.flatMap((r) => (r.body.kind === "notice" ? [r.body.text] : []));

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "ef@example.com", password: "password-1", locale: "en" });
  bot = (await call("POST", "/bots", { name: "Ef" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "codex:default" })).status, 200);
});

test("a process that stays after turn.completed is ended after the grace: the turn finishes, no « Stopped. »", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "first question" });
  await idle();
  assert.ok(reasons.at(-1) instanceof EngineFinished, "ended by the exit grace");
  const list = await rowsOf();
  assert.ok(list.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.startsWith("Done:")));
  assert.deepEqual(notices(list), [], "no Stopped., no raw skills warning");
});

test("Stop pressed after the reply was delivered is not reported as « Stopped. »", async () => {
  const before = (await rowsOf()).length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "second question" });
  await until(async () => (await rowsOf()).slice(before).some((r) => r.body.kind === "message" && r.body.role === "assistant"), "the reply");
  await call("POST", `/bots/${bot.id}/stop`);
  await idle();
  assert.deepEqual(notices((await rowsOf()).slice(before)), []);
});

test("another non-fatal Codex warning is shown, without failing the turn", async () => {
  warning = "Model metadata for `gpt-x` not found; defaulting to fallback metadata.";
  const before = (await rowsOf()).length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "third question" });
  await idle();
  const fresh = (await rowsOf()).slice(before);
  assert.deepEqual(notices(fresh), [warning]);
  assert.ok(fresh.some((r) => r.body.kind === "message" && r.body.role === "assistant"));
  warning = SKILLS;
});
