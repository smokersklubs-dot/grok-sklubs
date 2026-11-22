import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Vague « boucle du tour » (A-FAIRE L18, L21, L22, L25, L53, décisions du propriétaire) : chaque défaut est d'abord
// reproduit avec un modèle scénarisé, puis corrigé.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-guards-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { endsOnPromise, MAX_PROMISE_NUDGES } = await import("../src/agent/promises.js");
const { dedupable } = await import("../src/agent/sameaction.js");
const { memories, bots, users } = await import("../src/store.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Scripted model. Last user words: `chain T {json} >> T {json}` → tools one after another; `promise always` → always
 * answers with a promise; `promise once` → a promise, then real work once nudged; otherwise it echoes.
 */
const requests: { texts: string[]; model: string }[] = [];
const queue: { name: string; input: Record<string, unknown> }[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1", "script-cheap"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    requests.push({ texts, model: req.model });
    const firstUser = req.messages.filter((m) => m.role === "user").map((m) => m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n")).join("\n");
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    let content: Block[];
    const nudged = texts.some((t) => t.includes("announced work"));
    const question = texts.find((t) => t.includes("[Question from "));
    if (question) content = [{ type: "text", text: /paie/.test(question) ? "ASK_OWNER" : "Ton amical." }];
    else if (results.length && !texts.length && queue.length) { const next = queue.shift()!; content = [{ type: "tool_use", id: `call_${requests.length}`, name: next.name, input: next.input }]; }
    else if (results.length && !texts.length) content = [{ type: "text", text: "Fini : tout est enregistré." }];
    else if (nudged && firstUser.includes("promise once")) content = [{ type: "text", text: "Voilà le résultat : 42." }];
    else if (nudged || said.includes("promise always") || said.includes("promise once")) content = [{ type: "text", text: "D'accord, je m'en occupe." }];
    else if (said.includes("chain ")) {
      const steps = said.slice(said.indexOf("chain ") + 6).split(" >> ").map((p) => { const x = /(\w+) (\{.*\})/s.exec(p)!; return { name: x[1], input: JSON.parse(x[2]) as Record<string, unknown> }; });
      queue.push(...steps.slice(1));
      content = [{ type: "tool_use", id: `call_${requests.length}`, name: steps[0].name, input: steps[0].input }];
    } else content = [{ type: "text", text: `Echo: ${said}` }];
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: req.model, usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
};
registerProvider(scripted);

let jar = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).map((r) => (r.body as { text: string }).text);
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const stepsOf = async (id: string) => (await rowsOf(id)).flatMap((r) => (r.body.kind === "step" ? [r.body] : []));
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const fresh = async (name: string, extra: Record<string, unknown> = {}): Promise<Bot> => (await call("POST", "/bots", { name, ...extra })).json.bot;

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "guards@example.com", password: "password-1", locale: "fr" });
});

// ── L21 : une promesse n'est pas un travail fait ──────────────────────────────
test("L21: promise detection looks at the end of the reply, in French and English", () => {
  for (const s of ["Je m'en occupe.", "D'accord, je vais chercher ça.", "J'ai trouvé 3 pistes. Je continue ?", "Tu veux que je continue ?", "I'll fetch the rest.", "Shall I continue?", "Want me to go on with the others?", "Let me check that."])
    assert.ok(endsOnPromise(s), `promise: ${s}`);
  for (const s of ["Voilà le résultat : 42.", "C'est fait : le fichier est enregistré.", "Let me know if you need anything else.", "Done. I sent the email to Marie.", "Je ne peux pas le faire : il me manque l'accès à Gmail."])
    assert.ok(!endsOnPromise(s), `not a promise: ${s}`);
  // Quoting a question or a tool's instructions is not the bot's own promise.
  for (const s of ['Pose la question « Comment on continue ? » avec les options proposées.', 'Then call ask_user with question "Comment on continue ?" and stop.'])
    assert.ok(!endsOnPromise(s), `quoted, not a promise: ${s}`);
  // A quotation that begins before the last 260 characters is still a quotation.
  assert.ok(!endsOnPromise(`Appelle ask_user avec la question "${"Le serveur est refusé par le site. ".repeat(6)}Comment on continue ?" et les options ["Coller la transcription","Ignorer"]. Ne dis pas seulement que le site bloque.`));
  // A promise early in a long report is not the end of the reply.
  assert.ok(!endsOnPromise(`Je vais d'abord expliquer. ${"Le rapport complet suit, ligne après ligne. ".repeat(10)}Conclusion : tout est en ordre.`));
});

test("L21: a turn that ends on « je m'en occupe » is sent back to work; a real answer then ends it normally", async () => {
  const bot = await fresh("Promesse");
  const before = requests.length;
  await say(bot.id, "promise once: trouve le chiffre");
  await idle(bot.id);
  assert.equal(requests.length - before, 2, "one nudge, then the real answer");
  const r = await replies(bot.id);
  assert.equal(r[r.length - 1], "Voilà le résultat : 42.");
  assert.ok(!(await notices(bot.id)).some((t) => /n'a pas fait/.test(t)), "no warning when the work was done");
});

test("L21: at most 2 nudges, then an honest notice; the promise is not counted as the answer", async () => {
  const bot = await fresh("Bavard");
  const before = requests.length;
  await say(bot.id, "promise always: fais le rapport");
  await idle(bot.id);
  assert.equal(requests.length - before, 1 + MAX_PROMISE_NUDGES, "the first try and exactly 2 nudges");
  const warn = (await notices(bot.id)).filter((t) => /a dit qu'il allait le faire, mais ne l'a pas fait \(relancé 2 fois/.test(t));
  assert.equal(warn.length, 1, JSON.stringify(await notices(bot.id)));
});

test("L21: an ordinary chat answer is not touched", async () => {
  const bot = await fresh("Normal");
  const before = requests.length;
  await say(bot.id, "bonjour");
  await idle(bot.id);
  assert.equal(requests.length - before, 1);
});

// ── L22 : un changement réussi n'est pas refait dans le même tour ─────────────
test("L22: which tools count as a change that is never repeated in a turn", async () => {
  const bot = await fresh("Liste");
  const t = await loop.newTurn(bots.byId(bot.id)!, users.byId(bots.byId(bot.id)!.userId)!, 0, new AbortController().signal);
  assert.ok(dedupable(t, "memory_save"), "saving a note is a change");
  assert.ok(!dedupable(t, "search_web"), "a read is not");
  assert.ok(!dedupable(t, "screen_click"), "a click may legitimately be repeated");
  assert.ok(!dedupable(t, "shell_run"), "a command may legitimately be run again");
});

test("L22: the same successful change called twice in one turn runs once; the second call gets the first result", async () => {
  const bot = await fresh("Unique");
  await say(bot.id, 'chain memory_save {"text":"Sam aime le thé vert."} >> memory_save {"text":"Sam aime le thé vert."} >> memory_save {"text":"Sam aime le thé noir."}');
  await idle(bot.id);
  const steps = (await stepsOf(bot.id)).filter((s) => s.tool === "memory_save");
  assert.equal(steps.length, 3, "three calls shown");
  assert.equal(steps[1].summary, "déjà fait", "the repeat is marked as already done");
  assert.equal(steps[1].status, "done");
  assert.notEqual(steps[2].summary, "déjà fait", "different arguments run normally");
  const kept = memories.list(bot.id).map((m) => m.text).filter((t) => t.startsWith("Sam aime le thé"));
  assert.equal(kept.filter((t) => t === "Sam aime le thé vert.").length, 1, `one note, got ${JSON.stringify(kept)}`);
});

// ── nod item 2 : le modèle choisi par routine / par type de travail est appliqué ─
test("nod 2: a routine runs on its own model, background work on the bot's background model, the owner's chat on the bot's model", async () => {
  const { routines } = await import("../src/routines.js");
  const bot = await fresh("Routinier");
  const r = routines.create(bot.id, { name: "Matin", prompt: "dis bonjour", trigger: "cron", schedule: "0 9 * * *", timezone: "Europe/Paris" });
  const put = await call("PUT", `/routines/${r.id}`, { model: "script:script-cheap" });
  assert.equal(put.status, 200, JSON.stringify(put.json));
  let before = requests.length;
  assert.equal((await call("POST", `/routines/${r.id}/run`)).status, 200);
  await until(() => requests.length > before && !loop.isBusy(bot.id), "routine turn");
  assert.deepEqual(requests.slice(before).map((x) => x.model), ["script-cheap"], "the routine's own model");
  // Background work no person started (here: a check-in like system message) follows the bot's background model.
  assert.equal((await call("PUT", `/bots/${bot.id}/work-models`, { background: "script:script-cheap" })).status, 200);
  before = requests.length;
  loop.enqueue(bot.id, { kind: "system", unattended: true, text: "check-in" });
  await until(() => requests.length > before && !loop.isBusy(bot.id), "background turn");
  assert.deepEqual(requests.slice(before).map((x) => x.model), ["script-cheap"]);
  // The owner's own message stays on the bot's model.
  before = requests.length;
  await say(bot.id, "bonjour");
  await idle(bot.id);
  assert.deepEqual(requests.slice(before).map((x) => x.model), ["script-1"]);
  // A choice that cannot run on this bot is ignored: an API bot has no subscription session.
  const { workModelFor } = await import("../src/agent/workmodel.js");
  assert.equal(workModelFor({ ...bots.byId(bot.id)!, model: "script:script-1" }, { kind: "routine", name: "x", text: "y" }), "script:script-1");
  const { workModels } = await import("../src/routineplus.js");
  q2(() => workModels.set(bot.id, { routines: "claude-code:sonnet" }));
  assert.equal(workModelFor({ ...bots.byId(bot.id)!, model: "script:script-1" }, { kind: "routine", name: "x", text: "y" }), "script:script-1", "API bot: the engine choice is ignored");
});
const q2 = (f: () => unknown) => { try { f(); } catch { /* refused: fine */ } };

// ── L53 : le disjoncteur entre bots survit au redémarrage et s'applique hors salons ─
test("L53: the bot-to-bot breaker is kept in the database: still open after a restart, closed by a human", async () => {
  const { postBudget, dmChannel, DEFAULT_LIMITS } = await import("../src/agent/roombudget.js");
  await import("../src/agent/budgetstore.js");
  postBudget.reset(DEFAULT_LIMITS);
  const ch = dmChannel("bot_x", "bot_y");
  const t0 = Date.now();
  for (let i = 0; i < DEFAULT_LIMITS.breakerAfter; i++) assert.equal(postBudget.attempt("u-l53", { channel: ch, botId: i % 2 ? "bot_y" : "bot_x", text: `étape numéro ${i} de notre échange`, now: t0 + i * 61_000 }).allow, true);
  const seventh = postBudget.attempt("u-l53", { channel: ch, botId: "bot_x", text: "encore une autre étape", now: t0 + 7 * 61_000 });
  assert.equal(seventh.allow, false);
  assert.ok(postBudget.isOpen("u-l53", ch));
  // What a restart does: memory is gone, the database is read again.
  postBudget.forgetMemory();
  assert.ok(postBudget.isOpen("u-l53", ch), "the breaker is still open after a restart");
  assert.equal(postBudget.attempt("u-l53", { channel: ch, botId: "bot_y", text: "on reprend ?", now: t0 + 8 * 61_000 }).allow, false);
  postBudget.human("u-l53", ch);
  postBudget.forgetMemory();
  assert.ok(!postBudget.isOpen("u-l53", ch), "a human message closes it, also on disk");
  assert.equal(postBudget.attempt("u-l53", { channel: ch, botId: "bot_y", text: "on reprend, merci", now: t0 + 9 * 61_000 }).allow, true);
});

test("L53: a request is never handed back to the bot that sent it", async () => {
  const { postBudget, dmChannel, DEFAULT_LIMITS } = await import("../src/agent/roombudget.js");
  postBudget.reset(DEFAULT_LIMITS);
  const ch = dmChannel("bot_a", "bot_b");
  const now = Date.now();
  assert.equal(postBudget.attempt("u-b", { channel: ch, botId: "bot_a", text: "Prépare le rapport des ventes de mars pour Marie", now }).allow, true);
  const back = postBudget.attempt("u-b", { channel: ch, botId: "bot_b", text: "Prépare le rapport des ventes de mars pour Marie.", now: now + 1000 });
  assert.equal(back.allow, false);
  assert.equal(!back.allow && back.rule, "bounce");
  // An answer that quotes the request and adds the result is not a hand-back.
  assert.equal(postBudget.attempt("u-b", { channel: ch, botId: "bot_b", text: "Tu m'as demandé : prépare le rapport des ventes de mars pour Marie. C'est fait, il est dans le dossier Ventes, total 12 400 euros.", now: now + 2000 }).allow, true);
});

test("L53: a helper's report goes through the same breaker outside group chats", async () => {
  const { postBudget, DEFAULT_LIMITS } = await import("../src/agent/roombudget.js");
  const { deliverCounted } = await import("../src/agent/team.js");
  postBudget.reset({ ...DEFAULT_LIMITS, breakerAfter: 2, perMinute: 0, perHour: 0 });
  const lead = bots.byId((await fresh("Chef")).id)!;
  const helper = bots.byId((await fresh("Aide")).id)!;
  assert.equal(deliverCounted(helper, lead, "premier rapport du jour, rien à signaler", 5), true);
  assert.equal(deliverCounted(helper, lead, "deuxième rapport, toujours rien de nouveau", 5), true);
  assert.equal(deliverCounted(helper, lead, "troisième rapport, je recommence", 5), false, "stopped at the breaker");
  await idle(lead.id);
  assert.ok((await notices(lead.id)).some((t) => /Boucle entre bots arrêtée/.test(t)));
  postBudget.reset(DEFAULT_LIMITS);
});

// ── L18 : redémarrage au milieu d'une action non protégée ──────────────────────
test("L18: an unprotected action (a message to another bot) leaves a marker for the rest of the turn; the next turn clears it", async () => {
  const { unprotectedOf } = await import("../src/agent/restartguard.js");
  const { postBudget, DEFAULT_LIMITS } = await import("../src/agent/roombudget.js");
  postBudget.reset(DEFAULT_LIMITS);
  await fresh("Destinataire");
  const bot = await fresh("Messager");
  await say(bot.id, 'chain bot_message {"bot":"Destinataire","message":"Peux-tu vérifier la facture de mars ?"}');
  await idle(bot.id);
  const marks = unprotectedOf(bot.id);
  assert.equal(marks.length, 1, JSON.stringify(marks));
  assert.equal(marks[0].tool, "bot_message");
  assert.equal(marks[0].done, 1);
  await say(bot.id, "bonjour");
  await idle(bot.id);
  assert.equal(unprotectedOf(bot.id).length, 0, "a new turn starts clean");
});

async function cutOff(bot: Bot, marker: boolean) {
  const { activeTurns, botQueue } = await import("../src/store.js");
  const { q } = await import("../src/db.js");
  const id = botQueue.add(bot.id, { kind: "user", text: "achète le billet de train" })!;
  botQueue.start(id);
  activeTurns.begin(bot.id);
  activeTurns.acted(bot.id);
  if (marker) q.run("INSERT INTO turn_unprotected (bot_id, call_id, tool, label, thread, started_at) VALUES (?, 'c1', 'screen_click', 'Cliquer à l''écran', 0, ?)", bot.id, Date.now());
  return id;
}

test("L18: after a restart, a turn cut off during an unprotected action is not replayed: a notice with Continue, then a check-first continuation", async () => {
  const { botQueue } = await import("../src/store.js");
  const bot = await fresh("Acheteur");
  const id = await cutOff(bot, true);
  const before = requests.length;
  loop.recoverInterruptedTurns();
  await sleep(300);
  await idle(bot.id);
  assert.equal(requests.length, before, "nothing is replayed on its own");
  assert.equal(botQueue.status(id), "done");
  const row = (await rowsOf(bot.id)).find((r) => r.body.kind === "notice" && r.body.action?.kind === "continue" && (r.body.action as { reason?: string }).reason === "restart");
  assert.ok(row, JSON.stringify(await notices(bot.id)));
  assert.match((row!.body as { text: string }).text, /Cliquer à l'écran/);
  assert.match((row!.body as { text: string }).text, /Je ne le refais pas tout seul/);
  // The owner presses Continue: the bot is told to check before redoing anything.
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${row!.seq}/continue`)).status, 200);
  await until(() => requests.length > before, "continuation");
  await idle(bot.id);
  assert.ok(requests.slice(before).some((r) => r.texts.some((t) => t.includes("Before redoing anything, check the current state"))));
});

test("L18: without an unprotected action, the cut-off turn picks up on its own as before", async () => {
  const bot = await fresh("Lecteur");
  await cutOff(bot, false);
  const before = requests.length;
  loop.recoverInterruptedTurns();
  await until(() => requests.length > before, "recovery");
  await idle(bot.id);
  assert.ok(requests.slice(before).some((r) => r.texts.some((t) => t.includes("[Continuation: The server restarted after you had already taken some actions."))));
});

test("L18: a graceful stop lets a turn finish its step and park before the next one", async () => {
  const { gracefulStop, resetGracefulStop } = await import("../src/agent/restartguard.js");
  const { activeTurns } = await import("../src/store.js");
  const bot = await fresh("Gracieux");
  const before = requests.length;
  await say(bot.id, 'chain memory_save {"text":"Lou préfère le matin."} >> memory_save {"text":"Lou préfère le soir."}');
  await until(() => requests.length > before, "first step");
  const left = await gracefulStop(5000, 20);
  assert.equal(left, 0, "every running turn parked within the time");
  const asked = requests.length;
  await sleep(200);
  assert.equal(requests.length, asked, "no new model step after the stop");
  assert.ok(activeTurns.leftover().some((t) => t.bot_id === bot.id), "the turn stays marked under way, for a clean pick-up after the restart");
  resetGracefulStop();
});

// ── Décision : une routine tourne dans son propre fil ─────────────────────────
test("routines run in their own thread: the main chat gets one message with the result, the steps stay in the thread", async () => {
  const { routines } = await import("../src/routines.js");
  const bot = await fresh("Filaire");
  await say(bot.id, "bonjour");
  await idle(bot.id);
  const r = routines.create(bot.id, { name: "Veille", prompt: 'chain memory_save {"text":"La veille du lundi est faite."}', trigger: "cron", schedule: "0 9 * * 1", timezone: "Europe/Paris" });
  assert.equal((await call("POST", `/routines/${r.id}/run`)).status, 200);
  const parent = await until(async () => (await rowsOf(bot.id)).find((x) => x.body.kind === "message" && x.body.origin?.kind === "routine" && /Routine « Veille » : Fini/.test(x.body.text)), "result in the main chat");
  await idle(bot.id);
  assert.ok(!parent.thread, "the result message is in the main chat");
  const inThread = (await call("GET", `/bots/${bot.id}/rows?limit=500&thread=${parent.seq}`)).json.rows as Row[];
  assert.ok(inThread.some((x) => x.body.kind === "step" && x.body.tool === "memory_save"), "the steps are in the routine's thread");
  const main = await rowsOf(bot.id);
  assert.ok(!main.some((x) => !x.thread && x.body.kind === "step" && x.body.tool === "memory_save"), "no step of the routine in the main chat");
  assert.ok(main.some((x) => x.thread === parent.seq) || inThread.length > 0);
});

// ── L25 : les questions d'un assistant vont d'abord au bot qui a confié le travail ─
test("L25: a helper's question is answered by the bot that gave it the work, with a « décidée pour toi » line for the owner", async () => {
  const { startHelper } = await import("../src/agent/team.js");
  const { postBudget, DEFAULT_LIMITS } = await import("../src/agent/roombudget.js");
  postBudget.reset(DEFAULT_LIMITS);
  const lead = bots.byId((await fresh("Cheffe")).id)!;
  const helper = startHelper(lead, 'chain ask_user {"question":"Quel ton pour le mail à Paul ?","options":["amical","formel"]}', "mail", 0);
  await until(async () => (await notices(lead.id)).some((t) => /décidée pour toi par Cheffe/.test(t)), "decided-for-you line");
  await until(() => !loop.isBusy(helper.id) && !loop.isBusy(lead.id), "both idle");
  const line = (await notices(lead.id)).find((t) => /décidée pour toi/.test(t))!;
  assert.match(line, /Quel ton pour le mail à Paul \?/);
  assert.match(line, /Ton amical\./);
  const helperRows = await rowsOf(helper.id);
  assert.ok(!helperRows.some((r) => r.body.kind === "card" && r.body.card.type === "question"), "the owner is not asked");
  assert.ok(helperRows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && /Fini/.test(r.body.text)), "the helper went on with the answer");
});

test("L25: a floor question (money) still goes to the owner, not to the lead bot", async () => {
  const { startHelper } = await import("../src/agent/team.js");
  const { isFloorQuestion } = await import("../src/agent/delegatedask.js");
  assert.ok(isFloorQuestion("Je paie les 30 euros de l'abonnement ?"));
  assert.ok(isFloorQuestion("Je supprime les anciens fichiers ?"));
  assert.ok(!isFloorQuestion("Quel ton pour le mail ?"));
  const lead = bots.byId((await fresh("Patronne")).id)!;
  const before = requests.filter((r) => r.texts.some((t) => t.includes("[Question from "))).length;
  const helper = startHelper(lead, 'chain ask_user {"question":"Je paie les 30 euros de l\'abonnement ?"}', "achat", 0);
  await until(async () => (await rowsOf(helper.id)).some((r) => r.body.kind === "card" && r.body.card.type === "question"), "question card for the owner");
  await until(() => !loop.isBusy(helper.id), "helper idle");
  assert.equal(requests.filter((r) => r.texts.some((t) => t.includes("[Question from "))).length, before, "the lead was not asked");
});
