import { emit, getLive } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { ToolSpec } from "../llm/types.js";
import type { BgTask, BgTaskState, Card } from "../shared.js";
import { approvals, audit, bots, clip, newId, now, paused, rows, users, type BotRecord } from "../store.js";

/**
 * Background tasks tracked from the chat (spec 07 A4). When the user asks for long work, the bot starts a task with
 * task_start: a hidden helper of its own does the work in its own conversation, so the main chat stays free. A card in
 * the main chat follows it — running / waiting for you / done / failed / stopped, a live step counter, "Stop" — and what
 * the user writes on the card goes to that task. When it ends, its report comes back to the main chat. At most
 * MAX_BG_TASKS run (or wait) at once per bot.
 *
 * The helper's grounding (grounding.ts) counts the user's words in the parent's main chat and on the card, never the goal
 * the bot wrote for it. Its approvals are answered from the task card.
 */
export const MAX_BG_TASKS = 3;

interface TaskRecord extends BgTask { helperId: string | null; goal: string; generation: number; cardSeq: number | null }
const toTask = (r: any): TaskRecord => ({ id: r.id, botId: r.bot_id, helperId: r.helper_id ?? null, title: r.title, goal: r.goal, state: r.state, steps: r.steps, result: r.result, generation: r.generation, cardSeq: r.card_seq ?? null, createdAt: r.created_at, updatedAt: r.updated_at });
export const publicTask = ({ helperId: _h, goal: _g, generation: _n, cardSeq: _c, ...rest }: TaskRecord): BgTask => rest;

export const bgTasks = {
  byId: (id: string) => { const r = q.get("SELECT * FROM bg_tasks WHERE id = ?", id); return r ? toTask(r) : null; },
  byHelper: (helperId: string) => { const r = q.get("SELECT * FROM bg_tasks WHERE helper_id = ?", helperId); return r ? toTask(r) : null; },
  forBot: (botId: string) => q.all("SELECT * FROM bg_tasks WHERE bot_id = ? ORDER BY created_at DESC LIMIT 50", botId).map(toTask),
  active: (botId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bg_tasks WHERE bot_id = ? AND state IN ('running','waiting')", botId)!.n,
  set(id: string, f: { state?: BgTaskState; steps?: number; result?: string }) {
    const cur = bgTasks.byId(id);
    if (!cur) return null;
    q.run("UPDATE bg_tasks SET state = ?, steps = ?, result = ?, updated_at = ? WHERE id = ?", f.state ?? cur.state, f.steps ?? cur.steps, f.result ?? cur.result, now(), id);
    return bgTasks.byId(id);
  },
};

/** Rewrites the task's card in the parent's chat (when that conversation is still the current one). */
function refreshCard(t: TaskRecord, extra: Partial<Extract<Card, { type: "task" }>> = {}) {
  const parent = bots.byId(t.botId);
  if (!parent || t.cardSeq === null || parent.generation !== t.generation) return;
  rows.updateCard(parent, t.generation, t.cardSeq, (c) => {
    if (c.type !== "task") return c;
    const next: Extract<Card, { type: "task" }> = { ...c, state: t.state, steps: t.steps, ...(t.result ? { result: clip(t.result, 2400) } : {}), ...extra };
    if (!("question" in extra)) delete next.question;
    if (!("approval" in extra)) delete next.approval;
    return next;
  });
  emit(parent.userId, { type: "tasks", botId: parent.id });
}

export class TaskLimitError extends Error {}

/** Starts a background task for `parent`: the hidden helper, its card in the main chat, and its first instruction. */
export function startTask(parent: BotRecord, title: string, goal: string, depth: number, tainted = false): TaskRecord {
  if (parent.parentId) throw new TaskLimitError("A helper or a background task cannot start background tasks.");
  if (bgTasks.active(parent.id) >= MAX_BG_TASKS) throw new TaskLimitError(`${MAX_BG_TASKS} background tasks are already under way. Wait for one to finish, or stop one.`);
  const loc = users.localeOf(parent.userId);
  const short = clip(title.replace(/\s+/g, " ").trim() || clip(goal, 40), 60);
  const helper = bots.create(parent.userId, {
    name: clip(`${parent.name} › ${short}`, 60), label: tr(loc, "Background task"), description: tr(loc, "Background task working for {name}.", { name: parent.name }),
    shape: parent.shape, color: parent.color, mode: parent.mode, effort: parent.effort, model: parent.model, autonomy: parent.autonomy,
    hidden: true, parentId: parent.id,
  });
  const id = newId("bgt");
  const t = now();
  q.run("INSERT INTO bg_tasks (id, bot_id, helper_id, title, goal, generation, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, parent.id, helper.id, short, clip(goal, 20_000), parent.generation, t, t);
  // The card lives in the main chat, whatever conversation the request came from.
  const card = rows.append(parent, { kind: "card", card: { type: "task", taskId: id, helperId: helper.id, title: short, state: "running", steps: 0 } }, 0);
  q.run("UPDATE bg_tasks SET card_seq = ? WHERE id = ?", card.seq, id);
  audit(parent.userId, "tool", `${parent.name}: background task started — ${short}`, parent.id);
  const instruction = `${goal}\n\n[You are working on this as a background task the user follows on a card in ${parent.name}'s chat. Work step by step; when you need a decision only the user can make, use ask_user (they answer on the card). Finish with a clear report: the main conclusion first, then the details.]`;
  rows.append(helper, { kind: "message", role: "user", text: goal, origin: { kind: "bot", id: parent.id, name: parent.name } });
  // Imported lazily: the loop imports this module for its hooks.
  void import("./loop.js").then(({ enqueue }) => enqueue(helper.id, { kind: "bot", fromName: parent.name, text: instruction, depth: depth + 1, tainted }));
  return bgTasks.byId(id)!;
}

/** "Stop" on a task card: its turn stops, its waiting approvals lapse; it can be resumed by replying on the card. */
export async function stopTask(t: TaskRecord): Promise<TaskRecord> {
  if (t.helperId) { const { interrupt, expireAllApprovals } = await import("./loop.js"); interrupt(t.helperId); expireAllApprovals(t.helperId); }
  const next = bgTasks.set(t.id, { state: "stopped" })!;
  refreshCard(next);
  const parent = bots.byId(t.botId);
  if (parent) audit(parent.userId, "tool", `${parent.name}: background task stopped — ${t.title}`, parent.id);
  return next;
}

/** What the user writes on a task card goes to that task (and reopens it if it had finished or stopped). */
export async function replyToTask(t: TaskRecord, text: string): Promise<TaskRecord> {
  const helper = t.helperId ? bots.byId(t.helperId) : null;
  if (!helper) throw new TaskLimitError("This task's worker is gone.");
  if (t.state !== "running" && t.state !== "waiting" && bgTasks.active(t.botId) >= MAX_BG_TASKS) throw new TaskLimitError(`${MAX_BG_TASKS} background tasks are already under way.`);
  // A question the helper asked is answered by this reply.
  const question = rows.list(helper.id, helper.generation, 30).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "question" && r.body.card.status === "pending");
  if (question) rows.updateCard(helper, question.generation, question.seq, (c) => (c.type === "question" ? { ...c, status: "answered", answer: clip(text, 500) } : c));
  // Typed by the user: it counts as their words for this task.
  rows.append(helper, { kind: "message", role: "user", text });
  const next = bgTasks.set(t.id, { state: "running" })!;
  refreshCard(next);
  const { submitUserMessage } = await import("./loop.js");
  submitUserMessage(helper, text);
  return next;
}

/** Hooks the turn loop calls for every bot; they only act for a background task's helper. */
export const bgTaskHooks = {
  isTaskHelper: (botId: string) => !!q.get("SELECT 1 FROM bg_tasks WHERE helper_id = ?", botId),
  started(bot: BotRecord) {
    if (!bot.parentId) return;
    const t = bgTasks.byHelper(bot.id);
    if (!t || t.state === "running") return;
    refreshCard(bgTasks.set(t.id, { state: "running" })!);
  },
  ended(bot: BotRecord, info: { failed: string; lastText: string; tainted: boolean }) {
    if (!bot.parentId) return;
    const t = bgTasks.byHelper(bot.id);
    if (!t) return;
    const steps = t.steps + (getLive(bot.id).steps ?? 0);
    const loc = users.localeOf(bot.userId);
    const held = paused.get<{ approvalId: string }>(bot.id);
    if (held?.approvalId) {
      // Waiting on an approval: it is answered from the task card.
      const a = approvals.byId(held.approvalId);
      const row = a ? rows.get(bot.id, a.generation, a.seq) : null;
      const card = row?.body.kind === "card" && row.body.card.type === "approval" ? row.body.card : null;
      refreshCard(bgTasks.set(t.id, { state: "waiting", steps })!, card ? { approval: { approvalId: card.approvalId, title: card.title, detail: [card.detail, card.why].filter(Boolean).join("\n\n"), ...(card.irreversible && card.irreversibleReason ? { irreversible: card.irreversibleReason } : {}) } } : {});
      return;
    }
    if (t.state === "stopped" || info.failed === "stopped") { refreshCard(bgTasks.set(t.id, { state: "stopped", steps })!); return; }
    // Stopped at a spend checkpoint (spend.ts): it waits for the user's answer on the checkpoint card.
    if (q.get("SELECT 1 FROM spend_checkpoints WHERE worker_id = ? AND status = 'pending'", bot.id)) {
      refreshCard(bgTasks.set(t.id, { state: "waiting", steps })!, { question: tr(loc, "Spend checkpoint reached: answer on the card in the chat (continue, raise or stop).") });
      return;
    }
    if (info.failed) {
      refreshCard(bgTasks.set(t.id, { state: "failed", steps, result: tr(loc, "Failed: {detail}", { detail: info.failed }) })!);
      const parent = bots.byId(t.botId);
      if (parent) rows.append(parent, { kind: "notice", tone: "error", text: tr(loc, "The background task “{title}” failed: {detail}", { title: t.title, detail: info.failed }) }, 0);
      return;
    }
    const question = rows.list(bot.id, bot.generation, 30).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "question" && r.body.card.status === "pending");
    if (question?.body.kind === "card" && question.body.card.type === "question") {
      const qc = question.body.card;
      refreshCard(bgTasks.set(t.id, { state: "waiting", steps })!, { question: [qc.question, ...qc.options.map((o, i) => `${i + 1}. ${o}`)].join("\n") });
      return;
    }
    // No report at all: the task needs the user rather than counting as done.
    if (!info.lastText.trim()) { refreshCard(bgTasks.set(t.id, { state: "waiting", steps })!, { question: tr(loc, "The task stopped without a result. Tell it how to go on.") }); return; }
    const done = bgTasks.set(t.id, { state: "done", steps, result: info.lastText })!;
    refreshCard(done);
    const parent = bots.byId(t.botId);
    if (!parent) return;
    audit(parent.userId, "tool", `${parent.name}: background task done — ${t.title}`, parent.id);
    void import("./loop.js").then(({ enqueue }) => enqueue(parent.id, {
      kind: "system", tainted: info.tainted,
      text: `Your background task "${t.title}" is finished. Its report (the user can read it in full on the task card):\n${clip(info.lastText, 8000)}\n\nTell the user its main conclusion in one or two short lines, in the main chat.`,
    }));
  },
};

// ── Tools ───────────────────────────────────────────────────────────────────
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

/** Tool definitions (wired into the built-in list by tools.ts, group "tasks"). */
export const bgTaskToolSpecs = {
  start: { name: "task_start", description: `Start a background task for long work (research across several sources, a comparison, a report, a long check) so the main chat stays free. A worker of yours does it in its own conversation; the user follows it on a card (state, steps, Stop) and can reply to it there. Its report comes back to you when it is done. At most ${MAX_BG_TASKS} at once. Do not use it for quick questions.`, inputSchema: obj({ title: str("A short title for the card (a few words)"), goal: str("Everything the task needs: the goal, the context, what the report must contain, when it is done") }, ["title", "goal"]) } satisfies ToolSpec,
  list: { name: "task_list", description: "List your background tasks with their state.", inputSchema: obj({}) } satisfies ToolSpec,
  stop: { name: "task_stop", description: "Stop one of your background tasks.", inputSchema: obj({ id: str("Task id") }, ["id"]) } satisfies ToolSpec,
};
