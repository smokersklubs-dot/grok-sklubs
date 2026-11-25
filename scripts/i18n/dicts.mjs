// Reads the translation dictionaries of the three surfaces without running any app code (TypeScript AST only),
// so the checks never import server modules (and never open a database). See docs/LANGUES.md.
import { readdirSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");

/** Every language Sklubot knows, read from the single source of truth (server/src/clientshared/locales.ts). */
export function locales() {
  const src = readFileSync(join(ROOT, "server/src/clientshared/locales.ts"), "utf8");
  const m = /export const LOCALES = \[([^\]]*)\]/.exec(src);
  if (!m) throw new Error("LOCALES not found in server/src/clientshared/locales.ts");
  return [...m[1].matchAll(/"([a-z]{2})"/g)].map((x) => x[1]);
}

/** Splits TypeScript source into the few tokens a dictionary needs: strings, identifiers, punctuation (comments dropped). */
function tokenize(src) {
  const toks = [];
  let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (c === "/" && src[i + 1] === "/") { while (i < src.length && src[i] !== "\n") i++; continue; }
    if (c === "/" && src[i + 1] === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 2; continue; }
    const prev = toks[toks.length - 1];
    if (c === "/" && !(prev && (prev.t === "id" && !/^(return|typeof|case|in|of)$/.test(prev.v) || prev.t === "num" || prev.t === "str" || prev.t === "tpl" || (prev.t === "p" && (prev.v === ")" || prev.v === "]"))))) {
      // A regular expression literal: skip it (its quotes are not strings).
      let j = i + 1;
      let cls = false;
      while (j < src.length && src[j] !== "\n" && (cls || src[j] !== "/")) {
        if (src[j] === "\\") j++;
        else if (src[j] === "[") cls = true;
        else if (src[j] === "]") cls = false;
        j++;
      }
      j++;
      while (j < src.length && /[a-z]/.test(src[j])) j++;
      toks.push({ t: "re", pos: i });
      i = j;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      let plain = true;
      while (j < src.length && src[j] !== c) {
        if (src[j] === "\\") j++;
        else if (c === "`" && src[j] === "$" && src[j + 1] === "{") plain = false;
        j++;
      }
      const raw = src.slice(i, j + 1);
      // A pure string literal (no `${}`): evaluating it only decodes its escapes.
      let v = null;
      if (plain) { try { v = Function(`"use strict"; return ${raw};`)(); } catch { v = null; } }
      toks.push(v !== null ? { t: "str", v, pos: i } : { t: "tpl", pos: i });
      i = j + 1;
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < src.length && /[\w$]/.test(src[j])) j++; toks.push({ t: "id", v: src.slice(i, j), pos: i }); i = j; continue; }
    if (/[0-9]/.test(c)) { let j = i; while (j < src.length && /[\w.]/.test(src[j])) j++; toks.push({ t: "num", v: src.slice(i, j), pos: i }); i = j; continue; }
    toks.push({ t: "p", v: c, pos: i });
    i++;
  }
  return toks;
}

/** Reads `{ key: "text" + "more", … }` starting at the `{` token index; returns the index after the closing `}`. */
function readObject(toks, at, out, skipped) {
  let i = at + 1;
  while (i < toks.length && !(toks[i].t === "p" && toks[i].v === "}")) {
    const start = i;
    const k = toks[i];
    let ok = (k.t === "str" || k.t === "id" || k.t === "num") && toks[i + 1]?.t === "p" && toks[i + 1].v === ":";
    let value = "";
    if (ok) {
      i += 2;
      if (toks[i]?.t === "p" && toks[i].v === "{") {
        // A nested table (`{ fr: { … }, en: { … } }`): read it as its own Map.
        const inner = new Map();
        i = readObject(toks, i, inner, skipped);
        out.set(String(k.v), inner);
        if (toks[i]?.t === "p" && toks[i].v === ",") i++;
        continue;
      }
      if (toks[i]?.t !== "str") ok = false;
      else {
        value = toks[i].v; i++;
        while (toks[i]?.t === "p" && toks[i].v === "+" && toks[i + 1]?.t === "str") { value += toks[i + 1].v; i += 2; }
        if (!(toks[i]?.t === "p" && (toks[i].v === "," || toks[i].v === "}"))) ok = false;
      }
    }
    if (ok) out.set(String(k.v), value);
    else {
      // Not a plain text entry (spread, function, nested object…): skip it.
      skipped.push(start);
      let depth = 0;
      i = start;
      while (i < toks.length) {
        const x = toks[i];
        if (x.t === "p" && "([{".includes(x.v)) depth++;
        else if (x.t === "p" && ")]}".includes(x.v)) { if (depth === 0) break; depth--; }
        else if (x.t === "p" && x.v === "," && depth === 0) break;
        i++;
      }
    }
    if (toks[i]?.t === "p" && toks[i].v === ",") i++;
  }
  return i + 1;
}

/**
 * The string pairs of the object literals assigned to variables whose name matches `nameRe` in `file`
 * (`const NAME = {`, `const NAME: Type = {`). Returns a Map key → text; `skipped` counts entries that are not plain strings.
 */
export function readDict(file, nameRe = /.*/) {
  const toks = tokenize(readFileSync(join(ROOT, file), "utf8"));
  const out = new Map();
  const skipped = [];
  for (let i = 0; i < toks.length; i++) {
    if (!(toks[i].t === "id" && (toks[i].v === "const" || toks[i].v === "let") && toks[i + 1]?.t === "id" && nameRe.test(toks[i + 1].v))) continue;
    // Find the `=` then expect `{` (type annotations such as `: Record<string, string>` or `: Dict` are skipped).
    let j = i + 2;
    let depth = 0;
    while (j < toks.length && !(depth === 0 && toks[j].t === "p" && toks[j].v === "=")) {
      if (toks[j].t === "p" && "<([{".includes(toks[j].v)) depth++;
      else if (toks[j].t === "p" && ">)]}".includes(toks[j].v)) depth--;
      if (toks[j].t === "p" && toks[j].v === ";") break;
      j++;
    }
    if (toks[j]?.v === "=" && toks[j + 1]?.t === "p" && toks[j + 1].v === "{") i = readObject(toks, j + 1, out, skipped) - 1;
  }
  return { map: out, skipped };
}

function walk(dir) {
  const out = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name === "node_modules" || e.name === "dist") continue;
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...walk(p));
    else if (/\.ts$/.test(e.name) && !/\.test\.ts$/.test(e.name)) out.push(p);
  }
  return out;
}

/** Server texts are keyed by their English wording; the French maps (`FR`, `…_FR`) list every translatable text. */
export const SERVER_FR_NAME = /^(FR|[A-Z0-9]+_FR)$/;
export const SERVER_LANG_DIR = "server/src/lang";

/** The server's translatable texts: Map english → french, gathered from every French map under server/src. */
export function serverSource() {
  const all = new Map();
  const files = [];
  for (const f of walk(join(ROOT, "server/src"))) {
    const rel = relative(ROOT, f).split("\\").join("/");
    if (rel.startsWith(SERVER_LANG_DIR + "/")) continue;
    const src = readFileSync(f, "utf8");
    if (!/\b(FR|[A-Z0-9]+_FR)\b\s*(:\s*Record<string,\s*string>)?\s*=\s*\{/.test(src)) continue;
    const { map } = readDict(rel, SERVER_FR_NAME);
    if (!map.size) continue;
    files.push(rel);
    for (const [k, v] of map) if (typeof v === "string") all.set(k, v);
  }
  return { map: all, files };
}

const cap = (l) => l[0].toUpperCase() + l.slice(1);
const fileExists = (f) => existsSync(join(ROOT, f));
const flatMap = (m) => new Map([...m].filter(([, v]) => typeof v === "string"));

/** web/src/i18n/sides.ts: component-local tables, name → file. */
export function sideTables() {
  return readDict("web/src/i18n/sides.ts", /^SIDE_TABLES$/).map;
}

/** A component-local table `{ fr: {…}, en: {…} }` → Map "name.key" → text, for one language (fr or en). */
function sideSource(lang) {
  const out = new Map();
  for (const [name, file] of sideTables()) {
    const { map } = readDict(file, /^(TEXT|TX)$/);
    const table = map.get(lang);
    if (!(table instanceof Map)) throw new Error(`${file}: no ${lang} table found (web/src/i18n/sides.ts)`);
    for (const [k, v] of table) if (typeof v === "string") out.set(`${name}.${k}`, v);
  }
  return out;
}

/** The mobile app's French for the server's English account errors (mobile/src/i18n/index.ts SERVER_FR). */
const mobileServerFr = () => readDict("mobile/src/i18n/index.ts", /^SERVER_FR$/).map;

/**
 * Every place texts live, per surface: `source()` is the reference key set (key → English), `dict(lang)` a language's
 * texts (null when the language has no file yet), `file(lang)` / `varName(lang)` where they are written.
 */
export const SURFACES = {
  web: {
    label: "web app (web/src/i18n)",
    source: () => flatMap(readDict("web/src/i18n/en.ts", /^en$/).map),
    file: (l) => `web/src/i18n/${l}.ts`,
    varName: (l) => l,
    dict(l) {
      if (l === "en") return this.source();
      return fileExists(this.file(l)) ? flatMap(readDict(this.file(l), new RegExp(`^${l}$`)).map) : null;
    },
  },
  webSide: {
    label: "web component tables (web/src/i18n/sides.ts)",
    source: () => sideSource("en"),
    file: (l) => `web/src/i18n/${l}.ts`,
    varName: () => "side",
    dict(l) {
      if (l === "en" || l === "fr") return sideSource(l);
      if (!fileExists(this.file(l))) return null;
      const out = new Map();
      for (const [name, table] of readDict(this.file(l), /^side$/).map) if (table instanceof Map) for (const [k, v] of table) out.set(`${name}.${k}`, v);
      return out;
    },
  },
  mobile: {
    label: "mobile app (mobile/src/i18n)",
    source: () => flatMap(readDict("mobile/src/i18n/en.ts", /^en$/).map),
    file: (l) => `mobile/src/i18n/${l}.ts`,
    varName: (l) => l,
    dict(l) {
      if (l === "en") return this.source();
      return fileExists(this.file(l)) ? flatMap(readDict(this.file(l), new RegExp(`^${l}$`)).map) : null;
    },
  },
  mobileServer: {
    label: "mobile app, server account errors (mobile/src/i18n/index.ts SERVER_FR)",
    source: () => new Map([...mobileServerFr().keys()].map((k) => [k, k])),
    file: (l) => `mobile/src/i18n/${l}.ts`,
    varName: (l) => `server${cap(l)}`,
    dict(l) {
      if (l === "en") return this.source();
      if (l === "fr") return mobileServerFr();
      return fileExists(this.file(l)) ? flatMap(readDict(this.file(l), new RegExp(`^server${cap(l)}$`)).map) : null;
    },
  },
  server: {
    label: "server texts (server/src/lang, French maps next to the code)",
    source: () => new Map([...serverSource().map.keys()].map((k) => [k, k])),
    file: (l) => `${SERVER_LANG_DIR}/${l}.ts`,
    varName: (l) => l,
    dict(l) {
      if (l === "en") return this.source();
      if (l === "fr") return serverSource().map;
      return fileExists(this.file(l)) ? flatMap(readDict(this.file(l), new RegExp(`^${l}$`)).map) : null;
    },
  },
};

/** Which surfaces share one language file (written together). */
export const FILE_GROUPS = { web: ["web", "webSide"], mobile: ["mobile", "mobileServer"], server: ["server"] };

const q = (s) => JSON.stringify(s);
const entries = (map, indent = "  ") => [...map].map(([k, v]) => `${indent}${q(k)}: ${q(v)},`).join("\n");

/**
 * Writes a language's file for one group from Maps (key → text), keys in the source order. Used by chunks.mjs merge.
 * `maps` is { surfaceName: Map }.
 */
export function writeLanguageFile(group, lang, maps) {
  const order = (surface, m) => {
    const src = [...SURFACES[surface].source().keys()];
    return new Map(src.filter((k) => m.has(k)).map((k) => [k, m.get(k)]));
  };
  let text;
  if (group === "web") {
    const main = order("web", maps.web ?? new Map());
    const side = order("webSide", maps.webSide ?? new Map());
    const byTable = new Map();
    for (const [k, v] of side) {
      const i = k.indexOf(".");
      const name = k.slice(0, i);
      if (!byTable.has(name)) byTable.set(name, new Map());
      byTable.get(name).set(k.slice(i + 1), v);
    }
    const sideText = [...byTable].map(([name, m]) => `  ${name}: {\n${entries(m, "    ")}\n  },`).join("\n");
    text = `import type { PartialDict, SideTexts } from "./index";\n\n/** ${HEADERS[lang] ?? `Texts in ${lang}`} Loaded on demand; missing texts show in English. Written by scripts/i18n/chunks.mjs (docs/LANGUES.md). */\nexport const ${lang}: PartialDict = {\n${entries(main)}\n};\n\n/** The component-local tables (web/src/i18n/sides.ts). */\nexport const side: SideTexts = {\n${sideText}\n};\n`;
  } else if (group === "mobile") {
    const main = order("mobile", maps.mobile ?? new Map());
    const srv = order("mobileServer", maps.mobileServer ?? new Map());
    text = `import type { Key } from "./fr";\n\n/** ${HEADERS[lang] ?? `Texts in ${lang}`} Missing texts show in English. Written by scripts/i18n/chunks.mjs (docs/LANGUES.md). */\nexport const ${lang}: Partial<Record<Key, string>> = {\n${entries(main)}\n};\n\n/** The server's English account errors (src/i18n/index.ts, SERVER_FR). */\nexport const server${cap(lang)}: Record<string, string> = {\n${entries(srv)}\n};\n`;
  } else {
    const main = order("server", maps.server ?? new Map());
    text = `/** ${HEADERS[lang] ?? `Server texts in ${lang}`} Keyed by the English text (server/src/lang/index.ts). Written by scripts/i18n/chunks.mjs (docs/LANGUES.md). */\nexport const ${lang}: Record<string, string> = {\n${entries(main)}\n};\n`;
  }
  writeFileSync(join(ROOT, FILE_GROUPS[group] && SURFACES[FILE_GROUPS[group][0]].file(lang)), text);
}

/** One line in each file's header, in the language itself. */
const HEADERS = {
  es: "Textos en español (tuteo, como el francés).",
  de: "Texte auf Deutsch (Du-Form, wie das französische Duzen).",
  it: "Testi in italiano (dare del tu, come in francese).",
  pt: "Textos em português do Brasil (você informal, como o tu do francês).",
  zh: "简体中文文本（语气亲切，与法语的 tu 对应）。",
};

/** Languages without plural forms (server/src/clientshared/locales.ts NO_PLURAL). */
export const NO_PLURAL_LOCALES = (() => {
  const m = /export const NO_PLURAL[^=]*=\s*\[([^\]]*)\]/.exec(readFileSync(join(ROOT, "server/src/clientshared/locales.ts"), "utf8"));
  return m ? [...m[1].matchAll(/"([a-z]{2})"/g)].map((x) => x[1]) : [];
})();
