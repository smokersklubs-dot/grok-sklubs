import { windowFromText, RESEARCH_EXTRAS, type Engagement, type ResearchWindow, type ResearchExtra, type SourceName, type SourceState } from "./researchsignals.js"; import type { Locale } from "./shared.js"; import { isLocale } from "./clientshared/locales.js";
/** Findings kept per question (was 4; more sources now answer). */
export const MAX_FINDINGS = 6;
export interface ResearchBrief {
  subject: string;
  plan: string[];
  seeds: string[];
  discover: boolean;
  model: boolean;
  includeX: boolean;
  locale: Locale;
  /** L87: only sources published in this window count (absent on older reports: "any"). */
  window?: ResearchWindow;
  /** L87: free sources besides the web (Hacker News, Polymarket, Reddit and YouTube through Agent Reach). */
  extras?: ResearchExtra[];
}
export interface ResearchSource {
  url: string;
  title: string;
  text: string;
  /** L87: publication date (YYYY-MM-DD) when the page or the source says it. */
  published?: string;
  engagement?: Engagement;
  origin?: SourceName;
  /** Rank boost (relevance, freshness, engagement) used to order excerpts. */
  boost?: number;
}
export interface ResearchFinding {
  claim: string;
  quote: string;
  url: string;
  title: string;
  published?: string;
  engagement?: string;
}
export interface ResearchSection {
  question: string;
  findings: ResearchFinding[];
  read: number;
  attempted: number;
  notes: string[];
  synthesis: boolean;
  at: number;
  /** L87: what each source did for this question (absent on older reports). */
  sources?: SourceState[];
  offTopic?: number;
  outOfWindow?: number;
  undated?: number;
}
export function publicAddress(value: unknown) {
  try {
    if (typeof value !== "string" || value.length > 2000) return null;
    const u = new URL(value);
    if (!/^https?:$/.test(u.protocol) || u.username || u.password) return null;
    u.hash = "";
    return u.href;
  } catch {
    return null;
  }
}
export function briefFrom(value: Partial<ResearchBrief>) {
  const clean = (v: unknown, max: number) =>
    typeof v === "string" && v.trim().length <= max ? v.trim() : "";
  const subject = clean(value.subject, 350);
  if (!subject) throw Error("Indique le sujet (350 caractères maximum).");
  if (!Array.isArray(value.plan) || value.plan.length < 1 || value.plan.length > 8)
    throw Error("Prévois entre une et huit questions.");
  const plan = value.plan.map((v) => clean(v, 350));
  if (plan.some((v) => !v) || new Set(plan).size !== plan.length)
    throw Error("Chaque question doit être distincte (350 caractères maximum).");
  const seeds = value.seeds ?? [];
  if (!Array.isArray(seeds) || seeds.length > 6 || seeds.some((v) => !publicAddress(v)))
    throw Error("Indique jusqu’à six adresses web valides.");
  const discover = value.discover !== false;
  const extras = Array.isArray(value.extras) ? [...new Set(value.extras.filter((x) => RESEARCH_EXTRAS.includes(x)))] : [];
  if (!seeds.length && !discover && !value.includeX && !extras.length)
    throw Error("Ajoute une source ou active la recherche web.");
  const window: ResearchWindow = (["any", "week", "month", "year"] as const).includes(value.window as ResearchWindow)
    ? (value.window as ResearchWindow)
    : windowFromText([subject, ...plan].join(" "));
  return {
    subject,
    plan,
    seeds: [...new Set(seeds.map((v) => publicAddress(v)!))],
    discover,
    includeX: value.includeX === true,
    model: value.model === true,
    locale: isLocale(value.locale) ? value.locale : "fr",
    window,
    extras,
  } satisfies ResearchBrief;
}
const compact = (value: string) => value.replace(/\s+/g, " ").trim();
const plain = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const noise = new Set(
  "avec dans pour quel quels quelle quelles comment pourquoi peut sont cette dont selon leur leurs sans entre sont qu'est elle elles avons nous vous sur des les est ses une sous comme about what which with before after when does from into this that there where how are these those the and for have has can its why who whether".split(
    " ",
  ),
);
function terms(text: string) {
  return new Set((plain(text).match(/[\p{L}\p{N}_-]{3,}/gu) ?? []).filter((t) => !noise.has(t)));
}
/** Deterministic, source-language excerpts for when no model is requested or available. */
export function extractEvidence(question: string, sources: ResearchSource[]): ResearchFinding[] {
  const wanted = terms(question);
  const candidates: { score: number; item: ResearchFinding }[] = [];
  for (const source of sources) {
    const url = publicAddress(source.url);
    if (!url) continue;
    const sentences = source.text.split(/\n\s*\n/u).flatMap((p) => compact(p).split(/(?<=[.!?])\s+/u));
    for (const sentence of sentences) {
      if (sentence.length < 25 || sentence.length > 750) continue;
      const words = terms(sentence);
      const overlap = [...wanted].filter((k) => words.has(k));
      const required = Math.min(4, Math.max(1, Math.ceil(wanted.size / 2)));
      if (overlap.length < required) continue;
      const tokens = sentence.split(/\s+/);
      let quote = "",
        best = -1;
      for (let end = tokens.length; end >= Math.min(tokens.length, 25); end--) {
        const window = tokens.slice(Math.max(0, end - 25), end).join(" ");
        const local = terms(window);
        const hits = [...wanted].filter((k) => local.has(k)).length;
        if (hits > best) {
          best = hits;
          quote = window;
        }
      }
      if (best < required) continue;
      candidates.push({
        score: (best / (1 + Math.log(1 + words.size) / 8)) * (1 + (source.boost ?? 0)),
        item: { claim: "", quote, url, title: source.title },
      });
    }
  }
  const used = new Set<string>();
  return candidates
    .sort((a, b) => b.score - a.score)
    .filter(({ item }) => {
      if (used.has(item.url)) return false;
      used.add(item.url);
      return true;
    })
    .slice(0, MAX_FINDINGS)
    .map((x) => x.item);
}
/** Reject invented source identifiers, unattested quotations and free-standing model text. */
export function checkedFindings(raw: string, sources: ResearchSource[]): ResearchFinding[] {
  let data: unknown;
  try {
    data = JSON.parse(raw.trim().replace(/^\x60{3}(?:json)?\s*|\s*\x60{3}$/gi, ""));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const items: ResearchFinding[] = [];
  for (const f of data) {
    if (!f || !Number.isInteger(f.source) || typeof f.quote !== "string" || typeof f.claim !== "string")
      continue;
    const source = sources[f.source - 1];
    const quote = compact(f.quote),
      claim = compact(f.claim);
    if (
      !source ||
      !publicAddress(source.url) ||
      quote.length < 12 ||
      quote.split(" ").length > 25 ||
      !claim ||
      claim.length > 500 ||
      !compact(source.text).includes(quote)
    )
      continue;
    if (!items.some((i) => i.quote === quote && i.url === source.url))
      items.push({ claim, quote, url: source.url, title: source.title });
    if (items.length === MAX_FINDINGS) break;
  }
  return items;
}
