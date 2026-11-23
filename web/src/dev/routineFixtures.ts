/** nod items 2, 8, 13 in the dev gallery (GalleryRoutines.tsx): what the server answers for a routine's extras and preview. */
import type { FixtureOptions } from "./fixtures";

const H = 3600_000;
export function routineExtrasFixture(o: FixtureOptions, empty: boolean) {
  const fr = o.lang === "fr";
  const due = Date.now() - 26 * H;
  return {
    revision: empty ? 0 : 3, editedAt: empty ? null : Date.now() - 2 * H, model: "", effectiveModel: "anthropic:claude-sonnet-4-6",
    approval: empty ? { state: "none", scope: null, approvedAt: null } : { state: "approved", scope: { targets: o.long ? ["camille.martin@exemple-entreprise-internationale.fr", "Slack #veille-concurrentielle-et-marché-international"] : ["camille@exemple.fr"], maxRunsPerDay: 1, until: null }, approvedAt: Date.now() - 5 * H },
    track: empty ? [] : [{ runId: "run_1", dueAt: due, startedAt: due + 42 * 60_000, missed: 3, lateMs: 42 * 60_000, byHand: false, line: fr ? "Prévue le 21/11/2026 07:30, lancée le 21/11/2026 08:12 · 3 exécutions sautées pendant l'arrêt" : "Due 11/21/26, 7:30 AM, started 11/21/26, 8:12 AM · 3 runs skipped while the server was off" }],
  };
}
export function routinePreviewFixture(o: FixtureOptions) {
  const day = 24 * H;
  const start = Date.now() + 20 * H;
  return { describe: o.lang === "fr" ? "En semaine à 7 h 30" : "Weekdays at 7:30 AM", next: [start, start + day, start + 2 * day], monthlyUsd: 0.42 };
}

/** L142 (GalleryRoutines.tsx): a routine's last runs with their duration and cost, and 30 days of spending. */
export function routineRunsFixture(o: FixtureOptions, empty: boolean) {
  const fr = o.lang === "fr";
  if (empty) return { runs: [] };
  const at = (d: number) => Date.now() - d * 24 * H;
  return { runs: [
    { id: "run_4", routineId: "rtn_gallery_nod", at: Date.now() - 120_000, status: "running", note: "", costUsd: 0.004 },
    { id: "run_3", routineId: "rtn_gallery_nod", at: at(1), status: "done", note: fr ? "Résumé envoyé à camille@exemple.fr" : "Summary sent to camille@exemple.fr", costUsd: 0.031, durationMs: 2 * 60_000 + 14_000 },
    { id: "run_2", routineId: "rtn_gallery_nod", at: at(2), status: "quiet", note: o.long ? (fr ? "Rien de nouveau dans les sources suivies depuis la dernière fois, aucune nouvelle ne méritait un résumé ce matin" : "Nothing new in the followed sources since last time, no news deserved a summary this morning") : "", costUsd: 0.008, durationMs: 41_000 },
    { id: "run_1", routineId: "rtn_gallery_nod", at: at(3), status: "error", note: fr ? "Le site des nouvelles ne répondait pas." : "The news site did not answer.", costUsd: 0, durationMs: 9_000 },
  ] };
}
export function usageDailyFixture(empty: boolean) {
  const DAY = 24 * H, today = Math.floor(Date.now() / DAY) * DAY;
  const days = Array.from({ length: 30 }, (_, i) => {
    const c = empty ? 0 : [0.12, 0.4, 0, 0.08, 0.95, 0.31, 0][i % 7] * (1 + (i % 5) / 4);
    return { day: new Date(today - (29 - i) * DAY).toISOString().slice(0, 10), costUsd: Math.round(c * 1000) / 1000, estimatedUsd: !empty && i % 9 === 4 ? 0.2 : 0, turns: c ? 3 + (i % 6) : 0 };
  });
  return { days, totalUsd: days.reduce((a, d) => a + d.costUsd, 0), estimatedUsd: days.reduce((a, d) => a + d.estimatedUsd, 0) };
}

/** L156 (GalleryRoutines.tsx): one research report, to show its « Exporter en Markdown / PDF » buttons. */
export function researchFixture(o: FixtureOptions, empty: boolean) {
  const fr = o.lang === "fr";
  if (empty) return { reports: [] };
  return { reports: [{
    id: "rr_1", state: "done",
    brief: { subject: o.long ? (fr ? "Prix de l'électricité pour les petites entreprises en France, en Allemagne et en Espagne depuis 2022" : "Electricity prices for small businesses in France, Germany and Spain since 2022") : (fr ? "Prix de l'électricité" : "Electricity prices"), plan: [fr ? "Quel prix aujourd'hui ?" : "What price today?", fr ? "Quelle tendance ?" : "Which trend?"] },
    sections: [{ question: fr ? "Quel prix aujourd'hui ?" : "What price today?", read: 4, at: Date.now() - 3600_000, notes: [], sources: [],
      findings: [{ url: "https://example.org/prix", title: fr ? "Observatoire des prix" : "Price observatory", claim: fr ? "Le prix moyen a baissé de 8 % sur un an." : "The average price fell 8% over a year.", quote: fr ? "« une baisse de 8 % »" : "“an 8% fall”", published: "2026-10-02" }] }],
  }] };
}
