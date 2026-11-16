import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport, type StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { tr } from "./i18n.js";
import { audit, clip, newId, now } from "./store.js";
import { computerKind, workspaceOf } from "./computer.js";
import { ComputersBusyError, computerReady, containerName, docker, holdMachine, onComputerStopping } from "./linux.js";
import { destructiveHint, looksReadOnly, slug } from "./connectors.js";
import type { ToolSpec } from "./llm/types.js";
import type { Locale, LocalToolServer, LocalToolsState } from "./shared.js";

/**
 * Local tool servers: an MCP server that a bot's owner starts with a command (`npx -y some-mcp-server`, `uvx …`) on
 * that bot's OWN Linux computer — never on the Sklubot server — and that Sklubot speaks to over the process's standard
 * input and output (the MCP stdio transport, https://modelcontextprotocol.io/specification/2025-06-18/basic/transports#stdio:
 * newline-delimited JSON-RPC on stdin/stdout, logs on stderr).
 *
 * How the process runs: the SDK's own StdioClientTransport (node_modules/@modelcontextprotocol/sdk/dist/esm/client/stdio.js)
 * spawns a program without a shell (`shell: false`) and frames JSON-RPC over its pipes. The program it spawns here is the
 * docker CLI: `docker exec -i <the bot's container> setsid -w sh -c '<write pid>; exec "$@"' <pidfile> <command> <args…>`.
 * So the command, its arguments and everything it does live inside the bot's container (same sandbox as shell_run:
 * dropped capabilities, no-new-privileges, its own home volume). No shell interprets anything on this host, and no host
 * environment variable reaches the container (docker exec only passes `-e` ones; we pass none). `setsid` makes the
 * server the leader of its own process group, so stopping it (stdin closed, then SIGTERM to the group) also stops what
 * it started (npx → node).
 *
 * Lifecycle: started on demand, when the bot calls one of its tools (or the owner adds it or presses Retry). Its tool
 * list is kept in the database so a turn can offer the tools without waking the computer. It stops when the computer
 * goes to sleep or is wiped (onComputerStopping), and when the server shuts down. A start that fails, or a server that
 * stops on its own, waits before the next start: 5 s, then 10 s, 20 s… up to 5 minutes (reset by a good start or by the
 * owner's Retry). Starting (spawn + initialize + tools/list) is bounded by START_TIMEOUT_MS; each call by
 * CALL_TIMEOUT_MS (the SDK's RequestOptions.timeout, shared/protocol.d.ts). A call is never retried on its own: it may
 * have sent something already.
 *
 * Its tools go through the same permission path as any app's (judge / authorize: a card unless allowed; irreversible
 * ones say so), and what they return is outside content, like any app's (loop.ts).
 *
 * No environment variables: the user's secrets (vault) are bound to hosts and by design never enter a bot's computer
 * (egress.ts adds them outside it); putting one into a process's environment inside the computer would break that, and
 * storing plain values here would put keys in the database. A program that needs an API key can use the credential
 * relay (Settings → the bot → computer), which keeps the key outside.
 */

export const START_TIMEOUT_MS = 120_000; // npx / uvx may first download the package
export const CALL_TIMEOUT_MS = 120_000;
export const MAX_PER_BOT = 10;
const BACKOFF_BASE_MS = 5_000;
const BACKOFF_MAX_MS = 5 * 60_000;
const timeouts = { start: START_TIMEOUT_MS, call: CALL_TIMEOUT_MS };
/** Tests only: shorter timeouts. */
export const setLocalToolTimeouts = (t: Partial<typeof timeouts> | null) => { timeouts.start = t?.start ?? START_TIMEOUT_MS; timeouts.call = t?.call ?? CALL_TIMEOUT_MS; };

// ── How a process is started on a bot's computer (replaceable in tests) ─────────
export interface Launcher {
  /** Null when bots have Linux computers here; else why a local tool server cannot run (an English template). */
  unavailable(): string | null;
  /** Wakes the bot's computer and says what to spawn to run the command in it. */
  params(bot: { id: string; userId: string }, serverId: string, command: string, args: string[]): Promise<StdioServerParameters>;
  /** Stops the server's process group inside the computer (best effort, never wakes it). */
  stop(botId: string, serverId: string): Promise<void>;
  /** Keeps the computer awake while a call runs (linux.ts holdMachine). */
  hold(botId: string): () => void;
}

const NO_COMPUTER = "Local tool servers run on the bot's own Linux computer, and this Sklubot server gives bots no Linux computer (Docker is not available). Ask whoever runs the server to enable Linux computers.";
const pidFile = (serverId: string) => `/tmp/sklubot-tools/${serverId.replace(/[^a-zA-Z0-9_-]/g, "_")}.pid`;
/** What the docker CLI itself needs from this host's environment to reach Docker; nothing else goes to it. */
const DOCKER_ENV = ["PATH", "HOME", "DOCKER_HOST", "DOCKER_CONFIG", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY"];

/**
 * The docker CLI arguments that run `command args…` inside a bot's container as an MCP stdio server. -i keeps standard
 * input open (the JSON-RPC requests); no -t: a terminal would mangle the stream. `setsid -w` (util-linux, in the desktop
 * image's Debian base) makes it the leader of a new process group and waits for it; `sh -c` only writes that pid and
 * execs the command with its arguments exactly as given ("$@"): nothing is re-parsed by a shell.
 */
export function dockerExecArgs(container: string, serverId: string, command: string, args: string[]): string[] {
  return ["exec", "-i", "-w", "/root", container, "setsid", "-w", "sh", "-c", 'mkdir -p /tmp/sklubot-tools && echo $$ > "$0" && exec "$@"', pidFile(serverId), command, ...args];
}

export const dockerLauncher: Launcher = {
  unavailable: () => (computerKind() === "linux" ? null : NO_COMPUTER),
  async params(bot, serverId, command, args) {
    const name = await computerReady(bot.id, bot.userId, workspaceOf(bot.id));
    const env: Record<string, string> = {};
    for (const k of DOCKER_ENV) if (process.env[k]) env[k] = process.env[k]!;
    return { command: "docker", args: dockerExecArgs(name, serverId, command, args), env, stderr: "pipe" };
  },
  async stop(botId, serverId) {
    await docker(["exec", containerName(botId), "sh", "-c", 'p=$(cat "$1" 2>/dev/null); [ -n "$p" ] && kill -TERM -- "-$p" 2>/dev/null; rm -f "$1"; true', "sh", pidFile(serverId)], { timeoutMs: 10_000 });
  },
  hold: (botId) => holdMachine(botId),
};
let launcher: Launcher = dockerLauncher;
/** Tests only: run the command some other way (null: back to the bot's computer). */
export const setLauncher = (l: Launcher | null) => { launcher = l ?? dockerLauncher; };

// ── Records ──────────────────────────────────────────────────────────────────
interface CachedTool { name: string; description: string; readOnly: boolean; destructive: boolean; schema: ToolSpec["inputSchema"] }
interface Rec { id: string; userId: string; botId: string; name: string; command: string; args: string[]; tools: CachedTool[]; createdAt: number }
const parse = <T,>(s: unknown, fallback: T): T => { try { const v = JSON.parse(String(s)); return v ?? fallback; } catch { return fallback; } };
const toRec = (r: any): Rec => ({ id: r.id, userId: r.user_id, botId: r.bot_id, name: r.name, command: r.command, args: parse<string[]>(r.args, []), tools: parse<CachedTool[]>(r.tools, []), createdAt: r.created_at });
const recOf = (id: string) => { const r = q.get("SELECT * FROM local_tool_servers WHERE id = ?", id); return r ? toRec(r) : null; };
const recsOf = (botId: string) => q.all("SELECT * FROM local_tool_servers WHERE bot_id = ? ORDER BY created_at", botId).map(toRec);

/** A program name or path (no spaces, no shell characters) and plain arguments. Returns the problem, or null. */
export function checkCommand(command: unknown, args: unknown): string | null {
  if (typeof command !== "string" || !/^[A-Za-z0-9_./@+:=-]{1,200}$/.test(command)) return "Give the program to run as one word, e.g. npx or uvx (its arguments go in the list below).";
  if (!Array.isArray(args) || args.length > 40) return "At most 40 arguments.";
  for (const a of args) if (typeof a !== "string" || a.length > 1000 || /[\u0000-\u001f\u007f]/.test(a)) return "Each argument is one line of text (1000 characters at most).";
  return null;
}

// ── Live processes ───────────────────────────────────────────────────────────
interface Entry {
  id: string; client: Client | null; status: "stopped" | "starting" | "ready" | "error";
  starting: Promise<void> | null; error: string | null; vars?: Record<string, string>; detail: string;
  failures: number; retryAt: number; closing: boolean;
}
const entries = new Map<string, Entry>();
const entryOf = (id: string): Entry => {
  let e = entries.get(id);
  if (!e) entries.set(id, (e = { id, client: null, status: "stopped", starting: null, error: null, detail: "", failures: 0, retryAt: 0, closing: false }));
  return e;
};
const changed = (userId: string, botId: string) => emit(userId, { type: "localtools", botId });

function fail(e: Entry, rec: Rec, error: string, vars?: Record<string, string>) {
  e.failures++;
  e.retryAt = Date.now() + Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** (e.failures - 1));
  e.status = "error"; e.error = error; e.vars = vars;
  changed(rec.userId, rec.botId);
}

/** Stops a running server on purpose (not a failure): its standard input is closed, then its process group is stopped. */
async function closeEntry(e: Entry, rec: Rec) {
  const client = e.client;
  e.client = null;
  e.closing = true;
  if (e.status === "ready") { e.status = "stopped"; changed(rec.userId, rec.botId); }
  if (!client) return;
  try { await client.close(); } catch { /* already gone */ }
  await launcher.stop(rec.botId, e.id).catch(() => {});
}

/** Starts the server if it is not running (and not waiting after a failure). Throws with the reason when it cannot. */
async function ensureStarted(rec: Rec): Promise<Client> {
  const e = entryOf(rec.id);
  if (e.status === "ready" && e.client) return e.client;
  if (!e.starting) {
    const why = launcher.unavailable();
    if (why) throw new Error(why);
    if (e.status === "error" && Date.now() < e.retryAt) throw new Error(`it failed a moment ago and will be started again in ${Math.ceil((e.retryAt - Date.now()) / 1000)} s`);
    e.starting = start(rec, e).finally(() => { e.starting = null; });
  }
  await e.starting;
  if (e.status !== "ready" || !e.client) throw new Error(tr("en", e.error ?? "it could not start", e.vars));
  return e.client;
}

async function start(rec: Rec, e: Entry) {
  e.status = "starting"; e.error = null; e.detail = ""; e.closing = false;
  changed(rec.userId, rec.botId);
  let transport: StdioClientTransport | null = null;
  let client: Client | null = null;
  try {
    const params = await launcher.params({ id: rec.botId, userId: rec.userId }, rec.id, rec.command, rec.args);
    transport = new StdioClientTransport(params);
    // Its error output: only the last line is kept, to show the owner why it failed (never given to a model).
    transport.stderr?.on("data", (chunk: Buffer) => {
      const last = chunk.toString("utf8").split("\n").map((l) => l.trim()).filter(Boolean).pop();
      if (last) e.detail = clip(last, 300);
    });
    client = new Client({ name: "sklubot", version: "0.1.0" });
    const c = client;
    c.onclose = () => {
      if (e.client !== c) return; // an older process
      if (e.status !== "ready") return; // still starting: the start itself reports the failure
      e.client = null;
      if (e.closing) { e.status = "stopped"; changed(rec.userId, rec.botId); return; }
      // It stopped on its own: whatever it left is stopped, and the next start waits a little longer each time.
      void launcher.stop(rec.botId, rec.id).catch(() => {});
      fail(e, rec, "It stopped on its own.");
    };
    e.client = c;
    await c.connect(transport, { timeout: timeouts.start });
    const listed = await c.listTools(undefined, { timeout: timeouts.start });
    const tools: CachedTool[] = listed.tools.slice(0, 100).map((t) => ({
      name: t.name, description: (t.description ?? "").slice(0, 1000),
      readOnly: looksReadOnly(t.name, t.annotations?.readOnlyHint), destructive: destructiveHint(t.annotations),
      schema: { type: "object", properties: (t.inputSchema?.properties ?? {}) as Record<string, unknown>, required: t.inputSchema?.required },
    }));
    q.run("UPDATE local_tool_servers SET tools = ? WHERE id = ?", JSON.stringify(tools), rec.id);
    e.status = "ready"; e.failures = 0; e.retryAt = 0; e.error = null; e.vars = undefined;
    changed(rec.userId, rec.botId);
  } catch (err) {
    const timedOut = /timed? ?out/i.test(String((err as Error)?.message ?? err));
    const reason = err instanceof ComputersBusyError ? "All the computers of this server are busy right now. It will start when one is free."
      : timedOut ? "The program did not answer as a tool server within {sec} s. Check the command, then press Retry."
      : "The program could not start as a tool server. Check the command, then press Retry.";
    e.client = null;
    e.closing = true;
    try { await client?.close(); } catch { /* not started */ }
    if (!client) try { await transport?.close(); } catch { /* not started */ }
    await launcher.stop(rec.botId, rec.id).catch(() => {});
    fail(e, rec, reason, { sec: String(Math.round(timeouts.start / 1000)) });
  }
}

// The computer goes to sleep (or is wiped): its tool servers stop with it, without counting as a failure.
onComputerStopping((botId) => {
  for (const rec of recsOf(botId)) {
    const e = entries.get(rec.id);
    if (e?.client) void closeEntry(e, rec);
  }
});

function view(rec: Rec, locale: Locale): LocalToolServer {
  const e = entries.get(rec.id);
  const unavailable = launcher.unavailable();
  const retry = e?.status === "error" && e.retryAt > Date.now() ? Math.ceil((e.retryAt - Date.now()) / 1000) : undefined;
  return {
    id: rec.id, botId: rec.botId, name: rec.name, command: rec.command, args: rec.args,
    status: unavailable ? "unavailable" : e?.status ?? "stopped",
    error: unavailable ? tr(locale, unavailable) : e?.status === "error" && e.error ? tr(locale, e.error, e.vars) : null,
    ...(e?.status === "error" && e.detail ? { detail: e.detail } : {}),
    ...(retry ? { retryInSec: retry } : {}),
    tools: rec.tools.map(({ name, description, readOnly }) => ({ name, description, readOnly })),
    createdAt: rec.createdAt,
  };
}

export interface LocalRemoteTool { spec: ToolSpec; connectorId: string; connectorName: string; remoteName: string; readOnly: boolean; destructive: boolean; command: true }

export const localTools = {
  available: () => launcher.unavailable() === null,
  state(botId: string, locale: Locale): LocalToolsState {
    const why = launcher.unavailable();
    return { available: !why, reason: why ? tr(locale, why) : null, servers: recsOf(botId).map((r) => view(r, locale)) };
  },
  get: (id: string) => recOf(id),
  /** Adds a server to a bot (the owner in the web app, or the bot after the owner's yes on a card) and starts it. */
  add(bot: { id: string; userId: string; name: string }, f: { name: string; command: string; args: string[] }, by: "owner" | "bot"): Rec {
    const why = launcher.unavailable();
    if (why) throw new Error(why);
    const problem = checkCommand(f.command, f.args);
    if (problem) throw new Error(problem);
    if (recsOf(bot.id).length >= MAX_PER_BOT) throw new Error("A bot can have 10 local tool servers at most."); // MAX_PER_BOT
    const name = clip(String(f.name ?? "").trim(), 40) || f.command;
    const id = newId("lts");
    q.run("INSERT INTO local_tool_servers (id, user_id, bot_id, name, command, args, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, bot.userId, bot.id, name, f.command, JSON.stringify(f.args), now());
    audit(bot.userId, "apps", `${bot.name}: local tool server added${by === "bot" ? " (approved on a card)" : ""} — ${name}: ${clip([f.command, ...f.args].join(" "), 200)}`, bot.id);
    changed(bot.userId, bot.id);
    return recOf(id)!;
  },
  /** Starts it now (the owner's Retry, or right after adding): the wait after a failure is cleared. */
  async start(id: string): Promise<void> {
    const rec = recOf(id);
    if (!rec) return;
    const e = entryOf(id);
    if (e.status === "error") { e.retryAt = 0; e.failures = 0; }
    await ensureStarted(rec).catch(() => {});
  },
  async stop(id: string) {
    const rec = recOf(id);
    const e = entries.get(id);
    if (rec && e) await closeEntry(e, rec);
  },
  async remove(id: string) {
    const rec = recOf(id);
    if (!rec) return;
    const e = entries.get(id);
    if (e) await closeEntry(e, rec);
    entries.delete(id);
    q.run("DELETE FROM local_tool_servers WHERE id = ?", id);
    audit(rec.userId, "apps", `Local tool server removed: ${rec.name}`, rec.botId);
    changed(rec.userId, rec.botId);
  },
  /**
   * The tools a bot's local servers offer, from the list each gave when it last started: no computer is woken for this.
   * A server that never listed its tools yet is started in the background (unless it is waiting after a failure).
   */
  toolsFor(botId: string): LocalRemoteTool[] {
    if (launcher.unavailable()) return [];
    const out: LocalRemoteTool[] = [];
    for (const rec of recsOf(botId)) {
      const e = entries.get(rec.id);
      if (!rec.tools.length && !e?.starting && !(e?.status === "error" && Date.now() < e.retryAt)) void ensureStarted(rec).catch(() => {});
      for (const t of rec.tools)
        out.push({
          spec: { name: `cmd_${slug(rec.name)}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), description: `[${rec.name}, on your computer] ${t.description}`, inputSchema: t.schema },
          connectorId: rec.id, connectorName: rec.name, remoteName: t.name, readOnly: t.readOnly, destructive: t.destructive, command: true,
        });
    }
    return out;
  },
  /** Calls one tool, starting the server first if needed. The computer stays awake while the call runs. */
  async call(id: string, tool: string, args: Record<string, unknown>, signal?: AbortSignal): Promise<{ text: string; isError: boolean }> {
    const rec = recOf(id);
    if (!rec) throw new Error("this local tool server was removed");
    let client: Client;
    try { client = await ensureStarted(rec); } catch (err) { throw new Error(`the local tool server "${rec.name}" is not running: ${(err as Error).message}`); }
    const release = launcher.hold(rec.botId);
    try {
      const res = await client.callTool({ name: tool, arguments: args }, undefined, { timeout: timeouts.call, signal });
      const parts = Array.isArray(res.content) ? res.content : [];
      const text = parts.map((p: any) => (p.type === "text" ? p.text : `[${p.type} content]`)).join("\n") || JSON.stringify(res.structuredContent ?? {});
      return { text: text.length > 60_000 ? text.slice(0, 60_000) + "\n…[truncated]" : text, isError: res.isError === true };
    } finally { release(); }
  },
  closeAll: () => Promise.all([...entries.values()].map(async (e) => { const rec = recOf(e.id); if (rec) await closeEntry(e, rec); })),
};
