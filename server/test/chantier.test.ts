import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Chantier » (chantiers.ts, chantierplanner.ts, chantierrunner.ts, chantierchecks.ts, docs/CHANTIER.md): a piece of
// work split between bots — planner card first, graph, contracts, checks by code and by a reviewer, failure reports that
// send back only the failed task, a limit of 3 attempts then the owner, lessons reused, metrics, stop, restart, isolation.
// The example is the owner's article: « outil qui transforme un article en cartes pour les réseaux sociaux ».
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-chantier-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "chx:chx-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS", "BOT_PARALLEL_TASKS", "HOSTED_MODE"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, botQueue } = await import("../src/store.js");
const { resolveInWorkspace } = await import("../src/computer.js");
const { goals } = await import("../src/agent/goals.js");
const { runningThreads } = await import("../src/agent/loop.js");
const { checkPlan, cycleOf, lessons } = await import("../src/chantiers.js");
const { parseVerdicts, pngSize } = await import("../src/chantierchecks.js");
const { resumeChantiers } = await import("../src/chantierrunner.js");
const { PLANNER_MARK } = await import("../src/chantierplanner.js");
const { REVIEW_MARK } = await import("../src/chantierchecks.js");
const { articleCardsPlan, ARTICLE_CARDS_BRIEF, ARTICLE_CARDS_TITLE } = await import("../src/chantierexample.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { ChantierPlan, ChantierView } from "../src/chantiertypes.js";

// ── A scripted model: the planner, the reviewer and each task's bot ─────────────────────────────────────────────────
let plannerAnswer = "{}";
let reviewAnswer: (req: TurnRequest) => string = () => JSON.stringify({ criteria: [{ id: "k1", verdict: "pass", why: "manifest.json: chaque texte est complet." }] });
/** What a task's bot does on an attempt: write files (into its own library), then say complete. */
type Work = (o: { key: string; n: number; out: string; botId: string; chantier: string }) => Promise<void | "silent"> | void | "silent";
let work: Record<string, Work> = {};
const holds = new Map<string, Promise<void>>();
const running = new Set<string>();
const seenTasks: string[] = [];
let n = 0;
const textOf = (b: Block[]) => b.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
const botByOut = new Map<string, string>();

registerProvider({
  id: "chx", label: "Chantier test", models: ["chx-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 100, outputTokens: 20, cachedTokens: 0 };
    const done = (content: Block[]): TurnResult => ({ content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "chx-1", usage });
    if (req.system.includes(PLANNER_MARK)) return done([{ type: "text", text: plannerAnswer }]);
    if (req.system.includes(REVIEW_MARK)) return done([{ type: "text", text: reviewAnswer(req) }]);
    const last = req.messages[req.messages.length - 1];
    if (last.content.some((b) => b.type === "tool_result")) return done([{ type: "text", text: "Fait." }]);
    const all = req.messages.map((m) => textOf(m.content)).join("\n");
    const briefs = [...all.matchAll(/Your task "([a-z0-9-]+)".*?Attempt (\d+) of[\s\S]*?under "(chantiers\/[^"]+)\/"/g)];
    const m = briefs[briefs.length - 1];
    if (!m) return done([{ type: "text", text: "ok" }]);
    const [, key, at, out] = m;
    const chantier = out.split("/")[1];
    seenTasks.push(`${key}#${at}`);
    running.add(key);
    let said: void | "silent";
    try {
      await holds.get(key);
      said = await work[key]?.({ key, n: Number(at), out, botId: botByOut.get(`${chantier}/${key}`)!, chantier });
    } finally { running.delete(key); }
    if (said === "silent") return done([{ type: "text", text: "J'ai fini les fichiers." }]);
    return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "complete", summary: `${key} livré`, evidence: `fichiers écrits dans ${out}` } }]);
  },
});

// ── Helpers ───────────────────────────────────────────────────────────────────────────────────────────────────────
type Who = "a" | "b";
const jars: Record<Who, string> = { a: "", b: "" };
async function call(who: Who, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 1200): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const view = async (id: string): Promise<ChantierView & { problems: string[] }> => (await call("a", "GET", `/chantiers/${id}`)).json;
const stateOf = async (id: string, key: string) => (await view(id)).tasks.find((t) => t.key === key)?.state;
const write = (botId: string, rel: string, data: string | Buffer) => { const full = resolveInWorkspace(botId, rel); mkdirSync(path.dirname(full), { recursive: true }); writeFileSync(full, data); };
/** A minimal PNG header of the given size (enough for the size check). */
const png = (w: number, h: number) => { const b = Buffer.alloc(33); b.writeUInt32BE(0x89504e47, 0); b.writeUInt32BE(0x0d0a1a0a, 4); b.writeUInt32BE(13, 8); b.write("IHDR", 12, "ascii"); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
const CARDS = ["Un article devient des cartes.", "Chaque carte se corrige.", "On exporte une image par carte."];
const quiet = async () => { await until(() => !botQueue.unfinished().length && [id.ada, id.bea, id.cid].every((b) => !runningThreads(b).length), "the bots to settle"); await new Promise((r) => setTimeout(r, 80)); };

const id: Record<string, string> = {};
const goodWork: Record<string, Work> = {
  recherche: ({ botId, out }) => write(botId, `${out}/sources.md`, "# Tailles\n- 1080 × 1350 : portrait conseillé (source : guide public de la plateforme).\n"),
  exigences: ({ botId, out }) => { write(botId, `${out}/exigences.md`, "# Exigences\n- une image par carte\n"); write(botId, `${out}/cards.json`, JSON.stringify({ cards: CARDS.map((text) => ({ text })) })); },
  export: ({ botId, out, chantier, n: at }) => {
    // Attempt 1 forgets the last card (a real kind of defect); later attempts export all of them.
    const count = at === 1 && exportBugOnFirst ? 2 : 3;
    for (let i = 0; i < count; i++) write(botId, `${out}/images/carte-${i + 1}.png`, png(1080, 1350));
    write(botId, `${out}/cards.json`, JSON.stringify({ cards: CARDS.map((text) => ({ text })) }));
    write(botId, `${out}/manifest.json`, JSON.stringify({ files: CARDS.map((text, i) => ({ file: `images/carte-${i + 1}.png`, text })) }));
    inputsSeen.push(...[`chantiers/${chantier}/entrees/export/essai-${at}/exigences/cards.json`].filter((p) => { try { return existsSync(resolveInWorkspace(botId, p)); } catch { return false; } }));
  },
};
let exportBugOnFirst = true;
const inputsSeen: string[] = [];
const examplePlan = (): ChantierPlan => articleCardsPlan({ research: id.ada, build: id.bea, review: id.cid });
async function create(plan: ChantierPlan, title = ARTICLE_CARDS_TITLE): Promise<string> {
  plannerAnswer = JSON.stringify(plan);
  const r = await call("a", "POST", "/chantiers", { title, brief: ARTICLE_CARDS_BRIEF, plannerBotId: id.ada });
  assert.equal(r.status, 200, r.text);
  const cid = r.json.chantier.id;
  await until(async () => (await view(cid)).chantier.status === "proposed", "the plan");
  for (const t of plan.tasks) botByOut.set(`${cid}/${t.key}`, t.botId);
  return cid;
}
const answered = (p: ChantierPlan): ChantierPlan => ({ ...p, unknowns: p.unknowns.map((u) => ({ ...u, answer: "12 au plus" })) });

test("setup: owner A with three bots (Ada researches, Bea builds, Cid specifies and reviews); stranger B", async () => {
  assert.equal((await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr" })).status, 200);
  assert.equal((await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123" })).status, 200);
  id.ada = (await call("a", "POST", "/bots", { name: "Ada" })).json.bot.id;
  id.bea = (await call("a", "POST", "/bots", { name: "Bea" })).json.bot.id;
  id.cid = (await call("a", "POST", "/bots", { name: "Cid" })).json.bot.id;
  id.bobBot = (await call("b", "POST", "/bots", { name: "Bobby" })).json.bot.id;
  // Bots act without asking for files of their own library (the gates themselves are unchanged and tested elsewhere).
  work = goodWork;
});

test("plan check: contract fields, reviewer ≠ producer, links, cycles, integration needs its link", () => {
  const userA = bots.byId(id.ada)!.userId;
  const ok = checkPlan(examplePlan(), userA, "fr");
  assert.deepEqual(ok.problems, []);
  assert.equal(ok.plan.tasks.length, 4);
  const bad = examplePlan();
  bad.tasks[2].reviewerBotId = id.bea; // same as the producer
  bad.tasks[0].contract.scope = [];
  bad.edges.push({ from: "ensemble", to: "recherche", artifact: "x" }, { from: "export", to: "nowhere", artifact: "y" });
  bad.edges = bad.edges.filter((e) => e.to !== "ensemble");
  const p = checkPlan(bad, userA, "fr").problems.join("\n");
  assert.match(p, /relecteur doit être un autre bot/);
  assert.match(p, /ne doit pas changer \(périmètre\)/);
  assert.match(p, /n'existent pas : export → nowhere/);
  assert.match(p, /vérifie le résultat de « export » : ajoute un lien export → ensemble/);
  assert.equal(cycleOf(["a", "b", "c"], [{ from: "a", to: "b", artifact: "" }, { from: "b", to: "c", artifact: "" }, { from: "c", to: "a", artifact: "" }]), "a → b → c → a");
  // A bot of another account cannot be named (isolation).
  const foreign = examplePlan();
  foreign.tasks[0].botId = id.bobBot;
  assert.match(checkPlan(foreign, userA, "fr").problems.join(), /choisis un de tes bots/);
});

test("reviewer criteria: a verdict per criterion; « pass » without a reason is not taken; missing → not sure", () => {
  const crit = [{ id: "k1", text: "lisible" }, { id: "k2", text: "complet" }, { id: "k3", text: "joli" }];
  const r = parseVerdicts(JSON.stringify({ criteria: [{ id: "k1", verdict: "pass", why: "carte 2 : texte entier" }, { id: "k2", verdict: "pass", why: "" }] }), crit, "fr");
  assert.deepEqual(r.map((x) => [x.id, x.pass, !!x.unsure]), [["k1", true, false], ["k2", false, true], ["k3", false, true]]);
  assert.deepEqual(parseVerdicts("pas du JSON", crit, "en").map((x) => x.unsure), [true, true, true]);
  assert.deepEqual(pngSize(png(1080, 1350)), { width: 1080, height: 1350 });
});

let main = "";
test("the planner card comes first: nothing runs before the owner approves, and not while a question is open", async () => {
  const r = await call("a", "POST", "/chantiers", { title: "", brief: "", plannerBotId: id.ada });
  assert.equal(r.status, 400);
  main = await create(examplePlan());
  let v = await view(main);
  assert.equal(v.chantier.status, "proposed");
  assert.equal(v.tasks.length, 0, "no task row before approval");
  assert.equal(v.chantier.plan!.tasks.length, 4);
  assert.equal(goals.forBot(id.bea).length + goals.forBot(id.ada).length + goals.forBot(id.cid).length, 0, "no goal before approval");
  // The open question must be answered first.
  const refused = await call("a", "POST", `/chantiers/${main}/approve`, {});
  assert.equal(refused.status, 400);
  assert.match(refused.json.problems.join(), /Réponds à la question ouverte/);
  assert.equal((await view(main)).tasks.length, 0);
  // Edits are saved as a proposal (still nothing runs).
  const saved = await call("a", "PUT", `/chantiers/${main}/plan`, { plan: answered(examplePlan()) });
  assert.equal(saved.status, 200, saved.text);
  assert.deepEqual(saved.json.problems, []);
  assert.equal(saved.json.chantier.status, "proposed");
  v = await view(main);
  assert.equal(v.chantier.plan!.unknowns[0].answer, "12 au plus");
});

let releaseRecherche: () => void = () => undefined;
let releaseExigences: () => void = () => undefined;
test("independent tasks run in parallel; the dependent task waits for both, then gets their artifacts", async () => {
  holds.set("recherche", new Promise<void>((r) => { releaseRecherche = r; }));
  holds.set("exigences", new Promise<void>((r) => { releaseExigences = r; }));
  const ok = await call("a", "POST", `/chantiers/${main}/approve`, {});
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.chantier.status, "running");
  await until(() => running.has("recherche") && running.has("exigences"), "both independent tasks running at once");
  assert.equal(await stateOf(main, "export"), "waiting");
  assert.equal(await stateOf(main, "ensemble"), "waiting");
  // Each task works in its own thread, as a goal of its bot.
  const v = await view(main);
  const rec = v.tasks.find((t) => t.key === "recherche")!;
  assert.ok(rec.thread > 0 && rec.goalId);
  assert.equal(goals.byId(rec.goalId!)!.thread, rec.thread);
  releaseRecherche();
  await until(async () => (await stateOf(main, "recherche")) === "accepted", "recherche accepted");
  assert.equal(await stateOf(main, "export"), "waiting", "export still waits for exigences");
  releaseExigences();
  await until(async () => (await stateOf(main, "exigences")) === "accepted", "exigences accepted");
});

test("a failing check sends back only that task, with a structured failure report; the fix passes; the integration check runs", async () => {
  const v = await until(async () => { const x = await view(main); return x.chantier.status === "done" ? x : null; }, "the chantier to finish");
  const att = (key: string) => v.attempts.filter((a) => a.taskKey === key);
  assert.equal(att("recherche").length, 1);
  assert.equal(att("exigences").length, 1);
  const [first, second] = att("export");
  assert.equal(first.result, "failed");
  assert.equal(second.result, "accepted");
  const failedCheck = first.checks.find((c) => !c.pass)!;
  assert.equal(failedCheck.id, "count");
  assert.equal(failedCheck.actual, "2 fichiers");
  assert.equal(failedCheck.expected, "3 fichiers");
  const rep = first.report!;
  assert.match(rep.component, /Export des images \(export\)/);
  assert.match(rep.conditions, /Essai 1 sur 3, par Bea/);
  assert.match(rep.failure, /autant d'images que de cartes : 2 fichiers/);
  assert.match(rep.expected, /3 fichiers/);
  assert.match(rep.repairScope, /Seulement « Export des images ».*Ne pas changer la génération du texte/);
  assert.ok(rep.recheck.some((x) => /vérifications d'ensemble de : Vérification d'ensemble/.test(x)));
  // The repair round was told the report; the other tasks were not run again.
  assert.deepEqual(seenTasks.filter((s) => s.startsWith("recherche") || s.startsWith("exigences")).sort(), ["exigences#1", "recherche#1"]);
  assert.ok(seenTasks.includes("export#2"));
  // The reviewer judged the criterion (code checks first, then the reviewer).
  assert.ok(second.checks.some((c) => c.kind === "review" && c.pass));
  // Integration check ran after the repair, on the export's output, and passed.
  assert.equal(att("ensemble").length, 1);
  assert.equal(att("ensemble")[0].result, "accepted");
  assert.ok(inputsSeen.some((p) => p.includes("/entrees/export/essai-1/exigences/cards.json")), "export got the cards of « exigences » as input");
  assert.equal(v.tasks.every((t) => t.state === "accepted"), true);
});

test("a lesson is saved with its evidence, and fed into the next chantier's checks", async () => {
  const userA = bots.byId(id.ada)!.userId;
  const l = lessons.of(userA).find((x) => x.rule === "Vérifier : autant d'images que de cartes")!;
  assert.ok(l, "lesson saved");
  assert.match(l.evidence, /l'essai 1 a échoué \(2 fichiers, attendu : 3 fichiers\) ; réussi à l'essai 2/);
  assert.match(l.appliesTo, /build/);
  assert.equal(l.check?.kind, "file_count");
  // The next chantier: a build task that exports images gets the lesson's check before it runs.
  const next = examplePlan();
  next.tasks = [next.tasks[2]];
  next.tasks[0].contract.checks = next.tasks[0].contract.checks.filter((c) => c.id !== "count");
  next.edges = [];
  next.unknowns = [];
  next.tasks[0].contract.input = "cards.json";
  const cid = await create(next, "Deuxième chantier");
  const plan = (await view(cid)).chantier.plan!;
  const added = plan.tasks[0].contract.checks.find((c) => c.fromLesson === l.id);
  assert.ok(added, "the lesson's check is in the new plan");
  assert.equal(added!.kind, "file_count");
  // The owner can revise it (and the page lists it with its evidence).
  const edited = await call("a", "PATCH", `/chantier-lessons/${l.id}`, { appliesTo: "build export images" });
  assert.equal(edited.status, 200);
  assert.ok((await view(cid)).lessons.some((x) => x.id === l.id));
  await call("a", "POST", `/chantiers/${cid}/stop`);
});

let limited = "";
test("limit of 3 attempts, then the branch stops, every attempt is kept, and the owner is asked", async () => {
  exportBugOnFirst = true;
  work = { ...goodWork, export: ({ botId, out }) => { write(botId, `${out}/cards.json`, JSON.stringify({ cards: CARDS.map((text) => ({ text })) })); write(botId, `${out}/images/carte-1.png`, png(1080, 1350)); write(botId, `${out}/manifest.json`, JSON.stringify({ files: [{ text: CARDS[0] }] })); } };
  const plan = answered(examplePlan());
  limited = await create(plan, "Chantier qui échoue");
  assert.equal((await call("a", "POST", `/chantiers/${limited}/approve`, {})).status, 200);
  const v = await until(async () => { const x = await view(limited); return x.decisions.some((d) => d.kind === "escalation" && d.status === "open") ? x : null; }, "the escalation card", 2400);
  await quiet();
  const ex = v.attempts.filter((a) => a.taskKey === "export");
  assert.equal(ex.length, 3);
  assert.ok(ex.every((a) => a.result === "failed" && a.report && a.checks.length >= 4), "every attempt kept, with checks and a report");
  assert.equal(v.tasks.find((t) => t.key === "export")!.state, "blocked");
  assert.equal(v.tasks.find((t) => t.key === "ensemble")!.state, "waiting", "the branch after it does not run");
  assert.equal(v.chantier.status, "waiting_owner");
  const d = v.decisions.find((x) => x.kind === "escalation")!;
  assert.deepEqual(d.options, ["retry", "accept", "stop_branch"]);
  assert.match(d.question, /a échoué 3 fois.*Tous les essais et leurs preuves sont gardés/);
  assert.ok(v.metrics.defects >= 1);
  // « Une tentative de plus »: a 4th attempt runs, still failing → a new card.
  assert.equal((await call("a", "POST", `/chantiers/${limited}/decisions/${d.id}`, { answer: "retry", note: "exporte toutes les cartes" })).status, 200);
  const v2 = await until(async () => { const x = await view(limited); return x.decisions.filter((y) => y.kind === "escalation" && y.status === "open").length ? (x.attempts.filter((a) => a.taskKey === "export").length === 4 ? x : null) : null; }, "the 4th attempt and a new card", 2400);
  await quiet();
  // Then stop this branch: export and what follows stop; nothing else is thrown away.
  const d2 = v2.decisions.find((x) => x.status === "open")!;
  const stopped = await call("a", "POST", `/chantiers/${limited}/decisions/${d2.id}`, { answer: "stop_branch" });
  assert.equal(stopped.status, 200);
  assert.equal(stopped.json.tasks.find((t: { key: string }) => t.key === "ensemble").state, "stopped");
  assert.equal(stopped.json.attempts.filter((a: { taskKey: string }) => a.taskKey === "export").length, 4);
  assert.equal(stopped.json.chantier.status, "stopped");
  assert.equal((await call("a", "POST", `/chantiers/${limited}/decisions/${d2.id}`, { answer: "retry" })).status, 409);
});

test("a reviewer « fail » sends the task back; « not sure » asks the owner", async () => {
  work = goodWork;
  exportBugOnFirst = false;
  let calls = 0;
  reviewAnswer = () => (++calls === 1 ? JSON.stringify({ criteria: [{ id: "k1", verdict: "fail", why: "carte 3 coupée au milieu" }] }) : JSON.stringify({ criteria: [{ id: "k1", verdict: "unsure", why: "je ne vois pas les images" }] }));
  const cid = await create(answered(examplePlan()), "Relecture");
  assert.equal((await call("a", "POST", `/chantiers/${cid}/approve`, {})).status, 200);
  const v = await until(async () => { const x = await view(cid); return x.decisions.some((d) => d.kind === "review" && d.status === "open") ? x : null; }, "the review card", 2400);
  const ex = v.attempts.filter((a) => a.taskKey === "export");
  assert.equal(ex[0].result, "failed");
  assert.match(ex[0].report!.failure, /carte 3 coupée/);
  assert.equal(ex[1].result, "blocked");
  const d = v.decisions.find((x) => x.kind === "review")!;
  assert.deepEqual(d.options, ["accept", "redo"]);
  // The owner looks and accepts: the integration check runs, the chantier ends.
  assert.equal((await call("a", "POST", `/chantiers/${cid}/decisions/${d.id}`, { answer: "accept" })).status, 200);
  await until(async () => (await view(cid)).chantier.status === "done", "done after the owner's yes");
  reviewAnswer = () => JSON.stringify({ criteria: [{ id: "k1", verdict: "pass", why: "manifest.json : textes complets" }] });
});

test("metrics: time, cost, defects, owner interventions, « continue » and restated asks with their reason", async () => {
  const v = await view(limited);
  assert.ok(v.metrics.durationMs > 0);
  assert.ok(v.metrics.tokens > 0, "tokens counted from the attempts");
  assert.equal(v.metrics.attempts, v.attempts.length);
  // approve + retry + stop_branch
  assert.equal(v.metrics.interventions, 3);
  assert.deepEqual(v.nudges.map((x) => x.kind), ["intervention", "intervention", "intervention"]);
  assert.match(v.nudges[1].reason, /export: retry — exporte toutes les cartes/);
  // A running chantier: the owner restates something, then has to say « continue » on a paused task.
  work = goodWork;
  holds.set("recherche", new Promise<void>((r) => { releaseMesures = r; }));
  const cid = await create(answered(examplePlan()), "Mesures");
  await call("a", "POST", `/chantiers/${cid}/approve`, {});
  await until(() => running.has("recherche"), "recherche running");
  const noReason = await call("a", "POST", `/chantiers/${cid}/tasks/recherche/nudge`, { kind: "restate", reason: "", text: "x" });
  assert.equal(noReason.status, 400);
  const r = await call("a", "POST", `/chantiers/${cid}/tasks/exigences/nudge`, { kind: "restate", reason: "il a oublié le format portrait", text: "Rappel : format portrait 1080 × 1350." });
  assert.equal(r.status, 200, r.text);
  const st = (await view(cid)).tasks.find((t) => t.key === "exigences")!;
  // The goal card's Resume, pressed by the owner on a paused task, counts as a « continue » with the reason it stopped.
  await until(async () => (await stateOf(cid, "exigences")) === "accepted", "exigences accepted");
  const rec = (await view(cid)).tasks.find((t) => t.key === "recherche")!;
  const g = goals.byId(rec.goalId!)!;
  goals.set(g, { status: "paused", reason: "en pause par toi" });
  assert.equal((await call("a", "POST", `/chantiers/${cid}/tasks/recherche/nudge`, { kind: "continue", reason: "il attendait sans raison" })).status, 200);
  goals.set(goals.byId(rec.goalId!)!, { status: "paused", reason: "en pause par toi" });
  assert.equal((await call("a", "POST", `/bots/${rec.botId}/goals/${rec.goalId}`, { action: "resume" })).status, 200);
  const m = (await view(cid));
  assert.equal(m.metrics.restates, 1);
  assert.equal(m.metrics.continues, 2);
  assert.ok(m.nudges.some((x) => x.kind === "restate" && /oublié le format portrait/.test(x.reason)));
  assert.ok(m.nudges.some((x) => x.kind === "continue" && /recherche: en pause par toi/.test(x.reason)));
  assert.ok(st.thread > 0);
  metricsChantier = cid;
});
let metricsChantier = "";
let releaseMesures: () => void = () => undefined;

test("owner stop: the running goals stop, everything done is kept, cards close", async () => {
  const before = await view(metricsChantier);
  const rec = before.tasks.find((t) => t.key === "recherche")!;
  const stop = await call("a", "POST", `/chantiers/${metricsChantier}/stop`);
  assert.equal(stop.status, 200);
  const v = await view(metricsChantier);
  assert.equal(v.chantier.status, "stopped");
  assert.equal(v.tasks.find((t) => t.key === "exigences")!.state, "accepted", "done work is kept");
  assert.equal(v.tasks.find((t) => t.key === "recherche")!.state, "stopped");
  assert.equal(goals.byId(rec.goalId!)!.status, "stopped");
  assert.ok(v.attempts.length >= 2);
  assert.equal((await call("a", "POST", `/chantiers/${metricsChantier}/stop`)).status, 409);
  holds.delete("recherche");
  releaseMesures();
  await quiet();
  assert.equal((await view(metricsChantier)).tasks.find((t) => t.key === "recherche")!.state, "stopped", "a late end of a stopped task changes nothing");
});

test("restart mid-chantier: a goal that ended while the server was off is checked, and the chantier goes on", async () => {
  let release: () => void = () => undefined;
  holds.set("recherche", new Promise<void>((r) => { release = r; }));
  // The bot writes its files but its turn ends without telling the runner (as if the server stopped right then).
  work = { ...goodWork, recherche: (o) => { goodWork.recherche(o); return "silent"; } };
  const cid = await create(answered(examplePlan()), "Redémarrage");
  await call("a", "POST", `/chantiers/${cid}/approve`, {});
  await until(async () => running.has("recherche") && (await stateOf(cid, "exigences")) === "accepted", "recherche running, exigences done");
  const rec = (await view(cid)).tasks.find((t) => t.key === "recherche")!;
  // Stored state at the stop: the goal is complete (written straight in the database, no runner told), the task was
  // being checked.
  q.run("UPDATE bot_goals SET status = 'complete', evidence = 'sources.md écrit' WHERE id = ?", rec.goalId);
  q.run("UPDATE chantier_tasks SET state = 'checking' WHERE chantier_id = ? AND task_key = 'recherche'", cid);
  holds.delete("recherche");
  release();
  await quiet();
  assert.equal(await stateOf(cid, "recherche"), "checking");
  work = goodWork;
  const n = resumeChantiers();
  assert.ok(n >= 1);
  await until(async () => (await stateOf(cid, "recherche")) === "accepted", "recherche accepted after the restart");
  await until(async () => (await view(cid)).chantier.status === "done", "the chantier finished after the restart", 2400);
});

test("isolation: another account sees nothing, cannot act, and cannot plan with someone else's bot", async () => {
  for (const [m, u] of [["GET", `/chantiers/${main}`], ["POST", `/chantiers/${main}/stop`], ["POST", `/chantiers/${main}/approve`], ["PUT", `/chantiers/${main}/plan`]] as const) {
    assert.equal((await call("b", m, u, {})).status, 404, `${m} ${u}`);
  }
  assert.deepEqual((await call("b", "GET", "/chantiers")).json.chantiers, []);
  assert.deepEqual((await call("b", "GET", "/chantier-lessons")).json.lessons, []);
  assert.equal((await call("b", "POST", "/chantiers", { title: "x", brief: "y", plannerBotId: id.ada })).status, 400);
  const userA = bots.byId(id.ada)!.userId;
  const lid = lessons.of(userA)[0].id;
  assert.equal((await call("b", "PATCH", `/chantier-lessons/${lid}`, { status: "retired" })).status, 404);
  // A's list shows A's chantiers with their counts.
  const list = (await call("a", "GET", "/chantiers")).json;
  assert.ok(list.chantiers.length >= 5);
  assert.ok(list.chantiers.some((c: { id: string; accepted: number }) => c.id === main && c.accepted === 4));
});

test("shared resources: two independent tasks naming the same file never run at the same time", async () => {
  const plan = answered(examplePlan());
  plan.tasks[0].resources = ["fichier:commun"];
  plan.tasks[1].resources = ["fichier:commun"];
  let release: () => void = () => undefined;
  holds.set("recherche", new Promise<void>((r) => { release = r; }));
  holds.set("exigences", Promise.resolve());
  work = goodWork;
  const cid = await create(plan, "Ressource partagée");
  await call("a", "POST", `/chantiers/${cid}/approve`, {});
  await until(() => running.has("recherche"), "the first task running");
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(await stateOf(cid, "exigences"), "waiting", "the second waits for the shared file");
  release();
  await until(async () => (await view(cid)).chantier.status === "done", "both done, one after the other", 2400);
  holds.clear();
});
