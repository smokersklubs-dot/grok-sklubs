/**
 * L75 — web_fetch reads a page as Markdown when it can (agent-browser audit, "read": `Accept: text/markdown`, `.md`,
 * `llms.txt`; our own code):
 *  - the request says it prefers Markdown (`Accept: text/markdown, text/html;q=0.9, …`): a site that serves Markdown
 *    (content negotiation, e.g. docs sites behind Cloudflare's "Markdown for agents") answers with it, kept as is;
 *  - an HTML page is turned into light Markdown (headings, links, lists, emphasis, code) instead of flat text, so the bot
 *    sees the structure and the link addresses;
 *  - `llms: true` reads the site's /llms.txt first (the proposal at https://llmstxt.org: a Markdown index of the site
 *    for language models, at the root), then the page; a page's own Markdown copy (the same address + ".md", also from
 *    llmstxt.org) is tried first with `markdown_copy: true`.
 */
export const MARKDOWN_ACCEPT = "text/markdown, text/x-markdown;q=0.95, text/html;q=0.9, text/plain;q=0.8, */*;q=0.5";

/** Whether an answer is Markdown (by its type, or a text answer to a ".md" / llms.txt address). */
export const isMarkdown = (type: string, url = "") => /markdown/i.test(type) || (/text\/plain/i.test(type) && /(\.md|\/llms(-full)?\.txt)(\?|#|$)/i.test(url));

/** The site's llms.txt address for a page address. */
export const llmsTxtOf = (url: string) => { try { return new URL("/llms.txt", url).toString(); } catch { return ""; } };
/** The page's own Markdown copy address (llmstxt.org: the page's address + ".md"; "index.html.md" for a folder). */
export function markdownCopyOf(url: string): string {
  try {
    const u = new URL(url);
    if (/\.md$/i.test(u.pathname)) return "";
    u.pathname = u.pathname.endsWith("/") ? `${u.pathname}index.html.md` : `${u.pathname}.md`;
    u.hash = "";
    return u.toString();
  } catch { return ""; }
}

const decode = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n) || 32)).replace(/&amp;/g, "&");
const flat = (s: string) => decode(s.replace(/<[^>]+>/g, " ")).replace(/\s+/g, " ").trim();

/** Light HTML → Markdown: enough structure for a model (headings, links with addresses, lists, emphasis, code, quotes). */
export function htmlToMarkdown(html: string, base = ""): string {
  const abs = (href: string) => { try { return base ? new URL(decode(href), base).toString() : decode(href); } catch { return decode(href); } };
  let s = html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<(script|style|noscript|svg|template|head|iframe)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(nav|footer)\b[\s\S]*?<\/\1>/gi, (m) => (m.length > 4000 ? " " : m));
  // Code first, so what is inside is kept as written.
  const code: string[] = [];
  s = s.replace(/<pre[^>]*>([\s\S]*?)<\/pre>/gi, (_, body: string) => { code.push(decode(body.replace(/<[^>]+>/g, ""))); return `\n\n\u0000${code.length - 1}\u0000\n\n`; });
  s = s.replace(/<code[^>]*>([\s\S]*?)<\/code>/gi, (_, body: string) => `\`${flat(body)}\``);
  s = s.replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_, n: string, body: string) => `\n\n${"#".repeat(Number(n))} ${flat(body)}\n\n`);
  s = s.replace(/<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi, (_, href: string, body: string) => {
    const text = flat(body);
    if (!text) return " ";
    return /^(javascript:|#)/i.test(href) ? text : `[${text.replace(/[[\]]/g, "")}](${abs(href)})`;
  });
  s = s.replace(/<(strong|b)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, body: string) => { const t = flat(body); return t ? `**${t}**` : " "; });
  s = s.replace(/<(em|i)\b[^>]*>([\s\S]*?)<\/\1>/gi, (_, _t, body: string) => { const t = flat(body); return t ? `*${t}*` : " "; });
  s = s.replace(/<li[^>]*>/gi, "\n- ").replace(/<\/li>/gi, "");
  s = s.replace(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, (_, body: string) => `\n\n> ${flat(body)}\n\n`);
  s = s.replace(/<img\b[^>]*alt\s*=\s*["']([^"']+)["'][^>]*>/gi, (_, alt: string) => ` [image: ${decode(alt)}] `);
  s = s.replace(/<(br)\s*\/?>/gi, "\n").replace(/<\/(p|div|section|article|tr|ul|ol|table|header|main|h[1-6])>/gi, "\n\n").replace(/<\/t[dh]>/gi, " | ");
  s = decode(s.replace(/<[^>]+>/g, " "));
  s = s.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
  return s.replace(/\u0000(\d+)\u0000/g, (_, i: string) => `\`\`\`\n${code[Number(i)].replace(/\n+$/, "")}\n\`\`\``);
}

type Get = (url: string, accept: string) => Promise<Response>;
/** A text answer of at most 60 000 characters, or null (not found, not text, an error). */
async function textOf(get: Get, url: string): Promise<{ url: string; type: string; text: string } | null> {
  if (!url) return null;
  try {
    const r = await get(url, MARKDOWN_ACCEPT);
    const type = r.headers.get("content-type") ?? "";
    if (!r.ok || !/text|markdown/i.test(type) || /html/i.test(type)) { await r.body?.cancel().catch(() => undefined); return null; }
    return { url: r.url || url, type, text: (await r.text()).slice(0, 60_000) };
  } catch { return null; }
}
/** What web_fetch reads before (or instead of) the page: the site's llms.txt, the page's own Markdown copy. */
export async function markdownExtras(url: string, a: { llms?: unknown; markdown_copy?: unknown }, get: Get): Promise<{ prefix: string; copy: { url: string; text: string } | null }> {
  const llms = a.llms === true ? await textOf(get, llmsTxtOf(url)) : null;
  const copy = a.markdown_copy === true ? await textOf(get, markdownCopyOf(url)) : null;
  const prefix = a.llms === true ? (llms ? `llms.txt of this site (${llms.url}):\n${llms.text.slice(0, 12_000)}\n\n---\n\n` : "This site has no llms.txt.\n\n") : "";
  return { prefix, copy: copy && isMarkdown(copy.type, copy.url) ? copy : null };
}
