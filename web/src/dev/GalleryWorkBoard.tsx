/**
 * « Tableau de travail » in the dev gallery (section=tableau): the kanban with its ideas, a recorded flow waiting for the
 * owner's approval with its evidence and a page change, the triggers and routines without AI, a workspace's team memory
 * with a guest's note to review, and the week's review with one proposed rule. `empty=1`: nothing yet. `long=1`: long
 * titles (the 390 px check).
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Bot } from "../types";
import type { BoardView } from "../../../server/src/workboardtypes";
import { AutomationsPanel, BoardPanel, FlowsPanel, LessonsPanel, TeamPanel, WorkBoardTabs } from "../components/WorkBoard";
import type { BoardTab, EventTrigger, FlowRunView, FlowView, WeekReview } from "../lib/workboard";
import { fakeBot, NOW, type FixtureOptions } from "./fixtures";

const IDS = { ada: "wb_ada", bea: "wb_bea" };

function boardFixture(o: FixtureOptions, empty: boolean): BoardView {
  const fr = o.lang === "fr";
  if (empty) return { tasks: [], ideas: [] };
  const long = o.long ? (fr ? " — version longue avec toutes les sources citées, les chiffres de l'année et un résumé pour le site" : " — long version with every source cited, the year's figures and a summary for the site") : "";
  const base = { description: "", startAt: null, files: [], acceptance: "auto" as const, armed: false, goalId: null, chantierId: null, ideaId: null, thread: 0, note: "", summary: "", batch: "", createdAt: NOW - 3600_000, updatedAt: NOW, startedAt: null, endedAt: null, dependents: [], waitingOn: [], deps: [] };
  return {
    tasks: [
      { ...base, id: "t1", title: (fr ? "Recherche des prix concurrents" : "Research competitors' prices") + long, botId: IDS.ada, priority: 1, state: "review", column: "review", acceptance: "owner", summary: fr ? "Tableau de 12 concurrents dans prix.xlsx." : "Table of 12 competitors in prix.xlsx.", dependents: ["t2"], files: [{ id: "f1", name: "consignes.pdf", type: "application/pdf", size: 220_000, addedAt: NOW }] },
      { ...base, id: "t2", title: fr ? "Nouvelle page tarifs" : "New pricing page", botId: IDS.bea, priority: 2, state: "waiting", column: "waiting", armed: true, deps: ["t1"], waitingOn: ["t1"], startAt: NOW + 20 * 3600_000 },
      { ...base, id: "t3", title: fr ? "Relancer les devis" : "Follow up on quotes", botId: IDS.ada, priority: 3, state: "blocked", column: "blocked", note: fr ? "la boîte mail n'est pas connectée" : "the mailbox is not connected" },
      { ...base, id: "t4", title: fr ? "Résumé de la réunion" : "Meeting summary", botId: IDS.bea, priority: 4, state: "done", column: "done", summary: fr ? "Envoyé dans le fil." : "Posted in the thread." },
      { ...base, id: "t5", title: fr ? "Carte d'une ancienne version" : "Card from an older version", botId: null, priority: 5, state: "archived_v9", column: "done" },
    ],
    ideas: [
      { id: "i1", number: 7, author: "Owner", title: fr ? "Les prix de la page mobile sont faux" : "Prices on the mobile page are wrong", body: "", urgency: "bug", progress: "partial", files: [{ id: "f2", name: "capture.png", type: "image/png", size: 80_000, addedAt: NOW }], taskIds: ["t1", "t2"], done: 1, total: 2, createdAt: NOW - 86_400_000, updatedAt: NOW },
      { id: "i2", number: 8, author: "Owner", title: fr ? "Un bilan chaque vendredi" : "A review every Friday", body: "", urgency: "idea", progress: "todo", files: [], taskIds: [], done: 0, total: 0, createdAt: NOW, updatedAt: NOW },
    ],
  };
}

function flowsFixture(o: FixtureOptions, empty: boolean): { flows: FlowView[]; runs: Record<string, FlowRunView[]> } {
  const fr = o.lang === "fr";
  if (empty) return { flows: [], runs: {} };
  const f: FlowView = {
    id: "fl1", botId: IDS.ada, name: fr ? "Surveiller le prix et commander" : "Watch the price and order", recording: false, createdAt: NOW - 86_400_000, updatedAt: NOW, lastRunAt: NOW - 120_000, commitSteps: 1, blockedSteps: 1,
    steps: [{ kind: "open", url: "https://shop.example/chaussures", commit: false }, { kind: "read", commit: false }, { kind: "click", label: fr ? "Ajouter au panier" : "Add to cart", commit: false }, { kind: "click", label: fr ? "Payer maintenant" : "Pay now", commit: true }, { kind: "blocked", why: fr ? "un identifiant enregistré a été tapé" : "a saved login was typed", commit: true }],
  };
  const run: FlowRunView = { id: "fr1", flowId: "fl1", startedAt: NOW - 120_000, endedAt: null, status: "waiting_approval", atStep: 3, changed: true, cause: "routine", note: fr ? "L'étape 4 peut engager quelque chose (« Payer maintenant ») : autorise-la pour continuer." : "Step 4 could commit something (“Pay now”): allow it to go on.",
    evidence: [
      { n: 0, kind: "open", ok: true, url: "https://shop.example/chaussures", title: "Chaussures", excerpt: "", hash: "a1b2c3d4e5f60718", note: "", shot: true },
      { n: 1, kind: "read", ok: true, url: "https://shop.example/chaussures", title: "Chaussures", excerpt: "Prix : 35 €", hash: "0f1e2d3c4b5a6978", note: "", shot: false, diff: { added: ["Prix : 35 €"], removed: ["Prix : 40 €"] } },
      { n: 2, kind: "click", ok: true, url: "https://shop.example/panier", title: fr ? "Panier" : "Cart", excerpt: "", hash: "9a8b7c6d5e4f3021", note: "", shot: true },
    ] };
  return { flows: [f, { ...f, id: "fl2", name: fr ? "Relevé des commandes" : "Order report", recording: true, steps: [f.steps[0]], commitSteps: 0, blockedSteps: 0, lastRunAt: null }], runs: { fl1: [run] } };
}

const triggersFixture = (o: FixtureOptions, empty: boolean): EventTrigger[] => empty ? [] : [
  { id: "tr1", event: "flow.page_changed", subject: "fl1", action: "notice", target: o.lang === "fr" ? "Le prix a changé !" : "The price changed!", botId: IDS.ada, enabled: true, fired: 3, lastFiredAt: NOW - 600_000, lastNote: o.lang === "fr" ? "note publiée" : "note posted", createdAt: NOW - 86_400_000 },
  { id: "tr2", event: "board.task_done", subject: "", action: "flow", target: "fl2", botId: IDS.bea, enabled: false, fired: 0, lastFiredAt: null, lastNote: "", createdAt: NOW },
];

function teamFixture(o: FixtureOptions, empty: boolean) {
  const fr = o.lang === "fr";
  const spaces = [{ kind: "workspace" as const, id: "ws1", name: fr ? "Atelier" : "Workshop", admin: true }];
  const n = (id: string, text: string, extra: Record<string, unknown> = {}) => ({ id, scope: { kind: "workspace", id: "ws1" }, authorName: "Mia", byGuest: false, text, status: "active" as const, links: [], linkedFrom: [], createdAt: NOW - 3600_000, updatedAt: NOW, ...extra });
  return {
    spaces,
    notes: empty ? [] : [
      n("n1", fr ? "Le client Dupont paie à 30 jours." : "Customer Dupont pays at 30 days.", { links: [{ kind: "url", ref: "https://dupont.example/", label: "site" }], linkedFrom: ["n2"] }),
      n("n2", fr ? "Toujours envoyer les devis en PDF." : "Always send quotes as PDF.", { authorName: "Owner" }),
      n("n3", fr ? "Facture de mars envoyée." : "March invoice sent.", { authorName: fr ? "Comptable (invité)" : "Accountant (guest)", byGuest: true, status: "pending" }),
    ],
    guests: empty ? [] : [{ id: "g1", name: fr ? "Comptable" : "Accountant", canWrite: true, expiresAt: NOW + 6 * 86_400_000, createdAt: NOW, revoked: false }],
  };
}

const weekFixture = (o: FixtureOptions, empty: boolean): WeekReview => ({
  from: NOW - 7 * 86_400_000, to: NOW, success: empty ? 0 : 9, failure: empty ? 0 : 2,
  perBot: empty ? [] : [{ botId: IDS.ada, name: "Ada", success: 6, failure: 2 }, { botId: IDS.bea, name: "Bea", success: 3, failure: 0 }],
  proposals: empty ? [] : [{ key: "k1", botId: IDS.ada, botName: "Ada", count: 2, evidence: [o.lang === "fr" ? "Export des ventes" : "Sales export", o.lang === "fr" ? "Stock du jour" : "Today's stock"],
    text: o.lang === "fr" ? "Avant de commencer un travail, vérifier d'abord ce qui a bloqué 2 fois cette semaine : Connexion à Shopify expirée. Si c'est encore le cas, me le dire tout de suite." : "Before starting a piece of work, first check what blocked it 2 times this week: Shopify connection expired. If it still holds, tell me at once." }],
});

export function GalleryWorkBoard({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const [ready, setReady] = useState(false);
  const [tab, setTab] = useState<BoardTab>("board");
  useEffect(() => {
    const extra: Record<string, Bot> = { [IDS.ada]: fakeBot(o, { id: IDS.ada, name: "Ada" }), [IDS.bea]: fakeBot(o, { id: IDS.bea, name: "Bea" }) };
    useStore.setState((s) => ({ bots: { ...s.bots, ...extra } }));
    setReady(true);
  }, [o.lang, o.long]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;
  const fr = o.lang === "fr";
  const flows = flowsFixture(o, empty);
  return (
    <main className="gallery-body wb-gallery">
      <section className="gallery-section" aria-label="Onglets">
        <h2 className="gallery-h">{fr ? "Les onglets" : "The tabs"}</h2>
        <div className="gallery-page is-auto"><WorkBoardTabs tab={tab} onTab={setTab} /></div>
      </section>
      <section className="gallery-section" aria-label="Tableau">
        <h2 className="gallery-h">{fr ? "Tableau : idées, à faire, en cours (à relire), bloquées, faites" : "Board: ideas, to do, under way (to review), blocked, done"}</h2>
        <div className="gallery-page is-auto"><BoardPanel data={boardFixture(o, empty)} /></div>
      </section>
      <section className="gallery-section" aria-label="Parcours">
        <h2 className="gallery-h">{fr ? "Parcours enregistrés : une étape attend ton accord" : "Recorded flows: a step waits for your OK"}</h2>
        <div className="gallery-page is-auto"><FlowsPanel data={flows} /></div>
      </section>
      <section className="gallery-section" aria-label="Automatisations">
        <h2 className="gallery-h">{fr ? "Déclencheurs et routines sans IA" : "Triggers and routines without AI"}</h2>
        <div className="gallery-page is-auto"><AutomationsPanel data={{ triggers: triggersFixture(o, empty), flows: flows.flows }} /></div>
      </section>
      <section className="gallery-section" aria-label="Mémoire d'équipe">
        <h2 className="gallery-h">{fr ? "Mémoire d'équipe : une note d'invité à relire" : "Team memory: a guest's note to review"}</h2>
        <div className="gallery-page is-auto"><TeamPanel data={teamFixture(o, empty)} /></div>
      </section>
      <section className="gallery-section" aria-label="Bilan">
        <h2 className="gallery-h">{fr ? "Bilan de la semaine : une règle proposée" : "Week review: one proposed rule"}</h2>
        <div className="gallery-page is-auto"><LessonsPanel data={weekFixture(o, empty)} /></div>
      </section>
    </main>
  );
}
