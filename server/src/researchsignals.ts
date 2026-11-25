import { tr } from "./i18n.js"; import { isLocale, LOCALE_INTL, type Locale } from "./clientshared/locales.js";
/*
 * Portions adapted from mvanhorn/last30days-skill (https://github.com/mvanhorn/last30days-skill, commit
 * 64b1f006f800640022ce07f51de5ce56aad34b76), Copyright (c) 2026 Matt Van Horn, MIT License; modified for Sklubot:
 * skills/last30days/scripts/lib/relevance.py (token_overlap_relevance: coverage, informative-token coverage, precision,
 * phrase bonus, generic-words-only cap, RELEVANCE_FLOOR) ported to TypeScript with French stop words and accent
 * folding; dates.py (window from N days, in-window check, recency_score) ported; the engagement boost and rank blend of
 * hackernews.py (parse_hackernews_response) generalised to every source. Publication-date reading from HTML metadata
 * and the « ce mois-ci » window words are Sklubot's. Nothing here reads cookies, sessions or browser data.
 */

export type ResearchExtra = "hn" | "polymarket" | "reddit" | "youtube" | "openalex" | "pubmed";
export const RESEARCH_EXTRAS: ResearchExtra[] = ["hn", "polymarket", "reddit", "youtube", "openalex", "pubmed"];
export type SourceName = "web" | "x" | ResearchExtra;
/** What a source did for one question: never « nobody talks about it » when it is not "ok"/"empty". */
export type SourceStateKind = "ok" | "empty" | "failed" | "rate_limited" | "timeout" | "login" | "unavailable";
export interface SourceState { source: SourceName; state: SourceStateKind; count: number }

/** Below this, a source is off-topic for the question (upstream RELEVANCE_FLOOR). */
export const RELEVANCE_FLOOR = 0.1;

export type ResearchWindow = "any" | "week" | "month" | "year";
export const WINDOW_DAYS: Record<Exclude<ResearchWindow, "any">, number> = { week: 7, month: 30, year: 365 };

const STOP = new Set(
  ("the a an to for how is in of on and with from by at this that it my your i me we you what are do can its be or not no so if but about all just get has have was will " +
    "le la les un une des du de d l et ou a au aux en dans sur pour par avec sans que qui quoi quel quelle quels quelles est sont ce cet cette ces se sa son ses leur leurs il elle ils elles on nous vous je tu y ne pas plus comment pourquoi combien").split(" "),
);
/** Words that are not the topic on their own (upstream LOW_SIGNAL_QUERY_TOKENS, plus French equivalents). */
const LOW_SIGNAL = new Set(
  ("advice best compare comparison explain guide how latest news odds opinion opinions prediction predictions review reviews thoughts tips tutorial update updates using versus vs worth " +
    "current days last month week year recent new people real relevant " +
    "actualite actualites nouveau nouveaux nouvelle nouvelles dernier derniers derniere dernieres recent recents recente recentes avis conseil conseils comparer comparaison mois semaine annee jours ci gens parle parlent pense pensent").split(" "),
);
const fold = (s: string) => s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
export function tokens(text: string): Set<string> {
  return new Set((fold(text).replace(/[’']/g, " ").match(/[\p{L}\p{N}]+/gu) ?? []).filter((w) => w.length > 1 && !STOP.has(w)));
}
const phrase = (s: string) => fold(s).replace(/[^\p{L}\p{N}\s]/gu, " ").split(/\s+/).filter(Boolean).join(" ");

/** 0–1: how well a text answers the query (upstream token_overlap_relevance; 0.5 for an empty query). */
export function relevance(query: string, text: string): number {
  const q = tokens(query);
  if (!q.size) return 0.5;
  const t = tokens(text);
  const overlap = [...q].filter((w) => t.has(w)).length;
  if (!overlap) return 0;
  const informative = new Set([...q].filter((w) => !LOW_SIGNAL.has(w)));
  const info = informative.size ? informative : q;
  const coverage = overlap / q.size;
  const infoOverlap = [...info].filter((w) => t.has(w)).length / info.size;
  const precision = overlap / (Math.min(t.size, q.size + 4) || 1);
  const pq = phrase(query);
  const bonus = pq && phrase(text).includes(pq) ? (pq.split(" ").length > 1 ? 0.12 : 0.16) : 0;
  const base = 0.55 * coverage ** 1.35 + 0.25 * infoOverlap + 0.2 * precision;
  if (informative.size && !infoOverlap) return Math.round(Math.min(0.24, base) * 100) / 100;
  return Math.round(Math.min(1, base + bonus) * 100) / 100;
}

/** The window the words of the request ask for (« ce mois-ci », « cette semaine »…), or "any". */
export function windowFromText(text: string): ResearchWindow {
  const t = fold(text);
  if (/cette semaine|7 derniers jours|this week|last 7 days|past week/.test(t)) return "week";
  if (/ce mois[- ]ci|30 derniers jours|dernier mois|this month|last 30 days|past month|en ce moment|actuellement|recemment|right now|lately/.test(t)) return "month";
  if (/cette annee|12 derniers mois|this year|past year|last 12 months/.test(t)) return "year";
  return "any";
}

const day = (ms: number) => new Date(ms).toISOString().slice(0, 10);
/** [from, to] as YYYY-MM-DD (upstream get_date_range), or null for "any". */
export function windowRange(w: ResearchWindow, now = Date.now()): [string, string] | null {
  return w === "any" ? null : [day(now - WINDOW_DAYS[w] * 86400_000), day(now)];
}
export function inWindow(date: string | undefined, w: ResearchWindow, now = Date.now()): boolean | null {
  const r = windowRange(w, now);
  if (!r) return true;
  if (!date) return null;
  return date >= r[0] && date <= r[1];
}
/** 0–1, 1 for today, 0 at the window's start or older (upstream recency_score / 100). */
export function recency(date: string | undefined, w: ResearchWindow, now = Date.now()): number {
  if (!date) return 0;
  const age = (Date.parse(day(now)) - Date.parse(date)) / 86400_000;
  const span = w === "any" ? 365 : WINDOW_DAYS[w];
  return age < 0 ? 1 : age >= span ? 0 : 1 - age / span;
}

/** A date in YYYY-MM-DD from an ISO date, a Unix time (seconds) or a parsable date text; undefined otherwise. */
export function isoDay(v: unknown): string | undefined {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return day(v < 1e12 ? v * 1000 : v);
  if (typeof v !== "string" || !v.trim()) return undefined;
  const compact = /^(\d{4})(\d{2})(\d{2})$/.exec(v.trim());
  if (compact) return isoDay(`${compact[1]}-${compact[2]}-${compact[3]}`);
  const m = /^(\d{4}-\d{2}-\d{2})/.exec(v.trim());
  if (m && !Number.isNaN(Date.parse(m[1]))) return m[1];
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : day(t);
}

/** The publication date a page declares in its metadata (article:published_time, JSON-LD datePublished, <time>…). */
export function publishedDate(html: string): string | undefined {
  const head = html.slice(0, 200_000);
  const patterns = [
    /<meta[^>]+(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|date|pubdate|publish[-_]?date|dc\.date(?:\.issued)?|dcterms\.(?:created|issued)|sailthru\.date|parsely-pub-date)["'][^>]*content=["']([^"']{6,40})["']/i,
    /<meta[^>]+content=["']([^"']{6,40})["'][^>]*(?:property|name|itemprop)=["'](?:article:published_time|og:published_time|datePublished|date|pubdate|publish[-_]?date|dc\.date(?:\.issued)?|dcterms\.(?:created|issued))["']/i,
    /"datePublished"\s*:\s*"([^"]{6,40})"/i,
    /<[^>]+itemprop=["']datePublished["'][^>]*datetime=["']([^"']{6,40})["']/i,
    /<time[^>]+datetime=["']([^"']{6,40})["']/i,
  ];
  for (const p of patterns) {
    const d = isoDay(p.exec(head)?.[1]);
    if (d && d >= "1995-01-01") return d;
  }
  return undefined;
}

export interface Engagement { points?: number; comments?: number; score?: number; views?: number; volume?: number }

/** Up to +0.2 for what people really did with it (upstream engagement_boost = min(0.2, log1p(points)/40)). */
export function engagementBoost(e: Engagement | undefined): number {
  if (!e) return 0;
  const crowd = (e.points ?? 0) + (e.score ?? 0) + 2 * (e.comments ?? 0) + (e.views ?? 0) / 100;
  const money = (e.volume ?? 0) / 1000;
  return Math.min(0.2, Math.log1p(crowd + money) / 40);
}

/** Rank blend: relevance first, then freshness, then engagement. */
export const rankScore = (rel: number, date: string | undefined, e: Engagement | undefined, w: ResearchWindow, now = Date.now()) =>
  0.7 * rel + 0.15 * recency(date, w, now) + engagementBoost(e);

/** A short human label: « 412 points, 96 commentaires », « 1,2 M$ misés »… */
export function engagementLabel(e: Engagement | undefined, locale: Locale | undefined): string {
  if (!e) return "";
  const n = (v: number) => new Intl.NumberFormat(isLocale(locale) ? LOCALE_INTL[locale] : "en-US", { notation: "compact", maximumFractionDigits: 1 }).format(v);
  const parts: string[] = [];
  if (e.points) parts.push(`${n(e.points)} points`);
  if (e.score) parts.push(tr(locale, "{n} votes", { n: n(e.score) }));
  if (e.comments) parts.push(tr(locale, "{n} comments", { n: n(e.comments) }));
  if (e.views) parts.push(tr(locale, "{n} views", { n: n(e.views) }));
  if (e.volume) parts.push(tr(locale, "${n} traded", { n: n(e.volume) }));
  return parts.join(", ");
}
