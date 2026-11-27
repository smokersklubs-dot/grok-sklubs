/**
 * L99 « lots en parallèle »: batch cards for the dev gallery (section=cards&type=batch) — under way (3 at work, one
 * waiting for an OK, the rest queued, two done), finished (one failed) and stopped. `batchCostGet` answers the card's
 * cost line, so the gallery never asks a server.
 */
import type { BatchCard, BatchCost, Card } from "../types";
import type { FixtureOptions } from "./fixtures";

type BatchFixture = { type: "batch"; status: string; card: Extract<Card, { type: "batch" }> };

export function batchCardFixtures(o: FixtureOptions): BatchFixture[] {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const long = o.long ? L(" — boutique en ligne avec un nom vraiment très long", " — online shop with a really very long name") : "";
  const names = ["Atelier Lune", `Brico Sud${long}`, "Café Nord", "Dalle & Co", "Éco Pièces", "Forge 21", "Gamme Pro", "Halle Verte"];
  const report = (n: string) => L(`${n} : 3 offres de 29 à 79 € par mois, essai gratuit de 14 jours. Point fort : le support par téléphone.`, `${n}: 3 plans from €29 to €79 a month, 14-day free trial. Strong point: phone support.`);
  const running: BatchCard = {
    type: "batch", batchId: "bat_g1", title: L("Prix des concurrents", "Competitor prices"), state: "running", parallel: 3,
    items: names.map((n, i) => i < 2 ? { title: n, state: "done", result: report(n) }
      : i === 2 ? { title: n, state: "running" }
      : i === 3 ? { title: n, state: "waiting", approval: { approvalId: "apr_g_batch", title: L("Ouvrir un compte d'essai sur dalle.example ?", "Open a trial account on dalle.example?"), detail: L("Il faut une adresse e-mail pour voir les prix.", "An email address is needed to see the prices.") } }
      : i < 5 ? { title: n, state: "running" }
      : { title: n, state: "queued" }),
  };
  const done: BatchCard = {
    type: "batch", batchId: "bat_g2", title: L("Avis clients", "Customer reviews"), state: "done", parallel: 3,
    items: names.slice(0, 5).map((n, i) => (i === 4 ? { title: n, state: "failed", result: L("Échec : le site ne répond pas.", "Failed: the site does not answer.") } : { title: n, state: "done", result: report(n) })),
  };
  const stopped: BatchCard = {
    type: "batch", batchId: "bat_g3", title: L("Vérifier les liens du site", "Check the site's links"), state: "stopped", parallel: 1,
    items: names.slice(0, 4).map((n, i) => (i === 0 ? { title: n, state: "done", result: report(n) } : { title: n, state: "stopped" })),
  };
  return [
    { type: "batch", status: "running", card: running },
    { type: "batch", status: "done", card: done },
    { type: "batch", status: "stopped", card: stopped },
  ];
}

/** GET /bots/:id/batches/:batchId in the gallery. */
export function batchCostGet(path: string): BatchCost | undefined {
  const m = /^\/bots\/[^/]+\/batches\/(bat_g\d)$/.exec(path);
  if (!m) return undefined;
  const running = m[1] === "bat_g1";
  return { batchId: m[1], costUsd: running ? 0.0612 : 0.0845, estimatedUsd: 0, turns: running ? 9 : 14, durationMs: running ? 194_000 : 412_000, endedAt: running ? null : Date.UTC(2026, 10, 25, 10, 0) };
}
