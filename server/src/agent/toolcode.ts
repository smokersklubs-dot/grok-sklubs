import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { computerKind, shellAvailable, workspaceOf } from "../computer.js";
import { freeComputerPlan } from "../hosted.js";
import { freeMax } from "../freecomputers.js";
import { JobLimitError, runCommand } from "../jobs.js";
import { botBaseUrl, writeComputerFile } from "../linux.js";
import type { ToolUseBlock } from "../llm/index.js";
import { RUN_STEPS } from "../llm/toolsearch.js";
import { clip } from "../store.js";
import type { Grant } from "../shared.js";
import type { Turn } from "./loop.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * L174 — « du code qui appelle les outils » (backlog A-FAIRE L174, RESTE 23/11; idea from Claude Code's "code mode" and
 * the Hermes audit, our own code). `run_steps` (tools-steps.ts) only chains read-only calls. `run_code` lets the bot write
 * a short Python 3 script that runs on ITS OWN Linux computer (the sandbox where shell_run already runs) and calls
 * Sklubot's tools from the script — loops, filters, joins of several results — in one step of the turn.
 *
 * How a call from the script reaches a tool: the script imports `sklubot` (SKLUBOT_PY below, written next to it), which
 * POSTs MCP JSON-RPC `tools/call` to the bot's existing tool endpoint (/mcp/<bot id>, routes.ts mcpRoute: only reachable
 * from the bots' computers, through their own socket or the internal network; never through the proxy). The request
 * carries a token made for THIS run (32 random bytes, kept here only as a SHA-256 digest, revoked when the run ends,
 * timed out or stopped); agent/mcp.ts hands such a request to `handleCodeMcp` below. Each call then goes through exactly
 * the gate of a normal call of the turn: bindCall (what the server itself sees), authorize (rules, reviewer, floor),
 * the approval card when one is needed (the script waits, as an engine's MCP call does), runReserved (reserved, executed
 * once, journaled, outside content marks the turn), and the loop guard. Nothing is skipped and nothing new is allowed.
 *
 * Limits (documented in docs/CODE-OUTILS.md): Python 3 standard library on the bot's computer; at most MAX_CALLS tool
 * calls and MAX_SCRIPT_CHARS of code per run; MAX_SECONDS at most (a script still running then goes on as a background
 * job, like shell_run, but its token is revoked: its later calls are refused); never run_code, run_steps or a tool that
 * waits for the owner's answer (ask_user…) from a script; only while the turn runs. Not offered where bots have no Linux
 * computer (computerKind), and refused on a hosted free plan when the server gives free plans no computer at all
 * (FREE_COMPUTERS_MAX=0). The script itself runs like shell_run on the bot's sandbox (no permission card for the code; each
 * Sklubot tool it calls is judged on its own).
 */
export const RUN_CODE = "run_code";
export const MAX_CALLS = 40;
export const MAX_SECONDS = 290;
export const DEFAULT_SECONDS = 120;
export const MAX_SCRIPT_CHARS = 20_000;
/** Never from a script: itself, run_steps, and the tools that wait for the owner's own answer. */
export const NOT_FROM_CODE = new Set([RUN_CODE, RUN_STEPS, "ask_user", "connector_request", "secret_request", "plan_propose", "stay_quiet", "ask_takeover"]);
const DIR = "/root/.sklubot/code";

export interface CodeRun { id: string; botId: string; turn: Turn; calls: number; names: string[]; closed: boolean; tainted: boolean }
const runs = new Map<string, { digest: Buffer; run: CodeRun }>();
const digest = (s: string) => createHash("sha256").update(s).digest();

/** Starts a run for this turn; returns it and its token (the token is never stored). */
export function openRun(turn: Turn): { run: CodeRun; token: string } {
  const token = randomBytes(32).toString("hex");
  const run: CodeRun = { id: randomBytes(6).toString("hex"), botId: turn.bot.id, turn, calls: 0, names: [], closed: false, tainted: false };
  runs.set(run.id, { digest: digest(token), run });
  return { run, token: `${run.id}.${token}` };
}
export function closeRun(run: CodeRun) { run.closed = true; runs.delete(run.id); }
export const openRuns = () => runs.size;

/** The run a bearer token belongs to, for this bot only; null otherwise (also after the run ended). */
export function runForToken(botId: string, header: string | undefined): CodeRun | null {
  const raw = String(header ?? "").replace(/^Bearer\s+/i, "");
  const [id, secret] = raw.split(".");
  const entry = id && secret ? runs.get(id) : undefined;
  if (!entry || entry.run.botId !== botId || entry.run.closed) return null;
  return timingSafeEqual(digest(secret), entry.digest) ? entry.run : null;
}

type Part = { type: "text"; text: string } | { type: "image"; data: string; mimeType: string };
const say = (text: string, isError = true) => ({ content: [{ type: "text" as const, text }] as Part[], isError });

/** One tool call from a script, through the same gate as any call of the turn (see mcp.ts handleMcp). */
export async function codeCall(run: CodeRun, name: string, input: Record<string, unknown>): Promise<{ content: Part[]; isError: boolean }> {
  const turn = run.turn;
  if (run.closed || turn.signal.aborted) return say("This run is over: its tool calls are no longer accepted.");
  if (NOT_FROM_CODE.has(name)) return say(`${name} cannot be called from a script: call it on its own, after run_code.`);
  if (!turn.builtin.has(name) && !turn.remote.has(name)) return say(`Unknown tool: ${name}. Call sklubot.tools() for the list.`);
  if (run.calls >= MAX_CALLS) return say(`At most ${MAX_CALLS} tool calls per run: stop here and report what you have.`);
  run.calls++;
  run.names.push(name);
  const { DECLINED, runReserved, waitForApproval } = await import("./loop.js");
  const { authorize } = await import("./authorize.js");
  const { bindCall } = await import("./bind.js");
  const { actionHash } = await import("./executions.js");
  const { approvals } = await import("../store.js");
  const { forgetCall, PARKED, parkedGrant } = await import("./approval-wait.js");
  const { LoopGuard, loopStopText } = await import("./reliability.js");
  const call: ToolUseBlock = { type: "tool_use", id: `code_${run.id}_${run.calls}`, name, input };
  await bindCall(turn, call);
  const verdict = await authorize(turn, call);
  if (verdict.kind === "block") return say(verdict.reason ? `${DECLINED} Why: ${verdict.reason}` : DECLINED);
  let grant: Grant | undefined = verdict.kind === "allow" ? verdict.grant : undefined;
  const asked: { approvalId?: string } = {};
  const hash = actionHash(call.name, call.input);
  const earlier = verdict.kind === "ask" ? parkedGrant(turn.bot.id, hash) : null;
  if (earlier && approvals.consume(earlier, hash)) { forgetCall(earlier); asked.approvalId = earlier; grant = { by: "approval" }; }
  else if (verdict.kind === "ask") {
    const status = await waitForApproval(turn, call, verdict, asked);
    if (status !== "allowed" && status !== "always") return say(status === "parked" ? PARKED : status === "expired" ? "This was not approved: the request was cancelled. Do not retry it unless the user asks." : DECLINED);
    grant = { by: "approval" };
    // Approved after the run was over (timed out, stopped): nothing runs behind the bot's back.
    if (run.closed || turn.signal.aborted) return say("Approved, but this run is over: the action did not run. Make the call on its own if it is still needed.");
  }
  const before = turn.tainted;
  const out: ToolOutput = await runReserved(turn, call, grant, asked.approvalId ?? "", hash, () => {});
  if (turn.tainted && !before) run.tainted = true;
  const why = (turn.guard ??= new LoopGuard()).check(call, out);
  if (why) return say(`Stop now: ${loopStopText(why)}. Doing it again will not help.`);
  const parts: Part[] = typeof out.content === "string" ? [{ type: "text", text: out.content }] : out.content.map((p) => (p.type === "text" ? { type: "text" as const, text: p.text } : { type: "image" as const, data: p.data, mimeType: p.mediaType }));
  return { content: parts, isError: !!out.isError };
}

/** The MCP server a script talks to: the turn's tools minus NOT_FROM_CODE, every call through codeCall. */
export function codeServer(run: CodeRun): Server {
  const server = new Server({ name: "sklubot-code", version: "1.0.0" }, { capabilities: { tools: {} } });
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: run.closed ? [] : run.turn.tools.filter((t) => !NOT_FROM_CODE.has(t.name)).map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema })),
  }));
  server.setRequestHandler(CallToolRequestSchema, async (request) => codeCall(run, request.params.name, (request.params.arguments ?? {}) as Record<string, unknown>));
  return server;
}

/**
 * Called first by agent/mcp.ts handleMcp: a request carrying a run's token is answered here (stateless, plain JSON
 * answers: the SDK's `enableJsonResponse`, dist/esm/server/webStandardStreamableHttp.d.ts "If true, the server will
 * return JSON responses instead of starting an SSE stream"). Returns false for any other request (the engine's own).
 */
export async function handleCodeMcp(botId: string, req: IncomingMessage, res: ServerResponse, body: unknown): Promise<boolean> {
  const run = runForToken(botId, req.headers.authorization);
  if (!run) return false;
  const server = codeServer(run);
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
  res.on("close", () => { void transport.close(); void server.close(); });
  await server.connect(transport);
  await transport.handleRequest(req, res, body);
  return true;
}

/** The small client the script imports (our own code; Python 3 standard library only). */
export const SKLUBOT_PY = `"""Sklubot tools from a run_code script. call(name, **args) -> text; tools() -> names. Each call is checked
like any call of the bot (rules, approvals); a refusal raises ToolError."""
import json, os, urllib.request

_cfg = json.load(open(os.environ["SKLUBOT_CODE_CFG"]))
_open = urllib.request.build_opener(urllib.request.ProxyHandler({}))
_n = 0


class ToolError(Exception):
    pass


def _rpc(method, params):
    global _n
    _n += 1
    req = urllib.request.Request(_cfg["url"], data=json.dumps({"jsonrpc": "2.0", "id": _n, "method": method, "params": params}).encode(),
                                 method="POST", headers={"content-type": "application/json", "accept": "application/json, text/event-stream",
                                                         "authorization": "Bearer " + _cfg["token"]})
    with _open.open(req, timeout=900) as r:
        raw = r.read().decode("utf-8", "replace")
    if not raw.lstrip().startswith("{"):
        raw = [line[5:] for line in raw.splitlines() if line.startswith("data:")][-1]
    msg = json.loads(raw)
    if "error" in msg:
        raise ToolError(msg["error"].get("message", "error"))
    return msg["result"]


def tools():
    return [t["name"] for t in _rpc("tools/list", {})["tools"]]


def call(name, **args):
    res = _rpc("tools/call", {"name": name, "arguments": args})
    text = "\\n".join(p.get("text", "") for p in res.get("content", []) if p.get("type") == "text")
    if res.get("isError"):
        raise ToolError(text)
    return text
`;

/** Where the script, its config and the client go on the computer, and the command that runs it (removes them after). */
export function runPlan(run: CodeRun, token: string): { files: { path: string; content: string }[]; command: string } {
  const cfg = `${DIR}/run-${run.id}.json`, script = `${DIR}/run-${run.id}.py`;
  return {
    files: [
      { path: `${DIR}/sklubot.py`, content: SKLUBOT_PY },
      { path: cfg, content: JSON.stringify({ url: `${botBaseUrl()}/mcp/${encodeURIComponent(run.botId)}`, token }) },
    ],
    command: `cd ${DIR} && SKLUBOT_CODE_CFG=${cfg} python3 ${script}; s=$?; rm -f ${cfg} ${script}; exit $s`,
  };
}

/** How a script is put on the computer and run (replaced in the tests: they have no Linux computer). */
export const codeHost = {
  /** Whether bots here have a Linux computer with a shell (the tool is listed only then: tools.ts). */
  available: () => computerKind() === "linux" && shellAvailable(),
  async write(c: ToolContext, file: string, content: string) { await writeComputerFile(c.bot.id, c.user.id, workspaceOf(c.bot.id), file, content, "600"); },
  async run(c: ToolContext, command: string, timeout: number): Promise<{ code: number | null; output: string; timedOut: boolean; job: boolean }> {
    const r = await runCommand(c.bot, workspaceOf(c.bot.id), command, timeout, { signal: c.signal, thread: c.thread, origin: c.origin, tainted: c.tainted });
    return { code: r.code ?? null, output: r.output, timedOut: !!r.timedOut, job: !!r.job };
  },
};

/** Why run_code may not run for this bot now (English, for the model), or null. */
export function codeRefusal(c: ToolContext): string | null {
  if (!c.turn) return "run_code is only available inside a turn: make the calls one by one.";
  if (!codeHost.available()) return "run_code needs your own Linux computer, and this server gives bots none: make the calls one by one (or several reads at once with run_steps).";
  if (freeComputerPlan(c.user.id) && freeMax() === 0) return "run_code needs a computer, and this plan has none: make the calls one by one (or several reads at once with run_steps).";
  return null;
}

export const toolCodeTools: BuiltinTool[] = [{
  spec: {
    name: RUN_CODE,
    description: `Run a short Python 3 script on your own Linux computer that calls your Sklubot tools, for work that needs a loop, a filter or a join over several tool results (e.g. search, then read each result, then keep the cheapest). In the script: \`import sklubot\`, then \`sklubot.call("tool_name", arg=value)\` returns the tool's text (raises sklubot.ToolError when refused or failed) and \`sklubot.tools()\` lists the names. Every call is checked exactly like a call of your own: one that needs the owner's approval waits for it. Print what you want back. At most ${MAX_CALLS} tool calls and ${MAX_SECONDS} seconds per run; never run_code, run_steps or ask_user from a script. Standard library only.`,
    inputSchema: { type: "object", properties: {
      code: { type: "string", description: "The Python 3 script" },
      timeout_seconds: { type: "integer", description: `Wait at most this many seconds (default ${DEFAULT_SECONDS}, max ${MAX_SECONDS})` },
    }, required: ["code"] },
  },
  activity: "shell", label: "Running code that calls tools", audited: true, detail: (a) => clip(String(a.code ?? "").split("\n").find((l) => l.trim() && !l.trim().startsWith("import")) ?? "", 60),
  async run(a: Record<string, unknown>, c: ToolContext): Promise<ToolOutput> {
    const refused = codeRefusal(c);
    if (refused) return { content: refused, isError: true, summary: "not available" };
    const code = String(a.code ?? "");
    if (!code.trim()) return { content: "Give the script.", isError: true };
    if (code.length > MAX_SCRIPT_CHARS) return { content: `The script is too long (at most ${MAX_SCRIPT_CHARS} characters): split the work.`, isError: true };
    const timeout = Math.min(MAX_SECONDS, Math.max(1, Number(a.timeout_seconds) || DEFAULT_SECONDS));
    const { run, token } = openRun(c.turn as Turn);
    try {
      const plan = runPlan(run, token);
      for (const f of plan.files) await codeHost.write(c, f.path, f.content);
      await codeHost.write(c, `${DIR}/run-${run.id}.py`, code);
      let r: Awaited<ReturnType<typeof codeHost.run>>;
      try { r = await codeHost.run(c, plan.command, timeout); }
      catch (err) { if (err instanceof JobLimitError) return { content: err.message, isError: true, summary: "too many jobs" }; throw err; }
      const calls = run.calls ? `\n\nSklubot tool calls in this run: ${run.calls} (${[...new Set(run.names)].join(", ")}).` : "\n\nNo Sklubot tool was called.";
      const head = r.job ? `Still running after ${timeout}s: it goes on as a background job, but its tool calls are no longer accepted.` : r.timedOut ? `Timed out after ${timeout}s and was stopped.` : `Exit code ${r.code}.`;
      return { content: `${head}\n${clip(r.output, 30_000) || "(no output)"}${calls}`, summary: `${run.calls} call(s) · ${r.timedOut || r.job ? "timed out" : `exit ${r.code}`}`, isError: r.timedOut || r.job || r.code !== 0, ...(run.tainted ? { outside: true } : {}) };
    } finally { closeRun(run); }
  },
}];
