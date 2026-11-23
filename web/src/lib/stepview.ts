/**
 * L142 (pure, tested in scripts/stepview.test.mjs): the words of a background task's cost line and of a step's detail —
 * a running time in short words, a spend that keeps the conservative estimate of unknown prices visible, and a step's
 * arguments as readable lines. Server side: server/src/stepdetail.ts.
 */

/** "45 s", "3 min", "1 h 05", for a duration in milliseconds (a negative one counts as 0). */
export function durationText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, "0")}`;
}

/** The spend in dollars: "0,03 $" style through `fmt`, with "≈ +0,01 $" for the estimate of unknown prices; "" when nothing. */
export function spendText(costUsd: number, estimatedUsd: number, fmt: (n: number) => string): { cost: string; estimate: string } {
  return { cost: fmt(Math.max(0, costUsd)), estimate: estimatedUsd > 0 ? `≈ +${fmt(estimatedUsd)}` : "" };
}

/** A step's arguments as [name, value] lines; objects and long values are shown whole, as indented JSON. */
export function argLines(args: Record<string, unknown>): [string, string][] {
  return Object.entries(args ?? {}).map(([k, v]) => [k, typeof v === "string" ? v : JSON.stringify(v, null, 2) ?? String(v)]);
}
