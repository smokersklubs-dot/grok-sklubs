import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Audit DS-Bot #72 / #74 / F14 (À faire n° 9): the in-turn line was 80 % of the window with no ceiling (a 1 M-token model
// compacted at 800 000 tokens), the line between turns ignored the model, and the user's older messages came back
// paraphrased in the summary. Now: capped line (380 000 by default), linked to the model, user's words word for word.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-dscompact-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "sum:s";
delete process.env.COMPACT_CAP_TOKENS; delete process.env.AUX_MODEL;

const { registerProvider } = await import("../src/llm/index.js");
const { linesFor, compactAtTokens, compactAtChars, betweenTurnsChars, userWordsBlock, shorten } = await import("../src/agent/compactlines.js");
const { compactIfNeeded, SUMMARY_SECTIONS } = await import("../src/agent/memory.js");
const { config } = await import("../src/config.js");
const { users, bots, rows, history } = await import("../src/store.js");

const SUMMARY = SUMMARY_SECTIONS.map((h) => `## ${h}\nI noted the facts of this part of the conversation carefully, with names and numbers.`).join("\n");
registerProvider({ id: "sum", label: "Summariser", models: ["s"], available: () => true, async runTurn() { return { content: [{ type: "text", text: SUMMARY }], stopReason: "end", model: "s", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

test("before / after: a 1 M-token window no longer compacts at 800 000 tokens", () => {
  assert.equal(Math.floor(1_000_000 * config.compactRatio), 800_000, "the old line");
  assert.equal(compactAtTokens(1_000_000), 380_000, "capped");
  assert.equal(compactAtTokens(200_000), 160_000, "the usual window keeps its line");
  assert.deepEqual(linesFor({ window: 1_000_000, reserve: 100_000 }), { window: 1_000_000, usable: 900_000, hard: 855_000, check: 380_000 });
  assert.equal(linesFor({ window: 100_000, reserve: 90_000 }).usable, 50_000, "never less than half the window");
});

test("between turns the line follows the model, never above COMPACT_CHARS", () => {
  assert.equal(compactAtChars(32_000), 102_400);
  assert.equal(compactAtChars(1_000_000), config.compactChars);
  assert.equal(betweenTurnsChars("nobody", "sum:s"), config.compactChars, "no declared window: the old line");
});

test("shorten keeps the start and the end with a marker", () => {
  const s = shorten("a".repeat(1000) + "b".repeat(1000));
  assert.match(s, /^a+\n\[… 500 characters left out of this view …\]\nb+$/);
});

test("the user's own messages come back word for word next to the summary; bots' and routines' words do not", async () => {
  const user = users.create("long@example.com", "Lo", "x", "fr");
  const bot = bots.create(user.id, { name: "Longue", model: "sum:s" });
  const said = ["Toujours tutoyer mes clients, jamais de vouvoiement.", "Le budget est de 4 200 € HT, pas plus.", "Réponds en français."];
  const msgs: any[] = [];
  for (let i = 0; i < 8; i++) {
    const text = said[i] ?? `Question numéro ${i} sur le projet Atlas.`;
    rows.append(bot, { kind: "message", role: "user", text });
    rows.append(bot, { kind: "message", role: "assistant", text: `Réponse ${i}` });
    msgs.push({ role: "user", content: [{ type: "text", text: `[2026-11-22 10:0${i} UTC]\n${text}` }] }, { role: "assistant", content: [{ type: "text", text: `Réponse ${i} `.repeat(50) }] });
  }
  rows.append(bot, { kind: "message", role: "user", text: "Message d'un autre bot", origin: { kind: "bot", id: "x", name: "Autre" } });
  for (const m of msgs) history.append(bot.id, bot.generation, m);
  const r = await compactIfNeeded(bots.byId(bot.id)!, true);
  assert.equal(r.changed, true);
  const first = history.load(bot.id, bot.generation)[0].content[0] as { text: string };
  assert.match(first.text, /## The user's messages, word for word \(oldest first\)/);
  for (const t of said) assert.ok(first.text.includes(`- ${t}`), t);
  assert.ok(!first.text.includes("Message d'un autre bot"), "only what the user typed");
  // The kept turns are not repeated in the block.
  assert.ok(!first.text.includes("- Question numéro 7 sur le projet Atlas."));
});

test("an empty block when there is nothing of the user's", () => {
  assert.equal(userWordsBlock({ id: "none", generation: 0 }, []), "");
});
