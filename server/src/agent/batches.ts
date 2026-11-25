import type { Hono } from "hono";
import { emit } from "../bus.js";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import { fail } from "../routeinput.js";
import type { BatchCard, BatchCost, BatchItemState, BatchItemView } from "../batchtypes.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord, type UserRecord } from "../store.js";
import { bgTasks, startTask, stopTask } from "./bgtasks.js";
import { dropPendingWork } from "./stopcommand.js";
import { setBatchListener } from "./batchstore.js";
import { laneCap } from "./lanes.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L99 « lots en parallèle » (owner decision 25/11/2026: "lots en parallèle, 3 à la fois par bot").
 *
 * A bot launches a batch of tasks in one go (batch_start: e.g. ten searches, one per competitor). Each task is a
 * background task of the bot without a card of its own (bgtasks.ts: a hidden helper works in its own conversation).
 * They run at most `laneCap` at a time — the bot's own task lanes (lanes.ts): 3, or 1 on a subscription engine or a free
 * hosted plan — counting the bot's other background tasks under way, so a bot never has more than 3 at work. The next
 * task starts as soon as one ends. One card in the main chat shows the whole batch (each task's state, the reports, what
 * it has cost, « Arrêter »); when the last task ends, the bot gets every report at once and writes ONE summary.
 * « Arrêter » cancels the tasks not started yet and stops the ones at work; what is done stays on the card (no summary
 * is written after a stop: the owner asked to stop).
 * Costs: each task's turns are recorded under its helper (usage table), added up for the card (batchCost).
 * Our own code; the idea of parallel sub-tasks with one result comes from OpenMausBot, OpenClaw and Timon (T23).
 */

export const MAX_BATCH_ITEMS = 20;
export const MIN_BATCH_ITEMS = 2;
export class BatchError extends Error {}

interface BatchRow { id: string; bot_id: string; title: string; state: BatchCard["state"]; generation: number; card_seq: number | null; depth: number; tainted: number; level: string | null; created_at: number; updated_at: number }
interface ItemRow { batch_id: string; idx: number; title: string; goal: string; task_id: string | null; state: "queued" | "started" | "cancelled"; extra: string | null }

const batchById = (id: string) => q.get<BatchRow>("SELECT * FROM batches WHERE id = ?", id) ?? null;
const itemsOf = (id: string) => q.all<ItemRow>("SELECT * FROM batch_items WHERE batch_id = ? ORDER BY idx", id);
const setState = (id: string, state: BatchCard["state"]) => q.run("UPDATE batches SET state = ?, updated_at = ? WHERE id = ?", state, now(), id);

/** How many tasks of this bot may start now: its lanes (3 at most) minus its background tasks already at work. */
export const freeSlots = (botId: string) => Math.max(0, laneCap(botId) - bgTasks.active(botId));

function viewOf(it: ItemRow): BatchItemView {
  if (it.state === "queued") return { title: it.title, state: "queued" };
  if (it.state === "cancelled" || !it.task_id) return { title: it.title, state: "stopped" };
  const t = bgTasks.byId(it.task_id);
  if (!t) return { title: it.title, state: "failed" };
  let extra: Partial<BatchItemView> = {};
  try { extra = it.extra ? JSON.parse(it.extra) : {}; } catch { extra = {}; }
  const state: BatchItemState = t.state;
  return {
    title: it.title, state,
    ...(t.result && (state === "done" || state === "failed") ? { result: clip(t.result, 1200) } : {}),
    ...(state === "waiting" && extra.question ? { question: extra.question } : {}),
    ...(state === "waiting" && extra.approval ? { approval: extra.approval } : {}),
  };
}

export function cardOf(b: BatchRow): BatchCard {
  return { type: "batch", batchId: b.id, title: b.title, state: b.state, parallel: laneCap(b.bot_id), items: itemsOf(b.id).map(viewOf) };
}

function refresh(b: BatchRow) {
  const parent = bots.byId(b.bot_id);
  if (!parent) return;
  if (b.card_seq !== null && parent.generation === b.generation) {
    const fresh = batchById(b.id) ?? b;
    rows.updateCard(parent, b.generation, b.card_seq, (c) => (c.type === "batch" ? cardOf(fresh) : c));
  }
  emit(parent.userId, { type: "tasks", botId: parent.id });
}

const itemNote = (parent: BotRecord, n: number, total: number) =>
  `[You are task ${n} of ${total} of a batch ${parent.name} runs in parallel; the user follows the batch on a card. Do only this task. Do not ask the user questions: make reasonable assumptions and say them in your report. Finish with a short, clear report: the main finding first, then the details and your sources.]`;

/** Starts the queued tasks that fit in the free slots, then closes the batch if nothing is left. */
export function pump(batchId: string): void {
  const b = batchById(batchId);
  if (!b || b.state !== "running") return;
  const parent = bots.byId(b.bot_id);
  if (!parent) return;
  const all = itemsOf(b.id);
  let free = freeSlots(parent.id);
  for (const it of all) {
    if (free <= 0) break;
    if (it.state !== "queued") continue;
    // Claimed first (never started twice by two pumps at once).
    if (Number(q.run("UPDATE batch_items SET state = 'started' WHERE batch_id = ? AND idx = ? AND state = 'queued'", b.id, it.idx).changes) !== 1) continue;
    try {
      startTask(parent, it.title, it.goal, b.depth, !!b.tainted, b.level ?? undefined, {
        note: itemNote(parent, it.idx + 1, all.length),
        link: (taskId) => q.run("UPDATE batch_items SET task_id = ? WHERE batch_id = ? AND idx = ?", taskId, b.id, it.idx),
      });
      free--;
    } catch (err) {
      console.error(`[batch ${b.id}]`, (err as Error)?.message ?? err);
      // Could not start (no worker could be made): this task is set aside, the others go on.
      q.run("UPDATE batch_items SET state = 'cancelled' WHERE batch_id = ? AND idx = ?", b.id, it.idx);
    }
  }
  refresh(b);
  finishIfDone(b.id);
}

/** Every task ended: the batch is done and the bot writes one summary from all the reports. */
function finishIfDone(batchId: string) {
  const b = batchById(batchId);
  if (!b || b.state !== "running") return;
  const views = itemsOf(b.id).map(viewOf);
  if (views.some((v) => v.state === "queued" || v.state === "running" || v.state === "waiting")) return;
  setState(b.id, "done");
  refresh(batchById(b.id)!);
  const parent = bots.byId(b.bot_id);
  if (!parent) return;
  const done = views.filter((v) => v.state === "done").length;
  audit(parent.userId, "tool", `${parent.name}: batch done — ${b.title} (${done}/${views.length})`, parent.id);
  const loc = users.localeOf(parent.userId);
  if (!done) { rows.append(parent, { kind: "notice", tone: "error", text: tr(loc, "No task of the batch “{title}” succeeded. The reasons are on its card.", { title: b.title }) }, 0); return; }
  const budget = Math.max(400, Math.floor(14_000 / views.length));
  const reports = itemsOf(b.id).map((it, i) => {
    const t = it.task_id ? bgTasks.byId(it.task_id) : null;
    return `${i + 1}. ${it.title} — ${views[i].state}\n${clip(t?.result ?? "", budget) || "(no report)"}`;
  }).join("\n\n");
  void import("./loop.js").then(({ enqueue }) => enqueue(parent.id, {
    // Always treated as outside content: the workers' reports usually come from pages they read (never authorises anything).
    kind: "system", tainted: true, unattended: true,
    text: `Your batch "${b.title}" is finished: ${done} of ${views.length} tasks done. Their reports (the user can read each one on the batch card):\n\n${reports}\n\nWrite ONE summary for the user in the main chat: what the tasks found together first (compare, rank or merge as the request needs), then anything that failed or is missing. Keep it short.`,
  }));
}

/** A batch task changed state (bgtasks.ts calls this instead of rewriting a card of its own). */
function onTaskChange(taskId: string, extra: { question?: string; approval?: BatchItemView["approval"] }) {
  const it = q.get<ItemRow>("SELECT * FROM batch_items WHERE task_id = ?", taskId);
  if (!it) return;
  const keep = { ...(extra.question ? { question: extra.question } : {}), ...(extra.approval ? { approval: extra.approval } : {}) };
  q.run("UPDATE batch_items SET extra = ? WHERE batch_id = ? AND idx = ?", Object.keys(keep).length ? JSON.stringify(keep) : null, it.batch_id, it.idx);
  pump(it.batch_id); // a slot may be free now; it also rewrites the card and closes the batch when nothing is left
  const b = batchById(it.batch_id);
  if (b && b.state !== "running") refresh(b);
}
setBatchListener((t, extra) => onTaskChange(t.id, extra));

export interface BatchItemInput { title: string; goal: string }

/** batch_start: records the batch, puts its card in the main chat and starts as many tasks as fit. */
export function startBatch(parent: BotRecord, title: string, items: BatchItemInput[], opts: { depth: number; tainted?: boolean; level?: unknown; context?: string }): BatchRow {
  if (parent.parentId) throw new BatchError("A helper or a background task cannot start a batch.");
  const list = items.map((i) => ({ title: clip(String(i.title ?? "").replace(/\s+/g, " ").trim(), 60), goal: String(i.goal ?? "").trim() })).filter((i) => i.goal);
  if (list.length < MIN_BATCH_ITEMS) throw new BatchError(`A batch needs at least ${MIN_BATCH_ITEMS} tasks, each with a goal. For one task, use task_start.`);
  if (list.length > MAX_BATCH_ITEMS) throw new BatchError(`A batch holds at most ${MAX_BATCH_ITEMS} tasks. Split the work, or group several small tasks into one.`);
  if (q.get("SELECT 1 FROM batches WHERE bot_id = ? AND state = 'running'", parent.id)) throw new BatchError("A batch of yours is still under way. Wait for its summary, or stop it with batch_stop.");
  const id = newId("bat");
  const t = now();
  const context = String(opts.context ?? "").trim();
  const level = typeof opts.level === "string" ? opts.level : null;
  q.tx(() => {
    q.run("INSERT INTO batches (id, bot_id, title, generation, depth, tainted, level, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, parent.id, clip(title.replace(/\s+/g, " ").trim() || list[0].title, 80), parent.generation, opts.depth, opts.tainted ? 1 : 0, level, t, t);
    list.forEach((it, i) => q.run("INSERT INTO batch_items (batch_id, idx, title, goal) VALUES (?, ?, ?, ?)", id, i, it.title || `#${i + 1}`, clip(context ? `${it.goal}\n\nContext for the whole batch:\n${context}` : it.goal, 20_000)));
  });
  const b = batchById(id)!;
  const card = rows.append(parent, { kind: "card", card: cardOf(b) }, 0);
  q.run("UPDATE batches SET card_seq = ? WHERE id = ?", card.seq, id);
  audit(parent.userId, "tool", `${parent.name}: batch started — ${b.title} (${list.length} tasks)`, parent.id);
  pump(id);
  return batchById(id)!;
}

/** « Arrêter »: the tasks not started yet are cancelled, the ones at work stopped. What is done stays. */
export async function stopBatch(batchId: string): Promise<BatchRow | null> {
  const b = batchById(batchId);
  if (!b) return null;
  if (b.state !== "running") return b;
  setState(b.id, "stopped");
  q.run("UPDATE batch_items SET state = 'cancelled' WHERE batch_id = ? AND state = 'queued'", b.id);
  for (const it of itemsOf(b.id)) {
    const t = it.task_id ? bgTasks.byId(it.task_id) : null;
    if (!t || (t.state !== "running" && t.state !== "waiting")) continue;
    if (t.helperId) dropPendingWork(t.helperId); // its first turn may not have begun yet: it never will
    await stopTask(t);
  }
  const parent = bots.byId(b.bot_id);
  if (parent) audit(parent.userId, "tool", `${parent.name}: batch stopped — ${b.title}`, parent.id);
  const next = batchById(b.id)!;
  refresh(next);
  return next;
}

/** Stop / « Tout arrêter » on the bot (stopcommand.ts): its batches under way stop. Returns how many tasks were stopped or cancelled. */
export async function stopBatchesOf(botId: string): Promise<number> {
  let n = 0;
  for (const r of q.all<{ id: string }>("SELECT id FROM batches WHERE bot_id = ? AND state = 'running'", botId)) {
    n += itemsOf(r.id).filter((it) => it.state === "queued" || (it.task_id && ["running", "waiting"].includes(bgTasks.byId(it.task_id)?.state ?? ""))).length;
    await stopBatch(r.id);
  }
  return n;
}

/** What the batch has cost so far: every turn of its tasks' helpers (usage table), and how long it has run. */
export function batchCost(botId: string, batchId: string, nowMs = Date.now()): BatchCost | null {
  const b = batchById(batchId);
  if (!b || b.bot_id !== botId) return null;
  const u = q.get<{ c: number | null; e: number | null; n: number }>(
    "SELECT SUM(u.cost_usd) AS c, SUM(COALESCE(u.est_cost_usd, 0)) AS e, COUNT(*) AS n FROM usage u JOIN bg_tasks t ON t.helper_id = u.bot_id JOIN batch_items i ON i.task_id = t.id WHERE i.batch_id = ?", b.id);
  const endedAt = b.state === "running" ? null : b.updated_at;
  return { batchId: b.id, costUsd: u?.c ?? 0, estimatedUsd: u?.e ?? 0, turns: u?.n ?? 0, durationMs: Math.max(0, (endedAt ?? nowMs) - b.created_at), endedAt };
}

/** After a restart: batches under way go on (their queued tasks start when slots are free). */
export function resumeBatches(): void {
  for (const r of q.all<{ id: string }>("SELECT id FROM batches WHERE state = 'running'")) {
    try { pump(r.id); } catch (err) { console.error(`[batch ${r.id}]`, err); }
  }
}
setTimeout(() => { try { resumeBatches(); } catch (err) { console.error("[batches]", err); } }, 5000).unref();

// ── Routes (registered from stepdetail.ts) ──────────────────────────────────────────────────────────────────────────
export function registerBatchRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  const own = (c: { get(k: "user"): UserRecord; req: { param(k: string): string | undefined } }) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "") ?? fail(404, user.locale === "fr" ? "Ce bot n'existe pas." : "That bot does not exist.");
    const cost = batchCost(bot.id, c.req.param("batchId") ?? "");
    return cost ? { bot, cost } : fail(404, user.locale === "fr" ? "Ce lot n'existe pas." : "That batch does not exist.");
  };
  api.get("/bots/:id/batches/:batchId", (c) => c.json(own(c).cost, 200, { "cache-control": "no-store" }));
  api.post("/bots/:id/batches/:batchId/stop", async (c) => {
    const { cost } = own(c);
    const b = await stopBatch(cost.batchId);
    return c.json({ ok: true, state: b?.state ?? "stopped" });
  });
}

// ── Tools (wired into the built-in list by tools.ts, group "tasks") ────────────────────────────────────────────────
const str = (description: string) => ({ type: "string", description });
export const batchTools: BuiltinTool[] = [
  {
    spec: {
      name: "batch_start",
      description: `Launch a batch of ${MIN_BATCH_ITEMS} to ${MAX_BATCH_ITEMS} independent tasks that run in parallel (at most 3 at a time; one at a time on a subscription tool), e.g. one search per competitor, one check per page. Each task is done by a worker of yours in its own conversation; the user follows the whole batch on one card (each task's state, cost, Stop). When the last task ends you receive all the reports at once and write ONE summary. Use it only when the tasks do not depend on each other; for a single long job use task_start.`,
      inputSchema: {
        type: "object",
        properties: {
          title: str("A short title for the batch card (a few words)"),
          items: { type: "array", minItems: MIN_BATCH_ITEMS, maxItems: MAX_BATCH_ITEMS, description: "The tasks, each complete on its own", items: { type: "object", properties: { title: str("A few words"), goal: str("Everything this task needs: what to find or do, what its report must contain") }, required: ["title", "goal"] } },
          context: str("Optional: context shared by every task (the user's request, constraints, the report format)"),
          level: { type: "string", enum: ["light", "normal", "hard"], description: "Optional, for every task. light: simple, mechanical work (a cheaper model); hard: demanding reasoning; normal (default)" },
        },
        required: ["title", "items"],
      },
    },
    activity: "planning", label: "Starting a batch of tasks", audited: true, group: "tasks", detail: (a) => clip(String(a.title ?? ""), 60),
    run: async (a, c) => {
      try {
        const b = startBatch(c.bot, String(a.title ?? ""), Array.isArray(a.items) ? a.items : [], { depth: c.depth, tainted: c.tainted, level: a.level, context: a.context });
        return { content: JSON.stringify({ id: b.id, tasks: itemsOf(b.id).length, at_once: laneCap(c.bot.id), note: "Started. The user follows it on its card; you will receive every report at once when the last task ends. Tell the user in one line that you started it, then carry on." }), summary: b.title };
      } catch (err) { return { content: (err as Error).message, isError: true }; }
    },
  },
  {
    spec: { name: "batch_stop", description: "Stop one of your batches: the tasks not started are cancelled, the ones at work stopped. What is done stays on its card.", inputSchema: { type: "object", properties: { id: str("Batch id (bat_…)") }, required: ["id"] } },
    activity: "planning", label: "Stopping a batch", group: "tasks",
    run: async (a, c) => {
      const b = batchById(String(a.id ?? ""));
      if (!b || b.bot_id !== c.bot.id) return { content: "No batch of yours has that id.", isError: true };
      await stopBatch(b.id);
      return { content: "Stopped.", summary: b.title };
    },
  },
];
