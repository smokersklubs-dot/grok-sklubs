/**
 * « Routines » in the dev gallery (section=routines): nod items 2, 8, 13 — a routine running now (live line), its late
 * run track, the editor open with the preview of the next runs, the « Approuver toute la consigne » form; then the
 * models for routines, background tasks and other background work. `empty=1`: a routine that never ran and has no approval.
 */
import { RoutineMore, WorkModels } from "../components/RoutineEditor";
import { RoutineCalendarFeed, RoutineRunForm } from "../components/RoutineParams";
import { RoutineHistory } from "../components/BotSettings";
import { UsageChart } from "../components/UsageChart";
import { ComputerHoursBlock } from "../components/ComputerHours";
import { ResearchPanel } from "../components/ResearchPanel";
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
      <section className="gallery-section" aria-label="L143">
        <h2>{fr ? "Routine avec paramètres ; mes routines dans mon agenda" : "Routine with parameters; my routines in my calendar"}</h2>
        <div className="gallery-page is-auto">
          <RoutineRunForm r={{ ...r, id: "rtn_gallery_params", prompt: fr ? "Résume les nouvelles de {{secteur=l'énergie}} pour {{période=cette semaine}} et envoie-les à {{destinataire}}." : "Summarise the news of {{sector=energy}} for {{period=this week}} and send them to {{recipient}}." }} onNote={() => undefined} />
          <RoutineCalendarFeed startStatus={empty ? { active: false, createdAt: null, lastReadAt: null } : { active: true, createdAt: NOW - 86400_000, lastReadAt: null, url: `${location.origin}/api/calendar/${o.long ? "x".repeat(32) : "Zx81_qLmT0pa9w2KcV7nYb3hR5sE1uFg"}.ics` }} />
          {!empty && <RoutineCalendarFeed startStatus={{ active: true, createdAt: NOW - 5 * 86400_000, lastReadAt: NOW - 3600_000 }} />}
        </div>
      </section>
      <section className="gallery-section" aria-label="L142">
        <h2>{fr ? "Durée et coût de chaque exécution ; dépenses des 30 derniers jours ; heures d'ordinateur" : "Duration and cost of each run; spending over the last 30 days; computer hours"}</h2>
        <div className="gallery-page is-auto">
          <RoutineHistory r={r} />
          <UsageChart />
          {/* L95: computer hours of the month with a cap (reached when `empty`), and without one. */}
          <ComputerHoursBlock initial={{ month: "2026-11", usedHours: empty ? 40 : 12.5, capHours: 40, ownCapHours: 40, operatorCapHours: o.long ? 60 : null, reached: empty }} />
          <ComputerHoursBlock initial={{ month: "2026-11", usedHours: 3.2, capHours: null, ownCapHours: null, operatorCapHours: null, reached: false }} />
        </div>
      </section>
      <section className="gallery-section" aria-label="L156">
        <h2>{fr ? "Exporter un rapport de recherche" : "Export a research report"}</h2>
        <div className="gallery-page is-auto"><ResearchPanel bot={GALLERY_BOT_ID} fr={fr} active /></div>
      </section>
    </main>
  );
}
