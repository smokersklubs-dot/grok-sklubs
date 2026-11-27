/**
 * Automations without a model turn (L173 rest; docs/cleanroom/10-timon.md T79 — clean room, ideas only). See
 * docs/TABLEAU.md (« Automatisations »).
 *
 * 1. A routine WITHOUT AI: when its time comes, instead of a turn of the bot, it replays a recorded flow (flows.ts),
 *    sends an internal event to one of the bot's own outgoing webhooks, posts a fixed note in the bot's chat, or runs the
 *    owner's own script on the bot's own Linux computer (never on this server; output kept in the run's note). No model
 *    call, no cost. Only the owner sets this (routes behind the session); no bot tool can create or change it.
 * 2. CHAINED routines: a routine may start right after another one of the same bot account ended (« seulement si elle a
 *    réussi » or « dans tous les cas »). A chain is checked for loops when it is set.
 * 3. TRIGGERS on internal events (internalevents.ts): « quand une tâche du tableau est finie / bloquée, une idée réglée,
 *    une routine réussie / ratée, une page surveillée a changé, un parcours a échoué » → start a routine, replay a flow,
 *    send a webhook, or post a note. An event an automation caused is never fed to another trigger (T79 v2), so two
 *    triggers can never feed each other.
 *
 * Every rule here carries its owner's user id and may only name that owner's own bots, routines, flows and webhooks.
 */
import { q } from "./db.js";
import { emit } from "./bus.js";
import { computerKind, runShell } from "./computer.js";
import { emitInternal, INTERNAL_EVENTS, isInternalEvent, onInternalEvent, type InternalEvent } from "./internalevents.js";
import { queueAutomationEvent } from "./outwebhooks.js";
import { onRunEnded, routines, runs, type RoutineRecord } from "./routines.js";
import { flows, startReplay } from "./flows.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "./store.js";
import { wt } from "./worki18n.js";

q.run(`CREATE TABLE IF NOT EXISTS routine_automation (
  routine_id TEXT PRIMARY KEY REFERENCES routines(id) ON DELETE CASCADE, mode TEXT NOT NULL DEFAULT 'ai', target TEXT NOT NULL DEFAULT '',
  after_routine_id TEXT, after_when TEXT NOT NULL DEFAULT 'ok', updated_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS event_triggers (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, event TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '',
  action TEXT NOT NULL, target TEXT NOT NULL, bot_id TEXT, enabled INTEGER NOT NULL DEFAULT 1, fired INTEGER NOT NULL DEFAULT 0,
  last_fired_at INTEGER, last_note TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS event_triggers_user ON event_triggers(user_id, event)");

export const ROUTINE_MODES = ["ai", "flow", "webhook", "notice", "script"] as const;
export type RoutineMode = (typeof ROUTINE_MODES)[number];
export const TRIGGER_ACTIONS = ["routine", "flow", "webhook", "notice"] as const;
export type TriggerAction = (typeof TRIGGER_ACTIONS)[number];
export const MAX_TRIGGERS = 30;
export const SCRIPT_TIMEOUT_SEC = 300;
const SCRIPT_CHARS = 8000;

export class AutomationError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }
const bad = (m: string): never => { throw new AutomationError(400, m); };

export interface RoutineAutomation { routineId: string; mode: RoutineMode; target: string; afterRoutineId: string | null; afterWhen: "ok" | "any" }
export interface EventTrigger { id: string; event: string; subject: string; action: TriggerAction; target: string; botId: string | null; enabled: boolean; fired: number; lastFiredAt: number | null; lastNote: string; createdAt: number }

const toAuto = (r: any): RoutineAutomation => ({ routineId: r.routine_id, mode: (ROUTINE_MODES as readonly string[]).includes(r.mode) ? r.mode : "ai", target: r.target, afterRoutineId: r.after_routine_id ?? null, afterWhen: r.after_when === "any" ? "any" : "ok" });
const toTrigger = (r: any): EventTrigger => ({ id: r.id, event: r.event, subject: r.subject, action: r.action, target: r.target, botId: r.bot_id ?? null, enabled: !!r.enabled, fired: r.fired, lastFiredAt: r.last_fired_at ?? null, lastNote: r.last_note, createdAt: r.created_at });

export function automationOf(routineId: string): RoutineAutomation {
  const r = q.get("SELECT * FROM routine_automation WHERE routine_id = ?", routineId);
  return r ? toAuto(r) : { routineId, mode: "ai", target: "", afterRoutineId: null, afterWhen: "ok" };
}

/** Checks that `target` fits `mode` and belongs to the routine's owner; returns the cleaned target. */
function cleanTarget(userId: string, bot: BotRecord, mode: RoutineMode | TriggerAction, raw: unknown): string {
  const t = String(raw ?? "").trim();
  if (mode === "ai") return "";
  if (mode === "flow") { const f = flows.owned(userId, t); if (!f) bad("That recorded flow is not one of yours."); return f!.id; }
  if (mode === "webhook") { if (!q.get("SELECT 1 FROM bot_webhooks WHERE id = ? AND bot_id = ? AND user_id = ?", t, bot.id, userId)) bad("Choose one of this bot's outgoing webhooks."); return t; }
  if (mode === "routine") { const r = routines.owned(userId, t); if (!r) bad("That routine is not one of yours."); return r!.id; }
  if (mode === "notice") return clip(t, 1000) || bad("Write the note to post.");
  // script: the owner's own words, run on the bot's own Linux computer only.
  if (computerKind() !== "linux") bad("A script runs only on a bot's own Linux computer, which this server does not have.");
  if (!t) bad("Write the script to run.");
  if (t.length > SCRIPT_CHARS) bad("The script is too long (8,000 characters at most).");
  return t;
}

/** Would starting `routineId` after `after` close a loop (A after B after … after A)? */
function chainLoops(routineId: string, after: string): boolean {
  let cur: string | null = after;
  for (let i = 0; i < 50 && cur; i++) { if (cur === routineId) return true; cur = automationOf(cur).afterRoutineId; }
  return false;
}

/** The owner sets how a routine runs (with or without AI), and what it follows. */
export function setRoutineAutomation(userId: string, routineId: string, o: { mode?: unknown; target?: unknown; afterRoutineId?: unknown; afterWhen?: unknown }): RoutineAutomation {
  const r = routines.owned(userId, routineId);
  if (!r) throw new AutomationError(404, "That routine does not exist.");
  const bot = bots.byId(r.botId)!;
  const cur = automationOf(r.id);
  const mode = o.mode === undefined ? cur.mode : (ROUTINE_MODES as readonly string[]).includes(String(o.mode)) ? (o.mode as RoutineMode) : bad("Unknown way of running.");
  const target = o.mode === undefined && o.target === undefined ? cur.target : cleanTarget(userId, bot, mode, o.target ?? cur.target);
  let after = cur.afterRoutineId;
  if (o.afterRoutineId !== undefined) {
    after = o.afterRoutineId ? String(o.afterRoutineId) : null;
    if (after) {
      if (!routines.owned(userId, after)) bad("That routine is not one of yours.");
      if (after === r.id || chainLoops(r.id, after)) bad("That chain would make a loop.");
    }
  }
  const when = o.afterWhen === undefined ? cur.afterWhen : o.afterWhen === "any" ? "any" : "ok";
  q.run("INSERT INTO routine_automation (routine_id, mode, target, after_routine_id, after_when, updated_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(routine_id) DO UPDATE SET mode = excluded.mode, target = excluded.target, after_routine_id = excluded.after_routine_id, after_when = excluded.after_when, updated_at = excluded.updated_at",
    r.id, mode, target, after, when, now());
  audit(userId, "routine", `${bot.name}: routine “${clip(r.name, 60)}” — ${mode === "ai" ? "runs with AI" : `runs without AI (${mode})`}${after ? ", chained" : ""}`, bot.id);
  return automationOf(r.id);
}

/**
 * Called by the scheduler (fireRoutine) once a run was started: a routine without AI does its action here and the run
 * ends here; true means « handled, do not queue a model turn ».
 */
export function runWithoutAi(r: RoutineRecord, runId: string): boolean {
  const a = automationOf(r.id);
  if (a.mode === "ai") return false;
  const bot = bots.byId(r.botId);
  if (!bot) { runs.finish(runId, "error", "its bot is gone"); return true; }
  void doAction(bot, a.mode, a.target, { label: r.name, routineId: r.id, fromTrigger: triggerStarted.has(r.id) }).then(
    (note) => runs.finish(runId, "done", note, () => routines.succeeded(r.id)),
    (err) => { routines.failed(r.id); runs.finish(runId, "error", clip((err as Error).message || "?", 300)); },
  ).finally(() => emit(bot.userId, { type: "routines", botId: bot.id }));
  return true;
}

/** One action, done without a model turn. Returns a short note for the run log. */
async function doAction(bot: BotRecord, mode: RoutineMode | TriggerAction, target: string, ctx: { label: string; routineId?: string; event?: InternalEvent; fromTrigger?: boolean }): Promise<string> {
  const loc = users.localeOf(bot.userId);
  switch (mode) {
    case "flow": { const run = startReplay(bot.userId, target, ctx.event || ctx.fromTrigger ? "trigger" : "routine"); return `flow run ${run.id} started`; }
    case "webhook": {
      const ok = queueAutomationEvent(bot, target, `auto:${newId("k")}`, { source: ctx.event ? "trigger" : "routine", label: ctx.label, ...(ctx.event ? { event: ctx.event.type, subject: ctx.event.subjectId, about: ctx.event.label, data: ctx.event.data ?? {} } : {}) });
      if (!ok) throw new Error("the webhook is gone or switched off");
      return "webhook queued";
    }
    case "notice": rows.append(bot, { kind: "notice", tone: "info", text: clip(`${ctx.label}: ${target}`, 1200) }); return "note posted";
    case "routine": {
      const r = routines.owned(bot.userId, target);
      if (!r || !r.enabled) throw new Error("the routine is gone or paused");
      const { fireRoutine } = await import("./scheduler.js");
      if (ctx.event) triggerStarted.set(r.id, (triggerStarted.get(r.id) ?? 0) + 1);
      return `routine ${fireRoutine(r, undefined, { note: ctx.event ? `[Started by a trigger: ${ctx.event.type} — ${clip(ctx.event.label, 120)}]` : "" })}`;
    }
    case "script": {
      if (computerKind() !== "linux") throw new Error("a script runs only on a bot's own Linux computer");
      const out = await runShell(bot.id, bot.userId, target, SCRIPT_TIMEOUT_SEC);
      rows.append(bot, { kind: "notice", tone: out.code === 0 ? "info" : "warn", text: wt(loc, "Script of the routine “{name}”: exit code {code}.", { name: ctx.label, code: String(out.code ?? (out.timedOut ? "timeout" : "?")) }) });
      if (out.code !== 0) throw new Error(`exit code ${out.code ?? (out.timedOut ? "timeout" : "?")}: ${clip(out.output.trim().split("\n").slice(-3).join(" "), 200)}`);
      return clip(`ok: ${out.output.trim().split("\n").slice(-2).join(" ")}`, 300);
    }
    default: return "";
  }
}

// ── Chained routines ─────────────────────────────────────────────────────────────────────────────────────────────
/** Routines a trigger started: the end of that run is marked as caused by an automation (it feeds no trigger). */
const triggerStarted = new Map<string, number>();
onRunEnded((r, status) => {
  if (status === "skipped" || status === "running") return;
  const ok = status === "done" || status === "quiet";
  const n = triggerStarted.get(r.id) ?? 0;
  if (n) { if (n > 1) triggerStarted.set(r.id, n - 1); else triggerStarted.delete(r.id); }
  const owner = bots.byId(r.botId)?.userId;
  if (!owner) return;
  emitInternal({ type: ok ? "routine.run_ok" : "routine.run_failed", userId: owner, botId: r.botId, subjectId: r.id, label: r.name, ...(n ? { cause: "trigger" as const } : {}) });
  // A chain is checked for loops when it is set (chainLoops), so this always ends.
  for (const next of q.all<{ routine_id: string; after_when: string }>("SELECT routine_id, after_when FROM routine_automation WHERE after_routine_id = ?", r.id)) {
    if (next.after_when !== "any" && !ok) continue;
    const child = routines.owned(owner, next.routine_id);
    if (!child || !child.enabled) continue;
    void import("./scheduler.js").then(({ fireRoutine }) => fireRoutine(child, undefined, { note: `[Chained: starts after the routine “${clip(r.name, 80)}” ${ok ? "succeeded" : "ended"}.]` }));
  }
});

// ── Triggers on internal events ───────────────────────────────────────────────────────────────────────────────────
export const triggers = {
  list: (userId: string) => q.all("SELECT * FROM event_triggers WHERE user_id = ? ORDER BY created_at", userId).map(toTrigger),
  create(userId: string, o: { event?: unknown; subject?: unknown; action?: unknown; target?: unknown; botId?: unknown }): EventTrigger {
    if (!isInternalEvent(o.event)) bad("Unknown event.");
    const action = (TRIGGER_ACTIONS as readonly string[]).includes(String(o.action)) ? (o.action as TriggerAction) : bad("Unknown action.");
    if (q.get<{ n: number }>("SELECT COUNT(*) AS n FROM event_triggers WHERE user_id = ?", userId)!.n >= MAX_TRIGGERS) throw new AutomationError(409, "At most 30 triggers: delete one first.");
    const bot = bots.owned(userId, String(o.botId ?? ""));
    if (!bot || bot.kind !== "agent") bad("That bot is not one of yours.");
    const target = cleanTarget(userId, bot!, action, o.target);
    const id = newId("trg");
    q.run("INSERT INTO event_triggers (id, user_id, event, subject, action, target, bot_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, userId, String(o.event), clip(String(o.subject ?? "").trim(), 80), action, target, bot!.id, now());
    audit(userId, "routine", `Trigger: when ${String(o.event)} → ${action}`, bot!.id);
    return toTrigger(q.get("SELECT * FROM event_triggers WHERE id = ?", id));
  },
  setEnabled(userId: string, id: string, on: boolean) { if (!q.run("UPDATE event_triggers SET enabled = ? WHERE id = ? AND user_id = ?", on ? 1 : 0, id, userId).changes) throw new AutomationError(404, "That trigger does not exist."); },
  remove(userId: string, id: string) { if (!q.run("DELETE FROM event_triggers WHERE id = ? AND user_id = ?", id, userId).changes) throw new AutomationError(404, "That trigger does not exist."); },
  /** « Essayer »: the trigger's action runs once now, with a test event (marked as caused by a trigger: it feeds nothing). */
  async test(userId: string, id: string): Promise<string> {
    const r = q.get<any>("SELECT * FROM event_triggers WHERE id = ? AND user_id = ?", id, userId);
    if (!r) throw new AutomationError(404, "That trigger does not exist.");
    return fire(toTrigger(r), { type: r.event, userId, subjectId: "test", label: "test", cause: "trigger" });
  },
};

async function fire(t: EventTrigger, e: InternalEvent): Promise<string> {
  const bot = t.botId ? bots.owned(e.userId, t.botId) : null;
  let note: string;
  try {
    if (!bot) throw new Error("its bot is gone");
    note = await doAction(bot, t.action, t.target, { label: e.label, event: { ...e, cause: "trigger" } });
  } catch (err) { note = `failed: ${clip((err as Error).message || "?", 200)}`; }
  q.run("UPDATE event_triggers SET fired = fired + 1, last_fired_at = ?, last_note = ? WHERE id = ?", now(), clip(note, 300), t.id);
  return note;
}

/** The listener: only the account's own enabled triggers, never for an event an automation caused. */
export function onEvent(e: InternalEvent) {
  if (e.cause === "trigger" || !e.userId) return;
  const list = q.all<any>("SELECT * FROM event_triggers WHERE user_id = ? AND event = ? AND enabled = 1", e.userId, e.type).map(toTrigger);
  for (const t of list) {
    if (t.subject && t.subject !== e.subjectId) continue;
    void fire(t, e);
  }
}
onInternalEvent(onEvent);

export { INTERNAL_EVENTS };
