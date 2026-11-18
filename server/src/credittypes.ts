/**
 * Wire types of the hosted mode's credits (credits.ts, Settings → Credits). Type-only; re-exported by shared.ts so the web
 * app gets them with the rest of the contract.
 */

/** A credit pack the owner offers (Administration → Settings): its id is what a client sends, never an amount. */
export interface CreditPack { id: string; amountEur: number }

/** One line of the credits history: credits bought or given (prepaid, they carry over) or a top-up for one month. */
export interface CreditEntry { id: string; at: number; kind: "prepaid" | "month"; source: "stripe" | "manual"; amountEur: number; note: string }

/** What one calendar month cost on the service's AI keys, and how much of it the prepaid credits paid. */
export interface CreditMonthSpend { month: string; spentEur: number; fromCreditsEur: number }

/** Settings → Credits: how this account's bots can work, and the prepaid credits. */
export interface CreditsView {
  operator: boolean;
  /** Prepaid credits left right now (€). */
  balanceEur: number;
  /** This month: the plan's own AI budget, the operator's top-ups for this month, and what the service's keys cost. */
  month: string; planBudgetEur: number; monthTopUpEur: number; spentEur: number;
  packs: CreditPack[];
  /** "stripe": the "Buy" buttons open Stripe Checkout; "off": no payment provider yet (contact the owner). */
  payments: "stripe" | "off";
  contactUrl: string;
  history: CreditEntry[];
  spend: CreditMonthSpend[];
  /** The three ways: own Claude / ChatGPT sign-in allowed here, the service's keys allowed on this plan. */
  subscriptionEngines: boolean; operatorKeys: boolean;
  /** The account's main bot (where its engine sign-in lives), when it has one. */
  mainBot: { id: string; name: string } | null;
}
