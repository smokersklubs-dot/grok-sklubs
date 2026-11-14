import { q } from "./db.js";
import { config } from "./config.js";
import { describeCron, nextRun } from "./cron.js";
import { newId, now, randomToken } from "./store.js";
import { tr } from "./i18n.js";
import { NATIVE_TRIGGERS, type Locale, type NativeTrigger, type Routine, type RoutineRun } from "./shared.js";

/** Where a built-in app trigger's last check stopped: a time, Outlook's delta link, Slack's last ts per channel. */
export interface NativeState { since?: number; deltaLink?: string; lastTs?: Record<string, string> }
export interface RoutineRecord extends Routine { hookToken: string | null; watchHash: string | null; nativeState: NativeState }
export const isNativeTrigger = (t: string): t is NativeTrigger => (NATIVE_TRIGGERS as readonly string[]).includes(t);
const APP_NAMES: Record<string, string> = { gmail: "Gmail", gcalendar: "Google Calendar", gdrive: "Google Drive", outlook: "Outlook", slack: "Slack" };

export function describeRoutine(r: { trigger: string; schedule: string; runAt: number | null; timezone: string; native?: Routine["native"] }, locale?: Locale): string {
  if (r.trigger === "webhook") return tr(locale, "When its web address is called");
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

function toRoutine(r: any): RoutineRecord {
  const enabled = !!r.enabled;
  const native = nativeOf(r);
  let nativeState: NativeState = {};
  try { nativeState = JSON.parse(r.native_state || "{}"); } catch { /* start over */ }
  const next = !enabled ? null : r.trigger === "cron" ? nextRun(r.schedule, r.timezone, now()) : r.trigger === "once" && r.run_at > now() ? r.run_at : null;
  return {
    id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, trigger: r.trigger, schedule: r.schedule, timezone: r.timezone,
    runAt: r.run_at, hookToken: r.hook_token, watchHash: r.watch_hash ?? null,
    watch: r.trigger === "watch" ? { kind: r.watch_kind, target: r.watch_target, everyMin: r.watch_every_min, lastCheckedAt: r.watch_checked_at ?? null } : null, hookUrl: r.hook_token ? `${config.publicUrl}/api/hooks/${r.hook_token}` : null,
    native, nativeState,
    enabled, lastRunAt: r.last_run_at, nextRunAt: next, describe: describeRoutine({ trigger: r.trigger, schedule: r.schedule, runAt: r.run_at, timezone: r.timezone, native }),
    createdAt: r.created_at,
  };
}

export const publicRoutine = ({ hookToken, watchHash, nativeState, ...rest }: RoutineRecord, locale?: Locale): Routine => ({ ...rest, describe: describeRoutine(rest, locale) });

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
  create(botId: string, f: { name: string; prompt: string; trigger: Routine["trigger"]; schedule?: string; timezone?: string; runAt?: number | null; watch?: { kind: string; target: string; everyMin: number }; native?: { accountId: string; query?: string; channel?: string; mentionsOnly?: boolean; leadMin?: number; everyMin: number } }): RoutineRecord {
    const id = newId("rtn");
    q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, run_at, hook_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, botId, f.name.trim().slice(0, 80), f.prompt.trim(), f.trigger, f.schedule ?? "", f.timezone ?? "UTC", f.runAt ?? null, f.trigger === "webhook" ? randomToken(24) : null, now());
    if (f.watch) q.run("UPDATE routines SET watch_kind = ?, watch_target = ?, watch_every_min = ? WHERE id = ?", f.watch.kind, f.watch.target, f.watch.everyMin, id);
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
    q.run("UPDATE routines SET name = ?, prompt = ?, schedule = ?, timezone = ?, run_at = ?, enabled = ? WHERE id = ?",
      f.name ?? cur.name, f.prompt ?? cur.prompt, f.schedule ?? cur.schedule, f.timezone ?? cur.timezone, f.runAt === undefined ? cur.runAt : f.runAt, (f.enabled ?? cur.enabled) ? 1 : 0, id);
    return routines.byId(id)!;
  },
  markRun: (id: string, at: number) => q.run("UPDATE routines SET last_run_at = ? WHERE id = ?", at, id),
  remove: (id: string) => q.run("DELETE FROM routines WHERE id = ?", id),
};

/** A short history of each routine's runs: when it fired and how it ended. */
export const runs = {
  start(routineId: string): string {
    const id = newId("run");
    q.run("INSERT INTO routine_runs (id, routine_id, at) VALUES (?, ?, ?)", id, routineId, now());
    // Keep the newest 30 per routine.
    q.run("DELETE FROM routine_runs WHERE routine_id = ? AND id NOT IN (SELECT id FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, rowid DESC LIMIT 30)", routineId, routineId);
    return id;
  },
  finish: (id: string, status: RoutineRun["status"], note: string) => q.run("UPDATE routine_runs SET status = ?, note = ? WHERE id = ?", status, note.slice(0, 300), id),
  list: (routineId: string): RoutineRun[] =>
    q.all<any>("SELECT * FROM routine_runs WHERE routine_id = ? ORDER BY at DESC, rowid DESC LIMIT 30", routineId).map((r) => ({ id: r.id, routineId: r.routine_id, at: r.at, status: r.status, note: r.note })),
};
