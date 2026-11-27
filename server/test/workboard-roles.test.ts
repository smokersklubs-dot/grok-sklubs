import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L163 (RESTE 23/11; clean room: docs/cleanroom/10-timon.md T10–T12 only): a model per task, project roles with their
// model and « épinglé », saved model sets, who really runs a task (and why), the open decisions.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-boardroles-"));
process.env.SESSION_SECRET = "board-roles-secret-board-roles-secret";
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
const { MAX_MODEL_SETS } = await import("../src/workboardroles.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";

/** Which model ran each board task (by title), and in which bot's request. */
const ranOn: Record<string, string> = {};
let n = 0;
const textOf = (b: Block[]) => b.filter((x) => x.type === "text").map((x) => (x as { text: string }).text).join("\n");
registerProvider({
  id: "brd", label: "Board test", models: ["brd-1", "brd-2", "brd-3"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };
    const done = (content: Block[]): TurnResult => ({ content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: req.model, usage });
    const last = req.messages[req.messages.length - 1];
    if (last.content.some((b) => b.type === "tool_result")) return done([{ type: "text", text: "Fait." }]);
    const m = [...req.messages.map((x) => textOf(x.content)).join("\n").matchAll(/\[Board task “([^”]+)”/g)].pop();
    if (!m) return done([{ type: "text", text: "ok" }]);
    ranOn[m[1]] = req.model;
    return done([{ type: "tool_use", id: `u${++n}`, name: "goal_update", input: { status: "complete", summary: `${m[1]} livré`, evidence: "rapport.md écrit" } }]);
  },
});

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const wait = async (ok: () => boolean, ms = 10_000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 20)); } };
const state = (id: string) => q.get<{ state: string }>("SELECT state FROM board_tasks WHERE id = ?", id)?.state;

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "stranger@example.com", name: "Other", password: "password-1", locale: "en" });
const lead = (await call("a", "GET", "/bots")).json.bots[0];
const reviewer = (await call("a", "POST", "/bots", { name: "Relecteur" })).json.bot;
const coder = (await call("a", "POST", "/bots", { name: "Codeuse" })).json.bot;
const strangerBot = (await call("b", "GET", "/bots")).json.bots[0];
const task = async (o: Record<string, unknown>) => (await call("a", "POST", "/board/tasks", o)).json.task;
const view = async () => (await call("a", "GET", "/board")).json;

test("T10: kind and model are checked; a model the account does not have is refused (nothing written)", async () => {
  assert.equal((await call("a", "POST", "/board/tasks", { title: "X", kind: "magic" })).status, 400);
  const bad = await call("a", "POST", "/board/tasks", { title: "X", model: "nowhere:zzz" });
  assert.equal(bad.status, 400);
  assert.match(bad.json.error, /n'est pas disponible sur ton compte/);
  assert.equal((await view()).tasks.length, 0);
  const t = await task({ title: "Avec modèle", kind: "code", model: "brd:brd-2", botId: coder.id });
  assert.equal(t.kind, "code");
  assert.equal(t.model, "brd:brd-2");
  assert.equal(t.modelFrom, "task");
});

test("T10: task model, else role model, else the bot's own — each level only fills what is empty", async () => {
  assert.equal((await call("a", "PUT", "/board/roles/research", { model: "brd:brd-3" })).status, 200);
  const own = await task({ title: "Recherche A", kind: "research", model: "brd:brd-2", botId: coder.id });
  const byRole = await task({ title: "Recherche B", kind: "research", botId: coder.id });
  const plain = await task({ title: "Corvée C", botId: coder.id });
  assert.equal(byRole.modelFrom, "role");
  assert.equal(plain.modelFrom, "bot");
  await call("a", "POST", "/board/tasks/launch", { ids: [own.id, byRole.id, plain.id] });
  await wait(() => [own.id, byRole.id, plain.id].every((id) => state(id) === "done"));
  assert.equal(ranOn["Recherche A"], "brd-2", "the task's own model wins");
  assert.equal(ranOn["Recherche B"], "brd-3", "the role's model fills it");
  assert.equal(ranOn["Corvée C"], "brd-1", "the bot's own model otherwise");
});

test("T12: a review given to the lead goes to the reviewer and the card says why; pinned role takes every task of its kind", async () => {
  await call("a", "PUT", "/board/roles/review", { botId: reviewer.id });
  const t = await task({ title: "Relire le devis", kind: "review", botId: lead.id });
  assert.equal(t.executorId, reviewer.id);
  assert.equal(t.execReason, "lead-redirected");
  const named = await task({ title: "Relire seul", kind: "review", botId: coder.id });
  assert.equal(named.executorId, coder.id, "a bot that holds no other role keeps it");
  assert.equal(named.execReason, "named");
  assert.equal((await call("a", "PUT", "/board/roles/docs", { pinned: true })).status, 400, "pinning needs a bot");
  await call("a", "PUT", "/board/roles/review", { pinned: true });
  const pinned = (await view()).tasks.find((x: any) => x.id === named.id);
  assert.equal(pinned.executorId, reviewer.id);
  assert.equal(pinned.execReason, "pinned");
  await call("a", "POST", "/board/tasks/launch", { ids: [t.id] });
  await wait(() => state(t.id) === "done");
  const after = (await view()).tasks.find((x: any) => x.id === t.id);
  assert.equal(after.botId, reviewer.id, "it ran on the reviewer");
  assert.equal(after.execReason, "pinned", "the role was pinned before it started: recorded at start");
  // Another account's bot can never hold a role.
  assert.equal((await call("a", "PUT", "/board/roles/code", { botId: strangerBot.id })).status, 400);
  assert.equal((await call("a", "PUT", "/board/roles/nope", {})).status, 404);
});

test("T12: a task with no bot starts on its role's holder; with no holder it is an open decision « personne »", async () => {
  const none = await task({ title: "Doc sans personne", kind: "docs" });
  assert.equal((await call("a", "POST", "/board/tasks/launch", { ids: [none.id] })).status, 400);
  const byRole = await task({ title: "Code par le rôle", kind: "code" });
  assert.equal((await call("a", "POST", "/board/tasks/launch", { ids: [byRole.id] })).status, 400, "no code holder yet");
  await call("a", "PUT", "/board/roles/code", { botId: coder.id });
  assert.equal((await call("a", "POST", "/board/tasks/launch", { ids: [byRole.id] })).status, 200);
  await wait(() => state(byRole.id) === "done");
  q.run("UPDATE board_tasks SET armed = 1 WHERE id = ?", none.id);
  q.run("UPDATE board_tasks SET state = 'blocked', note = 'accès refusé' WHERE title = 'Corvée C'");
  const d = (await view()).decisions;
  assert.ok(d.some((x: any) => x.taskId === none.id && x.kind === "nobody"));
  assert.ok(d.some((x: any) => x.kind === "blocked" && x.why === "accès refusé"));
  assert.equal((await call("b", "GET", "/board")).json.decisions.length, 0, "isolation");
});

test("T11: model sets — applied in one click, roles not covered keep their choice, a gone model is skipped and named", async () => {
  const before = (await view()).roles.find((r: any) => r.role === "research").model;
  assert.equal((await call("a", "POST", "/board/model-sets", { name: "", models: { code: "brd:brd-2" } })).status, 400);
  assert.equal((await call("a", "POST", "/board/model-sets", { name: "X", models: { wizard: "brd:brd-2" } })).status, 400);
  const s = (await call("a", "POST", "/board/model-sets", { name: "Économe", models: { code: "brd:brd-2", docs: "gone:old-1" } })).json.set;
  assert.equal(s.name, "Économe");
  const applied = await call("a", "POST", `/board/model-sets/${s.id}/apply`);
  assert.deepEqual(applied.json.applied, ["code"]);
  assert.deepEqual(applied.json.skipped, [{ role: "docs", model: "gone:old-1" }]);
  const roles = applied.json.roles;
  assert.equal(roles.find((r: any) => r.role === "code").model, "brd:brd-2");
  assert.equal(roles.find((r: any) => r.role === "research").model, before, "not covered: unchanged");
  assert.equal((await call("b", "POST", `/board/model-sets/${s.id}/apply`)).status, 404);
  assert.equal(MAX_MODEL_SETS, 50);
  assert.equal((await call("a", "DELETE", `/board/model-sets/${s.id}`)).status, 200);
  assert.equal((await view()).modelSets.length, 0);
});
