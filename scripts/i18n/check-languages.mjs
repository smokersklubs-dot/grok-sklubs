#!/usr/bin/env node
// Language check: every language of server/src/clientshared/locales.ts, on every surface (web, web component tables,
// mobile, mobile server errors, server). See docs/LANGUES.md.
//
//   node scripts/i18n/check-languages.mjs          # report: coverage % per language and surface, problems
//   node scripts/i18n/check-languages.mjs es       # one language, with the first missing keys
//   npm run check:i18n                             # the test (fails on a problem or a coverage under its floor)
//
// A problem (always fails): a key the reference (English) does not have, an empty text, a `{name}` placeholder added
// or lost, a link host changed, a different number of backticks (Markdown code), a broken `_one`/`_other` pair.
// A missing text is NOT a problem: it shows in English (the documented fallback). Only the coverage floor below fails.
import { pathToFileURL } from "node:url";
import { NO_PLURAL_LOCALES, SURFACES, locales } from "./dicts.mjs";

/**
 * Lowest coverage (%) accepted per language, all surfaces together. French and English are complete by type.
 * A new language starts at 0 and raises its floor as it is translated (docs/LANGUES.md, step 5).
 */
export const COVERAGE_FLOOR = { fr: 100, en: 100, es: 95 };

const placeholders = (s) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
// Link hosts only: example paths may be translated (github.com/owner/repository → github.com/proprietaire/depot).
const links = (s) => [...new Set([...s.matchAll(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)*\.[a-z]{2,})/gi)].map((m) => m[1].toLowerCase()))].sort().join(" ");
const ticks = (s) => (s.match(/`/g) ?? []).length;

/** Keys a language must have on a surface: all of them, minus the `_one` forms for languages without plural forms. */
export function requiredKeys(source, lang) {
  const keys = [...source.keys()];
  if (!NO_PLURAL_LOCALES.includes(lang)) return keys;
  return keys.filter((k) => !(k.endsWith("_one") && source.has(`${k.slice(0, -4)}_other`)));
}

/** The rules on Maps (key → text): { done, missing[], problems[], sameAsEnglish } for `dict` against `source`. */
export function compare(source, dict, lang) {
  const required = requiredKeys(source, lang);
  const res = { total: required.length, done: 0, missing: [], problems: [], sameAsEnglish: 0 };
  for (const [k, v] of dict) {
    if (!source.has(k)) { res.problems.push(`${k}: not a key of the reference (English) — remove it or rename it`); continue; }
    const en = source.get(k);
    if (typeof v !== "string" || !v.trim()) { res.problems.push(`${k}: empty text`); continue; }
    if (placeholders(v) !== placeholders(en)) res.problems.push(`${k}: placeholders {${placeholders(v)}} instead of {${placeholders(en)}}`);
    if (links(v) !== links(en)) res.problems.push(`${k}: links changed (${links(v) || "none"} instead of ${links(en) || "none"})`);
    if (ticks(v) !== ticks(en)) res.problems.push(`${k}: ${ticks(v)} backticks instead of ${ticks(en)} (Markdown code)`);
    if (lang !== "en" && v === en) res.sameAsEnglish++;
  }
  // Plural pairs: a language with plural forms gives both forms or neither; one without gives `_other`.
  for (const k of source.keys()) {
    if (!k.endsWith("_one")) continue;
    const base = k.slice(0, -4);
    if (!source.has(`${base}_other`)) continue;
    const one = dict.has(k), other = dict.has(`${base}_other`);
    if (NO_PLURAL_LOCALES.includes(lang)) { if (one && !other) res.problems.push(`${base}: has _one but not _other (this language only needs _other)`); }
    else if (one !== other) res.problems.push(`${base}: ${one ? "_one" : "_other"} without ${one ? "_other" : "_one"}`);
  }
  for (const k of required) if (dict.has(k)) res.done++; else res.missing.push(k);
  return res;
}

/** One language on one surface: { surface, lang, total, done, missing[], problems[], sameAsEnglish, hasFile }. */
export function checkSurface(surfaceName, lang) {
  const surface = SURFACES[surfaceName];
  const source = surface.source();
  const dict = surface.dict(lang);
  if (!dict) {
    const required = requiredKeys(source, lang);
    return { surface: surfaceName, lang, total: required.length, done: 0, missing: required, problems: [], sameAsEnglish: 0, hasFile: false };
  }
  return { surface: surfaceName, lang, hasFile: true, ...compare(source, dict, lang) };
}

/** Every language × surface. */
export function checkAll(langs = locales()) {
  const out = [];
  for (const lang of langs) for (const name of Object.keys(SURFACES)) out.push(checkSurface(name, lang));
  return out;
}

export const pct = (done, total) => (total ? Math.floor((1000 * done) / total) / 10 : 100);

/** Per language: { lang, done, total, coverage, floor, problems } over all surfaces. */
export function summary(results) {
  const by = new Map();
  for (const r of results) {
    const s = by.get(r.lang) ?? { lang: r.lang, done: 0, total: 0, problems: [] };
    s.done += r.done; s.total += r.total; s.problems.push(...r.problems.map((p) => `[${r.surface}] ${p}`));
    by.set(r.lang, s);
  }
  return [...by.values()].map((s) => ({ ...s, coverage: pct(s.done, s.total), floor: COVERAGE_FLOOR[s.lang] ?? 0 }));
}

function report(langs) {
  const results = checkAll(langs);
  const pad = (s, n) => String(s).padEnd(n);
  console.log(`${pad("language", 9)}${Object.keys(SURFACES).map((n) => pad(n, 15)).join("")}total`);
  for (const s of summary(results)) {
    const cells = results.filter((r) => r.lang === s.lang).map((r) => pad(r.hasFile ? `${pct(r.done, r.total)}%` : "no file", 15));
    console.log(`${pad(s.lang, 9)}${cells.join("")}${s.coverage}% (floor ${s.floor}%)${s.problems.length ? `, ${s.problems.length} problem(s)` : ""}`);
  }
  for (const s of summary(results)) for (const p of s.problems.slice(0, 40)) console.log(`  ${s.lang} ${p}`);
  if (langs.length === 1) {
    for (const r of results) if (r.missing.length) console.log(`  ${r.surface}: ${r.missing.length} missing, e.g. ${r.missing.slice(0, 8).join(", ")}`);
    for (const r of results) if (r.sameAsEnglish) console.log(`  ${r.surface}: ${r.sameAsEnglish} text(s) identical to English (names, "OK"… or not translated yet)`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) report(process.argv[2] ? [process.argv[2]] : locales());
