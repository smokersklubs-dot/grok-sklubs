import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L174 (RESTE 23/11): run_code — a Python script on the bot's own computer calls Sklubot tools through the bot's tool
// endpoint (/mcp/<bot>), each call through the same gate as a call of the turn. The tests have no Linux computer: the
// script runs here with the real python3, the real client (SKLUBOT_PY) and the real MCP endpoint (handleMcp on a local
// port, as the computer would reach it); only the "write a file / run a command on the computer" step is replaced.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-toolcode-"));
process.env.SESSION_SECRET = "tool-code-secret-tool-code-secret-0001";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["MAX_BOTS", "ANTHROPIC_API_KEY", "XAI_API_KEY", "OPENAI_API_KEY", "DEMO_MODE", "HOSTED_MODE", "DATA_VOLUME", "BOT_LINK", "TOOL_SEARCH"]) delete process.env[k];

let handle: ((botId: string, req: any, res: any, body: unknown) => Promise<void>) | null = null;
const local = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const m = /^\/mcp\/([^/]+)$/.exec(req.url ?? "");
  if (!m || !handle) { res.writeHead(404).end(); return; }
  await handle(decodeURIComponent(m[1]), req, res, JSON.parse(Buffer.concat(chunks).toString() || "null"));
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
process.env.ENGINE_BASE_URL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { handleMcp } = await import("../src/agent/mcp.js");
const { codeHost, runForToken, openRuns, NOT_FROM_CODE, MAX_CALLS, SKLUBOT_PY } = await import("../src/agent/toolcode.js");
const { bots, memories } = await import("../src/store.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
handle = handleMcp;
after(() => { local.closeAllConnections(); local.close(); });

// The computer, replaced: /root/.sklubot/code is a folder here; the command runs with sh.
const box = mkdtempSync(path.join(tmpdir(), "sklubot-toolcode-box-"));
const ran: string[] = [];
codeHost.available = () => true;
codeHost.write = async (_c, file, content) => { const p = file.replace("/root/.sklubot/code", box); mkdirSync(path.dirname(p), { recursive: true }); writeFileSync(p, content); };
codeHost.run = (_c, command, timeout) => new Promise((resolve) => {
  ran.push(command);
  execFile("sh", ["-c", command.replaceAll("/root/.sklubot/code", box)], { timeout: timeout * 1000 }, (err, stdout, stderr) => {
    resolve({ code: err ? ((err as { code?: number }).code ?? 1) : 0, output: `${stdout}${stderr}`, timedOut: !!(err as { killed?: boolean } | null)?.killed, job: false });
  });
});

const SCRIPT = [
  "import sklubot",
  "names = sklubot.tools()",
  "print('LISTED', 'memory_search' in names, 'run_code' in names, 'ask_user' in names)",
  "print('FOUND', sklubot.call('memory_search', query='tea')[:200].replace('\\n', ' '))",
  "for bad in ['run_steps', 'nope_tool']:",
  "    try:",
  "        sklubot.call(bad, steps=[])",
  "    except sklubot.ToolError as e:",
  "        print('REFUSED', bad, str(e)[:80])",
].join("\n");
const results: string[] = [];
let script = SCRIPT;
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const result = last.content.find((b) => b.type === "tool_result");
    if (result && result.type === "tool_result") { results.push(result.content.map((c) => (c.type === "text" ? c.text : "")).join("\n")); return { content: [{ type: "text", text: "done" }], stopReason: "end", model: req.model, usage }; }
    const text = last.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    if (/CODEJOB/.test(text) && req.tools.some((t) => t.name === "run_code")) return { content: [{ type: "tool_use", id: `c${Date.now()}`, name: "run_code", input: { code: script } }] as Block[], stopReason: "tool_use", model: req.model, usage };
    return { content: [{ type: "text", text: "[]" }], stopReason: "end", model: req.model, usage };
  },
});
let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(fn: () => T | Promise<T>, what: string, ms = 30_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as NonNullable<T>; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
}
await call("POST", "/auth/signup", { email: "code@example.com", password: "password-1", locale: "en" });
const botId = (await call("POST", "/bots", { name: "Coder" })).json.bot.id as string;
memories.add(botId, "The owner drinks green tea every morning.", "chat");

test("L174: tokens are per run, per bot, and dead once the run is over", () => {
  assert.equal(runForToken(botId, "Bearer nothing.here"), null);
  assert.equal(runForToken(botId, undefined), null);
  assert.ok(NOT_FROM_CODE.has("run_code") && NOT_FROM_CODE.has("run_steps") && NOT_FROM_CODE.has("ask_user"));
  assert.equal(MAX_CALLS, 40);
  assert.match(SKLUBOT_PY, /ProxyHandler\(\{\}\)/, "the client never goes through a proxy");
});

test("L174: a script lists and calls Sklubot tools through the gated endpoint; forbidden and unknown tools are refused", async () => {
  await call("POST", `/bots/${botId}/messages`, { text: "CODEJOB find what I drink" });
  const out = await until(() => results.find((r) => /LISTED/.test(r)), "the run_code result");
  assert.match(out, /LISTED True False False/, "run_code and ask_user are not offered to scripts");
  assert.match(out, /FOUND .*green tea/);
  assert.match(out, /REFUSED run_steps run_steps cannot be called from a script/);
  assert.match(out, /REFUSED nope_tool Unknown tool/);
  assert.match(out, /Sklubot tool calls in this run: 1 \(memory_search\)/, "refused calls are not counted");
  assert.match(out, /^Exit code 0\./);
  assert.equal(openRuns(), 0, "the token is revoked after the run");
  assert.match(ran[0], /rm -f .*run-[0-9a-f]+\.json/, "config and script removed after the run");
  // The journal holds the nested call like any other call of the bot.
  const journal = (await call("GET", `/journal?limit=50`)).json;
  if (journal?.entries) assert.ok(journal.entries.some((e: any) => e.tool === "memory_search"));
});

test("L174: a token kept by the script after the run is refused by the endpoint", async () => {
  script = "import json, os, sklubot\nprint('CFG', json.load(open(os.environ['SKLUBOT_CODE_CFG']))['token'])";
  results.length = 0;
  await call("POST", `/bots/${botId}/messages`, { text: "CODEJOB keep the token" });
  const out = await until(() => results.find((r) => /CFG/.test(r)), "second run");
  const token = /CFG (\S+)/.exec(out)![1];
  assert.equal(runForToken(botId, `Bearer ${token}`), null);
  const res = await fetch(`${process.env.ENGINE_BASE_URL}/mcp/${botId}`, { method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` }, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list", params: {} }) });
  assert.equal(res.status, 401, "neither a run nor an engine turn: unauthorised");
  void readFileSync;
});

test("L174: without a Linux computer the tool is not offered and refuses", async () => {
  const { codeRefusal } = await import("../src/agent/toolcode.js");
  codeHost.available = () => false;
  const r = codeRefusal({ turn: {}, user: { id: "u" } } as never);
  assert.match(r ?? "", /needs your own Linux computer/);
  codeHost.available = () => true;
});
