import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { botPathOf, computerKind, screen } from "../computer.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import { botBaseUrl, containerName, docker, machineOf, mayControlProcesses } from "../linux.js";
import type { Attachment, Engine, EngineRuntime, EngineStatus } from "../shared.js";
import { bots, clip, rows, type BotRecord } from "../store.js";
import { noteSubscription, record } from "../usage.js";
import { activity, Caption, expireEngineApprovals, interrupt, StreamingRow, type Turn } from "./loop.js";
import { getLive, setLive } from "../bus.js";
import { buildSystemPrompt } from "./prompt.js";
import { imageService } from "../images.js";
import { browserAvailable } from "../computer.js";
import { noteDiskTrouble } from "../disk.js";
import { claudeLimitFrom, claudeLimitFromText, codexLimitFrom, noteEngineLimit, type LimitHit } from "./sublimit.js";
import { callSignal, EngineGone, setEngineSampler, SwitchModel, watchExec, watchOutput, watchProgress, watchTool, watchToolsDone, watchWait, type EngineSample } from "./watch.js";

/**
 * Bots that run on their owner's own subscription. Each turn is handed to the provider's official
 * command-line tool (Claude Code for a Claude plan, Codex for a ChatGPT plan) inside the bot's own Linux
 * computer, where the owner signed in once. The tool runs its own agent loop with its own shell, file and
 * web tools; Sklubot's tools (memory, routines, apps, vault, team, screen…) reach it through an MCP
 * endpoint of this server, with the usual approvals.
 *
 * Command-line options used here were checked against each tool's --help (Claude Code 2.1.325,
 * Codex 0.169.0) and their documentation: code.claude.com/docs/en/cli-reference and
 * developers.openai.com/codex/noninteractive.
 */
export const isEngineRef = (ref: string | null | undefined): boolean => !!ref && /^(claude-code|codex):/.test(ref);
export const engineOf = (ref: string): Engine => (ref.startsWith("codex:") ? "codex" : "claude-code");
const modelOf = (ref: string) => ref.slice(ref.indexOf(":") + 1);

/**
 * The secret a bot's computer presents to this server's tool endpoint: a fresh random token for each
 * subscription turn, kept only in this server's memory and revoked when the turn ends. Outside a turn the
 * endpoint answers no one, and a token copied from the computer is useless once that turn is over.
 */
const turnTokens = new Map<string, Buffer>();
const digest = (s: string) => createHash("sha256").update(s).digest();
export function engineTokenValid(botId: string, given: string): boolean {
  const want = turnTokens.get(botId);
  return !!want && !!given && timingSafeEqual(digest(given), want);
}
/** For tests and tools: starts a token for a bot's turn (runEngineTurn does this itself). */
export function issueEngineToken(botId: string): string {
  const token = randomBytes(32).toString("hex");
  turnTokens.set(botId, digest(token));
  return token;
}
export const revokeEngineToken = (botId: string) => { turnTokens.delete(botId); };

const claudeOption = (m: string) => ({ ref: `claude-code:${m}`, provider: "Claude (subscription)", model: m, kind: "subscription" as const, engine: "claude-code" as const });
const codexOption = (m: string) => ({ ref: `codex:${m}`, provider: "ChatGPT (subscription)", model: m, kind: "subscription" as const, engine: "codex" as const });

/**
 * Every subscription choice this server accepts (only when bots have Linux computers): the configured lists plus the
 * Codex models discovered lately (see engineModelsFor). Used to check a model a bot picks for a new bot.
 */
export function engineModels() {
  if (computerKind() !== "linux") return [];
  const codex = new Set(config.codexModels);
  for (const c of codexCatalogs.values()) for (const m of c.models) codex.add(m);
  return [...config.claudeCodeModels.map(claudeOption), ...[...codex].map(codexOption)];
}

// ── The real model list of the subscription tools ───────────────────────────
/**
 * Codex: `codex debug models` "Render the raw model catalog as JSON" (codex debug --help, codex-cli 0.169.0, the
 * version in the desktop image): {"models":[{"slug", "visibility": "list" | "hide", "priority", ...}]}. Run as is it
 * refreshes the catalog for the signed-in account (falling back to the one bundled with the binary); `--bundled` "Skip
 * refresh and dump only the bundled catalog shipped with this binary" (codex debug models --help). Same technique as
 * SuperBot (superbot server/src/adapters/codex.rs:62-80, cached 10 minutes in adapters/mod.rs:65-78).
 * Claude Code: no documented command lists the models (claude --help, code.claude.com/docs/en/cli-reference only document
 * --model with aliases or full names), so its list stays the configured CLAUDE_CODE_MODELS.
 */
const CATALOG_TTL_MS = 10 * 60_000;
/** A failed discovery is not retried for a minute (the configured list is offered meanwhile). */
const CATALOG_RETRY_MS = 60_000;
const CATALOG_TIMEOUT_MS = 20_000;
/** Per user ("" = the bundled catalog of the desktop image): when it was read and the models it lists, in its order. */
const codexCatalogs = new Map<string, { at: number; models: string[] }>();
const catalogFailures = new Map<string, number>();
const catalogReads = new Map<string, Promise<string[] | null>>();

/** The models a `codex debug models` catalog offers in its picker ("list" visibility), by priority; [] if unreadable. */
export function parseCodexCatalog(raw: string): string[] {
  let j: any;
  try { j = JSON.parse(raw); } catch { return []; }
  const list: any[] = Array.isArray(j?.models) ? j.models : [];
  const seen = new Set<string>();
  return list
    .filter((m) => m && typeof m.slug === "string" && /^[A-Za-z0-9][\w.:-]{0,79}$/.test(m.slug) && (m.visibility === undefined || m.visibility === "list"))
    .sort((a, b) => (Number.isFinite(a.priority) ? a.priority : 1e9) - (Number.isFinite(b.priority) ? b.priority : 1e9))
    .map((m) => m.slug as string)
    .filter((slug) => !seen.has(slug) && !!seen.add(slug));
}

/**
 * Where the catalog is read when none of the user's computers is on: a throwaway container of the desktop image, with no
 * network, dumping the catalog bundled with its Codex. Never wakes a bot's computer. Tests replace it.
 */
type CatalogRunner = () => Promise<string | null>;
const bundledCatalog: CatalogRunner = async () => {
  // Labelled and unprivileged like every container of Sklubot: the Docker proxy (dockerproxy.ts) refuses any other.
  const r = await docker(["run", "--rm", "--network", "none", "--memory", "512m", "--cap-drop", "ALL", "--security-opt", "no-new-privileges", "--label", "sklubot=catalog", "--entrypoint", "codex", config.desktopImage, "debug", "models", "--bundled"], { timeoutMs: CATALOG_TIMEOUT_MS, maxBytes: 8_000_000 });
  return r.code === 0 && !r.timedOut ? r.stdout.toString("utf8") : null;
};
let catalogRunner: CatalogRunner = bundledCatalog;
/** For tests: replace the throwaway reader (null puts the real one back) and forget what was cached. */
export function setCatalogRunner(fn: CatalogRunner | null) { catalogRunner = fn ?? bundledCatalog; codexCatalogs.clear(); catalogFailures.clear(); catalogReads.clear(); }

async function readCodexCatalog(key: string, read: () => Promise<string | null>): Promise<string[] | null> {
  const cached = codexCatalogs.get(key);
  if (cached && Date.now() - cached.at < CATALOG_TTL_MS) return cached.models;
  if (Date.now() - (catalogFailures.get(key) ?? 0) < CATALOG_RETRY_MS) return null;
  const inflight = catalogReads.get(key);
  if (inflight) return inflight;
  const job = (async () => {
    const raw = await read().catch(() => null);
    const models = raw ? parseCodexCatalog(raw) : [];
    if (!models.length) { catalogFailures.set(key, Date.now()); return null; }
    codexCatalogs.set(key, { at: Date.now(), models });
    catalogFailures.delete(key);
    return models;
  })();
  catalogReads.set(key, job);
  try { return await job; } finally { catalogReads.delete(key); }
}

/**
 * The subscription choices for one user's model picker. Codex: the catalog read in a computer of theirs that is on
 * (`prefer` first: the bot whose settings are open), which knows their account, else the image's bundled catalog;
 * cached 10 minutes; on any failure or timeout, the configured CODEX_MODELS. "default" (Codex picks) always comes first.
 */
export async function engineModelsFor(userId: string, prefer?: string) {
  return computerKind() === "linux" ? subscriptionChoices(userId, prefer) : [];
}
/** engineModelsFor without the check for Linux computers (tests run without them). */
export async function subscriptionChoices(userId: string, prefer?: string) {
  const mine = bots.list(userId, true).filter((b) => b.kind === "agent").map((b) => b.id);
  const order = prefer && mine.includes(prefer) ? [prefer, ...mine.filter((id) => id !== prefer)] : mine;
  const awake = order.find((id) => host.awake(id));
  let found: string[] | null = null;
  if (awake && host.probe) {
    const probe = host.probe;
    found = await readCodexCatalog(userId, async () => {
      // --bundled: never touch the account. Without it Codex refreshes the account's catalog, which can refresh its
      // sign-in token while a turn of this bot holds the old one; OpenAI's refresh tokens are single-use, so the turn
      // then fails with "your refresh token was already used" and the user has to sign in again.
      const r = await probe(awake, ["codex", "debug", "models", "--bundled"], CATALOG_TIMEOUT_MS);
      return r.code === 0 ? r.stdout : null;
    });
  }
  found ??= await readCodexCatalog("", () => catalogRunner());
  const codex = found ? [...new Set(["default", ...found])] : config.codexModels;
  return [...config.claudeCodeModels.map(claudeOption), ...codex.map(codexOption)];
}

/**
 * The bot's thinking effort (Bot.effort: low | medium | high | xhigh) for the subscription tools; nothing when unset.
 * - Claude Code: `--effort <level>` "Effort level for the current session (low, medium, high, xhigh, max)" (claude --help,
 *   Claude Code 2.1.325; code.claude.com/docs/en/cli-reference). SuperBot passes it the same way
 *   (superbot server/src/adapters/claude.rs:30-31).
 * - Codex: `-c model_reasoning_effort="<level>"`, the config key model_reasoning_effort (Codex configuration reference,
 *   developers.openai.com/codex/config-reference; `-c key=value` per codex exec --help). Checked with codex-cli 0.169.0:
 *   `codex exec -c model_reasoning_effort="high"` prints "reasoning effort: high". The levels each model takes are its
 *   supported_reasoning_levels in `codex debug models`: low, medium, high and xhigh for every listed model. SuperBot:
 *   superbot server/src/adapters/codex.rs:25-26.
 * Sklubot's four levels exist in both tools under the same names, so they pass through unchanged.
 */
const ENGINE_EFFORTS = new Set(["low", "medium", "high", "xhigh"]);
export function effortArgs(engine: Engine, effort: string | null | undefined): string[] {
  if (!effort || !ENGINE_EFFORTS.has(effort)) return [];
  return engine === "codex" ? ["-c", `model_reasoning_effort="${effort}"`] : ["--effort", effort];
}

// While a subscription turn runs, the tool calls it makes share its state (stop signal, caution after
// reading outside content, depth of bot-to-bot exchanges).
const runningTurns = new Map<string, Turn>();
export const engineTurnOf = (botId: string) => runningTurns.get(botId) ?? null;

// ── Sessions: each bot keeps one tool session per conversation ───────────────
q.run("CREATE TABLE IF NOT EXISTS engine_sessions (bot_id TEXT NOT NULL, generation INTEGER NOT NULL, engine TEXT NOT NULL, session_id TEXT NOT NULL, PRIMARY KEY (bot_id, generation, engine))");
const sessionOf = (botId: string, generation: number, engine: Engine) =>
  q.get<{ session_id: string }>("SELECT session_id FROM engine_sessions WHERE bot_id = ? AND generation = ? AND engine = ?", botId, generation, engine)?.session_id ?? null;
const saveSession = (botId: string, generation: number, engine: Engine, id: string) =>
  q.run("INSERT INTO engine_sessions (bot_id, generation, engine, session_id) VALUES (?, ?, ?, ?) ON CONFLICT(bot_id, generation, engine) DO UPDATE SET session_id = excluded.session_id", botId, generation, engine, id);
const dropSession = (botId: string, generation: number, engine: Engine) =>
  q.run("DELETE FROM engine_sessions WHERE bot_id = ? AND generation = ? AND engine = ?", botId, generation, engine);

// ── Talking to the bot's computer ────────────────────────────────────────────
/**
 * Everything the subscription engine needs from the bot's computer. The real one talks to its container; tests put a
 * fake in its place (setEngineHost) to play the tool's event stream and its calls to our tool endpoint.
 */
export interface EngineHost {
  /** Makes sure the computer is on (and its screen ready, see readyForTurn). */
  ensure(bot: BotRecord): Promise<void>;
  writeFile(botId: string, path: string, content: string): Promise<void>;
  exec(bot: BotRecord, args: string[], env: Record<string, string>, cwd: string, input: string, signal: AbortSignal, onLine: (line: string) => void): Promise<{ code: number | null; stderr: string }>;
  /** Stops every engine process on the computer (a stuck tool, a helper it left behind). */
  kill(botId: string): Promise<void>;
  /** The screen check before a turn (B-2). Errors are the caller's to log. */
  ready(bot: BotRecord): Promise<void>;
  /** Whether the computer is on right now (never wakes it). */
  awake(botId: string): boolean;
  /**
   * Marks the computer busy while a turn (or a side request) runs in it, so it is never put to sleep meanwhile; returns
   * the release. Optional: a host without it (a test's fake) has nothing to keep awake.
   */
  hold?(bot: BotRecord): (() => void) | Promise<() => void>;
  /** The computer a bot works on (its own, or a shared one): what the one-tool-at-a-time lock is keyed by. */
  machineOf?(botId: string): string;
  /** Runs a short command in the computer if it is on (never wakes it): for the model list (engineModelsFor). */
  probe?(botId: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string }>;
  /**
   * The turn watch (watch.ts) looks at the running tool's process: gone from the computer, or alive with the CPU time its
   * process tree used so far; null when it cannot tell. Optional: a host without it is not looked at.
   */
  sample?(botId: string): Promise<EngineSample | null>;
}

const dockerHost: EngineHost = {
  async ensure(bot) {
    if (computerKind() !== "linux") throw new Error("Subscriptions need the bots' Linux computers (Docker and the desktop image) on this server.");
    await screen.wake(bot.id, bot.userId);
  },
  async writeFile(botId, path, content) {
    const r = await docker(["exec", "-i", containerName(botId), "sh", "-c", `umask 077; mkdir -p "$(dirname '${path}')"; cat > '${path}'`], { timeoutMs: 20_000, input: content });
    if (r.code !== 0) throw new Error(`could not prepare the bot's computer: ${r.stderr.trim().slice(0, 200)}`);
  },
  exec: (bot, args, env, cwd, input, signal, onLine) => runInComputer(bot, args, env, cwd, input, signal, onLine),
  kill: (botId) => killEngineProcesses(botId),
  ready: (bot) => screen.ready(bot.id, bot.userId),
  awake: (botId) => screen.isOpen(botId),
  hold: (bot) => screen.holdTurn(bot.id, bot.userId),
  machineOf: (botId) => machineOf(botId),
  async probe(botId, args, timeoutMs) {
    if (!screen.isOpen(botId)) return { code: null, stdout: "" };
    const r = await docker(["exec", containerName(botId), ...args], { timeoutMs, maxBytes: 8_000_000 });
    return { code: r.timedOut ? null : r.code, stdout: r.stdout.toString("utf8") };
  },
  async sample(botId) {
    if (!screen.isOpen(botId)) return null;
    const r = await docker(["exec", containerName(botId), "sh", "-c", ENGINE_SAMPLE], { timeoutMs: 10_000 });
    return r.code === 0 && !r.timedOut ? parseEngineSample(r.stdout.toString("utf8")) : null;
  },
};

/**
 * One look at the running tool's process (the pid the wrapper wrote down, ENGINE_WRAPPER): "gone" when that process no
 * longer exists, else "alive <ms>", the CPU time (user + system) of it and every process under it, from /proc/<pid>/stat
 * fields 14 and 15 (utime, stime, in clock ticks: proc(5)) and the parent pid of each process (field 4); the command name
 * (field 2, in parentheses) may hold spaces, so fields are counted after its closing parenthesis. "none": no pid written.
 * Only sh, cat, awk and getconf are needed: all in the desktop image (checked in sklubot-desktop: /usr/bin/awk,
 * /usr/bin/getconf; a busy child process was counted, 1 980 ms for about 2 s of `yes`).
 */
export const ENGINE_SAMPLE = String.raw`pid=$(cat /tmp/sklubot-engine.pid 2>/dev/null); if [ -z "$pid" ]; then echo none; exit 0; fi; if [ ! -d /proc/$pid ]; then echo gone; exit 0; fi; cat /proc/[0-9]*/stat 2>/dev/null | awk -v root="$pid" -v hz="$(getconf CLK_TCK 2>/dev/null || echo 100)" '{ p=$1; s=$0; sub(/^.*\) /, "", s); split(s, f, " "); par[p]=f[2]; t[p]=f[12]+f[13] } END { n=0; for (p in t) { x=p; for (i=0; i<64 && x!="" && x!=root && x>1; i++) x=par[x]; if (x==root) n+=t[p] } printf "alive %d\n", n*1000/hz }'`;
export function parseEngineSample(out: string): EngineSample | null {
  const text = out.trim();
  if (text === "gone") return { gone: true };
  const m = /^alive (\d+)$/.exec(text);
  return m ? { gone: false, cpuMs: Number(m[1]) } : null;
}

/** The tools' own processes only (and the one whose id the last turn wrote down); the desktop keeps running. */
async function killEngineProcesses(botId: string) {
  // A shared computer driven by another bot right now: its tool is that bot's, not this one's (Part B).
  if (!mayControlProcesses(botId)) return;
  await docker(["exec", containerName(botId), "sh", "-c", "kill -TERM $(cat /tmp/sklubot-engine.pid 2>/dev/null) 2>/dev/null; pkill -TERM -f '^(node .*)?claude( |$)' ; pkill -TERM -f '^(node .*)?codex( |$)'; sleep 1; pkill -KILL -f '^(node .*)?claude( |$)'; pkill -KILL -f '^(node .*)?codex( |$)'; rm -f /tmp/sklubot-engine.pid; true"], { timeoutMs: 20_000 });
}
let host: EngineHost = dockerHost;
/** How the turn watch looks at a running tool's process: through the computer this file talks to. */
const sampleEngine = (botId: string) => (host.sample ? host.sample(botId) : Promise.resolve(null));
/** For tests: replace the computer the engine talks to (null puts the real one back). */
export const setEngineHost = (h: EngineHost | null) => { host = h ?? dockerHost; };
const writeFile = (botId: string, path: string, content: string) => host.writeFile(botId, path, content);
const ensureComputer = (bot: BotRecord) => host.ensure(bot);

// ── The engine's state, for the engine panel (B-4) ──────────────────────────
const runtime = new Map<string, { status: EngineRuntime["status"]; error: string | null; since: number }>();
const restarting = new Map<string, Promise<void>>();
const noteRuntime = (botId: string, status: EngineRuntime["status"], error: string | null = null) => { runtime.set(botId, { status, error, since: Date.now() }); };

/** What the engine panel shows: working while a turn runs, starting during a restart, the last failure, or ready / stopped. */
export function engineRuntime(bot: BotRecord): EngineRuntime {
  const engine = isEngineRef(bot.model) ? engineOf(bot.model) : null;
  const model = isEngineRef(bot.model) ? modelOf(bot.model) || "default" : "";
  const known = runtime.get(bot.id);
  if (restarting.has(bot.id)) return { engine, model, status: "starting", error: null, since: known?.since ?? Date.now() };
  if (runningTurns.has(bot.id)) return { engine, model, status: "working", error: null, since: known?.since ?? Date.now() };
  if (known?.status === "error") return { engine, model, ...known };
  if (computerKind() === "linux" && !host.awake(bot.id)) return { engine, model, status: "stopped", error: null, since: known?.since ?? Date.now() };
  return { engine, model, status: "ready", error: null, since: known?.since ?? Date.now() };
}

/**
 * "Restart the engine" (B-4): stops the turn under way and every engine process on the bot's computer, lets the
 * approvals it was waiting on lapse (the source keeps them; we do not, see B-5), then wakes the computer and checks the
 * tool in the background. The bot's conversation with the tool is kept (its session is resumed on the next turn).
 * Returns at once with the new state (usually "starting").
 */
export async function restartEngine(bot: BotRecord): Promise<EngineRuntime> {
  if (!isEngineRef(bot.model)) throw new EngineRestartRefused("This bot does not run on a subscription engine, so there is nothing to restart.");
  const pending = restarting.get(bot.id);
  if (pending) return engineRuntime(bot);
  interrupt(bot.id);
  expireEngineApprovals(bot.id);
  const job = (async () => {
    try {
      await host.kill(bot.id).catch((err) => console.error(`[engine restart ${bot.id}] kill`, err));
      // The stopped turn winds down (its process is gone): wait for it, 10 s at most.
      for (let i = 0; i < 100 && runningTurns.has(bot.id); i++) await pause(100);
      await host.ensure(bot);
      await host.ready(bot).catch((err) => console.error(`[engine restart ${bot.id}] screen`, err));
      noteRuntime(bot.id, "ready");
    } catch (err) {
      noteRuntime(bot.id, "error", clip(String((err as Error)?.message ?? err), 300));
    }
  })();
  restarting.set(bot.id, job);
  void job.finally(() => restarting.delete(bot.id));
  return engineRuntime(bot);
}
export class EngineRestartRefused extends Error {}
/** For tests: waits for a restart under way to finish. */
export const restartSettled = (botId: string) => restarting.get(botId) ?? Promise.resolve();

/** A bot is deleted: its engine processes stop and its saved sessions are forgotten (U-003). */
export async function retireEngine(botId: string) {
  q.run("DELETE FROM engine_sessions WHERE bot_id = ?", botId);
  runtime.delete(botId);
  if (host.awake(botId)) await host.kill(botId);
}

/** The engine's own "find the right tool" calls: no row, no step, only a caption (B-3.2, B-7.1). */
const TOOL_SEARCH = /^(ToolSearch|tool_search|search_tools?)$/i;

/**
 * The engine names tools from an MCP server "mcp" + underscores + server + underscores + tool. For our own server the
 * prefix goes and the tool is found among ours without regard to case (an engine may lower-case names); a tool of
 * another server keeps its own name, and the server is remembered for the activity shown.
 */
export function normalizeToolName(turn: Turn, raw: string): { name: string; server: string | null } {
  const m = /^mcp_+(.+?)_+(.+)$/i.exec(raw);
  if (!m) return { name: raw, server: null };
  if (m[1].toLowerCase() === "sklubot") return { name: ownToolName(turn, m[2]), server: null };
  return { name: m[2], server: m[1] };
}
/** One of our tools, by its name in any case; unknown names are returned as they are. */
export function ownToolName(turn: Turn, raw: string): string {
  if (turn.builtin.has(raw) || turn.remote.has(raw)) return raw;
  const low = raw.toLowerCase();
  for (const k of [...turn.builtin.keys(), ...turn.remote.keys()]) if (k.toLowerCase() === low) return k;
  return raw;
}

function toolLabel(name: string, server: string | null, turn: Turn): string {
  const loc = turn.user.locale;
  if (server) return tr(loc, "Using {app}", { app: server });
  const builtin = turn.builtin.get(name);
  if (builtin) return tr(loc, builtin.label);
  const remote = turn.remote.get(name);
  if (remote) return tr(loc, "Using {app}", { app: remote.connectorName });
  const own: Record<string, string> = {
    Bash: "Running a command", command_execution: "Running a command", Read: "Reading a file", Write: "Saving a file", Edit: "Saving a file",
    NotebookEdit: "Saving a file", file_change: "Saving a file", WebSearch: "Searching the web", web_search: "Searching the web",
    WebFetch: "Reading a page", Task: "Starting a helper", TodoWrite: "Planning",
  };
  return tr(loc, own[name] ?? "Working");
}

function activityOf(name: string, server: string | null, turn: Turn) {
  if (server) return "connector" as const;
  const builtin = turn.builtin.get(name);
  if (builtin) return builtin.activity;
  if (turn.remote.has(name)) return "connector" as const;
  if (/Bash|command/.test(name)) return "shell" as const;
  if (/WebSearch|web_search/.test(name)) return "searching" as const;
  if (/WebFetch/.test(name)) return "reading" as const;
  if (/screen_|browser_open|page_read/.test(name)) return "computer" as const;
  if (/memory|skill|conversation/.test(name)) return "remembering" as const;
  if (/app_/.test(name)) return "connector" as const;
  return "thinking" as const;
}

type StepStatus = "running" | "done" | "error" | "waiting" | "denied";
/** A tool row of the running engine turn, waiting to be matched with the call our tool endpoint receives (B-3). */
export interface EngineStep {
  seq: number; callId: string; name: string; claimed: boolean; done: boolean;
  /** What our side knew about the call when it ended (status and summary); it wins over a guess from the raw output. */
  declared: { status: StepStatus; summary?: string } | null;
}
const turnSteps = new Map<string, EngineStep[]>();
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Our tool endpoint received a call: the oldest row of this bot's running turn with that tool name, not claimed yet
 * and not finished, is this call's row (first in, first out: of two parallel calls of one tool, the first call
 * received takes the first row announced). The stream announces a call just before the engine runs it, so this looks
 * again every 40 ms for up to 600 ms. No row (or no turn: a session of the engine outside the app): null.
 */
export async function claimStep(botId: string, name: string, waitMs = 600): Promise<EngineStep | null> {
  const deadline = Date.now() + waitMs;
  for (;;) {
    const step = turnSteps.get(botId)?.find((x) => x.name === name && !x.claimed && !x.done);
    if (step) { step.claimed = true; return step; }
    if (Date.now() >= deadline || !runningTurns.has(botId)) return null;
    await pause(40);
  }
}

/**
 * Sets a claimed row's status from our side: "waiting" while an approval is open, "running" once allowed, or the
 * result (done / error / denied, with a short summary), which is remembered and shown at once.
 */
export function markStep(botId: string, step: EngineStep | null, status: StepStatus, summary?: string) {
  if (!step) return;
  const turn = runningTurns.get(botId);
  if (!turn) return;
  if (status === "done" || status === "error" || status === "denied") step.declared = { status, summary };
  const row = rows.get(turn.bot.id, turn.generation, step.seq);
  if (row?.body.kind === "step") rows.rewrite(turn.bot, turn.generation, step.seq, { ...row.body, status, summary: summary !== undefined ? clip(summary, 200) : row.body.summary });
}

/** A guess at how a call went, from the tool's raw output, when our side said nothing about it. */
export function guessOutcome(raw: string, ok: boolean): { status: StepStatus; summary: string } {
  const text = raw.trim();
  try {
    const j = JSON.parse(text);
    if (j && typeof j === "object") {
      if (j.error) return { status: "error", summary: clip(typeof j.error === "string" ? j.error : JSON.stringify(j.error), 200) };
      const code = j.exit_code ?? j.exitCode;
      if (typeof code === "number" && code !== 0) return { status: "error", summary: `exit code ${code}` };
      if (j.success === false) return { status: "error", summary: clip(String(j.message ?? "failed"), 200) };
    }
  } catch { /* not JSON */ }
  if (/^(tool )?error\b/i.test(text) || !ok) return { status: "error", summary: clip(text.replace(/\s+/g, " "), 200) };
  return { status: "done", summary: clip(text.replace(/\s+/g, " "), 80) };
}

/**
 * Tool-internal warnings that mean nothing to the person chatting, logged instead of shown. "Exceeded skills context budget.
 * All skill descriptions were removed…": Codex lists the skills it finds on the computer (its own bundled ones and any
 * installed there) within a small share of the context, and drops their descriptions when there are too many. Sklubot
 * gives Codex no skills of its own (the bot's skills are in its instructions, AGENTS.md), so there is nothing to fix here.
 */
const TOOL_NOISE: RegExp[] = [/skills? context budget/i, /^falling back from websockets to https transport\b/i];

/** Turns the tool's own events into chat rows: streamed replies, steps, the thinking caption and the step counter. */
class Transcript {
  readonly stream: StreamingRow;
  readonly caption: Caption;
  readonly steps: EngineStep[] = [];
  constructor(private turn: Turn) {
    this.stream = new StreamingRow(turn);
    this.caption = new Caption(turn);
    turnSteps.set(turn.bot.id, this.steps);
  }
  text(delta: string) {
    if (!this.stream.started && !getLive(this.turn.bot.id).awaiting) activity(this.turn, "writing");
    this.stream.push(delta);
  }
  endMessage() {
    const said = this.stream.finish();
    if (said) { this.turn.spoke = true; this.turn.lastText = said; }
  }
  /** A whole message that was not streamed piece by piece. */
  message(text: string) {
    if (!text.trim()) return;
    this.text(text);
    this.endMessage();
  }
  stepStart(id: string, raw: string, args: Record<string, unknown>) {
    const { user, bot } = this.turn;
    watchOutput(bot.id);
    if (TOOL_SEARCH.test(raw)) { setLive(user.id, bot.id, { caption: tr(user.locale, "Finding the right tool") }); return; }
    if (this.steps.some((x) => x.callId === id)) return;
    this.endMessage();
    const { name, server } = normalizeToolName(this.turn, raw);
    const short: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args ?? {})) short[k] = typeof v === "string" ? clip(v, 400) : v;
    const seq = rows.append(bot, { kind: "step", callId: id, tool: name, label: toolLabel(name, server, this.turn), status: "running", args: short }).seq;
    this.steps.push({ seq, callId: id, name, claimed: false, done: false, declared: null });
    // A tool at work (a command, a page, one of ours waiting for an approval) is not silence (watch.ts).
    watchTool(bot.id, id, true);
    // The counter moves on even while the bot waits for the user; only then the activity stays as it is.
    const count = this.steps.length;
    if (getLive(bot.id).awaiting) setLive(user.id, bot.id, { steps: count });
    else setLive(user.id, bot.id, { running: true, awaiting: null, steps: count, caption: null, activity: { kind: activityOf(name, server, this.turn), detail: server ?? this.turn.remote.get(name)?.connectorName ?? name.replace(/_/g, " "), since: Date.now() } });
  }
  /** The tool's result arrived in the stream (once per call id): found by call id, never by name. */
  stepEnd(id: string, ok: boolean, raw: string) {
    const step = this.steps.find((x) => x.callId === id);
    if (!step || step.done) return;
    step.done = true;
    watchTool(this.turn.bot.id, id, false);
    const row = rows.get(this.turn.bot.id, this.turn.generation, step.seq);
    if (row?.body.kind === "step") {
      const guess = guessOutcome(raw, ok);
      const d = step.declared;
      const status = d && d.status !== "running" ? d.status : guess.status;
      const summary = d?.summary ?? guess.summary;
      rows.rewrite(this.turn.bot, this.turn.generation, step.seq, { ...row.body, status, summary: clip(summary, 200) });
    }
    if (!getLive(this.turn.bot.id).awaiting) activity(this.turn, "thinking");
  }
  /** End of the turn: rows still running or waiting become done (success) or error, "stopped" / "did not finish". */
  close(success: boolean, aborted: boolean, timedOut = false) {
    const loc = this.turn.user.locale;
    for (const step of this.steps) {
      const row = rows.get(this.turn.bot.id, this.turn.generation, step.seq);
      if (row?.body.kind !== "step" || (row.body.status !== "running" && row.body.status !== "waiting")) continue;
      rows.rewrite(this.turn.bot, this.turn.generation, step.seq, success ? { ...row.body, status: "done" } : { ...row.body, status: "error", summary: tr(loc, timedOut ? "time limit reached" : aborted ? "stopped" : "did not finish") });
    }
    if (turnSteps.get(this.turn.bot.id) === this.steps) turnSteps.delete(this.turn.bot.id);
    watchToolsDone(this.turn.bot.id);
  }
  notice(text: string, tone: "info" | "warn" | "error" = "warn") {
    this.endMessage();
    noteDiskTrouble(this.turn.bot, text);
    rows.append(this.turn.bot, { kind: "notice", tone, text });
    this.failed = true;
    this.lastFailure = clip(text, 300);
  }
  /**
   * A non-fatal message from the tool (Codex's `error` item: "Describes a non-fatal error surfaced as an item" —
   * codex-rs/exec/src/exec_events.rs). It never fails the turn. Known tool-internal noise (TOOL_NOISE) goes to the server
   * log only; anything else is shown as a notice.
   */
  warning(text: string) {
    const clean = clip(text.replace(/\s+/g, " ").trim(), 300);
    if (!clean) return;
    if (TOOL_NOISE.some((re) => re.test(clean))) { console.warn(`[engine ${this.turn.bot.name}] ${clean}`); return; }
    this.endMessage();
    noteDiskTrouble(this.turn.bot, clean);
    rows.append(this.turn.bot, { kind: "notice", tone: "warn", text: clean });
  }
  /** The tool reported the end of its turn (its reply is delivered): a stop from now on is not "Stopped." (see watchedExec). */
  ended = false;
  /** Set by watchedExec while the tool runs: ends a process that does not exit by itself after the turn's end. */
  onEnded: (() => void) | null = null;
  turnEnded() {
    this.ended = true;
    this.onEnded?.();
  }
  failed = false;
  /** The tool itself ended on this failure (not a passing error item): a backup model may take the turn over. */
  fatal = false;
  /** The user moved this message to the next model before the tool said anything ("Switch AI", watch.ts). */
  switched = false;
  lastFailure = "";
  /** The subscription is at its usage limit (sublimit.ts): until when. Said by the loop, not as a failure notice. */
  limited: { until: number; engine: Engine } | null = null;
  /** The tool ended on the plan's usage limit: the account's engine is limited until T, and the turn says nothing itself. */
  limit(hit: LimitHit, failure: string) {
    this.endMessage();
    const engine = engineOf(this.turn.bot.model);
    this.limited = { until: noteEngineLimit(this.turn.user.id, engine, hit), engine };
    this.failed = true;
    this.fatal = true;
    this.lastFailure = clip(failure, 300);
  }
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => (c?.type === "text" ? c.text : "")).join(" ") : "";

/** Runs one command in the bot's computer and feeds each line of its output to `onLine`. Stopping sends it an interrupt. */
function runInComputer(bot: BotRecord, args: string[], env: Record<string, string>, cwd: string, input: string, signal: AbortSignal, onLine: (line: string) => void): Promise<{ code: number | null; stderr: string }> {
  const name = containerName(bot.id);
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // The process id is written down so that "stop" can interrupt the tool inside the computer.
  // A secret for the tool (the MCP token of a Codex turn) is never passed with `docker exec -e`, where it would show in
  // this server's process list and in the exec's inspect data: it was written to a file first (SECRET_ENV_FILE), which
  // the wrapper reads into the variable and deletes before the tool starts.
  const child = spawn("docker", ["exec", "-i", "-w", cwd, ...envArgs, name, "sh", "-c", ENGINE_WRAPPER, "sh", ...args], { stdio: ["pipe", "pipe", "pipe"] });
  // Stop (or the turn's time limit): an interrupt first, so the tool can wind down and save its session. A tool that is
  // hung and ignores it is killed 15 s later, inside the computer and here, so the bot's queue never stays blocked.
  let escalate: NodeJS.Timeout | null = null;
  const stop = () => {
    void docker(["exec", name, "sh", "-c", "kill -INT $(cat /tmp/sklubot-engine.pid) 2>/dev/null"], { timeoutMs: 10_000 });
    // A process already gone (its helpers may still hold the output open) or a tool that never said a word and whose
    // message goes to another model: nothing to save, so no grace (watch.ts).
    const quick = signal.reason instanceof EngineGone || signal.reason instanceof SwitchModel || signal.reason instanceof EngineFinished;
    escalate = setTimeout(() => { void killEngineProcesses(bot.id).finally(() => { if (child.exitCode === null) child.kill("SIGKILL"); }); }, quick ? 1000 : ENGINE_KILL_GRACE_MS);
  };
  signal.addEventListener("abort", stop, { once: true });
  let buffer = "", stderr = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffer += chunk.toString("utf8");
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (line) { try { onLine(line); } catch (err) { console.error("[engine line]", err); } }
    }
  });
  child.stderr.on("data", (c: Buffer) => { stderr = (stderr + c.toString("utf8")).slice(-4000); });
  child.stdin.on("error", () => {}); // the tool may exit before reading everything
  child.stdin.end(input);
  return new Promise((resolve) => child.on("close", (code) => { signal.removeEventListener("abort", stop); if (escalate) clearTimeout(escalate); if (buffer.trim()) { try { onLine(buffer.trim()); } catch { /* ignore */ } } resolve({ code, stderr }); }));
}

/** Where a turn's secret variables wait for the wrapper (mode 600, removed as soon as read). */
export const SECRET_ENV_FILE = "/root/.sklubot/turn-secrets.env";
/** Writes the pid down (for "stop"), loads and deletes the secret variables if any, then runs the tool. */
const SUBSCRIPTION_ENV = "unset OPENAI_API_KEY CODEX_API_KEY ANTHROPIC_API_KEY ANTHROPIC_AUTH_TOKEN ANTHROPIC_BASE_URL CLAUDE_CODE_USE_BEDROCK CLAUDE_CODE_USE_VERTEX CLAUDE_CODE_USE_FOUNDRY";
export const ENGINE_WRAPPER = `echo $$ > /tmp/sklubot-engine.pid; if [ -f ${SECRET_ENV_FILE} ]; then set -a; . ${SECRET_ENV_FILE}; set +a; rm -f ${SECRET_ENV_FILE}; fi; ${SUBSCRIPTION_ENV}; exec "$@"`;
/** The file's content: KEY='value' lines (values are hex tokens; single quotes inside are escaped anyway). */
export const secretEnvFile = (vars: Record<string, string>) => Object.entries(vars).map(([k, v]) => `${k}='${v.replace(/'/g, `'\\''`)}'`).join("\n") + "\n";

/** How long a stopped tool gets to exit on its interrupt before it is killed. */
const ENGINE_KILL_GRACE_MS = 15_000;

const NOT_SIGNED_IN = /not logged in|please run \/login|login required|not authenticated|unauthorized|401/i;

// ── One turn ─────────────────────────────────────────────────────────────────
/**
 * The reason a subscription turn is aborted with when it reaches its time limit (ENGINE_TURN_TIMEOUT_MINUTES), so it is
 * told apart from the user's "Stop" (an abort without a reason). See SuperBot's runner for the same idea of a stop reason
 * (superbot server/src/runner.rs:177-186, 238-268).
 */
export class EngineTimeout extends Error {
  constructor(readonly limitMs: number) { super(`the turn reached its time limit (${Math.round(limitMs / 60_000)} min)`); this.name = "EngineTimeout"; }
}
/** Why a tool's process is ended after it reported the end of its turn: it did not exit by itself (watchedExec). */
export class EngineFinished extends Error {
  constructor() { super("the tool reported the end of its turn but did not exit"); this.name = "EngineFinished"; }
}
export const isEngineTimeout = (reason: unknown): reason is EngineTimeout => reason instanceof EngineTimeout;

/**
 * How a subscription turn ended, for a backup model that may take over (loop.ts): `failure` is what the tool said when it
 * failed (empty: it did not); `steps` are the chat rows of what it did meanwhile (never done again by the backup).
 */
export interface EngineOutcome {
  failure: string; steps: number[]; /** The user moved this message to the next model before the tool said anything (watch.ts). */ switched?: boolean;
  /** The subscription is at its usage limit until `until` (sublimit.ts): the turn did not finish because of it. */
  limited?: { until: number; engine: Engine };
}

export async function runEngineTurn(turn: Turn, prompt: string, attachments: Attachment[]): Promise<EngineOutcome> {
  const { bot } = turn;
  // Starting the computer (or waiting for room, or for the tool another bot of a shared computer runs) is not the AI's
  // silence: the turn watch counts from the moment the tool itself starts.
  const ready = watchWait(bot.id);
  try {
    await ensureComputer(bot);
    // Busy for the whole turn: the computer is never put to sleep under the tool (to make room for another, or as idle),
    // and a shared computer stays this bot's until the turn ends (Part B).
    const release = (await host.hold?.(bot)) ?? (() => {});
    try { return await withEngineLock(bot, 0, () => engineTurnOn(turn, prompt, attachments, ready)); } finally { release(); }
  } finally { ready(); }
}

/**
 * One subscription tool at a time per computer (Part B): a turn and a side request of the same bot, or two bots of a
 * shared computer, never run Claude Code or Codex side by side — both would refresh the same sign-in token, and OpenAI's
 * refresh tokens are single-use ("refresh token was already used"). Keyed by the computer (machineOf). `waitMs` 0: wait
 * as long as it takes (a turn); otherwise give up after that long (a side request).
 */
const engineLocks = new Map<string, Promise<void>>();
export async function withEngineLock<T>(bot: BotRecord, waitMs: number, fn: () => Promise<T>): Promise<T> {
  const key = host.machineOf?.(bot.id) ?? bot.id;
  const before = engineLocks.get(key) ?? Promise.resolve();
  let free!: () => void;
  const mine = new Promise<void>((r) => { free = r; });
  const chain = before.then(() => mine);
  engineLocks.set(key, chain);
  try {
    if (waitMs > 0) {
      let timer: NodeJS.Timeout | undefined;
      const late = new Promise<"late">((r) => { timer = setTimeout(() => r("late"), waitMs); });
      const got = await Promise.race([before.then(() => "ok" as const), late]);
      clearTimeout(timer);
      if (got === "late") throw new Error("the computer's subscription tool is busy with another request");
    } else await before;
    return await fn();
  } finally {
    free();
    if (engineLocks.get(key) === chain) engineLocks.delete(key);
  }
}

async function engineTurnOn(turn: Turn, prompt: string, attachments: Attachment[], ready: () => void): Promise<EngineOutcome> {
  const { bot } = turn;
  // B-2: before the message goes to the engine, the screen must be ready (computer up, look applied, the bot's own
  // browser answering). Otherwise a tool that finds no browser may start one of its own, out of the user's sight.
  // A failure here is logged and the turn goes on; a stop pressed meanwhile ends the turn before anything is sent.
  try { await host.ready(bot); } catch (err) { console.error(`[screen ready ${bot.id}]`, (err as Error)?.message ?? err); }
  if (turn.signal.aborted) throw new Error("aborted");
  const engine = engineOf(bot.model);
  const files = attachments.length ? `\n\n[Files the user attached, in your library:]\n${attachments.map((a) => `- ${botPathOf(a.path)} (${a.mime})`).join("\n")}` : "";
  const system = buildSystemPrompt(bot, turn.user, { connectorNames: [...new Set([...turn.remote.values()].map((r) => r.connectorName))], browser: browserAvailable(), shell: true, linux: true, images: !!imageService(), engine });
  await writeFile(bot.id, "/root/.sklubot/engine-prompt.md", system);
  const t = new Transcript(turn);
  runningTurns.set(bot.id, turn);
  setLive(turn.user.id, bot.id, { steps: 0 });
  const token = issueEngineToken(bot.id);
  let threw = false;
  ready();
  try {
    if (engine === "claude-code") await claudeTurn(turn, t, prompt + files, token);
    else await codexTurn(turn, t, prompt + files, system, token);
  } catch (err) { threw = true; throw err; } finally {
    revokeEngineToken(bot.id);
    runningTurns.delete(bot.id);
    t.endMessage();
    // Stopped after the tool already reported the end of its turn (its reply is out): that is a finished turn.
    const aborted = turn.signal.aborted && !t.ended;
    t.close(!aborted && !threw && !t.failed, aborted, isEngineTimeout(turn.signal.reason));
    if (aborted && turn.signal.reason instanceof EngineGone) noteRuntime(bot.id, "error", "the tool's process ended without finishing the turn");
    else if (aborted || t.switched) noteRuntime(bot.id, "ready");
    else if (threw || t.failed) noteRuntime(bot.id, "error", t.lastFailure || null);
    else noteRuntime(bot.id, "ready");
  }
  if (turn.signal.aborted && !t.ended) throw new Error("aborted");
  return { failure: t.fatal ? t.lastFailure || "the tool failed" : "", steps: t.steps.map((s) => s.seq), ...(t.switched ? { switched: true } : {}), ...(t.limited ? { limited: t.limited } : {}) };
}

/**
 * Runs the tool for one attempt of a turn, watched (watch.ts): its process is looked at meanwhile, every line of its
 * stream is progress, and "Switch AI" stops this run only (the turn goes on with the next model, loop.ts).
 */
async function watchedExec(turn: Turn, t: Transcript, args: string[], env: Record<string, string>, cwd: string, input: string, onLine: (line: string) => void) {
  const { bot } = turn;
  // The turn's end is reported but the process stays (a helper it started can hold its output open, so the reply looks
  // "still working" and the bot's queue waits): after a short grace it is ended, and the turn counts as finished.
  const finished = new AbortController();
  let exitTimer: NodeJS.Timeout | null = null;
  t.onEnded = () => { exitTimer ??= setTimeout(() => finished.abort(new EngineFinished()), config.engineExitGraceMs); };
  const signal = AbortSignal.any([callSignal(bot.id, turn.signal), finished.signal]);
  setEngineSampler(sampleEngine);
  watchExec(bot.id, true);
  try {
    return await host.exec(bot, args, env, cwd, input, signal, (line) => { watchProgress(bot.id); onLine(line); });
  } finally {
    if (exitTimer) clearTimeout(exitTimer);
    t.onEnded = null;
    watchExec(bot.id, false);
    if (!turn.signal.aborted && signal.aborted && signal.reason instanceof SwitchModel) t.switched = true;
  }
}

/**
 * How long our tool endpoint may hold a call: 30 minutes, so an approval (at most 25 minutes, config.approvalExpireMs)
 * always answers first. Claude Code: the per-server "timeout" field of the MCP config, in ms ("A per-server timeout field
 * in .mcp.json overrides [MCP_TOOL_TIMEOUT] for that server", which also raises the 60 s per-request limit of HTTP servers
 * and the idle window — code.claude.com/docs/en/env-vars, MCP_TOOL_TIMEOUT). Codex: mcp_servers.<id>.tool_timeout_sec
 * ("Override the default 60s per-tool timeout for an MCP server" — the Codex configuration reference).
 */
const TOOL_TIMEOUT_MS = 30 * 60_000;

async function claudeTurn(turn: Turn, t: Transcript, prompt: string, token: string, retried = false) {
  const { bot } = turn;
  const mcp = { mcpServers: { sklubot: { type: "http", url: `${botBaseUrl()}/mcp/${encodeURIComponent(bot.id)}`, headers: { Authorization: `Bearer ${token}` }, timeout: TOOL_TIMEOUT_MS } } };
  await writeFile(bot.id, "/root/.sklubot/mcp.json", JSON.stringify(mcp));
  const resume = sessionOf(bot.id, turn.generation, "claude-code");
  const model = modelOf(bot.model);
  const args = [
    "claude", "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
    // The computer is the bot's own sandbox: tools run without per-call prompts there. Sklubot's own
    // tools still ask the user where they must (apps that change things, saved logins…).
    "--permission-mode", "bypassPermissions",
    "--tools", "Bash,Read,Write,Edit,WebFetch,WebSearch,Task,NotebookEdit",
    "--strict-mcp-config", "--mcp-config", "/root/.sklubot/mcp.json",
    "--append-system-prompt-file", "/root/.sklubot/engine-prompt.md",
    ...(model && model !== "default" ? ["--model", model] : []),
    ...effortArgs("claude-code", bot.effort),
    ...(resume ? ["--resume", resume] : []),
  ];
  let failure = "", sawResult = false, missingSession = false;
  let limit: LimitHit | null = null;
  const res = await watchedExec(turn, t, args, { IS_SANDBOX: "1", MCP_TOOL_TIMEOUT: String(TOOL_TIMEOUT_MS) }, "/root/files", prompt, (line) => {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }
    // The model's own stream (words, thinking, a tool call or its result) is its answer starting (watch.ts).
    if (e.type === "stream_event" || e.type === "assistant" || e.type === "user") watchOutput(bot.id);
    if (e.type === "system" && e.subtype === "init" && e.session_id) saveSession(bot.id, turn.generation, "claude-code", e.session_id);
    else if (e.type === "stream_event") {
      const d = e.event?.delta;
      if (e.parent_tool_use_id) return; // a helper's own words stay inside its step
      if (d?.type === "text_delta") t.text(d.text);
      else if (d?.type === "thinking_delta") t.caption.push(d.thinking);
    } else if (e.type === "assistant" && !e.parent_tool_use_id) {
      for (const b of e.message?.content ?? []) {
        if (b.type === "tool_use") t.stepStart(b.id, b.name, b.input ?? {});
        else if (b.type === "text" && !t.stream.started && b.text) t.message(b.text);
      }
      if (e.message?.content?.some((b: any) => b.type === "text")) t.endMessage();
    } else if (e.type === "user" && !e.parent_tool_use_id) {
      for (const b of e.message?.content ?? []) if (b.type === "tool_result") t.stepEnd(b.tool_use_id, !b.is_error, textOf(b.content));
    } else if (e.type === "rate_limit_event") {
      const w = e.rate_limit_info?.unifiedWindows ?? {};
      noteSubscription(turn.user.id, { engine: "claude-code", fiveHour: w.five_hour?.utilization ?? null, sevenDay: w.seven_day?.utilization ?? null, resetsAt: e.rate_limit_info?.resetsAt ? e.rate_limit_info.resetsAt * 1000 : null, at: Date.now() });
      // Only "rejected" without usage credits is the limit; "allowed_warning" is a warning (sublimit.ts claudeLimitFrom).
      const hit = claudeLimitFrom(e.rate_limit_info);
      if (hit) { limit = hit; failure = tr(turn.user.locale, "Your Claude subscription has reached its usage limit for now. I will be able to continue once it resets."); }
    } else if (e.type === "result") {
      sawResult = true;
      if (!e.is_error && !turn.signal.aborted) t.turnEnded();
      const u = e.usage ?? {};
      record(turn.user.id, bot.id, bot.model, { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0 });
      if (e.is_error || (typeof e.result === "string" && NOT_SIGNED_IN.test(e.result) && !turn.spoke)) {
        const msg = String(e.result ?? e.subtype ?? "");
        if (/no conversation found|session.*not found/i.test(msg)) missingSession = true;
        else if (limit || claudeLimitFromText(msg)) { limit ??= claudeLimitFromText(msg); failure ||= clip(msg, 300); }
        else failure = NOT_SIGNED_IN.test(msg) ? signInHint(turn, "claude-code") : clip(msg, 300);
      }
    }
  });
  if (turn.signal.aborted || t.switched) return;
  if (missingSession && !retried) { dropSession(bot.id, turn.generation, "claude-code"); return claudeTurn(turn, t, prompt, token, true); }
  if (!sawResult && !failure) failure = NOT_SIGNED_IN.test(res.stderr) ? signInHint(turn, "claude-code") : clip(res.stderr.trim() || `Claude Code stopped (code ${res.code}).`, 300);
  if (failure && limit) t.limit(limit, failure);
  else if (failure) { t.notice(failure); t.fatal = true; }
}

/**
 * What `codex exec resume <id>` prints when that conversation is gone (the computer was reset, its ~/.codex wiped): on
 * standard error, exit code 1, before any JSON event. Reproduced with codex-cli 0.169.0 (the desktop image's version):
 * `echo hi | codex exec resume --json --skip-git-repo-check <unknown id> -` prints
 * "Error: thread/resume: thread/resume failed: no rollout found for thread id <id> (code -32600)". A "rollout" is Codex's
 * file of a saved conversation (~/.codex/sessions). The same words are accepted in a turn.failed / error event.
 */
export const CODEX_LOST_SESSION = /no rollout found for thread id/i;

async function codexTurn(turn: Turn, t: Transcript, prompt: string, system: string, token: string, retried = false) {
  const { bot } = turn;
  // Codex reads its standing instructions from AGENTS.md in its working folder.
  await writeFile(bot.id, "/root/AGENTS.md", system);
  const resume = sessionOf(bot.id, turn.generation, "codex");
  const model = modelOf(bot.model);
  const common = [
    "--json", "--skip-git-repo-check",
    // As above: the computer itself is the sandbox.
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", `mcp_servers.sklubot.url="${botBaseUrl()}/mcp/${encodeURIComponent(bot.id)}"`,
    "-c", 'mcp_servers.sklubot.bearer_token_env_var="SKLUBOT_MCP_TOKEN"',
    "-c", `mcp_servers.sklubot.tool_timeout_sec=${TOOL_TIMEOUT_MS / 1000}`,
    ...(model && model !== "default" ? ["-m", model] : []),
    ...effortArgs("codex", bot.effort),
  ];
  const args = resume ? ["codex", "exec", "resume", ...common, resume, "-"] : ["codex", "exec", ...common, "-"];
  let failure = "", sawEnd = false, missingSession = false, produced = false;
  let limit: LimitHit | null = null;
  await writeFile(bot.id, SECRET_ENV_FILE, secretEnvFile({ SKLUBOT_MCP_TOKEN: token }));
  const res = await watchedExec(turn, t, args, {}, "/root", prompt, (line) => {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }
    const it = e.item;
    // An item (a message, reasoning, a command, a tool call) is the model's answer starting (watch.ts).
    if (typeof e.type === "string" && e.type.startsWith("item.")) watchOutput(bot.id);
    // Anything beyond the thread's start means the turn already did or said something: it is never run a second time.
    if (e.type !== "thread.started" && e.type !== "turn.started" && e.type !== "turn.failed" && e.type !== "error") produced = true;
    if (e.type === "thread.started" && e.thread_id) saveSession(bot.id, turn.generation, "codex", e.thread_id);
    else if (e.type === "item.started" && it) {
      if (it.type === "command_execution") t.stepStart(it.id, "command_execution", { command: it.command });
      else if (it.type === "mcp_tool_call") t.stepStart(it.id, `mcp__${it.server}__${it.tool}`, it.arguments ?? {});
      else if (it.type === "web_search") t.stepStart(it.id, "web_search", { query: it.query });
      else if (it.type === "file_change") t.stepStart(it.id, "file_change", { files: (it.changes ?? []).map((c: any) => c.path).join(", ") });
    } else if (e.type === "item.updated" && it?.type === "reasoning") t.caption.push(it.text ?? "");
    else if (e.type === "item.completed" && it) {
      if (it.type === "agent_message") t.message(it.text ?? "");
      else if (it.type === "reasoning") t.caption.push(it.text ?? "");
      else if (it.type === "command_execution") t.stepEnd(it.id, it.status === "completed" && (it.exit_code ?? 0) === 0, `exit ${it.exit_code ?? "?"}`);
      else if (it.type === "mcp_tool_call") t.stepEnd(it.id, it.status === "completed" && !it.error, it.error?.message ?? textOf(it.result?.content));
      else if (it.type === "web_search" || it.type === "file_change") t.stepEnd(it.id, it.status !== "failed", it.query ?? "");
      else if (it.type === "error") t.warning(String(it.message ?? ""));
    } else if (e.type === "turn.completed") {
      sawEnd = true;
      // Only an end reported before any stop counts (a tool that is interrupted may still print one).
      if (!turn.signal.aborted) t.turnEnded();
      const u = e.usage ?? {};
      record(turn.user.id, bot.id, bot.model, { inputTokens: u.input_tokens ?? 0, outputTokens: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0), cachedTokens: u.cached_input_tokens ?? 0 });
      noteSubscription(turn.user.id, { engine: "codex", fiveHour: null, sevenDay: null, resetsAt: null, at: Date.now() });
    } else if (e.type === "turn.failed" || e.type === "error") {
      sawEnd = true;
      const msg = String(e.error?.message ?? e.message ?? "Codex stopped.");
      if (resume && CODEX_LOST_SESSION.test(msg)) missingSession = true;
      else if ((limit ??= codexLimitFrom(msg))) failure ||= clip(msg, 300);
      else failure = NOT_SIGNED_IN.test(msg) ? signInHint(turn, "codex") : clip(msg, 300);
    }
  });
  // The saved conversation is gone (see CODEX_LOST_SESSION): forget it and start a fresh one, once, like Claude Code above
  // — only when nothing came out of this attempt (no step, no words), so no work is ever done twice.
  if (t.switched) return;
  if (resume && !retried && !turn.signal.aborted && !produced && !turn.spoke && (missingSession || CODEX_LOST_SESSION.test(res.stderr))) {
    dropSession(bot.id, turn.generation, "codex");
    return codexTurn(turn, t, prompt, system, token, true);
  }
  if (turn.signal.aborted) return;
  if (!sawEnd && !failure) { limit ??= codexLimitFrom(res.stderr); failure = NOT_SIGNED_IN.test(res.stderr) ? signInHint(turn, "codex") : clip(res.stderr.trim() || `Codex stopped (code ${res.code}).`, 300); }
  if (failure && limit) t.limit(limit, failure);
  else if (failure) { t.notice(failure); t.fatal = true; }
}

const signInHint = (turn: Turn, engine: Engine) =>
  tr(turn.user.locale, engine === "codex"
    ? "I am not signed in to ChatGPT on this desktop. Open Settings → Models and check my connection."
    : "I am not signed in to Claude on this desktop. Open Settings → Models and check my connection.");

// ── A short side request (memory, summaries) through the subscription ───────
export async function engineAsk(bot: BotRecord, system: string, prompt: string): Promise<string> {
  await ensureComputer(bot);
  const release = (await host.hold?.(bot)) ?? (() => {});
  try { return await withEngineLock(bot, 60_000, () => engineAskOn(bot, system, prompt)); } finally { release(); }
}
async function engineAskOn(bot: BotRecord, system: string, prompt: string): Promise<string> {
  {
    const engine = engineOf(bot.model);
    let out = "";
    const ctrl = AbortSignal.timeout(180_000);
    if (engine === "claude-code") {
      await writeFile(bot.id, "/root/.sklubot/side-prompt.md", system);
      await host.exec(bot, ["claude", "-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence", "--append-system-prompt-file", "/root/.sklubot/side-prompt.md", ...(modelOf(bot.model) !== "default" ? ["--model", modelOf(bot.model)] : []), ...effortArgs("claude-code", bot.effort)],
        { IS_SANDBOX: "1" }, "/root", prompt, ctrl, (line) => { try { const e = JSON.parse(line); if (e.type === "result" && !e.is_error) out = String(e.result ?? ""); } catch { /* ignore */ } });
    } else {
      await host.exec(bot, ["codex", "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", ...effortArgs("codex", bot.effort), "-"], {}, "/tmp", `${system}\n\n${prompt}`, ctrl,
        (line) => { try { const e = JSON.parse(line); if (e.type === "item.completed" && e.item?.type === "agent_message") out = String(e.item.text ?? ""); } catch { /* ignore */ } });
    }
    return out.trim();
  }
}

// ── Sign-in on the bot's own screen ─────────────────────────────────────────
export async function engineStatus(bot: BotRecord): Promise<EngineStatus[]> {
  await ensureComputer(bot);
  const name = containerName(bot.id);
  const claude = await docker(["exec", name, "sh", "-c", `${SUBSCRIPTION_ENV}; command -v claude >/dev/null || exit 9; claude auth status --json`], { timeoutMs: 30_000 });
  const codex = await docker(["exec", name, "sh", "-c", `${SUBSCRIPTION_ENV}; command -v codex >/dev/null || exit 9; codex login status 2>&1`], { timeoutMs: 30_000 });
  let c: any = {};
  try { c = JSON.parse(claude.stdout.toString("utf8")); } catch { /* not JSON */ }
  const codexText = codex.stdout.toString("utf8").trim();
  const claudePlan = claude.code === 0 && !!c.loggedIn && ["claude.ai", "oauth_token"].includes(c.authMethod);
  const codexPlan = codex.code === 0 && /logged in (?:using|with) chatgpt/i.test(codexText);
  return [
    { engine: "claude-code", installed: claude.code !== 9, signedIn: claudePlan, account: claudePlan ? c.email ?? c.account?.email ?? null : null, detail: claude.code === 9 ? "not installed" : null },
    { engine: "codex", installed: codex.code !== 9, signedIn: codexPlan, account: codexPlan ? "ChatGPT" : null, detail: codex.code === 9 ? "not installed" : null },
  ];
}

/** Opens a terminal on the bot's screen running the provider's sign-in; its page opens in the bot's browser. */
export async function engineLogin(bot: BotRecord, engine: Engine) {
  await ensureComputer(bot);
  const fr = (await import("../store.js")).users.localeOf(bot.userId) === "fr";
  const done = fr ? "Connexion terminée. Tu peux fermer cette fenêtre et rendre la main." : "Signed in. You can close this window and hand back.";
  const cmd = `${SUBSCRIPTION_ENV}; ${engine === "codex" ? "codex login" : "claude auth login --claudeai"}`;
  const title = engine === "codex" ? "ChatGPT" : "Claude";
  const r = await docker(["exec", "-d", containerName(bot.id), "xterm", "-T", title, "-geometry", "100x24+80+60", "-e", "sh", "-c", `${cmd} && echo && echo '${done}'; sleep 3600`], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(`could not open the sign-in window: ${r.stderr.trim().slice(0, 200)}`);
}

export async function engineLogout(bot: BotRecord, engine: Engine) {
  await ensureComputer(bot);
  await docker(["exec", containerName(bot.id), "sh", "-c", engine === "codex" ? "codex logout" : "claude auth logout"], { timeoutMs: 30_000 });
}

export const randomCallId = () => `mcp_${randomUUID().slice(0, 8)}`;
