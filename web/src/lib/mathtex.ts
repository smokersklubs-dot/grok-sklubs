/**
 * L147 — LaTeX in the chat. Math is taken out of a message before Markdown sees it (Markdown would eat its "_", "*" and
 * "\"), replaced by a marker, and put back after sanitising as a span that holds the TeX source as plain text. The span is
 * turned into MathML by KaTeX only in the browser, only when a message has math (web/src/lib/mathrender.ts, loaded on
 * demand). Delimiters: $$…$$ and \[…\] (a block), \(…\) and $…$ (in a line). A "$" amount is never math: the opening
 * "$" must touch the formula and the closing one may not be followed by a digit ("5 $ et 10 $", "$5 and $10" stay text).
 * Code blocks and `code` are left alone.
 */
export interface MathItem { tex: string; display: boolean }

const OPEN = "";
const CLOSE = "";
const MAX_ITEMS = 200;
const MAX_TEX = 2000;
const MATH = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\\\(([\s\S]+?)\\\)|(?<![\\$\w])\$(?![\s$])([^$\n]+?)(?<![\s\\])\$(?![\d$\w])/g;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;

function inText(part: string, items: MathItem[]): string {
  return part.replace(MATH, (all, a?: string, b?: string, c?: string, d?: string) => {
    const tex = (a ?? b ?? c ?? d ?? "").trim();
    if (!tex || tex.length > MAX_TEX || items.length >= MAX_ITEMS) return all;
    items.push({ tex, display: a !== undefined || b !== undefined });
    return `${OPEN}${items.length - 1}${CLOSE}`;
  });
}

/** Inline `code` spans are kept as they are; math is looked for between them. */
function outsideInlineCode(chunk: string, items: MathItem[]): string {
  let out = "";
  let at = 0;
  const code = /(`+)[\s\S]*?[^`]\1(?!`)|(`+)\2(?!`)/g;
  for (const m of chunk.matchAll(code)) {
    out += inText(chunk.slice(at, m.index), items) + m[0];
    at = (m.index ?? 0) + m[0].length;
  }
  return out + inText(chunk.slice(at), items);
}

/** The message with each formula replaced by a marker, and the formulas in order. */
export function extractMath(src: string): { text: string; items: MathItem[] } {
  const items: MathItem[] = [];
  if (!/[$\\]/.test(src)) return { text: src, items };
  const lines = src.split("\n");
  const out: string[] = [];
  let fence: string | null = null;
  let chunk: string[] = [];
  const flush = () => { if (chunk.length) out.push(outsideInlineCode(chunk.join("\n"), items)); chunk = []; };
  for (const line of lines) {
    const f = FENCE.exec(line);
    if (fence) {
      out.push(line);
      if (f && f[1][0] === fence[0] && f[1].length >= fence.length && line.trim() === f[1]) fence = null;
    } else if (f) {
      flush();
      fence = f[1];
      out.push(line);
    } else chunk.push(line);
  }
  flush();
  return { text: out.join("\n"), items };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");

/** Puts each formula back as `<span class="md-math" data-tex="…">TeX source</span>` (escaped: never markup). */
export function restoreMath(html: string, items: MathItem[]): string {
  if (!items.length) return html;
  return html.replace(new RegExp(`${OPEN}(\\d+)${CLOSE}`, "g"), (all, n: string) => {
    const item = items[Number(n)];
    if (!item) return "";
    const tex = escapeHtml(item.tex);
    return `<span class="md-math${item.display ? " is-display" : ""}" data-tex="${tex}"${item.display ? ' data-display="1"' : ""}>${item.display ? `$$${tex}$$` : `$${tex}$`}</span>`;
  });
}

/**
 * KaTeX's MathML, made ready for the sanitiser: the <annotation> (a copy of the TeX source) and the <semantics> wrapper
 * are taken out, as DOMPurify refuses both (it would then show the source twice).
 */
export function cleanMathMl(markup: string): string {
  return markup.replace(/<annotation\b[^>]*>[\s\S]*?<\/annotation>/g, "").replace(/<\/?semantics>/g, "");
}

/** The KaTeX options Sklubot uses: no \href / \url / \html… (trust off), bounded sizes and macro expansion, no throw. */
export const KATEX_OPTIONS = { output: "mathml", throwOnError: false, trust: false, strict: "ignore", maxSize: 20, maxExpand: 300 } as const;
