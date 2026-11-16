/**
 * A small Markdown reader for bot replies: headings, paragraphs, bullet and numbered lists, task boxes, quotes,
 * fenced code, horizontal rules, simple tables; inline bold, italic, strike, code and links. It returns plain data
 * that the Markdown component draws with native Text — no HTML, no WebView, nothing executed.
 * Line breaks inside a paragraph are kept (like the web app, marked's `breaks: true`).
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "b"; c: Inline[] }
  | { t: "i"; c: Inline[] }
  | { t: "s"; c: Inline[] }
  | { t: "code"; v: string }
  | { t: "link"; href: string; c: Inline[] };

export type Block =
  | { t: "p"; c: Inline[] }
  | { t: "h"; level: number; c: Inline[] }
  | { t: "list"; ordered: boolean; start: number; items: { c: Inline[]; checked: boolean | null; sub: Block[] }[] }
  | { t: "quote"; c: Block[] }
  | { t: "code"; lang: string; v: string }
  | { t: "hr" }
  | { t: "table"; head: Inline[][]; rows: Inline[][][] };

const SAFE_LINK = /^(https?:\/\/|mailto:)/i;

export function parseInline(src: string): Inline[] {
  const out: Inline[] = [];
  let buf = "";
  const flush = () => { if (buf) { out.push({ t: "text", v: buf }); buf = ""; } };
  let i = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === "\\" && i + 1 < src.length && /[\\`*_{}[\]()#+\-.!~|>]/.test(src[i + 1])) { buf += src[i + 1]; i += 2; continue; }
    if (ch === "`") {
      const end = src.indexOf("`", i + 1);
      if (end > i) { flush(); out.push({ t: "code", v: src.slice(i + 1, end) }); i = end + 1; continue; }
    }
    if (ch === "[") {
      const m = /^\[([^\]]*)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/.exec(src.slice(i));
      if (m) {
        flush();
        const label = parseInline(m[1] || m[2]);
        if (SAFE_LINK.test(m[2])) out.push({ t: "link", href: m[2], c: label });
        else out.push(...label);
        i += m[0].length;
        continue;
      }
    }
    if (ch === "h" && /^https?:\/\//.test(src.slice(i)) && (i === 0 || /[\s(]/.test(src[i - 1]))) {
      const m = /^https?:\/\/[^\s<>()]+[^\s<>().,;:!?'"]/.exec(src.slice(i));
      if (m) { flush(); out.push({ t: "link", href: m[0], c: [{ t: "text", v: m[0] }] }); i += m[0].length; continue; }
    }
    const two = src.slice(i, i + 2);
    if (two === "**" || two === "__" || two === "~~") {
      const end = src.indexOf(two, i + 2);
      if (end > i + 2) {
        flush();
        out.push({ t: two === "~~" ? "s" : "b", c: parseInline(src.slice(i + 2, end)) });
        i = end + 2;
        continue;
      }
    }
    if ((ch === "*" || ch === "_") && src[i + 1] !== ch && src[i + 1] !== " " && src[i + 1] !== undefined) {
      // _ only at a word boundary, so snake_case words stay as they are.
      if (ch === "*" || i === 0 || /[\s(]/.test(src[i - 1])) {
        let end = src.indexOf(ch, i + 1);
        while (end > 0 && (src[end - 1] === " " || (ch === "_" && /\w/.test(src[end + 1] ?? "")))) end = src.indexOf(ch, end + 1);
        if (end > i + 1) {
          flush();
          out.push({ t: "i", c: parseInline(src.slice(i + 1, end)) });
          i = end + 1;
          continue;
        }
      }
    }
    buf += ch;
    i++;
  }
  flush();
  return out;
}

const LIST_RE = /^(\s*)([-*+]|\d{1,9}[.)])\s+(.*)$/;
const splitRow = (line: string) => line.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());

export function parseMarkdown(src: string): Block[] {
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  return parseLines(lines);
}

function parseLines(lines: string[]): Block[] {
  const blocks: Block[] = [];
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) { blocks.push({ t: "p", c: parseInline(para.join("\n")) }); para = []; }
  };
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const fence = /^\s*(```+|~~~+)\s*([\w+-]*)/.exec(line);
    if (fence) {
      flushPara();
      const code: string[] = [];
      let j = i + 1;
      while (j < lines.length && !lines[j].trim().startsWith(fence[1])) code.push(lines[j++]);
      blocks.push({ t: "code", lang: fence[2] ?? "", v: code.join("\n") });
      i = j;
      continue;
    }
    if (!line.trim()) { flushPara(); continue; }
    const h = /^(#{1,6})\s+(.*?)\s*#*\s*$/.exec(line);
    if (h) { flushPara(); blocks.push({ t: "h", level: h[1].length, c: parseInline(h[2]) }); continue; }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flushPara(); blocks.push({ t: "hr" }); continue; }
    if (/^\s*>/.test(line)) {
      flushPara();
      const inner: string[] = [];
      while (i < lines.length && /^\s*>/.test(lines[i])) inner.push(lines[i++].replace(/^\s*>\s?/, ""));
      i--;
      blocks.push({ t: "quote", c: parseLines(inner) });
      continue;
    }
    if (line.includes("|") && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/.test(lines[i + 1])) {
      flushPara();
      const head = splitRow(line).map(parseInline);
      const rows: Inline[][][] = [];
      let j = i + 2;
      while (j < lines.length && lines[j].includes("|") && lines[j].trim()) rows.push(splitRow(lines[j++]).map(parseInline));
      blocks.push({ t: "table", head, rows });
      i = j - 1;
      continue;
    }
    const li = LIST_RE.exec(line);
    if (li && !(para.length && !/^\s*$/.test(lines[i - 1] ?? "") && li[1].length > 0)) {
      flushPara();
      const ordered = /\d/.test(li[2]);
      const baseIndent = li[1].length;
      const items: { c: Inline[]; checked: boolean | null; sub: Block[] }[] = [];
      let j = i;
      while (j < lines.length) {
        const m = LIST_RE.exec(lines[j]);
        if (m && m[1].length === baseIndent && /\d/.test(m[2]) === ordered) {
          let text = m[3];
          let checked: boolean | null = null;
          const box = /^\[([ xX])\]\s+(.*)$/.exec(text);
          if (box) { checked = box[1] !== " "; text = box[2]; }
          const sub: string[] = [];
          let k = j + 1;
          while (k < lines.length && lines[k].trim() && ((LIST_RE.exec(lines[k])?.[1].length ?? -1) > baseIndent || (!LIST_RE.test(lines[k]) && /^\s{2,}/.test(lines[k])))) sub.push(lines[k++].slice(Math.min(baseIndent + 2, lines[k - 1].search(/\S/))));
          items.push({ c: parseInline(text), checked, sub: sub.length ? parseLines(sub) : [] });
          j = k;
          continue;
        }
        if (!lines[j].trim() && j + 1 < lines.length && LIST_RE.exec(lines[j + 1])?.[1].length === baseIndent) { j++; continue; }
        break;
      }
      blocks.push({ t: "list", ordered, start: ordered ? parseInt(li[2], 10) || 1 : 1, items });
      i = j - 1;
      continue;
    }
    para.push(line);
  }
  flushPara();
  return blocks;
}

/** Plain text of inline nodes (for accessibility labels and copying). */
export const plainInline = (c: Inline[]): string => c.map((n) => ("v" in n ? n.v : plainInline(n.c))).join("");
