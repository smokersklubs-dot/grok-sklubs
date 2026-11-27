import type { ToolSpec } from "../llm/types.js";
import { guardedFetch } from "../net.js";
import { clip } from "../store.js";
import { apiProblem, callApi, type AccountRecord, type ApiAnswer } from "./accounts.js";
import { vendorUrl } from "./vendors.js";

/**
 * L166 — built-in « Search Console » app: the owner's real search data, read with their own Google OAuth client (the same
 * setup as Gmail or Drive, vendors.ts), plus two free public services that go with it.
 *
 *  - Search Console API, read only, scope https://www.googleapis.com/auth/webmasters.readonly
 *    (https://developers.google.com/webmaster-tools/v1/how-tos/authorizing):
 *      sites.list           GET  https://www.googleapis.com/webmasters/v3/sites
 *      searchanalytics.query POST https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/searchAnalytics/query
 *      sitemaps.list        GET  https://www.googleapis.com/webmasters/v3/sites/{siteUrl}/sitemaps
 *      urlInspection.index.inspect POST https://searchconsole.googleapis.com/v1/urlInspection/index:inspect
 *    (reference: https://developers.google.com/webmaster-tools/v1/api_reference_index). The two POSTs only read.
 *  - PageSpeed Insights API v5, GET https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=…&strategy=…&category=…
 *    (https://developers.google.com/speed/docs/insights/v5/get-started; the API key is optional, so no key and no
 *    Google token is sent: the page address alone goes to Google).
 *  - IndexNow, POST https://api.indexnow.org/indexnow with JSON {host, key, keyLocation, urlList}
 *    (https://www.indexnow.org/documentation): tells Bing and the other IndexNow engines that pages changed. It is a WRITE
 *    (it asks the owner like any send); the key is the owner's own, already published as a text file on their site.
 *
 * Every address can point at a local fake for tests (GOOGLE_API_URL, vendors.ts; INDEXNOW_API_URL for IndexNow).
 */

type Risk = "read" | "safe" | "write";
interface Def { action: string; risk: Risk; label: string; description: string; schema: ToolSpec["inputSchema"]; run(acc: AccountRecord, a: Record<string, any>): Promise<{ text: string; summary: string }> }

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });
const check = (a: ApiAnswer) => { if (a.status >= 400) throw new Error(apiProblem(a)); return a; };
const out = (text: string, summary: string) => ({ text: clip(text, 14_000), summary });
const wm = (path: string) => vendorUrl("google", `https://www.googleapis.com/webmasters/v3${path}`);
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DIMENSIONS = new Set(["query", "page", "country", "device", "date", "searchAppearance"]);
const iso = (d: Date) => d.toISOString().slice(0, 10);

/** A Search Console property as the API names it: "https://example.com/" (URL prefix) or "sc-domain:example.com". */
export function cleanProperty(raw: unknown): string {
  const s = String(raw ?? "").trim();
  if (/^sc-domain:[a-z0-9.-]+\.[a-z]{2,}$/i.test(s)) return s.toLowerCase();
  let u: URL;
  try { u = new URL(s); } catch { throw new Error('site must be a property like "https://example.com/" or "sc-domain:example.com" (see sc_sites)'); }
  if (u.protocol !== "https:" && u.protocol !== "http:") throw new Error("site must be an http(s) property or sc-domain:…");
  return `${u.protocol}//${u.host}${u.pathname.endsWith("/") ? u.pathname : `${u.pathname}/`}`;
}

/** The search analytics request: dates (default the last 28 days ending 3 days ago, as data arrives late), dimensions, limit. */
export function analyticsBody(a: Record<string, any>, today = new Date()): Record<string, unknown> {
  const end = DAY.test(String(a.end_date ?? "")) ? String(a.end_date) : iso(new Date(today.getTime() - 3 * 86_400_000));
  const start = DAY.test(String(a.start_date ?? "")) ? String(a.start_date) : iso(new Date(new Date(`${end}T00:00:00Z`).getTime() - 27 * 86_400_000));
  if (start > end) throw new Error("start_date must be before end_date");
  const dims = (Array.isArray(a.dimensions) ? a.dimensions : String(a.dimensions ?? "query").split(",")).map((x: unknown) => String(x).trim()).filter((x: string) => DIMENSIONS.has(x)).slice(0, 3);
  const body: Record<string, unknown> = { startDate: start, endDate: end, dimensions: dims.length ? dims : ["query"], rowLimit: Math.min(1000, Math.max(1, Math.floor(Number(a.limit) || 25))), type: "web" };
  const contains = String(a.page_contains ?? "").trim();
  if (contains) body.dimensionFilterGroups = [{ filters: [{ dimension: "page", operator: "contains", expression: clip(contains, 200) }] }];
  return body;
}

const pct = (n: unknown) => `${(Number(n) * 100).toFixed(1)} %`;

/** The IndexNow request, checked: every address on the same host as the key file, 1 to 10 000 of them. */
export function indexNowBody(a: Record<string, any>): { host: string; key: string; keyLocation: string; urlList: string[] } {
  const key = String(a.key ?? "").trim();
  // The key: 8 to 128 characters, letters, digits and dashes (IndexNow documentation, "API Key").
  if (!/^[A-Za-z0-9-]{8,128}$/.test(key)) throw new Error("key must be the site's IndexNow key: 8 to 128 letters, digits or dashes");
  let loc: URL;
  try { loc = new URL(String(a.key_location ?? "")); } catch { throw new Error("key_location must be the full address of the key file on the site, e.g. https://example.com/<key>.txt"); }
  if (loc.protocol !== "https:" && loc.protocol !== "http:") throw new Error("key_location must be an http(s) address");
  const urls = (Array.isArray(a.urls) ? a.urls : String(a.urls ?? "").split(/[\s,]+/)).map((x: unknown) => String(x).trim()).filter(Boolean);
  if (!urls.length || urls.length > 10_000) throw new Error("give 1 to 10 000 page addresses in urls");
  for (const u of urls) { let p: URL; try { p = new URL(u); } catch { throw new Error(`"${clip(u, 80)}" is not an address`); } if (p.host !== loc.host) throw new Error(`${clip(u, 80)} is not on ${loc.host}, the host of the key file`); }
  return { host: loc.host, key, keyLocation: loc.toString(), urlList: [...new Set(urls)] };
}

export const SEARCH_CONSOLE: Def[] = [
  {
    action: "sc_sites", risk: "read", label: "Listing Search Console sites",
    description: "List the sites (properties) of this Search Console account and your access level on each.",
    schema: obj({}),
    async run(acc) {
      const list: any[] = check(await callApi(acc, "GET", wm("/sites"))).json?.siteEntry ?? [];
      return out(list.length ? list.map((s) => `- ${s.siteUrl} (${s.permissionLevel})`).join("\n") : "No site in this Search Console account.", `${list.length} sites`);
    },
  },
  {
    action: "sc_search_analytics", risk: "read", label: "Reading search results data",
    description: "Clicks, impressions, click rate and average position in Google Search for a site, by query, page, country, device or date. Default: the 28 days ending 3 days ago, by query, top 25.",
    schema: obj({ site: str('The property, exactly as sc_sites gives it ("https://example.com/" or "sc-domain:example.com")'), dimensions: { type: "array", items: { type: "string", enum: [...DIMENSIONS] }, description: "Up to 3 of: query, page, country, device, date, searchAppearance (default query)" }, start_date: str("First day, YYYY-MM-DD"), end_date: str("Last day, YYYY-MM-DD"), limit: int("Rows (1-1000, default 25)"), page_contains: str("Only pages whose address contains this") }, ["site"]),
    async run(acc, a) {
      const site = cleanProperty(a.site), body = analyticsBody(a);
      const rows: any[] = check(await callApi(acc, "POST", wm(`/sites/${encodeURIComponent(site)}/searchAnalytics/query`), { json: body })).json?.rows ?? [];
      const dims = (body.dimensions as string[]).join(" / ");
      const head = `${site} · ${body.startDate} → ${body.endDate} · by ${dims}`;
      return out(rows.length ? `${head}\n${rows.map((r) => `- ${(r.keys ?? []).join(" / ")} · ${r.clicks} clicks · ${r.impressions} impressions · CTR ${pct(r.ctr)} · position ${Number(r.position).toFixed(1)}`).join("\n")}` : `${head}\nNo data for this period.`, `${rows.length} rows`);
    },
  },
  {
    action: "sc_sitemaps", risk: "read", label: "Reading sitemaps",
    description: "The sitemaps submitted for a site: when Google last read them, errors and warnings.",
    schema: obj({ site: str("The property, as sc_sites gives it") }, ["site"]),
    async run(acc, a) {
      const site = cleanProperty(a.site);
      const list: any[] = check(await callApi(acc, "GET", wm(`/sites/${encodeURIComponent(site)}/sitemaps`))).json?.sitemap ?? [];
      return out(list.length ? list.map((s) => `- ${s.path} · submitted ${s.lastSubmitted ?? "?"} · read ${s.lastDownloaded ?? "never"} · ${s.errors ?? 0} errors, ${s.warnings ?? 0} warnings${s.isPending ? " · pending" : ""}`).join("\n") : "No sitemap submitted for this site.", `${list.length} sitemaps`);
    },
  },
  {
    action: "sc_inspect_url", risk: "read", label: "Inspecting a page in Google",
    description: "Whether Google has indexed one page of the site, and why not: verdict, coverage, last crawl, robots.txt, canonical chosen by Google.",
    schema: obj({ site: str("The property, as sc_sites gives it"), url: str("The full address of the page to inspect") }, ["site", "url"]),
    async run(acc, a) {
      const site = cleanProperty(a.site), url = String(a.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be the page's full address");
      const r = check(await callApi(acc, "POST", vendorUrl("google", "https://searchconsole.googleapis.com/v1/urlInspection/index:inspect"), { json: { inspectionUrl: url, siteUrl: site, languageCode: "fr-FR" } })).json?.inspectionResult ?? {};
      const i = r.indexStatusResult ?? {};
      const lines = [`${url}`, `Verdict: ${i.verdict ?? "?"} · ${i.coverageState ?? ""}`, `Indexing allowed: ${i.indexingState ?? "?"} · robots.txt: ${i.robotsTxtState ?? "?"} · fetch: ${i.pageFetchState ?? "?"}`, `Last crawl: ${i.lastCrawlTime ?? "never"}`, `Canonical — yours: ${i.userCanonical ?? "none"} · Google's: ${i.googleCanonical ?? "none"}`];
      if (r.mobileUsabilityResult?.verdict) lines.push(`Mobile usability: ${r.mobileUsabilityResult.verdict}`);
      return out(lines.join("\n"), String(i.verdict ?? "inspected"));
    },
  },
  {
    action: "pagespeed", risk: "read", label: "Measuring page speed",
    description: "PageSpeed Insights for any public page: the performance score and lab measures (LCP, CLS, TBT) on phone or computer, plus real-user data (Core Web Vitals) when Google has enough visits. Only the page address is sent to Google.",
    schema: obj({ url: str("The page's full address"), strategy: { type: "string", enum: ["mobile", "desktop"], description: "mobile (default) or desktop" } }, ["url"]),
    async run(_acc, a) {
      const url = String(a.url ?? "").trim();
      if (!/^https?:\/\//i.test(url)) throw new Error("url must be the page's full address");
      const qs = new URLSearchParams({ url, strategy: a.strategy === "desktop" ? "desktop" : "mobile" });
      for (const c of ["performance", "accessibility", "seo"]) qs.append("category", c);
      const res = await guardedFetch(vendorUrl("google", `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?${qs}`), { signal: AbortSignal.timeout(90_000), headers: { accept: "application/json" } });
      const j: any = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(`PageSpeed answered with an error: HTTP ${res.status}`);
      const cat = j.lighthouseResult?.categories ?? {}, au = j.lighthouseResult?.audits ?? {};
      const score = (c: any) => (typeof c?.score === "number" ? Math.round(c.score * 100) : "?");
      const field = j.loadingExperience?.metrics ?? {};
      const f = (k: string, unit = "") => (field[k] ? `${field[k].percentile}${unit} (${field[k].category})` : "not enough data");
      return out([
        `${url} · ${qs.get("strategy")}`,
        `Scores — performance ${score(cat.performance)} · accessibility ${score(cat.accessibility)} · SEO ${score(cat.seo)} (out of 100)`,
        `Lab — LCP ${au["largest-contentful-paint"]?.displayValue ?? "?"} · CLS ${au["cumulative-layout-shift"]?.displayValue ?? "?"} · TBT ${au["total-blocking-time"]?.displayValue ?? "?"} · speed index ${au["speed-index"]?.displayValue ?? "?"}`,
        `Real users (28 days) — LCP ${f("LARGEST_CONTENTFUL_PAINT_MS", " ms")} · INP ${f("INTERACTION_TO_NEXT_PAINT", " ms")} · CLS ${f("CUMULATIVE_LAYOUT_SHIFT_SCORE")}`,
      ].join("\n"), `performance ${score(cat.performance)}`);
    },
  },
  {
    action: "indexnow_submit", risk: "write", label: "Telling search engines about changed pages",
    description: "Tell Bing and the other IndexNow search engines that pages of the site were added or changed (IndexNow). Needs the site's IndexNow key and the address of its key file on the site. Asks the owner first.",
    schema: obj({ urls: { type: "array", items: { type: "string" }, description: "Full addresses of the changed pages (same site)" }, key: str("The site's IndexNow key"), key_location: str("Full address of the key file on the site, e.g. https://example.com/<key>.txt") }, ["urls", "key", "key_location"]),
    async run(_acc, a) {
      const body = indexNowBody(a);
      const res = await guardedFetch(process.env.INDEXNOW_API_URL || "https://api.indexnow.org/indexnow", { method: "POST", headers: { "content-type": "application/json; charset=utf-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(30_000) });
      await res.body?.cancel().catch(() => {});
      // Answers (IndexNow documentation): 200 OK, 202 Accepted (key check pending), 400 bad request, 403 key not valid,
      // 422 addresses not on the host or key mismatch, 429 too many requests.
      const meaning: Record<number, string> = { 200: "received", 202: "accepted (the key file will be checked)", 400: "refused: the request is not valid", 403: "refused: the key is not valid (is the key file published at key_location?)", 422: "refused: the addresses do not belong to the host, or the key does not match", 429: "refused: too many requests, try later" };
      const said = meaning[res.status] ?? `answered HTTP ${res.status}`;
      if (res.status >= 400) throw new Error(`IndexNow ${said}`);
      return out(`IndexNow ${said} for ${body.urlList.length} page(s) of ${body.host}.`, `${body.urlList.length} pages`);
    },
  },
];
