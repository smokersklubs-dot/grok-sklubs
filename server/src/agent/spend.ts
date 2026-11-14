import { emit } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import { runs } from "../routines.js";
import type { Card, SpendScope } from "../shared.js";
import { audit, bots, clip, newId, now, rows, settings, users, type BotRecord } from "../store.js";

/**
 * Spend checkpoints (spec 07 A5). Each piece of work a bot does is a "scope": a chat (or one thread) since the user's
 * last message there, a background task since the user last wrote on its card, a routine run. Every model call billed
 * to the bot while a scope is active (its own steps, and the automatic reviewer's checks) adds to that scope. Once the
 * scope has spent its checkpoint (the bot's setting, else the account's, 5 $ by default), the turn stops before its
 * next step — an action already started finishes first — and a card asks: continue (up to the next checkpoint), raise
 * (doubles it for this piece of work) or stop. Nothing done is lost: the history stays, and "continue" picks it up.
 *
 * With a model the server has no price for (a subscription tool, an unknown model), nothing is counted: there is no
 * checkpoint for that work.
 */

/** The scope each bot's running turn bills to (in memory: a restart begins a new turn anyway). */
const active = new Map<string, string>();

export const scopeKey = {
  chat: (thread: number) => `chat:${thread || 0}`,
  task: (taskId: string) => `task:${taskId}`,
  routine: (runId: string) => `routine:${runId}`,
};
const scopeOf = (key: string): SpendScope => (key.startsWith("task:") ? "task" : key.startsWith("routine:") ? "routine" : "chat");

/** The checkpoint that applies to a bot, in USD (0: never stops). A task's helper follows its parent's setting. */
export function checkpointFor(bot: BotRecord): number {
  const owner = bot.parentId ? bots.byId(bot.parentId) ?? bot : bot;
  return owner.spendCheckpointUsd ?? settings.spend(bot.userId).checkpointUsd;
}

export function beginScope(botId: string, key: string) { active.set(botId, key); }
export function endScope(botId: string) { active.delete(botId); }
export const activeScope = (botId: string) => active.get(botId) ?? null;

/** Called for every model call billed to a bot (usage.record): adds to its active scope, and to the routine run it serves. */
export function addSpend(botId: string, usd: number) {
  const key = active.get(botId);
  if (!key || !(usd > 0)) return;
  q.run("INSERT INTO spend_scopes (worker_id, scope_key, spent_usd, updated_at) VALUES (?, ?, ?, ?) ON CONFLICT(worker_id, scope_key) DO UPDATE SET spent_usd = spent_usd + excluded.spent_usd, updated_at = excluded.updated_at", botId, key, usd, now());
  if (key.startsWith("routine:")) runs.addCost(key.slice(8), usd);
}

/** The user spoke to this piece of work: what it spent so far no longer counts towards its checkpoint. */
export function resetScope(botId: string, key: string) {
  q.run("UPDATE spend_scopes SET spent_usd = 0, updated_at = ? WHERE worker_id = ? AND scope_key = ?", now(), botId, key);
}

export function spentIn(botId: string, key: string): { spent: number; threshold: number | null } {
  const r = q.get<{ spent_usd: number; threshold_usd: number | null }>("SELECT spent_usd, threshold_usd FROM spend_scopes WHERE worker_id = ? AND scope_key = ?", botId, key);
  return { spent: r?.spent_usd ?? 0, threshold: r?.threshold_usd ?? null };
}

/** The checkpoint this scope has reached, if it has: what it spent and the checkpoint it passed. */
export function overCheckpoint(bot: BotRecord, key: string): { spent: number; threshold: number } | null {
  const s = spentIn(bot.id, key);
  const threshold = s.threshold ?? checkpointFor(bot);
  if (!(threshold > 0) || s.spent < threshold) return null;
  return { spent: s.spent, threshold };
}

interface CheckpointRecord { id: string; workerId: string; cardBotId: string; scopeKey: string; generation: number; thread: number; cardSeq: number | null; spent: number; threshold: number; tainted: boolean; origin: string; status: string }
const toCheckpoint = (r: any): CheckpointRecord => ({ id: r.id, workerId: r.worker_id, cardBotId: r.card_bot_id, scopeKey: r.scope_key, generation: r.generation, thread: r.thread, cardSeq: r.card_seq ?? null, spent: r.spent_usd, threshold: r.threshold_usd, tainted: !!r.tainted, origin: r.origin ?? "", status: r.status });
export const checkpoints = {
  byId: (id: string) => { const r = q.get("SELECT * FROM spend_checkpoints WHERE id = ?", id); return r ? toCheckpoint(r) : null; },
  pendingFor: (workerId: string) => { const r = q.get("SELECT * FROM spend_checkpoints WHERE worker_id = ? AND status = 'pending' ORDER BY created_at DESC LIMIT 1", workerId); return r ? toCheckpoint(r) : null; },
};

/** What the scope is about, for the card's title. */
function titleOf(bot: BotRecord, key: string): string {
  const loc = users.localeOf(bot.userId);
  if (key.startsWith("task:")) return q.get<{ title: string }>("SELECT title FROM bg_tasks WHERE id = ?", key.slice(5))?.title ?? bot.name;
  if (key.startsWith("routine:")) {
    const r = q.get<{ name: string }>("SELECT r.name FROM routine_runs x JOIN routines r ON r.id = x.routine_id WHERE x.id = ?", key.slice(8));
    return r ? tr(loc, "Routine “{name}”", { name: r.name }) : bot.name;
  }
  return tr(loc, "Work in {bot}'s chat", { bot: bot.name });
}

/**
 * Stops the work at its checkpoint: the card goes where the user follows this work (a background task's card is in
 * its parent's main chat; a chat or a routine in the bot's own chat, in the thread it worked in).
 */
export function raiseCheckpoint(bot: BotRecord, key: string, over: { spent: number; threshold: number }, info: { thread: number; tainted: boolean; origin?: string }): string {
  const parent = key.startsWith("task:") && bot.parentId ? bots.byId(bot.parentId) : null;
  const cardBot = parent ?? bot;
  const thread = parent ? 0 : info.thread;
  const id = newId("spd");
  const title = clip(titleOf(bot, key), 120);
  const card: Card = { type: "spend", checkpointId: id, title, scope: scopeOf(key), spentUsd: Math.round(over.spent * 100) / 100, thresholdUsd: over.threshold, status: "pending" };
  const row = rows.append(cardBot, { kind: "card", card }, thread);
  q.run("INSERT INTO spend_checkpoints (id, worker_id, card_bot_id, scope_key, generation, thread, card_seq, spent_usd, threshold_usd, tainted, origin, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    id, bot.id, cardBot.id, key, cardBot.generation, thread, row.seq, over.spent, over.threshold, info.tainted ? 1 : 0, info.origin ?? "", now());
  bots.bumpUnread(cardBot.id);
  audit(bot.userId, "system", `${bot.name}: spend checkpoint reached (${over.spent.toFixed(2)} $ ≥ ${over.threshold.toFixed(2)} $) — ${title}`, bot.id);
  return id;
}

export const SPEND_CONTINUE_TEXT = "You stopped at a spend checkpoint and the user chose to continue. Pick the work back up where you left off — do not redo what is already done — and finish it, or say plainly where things stand.";

/**
 * The user's answer on a checkpoint card. "continue": the scope starts counting again from zero and the work resumes;
 * "raise": its checkpoint doubles for this piece of work, then it resumes; "stop": it stays stopped (a task is marked
 * stopped). Returns false when the card was already answered.
 */
export async function answerCheckpoint(cp: CheckpointRecord, action: "continue" | "raise" | "stop"): Promise<boolean> {
  const status = action === "continue" ? "continued" : action === "raise" ? "raised" : "stopped";
  if (Number(q.run("UPDATE spend_checkpoints SET status = ? WHERE id = ? AND status = 'pending'", status, cp.id).changes) !== 1) return false;
  const worker = bots.byId(cp.workerId);
  const cardBot = bots.byId(cp.cardBotId);
  if (cardBot && cp.cardSeq !== null && cardBot.generation === cp.generation)
    rows.updateCard(cardBot, cp.generation, cp.cardSeq, (c) => (c.type === "spend" ? { ...c, status, ...(action === "raise" ? { thresholdUsd: cp.threshold * 2 } : {}) } : c));
  if (!worker) return true;
  const loc = users.localeOf(worker.userId);
  audit(worker.userId, "system", `${worker.name}: spend checkpoint — ${tr(loc, action === "continue" ? "continued" : action === "raise" ? "checkpoint raised" : "stopped")}`, worker.id);
  if (action === "stop") {
    if (cp.scopeKey.startsWith("task:")) {
      const { bgTasks, stopTask } = await import("./bgtasks.js");
      const t = bgTasks.byId(cp.scopeKey.slice(5));
      if (t) await stopTask(t);
    }
    return true;
  }
  if (action === "raise") q.run("UPDATE spend_scopes SET threshold_usd = ?, updated_at = ? WHERE worker_id = ? AND scope_key = ?", cp.threshold * 2, now(), worker.id, cp.scopeKey);
  else resetScope(worker.id, cp.scopeKey);
  if (cp.scopeKey.startsWith("task:")) {
    const { bgTasks } = await import("./bgtasks.js");
    const t = bgTasks.byId(cp.scopeKey.slice(5));
    if (t) bgTasks.set(t.id, { state: "running" });
    if (cardBot) emit(cardBot.userId, { type: "tasks", botId: cardBot.id });
  }
  const { enqueue } = await import("./loop.js");
  enqueue(worker.id, { kind: "system", text: SPEND_CONTINUE_TEXT, thread: cp.scopeKey.startsWith("chat:") ? cp.thread || undefined : undefined, tainted: cp.tainted, resumeOf: "spend", spendScope: cp.scopeKey, origin: cp.origin || undefined });
  return true;
}
