/**
 * « Relecture et recherche » in the dev gallery (section=relecture): a peer review's findings anchored to lines with
 * the per-file coverage (L77; « Vide » : an approved review with nothing found), then the deep research options and a
 * question's source states, dates and engagement (L87).
 */
import { useState } from "react";
import { PeerReviewFindings } from "../components/PeerReviewFindings";
import { FindingMeta, ResearchOptions, SourceStates } from "../components/ResearchExtras";
import type { PeerReviewResult, ResearchExtra, ResearchWindow } from "../types";
import { NOW, type FixtureOptions } from "./fixtures";
import "../components/research.css";

function reviewFixture(o: FixtureOptions, empty: boolean): PeerReviewResult {
  const fr = o.lang === "fr";
  const long = o.long ? "server/src/integrations/billing/providers/very-long-folder-name/invoice-totals-calculator.ts" : "src/orders/pagination.ts";
  return {
    reviewer: "Relecteur", verdict: empty ? "approved" : "changes", partial: false, at: NOW, reason: "", goal: true, batches: empty ? 1 : 3, dropped: empty ? 0 : 1, lookups: 2,
    findings: empty ? [] : [
      { path: long, line: 5, endLine: 5, side: "new", category: "bug", severity: "high", text: fr ? "`<=` renvoie 21 éléments au lieu de 20, avec des cases vides sur la dernière page." : "`<=` returns 21 items instead of 20, with empty slots on the last page." },
      { path: "server/search.ts", line: 14, endLine: 15, side: "new", category: "risk", severity: "critical", text: fr ? "Le nom est collé dans la requête SQL : injection possible. Utiliser un paramètre." : "The name is pasted into the SQL query: injection. Use a parameter." },
      { path: "server/search.ts", line: 13, endLine: 13, side: "new", category: "test", severity: "medium", text: fr ? "Aucun test ne couvre byName." : "No test covers byName." },
      { path: "jobs/prices.ts", line: 0, endLine: 0, side: "new", category: "load", severity: "low", text: fr ? "Une requête par produit, sans limite." : "One request per product, unbounded." },
    ],
    coverage: [
      { path: long, status: "reviewed" }, { path: "server/search.ts", status: "reviewed" }, { path: "jobs/prices.ts", status: "reviewed" },
      { path: "package-lock.json", status: "skipped", reason: "generated" }, { path: ".env", status: "skipped", reason: "secret" }, { path: "logo.png", status: "skipped", reason: "binary" },
    ],
  };
}

export function GalleryReview({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const fr = o.lang === "fr";
  const [period, setPeriod] = useState<ResearchWindow | "auto">("auto");
  const [extras, setExtras] = useState<ResearchExtra[]>(["hn", "reddit"]);
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Relecture">
        <h2>{fr ? "Relecture entre bots : points relevés et fichiers relus" : "Peer review: findings and files reviewed"}</h2>
        <div className="gallery-page is-auto peer-review">
          <p role="status"><strong>Relecteur · {empty ? (fr ? "Approuvé" : "Approved") : fr ? "Corrections demandées" : "Changes requested"}</strong></p>
          <PeerReviewFindings review={reviewFixture(o, empty)} fr={fr} />
        </div>
      </section>
      <section className="gallery-section" aria-label="Recherche">
        <h2>{fr ? "Recherche approfondie : période, sources, état par source" : "Deep research: period, sources, per-source status"}</h2>
        <div className="gallery-page is-auto research-panel">
          <ResearchOptions fr={fr} window={period} setWindow={setPeriod} extras={extras} setExtras={setExtras} />
          <div className="research-finding">
            <blockquote>Bun 2 runtime ships a faster bundler for TypeScript projects.</blockquote>
            <a href="https://news.ycombinator.com/item?id=101">Hacker News · Bun 2 runtime ships a faster bundler</a>
            <FindingMeta published="2026-11-19" engagement={fr ? "412 points, 96 commentaires" : "412 points, 96 comments"} fr={fr} />
          </div>
          <SourceStates fr={fr} states={empty ? [{ source: "hn", state: "rate_limited", count: 0 }] : [{ source: "web", state: "ok", count: 5 }, { source: "hn", state: "ok", count: 3 }, { source: "polymarket", state: "empty", count: 0 }, { source: "reddit", state: "rate_limited", count: 0 }, { source: "youtube", state: "login", count: 0 }]} />
          <p className="muted">{empty ? (fr ? "Pas de conclusion possible : Hacker News (limite de débit). Impossible de dire que personne n’en parle." : "No conclusion possible: Hacker News (rate limited). This does not mean nobody talks about it.") : fr ? "1 source(s) publiée(s) avant la période (30 derniers jours) écartée(s)." : "1 source(s) published before the period (last 30 days) set aside."}</p>
        </div>
      </section>
    </main>
  );
}
