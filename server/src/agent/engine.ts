import { spawn } from "node:child_process";
import { createHash, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { botPathOf, computerKind, screen } from "../computer.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import { containerName, docker } from "../linux.js";
import type { Attachment, Engine, EngineStatus } from "../shared.js";
import { bots, clip, rows, type BotRecord } from "../store.js";
import { noteSubscription, record } from "../usage.js";
import { activity, Caption, StreamingRow, type Turn } from "./loop.js";
import { buildSystemPrompt } from "./prompt.js";
import { imageService } from "../images.js";
import { browserAvailable } from "../computer.js";

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

/** Subscription choices for the model picker (only when bots have Linux computers). */
export function engineModels() {
  if (computerKind() !== "linux") return [];
  return [
    ...config.claudeCodeModels.map((m) => ({ ref: `claude-code:${m}`, provider: "Claude (subscription)", model: m, kind: "subscription" as const, engine: "claude-code" as const })),
    ...config.codexModels.map((m) => ({ ref: `codex:${m}`, provider: "ChatGPT (subscription)", model: m, kind: "subscription" as const, engine: "codex" as const })),
  ];
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
async function writeFile(botId: string, path: string, content: string) {
  const r = await docker(["exec", "-i", containerName(botId), "sh", "-c", `umask 077; mkdir -p "$(dirname '${path}')"; cat > '${path}'`], { timeoutMs: 20_000, input: content });
  if (r.code !== 0) throw new Error(`could not prepare the bot's computer: ${r.stderr.trim().slice(0, 200)}`);
}

async function ensureComputer(bot: BotRecord) {
  if (computerKind() !== "linux") throw new Error("Subscriptions need the bots' Linux computers (Docker and the desktop image) on this server.");
  await screen.wake(bot.id, bot.userId);
}

function toolLabel(name: string, turn: Turn): string {
  const loc = turn.user.locale;
  const ours = name.replace(/^mcp__sklubot__/, "");
  const builtin = turn.builtin.get(ours);
  if (builtin) return tr(loc, builtin.label);
  const remote = turn.remote.get(ours);
  if (remote) return tr(loc, "Using {app}", { app: remote.connectorName });
  const own: Record<string, string> = {
    Bash: "Running a command", command_execution: "Running a command", Read: "Reading a file", Write: "Saving a file", Edit: "Saving a file",
    NotebookEdit: "Saving a file", file_change: "Saving a file", WebSearch: "Searching the web", web_search: "Searching the web",
    WebFetch: "Reading a page", Task: "Starting a helper", TodoWrite: "Planning",
  };
  return tr(loc, own[name] ?? "Working");
}

function activityOf(name: string) {
  if (/Bash|command/.test(name)) return "shell" as const;
  if (/WebSearch|web_search/.test(name)) return "searching" as const;
  if (/WebFetch/.test(name)) return "reading" as const;
  if (/screen_|browser_open|page_read/.test(name)) return "computer" as const;
  if (/memory|skill|conversation/.test(name)) return "remembering" as const;
  if (/app_/.test(name)) return "connector" as const;
  return "thinking" as const;
}

/** Turns the tool's own events into chat rows: streamed replies, steps, and the thinking caption. */
class Transcript {
  readonly stream: StreamingRow;
  readonly caption: Caption;
  private steps = new Map<string, number>();
  constructor(private turn: Turn) {
    this.stream = new StreamingRow(turn);
    this.caption = new Caption(turn);
  }
  text(delta: string) {
    if (!this.stream.started) activity(this.turn, "writing");
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
  stepStart(id: string, name: string, args: Record<string, unknown>) {
    if (this.steps.has(id)) return;
    this.endMessage();
    activity(this.turn, activityOf(name), name.replace(/^mcp__sklubot__/, "").replace(/_/g, " "));
    const short: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(args ?? {})) short[k] = typeof v === "string" ? clip(v, 400) : v;
    this.steps.set(id, rows.append(this.turn.bot, { kind: "step", callId: id, tool: name, label: toolLabel(name, this.turn), status: "running", args: short }).seq);
  }
  stepEnd(id: string, ok: boolean, summary: string) {
    const seq = this.steps.get(id);
    if (!seq) return;
    const row = rows.get(this.turn.bot.id, this.turn.generation, seq);
    if (row?.body.kind === "step") rows.rewrite(this.turn.bot, this.turn.generation, seq, { ...row.body, status: ok ? "done" : "error", summary: clip(summary.replace(/\s+/g, " ").trim(), 80) });
    activity(this.turn, "thinking");
  }
  notice(text: string, tone: "info" | "warn" | "error" = "warn") {
    this.endMessage();
    rows.append(this.turn.bot, { kind: "notice", tone, text });
  }
}

const textOf = (content: unknown): string =>
  typeof content === "string" ? content : Array.isArray(content) ? content.map((c: any) => (c?.type === "text" ? c.text : "")).join(" ") : "";

/** Runs one command in the bot's computer and feeds each line of its output to `onLine`. Stopping sends it an interrupt. */
function runInComputer(bot: BotRecord, args: string[], env: Record<string, string>, cwd: string, input: string, signal: AbortSignal, onLine: (line: string) => void): Promise<{ code: number | null; stderr: string }> {
  const name = containerName(bot.id);
  const envArgs = Object.entries(env).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
  // The process id is written down so that "stop" can interrupt the tool inside the computer.
  const child = spawn("docker", ["exec", "-i", "-w", cwd, ...envArgs, name, "sh", "-c", 'echo $$ > /tmp/sklubot-engine.pid; exec "$@"', "sh", ...args], { stdio: ["pipe", "pipe", "pipe"] });
  const stop = () => { void docker(["exec", name, "sh", "-c", "kill -INT $(cat /tmp/sklubot-engine.pid) 2>/dev/null"], { timeoutMs: 10_000 }); };
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
  return new Promise((resolve) => child.on("close", (code) => { signal.removeEventListener("abort", stop); if (buffer.trim()) { try { onLine(buffer.trim()); } catch { /* ignore */ } } resolve({ code, stderr }); }));
}

const NOT_SIGNED_IN = /not logged in|please run \/login|login required|not authenticated|unauthorized|401/i;

// ── One turn ─────────────────────────────────────────────────────────────────
export async function runEngineTurn(turn: Turn, prompt: string, attachments: Attachment[]) {
  const { bot } = turn;
  await ensureComputer(bot);
  const engine = engineOf(bot.model);
  const files = attachments.length ? `\n\n[Files the user attached, in your library:]\n${attachments.map((a) => `- ${botPathOf(a.path)} (${a.mime})`).join("\n")}` : "";
  const system = buildSystemPrompt(bot, turn.user, { connectorNames: [...new Set([...turn.remote.values()].map((r) => r.connectorName))], browser: browserAvailable(), shell: true, linux: true, images: !!imageService(), engine });
  await writeFile(bot.id, "/root/.sklubot/engine-prompt.md", system);
  const t = new Transcript(turn);
  runningTurns.set(bot.id, turn);
  const token = issueEngineToken(bot.id);
  try {
    if (engine === "claude-code") await claudeTurn(turn, t, prompt + files, token);
    else await codexTurn(turn, t, prompt + files, system, token);
  } finally {
    revokeEngineToken(bot.id);
    runningTurns.delete(bot.id);
    t.endMessage();
  }
  if (turn.signal.aborted) throw new Error("aborted");
}

async function claudeTurn(turn: Turn, t: Transcript, prompt: string, token: string, retried = false) {
  const { bot } = turn;
  const mcp = { mcpServers: { sklubot: { type: "http", url: `${config.engineBaseUrl}/mcp/${encodeURIComponent(bot.id)}`, headers: { Authorization: `Bearer ${token}` } } } };
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
    ...(resume ? ["--resume", resume] : []),
  ];
  let failure = "", sawResult = false, missingSession = false;
  const res = await runInComputer(bot, args, { IS_SANDBOX: "1" }, "/root/files", prompt, turn.signal, (line) => {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }
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
      if (e.rate_limit_info?.status && e.rate_limit_info.status !== "allowed") failure = tr(turn.user.locale, "Your Claude subscription has reached its usage limit for now. I will be able to continue once it resets.");
    } else if (e.type === "result") {
      sawResult = true;
      const u = e.usage ?? {};
      record(turn.user.id, bot.id, bot.model, { inputTokens: (u.input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0), outputTokens: u.output_tokens ?? 0, cachedTokens: u.cache_read_input_tokens ?? 0 });
      if (e.is_error || (typeof e.result === "string" && NOT_SIGNED_IN.test(e.result) && !turn.spoke)) {
        const msg = String(e.result ?? e.subtype ?? "");
        if (/no conversation found|session.*not found/i.test(msg)) missingSession = true;
        else failure = NOT_SIGNED_IN.test(msg) ? signInHint(turn, "claude-code") : clip(msg, 300);
      }
    }
  });
  if (missingSession && !retried) { dropSession(bot.id, turn.generation, "claude-code"); return claudeTurn(turn, t, prompt, token, true); }
  if (turn.signal.aborted) return;
  if (!sawResult && !failure) failure = NOT_SIGNED_IN.test(res.stderr) ? signInHint(turn, "claude-code") : clip(res.stderr.trim() || `Claude Code stopped (code ${res.code}).`, 300);
  if (failure) t.notice(failure);
}

async function codexTurn(turn: Turn, t: Transcript, prompt: string, system: string, token: string) {
  const { bot } = turn;
  // Codex reads its standing instructions from AGENTS.md in its working folder.
  await writeFile(bot.id, "/root/AGENTS.md", system);
  const resume = sessionOf(bot.id, turn.generation, "codex");
  const model = modelOf(bot.model);
  const common = [
    "--json", "--skip-git-repo-check",
    // As above: the computer itself is the sandbox.
    "--dangerously-bypass-approvals-and-sandbox",
    "-c", `mcp_servers.sklubot.url="${config.engineBaseUrl}/mcp/${encodeURIComponent(bot.id)}"`,
    "-c", 'mcp_servers.sklubot.bearer_token_env_var="SKLUBOT_MCP_TOKEN"',
    ...(model && model !== "default" ? ["-m", model] : []),
  ];
  const args = resume ? ["codex", "exec", "resume", ...common, resume, "-"] : ["codex", "exec", ...common, "-"];
  let failure = "", sawEnd = false;
  const res = await runInComputer(bot, args, { SKLUBOT_MCP_TOKEN: token }, "/root", prompt, turn.signal, (line) => {
    let e: any;
    try { e = JSON.parse(line); } catch { return; }
    const it = e.item;
    if (e.type === "thread.started" && e.thread_id) saveSession(bot.id, turn.generation, "codex", e.thread_id);
    else if (e.type === "item.started" && it) {
      if (it.type === "command_execution") t.stepStart(it.id, "command_execution", { command: it.command });
      else if (it.type === "mcp_tool_call") t.stepStart(it.id, it.server === "sklubot" ? `mcp__sklubot__${it.tool}` : `${it.server}__${it.tool}`, it.arguments ?? {});
      else if (it.type === "web_search") t.stepStart(it.id, "web_search", { query: it.query });
      else if (it.type === "file_change") t.stepStart(it.id, "file_change", { files: (it.changes ?? []).map((c: any) => c.path).join(", ") });
    } else if (e.type === "item.updated" && it?.type === "reasoning") t.caption.push(it.text ?? "");
    else if (e.type === "item.completed" && it) {
      if (it.type === "agent_message") t.message(it.text ?? "");
      else if (it.type === "reasoning") t.caption.push(it.text ?? "");
      else if (it.type === "command_execution") t.stepEnd(it.id, it.status === "completed" && (it.exit_code ?? 0) === 0, `exit ${it.exit_code ?? "?"}`);
      else if (it.type === "mcp_tool_call") t.stepEnd(it.id, it.status === "completed" && !it.error, it.error?.message ?? textOf(it.result?.content));
      else if (it.type === "web_search" || it.type === "file_change") t.stepEnd(it.id, it.status !== "failed", it.query ?? "");
      else if (it.type === "error") t.notice(clip(String(it.message ?? "error"), 300));
    } else if (e.type === "turn.completed") {
      sawEnd = true;
      const u = e.usage ?? {};
      record(turn.user.id, bot.id, bot.model, { inputTokens: u.input_tokens ?? 0, outputTokens: (u.output_tokens ?? 0) + (u.reasoning_output_tokens ?? 0), cachedTokens: u.cached_input_tokens ?? 0 });
      noteSubscription(turn.user.id, { engine: "codex", fiveHour: null, sevenDay: null, resetsAt: null, at: Date.now() });
    } else if (e.type === "turn.failed" || e.type === "error") {
      sawEnd = true;
      const msg = String(e.error?.message ?? e.message ?? "Codex stopped.");
      failure = NOT_SIGNED_IN.test(msg) ? signInHint(turn, "codex") : clip(msg, 300);
    }
  });
  if (turn.signal.aborted) return;
  if (!sawEnd && !failure) failure = NOT_SIGNED_IN.test(res.stderr) ? signInHint(turn, "codex") : clip(res.stderr.trim() || `Codex stopped (code ${res.code}).`, 300);
  if (failure) t.notice(failure);
}

const signInHint = (turn: Turn, engine: Engine) =>
  tr(turn.user.locale, engine === "codex"
    ? "I am not signed in to ChatGPT on my computer yet. Open my settings → Brain → Sign in, then sign in on my screen."
    : "I am not signed in to Claude on my computer yet. Open my settings → Brain → Sign in, then sign in on my screen.");

// ── A short side request (memory, summaries) through the subscription ───────
export async function engineAsk(bot: BotRecord, system: string, prompt: string): Promise<string> {
  await ensureComputer(bot);
  const engine = engineOf(bot.model);
  let out = "";
  const ctrl = AbortSignal.timeout(180_000);
  if (engine === "claude-code") {
    await writeFile(bot.id, "/root/.sklubot/side-prompt.md", system);
    await runInComputer(bot, ["claude", "-p", "--output-format", "stream-json", "--verbose", "--tools", "", "--no-session-persistence", "--append-system-prompt-file", "/root/.sklubot/side-prompt.md", ...(modelOf(bot.model) !== "default" ? ["--model", modelOf(bot.model)] : [])],
      { IS_SANDBOX: "1" }, "/root", prompt, ctrl, (line) => { try { const e = JSON.parse(line); if (e.type === "result" && !e.is_error) out = String(e.result ?? ""); } catch { /* ignore */ } });
  } else {
    await runInComputer(bot, ["codex", "exec", "--json", "--skip-git-repo-check", "--ephemeral", "--sandbox", "read-only", "-"], {}, "/tmp", `${system}\n\n${prompt}`, ctrl,
      (line) => { try { const e = JSON.parse(line); if (e.type === "item.completed" && e.item?.type === "agent_message") out = String(e.item.text ?? ""); } catch { /* ignore */ } });
  }
  return out.trim();
}

// ── Sign-in on the bot's own screen ─────────────────────────────────────────
export async function engineStatus(bot: BotRecord): Promise<EngineStatus[]> {
  await ensureComputer(bot);
  const name = containerName(bot.id);
  const claude = await docker(["exec", name, "sh", "-c", "command -v claude >/dev/null || exit 9; claude auth status --json"], { timeoutMs: 30_000 });
  const codex = await docker(["exec", name, "sh", "-c", "command -v codex >/dev/null || exit 9; codex login status 2>&1"], { timeoutMs: 30_000 });
  let c: any = {};
  try { c = JSON.parse(claude.stdout.toString("utf8")); } catch { /* not JSON */ }
  const codexText = codex.stdout.toString("utf8").trim();
  return [
    { engine: "claude-code", installed: claude.code !== 9, signedIn: claude.code === 9 ? false : !!c.loggedIn, account: c.email ?? c.account?.email ?? (c.authMethod && c.authMethod !== "none" ? String(c.authMethod) : null), detail: claude.code === 9 ? "not installed" : null },
    { engine: "codex", installed: codex.code !== 9, signedIn: codex.code === 9 ? false : codex.code === 0 && !/not logged in/i.test(codexText), account: codex.code === 0 ? clip(codexText, 120) : null, detail: codex.code === 9 ? "not installed" : null },
  ];
}

/** Opens a terminal on the bot's screen running the provider's sign-in; its page opens in the bot's browser. */
export async function engineLogin(bot: BotRecord, engine: Engine) {
  await ensureComputer(bot);
  const fr = (await import("../store.js")).users.localeOf(bot.userId) === "fr";
  const done = fr ? "Connexion terminée. Tu peux fermer cette fenêtre et rendre la main." : "Signed in. You can close this window and hand back.";
  const cmd = engine === "codex" ? "codex login" : "claude auth login --claudeai";
  const title = engine === "codex" ? "ChatGPT" : "Claude";
  const r = await docker(["exec", "-d", containerName(bot.id), "xterm", "-T", title, "-geometry", "100x24+80+60", "-e", "sh", "-c", `${cmd} && echo && echo '${done}'; sleep 3600`], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(`could not open the sign-in window: ${r.stderr.trim().slice(0, 200)}`);
}

export async function engineLogout(bot: BotRecord, engine: Engine) {
  await ensureComputer(bot);
  await docker(["exec", containerName(bot.id), "sh", "-c", engine === "codex" ? "codex logout" : "claude auth logout"], { timeoutMs: 30_000 });
}

export const randomCallId = () => `mcp_${randomUUID().slice(0, 8)}`;
