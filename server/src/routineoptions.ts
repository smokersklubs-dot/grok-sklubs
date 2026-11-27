/**
 * Wave 6 — three per-routine options, kept in a side table (nothing stored in `routines` changes; a routine without a
 * row has the defaults, which is how every existing routine behaved before):
 *
 * - `announce` (L54): "thread" (default, owner decision 22/11/2026: the run works in its own thread, only its result
 *   reaches the chat) or "chat" (the run works in the main chat, « dans la discussion »).
 * - `condition` (L86): a plain-language condition ("only if the price drops under 50 €"). When what the routine waits for
 *   changes (a watched page or file, a new email or message, a webhook), a small model reads the new item and answers
 *   yes / no before the bot is woken (agent/routinecondition.ts). Empty: no check.
 * - `heavy` (L183): heavy work paced by the subscription's quota — while the bot's subscription is at its limit, a due
 *   run waits for the reset instead of spending the backup model or waiting in the queue (routinepacing.ts).
 *
 *   GET /routines/:id/options   → { announce, condition, heavy }
 *   PUT /routines/:id/options   { announce?, condition?, heavy? } → same
 */
import type { Context, Hono } from "hono"; import { tr } from "./i18n.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { body, fail } from "./routeinput.js";
import { routines } from "./routines.js";
import { audit, type UserRecord } from "./store.js";
import type { BuiltinTool } from "./agent/tools.js";

q.run("CREATE TABLE IF NOT EXISTS routine_options (routine_id TEXT PRIMARY KEY, announce TEXT NOT NULL DEFAULT 'thread', condition TEXT NOT NULL DEFAULT '', heavy INTEGER NOT NULL DEFAULT 0)");

export type Announce = "thread" | "chat";
export interface RoutineOptions { announce: Announce; condition: string; heavy: boolean }
export const CONDITION_MAX = 500;

export function routineOptions(routineId: string): RoutineOptions {
  const r = q.get<{ announce: string; condition: string; heavy: number }>("SELECT announce, condition, heavy FROM routine_options WHERE routine_id = ?", routineId);
  return { announce: r?.announce === "chat" ? "chat" : "thread", condition: r?.condition ?? "", heavy: !!r?.heavy };
}

/** Changes the options given; returns the new ones. */
export function setRoutineOptions(routineId: string, patch: Partial<RoutineOptions>): RoutineOptions {
  const cur = routineOptions(routineId);
  const next: RoutineOptions = {
    announce: patch.announce === "chat" || patch.announce === "thread" ? patch.announce : cur.announce,
    condition: typeof patch.condition === "string" ? patch.condition.replace(/\s+/g, " ").trim().slice(0, CONDITION_MAX) : cur.condition,
    heavy: typeof patch.heavy === "boolean" ? patch.heavy : cur.heavy,
  };
  q.run("INSERT INTO routine_options (routine_id, announce, condition, heavy) VALUES (?, ?, ?, ?) ON CONFLICT(routine_id) DO UPDATE SET announce = excluded.announce, condition = excluded.condition, heavy = excluded.heavy",
    routineId, next.announce, next.condition, next.heavy ? 1 : 0);
  return next;
}

/** The announce option of the routine a run belongs to. */
export function announceOfRun(runId: string): Announce {
  const r = q.get<{ routine_id: string }>("SELECT routine_id FROM routine_runs WHERE id = ?", runId);
  return r ? routineOptions(r.routine_id).announce : "thread";
}

type Env = { Variables: { user: UserRecord } };

export function registerRoutineOptionRoutes(api: Hono<Env>) {
  const own = (c: Context<Env>) => routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, tr(c.get("user").locale, "That routine does not exist."));
  api.get("/routines/:id/options", (c) => c.json(routineOptions(own(c).id)));
  api.put("/routines/:id/options", async (c) => {
    const r = own(c);
    const b = await body(c);
    if (b.announce !== undefined && b.announce !== "chat" && b.announce !== "thread") fail(400, tr(c.get("user").locale, "Unknown announce choice."));
    const next = setRoutineOptions(r.id, { announce: b.announce as Announce | undefined, condition: typeof b.condition === "string" ? b.condition : undefined, heavy: typeof b.heavy === "boolean" ? b.heavy : undefined });
    audit(c.get("user").id, "routine", `${r.name}: options changed (announce ${next.announce}, condition ${next.condition ? "set" : "none"}, heavy ${next.heavy ? "yes" : "no"})`, r.botId);
    emit(c.get("user").id, { type: "routines", botId: r.botId });
    return c.json(next);
  });
}

/** The bot sets the same options (only on its own routines, never from a routine's own run). */
export const routineOptionTools: BuiltinTool[] = [{
  spec: {
    name: "routine_options",
    description: "Set options of one of your routines. announce: \"thread\" (default: the run works in its own thread, only its result reaches the chat) or \"chat\" (the run works in the main chat). condition: a plain-language condition checked by a small model on each new item before you are woken (empty to remove), e.g. \"only if the price is under 50 €\". heavy: true for heavy work that should wait for the subscription's quota window instead of running while it is at its limit.",
    inputSchema: { type: "object", properties: { id: { type: "string", description: "Routine id" }, announce: { type: "string", enum: ["thread", "chat"] }, condition: { type: "string", description: "Plain-language condition, or empty" }, heavy: { type: "boolean" } }, required: ["id"] },
  },
  activity: "planning", label: "Updating a routine", group: "routines",
  run: async (a, c) => {
    if (c.origin === "routine") return { content: "A routine cannot change routines. Tell the user what you would change.", isError: true };
    const r = routines.byId(String(a.id));
    if (!r || r.botId !== c.bot.id) return { content: "No routine of yours has that id.", isError: true };
    const next = setRoutineOptions(r.id, { announce: a.announce as Announce | undefined, condition: typeof a.condition === "string" ? a.condition : undefined, heavy: typeof a.heavy === "boolean" ? a.heavy : undefined });
    emit(c.user.id, { type: "routines", botId: c.bot.id });
    return { content: JSON.stringify(next), summary: r.name };
  },
}];
