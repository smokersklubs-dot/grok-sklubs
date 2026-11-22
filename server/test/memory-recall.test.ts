import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Ranked memory recall (agent/recall.ts): keyword ranking (BM25, French + English), memory_search, and the automatic
// recall before a turn. No model is registered here: nothing in this file may call one.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-recall-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
// A small prompt budget, so that some notes do not fit in the prompt and recall has something to add.
process.env.PROMPT_MEMORY_CHARS = "300";
delete process.env.MAX_BOTS;

const recall = await import("../src/agent/recall.js");
const { rankNotes, tokenize, stem, searchNotes, recallForTurn, recallLines, RECALL_TOP_K, RECALL_CHAR_BUDGET, RECALL_MIN_RELEVANCE, UNCERTAIN_MARK } = recall;
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { bots, users, memories, rows, settings, auditList } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { Memory } from "../src/shared.js";

const DAY = 86400_000;
const NOW = Date.UTC(2026, 10, 22);
let n = 0;
const note = (text: string, extra: Partial<Memory> = {}): Memory => ({ id: `n${++n}`, botId: "b", text, source: "chat", createdAt: NOW - DAY, status: "active", quote: "", category: null, confidence: "once", confirmedAt: null, lastUsedAt: null, ...extra });
const texts = (r: { note: { text: string } }[]) => r.map((x) => x.note.text);

const alice = users.create("alice-recall@example.test", "Alice", "x", "fr");
const bruno = users.create("bruno-recall@example.test", "Bruno", "x", "fr");
const newBot = (userId: string, name: string) => bots.create(userId, { name });
const said = new Map<string, string>();
const say = (botId: string, text: string, origin?: { kind: "routine" | "webhook" | "bot"; id: string; name: string }) => { if (!origin) said.set(botId, text); return rows.append(bots.byId(botId)!, { kind: "message", role: "user", text, ...(origin ? { origin } : {}) }, 0); };
/**
 * The ranking, budget and filters of the recall, for the words the user just typed (given directly). Which turns get a
 * recall at all — only the user's own, in a real turn — is tested through the real queue in memory-fixes.test.ts.
 */
const recallFor = (bot: Parameters<typeof recallForTurn>[0], opts: Parameters<typeof recallForTurn>[1] = {}) => recallForTurn(bot, { message: said.get(bot.id) ?? "", ...opts });
const age = (id: string, days: number) => q.run("UPDATE memories SET created_at = ? WHERE id = ?", Date.now() - days * DAY, id);
const usageRows = () => q.get<{ c: number }>("SELECT COUNT(*) AS c FROM usage")!.c;
const recallLog = (userId: string) => auditList(userId, undefined, 200).filter((e) => e.text.startsWith("Notes recalled"));
const EXTRAS = { connectorNames: [], browser: false, shell: false };
/** Filler notes with no word in common with the test queries. */
const filler = (botId: string, count: number, word = "zzfiller") => { for (let i = 0; i < count; i++) memories.add(botId, `${word} numero ${i} sans rapport`, "chat"); };

test("words: accents, elisions and plurals are folded, small words dropped", () => {
  assert.deepEqual(tokenize("L'adresse de la Référence"), ["adress", "referenc"]);
  assert.deepEqual(tokenize("d’accord pour les Factures"), ["accord", "factur"]);
  assert.equal(stem("factures"), stem("facture"));
  assert.equal(stem("journaux"), stem("journal"));
  assert.equal(stem("bureaux"), stem("bureau"));
  assert.equal(stem("invoices"), stem("invoice"));
  assert.equal(stem("companies"), stem("company"));
  assert.equal(stem("boxes"), stem("box"));
  assert.deepEqual(tokenize("the and of le la les des"), []);
  // An English possessive is not a French elision; a number is kept.
  assert.deepEqual(tokenize("Dupont's 30 days"), ["dupont", "30", "day"]);
});

test("ranking: French, accents and plurals, other wording sharing the key terms", () => {
  const notes = [
    note("Le client Dupont règle ses factures à 30 jours."),
    note("Préfère les réponses courtes le matin."),
    note("Le logo doit rester en vert foncé."),
    note("La référence du contrat d'électricité est EL-2291."),
    note("Travaille depuis Lyon le vendredi."),
  ];
  // Singular, no accent, another sentence.
  let r = rankNotes(notes, "Prépare la relance de la facture Dupont", { now: NOW });
  assert.equal(r[0].note.text, notes[0].text);
  assert.deepEqual(r[0].matched.sort(), ["dupont", "facture"]);
  assert.equal(r.length, 1, "notes that share no word are not returned");
  r = rankNotes(notes, "quelle est la reference de l'electricite ?", { now: NOW });
  assert.equal(r[0].note.text, notes[3].text);
  r = rankNotes(notes, "des logos verts", { now: NOW });
  assert.equal(r[0].note.text, notes[2].text);
  // No shared word at all (a synonym): not found — this is keyword-based.
  assert.deepEqual(rankNotes(notes, "paiement des devis", { now: NOW }), []);
  assert.deepEqual(rankNotes(notes, "le la les de", { now: NOW }), [], "only small words: nothing to look for");
});

test("ranking: English, and the more specific note first", () => {
  const notes = [
    note("The user prefers short emails."),
    note("Invoices for Acme are sent on the first Monday of the month."),
    note("The Acme contact is Maria from accounting."),
    note("Standup meetings are at 9:30 on weekdays."),
    note("Uses a company laptop for travel."),
  ];
  let r = rankNotes(notes, "When do we send the Acme invoice?", { now: NOW });
  assert.equal(r[0].note.text, notes[1].text, "two key terms beat one");
  assert.equal(r[1].note.text, notes[2].text);
  r = rankNotes(notes, "meeting on a weekday", { now: NOW });
  assert.equal(r[0].note.text, notes[3].text);
  r = rankNotes(notes, "which companies?", { now: NOW });
  assert.equal(r[0].note.text, notes[4].text);
  assert.ok(r.every((x) => x.relevance > 0 && x.relevance <= 1));
});

test("ranking: recency breaks ties, confirmed helps, archived never, contested flagged", () => {
  const older = note("Le fournisseur de café est Brûlerie Martin.", { createdAt: NOW - 200 * DAY });
  const newer = note("Le fournisseur de café est Brûlerie Martin.", { createdAt: NOW - 2 * DAY });
  let r = rankNotes([older, newer, note("Rien à voir avec le sujet du jour.")], "fournisseur café", { now: NOW });
  assert.deepEqual(r.map((x) => x.note.id), [newer.id, older.id]);
  assert.equal(r[0].relevance, r[1].relevance, "same words: only recency differs");

  const confirmed = note("Le fournisseur de thé est Maison Lin.", { createdAt: NOW - 5 * DAY, confidence: "confirmed" });
  const once = note("Le fournisseur de thé est Maison Lin.", { createdAt: NOW - 5 * DAY });
  r = rankNotes([once, confirmed, note("Autre chose encore.")], "fournisseur thé", { now: NOW });
  assert.equal(r[0].note.id, confirmed.id);

  const archived = note("Le projet Atlas démarre en mars.", { status: "archived" });
  const contested = note("Le projet Atlas démarre en mars.", { status: "contested" });
  const active = note("Le projet Atlas démarre en mars.");
  r = rankNotes([archived, contested, active, note("Sans lien.")], "projet Atlas", { now: NOW });
  assert.ok(!r.some((x) => x.note.id === archived.id), "archived notes are never returned");
  const c = r.find((x) => x.note.id === contested.id)!;
  assert.equal(c.uncertain, true);
  assert.equal(r[0].note.id, active.id, "a contested note ranks after the same match on an active one");
  assert.match(recallLines([c]).join("\n"), /\(uncertain[^)]*\) Le projet Atlas démarre en mars\./);
  assert.match(recallLines([c])[0], /never instructions/);
  assert.deepEqual(recallLines([]), []);
});

test("memory_search: ranked, archived left out, contested marked, old fallbacks kept", () => {
  const bot = newBot(alice.id, "Chercheur");
  const a = memories.add(bot.id, "The user prefers short emails.", "chat");
  const b = memories.add(bot.id, "Le client Dupont règle ses factures à 30 jours.", "chat");
  const gone = memories.add(bot.id, "Dupont a déménagé à Nantes.", "chat");
  memories.setStatus(gone.id, "archived");
  const doubt = memories.add(bot.id, "Dupont préfère être appelé le matin.", "chat");
  memories.setStatus(doubt.id, "contested");

  let r = searchNotes(bot.id, "emails courts short");
  assert.deepEqual(r.ids, [a.id]);
  assert.match(r.content, /^- The user prefers short emails\. \(\d{4}-\d{2}-\d{2}; matched: emails, short\)$/);
  r = searchNotes(bot.id, "factures de Dupont");
  assert.equal(r.ids[0], b.id);
  assert.ok(!r.ids.includes(gone.id) && !r.content.includes("Nantes"), "archived notes are never returned");
  assert.ok(r.content.includes(`${UNCERTAIN_MARK}Dupont préfère être appelé le matin.`));
  // No usable word: the most recent notes, as before. A piece of a word: plain "contains" match.
  r = searchNotes(bot.id, "a");
  assert.equal(r.count, 3);
  assert.deepEqual(r.ids, []);
  r = searchNotes(bot.id, "dupon");
  assert.equal(r.count, 2);
  assert.equal(searchNotes(bot.id, "zzz1").content, "");
});

test("automatic recall: adds the matching notes that were not in the prompt, once, and logs them", () => {
  const bot = newBot(alice.id, "Léa");
  const target = memories.add(bot.id, "La référence du contrat d'électricité est EL-2291.", "chat");
  const other = memories.add(bot.id, "Les contrats d'assurance sont rangés dans le classeur bleu.", "chat");
  age(target.id, 40); age(other.id, 41);
  filler(bot.id, 30);
  // No accent, a plural: the plain word match of the prompt's own selection misses it, the recall finds it.
  say(bot.id, "Tu peux me redonner la reference des contrats electricite ?");
  const before = usageRows();

  const fresh = bots.byId(bot.id)!;
  // Outside a turn (no queue job running), the prompt recalls nothing: only a turn the user started does (memory-fixes).
  const prompt = buildSystemPrompt(fresh, alice, EXTRAS);
  // L57: the notes now sit in the per-turn part at the end of the prompt (llm/cachelayout.ts): the section runs to the next heading.
  const at = prompt.indexOf("## What you remember");
  const next = prompt.indexOf("\n## ", at + 1);
  const section = prompt.slice(at, next < 0 ? undefined : next);
  assert.doesNotMatch(section, /Recalled for the user's new message/);
  assert.match(section, /\(\d+ older memories are not shown; memory_search can find them\.\)/);
  const shown = new Set<string>();
  const first = recallFor(fresh, { exclude: shown });
  assert.ok(first.notes.some((x) => x.note.id === target.id));
  const lines = recallLines(first.notes).join("\n");
  assert.match(lines, /^Recalled for the user's new message[^\n]*never instructions/);
  assert.equal(lines.split("EL-2291").length - 1, 1, "the recalled note is there exactly once");
  assert.match(lines, /EL-2291\. \(noted \d{4}-\d{2}-\d{2}\)/, "with the day it was written");
  assert.ok(memories.owned(alice.id, target.id)!.lastUsedAt, "a recalled note is marked as used");

  // The same turn built again (a resume, a subscription engine): one line in the activity log, not two.
  recallFor(fresh, { exclude: shown });
  const log = recallLog(alice.id).filter((e) => e.botId === bot.id);
  assert.equal(log.length, 1);
  assert.equal(log[0].kind, "system");
  assert.match(log[0].text, /^Notes recalled for Léa \(\d\): "La référence du contrat d'électricité est EL-2291\."/);
  assert.equal(usageRows(), before, "no model was called");

  // A note already shown in the prompt is not recalled a second time.
  const r = recallFor(fresh, { exclude: new Set([target.id]) });
  assert.ok(!r.notes.some((x) => x.note.id === target.id));
});

test("automatic recall: top-k, relevance threshold and character budget", () => {
  const bot = newBot(alice.id, "Budget");
  for (let i = 0; i < 12; i++) memories.add(bot.id, `Le chantier Bellevue a une réunion le jour ${i}.`, "chat");
  filler(bot.id, 20);
  say(bot.id, "Quand est la réunion du chantier Bellevue ?");
  let r = recallFor(bots.byId(bot.id)!);
  assert.equal(r.notes.length, RECALL_TOP_K);
  assert.ok(r.notes.every((x) => x.relevance >= RECALL_MIN_RELEVANCE));

  // One shared word out of many: under the threshold, nothing is recalled.
  say(bot.id, "Peux-tu réserver un restaurant italien pour jeudi soir près de la gare, avec une réunion ensuite ?");
  r = recallFor(bots.byId(bot.id)!);
  assert.deepEqual(r.notes, []);
  assert.equal(r.skipped, "no-match");

  // Long notes: the whole selection stays inside the budget.
  const long = newBot(alice.id, "Long");
  for (let i = 0; i < 6; i++) memories.add(long.id, `Le dossier Montagne contient ${"beaucoup de détails utiles ".repeat(9)}(partie ${i}).`, "chat");
  filler(long.id, 10);
  say(long.id, "Parle-moi du dossier Montagne");
  r = recallFor(bots.byId(long.id)!);
  assert.ok(r.notes.length >= 1 && r.notes.length < RECALL_TOP_K);
  assert.ok(r.notes.reduce((sum, x) => sum + x.note.text.length + 3, 0) <= RECALL_CHAR_BUDGET);
});

test("automatic recall: nothing when switched off, for a bot without memory tools, or for a message the user did not type", () => {
  const bot = newBot(bruno.id, "Réglages");
  memories.add(bot.id, "Le mot d'ordre du projet Colibri est la simplicité.", "chat");
  filler(bot.id, 30);
  say(bot.id, "Rappelle-moi le mot d'ordre du projet Colibri");
  assert.equal(settings.memory(bruno.id).autoRecall, true, "on by default");
  assert.equal(recallFor(bots.byId(bot.id)!).notes.length, 1);

  settings.saveMemory(bruno.id, { autoRecall: false });
  assert.equal(settings.memory(bruno.id).autoRecall, false);
  assert.equal(settings.memory(bruno.id).autoCapture, true, "the other settings are untouched");
  const logBefore = recallLog(bruno.id).length;
  let r = recallFor(bots.byId(bot.id)!);
  assert.deepEqual([r.notes.length, r.skipped], [0, "setting-off"]);
  assert.doesNotMatch(buildSystemPrompt(bots.byId(bot.id)!, bruno, EXTRAS), /Recalled for the user's new message/);
  assert.equal(recallLog(bruno.id).length, logBefore);
  settings.saveMemory(bruno.id, { autoRecall: true });

  // The owner switched the memory tools off for this bot.
  bots.patch(bot.id, { disabledTools: ["memory"] });
  r = recallFor(bots.byId(bot.id)!);
  assert.deepEqual([r.notes.length, r.skipped], [0, "bot-memory-off"]);
  bots.patch(bot.id, { disabledTools: [] });
  assert.equal(recallFor(bots.byId(bot.id)!).notes.length, 1);

  // No turn of the user's is running (a routine's, a webhook's… or none): nothing is recalled, whatever the chat holds.
  say(bot.id, "Rappelle le mot d'ordre du projet Colibri", { kind: "webhook", id: "w1", name: "Hook" });
  r = recallForTurn(bots.byId(bot.id)!);
  assert.deepEqual([r.notes.length, r.skipped], [0, "no-user-message"]);
});

test("automatic recall: an empty memory takes the no-cost path", () => {
  const bot = newBot(bruno.id, "Vide");
  say(bot.id, "Bonjour, quoi de neuf sur le projet Colibri ?");
  const before = { usage: usageRows(), log: auditList(bruno.id, undefined, 200).length };
  const r = recallFor(bots.byId(bot.id)!);
  assert.deepEqual([r.notes.length, r.skipped], [0, "empty"]);
  const prompt = buildSystemPrompt(bots.byId(bot.id)!, bruno, EXTRAS);
  assert.doesNotMatch(prompt, /## What you remember|Recalled for/);
  assert.deepEqual({ usage: usageRows(), log: auditList(bruno.id, undefined, 200).length }, before);
  // Only archived notes: still empty.
  const m = memories.add(bot.id, "Le projet Colibri est terminé.", "chat");
  memories.setStatus(m.id, "archived");
  assert.equal(recallFor(bots.byId(bot.id)!).skipped, "empty");
});

test("automatic recall: never crosses bots or accounts", () => {
  const mine = newBot(alice.id, "Mien");
  const sibling = newBot(alice.id, "Voisin");
  const foreign = newBot(bruno.id, "Étranger");
  memories.add(sibling.id, "Le coffre Saphir se trouve au deuxième étage.", "chat");
  memories.add(foreign.id, "Le coffre Saphir contient les contrats signés.", "chat");
  const own = memories.add(mine.id, "Le coffre Saphir s'ouvre avec la clé rouge.", "chat");
  filler(mine.id, 30); filler(sibling.id, 30); filler(foreign.id, 30);
  for (const b of [mine, sibling, foreign]) say(b.id, "Où est le coffre Saphir ?");

  const r = recallFor(bots.byId(mine.id)!);
  assert.deepEqual(r.notes.map((x) => x.note.id), [own.id]);
  assert.ok(r.notes.every((x) => x.note.botId === mine.id));
  const prompt = buildSystemPrompt(bots.byId(mine.id)!, alice, EXTRAS);
  assert.doesNotMatch(prompt, /deuxième étage|contrats signés/);
  assert.ok(!searchNotes(mine.id, "coffre Saphir").content.match(/deuxième étage|contrats signés/));
  // The other account's bot sees only its own note, and its recall is logged in its own account only.
  const theirs = recallFor(bots.byId(foreign.id)!);
  assert.deepEqual(texts(theirs.notes), ["Le coffre Saphir contient les contrats signés."]);
  assert.ok(!recallLog(alice.id).some((e) => e.text.includes("contrats signés")));
  assert.ok(!recallLog(bruno.id).some((e) => e.text.includes("clé rouge")));
});

test("automatic recall: sensitive notes follow Settings → Memory; secrets never", () => {
  const carole = users.create("carole-recall@example.test", "Carole", "x", "fr");
  const bot = newBot(carole.id, "Discret");
  // Kept because the user asked explicitly (the category itself is not allowed in the settings).
  const health = memories.add(bot.id, "Carole est allergique aux arachides.", "chat", { category: "health" });
  const plain = memories.add(bot.id, "Carole déjeune souvent aux arachides grillées du marché.", "chat");
  // Stored without a category (an older note): the text itself is checked.
  const untagged = memories.add(bot.id, "Le médecin de Carole lui interdit les arachides.", "chat");
  const secret = memories.add(bot.id, "Le portail des arachides : mot de passe: Xk29!aa", "chat");
  filler(bot.id, 30);
  say(bot.id, "Un repas sans arachides ?");

  let ids = recallFor(bots.byId(bot.id)!).notes.map((x) => x.note.id);
  assert.ok(ids.includes(plain.id));
  assert.ok(!ids.includes(health.id) && !ids.includes(untagged.id), "health notes are not recalled while the topic is excluded");
  assert.ok(!ids.includes(secret.id));

  settings.saveMemory(carole.id, { allowSensitive: { health: true } });
  ids = recallFor(bots.byId(bot.id)!).notes.map((x) => x.note.id);
  assert.ok(ids.includes(health.id) && ids.includes(untagged.id), "allowed by the owner: recalled");
  assert.ok(!ids.includes(secret.id), "a secret is never recalled");
});

test("performance: ranking 5,000 notes", () => {
  const subjects = ["facture", "contrat", "client", "livraison", "réunion", "budget", "invoice", "meeting", "supplier", "planning", "voyage", "commande"];
  const places = ["Lyon", "Paris", "Nantes", "Lille", "Berlin", "Madrid", "Rome", "Oslo"];
  const notes: Memory[] = [];
  for (let i = 0; i < 5000; i++)
    notes.push(note(`Le ${subjects[i % subjects.length]} numéro ${i} concerne ${places[i % places.length]} et le dossier ${subjects[(i * 7) % subjects.length]}s du trimestre ${i % 4}.`, { createdAt: NOW - (i % 400) * DAY }));
  notes.push(note("La société Zéphyr livre les cartons le mardi."));
  rankNotes(notes.slice(0, 200), "échauffement", { now: NOW });
  const times: number[] = [];
  let top: ReturnType<typeof rankNotes> = [];
  for (let run = 0; run < 5; run++) {
    const t0 = performance.now();
    top = rankNotes(notes, "Quand la société Zephyr livre-t-elle les factures et les cartons de Lyon ?", { now: NOW, limit: 10 });
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  console.log(`[memory-recall] 5,001 notes ranked in ${times[2].toFixed(1)} ms (median of 5; fastest ${times[0].toFixed(1)} ms, slowest ${times[4].toFixed(1)} ms)`);
  assert.equal(top[0].note.text, "La société Zéphyr livre les cartons le mardi.");
  assert.ok(times[2] < 150, `ranking 5,000 notes took ${times[2].toFixed(1)} ms`);
});
