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
