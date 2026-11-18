/**
 * Paddle Billing, for prepaid AI credits only (credits.ts). Paddle is the merchant of record: it sells the credits in its
 * own name, collects the payment and handles sales tax / VAT. Plain fetch, no SDK. Written from Paddle's developer
 * documentation (read 2026-11-18, the `.md` versions of each page); every endpoint, field and header used below is cited:
 *
 *  - Base URLs — https://developer.paddle.com/sdks/sandbox ("API base URLs"): live `https://api.paddle.com`, sandbox
 *      `https://sandbox-api.paddle.com`. Sandbox and live accounts are separate (keys, catalog, notification destinations).
 *      The go-live checklist (https://developer.paddle.com/build/go-live-checklist) says never to default the
 *      environment silently: PADDLE_ENV must say `sandbox` or `production`, or payment stays off.
 *  - Authentication — https://developer.paddle.com/api-reference/about/authentication : `Authorization: Bearer <API key>`;
 *      keys look like `pdl_sdbx_apikey_…` (sandbox) or `pdl_live_apikey_…` (live); older keys have no prefix.
 *  - Versioning — https://developer.paddle.com/api-reference/about/versioning : `Paddle-Version: 1` ("good practice").
 *  - Create a transaction — https://developer.paddle.com/api-reference/transactions/create-transaction
 *      POST /transactions. `items[]` of a "non-catalog price for an existing product": `quantity` and `price` with
 *      `product_id` (`pro_…`), `description` (internal, 2–500 chars), `name` (shown at checkout, 1–150), `unit_price`
 *      { `amount` ("lowest denomination … as a string", e.g. 10 € = "1000"), `currency_code` }, `tax_mode`
 *      (`internal` = "Prices are inclusive of tax"), `quantity` { minimum, maximum } (limits on how many can be bought).
 *      Also `currency_code`, `collection_mode` (`automatic` = "for checkout"), `custom_data` ("your own structured
 *      key-value data") and `checkout.url` ("Pass the URL for an approved domain … Paddle returns a unique payment link
 *      composed of the URL passed … + `?_ptxn=` and the Paddle ID for this transaction"). Answer 201 `{ data: { id:
 *      "txn_…", status, checkout: { url } … }, meta }`; errors `{ error: { type, code, detail }, meta }`
 *      (https://developer.paddle.com/errors/shared/bad_request).
 *      Non-catalog items: https://developer.paddle.com/build/transactions/bill-create-custom-items-prices-products —
 *      the server sets the price for each purchase, so no price per pack has to be kept in Paddle's catalog.
 *  - Default payment link — https://developer.paddle.com/build/transactions/default-payment-link : a page of an approved
 *      website that includes Paddle.js, which "automatically opens a checkout for the transaction when the query
 *      parameter is present". Required before any transaction can be created. Ours is /paiement (hostedroutes.ts).
 *  - Webhooks — https://developer.paddle.com/webhooks/about/how-webhooks-work : every payload has `event_id` ("Use this
 *      to deduplicate"), `event_type`, `occurred_at`, `notification_id`, `data`; at-least-once delivery.
 *      https://developer.paddle.com/webhooks/about/respond-to-webhooks : answer 200 within five seconds, else retries.
 *  - Signature — https://developer.paddle.com/webhooks/about/signature-verification ("Verify manually"): header
 *      `Paddle-Signature: ts=1671552777;h1=eb4d…` — elements split by `;`, key/value by `=`; at least one `h1` (several
 *      while a secret is rotated); signed payload = `${ts}:${raw body}` (the raw body, untouched); HMAC-SHA256 with the
 *      notification destination's secret key, hex; compare in constant time. Checking `ts` against the clock is
 *      optional there ("Our SDKs have a default tolerance of five seconds"); we allow 5 minutes for clock skew — a replay
 *      inside that window is harmless anyway, every event and transaction being handled once.
 */
import { createHmac, timingSafeEqual } from "node:crypto";

export type PaddleEnv = "sandbox" | "production";
export const PADDLE_API: Record<PaddleEnv, string> = { sandbox: "https://sandbox-api.paddle.com", production: "https://api.paddle.com" };
export const SIGNATURE_TOLERANCE_S = 300;

const env = (k: string) => (process.env[k] ?? "").trim();
export interface PaddleKeys { env: PaddleEnv; apiKey: string; webhookSecret: string; clientToken: string; productId: string }
/** The environment variables payment needs (names only: shown to the owner in Administration when one is missing). */
export const PADDLE_VARS = ["PADDLE_ENV", "PADDLE_API_KEY", "PADDLE_WEBHOOK_SECRET", "PADDLE_CLIENT_TOKEN", "PADDLE_PRODUCT_ID"] as const;

/**
 * What is missing or wrong in the configuration (empty = ready). Read each time: tests change it, and the owner sets it in
 * the environment, never in the database. Keys and tokens of the other environment are refused (a sandbox key with
 * PADDLE_ENV=production would fail at the first purchase; better to say so now).
 */
export function paddleProblems(): string[] {
  const out: string[] = [];
  const e = env("PADDLE_ENV");
  if (e !== "sandbox" && e !== "production") out.push("PADDLE_ENV");
  const key = env("PADDLE_API_KEY");
  // https://developer.paddle.com/api-reference/about/authentication ("API key format"): pdl_(live|sdbx)_apikey_…
  if (!key || (/^pdl_/.test(key) && !key.startsWith(e === "sandbox" ? "pdl_sdbx_" : "pdl_live_"))) out.push("PADDLE_API_KEY");
  if (!env("PADDLE_WEBHOOK_SECRET")) out.push("PADDLE_WEBHOOK_SECRET");
  // https://developer.paddle.com/build/go-live-checklist : "Sandbox tokens start with `test_` and live tokens start with `live_`".
  const token = env("PADDLE_CLIENT_TOKEN");
  if (!token || !token.startsWith(e === "sandbox" ? "test_" : "live_")) out.push("PADDLE_CLIENT_TOKEN");
  // A product id: pattern `^pro_[a-z\d]{26}$` (create-transaction, `items[].price.product_id`).
  if (!/^pro_[a-z\d]{26}$/.test(env("PADDLE_PRODUCT_ID"))) out.push("PADDLE_PRODUCT_ID");
  return out;
}
export function paddleKeys(): PaddleKeys | null {
  if (paddleProblems().length) return null;
  return { env: env("PADDLE_ENV") as PaddleEnv, apiKey: env("PADDLE_API_KEY"), webhookSecret: env("PADDLE_WEBHOOK_SECRET"), clientToken: env("PADDLE_CLIENT_TOKEN"), productId: env("PADDLE_PRODUCT_ID") };
}

type Fetch = (url: string, init: RequestInit) => Promise<Response>;
let fetcher: Fetch = (url, init) => fetch(url, init);
/** Tests: a fake Paddle (null puts the real fetch back). */
export const _setPaddleFetch = (fn: Fetch | null) => { fetcher = fn ?? ((url, init) => fetch(url, init)); };

export interface PaddleTransaction { id: string; status?: string; checkout?: { url: string | null } | null; custom_data?: Record<string, unknown> | null; currency_code?: string; details?: { totals?: { total?: string; currency_code?: string } } }
export class PaddleError extends Error { constructor(public status: number, message: string) { super(message); this.name = "PaddleError"; } }

/** POST /transactions. Throws PaddleError on any answer that is not a transaction with a checkout link. */
export async function createTransaction(body: Record<string, unknown>): Promise<PaddleTransaction> {
  const keys = paddleKeys();
  if (!keys) throw new PaddleError(503, "Paddle is not configured.");
  const res = await fetcher(`${PADDLE_API[keys.env]}/transactions`, {
    method: "POST",
    headers: { authorization: `Bearer ${keys.apiKey}`, "content-type": "application/json", accept: "application/json", "paddle-version": "1" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(15_000),
  });
  const json = (await res.json().catch(() => null)) as { data?: PaddleTransaction; error?: { code?: string; detail?: string } } | null;
  const txn = json?.data;
  if (!res.ok || !txn || typeof txn.id !== "string" || !/^txn_[a-z\d]{26}$/.test(txn.id) || !txn.checkout?.url) {
    // Paddle's error code and detail are about our request (never a secret); kept for the server's log only.
    throw new PaddleError(502, `Paddle answered ${res.status}${json?.error ? `: ${json.error.code ?? ""} ${json.error.detail ?? ""}`.trimEnd() : ""}`);
  }
  return txn;
}

/**
 * Verifies a webhook's `Paddle-Signature` against the raw body. Returns null when it is good, else why it is refused (for
 * the log; the route answers 400 either way).
 */
export function verifyPaddleSignature(rawBody: string, header: string | undefined, secret: string, nowS = Math.floor(Date.now() / 1000), toleranceS = SIGNATURE_TOLERANCE_S): string | null {
  if (!header || header.length > 4096) return "missing signature";
  let ts: number | null = null;
  const h1: string[] = [];
  for (const part of header.split(";")) {
    const i = part.indexOf("=");
    if (i < 1) continue;
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim();
    if (k === "ts" && /^\d{1,12}$/.test(v)) ts = Number(v);
    else if (k === "h1" && /^[0-9a-f]{64}$/i.test(v)) h1.push(v.toLowerCase());
  }
  if (ts === null || !h1.length) return "malformed signature";
  const expected = Buffer.from(createHmac("sha256", secret).update(`${ts}:${rawBody}`, "utf8").digest("hex"), "utf8");
  const match = h1.some((s) => { const b = Buffer.from(s, "utf8"); return b.length === expected.length && timingSafeEqual(b, expected); });
  if (!match) return "no matching signature";
  if (toleranceS <= 0 || Math.abs(nowS - ts) > toleranceS) return "timestamp outside the tolerance";
  return null;
}

/** Tests and the owner's checks: the header Paddle would send for this body (same scheme as above). */
export function signPaddlePayload(rawBody: string, secret: string, ts = Math.floor(Date.now() / 1000)): string {
  return `ts=${ts};h1=${createHmac("sha256", secret).update(`${ts}:${rawBody}`, "utf8").digest("hex")}`;
}

/** An amount in the currency's lowest denomination, as Paddle writes it (a string holding an integer), or null. */
export function minorUnits(v: unknown): number | null {
  if (typeof v === "number" && Number.isSafeInteger(v)) return v;
  if (typeof v === "string" && /^-?\d{1,15}$/.test(v)) return Number(v);
  return null;
}
