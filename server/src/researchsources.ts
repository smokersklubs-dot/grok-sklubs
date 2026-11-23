/*
 * Portions adapted from mvanhorn/last30days-skill (https://github.com/mvanhorn/last30days-skill, commit
 * 64b1f006f800640022ce07f51de5ce56aad34b76), Copyright (c) 2026 Matt Van Horn, MIT License; modified for Sklubot:
 * skills/last30days/scripts/lib/hackernews.py (Algolia search with created_at_i window, optionalWords, client-side
 * MIN_STORY_POINTS filter, item permalinks) and polymarket.py (Gamma public-search sorted by volume, open events only,
 * outcomePrices parsing, market volume) ported to TypeScript over Sklubot's guarded fetch; Reddit and YouTube go through
 * the bots' existing read-only Agent Reach instead of last30days' own clients. NOT reused: anything reading browser
 * cookies or sessions (reddit_session, X AUTH_TOKEN/CT0, bird-search), paid scrapers.
 *
 * Endpoints (public, no key):
 *  - Hacker News Search API by Algolia, https://hn.algolia.com/api (GET /api/v1/search, parameters query, tags,
 *    numericFilters on created_at_i, hitsPerPage; optionalWords is an Algolia search parameter).
 *  - Polymarket Gamma API, https://docs.polymarket.com/ (GET https://gamma-api.polymarket.com/public-search with q,
 *    events_status, keep_closed_markets, limit_per_type, sort — as last30days calls it).
 */
import { guardedFetch } from "./net.js";
import { reachAvailable, reachChannelSearch } from "./reach.js";
import type { BotRecord } from "./store.js";
import type { ResearchSource } from "./researchevidence.js";
import { isoDay, windowRange, type ResearchWindow } from "./researchsignals.js";
import { searchOpenAlex, searchPubMed } from "./researchscholar.js";

import type { ResearchExtra, SourceName, SourceState, SourceStateKind } from "./researchsignals.js";
export { RESEARCH_EXTRAS, type ResearchExtra, type SourceName, type SourceState, type SourceStateKind } from "./researchsignals.js";
export interface SourceOutcome { state: SourceState; items: ResearchSource[] }

const HN_MIN_POINTS = 2;
const hnBase = () => (process.env.RESEARCH_HN_BASE ?? "https://hn.algolia.com").replace(/\/$/, "");
const pmBase = () => (process.env.RESEARCH_POLYMARKET_BASE ?? "https://gamma-api.polymarket.com").replace(/\/$/, "");

export class SourceError extends Error { constructor(readonly kind: SourceStateKind) { super(kind); } }
export async function getJson(url: string, signal: AbortSignal): Promise<any> {
  let res: Response;
  try {
    res = await guardedFetch(url, { signal: AbortSignal.any([signal, AbortSignal.timeout(15_000)]), headers: { accept: "application/json", "user-agent": "Sklubot research" } });
  } catch (e) {
    throw new SourceError(e instanceof Error && /abort|timeout/i.test(e.name + e.message) ? "timeout" : "failed");
  }
  if (res.status === 429) { await res.body?.cancel(); throw new SourceError("rate_limited"); }
  if (!res.ok) { await res.body?.cancel(); throw new SourceError("failed"); }
  const text = (await res.text()).slice(0, 2_000_000);
  try { return JSON.parse(text); } catch { throw new SourceError("failed"); }
}
const strip = (html: string) => html.replace(/<p>/gi, "\n").replace(/<[^>]+>/g, "").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").trim();
export const done = (source: SourceName, items: ResearchSource[]): SourceOutcome => ({ state: { source, state: items.length ? "ok" : "empty", count: items.length }, items });
export const failed = (source: SourceName, e: unknown): SourceOutcome => ({ state: { source, state: e instanceof SourceError ? e.kind : "failed", count: 0 }, items: [] });

export async function searchHackerNews(query: string, window: ResearchWindow, signal: AbortSignal, now = Date.now()): Promise<SourceOutcome> {
  try {
    const words = query.replace(/[-,]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
    const params = new URLSearchParams({ query: words, tags: "story", hitsPerPage: "30" });
    const range = windowRange(window, now);
    if (range) params.set("numericFilters", `created_at_i>${Math.floor(Date.parse(range[0]) / 1000)},created_at_i<${Math.floor(Date.parse(range[1]) / 1000) + 86400}`);
    const tokens = words.split(" ");
    if (tokens.length > 1) params.set("optionalWords", tokens.slice(1).join(" "));
    const data = await getJson(`${hnBase()}/api/v1/search?${params}`, signal);
    const items: ResearchSource[] = [];
    for (const hit of Array.isArray(data?.hits) ? data.hits : []) {
      const points = Number(hit?.points) || 0;
      if (points <= HN_MIN_POINTS || !hit?.objectID || typeof hit.title !== "string") continue;
      const story = typeof hit.story_text === "string" ? strip(hit.story_text).slice(0, 3000) : "";
      items.push({
        url: `https://news.ycombinator.com/item?id=${encodeURIComponent(String(hit.objectID))}`,
        title: "Hacker News · " + hit.title.slice(0, 200),
        text: [hit.title + ".", story].filter(Boolean).join("\n\n"),
        published: isoDay(hit.created_at_i),
        engagement: { points, comments: Number(hit.num_comments) || 0 },
        origin: "hn",
      });
    }
    return done("hn", items);
  } catch (e) {
    return failed("hn", e);
  }
}

function outcomes(market: any): [string, number][] {
  const parse = (v: unknown) => { try { return typeof v === "string" ? JSON.parse(v) : v; } catch { return null; } };
  const names = parse(market?.outcomes);
  const prices = parse(market?.outcomePrices);
  if (!Array.isArray(prices)) return [];
  return prices.flatMap((p: unknown, i: number) => { const n = Number(p); return Number.isFinite(n) ? [[Array.isArray(names) && typeof names[i] === "string" ? names[i] : `#${i + 1}`, n] as [string, number]] : []; });
}

/** Open prediction markets about the subject, biggest money first. Shown as « ce que parient les gens », never as a fact. */
export async function searchPolymarket(query: string, signal: AbortSignal, fr: boolean, now = Date.now()): Promise<SourceOutcome> {
  try {
    const params = new URLSearchParams({ q: query.slice(0, 200), sort: "volume", events_status: "active", keep_closed_markets: "0", limit_per_type: "10" });
    const data = await getJson(`${pmBase()}/public-search?${params}`, signal);
    const items: ResearchSource[] = [];
    for (const ev of Array.isArray(data?.events) ? data.events : []) {
      if (!ev || ev.closed || typeof ev.slug !== "string" || !/^[a-z0-9-]{1,200}$/i.test(ev.slug)) continue;
      const live = (Array.isArray(ev.markets) ? ev.markets : []).filter((m: any) => m && !m.closed && m.active !== false && typeof m.question === "string");
      const volume = (m: any) => Number(m.volumeNum) || Number(m.volume) || 0;
      live.sort((a: any, b: any) => volume(b) - volume(a));
      const lines = live.slice(0, 3).flatMap((m: any) => {
        const o = outcomes(m)[0];
        if (!o) return [];
        const pct = Math.round(o[1] * 100);
        return [fr ? `Pari en cours : ${m.question} — « ${o[0]} » à ${pct} % selon les parieurs.` : `Open bet: ${m.question} — "${o[0]}" at ${pct}% according to bettors.`];
      });
      if (!lines.length) continue;
      items.push({
        url: `https://polymarket.com/event/${ev.slug}`,
        title: "Polymarket · " + String(ev.title ?? live[0].question).slice(0, 200),
        text: lines.join("\n\n"),
        published: isoDay(now),
        engagement: { volume: live.reduce((s: number, m: any) => s + volume(m), 0) },
        origin: "polymarket",
      });
    }
    return done("polymarket", items);
  } catch (e) {
    return failed("polymarket", e);
  }
}

/** Reddit or YouTube through Agent Reach on the bot's own computer (read-only). Unknown item fields are optional. */
export async function searchReach(bot: BotRecord, channel: "reddit" | "youtube", query: string, signal: AbortSignal): Promise<SourceOutcome> {
  if (!reachAvailable()) return { state: { source: channel, state: "unavailable", count: 0 }, items: [] };
  try {
    const env = await reachChannelSearch(bot, channel, query, 10, signal);
    if (!env.ok) {
      const code = env.error?.code;
      const kind: SourceStateKind = code === "RATE_LIMITED" ? "rate_limited" : code === "TIMEOUT" ? "timeout" : code === "NEED_LOGIN" ? "login" : code === "NOT_FOUND" ? "empty" : "failed";
      return { state: { source: channel, state: kind, count: 0 }, items: [] };
    }
    const num = (...v: unknown[]) => { for (const x of v) { const n = Number(x); if (Number.isFinite(n) && n > 0) return n; } return undefined; };
    const items: ResearchSource[] = (env.items ?? []).flatMap((it: any) => {
      if (!it || typeof it.url !== "string" || !/^https?:\/\//.test(it.url)) return [];
      const text = [it.title, it.text ?? it.description ?? it.selftext].filter((x) => typeof x === "string" && x.trim()).join("\n\n").slice(0, 6000);
      if (!text) return [];
      return [{
        url: it.url,
        title: (channel === "reddit" ? "Reddit · " : "YouTube · ") + String(it.title ?? it.url).slice(0, 200),
        text,
        published: isoDay(it.published_at ?? it.created_utc ?? it.upload_date ?? it.date),
        engagement: { score: num(it.score, it.ups, it.upvotes), comments: num(it.num_comments, it.comments, it.comment_count), views: num(it.view_count, it.views) },
        origin: channel,
      }];
    });
    return done(channel, items);
  } catch (e) {
    return failed(channel, e);
  }
}

export function searchExtra(extra: ResearchExtra, bot: BotRecord, query: string, window: ResearchWindow, signal: AbortSignal, fr: boolean): Promise<SourceOutcome> {
  if (extra === "openalex") return searchOpenAlex(query, window, signal); // L118 (researchscholar.ts)
  if (extra === "pubmed") return searchPubMed(query, window, signal);
  if (extra === "hn") return searchHackerNews(query, window, signal);
  if (extra === "polymarket") return searchPolymarket(query, signal, fr);
  return searchReach(bot, extra, query, signal);
}
