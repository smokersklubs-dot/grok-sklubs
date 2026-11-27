/**
 * « Équipe Sklubot (.md) » (docs/FORMAT-EQUIPE.md): the small, safe YAML subset of a team file's front matter.
 *
 * Read: block mappings (`key: value`), block sequences (`- item`, `- key: value`), double-quoted (JSON escapes),
 * single-quoted and plain scalars, literal (`|`, `|-`, `|+`) and folded (`>`, `>-`) blocks, flow lists of scalars
 * (`[a, "b"]`), `[]`, `{}` and `#` comments. Everything is text: no number, boolean or date is guessed (the schema
 * reader converts what it expects). Refused, with the line and a reason in plain words: anchors (`&`), aliases (`*`),
 * tags (`!`), merge keys (`<<`), complex keys (`?`), flow maps with content, tabs in indentation, a key given twice,
 * keys that would reach an object's prototype, more than MAX_DEPTH levels or MAX_NODES values. No dependency.
 *
 * Written: the same subset (yamlWrite), always in a form this reader gives back unchanged.
 */

export type YamlValue = string | YamlValue[] | YamlMap;
export interface YamlMap { [key: string]: YamlValue }

/** A front matter that cannot be read: `reason` is an English sentence (translated by the caller), `line` is 1-based. */
export class YamlError extends Error {
  constructor(public line: number, public reason: string, public vars: Record<string, string> = {}) {
    super(`line ${line}: ${reason.replace(/\{(\w+)\}/g, (_m, k) => vars[k] ?? "")}`);
    this.name = "YamlError";
  }
}

const MAX_DEPTH = 10, MAX_NODES = 20_000, MAX_LINES = 20_000;
const BAD_KEYS = new Set(["__proto__", "constructor", "prototype"]);
const KEY = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*'|[^\s"'#&*!|>%@`?{}[\],-][^:#]*?|-[^\s:#][^:#]*?)\s*:(?:[ \t]+(.*))?$/;

const isMap = (v: YamlValue | undefined): v is YamlMap => !!v && typeof v === "object" && !Array.isArray(v);
export const yamlIsMap = isMap;

interface Line { n: number; indent: number; text: string }

/** Reads a front matter block (the text between the two `---` lines). */
export function yamlRead(src: string, firstLine = 1): YamlMap {
  const raw = src.replace(/\r\n?/g, "\n").split("\n");
  if (raw.length > MAX_LINES) throw new YamlError(firstLine, "The header is too long.");
  let nodes = 0;
  const count = (n: number) => { if (++nodes > MAX_NODES) throw new YamlError(n, "The header has too many values."); };
  const lines: (Line | null)[] = raw.map((t, i) => {
    const n = firstLine + i;
    const lead = /^[ \t]*/.exec(t)![0];
    if (lead.includes("\t") && t.trim()) throw new YamlError(n, "Use spaces, not tabs, at the start of a line.");
    return { n, indent: lead.length, text: t };
  });
  let pos = 0;
  const blank = (l: Line) => !l.text.trim() || /^\s*#/.test(l.text);
  /** The next line that holds something (skips blank lines and comments). */
  const peek = (): Line | null => { while (pos < lines.length && blank(lines[pos]!)) pos++; return pos < lines.length ? lines[pos]! : null; };
  const isItem = (l: Line) => /^-(?:\s|$)/.test(l.text.slice(l.indent));

  function scalar(rawValue: string, n: number): YamlValue {
    const s = rawValue.trim();
    count(n);
    if (!s) return "";
    const c = s[0];
    if (c === "&") throw new YamlError(n, "Anchors (&) are not allowed: write the value itself.");
    if (c === "*") throw new YamlError(n, "Aliases (*) are not allowed: write the value itself.");
    if (c === "!") throw new YamlError(n, "Tags (!) are not allowed.");
    if (c === "@" || c === "`" || c === "%") throw new YamlError(n, "A value cannot start with this character: put it between quotes.");
    if (c === '"') {
      const m = /^("(?:[^"\\]|\\.)*")\s*(?:#.*)?$/.exec(s);
      if (!m) throw new YamlError(n, "A quoted text is not closed (or something follows it).");
      try { return String(JSON.parse(m[1])); } catch { throw new YamlError(n, "This quoted text uses an escape that is not allowed."); }
    }
    if (c === "'") {
      const m = /^'((?:[^']|'')*)'\s*(?:#.*)?$/.exec(s);
      if (!m) throw new YamlError(n, "A quoted text is not closed (or something follows it).");
      return m[1].replace(/''/g, "'");
    }
    if (c === "[") {
      const m = /^\[(.*)\]\s*(?:#.*)?$/.exec(s);
      if (!m) throw new YamlError(n, "A list in [ ] must open and close on the same line.");
      if (/[[{]/.test(m[1].replace(/"(?:[^"\\]|\\.)*"|'(?:[^']|'')*'/g, ""))) throw new YamlError(n, "Lists inside lists are not allowed: write one item per line.");
      return splitFlow(m[1]).map((p) => scalar(p, n) as string);
    }
    if (c === "{") {
      if (/^\{\s*\}\s*(?:#.*)?$/.test(s)) return Object.create(null) as YamlMap;
      throw new YamlError(n, "Use one key per line instead of { … }.");
    }
    if (s === "---" || s === "...") throw new YamlError(n, "Only one header is allowed.");
    // A plain scalar ends at a comment.
    return s.replace(/\s+#.*$/, "");
  }

  function block(header: string, parentIndent: number, n: number): string {
    const h = /^([|>])([+-]?)\s*(?:#.*)?$/.exec(header.trim());
    if (!h) throw new YamlError(n, "After | or >, put the text on the next lines (indentation numbers are not allowed).");
    count(n);
    const body: string[] = [];
    let ind = -1;
    while (pos < lines.length) {
      const l = lines[pos]!;
      if (!l.text.trim()) { body.push(""); pos++; continue; }
      if (ind < 0) { if (l.indent <= parentIndent) break; ind = l.indent; }
      if (l.indent < ind) break;
      body.push(l.text.slice(ind));
      pos++;
    }
    // Blank lines after the text belong to it only with "+" (keep); they are counted back otherwise.
    let end = body.length;
    while (end > 0 && body[end - 1] === "") end--;
    const kept = body.slice(0, end);
    const trailing = body.length - end;
    let text: string;
    if (h[1] === "|") text = kept.join("\n");
    else {
      // Folded: lines of a paragraph are joined with a space; a blank line is a line break.
      text = "";
      for (const cur of kept) {
        if (cur === "") { text += "\n"; continue; }
        if (text && !text.endsWith("\n")) text += " ";
        text += cur;
      }
    }
    if (!kept.length) return "";
    if (h[2] === "-") return text;
    if (h[2] === "+") return text + "\n".repeat(trailing + 1);
    return `${text}\n`;
  }

  function node(minIndent: number, depth: number): YamlValue | undefined {
    const l = peek();
    if (!l || l.indent < minIndent) return undefined;
    if (depth > MAX_DEPTH) throw new YamlError(l.n, "The header is nested too deeply.");
    return isItem(l) ? seq(l.indent, depth) : map(l.indent, depth);
  }

  /** The value after "key:" or "- ": inline, a block scalar, or the nested lines. */
  function value(rest: string | undefined, ownIndent: number, n: number, depth: number, sameIndentSeq: boolean): YamlValue {
    const r = (rest ?? "").trim();
    if (r.startsWith("|") || r.startsWith(">")) return block(r, ownIndent, n);
    if (r && !r.startsWith("#")) return scalar(r, n);
    const next = peek();
    if (next && next.indent > ownIndent) return node(ownIndent + 1, depth + 1)!;
    // "key:" followed by "- item" lines at the same indentation (a common way to write lists).
    if (sameIndentSeq && next && next.indent === ownIndent && isItem(next)) return seq(ownIndent, depth + 1);
    count(n);
    return "";
  }

  function map(indent: number, depth: number): YamlMap {
    const out: YamlMap = Object.create(null);
    for (;;) {
      const l = peek();
      if (!l || l.indent < indent) break;
      if (l.indent > indent) throw new YamlError(l.n, "This line is indented more than the one before it.");
      if (isItem(l)) break;
      const body = l.text.slice(indent);
      if (body.startsWith("?")) throw new YamlError(l.n, "Complex keys (?) are not allowed.");
      const m = KEY.exec(body);
      if (!m) throw new YamlError(l.n, /:/.test(body) ? "This line is not “key: value”." : "This line is not “key: value” (a “:” is missing).");
      let key = m[1].trim();
      if (key.startsWith('"')) { try { key = String(JSON.parse(key)); } catch { throw new YamlError(l.n, "This quoted key uses an escape that is not allowed."); } }
      else if (key.startsWith("'")) key = key.slice(1, -1).replace(/''/g, "'");
      if (key === "<<") throw new YamlError(l.n, "Merge keys (<<) are not allowed.");
      if (BAD_KEYS.has(key)) throw new YamlError(l.n, "This key name is not allowed.");
      if (Object.prototype.hasOwnProperty.call(out, key)) throw new YamlError(l.n, "The key “{key}” is given twice.", { key: key.slice(0, 40) });
      pos++;
      out[key] = value(m[2], indent, l.n, depth, true);
    }
    return out;
  }

  function seq(indent: number, depth: number): YamlValue[] {
    const out: YamlValue[] = [];
    for (;;) {
      const l = peek();
      if (!l || l.indent !== indent || !isItem(l)) {
        if (l && l.indent > indent) throw new YamlError(l.n, "This line is indented more than the one before it.");
        break;
      }
      const after = l.text.slice(indent + 1);
      const gap = /^\s*/.exec(after)![0].length;
      const content = after.slice(gap);
      const quotedScalar = /^("(?:[^"\\]|\\.)*"|'(?:[^']|'')*')\s*(?:#.*)?$/.test(content);
      const mapItem = !!content && !/^[#|>[{]/.test(content) && !quotedScalar && KEY.test(content);
      if (mapItem) {
        // "- key: value": a map whose first key sits on the item's line. The line is read again as that map's first line.
        const at = indent + 1 + gap;
        lines[pos] = { n: l.n, indent: at, text: " ".repeat(at) + content };
        if (depth + 1 > MAX_DEPTH) throw new YamlError(l.n, "The header is nested too deeply.");
        out.push(map(at, depth + 1));
        continue;
      }
      pos++;
      out.push(value(content, indent, l.n, depth, false));
    }
    return out;
  }

  const first = peek();
  if (!first) return Object.create(null) as YamlMap;
  if (first.indent !== 0) throw new YamlError(first.n, "The header's first key must start at the beginning of the line.");
  if (isItem(first)) throw new YamlError(first.n, "The header must be a list of “key: value” lines, not a list.");
  const root = map(0, 0);
  const rest = peek();
  if (rest) throw new YamlError(rest.n, "This line is not “key: value”.");
  return root;
}

function splitFlow(s: string): string[] {
  const parts: string[] = [];
  let cur = "", quote = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (quote) {
      cur += ch;
      if (quote === '"' && ch === "\\") { cur += s[++i] ?? ""; continue; }
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === '"' || ch === "'") { quote = ch; cur += ch; continue; }
    if (ch === ",") { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) parts.push(cur);
  return parts.map((p) => p.trim()).filter(Boolean);
}

// ── Writing ──────────────────────────────────────────────────────────────────────────────────────────────────────

const PLAIN = /^[A-Za-z0-9][A-Za-z0-9_./:+-]*$/;
/** A single-line text: plain when it is a simple word (an id, a cron field-less token), else JSON-quoted. */
function inline(s: string): string {
  return PLAIN.test(s) && !/:$/.test(s) && !/^(true|false|null|yes|no|on|off|~)$/i.test(s) ? s : JSON.stringify(s);
}
/** A multi-line text as a literal block, when the reader gives it back unchanged; else one quoted line. */
function multiline(s: string, indent: string): string {
  const lines = s.split("\n");
  const safe = !s.endsWith("\n") && !/^\s/.test(lines.find((l) => l.trim()) ?? "") && lines.every((l) => l === "" || l.trim() !== "") && !/[\u0000-\u0008\u000B-\u001F\u007F]/.test(s) && !lines[0].startsWith(" ");
  if (!safe) return ` ${JSON.stringify(s)}`;
  return ` |-\n${lines.map((l) => (l ? `${indent}${l}` : "")).join("\n")}`;
}

/** A map as front matter lines (keys in the order given; undefined, empty lists and empty texts are left out). */
export function yamlWrite(value: Record<string, unknown>, indent = 0): string {
  const pad = " ".repeat(indent);
  const out: string[] = [];
  for (const [k, v] of Object.entries(value)) {
    if (v === undefined || v === null || v === "" || (Array.isArray(v) && !v.length)) continue;
    if (typeof v === "string") { out.push(`${pad}${k}:${v.includes("\n") ? multiline(v, `${pad}  `) : ` ${inline(v)}`}`); continue; }
    if (typeof v === "number" || typeof v === "boolean") { out.push(`${pad}${k}: ${String(v)}`); continue; }
    if (Array.isArray(v)) {
      if (v.every((x) => typeof x === "string" && !x.includes("\n")) && (v as string[]).join(", ").length < 80) { out.push(`${pad}${k}: [${(v as string[]).map((x) => JSON.stringify(x)).join(", ")}]`); continue; }
      out.push(`${pad}${k}:`);
      for (const item of v) {
        if (typeof item === "string") { out.push(`${pad}  -${item.includes("\n") ? multiline(item, `${pad}    `) : ` ${inline(item)}`}`); continue; }
        const inner = yamlWrite(item as Record<string, unknown>, indent + 4);
        if (!inner) { out.push(`${pad}  - {}`); continue; }
        out.push(`${pad}  - ${inner.slice(indent + 4)}`);
      }
      continue;
    }
    if (typeof v === "object") {
      const inner = yamlWrite(v as Record<string, unknown>, indent + 2);
      if (inner) out.push(`${pad}${k}:`, inner);
    }
  }
  return out.join("\n");
}
