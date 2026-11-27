import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L142: the cost and time of a background task (its own helper's usage), and the full detail of one step (every
// argument, the whole result by call id, timing, the journal line that allowed it) — owner only, vault values removed.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-stepdetail-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { api } = await import("../src/routes.js");
const { bots, rows, history } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { addJournal } = await import("../src/journal.js");
const { taskCost, stepDetail, STEP_RESULT_MAX } = await import("../src/stepdetail.js");

const clients: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, ...(clients[who] ? { cookie: clients[who] } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set?.startsWith("sklubot_session=")) clients[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* text */ }
  return { status: res.status, json };
}

test("a background task's card: the spend of its own helper and its running time", async () => {
  const a = (await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Ana", password: "password123", locale: "fr", acceptTerms: true })).json.user.id;
  await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bo", password: "password123", acceptTerms: true });
  const bot = bots.list(a).find((x) => x.kind === "agent")!;
  const helper = bots.create(a, { name: "helper", label: "", description: "", hidden: true, parentId: bot.id } as never);
  const t0 = Date.now() - 120_000;
  q.run("INSERT INTO bg_tasks (id, bot_id, helper_id, title, goal, state, generation, created_at, updated_at) VALUES ('bgt_1', ?, ?, 'Veille', 'g', 'running', 1, ?, ?)", bot.id, helper.id, t0, t0);
  for (const [cost, est] of [[0.02, 0], [0.01, 0.005]]) q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, est_cost_usd) VALUES (?, ?, ?, 'm', 100, 50, 0, ?, ?)", a, helper.id, Date.now(), cost, est);
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, est_cost_usd) VALUES (?, ?, ?, 'm', 1, 1, 0, 9, 0)", a, bot.id, Date.now()); // the parent's own chat: not the task's
  const c = taskCost(bot.id, "bgt_1", t0 + 120_000)!;
  assert.equal(Math.round(c.costUsd * 1000), 30);
  assert.equal(c.estimatedUsd, 0.005);
  assert.equal(c.turns, 2);
  assert.equal(c.inputTokens, 200);
  assert.equal(c.endedAt, null);
  assert.equal(c.durationMs, 120_000);
  q.run("UPDATE bg_tasks SET state = 'done', updated_at = ? WHERE id = 'bgt_1'", t0 + 60_000);
  assert.equal(taskCost(bot.id, "bgt_1")!.durationMs, 60_000, "a finished task stops counting");
  assert.equal(taskCost("other", "bgt_1"), null);
  const r = await call("a", "GET", `/bots/${bot.id}/bgtasks/bgt_1/cost`);
  assert.equal(r.status, 200);
  assert.equal(r.json.turns, 2);
  assert.equal((await call("b", "GET", `/bots/${bot.id}/bgtasks/bgt_1/cost`)).status, 404, "another account sees nothing");
});

test("a step in full: all arguments, the whole result by call id, timing, the journal line", async () => {
  const a = (await call("a", "GET", "/me")).json?.user?.id ?? bots.list(Object.keys(clients)[0]).length;
  void a;
  const bot = bots.list(q.get<{ id: string }>("SELECT id FROM users WHERE email = 'a@example.com'")!.id).find((x) => x.kind === "agent")!;
  const step = rows.append(bot, { kind: "step", callId: "call_abc", tool: "web_fetch", label: "Lire la page", status: "done", args: { url: "https://example.com", note: "x".repeat(50) }, summary: "200 OK" }, 0);
  addJournal({ userId: bot.userId, botId: bot.id, tool: "web_fetch", label: "Lire la page", decision: "free", status: "done", origin: "user" });
  history.append(bot.id, bot.generation, { role: "user", content: [{ type: "tool_result", toolUseId: "call_other", content: [{ type: "text", text: "nope" }] }, { type: "tool_result", toolUseId: "call_abc", content: [{ type: "text", text: "Titre\n" + "y".repeat(STEP_RESULT_MAX) }, { type: "image", source: {} }] }] } as never);
  q.run("UPDATE rows SET created_at = created_at - 3000 WHERE bot_id = ? AND seq = ?", bot.id, step.seq);
  rows.append(bot, { kind: "message", role: "assistant", text: "fini" }, 0);
  const d = stepDetail(bot, step.seq)!;
  assert.equal(d.tool, "web_fetch");
  assert.equal(d.args.url, "https://example.com");
  assert.equal((d.args.note as string).length, 50, "arguments whole");
  assert.ok(d.result!.text.startsWith("Titre\n"));
  assert.equal(d.result!.text.length, STEP_RESULT_MAX);
  assert.equal(d.result!.truncated, true);
  assert.equal(d.result!.images, 1);
  assert.ok(d.durationMs! >= 2900, `about 3 s, got ${d.durationMs}`);
  assert.equal(d.journal?.decision, "free");
  assert.equal(stepDetail(bot, step.seq + 1), null, "a message is not a step");
  assert.equal((await call("a", "GET", `/bots/${bot.id}/steps/${step.seq}`)).json.result.images, 1);
  assert.equal((await call("b", "GET", `/bots/${bot.id}/steps/${step.seq}`)).status, 404);
  assert.equal((await call("a", "GET", `/bots/${bot.id}/steps/99999`)).status, 404);
});

test("L153 « Vérifier ce bot »: looks at the file, the page reading and the journal since the check began", async () => {
  const { saveFile } = await import("../src/computer.js");
  const { selfCheck, SELFCHECK_FILE } = await import("../src/selfcheck.js");
  const user = q.get<{ id: string }>("SELECT id FROM users WHERE email = 'a@example.com'")!.id;
  const bot = bots.list(user).find((x) => x.kind === "agent")!;
  await new Promise((r) => setTimeout(r, 5));
  const since = Date.now();
  assert.deepEqual({ ...selfCheck(user, bot.id, "SKB-ABC123", since), journal: [] }, { file: "missing", page: false, journal: [] });
  addJournal({ userId: user, botId: bot.id, tool: "web_fetch", label: "Lire", decision: "free", status: "done", origin: "user" });
  saveFile(bot.id, SELFCHECK_FILE, "SKB-ABC123\n");
  const ok = selfCheck(user, bot.id, "SKB-ABC123", since);
  assert.equal(ok.file, "match");
  assert.equal(ok.page, true);
  assert.ok(ok.journal.length >= 1);
  assert.equal(selfCheck(user, bot.id, "SKB-OTHER1", since).file, "other");
  assert.equal(selfCheck(user, bot.id, "SKB-ABC123", Date.now() + 60_000).page, false, "older lines do not count");
  assert.equal((await call("a", "GET", `/bots/${bot.id}/selfcheck?token=SKB-ABC123&since=${since}`)).json.file, "match");
  assert.equal((await call("a", "GET", `/bots/${bot.id}/selfcheck?token=../etc&since=${since}`)).status, 400);
  assert.equal((await call("b", "GET", `/bots/${bot.id}/selfcheck?token=SKB-ABC123&since=${since}`)).status, 404);
});
