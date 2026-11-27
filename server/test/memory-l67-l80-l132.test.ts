import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L67 (doublon signalé, 20 notes proches, caractères invisibles, « Retiens surtout… »), L80 (fils résumés, `/compact`
// avec consigne, conversation de plus de 200 000 caractères résumée par parties, résumé à chaud pendant le repos), L132
// (« Réponses courtes » : réglage chiffré par canal, canal du message connu des consignes).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l67-l80-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "l67:r";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.AUX_MODEL;
delete process.env.FALLBACK_MODELS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { consolidate, compactIfNeeded, SUMMARY_SECTIONS, similar } = await import("../src/agent/memory.js");
const { cleanInvisible, nearbyNotes, duplicateOf, memoryFocus, NEAR_NOTES } = await import("../src/agent/memorysave.js");
const { splitSource, compactCommand, restDue, PART_CHARS } = await import("../src/agent/compactplus.js");
const { shortReplies, shortRepliesLine, turnChannel, noteChannel } = await import("../src/shortreplies.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users, memories, rows, history } = await import("../src/store.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const prompts: { kind: string; text: string }[] = [];
let learnAnswer = '{"facts": []}';
const GOOD = SUMMARY_SECTIONS.map((h) => `## ${h}\nJ'ai noté : la cliente Camille et le devis 4521.`).join("\n");
registerProvider({
  id: "l67", label: "Scripted", models: ["r"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const all = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : "")).join("\n")).join("\n");
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    if (!req.tools.length) {
      const kind = /in exactly these sections/.test(all) ? (/This is part \d+ of/.test(all) ? "part" : "summary") : "learn";
      prompts.push({ kind, text: all });
      return { content: [{ type: "text", text: kind === "learn" ? learnAnswer : kind === "part" ? "Notes de cette partie : Camille, devis 4521." : GOOD }], stopReason: "end", model: "r", usage };
    }
    prompts.push({ kind: "turn", text: req.system + "\n" + all });
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "r", usage };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const fresh = async (name: string) => bots.byId((await call("POST", "/bots", { name })).json.bot.id)!;
let userId = "";

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "l67@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("l67@example.com")!.id;
});

// ── L67 ──────────────────────────────────────────────────────────────────────
test("L67 invisible characters: zero-width, direction marks, soft hyphens and controls are removed", () => {
  assert.equal(cleanInvisible("Ca​mi­lle‮ aime‍ le\u0007 thé﻿  vert "), "Camille aime le thé vert");
  assert.equal(cleanInvisible("é"), "é", "NFC");
});

test("L67 memory_save: a duplicate is reported with the existing note, nothing added; the saved text is cleaned", async () => {
  const bot = await fresh("Doublon");
  const tool = builtinTools({}).find((t) => t.spec.name === "memory_save")!;
  const ctx = { bot, user: users.byId(userId)!, depth: 0, signal: AbortSignal.timeout(5000), thread: 0, origin: "user" } as any;
  const first = await tool.run({ text: "Le client​ Dupont paie à 30 jours." }, ctx);
  assert.equal(first.content, "Remembered.");
  assert.equal(memories.list(bot.id)[0].text, "Le client Dupont paie à 30 jours.");
  const again = await tool.run({ text: "le client Dupont paie a 30 jours" }, ctx);
  assert.match(again.content, /^Already remembered, nothing added: "Le client Dupont paie à 30 jours\."/);
  assert.equal(memories.list(bot.id).length, 1);
  const other = await tool.run({ text: "Le client Durand paie à 30 jours." }, ctx);
  assert.equal(other.content, "Remembered.", "another name is another fact");
  assert.equal(duplicateOf(bot.id, "client Durand paie à 30 jours", similar)?.text, "Le client Durand paie à 30 jours.");
});

test("L67 learning: the model sees the 20 notes closest to the messages (not the 200 latest), and the owner's « Retiens surtout »", async () => {
  const bot = await fresh("Proches");
  memories.add(bot.id, "Le fournisseur Acme livre les cartons le jeudi.", "chat");
  for (let i = 0; i < 250; i++) memories.add(bot.id, `Note sans rapport numéro ${i} sur la météo.`, "chat");
  const near = nearbyNotes(bot.id, "Acme a livré les cartons en retard");
  assert.equal(near.length, NEAR_NOTES);
  assert.equal(near[0].text, "Le fournisseur Acme livre les cartons le jeudi.", "an old note on the subject comes first");
  assert.equal((await call("PUT", `/bots/${bot.id}/memory-focus`, { text: "mes fournisseurs​ et leurs délais" })).json.text, "mes fournisseurs et leurs délais");
  assert.equal((await call("PUT", `/bots/${bot.id}/memory-focus`, { text: "password: hunter2-abcdefgh-123456" })).status, 400);
  assert.equal(memoryFocus(bot.id), "mes fournisseurs et leurs délais");
  rows.append(bot, { kind: "message", role: "user", text: "Acme a livré les cartons en retard cette fois." }, 0);
  prompts.length = 0;
  learnAnswer = JSON.stringify({ facts: [{ text: "Le fournisseur​ Acme livre parfois en retard.", quote: "Acme a livré les cartons en retard" }] });
  const r = await consolidate(bots.byId(bot.id)!);
  assert.deepEqual(r.added, ["Le fournisseur Acme livre parfois en retard."], "invisible characters cleaned");
  const p = prompts.find((x) => x.kind === "learn")!.text;
  assert.match(p, /Acme livre les cartons le jeudi/);
  assert.equal((p.match(/Note sans rapport/g) ?? []).length, NEAR_NOTES - 1, "20 notes, not 200");
  assert.match(p, /The user's own guidance on what to remember for this teammate .*"mes fournisseurs et leurs délais"/);
  assert.match(p, /the Skip rules above still apply/);
  assert.equal((await call("PUT", `/bots/${bot.id}/memory-focus`, { text: "" })).json.text, "");
});

// ── L80 ──────────────────────────────────────────────────────────────────────
const bigTurn = (i: number, size: number) => [
  { role: "user" as const, content: [{ type: "text" as const, text: `Demande ${i} ` + "x".repeat(size) }] },
  { role: "assistant" as const, content: [{ type: "text" as const, text: `Réponse ${i}` }] },
];

test("L80 long input: over 200,000 characters it is summarised in parts, nothing cut silently", async () => {
  const s = splitSource("a\n".repeat(400_000));
  assert.equal(s.parts.length, Math.ceil(800_000 / PART_CHARS));
  assert.equal(s.cut, false);
  assert.ok(s.parts.every((p) => p.length <= PART_CHARS));
  assert.equal(splitSource("b".repeat(PART_CHARS * 10)).cut, true, "past 8 parts the oldest is left out, and said");
  const bot = await fresh("Long");
  const msgs = Array.from({ length: 12 }, (_, i) => bigTurn(i, 30_000)).flat();
  history.replace(bot.id, bot.generation, msgs);
  prompts.length = 0;
  const r = await compactIfNeeded(bots.byId(bot.id)!, true);
  assert.equal(r.changed, true);
  const parts = prompts.filter((x) => x.kind === "part");
  assert.ok(parts.length >= 2, `summarised in ${parts.length} parts`);
  assert.match(parts[0].text, /Demande 0 /, "the very start of the conversation is read");
  const final = prompts.find((x) => x.kind === "summary")!.text;
  assert.match(final, /Notes already written on each part/);
  assert.doesNotMatch(final, /earlier part cut/);
});

test("L80 threads and `/compact <consigne>`: summarised in their own thread, the owner's words guide the summary", async () => {
  const bot = await fresh("Fil");
  const head = rows.append(bot, { kind: "message", role: "user", text: "Sujet du fil" }, 0);
  const thread = head.seq;
  history.replace(bot.id, bot.generation, Array.from({ length: 6 }, (_, i) => bigTurn(i, 500)).flat(), thread);
  history.replace(bot.id, bot.generation, bigTurn(99, 10), 0);
  assert.deepEqual(compactCommand("/compact garde bien les montants"), { instruction: "garde bien les montants" });
  assert.deepEqual(compactCommand("/résumer"), { instruction: "" });
  assert.equal(compactCommand("compact this"), null);
  prompts.length = 0;
  const sent = await call("POST", `/bots/${bot.id}/messages`, { text: "/compact garde bien les montants", thread });
  assert.equal(sent.status, 200);
  await until(() => history.load(bot.id, bot.generation, thread)[0]?.content.some((b: any) => b.type === "text" && /Automatic summary/.test(b.text)), "thread summarised");
  assert.match(prompts.find((x) => x.kind === "summary")!.text, /The user asked for this summary with these words .*"garde bien les montants"/);
  assert.equal(history.load(bot.id, bot.generation, 0).length, 2, "the main chat is untouched");
  await until(() => rows.list(bot.id, bot.generation, 50, undefined, thread).some((r) => r.body.kind === "notice" && /J.ai résumé/.test(r.body.text)), "notice in the thread");
  assert.ok(!prompts.some((x) => x.kind === "turn" && /\/compact/.test(x.text)), "the command never reaches the model as a message");
  // Too short: said plainly.
  const small = await fresh("Court");
  await call("POST", `/bots/${small.id}/messages`, { text: "/compact" });
  await until(() => rows.list(small.id, small.generation, 50).some((r) => r.body.kind === "notice" && /Rien à résumer/.test(r.body.text)), "nothing-to-do notice");
});

test("L80 résumé à chaud: a long conversation quiet for 15 minutes is due; a recent or short one is not", async () => {
  const bot = await fresh("Repos");
  history.replace(bot.id, bot.generation, Array.from({ length: 40 }, (_, i) => bigTurn(i, 9000)).flat());
  rows.append(bot, { kind: "message", role: "user", text: "dernier message" }, 0);
  const now = Date.now();
  assert.equal(restDue(now, 0.01).some((d) => d.bot.id === bot.id), false, "just written: not yet");
  assert.ok(restDue(now + 16 * 60_000, 0.01).some((d) => d.bot.id === bot.id && d.thread === 0), "quiet: due");
  assert.equal(restDue(now + 16 * 60_000, 50).some((d) => d.bot.id === bot.id), false, "under the share of the limit: not due");
});

// ── L132 ─────────────────────────────────────────────────────────────────────
test("L132 « Réponses courtes »: numbered rules, channels, off by default (prompt unchanged), the channel of the message", async () => {
  const bot = await fresh("Court2");
  const u = users.byId(userId)!;
  const extras = { connectorNames: [], browser: false, shell: false };
  rows.append(bot, { kind: "message", role: "user", text: "depuis le web" }, 0); // the prompt follows the language of the last message: same rows on both sides
  const before = buildSystemPrompt(bots.byId(bot.id)!, u, extras);
  assert.deepEqual(shortReplies(bot.id), { enabled: false, maxSentences: 3, maxWords: 60, channels: ["telegram", "voice"] });
  assert.doesNotMatch(before, /Short replies/);
  assert.equal((await call("PUT", `/bots/${bot.id}/short-replies`, { maxSentences: 0 })).status, 400);
  assert.equal((await call("PUT", `/bots/${bot.id}/short-replies`, { channels: ["sms"] })).status, 400);
  const on = await call("PUT", `/bots/${bot.id}/short-replies`, { enabled: true, maxSentences: 2, maxWords: 40, channels: ["telegram"] });
  assert.deepEqual(on.json, { enabled: true, maxSentences: 2, maxWords: 40, channels: ["telegram"] });
  assert.equal(turnChannel(bot.id), "web");
  assert.equal(buildSystemPrompt(bots.byId(bot.id)!, u, extras), before, "web is not chosen: nothing changes");
  await sleep(5);
  rows.append(bot, { kind: "message", role: "user", text: "depuis Telegram" }, 0);
  noteChannel(bot.id, "telegram");
  assert.equal(turnChannel(bot.id), "telegram");
  const p = buildSystemPrompt(bots.byId(bot.id)!, u, extras);
  assert.match(p, /## Short replies \(the owner's setting; this message came from Telegram\)\nAnswer in at most 2 sentences and at most 40 words/);
  assert.ok(p.indexOf("Short replies") > p.indexOf("## Right now"), "in the per-turn part (the cached part stays the same)");
  await sleep(1600);
  rows.append(bot, { kind: "message", role: "user", text: "de nouveau sur le web" }, 0);
  assert.equal(turnChannel(bot.id), "web", "a later web message is the web again");
  rows.append(bot, { kind: "message", role: "user", text: "à voix haute", origin: { kind: "voice", id: "", name: "Voice" } } as any, 0);
  assert.equal(turnChannel(bot.id), "voice");
  assert.match(shortRepliesLine(bot.id, "voice"), /^$/, "voice not chosen");
  await call("PUT", `/bots/${bot.id}/short-replies`, { channels: ["voice", "web"] });
  assert.match(shortRepliesLine(bot.id), /came from a voice call \(it is read aloud\)/);
});

test("teardown: no turn left running", async () => {
  for (const b of bots.list(userId)) await until(() => !loop.isBusy(b.id), "idle");
});
