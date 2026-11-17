import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Modèles d'équipe" in hosted mode (HOSTED_MODE=1): the plan's limits on bots and active routines are shown in the
// preview and enforced before anything is created; a template's routines arrive paused, so they use none of the plan's
// active routines until the customer turns them on.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-tpl-hosted-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.HOSTED_MODE = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "thscript:th-1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const hosted = await import("../src/hosted.js");
const { routines } = await import("../src/routines.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

registerProvider({
  id: "thscript", label: "Script", models: ["th-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    req.onText?.("ok");
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "th-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
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
let freeId = "";
const routinesFile = `---\nformat: sklubot-equipe\nversion: 1\ntitle: Quatre routines\n---\n\n## Bot: Un\n\n${[0, 1, 2, 3, 4].map((i) => `### Routine: R${i}\n\n- cron: ${i} 9 * * *\n- timezone: Europe/Paris\n\nTâche ${i}\n`).join("\n")}\n## Bot: Deux\n\n## Bot: Trois\n`;

test("the plan's room is in the preview, and a template that does not fit creates nothing", async () => {
  assert.equal((await owner("POST", "/auth/signup", { email: "owner@example.com", password: "password123", locale: "fr" })).status, 200);
  const f = await free("POST", "/auth/signup", { email: "free@example.com", password: "password123", plan: "free", acceptTerms: true, locale: "fr" });
  assert.equal(f.status, 200, f.text);
  freeId = f.json.user.id;
  assert.equal(hosted.accountView(freeId).usage.maxBots, 2);

  const p = await free("POST", "/templates/preview", { template: "boutique-en-ligne" });
  assert.equal(p.status, 200, p.text);
  assert.deepEqual(p.json.room, { bots: 1, activeRoutines: 3 });
  assert.ok(p.json.warnings.some((w: any) => w.code === "bots_limit" && w.n === 1));

  const before = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", freeId)!.n;
  const sectionsBefore = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_sections WHERE user_id = ?", freeId)!.n;
  const r = await free("POST", "/templates/commit", { previewId: p.json.previewId, section: "Boutique", bots: [{ index: 0, include: true }, { index: 1, include: true }] });
  assert.equal(r.status, 403);
  assert.equal(r.json.code, "plan_limit");
  assert.equal(r.json.limit, "bots");
  assert.match(r.json.error, /Ton offre permet 2 bots/);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bots WHERE user_id = ?", freeId)!.n, before, "nothing was created");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_sections WHERE user_id = ?", freeId)!.n, sectionsBefore, "not even the section");
});

test("paused routines do not use the plan's active routines; turning them on meets the usual limit", async () => {
  const p = await free("POST", "/templates/preview", { text: routinesFile });
  assert.ok(p.json.warnings.some((w: any) => w.code === "routines_limit" && w.n === 3));
  const ok = await free("POST", "/templates/commit", { previewId: p.json.previewId, bots: [{ index: 0, include: true }] });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.report.routines, 5);
  const made = routines.forBot(ok.json.report.bots[0].id);
  assert.ok(made.every((x) => !x.enabled));
  assert.equal(hosted.countRoutines(freeId), 0);
  for (const x of made.slice(0, 3)) assert.equal((await free("PATCH", `/routines/${x.id}`, { enabled: true })).status, 200);
  assert.equal((await free("PATCH", `/routines/${made[3].id}`, { enabled: true })).json.limit, "routines");
  // Full of bots now: the next preview says so, a commit is refused.
  const p2 = await free("POST", "/templates/preview", { template: "secretariat" });
  assert.equal(p2.json.room.bots, 0);
  assert.equal((await free("POST", "/templates/commit", { previewId: p2.json.previewId, bots: [{ index: 0, include: true }] })).json.code, "plan_limit");
});

test("the operator has no plan limit", async () => {
  const p = await owner("POST", "/templates/preview", { text: routinesFile });
  assert.deepEqual(p.json.room, { bots: null, activeRoutines: null });
  const r = await owner("POST", "/templates/commit", { previewId: p.json.previewId, bots: [0, 1, 2].map((index) => ({ index, include: true })) });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.report.bots.length, 3);
});
