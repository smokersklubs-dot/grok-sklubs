import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L165 recorded flows (agent/flowrecord.ts, flows.ts, docs/TABLEAU.md (« Parcours »)) and L173 automations without AI (automations.ts,
// docs/TABLEAU.md (« Automatisations »)): record from the bot's browser tools, replay with checks, step evidence and page comparison,
// every committing step approved by the owner each run; routines without AI, chained routines, triggers on internal
// events that never feed each other; isolation.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-flows-"));
process.env.SESSION_SECRET = "flows-secret-flows-secret-flows-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "flw:flw-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "HOSTED_MODE", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { stepOf, recordable } = await import("../src/agent/flowrecord.js");
const { compareText, continueRun, setFlowDriver } = await import("../src/flows.js");
const { onEvent } = await import("../src/automations.js");
const { fireRoutine } = await import("../src/scheduler.js");
const { bots } = await import("../src/store.js");
import type { FlowDriver } from "../src/flows.js";
import type { TurnResult } from "../src/llm/types.js";

let modelCalls = 0;
registerProvider({ id: "flw", label: "Flows test", models: ["flw-1"], available: () => true, async runTurn(): Promise<TurnResult> { modelCalls++; return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "flw-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; } });

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: "http://localhost", host: "localhost", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
const wait = async (ok: () => boolean, ms = 5000) => { const t = Date.now(); while (!ok()) { if (Date.now() - t > ms) throw new Error("timeout"); await new Promise((r) => setTimeout(r, 15)); } };

await call("a", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "stranger@example.com", name: "Other", password: "password-1", locale: "en" });
const botA = (await call("a", "GET", "/bots")).json.bots[0];

// ── A fake browser: a shop page whose price changes, controls by position ────────────────────────────────────────
const page = { url: "https://shop.example/", title: "Shop", text: "Chaussures\nPrix : 40 €" };
const labels: Record<string, string> = { "100,200": "Voir les prix", "300,400": "Payer maintenant" };
const clicks: string[] = [];
const shot = () => ({ data: Buffer.from("fake-jpeg").toString("base64"), mediaType: "image/jpeg" as const, url: page.url, title: page.title });
setFlowDriver((): FlowDriver => ({
  open: async (url) => { page.url = url; return shot(); },
  click: async (x, y) => { clicks.push(`${x},${y}`); return shot(); },
  type: async () => shot(), key: async () => shot(), scroll: async () => shot(),
  read: async () => ({ ...page }),
  targetAt: async (x, y) => ({ label: labels[`${x},${y}`] ?? "", host: "shop.example" }),
  elements: async () => ({ url: page.url, title: page.title, target: "t", loader: "l", elements: [], more: 0 }),
  elementAct: async () => ({ ok: true }),
}));

test("steps: a committing click, Enter and submit are « engage »; secrets, uploads, dialogs are never recorded", () => {
  const ok = { content: "Clicked.\nPage: Shop — https://shop.example/" };
  assert.equal(stepOf("screen_click", { x: 1, y: 2, seen_target: { label: "Voir les prix", host: "shop.example", form: "" } }, ok)!.commit, false);
  assert.equal(stepOf("screen_click", { x: 1, y: 2, seen_target: { label: "Payer maintenant", host: "shop.example", form: "" } }, ok)!.commit, true);
  assert.equal(stepOf("screen_click", { x: 1, y: 2 }, ok)!.commit, true, "a control whose words were not read: asked");
  assert.equal(stepOf("screen_key", { keys: "Enter" }, ok)!.commit, true);
  assert.equal(stepOf("screen_type", { text: "sk-fake-for-tests-1234567890abcdef1234567890" }, ok)!.kind, "blocked");
  assert.equal(stepOf("vault_type", {}, ok)!.kind, "blocked");
  assert.equal(stepOf("element_upload", {}, ok)!.kind, "blocked");
  assert.equal(stepOf("screen_click", { x: 1, y: 2 }, { content: "no", isError: true }), null, "a failed action is not a step");
  assert.equal(stepOf("browser_open", { url: "https://shop.example/a" }, ok)!.expectHost, "shop.example");
});

let flowId = "";
test("recording: the bot's own browser tools write the steps; nothing is recorded once stopped", async () => {
  const r = await call("a", "POST", "/flows/record", { botId: botA.id, name: "Surveiller le prix" });
  assert.equal(r.status, 200);
  flowId = r.json.flow.id;
  assert.equal((await call("a", "POST", "/flows/record", { botId: botA.id, name: "x" })).status, 409, "one recording per bot");
  const fake = (name: string) => recordable({ spec: { name, description: "", inputSchema: { type: "object", properties: {} } }, activity: "computer", label: name, run: async () => ({ content: "Done.\nPage: Shop — https://shop.example/" }) } as any);
  const ctx = { bot: bots.byId(botA.id)!, user: {} as any, depth: 0, signal: new AbortController().signal };
  await fake("browser_open").run({ url: "https://shop.example/" }, ctx);
  await fake("screen_click").run({ x: 100, y: 200, seen_target: { label: "Voir les prix", host: "shop.example", form: "" } }, ctx);
  await fake("page_read").run({}, ctx);
  await call("a", "POST", `/flows/${flowId}/stop`);
  await fake("screen_key").run({ keys: "Enter" }, ctx);
  const f = (await call("a", "GET", `/flows/${flowId}/runs`)).json.flow;
  assert.deepEqual(f.steps.map((s: any) => s.kind), ["open", "click", "read"]);
});

test("replay without the model: evidence for each step (address, title, excerpt, fingerprint, screenshot)", async () => {
  const before = modelCalls;
  const r = await call("a", "POST", `/flows/${flowId}/replay`);
  assert.equal(r.status, 200);
  await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r.json.run.id)!.status === "done");
  const run = (await call("a", "GET", `/flows/${flowId}/runs`)).json.runs[0];
  assert.equal(run.evidence.length, 3);
  assert.equal(run.evidence[0].url, "https://shop.example/");
  assert.match(run.evidence[2].excerpt, /40 €/);
  assert.equal(run.evidence[1].shot, true);
  assert.equal(run.changed, false, "first run: nothing to compare");
  assert.equal((await api.request(`/flow-runs/${run.id}/shots/1`, { headers: { cookie: jars.a } })).status, 200);
  assert.equal(modelCalls, before, "no model call");
});

test("page comparison: the price changed → lines added/removed, and a trigger on it fires once (a note)", async () => {
  const t = await call("a", "POST", "/triggers", { event: "flow.page_changed", subject: flowId, action: "notice", target: "Le prix a changé !", botId: botA.id });
  assert.equal(t.status, 200);
  page.text = "Chaussures\nPrix : 35 €";
  const r = await call("a", "POST", `/flows/${flowId}/replay`);
  await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r.json.run.id)!.status === "done");
  const run = (await call("a", "GET", `/flows/${flowId}/runs`)).json.runs[0];
  assert.equal(run.changed, true);
  assert.deepEqual(run.evidence[2].diff, { added: ["Prix : 35 €"], removed: ["Prix : 40 €"] });
  await wait(() => (q.get<{ fired: number }>("SELECT fired FROM event_triggers WHERE id = ?", t.json.trigger.id)!.fired) === 1);
  assert.ok(q.get("SELECT 1 FROM rows WHERE bot_id = ? AND body LIKE '%Le prix a changé%'", botA.id));
});

test("a committing step waits for the owner's approval, every run; a wrong step or a stranger cannot approve", async () => {
  const f = (await call("a", "GET", `/flows/${flowId}/runs`)).json.flow;
  q.run("UPDATE flows SET steps = ? WHERE id = ?", JSON.stringify([...f.steps, { kind: "click", x: 300, y: 400, label: "Payer maintenant", host: "shop.example", commit: true, expectHost: "shop.example" }]), flowId);
  for (let round = 0; round < 2; round++) {
    const before = clicks.length;
    const r = await call("a", "POST", `/flows/${flowId}/replay`);
    const rid = r.json.run.id;
    await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", rid)!.status === "waiting_approval");
    assert.equal(clicks.filter((c) => c === "300,400").length, clicks.slice(0, before).filter((c) => c === "300,400").length, "not clicked before approval");
    assert.equal((await call("a", "POST", `/flow-runs/${rid}/approve`, { step: 1 })).status, 409);
    assert.equal((await call("b", "POST", `/flow-runs/${rid}/approve`, { step: 3 })).status, 404);
    assert.equal((await call("a", "POST", `/flow-runs/${rid}/approve`, { step: 3 })).status, 200);
    await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", rid)!.status === "done");
    assert.equal(clicks[clicks.length - 1], "300,400");
  }
});

test("checks: the control's words changed → nothing clicked, run failed with the reason; another host → stopped", async () => {
  labels["100,200"] = "Supprimer mon compte";
  const before = clicks.length;
  const r = await call("a", "POST", `/flows/${flowId}/replay`);
  await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r.json.run.id)!.status === "failed");
  assert.equal(clicks.length, before, "nothing clicked");
  assert.match(q.get<{ note: string }>("SELECT note FROM flow_runs WHERE id = ?", r.json.run.id)!.note, /Supprimer mon compte/);
  labels["100,200"] = "Voir les prix";
  q.run("UPDATE flows SET steps = ? WHERE id = ?", JSON.stringify([{ kind: "open", url: "https://evil.example/", commit: false, expectHost: "shop.example" }]), flowId);
  const r2 = await call("a", "POST", `/flows/${flowId}/replay`);
  await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r2.json.run.id)!.status === "failed");
  assert.match(q.get<{ note: string }>("SELECT note FROM flow_runs WHERE id = ?", r2.json.run.id)!.note, /evil\.example/);
  q.run("UPDATE flows SET steps = ? WHERE id = ?", JSON.stringify([{ kind: "blocked", why: "a secret was typed", commit: true }]), flowId);
  const r3 = await call("a", "POST", `/flows/${flowId}/replay`);
  await continueRun(r3.json.run.id);
  await wait(() => q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r3.json.run.id)!.status === "failed");
  assert.equal(q.get<{ status: string }>("SELECT status FROM flow_runs WHERE id = ?", r3.json.run.id)!.status, "failed");
});

test("compareText folds whitespace and lists at most 20 lines each way", () => {
  assert.deepEqual(compareText("aa  bb\ncc", "aa bb\ndd"), { added: ["dd"], removed: ["cc"] });
  const many = Array.from({ length: 30 }, (_, i) => `ligne ${i}`).join("\n");
  assert.equal(compareText("", many).added.length, 20);
});

// ── L173 ──
const mkRoutine = (id: string, name: string) => q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES (?, ?, ?, 'x', 'cron', '0 8 * * *', 'UTC', ?)", id, botA.id, name, Date.now());
mkRoutine("rA", "Relevé");
mkRoutine("rB", "Suite");

test("a routine without AI posts its note: no model call, run done", async () => {
  const set = await call("a", "PUT", "/routines/rA/automation", { mode: "notice", target: "Relevé fait." });
  assert.equal(set.status, 200);
  const before = modelCalls;
  assert.equal(fireRoutine((await import("../src/routines.js")).routines.byId("rA")!), "fired");
  await wait(() => q.get<{ status: string }>("SELECT status FROM routine_runs WHERE routine_id = 'rA' ORDER BY at DESC LIMIT 1")!.status === "done");
  assert.equal(modelCalls, before);
  assert.ok(q.get("SELECT 1 FROM rows WHERE bot_id = ? AND body LIKE '%Relevé fait.%'", botA.id));
});

test("chained routines: B starts after A succeeded; a loop is refused", async () => {
  await call("a", "PUT", "/routines/rB/automation", { mode: "notice", target: "Suite faite.", afterRoutineId: "rA" });
  assert.equal((await call("a", "PUT", "/routines/rA/automation", { afterRoutineId: "rB" })).status, 400, "A after B after A: a loop");
  fireRoutine((await import("../src/routines.js")).routines.byId("rA")!);
  await wait(() => q.get<{ status: string }>("SELECT status FROM routine_runs WHERE routine_id = 'rB' ORDER BY at DESC LIMIT 1")?.status === "done");
});

test("a script runs only on a bot's own Linux computer (refused here); others' targets refused", async () => {
  assert.equal((await call("a", "PUT", "/routines/rA/automation", { mode: "script", target: "echo hi" })).status, 400);
  assert.equal((await call("b", "PUT", "/routines/rA/automation", { mode: "notice", target: "x" })).status, 404);
  const botB = (await call("b", "GET", "/bots")).json.bots[0];
  assert.equal((await call("b", "POST", "/triggers", { event: "board.task_done", action: "flow", target: flowId, botId: botB.id })).status, 400, "another account's flow");
  assert.equal((await call("b", "POST", "/triggers", { event: "board.task_done", action: "notice", target: "x", botId: botA.id })).status, 400, "another account's bot");
  assert.equal((await call("b", "GET", `/flows/${flowId}/runs`)).status, 404);
});

test("an event an automation caused never feeds a trigger (two triggers cannot feed each other)", async () => {
  const t = (await call("a", "POST", "/triggers", { event: "board.task_done", action: "notice", target: "Tâche finie", botId: botA.id })).json.trigger;
  const user = bots.byId(botA.id)!.userId;
  onEvent({ type: "board.task_done", userId: user, subjectId: "x", label: "x", cause: "trigger" });
  onEvent({ type: "board.task_done", userId: "someone-else", subjectId: "x", label: "x" });
  await new Promise((r) => setTimeout(r, 50));
  assert.equal(q.get<{ fired: number }>("SELECT fired FROM event_triggers WHERE id = ?", t.id)!.fired, 0);
  onEvent({ type: "board.task_done", userId: user, subjectId: "x", label: "x" });
  await wait(() => q.get<{ fired: number }>("SELECT fired FROM event_triggers WHERE id = ?", t.id)!.fired === 1);
});
