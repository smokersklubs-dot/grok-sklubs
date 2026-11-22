/**
 * « Routines » in the dev gallery (section=routines): nod items 2, 8, 13 — a routine running now (live line), its late
 * run track, the editor open with the preview of the next runs, the « Approuver toute la consigne » form; then the
 * model for background tasks. `empty=1`: a routine that never ran and has no approval.
 */
import { RoutineMore, WorkModels } from "../components/RoutineEditor";
import type { Routine } from "../types";
import { fakeBot, GALLERY_BOT_ID, NOW, type FixtureOptions } from "./fixtures";

export function galleryRoutine(o: FixtureOptions, empty: boolean): Routine {
  const fr = o.lang === "fr";
  return {
    id: "rtn_gallery_nod", botId: GALLERY_BOT_ID, name: fr ? "Veille du matin" : "Morning watch",
    prompt: o.long ? (fr ? "Chaque matin, lis les nouvelles de mon secteur, garde les trois plus importantes et envoie-moi un résumé court par e-mail, avec les liens, puis prépare un brouillon de message pour l'équipe sur Slack #veille-concurrentielle-et-marché-international." : "Every morning, read my industry's news, keep the three most important and email me a short summary with the links, then draft a message for the team on Slack #competitive-and-international-market-watch.") : (fr ? "Résume les nouvelles de mon secteur et envoie-les-moi." : "Summarise my industry's news and send them to me."),
    trigger: "cron", watch: null, native: null, schedule: "30 7 * * 1-5", timezone: "Europe/Paris", runAt: null, hookUrl: null,
    enabled: true, lastRunAt: empty ? null : NOW - 3600_000, nextRunAt: NOW + 20 * 3600_000, describe: fr ? "En semaine à 7 h 30" : "Weekdays at 7:30 AM", createdAt: NOW - 30 * 86400_000,
    skipUnchanged: false, inputs: [], failures: 0, pausedReason: null, running: !empty, projectedMonthlyUsd: 0.42,
  };
}

export function GalleryRoutines({ o, empty }: { o: FixtureOptions; empty: boolean }) {
  const r = galleryRoutine(o, empty);
  const fr = o.lang === "fr";
  return (
    <main className="gallery-body">
      <section className="gallery-section" aria-label="Routines">
        <h2>{fr ? "Routine : en cours, piste, modifier, approuver toute la consigne" : "Routine: running, track, edit, approve the whole instruction"}</h2>
        <div className="gallery-page is-auto">
          <ul className="list"><li className="routine"><div className="list-row-text"><span className="list-row-title">{r.name}</span><span className="list-row-sub">{r.describe}</span></div><p className="routine-prompt">{r.prompt}</p><RoutineMore r={r} open onNote={() => undefined} onError={() => undefined} /></li></ul>
          <WorkModels bot={fakeBot(o)} />
        </div>
      </section>
    </main>
  );
}
