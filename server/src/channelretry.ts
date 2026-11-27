/*
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/src/host/im/platforms/retry.js, Copyright 2026 Fei2411 and the DS Bot contributors, Apache License 2.0;
 * modified for Sklubot: TypeScript, and a test hook (TELEGRAM_RETRY_MS scales the waits).
 *
 * DS-Bot audit #128: waits between attempts to reach a chat service when the network is down. The first wait is short
 * so a brief drop recovers quickly; it grows to a cap and repeats, so a long outage is retried at a steady pace instead
 * of a request loop. (Slack and Discord already double their wait from CHANNEL_RETRY_MS up to 60 s.)
 */
export const RETRY_DELAYS_MS = [250, 500, 1_000, 2_000, 5_000, 15_000, 30_000] as const;

/** The wait before attempt `attempt` (0 = the first retry). */
export function retryDelay(attempt: number): number {
  const base = RETRY_DELAYS_MS[Math.min(Math.max(Math.floor(attempt), 0), RETRY_DELAYS_MS.length - 1)];
  const scale = Number(process.env.TELEGRAM_RETRY_MS ?? "");
  // Tests set TELEGRAM_RETRY_MS (a fixed short wait, as before); otherwise the growing waits.
  return Number.isFinite(scale) && scale > 0 ? Math.min(base, scale) : base;
}
