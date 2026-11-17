import { mailConfigured, sendSystemMail } from "../accountmail.js";
import { config } from "../config.js";
import { q } from "../db.js";
import { sendPush } from "../push.js";
import type { SentinelDetectorRun, SentinelScanInfo, SentinelSeverity } from "../shared.js";
import { newId } from "../store.js";
import { dispatchAlerts, type AlertSender, type SentAlert } from "./alerts.js";
import { DETECTORS, type Detector, type Observation } from "./detectors.js";
import { SEVERITY_RANK, type IncidentRow } from "./view.js";

/**
 * Sentinelle — the health scanner (ideas from OpenMausBot's Sentinel, Apache-2.0: a read-only scan that groups failures
 * into issues with a stable signature and makes no model call; this code is our own and runs inside the server).
 *
 * Every SENTINEL_EVERY_MIN minutes (default 10; 0 switches it off) one scan runs the detectors (detectors.ts) one after
 * the other, inside a time box (SCAN_LIMITS): a detector still to start when the box is spent is skipped, one that
 * throws or takes too long counts as failed — and an incident only resolves when its own detector ran fine and no
 * longer sees it. The scan reads; the only rows it writes are its own (sentinel_incidents, sentinel_samples,
 * sentinel_alerts). It never calls a model.
 *
 * Lifecycle of an incident (one active row per fingerprint):
 *   open (first seen) → ongoing (seen again: measure, peak, last seen) → resolved (not seen for SENTINEL_QUIET_MIN,
 *   default 30 min). "Acquitter" (acked_at) keeps it active but stops its alerts. Seen again after it resolved: a new
 *   incident (the history keeps each episode).
 */
const envNum = (name: string, fallback: number) => { const v = Number(process.env[name]); return process.env[name] !== undefined && process.env[name] !== "" && Number.isFinite(v) ? v : fallback; };
export const SCAN_LIMITS = {
  everyMin: Math.max(0, envNum("SENTINEL_EVERY_MIN", 10)),
  quietMs: Math.max(1, envNum("SENTINEL_QUIET_MIN", 30)) * 60_000,
  /** No detector starts once the scan has run this long. */
  timeBoxMs: 5_000,
  /** One detector (the Docker ping is the only slow one) is given up after this. */
  detectorTimeoutMs: 3_000,
  keepSamplesMs: 8 * 24 * 3_600_000,
  keepResolvedMs: 90 * 24 * 3_600_000,
  keepAlertsMs: 60 * 24 * 3_600_000,
};

let lastScan: SentinelScanInfo | null = null;
let nextScanAt: number | null = null;
let running: Promise<ScanResult> | null = null;
export const scanState = () => ({ lastScan, nextScanAt, everyMin: SCAN_LIMITS.everyMin });

export interface ScanResult extends SentinelScanInfo { observations: Observation[]; alerts: SentAlert[] }

/** The alerts' real channels: Web Push (push.ts) and the server's own e-mail (accountmail.ts, when SMTP is set). */
export const defaultSender: AlertSender = {
  push: (userId, title, body) => sendPush(userId, { kind: "sentinel", title, body, tag: "sentinel" }),
  mail: (to, subject, text) => sendSystemMail(to, subject, text),
  mailReady: () => mailConfigured(),
};

/** A detector's result, or a failure once `ms` have passed (the timer is cleared as soon as the detector answers). */
function withTimeout<T>(work: Promise<T>, ms: number): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const limit = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error(`took more than ${ms} ms`)), ms); });
  return Promise.race([work, limit]).finally(() => clearTimeout(timer));
}

async function runDetectors(list: Detector[], t: number): Promise<{ runs: SentinelDetectorRun[]; observations: Observation[] }> {
  const started = Date.now();
  const runs: SentinelDetectorRun[] = [];
  const observations: Observation[] = [];
  for (const d of list) {
    if (Date.now() - started > SCAN_LIMITS.timeBoxMs) { runs.push({ name: d.name, ok: false, ms: 0, skipped: true }); continue; }
    const t0 = Date.now();
    try {
      const got = await withTimeout(Promise.resolve().then(() => d.run({ now: t })), SCAN_LIMITS.detectorTimeoutMs);
      observations.push(...got);
      runs.push({ name: d.name, ok: true, ms: Date.now() - t0 });
    } catch (err) {
      runs.push({ name: d.name, ok: false, ms: Date.now() - t0, error: String((err as Error)?.message ?? err).slice(0, 160) });
    }
  }
  return { runs, observations };
}

/** Keeps one observation per fingerprint (the most severe). */
function merge(list: Observation[]): Observation[] {
  const by = new Map<string, Observation>();
  for (const o of list) {
    const cur = by.get(o.fingerprint);
    if (!cur || SEVERITY_RANK[o.severity] > SEVERITY_RANK[cur.severity] || (o.severity === cur.severity && o.count > cur.count)) by.set(o.fingerprint, o);
  }
  return [...by.values()];
}

/** Applies one scan's observations to the incidents (in one transaction). Exported for the lifecycle tests. */
export function applyObservations(observations: Observation[], ranKinds: Set<string>, t: number): { opened: number; resolved: number } {
  let opened = 0, resolved = 0;
  const hour = Math.floor(t / 3_600_000) * 3_600_000;
  q.tx(() => {
    const seen = new Set<string>();
    for (const o of merge(observations)) {
      seen.add(o.fingerprint);
      const cur = q.get<IncidentRow>("SELECT * FROM sentinel_incidents WHERE fingerprint = ? AND status != 'resolved'", o.fingerprint);
      let id: string;
      if (cur) {
        id = cur.id;
        q.run("UPDATE sentinel_incidents SET status = 'ongoing', severity = ?, params = ?, count = ?, peak = MAX(peak, ?), seen = seen + 1, last_at = ?, user_id = ?, bot_id = ? WHERE id = ?",
          o.severity, JSON.stringify(o.params), o.count, o.count, t, o.userId ?? null, o.botId ?? null, id);
      } else {
        id = newId("inc");
        q.run("INSERT INTO sentinel_incidents (id, fingerprint, kind, severity, status, params, user_id, bot_id, count, peak, seen, first_at, last_at) VALUES (?, ?, ?, ?, 'open', ?, ?, ?, ?, ?, 1, ?, ?)",
          id, o.fingerprint, o.kind, o.severity, JSON.stringify(o.params), o.userId ?? null, o.botId ?? null, o.count, o.count, t, t);
        opened++;
      }
      q.run("INSERT INTO sentinel_samples (incident_id, hour, value) VALUES (?, ?, ?) ON CONFLICT(incident_id, hour) DO UPDATE SET value = MAX(value, excluded.value)", id, hour, Math.max(0, Math.round(o.count)));
    }
    // Quiet for the quiet period, and its detector ran fine this time: resolved.
    for (const r of q.all<Pick<IncidentRow, "id" | "fingerprint" | "kind" | "last_at">>("SELECT id, fingerprint, kind, last_at FROM sentinel_incidents WHERE status != 'resolved'")) {
      if (seen.has(r.fingerprint) || !ranKinds.has(r.kind) || t - r.last_at < SCAN_LIMITS.quietMs) continue;
      q.run("UPDATE sentinel_incidents SET status = 'resolved', resolved_at = ? WHERE id = ?", t, r.id);
      resolved++;
    }
    q.run("DELETE FROM sentinel_samples WHERE hour < ?", t - SCAN_LIMITS.keepSamplesMs);
    q.run("DELETE FROM sentinel_incidents WHERE status = 'resolved' AND resolved_at < ?", t - SCAN_LIMITS.keepResolvedMs);
    q.run("DELETE FROM sentinel_alerts WHERE at < ?", t - SCAN_LIMITS.keepAlertsMs);
  });
  return { opened, resolved };
}

/** One scan: detectors, incidents, alerts. Two calls at once share the same scan. */
export function scan(opts: { now?: number; detectors?: Detector[]; send?: AlertSender | null; base?: string } = {}): Promise<ScanResult> {
  running ??= (async () => {
    const t = opts.now ?? Date.now();
    const t0 = Date.now();
    const { runs, observations } = await runDetectors(opts.detectors ?? DETECTORS, t);
    const ran = new Set(runs.filter((r) => r.ok).map((r) => r.name));
    const { opened, resolved } = applyObservations(observations, ran, t);
    let alerts: SentAlert[] = [];
    const send = opts.send === undefined ? defaultSender : opts.send;
    if (send) { try { alerts = await dispatchAlerts(t, send, opts.base ?? config.publicUrl); } catch (err) { console.error("[sentinel alerts]", (err as Error)?.message ?? err); } }
    const info: SentinelScanInfo = { at: t, durationMs: Date.now() - t0, detectors: runs, opened, resolved };
    lastScan = info;
    return { ...info, observations, alerts };
  })().finally(() => { running = null; });
  return running;
}

export function acknowledge(id: string, userId: string, t = Date.now()): boolean {
  return q.run("UPDATE sentinel_incidents SET acked_at = ?, acked_by = ? WHERE id = ? AND status != 'resolved' AND acked_at IS NULL", t, userId, id).changes > 0;
}

export const severityCounts = (): Record<SentinelSeverity, number> => {
  const out: Record<SentinelSeverity, number> = { info: 0, warn: 0, critical: 0 };
  for (const r of q.all<{ severity: SentinelSeverity; n: number }>("SELECT severity, COUNT(*) AS n FROM sentinel_incidents WHERE status != 'resolved' GROUP BY severity")) if (r.severity in out) out[r.severity] = r.n;
  return out;
};

let started = false;
/** Started once with the server (index.ts). The first scan runs a minute after start-up, then every SENTINEL_EVERY_MIN. */
export function startSentinel() {
  if (started || SCAN_LIMITS.everyMin <= 0) return;
  started = true;
  const every = SCAN_LIMITS.everyMin * 60_000;
  const tick = () => { nextScanAt = Date.now() + every; void scan().catch((err) => console.error("[sentinel]", err)); };
  nextScanAt = Date.now() + 60_000;
  setTimeout(() => { tick(); setInterval(tick, every).unref(); }, 60_000).unref();
}
