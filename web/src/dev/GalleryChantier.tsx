/**
 * « Chantier » in the dev gallery (section=chantier): the owner's example « outil qui transforme un article en cartes
 * pour les réseaux sociaux » — the plan to approve (with what is left to fix), then the chantier under way: the graph
 * coloured by state, the export task rejected once with its failure report, the escalation card, the figures and the
 * lesson; then the list. `empty=1`: no chantier yet. view=new: the « Nouveau chantier » form alone.
 */
import { useEffect, useState } from "react";
import { useStore } from "../store";
import type { Bot } from "../types";
import type { ChantierView } from "../../../server/src/chantiertypes";
import { articleCardsPlan, ARTICLE_CARDS_TITLE } from "../../../server/src/chantierexample";
import { ChantierList, ChantierPage, NewChantier } from "../components/Chantier";
import { fakeBot, NOW, type FixtureOptions } from "./fixtures";

const IDS = { research: "ch_ada", build: "ch_bea", review: "ch_cid" };

function chantierFixture(o: FixtureOptions, running: boolean): ChantierView & { problems: string[] } {
  const fr = o.lang === "fr";
  const plan = articleCardsPlan(IDS);
  if (o.long) plan.tasks[2].title = fr ? "Export des images de toutes les cartes au format portrait pour Instagram, LinkedIn et Facebook" : "Export the images of every card in portrait size for Instagram, LinkedIn and Facebook";
  if (running) plan.unknowns[0].answer = "12";
  const t0 = NOW - 42 * 60_000;
  const failed = { id: "count", label: "autant d'images que de cartes", kind: "file_count" as const, pass: false, actual: "2 fichiers", expected: "3 fichiers" };
  return {
    chantier: { id: "ch_gallery", title: ARTICLE_CARDS_TITLE, brief: "", plannerBotId: IDS.research, status: running ? "waiting_owner" : "proposed", plan, note: "", createdAt: t0 - 5 * 60_000, approvedAt: running ? t0 : null, endedAt: null },
    tasks: running ? [
      { key: "recherche", state: "accepted", botId: IDS.research, thread: 11, goalId: "g1", attempts: 1, extra: 0, waiting: "", note: "", startedAt: t0, endedAt: t0 + 6 * 60_000 },
      { key: "exigences", state: "accepted", botId: IDS.review, thread: 12, goalId: "g2", attempts: 1, extra: 0, waiting: "", note: "", startedAt: t0, endedAt: t0 + 9 * 60_000 },
      { key: "export", state: "blocked", botId: IDS.build, thread: 13, goalId: "g3", attempts: 3, extra: 0, waiting: "", note: fr ? "limite d'essais atteinte" : "limit of attempts reached", startedAt: t0 + 10 * 60_000, endedAt: null },
      { key: "ensemble", state: "waiting", botId: IDS.review, thread: 0, goalId: null, attempts: 0, extra: 0, waiting: "", note: "", startedAt: null, endedAt: null },
    ] : [],
    attempts: running ? [1, 2, 3].map((n) => ({
      id: `a${n}`, taskKey: "export", n, botId: IDS.build, goalId: `g3${n}`, startedAt: t0 + (8 + n * 8) * 60_000, endedAt: t0 + (14 + n * 8) * 60_000, result: "failed" as const,
      summary: fr ? "Images exportées." : "Images exported.", evidence: fr ? "3 cartes dans l'éditeur, export lancé." : "3 cards in the editor, export run.",
      checks: [failed, { id: "order", label: "images dans l'ordre de l'éditeur", kind: "same_order" as const, pass: true, actual: "même ordre (3 éléments)", expected: "" }, { id: "size", label: "images en 1080 × 1350", kind: "image_size" as const, pass: true, actual: "2 images à la bonne taille", expected: "1080 × 1350" }],
      report: { component: "Export des images (export)", conditions: `Essai ${n} sur 3, par Bea ; entrée : cards.json et exigences.md`, failure: "autant d'images que de cartes : 2 fichiers", expected: "autant d'images que de cartes : 3 fichiers", repairScope: "Seulement « Export des images » : ses fichiers dans chantiers/ch_gallery/export. Ne pas changer : Ne pas changer la génération du texte. ; Ne pas changer l'éditeur.", recheck: ["autant d'images que de cartes", "puis les vérifications d'ensemble de : Vérification d'ensemble"] },
      costUsd: 0.04, tokens: 9_200,
    })) : [],
    decisions: running ? [{ id: "d1", taskKey: "export", kind: "escalation", question: fr ? "La tâche « Export des images » a échoué 3 fois. Dernier échec : autant d'images que de cartes : 2 fichiers. Attendu : 3 fichiers. Tous les essais et leurs preuves sont gardés." : "Task “Export des images” failed 3 times. Last failure: 2 files. Expected: 3 files. Every attempt and its evidence are kept.", options: ["retry", "accept", "stop_branch"], status: "open", answer: null, note: "", createdAt: NOW - 3 * 60_000 }] : [],
    lessons: running ? [{ id: "l1", rule: "Vérifier : images en 1080 × 1350", evidence: "Chantier « Bannières », tâche « Export » : l'essai 1 a échoué (1200 × 1200), réussi à l'essai 2.", appliesTo: "build export images", check: null, status: "active", sourceChantier: "ch_old", uses: 2, createdAt: NOW - 86_400_000, updatedAt: NOW - 86_400_000 }] : [],
    nudges: running ? [{ at: t0, kind: "intervention", reason: fr ? "plan approuvé" : "approved the plan" }, { at: t0 + 20 * 60_000, kind: "restate", reason: fr ? "exigences : il a oublié le format portrait" : "exigences: forgot the portrait size" }] : [],
    metrics: { durationMs: running ? 42 * 60_000 : 0, costUsd: running ? 0.19 : 0, tokens: running ? 41_000 : 0, defects: running ? 1 : 0, interventions: running ? 1 : 0, continues: 0, restates: running ? 1 : 0, attempts: running ? 5 : 0 },
    problems: running ? [] : [fr ? "Réponds à la question ouverte : Combien de cartes au plus par article ?" : "Answer the open question: How many cards at most per article?"],
  };
}

export function GalleryChantier({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const extra: Record<string, Bot> = { [IDS.research]: fakeBot(o, { id: IDS.research, name: "Ada" }), [IDS.build]: fakeBot(o, { id: IDS.build, name: "Bea" }), [IDS.review]: fakeBot(o, { id: IDS.review, name: "Cid" }) };
    useStore.setState((s) => ({ bots: { ...s.bots, ...extra } }));
    setReady(true);
  }, [o.lang, o.long]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ready) return null;
  const fr = o.lang === "fr";
  const list = empty ? [] : [{ id: "ch_gallery", title: ARTICLE_CARDS_TITLE, status: "waiting_owner" as const, tasks: 4, accepted: 2, blocked: 1, openDecisions: 1, createdAt: NOW }, { id: "ch_2", title: fr ? "Bannières du site" : "Site banners", status: "done" as const, tasks: 3, accepted: 3, blocked: 0, openDecisions: 0, createdAt: NOW - 86_400_000 }];
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Chantier">
        <h2 className="gallery-h">{fr ? "Chantier en cours : schéma, essais, rapport d'échec, carte de décision" : "Chantier running: graph, attempts, failure report, decision card"}</h2>
        <div className="gallery-page is-auto"><ChantierPage id="ch_gallery" data={chantierFixture(o, true)} /></div>
      </section>
      <section className="gallery-section" aria-label="Plan">
        <h2 className="gallery-h">{fr ? "Plan à approuver" : "Plan to approve"}</h2>
        <div className="gallery-page is-auto"><ChantierPage id="ch_gallery_plan" data={chantierFixture(o, false)} /></div>
      </section>
      <section className="gallery-section" aria-label="Nouveau">
        <h2 className="gallery-h">{fr ? "Nouveau chantier" : "New chantier"}</h2>
        <div className="gallery-page is-auto"><NewChantier botId={IDS.research} /></div>
      </section>
      <section className="gallery-section" aria-label="Liste">
        <h2 className="gallery-h">{fr ? "La liste des chantiers" : "The chantier list"}</h2>
        <div className="gallery-page is-auto"><ChantierList data={list} /></div>
      </section>
    </main>
  );
}
