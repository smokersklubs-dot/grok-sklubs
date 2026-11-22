/**
 * DS-Bot item 8: view cards for the dev gallery (section=cards&type=view): key figures + chart + table + progress
 * ("shown"), a form waiting ("pending"), answered and closed.
 */
import type { Card, ViewBlock } from "../types";
import type { FixtureOptions } from "./fixtures";

type ViewFixture = { type: "view"; status: string; card: Extract<Card, { type: "view" }> };

export function viewCardFixtures(o: FixtureOptions): ViewFixture[] {
  const fr = o.lang === "fr";
  const L = (a: string, b: string) => (fr ? a : b);
  const long = (s: string) => (o.long ? `${s} — ${L("détail par magasin, semaine 47, hors retours et remboursements", "per shop, week 47, without returns and refunds")}` : s);
  const sales: ViewBlock[] = [
    { kind: "stats", items: [{ label: L("Chiffre", "Revenue"), value: "4 210 €", hint: "+12 %" }, { label: L("Commandes", "Orders"), value: "87" }, { label: L("Panier moyen", "Average basket"), value: "48,40 €" }] },
    { kind: "chart", chart: "bar", labels: L("Lun Mar Mer Jeu Ven Sam Dim", "Mon Tue Wed Thu Fri Sat Sun").split(" "), series: [{ name: L("Cette semaine", "This week"), values: [420, 510, 380, 640, 720, 980, 560] }, { name: L("Semaine dernière", "Last week"), values: [390, 450, 410, 520, 690, 870, 430] }], unit: "€" },
    { kind: "table", columns: [L("Produit", "Product"), L("Ventes", "Sales"), L("Stock", "Stock")], rows: [[long(L("Pain de campagne", "Country bread")), "320", "42"], ["Croissant", "290", "12"], [L("Tarte aux pommes", "Apple pie"), "64", "5"]] },
    { kind: "progress", label: L("Objectif du mois", "Monthly goal"), value: 4210, max: 10000 },
  ];
  const form: ViewBlock[] = [
    { kind: "text", text: L("Pour réserver la salle, dis-moi :", "To book the room, tell me:") },
    { kind: "form", submit: L("Réserver", "Book"), fields: [
      { id: "people", label: L("Personnes", "People"), type: "number", required: true },
      { id: "room", label: L("Salle", "Room"), type: "choice", options: [L("Terrasse", "Terrace"), L("Intérieur", "Inside")] },
      { id: "note", label: L("Note", "Note"), type: "text", placeholder: L("près de la fenêtre…", "by the window…") },
      { id: "veg", label: L("Menu végétarien", "Vegetarian menu"), type: "checkbox" },
    ] },
  ];
  const fallback = L("📊 Ventes de la semaine\n\n• Chiffre : 4 210 € (+12 %)\n• Commandes : 87", "📊 Sales of the week\n\n• Revenue: 4 210 € (+12 %)\n• Orders: 87");
  return [
    { type: "view", status: "shown", card: { type: "view", title: long(L("Ventes de la semaine", "Sales of the week")), blocks: sales, fallback, status: "shown" } },
    { type: "view", status: "pending", card: { type: "view", title: L("Réservation", "Booking"), blocks: form, fallback: "📝", status: "pending" } },
    { type: "view", status: "answered", card: { type: "view", title: L("Réservation", "Booking"), blocks: form, fallback: "📝", status: "answered", answer: L("Personnes: 4 · Salle: Terrasse", "People: 4 · Room: Terrace") } },
    { type: "view", status: "dismissed", card: { type: "view", title: L("Réservation", "Booking"), blocks: form, fallback: "📝", status: "dismissed" } },
  ];
}
