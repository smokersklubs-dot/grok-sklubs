// Vague 7 confort, côté appli : tour d'accueil d'un nouveau bot (L145, src/lib/starters.ts) et glossaire (L161).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { roleOf, welcomeFor } from "../src/lib/starters.ts";
import { GLOSSARY } from "../src/lib/glossary.ts";

test("L145: the role comes from the bot's own words; an unknown role gets the general welcome", () => {
  assert.equal(roleOf("Comptable · factures et devis"), "money");
  assert.equal(roleOf("Développeur web, corrige mes bugs GitHub"), "code");
  assert.equal(roleOf("Community manager Instagram"), "marketing");
  assert.equal(roleOf("Rédactrice de blog"), "writing");
  assert.equal(roleOf("Veille concurrentielle"), "research");
  assert.equal(roleOf("Léon"), "general");
});

test("L145: one question, exactly 3 choices and 4 starters, in both languages, with distinct labels", () => {
  for (const label of ["Comptable", "Développeur", "Marketing", "Rédacteur", "Recherche", "Support client", "Designer", "Assistant agenda", ""]) {
    for (const lang of ["fr", "en"]) {
      const w = welcomeFor({ name: "Bot", label }, lang);
      assert.ok(w.question.endsWith("?"), `${label}/${lang}`);
      assert.equal(w.choices.length, 3);
      assert.equal(w.starters.length, 4);
      const labels = [...w.choices, ...w.starters].map((c) => c.label);
      assert.equal(new Set(labels).size, 7, `${label}/${lang} labels are distinct`);
      for (const c of [...w.choices, ...w.starters]) assert.ok(c.prompt.length > 20 && c.label.length <= 32, c.label);
    }
  }
  assert.equal(welcomeFor({ name: "Max", label: "Comptable" }, "fr").question, "Par quoi on commence côté chiffres ?");
});

test("L161: every glossary word has a French and an English explanation", () => {
  for (const [k, v] of Object.entries(GLOSSARY)) for (const lang of ["fr", "en"]) { assert.equal(v[lang].length, 2, k); assert.ok(v[lang][1].length > 30, `${k}/${lang}`); }
});
