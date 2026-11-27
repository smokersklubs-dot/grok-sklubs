import { inflateRawSync } from "node:zlib";

/**
 * L148 « Visionneuses » (backlog A-FAIRE): Excel (.xlsx), Word (.docx) and PowerPoint (.pptx) files shown in the app,
 * read here on the server as data, never run. These formats are ZIP archives of XML parts (ECMA-376, Office Open XML):
 * only the parts that hold text and cell values are read; macros (vbaProject.bin in .xlsm/.docm/.pptm), embedded objects,
 * external links and pictures are never opened (a file that carries macros is said so). Written for Sklubot from the
 * format specifications, no third-party code:
 *  - ZIP: PKWARE APPNOTE.TXT 6.3.10 — End of central directory record (4.3.16), central directory headers (4.3.12),
 *    local file headers (4.3.7); methods 0 (stored) and 8 (deflate, read with zlib's raw inflate). ZIP64 and encrypted
 *    entries are refused.
 *  - SpreadsheetML: xl/workbook.xml (sheets, r:id), xl/_rels/workbook.xml.rels, xl/sharedStrings.xml (si/t, r/t),
 *    xl/worksheets/sheetN.xml (row/c@r, c@t = s | inlineStr | b | str | e, v, is/t).
 *  - WordprocessingML: word/document.xml (w:p, w:pStyle, w:t, w:tab, w:br, w:tbl/w:tr/w:tc).
 *  - PresentationML: ppt/presentation.xml (p:sldId order), ppt/_rels/presentation.xml.rels, ppt/slides/slideN.xml (a:p, a:t).
 * Limits stop archive bombs: entries, size per part, total inflated bytes, and the compression ratio.
 */
export const OFFICE_LIMITS = { fileBytes: 30_000_000, entries: 5000, partBytes: 40_000_000, totalBytes: 120_000_000, ratio: 200, rows: 5000, cols: 200, sheets: 30, blocks: 4000, slides: 300 };

export class OfficeError extends Error {}

interface Entry { name: string; method: number; compressed: number; size: number; offset: number; flags: number }

/** The archive's table of contents (central directory). */
export function zipEntries(buf: Buffer): Entry[] {
  if (buf.length > OFFICE_LIMITS.fileBytes) throw new OfficeError("This file is too large to preview.");
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65_535); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new OfficeError("This file is not a valid Office document.");
  const count = buf.readUInt16LE(eocd + 10);
  const cdOffset = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOffset === 0xffffffff) throw new OfficeError("This file is too large to preview.");
  if (count > OFFICE_LIMITS.entries) throw new OfficeError("This file has too many parts to preview.");
  const out: Entry[] = [];
  let p = cdOffset;
  for (let n = 0; n < count; n++) {
    if (p + 46 > buf.length || buf.readUInt32LE(p) !== 0x02014b50) throw new OfficeError("This file is not a valid Office document.");
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const compressed = buf.readUInt32LE(p + 20), size = buf.readUInt32LE(p + 24);
    const nameLen = buf.readUInt16LE(p + 28), extra = buf.readUInt16LE(p + 30), comment = buf.readUInt16LE(p + 32);
    const offset = buf.readUInt32LE(p + 42);
    out.push({ name: buf.subarray(p + 46, p + 46 + nameLen).toString("utf8"), method, compressed, size, offset, flags });
    p += 46 + nameLen + extra + comment;
  }
  return out;
}

class Archive {
  private entries: Map<string, Entry>;
  private inflated = 0;
  constructor(private buf: Buffer) { this.entries = new Map(zipEntries(buf).map((e) => [e.name, e])); }
  has(name: string) { return this.entries.has(name); }
  names() { return [...this.entries.keys()]; }
  text(name: string): string | null {
    const e = this.entries.get(name);
    if (!e) return null;
    if (e.flags & 1) throw new OfficeError("This file is protected by a password.");
    if (e.size > OFFICE_LIMITS.partBytes || (e.compressed > 0 && e.size / e.compressed > OFFICE_LIMITS.ratio)) throw new OfficeError("This file is too large to preview.");
    this.inflated += e.size;
    if (this.inflated > OFFICE_LIMITS.totalBytes) throw new OfficeError("This file is too large to preview.");
    const h = e.offset;
    if (h + 30 > this.buf.length || this.buf.readUInt32LE(h) !== 0x04034b50) throw new OfficeError("This file is not a valid Office document.");
    const start = h + 30 + this.buf.readUInt16LE(h + 26) + this.buf.readUInt16LE(h + 28);
    const raw = this.buf.subarray(start, start + e.compressed);
    if (e.method === 0) return raw.toString("utf8");
    if (e.method !== 8) throw new OfficeError("This file uses a compression Sklubot cannot read.");
    return inflateRawSync(raw, { maxOutputLength: OFFICE_LIMITS.partBytes }).toString("utf8");
  }
}

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
export const unxml = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (_, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : ENT[e.toLowerCase()] ?? "");
const attr = (tag: string, name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(tag)?.[1];
/** The text of every <t>-like element in a fragment (w:t, a:t, t), in order. */
const texts = (xml: string, tag: string) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => unxml(m[1])).join("");
const rels = (xml: string | null) => new Map([...(xml ?? "").matchAll(/<Relationship\b[^>]*>/g)].map((m) => [attr(m[0], "Id") ?? "", attr(m[0], "Target") ?? ""]));
const resolve = (base: string, target: string) => (target.startsWith("/") ? target.slice(1) : base + target).replace(/[^/]+\/\.\.\//g, "");

export interface SheetPreview { name: string; rows: string[][]; totalRows: number; truncated: boolean }
export interface OfficePreview {
  kind: "xlsx" | "docx" | "pptx"; macros: boolean;
  sheets?: SheetPreview[];
  blocks?: { type: "heading" | "paragraph" | "table"; level?: number; text?: string; rows?: string[][] }[];
  slides?: { n: number; title: string; lines: string[] }[];
}

/** "B12" → column 1 (0-based). */
export function columnOf(ref: string): number {
  const letters = /^[A-Z]+/.exec(ref)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

function readXlsx(z: Archive): SheetPreview[] {
  const shared = [...(z.text("xl/sharedStrings.xml") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => texts(m[1], "t"));
  const wb = z.text("xl/workbook.xml") ?? "";
  const r = rels(z.text("xl/_rels/workbook.xml.rels"));
  const sheets = [...wb.matchAll(/<sheet\b[^>]*>/g)].slice(0, OFFICE_LIMITS.sheets).map((m) => ({ name: unxml(attr(m[0], "name") ?? "Sheet"), target: r.get(attr(m[0], "r:id") ?? "") ?? "" }));
  return sheets.map(({ name, target }) => {
    const xml = target ? z.text(resolve("xl/", target)) ?? "" : "";
    const rows: string[][] = [];
    let total = 0;
    for (const row of xml.matchAll(/<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g)) {
      total++;
      if (rows.length >= OFFICE_LIMITS.rows) continue;
      const index = Number(attr(` ${row[1] ?? ""}`, "r") ?? rows.length + 1) - 1;
      const line: string[] = [];
      for (const c of (row[2] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const col = columnOf(attr(` ${c[1]}`, "r") ?? "");
        if (col >= OFFICE_LIMITS.cols) continue;
        const type = attr(` ${c[1]}`, "t");
        const v = /<v>([\s\S]*?)<\/v>/.exec(c[2] ?? "")?.[1];
        let value = "";
        if (type === "s") value = shared[Number(v)] ?? "";
        else if (type === "inlineStr") value = texts(c[2] ?? "", "t");
        else if (type === "b") value = v === "1" ? "TRUE" : "FALSE";
        else value = v === undefined ? "" : unxml(v);
        while (line.length < col) line.push("");
        line[col] = value;
      }
      while (rows.length < Math.min(index, OFFICE_LIMITS.rows)) rows.push([]);
      if (rows.length < OFFICE_LIMITS.rows) rows.push(line);
    }
    return { name, rows, totalRows: total, truncated: total > rows.length };
  });
}

function readDocx(z: Archive): NonNullable<OfficePreview["blocks"]> {
  const xml = z.text("word/document.xml") ?? "";
  const body = /<w:body>([\s\S]*)<\/w:body>/.exec(xml)?.[1] ?? xml;
  const blocks: NonNullable<OfficePreview["blocks"]> = [];
  const para = (p: string) => texts(p.replace(/<w:tab\/>/g, "<w:t>\t</w:t>").replace(/<w:br\/>/g, "<w:t>\n</w:t>"), "w:t");
  for (const m of body.matchAll(/<w:tbl>([\s\S]*?)<\/w:tbl>|<w:p\b[^>]*?(?:\/>|>([\s\S]*?)<\/w:p>)/g)) {
    if (blocks.length >= OFFICE_LIMITS.blocks) break;
    if (m[1] !== undefined) {
      const rows = [...m[1].matchAll(/<w:tr\b[^>]*>([\s\S]*?)<\/w:tr>/g)].map((tr) => [...tr[1].matchAll(/<w:tc\b[^>]*>([\s\S]*?)<\/w:tc>/g)].map((tc) => [...tc[1].matchAll(/<w:p\b[^>]*>([\s\S]*?)<\/w:p>/g)].map((p) => para(p[1])).join("\n")));
      blocks.push({ type: "table", rows: rows.slice(0, OFFICE_LIMITS.rows) });
      continue;
    }
    const inner = m[2] ?? "";
    const text = para(inner);
    if (!text.trim()) continue;
    const style = /<w:pStyle w:val="([^"]+)"/.exec(inner)?.[1] ?? "";
    const level = /^(?:Heading|Titre)(\d)$/i.exec(style)?.[1] ?? (/^Title$/i.test(style) ? "1" : null);
    blocks.push(level ? { type: "heading", level: Math.min(4, Number(level)), text } : { type: "paragraph", text });
  }
  return blocks;
}

function readPptx(z: Archive): NonNullable<OfficePreview["slides"]> {
  const pres = z.text("ppt/presentation.xml") ?? "";
  const r = rels(z.text("ppt/_rels/presentation.xml.rels"));
  let targets = [...pres.matchAll(/<p:sldId\b[^>]*>/g)].map((m) => r.get(attr(m[0], "r:id") ?? "") ?? "").filter(Boolean).map((t) => resolve("ppt/", t));
  if (!targets.length) targets = z.names().filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/\d+/.exec(a.slice(16))?.[0]) - Number(/\d+/.exec(b.slice(16))?.[0]));
  return targets.slice(0, OFFICE_LIMITS.slides).map((t, i) => {
    const xml = z.text(t) ?? "";
    const lines = [...xml.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => texts(p[1], "a:t").trim()).filter(Boolean);
    const titleShape = /<p:sp>(?:(?!<\/p:sp>)[\s\S])*?<p:ph type="(?:title|ctrTitle)"[\s\S]*?<\/p:sp>/.exec(xml)?.[0];
    const title = titleShape ? [...titleShape.matchAll(/<a:p>([\s\S]*?)<\/a:p>/g)].map((p) => texts(p[1], "a:t")).join(" ").trim() : lines[0] ?? "";
    return { n: i + 1, title, lines: lines.filter((l, j) => !(j === 0 && l === title)) };
  });
}

/** The preview of an Office file from its bytes; `ext` from the file name (xlsx, xlsm, docx, docm, pptx, pptm). */
export function officePreview(buf: Buffer, ext: string): OfficePreview {
  const z = new Archive(buf);
  const e = ext.toLowerCase();
  const macros = z.names().some((n) => /vbaProject\.bin$/i.test(n));
  if (e === "xlsx" || e === "xlsm") return { kind: "xlsx", macros, sheets: readXlsx(z) };
  if (e === "docx" || e === "docm") return { kind: "docx", macros, blocks: readDocx(z) };
  if (e === "pptx" || e === "pptm") return { kind: "pptx", macros, slides: readPptx(z) };
  throw new OfficeError("Only Word, Excel and PowerPoint files (.docx, .xlsx, .pptx) can be previewed.");
}
export const OFFICE_EXT = /\.(xlsx|xlsm|docx|docm|pptx|pptm)$/i;
