import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L64 (owner decision n° 8): a Claude Code bot loses its WebFetch tool while its own browser is ready, so links open in
// the real browser on its screen; when the browser does not answer (or the computer cannot tell), WebFetch stays.
// A fake computer records the command line and the standing instructions the engine is given.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-webfetch-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { initComputer, closeAllDesktops } = await import("../src/computer.js");
await initComputer(); // Sklubot's browser tools exist on this server (browserAvailable)
const { setEngineHost } = await import("../src/agent/engine.js");
const { claudeToolList, browserReadyFor, NO_WEBFETCH_NOTE } = await import("../src/agent/enginetools.js");
import type { Bot } from "../src/shared.js";

const files = new Map<string, string>();
const runs: string[][] = [];
/** What the fake computer says about the bot's browser: true, false, or no answer at all (an older host). */
let browser: boolean | "throws" | "absent" = true;
const host = {
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {},
  writeFile: async (botId: string, p: string, content: string) => { files.set(`${botId}:${p}`, content); },
  async exec(_bot: unknown, args: string[], _env: unknown, _cwd: string, _input: string, _signal: AbortSignal, onLine: (l: string) => void) {
    runs.push(args);
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    if (args[0] === "codex") { emit({ type: "thread.started", thread_id: "t1" }); emit({ type: "item.completed", item: { type: "agent_message", text: "ok" } }); emit({ type: "turn.completed", usage: {} }); }
    else { emit({ type: "system", subtype: "init", session_id: "s1" }); emit({ type: "assistant", message: { content: [{ type: "text", text: "ok" }] } }); emit({ type: "result", usage: {} }); }
    return { code: 0, stderr: "" };
  },
};
const withBrowser = () => ({ ...host, ...(browser === "absent" ? {} : { browserAnswers: async () => { if (browser === "throws") throw new Error("docker down"); return browser === true; } }) });
after(async () => { setEngineHost(null); await closeAllDesktops(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const toolsOf = (args: string[]) => args[args.indexOf("--tools") + 1];

let bot: Bot;
async function turn(): Promise<{ tools: string; prompt: string; args: string[] }> {
  setEngineHost(withBrowser());
  const n = runs.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "open https://example.com" });
  const args = await until(() => runs[n], "the engine run");
  await until(async () => !(await call("GET", "/bots")).json.live[bot.id]?.running, "idle");
  return { tools: toolsOf(args), prompt: files.get(`${bot.id}:/root/.sklubot/engine-prompt.md`) ?? files.get(`${bot.id}:/root/AGENTS.md`) ?? "", args };
}

test("the tool list: WebFetch only while the browser is not ready; WebSearch always", async () => {
  assert.equal(claudeToolList(false), "Bash,Read,Write,Edit,WebFetch,WebSearch,Task,NotebookEdit");
  assert.equal(claudeToolList(true), "Bash,Read,Write,Edit,WebSearch,Task,NotebookEdit");
  assert.equal(await browserReadyFor(true, async () => true), true);
  assert.equal(await browserReadyFor(false, async () => true), false, "no browser tools on this server");
  assert.equal(await browserReadyFor(true, undefined), false, "a host that cannot tell");
  assert.equal(await browserReadyFor(true, async () => { throw new Error("x"); }), false);
});

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "wf@example.com", password: "password-1", locale: "en" });
  bot = (await call("POST", "/bots", { name: "Wf" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "claude-code:default" })).status, 200);
});

test("Claude Code with its browser ready: no WebFetch, and the standing instructions say to use browser_open", async () => {
  browser = true;
  const r = await turn();
  assert.doesNotMatch(r.tools, /WebFetch/);
  assert.match(r.tools, /WebSearch/);
  assert.ok(r.prompt.endsWith(NO_WEBFETCH_NOTE), "the note is in the engine prompt");
});

test("browser not ready, or the computer cannot tell: WebFetch stays (never without a way to read a page)", async () => {
  for (const state of [false, "throws", "absent"] as const) {
    browser = state;
    const r = await turn();
    assert.match(r.tools, /WebFetch/, `state ${state}`);
    assert.ok(!r.prompt.includes("Your WebFetch tool is off"), `no note when ${state}`);
  }
});

test("Codex: nothing to remove (no page-reading tool of its own), no note", async () => {
  browser = true;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "codex:default" })).status, 200);
  const r = await turn();
  assert.equal(r.args[0], "codex");
  assert.ok(!r.args.includes("--tools"));
  assert.ok(!r.prompt.includes("Your WebFetch tool is off"));
});
