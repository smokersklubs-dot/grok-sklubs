import type { Context, Hono } from "hono";
import { submitUserMessage } from "./agent/loop.js";
import { findSecrets } from "./shared.js";
import { bots, clip, rows, type BotRecord, type UserRecord } from "./store.js";
import { ct } from "./chantieri18n.js";
import { chantiers, lessons, summaryOf, viewOf } from "./chantiers.js";
import { planChantier } from "./chantierplanner.js";
import { answerDecision, approveChantier, ChantierError, chantierAsk, nudgeTask, readiness, resumeChantiers, saveDraft, stopChantier } from "./chantierrunner.js";
import { DECISION_ANSWERS, type DecisionAnswer } from "./chantiertypes.js";

/**
 * « Chantier » — the routes (behind the session like every /api route). Only the owner of a chantier sees or touches
 * it: another account's chantier reads as missing (404), and every bot named in a plan must be the caller's own.
 *
 *  GET   /chantiers                          the caller's chantiers (summary) and how many cards wait for them
 *  POST  /chantiers { title, brief, plannerBotId }   creates it; the planner turn runs, the plan comes back as a proposal
 *  GET   /chantiers/:id                      the page: plan, tasks, attempts, failure reports, cards, lessons, metrics
 *  PUT   /chantiers/:id/plan { plan }        saves the owner's edits (still a proposal); answers the problems left
 *  POST  /chantiers/:id/approve { plan? }    approves and starts (400 with the problems while there are any)
 *  POST  /chantiers/:id/replan               asks the planner again (proposal only)
 *  POST  /chantiers/:id/stop                 stops every task; everything done is kept
 *  POST  /chantiers/:id/decisions/:did { answer, note? }   the owner's answer on a card
 *  POST  /chantiers/:id/tasks/:key/nudge { kind: continue | restate, reason, text? }
 *  GET   /chantier-lessons                   the caller's lessons (all, retired too)
 *  PATCH /chantier-lessons/:id { rule?, appliesTo?, status? }
 */
type Env = { Variables: { user: UserRecord } };
const err = (c: Context, status: 400 | 404 | 409, error: string, extra: Record<string, unknown> = {}) => c.json({ error, ...extra }, status);
const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;

function guard(c: Context<Env>, fn: () => Response | Promise<Response>) {
  return Promise.resolve().then(fn).catch((e) => {
    if (e instanceof ChantierError) return err(c, e.status, ct(c.get("user").locale, e.message));
    throw e;
  });
}

function startPlanning(id: string) {
  const c = chantiers.byId(id);
  if (!c) return;
  void planChantier(c, chantierAsk()).catch((e) => {
    console.error("[chantier planner]", e);
    chantiers.set(id, { status: "proposed", note: String((e as Error).message ?? e) });
  });
}

let resumed = false;

export function registerChantierRoutes(api: Hono<Env>) {
  // After a restart, the chantiers under way go on (once, a moment after the bot queues were recovered).
  if (!resumed && process.env.NO_SCHEDULER !== "1") { resumed = true; setTimeout(() => { try { resumeChantiers(); } catch (e) { console.error("[chantier resume]", e); } }, 5000).unref?.(); }

  api.get("/chantiers", (c) => {
    const list = chantiers.list(c.get("user").id).map(summaryOf);
    return c.json({ chantiers: list, pending: list.reduce((n, x) => n + x.openDecisions + (x.status === "proposed" ? 1 : 0), 0) });
  });

  api.post("/chantiers", async (c) => {
    const user = c.get("user");
    const b = await body(c);
    const brief = String(b.brief ?? "").trim();
    const title = String(b.title ?? "").trim() || clip(brief.split("\n")[0] ?? "", 80);
    if (!brief) return err(c, 400, ct(user.locale, "Describe what you want built."));
    if (brief.length > 20_000) return err(c, 400, ct(user.locale, "That description is too long."));
    if (findSecrets(brief).length) return err(c, 400, ct(user.locale, "Do not paste a secret here: put it in the vault."));
    const planner = bots.owned(user.id, String(b.plannerBotId ?? ""));
    if (!planner || planner.kind !== "agent" || planner.hidden) return err(c, 400, ct(user.locale, "Choose one of your bots to plan it."));
    const ch = chantiers.create(user.id, { title, brief, plannerBotId: planner.id });
    startPlanning(ch.id);
    return c.json(viewOf(chantiers.byId(ch.id)!));
  });

  api.get("/chantiers/:id", (c) => {
    const user = c.get("user");
    const ch = chantiers.owned(user.id, c.req.param("id"));
    if (!ch) return err(c, 404, ct(c.get("user").locale, "That chantier does not exist."));
    const problems = ch.status === "proposed" && ch.plan ? readiness(ch.plan, user.id, user.locale).problems : [];
    return c.json({ ...viewOf(ch), problems });
  });

  api.put("/chantiers/:id/plan", (c) => guard(c, async () => {
    const user = c.get("user");
    const problems = saveDraft(user.id, c.req.param("id"), (await body(c)).plan);
    return c.json({ ...viewOf(chantiers.byId(c.req.param("id"))!), problems });
  }));

  api.post("/chantiers/:id/approve", (c) => guard(c, async () => {
    const user = c.get("user");
    const b = await body(c);
    const problems = approveChantier(user.id, c.req.param("id"), b.plan);
    if (problems.length) return err(c, 400, ct(user.locale, "The plan is not ready yet."), { problems });
    return c.json({ ...viewOf(chantiers.byId(c.req.param("id"))!), problems: [] });
  }));

  api.post("/chantiers/:id/replan", (c) => {
    const user = c.get("user");
    const ch = chantiers.owned(user.id, c.req.param("id"));
    if (!ch) return err(c, 404, ct(c.get("user").locale, "That chantier does not exist."));
    if (ch.status !== "proposed") return err(c, 409, ct(user.locale, "This chantier is not waiting for your approval."));
    chantiers.set(ch.id, { status: "planning", note: "" });
    startPlanning(ch.id);
    return c.json(viewOf(chantiers.byId(ch.id)!));
  });

  api.post("/chantiers/:id/stop", (c) => guard(c, () => {
    stopChantier(c.get("user").id, c.req.param("id"));
    return c.json(viewOf(chantiers.byId(c.req.param("id"))!));
  }));

  api.post("/chantiers/:id/decisions/:did", (c) => guard(c, async () => {
    if (!chantiers.owned(c.get("user").id, c.req.param("id"))) return err(c, 404, ct(c.get("user").locale, "That chantier does not exist."));
    const b = await body(c);
    const answer = String(b.answer ?? "") as DecisionAnswer;
    if (!(DECISION_ANSWERS as readonly string[]).includes(answer)) return err(c, 400, ct(c.get("user").locale, "That answer is not offered here."));
    answerDecision(c.get("user").id, c.req.param("id"), c.req.param("did"), answer, clip(String(b.note ?? "").trim(), 1000));
    return c.json(viewOf(chantiers.byId(c.req.param("id"))!));
  }));

  api.post("/chantiers/:id/tasks/:key/nudge", (c) => guard(c, async () => {
    const user = c.get("user");
    if (!chantiers.owned(user.id, c.req.param("id"))) return err(c, 404, ct(user.locale, "That chantier does not exist."));
    const b = await body(c);
    const kind = b.kind === "restate" ? "restate" : b.kind === "continue" ? "continue" : null;
    if (!kind) return err(c, 400, ct(c.get("user").locale, "kind must be continue or restate."));
    const text = String(b.text ?? "").slice(0, 20_000);
    if (findSecrets(text).length) return err(c, 400, ct(user.locale, "Do not paste a secret here: put it in the vault."));
    // The owner's words go into the task's thread as their own message, the ordinary way (every gate applies).
    const send = (bot: BotRecord, words: string, thread: number) => { rows.append(bot, { kind: "message", role: "user", text: words }, thread); submitUserMessage(bot, words, false, [], undefined, thread); };
    nudgeTask(user.id, c.req.param("id"), c.req.param("key"), kind, String(b.reason ?? ""), text, send);
    return c.json(viewOf(chantiers.byId(c.req.param("id"))!));
  }));

  api.get("/chantier-lessons", (c) => c.json({ lessons: lessons.of(c.get("user").id, true) }));

  api.patch("/chantier-lessons/:id", async (c) => {
    const b = await body(c);
    const status = b.status === "retired" ? "retired" : b.status === "active" ? "active" : undefined;
    const l = lessons.edit(c.get("user").id, c.req.param("id"), { rule: typeof b.rule === "string" ? b.rule : undefined, appliesTo: typeof b.appliesTo === "string" ? b.appliesTo : undefined, status });
    return l ? c.json({ lesson: l }) : err(c, 404, ct(c.get("user").locale, "That lesson does not exist."));
  });
}
