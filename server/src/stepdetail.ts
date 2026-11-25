/**
 * L142, the last two parts of « d'un coup d'œil, qui fait quoi et combien ça coûte »:
 *  - « coût sur la carte d'une tâche »: what a background task has cost so far and how long it has run. Every
 *    background task has its own hidden helper bot (agent/bgtasks.ts startTask), so its spend is exactly the usage lines
 *    of that helper (known prices apart from the conservative estimate of unknown ones, as Settings → Usage counts).
 *  - « détail complet d'une étape »: one step of the chat in full — its tool, every argument, the whole result the bot
 *    read back (from the model-facing history, by the call's id), when it started and roughly how long it took, and the
 *    journal line of that call: what allowed it (the owner's words, a card, a rule…) and what the model spent before it.
 * Read-only, owner only (bots.owned): a step's result can hold the owner's data. Known vault values are removed
 * (redactSecrets) before anything is answered. Routes: GET /bots/:id/bgtasks/:taskId/cost, GET /bots/:id/steps/:seq.
 */
import type { Hono } from "hono";
import { bgTasks } from "./agent/bgtasks.js";
import { q } from "./db.js";
import { fail } from "./routeinput.js";
import { bots, clip, redactSecrets, rows, type UserRecord } from "./store.js";
import { registerSelfCheckRoutes } from "./selfcheck.js";
import { registerBatchRoutes } from "./agent/batches.js";

export interface TaskCost { taskId: string; costUsd: number; estimatedUsd: number; turns: number; inputTokens: number; outputTokens: number; startedAt: number; endedAt: number | null; durationMs: number }

/** A background task's spend and time so far (null: no such task of this bot). */
export function taskCost(botId: string, taskId: string, nowMs = Date.now()): TaskCost | null {
  const t = bgTasks.byId(taskId);
  if (!t || t.botId !== botId) return null;
  const u = t.helperId
    ? q.get<{ c: number | null; e: number | null; n: number; i: number | null; o: number | null }>("SELECT SUM(cost_usd) AS c, SUM(COALESCE(est_cost_usd, 0)) AS e, COUNT(*) AS n, SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM usage WHERE bot_id = ?", t.helperId)
    : null;
  const finished = t.state === "done" || t.state === "failed" || t.state === "stopped";
  const endedAt = finished ? t.updatedAt : null;
  return {
    taskId: t.id, costUsd: u?.c ?? 0, estimatedUsd: u?.e ?? 0, turns: u?.n ?? 0, inputTokens: u?.i ?? 0, outputTokens: u?.o ?? 0,
    startedAt: t.createdAt, endedAt, durationMs: Math.max(0, (endedAt ?? nowMs) - t.createdAt),
  };
}

/** Longest result text answered (characters): enough for a page of output, never a whole file dump. */
export const STEP_RESULT_MAX = 20_000;

export interface StepDetail {
  seq: number; tool: string; label: string; status: string; args: Record<string, unknown>; summary: string;
  startedAt: number; endedAt: number | null; durationMs: number | null;
  result: { text: string; truncated: boolean; isError: boolean; images: number } | null;
  journal: { decision: string; reason: string; quote: string; costUsd: number; status: string } | null;
}

/** The whole result of one tool call from the bot's history (its tool_result block, by the call's id). */
function resultOf(botId: string, generation: number, callId: string): StepDetail["result"] {
  if (!callId) return null;
  const like = `%${callId.replace(/[%_\\]/g, (ch) => `\\${ch}`)}%`;
  for (const h of q.all<{ content: string }>("SELECT content FROM history WHERE bot_id = ? AND generation = ? AND content LIKE ? ESCAPE '\\' ORDER BY id", botId, generation, like)) {
    let blocks: unknown;
    try { blocks = JSON.parse(h.content); } catch { continue; }
    if (!Array.isArray(blocks)) continue;
    for (const b of blocks as { type?: string; toolUseId?: string; content?: { type?: string; text?: string }[]; isError?: boolean }[]) {
      if (b?.type !== "tool_result" || b.toolUseId !== callId) continue;
      const parts = Array.isArray(b.content) ? b.content : [];
      const text = parts.filter((p) => p?.type === "text").map((p) => String(p.text ?? "")).join("\n");
      return { text: text.length > STEP_RESULT_MAX ? text.slice(0, STEP_RESULT_MAX) : text, truncated: text.length > STEP_RESULT_MAX, isError: b.isError === true, images: parts.filter((p) => p?.type === "image").length };
    }
  }
  return null;
}

/** One step of a conversation in full (null: not a step of this bot). `generation`: the conversation (default: current). */
export function stepDetail(bot: { id: string; userId: string; generation: number }, seq: number, generation = bot.generation): StepDetail | null {
  const row = rows.get(bot.id, generation, seq);
  if (!row || row.body.kind !== "step") return null;
  const b = row.body;
  const thread = row.thread ?? 0;
  const next = q.get<{ at: number }>("SELECT created_at AS at FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND seq > ? ORDER BY seq LIMIT 1", bot.id, generation, thread, seq);
  const endedAt = b.status === "running" || b.status === "waiting" ? null : next?.at ?? null;
  // The journal line of this call: the first one of the same tool written from the step's start on (lines are added when
  // the call is decided, a few milliseconds after its step row).
  const j = q.get<{ decision: string; reason: string; quote: string; cost_usd: number; status: string }>(
    "SELECT decision, reason, quote, cost_usd, status FROM action_journal WHERE user_id = ? AND bot_id = ? AND tool = ? AND at >= ? AND at <= ? ORDER BY at, id LIMIT 1",
    bot.userId, bot.id, b.tool, row.createdAt - 1000, (endedAt ?? Date.now()) + 1000);
  const safe = (s: string) => redactSecrets(bot.userId, s);
  let args: Record<string, unknown> = {};
  try { args = JSON.parse(safe(JSON.stringify(b.args ?? {}))); } catch { args = {}; }
  const result = resultOf(bot.id, generation, b.callId);
  return {
    seq, tool: b.tool, label: b.label, status: b.status, args, summary: safe(b.summary ?? ""),
    startedAt: row.createdAt, endedAt, durationMs: endedAt === null ? null : Math.max(0, endedAt - row.createdAt),
    result: result ? { ...result, text: safe(result.text) } : null,
    journal: j ? { decision: j.decision, reason: clip(j.reason, 300), quote: clip(j.quote, 400), costUsd: j.cost_usd, status: j.status } : null,
  };
}

export function registerStepDetailRoutes(api: Hono<{ Variables: { user: UserRecord } }>) {
  registerSelfCheckRoutes(api); // L153 « Vérifier ce bot » (selfcheck.ts)
  registerBatchRoutes(api); // L99 « lots en parallèle » (agent/batches.ts)
  const own = (userId: string, id: string, fr: boolean) => bots.owned(userId, id) ?? fail(404, fr ? "Ce bot n'existe pas." : "That bot does not exist.");
  api.get("/bots/:id/bgtasks/:taskId/cost", (c) => {
    const user = c.get("user");
    const bot = own(user.id, c.req.param("id") ?? "", user.locale === "fr");
    const cost = taskCost(bot.id, c.req.param("taskId") ?? "");
    return cost ? c.json(cost, 200, { "cache-control": "no-store" }) : fail(404, user.locale === "fr" ? "Cette tâche n'existe pas." : "That task does not exist.");
  });
  api.get("/bots/:id/steps/:seq", (c) => {
    const user = c.get("user");
    const bot = own(user.id, c.req.param("id") ?? "", user.locale === "fr");
    const g = Number(c.req.query("generation"));
    const detail = stepDetail(bot, Number(c.req.param("seq")), Number.isInteger(g) && g > 0 ? g : bot.generation);
    return detail ? c.json(detail, 200, { "cache-control": "no-store" }) : fail(404, user.locale === "fr" ? "Cette étape n'existe pas." : "That step does not exist.");
  });
}
