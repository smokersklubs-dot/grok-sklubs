/**
 * Payment providers for the hosted mode's SUBSCRIPTIONS (SK-P1-07). Only the "manual" one exists for plans — the
 * operator records a payment in Settings → Administration (hosted.ts adminActions.markPaid) and the account is active
 * until the date they enter; the scheduler then moves it to past_due → suspended if nothing new is recorded.
 * (Prepaid AI credits are paid online through Paddle: credits.ts and billing/paddle.ts, outside this interface.)
 *
 * How a real provider plugs in (docs/MODE-HEBERGE.md, "Brancher un fournisseur de paiement"):
 *  1. Write an adapter here implementing PaymentProvider (paddle.ts already holds Paddle's API calls and signature check),
 *     from the provider's OFFICIAL documentation only (cite each endpoint and header in comments, as the rest of this
 *     repository does). Nothing below names or guesses any provider API.
 *  2. `verifyWebhook` checks the signature of the raw request body with the provider's signing secret (an environment
 *     variable, never in the database or the code) and returns the events it carries; a bad signature → throw (the
 *     route answers 400).
 *  3. `handleWebhook` maps each event to `BillingChange`s (an account, a status, a paid-until date, the external
 *     reference). The route applies them through the same functions as the admin page and records each event id in
 *     `billing_events` first, so the same event delivered twice changes nothing the second time.
 *  4. `checkoutUrl` (optional) returns the provider's hosted payment page for an account and a plan; until then the
 *     "Upgrade" buttons use the contact address of the hosted settings.
 *  5. Register it in PROVIDERS below. Until then, POST /api/billing/webhook/<name> answers 501 (not implemented) for the
 *     names in PLANNED_PROVIDERS and changes nothing — except `paddle` once configured, which is the credits webhook.
 */
import type { SubscriptionStatus } from "../shared.js";

/** What a provider event changes on one account. */
export interface BillingChange { userId: string; status?: SubscriptionStatus; periodEnd?: number | null; externalRef?: string; planId?: string }

export interface PaymentProvider {
  readonly id: string;
  readonly label: string;
  /** Manual providers have no webhook: the operator records payments by hand. */
  readonly manual: boolean;
  /** Checks the signature and returns the events (id + raw payload). Throws on a bad signature. */
  verifyWebhook?(rawBody: string, headers: Record<string, string>): Promise<{ id: string; payload: unknown }[]>;
  /** Maps verified events to account changes. */
  handleWebhook?(events: { id: string; payload: unknown }[]): Promise<BillingChange[]>;
  /** The provider's own payment page for this account and plan, when it has one. */
  checkoutUrl?(userId: string, planId: string): Promise<string | null>;
}

/** The only provider today: the operator marks payments by hand (Settings → Administration → "Payment received"). */
export const manualProvider: PaymentProvider = { id: "manual", label: "Manuel / Manual", manual: true };

/** Registered providers by id. Add a real adapter here once it is written from the provider's documentation. */
export const PROVIDERS: Record<string, PaymentProvider> = { manual: manualProvider };

/**
 * Names whose webhook route answers 501 instead of 404, to say "not connected here": `paddle` (until configured) and
 * `stripe`, an address earlier versions documented (Stripe is no longer used; an old webhook pointed at it changes nothing).
 */
export const PLANNED_PROVIDERS = ["paddle", "stripe"] as const;
