/**
 * L158 « Créations »: trajectory cards for the dev gallery (section=cards&type=trajectory) — a poster in progress
 * (study → build → check, with a render identical to the one before), a stalled one (« aucun progrès ») with a page, a
 * video and a file too big for a preview, and a finished one. The thumbnails are drawn here (data: SVG) through
 * setRenderSource, so the gallery never asks a server.
 */
import { setRenderSource } from "../components/TrajectoryCard";
import type { Card, TrajectoryRender } from "../types";
import type { FixtureOptions } from "./fixtures";

type TrajectoryFixture = { type: "trajectory"; status: string; card: Extract<Card, { type: "trajectory" }> };
const COLORS = ["#e2552d", "#3b6fd8", "#2f9e6e", "#c58a12", "#8a4fd0", "#d0457a"];

/** A small picture per render: a coloured poster with its number, the same picture for an unchanged render. */
setRenderSource((_bot, creation, id) => {
  const look = id % 100 === 3 ? 2 : id % 100; // render 3 of the poster is identical to render 2
  const c = COLORS[look % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240"><rect width="320" height="240" fill="#f4f2ee"/><rect x="${20 + look * 8}" y="20" width="${180 - look * 6}" height="200" rx="10" fill="${c}"/><circle cx="250" cy="${70 + look * 12}" r="${24 + look * 4}" fill="#1e2024" opacity=".85"/><text x="40" y="200" font-family="sans-serif" font-size="30" font-weight="700" fill="#fff">${look}</text></svg>`;
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
});

export function trajectoryCardFixtures(o: FixtureOptions): TrajectoryFixture[] {
  const fr = o.lang === "fr";
  const L = (a: string, b: string) => (fr ? a : b);
  const T0 = Date.UTC(2026, 10, 23, 9, 0);
  const r = (id: number, n: number, stage: TrajectoryRender["stage"], kind: TrajectoryRender["kind"], name: string, note: string, unchanged = false, preview = true): TrajectoryRender =>
    ({ id, n, stage, kind, name, note, at: T0 + n * 600_000, bytes: 180_000 + n * 1000, unchanged, preview });
  const longName = (s: string) => (o.long ? `${s}-${L("version-finale-avec-les-couleurs-du-festival-et-le-logo-agrandi", "final-version-with-the-festival-colours-and-a-bigger-logo")}` : s);
  const poster = [
    r(101, 1, "study", "image", "references.png", L("Trois affiches de référence", "Three reference posters")),
    r(102, 2, "build", "image", longName("affiche-v1.png"), L("Premier jet : titre et date", "First draft: title and date")),
    r(103, 3, "build", "image", longName("affiche-v1.png"), L("Rendu relancé", "Render run again"), true),
    r(104, 4, "check", "image", longName("affiche-v2.png"), L("Contraste corrigé, logo plus grand", "Contrast fixed, bigger logo")),
  ];
  const stalled = [
    r(201, 1, "build", "page", "index.html", L("Page d'accueil", "Home page")),
    r(202, 2, "build", "video", "teaser.mp4", L("Teaser 10 s", "10 s teaser")),
    r(203, 3, "check", "file", "export-print.pdf", "", false, false),
    r(204, 4, "check", "file", "export-print.pdf", L("Même export", "Same export"), true, false),
    r(205, 5, "check", "file", "export-print.pdf", L("Même export", "Same export"), true, false),
  ];
  const many = Array.from({ length: 12 }, (_, i) => r(301 + i, 9 + i, i < 3 ? "study" : i < 8 ? "build" : i < 11 ? "check" : "ready", "image", `logo-${9 + i}.png`, ""));
  return [
    { type: "trajectory", status: "check", card: { type: "trajectory", creationId: "cre_poster1", title: o.long ? L("Affiche du concert de fin d'année de l'école de musique — format A2 et réseaux sociaux", "End-of-year music school concert poster — A2 and social media formats") : L("Affiche du concert", "Concert poster"), stage: "check", renders: poster, total: 4, stalled: false } },
    { type: "trajectory", status: "stalled", card: { type: "trajectory", creationId: "cre_site2", title: L("Site du festival", "Festival website"), stage: "check", renders: stalled, total: 5, stalled: true } },
    { type: "trajectory", status: "ready", card: { type: "trajectory", creationId: "cre_logo3", title: L("Logo de la boulangerie", "Bakery logo"), stage: "ready", renders: many, total: 20, stalled: false } },
  ];
}
