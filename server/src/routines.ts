import { q } from "./db.js";
import { config } from "./config.js";
import { describeCron, nextRun } from "./cron.js";
import { newId, now, randomToken } from "./store.js";
import type { Routine } from "./shared.js";

export interface RoutineRecord extends Routine { hookToken: string | null }

export function describeRoutine(r: { trigger: string; schedule: string; runAt: number | null; timezone: string }): string {
  if (r.trigger === "webhook") return "When its web address is called";
  if (r.trigger === "once")
    return r.runAt ? `Once on ${new Date(r.runAt).toLocaleString("en-US", { timeZone: r.timezone, dateStyle: "medium", timeStyle: "short" })}` : "Once";
  return describeCron(r.schedule);
}

function toRoutine(r: any): RoutineRecord {
  const enabled = !!r.enabled;
  const next = !enabled ? null : r.trigger === "cron" ? nextRun(r.schedule, r.timezone, now()) : r.trigger === "once" && r.run_at > now() ? r.run_at : null;
  return {
    id: r.id, botId: r.bot_id, name: r.name, prompt: r.prompt, trigger: r.trigger, schedule: r.schedule, timezone: r.timezone,
    runAt: r.run_at, hookToken: r.hook_token, hookUrl: r.hook_token ? `${config.publicUrl}/api/hooks/${r.hook_token}` : null,
    enabled, lastRunAt: r.last_run_at, nextRunAt: next, describe: describeRoutine({ trigger: r.trigger, schedule: r.schedule, runAt: r.run_at, timezone: r.timezone }),
    createdAt: r.created_at,
  };
}

export const publicRoutine = ({ hookToken, ...rest }: RoutineRecord): Routine => rest;

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
  create(botId: string, f: { name: string; prompt: string; trigger: Routine["trigger"]; schedule?: string; timezone?: string; runAt?: number | null }): RoutineRecord {
    const id = newId("rtn");
    q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, run_at, hook_token, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, botId, f.name.trim().slice(0, 80), f.prompt.trim(), f.trigger, f.schedule ?? "", f.timezone ?? "UTC", f.runAt ?? null, f.trigger === "webhook" ? randomToken(24) : null, now());
    return routines.byId(id)!;
  },
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
