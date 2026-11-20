import { q } from "./db.js";
import { config } from "./config.js";
import { describeCron, nextRun } from "./cron.js";
import { defaultModelRef } from "./llm/index.js";
import { costOf } from "./usage.js";
import { newId, now, randomToken } from "./store.js";
import { tr } from "./i18n.js";
import { NATIVE_TRIGGERS, type Locale, type NativeTrigger, type Routine, type RoutineRun } from "./shared.js";

/** Where a built-in app trigger's last check stopped: a time, Outlook's delta link, Slack's last ts per channel. */
export interface NativeState { since?: number; deltaLink?: string; lastTs?: Record<string, string> }
/** What a "skip when nothing changed" routine looks at before each run: a built-in mail account, or a web address. */
export type RoutineInput = { kind: "account"; accountId: string } | { kind: "url"; url: string };
export interface RoutineRecord extends Routine { hookToken: string | null; watchHash: string | null; nativeState: NativeState; rawInputs: RoutineInput[]; inputsHash: string | null }
/** Failed runs in a row before the user is pushed, and before the server pauses the routine (spec 07 A7). */
export const ROUTINE_FAIL_PUSH = 3;
export const ROUTINE_FAIL_PAUSE = 5;
/** A run still "running" after this long was cut off (a restart): it no longer blocks the next one. */
const STALE_RUN_MS = 2 * 3600_000;

// A subscription can be limited longer than the timeout for abandoned runs.
const queuedRun = `EXISTS (SELECT 1 FROM bot_queue b
  WHERE b.bot_id = (SELECT bot_id FROM routines WHERE id = routine_runs.routine_id)
    AND b.status IN ('pending', 'running', 'limited', 'held')
    AND CASE WHEN json_valid(b.trigger) THEN json_extract(b.trigger, '$.runId') END = routine_runs.id)`;
function hasActiveRun(id: string): boolean {
  return !!q.get(`SELECT 1 FROM routine_runs WHERE routine_id = ? AND status = 'running' AND (at > ? OR ${queuedRun})`, id, now() - STALE_RUN_MS);
}
export const isNativeTrigger = (t: string): t is NativeTrigger => (NATIVE_TRIGGERS as readonly string[]).includes(t);
const APP_NAMES: Record<string, string> = { gmail: "Gmail", gcalendar: "Google Calendar", gdrive: "Google Drive", outlook: "Outlook", slack: "Slack" };

export function describeRoutine(r: { trigger: string; schedule: string; runAt: number | null; timezone: string; native?: Routine["native"] }, locale?: Locale): string {
  if (r.trigger === "webhook") return tr(locale, "When its web address is called");
  if (r.trigger === "botmail") return tr(locale, "When an email arrives at its own address");
  if (r.native && r.trigger === "email") return r.native.query ? tr(locale, "When a new email matches “{query}” in {account}", { query: r.native.query, account: r.native.account }) : tr(locale, "When a new email arrives in {account}", { account: r.native.account });
  if (r.native && r.trigger === "slack") {
    const where = r.native.channel === "@dm" ? tr(locale, "a direct message") : r.native.channel;
    return r.native.mentionsOnly ? tr(locale, "When the app is mentioned in {where} ({account})", { where, account: r.native.account }) : tr(locale, "When a new message arrives in {where} ({account})", { where, account: r.native.account });
  }
  if (r.native && r.trigger === "calendar") return tr(locale, "{n} minutes before each event in {account}", { n: r.native.leadMin, account: r.native.account });
  if (r.trigger === "watch") return tr(locale, "When what it watches changes");
  if (r.trigger === "once")
    return r.runAt ? tr(locale, "Once on {date}", { date: new Date(r.runAt).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" }) }) : tr(locale, "Once");
  return describeCron(r.schedule, locale);
}

function nativeOf(r: any): Routine["native"] {
  if (!isNativeTrigger(r.trigger)) return null;
  let c: any = {};
  try { c = JSON.parse(r.native_config || "{}"); } catch { /* defaults */ }
  const acc = r.native_account_id ? q.get<{ app: string; label: string; status: string }>("SELECT app, label, status FROM native_accounts WHERE id = ?", r.native_account_id) : undefined;
  return {
    accountId: r.native_account_id ?? "", account: acc ? `${APP_NAMES[acc.app] ?? acc.app} — ${acc.label}` : "?", accountStatus: !acc ? "missing" : acc.status === "ready" ? "ready" : "needs_auth",
    query: String(c.query ?? ""), channel: String(c.channel ?? ""), mentionsOnly: !!c.mentionsOnly, leadMin: Number(c.leadMin) || 10,
    everyMin: Number(r.native_every_min) || 5, lastCheckedAt: r.native_checked_at ?? null,
  };
}

function inputsOf(r: any): RoutineInput[] {
  let raw: unknown = [];
  try { raw = JSON.parse(r.inputs || "[]"); } catch { /* none */ }
  return Array.isArray(raw) ? raw.filter((i): i is RoutineInput => !!i && typeof i === "object" && ((i.kind === "account" && typeof i.accountId === "string") || (i.kind === "url" && typeof i.url === "string"))).slice(0, 5) : [];
}
function inputLabel(i: RoutineInput): string {
  if (i.kind === "url") return i.url;
  const acc = q.get<{ app: string; label: string }>("SELECT app, label FROM native_accounts WHERE id = ?", i.accountId);
  return acc ? `${APP_NAMES[acc.app] ?? acc.app} — ${acc.label}` : "?";
}

/** How many times a routine fires in 30 days at its schedule (cron, once), or as seen over the last 30 days (other kinds). */
function runsPerMonth(r: any): number | null {
  if (r.trigger === "cron") {
    let n = 0;
    let t = now();
    const end = t + 30 * 86400_000;
    // Counted one by one, up to a cap; a very frequent schedule is extrapolated from the cap.
    while (n < 3000) { const next = nextRun(r.schedule, r.timezone, t); if (!next || next > end) break; n++; t = next; }
    return n >= 3000 ? Math.round((n * (end - now())) / Math.max(1, t - now())) : n;
  }
  if (r.trigger === "once") return r.last_run_at ? 0 : 1;
  const seen = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM routine_runs WHERE routine_id = ? AND at >= ? AND status != 'skipped'", r.id, now() - 30 * 86400_000)?.n ?? 0;
  return seen || null;
}
/** What one run of a bot costs, by default: a typical turn (8 000 tokens in, 600 out) at its model's price. */
export function typicalRunUsd(modelRef: string, userId?: string): number {
  const ref = modelRef || defaultModelRef();
  return costOf(ref.includes(":") ? ref.slice(ref.indexOf(":") + 1) : ref, { inputTokens: 8000, outputTokens: 600, cachedTokens: 0 }, userId);
}
/** Projected monthly cost: the average of its recent runs (or a typical run) times how often it fires. */
function projected(r: any): number | null {
  const per = runsPerMonth(r);
  if (per === null) return null;
  const recent = q.all<{ c: number }>("SELECT cost_usd AS c FROM routine_runs WHERE routine_id = ? AND status IN ('done','quiet','error') ORDER BY at DESC LIMIT 10", r.id);
  const owner = q.get<{ model: string; user_id: string }>("SELECT model, user_id FROM bots WHERE id = ?", r.bot_id);
  const model = owner?.model ?? "";
  const avg = recent.length && recent.some((x) => x.c > 0) ? recent.reduce((a, x) => a + x.c, 0) / recent.length : typicalRunUsd(model, owner?.user_id);
  return Math.round(avg * per * 100) / 100;
}

function toRoutine(r: any): RoutineRecord {
  const enabled = !!r.enabled;
  const rawInputs = inputsOf(r);
  const native = nativeOf(r);
  let nativeState: NativeState = {};
  try { nativeState = JSON.parse(r.native_state || "{}"); } catch { /* start over */ }
  const next = !enabled ? null : r.trigger === "cron" ? nextRun(r.schedule, r.timezone, now()) : r.trigger === "once" && r.run_at > now() ? r.run_at : null;
  return {
    id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, trigger: r.trigger, schedule: r.schedule, timezone: r.timezone,
    runAt: r.run_at, hookToken: r.hook_token, watchHash: r.watch_hash ?? null,
    watch: r.trigger === "watch" ? { kind: r.watch_kind, target: r.watch_target, everyMin: r.watch_every_min, lastCheckedAt: r.watch_checked_at ?? null } : null, hookUrl: r.hook_token ? `${config.publicUrl}/api/hooks/${r.hook_token}` : null,
    native, nativeState, rawInputs, inputsHash: r.inputs_hash ?? null,
    enabled, lastRunAt: r.last_run_at, nextRunAt: next, describe: describeRoutine({ trigger: r.trigger, schedule: r.schedule, runAt: r.run_at, timezone: r.timezone, native }),
    createdAt: r.created_at,
    skipUnchanged: !!r.skip_unchanged, inputs: rawInputs.map(inputLabel), failures: r.failures ?? 0, pausedReason: r.paused_reason ?? null,
    running: hasActiveRun(r.id),
    projectedMonthlyUsd: projected(r),
  };
}

export const publicRoutine = ({ hookToken, watchHash, nativeState, rawInputs: _i, inputsHash: _h, ...rest }: RoutineRecord, locale?: Locale): Routine => ({ ...rest, describe: describeRoutine(rest, locale) });

/** Hosted mode (hosted.ts): the account's plan may limit its number of active routines (bot id of the routine). */
let routineGuard: (botId: string) => void = () => {};
export const setRoutineGuard = (fn: (botId: string) => void) => { routineGuard = fn; };

export const routines = {
  forBot: (botId: string) => q.all("SELECT * FROM routines WHERE bot_id = ? ORDER BY created_at", botId).map(toRoutine),
  byId: (id: string) => { const r = q.get("SELECT * FROM routines WHERE id = ?", id); return r ? toRoutine(r) : null; },
  owned(userId: string, id: string) {
    const r = q.get("SELECT r.* FROM routines r JOIN bots b ON b.id = r.bot_id WHERE r.id = ? AND b.user_id = ?", id, userId);
    return r ? toRoutine(r) : null;
  },
  byHook: (token: string) => { const r = q.get("SELECT * FROM routines WHERE hook_token = ?", token); return r ? toRoutine(r) : null; },
  allEnabled: () => q.all("SELECT * FROM routines WHERE enabled = 1").map(toRoutine),
  ranSince: (userId: string, since: number) =>
    q.all("SELECT r.* FROM routines r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND r.last_run_at >= ?", userId, since).map(toRoutine),
  /** An enabled routine of this bot that does exactly the same thing at the same time (spec 07 A7: no duplicates). */
  twin(botId: string, f: { prompt: string; trigger: Routine["trigger"]; schedule?: string; timezone?: string; runAt?: number | null; watchTarget?: string }): RoutineRecord | null {
    const r = q.get("SELECT * FROM routines WHERE bot_id = ? AND enabled = 1 AND trigger = ? AND prompt = ? AND schedule = ? AND timezone = ? AND COALESCE(run_at, 0) = ? AND COALESCE(watch_target, '') = ?",
      botId, f.trigger, f.prompt.trim(), f.schedule ?? "", f.timezone ?? "UTC", f.runAt ?? 0, f.watchTarget ?? "");
    return r ? toRoutine(r) : null;
  },
  create(botId: string, f: { name: string; prompt: string; trigger: Routine["trigger"]; schedule?: string; timezone?: string; runAt?: number | null; watch?: { kind: string; target: string; everyMin: number }; native?: { accountId: string; query?: string; channel?: string; mentionsOnly?: boolean; leadMin?: number; everyMin: number }; inputs?: RoutineInput[]; paused?: boolean }): RoutineRecord {
    // `paused`: created switched off (an import): it never runs before the user turns it on, and an inactive routine does
    // not count against the plan's limit of active routines (the guard runs when it is turned on).
    if (!f.paused) routineGuard(botId);
    const id = newId("rtn");
    q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, run_at, hook_token, enabled, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, botId, f.name.trim().slice(0, 80), f.prompt.trim(), f.trigger, f.schedule ?? "", f.timezone ?? "UTC", f.runAt ?? null, f.trigger === "webhook" ? randomToken(24) : null, f.paused ? 0 : 1, now());
    if (f.watch) q.run("UPDATE routines SET watch_kind = ?, watch_target = ?, watch_every_min = ? WHERE id = ?", f.watch.kind, f.watch.target, f.watch.everyMin, id);
    if (f.inputs?.length && f.trigger === "cron") q.run("UPDATE routines SET skip_unchanged = 1, inputs = ? WHERE id = ?", JSON.stringify(f.inputs.slice(0, 5)), id);
    if (f.native) {
      // Only what arrives from now on fires: the starting point is the moment the routine is created.
      const n = f.native;
      q.run("UPDATE routines SET native_account_id = ?, native_config = ?, native_every_min = ?, native_state = ? WHERE id = ?", n.accountId,
        JSON.stringify({ query: n.query ?? "", channel: n.channel ?? "", mentionsOnly: !!n.mentionsOnly, leadMin: n.leadMin ?? 10 }), n.everyMin, JSON.stringify({ since: now() }), id);
    }
    return routines.byId(id)!;
  },
  setNativeState: (id: string, state: NativeState, at: number) => q.run("UPDATE routines SET native_state = ?, native_checked_at = ? WHERE id = ?", JSON.stringify(state), at, id),
  /** Atomically notes that this item fired; false when it already had (so nothing ever fires twice). */
  claim: (id: string, item: string): boolean => Number(q.run("INSERT OR IGNORE INTO native_seen (routine_id, item, at) VALUES (?, ?, ?)", id, item.slice(0, 300), now()).changes) === 1,
  seen: (id: string, item: string): boolean => !!q.get("SELECT 1 FROM native_seen WHERE routine_id = ? AND item = ?", id, item.slice(0, 300)),
  forAccount: (accountId: string) => q.all("SELECT * FROM routines WHERE native_account_id = ? AND enabled = 1", accountId).map(toRoutine),
  setWatchState: (id: string, hash: string | null, at: number) => q.run("UPDATE routines SET watch_hash = ?, watch_checked_at = ? WHERE id = ?", hash, at, id),
  update(id: string, f: Partial<{ name: string; prompt: string; schedule: string; timezone: string; runAt: number | null; enabled: boolean }>) {
    const cur = routines.byId(id);
    if (!cur) return null;
    if (f.enabled === true && !cur.enabled) routineGuard(cur.botId);
    // Turned back on by the user: the failure count starts over.
    if (f.enabled === true && !cur.enabled) q.run("UPDATE routines SET failures = 0, paused_reason = NULL WHERE id = ?", id);
    q.run("UPDATE routines SET name = ?, prompt = ?, schedule = ?, timezone = ?, run_at = ?, enabled = ? WHERE id = ?",
      f.name ?? cur.name, f.prompt ?? cur.prompt, f.schedule ?? cur.schedule, f.timezone ?? cur.timezone, f.runAt === undefined ? cur.runAt : f.runAt, (f.enabled ?? cur.enabled) ? 1 : 0, id);
    return routines.byId(id)!;
  },
  markRun: (id: string, at: number) => q.run("UPDATE routines SET last_run_at = ? WHERE id = ?", at, id),
  /** Atomically claims a due slot: false when that slot already fired (two timers, a catch-up and a tick…). */
  claimSlot: (id: string, slot: string): boolean => Number(q.run("UPDATE routines SET last_slot = ? WHERE id = ? AND COALESCE(last_slot, '') != ?", slot, id, slot).changes) === 1,
  setInputsHash: (id: string, hash: string | null) => q.run("UPDATE routines SET inputs_hash = ? WHERE id = ?", hash, id),
  /** A failed run: one more in a row. Returns the new count. */
  failed(id: string): number { q.run("UPDATE routines SET failures = failures + 1 WHERE id = ?", id); return q.get<{ failures: number }>("SELECT failures FROM routines WHERE id = ?", id)?.failures ?? 0; },
  succeeded: (id: string) => q.run("UPDATE routines SET failures = 0 WHERE id = ?", id),
  pauseFor: (id: string, reason: string) => q.run("UPDATE routines SET enabled = 0, paused_reason = ? WHERE id = ?", reason.slice(0, 200), id),
  remove: (id: string) => q.run("DELETE FROM routines WHERE id = ?", id),
};

/** A short history of each routine's runs: when it fired and how it ended. */
export const runs = {
  start(routineId: string): string {
    const id = newId("run");
    q.run("INSERT INTO routine_runs (id, routine_id, at) VALUES (?, ?, ?)", id, routineId, now());
    // Keep the newest 30 per routine.
    q.run(`DELETE FROM routine_runs WHERE routine_id = ? AND id NOT IN (SELECT id FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, rowid DESC LIMIT 30) AND (status != 'running' OR NOT ${queuedRun})`, routineId, routineId);
    return id;
  },
  finish(id: string, status: RoutineRun["status"], note: string, finishWork?: () => void) {
    q.tx(() => {
      q.run("UPDATE routine_runs SET status = ?, note = ? WHERE id = ?", status, note.slice(0, 300), id);
      finishWork?.();
    });
    const r = q.get<{ routine_id: string }>("SELECT routine_id FROM routine_runs WHERE id = ?", id);
    const routine = r ? routines.byId(r.routine_id) : null;
    if (routine) for (const fn of runListeners) { try { fn(routine, status, note); } catch (err) { console.error("[routine run]", err); } }
  },
  /** A run that did not happen (nothing new, or still running): recorded, with no model call. */
  skipped(routineId: string, note: string): string {
    const id = runs.start(routineId);
    q.run("UPDATE routine_runs SET status = 'skipped', note = ? WHERE id = ?", note.slice(0, 300), id);
    return id;
  },
  addCost: (id: string, usd: number) => q.run("UPDATE routine_runs SET cost_usd = cost_usd + ? WHERE id = ?", usd, id),
  /** Whether a run of this routine is still under way (not one a restart left behind). */
  active: hasActiveRun,
  list: (routineId: string): RoutineRun[] =>
    q.all<any>("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, rowid DESC LIMIT 30", routineId).map((r) => ({ id: r.id, routineId: r.routine_id, at: r.at, status: r.status, note: r.note, costUsd: r.cost_usd ?? 0 })),
};

/** Who wants to hear how a run ended (the scheduler: failures in a row, push, auto-pause). */
const runListeners: ((r: RoutineRecord, status: RoutineRun["status"], note: string) => void)[] = [];
export const onRunEnded = (fn: (r: RoutineRecord, status: RoutineRun["status"], note: string) => void) => { runListeners.push(fn); };
