/**
 * Settings → Credits (hosted mode only, docs/MODE-HEBERGE.md "Crédits"): every account is free to create, and its bots
 * work in one of three ways — the person's own Claude / ChatGPT subscription (signed in on their bot's computer), their
 * own API key (Settings → Models), or prepaid credits spent on the service's AI keys. This file: the credits page's data,
 * buying a pack with Stripe Checkout (billing/stripe.ts), and Stripe's webhook that adds the credits once paid.
 *
 *  - Packs: the owner's list of amounts (Administration → Settings, `creditPacksEur`). A client sends a pack id
 *    (`pack-1000` = 10 €), never an amount; the amount, the currency and the account come from the server.
 *  - Without STRIPE_SECRET_KEY + STRIPE_WEBHOOK_SECRET: the "Buy" buttons say payment is coming soon and show the owner's
 *    contact; checkout and webhook answer 503 { code: "payments_off" }; the operator can still add credits by hand.
 *  - With them: POST /api/billing/credits/checkout creates a Checkout Session (mode=payment, one line item in EUR) and
 *    remembers it (credit_checkouts: session id → account, pack, amount). POST /api/billing/stripe/webhook checks the
 *    signature of the raw body, then on `checkout.session.completed` / `checkout.session.async_payment_succeeded` with
 *    payment_status "paid" adds the credits — only for a session this server created, to the account that created it,
 *    for the amount it set, and once: per event id (billing_events) and per session id (unique credit_topups.external_ref).
 *    The older address POST /api/billing/webhook/stripe is the same handler once Stripe is configured (501 before).
 */
import type { Context, Hono } from "hono";
import { config } from "./config.js";
import { q } from "./db.js";
import { adminLog, addPrepaid, creditEur, HostedError, hostedMode, hostedSettings, isOperator, monthBounds, operatorKeysAllowed, planBaseEur, prepaidLeftEur, prepaidUseByMonth, spentEur, subscriptionEnginesFor } from "./hosted.js";
import { createCheckoutSession, StripeError, stripeKeys, verifyStripeSignature } from "./billing/stripe.js";
import { pickLocale } from "./i18n.js";
import type { CreditEntry, CreditPack, CreditsView, Locale } from "./shared.js";
import { bots, now, users, type UserRecord } from "./store.js";

const FR: Record<string, string> = {
  "Online payment is not available yet. To get credits, contact whoever runs this service.": "Le paiement en ligne n'est pas encore disponible. Pour obtenir des crédits, contacte la personne qui gère ce service.",
  "Online payment is not available yet. To get credits, contact whoever runs this service: {contact}": "Le paiement en ligne n'est pas encore disponible. Pour obtenir des crédits, contacte la personne qui gère ce service : {contact}",
  "This pack does not exist. Reload the page and choose one of the packs shown.": "Ce pack n'existe pas. Recharge la page et choisis un des packs proposés.",
  "Your account runs this service: it has no credits to buy.": "Ton compte gère ce service : il n'a pas de crédits à acheter.",
  "Your plan uses your own API keys only: credits for the service's keys would not be used. Change plan first.": "Ton offre utilise uniquement tes propres clés d'API : des crédits sur les clés du service ne serviraient pas. Change d'offre d'abord.",
  "The payment page could not be opened right now. Try again in a minute.": "La page de paiement n'a pas pu s'ouvrir pour l'instant. Réessaie dans une minute.",
  "Too many attempts. Wait a few minutes and try again.": "Trop de tentatives. Attends quelques minutes puis réessaie.",
  "Invalid signature.": "Signature invalide.",
};
const m = (loc: Locale | undefined, english: string, vars: Record<string, string | number> = {}) =>
  (loc === "fr" ? FR[english] ?? english : english).replace(/\{(\w+)\}/g, (_x, k) => String(vars[k] ?? ""));
class CreditsError extends HostedError {
  constructor(status: 400 | 403 | 404 | 409 | 429 | 502 | 503, english: string, code: string, vars: Record<string, string | number> = {}) { super(status, english, vars, code); this.name = "CreditsError"; }
  override text(locale: Locale | undefined) { return m(locale, this.english, this.vars); }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const packId = (amountEur: number) => `pack-${Math.round(amountEur * 100)}`;
export const creditPacks = (): CreditPack[] => hostedSettings.get().creditPacksEur.map((a) => ({ id: packId(a), amountEur: a }));
export const paymentsOn = () => !!stripeKeys();

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────
export function creditsView(userId: string): CreditsView {
  const s = hostedSettings.get();
  const operator = isOperator(userId);
  const main = bots.primary(userId);
  const history = q.all<{ id: string; at: number; kind: string; source: string; amount_eur: number; note: string }>(
    "SELECT id, at, kind, source, amount_eur, note FROM credit_topups WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId)
    .map((r): CreditEntry => ({ id: r.id, at: r.at, kind: r.kind === "prepaid" ? "prepaid" : "month", source: r.source === "stripe" ? "stripe" : "manual", amountEur: round2(r.amount_eur), note: r.note }));
  return {
    operator,
    balanceEur: operator ? 0 : prepaidLeftEur(userId),
    month: monthBounds().label, planBudgetEur: operator ? 0 : round2(planBaseEur(userId)), monthTopUpEur: operator ? 0 : round2(creditEur(userId)), spentEur: round2(spentEur(userId)),
    packs: creditPacks(), payments: paymentsOn() ? "stripe" : "off", contactUrl: s.contactUrl,
    history, spend: operator ? [] : prepaidUseByMonth(userId).filter((x, i) => i === 0 || x.spentEur > 0 || x.fromCreditsEur > 0),
    subscriptionEngines: subscriptionEnginesFor(userId), operatorKeys: operatorKeysAllowed(userId),
    mainBot: main ? { id: main.id, name: main.name } : null,
  };
}

// ── Checkout ─────────────────────────────────────────────────────────────────────────────────────────────────────
const attempts = new Map<string, number[]>();
function throttleCheckout(userId: string) {
  const t = now();
  const recent = (attempts.get(userId) ?? []).filter((x) => t - x < 15 * 60_000);
  if (recent.length >= 10) throw new CreditsError(429, "Too many attempts. Wait a few minutes and try again.", "throttled");
  recent.push(t);
  attempts.set(userId, recent);
  if (attempts.size > 10_000) attempts.clear();
}

export async function startCheckout(user: UserRecord, pack: unknown): Promise<{ url: string }> {
  if (isOperator(user.id)) throw new CreditsError(409, "Your account runs this service: it has no credits to buy.", "operator");
  if (!paymentsOn()) {
    const contact = hostedSettings.get().contactUrl.replace(/^mailto:/i, "");
    throw contact
      ? new CreditsError(503, "Online payment is not available yet. To get credits, contact whoever runs this service: {contact}", "payments_off", { contact })
      : new CreditsError(503, "Online payment is not available yet. To get credits, contact whoever runs this service.", "payments_off");
  }
  const chosen = creditPacks().find((p) => p.id === pack);
  if (!chosen) throw new CreditsError(400, "This pack does not exist. Reload the page and choose one of the packs shown.", "pack");
  if (!operatorKeysAllowed(user.id)) throw new CreditsError(409, "Your plan uses your own API keys only: credits for the service's keys would not be used. Change plan first.", "byok");
  throttleCheckout(user.id);
  const cents = Math.round(chosen.amountEur * 100);
  const fr = user.locale === "fr";
  let session;
  try {
    session = await createCheckoutSession({
      mode: "payment",
      line_items: [{
        price_data: {
          currency: "eur", unit_amount: cents,
          product_data: { name: fr ? `Crédits IA Sklubot — ${chosen.amountEur} €` : `Sklubot AI credits — €${chosen.amountEur}`, description: fr ? "Crédits prépayés pour les modèles d'IA du service. Ils ne s'arrêtent pas à la fin du mois." : "Prepaid credits for the service's AI models. They do not end with the month." },
        },
        quantity: 1,
      }],
      success_url: `${config.publicUrl}/?credits=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.publicUrl}/?credits=cancel`,
      client_reference_id: user.id,
      customer_email: user.email,
      metadata: { userId: user.id, pack: chosen.id },
      locale: fr ? "fr" : "en",
    });
  } catch (err) {
    console.error(`[credits] Checkout Session not created: ${(err as Error).message}`);
    throw new CreditsError(502, "The payment page could not be opened right now. Try again in a minute.", "stripe");
  }
  q.run("INSERT OR IGNORE INTO credit_checkouts (session_id, user_id, pack_id, amount_eur, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)", session.id, user.id, chosen.id, chosen.amountEur, now());
  adminLog({ id: user.id, label: user.email }, user.id, "checkout", `credit pack ${chosen.amountEur} € — ${session.id}`);
  return { url: session.url! };
}

// ── Webhook ──────────────────────────────────────────────────────────────────────────────────────────────────────
const STRIPE_ACTOR = { id: "stripe", label: "Stripe" };
const FULFILL_EVENTS = new Set(["checkout.session.completed", "checkout.session.async_payment_succeeded"]);

/** Adds the credits of one paid Checkout Session, once. What it did, for the answer and the tests. */
export function fulfillSession(obj: any): "credited" | "duplicate" | "ignored" {
  const id = typeof obj?.id === "string" ? obj.id : "";
  if (!id || obj.mode !== "payment" || obj.payment_status !== "paid") return "ignored";
  const row = q.get<{ user_id: string; amount_eur: number; pack_id: string; status: string }>("SELECT user_id, amount_eur, pack_id, status FROM credit_checkouts WHERE session_id = ?", id);
  // A session this server did not create (another product on the same Stripe account): not ours to credit.
  if (!row) { console.warn(`[credits] paid Checkout Session ${id} is not one of ours: ignored`); return "ignored"; }
  const cents = Math.round(row.amount_eur * 100);
  if (obj.currency !== "eur" || obj.amount_total !== cents || (obj.metadata?.userId && obj.metadata.userId !== row.user_id)) {
    adminLog(STRIPE_ACTOR, row.user_id, "credit-refused", `session ${id}: paid ${obj.amount_total} ${obj.currency}, expected ${cents} eur — not credited, check it in Stripe`);
    return "ignored";
  }
  if (!users.byId(row.user_id)) return "ignored";
  const added = addPrepaid(row.user_id, row.amount_eur, { source: "stripe", ref: id, note: row.pack_id, actor: STRIPE_ACTOR });
  q.run("UPDATE credit_checkouts SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE session_id = ?", now(), id);
  return added ? "credited" : "duplicate";
}

async function stripeWebhook(c: Context): Promise<Response> {
  const loc = pickLocale(undefined, c.req.header("accept-language"));
  const keys = stripeKeys();
  if (!keys) { const e = new CreditsError(503, "Online payment is not available yet. To get credits, contact whoever runs this service.", "payments_off"); return c.json({ error: e.text(loc), code: e.code }, 503); }
  // The raw body, exactly as sent: the signature covers it byte for byte.
  const raw = await c.req.text();
  const why = verifyStripeSignature(raw, c.req.header("stripe-signature"), keys.webhookSecret);
  if (why) { console.warn(`[credits] Stripe webhook refused: ${why}`); return c.json({ error: m(loc, "Invalid signature.") }, 400); }
  let event: any;
  try { event = JSON.parse(raw); } catch { return c.json({ error: "Invalid JSON." }, 400); }
  const eventId = typeof event?.id === "string" ? event.id.slice(0, 200) : "";
  if (!eventId) return c.json({ error: "Invalid event." }, 400);
  if (q.get("SELECT 1 AS x FROM billing_events WHERE provider = 'stripe' AND event_id = ?", eventId)) return c.json({ received: true, duplicate: true });
  let result: string = "ignored";
  if (FULFILL_EVENTS.has(event.type)) result = fulfillSession(event.data?.object);
  // Recorded after the work: if it failed, Stripe retries, and the session id still keeps a retry from crediting twice.
  q.run("INSERT OR IGNORE INTO billing_events (provider, event_id, received_at) VALUES ('stripe', ?, ?)", eventId, now());
  return c.json({ received: true, result });
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NOT_FOUND = { error: "No such endpoint." };
function guard(fn: (c: Context) => Promise<Response> | Response) {
  return async (c: Context) => {
    if (!hostedMode()) return c.json(NOT_FOUND, 404);
    try { return await fn(c); } catch (err) {
      if (err instanceof HostedError) {
        const loc: Locale = (c.get("user") as UserRecord | undefined)?.locale ?? pickLocale(undefined, c.req.header("accept-language"));
        return c.json({ error: err.text(loc), ...(err.code ? { code: err.code } : {}), ...(err.code === "payments_off" ? { contactUrl: hostedSettings.get().contactUrl } : {}) }, err.status);
      }
      if (err instanceof StripeError) return c.json({ error: "Stripe" }, 502);
      throw err;
    }
  };
}
/** Without a session: Stripe's webhook. `legacy`: the older /billing/webhook/stripe once Stripe is configured. */
export function registerCreditsPublic(api: Hono<any>) {
  api.post("/billing/stripe/webhook", guard(stripeWebhook));
}
export const stripeLegacyWebhook = (c: Context) => (paymentsOn() ? stripeWebhook(c) : null);

/** For signed-in people. */
export function registerCreditsPrivate(api: Hono<any>) {
  api.get("/billing/credits", guard((c) => c.json(creditsView((c.get("user") as UserRecord).id))));
  api.post("/billing/credits/checkout", guard(async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json(await startCheckout(c.get("user") as UserRecord, b?.pack));
  }));
}
