#!/usr/bin/env node
// Translate a language in chunks (docs/LANGUES.md): export the missing texts as small numbered files, translate each
// file, then merge them back into the language's dictionary files. Never edit a 6,000-line dictionary by hand.
//
//   node scripts/i18n/chunks.mjs export <lang> <group> <dir> [--chars 16000]
//       group: web (web app + its component tables), mobile (app + server errors), server
//       writes <dir>/<group>-001.src.tsv … (one text per line: "id<TAB>English") and <dir>/<group>.manifest.json
//   (translate: for each <group>-NNN.src.tsv write <group>-NNN.<lang>.tsv with the same ids: "id=translation" or
//    "id<TAB>translation", one per line)
//   node scripts/i18n/chunks.mjs merge <lang> <group> <dir>
//       reads every <group>-NNN.<lang>.tsv, keeps the texts already in the dictionary, rewrites the language file(s)
//   then: node scripts/i18n/check-languages.mjs <lang>
//
// In the .tsv files a line break inside a text is written \n and a tab \t (a backslash is \\). Identical English texts
// are exported once and their translation goes to every key that has them.
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { FILE_GROUPS, NO_PLURAL_LOCALES, SURFACES, locales, writeLanguageFile } from "./dicts.mjs";

const esc = (s) => s.replace(/\\/g, "\\\\").replace(/\t/g, "\\t").replace(/\r?\n/g, "\\n");
const unesc = (s) => s.replace(/\\(\\|t|n)/g, (_m, c) => (c === "n" ? "\n" : c === "t" ? "\t" : "\\"));

function usage(msg) {
  console.error(`${msg}\nUsage: node scripts/i18n/chunks.mjs export|merge <lang> <web|mobile|server> <dir> [--chars N]`);
  process.exit(1);
}

const [cmd, lang, group, dir] = process.argv.slice(2);
if (!["export", "merge"].includes(cmd)) usage("Unknown command.");
if (!locales().includes(lang) || lang === "fr" || lang === "en") usage(`Unknown language "${lang}" (French and English are written by hand).`);
if (!FILE_GROUPS[group]) usage(`Unknown group "${group}".`);
if (!dir) usage("Give a folder for the chunk files.");
const charsArg = process.argv.indexOf("--chars");
const CHARS = charsArg > 0 ? Number(process.argv[charsArg + 1]) || 16000 : 16000;

if (cmd === "export") {
  mkdirSync(dir, { recursive: true });
  const byText = new Map(); // English → [[surface, key]]
  for (const surface of FILE_GROUPS[group]) {
    const source = SURFACES[surface].source();
    const have = SURFACES[surface].dict(lang) ?? new Map();
    for (const [key, en] of source) {
      if (have.has(key)) continue;
      // A language without plural forms only needs the `_other` text of a pair.
      if (NO_PLURAL_LOCALES.includes(lang) && key.endsWith("_one") && source.has(`${key.slice(0, -4)}_other`)) continue;
      if (!byText.has(en)) byText.set(en, []);
      byText.get(en).push([surface, key]);
    }
  }
  const manifest = {};
  let chunk = 1, size = 0, lines = [], id = 0;
  const flush = () => {
    if (!lines.length) return;
    writeFileSync(join(dir, `${group}-${String(chunk).padStart(3, "0")}.src.tsv`), lines.join("\n") + "\n");
    chunk++; size = 0; lines = [];
  };
  for (const [en, keys] of byText) {
    id++;
    manifest[id] = keys;
    // The first key gives the translator its context (e.g. "settings.theme.dark").
    lines.push(`${id}\t${esc(keys[0][1]).slice(0, 80)}\t${esc(en)}`);
    size += en.length;
    if (size >= CHARS) flush();
  }
  flush();
  writeFileSync(join(dir, `${group}.manifest.json`), JSON.stringify(manifest));
  console.log(`${id} texts to translate in ${chunk - 1} file(s) in ${dir} (lines: id<TAB>context key<TAB>English).`);
} else {
  const manifest = JSON.parse(readFileSync(join(dir, `${group}.manifest.json`), "utf8"));
  const maps = {};
  for (const surface of FILE_GROUPS[group]) maps[surface] = new Map(SURFACES[surface].dict(lang) ?? []);
  const seen = new Set();
  const problems = [];
  const files = readdirSync(dir).filter((f) => f.startsWith(`${group}-`) && f.endsWith(`.${lang}.tsv`)).sort();
  for (const f of files) {
    for (const [n, line] of readFileSync(join(dir, f), "utf8").split("\n").entries()) {
      if (!line.trim()) continue;
      // "id<TAB>…" or "id=…" (easier to type).
      const eq = /^\d+=/.test(line) ? line.indexOf("=") : -1;
      const tab = eq > 0 ? eq : line.indexOf("\t");
      const id = line.slice(0, tab);
      // "id<TAB>translation", or "id<TAB>context key<TAB>translation" when the key column was kept.
      let text = line.slice(tab + 1);
      const keys = manifest[id];
      if (tab < 0 || !keys) { problems.push(`${f}:${n + 1}: unknown id "${id}"`); continue; }
      const ctx = esc(keys[0][1]).slice(0, 80);
      if (text.startsWith(`${ctx}\t`)) text = text.slice(ctx.length + 1);
      if (seen.has(id)) problems.push(`${f}:${n + 1}: id ${id} translated twice (the last one is kept)`);
      seen.add(id);
      for (const [surface, key] of keys) maps[surface].set(key, unesc(text));
    }
  }
  writeLanguageFile(group, lang, maps);
  const left = Object.keys(manifest).filter((id) => !seen.has(id)).length;
  console.log(`${seen.size} texts merged from ${files.length} file(s); ${left} still to translate.`);
  for (const p of problems) console.log(`  ${p}`);
  if (problems.length) process.exitCode = 1;
}
