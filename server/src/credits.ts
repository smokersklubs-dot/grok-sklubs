/**
 * Settings → Credits (hosted mode only, docs/MODE-HEBERGE.md "Crédits"): every account is free to create, and its bots
 * work in one of three ways — the person's own Claude / ChatGPT subscription (signed in on their bot's computer), their
 * own API key (Settings → Models), or prepaid credits spent on the service's AI keys. This file: the credits page's data,
 * buying a pack through Paddle (billing/paddle.ts, Paddle is the merchant of record) and Paddle's webhook that adds the
 * credits once paid — or removes them after a refund.
 *
 *  - Packs: the owner's list of amounts (Administration → Settings, `creditPacksEur`). A client sends a pack id
 *    (`pack-1000` = 10 €), never an amount; the amount, the currency and the account come from the server.
 *  - Without the PADDLE_* variables (billing/paddle.ts PADDLE_VARS): the "Buy" buttons say payment is coming soon and show
 *    the owner's contact; checkout and webhook answer 503 { code: "payments_off" }; the operator can still add credits.
 *  - With them: POST /api/billing/credits/checkout creates a Paddle transaction (one non-catalog price on the owner's
 *    product, in EUR, tax included, quantity fixed at 1, our custom data) and remembers it (credit_checkouts: transaction
 *    id → account, pack, amount); the browser goes to its checkout link, our /paiement page, where Paddle.js opens the
 *    checkout. POST /api/billing/paddle/webhook checks the signature of the raw body, then:
 *      · `transaction.paid` / `transaction.completed` (status paid or completed) adds the credits — only for a transaction
 *        this server created, to the account that created it (custom data must agree), for the amount it set, in EUR,
 *        and once: per event id (billing_events) and per transaction id (unique credit_topups.external_ref);
 *      · `adjustment.created` / `adjustment.updated` with an approved refund or chargeback on one of our transactions
 *        removes the refunded amount from the credits not spent yet, once per adjustment id; what was already spent
 *        cannot be taken back and is written to the Administration log for the owner (same for reversed chargebacks,
 *        which are not re-credited automatically: the owner decides, with "Add AI credits").
 *    The older address POST /api/billing/webhook/paddle is the same handler once Paddle is configured (501 before).
 */
import type { Context, Hono } from "hono"; import { localize } from "./lang/index.js"; import { tr } from "./i18n.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { adminLog, addPrepaid, creditEur, HostedError, hostedMode, hostedSettings, isOperator, monthBounds, operatorKeysAllowed, planBaseEur, prepaidLeftEur, prepaidUseByMonth, removePrepaid, spentEur, subscriptionEnginesFor } from "./hosted.js";
import { createTransaction, minorUnits, paddleKeys, paddleProblems, PaddleError, verifyPaddleSignature, type PaddleEnv } from "./billing/paddle.js";
import { pickLocale } from "./i18n.js";
import type { CreditEntry, CreditPack, CreditsView, Locale } from "./shared.js";
import { bots, now, users, type UserRecord } from "./store.js";

const FR: Record<string, string> = {
  "Credits are not sold on this service.": "Ce service ne vend pas de crédits.",
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
  localize(loc, english, FR).replace(/\{(\w+)\}/g, (_x, k) => String(vars[k] ?? ""));
class CreditsError extends HostedError {
  constructor(status: 400 | 403 | 404 | 409 | 429 | 502 | 503, english: string, code: string, vars: Record<string, string | number> = {}) { super(status, english, vars, code); this.name = "CreditsError"; }
  override text(locale: Locale | undefined) { return m(locale, this.english, this.vars); }
}

const round2 = (n: number) => Math.round(n * 100) / 100;
export const packId = (amountEur: number) => `pack-${Math.round(amountEur * 100)}`;
export const creditPacks = (): CreditPack[] => hostedSettings.get().creditPacksEur.map((a) => ({ id: packId(a), amountEur: a }));
export const paymentsOn = () => !!paddleKeys();
/** Administration → Settings → Credits: the provider, its environment and what is missing (variable names only). */
export function paymentsInfo(): { provider: "Paddle"; env: PaddleEnv | null; missing: string[] } {
  const e = (process.env.PADDLE_ENV ?? "").trim();
  return { provider: "Paddle", env: e === "sandbox" || e === "production" ? e : null, missing: paddleProblems() };
}
/** The page Paddle's checkout links point to (hostedroutes.ts): it loads Paddle.js, which opens the checkout. */
export const PAY_PATH = "/paiement";

// ── The page ─────────────────────────────────────────────────────────────────────────────────────────────────────
const entrySource = (source: string, amount: number): CreditEntry["source"] => (source === "manual" ? "manual" : amount < 0 ? "refund" : "payment");
export function creditsView(userId: string): CreditsView {
  const s = hostedSettings.get();
  const operator = isOperator(userId);
  const main = bots.primary(userId);
  const history = q.all<{ id: string; at: number; kind: string; source: string; amount_eur: number; note: string }>(
    "SELECT id, at, kind, source, amount_eur, note FROM credit_topups WHERE user_id = ? ORDER BY at DESC LIMIT 50", userId)
    .map((r): CreditEntry => ({ id: r.id, at: r.at, kind: r.kind === "prepaid" ? "prepaid" : "month", source: entrySource(r.source, r.amount_eur), amountEur: round2(r.amount_eur), note: r.source === "manual" ? r.note : "" }));
  return {
    operator,
    balanceEur: operator ? 0 : prepaidLeftEur(userId),
    month: monthBounds().label, planBudgetEur: operator ? 0 : round2(planBaseEur(userId)), monthTopUpEur: operator ? 0 : round2(creditEur(userId)), spentEur: round2(spentEur(userId)),
    packs: creditPacks(), payments: paymentsOn() ? "paddle" : "off", contactUrl: s.contactUrl,
    history, spend: operator ? [] : prepaidUseByMonth(userId).filter((x, i) => i === 0 || x.spentEur > 0 || x.fromCreditsEur > 0),
    subscriptionEngines: subscriptionEnginesFor(userId), operatorKeys: operatorKeysAllowed(userId),
    mainBot: main ? { id: main.id, name: main.name } : null,
    creditsForSale: s.creditsForSale,
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
function paymentsOff(): CreditsError {
  const contact = hostedSettings.get().contactUrl.replace(/^mailto:/i, "");
  return contact
    ? new CreditsError(503, "Online payment is not available yet. To get credits, contact whoever runs this service: {contact}", "payments_off", { contact })
    : new CreditsError(503, "Online payment is not available yet. To get credits, contact whoever runs this service.", "payments_off");
}

/** Our keys in the transaction's `custom_data` (the webhook checks them against what this server recorded). */
export const CUSTOM = { user: "sklubot_user", pack: "sklubot_pack" } as const;

export async function startCheckout(user: UserRecord, pack: unknown): Promise<{ url: string }> {
  if (isOperator(user.id)) throw new CreditsError(409, "Your account runs this service: it has no credits to buy.", "operator");
  // Credits are sold only when the owner turned it on (Administration → Settings → "Sell Sklubot credits", off by default).
  if (!hostedSettings.get().creditsForSale) throw new CreditsError(404, "Credits are not sold on this service.", "payments_off");
  const keys = paddleKeys();
  if (!keys) throw paymentsOff();
  const chosen = creditPacks().find((p) => p.id === pack);
  if (!chosen) throw new CreditsError(400, "This pack does not exist. Reload the page and choose one of the packs shown.", "pack");
  if (!operatorKeysAllowed(user.id)) throw new CreditsError(409, "Your plan uses your own API keys only: credits for the service's keys would not be used. Change plan first.", "byok");
  throttleCheckout(user.id);
  const cents = Math.round(chosen.amountEur * 100);
  let txn;
  try {
    // https://developer.paddle.com/api-reference/transactions/create-transaction (fields cited in billing/paddle.ts).
    txn = await createTransaction({
      items: [{
        quantity: 1,
        price: {
          product_id: keys.productId,
          description: `Sklubot prepaid AI credits ${chosen.id}`,
          name: tr(user.locale, "AI credits — €{amount}", { amount: chosen.amountEur }),
          unit_price: { amount: String(cents), currency_code: "EUR" },
          // The pack's price is what the person pays, tax included (Paddle works out the tax inside it).
          tax_mode: "internal",
          quantity: { minimum: 1, maximum: 1 },
        },
      }],
      currency_code: "EUR",
      collection_mode: "automatic",
      custom_data: { [CUSTOM.user]: user.id, [CUSTOM.pack]: chosen.id },
      checkout: { url: `${config.publicUrl}${PAY_PATH}` },
    });
  } catch (err) {
    console.error(`[credits] Paddle transaction not created: ${(err as Error).message}`);
    throw new CreditsError(502, "The payment page could not be opened right now. Try again in a minute.", "paddle");
  }
  // The link Paddle composed (our page + ?_ptxn=txn_…). Only ever our own page: never send the browser elsewhere.
  const url = URL.canParse(txn.checkout!.url!) ? new URL(txn.checkout!.url!) : null;
  const ours = new URL(`${config.publicUrl}${PAY_PATH}`);
  if (!url || url.origin !== ours.origin || url.pathname !== ours.pathname) {
    console.error(`[credits] Paddle returned a checkout link outside ${ours.origin}${PAY_PATH}: check the default payment link`);
    throw new CreditsError(502, "The payment page could not be opened right now. Try again in a minute.", "paddle");
  }
  q.run("INSERT OR IGNORE INTO credit_checkouts (session_id, user_id, pack_id, amount_eur, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)", txn.id, user.id, chosen.id, chosen.amountEur, now());
  adminLog({ id: user.id, label: user.email }, user.id, "checkout", `credit pack ${chosen.amountEur} € — ${txn.id}`);
  return { url: url.toString() };
}

// ── Webhook ──────────────────────────────────────────────────────────────────────────────────────────────────────
const PADDLE_ACTOR = { id: "paddle", label: "Paddle" };
// https://developer.paddle.com/webhooks/about/how-webhooks-work ("What happens at checkout"): `transaction.paid` is the
// earliest point at which payment is captured, `transaction.completed` when Paddle has finished processing. Either one
// credits (whichever comes first); the transaction id keeps the other from crediting again.
const PAID_EVENTS = new Set(["transaction.paid", "transaction.completed"]);
const PAID_STATUS = new Set(["paid", "completed"]);
// https://developer.paddle.com/webhooks/adjustments/adjustment-created : `action` refund | chargeback |
// chargeback_warning ("The amount is refunded") take money back; *_reverse give it back; `credit` is for invoices.
// `status`: pending_approval → approved | rejected (most live refunds need Paddle's approval; adjustment.updated says so).
const ADJUST_EVENTS = new Set(["adjustment.created", "adjustment.updated"]);
const TAKE_BACK = new Set(["refund", "chargeback", "chargeback_warning"]);
const GIVE_BACK = new Set(["chargeback_reverse", "chargeback_warning_reverse", "credit_reverse"]);

type Checkout = { user_id: string; amount_eur: number; pack_id: string; status: string };
const checkoutOf = (txnId: string) => q.get<Checkout>("SELECT user_id, amount_eur, pack_id, status FROM credit_checkouts WHERE session_id = ?", txnId);
/** Once per (kind, id): true the first time. billing_events is the idempotency table of every provider (migration 4). */
const firstTime = (kind: string, id: string) => q.run("INSERT OR IGNORE INTO billing_events (provider, event_id, received_at) VALUES (?, ?, ?)", kind, id, now()).changes > 0;

/** Adds the credits of one paid transaction, once. What it did, for the answer and the tests. */
export function fulfillTransaction(txn: any): "credited" | "duplicate" | "ignored" {
  const id = typeof txn?.id === "string" ? txn.id : "";
  if (!/^txn_[a-z\d]{26}$/.test(id) || !PAID_STATUS.has(txn.status)) return "ignored";
  const row = checkoutOf(id);
  // A transaction this server did not create (another product on the same Paddle account): not ours to credit.
  if (!row) { console.warn(`[credits] paid Paddle transaction ${id} is not one of ours: ignored`); return "ignored"; }
  const cents = Math.round(row.amount_eur * 100);
  const total = minorUnits(txn.details?.totals?.total);
  const currency = txn.details?.totals?.currency_code ?? txn.currency_code;
  const custom = txn.custom_data ?? {};
  if (currency !== "EUR" || txn.currency_code !== "EUR" || total !== cents || custom[CUSTOM.user] !== row.user_id || custom[CUSTOM.pack] !== row.pack_id) {
    adminLog(PADDLE_ACTOR, row.user_id, "credit-refused", `transaction ${id}: paid ${total} ${currency} for ${String(custom[CUSTOM.user] ?? "?")}/${String(custom[CUSTOM.pack] ?? "?")}, expected ${cents} EUR for this account's ${row.pack_id} — not credited, check it in Paddle`);
    return "ignored";
  }
  if (!users.byId(row.user_id)) return "ignored";
  const added = addPrepaid(row.user_id, row.amount_eur, { source: "paddle", ref: id, note: row.pack_id, actor: PADDLE_ACTOR });
  q.run("UPDATE credit_checkouts SET status = 'paid', paid_at = COALESCE(paid_at, ?) WHERE session_id = ? AND status = 'open'", now(), id);
  return added ? "credited" : "duplicate";
}

/**
 * A refund or a chargeback on one of our transactions, once approved: removes the refunded amount (never more than the
 * transaction credited, all its refunds together) from the credits not spent yet. What was already spent stays spent:
 * the owner sees it in the Administration log ("refund-unrecovered"). Reversals are only logged: the owner decides.
 */
export function handleAdjustment(adj: any): "removed" | "logged" | "duplicate" | "ignored" {
  const id = typeof adj?.id === "string" ? adj.id.slice(0, 100) : "";
  const txnId = typeof adj?.transaction_id === "string" ? adj.transaction_id : "";
  if (!id || !txnId) return "ignored";
  const row = checkoutOf(txnId);
  if (!row) return "ignored";
  const action = String(adj.action ?? ""), status = String(adj.status ?? "");
  const total = minorUnits(adj.totals?.total);
  if (GIVE_BACK.has(action)) {
    if (status !== "approved") return "ignored";
    if (!firstTime("paddle:adjustment", id)) return "duplicate";
    adminLog(PADDLE_ACTOR, row.user_id, "refund-reversed", `${action} ${id} on ${txnId} (${total ?? "?"} ${adj.currency_code ?? ""}): nothing re-credited automatically — add the credits by hand if they are due`);
    return "logged";
  }
  if (!TAKE_BACK.has(action)) return "ignored";
  if (status !== "approved") {
    if (status === "pending_approval") adminLog(PADDLE_ACTOR, row.user_id, "refund-pending", `${action} ${id} on ${txnId} waits for Paddle's approval: the credits stay until it is approved`);
    return "logged";
  }
  if (row.status !== "paid" && row.status !== "refunded") return "ignored";
  if (!firstTime("paddle:adjustment", id)) return "duplicate";
  // What earlier refunds of this transaction already accounted for (removed or already spent), in cents: kept as
  // billing_events rows "<adjustment id>:<cents>" under provider "paddle:refund:<transaction id>".
  const already = q.all<{ event_id: string }>("SELECT event_id FROM billing_events WHERE provider = ?", `paddle:refund:${txnId}`)
    .reduce((n, r) => n + (Number(r.event_id.split(":").pop()) || 0), 0) / 100;
  const refundedEur = adj.currency_code === "EUR" && total !== null && total > 0 ? total / 100 : row.amount_eur;
  const due = round2(Math.max(0, Math.min(refundedEur, row.amount_eur - already)));
  firstTime(`paddle:refund:${txnId}`, `${id}:${Math.round(due * 100)}`);
  const removed = due > 0 ? removePrepaid(row.user_id, due, { source: "paddle", ref: id, note: `refund ${txnId}`, actor: PADDLE_ACTOR }) : 0;
  q.run("UPDATE credit_checkouts SET status = 'refunded' WHERE session_id = ?", txnId);
  const gap = round2(due - removed);
  adminLog(PADDLE_ACTOR, row.user_id, gap > 0 ? "refund-unrecovered" : "refund", `${action} ${id} on ${txnId}: ${removed} € of credits removed${gap > 0 ? `, ${gap} € already spent on the service's AI keys (not recoverable automatically)` : ""}`);
  return "removed";
}

async function paddleWebhook(c: Context): Promise<Response> {
  const loc = pickLocale(undefined, c.req.header("accept-language"));
  const keys = paddleKeys();
  if (!keys) { const e = paymentsOff(); return c.json({ error: e.text(loc), code: e.code }, 503); }
  // The raw body, exactly as sent: the signature covers it byte for byte.
  const raw = await c.req.text();
  const why = verifyPaddleSignature(raw, c.req.header("paddle-signature"), keys.webhookSecret);
  if (why) { console.warn(`[credits] Paddle webhook refused: ${why}`); return c.json({ error: m(loc, "Invalid signature.") }, 400); }
  let event: any;
  try { event = JSON.parse(raw); } catch { return c.json({ error: "Invalid JSON." }, 400); }
  const eventId = typeof event?.event_id === "string" ? event.event_id.slice(0, 200) : "";
  if (!eventId) return c.json({ error: "Invalid event." }, 400);
  if (q.get("SELECT 1 AS x FROM billing_events WHERE provider = 'paddle' AND event_id = ?", eventId)) return c.json({ received: true, duplicate: true });
  let result: string = "ignored";
  if (PAID_EVENTS.has(event.event_type)) result = fulfillTransaction(event.data);
  else if (ADJUST_EVENTS.has(event.event_type)) result = handleAdjustment(event.data);
  // Recorded after the work: if it failed, Paddle retries, and the transaction / adjustment id still keeps a retry from
  // counting twice.
  q.run("INSERT OR IGNORE INTO billing_events (provider, event_id, received_at) VALUES ('paddle', ?, ?)", eventId, now());
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
      if (err instanceof PaddleError) return c.json({ error: "Paddle" }, 502);
      throw err;
    }
  };
}
/** Without a session: Paddle's webhook. `legacy`: the older /billing/webhook/paddle once Paddle is configured. */
export function registerCreditsPublic(api: Hono<any>) {
  api.post("/billing/paddle/webhook", guard(paddleWebhook));
}
export const paddleLegacyWebhook = (c: Context) => (paymentsOn() ? paddleWebhook(c) : null);

/** For signed-in people. */
export function registerCreditsPrivate(api: Hono<any>) {
  api.get("/billing/credits", guard((c) => c.json(creditsView((c.get("user") as UserRecord).id))));
  api.post("/billing/credits/checkout", guard(async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    return c.json(await startCheckout(c.get("user") as UserRecord, b?.pack));
  }));
}
