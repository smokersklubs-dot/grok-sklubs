/**
 * L142 « graphique 30 jours »: what the account spent each day over the last 30 days (UTC days, oldest first, every day
 * present even with nothing spent), from the same usage lines as Settings → Usage (usage.ts). A line without a known
 * price counts its conservative estimate apart (estimatedUsd), never as 0 $ hidden in the cost.
 */
import type { Hono } from "hono";
import { q } from "./db.js";
import type { UserRecord } from "./store.js";

export const DAILY_DAYS = 30;
const DAY = 86_400_000;

export interface UsageDay { day: string; costUsd: number; estimatedUsd: number; turns: number }

export function usageDaily(userId: string, nowMs = Date.now(), days = DAILY_DAYS): { days: UsageDay[]; totalUsd: number; estimatedUsd: number } {
  const today = Math.floor(nowMs / DAY) * DAY;
  const start = today - (days - 1) * DAY;
  const rows = q.all<{ d: number; c: number; e: number; n: number }>(
    `SELECT CAST(at / ${DAY} AS INTEGER) AS d, SUM(cost_usd) AS c, SUM(COALESCE(est_cost_usd, 0)) AS e, COUNT(*) AS n
     FROM usage WHERE user_id = ? AND at >= ? AND at < ? GROUP BY d`, userId, start, today + DAY);
  const by = new Map(rows.map((r) => [r.d, r]));
  const out: UsageDay[] = [];
  for (let i = 0; i < days; i++) {
    const ms = start + i * DAY, r = by.get(ms / DAY);
    out.push({ day: new Date(ms).toISOString().slice(0, 10), costUsd: r?.c ?? 0, estimatedUsd: r?.e ?? 0, turns: r?.n ?? 0 });
  }
  return { days: out, totalUsd: out.reduce((a, d) => a + d.costUsd, 0), estimatedUsd: out.reduce((a, d) => a + d.estimatedUsd, 0) };
}

export function registerUsageDaily(api: Hono<{ Variables: { user: UserRecord } }>) {
  api.get("/usage/daily", (c) => c.json(usageDaily(c.get("user").id)));
}
