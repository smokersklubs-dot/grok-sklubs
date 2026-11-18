import assert from "node:assert/strict";
import { test } from "node:test";
import { findGuide, guideIndex } from "../src/agent/guides.js";
import { designReferences, individualMethods, methodFamilies } from "../src/agent/workmethods.js";

test("the portable manual exposes each procedure by its directory title and stable id", () => {
  const directory = findGuide("Méthodes")!;
  const titles = directory.body.split("\n").filter((line) => line.startsWith("- ")).map((line) => line.slice(2));
  assert.equal(titles.length, 60);
  assert.equal(methodFamilies.length, 12);
  assert.deepEqual(titles, individualMethods.map((guide) => guide.name));
  const entries = [...guideIndex(), ...individualMethods];
  assert.equal(new Set(entries.map((entry) => entry.id)).size, entries.length);
  for (const title of titles) {
    const guide = findGuide(title)!;
    assert.ok(guide.body.includes("Références · ["));
    assert.match(guide.body, /\]\(https:\/\//);
    assert.equal(findGuide(guide.id), guide);
    assert.ok(guide.body.split("\n")[0].length > 80);
  }
  assert.equal(findGuide("controler la fidelite du packaging")!.name, "Contrôler la fidélité du packaging");
  assert.equal(findGuide("aucune-fiche-de-ce-nom"), null);
});

test("the OpenDesign directory lists each pinned workflow or template and resolves its source", () => {
  const directory = findGuide("opendesign")!;
  assert.equal(designReferences.length, 169);
  assert.equal(new Set(designReferences.map((g) => g.id)).size, designReferences.length);
  for (const reference of designReferences) {
    const slug = reference.name.split("/")[1];
    assert.ok(directory.body.split(/[,\s]+/).includes(slug));
    assert.equal(findGuide(reference.name), reference);
    assert.ok(reference.body.endsWith("/skills/" + slug + "/SKILL.md)"));
    assert.match(reference.body, /github\.com\/nexu-io\/open-design\/blob\/[0-9a-f]{40}\//);
  }
  assert.equal(findGuide("opendesign/guide-that-does-not-exist"), null);
});

test("each indexed family opens its own five methods without loading their text in the prompt index", () => {
  const index = guideIndex();
  for (const family of methodFamilies) {
    assert.ok(index.some((entry) => entry.id === family.id));
    const titles = findGuide(family.id)!.body.split("\n").filter((line) => line.startsWith("### "));
    assert.equal(titles.length, 5);
    for (const line of titles) assert.ok(individualMethods.includes(findGuide(line.slice(4))!));
  }
  assert.equal(index.some((entry) => "body" in entry), false);
});
