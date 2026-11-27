import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Mémoire (A-FAIRE L15, L16, L28 et audits mem0 / claude-mem) : anti-doublon, rappel sur les seuls tours de l'utilisateur
// (par le vrai chemin de la file), apprentissage sans perte, dates, « oublie ça », édition avec historique, « Annuler »
// qui rend la même note, recherche dans les conversations sans accents. Chaque défaut a d'abord été reproduit ici.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-memfix-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "rec:r";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
// A small prompt budget, so that some notes do not fit in the prompt and the recall has something to add.
process.env.PROMPT_MEMORY_CHARS = "300";
delete process.env.AUX_MODEL;
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { similar, consolidate, LEARN_BATCH, LEARN_UNREADABLE_LIMIT, importCandidates } = await import("../src/agent/memory.js");
const { pickMemories, buildSystemPrompt } = await import("../src/agent/prompt.js");
const { createRoom } = await import("../src/agent/team.js");
const { fireRoutine } = await import("../src/scheduler.js");
const { routines } = await import("../src/routines.js");
const { searchMessages } = await import("../src/convsearch.js");
const { interruptedTrigger } = await import("../src/agent/turn-request.js");
const { bots, users, memories, rows, settings, auditList } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ── A scripted model: turns echo (or run `call T {json}`), side requests (learning) answer `learnAnswer` ──────────
const turns: { system: string; all: string }[] = [];
const learnPrompts: string[] = [];
let learnAnswer = '{"facts": []}';
registerProvider({
  id: "rec", label: "Recorder", models: ["r"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const all = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n")).join("\n---\n");
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    if (!req.tools.length) { learnPrompts.push(all); return { content: [{ type: "text", text: learnAnswer }], stopReason: "end", model: "r", usage }; }
    turns.push({ system: req.system, all });
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
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const fresh = async (name: string): Promise<Bot> => (await call("POST", "/bots", { name })).json.bot;
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const recallLog = (userId: string) => auditList(userId, undefined, 200).filter((e) => e.text.startsWith("Notes recalled"));
/** The system prompt of the turn whose messages hold `marker`. */
const systemOf = async (marker: string) => (await until(() => turns.find((t) => t.all.includes(marker)), `turn "${marker}"`)).system;
const RECALLED = /Recalled for the user's new message/;
let userId = "";

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "memfix@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("memfix@example.com")!.id;
});

// ── L15 ──────────────────────────────────────────────────────────────────────
test("L15: two notes that differ by a name, a number or a day are two facts; real duplicates are still caught", () => {
  // Reproduced on 22/11 with the old Jaccard check: all four were `true`.
  assert.equal(similar("Le client Dupont paie toujours ses factures à 30 jours fin de mois", "Le client Durand paie toujours ses factures à 30 jours fin de mois"), false);
  assert.equal(similar("Le rapport hebdomadaire est envoyé le lundi matin à toute l'équipe", "Le rapport hebdomadaire est envoyé le vendredi matin à toute l'équipe"), false);
  assert.equal(similar("Le client Dupont paie ses factures à 30 jours fin de mois", "Le client Dupont paie ses factures à 45 jours fin de mois"), false);
  assert.equal(similar("Dupont paie toujours ses factures à 30 jours fin de mois", "Durand paie toujours ses factures à 30 jours fin de mois"), false);
  // The same fact, worded a little differently (accents, plural, one more word): still the same.
  assert.equal(similar("Le client Dupont paie toujours ses factures à 30 jours", "le client dupont paie ses factures a 30 jours"), true);
  assert.equal(similar("Travaille le samedi", "Travaille le samedi"), true);
  assert.equal(similar("The user prefers short emails in the morning", "The user prefers short emails in the mornings"), true);
  // One side only names the day: a less precise restatement, not a different fact.
  assert.equal(similar("Le rapport hebdomadaire part à toute l'équipe le lundi matin", "Le rapport hebdomadaire part à toute l'équipe le matin"), true);
});

test("L15: learning keeps Durand next to Dupont and does not confirm Dupont with a quote about Durand; import too", async () => {
  const b = await fresh("Doublons");
  const bot = bots.byId(b.id)!;
  const dupont = memories.add(b.id, "Le client Dupont paie toujours ses factures à 30 jours fin de mois.", "learned", { quote: "Dupont paie à 30 jours" });
  q.run("UPDATE memories SET created_at = created_at - 60000 WHERE id = ?", dupont.id);
  rows.append(bot, { kind: "message", role: "user", text: "Note aussi : Durand paie toujours à 30 jours fin de mois." });
  learnAnswer = JSON.stringify({ facts: [{ text: "Le client Durand paie toujours ses factures à 30 jours fin de mois.", quote: "Durand paie toujours à 30 jours fin de mois" }] });
  const r = await consolidate(bot);
  assert.deepEqual(r.added, ["Le client Durand paie toujours ses factures à 30 jours fin de mois."]);
  assert.equal(memories.owned(userId, dupont.id)!.confidence, "once", "the Dupont note was not confirmed by words about Durand");
  const prev = importCandidates(bot, "- Le client Martin paie toujours ses factures à 30 jours fin de mois.");
  assert.equal(prev[0].skip, null, "not a duplicate of Dupont or Durand");
  learnAnswer = '{"facts": []}';
});

// ── L28 ──────────────────────────────────────────────────────────────────────
test("L28: a long conversation is read in full, oldest first, in batches; each message goes with its day", async () => {
  const b = await fresh("Bavard");
  const bot = bots.byId(b.id)!;
  const start = Date.now() - 3 * 86400_000;
  for (let i = 1; i <= 130; i++) {
    const row = rows.append(bot, { kind: "message", role: "user", text: `Message numéro ${i} : rien de spécial.` });
    q.run("UPDATE rows SET created_at = ? WHERE bot_id = ? AND seq = ?", start + i * 1000, b.id, row.seq);
  }
  const before = learnPrompts.length;
  const r = await consolidate(bot);
  const sent = learnPrompts.slice(before).join("\n");
  assert.equal(r.considered, 130, "every message was read");
  assert.match(sent, /Message numéro 1 :/, "the oldest messages are read (the old code only read the 60 newest)");
  assert.match(sent, /Message numéro 130 :/);
  assert.equal(learnPrompts.length - before, Math.ceil(130 / LEARN_BATCH), "one model call per batch");
  assert.equal(q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", b.id)!.mark, start + 130_000);
  // Dates: today's, and the day of each message, with the rule on relative dates.
  assert.match(sent, new RegExp(`Today is ${new Date().toISOString().slice(0, 10)}`));
  assert.match(sent, new RegExp(`- \\[${new Date(start + 1000).toISOString().slice(0, 10)}\\] Message numéro 1 :`));
  assert.match(sent, /Never keep a relative date[^\n]*turn it into a real date/);
});

test("L28: an unreadable answer does not move the mark (the messages are read again); repeated, they are let go", async () => {
  const b = await fresh("Illisible");
  const bot = bots.byId(b.id)!;
  rows.append(bot, { kind: "message", role: "user", text: "Je travaille chez Zéphyr depuis mars." });
  const mark = () => q.get<{ mark: number }>("SELECT mark FROM consolidation WHERE bot_id = ?", b.id)?.mark ?? 0;
  learnAnswer = "Désolé, je ne peux pas répondre en JSON.";
  await consolidate(bot);
  assert.equal(mark(), 0, "the old code moved the mark here and the message was lost");
  learnAnswer = JSON.stringify({ facts: [{ text: "L'utilisateur travaille chez Zéphyr.", quote: "Je travaille chez Zéphyr" }] });
  const ok = await consolidate(bot);
  assert.deepEqual(ok.added, ["L'utilisateur travaille chez Zéphyr."], "read again, and learned");
  assert.ok(mark() > 0);
  // A model that never answers properly: after LEARN_UNREADABLE_LIMIT tries the batch is let go (no endless cost).
  rows.append(bot, { kind: "message", role: "user", text: "Encore un message." });
  learnAnswer = "pas du JSON";
  const at = mark();
  for (let i = 1; i < LEARN_UNREADABLE_LIMIT; i++) { await consolidate(bot); assert.equal(mark(), at); }
  await consolidate(bot);
  assert.ok(mark() > at);
  learnAnswer = '{"facts": []}';
});

test("L28: the prompt's own choice counts every note (past 500) and folds accents and plurals like the recall; each note shows its day", async () => {
  const b = await fresh("Cinq cents");
  const bot = bots.byId(b.id)!;
  for (let i = 0; i < 520; i++) memories.add(b.id, `zzremplissage numero ${i} sans rapport`, "chat");
  const target = memories.add(b.id, "La réunion du chantier Bellevue a lieu le jeudi.", "chat");
  q.run("UPDATE memories SET created_at = created_at + 1000 WHERE id = ?", target.id);
  rows.append(bot, { kind: "message", role: "user", text: "Quand sont les reunions de chantier ?" });
  const mem = pickMemories(bots.byId(b.id)!);
  assert.equal(mem.omitted, 521 - mem.lines.length, "the old code said 500 - shown");
  assert.equal(mem.full, true);
  assert.ok(mem.lines.some((l) => l.includes("chantier Bellevue")), "no accent, a plural: found (the old split missed it)");
  assert.match(mem.lines.find((l) => l.includes("Bellevue"))!, /jeudi\. \(noted \d{4}-\d{2}-\d{2}\)$/);
  const prompt = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.match(prompt, new RegExp(`\\(${521 - mem.lines.length} older memories are not shown`));
  assert.match(prompt, /Each note ends with the day it was written/);
});

// ── L16: the real queue, no faked origin ────────────────────────────────────
test("L16: the recall runs for the user's own message, and never for a routine, a webhook, a group chat, a teammate, a member, a program or a pick-up", async () => {
  const b = await fresh("Rappel");
  // More matching notes than the prompt budget holds: the prompt shows some, the recall adds the others.
  for (let i = 1; i <= 5; i++) {
    const m = memories.add(b.id, `Le contrat d'électricité numéro ${i} a la référence EL-229${i} chez le fournisseur.`, "chat");
    q.run("UPDATE memories SET created_at = created_at - ? WHERE id = ?", (40 + i) * 86400_000, m.id);
  }
  for (let i = 0; i < 20; i++) memories.add(b.id, `zzremplissage numero ${i} sans rapport`, "chat");

  // 1. The user types: recall, and one line in the activity log.
  await say(b.id, "Tu peux me redonner la reference des contrats electricite ? marqueur-user");
  await idle(b.id);
  assert.match(await systemOf("marqueur-user"), RECALLED);
  const logged = recallLog(userId).filter((e) => e.botId === b.id).length;
  assert.equal(logged, 1);
  // From here on, the user's typed message about electricity stays the newest of the chat (the old code recalled for it).
  const noRecall = async (marker: string, label: string) => {
    await idle(b.id);
    assert.doesNotMatch(await systemOf(marker), RECALLED, `${label}: no recall`);
    assert.equal(recallLog(userId).filter((e) => e.botId === b.id).length, logged, `${label}: nothing logged`);
  };

  // 2. A routine (scheduled), then a webhook routine with an outside payload.
  const r = routines.create(b.id, { name: "Relevé", prompt: "Vérifie la référence des contrats d'électricité. marqueur-routine", trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  assert.equal(fireRoutine(routines.byId(r.id)!), "fired");
  await noRecall("marqueur-routine", "routine");
  const hook = routines.create(b.id, { name: "Hook", prompt: "Traite l'appel. marqueur-webhook", trigger: "webhook" });
  assert.equal(fireRoutine(routines.byId(hook.id)!, { text: "référence contrat électricité" }, { outside: true }), "fired");
  await noRecall("marqueur-webhook", "webhook");

  // 3. A group chat: the owner posts in the room, the bot gets a system turn.
  const room = createRoom(userId, "Équipe", [b.id]);
  await say(room.id, "Quelle est la référence du contrat d'électricité ? marqueur-salon");
  await noRecall("marqueur-salon", "group chat");

  // 4. A teammate's message, a workspace member's, an outside program's (Bot API).
  loop.enqueue(b.id, { kind: "bot", fromName: "Ada", text: "Référence du contrat électricité ? marqueur-collegue", depth: 1 });
  await noRecall("marqueur-collegue", "teammate");
  loop.submitMemberMessage(bots.byId(b.id)!, "Référence du contrat électricité ? marqueur-membre", { id: "m1", name: "Paul", role: "editor", workspace: "Atelier" });
  await noRecall("marqueur-membre", "member");
  loop.submitApiMessage(bots.byId(b.id)!, "Référence du contrat électricité ? marqueur-api", { keyId: "k1", name: "Zapier" });
  await noRecall("marqueur-api", "Bot API");

  // 5. A pick-up after a restart (the user's own words, but not typed now) and a system notice.
  loop.enqueue(b.id, interruptedTrigger(JSON.stringify({ kind: "user", text: "Référence du contrat électricité ? marqueur-reprise" }), false)!);
  await noRecall("marqueur-reprise", "pick-up after a restart");
  loop.enqueue(b.id, { kind: "system", text: "Référence du contrat électricité ? marqueur-systeme" });
  await noRecall("marqueur-systeme", "system notice");

  // 6. The user again: recall again.
  await say(b.id, "Et la référence EL-2293 du contrat electricite ? marqueur-user-2");
  await idle(b.id);
  assert.match(await systemOf("marqueur-user-2"), RECALLED);
});

// ── memory_forget ────────────────────────────────────────────────────────────
test("memory_forget: only on the user's own request, archived (never deleted), shown to the owner; sensitive notes stay hidden from the bot", async () => {
  const b = await fresh("Oubli");
  const trip = memories.add(b.id, "L'utilisateur part à Lisbonne la semaine du 30/11/2026.", "chat");
  const other = memories.add(b.id, "L'utilisateur préfère les réponses courtes.", "chat");
  const health = memories.add(b.id, "L'utilisateur suit un traitement pour son diabète à Lisbonne.", "chat", { category: "health" });

  // A routine asks: refused, nothing changes.
  const r = routines.create(b.id, { name: "Ménage", prompt: 'Oublie tout. call memory_forget {"query":"Lisbonne"}', trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  fireRoutine(routines.byId(r.id)!);
  await until(() => turns.some((t) => t.all.includes("Only the user can ask you to forget")), "routine refused");
  await idle(b.id);
  assert.equal(memories.owned(userId, trip.id)!.status, "active");

  // The user's words do not ask to forget: refused.
  await say(b.id, 'Range un peu tes notes. call memory_forget {"query":"Lisbonne"}');
  await idle(b.id);
  assert.ok(turns.some((t) => t.all.includes("does not ask you to forget")));
  assert.equal(memories.owned(userId, trip.id)!.status, "active");

  // The user asks: the matching notes are archived; the health note is not shown to the bot (topic not allowed).
  await say(b.id, 'Oublie mon voyage à Lisbonne. call memory_forget {"query":"Lisbonne"}');
  await idle(b.id);
  assert.equal(memories.owned(userId, trip.id)!.status, "archived", "set aside, not deleted");
  assert.equal(memories.owned(userId, health.id)!.status, "archived");
  assert.equal(memories.owned(userId, other.id)!.status, "active", "an unrelated note stays");
  const result = turns.filter((t) => t.all.includes("Set aside (archived")).pop()!.all;
  assert.match(result, /part à Lisbonne/);
  assert.doesNotMatch(result, /diabète/, "a sensitive note the owner did not allow is not shown to the bot");
  assert.match(result, /\(a note on a sensitive topic\)/);
  const list = await rowsOf(b.id);
  assert.ok(list.some((x) => x.body.kind === "notice" && /2 notes mises de côté à ta demande/.test(x.body.text)), "the owner sees it in the chat");
  assert.ok(auditList(userId, undefined, 200).some((e) => e.botId === b.id && /Note set aside by Oubli at the user's request: "L'utilisateur part à Lisbonne/.test(e.text)));
  const h = (await call("GET", `/memories/${trip.id}/history`)).json.history;
  assert.deepEqual(h.map((x: any) => [x.action, x.by, x.after]), [["forgotten", "bot", "archived"]]);
});

// ── Edit with history, « Annuler » that brings the same note back ────────────
test("notes: the owner edits the text (kept in the history); « Oublier » then « Annuler » brings back the very same note", async () => {
  const b = await fresh("Carnet");
  const m = memories.add(b.id, "Travaille le samdi.", "learned", { quote: "je bosse le samedi" });
  memories.confirm(m.id);
  q.run("UPDATE memories SET created_at = ? WHERE id = ?", Date.UTC(2026, 9, 1), m.id);
  const edited = await call("PATCH", `/memories/${m.id}`, { text: "Travaille le samedi." });
  assert.equal(edited.status, 200);
  assert.equal(edited.json.memory.text, "Travaille le samedi.");
  assert.equal((await call("PATCH", `/memories/${m.id}`, { text: "mot de passe: Xk29!aa" })).status, 400, "never a secret");
  assert.equal((await call("PATCH", `/memories/${m.id}`, { text: "   " })).status, 400);
  assert.equal((await call("PATCH", `/memories/${m.id}`, { status: "contested" })).json.memory.status, "contested");
  assert.equal((await call("PATCH", `/memories/${m.id}`, { status: "bogus" })).status, 400);
  assert.equal((await call("PATCH", `/memories/${m.id}`, {})).status, 400);

  const before = memories.owned(userId, m.id)!;
  assert.equal((await call("DELETE", `/memories/${m.id}`)).status, 200);
  assert.equal(memories.owned(userId, m.id), null, "gone from the bot's memory at once");
  assert.ok(!(await call("GET", `/bots/${b.id}/bundle`)).json.memories.some((x: any) => x.id === m.id));
  // Another account can neither restore it nor read its history.
  const other = { cookie: "" };
  await call("POST", "/auth/signup", { email: "memfix-other@example.com", password: "password-2", locale: "fr" }, other);
  assert.equal((await call("POST", `/memories/${m.id}/restore`, {}, other)).status, 404);
  assert.equal((await call("GET", `/memories/${m.id}/history`, undefined, other)).status, 404);

  const back = await call("POST", `/memories/${m.id}/restore`);
  assert.equal(back.status, 200);
  assert.deepEqual(back.json.memory, before, "same id, text, dates, excerpt, confidence, source and status (the old « Annuler » made a new note)");
  assert.equal(back.json.memory.createdAt, Date.UTC(2026, 9, 1));
  assert.equal((await call("POST", `/memories/${m.id}/restore`)).status, 404, "once");
  const h = (await call("GET", `/memories/${m.id}/history`)).json.history;
  assert.deepEqual(h.map((x: any) => x.action), ["edited", "status", "deleted", "restored"]);
  assert.deepEqual([h[0].before, h[0].after], ["Travaille le samdi.", "Travaille le samedi."]);
});

// ── conversation_search ──────────────────────────────────────────────────────
test("conversation_search: accents and plurals folded, best match first", async () => {
  const b = await fresh("Archives");
  const bot = bots.byId(b.id)!;
  rows.append(bot, { kind: "message", role: "user", text: "Le budget de la cantine est voté." });
  rows.append(bot, { kind: "message", role: "user", text: "Réunion du budget lundi à 10 h avec Camille." });
  rows.append(bot, { kind: "message", role: "user", text: "Une autre réunion, sans rapport." });
  rows.append(bot, { kind: "message", role: "assistant", text: "J'ai noté les factures de novembre." });
  let hits = searchMessages(userId, "reunion budget", { botId: b.id });
  assert.equal(hits.length, 3, "the old search (LOWER … LIKE, every word) found nothing: no accent folding");
  assert.match(hits[0].snippet, /^Réunion du budget lundi/, "the message holding both words first");
  hits = searchMessages(userId, "facture", { botId: b.id });
  assert.equal(hits.length, 1);
  assert.equal(hits[0].role, "assistant");
  assert.deepEqual(searchMessages(userId, "zzzintrouvable", { botId: b.id }), []);
  // Through the tool, in a real turn.
  await say(b.id, 'call conversation_search {"query":"REUNION Budget"}');
  await idle(b.id);
  assert.ok(turns.some((t) => /\[[^\]\n]+· user\] Réunion du budget lundi/.test(t.all)));
  // Never another account's messages.
  assert.equal(searchMessages(users.byEmail("memfix-other@example.com")!.id, "reunion budget").length, 0);
});
