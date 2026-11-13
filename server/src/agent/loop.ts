import { clearLive, emit, getLive, setLive } from "../bus.js";
import { browserAvailable } from "../computer.js";
import { config } from "../config.js";
import { connectors } from "../connectors.js";
import { defaultModelRef, resolveModel, validateToolInput, type Block, type ChatMessage, type Effort, type TextBlock, type ToolResultBlock, type ToolSpec, type ToolUseBlock } from "../llm/index.js";
import type { ActivityKind, Row } from "../shared.js";
import { approvals, bots, clip, history, newId, paused, policies, rows, settings, users, type BotRecord, type UserRecord } from "../store.js";
import { overBudget, record } from "../usage.js";
import { compactIfNeeded } from "./memory.js";
import { buildSystemPrompt } from "./prompt.js";
import { deliverBotMessage } from "./team.js";
import { builtinTools, type BuiltinTool, type ToolOutput } from "./tools.js";

export type Trigger =
  | { kind: "user"; text: string; voice?: boolean }
  | { kind: "routine"; name: string; text: string }
  | { kind: "bot"; fromName: string; text: string; depth: number }
  | { kind: "system"; text: string; depth?: number }
  | { kind: "resume" };

/** Everything needed to continue a turn that stopped to ask the user for permission. */
interface PausedTurn {
  system: string;
  tools: ToolSpec[];
  modelRef: string;
  pending: ToolUseBlock[];
  results: ToolResultBlock[];
  stepSeq: Record<string, number>;
  generation: number;
  approvalId: string;
  depth: number;
  endTurn: boolean;
}

interface Turn {
  bot: BotRecord;
  user: UserRecord;
  system: string;
  tools: ToolSpec[];
  modelRef: string;
  depth: number;
  signal: AbortSignal;
  generation: number;
  builtin: Map<string, BuiltinTool>;
  remote: Map<string, { connectorId: string; connectorName: string; remoteName: string; readOnly: boolean }>;
  /** How often each exact call was made this turn, to stop a bot going round in circles. */
  repeats: Map<string, number>;
  spoke: boolean;
  lastText: string;
}

// ── Per-bot serial queue ─────────────────────────────────────────────────────
const queues = new Map<string, Promise<void>>();
const pendingCount = new Map<string, number>();
const controllers = new Map<string, AbortController>();
/** Messages typed while the bot is mid-turn; folded into that turn at the next step. */
const steering = new Map<string, string[]>();

export const isBusy = (botId: string) => (pendingCount.get(botId) ?? 0) > 0;

/** Runs a job after everything already queued for this bot. Jobs for different bots run side by side. */
export function inQueue<T>(botId: string, job: () => Promise<T>): Promise<T> {
  pendingCount.set(botId, (pendingCount.get(botId) ?? 0) + 1);
  const run = (queues.get(botId) ?? Promise.resolve()).then(job);
  const tail = run.then(() => {}, (err) => console.error(`[bot ${botId}]`, err)).finally(() => {
    const left = (pendingCount.get(botId) ?? 1) - 1;
    if (left <= 0) { pendingCount.delete(botId); if (queues.get(botId) === tail) queues.delete(botId); }
    else pendingCount.set(botId, left);
  });
  queues.set(botId, tail);
  return run;
}

export function enqueue(botId: string, trigger: Trigger) {
  void inQueue(botId, () => runTurn(botId, trigger)).catch(() => {});
}

/** A user message: starts a turn, or — if the bot is already working — joins the turn in progress. */
export function submitUserMessage(bot: BotRecord, text: string, voice = false) {
  if (controllers.has(bot.id) && !paused.get(bot.id)) {
    const list = steering.get(bot.id) ?? [];
    list.push(text);
    steering.set(bot.id, list);
    setLive(bot.userId, bot.id, { queued: list.length });
    return;
  }
  enqueue(bot.id, { kind: "user", text, voice });
}

export function interrupt(botId: string) {
  controllers.get(botId)?.abort();
}

function drainSteering(bot: BotRecord): string[] {
  const list = steering.get(bot.id) ?? [];
  if (list.length) {
    steering.delete(bot.id);
    setLive(bot.userId, bot.id, { queued: 0 });
  }
  return list;
}

// ── Turn ─────────────────────────────────────────────────────────────────────
const text = (s: string): TextBlock => ({ type: "text", text: s });
const activity = (t: Turn, kind: ActivityKind, detail?: string) => setLive(t.user.id, t.bot.id, { running: true, activity: { kind, detail, since: Date.now() }, awaiting: null });

function triggerMessage(trigger: Exclude<Trigger, { kind: "resume" }>): string {
  switch (trigger.kind) {
    case "user": return trigger.voice
      ? `[Said aloud on a voice call. Your reply will be read out: lead with the answer, keep it short, plain sentences, no markdown, links or ids unless asked.]\n${trigger.text}`
      : trigger.text;
    case "routine": return `[Your routine "${trigger.name}" is running now. Carry it out:]\n${trigger.text}`;
    case "bot": return `[Message from ${trigger.fromName}, another bot on the team. To answer them, use bot_message.]\n${trigger.text}`;
    case "system": return `[System notice]\n${trigger.text}`;
  }
}

/** A turn that was cut off can leave tool calls without results; close them so the transcript stays valid. */
function repairDangling(botId: string, generation: number): ToolResultBlock[] {
  const all = history.load(botId, generation);
  const last = all[all.length - 1];
  if (!last || last.role !== "assistant") return [];
  return last.content.filter((b): b is ToolUseBlock => b.type === "tool_use").map((call) => ({
    type: "tool_result", toolUseId: call.id, isError: true,
    content: [text("This call was interrupted before it finished. Its result is unknown — check the current state before trying again.")],
  }));
}

/** Screenshots from earlier turns are replaced by a note; the turn in progress keeps all of its own. */
function trimOldImages(messages: ChatMessage[]): ChatMessage[] {
  let turnStart = 0;
  messages.forEach((m, i) => { if (m.role === "user" && !m.content.some((b) => b.type === "tool_result")) turnStart = i; });
  return messages.map((m, i) => {
    if (i >= turnStart || m.role !== "user") return m;
    return {
      role: m.role,
      content: m.content.map((b): Block => b.type === "tool_result"
        ? { ...b, content: b.content.map((c) => (c.type === "image" ? text("[An earlier screenshot was here.]") : c)) }
        : b.type === "image" ? text("[An earlier image was here.]") : b),
    };
  });
}

async function newTurn(bot: BotRecord, user: UserRecord, depth: number, signal: AbortSignal): Promise<Turn> {
  const remoteTools = await connectors.toolsFor(user.id).catch(() => []);
  const builtins = builtinTools();
  const connectorNames = [...new Set(remoteTools.map((t) => t.connectorName))];
  return {
    bot, user, depth, signal, generation: bot.generation,
    system: buildSystemPrompt(bot, user, { connectorNames, browser: browserAvailable(), shell: config.shellEnabled }),
    // Sorted so the tool list is byte-identical from call to call, which keeps provider caches warm.
    tools: [...builtins.map((b) => b.spec), ...remoteTools.map((r) => r.spec)].sort((a, b) => a.name.localeCompare(b.name)),
    modelRef: bot.model || defaultModelRef(),
    builtin: new Map(builtins.map((b) => [b.spec.name, b])),
    remote: new Map(remoteTools.map((r) => [r.spec.name, r])),
    repeats: new Map(), spoke: false, lastText: "",
  };
}

async function runTurn(botId: string, trigger: Trigger): Promise<void> {
  const bot = bots.byId(botId);
  if (!bot || bot.kind !== "agent") return;
  const user = users.byId(bot.userId);
  if (!user) return;
  const controller = new AbortController();
  controllers.set(botId, controller);
  setLive(user.id, botId, { running: true, activity: { kind: "thinking", since: Date.now() }, awaiting: null, startedAt: Date.now() });
  let turn: Turn | null = null;
  try {
    const held = paused.get<PausedTurn>(botId);
    if (trigger.kind === "resume") {
      if (!held) return;
      turn = await newTurn(bot, user, held.depth, controller.signal);
      // The paused request must be continued with exactly the prompt and tools it started with.
      turn.system = held.system; turn.tools = held.tools; turn.modelRef = held.modelRef;
      const outcome = await processCalls(turn, held);
      if (outcome !== "continue") return;
    } else {
      if (held) supersede(bot, held);
      if (overBudget(user.id)) {
        rows.append(bot, { kind: "notice", tone: "warn", text: "This month's budget is used up, so I'm paused. Raise or clear the budget in Settings → Usage to continue." });
        return;
      }
      await compactIfNeeded(bot).catch((err) => console.error("[compaction]", err));
      const depth = trigger.kind === "bot" ? trigger.depth : trigger.kind === "system" ? trigger.depth ?? 0 : 0;
      turn = await newTurn(bot, user, depth, controller.signal);
      const extra = drainSteering(bot);
      history.append(botId, bot.generation, { role: "user", content: [...repairDangling(botId, bot.generation), text(triggerMessage(trigger)), ...extra.map(text)] });
    }
    await modelLoop(turn);
    // A helper's last words go back to whoever started it.
    if (bot.parentId && turn.lastText && !paused.get(botId)) {
      const parent = bots.byId(bot.parentId);
      // The hop count travels with the report, so a bot and its helper cannot ping-pong forever.
      if (parent) deliverBotMessage(bot, parent, turn.lastText, turn.depth);
    }
    if (trigger.kind === "system" && bot.primary) noteCheckinOutcome(user.id, turn.spoke);
  } catch (err) {
    const stopped = controller.signal.aborted;
    if (bots.byId(botId))
      rows.append(bot, stopped ? { kind: "notice", tone: "info", text: "Stopped." } : { kind: "notice", tone: "error", text: `Something went wrong: ${clip(String((err as Error)?.message ?? err), 400)}` });
    if (!stopped) console.error(`[turn ${bot.name}]`, err);
  } finally {
    controllers.delete(botId);
    const leftover = drainSteering(bot);
    if (!paused.get(botId)) clearLive(user.id, botId);
    bots.announce(bots.byId(botId));
    // Anything typed in the last instant of the turn still deserves an answer.
    if (leftover.length && bots.byId(botId)) enqueue(botId, { kind: "user", text: leftover.join("\n\n") });
  }
}

/** Calls the model, runs the tools it asks for, and repeats until it has nothing more to do. */
async function modelLoop(turn: Turn) {
  const { bot } = turn;
  const { provider, model } = resolveModel(turn.modelRef);
  for (let step = 0; step < config.maxSteps; step++) {
    if (turn.signal.aborted) throw new Error("aborted");
    const stream = new StreamingRow(turn);
    const result = await provider.runTurn({
      model, system: turn.system, tools: turn.tools, effort: bot.effort as Effort, webSearch: true, signal: turn.signal,
      messages: trimOldImages(history.load(bot.id, turn.generation)),
      onText: (delta) => { if (!stream.started) activity(turn, "writing"); stream.push(delta); },
      onToolStart: (_id, name) => { if (name === "web_search") activity(turn, "searching"); },
    }).catch((err: unknown) => { stream.finish(); throw err; });
    record(turn.user.id, bot.id, result.model, result.usage);
    const said = stream.finish(result.sources);
    if (said) { turn.spoke = true; turn.lastText = said; }
    history.append(bot.id, turn.generation, { role: "assistant", content: result.content });

    if (result.stopReason === "pause") continue;
    const calls = result.content.filter((b): b is ToolUseBlock => b.type === "tool_use");
    if (result.stopReason === "refusal") {
      closeCalls(turn, calls, "The request was declined before this ran.");
      rows.append(bot, { kind: "notice", tone: "warn", text: result.detail ?? "The model declined this request." });
      return;
    }
    if (result.stopReason === "max_tokens") {
      closeCalls(turn, calls, "The reply was cut off before this call was complete, so it did not run.");
      rows.append(bot, { kind: "notice", tone: "warn", text: "The reply was cut off because it got too long. Ask me to continue." });
      return;
    }
    if (!calls.length) {
      const extra = drainSteering(bot);
      if (!extra.length) return;
      history.append(bot.id, turn.generation, { role: "user", content: extra.map(text) });
      continue;
    }
    const stepSeq: Record<string, number> = {};
    for (const call of calls) {
      const b = turn.builtin.get(call.name);
      stepSeq[call.id] = rows.append(bot, { kind: "step", callId: call.id, tool: call.name, label: b?.label ?? `Using ${turn.remote.get(call.name)?.connectorName ?? "an app"}`, status: "running", args: redact(call.input) }).seq;
    }
    const outcome = await processCalls(turn, { system: turn.system, tools: turn.tools, modelRef: turn.modelRef, pending: calls, results: [], stepSeq, generation: turn.generation, approvalId: "", depth: turn.depth, endTurn: false });
    if (outcome !== "continue") return;
    activity(turn, "thinking");
  }
  rows.append(bot, { kind: "notice", tone: "warn", text: `I stopped after ${config.maxSteps} steps to avoid running away with this. Tell me to continue if it is worth it.` });
}

function closeCalls(turn: Turn, calls: ToolUseBlock[], reason: string) {
  if (!calls.length) return;
  history.append(turn.bot.id, turn.generation, { role: "user", content: calls.map((c): ToolResultBlock => ({ type: "tool_result", toolUseId: c.id, isError: true, content: [text(reason)] })) });
}

/** Long arguments are shortened in the transcript; the model's own copy is untouched. */
function redact(input: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(input)) out[k] = typeof v === "string" ? clip(v, 400) : v;
  return out;
}

class StreamingRow {
  private row: Row | null = null;
  private buffer = "";
  private lastFlush = 0;
  constructor(private turn: Turn) {}
  get started() { return this.row !== null; }
  push(delta: string) {
    this.buffer += delta;
    if (!this.row) {
      if (!this.buffer.trim()) return;
      this.row = rows.append(this.turn.bot, { kind: "message", role: "assistant", text: this.buffer, streaming: true });
      this.lastFlush = Date.now();
    } else if (Date.now() - this.lastFlush > 120) {
      rows.rewrite(this.turn.bot, this.row.generation, this.row.seq, { kind: "message", role: "assistant", text: this.buffer, streaming: true });
      this.lastFlush = Date.now();
    }
  }
  /** Closes the row and returns what was said, if anything. */
  finish(sources?: { url: string; title?: string }[]): string {
    if (!this.row) return "";
    const said = this.buffer.trim();
    rows.rewrite(this.turn.bot, this.row.generation, this.row.seq, { kind: "message", role: "assistant", text: said, sources: sources?.length ? sources.slice(0, 12) : undefined });
    bots.bumpUnread(this.turn.bot.id);
    this.row = null;
    return said;
  }
}

// ── Tool execution, permissions, approvals ───────────────────────────────────
type Verdict = { kind: "allow" } | { kind: "block" } | { kind: "ask"; policyKey: string; title: string; source: string };

function judge(turn: Turn, call: ToolUseBlock): Verdict {
  const { bot, user } = turn;
  const builtin = turn.builtin.get(call.name);
  const remote = turn.remote.get(call.name);
  if (!builtin && !remote) return { kind: "allow" }; // unknown tools fail on their own with a clear error
  const key = builtin ? call.name : `${remote!.connectorName}: ${remote!.remoteName}`;
  const policy = policies.get(user.id, key);
  if (policy === "blocked") return { kind: "block" };
  if (policy === "always_allow") return { kind: "allow" };
  const title = builtin
    ? `Allow ${bot.name} to run a command?`
    : `Allow ${bot.name} to use ${remote!.connectorName}: ${remote!.remoteName.replace(/[_-]+/g, " ")}?`;
  const ask: Verdict = { kind: "ask", policyKey: key, title, source: builtin ? "This computer" : remote!.connectorName };
  if (policy === "needs_approval") return ask;
  if (builtin) return builtin.sensitive && bot.autonomy === "careful" ? ask : { kind: "allow" };
  return remote!.readOnly || bot.autonomy === "trusted" ? { kind: "allow" } : ask;
}

function describeArgs(input: Record<string, unknown>): string {
  const lines = Object.entries(input).filter(([, v]) => v === null || typeof v !== "object").slice(0, 6).map(([k, v]) => `${k}: ${clip(String(v), 160)}`);
  return clip(lines.join("\n"), 1200);
}

function setStep(turn: Turn, st: PausedTurn, call: ToolUseBlock, status: "running" | "done" | "error" | "waiting" | "denied", summary?: string) {
  const seq = st.stepSeq[call.id];
  const row = seq ? rows.get(turn.bot.id, st.generation, seq) : null;
  if (row?.body.kind === "step") rows.rewrite(turn.bot, st.generation, seq, { ...row.body, status, summary: summary ?? row.body.summary });
}

const DECLINED = "The user did not allow this. Do not try it again or look for a way around it — do the job another way, or say what could not be done.";

async function execute(turn: Turn, call: ToolUseBlock): Promise<ToolOutput> {
  const signature = `${call.name}:${JSON.stringify(call.input)}`;
  const seen = (turn.repeats.get(signature) ?? 0) + 1;
  turn.repeats.set(signature, seen);
  if (seen > 4) return { content: `You have made this exact call ${seen} times in this turn. Repeating it will not change the result — try something different or tell the user where you are stuck.`, isError: true, summary: "repeated call skipped" };

  const builtin = turn.builtin.get(call.name);
  if (builtin) {
    const problem = validateToolInput(builtin.spec, call.input);
    if (problem) return { content: `Invalid arguments: ${problem}.`, isError: true, summary: "invalid arguments" };
    activity(turn, builtin.activity, builtin.detail?.(call.input));
    return builtin.run(call.input, { bot: turn.bot, user: turn.user, depth: turn.depth, signal: turn.signal });
  }
  const remote = turn.remote.get(call.name);
  if (remote) {
    activity(turn, "connector", remote.connectorName);
    const r = await connectors.call(remote.connectorId, remote.remoteName, call.input);
    return { content: r.text, isError: r.isError, summary: r.isError ? "failed" : "done" };
  }
  return { content: `There is no tool called "${call.name}".`, isError: true, summary: "unknown tool" };
}

/**
 * Works through a batch of tool calls in order. Returns "continue" when the model should be called
 * again, "end" when a tool closed the turn, and "paused" when it stopped to ask for permission.
 */
async function processCalls(turn: Turn, st: PausedTurn): Promise<"continue" | "end" | "paused"> {
  const { bot, user } = turn;
  let decided: "allow" | "deny" | null = null;
  if (st.approvalId) {
    const status = approvals.byId(st.approvalId)?.status;
    if (status === "pending") return "paused";
    decided = status === "allowed" || status === "always" ? "allow" : "deny";
    st.approvalId = "";
  }
  while (st.pending.length) {
    if (turn.signal.aborted) {
      // Record what we have so the next turn starts from a consistent transcript.
      for (const call of st.pending) { st.results.push({ type: "tool_result", toolUseId: call.id, isError: true, content: [text("Not run: the user stopped the turn.")] }); setStep(turn, st, call, "denied", "stopped"); }
      st.pending = [];
      history.append(bot.id, st.generation, { role: "user", content: st.results });
      paused.clear(bot.id);
      throw new Error("aborted");
    }
    const call = st.pending[0];
    const verdict: Verdict = decided === "allow" ? { kind: "allow" } : decided === "deny" ? { kind: "block" } : judge(turn, call);
    decided = null;
    if (verdict.kind === "ask") {
      const approvalId = newId("apr");
      const card = rows.append(bot, { kind: "card", card: { type: "approval", approvalId, title: verdict.title, detail: describeArgs(call.input), tool: verdict.policyKey, source: verdict.source, status: "pending" } });
      approvals.create(bot.id, user.id, st.generation, card.seq, verdict.policyKey, approvalId);
      setStep(turn, st, call, "waiting");
      st.approvalId = approvalId;
      paused.set(bot.id, st);
      setLive(user.id, bot.id, { running: false, activity: { kind: "waiting", since: Date.now() }, awaiting: { reason: verdict.title.replace(/^Allow \S+ to /, "").replace(/\?$/, ""), since: Date.now() } });
      emit(user.id, { type: "tasks", botId: bot.id });
      return "paused";
    }
    let out: ToolOutput;
    if (verdict.kind === "block") {
      out = { content: DECLINED, isError: true };
      setStep(turn, st, call, "denied", "not allowed");
    } else {
      setStep(turn, st, call, "running");
      try {
        out = await execute(turn, call);
        setStep(turn, st, call, out.isError ? "error" : "done", out.summary);
      } catch (err) {
        const message = String((err as Error)?.message ?? err);
        out = { content: `Tool error: ${message}`, isError: true };
        setStep(turn, st, call, "error", clip(message, 200));
      }
    }
    st.results.push({ type: "tool_result", toolUseId: call.id, isError: out.isError || undefined, content: typeof out.content === "string" ? [text(out.content)] : out.content });
    st.endTurn ||= !!out.endTurn;
    st.pending.shift();
  }
  // Anything the user typed meanwhile rides along with the results, so the model sees it at once.
  const extra = st.endTurn ? [] : drainSteering(bot);
  history.append(bot.id, st.generation, { role: "user", content: [...st.results, ...extra.map(text)] });
  paused.clear(bot.id);
  return st.endTurn ? "end" : "continue";
}

/** A new message arrived while an approval was open: the old request lapses and its calls are closed. */
function supersede(bot: BotRecord, st: PausedTurn) {
  const approval = approvals.byId(st.approvalId);
  if (approval?.status === "pending") {
    approvals.resolve(approval.id, "expired");
    rows.updateCard(bot, approval.generation, approval.seq, (c) => (c.type === "approval" ? { ...c, status: "expired" } : c));
  }
  for (const call of st.pending) {
    st.results.push({ type: "tool_result", toolUseId: call.id, isError: true, content: [text("Skipped: the user sent a new message before this ran. Do not retry it unless they ask.")] });
    const seq = st.stepSeq[call.id];
    const row = seq ? rows.get(bot.id, st.generation, seq) : null;
    if (row?.body.kind === "step") rows.rewrite(bot, st.generation, seq, { ...row.body, status: "denied", summary: "skipped" });
  }
  if (st.generation === bot.generation) history.append(bot.id, st.generation, { role: "user", content: st.results });
  paused.clear(bot.id);
}

export function decideApproval(userId: string, approvalId: string, decision: "allow" | "always" | "deny"): boolean {
  const approval = approvals.byId(approvalId);
  if (!approval || approval.userId !== userId) return false;
  if (approval.status !== "pending") return true;
  const bot = bots.byId(approval.botId);
  if (!bot) return false;
  const status = decision === "allow" ? "allowed" : decision === "always" ? "always" : "denied";
  approvals.resolve(approvalId, status);
  if (decision === "always") policies.set(userId, approval.tool, "always_allow");
  rows.updateCard(bot, approval.generation, approval.seq, (c) => (c.type === "approval" ? { ...c, status } : c));
  enqueue(bot.id, { kind: "resume" });
  return true;
}

function noteCheckinOutcome(userId: string, spoke: boolean) {
  const cur = settings.checkins(userId);
  settings.saveCheckins(userId, { ...cur, quietStreak: spoke ? 0 : cur.quietStreak + 1 });
}

export const liveOf = getLive;
