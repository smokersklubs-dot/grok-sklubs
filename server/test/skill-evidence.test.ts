import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L131 (skillevidence.ts): a proposed skill shows the owner's earlier requests for the same task, one per conversation,
// newest first, anonymised; the bot's own messages and other accounts never count.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ske-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { users, bots, rows } = await import("../src/store.js");
const ev = await import("../src/skillevidence.js");

test("earlier requests in several conversations become the evidence of a proposed skill", () => {
  const owner = users.create("ev@example.com", "Martine", "x", "fr");
  const other = users.create("ev2@example.com", "Autre", "x", "fr");
  const a = bots.create(owner.id, { name: "Léon" }), b = bots.create(owner.id, { name: "Iris" }), z = bots.create(other.id, { name: "Zed" });
  const say = (bot: typeof a, role: "user" | "assistant", text: string) => rows.append(bot, { kind: "message", role, text } as any);
  say(a, "user", "Peux-tu faire la facture mensuelle du client Dupont, comme d'habitude ?");
  say(a, "user", "Encore la facture mensuelle pour Dupont stp"); // same conversation: counted once
  say(a, "assistant", "Voici la facture mensuelle.");          // the bot's own words never count
  say(b, "user", "Il faut préparer la facture mensuelle de novembre.");
  say(z, "user", "facture mensuelle de mon compte");            // another account
  const found = ev.proposalEvidence(owner.id, "Facture mensuelle", "", ["Martine", "Dupont"]);
  assert.equal(found.length, 2, JSON.stringify(found));
  assert.deepEqual(found.map((x) => x.where).sort(), ["Iris", "Léon"]);
  assert.ok(found.every((x) => !/Dupont|Martine/.test(x.quote)), "names known to the account are replaced");
  assert.ok(found[0].at >= found[1].at, "newest first");
  assert.match(ev.evidenceNote(found), /2 earlier conversations/);
  assert.deepEqual(ev.evidenceFields([]), {});
  assert.equal(ev.proposalEvidence(owner.id, "zzzz introuvable", "", []).length, 0);
});

test("one owner message per conversation (bot, reset, thread), at most four", () => {
  const hit = (botId: string, generation: number, at: number, role: "user" | "assistant" = "user", thread?: number) => ({ botId, botName: botId, generation, current: true, seq: at, at, role, snippet: "x", ...(thread ? { thread } : {}) });
  const list = ev.distinctAsks([hit("a", 1, 1), hit("a", 1, 2), hit("a", 2, 3), hit("a", 2, 4, "user", 9), hit("b", 1, 5, "assistant"), hit("c", 1, 6), hit("d", 1, 7), hit("e", 1, 8)]);
  assert.equal(list.length, 4);
  assert.deepEqual(list.map((h) => h.at), [8, 7, 6, 4]);
});
