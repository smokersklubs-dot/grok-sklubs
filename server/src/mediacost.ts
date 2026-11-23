/**
 * What a picture or a video may cost BEFORE the call (audit Open Generative AI, §2 "Coût" and §5 items 1, 3, 8).
 *
 * Before: with no admin price (VIDEO_PRICE_USD) a video reserved 0 $, so the daily cap, the usage caps and the monthly
 * budget could not stop it before the provider was paid; image_generate reserved nothing at all. Now every paid media
 * call reserves at least a conservative CEILING first (thirdparty.ts reserve), and settles the real cost after.
 *
 * Where a price comes from, in this order:
 *  1. the admin's own price (env): VIDEO_PRICE_USD (per video), IMAGE_PRICE_USD (per picture) — "known", shown as the
 *     estimated cost on the card;
 *  2. otherwise a CEILING below — "unknown": the card says « prix inconnu » and shows the most that is reserved.
 *
 * The ceilings are NOT vendor prices (we do not copy a price list that changes): they are deliberately high so that a
 * budget stops a call it could not pay. Override them per provider with VIDEO_USD_PER_SECOND_<ID> (e.g.
 * VIDEO_USD_PER_SECOND_XAI=0.05) and IMAGE_CEILING_USD. xAI reports the real cost after the call
 * (usage.cost_in_usd_ticks, https://docs.x.ai/developers/rest-api-reference/inference/videos); Gemini's documented
 * responses carry no price, so the ceiling is what is recorded for it unless the admin sets VIDEO_PRICE_USD.
 *
 * Free engines (Wan2GP on the owner's own GPU, the demo clip) cost 0 $ and never show a money card.
 *
 * "Always" on a money card: only when the price is KNOWN and at most MEDIA_ALWAYS_UNDER_USD (default 0.10 $). Any other
 * paid generation asks every time, with its price (audit §3.1: the price before EACH generation above a threshold).
 */

/** Seconds a video lasts when the bot does not say (the tool's own default, "about 8"). */
export const DEFAULT_VIDEO_SECONDS = 8;
/** Longest clip the API providers accept (xAI 1–15 s, Gemini 3–15 s: video.ts). */
export const MAX_VIDEO_SECONDS = 15;
/** Ceiling per second of video, per paid provider (USD). Deliberately above any public list price seen in 2026. */
export const VIDEO_CEILING_USD_PER_SECOND: Readonly<Record<string, number>> = { xai: 0.1, gemini: 0.2 };
/** Ceiling for a provider not listed above. */
export const VIDEO_CEILING_FALLBACK_USD_PER_SECOND = 0.25;
/** Ceiling per generated picture (USD): above the largest "high quality" image prices seen in 2026. */
export const IMAGE_CEILING_USD = 0.25;
/** "Always" is offered on a money card only for a known price at or under this (USD). */
export const MEDIA_ALWAYS_UNDER_USD = 0.1;

export interface MediaCost {
  /** The amount reserved before the call (USD). 0 for a free engine. */
  usd: number;
  /** True when the price comes from the admin (or the engine is free); false for a ceiling. */
  known: boolean;
  /** No money at all (Wan2GP on the owner's GPU, demo). */
  free: boolean;
}

const envNumber = (name: string): number | null => {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return null;
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : null;
};
const FREE_ENGINES = new Set(["wan2gp", "demo"]);

/** Seconds billed for a request (the provider's own range applies; unknown → the default). */
export const billedSeconds = (duration: number | null | undefined) =>
  Math.min(MAX_VIDEO_SECONDS, Math.max(1, Math.round(Number(duration) || DEFAULT_VIDEO_SECONDS)));

/** The most one video of `provider` can cost, before the call. */
export function videoCost(provider: string, duration?: number | null): MediaCost {
  if (FREE_ENGINES.has(provider)) return { usd: 0, known: true, free: true };
  const admin = envNumber("VIDEO_PRICE_USD");
  if (admin !== null && admin > 0) return { usd: admin, known: true, free: false };
  const perSecond = envNumber(`VIDEO_USD_PER_SECOND_${provider.toUpperCase()}`) ?? VIDEO_CEILING_USD_PER_SECOND[provider] ?? VIDEO_CEILING_FALLBACK_USD_PER_SECOND;
  return { usd: Math.round(perSecond * billedSeconds(duration) * 100) / 100, known: false, free: false };
}

/** The most one picture can cost, before the call (`free` for a local engine). */
export function imageCost(provider = "api"): MediaCost {
  if (FREE_ENGINES.has(provider)) return { usd: 0, known: true, free: true };
  const admin = envNumber("IMAGE_PRICE_USD");
  if (admin !== null && admin > 0) return { usd: admin, known: true, free: false };
  return { usd: envNumber("IMAGE_CEILING_USD") ?? IMAGE_CEILING_USD, known: false, free: false };
}

/** Whether a money card may offer "Always" (a known, small price); otherwise it asks before each generation. */
export function alwaysAllowed(cost: MediaCost): boolean {
  const limit = envNumber("MEDIA_ALWAYS_UNDER_USD") ?? MEDIA_ALWAYS_UNDER_USD;
  return cost.free || (cost.known && cost.usd <= limit);
}

/** The card's extra line (English template, translated in i18n): the estimated price, or « prix inconnu » and the ceiling. */
export function costNote(cost: MediaCost, unit: "video" | "picture"): string {
  if (cost.known) return unit === "video" ? "Estimated cost: {cost} $ per video, reserved before the call and settled at the real cost." : "Estimated cost: {cost} $ per picture, reserved before the call and settled at the real cost.";
  return unit === "video"
    ? "The price is not known in advance: up to {cost} $ is reserved before the call (a ceiling, so your budget can stop it), and the real cost is recorded after."
    : "The price is not known in advance: up to {cost} $ per picture is reserved before the call (a ceiling, so your budget can stop it), and the real cost is recorded after.";
}

/**
 * The line added when a paid call failed and its reservation was released (adapted from Open Generative AI's
 * appendGenerationRefundNotice, packages/studio/src/utils/generationLifecycle.js, MIT, Copyright (c) 2026 Open
 * Generative AI Contributors; modified for Sklubot: our reservation instead of MuAPI credits, a provider's own refund
 * kept when it reports one).
 */
export function refundNotice(message: string, f: { reservedUsd: number; providerRefund?: { refunded?: boolean; amount?: number; unit?: string } | null }): string {
  const own = f.reservedUsd > 0 ? ` The ${f.reservedUsd.toFixed(2)} $ reserved for it was released: nothing was charged.` : " Nothing was charged.";
  const pr = f.providerRefund;
  if (pr?.refunded !== true) return `${message}${own}`;
  const n = pr.amount;
  const unit = pr.unit || "credit";
  const theirs = Number.isFinite(n) ? ` The provider refunded ${n} ${unit}${n === 1 ? "" : "s"}.` : " The provider refunded the generation.";
  return `${message}${own}${theirs}`;
}
