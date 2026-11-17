import { statfsSync } from "node:fs";
import { computerKind } from "../computer.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { hostedMode, hostedSettings, isOperator, monthBounds, plans } from "../hosted.js";
import { backupStatus, checkDocker } from "../monitor.js";
import { schedulerBeat } from "../scheduler.js";
import { mailConfigured } from "../accountmail.js";
import { turnstileKeys, verificationWanted } from "../publicsignup.js";
import type { SentinelSeverity } from "../shared.js";
import { countSignals } from "./signals.js";

/**
 * Sentinelle — the detectors. Each one reads what it needs, strictly read-only (SELECTs on indexed columns over a short
 * window, the in-process signals of signals.ts, statfs, a GET /_ping), and returns observations: a stable fingerprint
 * for the problem, a severity, the measure (`count`) and a few numbers for the explanation (`params`). No detector
 * calls a model, writes a row, or keeps a message's text: identifiers and numbers only.
 *
 * Thresholds (THRESHOLDS below; the windows are fixed):
 *  - tool_errors       failed tool calls per bot and tool in 1 h (action_journal): ≥ 5 warn; ≥ 20, or ≥ 10 with ≥ 80 % failing, critical
 *  - turn_failures     failed model calls / subscription turns per provider and error class in 1 h (signals):
 *                      auth ≥ 1 warn, ≥ 3 critical; rate_limit ≥ 5 warn, ≥ 20 critical; context ≥ 3 warn, ≥ 10 critical;
 *                      others (overloaded, server, network, timeout, other) ≥ 5 warn, ≥ 20 critical
 *  - engine_watch      turn-watch notices in 6 h: stalled (audit) and engine gone (audit) ≥ 3 warn, ≥ 10 critical;
 *                      silent first reply (signals) ≥ 5 info, ≥ 15 warn
 *  - routine_failures  a routine with ≥ 3 failures in a row (warn), or paused by the server (warn)
 *  - connector_auth    an account's connections or keys refused (credential_health "broken"/"reconnect", built-in app accounts to sign in again): ≥ 1 warn
 *  - queue_stuck       queued work pending for more than 2 h: warn; more than 6 h: critical
 *  - disk_low          free space of the data folder under DISK_FREE_MIN_MB or 5 %: warn; under 256 MB: critical
 *  - backup            last backup failed, or ≥ 2 in-app failures in a row: critical; last success older than 26 h: warn, 72 h: critical
 *  - hosted_budget     hosted mode: customer accounts that spent their month's AI budget: info
 *  - docker            Linux computers: /_ping through the proxy fails: critical; refused/failed Docker calls in 1 h ≥ 5 warn, ≥ 30 critical
 *  - cost_spike        an account's spend in the last 24 h ≥ 3× its daily average of the 7 days before and ≥ 5 $: warn; ≥ 6× and ≥ 20 $: critical
 *  - login_failures    failed password sign-ins in 15 min: ≥ 20 in all or ≥ 10 from one address warn; ≥ 100 critical
 *  - error_rate        lines on the error log in 1 h ≥ 30 warn, ≥ 200 critical; an uncaught exception in 1 h: warn
 *  - scheduler         the scheduler's tick is more than 2 min old (unless switched off): critical
 *  - public_signup     open to the public without SMTP (no e-mail verification): warn; OPEN_SIGNUP without Turnstile: info
 */
export interface Observation {
  fingerprint: string;
  kind: string;
  severity: SentinelSeverity;
  count: number;
  params: Record<string, string | number>;
  userId?: string | null;
  botId?: string | null;
}
export interface DetectorContext { now: number }
export interface Detector { name: string; run(ctx: DetectorContext): Observation[] | Promise<Observation[]> }

const H = 3_600_000;
export const THRESHOLDS = {
  toolErrors: { windowMs: H, warn: 5, critical: 20, criticalRatioMin: 10, criticalRatio: 0.8 },
  turnFailures: { windowMs: H, auth: [1, 3], rate_limit: [5, 20], context: [3, 10], other: [5, 20] } as const,
  engineWatch: { windowMs: 6 * H, stalled: [3, 10], gone: [3, 10], silent: [5, 15] } as const,
  routineFailures: { failing: 3 },
  queue: { warnMs: 2 * H, criticalMs: 6 * H },
  disk: { criticalMb: 256, warnPct: 5 },
  backup: { warnHours: 26, criticalHours: 72, failures: 2 },
  docker: { windowMs: H, warn: 5, critical: 30 },
  cost: { ratioWarn: 3, ratioCritical: 6, minUsd: 5, criticalUsd: 20 },
  login: { windowMs: 15 * 60_000, warn: 20, perSource: 10, critical: 100 },
  errors: { windowMs: H, warn: 30, critical: 200 },
  scheduler: { staleMs: 2 * 60_000 },
};

const level = (n: number, [warn, critical]: readonly [number, number]): SentinelSeverity | null => (n >= critical ? "critical" : n >= warn ? "warn" : null);

const toolErrors: Detector = {
  name: "tool_errors",
  run({ now }) {
    const t = THRESHOLDS.toolErrors;
    const rows = q.all<{ user_id: string; bot_id: string; tool: string; failed: number; total: number }>(
      `SELECT user_id, bot_id, tool, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed, COUNT(*) AS total
       FROM action_journal WHERE at >= ? GROUP BY bot_id, tool HAVING failed >= ? ORDER BY failed DESC LIMIT 200`, now - t.windowMs, t.warn);
    return rows.map((r) => {
      const critical = r.failed >= t.critical || (r.failed >= t.criticalRatioMin && r.failed / Math.max(1, r.total) >= t.criticalRatio);
      return { fingerprint: `tool_errors:${r.bot_id}:${r.tool}`, kind: "tool_errors", severity: critical ? "critical" : "warn", count: r.failed, params: { tool: r.tool, failed: r.failed, total: r.total }, userId: r.user_id, botId: r.bot_id };
    });
  },
};

const turnFailures: Detector = {
  name: "turn_failures",
  run({ now }) {
    const t = THRESHOLDS.turnFailures;
    const out: Observation[] = [];
    for (const s of countSignals("turn_failure", now - t.windowMs)) {
      const [provider, code] = s.key.split(":");
      const sev = level(s.count, code === "auth" ? t.auth : code === "rate_limit" ? t.rate_limit : code === "context" ? t.context : t.other);
      if (sev) out.push({ fingerprint: `turn_failures:${provider}:${code}`, kind: "turn_failures", severity: sev, count: s.count, params: { v: code, provider, code, n: s.count } });
    }
    return out;
  },
};

const engineWatch: Detector = {
  name: "engine_watch",
  run({ now }) {
    const t = THRESHOLDS.engineWatch;
    const since = now - t.windowMs;
    // The texts written by agent/watch.ts ("no progress for N min in the running turn") and agent/loop.ts ("… ended without finishing the turn").
    const r = q.get<{ stalled: number | null; gone: number | null }>(
      `SELECT SUM(CASE WHEN text LIKE '%: no progress for % min in the running turn' THEN 1 ELSE 0 END) AS stalled,
              SUM(CASE WHEN text LIKE '%: Claude Code ended without finishing the turn' OR text LIKE '%: Codex ended without finishing the turn' THEN 1 ELSE 0 END) AS gone
       FROM audit WHERE at >= ? AND kind = 'system'`, since);
    const silent = countSignals("engine_silent", since).reduce((a, s) => a + s.count, 0);
    const out: Observation[] = [];
    const add = (v: "stalled" | "gone", n: number) => { const sev = level(n, t[v]); if (sev) out.push({ fingerprint: `engine_watch:${v}`, kind: "engine_watch", severity: sev, count: n, params: { v, n } }); };
    add("stalled", r?.stalled ?? 0);
    add("gone", r?.gone ?? 0);
    if (silent >= t.silent[0]) out.push({ fingerprint: "engine_watch:silent", kind: "engine_watch", severity: silent >= t.silent[1] ? "warn" : "info", count: silent, params: { v: "silent", n: silent } });
    return out;
  },
};

const routineFailures: Detector = {
  name: "routine_failures",
  run() {
    const rows = q.all<{ id: string; failures: number; enabled: number; paused_reason: string | null; bot_id: string; user_id: string }>(
      `SELECT r.id, r.failures, r.enabled, r.paused_reason, r.bot_id, b.user_id FROM routines r JOIN bots b ON b.id = r.bot_id
       WHERE r.failures >= ? OR (r.enabled = 0 AND r.paused_reason IS NOT NULL AND r.failures > 0) LIMIT 500`, THRESHOLDS.routineFailures.failing);
    return rows.map((r) => {
      const paused = !r.enabled && !!r.paused_reason;
      return { fingerprint: `routine_failures:${r.id}`, kind: "routine_failures", severity: "warn" as const, count: r.failures, params: { v: paused ? "paused" : "failing", routineId: r.id, n: r.failures }, userId: r.user_id, botId: r.bot_id };
    });
  },
};

const connectorAuth: Detector = {
  name: "connector_auth",
  run() {
    const per = new Map<string, number>();
    for (const r of q.all<{ user_id: string; n: number }>("SELECT user_id, COUNT(*) AS n FROM credential_health WHERE state IN ('broken', 'reconnect') GROUP BY user_id")) per.set(r.user_id, (per.get(r.user_id) ?? 0) + r.n);
    // A built-in app account that was signed in and lost it (needs_auth with a reason); a new one never signed in is not a failure.
    for (const r of q.all<{ user_id: string; n: number }>("SELECT user_id, COUNT(*) AS n FROM native_accounts WHERE status = 'needs_auth' AND error IS NOT NULL AND error != '' GROUP BY user_id")) per.set(r.user_id, (per.get(r.user_id) ?? 0) + r.n);
    return [...per].map(([userId, n]) => ({ fingerprint: `connector_auth:${userId}`, kind: "connector_auth", severity: "warn" as const, count: n, params: { n }, userId }));
  },
};

const queueStuck: Detector = {
  name: "queue_stuck",
  run({ now }) {
    const t = THRESHOLDS.queue;
    const r = q.get<{ n: number; oldest: number | null }>("SELECT COUNT(*) AS n, MIN(created_at) AS oldest FROM bot_queue WHERE status = 'pending' AND created_at < ?", now - t.warnMs);
    if (!r?.n || !r.oldest) return [];
    const age = now - r.oldest;
    return [{ fingerprint: "queue_stuck", kind: "queue_stuck", severity: age > t.criticalMs ? "critical" : "warn", count: r.n, params: { n: r.n, age: Math.round(age / 60_000) } }];
  },
};

/** statfs of the data folder; injectable for tests. */
export const diskProbe = { read(): { freeMb: number; totalMb: number } | null {
  try {
    const s = statfsSync(config.dataDir);
    return { freeMb: Math.floor((Number(s.bavail) * Number(s.bsize)) / 1_048_576), totalMb: Math.floor((Number(s.blocks) * Number(s.bsize)) / 1_048_576) };
  } catch { return null; }
} };
const diskLow: Detector = {
  name: "disk_low",
  run() {
    const d = diskProbe.read();
    if (!d) return [];
    const t = THRESHOLDS.disk;
    const params = { freeMb: d.freeMb, totalMb: d.totalMb, minMb: config.diskFreeMinMb };
    if (d.freeMb < t.criticalMb) return [{ fingerprint: "disk_low", kind: "disk_low", severity: "critical", count: d.freeMb, params: { v: "full", ...params } }];
    const low = (config.diskFreeMinMb > 0 && d.freeMb < config.diskFreeMinMb) || (d.totalMb > 0 && (d.freeMb / d.totalMb) * 100 < t.warnPct);
    return low ? [{ fingerprint: "disk_low", kind: "disk_low", severity: "warn", count: d.freeMb, params: { v: "low", ...params } }] : [];
  },
};

const backup: Detector = {
  name: "backup",
  run({ now }) {
    const t = THRESHOLDS.backup;
    const out: Observation[] = [];
    const status = backupStatus();
    const app = q.get<{ failures: number; enabled: number }>("SELECT failures, enabled FROM instance_backup WHERE id = 1");
    const failures = app?.enabled ? app.failures : 0;
    if (status?.ok === false || failures >= t.failures) out.push({ fingerprint: "backup:failed", kind: "backup", severity: "critical", count: Math.max(1, failures), params: { v: "failed", failures: Math.max(1, failures) } });
    // Age of the last success: the in-app history when there is one, else the status file (deploy/backup.sh).
    const lastOk = q.get<{ at: number | null }>("SELECT MAX(finished_at) AS at FROM backup_runs WHERE ok = 1")?.at ?? (status?.ok ? status.at : null);
    const configured = !!app?.enabled || !!status;
    if (configured && lastOk) {
      const hours = Math.floor((now - lastOk) / H);
      if (hours >= t.warnHours) out.push({ fingerprint: "backup:old", kind: "backup", severity: hours >= t.criticalHours ? "critical" : "warn", count: hours, params: { v: "old", hours } });
    }
    return out;
  },
};

const hostedBudget: Detector = {
  name: "hosted_budget",
  run({ now }) {
    if (!hostedMode()) return [];
    // Read-only on purpose: budgetEur() would create a missing subscription; only accounts that have one are looked at.
    const month = monthBounds(now);
    const rate = hostedSettings.get().usdToEur;
    const trialBudget = hostedSettings.get().trialBudgetEur;
    let n = 0;
    for (const s of q.all<{ user_id: string; plan_id: string; status: string; spent: number | null; credit: number | null }>(
      `SELECT s.user_id, s.plan_id, s.status,
         (SELECT SUM(cost_usd + est_cost_usd) FROM usage u WHERE u.user_id = s.user_id AND u.payer = 'operator' AND u.at >= ?) AS spent,
         (SELECT SUM(amount_eur) FROM credit_topups c WHERE c.user_id = s.user_id AND c.month = ?) AS credit
       FROM subscriptions s WHERE s.status != 'suspended'`, month.start, month.label)) {
      if (isOperator(s.user_id)) continue;
      const plan = plans.get(s.plan_id);
      const base = !plan || plan.kind === "byok" ? 0 : s.status === "trial" ? Math.min(plan.aiBudgetEur, trialBudget) : plan.aiBudgetEur;
      const spent = s.spent ?? 0;
      if (spent > 0 && spent * rate >= base + (s.credit ?? 0) - 1e-9) n++;
    }
    return n ? [{ fingerprint: "hosted_budget", kind: "hosted_budget", severity: "info", count: n, params: { n } }] : [];
  },
};

/**
 * A server open to the public (OPEN_SIGNUP or HOSTED_MODE, publicsignup.ts) without SMTP cannot verify new accounts'
 * addresses (verification is skipped) nor send "forgotten password" links: warn. OPEN_SIGNUP without Turnstile: info.
 */
const publicSignup: Detector = {
  name: "public_signup",
  run() {
    const out: Observation[] = [];
    if (verificationWanted() && !mailConfigured()) out.push({ fingerprint: "public_signup:no_mail", kind: "public_signup", severity: "warn", count: 1, params: { v: "no_mail" } });
    if (config.openSignup && !turnstileKeys()) out.push({ fingerprint: "public_signup:no_turnstile", kind: "public_signup", severity: "info", count: 1, params: { v: "no_turnstile" } });
    return out;
  },
};

const docker: Detector = {
  name: "docker",
  async run({ now }) {
    const t = THRESHOLDS.docker;
    const out: Observation[] = [];
    if (computerKind() === "linux") {
      const c = await checkDocker();
      if (c.state === "degraded" || c.state === "down") out.push({ fingerprint: "docker:unreachable", kind: "docker", severity: "critical", count: 1, params: { v: "unreachable", code: c.code } });
    }
    for (const s of countSignals("docker_error", now - t.windowMs)) {
      const sev = level(s.count, [t.warn, t.critical]);
      if (sev) out.push({ fingerprint: `docker:errors:${s.key}`, kind: "docker", severity: sev, count: s.count, params: { v: "errors", class: s.key, n: s.count } });
    }
    return out;
  },
};

const costSpike: Detector = {
  name: "cost_spike",
  run({ now }) {
    const t = THRESHOLDS.cost;
    const day = now - 24 * H;
    const rows = q.all<{ user_id: string; last: number | null; base: number | null }>(
      `SELECT user_id, SUM(CASE WHEN at >= ? THEN cost_usd + est_cost_usd ELSE 0 END) AS last, SUM(CASE WHEN at < ? THEN cost_usd + est_cost_usd ELSE 0 END) AS base
       FROM usage WHERE at >= ? GROUP BY user_id`, day, day, now - 8 * 24 * H);
    const out: Observation[] = [];
    for (const r of rows) {
      const last = r.last ?? 0;
      const base = (r.base ?? 0) / 7;
      if (last < t.minUsd) continue;
      const ratio = base > 0 ? last / base : Infinity;
      if (ratio < t.ratioWarn) continue;
      const critical = ratio >= t.ratioCritical && last >= t.criticalUsd;
      out.push({ fingerprint: `cost_spike:${r.user_id}`, kind: "cost_spike", severity: critical ? "critical" : "warn", count: Math.round(last), params: { last: last.toFixed(2), base: base.toFixed(2), ratio: Number.isFinite(ratio) ? Math.round(ratio * 10) / 10 : 0 }, userId: r.user_id });
    }
    return out;
  },
};

const loginFailures: Detector = {
  name: "login_failures",
  run({ now }) {
    const t = THRESHOLDS.login;
    const per = countSignals("login_failure", now - t.windowMs);
    const n = per.reduce((a, s) => a + s.count, 0);
    const top = per[0]?.count ?? 0;
    if (n < t.warn && top < t.perSource) return [];
    return [{ fingerprint: "login_failures", kind: "login_failures", severity: n >= t.critical ? "critical" : "warn", count: n, params: { n, sources: per.length } }];
  },
};

const errorRate: Detector = {
  name: "error_rate",
  run({ now }) {
    const t = THRESHOLDS.errors;
    const out: Observation[] = [];
    const n = countSignals("error_log", now - t.windowMs).reduce((a, s) => a + s.count, 0);
    const sev = level(n, [t.warn, t.critical]);
    if (sev) out.push({ fingerprint: "error_rate:log", kind: "error_rate", severity: sev, count: n, params: { v: "log", n } });
    const u = countSignals("uncaught", now - t.windowMs).reduce((a, s) => a + s.count, 0);
    if (u) out.push({ fingerprint: "error_rate:uncaught", kind: "error_rate", severity: "warn", count: u, params: { v: "uncaught", n: u } });
    return out;
  },
};

const scheduler: Detector = {
  name: "scheduler",
  run({ now }) {
    if (config.schedulerOff) return [];
    const beat = schedulerBeat();
    if (!beat || now - beat <= THRESHOLDS.scheduler.staleMs) return [];
    return [{ fingerprint: "scheduler", kind: "scheduler", severity: "critical", count: 1, params: { min: Math.round((now - beat) / 60_000) } }];
  },
};

/** In the order they run (the cheapest and most telling first; the scan stops starting new ones past its time box). */
export const DETECTORS: Detector[] = [scheduler, diskLow, queueStuck, backup, errorRate, loginFailures, turnFailures, engineWatch, toolErrors, routineFailures, connectorAuth, costSpike, hostedBudget, publicSignup, docker];
