/**
 * L142 « graphique 30 jours » (pure, tested in scripts/usage-chart.test.mjs): bar heights for the 30 days of spending
 * from GET /usage/daily (server usagedaily.ts). A day's bar counts what it cost plus the estimate of lines without a
 * known price (shown in another colour, never hidden as 0 $). The scale's top is a round value above the busiest day.
 */
export interface UsageDay { day: string; costUsd: number; estimatedUsd: number; turns: number }

/** A round top for the scale: 1, 2 or 5 × a power of ten, at least the busiest day (0.01 $ when nothing was spent). */
export function niceTop(max: number): number {
  if (!(max > 0)) return 0.01;
  const p = 10 ** Math.floor(Math.log10(max));
  for (const m of [1, 2, 5, 10]) if (m * p >= max - 1e-12) return m * p;
  return 10 * p;
}

export interface Bar { day: string; cost: number; estimate: number; turns: number; costH: number; estimateH: number }

/** Heights in [0, height] for each day's cost and estimate; a day with spending is at least 2 px so it stays visible. */
export function bars(days: UsageDay[], height: number): { top: number; bars: Bar[] } {
  const top = niceTop(Math.max(0, ...days.map((d) => d.costUsd + d.estimatedUsd)));
  const h = (v: number) => (v > 0 ? Math.max(2, (v / top) * height) : 0);
  return { top, bars: days.map((d) => ({ day: d.day, cost: d.costUsd, estimate: d.estimatedUsd, turns: d.turns, costH: h(d.costUsd), estimateH: d.estimatedUsd > 0 ? Math.max(2, (d.estimatedUsd / top) * height) : 0 })) };
}

/** The busiest day, for the sentence under the chart (null when nothing was spent). */
export function busiest(days: UsageDay[]): UsageDay | null {
  let best: UsageDay | null = null;
  for (const d of days) if (d.costUsd + d.estimatedUsd > 0 && (!best || d.costUsd + d.estimatedUsd > best.costUsd + best.estimatedUsd)) best = d;
  return best;
}
