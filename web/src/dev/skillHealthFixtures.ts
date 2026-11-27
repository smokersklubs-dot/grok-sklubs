/** The dev gallery's « Santé des compétences » and « Catalogue de l'équipe » (section=skillhealth). Development only. */
import type { BenchResult, CatalogSkill, Skill, SkillHealth, SkillHealthReport, SkillVersion } from "../types";
import type { FixtureOptions } from "./fixtures";

const DAY = 86_400_000;
const NOW = Date.now();
const SCOPE = { sections: [], bots: [], exclude: [] };
const base = (o: Partial<SkillHealth> & Pick<SkillHealth, "skillId" | "name">): SkillHealth => ({
  botId: "gal_bot", botName: "jiren", uses: 0, failures: 0, lastUsedAt: null, lastFailure: "", state: "active", archivedBy: null, pinned: false, locked: false,
  madeBy: "owner", onlyOnRequest: false, alwaysFull: false, scope: SCOPE, chars: 900, sections: 1, versions: 0, update: null, similar: [], inline: false, ...o,
});

export function skillHealthFixture(o: FixtureOptions, empty: boolean): SkillHealthReport {
  const fr = o.lang === "fr";
  if (empty) return { skills: [], suggestions: [], pass: { checked: 0, markedStale: 0, archived: 0, reactivated: 0 }, staleAfterDays: 14, archiveAfterDays: 30 };
  const long = o.long ? (fr ? " pour toutes les boutiques du réseau, chaque premier lundi du mois, avec les chiffres de l'année d'avant" : " for every shop of the network, each first Monday of the month, with last year's figures") : "";
  const skills: SkillHealth[] = [
    base({ skillId: "gal_skill_report", name: (fr ? "Rapport des ventes" : "Sales report") + long, uses: 12, lastUsedAt: NOW - 2 * DAY, failures: 2, lastFailure: fr ? "Étape 1 : le tableur a changé d'adresse." : "Step 1: the spreadsheet moved.", pinned: true, versions: 3, sections: 4, chars: 8200 }),
    base({ skillId: "gal_skill_devis", name: fr ? "Faire un devis" : "Write a quote", uses: 4, lastUsedAt: NOW - 6 * DAY, locked: true, onlyOnRequest: true, update: { kind: "library", title: fr ? "Rédiger un devis" : "Write a quote" } }),
    base({ skillId: "gal_skill_factures", name: fr ? "Ranger les factures" : "File the invoices", botName: "Nora", madeBy: "bot", similar: [{ skillId: "gal_skill_fact2", name: fr ? "Factures du mois" : "Monthly invoices", botName: "Compta", score: 0.82 }] }),
    base({ skillId: "gal_skill_vieille", name: fr ? "Vieille veille" : "Old watch", madeBy: "bot", state: "archived", archivedBy: "curator", uses: 1, lastUsedAt: NOW - 45 * DAY }),
    base({ skillId: "gal_skill_court", name: fr ? "Réponses courtes" : "Short replies", inline: true, update: { kind: "catalog", title: fr ? "Réponses courtes" : "Short replies" } }),
  ];
  return {
    skills, pass: { checked: 5, markedStale: 0, archived: 1, reactivated: 0 }, staleAfterDays: 14, archiveAfterDays: 30,
    suggestions: [
      { kind: "failing", skillId: "gal_skill_report", name: skills[0].name, botName: "jiren", detail: skills[0].lastFailure },
      { kind: "duplicate", skillId: "gal_skill_factures", name: skills[2].name, botName: "Nora", detail: "82", otherId: "gal_skill_fact2", otherName: fr ? "Factures du mois (Compta)" : "Monthly invoices (Compta)" },
      { kind: "archived", skillId: "gal_skill_vieille", name: skills[3].name, botName: "jiren", detail: "30" },
    ],
  };
}

export const healthSkillFixture = (o: FixtureOptions): Skill => ({
  id: "gal_skill_report", botId: "gal_bot", name: o.lang === "fr" ? "Rapport des ventes" : "Sales report", description: o.lang === "fr" ? "Chaque lundi matin" : "Every Monday morning",
  body: "## …", needs: "", check: "", output: "", approvals: "", shared: true, learned: false, outside: false, draft: false, createdAt: NOW - 40 * DAY, updatedAt: NOW - 2 * DAY,
});

export function catalogFixture(o: FixtureOptions, empty: boolean): CatalogSkill[] {
  const fr = o.lang === "fr";
  if (empty) return [];
  return [
    { id: "gal_cat_1", name: fr ? "Accueil d'un nouveau client" : "Welcoming a new customer", description: fr ? "Remercier, proposer un appel, envoyer la plaquette." : "Thank them, offer a call, send the brochure.", body: "", version: 3, fromBot: "jiren", updatedAt: NOW - 3 * DAY, addedTo: 2, botCount: 4 },
    { id: "gal_cat_2", name: fr ? "Relance d'un devis sans réponse" : "Following up an unanswered quote", description: fr ? "Une relance polie à J+7, une dernière à J+15." : "A polite follow-up at day 7, a last one at day 15.", body: "", version: 1, fromBot: "Nora", updatedAt: NOW - 20 * DAY, addedTo: 4, botCount: 4 },
  ];
}

export const versionsListFixture = (o: FixtureOptions): SkillVersion[] => [
  { id: "gal_v1", name: "", description: "", body: o.lang === "fr" ? "1. Ouvre le tableur partagé.\n2. Résume les ventes par boutique." : "1. Open the shared spreadsheet.\n2. Summarise sales by shop.", savedAt: NOW - 2 * DAY, reason: "" },
  { id: "gal_v2", name: "", description: "", body: o.lang === "fr" ? "1. Ouvre le tableur.\n2. Résume." : "1. Open the spreadsheet.\n2. Summarise.", savedAt: NOW - 12 * DAY, reason: "" },
];

export const benchFixture = (o: FixtureOptions): BenchResult => {
  const fr = o.lang === "fr";
  const w = fr ? "Ventes de la semaine : 12 430 € (+8 %).\n• Meilleure boutique : Lyon.\n• À surveiller : Nantes (−12 %)." : "This week's sales: €12,430 (+8%).\n• Best shop: Lyon.\n• To watch: Nantes (−12%).";
  const wo = fr ? "Bien sûr ! Pour faire le résumé des ventes de la semaine, il faudrait d'abord que je récupère les données de chaque boutique, puis que je les additionne et que je compare avec la semaine précédente. Ensuite je pourrais te présenter un tableau détaillé avec toutes les colonnes…" : "Of course! To summarise this week's sales, I would first need to collect the data from each shop, then add it up and compare it with the previous week. Then I could show you a detailed table with every column…";
  return { prompt: fr ? "Fais le résumé des ventes de la semaine." : "Summarise this week's sales.", skillName: fr ? "Rapport des ventes" : "Sales report", withSkill: { text: w, chars: w.length }, without: { text: wo, chars: wo.length } };
};
