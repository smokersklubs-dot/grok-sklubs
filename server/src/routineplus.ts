/*
 * Portions adapted from n8n-io/nod (https://github.com/n8n-io/nod, commit 0f9de28af967ad6f7be12a3181edcef860216328),
 * Copyright 2026 n8n GmbH, Apache License 2.0; modified for Sklubot: the behaviour of src/shared/schedule-timing.ts and
 * src/server/schedules.ts (late / skipped run track, edit preview without saving, "run now" refused on an unreviewed
 * change after a failure, approval of a complete saved instruction that lapses when the instruction changes) rewritten
 * on Sklubot's SQLite routines, run log and routine-scoped rules; no nod code path runs here.
 *
 * nod audit items 2 (a model per routine, per kind of work, per task), 8 (run track, live activity, "run now" guard,
 * preview of the next runs), 13 (approve a routine's whole instruction with its scope), 45 (a correction changes only
 * the fields it names).
 */
import { createHash } from "node:crypto"; import { localize } from "./lang/index.js";
import { getLive } from "./bus.js";
import { describeCron, isValidTimezone, nextRun } from "./cron.js"; import { belowFloor, FLOOR_REFUSAL } from "./routinefloor.js"; import { PACE_FR } from "./pacei18n.js";
import { q } from "./db.js";
import { describeRoutine, onRoutineUpdated, routines, runs, typicalRunUsd, type RoutineRecord } from "./routines.js";
import { rules } from "./rules.js";
import type { Locale, Routine } from "./shared.js";
import { cleanModelList, now, type BotRecord } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS routine_meta (
  routine_id TEXT PRIMARY KEY REFERENCES routines(id) ON DELETE CASCADE,
  model TEXT NOT NULL DEFAULT '', revision INTEGER NOT NULL DEFAULT 0, edited_at INTEGER,
  approved_hash TEXT, approved_scope TEXT, approved_at INTEGER, approved_rule TEXT)`);
q.run(`CREATE TABLE IF NOT EXISTS routine_run_track (
  run_id TEXT PRIMARY KEY, routine_id TEXT NOT NULL, due_at INTEGER, started_at INTEGER NOT NULL, missed INTEGER NOT NULL DEFAULT 0, by_hand INTEGER NOT NULL DEFAULT 0)`);
q.run(`CREATE TABLE IF NOT EXISTS bot_work_models (
  bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE,
  routines TEXT NOT NULL DEFAULT '', background TEXT NOT NULL DEFAULT '', tasks TEXT NOT NULL DEFAULT '')`);

/** Texts this module writes (English is the key; French here, as in i18n.ts). */
export const ROUTINE_FR: Record<string, string> = {
  "Due {due}, started {start}": "Prévue le {due}, lancée le {start}",
  "{n} runs skipped while the server was off": "{n} exécutions sautées pendant l'arrêt",
  "Approved instruction of the routine “{name}” ({when}): carry it out without asking each time, only towards: {targets}.": "Consigne approuvée de la routine « {name} » ({when}) : l'exécuter sans redemander à chaque fois, seulement vers : {targets}.",
  "At most {n} runs a day.": "Au plus {n} exécutions par jour.",
  "Until {date}.": "Jusqu'au {date}.",
  "Anything else, another target, or a change of the instruction: ask.": "Tout le reste, une autre cible ou une consigne modifiée : demander.",
  "That is not a model reference (provider:model).": "Ce n'est pas un nom de modèle (fournisseur:modèle).",
  "Unknown time zone.": "Fuseau horaire inconnu.",
  "That schedule never runs or cannot be read (five fields: minute hour day month weekday).": "Cet horaire ne tourne jamais ou ne se lit pas (cinq champs : minute heure jour mois jour-de-semaine).",
  "This routine was changed meanwhile: reopen it to see the latest version.": "Cette routine a changé entre-temps : rouvre-la pour voir la dernière version.",
  "This routine was changed since you opened it: look at the latest version before running it.": "Cette routine a changé depuis que tu l'as ouverte : regarde la dernière version avant de la lancer.",
  "This routine was changed after a failed run: open it and check the change before running it.": "Cette routine a été modifiée après un échec : ouvre-la et vérifie le changement avant de la lancer.",
  "Only scheduled routines have a next run to preview.": "Seules les routines à horaire ont une prochaine exécution à prévoir.",
  "Name at least one target (a person, an address, an app) the routine may act on.": "Indique au moins une cible (une personne, une adresse, une appli) sur laquelle la routine peut agir.",
  "The daily limit must be between 1 and 1440 runs.": "La limite par jour doit être entre 1 et 1440 exécutions.",
  "The end date must be in the future.": "La date de fin doit être dans le futur.",
  "Save your changes first, then run it.": "Enregistre d'abord tes changements, puis lance-la.",
  [FLOOR_REFUSAL]: PACE_FR[FLOOR_REFUSAL], // L143 (routinefloor.ts, pacei18n.ts)
};
export function tr(locale: Locale | undefined, en: string, vars: Record<string, string | number> = {}): string {
  const s = localize(locale, en, ROUTINE_FR);
  return s.replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

export class RoutineEditError extends Error { constructor(public status: 400 | 409, message: string) { super(message); } }

interface Meta { model: string; revision: number; editedAt: number | null; approvedHash: string | null; approvedScope: InstructionScope | null; approvedAt: number | null; approvedRule: string | null }
function meta(id: string): Meta {
  const r = q.get<any>("SELECT * FROM routine_meta WHERE routine_id = ?", id);
  let scope: InstructionScope | null = null;
  try { scope = r?.approved_scope ? JSON.parse(r.approved_scope) : null; } catch { scope = null; }
  return { model: r?.model ?? "", revision: r?.revision ?? 0, editedAt: r?.edited_at ?? null, approvedHash: r?.approved_hash ?? null, approvedScope: scope, approvedAt: r?.approved_at ?? null, approvedRule: r?.approved_rule ?? null };
}
const ensure = (id: string) => q.run("INSERT OR IGNORE INTO routine_meta (routine_id) VALUES (?)", id);

// ── Models per kind of work (item 2) ────────────────────────────────────────────────────────────────────────────────
export type WorkKind = "chat" | "routine" | "background" | "task";
export interface WorkModels { routines: string; background: string; tasks: string }

/** A model reference ("provider:model") or "" (= the bot's own model). Anything else is refused. */
export function cleanModelRef(raw: unknown): string {
  const v = String(raw ?? "").trim();
  if (!v) return "";
  if (cleanModelList([v]).length !== 1) throw new RoutineEditError(400, "That is not a model reference (provider:model).");
  return v;
}
export const workModels = {
  get(botId: string): WorkModels {
    const r = q.get<any>("SELECT * FROM bot_work_models WHERE bot_id = ?", botId);
    return { routines: r?.routines ?? "", background: r?.background ?? "", tasks: r?.tasks ?? "" };
  },
  set(botId: string, f: Partial<WorkModels>): WorkModels {
    const cur = workModels.get(botId);
    const next = { routines: f.routines === undefined ? cur.routines : cleanModelRef(f.routines), background: f.background === undefined ? cur.background : cleanModelRef(f.background), tasks: f.tasks === undefined ? cur.tasks : cleanModelRef(f.tasks) };
    q.run("INSERT INTO bot_work_models (bot_id, routines, background, tasks) VALUES (?, ?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET routines = excluded.routines, background = excluded.background, tasks = excluded.tasks", botId, next.routines, next.background, next.tasks);
    return next;
  },
};

/**
 * The model one piece of work runs on: the routine's own choice, else the bot's choice for that kind of work, else the
 * bot's model. A task started with an explicit model uses it.
 */
export function modelForWork(bot: Pick<BotRecord, "id" | "model">, kind: WorkKind, opts: { routineId?: string; explicit?: string } = {}): string {
  if (opts.explicit) return opts.explicit;
  if (kind === "routine" && opts.routineId) { const own = meta(opts.routineId).model; if (own) return own; }
  const w = workModels.get(bot.id);
  const chosen = kind === "routine" ? w.routines : kind === "background" ? w.background : kind === "task" ? w.tasks : "";
  return chosen || bot.model;
}

/** The model a routine run was queued with (`runId` of the queue item): what the turn loop can ask. */
export function modelForRun(bot: Pick<BotRecord, "id" | "model">, runId: string | undefined): string {
  const r = runId ? q.get<{ routine_id: string }>("SELECT routine_id FROM routine_runs WHERE id = ?", runId) : undefined;
  return modelForWork(bot, "routine", { routineId: r?.routine_id });
}

// ── Edit, revision, "run now" guard (items 8, 45) ───────────────────────────────────────────────────────────────────
export interface RoutineEdit { name?: string; prompt?: string; schedule?: string; timezone?: string; runAt?: number | null; model?: string }

function checkSchedule(trigger: Routine["trigger"], schedule: string, timezone: string) {
  if (!isValidTimezone(timezone)) throw new RoutineEditError(400, "Unknown time zone.");
  if (trigger === "cron") {
    try { if (nextRun(schedule, timezone, now()) === null) throw new Error("never"); } catch { throw new RoutineEditError(400, "That schedule never runs or cannot be read (five fields: minute hour day month weekday)."); }
  }
}

/**
 * Saves only the fields that changed; anything not named stays as it is ("every hour instead" changes the schedule
 * only). `revision` (when given) must be the one the editor opened, so two editors never overwrite each other. A change
 * of what the routine does makes its approved instruction lapse.
 */
export function editRoutine(r: RoutineRecord, f: RoutineEdit, revision?: number): { routine: RoutineRecord; changed: string[] } {
  const m = meta(r.id);
  if (revision !== undefined && revision !== m.revision) throw new RoutineEditError(409, "This routine was changed meanwhile: reopen it to see the latest version.");
  const changed: string[] = [];
  const next = { name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone, runAt: r.runAt };
  if (f.name !== undefined && f.name.trim() && f.name.trim().slice(0, 80) !== r.name) { next.name = f.name.trim().slice(0, 80); changed.push("name"); }
  if (f.prompt !== undefined && f.prompt.trim() && f.prompt.trim() !== r.prompt) { next.prompt = f.prompt.trim().slice(0, 8000); changed.push("prompt"); }
  if (f.schedule !== undefined && f.schedule.trim() !== r.schedule) { next.schedule = f.schedule.trim(); changed.push("schedule"); }
  if (f.timezone !== undefined && f.timezone.trim() !== r.timezone) { next.timezone = f.timezone.trim(); changed.push("timezone"); }
  if (f.runAt !== undefined && f.runAt !== r.runAt) { next.runAt = f.runAt; changed.push("runAt"); }
  const model = f.model === undefined ? m.model : cleanModelRef(f.model);
  if (model !== m.model) changed.push("model");
  if (changed.includes("schedule") || changed.includes("timezone")) checkSchedule(r.trigger, next.schedule, next.timezone);
  if (changed.includes("schedule") && r.trigger === "cron" && belowFloor(next.schedule)) throw new RoutineEditError(400, FLOOR_REFUSAL); // L143 (routinefloor.ts)
  if (!changed.length) return { routine: r, changed };
  ensure(r.id);
  q.tx(() => {
    routines.update(r.id, { name: next.name, prompt: next.prompt, schedule: next.schedule, timezone: next.timezone, runAt: next.runAt });
    q.run("UPDATE routine_meta SET model = ?, revision = revision + 1, edited_at = ? WHERE routine_id = ?", model, now(), r.id);
  });
  const updated = routines.byId(r.id)!;
  if (changed.some((c) => c !== "name")) lapseApproval(updated);
  return { routine: updated, changed };
}

/**
 * "Run now" (nod: refuse a run on a changed routine after a failure): when the last run failed and the routine was
 * changed since, the editor must send the revision it shows (the user looked at the change); a stale revision is refused.
 */
export function runNowCheck(r: RoutineRecord, revision: number | undefined): void {
  const m = meta(r.id);
  if (revision !== undefined && revision !== m.revision) throw new RoutineEditError(409, "This routine was changed since you opened it: look at the latest version before running it.");
  const last = runs.list(r.id).find((x) => x.status !== "skipped" && x.status !== "running");
  if (revision === undefined && last?.status === "error" && m.editedAt !== null && m.editedAt > last.at)
    throw new RoutineEditError(409, "This routine was changed after a failed run: open it and check the change before running it.");
}

// ── Preview without saving (item 8) ─────────────────────────────────────────────────────────────────────────────────
export interface RoutinePreview { describe: string; next: number[]; monthlyUsd: number | null }
export function previewRoutine(bot: Pick<BotRecord, "id" | "model" | "userId">, f: { trigger?: string; schedule?: string; timezone?: string; runAt?: number | null; model?: string; routineId?: string }, locale?: Locale): RoutinePreview {
  const trigger = (f.trigger ?? "cron") as Routine["trigger"];
  const timezone = (f.timezone ?? "UTC").trim() || "UTC";
  const schedule = (f.schedule ?? "").trim();
  if (trigger !== "cron" && trigger !== "once") throw new RoutineEditError(400, "Only scheduled routines have a next run to preview.");
  checkSchedule(trigger, schedule, timezone);
  const next: number[] = [];
  if (trigger === "once") { if (f.runAt && f.runAt > now()) next.push(f.runAt); }
  else { let t = now(); while (next.length < 3) { const n = nextRun(schedule, timezone, t); if (!n) break; next.push(n); t = n; } }
  const model = f.model ? cleanModelRef(f.model) : modelForWork(bot, "routine", { routineId: f.routineId });
  let perMonth = 0;
  if (trigger === "once") perMonth = next.length;
  else { let t = now(); const end = t + 30 * 86400_000; while (perMonth < 3000) { const n = nextRun(schedule, timezone, t); if (!n || n > end) break; perMonth++; t = n; } }
  const monthlyUsd = Math.round(typicalRunUsd(model, bot.userId) * perMonth * 100) / 100;
  return { describe: trigger === "cron" ? describeCron(schedule, locale) : describeRoutine({ trigger, schedule, runAt: f.runAt ?? null, timezone }, locale), next, monthlyUsd };
}

// ── Run track (item 8) ──────────────────────────────────────────────────────────────────────────────────────────────
export function trackRun(runId: string, routineId: string, dueAt: number | null, missed: number, byHand = false) {
  q.run("INSERT OR REPLACE INTO routine_run_track (run_id, routine_id, due_at, started_at, missed, by_hand) VALUES (?, ?, ?, ?, ?, ?)", runId, routineId, dueAt, now(), Math.max(0, missed), byHand ? 1 : 0);
  q.run("DELETE FROM routine_run_track WHERE routine_id = ? AND run_id NOT IN (SELECT id FROM routine_runs WHERE routine_id = ?)", routineId, routineId);
}
export interface RunTrack { dueAt: number | null; startedAt: number; missed: number; lateMs: number; byHand: boolean }
export function trackOf(runId: string): RunTrack | null {
  const r = q.get<any>("SELECT * FROM routine_run_track WHERE run_id = ?", runId);
  return r ? { dueAt: r.due_at ?? null, startedAt: r.started_at, missed: r.missed, lateMs: r.due_at ? Math.max(0, r.started_at - r.due_at) : 0, byHand: !!r.by_hand } : null;
}
/** Late by more than this: said at the top of the run's first line in the chat. */
export const LATE_MS = 10 * 60_000;
const hm = (at: number, tz: string, locale?: Locale) => new Date(at).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { timeZone: tz, dateStyle: "short", timeStyle: "short" });
/** "Prévue le 22/11 à 08:00, lancée à 08:42 · 3 exécutions sautées pendant l'arrêt" — or "" when on time. */
export function lateLine(dueAt: number, startedAt: number, missed: number, timezone: string, locale?: Locale): string {
  if (startedAt - dueAt <= LATE_MS && !missed) return "";
  const tz = isValidTimezone(timezone) ? timezone : "UTC";
  const base = tr(locale, "Due {due}, started {start}", { due: hm(dueAt, tz, locale), start: hm(startedAt, tz, locale) });
  return missed ? `${base} · ${tr(locale, "{n} runs skipped while the server was off", { n: missed })}` : base;
}

// ── Live activity (item 8) ──────────────────────────────────────────────────────────────────────────────────────────
export interface RoutineLive { routineId: string; running: boolean; steps: number; caption: string | null; activity: string | null; since: number | null; awaiting: string | null }
/** What each running routine of a bot is doing now: the bot's live state while one of its runs is under way. */
export function liveRoutines(botId: string): RoutineLive[] {
  const live = getLive(botId);
  return routines.forBot(botId).filter((r) => r.running).map((r) => ({
    routineId: r.id, running: live.running, steps: live.steps ?? 0, caption: live.caption ?? null,
    activity: live.activity ? `${live.activity.kind}${live.activity.detail ? `: ${live.activity.detail}` : ""}` : null,
    since: live.startedAt, awaiting: live.awaiting?.reason ?? null,
  }));
}

// ── Approve the whole instruction (item 13) ─────────────────────────────────────────────────────────────────────────
export interface InstructionScope { targets: string[]; maxRunsPerDay: number | null; until: number | null }
export function instructionHash(r: Pick<RoutineRecord, "id" | "prompt" | "trigger" | "schedule" | "timezone" | "runAt">, scope: InstructionScope): string {
  return createHash("sha256").update(JSON.stringify([r.id, r.prompt, r.trigger, r.schedule, r.timezone, r.runAt, meta(r.id).model, scope.targets, scope.maxRunsPerDay, scope.until])).digest("hex");
}
export function cleanScope(raw: any): InstructionScope {
  const targets = (Array.isArray(raw?.targets) ? raw.targets : []).map((t: unknown) => String(t ?? "").trim().slice(0, 200)).filter(Boolean).slice(0, 20);
  if (!targets.length) throw new RoutineEditError(400, "Name at least one target (a person, an address, an app) the routine may act on.");
  const max = raw?.maxRunsPerDay === null || raw?.maxRunsPerDay === undefined || raw?.maxRunsPerDay === "" ? null : Math.floor(Number(raw.maxRunsPerDay));
  if (max !== null && (!Number.isFinite(max) || max < 1 || max > 1440)) throw new RoutineEditError(400, "The daily limit must be between 1 and 1440 runs.");
  const until = raw?.until ? Number(raw.until) : null;
  if (until !== null && (!Number.isFinite(until) || until <= now())) throw new RoutineEditError(400, "The end date must be in the future.");
  return { targets, maxRunsPerDay: max, until };
}
/** The rule a routine-scoped approval becomes: the routine's turns and its reviewer read it; it never widens the floor. */
export function approvalRuleText(r: RoutineRecord, scope: InstructionScope, locale?: Locale): string {
  const parts = [
    tr(locale, "Approved instruction of the routine “{name}” ({when}): carry it out without asking each time, only towards: {targets}.", { name: r.name, when: describeRoutine(r, locale), targets: scope.targets.join(", ") }),
    scope.maxRunsPerDay ? tr(locale, "At most {n} runs a day.", { n: scope.maxRunsPerDay }) : "",
    scope.until ? tr(locale, "Until {date}.", { date: new Date(scope.until).toISOString().slice(0, 10) }) : "",
    tr(locale, "Anything else, another target, or a change of the instruction: ask."),
  ];
  return parts.filter(Boolean).join(" ");
}
export function approveInstruction(userId: string, r: RoutineRecord, scope: InstructionScope, locale?: Locale) {
  ensure(r.id);
  const m = meta(r.id);
  if (m.approvedRule) rules.remove(m.approvedRule);
  const rule = rules.create(userId, approvalRuleText(r, scope, locale), r.botId, { routineId: r.id, source: "user", quote: r.prompt.slice(0, 400) });
  q.run("UPDATE routine_meta SET approved_hash = ?, approved_scope = ?, approved_at = ?, approved_rule = ? WHERE routine_id = ?", instructionHash(r, scope), JSON.stringify(scope), now(), rule.id, r.id);
  return approvalOf(r);
}
/** A changed routine: the approval no longer matches what it does; its rule is switched off until approved again. */
export function lapseApproval(r: RoutineRecord) {
  const m = meta(r.id);
  if (!m.approvedRule || !m.approvedScope) return;
  if (m.approvedHash === instructionHash(r, m.approvedScope)) return;
  if (rules.owned(q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", r.botId)?.user_id ?? "", m.approvedRule)) rules.update(m.approvedRule, { enabled: false });
}
onRoutineUpdated((r) => lapseApproval(r));
export function revokeApproval(r: RoutineRecord) {
  const m = meta(r.id);
  if (m.approvedRule) rules.remove(m.approvedRule);
  q.run("UPDATE routine_meta SET approved_hash = NULL, approved_scope = NULL, approved_at = NULL, approved_rule = NULL WHERE routine_id = ?", r.id);
}
export interface InstructionApproval { state: "none" | "approved" | "stale" | "expired"; scope: InstructionScope | null; approvedAt: number | null }
export function approvalOf(r: RoutineRecord): InstructionApproval {
  const m = meta(r.id);
  if (!m.approvedScope || !m.approvedHash) return { state: "none", scope: null, approvedAt: null };
  const state = m.approvedHash !== instructionHash(r, m.approvedScope) ? "stale" : m.approvedScope.until && m.approvedScope.until <= now() ? "expired" : "approved";
  // A lapsed approval never keeps its rule on (a change made outside the editor, or the end date passed).
  if (state !== "approved" && m.approvedRule) rules.update(m.approvedRule, { enabled: false });
  return { state, scope: m.approvedScope, approvedAt: m.approvedAt };
}

/** Everything the routine editor shows on top of the routine itself. */
export function routineExtras(r: RoutineRecord, bot: Pick<BotRecord, "id" | "model">) {
  const m = meta(r.id);
  return { revision: m.revision, editedAt: m.editedAt, model: m.model, effectiveModel: modelForWork(bot, "routine", { routineId: r.id }), approval: approvalOf(r) };
}
