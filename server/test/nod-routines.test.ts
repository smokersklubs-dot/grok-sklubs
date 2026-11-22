import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// nod audit items 2 (a model per routine / kind of work / task), 8 (run track, live activity, "run now" guard, preview),
// 13 (approve a routine's whole instruction with its scope), 45 (a correction changes only what it names), and the
// prompt rules 12 / 15 / 39 / 62 (agent/nodguidance.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-nod-routines-"));
process.env.SESSION_SECRET = "nod-routines-secret-nod-routines-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { routines } = await import("../src/routines.js");
const { dueRoutine } = await import("../src/scheduler.js");
const { modelForWork, modelForRun } = await import("../src/routineplus.js");
const { startTask } = await import("../src/agent/bgtasks.js");
const { bots, rows: chatRows } = await import("../src/store.js");
const { guessLanguage, languageLine } = await import("../src/agent/nodguidance.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const systems: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1", "script-2"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    systems.push(req.system);
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
const bot = (await call("GET", "/bots")).json.bots[0];
const t0 = Date.now();
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES ('r1', ?, 'Veille', 'Résume les nouvelles du jour.', 'cron', '0 8 * * *', 'Europe/Paris', ?)", bot.id, t0);

test("a correction changes only the fields it names; the revision guards against a stale editor", async () => {
  const first = await call("PUT", "/routines/r1", { schedule: "0 * * * *", revision: 0 });
  assert.equal(first.status, 200);
  assert.deepEqual(first.json.changed, ["schedule"]);
  assert.equal(first.json.routine.prompt, "Résume les nouvelles du jour.", "the instruction is kept");
  assert.equal(first.json.routine.timezone, "Europe/Paris");
  assert.equal(first.json.revision, 1);
  const stale = await call("PUT", "/routines/r1", { name: "Autre", revision: 0 });
  assert.equal(stale.status, 409);
  assert.match(stale.json.error, /a changé entre-temps/);
  const same = await call("PUT", "/routines/r1", { schedule: "0 * * * *" });
  assert.deepEqual(same.json.changed, [], "nothing changed: nothing saved");
  assert.equal(same.json.revision, 1);
  const badTz = await call("PUT", "/routines/r1", { timezone: "Mars/Olympus" });
  assert.equal(badTz.status, 400);
  assert.equal(badTz.json.error, "Fuseau horaire inconnu.");
  const badCron = await call("PUT", "/routines/r1", { schedule: "every day" });
  assert.equal(badCron.status, 400);
  assert.equal((await call("PUT", "/routines/r1", { name: "x" }, "b")).status, 404, "another account's routine");
  await call("PUT", "/routines/r1", { schedule: "0 8 * * *" });
});

test("preview: the next three runs and a monthly cost, nothing saved", async () => {
  const before = routines.byId("r1")!;
  const p = await call("POST", `/bots/${bot.id}/routines/preview`, { schedule: "30 7 * * 1-5", timezone: "Europe/Paris", routineId: "r1" });
  assert.equal(p.status, 200);
  assert.equal(p.json.next.length, 3);
  assert.ok(p.json.next[0] > Date.now() && p.json.next[1] > p.json.next[0]);
  assert.equal(typeof p.json.monthlyUsd, "number");
  assert.match(p.json.describe, /7 h 30/);
  assert.equal(routines.byId("r1")!.schedule, before.schedule, "not saved");
  assert.equal((await call("POST", `/bots/${bot.id}/routines/preview`, { schedule: "0 8 * * *", timezone: "Nowhere/City" })).status, 400);
  assert.equal((await call("POST", `/bots/${bot.id}/routines/preview`, { schedule: "0 8 * * *", timezone: "UTC" }, "b")).status, 404);
});

test("a late run says when it was due and how many runs were skipped; the track is kept per run", async () => {
  // A slot on the hour, three hours before the current hour: exactly three hourly slots follow it (H-2, H-1, H), whatever
  // the minute the test runs at (a slot "now - 3 h - 1 min" gave four in the first minute of an hour).
  const slot = Math.floor(Date.now() / 3600_000) * 3600_000 - 3 * 3600_000;
  q.run("UPDATE routines SET schedule = '0 * * * *', timezone = 'UTC' WHERE id = 'r1'");
  assert.equal(await dueRoutine(routines.byId("r1")!, slot), "fired");
  const rows = (await call("GET", `/bots/${bot.id}/rows`)).json?.rows ?? q.all<any>("SELECT body FROM rows WHERE bot_id = ?", bot.id).map((r) => ({ body: JSON.parse(r.body) }));
  const line = rows.map((r: any) => r.body).find((b: any) => b.kind === "event" && /Routine en cours : Veille/.test(b.text));
  assert.ok(line, "the run's line");
  assert.match(line.text, /^Prévue le .+, lancée le .+ · 3 exécutions sautées pendant l'arrêt — Routine en cours : Veille$/);
  const extras = await call("GET", "/routines/r1/extras");
  const track = extras.json.track[0];
  assert.equal(track.dueAt, slot);
  assert.equal(track.missed, 3);
  assert.ok(track.lateMs >= 3 * 3600_000);
  assert.match(track.line, /3 exécutions sautées/);
  q.run("UPDATE routines SET schedule = '0 8 * * *', timezone = 'Europe/Paris' WHERE id = 'r1'");
});

test("live activity of running routines is listed for the bot only", async () => {
  const live = await call("GET", `/bots/${bot.id}/routines/live`);
  assert.equal(live.status, 200);
  assert.ok(Array.isArray(live.json.live));
  for (const l of live.json.live) assert.equal(typeof l.steps, "number");
  assert.equal((await call("GET", `/bots/${bot.id}/routines/live`, undefined, "b")).status, 404);
});

test("run now is refused on a change made after a failed run, until the editor sends the revision it shows", async () => {
  q.run("UPDATE routine_runs SET status = 'error', at = ? WHERE routine_id = 'r1'", Date.now() - 60_000);
  const edited = await call("PUT", "/routines/r1", { prompt: "Résume les nouvelles et la météo." });
  const refused = await call("POST", "/routines/r1/run", {});
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /modifiée après un échec/);
  const stale = await call("POST", "/routines/r1/run", { revision: edited.json.revision - 1 });
  assert.equal(stale.status, 409);
  const ok = await call("POST", "/routines/r1/run", { revision: edited.json.revision });
  assert.equal(ok.status, 200);
});

test("approving the whole instruction makes a routine-scoped rule; any change of the instruction lapses it", async () => {
  const empty = await call("POST", "/routines/r1/approve", { scope: { targets: [] } });
  assert.equal(empty.status, 400);
  const ok = await call("POST", "/routines/r1/approve", { scope: { targets: ["camille@example.com"], maxRunsPerDay: 2 } });
  assert.equal(ok.status, 200);
  assert.equal(ok.json.approval.state, "approved");
  const rule = (await call("GET", "/rules")).json.rules.find((r: any) => r.routineId === "r1");
  assert.ok(rule && rule.enabled);
  assert.match(rule.text, /Consigne approuvée de la routine « Veille »/);
  assert.match(rule.text, /seulement vers : camille@example.com\. Au plus 2 exécutions par jour\./);
  // A change of the name alone keeps the approval; a change of what it does lapses it.
  await call("PUT", "/routines/r1", { name: "Veille du matin" });
  assert.equal((await call("GET", "/routines/r1/extras")).json.approval.state, "approved");
  await call("PUT", "/routines/r1", { schedule: "0 9 * * *" });
  assert.equal((await call("GET", "/routines/r1/extras")).json.approval.state, "stale");
  assert.equal((await call("GET", "/rules")).json.rules.find((r: any) => r.id === rule.id).enabled, false, "the rule no longer applies");
  // A change made elsewhere (the routine_update tool, store) lapses it too.
  await call("POST", "/routines/r1/approve", { scope: { targets: ["camille@example.com"] } });
  routines.update("r1", { prompt: "Autre chose." });
  const again = (await call("GET", "/rules")).json.rules.find((r: any) => r.routineId === "r1");
  assert.equal(again.enabled, false);
  const withdrawn = await call("DELETE", "/routines/r1/approve");
  assert.equal(withdrawn.json.approval.state, "none");
  assert.equal((await call("GET", "/rules")).json.rules.filter((r: any) => r.routineId === "r1").length, 0);
});

test("a model per routine, per kind of work and per task", async () => {
  const bad = await call("PUT", `/bots/${bot.id}/work-models`, { tasks: "not a model" });
  assert.equal(bad.status, 400);
  const set = await call("PUT", `/bots/${bot.id}/work-models`, { tasks: "script:script-2", routines: "script:script-2" });
  assert.deepEqual(set.json, { routines: "script:script-2", background: "", tasks: "script:script-2" });
  const b = bots.byId(bot.id)!;
  assert.equal(modelForWork(b, "chat"), b.model);
  assert.equal(modelForWork(b, "background"), b.model, "unset: the bot's own model");
  assert.equal(modelForWork(b, "routine", { routineId: "r1" }), "script:script-2");
  await call("PUT", "/routines/r1", { model: "script:script-1" });
  assert.equal(modelForWork(b, "routine", { routineId: "r1" }), "script:script-1", "the routine's own choice wins");
  const runId = q.get<{ id: string }>("SELECT id FROM routine_runs WHERE routine_id = 'r1' LIMIT 1")!.id;
  assert.equal(modelForRun(b, runId), "script:script-1");
  const task = startTask(b, "Recherche", "Cherche trois sources.", 0);
  assert.equal(bots.byId(task.helperId!)!.model, "script:script-2", "the task's worker runs on the model for tasks");
  const changed = await call("PUT", `/bots/${bot.id}/bgtasks/${task.id}/model`, { model: "script:script-1" });
  assert.equal(changed.json.model, "script:script-1");
  assert.equal(bots.byId(task.helperId!)!.model, "script:script-1");
  assert.equal((await call("PUT", `/bots/${bot.id}/bgtasks/${task.id}/model`, { model: "script:script-1" }, "b")).status, 404);
});

test("the reply language follows the user's latest clear message; neutral messages keep it (nod item 12)", () => {
  assert.equal(guessLanguage("Bonjour, peux-tu me faire un résumé ?"), "fr");
  assert.equal(guessLanguage("Can you please summarise this for me?"), "en");
  assert.equal(guessLanguage("ok"), null);
  assert.equal(guessLanguage("https://example.com 👍"), null);
  const b = bots.byId(bot.id)!;
  chatRows.append(b, { kind: "message", role: "user", text: "Could you check my calendar for tomorrow?" });
  assert.match(languageLine(b, "fr"), /now: English/);
  chatRows.append(b, { kind: "message", role: "user", text: "merci 👍" });
  assert.match(languageLine(b, "fr"), /now: English/, "a message whose language is unclear keeps the conversation's language");
  chatRows.append(b, { kind: "message", role: "assistant", text: "Here is your calendar for tomorrow and the rest of the week." });
  assert.match(languageLine(b, "fr"), /now: English/, "the bot's own words never set it");
  chatRows.append(b, { kind: "message", role: "user", text: "Et pour la semaine prochaine, c'est possible ?" });
  assert.match(languageLine(b, "en"), /now: French/);
});

test("the system prompt carries the connector-first and cadence rules (nod items 15, 39, 62)", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "Bonjour, que peux-tu faire pour moi ?" });
  for (let i = 0; i < 100 && !systems.length; i++) await new Promise((r) => setTimeout(r, 50));
  const sys = systems.at(-1) ?? "";
  assert.match(sys, /come after connected apps: when a connected app or account can do the work, use it/);
  assert.match(sys, /send a progress message only when a new checked result helps the user/);
  assert.match(sys, /already gave a clear answer to a choice or an offer, act on it/);
  assert.match(sys, /in the conversation's language/);
});
