/**
 * Routines, nod items 2, 8, 13 — the routes (routineplus.ts holds the logic). Behind the session; another account's
 * routine or bot answers 404.
 *
 *   GET  /routines/:id/extras            { revision, editedAt, model, effectiveModel, approval, track: [{ runId, dueAt, startedAt, missed, lateMs, byHand, line }] }
 *   PUT  /routines/:id                   { name?, prompt?, schedule?, timezone?, runAt?, model?, revision? } → only the changed fields are saved
 *   POST /routines/:id/approve           { scope: { targets[], maxRunsPerDay?, until? } } → the whole instruction, approved
 *   DELETE /routines/:id/approve         the approval is withdrawn (its rule removed)
 *   POST /bots/:id/routines/preview      { trigger?, schedule, timezone, runAt?, model?, routineId? } → { describe, next[], monthlyUsd } (nothing saved)
 *   GET  /bots/:id/routines/live         { live: [{ routineId, steps, caption, activity, since, awaiting }] }
 *   GET  /bots/:id/work-models           { routines, background, tasks } ("" = the bot's own model)
 *   PUT  /bots/:id/work-models           same fields, partial
 * "Run now" (routes.ts) calls runNowGuard first.
 */
import type { Context, Hono } from "hono";
import { emit } from "./bus.js";
import { bgTasks } from "./agent/bgtasks.js";
import { body, fail } from "./routeinput.js";
import { routines, runs, type RoutineRecord } from "./routines.js";
import {
  approveInstruction, cleanModelRef, cleanScope, editRoutine, lateLine, liveRoutines, previewRoutine, revokeApproval, RoutineEditError, routineExtras, runNowCheck, trackOf, tr, workModels,
} from "./routineplus.js";
import { schedule } from "./scheduler.js";
import { audit, bots, type BotRecord, type UserRecord } from "./store.js";
import { publicRoutine } from "./routines.js";
import { registerRoutineOptionRoutes } from "./routineoptions.js";
import { cleanParamValues } from "./clientshared/routineparams.js";
import { registerRoutineIcalRoutes } from "./routineical.js"; import { registerUsageDaily } from "./usagedaily.js";

type Env = { Variables: { user: UserRecord } };

const wrap = <T>(c: Context<Env>, fn: () => T): T => {
  try { return fn(); } catch (err) {
    if (err instanceof RoutineEditError) fail(err.status, tr(c.get("user").locale, err.message));
    throw err;
  }
};
const ownRoutine = (c: Context<Env>): RoutineRecord => routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, c.get("user").locale === "fr" ? "Cette routine n'existe pas." : "That routine does not exist.");
const ownBot = (c: Context<Env>): BotRecord => bots.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, c.get("user").locale === "fr" ? "Ce bot n'existe pas." : "That bot does not exist.");
const botOf = (r: RoutineRecord) => bots.byId(r.botId)!;

function trackFor(r: RoutineRecord, locale: UserRecord["locale"]) {
  return runs.list(r.id).map((run) => {
    const t = trackOf(run.id);
    return t ? { runId: run.id, ...t, line: t.dueAt ? lateLine(t.dueAt, t.startedAt, t.missed, r.timezone, locale) : "" } : null;
  }).filter(Boolean);
}

/** "Run now": refused on a routine changed after a failure unless the editor sends the revision it shows. */
export async function runNowGuard(c: Context<Env>, r: RoutineRecord): Promise<Record<string, string>> {
  const b = await body(c);
  const revision = b.revision === undefined || b.revision === null ? undefined : Number(b.revision);
  wrap(c, () => runNowCheck(r, Number.isFinite(revision) ? revision : undefined));
  return cleanParamValues(b.params); // L143: the values typed in the run form (clientshared/routineparams.ts)
}

export function registerRoutinePlusRoutes(api: Hono<Env>) {
  registerRoutineOptionRoutes(api); // L54 / L86 / L183 options (routineoptions.ts)
  registerRoutineIcalRoutes(api); registerUsageDaily(api); // L143: the calendar feed's link (routineical.ts); L142: 30 days of spending (usagedaily.ts)
  api.get("/routines/:id/extras", (c) => {
    const r = ownRoutine(c);
    return c.json({ ...routineExtras(r, botOf(r)), track: trackFor(r, c.get("user").locale) });
  });

  api.put("/routines/:id", async (c) => {
    const r = ownRoutine(c);
    const b = await body(c);
    const str = (v: unknown) => (typeof v === "string" ? v : undefined);
    const runAt = b.runAt === undefined ? undefined : b.runAt === null ? null : Number(b.runAt);
    const revision = b.revision === undefined ? undefined : Number(b.revision);
    const out = wrap(c, () => editRoutine(r, { name: str(b.name), prompt: str(b.prompt), schedule: str(b.schedule), timezone: str(b.timezone), runAt: runAt === undefined || runAt === null || Number.isFinite(runAt) ? runAt : undefined, model: str(b.model) }, Number.isFinite(revision) ? revision : undefined));
    if (out.changed.length) {
      schedule(r.id);
      audit(c.get("user").id, "routine", `${r.name}: routine edited (${out.changed.join(", ")})`, r.botId);
      emit(c.get("user").id, { type: "routines", botId: r.botId });
    }
    return c.json({ routine: publicRoutine(out.routine, c.get("user").locale), changed: out.changed, ...routineExtras(out.routine, botOf(out.routine)) });
  });

  api.post("/routines/:id/approve", async (c) => {
    const r = ownRoutine(c);
    const raw = (await body(c)).scope;
    const scope = wrap(c, () => cleanScope(raw));
    const approval = approveInstruction(c.get("user").id, r, scope, c.get("user").locale);
    audit(c.get("user").id, "routine", `${r.name}: whole instruction approved for ${scope.targets.join(", ")}`, r.botId);
    emit(c.get("user").id, { type: "rules" });
    return c.json({ approval });
  });

  api.delete("/routines/:id/approve", (c) => {
    const r = ownRoutine(c);
    revokeApproval(r);
    audit(c.get("user").id, "routine", `${r.name}: approval of the instruction withdrawn`, r.botId);
    emit(c.get("user").id, { type: "rules" });
    return c.json({ approval: routineExtras(r, botOf(r)).approval });
  });

  api.post("/bots/:id/routines/preview", async (c) => {
    const bot = ownBot(c);
    const b = await body(c);
    if (b.routineId && !routines.owned(c.get("user").id, String(b.routineId))) fail(404, "That routine does not exist.");
    return c.json(wrap(c, () => previewRoutine(bot, { trigger: b.trigger, schedule: b.schedule, timezone: b.timezone, runAt: b.runAt ? Number(b.runAt) : null, model: b.model, routineId: b.routineId }, c.get("user").locale)));
  });

  api.get("/bots/:id/routines/live", (c) => c.json({ live: liveRoutines(ownBot(c).id) }, 200, { "cache-control": "no-store" }));

  // A background task's own model (nod: a model per task): its worker's next turns use it.
  api.put("/bots/:id/bgtasks/:taskId/model", async (c) => {
    const bot = ownBot(c);
    const t = bgTasks.byId(c.req.param("taskId") ?? "");
    if (!t || t.botId !== bot.id || !t.helperId) fail(404, "That task does not exist.");
    const b = await body(c);
    const model = wrap(c, () => cleanModelRef(b.model)) || bot.model;
    bots.patch(t!.helperId!, { model });
    audit(c.get("user").id, "tool", `${bot.name}: background task model set to ${model} — ${t!.title}`, bot.id);
    return c.json({ taskId: t!.id, model });
  });

  api.get("/bots/:id/work-models", (c) => c.json(workModels.get(ownBot(c).id)));
  api.put("/bots/:id/work-models", async (c) => {
    const bot = ownBot(c);
    const b = await body(c);
    const next = wrap(c, () => workModels.set(bot.id, { routines: b.routines, background: b.background, tasks: b.tasks }));
    audit(c.get("user").id, "account", `${bot.name}: models per kind of work changed`, bot.id);
    return c.json(next);
  });
}
