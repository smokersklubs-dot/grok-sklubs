import { seal, unseal } from "../auth.js"; import { guardVault } from "../vaultaccess.js";
import { boundCard } from "./tools-browser.js";
import { q } from "../db.js";
import type { ToolSpec } from "../llm/types.js";
import type { Payment } from "../shared.js";
import { audit, cardSpent, clip, newId, now, vault, type VaultRecord } from "../store.js";
import { hostOf, probe } from "./bind.js";
import type { BuiltinTool } from "./tools.js";

/**
 * Payments with a vault card (spec 07 A12), without any card provider: the server types the card on the merchant's
 * page in the bot's own browser.
 *
 *  - A card is a vault item of kind "card". Its number, expiry, CVC and the name on it are sealed together; only the
 *    network and the last 4 digits are ever shown — to the user, and to the model (vault_list).
 *  - card_fill types the card fields at the positions the bot gives, on the page in front, and can press the pay
 *    button. Every payment needs its own approval (the deterministic floor: always asked, never "Always", single use),
 *    bound to amount, currency, merchant, card AND the page's host (bind.ts): at run time, a different page fills
 *    nothing. Over a card's daily or monthly cap, it is refused before any card is shown.
 *  - "Card filled" is not "paid": the bot must read the merchant's page. An interruption leaves the outcome unknown
 *    (executions.ts), never replayed; the payment counts against the caps until the user says otherwise.
 *  - Never from a phone channel: the approval card must be answered in the app (telegram.ts refuses it).
 */

export interface CardSecret { number: string; expiry: string; cvc: string; holder: string }

/** Luhn check (ISO/IEC 7812-1) and the network from the number's prefix (IIN ranges published by the networks). */
export function luhnOk(number: string): boolean {
  const d = number.replace(/\D/g, "");
  if (d.length < 12 || d.length > 19) return false;
  let sum = 0;
  for (let i = 0; i < d.length; i++) {
    let n = Number(d[d.length - 1 - i]);
    if (i % 2 === 1) { n *= 2; if (n > 9) n -= 9; }
    sum += n;
  }
  return sum % 10 === 0;
}
export function brandOf(number: string): string {
  const d = number.replace(/\D/g, "");
  if (/^4/.test(d)) return "Visa";
  if (/^(5[1-5]|2(2[2-9]|[3-6]\d|7[01]|720))/.test(d)) return "Mastercard";
  if (/^3[47]/.test(d)) return "American Express";
  if (/^(6011|65|64[4-9])/.test(d)) return "Discover";
  if (/^35(2[89]|[3-8])/.test(d)) return "JCB";
  return "Card";
}

/** Checks the card fields typed by the user and seals them. Throws with a message for the user. */
export function sealCard(f: { number: unknown; expiry: unknown; cvc: unknown; holder: unknown }): { enc: string; brand: string; last4: string } {
  const number = String(f.number ?? "").replace(/[\s-]/g, "");
  const expiry = String(f.expiry ?? "").trim();
  const cvc = String(f.cvc ?? "").trim();
  const holder = String(f.holder ?? "").trim().slice(0, 80);
  if (!/^\d{12,19}$/.test(number) || !luhnOk(number)) throw new Error("This card number is not valid.");
  const m = /^(0[1-9]|1[0-2])\s*\/\s*(\d{2}|\d{4})$/.exec(expiry);
  if (!m) throw new Error("The expiry date must look like MM/YY.");
  if (!/^\d{3,4}$/.test(cvc)) throw new Error("The security code (CVC) must be 3 or 4 digits.");
  const card: CardSecret = { number, expiry: `${m[1]}/${m[2].slice(-2)}`, cvc, holder };
  return { enc: seal(JSON.stringify({ card: true, ...card })), brand: brandOf(number), last4: number.slice(-4) };
}

export function openCard(item: VaultRecord): CardSecret | null {
  if (item.kind !== "card" || !item.passwordEnc) return null;
  try { const c = JSON.parse(unseal(item.passwordEnc) ?? "null"); return c?.number ? { number: String(c.number), expiry: String(c.expiry ?? ""), cvc: String(c.cvc ?? ""), holder: String(c.holder ?? "") } : null; } catch { return null; }
}

/** How the bot's card is named to the model and on cards: name, network, last 4 digits. Never more. */
export const cardLabel = (item: VaultRecord) => `${item.name} (${item.card?.brand || "Card"} •••• ${item.card?.last4 || "????"})`;

/** Whether a payment fits the card's caps. Null when it does; else the reason (English template) and its values. */
export function capProblem(userId: string, input: Record<string, unknown>): { reason: string; vars: Record<string, string> } | null {
  const item = vault.byName(userId, String(input.card ?? ""));
  if (!item || item.kind !== "card" || !item.card) return null; // the tool itself explains
  const amount = Number(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const day = cardSpent(item.id, "day"), month = cardSpent(item.id, "month");
  if (item.card.dailyCapUsd !== null && day + amount > item.card.dailyCapUsd)
    return { reason: "This payment would pass the daily cap of {card} ({spent} already spent today, cap {cap}).", vars: { card: cardLabel(item), spent: day.toFixed(2), cap: item.card.dailyCapUsd.toFixed(2) } };
  if (item.card.monthlyCapUsd !== null && month + amount > item.card.monthlyCapUsd)
    return { reason: "This payment would pass the monthly cap of {card} ({spent} already spent this month, cap {cap}).", vars: { card: cardLabel(item), spent: month.toFixed(2), cap: item.card.monthlyCapUsd.toFixed(2) } };
  return null;
}

const toPayment = (r: any): Payment => ({ id: r.id, botId: r.bot_id, cardId: r.card_id, cardName: r.card_name, amount: r.amount, currency: r.currency, merchant: r.merchant, host: r.host, status: r.status, createdAt: r.created_at });
export const payments = {
  list: (userId: string, limit = 100) => q.all("SELECT * FROM payments WHERE user_id = ? ORDER BY created_at DESC LIMIT ?", userId, limit).map(toPayment),
  create(f: { userId: string; botId: string; card: VaultRecord; amount: number; currency: string; merchant: string; host: string }): string {
    const id = newId("pay");
    q.run("INSERT INTO payments (id, user_id, bot_id, card_id, card_name, amount, currency, merchant, host, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", id, f.userId, f.botId, f.card.id, cardLabel(f.card), f.amount, f.currency, f.merchant, f.host, now());
    return id;
  },
  set: (id: string, status: Payment["status"]) => q.run("UPDATE payments SET status = ? WHERE id = ?", status, id),
};

/** Replaceable in tests: clicking and typing on the bot's screen. */
export const cardScreen = {
  // Bound to the approved page: checked on the bot's active tab right before each click and each field (tools-browser.ts).
  click: (botId: string, userId: string, x: number, y: number, host = "") => boundCard.click(botId, userId, x, y, host),
  type: (botId: string, userId: string, text: string, host = "") => boundCard.type(botId, userId, text, host),
};

const FIELDS = ["number", "expiry", "exp_month", "exp_year", "cvc", "name"] as const;
type Field = (typeof FIELDS)[number];
const valueOf = (c: CardSecret, f: Field) => (f === "number" ? c.number : f === "expiry" ? c.expiry : f === "exp_month" ? c.expiry.slice(0, 2) : f === "exp_year" ? c.expiry.slice(3) : f === "cvc" ? c.cvc : c.holder);

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

export const cardTools: BuiltinTool[] = guardVault([{ // L41 (vaultaccess.ts)
  spec: {
    name: "card_fill",
    description: "Pay with one of the user's saved cards: types the card's fields into the payment form on the page in front of you (positions from your last screenshot), and can press the pay button. You never see the card (only its name, network and last 4 digits, from vault_list). Every payment is asked to the user, bound to this amount, merchant, card and page: fill the cart first, open the payment page, then call this once. A filled card is not a payment: read the page afterwards and tell the user what it says.",
    inputSchema: obj({
      card: str("Name of the saved card (vault_list)"),
      amount: { type: "number", description: "The total shown on the page, e.g. 42.9" },
      currency: str("Its currency as shown, e.g. EUR"),
      merchant: str("The shop, as shown on the page"),
      fields: { type: "array", description: "Where each card field is on the page: [{\"field\": \"number\"|\"expiry\"|\"exp_month\"|\"exp_year\"|\"cvc\"|\"name\", \"x\": .., \"y\": ..}]", items: { type: "object", properties: { field: { type: "string", enum: [...FIELDS] }, x: { type: "integer" }, y: { type: "integer" } }, required: ["field", "x", "y"] } },
      submit: { type: "object", description: "Optional: where the pay button is ({\"x\": .., \"y\": ..}), to press it once the card is filled", properties: { x: { type: "integer" }, y: { type: "integer" } } },
    }, ["card", "amount", "currency", "merchant", "fields"]),
  },
  activity: "computer", label: "Paying with a saved card", group: "vault", audited: true, detail: (a) => clip(String(a.merchant ?? ""), 40),
  // The deterministic floor: every payment asks, every time; "Always" is never offered.
  gate: (a) => ({
    key: `card: ${String(a.card ?? "").trim()}`, strict: true, once: true, source: "Vault",
    title: "Allow {bot} to pay {amount} {currency} to {merchant} with {card}?", reason: "pay {amount} {currency} to {merchant}",
    vars: { amount: String(a.amount ?? "?"), currency: clip(String(a.currency ?? ""), 8), merchant: clip(String(a.merchant ?? "?"), 80), card: clip(String(a.card ?? "?"), 80), host: String(a.seen_host || "—") },
    note: "Page: {host}. This approval is for this payment only: same amount, shop, card and page. Sklubot types the card itself; the bot never sees it.",
  }),
  run: async (a, c) => {
    const item = vault.byName(c.user.id, String(a.card));
    if (!item || item.kind !== "card") return { content: `No saved card is called "${a.card}". Use vault_list to see the names.`, isError: true };
    const card = openCard(item);
    if (!card) return { content: "That card is incomplete. Ask the user to fix it in Settings → Vault.", isError: true };
    const amount = Number(a.amount);
    if (!Number.isFinite(amount) || amount <= 0) return { content: "Give the amount shown on the page.", isError: true };
    const fields = (Array.isArray(a.fields) ? a.fields : []).filter((f: any) => f && FIELDS.includes(f.field) && Number.isFinite(Number(f.x)) && Number.isFinite(Number(f.y))).slice(0, 6) as { field: Field; x: number; y: number }[];
    if (!fields.length) return { content: "Say where the card fields are (fields: [{field, x, y}]).", isError: true };
    // Bound to the page the approval was given for: if the page in front changed, nothing is typed.
    const bound = String(a.seen_host ?? "");
    const here = hostOf(await probe.pageUrl(c.bot.id, c.user.id).catch(() => ""));
    if (!bound || !here || here !== bound) return { content: `The page in front (${here || "unknown"}) is not the one this payment was approved for (${bound || "unknown"}). Nothing was typed. Do not try again on another page.`, isError: true, summary: "page changed" };
    const loc = c.user.locale;
    const payId = payments.create({ userId: c.user.id, botId: c.bot.id, card: item, amount, currency: clip(String(a.currency ?? ""), 8).toUpperCase(), merchant: clip(String(a.merchant ?? ""), 120), host: here });
    audit(c.user.id, "vault", `${c.bot.name}: ${cardLabel(item)} — ${amount} ${String(a.currency ?? "")} → ${clip(String(a.merchant ?? ""), 80)} (${here})`, c.bot.id);
    try {
      for (const f of fields) {
        await cardScreen.click(c.bot.id, c.user.id, Math.round(Number(f.x)), Math.round(Number(f.y)), here);
        await cardScreen.type(c.bot.id, c.user.id, valueOf(card, f.field), here);
      }
      const submit = a.submit && Number.isFinite(Number(a.submit.x)) && Number.isFinite(Number(a.submit.y)) ? a.submit : null;
      if (submit) await cardScreen.click(c.bot.id, c.user.id, Math.round(Number(submit.x)), Math.round(Number(submit.y)), here);
      payments.set(payId, submit ? "submitted" : "filled");
      void loc;
      return {
        content: `${submit ? "Filled the card and pressed the pay button" : "Filled the card fields"} (${cardLabel(item)}: ${fields.map((f) => f.field).join(", ")}) on ${here}, for ${amount} ${String(a.currency ?? "")}. This is NOT proof of payment: take a screenshot or read the page now, and tell the user exactly what it says (confirmation, error, a 3-D Secure step for them to do on their phone…).`,
        summary: `${amount} ${String(a.currency ?? "")} · ${item.card?.brand ?? ""} ${item.card?.last4 ?? ""}`,
      };
    } catch (err) {
      // Some fields may have gone in: the outcome is unknown; it still counts against the caps.
      payments.set(payId, "uncertain");
      throw err;
    }
  },
}]);
