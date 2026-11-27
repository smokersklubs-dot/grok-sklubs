import { q } from "../db.js";
import type { Engine } from "../shared.js";
import { botQueue, bots, type QueuedWork } from "../store.js";

/**
 * L60 — « quota revérifié toutes les 2 min » (backlog A-FAIRE L60; nod, Timon T43 and OMB audits; our own code).
 *
 * A subscription that hit its usage limit WITHOUT saying when it resets is marked "limited" for a conservative hour
 * (sublimit.ts DEFAULT_LIMIT_MS, source 'default'), and the work of a bot without a backup model waits all that time. A
 * window often reopens much sooner. Now, while such a limit lasts, every PROBE_MS (2 minutes) ONE waiting job is let
 * through as a probe: its turn runs on the subscription as usual. If the tool reports the limit again, the limit stands (it
 * is marked anew, the job waits again in its place, as a continuation when the tool had already done something:
 * sublimit.ts waitForSubscription) and the next probe comes 2 minutes later. If the probe's turn finished without a new
 * limit, the subscription is back: the limit is lifted at once and everything that waited runs, in order (sublimit.ts
 * sweepLimits: the usual "available again" notices and pushes). A limit whose reset time the tool gave is never probed:
 * that time is believed. One probe at a time per account and engine; never another login or account.
 */
export const PROBE_MS = 2 * 60_000;

interface Probe { userId: string; engine: Engine; botId: string; jobId: number; until: number; at: number }
/** The probe under way per account and engine, and when the last one started. */
const probes = new Map<string, Probe>();
const lastProbe = new Map<string, number>();
const keyOf = (userId: string, engine: Engine) => `${userId}\n${engine}`;
const engineOfRef = (ref: string | null | undefined): Engine | null => (!ref ? null : ref.startsWith("codex:") ? "codex" : ref.startsWith("claude-code:") ? "claude-code" : null);

/** sublimit.ts subLimitFor: the bot whose job is the probe runs on its subscription while that job is not finished. */
export function probing(userId: string, engine: Engine, botId: string): boolean {
  const p = probes.get(keyOf(userId, engine));
  if (!p || p.botId !== botId) return false;
  const status = botQueue.status(p.jobId);
  return status === "pending" || status === "running";
}

/** For tests. */
export const resetProbes = () => { probes.clear(); lastProbe.clear(); };

/**
 * Called with the limits sweep (sublimit.ts, every 30 s). `rerun`: loop.ts runAgain; `lift`: lifts one limit now and
 * runs what waited (sublimit.ts). Returns what it did, for the tests.
 */
export function sweepProbes(now: number, rerun: (botId: string, list: QueuedWork[]) => number, lift: (userId: string, engine: Engine) => void): { started: number; lifted: number } {
  const out = { started: 0, lifted: 0 };
  const limits = q.all<{ user_id: string; engine: Engine; until: number; detected_at: number }>("SELECT user_id, engine, until, detected_at FROM subscription_limits WHERE source = 'default' AND until > ?", now);
  for (const [key, p] of probes) {
    const status = botQueue.status(p.jobId);
    if (status === "pending" || status === "running") continue;
    probes.delete(key);
    const lim = limits.find((l) => keyOf(l.user_id, l.engine) === key);
    // Finished, and no new limit was reported meanwhile (the limit's time is the one the probe started under): back.
    if (lim && lim.until === p.until && status !== "limited") { lift(p.userId, p.engine); out.lifted++; }
  }
  for (const lim of limits) {
    const key = keyOf(lim.user_id, lim.engine);
    if (probes.has(key) || now - Math.max(lim.detected_at, lastProbe.get(key) ?? 0) < PROBE_MS) continue;
    const waiting = botQueue.limitedBots().map((r) => bots.byId(r.bot_id)).find((b) => b && b.userId === lim.user_id && engineOfRef(b.model) === lim.engine);
    if (!waiting) continue;
    const job = botQueue.limitedFor(waiting.id)[0];
    if (!job) continue;
    lastProbe.set(key, now);
    probes.set(key, { userId: lim.user_id, engine: lim.engine, botId: waiting.id, jobId: job.id, until: lim.until, at: now });
    botQueue.unlimit(job.id);
    rerun(waiting.id, [job]);
    out.started++;
  }
  return out;
}
