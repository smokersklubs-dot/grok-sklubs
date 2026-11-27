/**
 * L117 — web_fetch's « balises » option (claude-seo audit: on-page checks; our own code). From the raw HTML of a page, the
 * tags an SEO check needs, in a short report the bot reads before the page text: title and description with their
 * length, robots, canonical, hreflang, Open Graph / Twitter, viewport, language, headings (H1-H3), JSON-LD types,
 * images without a text alternative, links counted. Read-only parsing of text already fetched: nothing is run.
 */
const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ");
const clean = (s: string) => decode(s.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
const attr = (tag: string, name: string) => {
  const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag);
  return m ? decode(m[2] ?? m[3] ?? m[4] ?? "").trim() : null;
};

export interface SeoTags {
  title: string | null; description: string | null; robots: string | null; canonical: string | null; lang: string | null; viewport: string | null;
  hreflang: { lang: string; href: string }[]; social: Record<string, string>; headings: { level: number; text: string }[];
  jsonLd: string[]; jsonLdErrors: number; images: number; imagesWithoutAlt: number; links: { internal: number; external: number; nofollow: number };
}

export function extractSeoTags(html: string, pageUrl: string): SeoTags {
  const src = html.replace(/<!--[\s\S]*?-->/g, "");
  const head = /<head[\s\S]*?<\/head>/i.exec(src)?.[0] ?? src;
  const metas = [...head.matchAll(/<meta\b[^>]*>/gi)].map((m) => m[0]);
  const meta = (key: string) => { const t = metas.find((m) => (attr(m, "name") ?? attr(m, "property") ?? "").toLowerCase() === key); return t ? attr(t, "content") : null; };
  const links = [...head.matchAll(/<link\b[^>]*>/gi)].map((m) => m[0]);
  const social: Record<string, string> = {};
  for (const m of metas) { const k = (attr(m, "property") ?? attr(m, "name") ?? "").toLowerCase(); if (/^(og|twitter):/.test(k) && Object.keys(social).length < 20) social[k] = (attr(m, "content") ?? "").slice(0, 300); }
  const jsonLd: string[] = []; let jsonLdErrors = 0;
  for (const m of src.matchAll(/<script\b[^>]*type\s*=\s*["']?application\/ld\+json["']?[^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const v = JSON.parse(m[1]);
      const walk = (x: any) => { if (Array.isArray(x)) x.forEach(walk); else if (x && typeof x === "object") { if (x["@type"]) jsonLd.push(String(x["@type"])); if (Array.isArray(x["@graph"])) x["@graph"].forEach(walk); } };
      walk(v);
    } catch { jsonLdErrors++; }
  }
  const body = src.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, "");
  const imgs = [...body.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]);
  let host = "";
  try { host = new URL(pageUrl).host; } catch { /* relative */ }
  const out = { internal: 0, external: 0, nofollow: 0 };
  for (const m of body.matchAll(/<a\b[^>]*>/gi)) {
    const href = attr(m[0], "href"); if (!href || /^(#|javascript:|mailto:|tel:)/i.test(href)) continue;
    let h = host; try { h = new URL(href, pageUrl).host; } catch { /* keep */ }
    if (h === host) out.internal++; else out.external++;
    if (/nofollow/i.test(attr(m[0], "rel") ?? "")) out.nofollow++;
  }
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(head)?.[1];
  return {
    title: title !== undefined ? clean(title) : null, description: meta("description"), robots: meta("robots"), viewport: meta("viewport"),
    canonical: links.map((l) => ((attr(l, "rel") ?? "").toLowerCase() === "canonical" ? attr(l, "href") : null)).find(Boolean) ?? null,
    lang: attr(/<html\b[^>]*>/i.exec(src)?.[0] ?? "", "lang"),
    hreflang: links.filter((l) => (attr(l, "rel") ?? "").toLowerCase() === "alternate" && attr(l, "hreflang")).slice(0, 20).map((l) => ({ lang: attr(l, "hreflang")!, href: attr(l, "href") ?? "" })),
    social, headings: [...body.matchAll(/<h([1-3])\b[^>]*>([\s\S]*?)<\/h\1>/gi)].slice(0, 40).map((m) => ({ level: Number(m[1]), text: clean(m[2]).slice(0, 160) })),
    jsonLd: [...new Set(jsonLd)].slice(0, 20), jsonLdErrors, images: imgs.length, imagesWithoutAlt: imgs.filter((t) => attr(t, "alt") === null).length, links: out,
  };
}

/** The short report web_fetch puts before the page text (English: the model reads it). Facts only, no score. */
export function seoTagsReport(t: SeoTags): string {
  const len = (s: string | null) => (s === null ? "MISSING" : `"${s.slice(0, 300)}" (${s.length} characters)`);
  const h1 = t.headings.filter((h) => h.level === 1);
  return [
    "Tags of this page (raw HTML, before any script ran — a page built by JavaScript may differ; open it in the browser to compare):",
    `- title: ${len(t.title)}`, `- meta description: ${len(t.description)}`,
    `- robots: ${t.robots ?? "none"} · canonical: ${t.canonical ?? "none"} · lang: ${t.lang ?? "none"} · viewport: ${t.viewport ?? "MISSING"}`,
    `- hreflang: ${t.hreflang.length ? t.hreflang.map((h) => `${h.lang} → ${h.href}`).join(", ") : "none"}`,
    `- social: ${Object.keys(t.social).length ? Object.entries(t.social).map(([k, v]) => `${k}="${v}"`).join("; ") : "none"}`,
    `- H1: ${h1.length} (${h1.map((h) => `"${h.text}"`).join(", ") || "none"}); headings: ${t.headings.map((h) => `H${h.level} ${h.text}`).slice(0, 25).join(" | ") || "none"}`,
    `- JSON-LD types: ${t.jsonLd.join(", ") || "none"}${t.jsonLdErrors ? ` (${t.jsonLdErrors} block(s) not valid JSON)` : ""}`,
    `- images: ${t.images}, without alt attribute: ${t.imagesWithoutAlt} · links: ${t.links.internal} internal, ${t.links.external} external, ${t.links.nofollow} nofollow`,
  ].join("\n");
}
