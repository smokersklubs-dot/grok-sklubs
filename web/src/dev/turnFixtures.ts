import type { Card, Row } from "../types";
import type { CardFixture, FixtureOptions } from "./fixtures";

/**
 * Gallery fixtures of the turn-control batch (L72, L79, L83, L94, L98, L139): rich question and plan cards, an approval
 * whose text can be corrected, cards with a countdown, and the notices with « Continuer seul », « Reprendre ma note »,
 * « Annuler ».
 */
const MIN = 60_000;

export function turnCardFixtures(o: FixtureOptions): CardFixture[] {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const long = (s: string) => (o.long ? `${s} ${L("— avec une précision très longue qui doit revenir à la ligne sans déborder sur un téléphone de 390 px", "— with a very long detail that has to wrap without overflowing on a 390 px phone")}` : s);
  const draft = { subject: L("Devis mars", "March quote"), body: long(L("Bonjour Claire,\n\nVoici le devs pour mars. Dis-moi si tout te va.\n\nBonne journée", "Hi Claire,\n\nHere is the quot for March. Tell me if it all works for you.\n\nBest")) };
  const cards: CardFixture[] = [
    { type: "approval", status: "pending", card: { type: "approval", approvalId: "ap_draft", status: "pending", title: L("Envoyer l'e-mail « Devis mars » à Claire ?", "Send the “March quote” email to Claire?"), detail: `to: claire@example.com\nsubject: ${draft.subject}\nbody: ${draft.body}`, tool: "gmail", source: "Gmail", draft, parksAt: Date.now() + 14 * MIN } },
    { type: "approval", status: "pending", card: { type: "approval", approvalId: "ap_soon", status: "pending", title: L("Laisser un programme de Juno appeler l'API Stripe ?", "Let a program of Juno call the Stripe API?"), detail: "POST api.stripe.com/v1/refunds", tool: "egress: stripe", source: "Stripe", once: true, expiresAt: Date.now() + 95_000 } },
    { type: "approval", status: "allowed", card: { type: "approval", approvalId: "ap_edited", status: "allowed", title: L("Envoyer l'e-mail « Devis mars » à Claire ?", "Send the “March quote” email to Claire?"), detail: `to: claire@example.com\nsubject: ${draft.subject}`, tool: "gmail", source: "Gmail", edited: true, outcome: "done" } },
    { type: "question", status: "pending", card: { type: "question", status: "pending", question: long(L("Quelle offre pour le client ?", "Which offer for the client?")), options: [L("Essentiel", "Basic"), L("Pro", "Pro"), L("Sur mesure", "Custom")], recommended: L("Pro", "Pro"), why: L("Le prix du devis en dépend.", "The quote's price depends on it."), irreversible: true } },
    { type: "question", status: "pending", card: { type: "question", status: "pending", question: L("Avant de lancer la campagne", "Before launching the campaign"), options: [], questions: [
      { question: L("Quand commencer ?", "When to start?"), options: [L("Aujourd'hui", "Today"), L("Lundi", "Monday")], recommended: L("Lundi", "Monday") },
      { question: long(L("Quels réseaux ?", "Which networks?")), options: ["Instagram", "LinkedIn", "TikTok"], multiple: true },
      { question: L("Qui valide les visuels ?", "Who approves the visuals?"), options: [L("Moi", "Me"), L("Mon associée", "My partner")] },
    ] } },
    { type: "question", status: "pending", card: { type: "question", status: "pending", question: L("Déménager la boutique", "Move the shop"), options: [L("Approuver", "Approve"), L("Approuver avec une note", "Approve with a note"), L("Le modifier", "Change it")], recommended: L("Approuver", "Approve"), why: L("Ça touche la boutique en ligne.", "It touches the live shop."), plan: { version: 2, steps: [L("Exporter les produits", "Export the products"), L("Créer la nouvelle boutique", "Create the new shop"), long(L("Passer une commande test", "Place a test order")), L("Basculer le domaine", "Switch the domain")], added: [long(L("Passer une commande test", "Place a test order"))], removed: [L("Prévenir les clients", "Tell the customers")] } } },
    { type: "takeover", status: "pending", card: { type: "takeover", takeoverId: "tk_soon", reason: "2fa", detail: L("Tape le code reçu par SMS.", "Type the code you got by text."), status: "pending", expiresAt: Date.now() + 25 * MIN } },
  ] as { type: Card["type"]; status: string; card: Card }[];
  return cards;
}

export function turnNoticeRows(o: FixtureOptions, row: (body: Row["body"], at: number) => Row, at: number): Row[] {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  return [
    row({ kind: "notice", tone: "warn", text: L("Je me suis arrêté après 60 étapes pour ne pas m'emballer. Dis-moi de continuer si ça vaut le coup.", "I stopped after 60 steps to avoid running away with this. Tell me to continue if it is worth it."), action: { kind: "continue", status: "pending", auto: true } }, at),
    row({ kind: "notice", tone: "info", text: L("J'ai atteint 60 étapes et le travail avance : je continue tout seul (4 fois de plus au maximum).", "I reached 60 steps and the work is moving forward: I am carrying on on my own (4 more time(s) at most).") }, at + 1),
    row({ kind: "notice", tone: "warn", text: L("Le serveur a redémarré avant que je lise ta note : « regarde aussi sklubs.fr/tarifs ». Elle est gardée — appuie sur « Reprendre ma note » pour la renvoyer.", "The server restarted before I read your note: “also look at sklubs.fr/pricing”. It is kept — press « Resume my note » to send it again."), action: { kind: "note", noteId: 7, status: "pending" } }, at + 2),
    row({ kind: "notice", tone: "info", text: L("Juno a enregistré une nouvelle compétence : Factures du mois.", "Juno saved a new skill: Monthly invoices."), action: { kind: "undo", undoId: "und_1", status: "pending", expiresAt: Date.now() + 20 * 60 * MIN } }, at + 3),
    row({ kind: "notice", tone: "info", text: L("Juno a mis en pause la routine Veille du matin.", "Juno paused the routine Morning watch."), action: { kind: "undo", undoId: "und_2", status: "done", expiresAt: Date.now() + 20 * 60 * MIN } }, at + 4),
    row({ kind: "notice", tone: "info", text: L("Tout est arrêté. Arrêté aussi : 1 assistant(s), 2 tâche(s) de fond. 3 message(s) ou suite(s) en attente annulé(s). Ce qui était déjà fait est gardé.", "Everything is stopped. Also stopped: 1 helper(s), 2 background task(s). 3 waiting message(s) or follow-up(s) were cancelled. What was already done is kept.") }, at + 5),
    row({ kind: "notice", tone: "info", text: L("⏰ Je repasse dans 20 min (vers 15:40 UTC) : la fin de la compilation", "⏰ I will come back to this in 20 min (around 15:40 UTC): the end of the build") }, at + 6),
  ];
}

/** GET /inbox in the gallery (InboxView.tsx): the waiting cards above, spread over three bots. */
export function inboxFixture(o: FixtureOptions & { empty?: boolean }) {
  const names = ["Juno", o.long ? "Assistante commerciale de la boutique en ligne" : "Max", "Nora"];
  const items = o.empty ? [] : turnCardFixtures(o).filter((c) => c.status === "pending").map((c, i) => ({ botId: `b${i % 3}`, botName: names[i % 3], seq: i + 1, thread: 0, createdAt: Date.now() - i * 7 * MIN, card: c.card, kind: c.type === "approval" ? "approval" : c.type === "question" ? "question" : "other" }));
  return { items, counts: { all: items.length } };
}
