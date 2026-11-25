import { q } from "./db.js";
import type { BuiltinTool } from "./agent/tools.js";
import type { ToolSpec } from "./llm/types.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { netGate } from "./netpolicy.js";
import { now, type BotRecord } from "./store.js";

/**
 * L157 « photothèque Wikimedia avec crédit automatique » (backlog A-FAIRE): free photos for the bots' pages, from
 * Wikimedia Commons only, through its official API, with their credit kept.
 *
 * API (MediaWiki Action API on commons.wikimedia.org, read-only, no key):
 *  - search in the File namespace: action=query&generator=search&gsrnamespace=6&gsrsearch=… (filetype:bitmap keeps
 *    photos and drawings, not PDFs or sounds) — https://www.mediawiki.org/wiki/API:Search
 *  - the file's addresses and its licence: prop=imageinfo&iiprop=url|extmetadata|mime&iiurlwidth=1280 —
 *    https://www.mediawiki.org/wiki/API:Imageinfo ; the licence, author and attribution fields of `extmetadata`
 *    (LicenseShortName, LicenseUrl, Artist, AttributionRequired, UsageTerms) — https://www.mediawiki.org/wiki/Extension:CommonsMetadata
 *  - one file by name: titles=File:… with the same props.
 *  - a descriptive User-Agent, as Wikimedia asks: https://meta.wikimedia.org/wiki/User-Agent_policy ; few requests
 *    (20 results per search at most): https://www.mediawiki.org/wiki/Wikimedia_APIs/Rate_limits
 *
 * Credit (https://commons.wikimedia.org/wiki/Commons:Credit_line): title of the work linked to its file page, author,
 * licence linked to its text, "via Wikimedia Commons". Only free licences are offered (public domain, CC0, CC BY, CC BY-SA,
 * GFDL, Free Art); anything NC, ND, "non-free" or "fair use" is left out.
 *
 * AUTOMATIC CREDIT. Every photo a bot found is remembered for its account (its credit included). When a page is published
 * or edited with a Commons image (upload.wikimedia.org or thumb.wikimedia.org), the credits it lacks are added at the
 * end of the page, in a block Sklubot owns (<aside data-sklubot-credits>), rewritten on each save; a Commons image the
 * bot never looked up is looked up by name first. An image whose licence is not free, or whose credit cannot be found,
 * is reported to the bot, which must replace or remove it.
 */
export const COMMONS_API = "https://commons.wikimedia.org/w/api.php";
export const COMMONS_UA = "Sklubot/0.1 (self-hosted team of assistants; photo search with credits)";
export interface CommonsPhoto { file: string; title: string; url: string; thumb: string; page: string; author: string; licence: string; licenceUrl: string; width: number; height: number; credit: string }

q.run("CREATE TABLE IF NOT EXISTS commons_photos (user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, file TEXT NOT NULL, title TEXT NOT NULL, page TEXT NOT NULL, author TEXT NOT NULL, licence TEXT NOT NULL, licence_url TEXT NOT NULL, credit TEXT NOT NULL, created_at INTEGER NOT NULL, PRIMARY KEY (user_id, file))");

type Fetch = (url: string) => Promise<Response>;
/** Replaced in tests (no network there). */
export const commonsNet: { fetch: Fetch } = {
  fetch: (url) => guardedFetch(url, { headers: { "user-agent": COMMONS_UA, accept: "application/json" }, redirect: "follow", signal: AbortSignal.timeout(20_000) }),
};

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" })[c]!);
const plain = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#0?39;/g, "'").replace(/\s+/g, " ").trim();

/** A licence that lets anyone reuse the photo on any page, commercial included (attribution and share-alike are fine). */
export function freeLicence(short: string, code = ""): boolean {
  const s = `${short} ${code}`.toLowerCase();
  if (!s.trim() || /\b(nc|nd)\b|-nc\b|-nd\b|non[- ]?commercial|no[- ]?deriv|non-free|fair use|all rights reserved|copyrighted free use provided/.test(s)) return false;
  return /\bcc0\b|public domain|\bpd\b|^pd[- ]|cc[- ]by(?:[- ]sa)?\b|cc-by(?:-sa)?-|gfdl|free art|\bfal\b|attribution\b/.test(s);
}

/** The file name (File:… without the prefix, spaces as underscores) behind a Commons address, or null. */
export function commonsFile(src: string): string | null {
  let u: URL;
  try { u = new URL(src, "https://example.invalid/"); } catch { return null; }
  if (!/^(upload|thumb)\.wikimedia\.org$/i.test(u.hostname) || !/\/commons\//.test(u.pathname)) return null;
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("thumb");
  // /wikipedia/commons/thumb/a/ab/Name.jpg/1280px-Name.jpg → Name.jpg ; /wikipedia/commons/a/ab/Name.jpg → Name.jpg
  const name = i >= 0 && parts.length > i + 3 ? parts[i + 3] : parts[parts.length - 1];
  try { return decodeURIComponent(name ?? "").replace(/ /g, "_") || null; } catch { return null; }
}

/** The credit line, in the page's language (fr or en). */
export function creditHtml(p: Pick<CommonsPhoto, "title" | "page" | "author" | "licence" | "licenceUrl">, lang: "fr" | "en" = "fr"): string {
  const by = p.author ? (lang === "fr" ? ` par ${esc(p.author)}` : ` by ${esc(p.author)}`) : "";
  const lic = p.licenceUrl ? `<a href="${esc(p.licenceUrl)}" rel="license noopener" target="_blank">${esc(p.licence)}</a>` : esc(p.licence);
  return `<a href="${esc(p.page)}" rel="noopener" target="_blank">${esc(p.title)}</a>${by}, ${lic}, ${lang === "fr" ? "via Wikimedia Commons" : "via Wikimedia Commons"}`;
}

interface ApiPage { title?: string; index?: number; missing?: boolean; imageinfo?: { url?: string; thumburl?: string; descriptionurl?: string; width?: number; height?: number; mime?: string; thumbwidth?: number; thumbheight?: number; extmetadata?: Record<string, { value?: string }> }[] }
function toPhoto(p: ApiPage): CommonsPhoto | null {
  const ii = p.imageinfo?.[0];
  if (!ii?.url || !ii.descriptionurl || !p.title) return null;
  const m = ii.extmetadata ?? {};
  const licence = plain(m.LicenseShortName?.value ?? "");
  if (!freeLicence(licence, plain(m.License?.value ?? ""))) return null;
  const file = p.title.replace(/^File:/i, "").replace(/ /g, "_");
  const title = plain(m.ObjectName?.value ?? "") || p.title.replace(/^File:/i, "").replace(/\.[a-z0-9]+$/i, "");
  const author = plain(m.Artist?.value ?? "").slice(0, 200) || (/public domain|\bpd\b|cc0/i.test(licence) ? "" : "Unknown author");
  const strip = (u: string) => u.replace(/\?utm_[^#]*$/, "");
  const photo = { file, title: title.slice(0, 200), url: strip(ii.url), thumb: strip(ii.thumburl || ii.url), page: ii.descriptionurl, author, licence, licenceUrl: plain(m.LicenseUrl?.value ?? ""), width: ii.thumbwidth || ii.width || 0, height: ii.thumbheight || ii.height || 0 };
  return { ...photo, credit: creditHtml(photo) };
}

const PROPS = "prop=imageinfo&iiprop=url%7Cextmetadata%7Csize%7Cmime&iiurlwidth=1280&iiextmetadatafilter=Artist%7CLicenseShortName%7CLicenseUrl%7CLicense%7CAttributionRequired%7CObjectName%7CUsageTerms";
async function ask(params: string): Promise<ApiPage[]> {
  const res = await commonsNet.fetch(`${COMMONS_API}?action=query&format=json&formatversion=2&${params}&${PROPS}`);
  if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}`);
  const body = (await res.json()) as { query?: { pages?: ApiPage[] } };
  return body.query?.pages ?? [];
}

const remember = (userId: string, photos: CommonsPhoto[]) => {
  for (const p of photos) q.run("INSERT INTO commons_photos (user_id, file, title, page, author, licence, licence_url, credit, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT (user_id, file) DO UPDATE SET title = excluded.title, page = excluded.page, author = excluded.author, licence = excluded.licence, licence_url = excluded.licence_url, credit = excluded.credit", userId, p.file, p.title, p.page, p.author, p.licence, p.licenceUrl, p.credit, now());
};
const known = (userId: string, file: string) => q.get<{ title: string; page: string; author: string; licence: string; licence_url: string }>("SELECT title, page, author, licence, licence_url FROM commons_photos WHERE user_id = ? AND file = ?", userId, file);

/** Free photos for a search, remembered with their credit for this account. */
export async function searchPhotos(userId: string, query: string, count = 6): Promise<CommonsPhoto[]> {
  const n = Math.min(10, Math.max(1, Math.trunc(count) || 6));
  const pages = await ask(`generator=search&gsrnamespace=6&gsrlimit=20&gsrsearch=${encodeURIComponent(`${query} filetype:bitmap`)}`);
  const photos = [...pages].sort((x, y) => (x.index ?? 0) - (y.index ?? 0)).map(toPhoto).filter((p): p is CommonsPhoto => !!p).slice(0, n);
  remember(userId, photos);
  return photos;
}

const CREDITS = /\s*<aside data-sklubot-credits[^>]*>[\s\S]*?<\/aside>\s*/i;
/** The Commons images of a page (file names), from its HTML and CSS. */
export function commonsImages(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/https?:\/\/(?:upload|thumb)\.wikimedia\.org\/[^\s"'()<>]+/gi)) { const f = commonsFile(m[0]); if (f) out.add(f); }
  return [...out];
}

/**
 * The page with the credits of its Commons images: known ones from this account's photos, unknown ones looked up by name
 * (when the bot's network policy allows Commons). `problems`: images to replace (not free, or not found).
 */
export async function withCommonsCredits(bot: Pick<BotRecord, "id" | "userId" | "name">, html: string, css = ""): Promise<{ html: string; added: number; problems: string[] }> {
  const base = html.replace(CREDITS, "\n");
  const files = commonsImages(base + "\n" + css);
  if (!files.length) return { html: html === base || !CREDITS.test(html) ? html : base, added: 0, problems: [] };
  const missing = files.filter((f) => !known(bot.userId, f));
  const problems: string[] = [];
  if (missing.length && !netGate(bot, COMMONS_API, "photo_search")) {
    try {
      const found = (await ask(`titles=${missing.slice(0, 20).map((f) => encodeURIComponent(`File:${f}`)).join("%7C")}`));
      for (const p of found) {
        const photo = toPhoto(p);
        if (photo) remember(bot.userId, [photo]);
        else if (p.title) problems.push(`${p.title.replace(/^File:/i, "")}: ${p.missing ? "not found on Wikimedia Commons" : "its licence is not free (or has no licence): replace it"}`);
      }
    } catch (e) { problems.push(`could not look up ${missing.length} image${missing.length > 1 ? "s" : ""} on Wikimedia Commons (${fetchProblem(e) ?? (e as Error).message})`); }
  }
  const lang: "fr" | "en" = /<html[^>]*\slang\s*=\s*["']?(?!fr)[a-z]/i.test(base) ? "en" : "fr";
  const lines = files.map((f) => known(bot.userId, f)).filter((k): k is NonNullable<typeof k> => !!k)
    .map((k) => `<li>${creditHtml({ title: k.title, page: k.page, author: k.author, licence: k.licence, licenceUrl: k.licence_url }, lang)}</li>`);
  for (const f of files) if (!known(bot.userId, f) && !problems.some((p) => p.startsWith(f) || p.startsWith(f.replace(/_/g, " ")))) problems.push(`${f}: no credit found`);
  if (!lines.length) return { html: base, added: 0, problems };
  const block = `\n<aside data-sklubot-credits style="max-width:72rem;margin:2rem auto 1rem;padding:0 1rem;font:13px/1.5 system-ui,sans-serif;opacity:.85"><p style="margin:0 0 .25rem;font-weight:600">${lang === "fr" ? "Crédits photo" : "Photo credits"}</p><ul style="margin:0;padding-left:1.2rem">${lines.join("")}</ul></aside>\n`;
  const out = /<\/body>/i.test(base) ? base.replace(/<\/body>(?![\s\S]*<\/body>)/i, `${block}</body>`) : base + block;
  return { html: out, added: lines.length, problems };
}

/** The bot's sentence after a save with Commons images ("" without any). */
export const creditsNote = (r: { added: number; problems: string[] }) =>
  (r.added ? `\n\nPhoto credits: ${r.added} Wikimedia Commons credit${r.added > 1 ? "s" : ""} (title, author, licence, link) kept at the end of the page; do not remove them.` : "")
  + (r.problems.length ? `\n\nCommons images without a usable credit — replace them (photo_search finds free ones) or remove them: ${r.problems.slice(0, 5).join("; ")}.` : "");

// ── The bot's tool ──
const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
export const photoTools: BuiltinTool[] = [{
  spec: {
    name: "photo_search",
    description: "Find free photos for a page on Wikimedia Commons (public domain, CC0, CC BY, CC BY-SA only). Returns each photo's address (1280 px wide), size, author and licence. Use the address as is in <img src> with a real alt text; the credit (title, author, licence, link) is added to the page automatically when you publish it, so do not write it yourself and never remove it.",
    inputSchema: obj({ query: { type: "string", description: "What the photo shows, in English or the page's language (e.g. 'lighthouse brittany')" }, count: { type: "integer", description: "How many photos, 1 to 10 (default 6)" } }, ["query"]),
  },
  activity: "reading", label: "Looking for free photos", group: "pages", outside: true, parallel: true, detail: (a) => String(a.query ?? "").slice(0, 60),
  run: async (a, c) => {
    const query = String(a.query ?? "").trim().slice(0, 200);
    if (!query) return { content: "Say what the photo should show.", isError: true };
    const net = netGate(c.bot, COMMONS_API, "photo_search");
    if (net) return { content: net, isError: true, summary: "blocked" };
    let photos: CommonsPhoto[];
    try { photos = await searchPhotos(c.user.id, query, Number(a.count) || 6); }
    catch (e) { return { content: `Wikimedia Commons could not be searched: ${fetchProblem(e) ?? (e as Error).message}. Try again in a minute.`, isError: true, summary: "not searched" }; }
    if (!photos.length) return { content: `No free photo found on Wikimedia Commons for “${query}”. Try other words (English often finds more).`, summary: "0" };
    return { content: `${photos.length} free photo${photos.length > 1 ? "s" : ""} from Wikimedia Commons (the credit is added to the page when you publish it):\n${photos.map((p, i) => `${i + 1}. ${p.title} — ${p.width}×${p.height} — ${p.author || "public domain"} — ${p.licence}\n   src: ${p.thumb}\n   file page: ${p.page}`).join("\n")}`, summary: `${photos.length}` };
  },
}];
