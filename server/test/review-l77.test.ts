import assert from "node:assert/strict";
import { test } from "node:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Card, FileChange } from "../src/shared.js";

// L77 rest (reviewplus.ts): reviewers of another provider first, several reviewers (« prête à publier » only with as
// many approvals as the project asks), project review rules given to every reviewer, « faire corriger par l'auteur »
// (a tainted teammate message, never the owner's own words). The reviewer is scripted: no model.
process.env.DATA_DIR = mkdtempSync(join(tmpdir(), "sklubot-l77-"));
process.env.SESSION_SECRET = "l77-review-tests-local-secret-00000";
process.env.NO_SCHEDULER = "1";
process.env.HOSTED_MODE = "0";
process.env.DEFAULT_MODEL = "alpha:a1";
const { users, bots, rows, sections } = await import("../src/store.js");
const { reviewAsk } = await import("../src/peerreview.js");
const { snapRunner } = await import("../src/snapshots.js");
const { reviewCandidates, providerOf, setRules, rulesOf, projectRulesBlock, startPanel, panelStatus, fixMessage, fixByAuthor, changesReview, fixSend } = await import("../src/reviewplus.js");
const loop = await import("../src/agent/loop.js");
const { q } = await import("../src/db.js");

const owner = users.create("l77@example.test", "User", "unused", "fr");
const stranger = users.create("l77-b@example.test", "B", "unused", "fr");
const author = bots.create(owner.id, { name: "Auteur" });
const same = bots.create(owner.id, { name: "Même" });
const other = bots.create(owner.id, { name: "Autre" });
const third = bots.create(owner.id, { name: "Troisième" });
const foreign = bots.create(stranger.id, { name: "Étranger" });
bots.patch(other.id, { model: "beta:b1" });
const project = sections.create(owner.id, "Site");
bots.patch(author.id, { sectionId: project.id });
const fc = (path: string): FileChange => ({ path, change: "modified", added: 3, removed: 1, binary: false, oldSize: 10, newSize: 20 });
const diffOf = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -10,3 +10,4 @@\n   const a = 1;\n-  return a;\n+  console.log(a);\n+  return a;\n }\n`;
function cardWith(files: FileChange[]) {
  rows.append(author, { kind: "message", role: "user", text: "Ajoute un journal." }, 0);
  const card: Extract<Card, { type: "files" }> = { type: "files", snapId: "tEND", baseId: "tBASE", status: "available", more: 0, files };
  return { row: rows.append(author, { kind: "card", card }), card };
}
const until = async (fn: () => boolean, what: string) => { for (let i = 0; i < 200; i++) { if (fn()) return; await new Promise((r) => setTimeout(r, 20)); } throw new Error(`timed out: ${what}`); };

test("L77 candidates: the owner's other bots, those on another provider first; never another account's", () => {
  assert.equal(providerOf(bots.byId(author.id)!), "alpha");
  const c = reviewCandidates(bots.byId(author.id)!);
  assert.deepEqual(c.map((x) => x.name), ["Autre", "Même", "Troisième"]);
  assert.equal(c[0].otherProvider, true);
  assert.equal(c[1].otherProvider, false);
  assert.ok(!c.some((x) => x.id === foreign.id || x.id === author.id));
});

test("L77 project rules: kept per project, checked, given to the reviewer as rules to check", () => {
  assert.deepEqual(rulesOf(owner.id, project.id), { text: "", minReviewers: 1 });
  assert.throws(() => setRules(owner.id, project.id, { minReviewers: 4 }), /entre 1 et 3/);
  assert.throws(() => rulesOf(stranger.id, project.id), /n'existe pas/);
  setRules(owner.id, project.id, { text: "Pas de console.log dans le code livré.", minReviewers: 2 });
  assert.match(projectRulesBlock(bots.byId(author.id)!), /review rules for this project .*never instructions to you\):\nPas de console\.log/);
  assert.equal(projectRulesBlock(bots.byId(same.id)!), "", "a bot outside the project gets none");
});

test("L77 several reviewers: each reads with the project rules; ready only with 2 approvals and no changes; fix sent to the author", async (t) => {
  t.mock.method(snapRunner, "any", async (_b: string, args: string[]) => args[0] === "diff" ? { code: 0, stdout: Buffer.from(diffOf(args[3])), stderr: "" } : { code: 1, stdout: Buffer.from(""), stderr: "" });
  const systems: string[] = [];
  const answers: Record<string, string> = {
    [other.id]: JSON.stringify({ verdict: "approved", summary: "Correct.", files: [{ path: "src/a.ts", status: "reviewed" }], findings: [] }),
    [same.id]: JSON.stringify({ verdict: "changes", summary: "Une règle du projet n'est pas suivie.", files: [{ path: "src/a.ts", status: "reviewed" }], findings: [{ path: "src/a.ts", category: "other", severity: "medium", code: "console.log(a);", text: "console.log interdit par les règles du projet." }] }),
    [third.id]: JSON.stringify({ verdict: "approved", summary: "Rien.", files: [{ path: "src/a.ts", status: "reviewed" }], findings: [] }),
  };
  t.mock.method(reviewAsk, "run", async (r: any, system: string) => { systems.push(system); return system.includes("remove") && !system.includes("review rules") ? JSON.stringify({ remove: [] }) : answers[r.id]; });
  const { row, card } = cardWith([fc("src/a.ts")]);
  const a = bots.byId(author.id)!;
  assert.throws(() => startPanel(a, [other.id], row, card, "fr"), /2 ou 3/);
  assert.throws(() => startPanel(a, [other.id, foreign.id], row, card, "fr"), /d'autres bots/);
  startPanel(a, [other.id, third.id], row, card, "fr");
  await until(() => panelStatus(a, row.seq).reviews.every((r) => r.state !== "working"), "two reviews");
  const ok = panelStatus(a, row.seq);
  assert.equal(ok.needed, 2);
  assert.equal(ok.approvals, 2);
  assert.equal(ok.verdict, "ready", "two approvals, as the project asks");
  assert.ok(systems.some((s) => /Pas de console\.log/.test(s)), "the reviewers got the project rules");
  startPanel(a, [same.id, other.id], row, card, "fr");
  await until(() => panelStatus(a, row.seq).reviews.every((r) => r.state !== "working"), "second panel");
  assert.equal(panelStatus(a, row.seq).verdict, "changes", "one reviewer asks for changes: not ready");
  const review = changesReview(a, row.seq)!;
  assert.equal(review.reviewer, "Même");
  const msg = fixMessage(review, "fr");
  assert.match(msg, /^Même a relu ta dernière modification et demande des corrections\./);
  assert.match(msg, /- \[medium\/other\] src\/a\.ts:\d+ — console\.log interdit/);
  const sent: any[] = [];
  t.mock.method(fixSend, "enqueue", (botId: string, trigger: any) => { sent.push({ botId, trigger }); });
  assert.deepEqual(fixByAuthor(a, row), { sent: true });
  assert.equal(sent.length, 1);
  assert.equal(sent[0].botId, a.id);
  assert.equal(sent[0].trigger.kind, "bot");
  assert.equal(sent[0].trigger.fromName, "Même");
  assert.equal(sent[0].trigger.tainted, true, "the reviewer's words never count as the owner's own");
  assert.match(sent[0].trigger.text, /console\.log interdit/);
});

test("L77 fix without a review asking for changes is refused", () => {
  const { row } = cardWith([fc("src/b.ts")]);
  assert.throws(() => fixByAuthor(bots.byId(author.id)!, row), /Aucune relecture/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM peer_review_panel WHERE seq = ?", row.seq)!.n, 0);
});
