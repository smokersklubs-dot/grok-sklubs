import { q } from "../db.js";
import { tr } from "../i18n.js";
import { modelAvailable, ProviderError } from "../llm/index.js";
import { isHostedStop } from "../hosted.js";
import { pushLater, type PushMessage } from "../push.js";
import { maskSecrets, type Card, type Engine, type FailureAuto, type FailureClass, type FailureRemedy, type FailureStatus, type FailureSummary, type FailureTry, type FailureView, type Locale } from "../shared.js";
import { audit, bots, clip, newId, now, redactSecrets, rows, settings, users, type BotRecord } from "../store.js";
import { engineOf, isEngineRef } from "./engine.js";
import { enqueue, isPaused, type Trigger } from "./loop.js";
import { backoffDelay, type LoopStop } from "./reliability.js";
import { failureCode } from "../sentinel/signals.js";
import { CODEX_LIMIT_TEXT, claudeLimitFromText, subLimitFor } from "./sublimit.js";
import { deliverBotMessage } from "./team.js";

/**
 * « Coordinateur d'échecs » — what happens when a bot's work fails, built ON TOP of what already handles failures:
 * the model-call retries and backup models (reliability.ts, loop.ts modelLoop), the subscription's backup model
 * (loop.ts engineFallback), the subscription limit (sublimit.ts), the turn watch (watch.ts), the loop guard, the
 * "did it go through?" executions (executions.ts) and the Sentinelle's counters (sentinel/signals.ts failureCode).
 * Those run first; whatever is still failing when they are done comes here, from the API path and the engine path alike.
 *
 *  1. classifyFailure: one stable code per failure (FAILURE_CLASSES), from the error object, its HTTP status and text.
 *  2. decideFailure (pure): a new try with backoff for passing problems (bounded, and never after an action whose outcome
 *     is unknown or a subscription turn that already did something), the backup model, waiting for a reset, a teammate
 *     whose brain works (« Entraide entre bots », on by default), or ONE card asking the owner, with real remedies.
 *  3. Never a dead end: every failure the owner must see ends on a card with at least one remedy that unblocks; what the
 *     bot did so far is kept (nothing here deletes or replays a step). A push only when the owner is needed (push.ts:
 *     their notification switches and quiet hours apply).
 *  4. A log per bot (bot_failures, migration 22) for the « Incidents » section and the day's summary on « Aujourd'hui ».
 *  5. Anti-storm: the same class for the same bot within 10 minutes updates one card (a counter); a provider failing for
 *     many bots at once opens a circuit breaker: one notice per account (push + Aujourd'hui), not one card per bot, and
 *     the bots' work is tried again when the breaker closes.
 * Isolation: everything is keyed by the bot's own account; a teammate is always a bot of the same account.
 */

export const DEDUPE_MS = 10 * 60_000;
export const MAX_AUTO_RETRIES = 2;
export const BREAKER_BOTS = 3;
const timing = { retryBaseMs: 20_000, retryMaxMs: 120_000, breakerOpenMs: 10 * 60_000 };
/** Tests: shorter waits. */
export const setFailureTiming = (t: Partial<typeof timing>) => Object.assign(timing, t);
let push: (userId: string, msg: PushMessage) => void = pushLater;
/** Tests: watch the notifications instead of sending them. */
export const setFailurePush = (fn: ((userId: string, msg: PushMessage) => void) | null) => { push = fn ?? pushLater; };

/** Passing problems another try may fix. */
export const TRANSIENT: ReadonlySet<FailureClass> = new Set(["provider_down", "rate_limited", "timeout"]);
/** Failures of the bot's brain (its model or subscription), not of the task: a teammate with another brain may take over. */
export const HANDOFF_CLASSES: ReadonlySet<FailureClass> = new Set(["provider_down", "rate_limited", "timeout", "auth_expired", "out_of_budget"]);
/** Failures of the task itself (a step, a loop, the request): only the owner's decision or a new try settles them. */
const TASK_LEVEL: ReadonlySet<FailureClass> = new Set(["tool_error", "loop_detected", "bad_input"]);

// ── 1. Classification ───────────────────────────────────────────────────────────────────────────────────────────
export interface FailureInput { err?: unknown; text?: string; status?: number | null; code?: string | null; loopStop?: LoopStop | null; tool?: string }
export interface Classified { cls: FailureClass; tool: string; status: number | null }

/** Claude Code / Codex / the turn's own words for "sign in again" (engine.ts signInHint, both languages). */
const SIGN_IN = /not signed in to (ChatGPT|Claude)|pas encore connecté à (ChatGPT|Claude)|log ?out and sign in again|please obtain a new token|token (has )?expired/i;
/** Out of money on an API account (Anthropic "credit balance is too low", OpenAI insufficient_quota, HTTP 402, OpenRouter credits). */
const OUT_OF_BUDGET = /insufficient[_ ](quota|credits?|funds|balance)|credit balance is too low|exceeded your current quota|payment required|billing (hard )?limit|not enough credits|out of credits?|budget (is )?(used up|exceeded|spent)|plus de crédits|crédits? (épuisés|insuffisants)/i;
const SUB_LIMIT = /subscription has reached its usage limit|a atteint sa limite d'utilisation/i;
/** The bot's computer (Docker, the desktop image) is not there, not running, or out of disk. */
const COMPUTER_DOWN = /no such container|container\b.{0,80}\bis not running|cannot connect to the docker daemon|is the docker daemon running|OCI runtime|could not start (the |its |my )?computer|computer (is )?(off|down|unreachable)|no space left on device|ENOSPC/i;
const TIMEOUT = /timed? ?out|timeout|took too long|ETIMEDOUT|UND_ERR_(HEADERS|BODY|CONNECT)_TIMEOUT|time limit/i;
/** The service itself (Codex's "stream disconnected before completion", a 5xx page, a dropped connection). */
const PROVIDER_DOWN = /stream disconnected|error sending request|connection (reset|closed|refused|error)|service unavailable|bad gateway|internal server error|overloaded|api_error|could not be reached/i;
const BAD_INPUT = /invalid_request_error|invalid request|bad request|unsupported (image|file|media|format)|could not process (the )?(image|file)|malformed|validation error/i;

/** The HTTP status in an error's words ("API error 503: …", "API Error: 529 {…}", "unexpected status 401"). */
const statusIn = (text: string): number | null => {
  const m = /\b(?:api error|status|http)[: ]+(\d{3})\b/i.exec(text);
  return m ? Number(m[1]) : null;
};

export function classifyFailure(i: FailureInput): Classified {
  if (i.loopStop) return { cls: i.loopStop.kind === "fail" ? "tool_error" : "loop_detected", tool: i.loopStop.tool, status: null };
  const e = i.err as { name?: string; message?: string; code?: string; cause?: unknown; reason?: string } | null | undefined;
  const names: string[] = [];
  for (let x: any = e, n = 0; x && n < 5; x = x.cause, n++) { if (x.name) names.push(String(x.name)); if (typeof x.code === "string") names.push(x.code); }
  const text = [i.text ?? "", e ? String(e.message ?? e) : "", names.join(" ")].join(" ").trim();
  const pe = i.err instanceof ProviderError ? i.err : null;
  const status = i.status ?? pe?.status ?? statusIn(text);
  const code = i.code ?? pe?.code ?? null;
  const tool = i.tool ?? "";
  const out = (cls: FailureClass): Classified => ({ cls, tool, status });
  if (names.includes("EngineTimeout") || names.includes("TimeoutError")) return out("timeout");
  if (names.includes("ComputersBusyError") || names.includes("EngineGone") || COMPUTER_DOWN.test(text)) return out("computer_down");
  if (isHostedStop(e)) return out("out_of_budget");
  if (SUB_LIMIT.test(text) || claudeLimitFromText(text) || CODEX_LIMIT_TEXT.test(text)) return out("subscription_limit");
  if (code === "out_of_credit" || status === 402 || OUT_OF_BUDGET.test(text)) return out("out_of_budget");
  const fc = failureCode(text, status, code);
  if (fc === "auth" || SIGN_IN.test(text)) return out("auth_expired");
  if (fc === "context") return out("bad_input");
  if (fc === "rate_limit") return out("rate_limited");
  if (status === 408 || status === 504 || TIMEOUT.test(text)) return out("timeout");
  if (fc === "overloaded" || fc === "server" || fc === "network" || PROVIDER_DOWN.test(text)) return out("provider_down");
  if ((status !== null && status >= 400 && status < 500) || BAD_INPUT.test(text)) return out("bad_input");
  return out(i.tool ? "tool_error" : "unknown");
}

// ── 2. Decision (pure) ──────────────────────────────────────────────────────────────────────────────────────────
export interface DecideInput {
  cls: FailureClass;
  /** Automatic new tries already made for this incident. */
  retries: number;
  /** An action of this work may have gone through (an execution left uncertain or running, a subscription step done). */
  uncertain: boolean;
  /** The path that failed already put a notice with its own way forward (Continue, the subscription's wait). */
  existingRemedy?: boolean;
  /** The bot's next backup model, when one may still take over. */
  fallback?: string | null;
  /** A bot of the same account whose brain works, when « Entraide entre bots » is on and the work may be handed over. */
  teammate?: { id: string; name: string } | null;
  /** The provider's circuit breaker is open (it fails for many bots right now). */
  breakerOpen?: boolean;
  /** The bot runs on a subscription engine (Claude Code / Codex). */
  engine?: Engine | null;
  rand?: number;
}
export interface Decision {
  auto: FailureAuto | null;
  /** For "retry" / "provider_wait": when the new try goes. */
  delayMs?: number;
  remedies: FailureRemedy[];
  /** Post (or update) a card in the chat. */
  card: boolean;
  /** Notify the owner (only when they are needed). */
  notify: boolean;
}

/** The buttons for a class: the first one is the main way out. Always at least one that unblocks. */
export function remediesFor(cls: FailureClass, o: { engine?: Engine | null; teammate?: boolean } = {}): FailureRemedy[] {
  const base: Record<FailureClass, FailureRemedy[]> = {
    provider_down: ["retry", "switch_model"], rate_limited: ["retry", "switch_model"], timeout: ["retry", "switch_model"],
    subscription_limit: ["switch_model", "retry"],
    auth_expired: o.engine ? ["reconnect", "switch_model"] : ["connect_account", "switch_model"],
    out_of_budget: ["connect_account", "switch_model"],
    tool_error: ["retry", "continue_without"], loop_detected: ["continue_without", "retry"],
    computer_down: ["restart_computer", "retry"], bad_input: ["retry", "switch_model"], unknown: ["retry", "switch_model"],
  };
  const list = [...base[cls]];
  if (o.teammate && (HANDOFF_CLASSES.has(cls) || cls === "unknown" || cls === "subscription_limit")) list.push("handoff");
  return list;
}

export function decideFailure(d: DecideInput): Decision {
  const remedies = remediesFor(d.cls, { engine: d.engine, teammate: !!d.teammate });
  // The subscription's limit has its own notice, queue and "back at …" (sublimit.ts): logged here, nothing more.
  if (d.cls === "subscription_limit") return { auto: d.fallback ? "fallback" : "wait", remedies, card: false, notify: false };
  // A notice with its own way forward is already there (Continue after the time limit, a computer that stopped…).
  if (d.existingRemedy) return { auto: null, remedies, card: false, notify: false };
  if (d.fallback && !TASK_LEVEL.has(d.cls) && d.cls !== "computer_down") return { auto: "fallback", remedies, card: false, notify: false };
  const safe = !d.uncertain;
  if (TRANSIENT.has(d.cls) && safe && d.breakerOpen) return { auto: "provider_wait", delayMs: timing.breakerOpenMs, remedies, card: false, notify: false };
  if (TRANSIENT.has(d.cls) && safe && d.retries < MAX_AUTO_RETRIES) {
    const delayMs = backoffDelay(d.retries, null, d.rand ?? Math.random(), timing.retryBaseMs, timing.retryMaxMs) ?? timing.retryMaxMs;
    return { auto: "retry", delayMs, remedies, card: true, notify: false };
  }
  if (d.teammate && HANDOFF_CLASSES.has(d.cls)) return { auto: "handoff", remedies, card: true, notify: false };
  return { auto: null, remedies, card: true, notify: true };
}

// ── The log (bot_failures) ──────────────────────────────────────────────────────────────────────────────────────
interface FailureRow { id: string; user_id: string; bot_id: string; class: FailureClass; tool: string; provider: string; detail: string; tried: string; status: FailureStatus; resolved_by: string; count: number; retries: number; generation: number | null; seq: number | null; thread: number; first_at: number; last_at: number; resolved_at: number | null }
const triedOf = (r: FailureRow): FailureTry[] => { try { const v = JSON.parse(r.tried); return Array.isArray(v) ? v : []; } catch { return []; } };
const toView = (r: FailureRow): FailureView => ({ id: r.id, botId: r.bot_id, cls: r.class, tool: r.tool, provider: r.provider, detail: r.detail, tried: triedOf(r), status: r.status, resolvedBy: (r.resolved_by as FailureView["resolvedBy"]) || "", count: r.count, firstAt: r.first_at, lastAt: r.last_at, resolvedAt: r.resolved_at });
const OPEN = "('auto', 'waiting', 'retrying')";

export const failures = {
  byId: (id: string) => q.get<FailureRow>("SELECT * FROM bot_failures WHERE id = ?", id) ?? null,
  /** The bot's incidents, newest first. Only ever one bot of the caller's own account (routes check ownership). */
  list: (botId: string, limit = 50) => q.all<FailureRow>("SELECT * FROM bot_failures WHERE bot_id = ? ORDER BY last_at DESC LIMIT ?", botId, limit).map(toView),
  open: (botId: string) => q.all<FailureRow>(`SELECT * FROM bot_failures WHERE bot_id = ? AND status IN ${OPEN} ORDER BY last_at DESC`, botId),
};

function sameOpen(botId: string, cls: FailureClass, tool: string, t: number, provider: string, thread: number): FailureRow | null {
  return q.get<FailureRow>(`SELECT * FROM bot_failures WHERE bot_id = ? AND class = ? AND tool = ? AND provider = ? AND thread = ? AND status IN ${OPEN} AND last_at > ? ORDER BY last_at DESC LIMIT 1`, botId, cls, tool, provider, thread, t - DEDUPE_MS) ?? null;
}

function save(r: FailureRow) {
  q.run(`INSERT INTO bot_failures (id, user_id, bot_id, class, tool, provider, detail, tried, status, resolved_by, count, retries, generation, seq, thread, first_at, last_at, resolved_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET detail = excluded.detail, tried = excluded.tried, status = excluded.status, resolved_by = excluded.resolved_by,
      count = excluded.count, retries = excluded.retries, generation = excluded.generation, seq = excluded.seq, thread = excluded.thread,
      last_at = excluded.last_at, resolved_at = excluded.resolved_at, provider = excluded.provider`,
  r.id, r.user_id, r.bot_id, r.class, r.tool, r.provider, r.detail, r.tried, r.status, r.resolved_by, r.count, r.retries, r.generation, r.seq, r.thread, r.first_at, r.last_at, r.resolved_at);
}

const cardStatus = (s: FailureStatus): Extract<Card, { type: "failure" }>["status"] =>
  s === "auto" || s === "retrying" ? "retrying" : s === "waiting" ? "pending" : s === "handed" ? "handed" : s === "resolved" ? "resolved" : "dismissed";

/** Puts the incident's card in the chat, or updates the one it has (one card per incident, with a counter). */
function showCard(bot: BotRecord, r: FailureRow, extra: { remedies: FailureRemedy[]; engine?: Engine | null; teammate?: { id: string; name: string } | null; retryAt?: number }) {
  const card: Extract<Card, { type: "failure" }> = {
    type: "failure", failureId: r.id, cls: r.class, ...(r.tool ? { tool: r.tool } : {}), detail: r.detail, tried: triedOf(r), remedies: extra.remedies,
    count: r.count, status: cardStatus(r.status), ...(extra.engine ? { engine: extra.engine } : {}), ...(extra.teammate ? { teammate: extra.teammate } : {}), ...(extra.retryAt ? { retryAt: extra.retryAt } : {}),
  };
  if (r.seq !== null && r.generation === bot.generation && rows.updateCard(bot, r.generation, r.seq, (k) => (k.type === "failure" && k.failureId === r.id ? card : k))) return;
  const row = rows.append(bot, { kind: "card", card }, r.thread || undefined);
  r.generation = bot.generation; r.seq = row.seq;
  bots.bumpUnread(bot.id);
}

/** Updates the card of an incident whose status changed (resolved, dismissed…), keeping its buttons. */
function refreshCard(r: FailureRow) {
  if (r.seq === null || r.generation === null) return;
  const bot = bots.byId(r.bot_id);
  if (!bot || bot.generation !== r.generation) return;
  rows.updateCard(bot, r.generation, r.seq, (k) => (k.type === "failure" && k.failureId === r.id ? { ...k, status: cardStatus(r.status), tried: triedOf(r), count: r.count, retryAt: undefined } : k));
}

// ── Circuit breaker per provider ────────────────────────────────────────────────────────────────────────────────
interface Breaker { hits: Map<string, { at: number; userId: string }>; openUntil: number; since: number; told: Set<string> }
const breakers = new Map<string, Breaker>();
/** Tests: forget the breakers and the planned new tries. */
export function resetFailureState() { breakers.clear(); for (const t of timers.values()) clearTimeout(t); timers.clear(); }

/** A transient failure of `provider` for `bot`. Returns whether the provider's breaker is open now. */
export function noteProviderFailure(provider: string, bot: Pick<BotRecord, "id" | "userId">, t = now()): boolean {
  if (!provider) return false;
  let b = breakers.get(provider);
  if (!b) breakers.set(provider, (b = { hits: new Map(), openUntil: 0, since: 0, told: new Set() }));
  for (const [id, h] of b.hits) if (h.at < t - DEDUPE_MS) b.hits.delete(id);
  b.hits.set(bot.id, { at: t, userId: bot.userId });
  if (b.openUntil <= t && b.hits.size >= BREAKER_BOTS) { b.openUntil = t + timing.breakerOpenMs; b.since = t; b.told.clear(); }
  return b.openUntil > t;
}
export const breakerOpen = (provider: string, t = now()) => (breakers.get(provider)?.openUntil ?? 0) > t;

/** One notice per account and outage (a push and the Aujourd'hui line), never one per bot. */
function tellOutage(provider: string, userId: string, locale: Locale | undefined) {
  const b = breakers.get(provider);
  if (!b || b.told.has(userId)) return;
  b.told.add(userId);
  const mine = [...b.hits.values()].filter((h) => h.userId === userId).length;
  push(userId, { kind: "needs", title: tr(locale, "{provider} is not answering", { provider: providerLabel(provider) }), body: tr(locale, "{n} of your bots are affected. Their work is kept and will be tried again on its own.", { n: mine }), tag: `outage-${provider}` });
  audit(userId, "system", `${providerLabel(provider)} is failing for several bots: one notice, their work is tried again when it answers`);
}
const providerLabel = (p: string) => ({ "claude-code": "Claude", codex: "ChatGPT", anthropic: "Anthropic", openai: "OpenAI", openrouter: "OpenRouter" } as Record<string, string>)[p] ?? p;

// ── Planned new tries ───────────────────────────────────────────────────────────────────────────────────────────
const timers = new Map<string, NodeJS.Timeout>();
const RETRY_TEXT = "Your last turn stopped on a temporary problem ({why}). This is a new try: pick the work back up where it stopped — check what is already done and do not redo any action that may already have gone through — then finish it, or say plainly where things stand.";
const CONTINUE_WITHOUT_TEXT = "The step {tool} failed. Your owner asks you to carry on without it: do not try that step again, finish what you can, and say plainly what was left undone.";
const LOOP_TEXT = "You were going round in circles ({why}). Your owner asks you to try a different way: do not repeat the same call, step back, and finish the work another way, or say plainly what blocks you.";

interface Resume { thread: number; tainted?: boolean; origin?: string; task?: string }
/** The work goes on in a new turn (the queue keeps it across a restart once it is enqueued). */
function resumeWork(r: FailureRow, text: string, res: Resume, byPerson: boolean) {
  const bot = bots.byId(r.bot_id);
  if (!bot) return;
  // A subscription engine keeps its own session, which may not hold the message it was answering: it rides along.
  const task = res.task && isEngineRef(bot.model) ? `\n\nThe message you were answering:\n${res.task}` : "";
  enqueue(bot.id, { kind: "system", text: text + task, thread: res.thread || undefined, tainted: res.tainted || undefined, origin: res.origin, ...(byPerson ? { byPerson: true } : { unattended: res.origin !== "user" ? true : undefined }) });
}
const resumes = new Map<string, Resume>();
function planRetry(r: FailureRow, delayMs: number, why: string) {
  const old = timers.get(r.id);
  if (old) clearTimeout(old);
  const timer = setTimeout(() => {
    timers.delete(r.id);
    const cur = failures.byId(r.id);
    if (!cur || (cur.status !== "auto" && cur.status !== "retrying")) return;
    resumeWork(cur, RETRY_TEXT.replace("{why}", why), resumes.get(r.id) ?? { thread: cur.thread }, false);
  }, Math.max(0, delayMs));
  timer.unref?.();
  timers.set(r.id, timer);
}

// ── Teammates (« Entraide entre bots ») ─────────────────────────────────────────────────────────────────────────
const brainOf = (ref: string) => (isEngineRef(ref) ? engineOf(ref) : ref.split(":")[0] ?? "");
/**
 * A bot of the same account whose brain is not the failing one and works now: an agent (not a helper, not hidden, not
 * paused), on another provider or subscription, not at its subscription's limit, with no open brain failure and whose
 * provider is not failing for many bots. The account's main bot first.
 */
export function findTeammate(bot: BotRecord, failingBrain = brainOf(bot.model)): BotRecord | null {
  if (!settings.reliability(bot.userId).mutualAid) return null;
  const t = now();
  const mates = bots.list(bot.userId).filter((b) => b.id !== bot.id && b.kind === "agent" && !b.hidden && !b.parentId && b.userId === bot.userId);
  mates.sort((a, b) => Number(b.primary) - Number(a.primary));
  for (const m of mates) {
    const brain = brainOf(m.model);
    if (!brain || brain === failingBrain || isPaused(m) || subLimitFor(m) || breakerOpen(brain, t)) continue;
    if (!isEngineRef(m.model) && !modelAvailable(m.model, m.userId)) continue;
    if (q.get(`SELECT 1 FROM bot_failures WHERE bot_id = ? AND status IN ${OPEN} AND class IN ('auth_expired','out_of_budget','provider_down','rate_limited','timeout') AND last_at > ?`, m.id, t - DEDUPE_MS)) continue;
    return m;
  }
  return null;
}

function handTo(bot: BotRecord, mate: BotRecord, cls: FailureClass, task: string, locale: Locale | undefined) {
  // Only the task travels: the owner's words (vault values and pasted secrets masked), never the bot's memory or vault.
  const clean = maskSecrets(redactSecrets(bot.userId, clip(task, 2000)), "[secret]").text;
  const text = tr(locale, "{from} could not finish this work ({why}) and hands it to you. Do it yourself and answer {owner} in your own chat — do not send it back to {from}, whose brain is not working right now.\n\nThe request:\n{task}", { from: bot.name, why: tr(locale, CLASS_TITLES[cls]), owner: users.byId(bot.userId)?.name ?? "", task: clean });
  deliverBotMessage(bot, mate, text, 0, true);
  audit(bot.userId, "system", `${bot.name}: work handed to ${mate.name} after a failure (${cls})`, bot.id);
}

/** The class's short title (server side: pushes, Aujourd'hui); the chat card is worded by the web app from `cls`. */
export const CLASS_TITLES: Record<FailureClass, string> = {
  provider_down: "The AI service is not answering", rate_limited: "Too many requests for now", subscription_limit: "The subscription is at its limit",
  auth_expired: "The account needs signing in again", out_of_budget: "No credit left for the AI", tool_error: "A step failed",
  computer_down: "The computer is not working", timeout: "It took too long", loop_detected: "It was going round in circles",
  bad_input: "The AI could not take this request", unknown: "Something went wrong",
};

// ── 3. The coordinator ──────────────────────────────────────────────────────────────────────────────────────────
export interface FailureContext extends FailureInput {
  bot: BotRecord;
  trigger: Trigger;
  thread: number;
  /** When the failed turn started: executions begun since then that stayed uncertain or running block a new try. */
  since: number;
  /** The subscription tool did something (steps) or spoke before failing: never run it again on its own. */
  didSomething?: boolean;
  existingRemedy?: boolean;
  /** The model's provider id or the engine ("claude-code", "codex"), for the circuit breaker. */
  provider?: string;
  /** The backup model already used for this turn (the fallback path), logged as tried. */
  fallbackUsed?: string;
  origin?: string;
  tainted?: boolean;
}
export interface FailureOutcome { id: string; cls: FailureClass; decision: Decision; card: boolean }

/** The task in words, for a teammate or a new try of a subscription turn. */
function taskOf(trigger: Trigger): string {
  if (trigger.kind === "user") return trigger.member || trigger.api ? "" : trigger.text;
  if (trigger.kind === "routine") return trigger.text;
  return "";
}

/** Whether an action of this work may have gone through (executions.ts: uncertain, or still marked running). */
export function uncertainSince(botId: string, since: number): boolean {
  return !!q.get("SELECT 1 FROM executions WHERE bot_id = ? AND started_at >= ? AND status IN ('uncertain', 'running') LIMIT 1", botId, since);
}

export function handleFailure(ctx: FailureContext): FailureOutcome | null {
  const { bot } = ctx;
  // A hidden helper (background task) reports to its task's card; a group chat has no brain of its own.
  if (bot.hidden || bot.kind !== "agent") return null;
  const user = users.byId(bot.userId);
  const loc = user?.locale;
  const c = classifyFailure(ctx);
  const t = now();
  const engine = isEngineRef(bot.model) ? engineOf(bot.model) : null;
  const provider = ctx.provider ?? brainOf(bot.model);
  const open = TRANSIENT.has(c.cls) ? noteProviderFailure(provider, bot, t) : breakerOpen(provider, t);
  const uncertain = !!ctx.didSomething || uncertainSince(bot.id, ctx.since);
  const prev = sameOpen(bot.id, c.cls, c.tool, t, provider, ctx.thread);
  const mayHand = ctx.trigger.kind === "user" ? !ctx.trigger.member && !ctx.trigger.api : ctx.trigger.kind === "routine";
  const mate = mayHand && (HANDOFF_CLASSES.has(c.cls) || c.cls === "unknown" || c.cls === "subscription_limit") ? findTeammate(bot, provider) : null;
  const decision = decideFailure({ cls: c.cls, retries: prev?.retries ?? 0, uncertain, existingRemedy: ctx.existingRemedy, fallback: ctx.fallbackUsed ?? null, teammate: mate ? { id: mate.id, name: mate.name } : null, breakerOpen: open, engine });
  const detail = clip(redactSecrets(bot.userId, String(ctx.text || (ctx.err as Error)?.message || ctx.err || "").replace(/\s+/g, " ").trim()), 400);
  const r: FailureRow = prev ? { ...prev, count: prev.count + 1, last_at: t, detail: detail || prev.detail, provider } : {
    id: newId("fail"), user_id: bot.userId, bot_id: bot.id, class: c.cls, tool: c.tool, provider, detail, tried: "[]", status: "waiting", resolved_by: "",
    count: 1, retries: 0, generation: null, seq: null, thread: ctx.thread, first_at: t, last_at: t, resolved_at: null,
  };
  const tried = triedOf(r);
  // The previous automatic try, if any, did not work.
  for (const x of tried) if (x.ok === null) x.ok = false;
  let retryAt: number | undefined;
  switch (decision.auto) {
    case "retry":
      tried.push({ action: "retry", at: t, ok: null });
      r.status = "auto"; r.retries += 1; retryAt = t + (decision.delayMs ?? 0);
      resumes.set(r.id, { thread: ctx.thread, tainted: ctx.tainted, origin: ctx.origin, task: taskOf(ctx.trigger) });
      planRetry(r, decision.delayMs ?? 0, tr(undefined, CLASS_TITLES[c.cls]));
      break;
    case "provider_wait":
      tried.push({ action: "provider_wait", at: t, ok: null, note: provider });
      r.status = "auto"; r.retries += 1;
      resumes.set(r.id, { thread: ctx.thread, tainted: ctx.tainted, origin: ctx.origin, task: taskOf(ctx.trigger) });
      planRetry(r, Math.max(0, (breakers.get(provider)?.openUntil ?? t) - t), tr(undefined, CLASS_TITLES[c.cls]));
      tellOutage(provider, bot.userId, loc);
      break;
    case "fallback":
      tried.push({ action: "fallback", at: t, ok: true, note: ctx.fallbackUsed ?? "" });
      r.status = "resolved"; r.resolved_by = "auto"; r.resolved_at = t;
      break;
    case "wait":
      tried.push({ action: "wait", at: t, ok: null });
      r.status = "auto";
      break;
    case "handoff":
      tried.push({ action: "handoff", at: t, ok: true, note: mate!.name });
      r.status = "handed"; r.resolved_by = "auto"; r.resolved_at = t;
      handTo(bot, mate!, c.cls, taskOf(ctx.trigger), loc);
      break;
    default:
      r.status = "waiting";
  }
  r.tried = JSON.stringify(tried.slice(-12));
  if (decision.card) showCard(bot, r, { remedies: decision.remedies, engine, teammate: mate ? { id: mate.id, name: mate.name } : null, retryAt });
  save(r);
  // Only what needs the owner, and once per incident (an update of the same card does not ring again).
  if (decision.notify && (!prev || prev.status !== "waiting")) push(bot.userId, { kind: "needs", title: bot.name, body: `${tr(loc, CLASS_TITLES[c.cls])}${c.tool ? ` (${c.tool})` : ""}`, botId: bot.id, tag: `failure-${r.id}` });
  if (!prev) audit(bot.userId, "system", `${bot.name}: failure ${c.cls}${c.tool ? ` (${c.tool})` : ""} — ${decision.auto ?? "asks the owner"}`, bot.id);
  return { id: r.id, cls: c.cls, decision, card: decision.card };
}

/**
 * A backup model took the work over by itself (modelLoop's chain, engineFallback): logged as fixed automatically, with no
 * card (the chat already says which model carries on). Dedupe as usual.
 */
export function noteFallback(bot: BotRecord, err: unknown, from: string, to: string, thread = 0) {
  if (bot.hidden || bot.kind !== "agent") return;
  try {
    const c = classifyFailure({ err, text: typeof err === "string" ? err : undefined });
    const t = now();
    const prev = sameOpen(bot.id, c.cls, c.tool, t, brainOf(from), thread) ?? q.get<FailureRow>("SELECT * FROM bot_failures WHERE bot_id = ? AND class = ? AND provider = ? AND thread = ? AND status = 'resolved' AND resolved_by = 'auto' AND last_at > ? ORDER BY last_at DESC LIMIT 1", bot.id, c.cls, brainOf(from), thread, t - DEDUPE_MS) ?? null;
    const r: FailureRow = prev ? { ...prev, count: prev.count + 1, last_at: t } : { id: newId("fail"), user_id: bot.userId, bot_id: bot.id, class: c.cls, tool: "", provider: brainOf(from), detail: clip(redactSecrets(bot.userId, String((err as Error)?.message ?? err)), 400), tried: "[]", status: "resolved", resolved_by: "auto", count: 1, retries: 0, generation: null, seq: null, thread, first_at: t, last_at: t, resolved_at: t };
    const tried = triedOf(r);
    tried.push({ action: "fallback", at: t, ok: true, note: to });
    r.tried = JSON.stringify(tried.slice(-12));
    if (r.status === "auto" || r.status === "retrying") { r.status = "resolved"; r.resolved_by = "auto"; r.resolved_at = t; refreshCard(r); }
    save(r);
  } catch (err2) { console.error("[failures]", (err2 as Error)?.message ?? err2); }
}

/**
 * A turn of the bot went through: its open brain-level incidents are settled (fixed automatically when the coordinator
 * was handling them, by the owner otherwise), and the automatic try that led here worked. Task-level ones (a step, a loop,
 * the request) stay until the owner settles them, unless they were being retried.
 */
export function noteTurnOk(bot: Pick<BotRecord, "id">, model: string, thread: number) {
  try {
    const t = now();
    for (const r of failures.open(bot.id)) {
      if (r.provider !== brainOf(model) || (TASK_LEVEL.has(r.class) && (r.status === "waiting" || r.thread !== thread))) continue;
      const tried = triedOf(r);
      for (const x of tried) if (x.ok === null) x.ok = true;
      const next: FailureRow = { ...r, tried: JSON.stringify(tried), status: "resolved", resolved_by: r.status === "auto" ? "auto" : "user", resolved_at: t };
      const timer = timers.get(r.id);
      if (timer) { clearTimeout(timer); timers.delete(r.id); }
      save(next);
      refreshCard(next);
    }
  } catch (err) { console.error("[failures]", (err as Error)?.message ?? err); }
}

/** A completed diagnostic request settles the incident only if it did not recur while the check ran. */
export function confirmTransportRecovery(bot: BotRecord, id: string, lastAt: number, provider: string, originalBytes: number) {
  const r = failures.byId(id);
  if (!r || r.user_id !== bot.userId || r.bot_id !== bot.id || r.last_at !== lastAt ||
      r.provider !== provider || r.status !== "waiting") return false;
  const oversized = r.class === "bad_input" && /\b413\b.*payload too large/i.test(r.detail) && originalBytes > 21 * 1024 * 1024;
  if (!oversized && r.class !== "rate_limited") return false;
  const at = now();
  const action = oversized ? "image_check" : "quota_check";
  r.tried = JSON.stringify([...triedOf(r), { action, at, ok: true }].slice(-12));
  r.status = "resolved"; r.resolved_by = "auto"; r.resolved_at = at;
  save(r); refreshCard(r);
  return true;
}

// ── The owner's buttons (failureroutes.ts) ──────────────────────────────────────────────────────────────────────
export class FailureActionRefused extends Error { constructor(message: string) { super(message); this.name = "FailureActionRefused"; } }
export type FailureAction = FailureRemedy | "dismiss";

/**
 * A button of a failure card. "retry" / "continue_without" / "restart_computer": the work goes on in a new turn (what was
 * done is kept); "handoff": to a teammate; "dismiss". "reconnect", "connect_account" and "switch_model" open the place
 * where it is fixed (the web app does that; "reconnect" starts the engine's sign-in first, see the route) — the card stays
 * open until a turn goes through again.
 */
export async function actOnFailure(bot: BotRecord, id: string, action: FailureAction, deps: { restart?: (bot: BotRecord) => Promise<void> } = {}): Promise<FailureView> {
  const r = failures.byId(id);
  // Isolation: only an incident of this bot (the route checked the bot is the caller's own).
  if (!r || r.bot_id !== bot.id || r.user_id !== bot.userId) throw new FailureActionRefused("There is no such incident.");
  if (r.status === "resolved" || r.status === "dismissed" || r.status === "handed") throw new FailureActionRefused("This incident is already settled.");
  const res = resumes.get(r.id) ?? { thread: r.thread };
  const loc = users.byId(bot.userId)?.locale;
  const timer = timers.get(r.id);
  if (timer && action !== "reconnect" && action !== "connect_account" && action !== "switch_model") { clearTimeout(timer); timers.delete(r.id); }
  const next: FailureRow = { ...r };
  switch (action) {
    case "dismiss": next.status = "dismissed"; next.resolved_at = now(); break;
    case "retry": next.status = "retrying"; resumeWork(r, (r.class === "loop_detected" ? LOOP_TEXT : RETRY_TEXT).replace("{why}", tr(undefined, CLASS_TITLES[r.class])), res, true); break;
    case "continue_without": next.status = "retrying"; resumeWork(r, r.class === "loop_detected" ? LOOP_TEXT.replace("{why}", r.tool) : CONTINUE_WITHOUT_TEXT.replace("{tool}", r.tool || "that failed"), res, true); break;
    case "restart_computer":
      await deps.restart?.(bot);
      next.status = "retrying"; resumeWork(r, RETRY_TEXT.replace("{why}", "its computer was restarted"), res, true); break;
    case "handoff": {
      const mate = findTeammate(bot, r.provider || brainOf(bot.model));
      if (!mate) throw new FailureActionRefused(tr(loc, "No other bot of yours has a working brain right now."));
      handTo(bot, mate, r.class, res.task ?? "", loc);
      const tried = triedOf(r);
      tried.push({ action: "handoff", at: now(), ok: true, note: mate.name });
      next.tried = JSON.stringify(tried); next.status = "handed"; next.resolved_by = "user"; next.resolved_at = now();
      break;
    }
    case "reconnect": case "connect_account": case "switch_model": break;
    default: throw new FailureActionRefused("Unknown action.");
  }
  save(next);
  refreshCard(next);
  return toView(next);
}

/** The owner pressed « Réessayer maintenant » on an outage: every bot of theirs waiting on that provider tries again now. */
export function retryOutage(userId: string, provider: string): number {
  let n = 0;
  for (const r of q.all<FailureRow>(`SELECT * FROM bot_failures WHERE user_id = ? AND provider = ? AND status IN ${OPEN}`, userId, provider)) {
    if (!triedOf(r).some((x) => x.action === "provider_wait" && x.ok === null)) continue;
    const timer = timers.get(r.id);
    if (timer) { clearTimeout(timer); timers.delete(r.id); }
    resumeWork(r, RETRY_TEXT.replace("{why}", tr(undefined, CLASS_TITLES[r.class])), resumes.get(r.id) ?? { thread: r.thread }, true);
    save({ ...r, status: "retrying" });
    n++;
  }
  return n;
}

// ── 4. « Aujourd'hui » ──────────────────────────────────────────────────────────────────────────────────────────
/** The day's incidents of the account: fixed without the owner, waiting for them; and the providers down for its bots. */
export function failureSummary(userId: string, start: number, end: number, t = now()): FailureSummary {
  const row = q.get<{ auto: number; waiting: number }>(`SELECT
      SUM(CASE WHEN status IN ('resolved', 'handed') AND resolved_by = 'auto' THEN 1 ELSE 0 END) AS auto,
      SUM(CASE WHEN status = 'waiting' THEN 1 ELSE 0 END) AS waiting
    FROM bot_failures WHERE user_id = ? AND last_at >= ? AND last_at < ?`, userId, start, end);
  const outages: FailureSummary["outages"] = [];
  for (const [provider, b] of breakers) {
    if (b.openUntil <= t) continue;
    const mine = q.get<{ n: number }>(`SELECT COUNT(DISTINCT bot_id) AS n FROM bot_failures WHERE user_id = ? AND provider = ? AND status IN ${OPEN}`, userId, provider)?.n ?? 0;
    if (mine > 0) outages.push({ provider, bots: mine, since: b.since });
  }
  return { autoFixed: Number(row?.auto ?? 0), waiting: Number(row?.waiting ?? 0), outages };
}
