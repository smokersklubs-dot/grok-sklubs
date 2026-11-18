/**
 * Stripe, for prepaid AI credits only (credits.ts): one Checkout Session per purchase, and the signed webhook that says it
 * was paid. Plain fetch, no SDK. Written from Stripe's documentation (read 2026-11-18); every endpoint, parameter and
 * header used below is cited there:
 *
 *  - Create a Checkout Session — https://docs.stripe.com/api/checkout/sessions/create
 *      POST https://api.stripe.com/v1/checkout/sessions, form-encoded (`-d "line_items[0][quantity]=2"`), authenticated
 *      with the secret key as the HTTP Basic user and an empty password (`curl -u "<<YOUR_SECRET_KEY>>:"`).
 *      Parameters used: `mode` (enum: payment | setup | subscription; "payment" = one-time payment), `line_items[0]` with
 *      `price_data.currency` (lowercase ISO code), `price_data.unit_amount` ("a non-negative integer in the smallest
 *      currency unit"), `price_data.product_data.name` (required) and `.description`, and `quantity`; `success_url`,
 *      `cancel_url`, `client_reference_id` (max 200 characters), `customer_email`, `metadata` (key-value map) and
 *      `locale` (enum including `auto`, `en`, `fr`). The answer is a Checkout Session object: `id` ("cs_…"), `url`
 *      (the hosted payment page), `payment_status` ("unpaid" at creation), `amount_total`, `currency`, `metadata`.
 *  - Fulfillment — https://docs.stripe.com/checkout/fulfillment?ui=full-page : listen for `checkout.session.completed`
 *      and, for payment methods that succeed later, `checkout.session.async_payment_succeeded`; check `payment_status`
 *      before fulfilling; fulfill once per Checkout Session even if called several times, possibly concurrently;
 *      `{CHECKOUT_SESSION_ID}` in `success_url` is replaced with the session id.
 *  - Webhooks — https://docs.stripe.com/webhooks : the raw body must not be modified before verification; return 2xx
 *      quickly; the same event can arrive more than once (log processed event ids), and two separate events can concern
 *      the same object (also dedupe on the object id).
 *  - Signature — https://docs.stripe.com/webhooks#verify-manually (the page https://docs.stripe.com/webhooks/signature
 *      leads there): the `Stripe-Signature` header is comma-separated `prefix=value` entries; keep `t` (timestamp, Unix
 *      seconds) and every `v1`, ignore everything else (`v0`, `secret`, `destination`, `payload` are not signed);
 *      signed_payload = `${t}.${raw body}`; expected = HMAC-SHA256(endpoint secret, signed_payload) in hex; compare in
 *      constant time with each `v1`; then reject when the timestamp is outside the tolerance (the libraries default to
 *      5 minutes; never 0). Several `v1` appear while a rolled secret is still active.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export const STRIPE_API = "https://api.stripe.com/v1";
/** Same as Stripe's libraries (https://docs.stripe.com/webhooks#verify-manually, "Preventing replay attacks"). */
export const SIGNATURE_TOLERANCE_S = 300;

const env = (k: string) => (process.env[k] ?? "").trim();
/** Both keys, or Stripe is off. Read each time (tests change them; the owner sets them in the environment, never in the database). */
export function stripeKeys(): { secret: string; webhookSecret: string } | null {
  const secret = env("STRIPE_SECRET_KEY"), webhookSecret = env("STRIPE_WEBHOOK_SECRET");
  return secret && webhookSecret ? { secret, webhookSecret } : null;
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetch = (url, init) => fetch(url, init);
/** Tests: a fake Stripe (null puts the real fetch back). */
export const _setStripeFetch = (fn: Fetch | null) => { fetcher = fn ?? ((url, init) => fetch(url, init)); };

/** Stripe's form encoding of nested parameters: `a[b][0][c]=v` (as in the documentation's curl examples). */
export function formEncode(params: Record<string, unknown>): string {
  const out = new URLSearchParams();
  const walk = (prefix: string, v: unknown) => {
    if (v === undefined || v === null) return;
    if (Array.isArray(v)) v.forEach((x, i) => walk(`${prefix}[${i}]`, x));
    else if (typeof v === "object") for (const [k, x] of Object.entries(v as Record<string, unknown>)) walk(prefix ? `${prefix}[${k}]` : k, x);
    else out.append(prefix, String(v));
  };
  walk("", params);
  return out.toString();
}

export interface CheckoutSession { id: string; url: string | null; payment_status?: string; amount_total?: number | null; currency?: string | null; metadata?: Record<string, string> }
export class StripeError extends Error { constructor(public status: number, message: string) { super(message); this.name = "StripeError"; } }

/** POST /v1/checkout/sessions. Throws StripeError on any answer that is not a session with a payment page. */
export async function createCheckoutSession(params: Record<string, unknown>): Promise<CheckoutSession> {
  const keys = stripeKeys();
  if (!keys) throw new StripeError(503, "Stripe is not configured.");
  const res = await fetcher(`${STRIPE_API}/checkout/sessions`, {
    method: "POST",
    headers: { authorization: `Basic ${Buffer.from(`${keys.secret}:`).toString("base64")}`, "content-type": "application/x-www-form-urlencoded" },
    body: formEncode(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as (CheckoutSession & { error?: { message?: string } }) | null;
  if (!res.ok || !body || typeof body.id !== "string" || !body.url) {
    // Stripe's error message is about our request (never a secret); kept for the server's log only.
    throw new StripeError(502, `Stripe answered ${res.status}${body?.error?.message ? `: ${body.error.message}` : ""}`);
  }
  return body;
}

/**
 * Verifies a webhook's `Stripe-Signature` against the raw body (steps 1-4 of the documentation). Returns null when it
 * is good, else why it is refused (for the log; the route answers 400 either way).
 */
export function verifyStripeSignature(rawBody: string, header: string | undefined, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = SIGNATURE_TOLERANCE_S): string | null {
  if (!header || header.length > 4096) return "missing signature";
  let t: number | null = null;
  const v1: string[] = [];
  for (const part of header.split(",")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "t" && /^\d{1,12}$/.test(v)) t = Number(v);
    else if (k === "v1" && /^[0-9a-f]{64}$/i.test(v)) v1.push(v.toLowerCase());
  }
  if (t === null || !v1.length) return "malformed signature";
  const expected = Buffer.from(createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex"), "utf8");
  const match = v1.some((s) => { const b = Buffer.from(s, "utf8"); return b.length === expected.length && timingSafeEqual(b, expected); });
  if (!match) return "no matching signature";
  if (toleranceS <= 0 || Math.abs(nowS - t) > toleranceS) return "timestamp outside the tolerance";
  return null;
}

/** Tests and the owner's checks: the header Stripe would send for this body (same scheme as above). */
export function signStripePayload(rawBody: string, secret: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${rawBody}`, "utf8").digest("hex")}`;
}
