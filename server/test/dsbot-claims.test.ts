import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Audit DS-Bot #63 / F9 (À faire n° 3): a reply that links a file that is not there, or says "working on it" while nothing
// runs, was not marked. Now the existing receipt (L85) carries these marks and the existing promise guard (L21) uses
// the same "work in progress" detector.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-dsclaims-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";

const { fileRefs, missingFileRefs, announcesWork, claimsFor, onComputer } = await import("../src/agent/claims.js");
const { postReceipt, receiptDone, noteToolForReceipt, compareReceipt } = await import("../src/agent/receipt.js");
const { endsOnPromise } = await import("../src/agent/promises.js");
const { workspaceOf } = await import("../src/computer.js");
const { users, bots, rows } = await import("../src/store.js");

test("only deliberate Markdown file links are file claims (not code, not web links, not folders)", () => {
  assert.deepEqual(fileRefs("Voici [le rapport](rapport.pdf), [site](https://x.fr), `[x](y.txt)`, [dossier](files/), [l](src/a.ts#L12)"), ["rapport.pdf", "src/a.ts"]);
  assert.equal(onComputer("~/files/a.txt"), "/root/files/a.txt");
  assert.equal(onComputer("files/a.txt"), "/root/files/a.txt");
});

test("missing files are reported; a file:line link counts when the file is there", async () => {
  const there = new Set(["/root/files/ok.pdf", "/root/src/a.ts"]);
  const exists = async (ps: string[]) => ps.map((p) => there.has(p));
  assert.deepEqual(await missingFileRefs("[a](files/ok.pdf) [b](files/absent.pdf) [c](src/a.ts:42)", exists), ["files/absent.pdf"]);
});

test("work announced in French, English or Chinese; finished work is not", () => {
  for (const t of ["Je suis en train d'exporter le fichier.", "C'est toujours en cours, je te reviens dès que c'est fini.", "I'm still exporting part 2.", "正在导出"]) assert.equal(announcesWork(t), true, t);
  for (const t of ["J'exportais tout à l'heure, c'est terminé.", "Voici le résumé.", "Partie 1 completed and here is the file.", "```\nI'm working on it\n```"]) assert.equal(announcesWork(t), false, t);
});

test("claimsFor: nothing marked when a tool ran, a job runs or a teammate was called", async () => {
  const exists = async (ps: string[]) => ps.map(() => true);
  assert.deepEqual(await claimsFor({ text: "Je suis en train d'exporter.", exists }), { inProgress: true });
  assert.equal(await claimsFor({ text: "Je suis en train d'exporter.", worked: true, exists }), undefined);
  assert.equal(await claimsFor({ text: "Je suis en train d'exporter.", running: 1, exists }), undefined);
  assert.equal(await claimsFor({ text: "Je suis en train d'exporter.", calledPeer: true, exists }), undefined);
});

test("the promise guard and the claims use one detector: 'je suis en train de…' with no tool is sent back to work", () => {
  assert.equal(endsOnPromise("Je suis en train de préparer le tableau."), true);
  assert.equal(endsOnPromise("Voici le tableau terminé."), false);
  // After tools ran in the turn, "still running" can be true (a background job): not a promise by itself.
  assert.equal(endsOnPromise("The dev server is still running in the background.", { workedThisTurn: true }), false);
  assert.equal(endsOnPromise("The dev server is still running in the background."), true);
});

test("the receipt line under the reply: missing file + nothing running, in French, one line; untouched shape of compareReceipt", async () => {
  assert.deepEqual(compareReceipt("Voici.", []), { saidNotDone: [], doneNotSaid: [] });
  const user = users.create("claims@example.com", "Cé", "x", "fr");
  const bot = bots.create(user.id, { name: "Rapporteur" });
  const ws = workspaceOf(bot.id);
  mkdirSync(path.join(ws, "files"), { recursive: true });
  writeFileSync(path.join(ws, "files", "vrai.pdf"), "x");
  const turn = { bot, user, lastText: "Voici [le vrai](files/vrai.pdf) et [le faux](files/faux.pdf). Je suis en train d'exporter le reste.", thread: 0 };
  assert.equal(postReceipt(turn), "", "with file links the line waits for the computer");
  const line = await receiptDone(turn);
  assert.equal(line, "Reçu — lien vers un fichier absent : files/faux.pdf · annonce un travail en cours, mais rien ne tourne");
  assert.equal(rows.list(bot.id, bot.generation, 10).filter((r) => r.body.kind === "notice").length, 1);
  // A turn that did work is not marked "nothing is running"; a reply whose links are all there gets no line.
  const t2 = { bot, user, lastText: "Voici [le vrai](files/vrai.pdf).", thread: 0 };
  noteToolForReceipt(t2, { type: "tool_use", id: "c", name: "file_save", input: {} }, { content: "ok" });
  postReceipt(t2);
  assert.equal(await receiptDone(t2), "");
});
