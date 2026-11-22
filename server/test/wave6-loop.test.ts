import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Wave 6, turns and routines: L54, L55, L58, L61, L62, L68, L85, L86, L89, L90, L92, L93, L96, L183.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w6loop-"));
process.env.SESSION_SECRET = "wave6-loop-secret-wave6-loop-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.MAX_STEPS = "8";
process.env.RETRY_BASE_MS = "5";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows: rowStore, settings, users } = await import("../src/store.js");
const { routines, runs, ROUTINE_FAIL_PAUSE } = await import("../src/routines.js");
const { fireRoutine, dueRoutine } = await import("../src/scheduler.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { TURN_CONTEXT_HEADING } = await import("../src/llm/cachelayout.js");
const { CLOSING_RULES, METHOD_BLOCK } = await import("../src/agent/conversationrules.js");
const { stampLine, noteBrowserTimezone, browserTimezone } = await import("../src/agent/turnstamp.js");
const { steer, drainSteering, waitingNotes, ADDS_TO_WORK } = await import("../src/agent/steering.js");
const { planAfterFailure, clearPacing, spacedUntil, spacingGap, deferForQuota, takeDue, RETRY_DELAYS_MS, QUOTA_STAGGER_MS } = await import("../src/routinepacing.js");
const { triggerMessage } = await import("../src/agent/turn-request.js");
const { saysNothingNew } = await import("../src/agent/routineframe.js");
const { openRoutineThread, closeRoutineThread } = await import("../src/agent/routinethread.js");
const { setRoutineOptions, routineOptions } = await import("../src/routineoptions.js");
const { compareReceipt, receiptText } = await import("../src/agent/receipt.js");
const { conditionGate } = await import("../src/agent/routinecondition.js");
const { cleanCriteria } = await import("../src/agent/goalcriteria.js");
const { goals, createGoal, goalAction } = await import("../src/agent/goals.js");
const { capText, resultCharsFor, RESULT_MIN_CHARS, RESULT_MAX_CHARS, shrinkImages, overTimeBudget, IMAGE_MAX_BYTES } = await import("../src/agent/turnbudget.js");
const { coerceArgs, appEnvelope, APP_RAN, APP_PARTLY, APP_FAILED } = await import("../src/agent/appenvelope.js");
const { askRefusal, setAskMode, startQueuedHelpers, helperGoal } = await import("../src/agent/askrules.js");
const { noteEngineLimit, setLimitClock } = await import("../src/agent/sublimit.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const requests: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    // L86: the condition checker answers from the item.
    if (req.system.startsWith("You check whether a new item meets one condition.")) {
      const item = JSON.stringify(req.messages);
      const match = /PRIX 40/.test(item);
      return { content: [{ type: "text", text: JSON.stringify({ match, why: match ? "le prix est sous 50" : "le prix est encore à 80" }) }], stopReason: "end", model: "script-1", usage };
    }
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    let content: Block[];
    const m = /call (\w+) (\{[^\n]*\})/.exec(texts);
    if (results.length) content = [{ type: "text", text: "Rapport : fait." }];
    else if (m) content = [{ type: "tool_use", id: `c_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }];
    else content = [{ type: "text", text: /RIEN/.test(texts) ? "Rien de neuf." : "ok" }];
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(fn: () => T | undefined | null | false, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out: ${label}`);
}
await call("POST", "/auth/signup", { email: "w6@example.com", name: "Zoé", password: "password-1", locale: "fr" });
const userId = (await call("GET", "/me")).json.user.id as string;
const main = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary) as Bot;
await call("PATCH", `/bots/${main.id}`, { model: "script:script-1" });
async function fresh(name: string): Promise<Bot> {
  const b = (await call("POST", "/bots", { name })).json.bot as Bot;
  return (await call("PATCH", `/bots/${b.id}`, { model: "script:script-1" })).json.bot as Bot;
}
const allRows = (botId: string): Row[] => { const b = bots.byId(botId)!; return rowStore.all(b.id, b.generation); };

test("L55 / L61 / L92: method block, standing instructions first, 6–8 closing rules last, model line in the turn part", async () => {
  const b = await fresh("Méthodique");
  q.run("UPDATE bots SET instructions = ? WHERE id = ?", "Toujours répondre en vers.", b.id);
  const sys = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  const [fixed, turn] = sys.split(TURN_CONTEXT_HEADING);
  assert.ok(fixed.indexOf("## Standing instructions") < fixed.indexOf("## How you work"), "the bot's instructions come first");
  assert.ok(fixed.includes(METHOD_BLOCK));
  assert.ok(fixed.trimEnd().endsWith(CLOSING_RULES), "the closing rules end the fixed part");
  const rules = CLOSING_RULES.split("\n").filter((l) => /^\d+\. /.test(l));
  assert.ok(rules.length >= 6 && rules.length <= 8, `${rules.length} rules`);
  assert.match(CLOSING_RULES, /Never ask in chat for a yes that an approval card will ask anyway/);
  assert.match(METHOD_BLOCK, /empty search means you did not find it/);
  assert.match(turn, /You run on the model script:script-1/);
});

test("L92: the device's time zone stamps each message when the profile has none; the profile wins; bad zones ignored", async () => {
  noteBrowserTimezone(userId, "Mars/Olympus");
  assert.equal(browserTimezone(userId), null);
  const b = await fresh("Horaire");
  await call("POST", `/bots/${b.id}/messages`, { text: "bonjour" }, { "x-time-zone": "Europe/Paris" });
  assert.equal(browserTimezone(userId), "Europe/Paris");
  const at = Date.UTC(2026, 10, 22, 14, 5);
  assert.equal(stampLine(userId, at), "[2026-11-22 14:05 UTC — Sun, 2026-11-22, 15:05 in Europe/Paris, the time zone of the user's device]".replace("Sun, 2026-11-22, 15:05", new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short", hourCycle: "h23" }).format(at)));
  settings.saveProfile(userId, { timezone: "America/New_York" });
  assert.equal(stampLine(userId, at), "[2026-11-22 14:05 UTC]");
  settings.saveProfile(userId, { timezone: "" });
});

test("L58: a note typed during the work is introduced as an addition, listed, and can be taken back", async () => {
  const b = bots.byId((await fresh("Occupé")).id)!;
  steer(b, b.id, 0, "et la météo ?", [], async () => [{ type: "text", text: "et la météo ?" }]);
  steer(b, b.id, 0, "oublie ça", [], async () => [{ type: "text", text: "oublie ça" }]);
  const listed = (await call("GET", `/bots/${b.id}/notes`)).json.notes;
  assert.equal(listed.length, 2);
  const del = await call("DELETE", `/bots/${b.id}/notes/${listed[1].id}`);
  assert.equal(del.status, 200);
  assert.deepEqual(del.json.notes.map((n: { text: string }) => n.text), ["et la météo ?"]);
  assert.equal((await call("DELETE", `/bots/${b.id}/notes/${listed[1].id}`)).status, 404, "already gone");
  const blocks = await drainSteering(b);
  assert.equal((blocks[0] as { text: string }).text, ADDS_TO_WORK);
  assert.match(ADDS_TO_WORK, /answer that first/);
  assert.equal(blocks.length, 2);
  assert.equal(waitingNotes(b.id).length, 0);
});

test("L62: new tries at 5, 15, 30 min before a failure counts; spacing instead of pause", () => {
  const plans = [0, 1, 2, 3].map(() => planAfterFailure("r-test", false, "panne"));
  assert.deepEqual(plans.map((p) => (p.kind === "retry" ? p.inMs : "count")), [...RETRY_DELAYS_MS, "count"]);
  assert.equal(planAfterFailure("r-test", true, "panne").kind, "count", "a spaced routine counts at once");
  assert.equal(spacingGap(ROUTINE_FAIL_PAUSE - 1, ROUTINE_FAIL_PAUSE), 0);
  assert.equal(spacingGap(ROUTINE_FAIL_PAUSE, ROUTINE_FAIL_PAUSE), 3600_000);
  assert.equal(spacingGap(ROUTINE_FAIL_PAUSE + 20, ROUTINE_FAIL_PAUSE), 86_400_000);
  assert.ok(spacedUntil("r-test", ROUTINE_FAIL_PAUSE, ROUTINE_FAIL_PAUSE)! > Date.now(), "just failed: the next due time is skipped");
  clearPacing("r-test");
  assert.equal(spacedUntil("r-test", ROUTINE_FAIL_PAUSE, ROUTINE_FAIL_PAUSE), null);
});

test("L62: a spaced routine skips a due time without a model call; a retry is due after its wait", async () => {
  const b = await fresh("Espacé");
  const r = routines.create(b.id, { name: "Veille", prompt: "Regarde", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" });
  for (let i = 0; i < 4 * ROUTINE_FAIL_PAUSE; i++) runs.finish(runs.start(r.id), "error", "panne");
  assert.equal(routines.byId(r.id)!.enabled, true);
  const before = requests.length;
  assert.equal(await dueRoutine(routines.byId(r.id)!, Date.now()), "skipped");
  assert.equal(requests.length, before);
  assert.match(runs.list(r.id)[0].note, /Spaced out after 5 failures/);
  runs.finish(runs.start(r.id), "done", "ok");
  assert.equal(routines.byId(r.id)!.failures, 0, "a run that works resets everything");
  const r2 = routines.create(b.id, { name: "Essai", prompt: "Essaie", trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  runs.finish(runs.start(r2.id), "error", "panne");
  assert.equal(takeDue(Date.now()).filter((d) => d.routineId === r2.id).length, 0, "not yet");
  assert.deepEqual(takeDue(Date.now() + RETRY_DELAYS_MS[0] + 1000).filter((d) => d.routineId === r2.id).map((d) => d.kind), ["retry"]);
});

test("L68: a routine turn's frame; routine_fail makes the run FAILED with its reason", async () => {
  const msg = triggerMessage({ kind: "routine", name: "Tri", text: "Trie mes mails" });
  assert.match(msg, /Nobody is watching this run: never stop to ask a question/);
  assert.match(msg, /"Done:", "Blocked:" \(and why\) or "Skipped:"/);
  assert.match(msg, /"Not confirmed:"/);
  const b = await fresh("Échoueur");
  const r = routines.create(b.id, { name: "Rapport", prompt: `call routine_fail {"reason":"le site est en panne, 2 étapes sur 3"}`, trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" });
  fireRoutine(routines.byId(r.id)!, undefined, { byHand: true });
  const run = await until(() => runs.list(r.id).find((x) => x.status !== "running"), "run ended");
  assert.equal(run.status, "error");
  assert.match(run.note, /le site est en panne/);
});

test("L54: « rien de neuf » posts nothing; « dans la discussion » keeps the run in the main chat", async () => {
  assert.equal(saysNothingNew("Rien de neuf."), true);
  assert.equal(saysNothingNew("Nothing new today"), true);
  assert.equal(saysNothingNew("Rien de neuf sauf un mail de Camille"), false);
  const b = await fresh("Veilleur");
  const r = routines.create(b.id, { name: "Veille", prompt: "RIEN à faire", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" });
  fireRoutine(routines.byId(r.id)!, undefined, { byHand: true });
  await until(() => runs.list(r.id).find((x) => x.status !== "running"), "run ended");
  const mainChat = allRows(b.id).filter((x) => !x.thread);
  assert.equal(mainChat.filter((x) => x.body.kind === "message").length, 0, "no message in the chat");
  assert.ok(mainChat.some((x) => x.body.kind === "event" && /Routine « Veille » : rien de neuf/.test(x.body.text)));
  // « dans la discussion »
  const r2 = routines.create(b.id, { name: "Ici", prompt: "Dis bonjour", trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  assert.equal(routineOptions(r2.id).announce, "thread");
  assert.equal((await call("PUT", `/routines/${r2.id}/options`, { announce: "chat" })).json.announce, "chat");
  const runId = runs.start(r2.id);
  const t = openRoutineThread(b.id, { kind: "routine", name: "Ici", text: "x", runId });
  assert.equal(t.kind === "routine" ? t.thread : -1, undefined);
  assert.equal((await call("PUT", `/routines/${r2.id}/options`, { announce: "ailleurs" })).status, 400);
  void closeRoutineThread;
});

test("L85: receipt — said but not done, done but not said", () => {
  assert.deepEqual(compareReceipt("C'est fait, j'ai envoyé le mail à Camille.", [{ name: "gmail_perso__mail_search", ok: true }]).saidNotDone, ["sent"]);
  assert.deepEqual(compareReceipt("J'ai envoyé le mail.", [{ name: "gmail_perso__mail_send", ok: true }]), { saidNotDone: [], doneNotSaid: [] });
  assert.deepEqual(compareReceipt("Voici le résumé.", [{ name: "file_trash", ok: true }]).doneNotSaid, [{ kind: "deleted", tools: ["file_trash"] }]);
  assert.deepEqual(compareReceipt("J'ai envoyé le mail.", [{ name: "gmail_perso__mail_send", ok: false }]).saidNotDone, ["sent"], "a failed send is not a send");
  assert.equal(receiptText("fr", compareReceipt("Voici.", [])), "");
  assert.equal(receiptText("fr", compareReceipt("J'ai payé la commande.", [{ name: "file_trash", ok: true }])), "Reçu — dit mais pas fait : payé · fait mais pas dit : supprimé (file_trash)");
});

test("L86: a condition is checked by a small model before the bot is woken", async () => {
  const b = await fresh("Prix");
  const r = routines.create(b.id, { name: "Prix", prompt: "Préviens-moi", trigger: "webhook" });
  assert.equal(await conditionGate(routines.byId(r.id)!, "PRIX 80"), true, "no condition: runs");
  setRoutineOptions(r.id, { condition: "seulement si le prix passe sous 50 €" });
  const before = runs.list(r.id).length;
  assert.equal(await conditionGate(routines.byId(r.id)!, "PRIX 80"), false);
  assert.match(runs.list(r.id)[0].note, /Condition non remplie : le prix est encore à 80/);
  assert.equal(runs.list(r.id).length, before + 1);
  assert.equal(await conditionGate(routines.byId(r.id)!, "PRIX 40"), true);
});

test("L89: 3–7 success criteria, evidence per criterion, then « attend ton accord » and « Valider »", async () => {
  assert.equal(typeof cleanCriteria(["a", "b"]), "string");
  assert.equal(typeof cleanCriteria(["1", "2", "3", "4", "5", "6", "7", "8"]), "string");
  assert.deepEqual(cleanCriteria(["  site en ligne ", "page contact", "test passé"]), ["site en ligne", "page contact", "test passé"]);
  const b = bots.byId((await fresh("Bâtisseur")).id)!;
  const g = createGoal(b, { objective: "Faire le site", thread: 0, origin: "user" });
  const { goalTools } = await import("../src/agent/goals.js");
  const update = goalTools.find((t) => t.spec.name === "goal_update")!;
  const crit = goalTools.find((t) => t.spec.name === "goal_criteria")!;
  const ctx = { bot: bots.byId(b.id)!, user: users.byId(userId)!, depth: 0, signal: new AbortController().signal, thread: 0 };
  assert.equal((await crit.run({ criteria: ["un", "deux"] }, ctx)).isError, true, "fewer than 3 refused");
  assert.equal((await crit.run({ criteria: ["la page s'ouvre", "le formulaire envoie", "le test passe"] }, ctx)).isError, undefined);
  const refused = await update.run({ status: "complete", summary: "fini", criteria_evidence: ["ok", ""] }, ctx);
  assert.equal(refused.isError, true);
  assert.match(String(refused.content), /le formulaire envoie/);
  const done = await update.run({ status: "complete", summary: "fini", criteria_evidence: ["capture ouverte", "mail reçu", "12/12"] }, ctx);
  assert.equal(done.isError, undefined);
  let now = goals.byId(g.id)!;
  assert.equal(now.status, "blocked");
  assert.equal(now.reason, "attend ton accord");
  const cardRow = allRows(b.id).find((x) => x.body.kind === "card" && x.body.card.type === "goal")!;
  const card = (cardRow.body as { card: { review?: boolean; criteria?: { evidence?: string }[] } }).card;
  assert.equal(card.review, true);
  assert.deepEqual(card.criteria!.map((c) => c.evidence), ["capture ouverte", "mail reçu", "12/12"]);
  now = goalAction(bots.byId(b.id)!, g.id, "accept");
  assert.equal(now.status, "complete");
});

test("L90: result size tied to the window, big pictures reduced, a time budget per turn", async () => {
  const max = resultCharsFor(userId, "script:script-1");
  assert.ok(max >= RESULT_MIN_CHARS && max <= RESULT_MAX_CHARS);
  assert.equal(max, Math.min(RESULT_MAX_CHARS, Math.round(200_000 * 4 * 0.3)));
  const cut = capText("a".repeat(500_000), 30_000);
  assert.equal(cut.length, 30_000);
  assert.match(cut, /cut to fit the model's context window/);
  const sharp = (await import("sharp")).default;
  const raw = await sharp({ create: { width: 3000, height: 3000, channels: 3, noise: { type: "gaussian", mean: 128, sigma: 60 } } }).png().toBuffer();
  assert.ok(raw.length > IMAGE_MAX_BYTES, `test picture is big (${raw.length})`);
  const out = await shrinkImages({ content: [{ type: "image", mediaType: "image/png", data: raw.toString("base64") }] });
  const img = (out.content as { type: string; data: string; mediaType: string }[])[0];
  assert.equal(img.mediaType, "image/jpeg");
  assert.ok(Buffer.from(img.data, "base64").length <= IMAGE_MAX_BYTES);
  const b = bots.byId((await fresh("Lent")).id)!;
  const turn = { bot: b, user: users.byId(userId)!, thread: 0 };
  assert.equal(overTimeBudget(turn, 1000), false);
  assert.equal(overTimeBudget(turn, 1000 + 59 * 60_000), false);
  assert.equal(overTimeBudget(turn, 1000 + 61 * 60_000), true);
  const notice = allRows(b.id).find((x) => x.body.kind === "notice" && /temps prévu pour un tour/.test(x.body.text));
  assert.ok(notice && notice.body.kind === "notice" && notice.body.action?.kind === "continue");
});

test("L93: app arguments converted from the schema; a standard first line on each app result", () => {
  const schema = { type: "object", properties: { n: { type: "integer" }, price: { type: "number" }, on: { type: "boolean" }, tags: { type: "array", items: { type: "string" } }, id: { type: "string" }, opts: { type: "object", properties: { limit: { type: "number" } } } } };
  assert.deepEqual(coerceArgs(schema, { n: "5", price: "4.5", on: "true", tags: "[\"a\",3]", id: 42, opts: "{\"limit\":\"10\"}", other: "x" }), { n: 5, price: 4.5, on: true, tags: ["a", "3"], id: "42", opts: { limit: 10 }, other: "x" });
  assert.deepEqual(coerceArgs(schema, { n: "5.5", on: "oui" }), { n: "5.5", on: "oui" }, "what does not convert cleanly stays");
  assert.equal(String(appEnvelope({ content: "{\"ok\":true}" }).content).split("\n")[0], APP_RAN);
  assert.equal(String(appEnvelope({ content: "{\"sent\":3,\"failed\":2}" }).content).split("\n")[0], APP_PARTLY);
  assert.equal(String(appEnvelope({ content: "403", isError: true }).content).split("\n")[0], APP_FAILED);
});

test("L96: who may ask whom (hierarchy); queued helpers start when a place frees; set report form", async () => {
  const a = bots.byId((await fresh("Alice")).id)!;
  const c = bots.byId((await fresh("Carl")).id)!;
  assert.equal(askRefusal(a, c), null, "open by default");
  assert.equal((await call("PUT", "/team/ask-policy", { mode: "hierarchy" })).json.mode, "hierarchy");
  assert.match(askRefusal(a, c)!, /Ask Zo|Ask .*who can pass it on/);
  assert.equal(askRefusal(a, bots.byId(main.id)!), null, "anyone may ask the main bot");
  setAskMode(userId, "open");
  assert.match(helperGoal("cherche X"), /Result: … \/ How I checked: … \/ What remains:/);
  q.run("INSERT INTO helper_queue (parent_id, goal, label, depth, tainted, created_at) VALUES (?, ?, ?, 0, 0, ?)", a.id, "compare les prix", "prix", Date.now());
  assert.equal(startQueuedHelpers(a.id), 1);
  const helper = bots.children(a.id)[0];
  assert.ok(helper, "the queued helper started");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM helper_queue WHERE parent_id = ?", a.id)!.n, 0);
});

test("L183: a heavy routine waits for the subscription's quota window; several start 10 minutes apart", async () => {
  const b = await fresh("Nocturne");
  q.run("UPDATE bots SET model = 'claude-code:sonnet' WHERE id = ?", b.id);
  const until = Date.now() + 2 * 3600_000;
  setLimitClock(null);
  noteEngineLimit(userId, "claude-code", { resetsAt: until });
  const r = routines.create(b.id, { name: "Gros rapport", prompt: "Analyse tout", trigger: "cron", schedule: "0 2 * * *", timezone: "UTC" });
  assert.equal(fireRoutine(routines.byId(r.id)!), "fired", "not heavy: runs as before");
  runs.finish(runs.list(r.id)[0].id, "done", "");
  setRoutineOptions(r.id, { heavy: true });
  assert.equal(fireRoutine(routines.byId(r.id)!), "capped");
  assert.match(runs.list(r.id)[0].note, /waits for the subscription's quota window/);
  const at1 = q.get<{ due_at: number }>("SELECT due_at FROM routine_pacing WHERE routine_id = ?", r.id)!.due_at;
  assert.ok(at1 >= until);
  const r2 = routines.create(b.id, { name: "Autre", prompt: "Encore", trigger: "cron", schedule: "0 3 * * *", timezone: "UTC" });
  const at2 = deferForQuota(r2.id, userId, until);
  assert.ok(Math.abs(at2 - at1) >= QUOTA_STAGGER_MS);
  assert.deepEqual(takeDue(Math.max(at1, at2) + 1).filter((d) => d.routineId === r.id || d.routineId === r2.id).map((d) => d.kind).sort(), ["quota", "quota"]);
  assert.equal(fireRoutine(routines.byId(r.id)!, undefined, { byHand: true }), "fired", "« Lancer maintenant » is a person's own work");
});

test("account isolation: another account gets 404 on the new routes with this account's ids", async () => {
  const b = await fresh("Privé");
  const r = routines.create(b.id, { name: "Privée", prompt: "x", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" });
  const mine = cookie;
  cookie = "";
  await call("POST", "/auth/signup", { email: "other-w6@example.com", name: "Autre", password: "password-1", locale: "en" });
  assert.equal((await call("GET", `/routines/${r.id}/options`)).status, 404);
  assert.equal((await call("PUT", `/routines/${r.id}/options`, { heavy: true })).status, 404);
  assert.equal(routineOptions(r.id).heavy, false);
  assert.equal((await call("GET", `/bots/${b.id}/notes`)).status, 404);
  assert.equal((await call("DELETE", `/bots/${b.id}/notes/1`)).status, 404);
  assert.equal((await call("PUT", "/sections/a_section/lead", { botId: b.id })).status, 404);
  assert.equal((await call("GET", "/team/ask-policy")).json.mode, "open");
  cookie = mine;
});
