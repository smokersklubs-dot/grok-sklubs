import { config } from "../config.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { Card, GoalStatus, GoalWaiting } from "../shared.js";
import { audit, bots, clip, laneKey, newId, now, paused, rows, users, type BotRecord } from "../store.js";
import { overBudget } from "../usage.js";
import { capHolds, cm, noteSkip } from "../usagecaps.js";
import { checkpoints } from "./spend.js";
import type { BuiltinTool } from "./tools.js";
import { enqueue, hostedHoldsBot, interrupt, isPaused, queuedBehind, runningThreads, tell } from "./loop.js";
import { cleanCriteria, criteriaCard, criteriaOf, criteriaTool, endReview, recordEvidence, reviewOf, setCriteria, startReview } from "./goalcriteria.js";
import { lt } from "./looptext.js";

/**
 * Goal mode ("Objectif" in the composer, "/objectif …", a routine whose text starts with "/objectif", or a goal the bot
 * proposes and the user accepts). The bot keeps working across rounds — each round is an ordinary turn of the bot (an API
 * turn, or a Claude Code / Codex turn resuming its session), queued in the durable bot queue (bot_queue) so it survives a
 * restart — until it marks the goal complete (with evidence) or blocked (with a reason), the user pauses or stops it, or
 * it reaches its round cap. A round never starts while the bot waits on the user: an approval card, a question it asked,
 * a spend checkpoint. Approvals, the irreversible gate and the outside-content caution apply to every round as to any
 * turn; a goal whose rounds read outside content keeps its next rounds careful from their first step.
 *
 * The round prompt and the round cap follow deepseek-harness packages/goal/goal-round-driver (prompt.ts, index.ts
 * "round-limit"), MIT, Copyright (c) 2026 DeepSeek — ideas only, rewritten here.
 */

export interface GoalRecord {
  id: string; botId: string; userId: string; generation: number; thread: number; objective: string; status: GoalStatus;
  rounds: number; maxRounds: number; summary: string; evidence: string; reason: string; waiting: GoalWaiting; queued: boolean;
  tainted: boolean; origin: string; spendKey: string; cardSeq: number | null; createdAt: number; updatedAt: number;
}

const OPEN = "('proposed', 'active', 'paused')";
const toGoal = (r: any): GoalRecord => ({
  id: r.id, botId: r.bot_id, userId: r.user_id, generation: r.generation, thread: r.thread, objective: r.objective, status: r.status,
  rounds: r.rounds, maxRounds: r.max_rounds, summary: r.summary, evidence: r.evidence, reason: r.reason, waiting: r.waiting || "",
  queued: !!r.queued, tainted: !!r.tainted, origin: r.origin, spendKey: r.spend_key, cardSeq: r.card_seq ?? null, createdAt: r.created_at, updatedAt: r.updated_at,
});

const COLUMNS: Record<string, string> = { status: "status", rounds: "rounds", maxRounds: "max_rounds", summary: "summary", evidence: "evidence", reason: "reason", waiting: "waiting", queued: "queued", tainted: "tainted", spendKey: "spend_key", cardSeq: "card_seq" };
type Patch = Partial<Pick<GoalRecord, "status" | "rounds" | "maxRounds" | "summary" | "evidence" | "reason" | "waiting" | "queued" | "tainted" | "spendKey" | "cardSeq">>;

/** What the goal card shows. */
export function goalCard(g: GoalRecord): Extract<Card, { type: "goal" }> {
  return {
    type: "goal", goalId: g.id, objective: g.objective, status: g.status, rounds: g.rounds, maxRounds: g.maxRounds,
    ...(g.summary ? { summary: g.summary } : {}), ...(g.evidence ? { evidence: g.evidence } : {}), ...(g.reason ? { reason: g.reason } : {}),
    ...(g.status === "active" && g.waiting ? { waiting: g.waiting } : {}), ...criteriaCard(g.id), // L89 (goalcriteria.ts)
  };
}

export const goals = {
  byId: (id: string) => { const r = q.get("SELECT * FROM bot_goals WHERE id = ?", id); return r ? toGoal(r) : null; },
  /** The proposed, active or paused goal of a bot's conversation (main chat or one thread), if any. */
  openFor: (botId: string, thread: number) => { const r = q.get(`SELECT * FROM bot_goals WHERE bot_id = ? AND thread = ? AND status IN ${OPEN}`, botId, thread); return r ? toGoal(r) : null; },
  /** The active goal of a conversation of the bot's current conversation generation. */
  activeFor(bot: BotRecord, thread: number): GoalRecord | null {
    const g = goals.openFor(bot.id, thread);
    return g && g.status === "active" && g.generation === bot.generation ? g : null;
  },
  activeOf: (botId: string) => q.all("SELECT * FROM bot_goals WHERE bot_id = ? AND status = 'active' ORDER BY created_at", botId).map(toGoal),
  forBot: (botId: string, limit = 20) => q.all("SELECT * FROM bot_goals WHERE bot_id = ? ORDER BY created_at DESC LIMIT ?", botId, limit).map(toGoal),
  /** Changes a goal and its card in the chat. */
  set(g: GoalRecord, patch: Patch): GoalRecord {
    const sets: string[] = [];
    const vals: (string | number | null)[] = [];
    for (const [k, v] of Object.entries(patch)) {
      const col = COLUMNS[k];
      if (!col) continue;
      sets.push(`${col} = ?`);
      vals.push(typeof v === "boolean" ? (v ? 1 : 0) : (v as string | number | null));
    }
    if (!sets.length) return g;
    q.run(`UPDATE bot_goals SET ${sets.join(", ")}, updated_at = ? WHERE id = ?`, ...vals, now(), g.id);
    const next = goals.byId(g.id)!;
    syncCard(next);
    if (next.status !== g.status) for (const fn of statusHooks) { try { fn(next, g); } catch (err) { console.error("[goal hook]", err); } }
    return next;
  },
};

/** Told after a goal's status changed (« Chantier », chantierrunner.ts, follows the goals it started). Must not throw. */
const statusHooks: ((g: GoalRecord, before: GoalRecord) => void)[] = [];
export const onGoalStatus = (fn: (g: GoalRecord, before: GoalRecord) => void) => { statusHooks.push(fn); };

function syncCard(g: GoalRecord) {
  const bot = bots.byId(g.botId);
  if (!bot || g.cardSeq === null) return;
  rows.updateCard(bot, g.generation, g.cardSeq, () => goalCard(g));
}

/**
 * Starts a goal (or a proposal) in a conversation. An open goal already there is stopped first: one goal per bot and
 * thread at a time. `maxRounds` is clamped to 1…GOAL_ROUNDS_LIMIT.
 */
export function createGoal(bot: BotRecord, o: { objective: string; thread: number; origin: string; status?: "active" | "proposed"; maxRounds?: number; spendKey?: string; tainted?: boolean }): GoalRecord {
  const objective = clip(o.objective.trim(), 4000);
  if (!objective) throw new Error("A goal needs an objective.");
  const old = goals.openFor(bot.id, o.thread);
  if (old) goals.set(old, { status: "stopped", reason: tr(users.localeOf(bot.userId), "replaced by a new goal"), queued: false, waiting: "" });
  const id = newId("goal");
  const max = Math.min(config.goalRoundsLimit, Math.max(1, Math.floor(o.maxRounds ?? config.goalMaxRounds)));
  const t = now();
  q.run("INSERT INTO bot_goals (id, bot_id, user_id, generation, thread, objective, status, max_rounds, origin, spend_key, tainted, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, bot.id, bot.userId, bot.generation, o.thread, objective, o.status ?? "active", max, o.origin, o.spendKey ?? "", o.tainted ? 1 : 0, t, t);
  const g = goals.byId(id)!;
  const card = rows.append(bot, { kind: "card", card: goalCard(g) }, o.thread);
  bots.bumpUnread(bot.id);
  audit(bot.userId, "system", `${bot.name}: ${o.status === "proposed" ? "goal proposed" : "goal started"} — ${clip(objective, 160)}`, bot.id);
  return goals.set(g, { cardSeq: card.seq });
}

/** "/objectif <text>" or "/goal <text>" at the start of a message (or a routine's text): the objective, else null. */
export function goalCommand(text: string): string | null {
  const m = /^\/(?:objectif|goal)(?:\s+([\s\S]*))?$/i.exec(text.trim());
  return m ? (m[1] ?? "").trim() : null;
}

/**
 * The prompt of each round after the first (adapted from deepseek-harness renderGoalRoundPrompt, see above): look at the
 * real state again, make progress, verify, and only claim completion with evidence.
 */
export function goalRoundPrompt(g: Pick<GoalRecord, "objective" | "maxRounds">, round: number): string {
  return [
    "<goal_round>",
    `Objective: ${JSON.stringify(g.objective)}`,
    `Round: ${round}/${g.maxRounds}`,
    "",
    "Goal mode: keep working toward the objective, on your own, without waiting for the user. Treat the current state of your computer, files, apps and the results of your tools as authoritative: inspect them instead of assuming that what you said earlier is still true. Make concrete progress in this round and verify the result.",
    "Before claiming completion, gather evidence that the WHOLE objective is achieved, then call goal_update with status \"complete\", a short summary and that evidence. If work remains, call goal_update with status \"active\" and a one-line progress summary, then keep working: the next round starts on its own when this one ends. If you cannot go on without the user (a decision, an access, a payment) or something outside your control blocks you, call goal_update with status \"blocked\" and the reason.",
    "Approvals still apply: when an action needs the user's yes, ask as usual — the goal waits for their answer.",
    "</goal_round>",
  ].join("\n");
}

/** A short line for a turn in a conversation whose goal is active (the first round, or the user's message meanwhile). */
export function goalNote(g: GoalRecord, round: number, first: boolean): string {
  return first
    ? `[Goal mode is on: the user set this message as an objective (round ${round}/${g.maxRounds}). First set 3 to 7 success criteria with goal_criteria (checks someone could see from outside). Work on it across rounds without waiting for them: when this turn ends, the next round starts on its own. When the WHOLE objective is achieved and verified, call goal_update with status "complete", a summary and the evidence; if something only the user can resolve blocks you, call goal_update with status "blocked" and the reason; otherwise call goal_update with status "active" and a one-line progress summary before your turn ends.]`
    : `[Goal mode is on — objective: ${JSON.stringify(clip(g.objective, 600))} (round ${round}/${g.maxRounds}). Answer the message below, then keep working toward the objective. Use goal_update to report progress, completion (with evidence) or a blocker.]`;
}

/** Called when a round (or any turn) starts in a conversation whose goal is active: one more round is used. */
export function startRound(g: GoalRecord): GoalRecord {
  return goals.set(g, { rounds: g.rounds + 1, waiting: "", queued: false });
}

/** How a turn of the bot ended, for the goal driver. */
export interface TurnEnd {
  thread: number;
  /** The user pressed Stop (or the goal's own Stop). */
  stopped: boolean;
  /** The turn failed: the error, shortened (empty: it did not). */
  failed: string;
  /** The turn ended on a question for the user or a card they must fill in (ask_user, connector_request, secret_request…). */
  waitsUser: boolean;
  /** The loop guard stopped it (going round in circles). */
  loopStop: string;
  tainted: boolean;
}

/**
 * After every turn of a bot: updates the goals of the conversation it ran in, then starts the next round of any active
 * goal of the bot that is free to go on. Never starts one while the bot waits on an approval or a spend checkpoint, while
 * other work is queued behind this turn (the last of it picks the goal back up), or past its round cap.
 */
export function goalAfterTurn(bot: BotRecord, end: TurnEnd) {
  const loc = users.localeOf(bot.userId);
  for (let g of goals.activeOf(bot.id)) {
    if (g.generation !== bot.generation) { goals.set(g, { status: "stopped", reason: tr(loc, "the conversation was reset"), queued: false, waiting: "" }); continue; }
    if (g.thread === end.thread) {
      if (end.tainted && !g.tainted) g = goals.set(g, { tainted: true });
      if (end.stopped) { pauseGoal(bot, g, tr(loc, "stopped")); continue; }
      if (end.failed) { pauseGoal(bot, g, tr(loc, "the last round failed: {detail}", { detail: clip(end.failed, 200) })); continue; }
      if (end.loopStop) { pauseGoal(bot, g, end.loopStop); continue; }
      g = goals.set(g, { waiting: waitingOf(bot, end.waitsUser) });
    } else if (g.waiting === "approval" || g.waiting === "checkpoint") {
      // Those hold the whole bot, whatever conversation settled them: looked at again after every turn.
      g = goals.set(g, { waiting: waitingOf(bot) });
    }
    continueGoal(bot, g);
  }
}

const waitingOf = (bot: BotRecord, waitsUser = false): GoalWaiting =>
  paused.get(bot.id) ? "approval" : checkpoints.pendingFor(bot.id) ? "checkpoint" : waitsUser ? "user" : "";

function pauseGoal(bot: BotRecord, g: GoalRecord, reason: string) {
  goals.set(g, { status: "paused", reason: clip(reason, 300), queued: false, waiting: "" });
}

/** Starts the next round of an active goal when nothing holds it. */
function continueGoal(bot: BotRecord, g: GoalRecord) {
  if (g.status !== "active" || g.queued || g.waiting) return;
  const loc = users.localeOf(bot.userId);
  // The bot waits on the user elsewhere (an approval holds its whole queue; a spend checkpoint its spending).
  const holding = waitingOf(bot);
  if (holding) { goals.set(g, { waiting: holding }); return; }
  // Work is queued behind this turn: the end of the last of it starts the round.
  if (queuedBehind(bot.id) > 0) return;
  if (overBudget(bot.userId)) { pauseGoal(bot, g, tr(loc, "this month's budget is used up")); return; }
  // "Pause": the bot is paused — the goal is paused with it, and resumed with it (resumeGoalsAfterPause).
  if (isPaused(bot)) { pauseGoal(bot, g, tr(loc, GOAL_PAUSED_WITH_BOT)); return; }
  // Hosted mode: the plan holds this bot's work (budget on the service's keys, suspended account…): the goal waits, paused.
  // Usage caps (usagecaps.ts): a later round is work no person started — a cap that stops it pauses the goal (said once
  // on the cap's card and in the activity log); resuming the goal after the reset, or raising the cap, goes on.
  const capped = capHolds(bot);
  if (capped) { pauseGoal(bot, g, cm(loc, "a usage cap is reached")); noteSkip(bot, capped, "a goal round"); return; }
  const held = hostedHoldsBot(bot);
  if (held) { pauseGoal(bot, g, tr(loc, held === "suspended" ? "the account is suspended" : held === "budget" ? "this month's budget is used up" : "the plan does not allow this model")); return; }
  if (g.rounds >= g.maxRounds) {
    goals.set(g, { status: "limit", reason: tr(loc, "it reached its limit of {n} rounds", { n: g.maxRounds }), queued: false });
    tell({ type: "waiting", bot, text: tr(loc, "Goal paused after {n} rounds: {objective}", { n: g.maxRounds, objective: clip(g.objective, 120) }) });
    return;
  }
  goals.set(g, { queued: true });
  enqueue(bot.id, { kind: "system", text: goalRoundPrompt(g, g.rounds + 1), thread: g.thread || undefined, goalRound: g.id, tainted: g.tainted || undefined, origin: g.origin, spendScope: g.spendKey || undefined, depth: 0 });
}

/** Why a goal waits while its bot is paused ("Pause", agent/pause.ts); resuming the bot resumes those goals. */
export const GOAL_PAUSED_WITH_BOT = "its bot is paused";

/** The bot was resumed: the goals "Pause" paused go on (each at its next round), in any language the reason was written. */
export function resumeGoalsAfterPause(bot: BotRecord): number {
  const reasons = new Set([GOAL_PAUSED_WITH_BOT, tr("fr", GOAL_PAUSED_WITH_BOT), tr("en", GOAL_PAUSED_WITH_BOT)]);
  let n = 0;
  for (const g of q.all("SELECT * FROM bot_goals WHERE bot_id = ? AND status = 'paused' ORDER BY created_at", bot.id).map(toGoal)) {
    if (g.status !== "paused" || g.generation !== bot.generation || !reasons.has(g.reason)) continue;
    continueGoal(bot, goals.set(g, { status: "active", reason: "", waiting: "", queued: false }));
    n++;
  }
  return n;
}

/** The user (or a spend checkpoint's "Stop") pauses every active goal of a bot. */
export function pauseGoalsOf(bot: BotRecord, reason: string) {
  for (const g of goals.activeOf(bot.id)) pauseGoal(bot, g, reason);
}

/** The buttons of the goal card. */
export function goalAction(bot: BotRecord, goalId: string, action: "pause" | "resume" | "stop" | "accept" | "decline"): GoalRecord {
  const g = goals.byId(goalId);
  if (!g || g.botId !== bot.id) throw new GoalError(404, "That goal does not exist.");
  const loc = users.localeOf(bot.userId);
  if (g.generation !== bot.generation && action !== "stop" && action !== "decline") throw new GoalError(409, "This goal belongs to an earlier conversation.");
  let next: GoalRecord;
  switch (action) {
    case "pause":
      if (g.status !== "active") throw new GoalError(409, "This goal is not running.");
      next = goals.set(g, { status: "paused", reason: tr(loc, "paused by you"), queued: false, waiting: "" });
      break;
    case "resume":
    case "accept": {
      // L89: a goal that waits for the owner's approval of its result: « Valider » closes it, « Reprendre » sends it back.
      const review = g.status === "blocked" ? reviewOf(g.id) : null;
      if (review) {
        endReview(g.id);
        if (action === "accept") { next = goals.set(g, { status: "complete", summary: review.summary, evidence: review.evidence, reason: "", waiting: "", queued: false }); audit(bot.userId, "system", `${bot.name}: goal approved — ${clip(g.objective, 160)}`, bot.id); break; }
      }
      const can = action === "accept" ? g.status === "proposed" : ["paused", "limit", "blocked"].includes(g.status);
      if (!can) throw new GoalError(409, action === "accept" ? "This goal was already answered." : "This goal cannot be resumed.");
      // Resuming at the cap gives it another full set of rounds (still within GOAL_ROUNDS_LIMIT in all).
      const maxRounds = g.status === "limit" ? Math.min(config.goalRoundsLimit, g.rounds + config.goalMaxRounds) : g.maxRounds;
      if (g.status === "limit" && maxRounds <= g.rounds) throw new GoalError(409, "This goal used all the rounds a goal may have.");
      next = goals.set(g, { status: "active", reason: "", waiting: "", queued: false, maxRounds });
      audit(bot.userId, "system", `${bot.name}: goal ${action === "accept" ? "accepted" : "resumed"} — ${clip(g.objective, 160)}`, bot.id);
      continueGoal(bot, next);
      next = goals.byId(g.id)!;
      break;
    }
    case "stop":
      if (!["proposed", "active", "paused", "limit", "blocked"].includes(g.status)) throw new GoalError(409, "This goal is already over.");
      next = goals.set(g, { status: "stopped", reason: tr(loc, "stopped by you"), queued: false, waiting: "" });
      // A round of this goal under way stops too.
      if (g.status === "active" && runningThreads(bot.id).includes(g.thread)) interrupt(laneKey(bot.id, g.thread)); // only its own lane (lanes.ts)
      audit(bot.userId, "system", `${bot.name}: goal stopped — ${clip(g.objective, 160)}`, bot.id);
      break;
    case "decline":
      if (g.status !== "proposed") throw new GoalError(409, "This goal was already answered.");
      next = goals.set(g, { status: "declined" });
      break;
  }
  return next;
}

export class GoalError extends Error {
  constructor(readonly status: 404 | 409, message: string) { super(message); this.name = "GoalError"; }
}

// ── Tools ────────────────────────────────────────────────────────────────────
const str = (description: string) => ({ type: "string", description });

export const goalTools: BuiltinTool[] = [
  criteriaTool((botId, thread) => goals.openFor(botId, thread), (id) => { const g = goals.byId(id); if (g) syncCard(g); }), // L89
  {
    spec: {
      name: "goal_update",
      description: "Goal mode: report on the goal of this conversation. status \"active\": still working (summary = one line of progress; the next round starts on its own). \"complete\": the WHOLE objective is achieved and verified — give the evidence (what you checked and what it showed). \"blocked\": you cannot go on without the user or something outside your control — the summary says why. Only for a conversation with an active goal.",
      inputSchema: { type: "object", properties: { status: { type: "string", enum: ["active", "complete", "blocked"], description: "Where the goal stands" }, summary: str("One or two lines: progress, result, or why it is blocked"), evidence: str("For complete: the evidence that the objective is achieved (checks run, files, links, numbers)"), criteria_evidence: { type: "array", items: { type: "string" }, description: "For complete, when the goal has success criteria: one piece of evidence per criterion, in order" } }, required: ["status", "summary"] },
    },
    activity: "planning", label: "Updating the goal", group: "tasks",
    run: async (a, c) => {
      const g = goals.activeFor(c.bot, c.thread ?? 0);
      if (!g) return { content: "There is no active goal in this conversation.", isError: true };
      const summary = clip(String(a.summary ?? "").trim(), 600);
      const status = String(a.status);
      if (status === "complete") {
        const evidence = clip(String(a.evidence ?? "").trim(), 2000);
        if (!evidence && !criteriaOf(g.id).length) return { content: "To mark the goal complete, give the evidence: what you checked and what it showed. If you have not verified it yet, verify it first.", isError: true };
        // L89: with success criteria, evidence for each one, then « attend ton accord » instead of closing on its own.
        const missing = recordEvidence(g.id, a.criteria_evidence);
        if (missing) return { content: missing, isError: true };
        if (criteriaOf(g.id).length) {
          const all = criteriaOf(g.id).map((x, i) => `${i + 1}. ${x.text} — ${x.evidence}`).join("\n");
          startReview(g.id, summary, clip(evidence || all, 2000));
          goals.set(g, { status: "blocked", reason: lt(c.user.locale, "waiting for your approval"), summary, evidence: clip(evidence || all, 2000), waiting: "", queued: false });
          tell({ type: "waiting", bot: c.bot, text: lt(c.user.locale, "Goal done, waiting for your approval: {objective}", { objective: clip(g.objective, 120) }) });
          return { content: "Every criterion has its evidence. The goal now waits for the user's approval on its card; no more rounds start. Tell the user the result and the evidence in your final message.", summary: lt(c.user.locale, "waiting for your approval") };
        }
        goals.set(g, { status: "complete", summary, evidence, waiting: "", queued: false });
        audit(c.bot.userId, "system", `${c.bot.name}: goal complete — ${clip(g.objective, 160)}`, c.bot.id);
        return { content: "The goal is marked complete; no more rounds will start. Tell the user the result in your final message.", summary: tr(c.user.locale, "complete") };
      }
      if (status === "blocked") {
        if (!summary) return { content: "Say why the goal is blocked.", isError: true };
        goals.set(g, { status: "blocked", reason: summary, summary, waiting: "", queued: false });
        tell({ type: "waiting", bot: c.bot, text: tr(c.user.locale, "Goal blocked: {reason}", { reason: clip(summary, 200) }) });
        return { content: "The goal is marked blocked; no more rounds will start until the user resumes it. Tell them plainly what you need.", summary: tr(c.user.locale, "blocked") };
      }
      if (status !== "active") return { content: "status must be active, complete or blocked.", isError: true };
      goals.set(g, { summary });
      return { content: "Noted. Keep working; when this turn ends the next round starts on its own.", summary: clip(summary, 80) };
    },
  },
  {
    spec: {
      name: "goal_propose",
      description: "Propose a goal for goal mode: a long objective you would keep working on across rounds, on your own, until it is done. The user sees a card and accepts or declines; nothing starts before they accept. Use it when the user asks for long, multi-step work that would need them to press Continue several times. Not for quick tasks.",
      inputSchema: { type: "object", properties: { objective: str("The objective, complete and self-contained: what done looks like"), criteria: { type: "array", items: { type: "string" }, description: "3 to 7 success criteria, each a check someone could see from outside" }, max_rounds: { type: "integer", description: `Rounds it may take at most (default ${config.goalMaxRounds}, at most ${config.goalRoundsLimit})` } }, required: ["objective"] },
    },
    activity: "planning", label: "Proposing a goal", group: "tasks",
    run: async (a, c) => {
      const thread = c.thread ?? 0;
      const open = goals.openFor(c.bot.id, thread);
      if (open && open.generation === c.bot.generation) return { content: `This conversation already has a goal (${open.status}): "${clip(open.objective, 200)}".`, isError: true };
      const objective = String(a.objective ?? "").trim();
      if (!objective) return { content: "Describe the objective.", isError: true };
      const crit = a.criteria === undefined ? null : cleanCriteria(a.criteria);
      if (typeof crit === "string") return { content: crit, isError: true };
      const made = createGoal(c.bot, { objective, thread, origin: c.origin === "routine" ? "routine" : "user", status: "proposed", maxRounds: Number(a.max_rounds) || undefined, tainted: c.tainted });
      if (crit) { setCriteria(made.id, crit); syncCard(made); }
      return { content: "Proposed: the user sees a card to accept or decline it. Do not start it as a goal before they accept; answer them normally now.", summary: clip(objective, 80) };
    },
  },
];
