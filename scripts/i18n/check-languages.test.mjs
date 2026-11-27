// The language check as a test (npm run check:i18n, part of npm test). Rules: scripts/i18n/check-languages.mjs.
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkAll, checkSurface, compare, countInline, inlineAllowlist, inlineBranches, inlineProblems, requiredKeys, summary } from "./check-languages.mjs";
import { locales, SURFACES } from "./dicts.mjs";

const results = checkAll();

for (const s of summary(results)) {
  test(`${s.lang}: no problem in its texts`, () => {
    assert.deepEqual(s.problems, [], `${s.problems.length} problem(s), first ones:\n${s.problems.slice(0, 20).join("\n")}`);
  });
  test(`${s.lang}: coverage ${s.coverage}% is at least its floor (${s.floor}%)`, (t) => {
    t.diagnostic(results.filter((r) => r.lang === s.lang).map((r) => `${r.surface} ${r.done}/${r.total}`).join(", "));
    assert.ok(s.coverage >= s.floor, `${s.lang} covers ${s.coverage}% of the texts, under its floor of ${s.floor}% (missing texts show in English)`);
  });
}

test("French and English are complete on every surface", () => {
  for (const lang of ["fr", "en"]) for (const name of Object.keys(SURFACES)) {
    const r = checkSurface(name, lang);
    assert.equal(r.missing.length, 0, `${lang} ${name}: missing ${r.missing.slice(0, 5).join(", ")}`);
  }
});

test("every language of the list is checked, and Chinese needs only the _other forms", () => {
  assert.deepEqual(locales(), ["fr", "en", "es", "de", "it", "pt", "zh"]);
  const source = new Map([["a_one", "1 thing"], ["a_other", "{n} things"], ["b", "B"]]);
  assert.deepEqual(requiredKeys(source, "zh"), ["a_other", "b"]);
  assert.deepEqual(requiredKeys(source, "es"), ["a_one", "a_other", "b"]);
});

test("the rules catch broken translations (placeholders, links, code, plurals, unknown keys, empty texts)", () => {
  const source = new Map([["hi", "Hello {name}"], ["link", "See https://example.com"], ["code", "Run `npm test`"], ["n_one", "{n} bot"], ["n_other", "{n} bots"]]);
  const bad = new Map([["hi", "Hola {nombre}"], ["link", "Mira https://ejemplo.es"], ["code", "Ejecuta npm test"], ["n_one", "{n} bot"], ["ghost", "¿?"], ["empty", ""]]);
  const r = compare(source, bad, "es");
  const text = r.problems.join("\n");
  for (const want of ["hi: placeholders", "link: links changed", "code: 0 backticks", "n: _one without _other", "ghost: not a key", "empty: not a key"]) assert.ok(text.includes(want), `missing problem "${want}" in:\n${text}`);
  assert.equal(r.done, 4);
  assert.deepEqual(r.missing, ["n_other"]);
  // Chinese: only `_other` is needed; `_one` alone is a problem.
  const zh = compare(source, new Map([["n_other", "{n} 个机器人"]]), "zh");
  assert.deepEqual(zh.problems, []);
  assert.deepEqual(zh.missing, ["hi", "link", "code"]);
  assert.ok(compare(source, new Map([["n_one", "{n}"]]), "zh").problems.some((p) => p.includes("only needs _other")));
});

test("no new inline French/English text (`x === \"fr\" ? … : …`) outside scripts/i18n/inline-allowlist.json", () => {
  const problems = inlineProblems();
  assert.deepEqual(problems, [], problems.map((p) => `${p.file}: ${p.found} inline fr/en branch(es), ${p.allowed} allowed (lines ${p.lines.join(", ")}): put the text in a dictionary (docs/LANGUES.md)`).join("\n"));
  for (const [file, entry] of Object.entries(inlineAllowlist())) assert.ok(entry.why && entry.max > 0, `${file}: each allowed file says why`);
  assert.ok(Object.keys(inlineBranches()).length > 0, "the scan sees the allowed files");
});

test("the inline scan catches the forms it should and ignores comments, lookups and optional chaining", () => {
  const src = [
    'const a = locale === "fr" ? "Bonjour" : "Hello";',
    "const b = fr ? `Salut ${x}` : `Hi ${x}`;",
    'const c = user.locale !== "fr" ? en : fr2;',
    "const d = isFr ? 1 : 2;",
    "// fr ? \"commented\" : \"out\"",
    "/* locale === \"fr\" ? 1 : 2 */",
    "const e = fr?.length ?? 0;",
    "const f = fr ?? \"en\";",
    'const g = localize(locale, "Hello", FR);',
  ].join("\n");
  assert.deepEqual(countInline(src), [1, 2, 3, 4]);
});
