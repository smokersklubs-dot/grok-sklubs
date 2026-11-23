/**
 * Routes of wave 7 (behind the session unless said): the work board (workboardroutes.ts), recorded flows (flows.ts),
 * automations (automations.ts), team memory (teammemory.ts), the memory controls (agent/memorykeep.ts) and the work
 * lessons (agent/worklessons.ts). Every route answers 404 for another account's thing.
 *
 * Flows (L165)
 *  GET    /flows                               { flows, recording: { [botId]: flowId } }
 *  POST   /flows/record { botId, name }        starts recording (one per bot)
 *  POST   /flows/:id/stop                      stops recording
 *  PATCH  /flows/:id { name?, expectText?: { step, text }, removeStep? }
 *  DELETE /flows/:id
 *  GET    /flows/:id/runs                      the last 10 runs with their evidence
 *  POST   /flows/:id/replay                    a replay now (no model call)
 *  POST   /flow-runs/:rid/approve { step }     allows the one committing step this run waits on
 *  POST   /flow-runs/:rid/stop
 *  GET    /flow-runs/:rid/shots/:n             a step's screenshot
 * Automations (L173)
 *  GET    /routines/:id/automation · PUT /routines/:id/automation { mode, target, afterRoutineId, afterWhen }
 *  GET    /triggers · POST /triggers { event, subject?, action, target, botId } · PATCH /triggers/:id { enabled } · DELETE · POST /triggers/:id/test
 * Team memory (L171)
 *  GET    /team-memory/:kind/:id               notes of a workspace or project (kind: workspace | section)
 *  POST   /team-memory/:kind/:id { text, links? } · PATCH /team-notes/:nid { text?, status?, links? } · DELETE /team-notes/:nid
 *  GET/POST /team-memory/workspace/:id/guests · DELETE /team-memory/workspace/:id/guests/:gid
 *  GET/PUT /bots/:id/team-memory { on }        the bot receives its workspace's notes (off by default)
 *  PUBLIC: GET /team-guest/:token · POST /team-guest/:token { text }   (registerTeamGuestPublic, before the session)
 * Memory (L66) and work lessons (L70)
 *  PUT    /bots/:id/rows/:seq/no-memory { on }  « Ne pas retenir ce message » (the owner's own message only)
 *  GET    /work-lessons · GET /work-lessons/week · POST /work-lessons/proposals/:key { accept }
 */
import type { Context, Hono } from "hono";
import { typedByUser } from "./agent/grounding.js";
import { memoryKeep } from "./agent/memorykeep.js";
import { answerProposal, LessonError, weekReview, workLessons } from "./agent/worklessons.js";
import { AutomationError, automationOf, setRoutineAutomation, triggers } from "./automations.js";
import { approveStep, FlowError, flows, startReplay, stopRun } from "./flows.js";
import { routines } from "./routines.js";
import { bots, rows, type UserRecord } from "./store.js";
import { cleanScope, guests, teamMemoryBots, TeamMemoryError, teamNotes } from "./teammemory.js";
import { registerBoardRoutes } from "./workboardroutes.js";
import { startBoard } from "./workboard.js";
import { wt } from "./worki18n.js";

type Env = { Variables: { user: UserRecord } };
const body = async (c: Context) => ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, any>;
const KNOWN = [FlowError, AutomationError, TeamMemoryError, LessonError];
function guard(c: Context<Env>, fn: () => Response | Promise<Response>) {
  return Promise.resolve().then(fn).catch((e) => {
    if (KNOWN.some((K) => e instanceof K)) return c.json({ error: wt(c.get("user")?.locale, e.message, (e as FlowError).vars ?? {}) }, e.status);
    throw e;
  });
}

export function registerWorkRoutes(api: Hono<Env>) {
  registerBoardRoutes(api);
  startBoard();
  const uid = (c: Context<Env>) => c.get("user").id;
  const ownBot = (c: Context<Env>) => { const b = bots.owned(uid(c), c.req.param("id") ?? ""); if (!b) throw new FlowError(404, "That bot is not one of yours."); return b; };

  // ── Flows ──
  api.get("/flows", (c) => guard(c, () => {
    const list = flows.list(uid(c));
    return c.json({ flows: list, recording: Object.fromEntries(list.filter((f) => f.recording).map((f) => [f.botId, f.id])) });
  }));
  api.post("/flows/record", (c) => guard(c, async () => { const b = await body(c); return c.json({ flow: flows.startRecording(uid(c), String(b.botId ?? ""), String(b.name ?? "")) }); }));
  api.post("/flows/:id/stop", (c) => guard(c, () => c.json({ flow: flows.stopRecording(uid(c), c.req.param("id")) })));
  api.patch("/flows/:id", (c) => guard(c, async () => c.json({ flow: flows.edit(uid(c), c.req.param("id"), await body(c)) })));
  api.delete("/flows/:id", (c) => guard(c, () => { flows.remove(uid(c), c.req.param("id")); return c.json({ ok: true }); }));
  api.get("/flows/:id/runs", (c) => guard(c, () => { const f = flows.owned(uid(c), c.req.param("id")); if (!f) throw new FlowError(404, "That flow does not exist."); return c.json({ flow: f, runs: flows.runs(f.id) }); }));
  api.post("/flows/:id/replay", (c) => guard(c, () => c.json({ run: startReplay(uid(c), c.req.param("id"), "owner") })));
  api.post("/flow-runs/:rid/approve", (c) => guard(c, async () => c.json({ run: approveStep(uid(c), c.req.param("rid"), Number((await body(c)).step)) })));
  api.post("/flow-runs/:rid/stop", (c) => guard(c, () => c.json({ run: stopRun(uid(c), c.req.param("rid")) })));
  api.get("/flow-runs/:rid/shots/:n", (c) => {
    const img = flows.shot(uid(c), c.req.param("rid"), Number(c.req.param("n")));
    return img ? new Response(new Uint8Array(img), { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=3600" } }) : c.json({ error: "Not found" }, 404);
  });

  // ── Automations ──
  api.get("/routines/:id/automation", (c) => guard(c, () => { const r = routines.owned(uid(c), c.req.param("id")); if (!r) throw new AutomationError(404, "That routine does not exist."); return c.json({ automation: automationOf(r.id) }); }));
  api.put("/routines/:id/automation", (c) => guard(c, async () => c.json({ automation: setRoutineAutomation(uid(c), c.req.param("id"), await body(c)) })));
  api.get("/triggers", (c) => guard(c, () => c.json({ triggers: triggers.list(uid(c)) })));
  api.post("/triggers", (c) => guard(c, async () => c.json({ trigger: triggers.create(uid(c), await body(c)) })));
  api.patch("/triggers/:id", (c) => guard(c, async () => { triggers.setEnabled(uid(c), c.req.param("id"), (await body(c)).enabled !== false); return c.json({ ok: true }); }));
  api.delete("/triggers/:id", (c) => guard(c, () => { triggers.remove(uid(c), c.req.param("id")); return c.json({ ok: true }); }));
  api.post("/triggers/:id/test", (c) => guard(c, async () => c.json({ note: await triggers.test(uid(c), c.req.param("id")) })));

  // ── Team memory ──
  api.get("/team-memory/:kind/:id", (c) => guard(c, () => c.json({ notes: teamNotes.list(uid(c), cleanScope(c.req.param("kind"), c.req.param("id"))) })));
  api.post("/team-memory/:kind/:id", (c) => guard(c, async () => c.json({ note: teamNotes.add(uid(c), cleanScope(c.req.param("kind"), c.req.param("id")), await body(c)) })));
  api.patch("/team-notes/:nid", (c) => guard(c, async () => c.json({ note: teamNotes.change(uid(c), c.req.param("nid"), await body(c)) })));
  api.delete("/team-notes/:nid", (c) => guard(c, () => { teamNotes.remove(uid(c), c.req.param("nid")); return c.json({ ok: true }); }));
  api.get("/team-memory/workspace/:id/guests", (c) => guard(c, () => c.json({ guests: guests.list(uid(c), c.req.param("id")) })));
  api.post("/team-memory/workspace/:id/guests", (c) => guard(c, async () => c.json({ guest: guests.create(uid(c), c.req.param("id"), await body(c)) })));
  api.delete("/team-memory/workspace/:id/guests/:gid", (c) => guard(c, () => { guests.revoke(uid(c), c.req.param("id"), c.req.param("gid")); return c.json({ ok: true }); }));
  api.get("/bots/:id/team-memory", (c) => guard(c, () => c.json({ on: teamMemoryBots.on(ownBot(c).id) })));
  api.put("/bots/:id/team-memory", (c) => guard(c, async () => { const b = ownBot(c); teamMemoryBots.set(b, (await body(c)).on === true); return c.json({ on: teamMemoryBots.on(b.id) }); }));

  // ── Memory controls and work lessons ──
  api.put("/bots/:id/rows/:seq/no-memory", (c) => guard(c, async () => {
    const b = ownBot(c);
    const seq = Number(c.req.param("seq"));
    const row = Number.isInteger(seq) ? rows.get(b.id, b.generation, seq) : null;
    if (!row || !typedByUser(row)) throw new FlowError(404, "Only one of your own messages can be marked.");
    const on = (await body(c)).on !== false;
    memoryKeep.skip(b.id, b.generation, seq, on);
    return c.json({ seq, noMemory: on });
  }));
  api.get("/bots/:id/no-memory", (c) => guard(c, () => { const b = ownBot(c); return c.json({ seqs: [...memoryKeep.skippedSeqs(b.id, b.generation)] }); }));
  api.get("/work-lessons", (c) => guard(c, () => c.json({ lessons: workLessons.list(uid(c), Number(c.req.query("limit") ?? 50) || 50) })));
  api.get("/work-lessons/week", (c) => guard(c, () => c.json(weekReview(uid(c)))));
  api.post("/work-lessons/proposals/:key", (c) => guard(c, async () => c.json(answerProposal(uid(c), c.req.param("key"), (await body(c)).accept === true))));
}

/** The guest links of the team memory: public (no session), slowed down per address, a dead link reads as 404. */
const hits = new Map<string, { n: number; until: number }>();
export function registerTeamGuestPublic(api: Hono<any>, clientIp: (c: Context) => string) {
  const slow = (c: Context) => {
    const k = clientIp(c), t = Date.now(), cur = hits.get(k);
    if (cur && cur.until > t && cur.n >= 60) return true;
    hits.set(k, cur && cur.until > t ? { ...cur, n: cur.n + 1 } : { n: 1, until: t + 10 * 60_000 });
    if (hits.size > 5000) for (const [key, v] of hits) if (v.until <= t) hits.delete(key);
    return false;
  };
  api.get("/team-guest/:token", (c) => {
    if (slow(c)) return c.json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
    const v = guests.read(c.req.param("token"));
    return v ? c.json(v) : c.json({ error: "This link does not work (unknown, expired or revoked)." }, 404);
  });
  api.post("/team-guest/:token", async (c) => {
    if (slow(c)) return c.json({ error: "Too many attempts. Wait a few minutes and try again." }, 429);
    try {
      const n = guests.write(c.req.param("token"), ((await c.req.json().catch(() => ({}))) ?? {}).text);
      return n ? c.json({ ok: true, pending: true }) : c.json({ error: "This link does not work (unknown, expired or revoked)." }, 404);
    } catch (e) { if (e instanceof TeamMemoryError) return c.json({ error: e.message }, e.status); throw e; }
  });
}
