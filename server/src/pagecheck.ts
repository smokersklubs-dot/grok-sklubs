/**
 * L56 — the automatic check of a page the bot publishes (page_publish, page_edit): the page as it was just saved, rendered
 * in the bot's own browser at a phone width (390 px) and a computer width (1280 px), one picture of both sent back to the
 * bot, its console errors and failed loads, and a floor of rules (images without alt text, contrast, sideways overflow,
 * main title below the first screen, missing viewport, `transition: all`, `100vw`, no focus style, motion without a
 * reduced-motion fallback, colours written directly, broken JSON-LD, invisible characters). The bot gets a short report
 * it must pass on; "nothing found" is said as "nothing found by these checks", never as "clean".
 *
 * Portions adapted from Nutlope/hallmark (https://github.com/Nutlope/hallmark, commit 04977e15f3dfd6ee4b74c887dac3eb52665d6c92),
 * Copyright (c) 2026 Hallmark contributors, MIT License — skills/hallmark/scripts/sloplint-render.mjs `observe()` (gate 34
 * horizontal scroll and phone spill, gate 40 computed contrast, gate 44b fold) and sloplint.mjs (gates 10a
 * `transition: all`, 34 `100vw`, 26a no `:focus-visible`, 27 motion without `prefers-reduced-motion`); modified for
 * Sklubot: one function returning plain findings, phone width 390 instead of 375, no gradients, at most 5 contrast
 * findings, plain-word messages; static rules on the page's own HTML and CSS files. See THIRD_PARTY_NOTICES.md.
 */
import { browserAvailable, screen } from "./computer.js";
import { composeSheet } from "./contactsheet.js";
import { pageHeaders } from "./pagefiles.js";
import { clip } from "./store.js";
import { userDriving } from "./takeover.js";
import type { BotRecord, UserRecord } from "./store.js";
import type { ImageBlock, TextBlock } from "./llm/types.js";

export const CHECK_SIZES: [number, number][] = [[390, 844], [1280, 800]];
export interface CheckFile { path: string; content: string }
export interface PageCheckRequest { html: string; files: CheckFile[]; headers: Record<string, string>; sizes: [number, number][]; rules: string }
export interface InPageFinding { rule: string; text: string }
export interface PageCheckAnswer {
  ok?: boolean; error?: string; shots?: { width: number; height: number; data: string }[];
  console?: { width: number; text: string; line?: number; url?: string; source?: string }[];
  failed?: { width: number; url: string; status?: number; error?: string; blocked?: string }[];
  rules?: Record<string, InPageFinding[]>;
}

/**
 * The in-page rules, run at each width once the page has settled (an expression returning a list of findings). Gates
 * 34, 40 and 44b of Hallmark's sloplint-render.mjs observe(), adapted (see the header).
 */
export const PAGE_RULES_JS = String.raw`(() => {
  const out = [];
  const push = (rule, text) => out.push({ rule: rule, text: text });
  const describe = (el) => { const cls = (el.className && typeof el.className === 'string') ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : ''; return el.tagName.toLowerCase() + (el.id ? '#' + el.id : '') + cls; };
  const visible = (el) => { const cs = getComputedStyle(el); if (cs.display === 'none' || cs.visibility === 'hidden' || parseFloat(cs.opacity) === 0) return false; const r = el.getBoundingClientRect(); return r.width > 1 && r.height > 1; };
  // The layout width (clientWidth): on a phone the browser may zoom out to show a too-wide page, which innerWidth follows.
  const vw = document.documentElement.clientWidth || window.innerWidth;
  const sw = document.documentElement.scrollWidth;
  if (sw > vw + 1) {
    const wide = [...document.querySelectorAll('body *')].find((el) => { if (!visible(el) || el.closest('svg')) return false; const r = el.getBoundingClientRect(); return r.right > vw + 2; });
    push('overflow', 'the page is ' + sw + ' px wide at ' + vw + ' px: it scrolls sideways' + (wide ? ' (' + describe(wide) + ' goes past the edge)' : ''));
  } else if (vw < 600) {
    const clipped = (el) => { for (let q = el.parentElement; q && q !== document.body && q !== document.documentElement; q = q.parentElement) { const cs = getComputedStyle(q); if (/hidden|clip|auto|scroll/.test(cs.overflowX + ' ' + cs.overflow)) return true; } return false; };
    const spill = [...document.querySelectorAll('body *')].find((el) => { if (!visible(el) || getComputedStyle(el).position === 'fixed' || el.closest('svg') || clipped(el)) return false; const r = el.getBoundingClientRect(); return r.right > vw + 2 || r.left < -2; });
    if (spill) { const r = spill.getBoundingClientRect(); push('overflow', describe(spill) + ' runs ' + Math.round(Math.max(r.right - vw, -r.left)) + ' px past the ' + vw + ' px screen, hidden only by the page cutting it off'); }
  }
  if (window.innerWidth >= 1200) {
    const h1 = document.querySelector('h1');
    if (h1 && visible(h1) && h1.getBoundingClientRect().bottom > window.innerHeight) push('fold', 'the main title (h1) ends ' + Math.round(h1.getBoundingClientRect().bottom) + ' px down: below the first screen at ' + window.innerWidth + '×' + window.innerHeight);
  }
  const cvs = document.createElement('canvas'); cvs.width = cvs.height = 1;
  const ctx2 = cvs.getContext('2d', { willReadFrequently: true });
  const toRgb = (str) => { ctx2.clearRect(0, 0, 1, 1); ctx2.fillStyle = 'rgba(0, 0, 0, 0)'; ctx2.fillStyle = str; ctx2.fillRect(0, 0, 1, 1); const d = ctx2.getImageData(0, 0, 1, 1).data; return { r: d[0] / 255, g: d[1] / 255, b: d[2] / 255, a: d[3] / 255 }; };
  const parse = (s) => { if (!s || s === 'transparent') return null; const m = /^rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)$/.exec(s.trim()); if (m) return { r: +m[1] / 255, g: +m[2] / 255, b: +m[3] / 255, a: m[4] == null ? 1 : +m[4] }; return toRgb(s); };
  const lin = (c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
  const ratio = (a, b) => { const la = lum(a), lb = lum(b); return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05); };
  const bgOf = (el) => { for (let node = el; node && node !== document.documentElement; node = node.parentElement) { const cs = getComputedStyle(node); if (/gradient|url\(/.test(cs.backgroundImage)) return null; const c = parse(cs.backgroundColor); if (c && c.a >= 0.9) return c; } const root = parse(getComputedStyle(document.documentElement).backgroundColor); return root && root.a > 0 ? root : { r: 1, g: 1, b: 1, a: 1 }; };
  let low = 0; const seen = new Set();
  for (const el of document.querySelectorAll('body *')) {
    if (low >= 5) break;
    if (!visible(el) || el.closest('svg')) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 2)) continue;
    const cs = getComputedStyle(el); const fg = parse(cs.color); if (!fg || fg.a < 0.9) continue;
    const bg = bgOf(el); if (!bg) continue;
    const size = parseFloat(cs.fontSize), weight = parseInt(cs.fontWeight, 10) || 400;
    const threshold = (size >= 24 || (size >= 18.5 && weight >= 700)) ? 3.0 : 4.5;
    const r = ratio(fg, bg); const key = describe(el);
    if (r < threshold - 0.05 && !seen.has(key)) { seen.add(key); low++; push('contrast', 'contrast ' + r.toFixed(2) + ':1 (needs ' + threshold + ':1) on ' + key + ' "' + (el.innerText || '').replace(/\s+/g, ' ').trim().slice(0, 30) + '"'); }
  }
  for (const el of document.querySelectorAll('a, button, [role=button]')) {
    if (!visible(el)) continue;
    const name = (el.getAttribute('aria-label') || el.getAttribute('title') || el.innerText || [...el.querySelectorAll('img[alt]')].map((i) => i.alt).join(' ') || '').trim();
    if (!name) { push('name', describe(el) + ' has no name a screen reader can say (no text, aria-label or title)'); break; }
  }
  return out;
})()`;

// ── Static rules (the HTML and CSS the bot wrote; work without a browser too) ─────────────────────────────────────────
const styleOf = (html: string, files: CheckFile[]) => [
  ...[...html.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)].map((m) => m[1]),
  ...[...html.matchAll(/\sstyle\s*=\s*"([^"]*)"/gi)].map((m) => `x{${m[1]}}`),
  ...files.filter((f) => /\.css$/i.test(f.path)).map((f) => f.content),
].join("\n").replace(/\/\*[\s\S]*?\*\//g, "");

export interface StaticFinding { rule: string; text: string }
/** The rules read in the page's own code (Hallmark gates 10a, 34, 26a, 27 adapted, and ours). */
export function staticFindings(html: string, files: CheckFile[]): StaticFinding[] {
  const out: StaticFinding[] = [];
  const css = styleOf(html, files);
  const push = (rule: string, text: string) => out.push({ rule, text });
  if (!/<meta[^>]+name\s*=\s*["']?viewport/i.test(html)) push("viewport", "no <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">: phones show the page zoomed out, tiny");
  if (!/<html[^>]*\slang\s*=/i.test(html)) push("lang", "no lang on <html> (e.g. <html lang=\"fr\">): screen readers may read it in the wrong language");
  const noAlt = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0]).filter((t) => !/\salt\s*=/i.test(t));
  if (noAlt.length) push("alt", `${noAlt.length} image${noAlt.length > 1 ? "s" : ""} without alt text (${clip(noAlt[0].match(/src\s*=\s*["']?([^"'\s>]+)/i)?.[1] ?? "<img>", 60)}${noAlt.length > 1 ? "…" : ""}): add alt="what it shows" (alt="" for a decorative one)`);
  const all = (css.match(/transition(?:-property)?\s*:\s*all\b/gi) ?? []).length;
  if (all) push("transition-all", `transition: all (${all}×): list the properties that move instead`);
  const vw = (css.match(/(?:^|[;{\s])(?:min-)?width\s*:\s*100vw/gi) ?? []).length;
  if (vw) push("100vw", `width: 100vw (${vw}×): it is wider than the screen when there is a scroll bar; use width: 100%`);
  const interactive = /<(a|button|input|select|textarea)\b/i.test(html);
  if (interactive && !/:focus(-visible|-within)?\b/.test(css)) push("focus", "no :focus-visible style anywhere: someone using the keyboard cannot see where they are");
  const motion = /@keyframes|animation\s*:|transition\s*:\s*(?!none)/i.test(css) || /\.animate\(/.test(html);
  const prm = /prefers-reduced-motion/i.test(css) || /prefers-reduced-motion/i.test(html);
  if (motion && !prm) push("motion", "motion without a @media (prefers-reduced-motion: reduce) fallback");
  const literal = css.split("\n").filter((l) => !/^\s*--[\w-]+\s*:/.test(l)).join("\n").match(/#[0-9a-f]{3,8}\b|rgba?\([^)]*\)|hsla?\([^)]*\)/gi) ?? [];
  if (literal.length > 8) push("colors", `${literal.length} colours written directly in the CSS: put them in :root variables (--ink, --paper…) so light/dark and changes stay coherent`);
  [...html.matchAll(/<script[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)].forEach((m, i) => {
    try { JSON.parse(m[1]); } catch { push("json-ld", `JSON-LD block ${i + 1} is not valid JSON: search engines ignore it`); }
  });
  const text = html.replace(/<script[\s\S]*?<\/script>/gi, "").replace(/<style[\s\S]*?<\/style>/gi, "");
  const invisible = text.match(/[​-‏⁠﻿‪-‮⁦-⁩]/g) ?? [];
  if (invisible.length) push("invisible", `${invisible.length} invisible character${invisible.length > 1 ? "s" : ""} (${[...new Set(invisible)].map((c) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, "0")}`).join(", ")}) in the text: remove them`);
  return out;
}

const CHECKED = "images' alt text, contrast, sideways overflow, title on the first screen, viewport, language, focus style, reduced motion, transition: all, 100vw, colours, JSON-LD, invisible characters, console errors, failed loads";

/** The report the bot gets (and must pass on), from what the check found. */
export function formatReport(stat: StaticFinding[], rendered: PageCheckAnswer | null, why: string | null): string {
  const lines: string[] = [];
  if (rendered?.ok) {
    const errs = rendered.console ?? [];
    const uniq = [...new Map(errs.map((e) => [e.text, e])).values()];
    if (uniq.length) lines.push(`Console: ${uniq.length} error${uniq.length > 1 ? "s" : ""} — ${uniq.slice(0, 4).map((e) => `“${clip(e.text.replace(/\s+/g, " "), 160)}”${e.line ? ` (line ${e.line})` : ""}`).join("; ")}`);
    const failed = [...new Map((rendered.failed ?? []).map((f) => [f.url || f.error, f])).values()];
    if (failed.length) lines.push(`Failed loads: ${failed.length} — ${failed.slice(0, 4).map((f) => `${f.status ?? clip(f.error ?? "failed", 40)}${f.blocked ? ` (blocked: ${f.blocked})` : ""} ${clip((f.url || "").replace(/^https?:\/\/127\.0\.0\.1:\d+\/p\/check\//, ""), 80)}`.trim()).join("; ")}`);
    // The same finding at both widths is said once ("At 390 and 1280 px: …").
    const at = new Map<string, string[]>();
    for (const [w, found] of Object.entries(rendered.rules ?? {})) for (const f of found) at.set(f.text, [...(at.get(f.text) ?? []), w]);
    for (const [t, ws] of at) lines.push(`At ${ws.join(" and ")} px: ${t}`);
  }
  for (const f of stat) lines.push(f.text.charAt(0).toUpperCase() + f.text.slice(1));
  const head = rendered?.ok
    ? `Automatic check of the page (rendered at ${CHECK_SIZES.map(([w]) => `${w}`).join(" and ")} px; checked: ${CHECKED}):`
    : `Automatic check of the page (its code only — ${why ?? "it could not be rendered"}: no picture, no console, no measured layout; checked: ${CHECKED.replace(/, console errors, failed loads$/, "")}):`;
  const body = lines.length ? lines.slice(0, 20).map((l) => `- ${l}`).join("\n") + (lines.length > 20 ? `\n- … and ${lines.length - 20} more` : "") : "- Nothing found by these checks.";
  const tail = lines.length
    ? "Fix these (page_edit), then look again. Tell the user in one short sentence what the check found and what you fixed; do not call the page finished while an error or an overflow remains."
    : "Nothing found by these checks is not proof that the page is right: look at the picture (phone and computer) and say what you looked at, without calling it “clean”.";
  return `${head}\n${body}\n${tail}`;
}

/** Runs the check of a page just saved and returns what to add to the tool's answer (the report, and the picture when rendered). */
export async function pageCheckBlocks(c: { bot: BotRecord; user: UserRecord }, html: string, files: CheckFile[]): Promise<{ text: string; image: ImageBlock | null }> {
  const stat = staticFindings(html, files);
  let why: string | null = null, rendered: PageCheckAnswer | null = null;
  if (!browserAvailable()) why = "there is no browser on this server";
  else if ((c.bot.disabledTools ?? []).includes("computer")) why = "this bot's computer is switched off";
  else if (userDriving(c.bot.id)) why = "the user is using the bot's computer right now";
  else {
    try {
      const req: PageCheckRequest = { html, files, headers: pageHeaders(), sizes: CHECK_SIZES, rules: PAGE_RULES_JS };
      rendered = await Promise.race([screen.pageCheck(c.bot.id, c.user.id, req), new Promise<PageCheckAnswer>((_, no) => setTimeout(() => no(new Error("it took longer than 2 minutes")), 120_000).unref())]);
      if (!rendered.ok) { why = (rendered.error ?? "the browser did not render it").replace(/\.$/, ""); rendered = null; }
    } catch (err) { why = `the browser could not render it (${clip((err as Error).message, 160)})`; rendered = null; }
  }
  let image: ImageBlock | null = null;
  if (rendered?.shots?.length && rendered.shots.every((s) => s.data)) {
    try { image = { type: "image", mediaType: "image/jpeg", data: (await composeSheet(rendered.shots)).toString("base64") }; } catch { image = null; }
  }
  return { text: formatReport(stat, rendered, why), image };
}

/** A page tool's answer with the check added: a picture of the page at both widths and the short report. */
export async function withPageCheck<T extends { content: string | Array<TextBlock | ImageBlock> }>(r: T, c: { bot: BotRecord; user: UserRecord }, html: string, files: CheckFile[]): Promise<T> {
  const { text, image } = await pageCheckBlocks(c, html, files);
  const first = typeof r.content === "string" ? r.content : r.content.map((b) => (b.type === "text" ? b.text : "")).join("\n");
  return { ...r, content: image ? [{ type: "text", text: `${first}\n\n${text}` }, image] : `${first}\n\n${text}` };
}
