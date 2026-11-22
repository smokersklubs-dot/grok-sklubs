// Wave 6 UI comfort: L140/L106 passage messages (lib/passage.ts), L147 stable streaming + « NOUVEAU » (lib/chatreading.ts),
// L156 exports with secrets masked (lib/chatexport.ts), L142 run transitions (lib/stopcauses.ts), L152 slash query.
import { test } from "node:test";
import assert from "node:assert/strict";
import { passageMessage, quoteLines, simplerMessage, worthQuoting, PASSAGE_MAX } from "../src/lib/passage.ts";
import { firstNewSeq, stableMarkdown, withNewLine } from "../src/lib/chatreading.ts";
import { conversationMarkdown, exportFileName, maskSecrets, turnDebug } from "../src/lib/chatexport.ts";
import { endedRuns, startedRuns } from "../src/lib/runchanges.ts";

test("passage: quoted then the request; nothing for an empty selection or request; long passages cut", () => {
  assert.equal(passageMessage("  la marge brute\nest de 40 %  ", "Explique-moi ce passage."), "> la marge brute\n> est de 40 %\n\nExplique-moi ce passage.");
  assert.equal(passageMessage("ab", "x"), "");
  assert.equal(passageMessage("assez long", "  "), "");
  const q = quoteLines("a".repeat(5000));
  assert.ok(q.length <= PASSAGE_MAX + 2 && q.endsWith("…"));
  assert.equal(worthQuoting("  ... "), false);
  assert.equal(worthQuoting("TVA"), true);
});

test("explain more simply: the start of the reply (no code, no marks), then the request", () => {
  const m = simplerMessage("## Résumé\n**La TVA** se calcule ainsi :\n```js\nx = 1\n```\nfin", "Explique plus simplement.");
  assert.equal(m, "> Résumé La TVA se calcule ainsi : … fin\n\nExplique plus simplement.");
  assert.ok(simplerMessage("x".repeat(400), "r").split("\n")[0].length <= 202);
  assert.equal(simplerMessage("", "r"), "");
});

test("stable streaming: an open code block is closed, a dangling ** or ` held back, a half table row held back", () => {
  assert.equal(stableMarkdown("Voici :\n```js\nconst a"), "Voici :\n```js\nconst a\n```");
  assert.equal(stableMarkdown("C'est **important"), "C'est important");
  assert.equal(stableMarkdown("lance `npm"), "lance npm");
  assert.equal(stableMarkdown("**fini** et `ok`"), "**fini** et `ok`");
  assert.equal(stableMarkdown("| a | b |\n|---|---|\n| 1 | 2"), "| a | b |\n|---|---|\n");
  assert.equal(stableMarkdown("ligne 1\nligne 2"), "ligne 1\nligne 2");
});

const row = (seq, role, text, thread) => ({ seq, botId: "b", createdAt: 1700000000000 + seq * 60000, ...(thread ? { thread } : {}), body: { kind: "message", role, text } });

test("NOUVEAU: above the first of the unread replies; thread replies do not count", () => {
  const rows = [row(1, "user", "a"), row(2, "assistant", "r1"), row(3, "assistant", "fil", 2), row(4, "assistant", "r2"), row(5, "assistant", "r3")];
  assert.equal(firstNewSeq(rows, 2), 4);
  assert.equal(firstNewSeq(rows, 0), null);
  assert.equal(firstNewSeq(rows, 9), null);
  const items = [{ t: "msgs", key: "a", rows: [rows[0]] }, { t: "msgs", key: "b", rows: [rows[1], rows[3], rows[4]] }];
  const out = withNewLine(items, 4, "Nouveau");
  assert.deepEqual(out.map((i) => i.key), ["a", "new", "b"]);
  assert.equal(withNewLine(items, null, "x"), items);
});

const finder = (text) => [...text.matchAll(/sk-fake-[a-z0-9]+/g)].map((m) => ({ start: m.index, end: m.index + m[0].length }));

test("export: Markdown with names and times, thread replies left out, secrets masked; safe file names", () => {
  const rows = [row(1, "user", "Ma clé est sk-fake-abc123"), row(2, "assistant", "Bien reçu."), row(3, "assistant", "dans un fil", 2), { seq: 4, botId: "b", createdAt: 1700000240000, body: { kind: "notice", tone: "warn", text: "Arrêté." } }];
  const md = conversationMarkdown("Jiren", rows, { you: "Toi", bot: "Jiren", title: "Discussion avec Jiren", exportedAt: "Exportée le", step: "Étape", notice: "Note" }, finder, 1700000000000);
  assert.match(md, /^# Discussion avec Jiren/);
  assert.match(md, /\*\*Toi\*\* · \d{4}-\d\d-\d\d \d\d:\d\d/);
  assert.match(md, /\*\*Jiren\*\*/);
  assert.doesNotMatch(md, /sk-fake|dans un fil/);
  assert.match(md, /•••• \(masked\)/);
  assert.match(md, /> Note : Arrêté\./);
  assert.equal(exportFileName("Jérôme l'assistant", 1700000000000, "md").replace(/\d{4}-\d\d-\d\d/, "D"), "jerome-l-assistant-D.md");
  assert.equal(maskSecrets("a sk-fake-1 b sk-fake-2", finder, "masqué"), "a •••• (masqué) b •••• (masqué)");
});

test("debug export of a turn: from the request to the reply, steps included, every string masked", () => {
  const rows = [row(1, "user", "avant"), row(2, "assistant", "r0"), row(3, "user", "Fais X avec sk-fake-zz9"), { seq: 4, botId: "b", createdAt: 1, body: { kind: "step", status: "done", label: "lecture", detail: "token sk-fake-qq1" } }, row(5, "assistant", "Fait.")];
  const d = turnDebug(rows, 5, finder);
  assert.equal(d.request, 3);
  assert.deepEqual(d.rows.map((r) => r.seq), [3, 4, 5]);
  assert.doesNotMatch(JSON.stringify(d), /sk-fake/);
  assert.deepEqual(turnDebug(rows, 99, finder).rows, []);
});

test("stop-cause refresh: which bots just stopped or started", () => {
  assert.deepEqual(endedRuns({ a: { running: true }, b: { running: false } }, { a: { running: false }, b: { running: true } }), ["a"]);
  assert.deepEqual(startedRuns({ a: { running: true }, b: { running: false } }, { a: { running: false }, b: { running: true }, c: { running: true } }), ["b", "c"]);
});
