import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Mémoire, vague L67–L138 : apprentissage réactif (L67), recherche plein texte dans les conversations (L73), résumés
// vérifiés (L80), fiche sur moi et « Ne rien retenir » (L88), « Ce que reçoit ce bot » (L137), jauge et « Voir le résumé »
// (L138), mémoire par le sens en option (L71). Chaque défaut a d'abord été reproduit ici (test rouge), puis corrigé.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-memctx-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "ctx:r";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.AUX_MODEL;
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;
delete process.env.OPENAI_API_KEY;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const memory = await import("../src/agent/memory.js");
const { isCorrection, learningDue, LEARN_EVERY_TURNS, consolidate, compactIfNeeded, summaryProblems, SUMMARY_SECTIONS } = memory;
const { searchMessages, messagesAround, fullTextIndex, conversationSearchAnswer } = await import("../src/convsearch.js");
const { memoryPrefs, summaries } = await import("../src/agent/memoryprefs.js");
const { fuseRankings, searchNotes } = await import("../src/agent/recall.js");
const { searchNotesSmart, embedderFor, cosine } = await import("../src/agent/semantic.js");
const { splitPrompt } = await import("../src/agent/promptview.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { bots, users, memories, rows, history } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { TurnRequest, TurnResult, Block } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";
import type { PromptView, ConversationSummary, SemanticSetting } from "../src/memorytypes.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── A scripted model: turns echo or run `call T {json}`; side requests answer by kind ─────────────────────────────
const sidePrompts: { kind: "learn" | "summary"; text: string }[] = [];
let learnAnswer = '{"facts": []}';
let summaryAnswers: string[] = [];
const turns: string[] = [];
const GOOD_SUMMARY = SUMMARY_SECTIONS.map((h) => `## ${h}\nJ'ai noté les points importants de cette partie : la cliente Camille, le devis 4521 et la réunion du 2026-11-30.`).join("\n");
registerProvider({
  id: "ctx", label: "Scripted", models: ["r"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const all = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n")).join("\n---\n");
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    if (!req.tools.length) {
      const kind = /in exactly these sections/.test(all) ? "summary" : "learn";
      sidePrompts.push({ kind, text: all });
      const text = kind === "summary" ? summaryAnswers.shift() ?? "" : learnAnswer;
      return { content: [{ type: "text", text }], stopReason: "end", model: "r", usage };
    }
    turns.push(all);
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const m = /call (\w+) (\{.*\})/s.exec(said);
    let content: Block[];
    if (results.length) content = [{ type: "text", text: `Tool said: ${results.map((r) => (r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join(" ")}` }];
    else if (m) content = [{ type: "tool_use", id: `call_${turns.length}`, name: m[1], input: JSON.parse(m[2]) }];
    else content = [{ type: "text", text: "ok" }];
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "r", usage };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown, jar?: { cookie: string }) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar ? jar.cookie : cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) { if (jar) jar.cookie = set.split(";")[0]; else cookie = set.split(";")[0]; }
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const fresh = async (name: string): Promise<Bot> => (await call("POST", "/bots", { name })).json.bot;
const user = (id: string, text: string, extra: Record<string, unknown> = {}) => rows.append(bots.byId(id)!, { kind: "message", role: "user", text, ...extra } as any, 0);
const reply = (id: string, text: string) => rows.append(bots.byId(id)!, { kind: "message", role: "assistant", text }, 0);
const other = { cookie: "" };
let userId = "";

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "memctx@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("memctx@example.com")!.id;
  assert.equal((await call("POST", "/auth/signup", { email: "memctx-other@example.com", password: "password-1", locale: "fr" }, other)).status, 200);
});

// ── L67 ──────────────────────────────────────────────────────────────────────
test("L67: correction words (French and English) are recognised; ordinary messages are not", () => {
  for (const t of ["Non, je t'ai dit que la réunion est le mardi.", "Je te l'ai déjà dit : pas de vouvoiement.", "C'est faux, mon associé s'appelle Karim.", "À partir de maintenant, écris-moi en anglais.",
    "Dorénavant envoie le rapport le vendredi", "No, I told you I use Outlook.", "From now on, keep replies short.", "non je t’ai dit 14 h", "That's not what I said."])
    assert.equal(isCorrection(t), true, t);
  for (const t of ["Peux-tu résumer ce document ?", "Merci, c'est parfait.", "Non merci.", "Tell me about the weather.", "Je t'envoie le fichier."])
    assert.equal(isCorrection(t), false, t);
});

test("L67: a correction makes learning due at once, before the quiet time; 20 turns too; never the bot's words or a routine's", async () => {
  const fix = await fresh("Correction"), chat = await fresh("Bavard"), many = await fresh("Vingt"), botSays = await fresh("Echo"), routine = await fresh("Routine");
  user(fix.id, "Bonjour, prépare le planning.");
  user(fix.id, "Non, je t'ai dit que je ne travaille pas le mercredi.");
  for (let i = 0; i < 5; i++) user(chat.id, `Message ordinaire numéro ${i}`);
  for (let i = 0; i < LEARN_EVERY_TURNS; i++) user(many.id, `Point ${i} de la liste`);
  user(botSays.id, "Prépare le planning.");
  reply(botSays.id, "Non, je t'ai dit que c'était impossible.");
  user(routine.id, "Non, je t'ai dit de tout envoyer.", { origin: { kind: "routine", id: "r1", name: "Matin" } });
  // Before L67: only bots quiet for CONSOLIDATE_IDLE_MIN (10 min) were due — none of these, all written just now.
  const due = new Map(learningDue(Date.now() - 10 * 60_000).map((d) => [d.id, d.reason]));
  assert.equal(due.get(fix.id), "correction");
  assert.equal(due.get(many.id), "turns");
  assert.equal(due.has(chat.id), false, "5 ordinary messages: wait for quiet");
  assert.equal(due.has(botSays.id), false, "a correction in the bot's own reply never counts");
  assert.equal(due.has(routine.id), false, "a routine's words never count");
  // Quiet bots stay due as before.
  assert.equal(new Map(learningDue(Date.now() + 1000).map((d) => [d.id, d.reason])).get(chat.id), "quiet");

  // The learning pass reads the user's words with their dates, and asks for real dates; the bot's reply is not sent.
  reply(fix.id, "Bien noté, je retire le mercredi.");
  sidePrompts.length = 0;
  learnAnswer = JSON.stringify({ facts: [{ text: "L'utilisateur ne travaille pas le mercredi.", quote: "je ne travaille pas le mercredi" }] });
  const r = await consolidate(bots.byId(fix.id)!);
  assert.deepEqual(r.added, ["L'utilisateur ne travaille pas le mercredi."]);
  const p = sidePrompts.find((s) => s.kind === "learn")!.text;
  assert.match(p, /\[\d{4}-\d{2}-\d{2}\] Non, je t'ai dit/);
  assert.match(p, /Never keep a relative date/);
  assert.doesNotMatch(p, /je retire le mercredi/, "never from the bot's words");
  assert.equal(learningDue(Date.now() - 10 * 60_000).some((d) => d.id === fix.id), false, "learned: no longer due");
  learnAnswer = '{"facts": []}';
});

// ── L73 ──────────────────────────────────────────────────────────────────────
test("L73: full-text index, accents folded, best first, date filter, messages around, never another account", async () => {
  assert.equal(fullTextIndex(), true, "FTS5 is available in node:sqlite");
  const b = await fresh("Archives FTS");
  user(b.id, "Le budget de la cantine est voté.");
  const hit = user(b.id, "Réunion du budget lundi à 10 h avec Camille, devis A-4521.");
  user(b.id, "Une autre réunion, sans rapport.");
  reply(b.id, "J'ai noté les factures de novembre.");
  // Every message is in the index (kept by triggers).
  const indexed = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM rows_fts_map m JOIN rows r ON r.bot_id = m.bot_id AND r.generation = m.generation AND r.seq = m.seq WHERE r.bot_id = ?", b.id)!.n;
  assert.equal(indexed, 4);
  let hits = searchMessages(userId, "reunion budget", { botId: b.id });
  assert.equal(hits.length, 3);
  assert.match(hits[0].snippet, /^Réunion du budget lundi/);
  assert.equal(searchMessages(userId, "facture", { botId: b.id })[0].role, "assistant");
  // A piece of a reference still found (the plain scan behind the index).
  assert.equal(searchMessages(userId, "452", { botId: b.id }).length, 1);
  // An edited message is searched by its new words.
  rows.rewrite(bots.byId(b.id)!, bots.byId(b.id)!.generation, hit.seq, { kind: "message", role: "user", text: "Réunion déplacée au jeudi avec Camille." });
  assert.equal(searchMessages(userId, "jeudi", { botId: b.id }).length, 1);
  assert.equal(searchMessages(userId, "lundi", { botId: b.id }).length, 0);
  // Date filter: an old message is outside a recent range.
  const old = user(b.id, "Réunion budget de l'an dernier.");
  q.run("UPDATE rows SET created_at = ? WHERE bot_id = ? AND seq = ?", Date.UTC(2025, 0, 15), b.id, old.seq);
  assert.equal(searchMessages(userId, "budget", { botId: b.id, since: Date.UTC(2026, 0, 1) }).some((h) => h.seq === old.seq), false);
  assert.deepEqual(searchMessages(userId, "budget", { botId: b.id, since: Date.UTC(2025, 0, 1), until: Date.UTC(2025, 1, 1) }).map((h) => h.seq), [old.seq]);
  const viaRoute = await call("GET", `/search?q=budget&since=2025-01-15&until=2025-01-15`);
  assert.deepEqual(viaRoute.json.hits.map((h: any) => h.seq), [old.seq], "the search box's date filter (the end day included)");
  // Messages around a hit: before and after, in order, the hit marked.
  const around = messagesAround(userId, b.id, bots.byId(b.id)!.generation, hit.seq, 1)!;
  assert.deepEqual(around.map((m) => [m.seq, m.hit]), [[hit.seq - 1, false], [hit.seq, true], [hit.seq + 1, false]]);
  assert.equal((await call("GET", `/bots/${b.id}/around?seq=${hit.seq}&count=2`)).json.messages.length, 4, "one before (the first message), the hit, two after");
  // Never another account's.
  assert.equal(messagesAround(users.byEmail("memctx-other@example.com")!.id, b.id, 0, hit.seq), null);
  assert.equal((await call("GET", `/bots/${b.id}/around?seq=${hit.seq}`, undefined, other)).status, 404);
  assert.equal(searchMessages(users.byEmail("memctx-other@example.com")!.id, "reunion budget").length, 0);
  // The tool: numbers on each hit, a date range, and « around ».
  const t = conversationSearchAnswer(userId, b.id, { query: "reunion", since: "2026-01-01" });
  assert.match(t.content, /\[#\d+ · [^\]]+· user\] Réunion déplacée/);
  assert.doesNotMatch(t.content, /an dernier/);
  assert.match(conversationSearchAnswer(userId, b.id, { query: "", around_seq: hit.seq, count: 1 }).content, /→ \[#\d+ ·[^\]]+\] Réunion déplacée/);
  await say(b.id, `call conversation_search {"query":"x","around_seq":${hit.seq},"count":1}`);
  await idle(b.id);
  assert.ok(turns.some((x) => x.includes("→ [#") && x.includes("Réunion déplacée")));
});

// ── L80 / L138 ───────────────────────────────────────────────────────────────
const fillHistory = (botId: string, n = 8) => {
  const bot = bots.byId(botId)!;
  for (let i = 0; i < n; i++) {
    history.append(botId, bot.generation, { role: "user", content: [{ type: "text", text: `Question ${i} : ${"détail ".repeat(400)}` }] });
    history.append(botId, bot.generation, { role: "assistant", content: [{ type: "text", text: `Réponse ${i} : ${"contenu ".repeat(400)}` }] });
  }
};

test("L80: the summary is checked (all sections, not empty, shorter, no secret)", () => {
  assert.deepEqual(summaryProblems(GOOD_SUMMARY, 100_000), []);
  assert.match(summaryProblems("Résumé : on a parlé de beaucoup de choses.", 100_000).join(), /missing sections/);
  assert.match(summaryProblems(GOOD_SUMMARY.replace("## Decisions made\n", ""), 100_000).join(), /Decisions made/);
  assert.match(summaryProblems(GOOD_SUMMARY, 500).join(), /not shorter/);
  assert.match(summaryProblems(`${GOOD_SUMMARY}\nClé : sk-ant-api03-${"x".repeat(40)}`, 100_000).join(), /password or a key/);
});

test("L80/L138: before summarising, a quiet learning pass; a refused summary is asked again; a visible line; « Voir le résumé »", async () => {
  const b = await fresh("Résumeur");
  fillHistory(b.id);
  user(b.id, "Retiens que mon associé s'appelle Karim.");
  assert.equal((await call("GET", `/bots/${b.id}/summary`)).json.summary, null);
  sidePrompts.length = 0;
  summaryAnswers = ["Résumé trop court.", GOOD_SUMMARY];
  const before = history.load(b.id, bots.byId(b.id)!.generation).length;
  const r = await compactIfNeeded(bots.byId(b.id)!, true);
  assert.equal(r.changed, true);
  assert.deepEqual(sidePrompts.map((s) => s.kind), ["learn", "summary", "summary"], "learning first, then the summary asked twice");
  assert.match(sidePrompts[2].text, /were refused \(missing sections/);
  const h = history.load(b.id, bots.byId(b.id)!.generation);
  assert.ok(h.length < before);
  assert.match(JSON.stringify(h[0]), /## Who the user is/);
  const line = rows.list(b.id, bots.byId(b.id)!.generation, 50).find((x: Row) => x.body.kind === "notice" && /résumé le début/.test(x.body.text));
  assert.ok(line, "a visible line in the chat");
  const s = (await call("GET", `/bots/${b.id}/summary`)).json.summary as ConversationSummary;
  assert.equal(s.summary, GOOD_SUMMARY);
  assert.equal(s.flushed, true);
  assert.equal((await call("GET", `/bots/${b.id}/summary`, undefined, other)).status, 404);
});

test("L80: two refused summaries replace nothing (the conversation stays whole) and say why", async () => {
  const b = await fresh("Prudent");
  fillHistory(b.id);
  const before = JSON.stringify(history.load(b.id, bots.byId(b.id)!.generation));
  summaryAnswers = ["Rien.", "Toujours rien."];
  await assert.rejects(() => compactIfNeeded(bots.byId(b.id)!, true), /failed its check/);
  assert.equal(JSON.stringify(history.load(b.id, bots.byId(b.id)!.generation)), before);
  assert.equal(summaries.latest(b.id, bots.byId(b.id)!.generation), null);
});

// ── L88 ──────────────────────────────────────────────────────────────────────
test("L88: « Ne rien retenir » stops learning and memory_save (an explicit « retiens » still works)", async () => {
  const b = await fresh("Discret");
  assert.equal((await call("PUT", `/bots/${b.id}/memory-prefs`, { noLearn: true })).json.noLearn, true);
  assert.equal((await call("PUT", `/bots/${b.id}/memory-prefs`, { noLearn: true }, other)).status, 404);
  user(b.id, "Je préfère les réunions le matin.");
  sidePrompts.length = 0;
  learnAnswer = JSON.stringify({ facts: [{ text: "Préfère les réunions le matin.", quote: "Je préfère les réunions le matin" }] });
  const r = await consolidate(bots.byId(b.id)!);
  assert.deepEqual(r.added, []);
  assert.equal(sidePrompts.length, 0, "no model call at all");
  await say(b.id, 'call memory_save {"text":"Aime le thé vert"}');
  await idle(b.id);
  assert.equal(memories.list(b.id).length, 0);
  assert.ok(turns.some((x) => x.includes("Ne rien retenir")));
  await say(b.id, 'Retiens ceci. call memory_save {"text":"Son chat s\'appelle Pixel"}');
  await idle(b.id);
  assert.deepEqual(memories.list(b.id).map((m) => m.text), ["Son chat s'appelle Pixel"]);
  memoryPrefs.setNoLearn(b.id, false);
  learnAnswer = '{"facts": []}';
});

test("L88: « Ajouter à ma fiche » puts a note in the shared profile every bot reads (owner only, once)", async () => {
  const a = await fresh("Appris"), other2 = await fresh("Autre");
  const note = memories.add(a.id, "Fuseau horaire : Europe/Lisbonne", "chat");
  assert.equal((await call("POST", `/memories/${note.id}/to-profile`, undefined, other)).status, 404);
  const r = await call("POST", `/memories/${note.id}/to-profile`);
  assert.equal(r.status, 200);
  assert.match(r.json.profile.preferences, /- Fuseau horaire : Europe\/Lisbonne/);
  assert.equal((await call("POST", `/memories/${note.id}/to-profile`)).json.already, true);
  const prompt = buildSystemPrompt(bots.byId(other2.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.match(prompt, /About the user \(shared profile[^\n]*\n[\s\S]*Europe\/Lisbonne/);
});

// ── L137 ─────────────────────────────────────────────────────────────────────
test("L137: « Ce que reçoit ce bot »: the parts in order, each with its size; what it sees of its memory and the cost", async () => {
  const b = await fresh("Transparent");
  for (let i = 0; i < 3; i++) memories.add(b.id, `Note numéro ${i} sur le projet Orion`, "chat");
  const v = (await call("GET", `/bots/${b.id}/prompt-view`)).json as PromptView;
  assert.equal(v.parts[0].title, "Who the bot is");
  assert.equal(v.parts[0].kind, "fixed");
  const titles = v.parts.map((p) => p.title);
  assert.ok(titles.indexOf("How you work") > 0);
  const mem = v.parts.find((p) => p.title === "What you remember")!;
  assert.equal(mem.kind, "turn");
  assert.match(mem.text, /projet Orion/);
  assert.equal(v.totalChars, v.parts.reduce((n, p) => n + p.chars, 0));
  assert.equal(v.parts[0].tokens, Math.ceil(v.parts[0].chars / 4));
  assert.deepEqual([v.memory.total, v.memory.shown, v.memory.hidden], [3, 3, 0]);
  assert.ok(v.memory.tokens > 0);
  assert.equal(typeof v.context.percent, "number");
  assert.equal(v.profileShared, true, "the profile filled by the previous test");
  assert.equal((await call("GET", `/bots/${b.id}/prompt-view`, undefined, other)).status, 404);
  // splitPrompt keeps every character of every part.
  const prompt = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.equal(splitPrompt(prompt).every((p) => prompt.includes(p.text)), true);
});

// ── L71 ──────────────────────────────────────────────────────────────────────
test("L71: off by default; keyword search unchanged; switching on needs a provider the account already has", async () => {
  const b = await fresh("Sens");
  memories.add(b.id, "Sa voiture est une Clio grise", "chat");
  const s0 = (await call("GET", "/memory/semantic")).json as SemanticSetting;
  assert.deepEqual(s0, { enabled: false, provider: null, model: null });
  assert.equal((await call("PUT", "/memory/semantic", { enabled: true })).status, 400, "no OpenAI or Mistral key: refused, nothing sent anywhere");
  const smart = await searchNotesSmart(bots.byId(b.id)!, "ma Clio");
  assert.equal(smart.semantic, false);
  assert.equal(smart.content, searchNotes(b.id, "ma Clio").content);
});

test("L71: fusion of the two rankings; with the option on, « ma voiture » finds « la Clio »", async () => {
  assert.deepEqual(fuseRankings(["a", "b", "c"], ["c", "d"]), ["c", "a", "b", "d"], "in both lists first; at equal score the keyword order");
  assert.deepEqual(fuseRankings([], ["x"]), ["x"]);
  assert.ok(Math.abs(cosine([1, 0], [1, 0]) - 1) < 1e-9);
  // A fake embeddings endpoint on OpenAI's address (no network): vectors by topic.
  const sent: string[][] = [];
  const topic = (t: string) => (/voiture|clio|auto/i.test(t) ? [1, 0, 0] : /chat|pixel/i.test(t) ? [0, 1, 0] : [0, 0, 1]);
  registerProvider({ id: "fakeemb", label: "OpenAI (test)", models: [], available: () => true, baseUrl: "https://api.openai.com/v1",
    async embed(_model: string, input: string[]) { sent.push(input); return { vectors: input.map(topic), inputTokens: input.length }; },
    async runTurn(): Promise<TurnResult> { throw new Error("not for turns"); } } as any);
  assert.equal(embedderFor(userId)?.model, "text-embedding-3-small");
  const b = await fresh("Sens 2");
  memories.add(b.id, "Sa Clio grise est au garage jusqu'au 2026-12-02", "chat");
  memories.add(b.id, "Son chat s'appelle Pixel", "chat");
  const bot = bots.byId(b.id)!;
  assert.equal((await searchNotesSmart(bot, "ma voiture")).count, 0, "off: nothing sent, keywords alone find nothing");
  assert.equal(sent.length, 0);
  const on = (await call("PUT", "/memory/semantic", { enabled: true })).json as SemanticSetting;
  assert.deepEqual(on, { enabled: true, provider: "OpenAI (test)", model: "text-embedding-3-small" });
  const r = await searchNotesSmart(bot, "ma voiture");
  assert.equal(r.semantic, true);
  assert.match(r.content, /Clio grise[^\n]*found by meaning/);
  assert.doesNotMatch(r.content, /Pixel/);
  // Vectors are kept: a second search sends only the query.
  sent.length = 0;
  await searchNotesSmart(bot, "mon auto");
  assert.deepEqual(sent, [["mon auto"]]);
  await call("PUT", "/memory/semantic", { enabled: false });
});
