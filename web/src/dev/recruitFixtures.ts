/**
 * Fake data for « Bot recruteur » in the dev gallery (Gallery.tsx): the main bot's proposal of a new specialist in every
 * state (pending, each limit, created, declined). Never shipped: the gallery is development only.
 */
import type { Card } from "../types";
import type { FixtureOptions } from "./fixtures";

type RecruitCard = Extract<Card, { type: "recruit" }>;

export function recruitCardFixtures(o: FixtureOptions): { label: string; card: RecruitCard }[] {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const more = o.long ? L(" Elle tient aussi un tableau des écarts de paiement, relance les factures en retard avec un message poli et prépare chaque trimestre un récapitulatif pour l'expert-comptable.", " It also keeps a table of late payments, sends polite reminders for overdue invoices and prepares a summary for the accountant every quarter.") : "";
  const base: RecruitCard = {
    type: "recruit", name: "Lina", role: L("Comptabilité", "Bookkeeping"),
    why: L("Tes factures reviennent chaque mois et aucun bot de l'équipe ne s'occupe de compta.", "Your invoices come back every month and no bot on the team handles bookkeeping."),
    instructions: L("Range les factures reçues par e-mail dans le dossier Compta, vérifie les montants et la TVA, et tiens à jour le tableau des dépenses du mois.", "Files the invoices received by email into the Bookkeeping folder, checks amounts and VAT, and keeps the month's expense sheet up to date.") + more,
    skills: [{ id: "methode-de-travail", title: L("Méthode de travail", "Working method") }],
    routines: [
      { name: L("Factures de la semaine", "This week's invoices"), schedule: "0 9 * * 1", when: L("chaque lundi à 09:00", "every Monday at 09:00"), prompt: "" },
      { name: L("Clôture du mois", "Month-end close"), schedule: "0 18 28 * *", when: L("le 28 de chaque mois à 18:00", "on the 28th of every month at 18:00"), prompt: "" },
    ],
    brain: "same", brainLabel: "anthropic:claude-sonnet-4-6",
    task: L("Trier les 14 factures d'octobre arrivées dans Gmail et me dire le total HT et TVA.", "Sort the 14 October invoices that arrived in Gmail and tell me the total before tax and the VAT."),
    status: "pending",
  };
  return [
    { label: "pending", card: base },
    { label: "pending · limit plan", card: { ...base, limit: "plan", limitN: 3 } },
    { label: "pending · limit daily", card: { ...base, brain: "default", brainLabel: "openai:gpt-5.1", skills: [], routines: [], limit: "daily", limitN: 3 } },
    { label: "created", card: { ...base, status: "created", botId: "bot_lina", botName: "Lina" } },
    { label: "declined", card: { ...base, status: "declined" } },
  ];
}
