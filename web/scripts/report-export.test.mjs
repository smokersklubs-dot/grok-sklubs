// L156 — a research report exported as Markdown (lib/reportexport.ts): subject, each question in plan order, findings with
// a numbered source, an unprocessed question said so, one « Sources » list without repeats, secrets masked.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { reportMarkdown, reportFileName } from "../src/lib/reportexport.ts";

const report = {
  id: "r1", state: "done",
  brief: { subject: "Prix   de l'électricité", plan: ["Quel prix ?", "Quelle tendance ?", "Quelles limites ?"] },
  sections: [
    { question: "Quel prix ?", read: 4, at: Date.UTC(2026, 10, 2), notes: ["Note un"], findings: [
      { url: "https://a.example/x", title: "Source A", claim: "Le prix monte.", quote: "ligne 1\nligne 2", published: "2026-10-01" },
      { url: "https://b.example/y", title: "Source [B]", claim: "Clé sk-fake-for-tests-123", quote: "" },
    ] },
    { question: "Quelle tendance ?", read: 2, at: Date.UTC(2026, 10, 3), notes: [], findings: [
      { url: "https://a.example/x", title: "Source A", claim: "Toujours A.", quote: "" },
    ] },
  ],
};
const find = (t) => { const i = t.indexOf("sk-fake"); return i < 0 ? [] : [{ start: i, end: i + 23 }]; };

test("report: subject, questions in order, numbered sources without repeats, secrets masked", () => {
  const md = reportMarkdown(report, true, find, Date.UTC(2026, 10, 23));
  assert.match(md, /^# Prix de l'électricité\n/);
  assert.match(md, /terminé · 2\/3 questions traitées/);
  const q = [...md.matchAll(/^## (.+)$/gm)].map((m) => m[1]);
  assert.deepEqual(q, ["1. Quel prix ?", "2. Quelle tendance ?", "3. Quelles limites ?", "Sources"]);
  assert.match(md, /Le prix monte\. \[1\]/);
  assert.match(md, /Toujours A\. \[1\]/, "the same link keeps its number");
  assert.match(md, /> ligne 1\n> ligne 2/);
  assert.match(md, /Pas encore traitée\./);
  assert.equal((md.match(/^\d+\. \[/gm) ?? []).length, 2, "two sources");
  assert.match(md, /2\. \[Source B\]\(https:\/\/b\.example\/y\)/, "brackets dropped from titles");
  assert.equal(md.includes("sk-fake-for-tests"), false);
  assert.match(md, /- Note un/);
});

test("report: English labels and file names", () => {
  const md = reportMarkdown({ ...report, state: "interrupted" }, false, () => []);
  assert.match(md, /interrupted · 2\/3 questions processed/);
  assert.match(md, /Not processed yet\./);
  assert.match(reportFileName(report, "md"), /\.md$/);
  assert.match(reportFileName(report, "html"), /\.html$/);
});
