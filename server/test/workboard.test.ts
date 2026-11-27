import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L163 « Tableau de travail » (workboard.ts, docs/TABLEAU.md; clean room: docs/cleanroom/10-timon.md T1–T8): durable
// tasks with files, priority, start date and dependencies that wait for the REAL result; ideas promoted once and closed
// by themselves; safe delete; grouped recap; isolation between accounts.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-board-"));
process.env.SESSION_SECRET = "board-secret-board-secret-board-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "brd:brd-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS", "BOT_PARALLEL_TASKS", "HOSTED_MODE", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { goals } = await import("../src/agent/goals.js");
const { cleanStartAt, judgeFile, recapText, sweep } = await import("../src/workboard.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

/** What each board task's bot answers (by title): complete with evidence, complete without anything, or blocked. */
const answers: Record<string, "complete" | "empty" | "blocked"> = {};
const seen: string[] = [];
let n = 0;
const textOf = (b: Block[]) => b.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
registerProvider({
  id: "brd", label: "Board test", models: ["brd-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
    const done = (content: Block[]): TurnResult => ({ content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "brd-1", usage });
    const last = req.messages[req.messages.length - 1];
    if (last.content.some((b) => b.type === "tool_result")) return done([{ type: "text", text: "Fait." }]);
    const m = [...req.messages.map((x) => textOf(x.content)).join("\n").matchAll(/\[Board task “([^”]+)”/g)].pop();
    if (!m) return done([{ type: "text", text: "ok" }]);
    seen.push(m[1]);
    const a = answers[m[1]] ?? "complete";
    if (a === "blocked") return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "blocked", summary: "accès refusé au site" } }]);
    if (a === "empty") return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "complete", summary: "" } }]);
    return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "complete", summary: `${m[1]} livré`, evidence: "rapport.md écrit" } }]);
  },
});

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const raw = body instanceof Uint8Array;
  const res = await api.request(url, { method, headers: { ...(raw ? {} : { "content-type": "application/json" }), origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "", ...headers }, body: body === undefined ? undefined : raw ? body : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const wait = async (ok: () => boolean, ms = 8000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } };
const state = (id: string) => q.get<{ state: string }>("SELECT state FROM board_tasks WHERE id = ?", id)?.state;

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "stranger@example.com", name: "Other", password: "password-1", locale: "en" });
const botA = (await call("a", "GET", "/bots")).json.bots[0];
const botB = (await call("b", "GET", "/bots")).json.bots[0];

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(40, 1)]);
const upload = (who: string, id: string, name: string, bytes: Buffer, kind = "tasks") => call(who, "POST", `/board/${kind}/${id}/files`, new Uint8Array(bytes), { "x-filename": encodeURIComponent(name), "content-type": "application/octet-stream" });

test("start date: milliseconds or a dated time with its zone; seconds and free text refused; far date warns", () => {
  const t0 = Date.parse("2026-11-23T08:00:00Z");
  assert.throws(() => cleanStartAt(1_795_000_000, t0), /seconds/);
  assert.throws(() => cleanStartAt("demain 9h", t0), /time zone/);
  assert.throws(() => cleanStartAt("2026-11-23T09:00", t0), /time zone/, "no zone: refused, never read as now");
  assert.equal(cleanStartAt("2026-11-23T09:00+01:00", t0).startAt, t0);
  assert.equal(cleanStartAt(t0 + 3600_000, t0).warning, "");
  assert.match(cleanStartAt(t0 + 19 * 3600_000, t0).warning, /18 hours/);
});

test("files: checked on their content; web pages, scripts, archives, programs refused with the reason", () => {
  assert.deepEqual(judgeFile("plan.png", PNG), { type: "image/png" });
  assert.match((judgeFile("plan.png", Buffer.from("MZ not an image")) as any).refused, /does not match/);
  assert.match((judgeFile("page.html", Buffer.from("<html>")) as any).refused, /web pages/);
  assert.match((judgeFile("x.sh", Buffer.from("echo")) as any).refused, /scripts/);
  assert.match((judgeFile("a.zip", Buffer.from("PK")) as any).refused, /archives/);
  assert.match((judgeFile("a.exe", Buffer.from("MZ")) as any).refused, /programs/);
  assert.match((judgeFile("notes.txt", Buffer.from([0x61, 0x00, 0x62])) as any).refused, /does not match/);
});

let A = "", B = "";
test("a task with 2 files and a dependency survives a re-read; « débloque 1 » / « attend 1 »", async () => {
  A = (await call("a", "POST", "/board/tasks", { title: "Recherche", botId: botA.id, priority: 2, acceptance: "owner" })).json.task.id;
  const r = await call("a", "POST", "/board/tasks", { title: "Rédaction", botId: botA.id, priority: 1, deps: [A] });
  assert.equal(r.status, 200);
  B = r.json.task.id;
  assert.equal((await upload("a", B, "brief.txt", Buffer.from("Le brief, en clair."))).status, 200);
  assert.equal((await upload("a", B, "plan.png", PNG)).status, 200);
  const refused = await upload("a", B, "page.html", Buffer.from("<html></html>"));
  assert.equal(refused.status, 400);
  assert.match(refused.json.error, /n'a pas été ajouté.*web pages|pages web|web pages/);
  const view = (await call("a", "GET", "/board")).json;
  const a = view.tasks.find((t: any) => t.id === A), b = view.tasks.find((t: any) => t.id === B);
  assert.deepEqual(a.dependents, [B]);
  assert.deepEqual(b.waitingOn, [A]);
  assert.equal(b.files.length, 2);
  assert.equal(view.tasks[0].id, B, "sorted by priority (1 first)");
  // A loop is refused.
  assert.equal((await call("a", "PATCH", `/board/tasks/${A}`, { deps: [B] })).status, 400);
});

test("safe delete: a task others wait on is refused, naming them", async () => {
  const r = await call("a", "DELETE", `/board/tasks/${A}`);
  assert.equal(r.status, 409);
  assert.match(r.json.error, /« Rédaction »/);
});

test("the dependent task waits for the REAL result: review « à corriger » keeps it waiting; accepted → it starts", async () => {
  const launched = await call("a", "POST", "/board/tasks/launch", { ids: [B] });
  assert.equal(launched.status, 200);
  assert.equal(state(B), "waiting", "B waits on A");
  await call("a", "POST", "/board/tasks/launch", { ids: [A] });
  await wait(() => state(A) === "review");
  assert.equal(state(B), "waiting", "A done by its bot but not accepted: B does not start");
  // « À corriger »: back to the bot, B still waits.
  const back = await call("a", "POST", `/board/tasks/${A}/reject`, { note: "Ajoute les sources." });
  assert.equal(back.status, 200);
  await wait(() => state(A) === "review");
  assert.equal(state(B), "waiting");
  const acc = await call("a", "POST", `/board/tasks/${A}/accept`);
  assert.equal(acc.json.task.state, "done");
  await wait(() => state(B) === "done");
  assert.ok(seen.includes("Rédaction"), "B ran as a goal of its bot");
  const g = goals.byId(q.get<{ goal_id: string }>("SELECT goal_id FROM board_tasks WHERE id = ?", B)!.goal_id)!;
  assert.equal(g.origin, "board");
  assert.equal(g.status, "complete");
});

test("a goal that ends « complete » with nothing readable is not done: blocked", async () => {
  answers["Vide"] = "empty";
  const id = (await call("a", "POST", "/board/tasks", { title: "Vide", botId: botA.id })).json.task.id;
  await call("a", "POST", "/board/tasks/launch", { ids: [id] });
  await wait(() => state(id) === "running");
  const g = goals.byId(q.get<{ goal_id: string }>("SELECT goal_id FROM board_tasks WHERE id = ?", id)!.goal_id)!;
  goals.set(g, { status: "complete", summary: "", evidence: "" });
  await wait(() => state(id) === "blocked");
  assert.match(q.get<{ note: string }>("SELECT note FROM board_tasks WHERE id = ?", id)!.note, /sans dire ce qu'il a produit/);
});

test("ideas: adding orders nothing; promoted once (second time names the task); all tasks done → idea done, partial counter", async () => {
  const before = seen.length;
  const idea = (await call("a", "POST", "/board/ideas", { title: "Page tarifs", urgency: "bug", body: "Les prix sont faux." })).json.idea;
  assert.equal(idea.number, 1);
  assert.equal((await upload("a", idea.id, "capture.png", PNG, "ideas")).status, 200);
  const p1 = await call("a", "POST", `/board/ideas/${idea.id}/promote`, { botId: botA.id });
  assert.equal(p1.status, 200);
  assert.equal(p1.json.task.priority, 2, "a bug becomes priority 2");
  assert.equal(p1.json.task.files.length, 1, "the task keeps a copy of the idea's files");
  const p2 = await call("a", "POST", `/board/ideas/${idea.id}/promote`, { botId: botA.id });
  assert.equal(p2.status, 409);
  assert.match(p2.json.error, /« Page tarifs »/);
  assert.equal(seen.length, before, "nothing ran");
  const second = (await call("a", "POST", "/board/tasks", { title: "Tarifs mobile", botId: botA.id, ideaId: idea.id })).json.task.id;
  await call("a", "POST", "/board/tasks/launch", { ids: [p1.json.task.id] });
  await wait(() => state(p1.json.task.id) === "done");
  let i = (await call("a", "GET", "/board")).json.ideas.find((x: any) => x.id === idea.id);
  assert.equal(i.progress, "partial");
  assert.equal(`${i.done}/${i.total}`, "1/2");
  await call("a", "POST", "/board/tasks/launch", { ids: [second] });
  await wait(() => state(second) === "done");
  i = (await call("a", "GET", "/board")).json.ideas.find((x: any) => x.id === idea.id);
  assert.equal(i.progress, "done");
  const reopen = await call("a", "PATCH", `/board/ideas/${idea.id}`, { progress: "todo" });
  assert.equal(reopen.status, 409, "a done idea is never reopened");
});

test("an unknown state left by another version shows in « done » without being rewritten", async () => {
  const id = (await call("a", "POST", "/board/tasks", { title: "Ancienne" })).json.task.id;
  q.run("UPDATE board_tasks SET state = 'archived_v9' WHERE id = ?", id);
  sweep();
  const t = (await call("a", "GET", "/board")).json.tasks.find((x: any) => x.id === id);
  assert.equal(t.column, "done");
  assert.equal(state(id), "archived_v9");
});

test("grouped recap: blocked first, an empty result is flagged, never sent empty", () => {
  const text = recapText([
    { title: "OK", state: "done", summary: "fait", note: "", priority: 1 },
    { title: "Rien", state: "done", summary: "  ", note: "", priority: 2 },
    { title: "Coincé", state: "blocked", summary: "", note: "mot de passe manquant", priority: 3 },
  ], "fr");
  const lines = text.split("\n");
  assert.match(lines[1], /Coincé.*bloquée : mot de passe manquant/);
  assert.match(text, /Rien.*aucun résultat lisible/);
});

test("a batch of tasks: one grouped recap in the main bot's chat once all ended", async () => {
  answers["Lot 2"] = "blocked";
  const x = (await call("a", "POST", "/board/tasks", { title: "Lot 1", botId: botA.id })).json.task.id;
  const y = (await call("a", "POST", "/board/tasks", { title: "Lot 2", botId: botA.id })).json.task.id;
  await call("a", "POST", "/board/tasks/launch", { ids: [x, y] });
  await wait(() => state(x) === "done" && state(y) === "blocked");
  await wait(() => !!q.get("SELECT 1 FROM rows WHERE bot_id = ? AND body LIKE '%même lot%'", botA.id));
  const recaps = q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND body LIKE '%même lot%'", botA.id);
  assert.equal(recaps.length, 1);
  assert.ok(recaps[0].body.indexOf("Lot 2") < recaps[0].body.indexOf("Lot 1"), "the blocked one first");
});

test("isolation: another account sees nothing and cannot use your bot or your task", async () => {
  assert.equal((await call("b", "GET", "/board")).json.tasks.length, 0);
  assert.equal((await call("b", "PATCH", `/board/tasks/${B}`, { title: "x" })).status, 404);
  assert.equal((await call("b", "DELETE", `/board/tasks/${B}`)).status, 404);
  assert.equal((await call("b", "POST", "/board/tasks", { title: "x", botId: botA.id })).status, 400);
  assert.equal((await call("b", "POST", "/board/tasks", { title: "x", botId: botB.id, deps: [A] })).status, 400);
  const fid = q.get<{ id: string }>("SELECT id FROM board_files WHERE owner_id = ?", B)!.id;
  assert.equal((await call("b", "GET", `/board/tasks/${B}/files/${fid}`)).status, 404);
});
