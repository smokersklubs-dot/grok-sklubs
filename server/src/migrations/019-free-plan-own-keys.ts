import type { DatabaseSync } from "node:sqlite";

/**
 * Migration 19 — the "Gratuit" plan becomes "bring your own key or subscription" (the owner's choice for his service:
 * free accounts use their own API key or their own Claude / ChatGPT subscription, never the operator's keys).
 * Only the seeded row is touched, and only while it still has the values migration 4 gave it: a plan the owner already
 * edited (budget or French description changed) is left exactly as it is. The previous version of the code reads the
 * row as before (it is the same table and columns).
 */
const OLD_FR = "Pour essayer : les clés d'IA du service, un petit budget chaque mois.";
export function freePlanOwnKeys(db: DatabaseSync): void {
  db.prepare(`UPDATE plans SET ai_budget_eur = 0, description_fr = ?, description_en = ?, updated_at = ?
    WHERE id = 'free' AND kind = 'free' AND ai_budget_eur = 2 AND description_fr = ?`).run(
    "Gratuit : utilise ta propre clé d'API (DeepSeek, OpenAI, Anthropic…) ou ton abonnement Claude / ChatGPT.",
    "Free: use your own API key (DeepSeek, OpenAI, Anthropic…) or your own Claude / ChatGPT subscription.",
    Date.now(), OLD_FR);
}
