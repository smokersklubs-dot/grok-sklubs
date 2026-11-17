import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Importer depuis Grok Bot" in hosted mode (HOSTED_MODE=1): the plan's limits on bots and active routines are shown in
// the preview and enforced before anything is created; imported routines arrive paused, so they do not use up the plan's
// active routines until the customer turns them on (where the usual limit applies).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-grok-hosted-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "ghscript:gh-1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const { routines } = await import("../src/routines.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "ghscript", label: "Script", models: ["gh-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ok");
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "gh-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: process.env.PUBLIC_URL!, host: "bots.example.test", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set && set.startsWith("sklubot_session=")) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const owner = client(), free = client();
const routinesOf = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `R${i}`, schedule: "chaque jour", cron: `${i} 9 * * *`, timezone: "Europe/Paris", task: `Tâche ${i}` }));
const reply = JSON.stringify({ format: "sklubot-bots", version: 1, bots: [{ name: "Un", routines: routinesOf(5) }, { name: "Deux" }, { name: "Trois" }] });
let freeId = "";

test("the plan's room is shown in the preview, and an import that does not fit creates nothing", async () => {
  assert.equal((await owner("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "fr" })).status, 200);
  const f = await free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "free", acceptTerms: true, locale: "fr" });
  assert.equal(f.status, 200, f.text);
  freeId = f.json.user.id;
  const plan = hosted.accountView(freeId).usage;
  assert.equal(plan.maxBots, 2);
  assert.equal(plan.maxRoutines, 3);

  const p = await free("POST", "/import/grok/preview", { text: "```json\n" + reply + "\n```" });
  assert.equal(p.status, 200, p.text);
  assert.deepEqual(p.json.room, { bots: 1, activeRoutines: 3 });
  assert.ok(p.json.warnings.some((w: any) => w.code === "bots_limit" && w.n === 1));
  assert.ok(p.json.warnings.some((w: any) => w.code === "routines_limit" && w.n === 3));

  const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", freeId)!.n;
  const r = await free("POST", "/import/grok/commit", { previewId: p.json.previewId, bots: [{ index: 0, include: true }, { index: 1, include: true }] });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "plan_limit");
  assert.equal(r.json.limit, "bots");
  assert.match(r.json.error, /Ton offre permet 2 bots/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", freeId)!.n, before, "nothing was created");

  // One bot fits; its five routines arrive paused and use none of the plan's three active routines.
  const ok = await free("POST", "/import/grok/commit", { previewId: p.json.previewId, bots: [{ index: 0, include: true, routines: routinesOf(5).map((_, i) => ({ index: i, include: true })) }] });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.report.routines, 5);
  const botId = ok.json.report.bots[0].id;
  const made = routines.forBot(botId);
  assert.equal(made.length, 5);
  assert.ok(made.every((x) => !x.enabled));
  assert.equal(hosted.countRoutines(freeId), 0);

  // Turning them on meets the usual limit: three, then a clear refusal.
  for (const x of made.slice(0, 3)) assert.equal((await free("PATCH", `/routines/${x.id}`, { enabled: true })).status, 200);
  const fourth = await free("PATCH", `/routines/${made[3].id}`, { enabled: true });
  assert.equal(fourth.status, 403);
  assert.equal(fourth.json.limit, "routines");

  // The plan is now full of bots: a new preview says so, and a commit is refused.
  const p2 = await free("POST", "/import/grok/preview", { text: reply });
  assert.deepEqual(p2.json.room.bots, 0);
  assert.equal((await free("POST", "/import/grok/commit", { previewId: p2.json.previewId, bots: [{ index: 1, include: true }] })).json.code, "plan_limit");
});

test("the operator has no plan limit", async () => {
  const p = await owner("POST", "/import/grok/preview", { text: reply });
  assert.deepEqual(p.json.room, { bots: null, activeRoutines: null });
  const r = await owner("POST", "/import/grok/commit", { previewId: p.json.previewId, bots: [0, 1, 2].map((index) => ({ index, include: true })) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.report.bots.length, 3);
});
