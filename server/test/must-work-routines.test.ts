import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Doit marcher » (checklist of 24/11): an "every weekday" routine runs Monday to Friday only; « Lancer maintenant »
// (the test run) runs the task once, without creating another routine and without moving its next time.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-mw-routines-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "mwr:r";
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { nextRun, describeCron } = await import("../src/cron.js");
const loop = await import("../src/agent/loop.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { bots, users } = await import("../src/store.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

let turns = 0;
registerProvider({ id: "mwr", label: "Scripted", models: ["r"], available: () => true, async runTurn(_req: TurnRequest): Promise<TurnResult> { turns++; return { content: [{ type: "text", text: "Résumé fait." }], stopReason: "end", model: "r", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie"); if (set) cookie = set.split(";")[0];
  const text = await res.text(); let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 400; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); }
  throw new Error(`timed out waiting for ${label}`);
}

test("must work: weekday routines and the test run", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "mwr@example.com", password: "password-1", locale: "fr" })).status, 200);
  const bot = (await call("POST", "/bots", { name: "Matin" })).json.bot;
  // Every weekday at 8:30, Paris: from a Friday noon the next run is Monday; from Saturday too; Monday → Tuesday.
  const expr = "30 8 * * 1-5";
  assert.equal(describeCron(expr, "fr"), "En semaine à 8 h 30");
  const fri = Date.UTC(2030, 0, 4, 12, 0), sat = Date.UTC(2030, 0, 5, 9, 0), mon = Date.UTC(2030, 0, 7, 9, 0);
  assert.equal(new Date(nextRun(expr, "Europe/Paris", fri)!).toISOString(), "2030-01-07T07:30:00.000Z");
  assert.equal(new Date(nextRun(expr, "Europe/Paris", sat)!).toISOString(), "2030-01-07T07:30:00.000Z");
  assert.equal(new Date(nextRun(expr, "Europe/Paris", mon)!).toISOString(), "2030-01-08T07:30:00.000Z");
  let at = fri; const days: number[] = [];
  for (let i = 0; i < 10; i++) { at = nextRun(expr, "Europe/Paris", at)!; days.push(new Date(at).getUTCDay()); }
  assert.deepEqual(days, [1, 2, 3, 4, 5, 1, 2, 3, 4, 5], "two weeks: never a Saturday or a Sunday");
  const create = builtinTools().find((t) => t.spec.name === "routine_create")!;
  const made = await create.run({ kind: "cron", schedule: expr, timezone: "Europe/Paris", name: "Point du matin", prompt: "Résume mes e-mails urgents." }, { bot: bots.byId(bot.id)!, user: users.byEmail("mwr@example.com")!, depth: 0, signal: new AbortController().signal } as never);
  assert.ok(!made.isError, String(made.content));
  const list = async () => (await call("GET", `/bots/${bot.id}/routines`)).json.routines as any[];
  const before = await list();
  assert.equal(before.length, 1);
  const r = before[0];
  assert.equal(r.schedule, expr);
  // « Lancer maintenant »: one run, the task done once; still one routine, the same next time, still on.
  assert.equal((await call("POST", `/routines/${r.id}/run`)).status, 200);
  const run = await until(async () => (await call("GET", `/routines/${r.id}/runs`)).json.runs.find((x: any) => x.status !== "running"), "finished run");
  assert.equal(run.status, "done");
  await until(() => !loop.isBusy(bot.id), "idle");
  assert.equal((await call("GET", `/routines/${r.id}/runs`)).json.runs.length, 1);
  assert.equal(turns, 1, "the task ran once");
  const after = await list();
  assert.equal(after.length, before.length, "no other routine was created");
  const same = after.find((x) => x.id === r.id);
  assert.equal(same.nextRunAt, before.find((x) => x.id === r.id).nextRunAt, "the next weekday run is not moved");
  assert.equal(same.enabled, true);
});
