import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Subscription engines, read from their structured stream fields (L17, L24, L27). The engine's computer is a fake that
// plays lines recorded from the real Claude Code 2.1.330 (2026-11-22: three turns of one session, an unknown model, an
// unknown --resume id, an unreachable MCP server) and the real codex-cli 0.169.0 output when a required MCP server does
// not start. Only the fields Sklubot reads are kept; values are the recorded ones.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-es-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ENGINE_EXIT_GRACE_SEC = "0.3";
delete process.env.MAX_BOTS;
delete process.env.FALLBACK_MODELS;

const { api } = await import("../src/routes.js");
const { EngineToolsMissing, setEngineHost } = await import("../src/agent/engine.js");
const { resetFailureState, setFailureTiming } = await import("../src/agent/failures.js");
const { q } = await import("../src/db.js");
import type { Bot, Row } from "../src/shared.js";

// A new try of a passing failure is planned far away: this file only looks at the card.
setFailureTiming({ retryBaseMs: 3_600_000, retryMaxMs: 3_600_000 });

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

const SESSION = "16f14b09-029c-48ce-9ed0-4649715962ef";
const MCP_OK = [{ name: "sklubot", status: "connected", source: "dynamic" }];
const init = (mcp: unknown = MCP_OK) => ({ type: "system", subtype: "init", session_id: SESSION, tools: [], mcp_servers: mcp, model: "claude-haiku-5-5", claude_code_version: "2.1.330" });
const text = (t: string) => ({ type: "assistant", parent_tool_use_id: null, session_id: SESSION, message: { content: [{ type: "text", text: t }] } });
/** The three recorded results of one session: `usage` is each invocation's own, total_cost_usd / modelUsage the running totals. */
const RESULTS = [
  { usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 649, cache_creation_input_tokens: 3179 }, total_cost_usd: 0.00064399, modelUsage: { "claude-haiku-5-5": { inputTokens: 2, outputTokens: 3, cacheReadInputTokens: 649, cacheCreationInputTokens: 3179, costUSD: 0.00064399 } } },
  { usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 2847, cache_creation_input_tokens: 1019 }, total_cost_usd: 0.00087796, modelUsage: { "claude-haiku-5-5": { inputTokens: 4, outputTokens: 6, cacheReadInputTokens: 3496, cacheCreationInputTokens: 4198, costUSD: 0.00087796 } } },
  { usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 3841, cache_creation_input_tokens: 63 }, total_cost_usd: 0.00093067, modelUsage: { "claude-haiku-5-5": { inputTokens: 6, outputTokens: 9, cacheReadInputTokens: 7337, cacheCreationInputTokens: 4261, costUSD: 0.00093067 } } },
];
const success = (i: number, words: string) => ({ type: "result", subtype: "success", is_error: false, api_error_status: null, terminal_reason: "completed", num_turns: 1, session_id: SESSION, result: words, ...RESULTS[i] });

type Script = (args: string[], emit: (e: unknown) => void, signal: AbortSignal) => Promise<{ code: number | null; stderr: string }>;
let script: Script = async () => ({ code: 0, stderr: "" });
const execs: string[][] = [];
const reasons: unknown[] = [];
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  async exec(_bot, args, _env, _cwd, _input, signal, onLine) {
    execs.push(args);
    const r = await script(args, (e) => onLine(JSON.stringify(e)), signal);
    if (signal.aborted) reasons.push(signal.reason);
    return r;
  },
});
after(() => { setEngineHost(null); resetFailureState(); });

let bot: Bot;
const idle = () => until(async () => !(await call("GET", "/bots")).json.live[bot.id]?.running, "idle");
const rowsOf = async (): Promise<Row[]> => (await call("GET", `/bots/${bot.id}/rows?limit=500`)).json.rows;
async function turn(words: string): Promise<Row[]> {
  const before = (await rowsOf()).length;
  await call("POST", `/bots/${bot.id}/messages`, { text: words });
  await until(async () => (await rowsOf()).length > before + 1, "the turn's rows");
  await idle();
  return (await rowsOf()).slice(before);
}
const notices = (list: Row[]) => list.flatMap((r) => (r.body.kind === "notice" ? [r.body.text] : []));
const replies = (list: Row[]) => list.flatMap((r) => (r.body.kind === "message" && r.body.role === "assistant" ? [r.body.text] : []));
const cards = (list: Row[]) => list.flatMap((r) => (r.body.kind === "card" && r.body.card.type === "failure" ? [r.body.card] : []));

test("setup: a French owner, a bot on Claude Code", async () => {
  await call("POST", "/auth/signup", { email: "es@example.com", password: "password-1", locale: "fr" });
  bot = (await call("POST", "/bots", { name: "Es" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "claude-code:haiku" })).status, 200);
});

test("L17: three turns of one resumed session count each invocation's own tokens, never the session's running total", async () => {
  let n = 0;
  script = async (_args, emit) => { const i = n++; emit(init()); emit(text(`reply ${i}`)); emit(success(i, `reply ${i}`)); return { code: 0, stderr: "" }; };
  for (const w of ["one", "two", "three"]) await turn(w);
  assert.equal(execs.length, 3);
  assert.ok(!execs[0].includes("--resume"), "the first turn starts a session");
  assert.deepEqual(execs.slice(1).map((a) => a[a.indexOf("--resume") + 1]), [SESSION, SESSION], "the next two resume it");
  const lines = q.all<{ input_tokens: number; output_tokens: number; cached_tokens: number }>("SELECT input_tokens, output_tokens, cached_tokens FROM usage WHERE bot_id = ? ORDER BY rowid", bot.id).map((l) => ({ ...l }));
  assert.deepEqual(lines, [
    { input_tokens: 2 + 649 + 3179, output_tokens: 3, cached_tokens: 649 },
    { input_tokens: 2 + 2847 + 1019, output_tokens: 3, cached_tokens: 2847 },
    { input_tokens: 2 + 3841 + 63, output_tokens: 3, cached_tokens: 3841 },
  ]);
  const total = lines.reduce((s, l) => s + l.input_tokens, 0);
  // The session's own running total after turn 3 (modelUsage): what the three lines must add up to, not exceed.
  const m = RESULTS[2].modelUsage["claude-haiku-5-5"];
  assert.equal(total, m.inputTokens + m.cacheReadInputTokens + m.cacheCreationInputTokens);
});

test("L24: Sklubot's tool server failed in init → the tool is stopped at once, nothing it says is shown, one French notice and a server_fault card", async () => {
  execs.length = 0; reasons.length = 0;
  script = async (_args, emit, signal) => {
    emit(init([{ name: "sklubot", status: "failed", source: "dynamic" }]));
    // The real CLI carries on without the tools: whatever it says next must never reach the chat.
    emit(text("Je n'ai pas accès à ta mémoire, mais voici une réponse quand même."));
    await new Promise<void>((r) => { if (signal.aborted) r(); else signal.addEventListener("abort", () => r(), { once: true }); });
    return { code: 130, stderr: "" };
  };
  const fresh = await turn("quatre");
  assert.ok(reasons.at(-1) instanceof EngineToolsMissing, "stopped for missing tools");
  assert.deepEqual(replies(fresh), []);
  const said = notices(fresh);
  assert.equal(said.length, 1);
  assert.match(said[0], /Mes outils Sklubot \(mémoire, coffre, accords\) ne se sont pas joints à Claude Code \(état : failed\)/);
  const c = cards(fresh);
  assert.equal(c.length, 1);
  assert.equal(c[0].cls, "server_fault");
  assert.equal(c[0].status, "pending", "never retried on its own");
  assert.deepEqual(c[0].remedies.slice(0, 2), ["retry", "switch_model"]);
});

test("L24: a server missing from mcp_servers, or needs-auth, stops too; connected and pending go on", async () => {
  for (const [mcp, stops] of [[[], true], [[{ name: "sklubot", status: "needs-auth" }], true], [[{ name: "sklubot", status: "pending" }], false], [MCP_OK, false]] as const) {
    script = async (_args, emit, signal) => {
      emit(init(mcp));
      if (signal.aborted) return { code: 130, stderr: "" };
      emit(text("ok")); emit(success(0, "ok"));
      return { code: 0, stderr: "" };
    };
    const fresh = await turn(`essai ${JSON.stringify(mcp)}`);
    assert.equal(replies(fresh).length, stops ? 0 : 1, JSON.stringify(mcp));
    // The card of the same failure within 10 minutes is the one above, updated (failures.ts DEDUPE_MS): the notice is new.
    assert.equal(notices(fresh).some((t) => /ne se sont pas joints à Claude Code/.test(t)), stops, JSON.stringify(mcp));
  }
});

test("L27: a failure is classed from assistant.error / api_error_status, whatever its words say", async () => {
  const fail = (code: string, status: number | null, words: string) => async (_a: string[], emit: (e: unknown) => void) => {
    emit(init());
    emit({ ...text(words), error: code });
    emit({ type: "result", subtype: "success", is_error: true, api_error_status: status, terminal_reason: "api_error", num_turns: 1, session_id: SESSION, result: words, usage: {} });
    return { code: 1, stderr: "" };
  };
  // Reworded (no English phrase the old patterns knew): the structured code still says "sign in again".
  script = fail("authentication_failed", 401, "Sitzung abgelaufen.");
  let fresh = await turn("cinq");
  assert.deepEqual(replies(fresh), [], "the error's words are not a reply");
  assert.match(notices(fresh)[0], /pas encore connecté à Claude/);
  assert.equal(cards(fresh)[0].cls, "auth_expired");
  assert.equal(cards(fresh)[0].remedies[0], "reconnect");
  // The recorded unknown-model failure: bad_input, not "unknown".
  script = fail("model_not_found", 404, "There's an issue with the selected model (claude-nonexistent-9). It may not exist or you may not have access to it.");
  fresh = await turn("six");
  assert.equal(cards(fresh)[0].cls, "bad_input");
  // A server error in words no pattern knows: provider_down (a passing problem, planned for a new try).
  script = fail("server_error", 500, "Kaputt.");
  fresh = await turn("sept");
  assert.equal(cards(fresh)[0].cls, "provider_down");
  assert.equal(cards(fresh)[0].status, "retrying");
  resetFailureState();
});

test("L27 / OMB 2: the recorded 2.1.330 lost-session result (text in `errors`, no init) starts a fresh session once", async () => {
  execs.length = 0;
  script = async (args, emit) => {
    if (args.includes("--resume")) {
      emit({ type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, session_id: args[args.indexOf("--resume") + 1], errors: [`No conversation found with session ID: ${args[args.indexOf("--resume") + 1]}`], usage: {} });
      return { code: 1, stderr: `No conversation found with session ID: ${args[args.indexOf("--resume") + 1]}` };
    }
    emit(init()); emit(text("nouvelle session")); emit(success(0, "nouvelle session"));
    return { code: 0, stderr: "" };
  };
  const fresh = await turn("huit");
  assert.equal(execs.length, 2, "one resume, then one fresh start");
  assert.ok(execs[0].includes("--resume") && !execs[1].includes("--resume"));
  assert.deepEqual(replies(fresh), ["nouvelle session"]);
  assert.equal(cards(fresh).length, 0, "no failure card");
  assert.ok(!notices(fresh).some((t) => /error_during_execution/.test(t)), "the subtype is never shown as an error");
});

test("L24 Codex: our server is required at startup; when it does not answer, a French notice and a server_fault card", async () => {
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "codex:default" })).status, 200);
  execs.length = 0;
  // codex-cli 0.169.0's own words (exit code 1, no JSON event) when a required MCP server does not start.
  script = async () => ({ code: 1, stderr: "2026-11-22T12:13:19.883395Z ERROR codex_core::session: Failed to create session: required MCP servers failed to initialize: sklubot: handshaking with MCP server failed" });
  const fresh = await turn("neuf");
  const args = execs[0];
  assert.ok(args.includes("mcp_servers.sklubot.required=true"), "required");
  assert.ok(args.includes("mcp_servers.sklubot.startup_timeout_sec=30"));
  assert.match(notices(fresh)[0], /ne se sont pas joints à Codex/);
  assert.equal(cards(fresh)[0].cls, "server_fault");
  assert.equal(cards(fresh)[0].status, "pending");
});
