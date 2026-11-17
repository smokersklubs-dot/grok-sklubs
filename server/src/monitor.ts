import { existsSync, readFileSync, statfsSync } from "node:fs";
import { request } from "node:http";
import path from "node:path";
import { computerKind } from "./computer.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { schedulerBeat } from "./scheduler.js";
import { hostedMode, hostedOverBudget, subscriptions } from "./hosted.js";

/**
 * What /api/health checks (SK-P0-08 / monitoring), each with a short code:
 *  - db: SQLite answers and accepts a write (a one-row upsert in `monitor`, inside the normal WAL) — failing it is "down";
 *  - docker: the Docker engine (through the filtering proxy, DOCKER_HOST) answers GET /_ping — only when the bots'
 *    computers are Linux containers; Docker Engine API "Ping": https://docs.docker.com/reference/api/engine/version/v1.47/#tag/System/operation/SystemPing
 *  - disk: free space of the data folder (statfs) against DISK_FREE_MIN_MB (and a hard floor of 256 MB);
 *  - scheduler: its routine tick (every 15 s) ran in the last 2 minutes, unless the scheduler is switched off;
 *  - backup: age of the last backup deploy/backup.sh or the in-app backup (autobackup.ts, "source": "app") recorded in
 *    the data folder (backup-status.json), when there is one:
 *    older than 26 h is "degraded"; no record at all is reported, not counted (backups may live elsewhere);
 *  - queue: the oldest work waiting in a bot's queue (pending for more than 2 h is "degraded").
 * The public route returns only ok / degraded / down and the first problem's code; the detail is for the server's owner.
 */
export type CheckState = "ok" | "degraded" | "down" | "off" | "unknown";
export interface Check { state: CheckState; code: string; detail?: Record<string, unknown> }
export interface HealthReport { status: "ok" | "degraded" | "down"; code: string; at: number; checks: Record<string, Check> }

export const BACKUP_STATUS_FILE = "backup-status.json";
const BACKUP_MAX_AGE_MS = 26 * 3_600_000;
const SCHEDULER_STALE_MS = 2 * 60_000;
const QUEUE_STUCK_MS = 2 * 3_600_000;

function checkDb(): Check {
  try {
    const t = Date.now();
    q.run("INSERT INTO monitor (key, value, at) VALUES ('probe', 'write', ?) ON CONFLICT(key) DO UPDATE SET at = excluded.at", t);
    const back = q.get<{ at: number }>("SELECT at FROM monitor WHERE key = 'probe'")?.at;
    return back === t ? { state: "ok", code: "ok" } : { state: "down", code: "db_readback" };
  } catch (err) {
    return { state: "down", code: "db_write_failed", detail: { error: String((err as Error).message).slice(0, 200) } };
  }
}

/** Where the Docker API is: DOCKER_HOST (tcp:// or unix://), else the default socket. Null: nowhere to ask. */
function dockerTarget(): { host?: string; port?: number; socketPath?: string } | null {
  const h = process.env.DOCKER_HOST ?? "";
  if (h.startsWith("tcp://")) { try { const u = new URL(h.replace(/^tcp:/, "http:")); return { host: u.hostname, port: Number(u.port || 2375) }; } catch { return null; } }
  if (h.startsWith("unix://")) return { socketPath: h.slice(7) };
  if (!h && existsSync("/var/run/docker.sock")) return { socketPath: "/var/run/docker.sock" };
  return null;
}
export async function checkDocker(): Promise<Check> {
  if (computerKind() !== "linux") return { state: "off", code: "not_used" };
  const target = dockerTarget();
  if (!target) return { state: "degraded", code: "docker_not_configured" };
  return pingDocker(target);
}
/** GET /_ping on a Docker API (or the filtering proxy in front of it): 200 "OK" is healthy. Exported for tests. */
export function pingDocker(target: { host?: string; port?: number; socketPath?: string }, timeoutMs = 2000): Promise<Check> {
  return new Promise<Check>((resolve) => {
    const req = request({ ...target, path: "/_ping", method: "GET", timeout: timeoutMs }, (res) => {
      let body = "";
      res.setEncoding("utf8");
      res.on("data", (d) => { if (body.length < 100) body += d; });
      res.on("end", () => resolve(res.statusCode === 200 && body.trim() === "OK" ? { state: "ok", code: "ok" } : { state: "degraded", code: "docker_unhealthy", detail: { status: res.statusCode } }));
    });
    req.on("timeout", () => { req.destroy(); resolve({ state: "degraded", code: "docker_timeout" }); });
    req.on("error", (err) => resolve({ state: "degraded", code: "docker_unreachable", detail: { error: String(err.message).slice(0, 120) } }));
    req.end();
  });
}

function checkDisk(): Check {
  try {
    const s = statfsSync(config.dataDir);
    const freeMb = Math.floor((Number(s.bavail) * Number(s.bsize)) / 1_048_576);
    const totalMb = Math.floor((Number(s.blocks) * Number(s.bsize)) / 1_048_576);
    const detail = { freeMb, totalMb, minFreeMb: config.diskFreeMinMb };
    if (freeMb < 256) return { state: "down", code: "disk_full", detail };
    if (config.diskFreeMinMb > 0 && freeMb < config.diskFreeMinMb) return { state: "degraded", code: "disk_low", detail };
    return { state: "ok", code: "ok", detail };
  } catch (err) {
    return { state: "unknown", code: "disk_unknown", detail: { error: String((err as Error).message).slice(0, 120) } };
  }
}

function checkScheduler(): Check {
  if (config.schedulerOff) return { state: "off", code: "off" };
  const beat = schedulerBeat();
  if (!beat) return { state: "degraded", code: "scheduler_not_started" };
  const age = Date.now() - beat;
  return age > SCHEDULER_STALE_MS ? { state: "degraded", code: "scheduler_stalled", detail: { lastTickSecAgo: Math.round(age / 1000) } } : { state: "ok", code: "ok", detail: { lastTickSecAgo: Math.round(age / 1000) } };
}

/** What deploy/backup.sh wrote after its last run (in the data folder, so the server sees it on VPS and Coolify alike). */
export function backupStatus(): { at: number; archive?: string; ok?: boolean; secrets?: string; source?: string } | null {
  const file = path.join(config.dataDir, BACKUP_STATUS_FILE);
  try {
    const v = JSON.parse(readFileSync(file, "utf8"));
    // source "app": written by the in-app backup to S3 (autobackup.ts); absent: deploy/backup.sh.
    return v && Number.isFinite(Number(v.at)) ? { at: Number(v.at), archive: typeof v.archive === "string" ? v.archive.slice(0, 200) : undefined, ok: v.ok !== false, secrets: typeof v.secrets === "string" ? v.secrets.slice(0, 40) : undefined, source: v.source === "app" ? "app" : "script" } : null;
  } catch { return null; }
}
/** The last restore drill (deploy/restore-drill.sh), shown with the backup; it does not change the status. */
function lastDrill(): { at: string; ok: boolean; archive?: string } | null {
  try {
    const v = JSON.parse(readFileSync(path.join(config.dataDir, "restore-drill-status.json"), "utf8"));
    return Number.isFinite(Number(v?.at)) ? { at: new Date(Number(v.at)).toISOString(), ok: v.ok === true, archive: typeof v.archive === "string" ? v.archive.slice(0, 200) : undefined } : null;
  } catch { return null; }
}
function checkBackup(): Check {
  const b = backupStatus();
  if (!b) return { state: "unknown", code: "no_backup_record", detail: { lastDrill: lastDrill() } };
  const ageH = Math.round(((Date.now() - b.at) / 3_600_000) * 10) / 10;
  const detail = { lastAt: new Date(b.at).toISOString(), ageHours: ageH, archive: b.archive, secrets: b.secrets, source: b.source, lastDrill: lastDrill() };
  if (b.ok === false) return { state: "degraded", code: "backup_failed", detail };
  return Date.now() - b.at > BACKUP_MAX_AGE_MS ? { state: "degraded", code: "backup_old", detail } : { state: "ok", code: "ok", detail };
}

function checkQueue(): Check {
  const r = q.get<{ oldest: number | null; n: number }>("SELECT MIN(created_at) AS oldest, COUNT(*) AS n FROM bot_queue WHERE status = 'pending'");
  const ageMin = r?.oldest ? Math.round((Date.now() - r.oldest) / 60_000) : 0;
  const detail = { pending: r?.n ?? 0, oldestPendingMin: ageMin };
  return r?.oldest && Date.now() - r.oldest > QUEUE_STUCK_MS ? { state: "degraded", code: "queue_stuck", detail } : { state: "ok", code: "ok", detail };
}

/**
 * Hosted mode only (no such check otherwise): how many customer accounts are in each status, and how many have spent
 * this month's AI budget on the service's keys. For the operator's eye; it never changes the status.
 */
function checkHosted(): Check {
  const byStatus: Record<string, number> = {};
  for (const r of q.all<{ status: string; n: number }>("SELECT status, COUNT(*) AS n FROM subscriptions GROUP BY status")) byStatus[r.status] = r.n;
  const overBudget = subscriptions.all().filter((s) => s.status !== "suspended" && hostedOverBudget(s.userId)).length;
  return { state: "ok", code: "ok", detail: { accounts: byStatus, overBudget } };
}

let cached: { at: number; report: HealthReport } | null = null;
let running: Promise<HealthReport> | null = null;
/** Runs every check (at most once every few seconds: the public route may be polled by several monitors). */
export async function healthReport(maxAgeMs = 5000): Promise<HealthReport> {
  if (cached && Date.now() - cached.at < maxAgeMs) return cached.report;
  running ??= (async () => {
    const checks: Record<string, Check> = { db: checkDb(), docker: await checkDocker(), disk: checkDisk(), scheduler: checkScheduler(), backup: checkBackup(), queue: checkQueue(), ...(hostedMode() ? { hosted: checkHosted() } : {}) };
    const order = ["db", "disk", "docker", "scheduler", "queue", "backup"];
    const down = order.find((k) => checks[k].state === "down");
    const degraded = order.find((k) => checks[k].state === "degraded");
    const report: HealthReport = { status: down ? "down" : degraded ? "degraded" : "ok", code: down ? checks[down].code : degraded ? checks[degraded].code : "ok", at: Date.now(), checks };
    cached = { at: Date.now(), report };
    return report;
  })().finally(() => { running = null; });
  return running;
}
/** Tests: forget the cached report. */
export const resetHealthCache = () => { cached = null; };
