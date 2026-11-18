// « Écouter les réponses »: the text cleaner the player and the server share (server/src/speechtext.ts) — what the
// browser's own voice reads when the server has none, and what the server sends to text-to-speech.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { speechParts, speechSentences, speechText, SPEECH_FIRST_PART, SPEECH_MAX_CHARS, SPEECH_PART } from "../../server/src/speechtext.ts";

test("markdown is taken out, titles and list items become sentences", () => {
  assert.equal(speechText("## Plan\n\n1. **Lire** le brief\n2. _Écrire_ la suite\n> une note", "fr"), "Plan. Lire le brief. Écrire la suite. une note.");
});

test("code blocks are one short word; inline code keeps its text", () => {
  assert.equal(speechText("Voici :\n```python\nprint('x')\nfor i in range(3): pass\n```\nVoilà.", "fr"), "Voici: bloc de code. Voilà.");
  assert.equal(speechText("Here:\n~~~\nrm -rf /\n~~~", "en"), "Here: code block.");
  assert.equal(speechText("Lance `npm test`.", "fr"), "Lance npm test.");
  assert.ok(!speechText("```\nunterminated code\nmore", "en").includes("unterminated"), "an unclosed block is not read either");
});

test("links: their words; a bare address is said by its host only", () => {
  assert.equal(speechText("Voir [la doc](https://docs.example.com/a/b?c=1).", "fr"), "Voir la doc.");
  assert.equal(speechText("Voir https://www.github.com/a/b/issues/12, merci.", "fr"), "Voir lien vers github.com, merci.");
  assert.equal(speechText("See www.example.org/page now", "en"), "See link to example.org now.");
  assert.equal(speechText("![logo](https://x.y/logo.png) Done.", "en"), "Done.");
});

test("tables are read row by row; HTML tags vanish", () => {
  assert.equal(speechText("| Nom | Prix |\n|:--|--:|\n| Thé | 3 € |", "fr"), "Nom, Prix. Thé, 3 €.");
  assert.equal(speechText("Un <b>mot</b> <br/> fort.", "fr"), "Un mot fort.");
});

test("long replies are capped at a sentence, with a word saying the rest is on screen", () => {
  const s = speechText("Une phrase complète. ".repeat(600), "fr");
  assert.ok(s.length <= SPEECH_MAX_CHARS + 30, String(s.length));
  assert.ok(s.endsWith("complète. La suite est à l'écran."));
  assert.ok(speechText("word ".repeat(2000), "en").endsWith("The rest is on screen."));
});

test("parts: a short first one (fast start), the rest grouped, nothing lost or cut mid-word", () => {
  const text = speechText("Bonjour ! " + "Voici une phrase de longueur moyenne pour le test, avec une virgule. ".repeat(20), "fr");
  const parts = speechParts(text);
  assert.ok(parts[0].length <= SPEECH_FIRST_PART);
  assert.ok(parts.every((p) => p.length <= SPEECH_PART));
  assert.equal(parts.join(" "), text);
  assert.ok(parts.length < 12, "grouped, not one request per sentence");
  const huge = speechParts("mot ".repeat(500).trim());
  assert.ok(huge.every((p) => p.length <= SPEECH_PART && !p.startsWith(" ") && !/^ot\b/.test(p)));
  assert.deepEqual(speechParts(""), []);
});

test("sentences: numbers and abbreviations mid-word do not end one", () => {
  assert.deepEqual(speechSentences("Version 3.5 sortie. Prix: 2,5 €! Fin?"), ["Version 3.5 sortie.", "Prix:", "2,5 €!", "Fin?"]);
});
