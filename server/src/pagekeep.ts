import { emit } from "./bus.js";
import { saveFile } from "./computer.js";
import { pageFiles, pageVersions, type PageFile } from "./pagefiles.js";
import type { LostPart, PageLossCard } from "./pagekeeptypes.js";
import { audit, pages, rows, type BotRecord } from "./store.js";

/**
 * L157 « rien de perdu à la refonte » (backlog A-FAIRE): when a bot publishes a page again (page_publish under the same
 * name) or edits its HTML (page_edit), the old version and the new one are compared — headings and named sections,
 * links, images, text blocks, files next to the HTML. What the new version no longer has goes on a card in the chat
 * (« Ces parties ont disparu »), and the bot is told in its tool result. Nothing is put back on its own: the owner keeps
 * the new version or puts the old one back (a new version is kept either way, as for « Restaurer » in Réglages → Pages).
 *
 * The comparison reads the HTML as text (no browser): scripts, styles and comments are left out; a text block counts as
 * lost only when its words appear nowhere in the new page (a paragraph moved or re-wrapped is not lost).
 */
export interface PageParts { sections: string[]; links: { href: string; text: string }[]; images: { src: string; alt: string }[]; texts: string[] }

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: "\"", apos: "'", nbsp: " " };
const decode = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (all, e: string) => {
  if (e[0] === "#") { const n = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); try { return String.fromCodePoint(n); } catch { return all; } }
  return ENTITIES[e.toLowerCase()] ?? all;
});
const textOf = (html: string) => decode(html.replace(/<[^>]*>/g, " ")).replace(/\s+/g, " ").trim();
/** For comparing words only: case, accents, punctuation and spaces do not count. */
const words = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const attr = (tag: string, name: string) => { const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, "i").exec(tag); return m ? decode(m[1] ?? m[2] ?? m[3] ?? "").trim() : ""; };

/** What a page shows, read from its HTML. */
export function pageParts(html: string): PageParts {
  const body = html.replace(/<!--[\s\S]*?-->/g, " ").replace(/<(script|style|template|noscript)\b[\s\S]*?<\/\1\s*>/gi, " ");
  const sections: string[] = [];
  for (const m of body.matchAll(/<h([1-6])\b[^>]*>([\s\S]*?)<\/h\1\s*>/gi)) { const t = textOf(m[2]); if (t) sections.push(t.slice(0, 120)); }
  for (const m of body.matchAll(/<(section|article|nav|header|footer|aside|main|form|table|figure)\b[^>]*>/gi)) {
    const name = attr(m[0], "aria-label") || attr(m[0], "id");
    if (name) sections.push(`${m[1].toLowerCase()} « ${name.slice(0, 80)} »`);
  }
  const links: PageParts["links"] = [];
  for (const m of body.matchAll(/<a\b([^>]*)>([\s\S]*?)<\/a\s*>/gi)) {
    const href = attr(`<a ${m[1]}>`, "href");
    if (!href || href === "#" || /^javascript:/i.test(href)) continue;
    links.push({ href, text: (textOf(m[2]) || attr(`<a ${m[1]}>`, "aria-label") || href).slice(0, 100) });
  }
  const images: PageParts["images"] = [];
  for (const m of body.matchAll(/<(img|source|video)\b[^>]*>/gi)) {
    const src = attr(m[0], "src") || attr(m[0], "poster") || attr(m[0], "srcset").split(/\s+/)[0] || "";
    if (src) images.push({ src, alt: attr(m[0], "alt") });
  }
  const texts: string[] = [];
  for (const m of body.matchAll(/<(p|li|blockquote|td|dd|figcaption|summary)\b[^>]*>([\s\S]*?)<\/\1\s*>/gi)) {
    const t = textOf(m[2]);
    if (t.length >= 30) texts.push(t);
  }
  return { sections, links, images, texts };
}

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const fileName = (src: string) => { if (/^data:/i.test(src)) return "image (data:)"; try { return decodeURIComponent(src.split(/[?#]/)[0].split("/").pop() || src); } catch { return src; } };

/** What the old page had that the new one no longer has. */
export function lostParts(beforeHtml: string, afterHtml: string, beforeFiles: string[] = [], afterFiles: string[] = []): LostPart[] {
  const a = pageParts(beforeHtml), b = pageParts(afterHtml);
  const out: LostPart[] = [];
  const has = new Set(b.sections.map(words));
  for (const s of new Set(a.sections)) if (!has.has(words(s))) out.push({ kind: "section", text: short(s) });
  const hrefs = new Set(b.links.map((l) => l.href));
  const seenHref = new Set<string>();
  for (const l of a.links) if (!hrefs.has(l.href) && !seenHref.has(l.href)) { seenHref.add(l.href); out.push({ kind: "link", text: short(l.text, 100), detail: short(l.href, 200) }); }
  const srcs = new Set(b.images.map((i) => i.src));
  const seenSrc = new Set<string>();
  for (const i of a.images) if (!srcs.has(i.src) && !seenSrc.has(i.src)) { seenSrc.add(i.src); out.push({ kind: "image", text: short(i.alt || fileName(i.src), 100), detail: /^data:/i.test(i.src) ? undefined : short(i.src, 200) }); }
  const all = ` ${words(textOf(afterHtml.replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, " ")))} `;
  const seenText = new Set<string>();
  for (const t of a.texts) {
    const w = words(t);
    if (!w || seenText.has(w) || all.includes(` ${w} `)) continue;
    seenText.add(w);
    out.push({ kind: "text", text: short(t, 160) });
  }
  const kept = new Set(afterFiles);
  for (const f of beforeFiles) if (!kept.has(f)) out.push({ kind: "file", text: f });
  return out;
}

const ORDER: LostPart["kind"][] = ["section", "image", "link", "text", "file"];
const LABEL: Record<LostPart["kind"], [string, string]> = { section: ["section", "sections"], link: ["link", "links"], image: ["image", "images"], text: ["text block", "text blocks"], file: ["file", "files"] };

/** The sentence for the bot: what disappeared, and that the owner decides. */
export function lossSummary(lost: LostPart[]): string {
  const counts = ORDER.map((k) => [k, lost.filter((p) => p.kind === k).length] as const).filter(([, n]) => n);
  const parts = counts.map(([k, n]) => `${n} ${LABEL[k][n > 1 ? 1 : 0]}`).join(", ");
  const sample = lost.slice(0, 6).map((p) => `${p.kind}: “${p.text}”`).join("; ");
  return `Nothing-lost check: this version no longer has ${parts} that the previous one had (${sample}${lost.length > 6 ? "; …" : ""}). The user got a card listing them and decides whether to keep this version or put the old one back. Tell them in one sentence; if you did not mean to drop them, put them back with page_edit.`;
}

/**
 * After a page was published again or edited: compares it with the version before, posts the card when something
 * disappeared, and returns the sentence for the bot ("" when nothing was lost or there was no version before).
 */
export function checkNothingLost(c: { bot: BotRecord; thread?: number }, page: { token: string; title: string; path: string }, before: { html: string; files: PageFile[] } | null, after: string): string {
  if (!before) return "";
  const previous = pageVersions.list(c.bot.id, page.path)[1];
  if (!previous) return "";
  const lost = lostParts(before.html, after, before.files.map((f) => f.file), pageFiles.names(c.bot.id, page.path));
  if (!lost.length) return "";
  const sorted = [...lost].sort((x, y) => ORDER.indexOf(x.kind) - ORDER.indexOf(y.kind));
  const card: PageLossCard = { type: "pageloss", token: page.token, title: page.title.slice(0, 120), previousVersion: previous.id, lost: sorted.slice(0, 40), total: lost.length, status: "pending" };
  rows.append(c.bot, { kind: "card", card }, c.thread);
  return lossSummary(sorted);
}

export class PageLossRefused extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** The owner's choice on the card: "keep" the new version, or "restore" the one before (kept as a new version). */
export function decidePageLoss(bot: BotRecord, userId: string, seq: number, choice: unknown, base: string): PageLossCard {
  if (choice !== "keep" && choice !== "restore") throw new PageLossRefused(400, "choice must be keep or restore.");
  const row = rows.get(bot.id, bot.generation, seq);
  if (row?.body.kind !== "card" || row.body.card.type !== "pageloss") throw new PageLossRefused(404, "There is no such card here.");
  const card = row.body.card;
  if (card.status !== "pending") throw new PageLossRefused(409, "This card was already answered.");
  const page = pages.byToken(card.token, base);
  if (!page || page.userId !== userId || page.botId !== bot.id) throw new PageLossRefused(404, "That page no longer exists.");
  if (choice === "restore") {
    const v = pageVersions.get(bot.id, page.path, card.previousVersion);
    if (!v) throw new PageLossRefused(409, "The old version is no longer in the page's history.");
    const n = pageVersions.list(bot.id, page.path).find((x) => x.id === card.previousVersion)?.n ?? 0;
    saveFile(bot.id, page.path, v.html);
    pageFiles.replace(bot.id, page.path, v.files);
    pageVersions.record(userId, bot.id, page.path, v.html, `restored version ${n}`);
    audit(userId, "account", `Page ${page.title}: version ${n} restored (nothing-lost check)`, bot.id);
    emit(userId, { type: "pages", token: page.token });
  }
  const next: PageLossCard = { ...card, status: choice === "restore" ? "restored" : "kept" };
  rows.updateCard(bot, row.generation, seq, () => next);
  return next;
}
