/**
 * « Chantier » — the runner (principles 3, 5, 6 and 8). Once the owner approved the plan:
 *  - a task whose upstream tasks are all accepted (and whose shared resources no running task holds) is dispatched to its
 *    bot as a GOAL in its own thread (goals.ts): independent tasks run side by side, in the bot's lanes (lanes.ts, at most
 *    3 per bot), shared files are also guarded per lane (turnlocks.ts); a task that depends on another waits;
 *  - the artifacts of its upstream tasks are copied into its bot's library first (inputs never leave the owner's account);
 *  - when the goal says complete (or reaches its round cap), the attempt is checked: exact checks by code, then the
 *    reviewer's criteria; pass → the task is accepted and the next ones start; fail → a failure report, and ONLY the
 *    failed unit is sent back (an integration check names the upstream task to blame; after its repair the integration
 *    checks run again); at the attempt limit (default 3) the branch stops, every attempt and its evidence are kept, and
 *    the owner gets a card to decide; a goal blocked on the owner, or a reviewer « not sure », also asks the owner.
 *  - lessons: a check that failed and then passed becomes a lesson (rule / evidence / applies to), fed into later plans.
 * Every bot action of a task is an ordinary goal round: approvals, the floor, the vault and isolation apply unchanged
 * (publishing, paying, deleting still wait for the owner's own yes). The state lives in SQLite: after a restart,
 * `resumeChantiers` picks up the goals that ended meanwhile and goes on.
 */
import { createGoal, goalAction, goalRoundPrompt, goals, onGoalStatus, type GoalRecord } from "./agent/goals.js";
import { enqueue, runningThreads, tell } from "./agent/loop.js";
import { ask as memoryAsk } from "./agent/memory.js";
import { listFiles, readLibraryFile, storeBytes } from "./computer.js";
import { audit, bots, clip, now, rows, users, type BotRecord } from "./store.js";
import { ct } from "./chantieri18n.js";
import {
  applyLessons, attempts, chantiers, checkPlan, decisions, downstreamOf, lessons, nudges, tasks, usageBetween, type ChantierRecord,
} from "./chantiers.js";
import { failureReport, inputDir, outputDir, reviewTask, runCodeChecks } from "./chantierchecks.js";
import type { ChantierPlan, CheckResult, DecisionAnswer, FailureReport, PlanTask } from "./chantiertypes.js";
import type { Locale } from "./shared.js";

type Ask = (bot: BotRecord, system: string, prompt: string, selected: boolean) => Promise<string>;
let ask: Ask = memoryAsk;
/** Tests only: the side request used by the reviewer. */
export const setChantierAsk = (fn: Ask | null) => { ask = fn ?? memoryAsk; };
/** The side request the planner and the reviewer use now. */
export const chantierAsk = (): Ask => ask;

export class ChantierError extends Error { constructor(readonly status: 400 | 404 | 409, message: string) { super(message); } }

const ACTIVE = new Set(["running", "repairing", "checking"]);
const locOf = (c: ChantierRecord) => users.localeOf(c.userId);
const planOf = (c: ChantierRecord): ChantierPlan => c.plan ?? { observations: [], assumptions: [], unknowns: [], requirements: [], tasks: [], edges: [], maxAttempts: 3 };
const ownBot = (c: ChantierRecord, id: string) => { const b = bots.byId(id); return b && b.userId === c.userId && b.kind === "agent" ? b : null; };

// ── Approval ─────────────────────────────────────────────────────────────────────────────────────────────────────
/**
 * The owner approves the plan (maybe edited). Refused while the plan has problems or an open question has no answer:
 * nothing runs before. Returns the problems (empty: approved and started).
 */
export function approveChantier(userId: string, id: string, raw?: unknown): string[] {
  const c = chantiers.owned(userId, id);
  if (!c) throw new ChantierError(404, "That chantier does not exist.");
  if (c.status !== "proposed") throw new ChantierError(409, ct(locOf(c), "This chantier is not waiting for your approval."));
  const loc = locOf(c);
  const { plan, problems } = readiness(raw ?? c.plan, userId, loc);
  applyLessons(userId, plan);
  if (problems.length) { chantiers.set(id, { plan }); return problems; }
  chantiers.set(id, { status: "running", plan, approvedAt: now(), note: "" });
  for (const t of plan.tasks) tasks.create(id, t);
  for (const lid of new Set(plan.tasks.flatMap((t) => t.contract.checks.map((x) => x.fromLesson).filter((x): x is string => !!x)))) lessons.used(lid);
  nudges.add(id, "intervention", ct(loc, "approved the plan"));
  audit(userId, "system", `Chantier approved — ${clip(c.title, 160)}`);
  advance(id);
  return [];
}

/** What still keeps a plan from being approved: its problems, and every open question without an answer. */
export function readiness(raw: unknown, userId: string, loc: Locale): { plan: ChantierPlan; problems: string[] } {
  const r = checkPlan(raw, userId, loc);
  for (const u of r.plan.unknowns) if (!u.answer) r.problems.push(ct(loc, "Answer the open question: {q}", { q: clip(u.text, 120) }));
  return r;
}

/** The owner saves an edited plan without approving it yet. */
export function saveDraft(userId: string, id: string, raw: unknown): string[] {
  const c = chantiers.owned(userId, id);
  if (!c) throw new ChantierError(404, "That chantier does not exist.");
  if (c.status !== "proposed") throw new ChantierError(409, ct(locOf(c), "This chantier is not waiting for your approval."));
  const { plan, problems } = readiness(raw, userId, locOf(c));
  chantiers.set(id, { plan });
  return problems;
}

// ── Moving tasks along ───────────────────────────────────────────────────────────────────────────────────────────
/** Starts every task that can start now, then settles the chantier's status. Safe to call any time. */
export function advance(id: string) {
  const c = chantiers.byId(id);
  if (!c || (c.status !== "running" && c.status !== "waiting_owner")) return;
  const plan = planOf(c);
  for (const t of plan.tasks) {
    const st = tasks.get(id, t.key);
    if (!st || st.state !== "waiting") continue;
    const ups = plan.edges.filter((e) => e.to === t.key).map((e) => tasks.get(id, e.from));
    if (ups.some((u) => !u || u.state !== "accepted")) continue;
    // Shared resources: one task at a time on the same file or screen (principle 3).
    const busy = tasks.of(id).filter((x) => ACTIVE.has(x.state)).map((x) => plan.tasks.find((p) => p.key === x.key)).filter((x): x is PlanTask => !!x);
    if (t.resources.some((r) => busy.some((b) => b.resources.includes(r)))) continue;
    if (t.integration) void recheck(c, t);
    else dispatch(c, t);
  }
  settle(id);
}

/** running / waiting_owner / done / stopped, from the tasks and the open cards. */
function settle(id: string) {
  const c = chantiers.byId(id);
  if (!c || (c.status !== "running" && c.status !== "waiting_owner")) return;
  const ts = tasks.of(id);
  const loc = locOf(c);
  if (ts.length && ts.every((t) => t.state === "accepted")) {
    chantiers.set(id, { status: "done", endedAt: now() });
    const planner = ownBot(c, c.plannerBotId);
    if (planner) tell({ type: "reply", bot: planner, text: ct(loc, "Chantier “{title}”: finished, every task accepted.", { title: clip(c.title, 80) }) });
    return;
  }
  const moving = ts.some((t) => ACTIVE.has(t.state));
  const open = decisions.openCount(id) > 0;
  if (!moving && !open && ts.every((t) => t.state === "accepted" || t.state === "stopped" || t.state === "waiting") && !ts.some((t) => t.state === "waiting" && canStart(c, t.key))) {
    const stopped = ts.filter((t) => t.state !== "accepted").map((t) => t.key);
    chantiers.set(id, { status: "stopped", endedAt: now(), note: ct(loc, "Stopped branches: {tasks}", { tasks: stopped.join(", ") }) });
    return;
  }
  const status = !moving && (open || ts.some((t) => t.state === "blocked")) ? "waiting_owner" : "running";
  if (status !== c.status) chantiers.set(id, { status });
}

function canStart(c: ChantierRecord, key: string): boolean {
  return planOf(c).edges.filter((e) => e.to === key).every((e) => tasks.get(c.id, e.from)?.state === "accepted");
}

/** Copies the artifacts of the tasks `t` waits on into its bot's library, for this attempt. Bounded; text and binary. */
function copyInputs(c: ChantierRecord, plan: ChantierPlan, t: PlanTask, n: number): string[] {
  const to = ownBot(c, t.botId)!;
  const lines: string[] = [];
  let total = 0;
  for (const e of plan.edges.filter((x) => x.to === t.key)) {
    const up = plan.tasks.find((x) => x.key === e.from);
    const from = up && ownBot(c, up.botId);
    if (!up || !from) continue;
    const dest = `${inputDir(c.id, t.key, n)}/${up.key}`;
    let copied = 0;
    const walk = (rel: string, sub: string, depth: number) => {
      for (const f of listFiles(from.id, rel)) {
        if (f.dir) { if (depth < 2) walk(`${rel}/${f.name}`, sub ? `${sub}/${f.name}` : f.name, depth + 1); continue; }
        if (copied >= 60 || f.size > 5_000_000 || total + f.size > 20_000_000) continue;
        const data = readLibraryFile(from.id, `${rel}/${f.name}`);
        storeBytes(to.id, sub ? `${dest}/${sub}` : dest, f.name, data);
        copied++; total += f.size;
      }
    };
    try { walk(outputDir(c.id, up.key), "", 0); } catch (err) { console.error("[chantier inputs]", (err as Error).message); }
    lines.push(`- ${dest}/ — ${e.artifact} (from task "${up.key}", ${copied} file${copied === 1 ? "" : "s"})`);
  }
  return lines;
}

/** What the bot is told in the first round of an attempt (later rounds have it in the thread's history). */
export function taskBrief(c: ChantierRecord, plan: ChantierPlan, t: PlanTask, n: number, inputs: string[], report: FailureReport | null, ownerNote = ""): string {
  const ck = t.contract.checks.map((x) => `- ${x.label} [${x.kind}${x.path ? ` ${x.path}` : ""}]${x.fromLesson ? " (lesson from an earlier chantier)" : ""}`);
  return [
    "<chantier_task>",
    `Chantier: ${JSON.stringify(c.title)}. Your task "${t.key}": ${JSON.stringify(t.title)} (role: ${t.role}). Attempt ${n} of ${plan.maxAttempts}.`,
    `Deliverable: ${t.deliverable || t.contract.output}`,
    `Input: ${t.contract.input}`,
    ...(inputs.length ? ["Artifacts of the earlier tasks, copied into your library:", ...inputs] : []),
    `Output: ${t.contract.output}`,
    `Write every file of your deliverable in your library under "${outputDir(c.id, t.key)}/" (e.g. file_save with filename "${outputDir(c.id, t.key)}/result.md"), and nothing else there.`,
    ...(ck.length ? ["Done means — a program checks these after you mark the goal complete:", ...ck] : []),
    ...(t.contract.criteria.length ? ["A reviewer bot then judges these criteria:", ...t.contract.criteria.map((k) => `- ${k.text}`)] : []),
    "Scope — do NOT change:", ...t.contract.scope.map((x) => `- ${x}`),
    "Rules: reconstruct behaviour only — never copy another product's source code, prompts, texts, names or assets. Publishing, paying or deleting anything still needs the owner's yes, as always: ask, the task waits.",
    ...(report ? [
      "REPAIR — the previous attempt was rejected. Failure report:",
      `- Component: ${report.component}`, `- Conditions: ${report.conditions}`, `- Failure: ${report.failure}`, `- Expected: ${report.expected}`,
      `- Repair scope: ${report.repairScope}`, `- Checked again: ${report.recheck.join(" ; ")}`,
      "Fix only what the report names; keep the parts that passed as they are.",
    ] : []),
    ...(ownerNote ? [`The owner adds: ${JSON.stringify(clip(ownerNote, 1000))}`] : []),
    "When every file is written and you checked them yourself, call goal_update with status \"complete\" and the evidence (what you checked). If only the owner can unblock you, call goal_update with status \"blocked\" and say why.",
    "</chantier_task>",
  ].join("\n");
}

/** Sends one attempt of a task to its bot, as a goal in the task's own thread. */
function dispatch(c: ChantierRecord, t: PlanTask, report: FailureReport | null = null, ownerNote = "") {
  const loc = locOf(c);
  const plan = planOf(c);
  const st = tasks.get(c.id, t.key)!;
  const bot = ownBot(c, t.botId);
  if (!bot) {
    tasks.set(c.id, t.key, { state: "blocked", note: ct(loc, "its bot is gone") });
    decisions.open(c.id, t.key, "blocked", ct(loc, "Task “{task}”: its bot is gone. Edit nothing here — stop this branch, or create the chantier again with another bot.", { task: t.title }), ["stop_branch"]);
    return;
  }
  const n = st.attempts + 1;
  let thread = st.thread;
  if (!thread || !rows.get(bot.id, bot.generation, thread)) {
    thread = rows.append(bot, { kind: "message", role: "assistant", text: ct(loc, "Chantier “{title}” — task “{task}”: running…", { title: c.title, task: t.title }) }, 0).seq;
    bots.bumpUnread(bot.id);
  }
  const inputs = copyInputs(c, plan, t, n);
  const g = createGoal(bot, { objective: ct(loc, "Chantier “{title}” — task “{task}” (attempt {n}/{max})", { title: clip(c.title, 80), task: t.title, n, max: plan.maxAttempts }), thread, origin: "chantier" });
  attempts.start(c.id, t.key, n, bot.id, g.id);
  tasks.set(c.id, t.key, { state: n > 1 ? "repairing" : "running", thread, goalId: g.id, attempts: n, note: "", ...(st.startedAt ? {} : { startedAt: now() }), endedAt: null });
  goals.set(g, { queued: true });
  enqueue(bot.id, { kind: "system", text: `${goalRoundPrompt(g, 1)}\n\n${taskBrief(c, plan, t, n, inputs, report, ownerNote)}`, thread, goalRound: g.id, origin: "chantier", depth: 0 });
}

// ── When a task's goal ends ──────────────────────────────────────────────────────────────────────────────────────
const evaluating = new Set<string>();
let selfResume = false;

onGoalStatus((g, before) => {
  if (g.origin !== "chantier") return;
  // The owner pressed Resume on a task's goal card (or resumed its bot): a « continue », with the reason it stopped.
  if (g.status === "active" && ["paused", "limit", "blocked"].includes(before.status)) {
    const link = selfResume ? null : tasks.byGoal(g.id);
    if (link) nudges.add(link.chantierId, "continue", `${link.task.key}: ${before.reason || before.status}`);
    return;
  }
  setImmediate(() => { void onGoalEnd(g.id).catch((err) => console.error("[chantier]", err)); });
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** A task's goal changed: check the attempt, ask the owner, or wait. Idempotent (also called after a restart). */
export async function onGoalEnd(goalId: string) {
  const link = tasks.byGoal(goalId);
  if (!link || evaluating.has(goalId)) return;
  const c = chantiers.byId(link.chantierId);
  const g = goals.byId(goalId);
  if (!c || !g || (c.status !== "running" && c.status !== "waiting_owner")) return;
  const st = link.task;
  if (!ACTIVE.has(st.state)) return;
  const plan = planOf(c);
  const t = plan.tasks.find((x) => x.key === st.key);
  if (!t) return;
  const loc = locOf(c);
  const bot = ownBot(c, t.botId);
  if (g.status === "complete" || g.status === "limit") {
    evaluating.add(goalId);
    try {
      // Let the round's turn end first (the bot may still be writing after goal_update).
      for (let i = 0; bot && i < 2400 && runningThreads(bot.id).includes(st.thread); i++) await sleep(250);
      await evaluate(chantiers.byId(c.id)!, t, g);
    } finally { evaluating.delete(goalId); }
  } else if (g.status === "blocked") {
    tasks.set(c.id, t.key, { state: "blocked", note: g.reason });
    askOwner(c, t, "blocked", ct(loc, "Task “{task}” needs you: {reason}", { task: t.title, reason: clip(g.reason, 400) }), ["resume", "stop_branch"]);
  } else if (g.status === "stopped") {
    const last = attempts.last(c.id, t.key);
    if (last?.result === "running") attempts.finish(last.id, { result: "stopped", summary: g.reason });
    tasks.set(c.id, t.key, { state: "blocked", note: g.reason });
    askOwner(c, t, "blocked", ct(loc, "Task “{task}” stopped ({reason}). Start it again, or stop this branch?", { task: t.title, reason: clip(g.reason, 200) }), ["retry", "stop_branch"]);
  } else if (g.status === "paused") {
    tasks.set(c.id, t.key, { note: ct(loc, "paused: {reason} — resume its goal in the thread", { reason: clip(g.reason, 200) }) });
  }
  settle(c.id);
}

function askOwner(c: ChantierRecord, t: PlanTask, kind: "escalation" | "blocked" | "review", question: string, options: DecisionAnswer[]) {
  decisions.open(c.id, t.key, kind, question, options);
  const bot = ownBot(c, t.botId) ?? ownBot(c, c.plannerBotId);
  if (bot) tell({ type: "waiting", bot, text: clip(`${c.title} — ${question}`, 300) });
}

/** Checks the attempt that just ended: code checks, then the reviewer, then accept / send back / ask the owner. */
async function evaluate(c: ChantierRecord, t: PlanTask, g: GoalRecord) {
  const loc = locOf(c);
  const plan = planOf(c);
  const last = attempts.last(c.id, t.key);
  if (!last || last.result !== "running") return;
  tasks.set(c.id, t.key, { state: "checking" });
  const code = runCodeChecks(c, plan, t, loc);
  const review = code.every((x) => x.pass) ? await reviewTask(c, t, loc, ask) : [];
  const fresh = chantiers.byId(c.id);
  if (!fresh || (fresh.status !== "running" && fresh.status !== "waiting_owner")) return; // stopped meanwhile
  const checks = [...code, ...review];
  const u = usageBetween(last.botId, last.startedAt, now());
  const failed = checks.filter((x) => !x.pass);
  const base = { summary: g.summary || g.reason, evidence: g.evidence, checks, costUsd: u.costUsd, tokens: u.tokens };
  if (!failed.length) { attempts.finish(last.id, { ...base, result: "accepted" }); accept(fresh, t); return; }
  if (failed.every((x) => x.unsure)) {
    attempts.finish(last.id, { ...base, result: "blocked" });
    tasks.set(c.id, t.key, { state: "blocked", note: ct(loc, "the reviewer is not sure") });
    askOwner(fresh, t, "review", ct(loc, "Task “{task}”: the reviewer could not judge {criteria}. Look at its files: is it good?", { task: t.title, criteria: failed.map((x) => `“${clip(x.label, 80)}”`).join(", ") }), ["accept", "redo"]);
    settle(c.id);
    return;
  }
  const report = failureReport(fresh, plan, t, last.n, failed, loc);
  attempts.finish(last.id, { ...base, result: "failed", report });
  sendBack(fresh, t, failed, report);
}

/** Sends back only the failed unit (principle 6): the task itself, or the upstream task an integration check blames. */
function sendBack(c: ChantierRecord, t: PlanTask, failed: CheckResult[], report: FailureReport, ownerNote = "") {
  const plan = planOf(c);
  const blamed = failed.find((x) => x.blame)?.blame;
  const unit = (blamed && plan.tasks.find((x) => x.key === blamed)) || t;
  if (unit.key !== t.key) tasks.set(c.id, t.key, { state: "waiting", note: ct(locOf(c), "waits for “{task}” to be repaired, then checks again", { task: unit.title }) });
  if (unit.integration) { escalate(c, unit, report); return; }
  const st = tasks.get(c.id, unit.key)!;
  if (st.attempts >= plan.maxAttempts + st.extra) { escalate(c, unit, report); return; }
  // Tasks after the unit that were already accepted are not redone; integration tasks recheck once it is accepted again.
  dispatch(c, unit, report, ownerNote);
  settle(c.id);
}

/** At the limit: the branch stops here, everything is kept, and the owner decides (principle 6). */
function escalate(c: ChantierRecord, t: PlanTask, report: FailureReport) {
  const loc = locOf(c);
  tasks.set(c.id, t.key, { state: "blocked", note: ct(loc, "limit of attempts reached") });
  askOwner(c, t, "escalation", ct(loc, "Task “{task}” failed {n} times. Last failure: {failure}. Expected: {expected}. Every attempt and its evidence are kept.", { task: t.title, n: tasks.get(c.id, t.key)!.attempts, failure: clip(report.failure, 300), expected: clip(report.expected, 300) }), ["retry", "accept", "stop_branch"]);
  settle(c.id);
}

/** A task passed: lessons from what failed before, the thread says so, the next tasks start. */
function accept(c: ChantierRecord, t: PlanTask, byOwner = false) {
  const loc = locOf(c);
  const st = tasks.get(c.id, t.key)!;
  tasks.set(c.id, t.key, { state: "accepted", endedAt: now(), note: byOwner ? ct(loc, "accepted by you") : "" });
  decisions.closeFor(c.id, t.key);
  if (!byOwner) learn(c, t);
  const bot = ownBot(c, t.botId);
  const parent = bot && st.thread ? rows.get(bot.id, bot.generation, st.thread) : null;
  if (bot && parent && parent.body.kind === "message") rows.rewrite(bot, parent.generation, parent.seq, { ...parent.body, text: ct(loc, "Chantier “{title}” — task “{task}”: accepted after {n} attempt(s).", { title: c.title, task: t.title, n: st.attempts }) });
  // Integration tasks waiting to recheck after this repair go back to « waiting »: advance runs them.
  advance(c.id);
}

/** Principle 7: each code check that failed in an earlier attempt of this task and passes now becomes a lesson. */
function learn(c: ChantierRecord, t: PlanTask) {
  const all = attempts.of(c.id).filter((a) => a.taskKey === t.key);
  const lastOk = all[all.length - 1];
  if (!lastOk || lastOk.result !== "accepted") return;
  const existing = lessons.of(c.userId, true);
  const loc = locOf(c);
  for (const prev of all.slice(0, -1)) for (const f of prev.checks.filter((x) => !x.pass && x.kind !== "review")) {
    const check = t.contract.checks.find((x) => x.id === f.id);
    if (!check || check.fromLesson || !lastOk.checks.some((x) => x.id === f.id && x.pass)) continue;
    const rule = ct(loc, "Check: {label}", { label: check.label });
    if (existing.some((l) => l.rule === rule && l.status === "active")) continue;
    existing.push(lessons.add(c.userId, {
      rule,
      evidence: ct(loc, "Chantier “{title}”, task “{task}”: attempt {a} failed ({actual}, expected {expected}); passed at attempt {b}.", { title: c.title, task: t.title, a: prev.n, actual: f.actual, expected: f.expected, b: lastOk.n }),
      appliesTo: `${t.role} ${t.title}`,
      check: { ...check, task: undefined, fromLesson: undefined },
      sourceChantier: c.id,
    }));
  }
}

/** An integration task: no production, only its checks over the upstream outputs (first run, or after a repair). */
async function recheck(c: ChantierRecord, t: PlanTask) {
  const loc = locOf(c);
  const plan = planOf(c);
  const st = tasks.get(c.id, t.key)!;
  const n = st.attempts + 1;
  const bot = ownBot(c, t.botId);
  tasks.set(c.id, t.key, { state: "checking", attempts: n, ...(st.startedAt ? {} : { startedAt: now() }) });
  const id = attempts.start(c.id, t.key, n, bot?.id ?? t.botId, null);
  const checks = runCodeChecks(c, plan, t, loc);
  const failed = checks.filter((x) => !x.pass);
  if (!failed.length) { attempts.finish(id, { result: "accepted", summary: ct(loc, "integration checks passed"), checks }); accept(chantiers.byId(c.id)!, t); return; }
  const report = failureReport(c, plan, t, n, failed, loc);
  attempts.finish(id, { result: "failed", summary: ct(loc, "integration checks failed"), checks, report });
  sendBack(chantiers.byId(c.id)!, t, failed, report);
}

// ── The owner's cards and buttons ────────────────────────────────────────────────────────────────────────────────
export function answerDecision(userId: string, id: string, decisionId: string, answer: DecisionAnswer, note = "") {
  const c = chantiers.owned(userId, id);
  if (!c) throw new ChantierError(404, "That chantier does not exist.");
  const loc = locOf(c);
  const d = decisions.get(id, decisionId);
  if (!d) throw new ChantierError(404, ct(loc, "That card does not exist."));
  if (d.status !== "open") throw new ChantierError(409, ct(loc, "This card was already answered."));
  if (!d.options.includes(answer)) throw new ChantierError(400, ct(loc, "That answer is not offered here."));
  if (c.status !== "running" && c.status !== "waiting_owner") throw new ChantierError(409, ct(loc, "This chantier is over."));
  const plan = planOf(c);
  const t = plan.tasks.find((x) => x.key === d.taskKey)!;
  const st = tasks.get(id, d.taskKey)!;
  decisions.answer(id, decisionId, answer, note);
  nudges.add(id, "intervention", `${t.key}: ${answer}${note ? ` — ${note}` : ""}`);
  const last = attempts.last(id, t.key);
  switch (answer) {
    case "retry":
      tasks.set(id, t.key, { extra: Math.max(st.extra, st.attempts + 1 - plan.maxAttempts), state: "waiting" });
      if (t.integration) void recheck(c, t);
      else dispatch(c, t, last?.report ?? null, note);
      break;
    case "redo": {
      const failed = (last?.checks ?? []).filter((x) => !x.pass).map((x) => ({ ...x, unsure: false, actual: note ? `${x.actual} — ${note}` : x.actual }));
      const report = failureReport(c, plan, t, st.attempts, failed, loc);
      if (last) attempts.finish(last.id, { ...last, result: "failed", report });
      tasks.set(id, t.key, { state: "running" });
      sendBack(c, t, failed, report, note);
      break;
    }
    case "accept":
      if (last && last.result !== "accepted") attempts.finish(last.id, { ...last, result: "accepted", summary: `${last.summary} ${ct(loc, "(accepted by you)")}`.trim() });
      accept(c, t, true);
      break;
    case "stop_branch":
      for (const k of [t.key, ...downstreamOf(plan, t.key)]) if (tasks.get(id, k)?.state !== "accepted") { tasks.set(id, k, { state: "stopped", note: ct(loc, "branch stopped by you") }); decisions.closeFor(id, k); }
      break;
    case "resume": {
      const g = st.goalId ? goals.byId(st.goalId) : null;
      const bot = ownBot(c, t.botId);
      if (g && bot && g.status === "blocked") {
        tasks.set(id, t.key, { state: st.attempts > 1 ? "repairing" : "running", note: "" });
        selfResume = true;
        try { goalAction(bot, g.id, "resume"); } finally { selfResume = false; }
      } else dispatch(c, t, null, note);
      break;
    }
  }
  advance(id);
  settle(id);
}

/** « Arrêter le chantier »: every running goal stops (its lane only), every attempt and file is kept. */
export function stopChantier(userId: string, id: string) {
  const c = chantiers.owned(userId, id);
  if (!c) throw new ChantierError(404, "That chantier does not exist.");
  const loc = locOf(c);
  if (c.status === "done" || c.status === "stopped") throw new ChantierError(409, ct(loc, "This chantier is over."));
  chantiers.set(id, { status: "stopped", endedAt: now(), note: ct(loc, "stopped by you") });
  nudges.add(id, "intervention", ct(loc, "stopped the chantier"));
  for (const st of tasks.of(id)) {
    if (st.state === "accepted") continue;
    const g = st.goalId ? goals.byId(st.goalId) : null;
    const bot = bots.byId(st.botId);
    if (g && bot && bot.userId === userId && ["active", "paused", "blocked", "limit", "proposed"].includes(g.status)) { try { goalAction(bot, g.id, "stop"); } catch { /* already over */ } }
    const last = attempts.last(id, st.key);
    if (last?.result === "running") attempts.finish(last.id, { ...last, result: "stopped", summary: ct(loc, "stopped by you") });
    tasks.set(id, st.key, { state: "stopped", note: ct(loc, "stopped by you") });
  }
  decisions.closeFor(id);
  audit(userId, "system", `Chantier stopped — ${clip(c.title, 160)}`);
}

/**
 * The owner nudges a task: « continue » (resume its paused goal) or restates what they want (their words go into the
 * task's thread as their own message). Both are counted, with the reason they give (metrics).
 */
export function nudgeTask(userId: string, id: string, key: string, kind: "continue" | "restate", reason: string, text = "", send?: (bot: BotRecord, text: string, thread: number) => void) {
  const c = chantiers.owned(userId, id);
  if (!c) throw new ChantierError(404, "That chantier does not exist.");
  const loc = locOf(c);
  const st = tasks.get(id, key);
  const t = planOf(c).tasks.find((x) => x.key === key);
  if (!st || !t) throw new ChantierError(404, ct(loc, "That task does not exist."));
  if (!reason.trim()) throw new ChantierError(400, ct(loc, "Say why, in a few words: it is counted to improve the next chantiers."));
  const bot = ownBot(c, t.botId);
  if (!bot) throw new ChantierError(409, ct(loc, "its bot is gone"));
  nudges.add(id, kind, `${key}: ${reason}`);
  if (kind === "continue") {
    const g = st.goalId ? goals.byId(st.goalId) : null;
    if (g && ["paused", "limit"].includes(g.status)) { selfResume = true; try { goalAction(bot, g.id, "resume"); } finally { selfResume = false; } }
  } else if (text.trim() && st.thread && send) send(bot, text.trim(), st.thread);
}

/** After a restart: goals that ended while the server was off are checked, half-done checks run again, tasks go on. */
export function resumeChantiers(): number {
  let n = 0;
  for (const c of chantiers.live()) {
    for (const st of tasks.of(c.id)) {
      const t = planOf(c).tasks.find((x) => x.key === st.key);
      if (!t) continue;
      if (st.state === "checking" && t.integration) { tasks.set(c.id, st.key, { state: "waiting", attempts: Math.max(0, st.attempts - 1) }); const last = attempts.last(c.id, st.key); if (last?.result === "running") attempts.finish(last.id, { result: "stopped", summary: "restart" }); continue; }
      if (st.state === "checking") tasks.set(c.id, st.key, { state: st.attempts > 1 ? "repairing" : "running" });
      if (ACTIVE.has(st.state) && st.goalId) { void onGoalEnd(st.goalId).catch((err) => console.error("[chantier resume]", err)); n++; }
    }
    advance(c.id);
  }
  return n;
}
