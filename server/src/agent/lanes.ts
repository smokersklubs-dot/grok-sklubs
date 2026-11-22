/**
 * Several tasks at once per bot (owner decision 22/11/2026: "jusqu'à 3 tâches en même temps par bot", backlog L99).
 *
 * A bot used to have one queue: a routine, a teammate's request or a background job held the owner's own chat until it
 * ended. Now each piece of work runs in a LANE, keyed by the conversation thread it answers in:
 *   - lane "0": the main chat (the owner's messages, and the short system follow-ups that belong there);
 *   - a routine run: its own thread (routinethread.ts) — lane "r:<run>" until the thread exists, then that thread;
 *   - a teammate's request, a helper's report: the thread under its message in the main chat (team.ts);
 *   - a side thread the owner opened, a goal in a thread: that thread.
 * Work of one lane runs in order, one turn at a time (one thread's history is never written by two turns). Different
 * lanes run side by side, at most `laneCap` of them; the main chat's lane never waits for a free slot: the other lanes
 * share the slots that are left (cap 3: the main chat + 2 others; a 4th task waits for one of them to end).
 *
 * One task at a time (cap 1, exactly the old single queue, in order) where running several cannot work or is not
 * included: a bot on a subscription tool (Claude Code, Codex keep one session per bot on its computer), a hosted
 * account on a plan of kind "free", or BOT_PARALLEL_TASKS=1 on the server (default 3, at most 3).
 *
 * The idea of a per-bot thread limit, with a smaller one on the entry plan, comes from OpenMausBot
 * (server/bot-thread-limits.ts, Apache-2.0); the scheduler below is Sklubot's own (see THIRD_PARTY_NOTICES.md).
 * Shared resources (the screen, a file) are guarded per lane in turnlocks.ts.
 */
import { setLiveLane } from "../bus.js";
import { bots, laneKey, newId, rowScope, type QueuedWork } from "../store.js";
import { accessOf, hostedMode } from "../hosted.js";
import { isEngineRef } from "./engine.js";
import type { Trigger } from "./turn-request.js";

export const MAX_PARALLEL_TASKS = 3;
export const MAIN_LANE = "0";

/** How many tasks this bot may run at once (1 to 3). */
export function laneCap(botId: string): number {
  const bot = bots.byId(botId);
  if (!bot || bot.kind !== "agent" || isEngineRef(bot.model)) return 1;
  const env = Math.floor(Number(process.env.BOT_PARALLEL_TASKS ?? MAX_PARALLEL_TASKS));
  const server = Number.isFinite(env) ? Math.min(MAX_PARALLEL_TASKS, Math.max(1, env)) : MAX_PARALLEL_TASKS;
  if (hostedMode()) {
    const a = accessOf(bot.userId);
    if (!a.operator && a.plan?.kind === "free") return 1;
  }
  return server;
}

interface Job { lane: string; start: () => void }
interface BotLanes { waiting: Job[]; running: Map<string, number> }
const perBot = new Map<string, BotLanes>();
/** A routine's lane "r:<run>" once its thread exists: work for that thread joins the same lane (in memory only). */
const aliases = new Map<string, string>();
const laneOfTrigger = new WeakMap<Trigger, string>();

const stateOf = (botId: string): BotLanes => {
  let s = perBot.get(botId);
  if (!s) { s = { waiting: [], running: new Map() }; perBot.set(botId, s); }
  return s;
};

/** The lane a piece of work goes to (see the top of this file). */
export function laneOf(botId: string, trigger: Trigger): string {
  const known = laneOfTrigger.get(trigger);
  if (known) return known;
  let lane: string;
  if (trigger.kind === "routine" && !trigger.thread && !trigger.continuation) lane = `r:${trigger.runId ?? newId("run")}`;
  else {
    const thread = trigger.kind === "resume" || trigger.kind === "bot" || trigger.kind === "user" || trigger.kind === "system" || trigger.kind === "routine" ? trigger.thread ?? 0 : 0;
    lane = threadLane(botId, thread);
  }
  laneOfTrigger.set(trigger, lane);
  return lane;
}

/** The lane of the work that answers in this thread now. */
export const threadLane = (botId: string, thread: number) => (thread ? aliases.get(laneKey(botId, thread)) ?? String(thread) : MAIN_LANE);

/** The thread a queue row works in (0: the main chat), from its stored trigger. */
export function rowThread(row: Pick<QueuedWork, "trigger">): number {
  try { const t = JSON.parse(row.trigger) as { thread?: unknown }; return typeof t.thread === "number" ? t.thread : 0; } catch { return 0; }
}

// Live state (bus.ts) is kept per lane: the lane of a call is the thread of the turn it runs in.
setLiveLane((botId) => { const s = rowScope.getStore(); return s && s.botId === botId ? s.thread : null; });

/** A routine's thread was just opened (loop.ts runTurn): later work for that thread waits behind the run. */
export function aliasLane(botId: string, thread: number, trigger: Trigger) {
  const lane = laneOfTrigger.get(trigger);
  if (thread && lane && lane !== String(thread)) aliases.set(laneKey(botId, thread), lane);
}

function dispatch(botId: string) {
  const s = perBot.get(botId);
  if (!s) return;
  const cap = laneCap(botId);
  const blocked = new Set<string>();
  for (let i = 0; i < s.waiting.length;) {
    const job = s.waiting[i];
    const others = [...s.running.keys()].filter((l) => l !== MAIN_LANE).length;
    const fits = cap <= 1 ? s.running.size === 0 : job.lane === MAIN_LANE || others < cap - 1;
    if (blocked.has(job.lane) || s.running.has(job.lane) || !fits) {
      if (cap <= 1) break; // one at a time: strictly in order, as the single queue always did
      blocked.add(job.lane); i++; continue;
    }
    s.waiting.splice(i, 1);
    s.running.set(job.lane, Date.now());
    job.start();
  }
  if (!s.waiting.length && !s.running.size) perBot.delete(botId);
}

/**
 * Runs a job in its lane, after the work already queued in that lane, as soon as a slot is free. Jobs for different
 * bots run side by side, as before. The job starts outside any turn's context (a job queued from inside a turn of the
 * same bot must not inherit that turn's lane).
 */
export function schedule<T>(botId: string, lane: string, job: () => Promise<T>): Promise<T> {
  const s = stateOf(botId);
  return new Promise<T>((resolve, reject) => {
    s.waiting.push({
      lane,
      start: () => rowScope.exit(() => {
        void Promise.resolve().then(job).then(resolve, reject).finally(() => {
          s.running.delete(lane);
          if (!s.waiting.some((j) => j.lane === lane)) for (const [k, v] of aliases) if (v === lane && k.startsWith(`${botId}~`)) aliases.delete(k);
          if (perBot.get(botId) !== s && (s.waiting.length || s.running.size)) perBot.set(botId, s);
          dispatch(botId);
        });
      }),
    });
    dispatch(botId);
  });
}

/** Whether the bot has any work queued or running, in any lane. */
export const laneBusy = (botId: string) => { const s = perBot.get(botId); return !!s && (s.waiting.length > 0 || s.running.size > 0); };
/** Work queued for this bot that has not started yet (all lanes). */
export const laneWaiting = (botId: string) => perBot.get(botId)?.waiting.length ?? 0;
/** The lanes running now, oldest first. */
export const lanesRunning = (botId: string): string[] => [...(perBot.get(botId)?.running.entries() ?? [])].sort((a, b) => a[1] - b[1]).map(([l]) => l);
/** Tests only: forget every lane. */
export function resetLanes() { perBot.clear(); aliases.clear(); }
