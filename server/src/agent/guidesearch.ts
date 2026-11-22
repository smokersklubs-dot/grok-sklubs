import type { ToolSpec } from "../llm/types.js";
import { libraryEntries } from "../skillslibrary.js";
import type { BuiltinTool } from "./tools.js";

/**
 * L109 — guide_search: finds the right rule among the bundled web component guides (library skill
 * « guides-composants-web », condensed from GoogleChrome/modern-web-guidance-src guides, CC BY 4.0 — see its NOTICE), so
 * a bot building a page reads the 2-4 entries it needs instead of the whole guide. Each entry says whether it relies on
 * a recent browser feature (« (récent) » / « (recent) » in the guide): then the bot must check support and keep the
 * fallback the entry gives. Read-only, from text bundled with the server.
 */
export interface GuideEntry { section: string; title: string; text: string; recent: boolean; lang: "fr" | "en" }
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const words = (s: string) => fold(s).split(/[^a-z0-9]+/).filter((w) => w.length >= 3);

let cache: GuideEntry[] | null = null;
export function webGuideEntries(): GuideEntry[] {
  if (cache) return cache;
  const e = libraryEntries().find((x) => x.id === "guides-composants-web");
  const out: GuideEntry[] = [];
  for (const lang of ["fr", "en"] as const) {
    const body = e?.text[lang]?.body ?? "";
    let section = "";
    for (const line of body.split("\n")) {
      const h = /^##\s+(.+)/.exec(line);
      if (h) { section = h[1].trim(); continue; }
      const b = /^\s*[-*]\s+\*\*(.+?)\*\*\s*:?\s*(.*)$/.exec(line);
      if (b && section) out.push({ section, title: b[1].replace(/[:：]\s*$/, "").trim(), text: b[2].trim(), recent: /\((récent|recent)\)/i.test(line), lang });
      else if (out.length && out[out.length - 1].section === section && line.trim() && /^\s{2,}\S/.test(line)) out[out.length - 1].text += " " + line.trim();
    }
  }
  return (cache = out);
}

/** The best entries for a request (title words count three times), in the language asked, else any. */
export function searchWebGuides(query: string, lang: "fr" | "en", limit = 4): GuideEntry[] {
  const q = words(query);
  if (!q.length) return [];
  const scored = webGuideEntries().map((g) => {
    const t = new Set(words(g.title)), b = new Set(words(`${g.section} ${g.text}`));
    const score = q.reduce((n, w) => n + ([...t].some((x) => x.startsWith(w) || w.startsWith(x)) ? 3 : 0) + ([...b].some((x) => x.startsWith(w)) ? 1 : 0), 0) + (g.lang === lang ? 0.5 : 0);
    return { g, score };
  }).filter((x) => x.score >= 1.5).sort((a, b) => b.score - a.score);
  const seen = new Set<string>();
  return scored.filter((x) => { const k = `${fold(x.g.section)}:${x.g.lang}:${fold(x.g.title)}`; if (seen.has(k)) return false; seen.add(k); return true; }).slice(0, limit).map((x) => x.g);
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
export const guideSearchTools: BuiltinTool[] = [{
  spec: {
    name: "guide_search",
    description: "Find the rule for building one part of a web page (dialog, menu, tabs, accordion, tooltip, toast, carousel, drawer, switch, form, validation, autofill, table on phones, dark mode, image priority, fonts…) in the bundled web component guides: native HTML first, accessibility, and the fallback when a recent browser feature is not supported everywhere.",
    inputSchema: obj({ query: { type: "string", description: "What you are building, e.g. \"modal dialog\" or \"onglets\"" } }, ["query"]),
  },
  activity: "reading", label: "Looking up a web guide", parallel: true,
  run: async (a, c) => {
    const found = searchWebGuides(String(a.query ?? ""), c.user.locale === "fr" ? "fr" : "en");
    if (!found.length) return { content: `No web guide entry matches "${a.query}". Entries: ${[...new Set(webGuideEntries().filter((g) => g.lang === "en").map((g) => g.title))].join(", ")}.`, summary: "nothing found" };
    return {
      content: [
        ...found.map((g) => `## ${g.title} (${g.section})\n${g.text}\nBrowser support: ${g.recent ? "uses a RECENT feature — check its support (MDN or the browser-support tables, e.g. web_fetch https://developer.mozilla.org/…) and keep the fallback above; when in doubt use the fallback alone." : "widely supported (no recent feature in this rule)."}`),
        "Source: modern-web-guidance guides (© Google LLC, CC BY 4.0), condensed and modified for Sklubot.",
      ].join("\n\n"),
      summary: found.map((g) => g.title).join(", ").slice(0, 80),
    };
  },
}];
