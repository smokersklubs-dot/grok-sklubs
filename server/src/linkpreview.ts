/**
 * L184 « aperçu de lien » (OpenMausBot audit "link preview" — behaviour only, our own code).
 *
 * The app asks GET /link-preview?url=… for the first web address of a message; the SERVER reads the page through the
 * guarded fetch (net.ts: private and local addresses are refused, every redirect re-checked), at most 256 KB of HTML
 * within 5 s, and answers only the title, the description and the site's name, as plain text. No picture is fetched or
 * shown (an outside picture would tell that site when the owner reads the chat). Results are kept 1 hour, 300 at most.
 */
import { fetchProblem, guardedFetch } from "./net.js";

export interface LinkPreview { url: string; host: string; title: string; description: string; siteName: string }
const TTL_MS = 3_600_000, MAX = 300, BYTES = 256 * 1024, LIMIT_MS = 5_000;
const cache = new Map<string, { at: number; value: LinkPreview | null }>();

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) => (e[0] === "#" ? String.fromCodePoint(e[1].toLowerCase() === "x" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENTITIES[e.toLowerCase()] ?? m));
const clean = (s: string | undefined, max: number) => decode(String(s ?? "")).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim().slice(0, max);

/** Title, description and site name from a page's <head> (Open Graph first, then the usual tags). */
export function parsePreview(html: string, url: string): LinkPreview | null {
  const head = html.slice(0, BYTES).split(/<\/head>/i)[0];
  const meta = (key: string) => {
    for (const m of head.matchAll(/<meta\b[^>]*>/gi)) {
      const tag = m[0];
      const name = /\b(?:property|name)\s*=\s*["']([^"']+)["']/i.exec(tag)?.[1]?.toLowerCase();
      if (name === key) return /\bcontent\s*=\s*"([^"]*)"|\bcontent\s*=\s*'([^']*)'/i.exec(tag)?.slice(1).find((x) => x !== undefined);
    }
    return undefined;
  };
  const title = clean(meta("og:title") ?? meta("twitter:title") ?? /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1], 160);
  const description = clean(meta("og:description") ?? meta("description") ?? meta("twitter:description"), 300);
  const host = new URL(url).hostname.replace(/^www\./, "");
  if (!title && !description) return null;
  return { url, host, title: title || host, description, siteName: clean(meta("og:site_name"), 60) || host };
}

/** Only plain https / http addresses with a host name, no user name or password in them. */
export function previewable(raw: string): URL | null {
  try { const u = new URL(raw); return /^https?:$/.test(u.protocol) && u.hostname && !u.username && !u.password ? u : null; } catch { return null; }
}

export async function linkPreview(raw: string, fetchFn: typeof guardedFetch = guardedFetch): Promise<{ preview: LinkPreview | null; problem?: string }> {
  const u = previewable(raw);
  if (!u) return { preview: null, problem: "not a web address" };
  const key = u.toString();
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return { preview: hit.value };
  let preview: LinkPreview | null = null;
  try {
    const res = await fetchFn(key, { headers: { accept: "text/html" }, signal: AbortSignal.timeout(LIMIT_MS) });
    if (res.ok && /text\/html|application\/xhtml/i.test(res.headers.get("content-type") ?? "")) {
      const reader = res.body?.getReader();
      let html = "", got = 0;
      const dec = new TextDecoder();
      while (reader && got < BYTES) { const { done, value } = await reader.read(); if (done) break; got += value.length; html += dec.decode(value, { stream: true }); if (/<\/head>/i.test(html)) break; }
      void reader?.cancel().catch(() => undefined);
      preview = parsePreview(html, res.url || key);
    } else void res.body?.cancel().catch(() => undefined);
  } catch (err) {
    return { preview: null, problem: fetchProblem(err) ?? "unreachable" };
  }
  cache.set(key, { at: Date.now(), value: preview });
  while (cache.size > MAX) cache.delete(cache.keys().next().value!);
  return { preview };
}
