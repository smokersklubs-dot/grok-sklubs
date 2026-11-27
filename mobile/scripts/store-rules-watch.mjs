#!/usr/bin/env node
/**
 * L160 — veille des règles des boutiques :  cd mobile && npm run store:rules
 *
 * Reads ONLY the "last updated" date of the two official rule pages (nothing else of the page is kept or compared):
 * - Apple App Review Guidelines, https://developer.apple.com/app-store/review/guidelines/ — the page ends with
 *   « Last Updated: <Month D, YYYY> »;
 * - Google Play Developer Policy Center, https://play.google/developer-content-policy/ — the banner at the top reads
 *   « <Month D, YYYY>: We're updating our policies » (the HTTP Last-Modified header is noted too, for information).
 * The dates seen last are in store/rules-watch.json. A date that changed: the script says which page, where to read the
 * changes, and exits with code 2 (a scheduled task can then warn the owner). After reading the changes (and adapting
 * STORE.md / docs/BOUTIQUES.md if needed): `npm run store:rules -- --save` records the new dates.
 * Exit codes: 0 nothing new, 2 a page changed, 1 a page could not be read or its date was not found (look by hand).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const STATE = join(ROOT, "store/rules-watch.json");

export const SOURCES = [
  { id: "apple", name: "Apple — App Review Guidelines", url: "https://developer.apple.com/app-store/review/guidelines/", news: "https://developer.apple.com/news/", date: /Last Updated:\s*([A-Z][a-z]+ \d{1,2}, \d{4})/ },
  { id: "google", name: "Google Play — Developer Policy Center", url: "https://play.google/developer-content-policy/", news: "https://play.google/developer-content-policy/", date: /([A-Z][a-z]+ \d{1,2}, \d{4}):\s*We(?:'|’|&#39;|&rsquo;)re updating our policies/ },
];

/** Text of a page without its tags (enough to find a date). */
export const pageText = (html) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/g, " ").replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/\s+/g, " ");
export function findDate(source, html) {
  return source.date.exec(pageText(html))?.[1] ?? null;
}

/** Compares what was read with what was saved: one line per source. Pure, for the tests. */
export function compare(saved, seen) {
  return SOURCES.map((s) => {
    const now = seen[s.id], before = saved?.[s.id]?.date ?? null;
    if (!now || now.error) return { id: s.id, level: "ÉCHEC", text: `${s.name} : page illisible (${now?.error ?? "pas de réponse"}) — regarde à la main : ${s.url}` };
    if (!now.date) return { id: s.id, level: "ÉCHEC", text: `${s.name} : date « dernière mise à jour » introuvable (la page a changé de forme) — regarde à la main : ${s.url}` };
    if (!before) return { id: s.id, level: "NOUVEAU", text: `${s.name} : mise à jour du ${now.date} (pas encore de date enregistrée ; --save pour l'enregistrer)` };
    if (before !== now.date) return { id: s.id, level: "CHANGÉ", text: `${s.name} : NOUVELLE VERSION du ${now.date} (avant : ${before}). Lis les changements : ${s.news}` };
    return { id: s.id, level: "OK", text: `${s.name} : pas de changement (mise à jour du ${now.date})` };
  });
}

export async function readSources(fetcher = fetch) {
  const seen = {};
  for (const s of SOURCES) {
    try {
      const res = await fetcher(s.url, { headers: { "user-agent": "store-rules-watch (Sklubot)" }, redirect: "follow", signal: AbortSignal.timeout(30_000) });
      if (!res.ok) { seen[s.id] = { error: `HTTP ${res.status}` }; continue; }
      seen[s.id] = { date: findDate(s, await res.text()), lastModified: res.headers.get("last-modified") ?? null };
    } catch (e) {
      seen[s.id] = { error: e.message };
    }
  }
  return seen;
}

export function exitCode(lines) {
  if (lines.some((l) => l.level === "ÉCHEC")) return 1;
  return lines.some((l) => l.level === "CHANGÉ") ? 2 : 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const save = process.argv.includes("--save");
  let saved = {};
  try { saved = JSON.parse(readFileSync(STATE, "utf8")); } catch { /* first run */ }
  const seen = await readSources();
  const lines = compare(saved, seen);
  for (const l of lines) console.log(`${l.level.padEnd(8)} ${l.text}`);
  if (save) {
    const next = { ...saved };
    for (const s of SOURCES) if (seen[s.id]?.date) next[s.id] = { url: s.url, date: seen[s.id].date, lastModified: seen[s.id].lastModified, checkedAt: new Date().toISOString().slice(0, 10) };
    writeFileSync(STATE, `${JSON.stringify(next, null, 2)}\n`);
    console.log("Dates enregistrées dans store/rules-watch.json.");
    process.exit(lines.some((l) => l.level === "ÉCHEC") ? 1 : 0);
  }
  process.exit(exitCode(lines));
}
