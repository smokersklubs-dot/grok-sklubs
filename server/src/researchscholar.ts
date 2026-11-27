/*
 * L118: direct, free access to two scholarly indexes, as research sources and as the bot tool `scholar_search`.
 * Sklubot's own code (no upstream code reused).
 *
 *  - OpenAlex works, https://api.openalex.org/works — « Basic use is free … no account needed »
 *    (https://help.openalex.org/how-to-use-the-api/api-overview). Parameters used: `search` (full-text search of works,
 *    https://help.openalex.org/api-entities/works/search-works), `filter=from_publication_date:…,to_publication_date:…`,
 *    `per_page`. Fields read: id, doi, display_name, publication_date, cited_by_count, abstract_inverted_index,
 *    primary_location.source.display_name, authorships[].author.display_name. No key is sent.
 *  - PubMed through NCBI E-utilities (https://www.ncbi.nlm.nih.gov/books/NBK25497/ and NBK25499): ESearch
 *    (`db=pubmed`, `term`, `retmode=json`, `retmax`, `sort=relevance`, `datetype=pdat`, `mindate`, `maxdate`) then ESummary
 *    (`db=pubmed`, `id`, `retmode=json`). Without an API key NCBI allows 3 requests per second: one search costs two.
 *    The `tool` parameter names the program; no e-mail address is sent (the owner's address stays private).
 */
import { done, failed, getJson, type SourceOutcome } from "./researchsources.js";
import type { ResearchSource } from "./researchevidence.js";
import { isoDay, windowRange, type ResearchWindow } from "./researchsignals.js";

const oaBase = () => (process.env.RESEARCH_OPENALEX_BASE ?? "https://api.openalex.org").replace(/\/$/, "");
const pmBase = () => (process.env.RESEARCH_PUBMED_BASE ?? "https://eutils.ncbi.nlm.nih.gov/entrez/eutils").replace(/\/$/, "");
export const SCHOLAR_LIMIT = 10;

/** OpenAlex gives abstracts as { word: [positions] }: put the words back in order. */
export function abstractText(inv: unknown): string {
  if (!inv || typeof inv !== "object") return "";
  const words: string[] = [];
  for (const [w, pos] of Object.entries(inv as Record<string, unknown>)) if (Array.isArray(pos)) for (const p of pos) if (Number.isInteger(p) && p >= 0 && p < 5000) words[p] = w;
  return words.filter(Boolean).join(" ");
}

export async function searchOpenAlex(query: string, window: ResearchWindow, signal: AbortSignal, limit = SCHOLAR_LIMIT): Promise<SourceOutcome> {
  try {
    const params = new URLSearchParams({ search: query.slice(0, 300), per_page: String(Math.min(25, Math.max(1, limit))) });
    const range = windowRange(window);
    if (range) params.set("filter", `from_publication_date:${range[0]},to_publication_date:${range[1]}`);
    const data = await getJson(`${oaBase()}/works?${params}`, signal);
    const items: ResearchSource[] = [];
    for (const w of Array.isArray(data?.results) ? data.results : []) {
      const title = typeof w?.display_name === "string" ? w.display_name : typeof w?.title === "string" ? w.title : "";
      const doi = typeof w?.doi === "string" && /^https:\/\/doi\.org\//.test(w.doi) ? w.doi : null;
      const id = typeof w?.id === "string" && /^https:\/\/openalex\.org\/W\d+$/.test(w.id) ? w.id : null;
      if (!title || !(doi || id)) continue;
      const authors = (Array.isArray(w.authorships) ? w.authorships : []).slice(0, 4).map((a: any) => a?.author?.display_name).filter((n: unknown) => typeof n === "string");
      const venue = w?.primary_location?.source?.display_name;
      const head = [authors.join(", ") + (Array.isArray(w.authorships) && w.authorships.length > 4 ? " et al." : ""), typeof venue === "string" ? venue : "", isoDay(w.publication_date) ?? ""].filter(Boolean).join(" · ");
      items.push({
        url: doi ?? id!, title: "OpenAlex · " + title.slice(0, 220),
        text: [title + ".", head, abstractText(w.abstract_inverted_index).slice(0, 4000)].filter(Boolean).join("\n\n"),
        published: isoDay(w.publication_date), engagement: { score: Number(w.cited_by_count) || 0 }, origin: "openalex",
      });
    }
    return done("openalex", items);
  } catch (e) {
    return failed("openalex", e);
  }
}

const slash = (d: string) => d.replace(/-/g, "/");
export async function searchPubMed(query: string, window: ResearchWindow, signal: AbortSignal, limit = SCHOLAR_LIMIT): Promise<SourceOutcome> {
  try {
    const params = new URLSearchParams({ db: "pubmed", term: query.slice(0, 300), retmode: "json", retmax: String(Math.min(25, Math.max(1, limit))), sort: "relevance", tool: "sklubot" });
    const range = windowRange(window);
    if (range) { params.set("datetype", "pdat"); params.set("mindate", slash(range[0])); params.set("maxdate", slash(range[1])); }
    const found = await getJson(`${pmBase()}/esearch.fcgi?${params}`, signal);
    const ids: string[] = (Array.isArray(found?.esearchresult?.idlist) ? found.esearchresult.idlist : []).filter((x: unknown) => typeof x === "string" && /^\d{1,10}$/.test(x));
    if (!ids.length) return done("pubmed", []);
    const sum = await getJson(`${pmBase()}/esummary.fcgi?${new URLSearchParams({ db: "pubmed", id: ids.join(","), retmode: "json", tool: "sklubot" })}`, signal);
    const items: ResearchSource[] = [];
    for (const id of ids) {
      const r = sum?.result?.[id];
      if (!r || typeof r.title !== "string" || !r.title.trim()) continue;
      const authors = (Array.isArray(r.authors) ? r.authors : []).slice(0, 4).map((a: any) => a?.name).filter((n: unknown) => typeof n === "string");
      const published = isoDay(typeof r.sortpubdate === "string" ? r.sortpubdate.slice(0, 10).replace(/\//g, "-") : r.pubdate);
      items.push({
        url: `https://pubmed.ncbi.nlm.nih.gov/${id}/`, title: "PubMed · " + r.title.slice(0, 220),
        text: [r.title, [authors.join(", "), typeof r.fulljournalname === "string" ? r.fulljournalname : "", typeof r.pubdate === "string" ? r.pubdate : ""].filter(Boolean).join(" · ")].join("\n\n"),
        published, origin: "pubmed",
      });
    }
    return done("pubmed", items);
  } catch (e) {
    return failed("pubmed", e);
  }
}

/** The answer of `scholar_search`, in words the model reads (sources listed with their link, date and citations). */
export function scholarAnswer(outcomes: SourceOutcome[]): { content: string; count: number; isError: boolean } {
  const lines: string[] = [];
  let count = 0;
  for (const o of outcomes) {
    const name = o.state.source === "openalex" ? "OpenAlex" : "PubMed";
    if (o.state.state !== "ok") { lines.push(`${name}: ${o.state.state === "empty" ? "nothing found" : `not reachable (${o.state.state}) — do not conclude that nothing exists`}.`); continue; }
    lines.push(`${name}: ${o.items.length} results.`);
    for (const it of o.items) {
      count++;
      const cites = it.engagement?.score ? ` · cited ${it.engagement.score} times` : "";
      lines.push(`- ${it.title.replace(/^(OpenAlex|PubMed) · /, "")} (${it.published ?? "undated"}${cites}) ${it.url}\n  ${it.text.split("\n\n").slice(1).join(" ").slice(0, 600)}`);
    }
  }
  return { content: lines.join("\n") + "\nThese are records from scholarly indexes: cite the link of each work you use; an abstract is not the full paper.", count, isError: outcomes.every((o) => o.state.state !== "ok" && o.state.state !== "empty") };
}

import type { BuiltinTool } from "./agent/tools.js";
/** L118: the bot looks scholarly works up itself (free, no key), outside a full research report. */
export const scholarTool: BuiltinTool = {
  spec: {
    name: "scholar_search",
    description: "Search scholarly literature directly: OpenAlex (papers of every field, with citation counts and abstracts) and PubMed (medicine and life sciences). Free and read-only. Use it for a literature review, a study's evidence or a market study's sources; set window to keep only recent works.",
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Words to search for (English usually finds more)" },
        sources: { type: "array", items: { type: "string", enum: ["openalex", "pubmed"] }, description: "Default: both" },
        window: { type: "string", enum: ["any", "week", "month", "year"] },
        limit: { type: "number", description: "Results per source, 1 to 25 (default 10)" },
      },
      required: ["query"],
    },
  },
  group: "web", activity: "searching", label: "Searching scholarly works", outside: true, parallel: true,
  detail: (a) => String(a.query ?? "").slice(0, 60),
  run: async (a, c) => {
    const query = String(a.query ?? "").trim();
    if (!query) return { content: "Give the words to search for.", isError: true };
    const want = Array.isArray(a.sources) && a.sources.length ? a.sources.filter((s: unknown) => s === "openalex" || s === "pubmed") : ["openalex", "pubmed"];
    const window: ResearchWindow = ["week", "month", "year"].includes(a.window) ? a.window : "any";
    const limit = Number.isFinite(Number(a.limit)) ? Math.round(Number(a.limit)) : SCHOLAR_LIMIT;
    const signal = AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]);
    const outcomes = await Promise.all(want.map((s: string) => (s === "openalex" ? searchOpenAlex(query, window, signal, limit) : searchPubMed(query, window, signal, limit))));
    const r = scholarAnswer(outcomes);
    return { content: r.content, isError: r.isError || undefined, summary: `${r.count} works` };
  },
};
