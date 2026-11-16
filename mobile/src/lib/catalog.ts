/** The app catalogue as the "connect" card shows it (same matching rule as web/src/components/Modals.tsx). Pure. */
import type { CatalogApp } from "../../../server/src/shared";

/** Same rule as the web: an app answers the card when one name contains the other. */
export function answersCard(appName: string, asked: string): boolean {
  const a = appName.trim().toLowerCase();
  const b = asked.trim().toLowerCase();
  return !!a && !!b && (a.includes(b) || b.includes(a));
}

/** Apps to show: the ones matching the bot's request first, then the search, by category order of the catalogue. */
export function rankApps(apps: CatalogApp[], asked: string, q: string): CatalogApp[] {
  const needle = q.trim().toLowerCase();
  const shown = apps.filter((a) => !needle || `${a.name} ${a.description}`.toLowerCase().includes(needle));
  return [...shown.filter((a) => answersCard(a.name, asked)), ...shown.filter((a) => !answersCard(a.name, asked))];
}

/** Same connector address (a trailing slash and the case do not matter). */
export const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();
