import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// "Aujourd'hui" (today.ts): what waits for the user, what the bots finished (per kind, per bot), the time saved as an
// estimate (the minutes table and the owner's overrides), the day's cost; days in the user's timezone; who sees what
// (a stranger nothing, a workspace viewer only the shared bot's chat-visible results); the daily digest's schedule.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-today-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "todayx:t-1";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows, settings, approvals } = await import("../src/store.js");
const { pauses } = await import("../src/pauses.js");
const today = await import("../src/today.js");
const { DEFAULT_MINUTES, FILES_PER_TURN, minutesTable, minutesSaved, TODAY_KINDS } = await import("../src/todayminutes.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { TodayReport, TodaySettingsView } from "../src/shared.js";

registerProvider({
  id: "todayx", label: "Today test", models: ["t-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "t-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

const ORIGIN = process.env.PUBLIC_URL!;
type Who = "a" | "b" | "v";
const jars: Record<Who, string> = { a: "", b: "", v: "" };
async function call(who: Who, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const report = async (who: Who = "a", date?: string): Promise<TodayReport> => {
  const r = await call(who, "GET", `/today${date ? `?date=${date}` : ""}`);
  assert.equal(r.status, 200, r.text);
  return r.json;
};
const ins = (sql: string, ...p: (string | number | null)[]) => q.run(sql, ...p);

let userA = "", userB = "", userV = "";
const id: Record<string, string> = {};
/** An instant inside A's current day (Europe/Paris), before now. */
let at = 0;
let dayStart = 0;

test("setup: A (Paris) with three bots, a stranger B, and V a viewer of A's workspace where bot Ada is shared", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123", locale: "fr" })).json.user.id;
  userB = (await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123" })).json.user.id;
  userV = (await call("v", "POST", "/auth/signup", { email: "v@example.com", name: "Vera", password: "password123" })).json.user.id;
  settings.saveProfile(userA, { timezone: "Europe/Paris" });
  // This isolation check compares the same reporting day for owner and viewer.
  settings.saveProfile(userV, { timezone: "Europe/Paris" });
  id.ada = (await call("a", "POST", "/bots", { name: "Ada" })).json.bot.id;
  id.bea = (await call("a", "POST", "/bots", { name: "Bea" })).json.bot.id;
  id.cid = (await call("a", "POST", "/bots", { name: "Cid" })).json.bot.id;
  id.bobBot = (await call("b", "POST", "/bots", { name: "Bobby" })).json.bot.id;
  id.ws = (await call("a", "POST", "/workspaces", { name: "Studio" })).json.workspace.id;
  const inv = (await call("a", "POST", `/workspaces/${id.ws}/invites`, { email: "v@example.com", role: "viewer" })).json.invite;
  assert.equal((await call("v", "POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") })).status, 200);
  assert.equal((await call("a", "PUT", `/bots/${id.ada}/share`, { workspaceId: id.ws, access: "all" })).status, 200);
  const day = today.dayBounds("Europe/Paris", undefined, Date.now());
  dayStart = day.start;
  at = day.start + Math.floor((Date.now() - day.start) / 2);
});

test("dayBounds: the user's day, DST days of 23 and 25 hours, and dates that are not days", () => {
  const spring = today.dayBounds("Europe/Paris", "2026-03-29");
  assert.equal(spring.end - spring.start, 23 * 3_600_000);
  assert.equal(new Date(spring.start).toISOString(), "2026-03-28T23:00:00.000Z");
  const autumn = today.dayBounds("Europe/Paris", "2026-10-25");
  assert.equal(autumn.end - autumn.start, 25 * 3_600_000);
  const utc = today.dayBounds("UTC", "2026-11-16");
  assert.equal(new Date(utc.start).toISOString(), "2026-11-16T00:00:00.000Z");
  const auckland = today.dayBounds("Pacific/Auckland", "2026-11-17");
  assert.equal(new Date(auckland.start).toISOString(), "2026-11-16T11:00:00.000Z", "UTC+13 in November");
  // Today, by default, in the zone (23:30 UTC is already the next day in Paris).
  assert.equal(today.dayBounds("Europe/Paris", undefined, Date.parse("2026-11-16T23:30:00Z")).date, "2026-11-17");
  assert.equal(today.dayBounds("UTC", undefined, Date.parse("2026-11-16T23:30:00Z")).date, "2026-11-16");
  for (const bad of ["2026-02-30", "2026-13-01", "yesterday", "2026-1-1", "1999-12-31"]) assert.throws(() => today.dayBounds("UTC", bad), /YYYY-MM-DD/);
});

test("the day's boundaries follow the user's timezone (the route too), and a bad date is a 400", async () => {
  // A task finished at 23:30 UTC on 16 Nov: Paris says 17 Nov (00:30), UTC says 16 Nov.
  const late = Date.parse("2026-11-16T23:30:00Z");
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('tz_task', ?, 'Late task', 'done', ?, ?)", id.cid, late, late);
  assert.ok((await report("a", "2026-11-17")).done.some((g) => g.items.some((i) => i.title === "Late task")), "Paris: 17 Nov");
  assert.ok(!(await report("a", "2026-11-16")).done.some((g) => g.items.some((i) => i.title === "Late task")), "Paris: not 16 Nov");
  settings.saveProfile(userA, { timezone: "UTC" });
  assert.ok((await report("a", "2026-11-16")).done.some((g) => g.items.some((i) => i.title === "Late task")), "UTC: 16 Nov");
  assert.equal((await report("a", "2026-11-16")).timezone, "UTC");
  settings.saveProfile(userA, { timezone: "Europe/Paris" });
  const r = await report("a", "2026-11-17");
  assert.equal(r.timezone, "Europe/Paris");
  assert.equal(new Date(r.start).toISOString(), "2026-11-16T23:00:00.000Z");
  assert.equal((await call("a", "GET", "/today?date=2026-02-30")).status, 400);
  assert.equal((await call("a", "GET", "/today?date=hier")).status, 400);
  ins("DELETE FROM tasks WHERE id = 'tz_task'");
});

test("finished work: every kind is counted, grouped by bot, with the minutes of the table (and nothing outside the day)", async () => {
  const before = dayStart - 3_600_000;
  // Task list: one done today, one done yesterday, one still working.
  ins("INSERT INTO tasks (id, bot_id, title, state, note, created_at, updated_at) VALUES ('t1', ?, 'Write the offer', 'done', 'sent to Marc', ?, ?)", id.ada, at, at);
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('t2', ?, 'Old task', 'done', ?, ?)", id.ada, before, before);
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('t3', ?, 'Open task', 'working', ?, ?)", id.ada, at, at);
  // A background task finished, a goal completed (with its evidence), one goal still active.
  ins("INSERT INTO bg_tasks (id, bot_id, title, goal, state, result, generation, card_seq, created_at, updated_at) VALUES ('bg1', ?, 'Compare suppliers', 'x', 'done', 'Supplier B is 12 % cheaper', 1, NULL, ?, ?)", id.ada, at, at);
  ins("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, evidence, card_seq, created_at, updated_at) VALUES ('g1', ?, ?, 1, 'Clean the CRM', 'complete', 5, '312 duplicates merged; report in files/crm.md', 7, ?, ?)", id.ada, userA, at, at);
  ins("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, created_at, updated_at) VALUES ('g2', ?, ?, 1, 'Still going', 'active', 5, ?, ?)", id.bea, userA, at, at);
  // Routines: a run done, a quiet one, a failed one (not counted as finished), one from yesterday.
  ins("INSERT INTO routines (id, bot_id, name, prompt, created_at) VALUES ('r1', ?, 'Morning inbox', 'p', ?)", id.bea, at);
  for (const [rid, st, when] of [["run1", "done", at], ["run2", "quiet", at + 1], ["run3", "error", at + 2], ["run4", "done", before]] as const) ins("INSERT INTO routine_runs (id, routine_id, at, status, note) VALUES (?, 'r1', ?, ?, 'n')", rid, when, st);
  // Long commands: one ended well, one failed.
  ins("INSERT INTO bot_jobs (id, bot_id, user_id, command, status, exit_code, started_at, ended_at) VALUES ('j1', ?, ?, 'npm run build', 'done', 0, ?, ?)", id.bea, userA, at, at);
  ins("INSERT INTO bot_jobs (id, bot_id, user_id, command, status, exit_code, started_at, ended_at) VALUES ('j2', ?, ?, 'npm test', 'failed', 1, ?, ?)", id.bea, userA, at, at);
  // The journal: two emails, a Slack post, a calendar event, a page, a failed send, 4 reads close together (one
  // research) and 2 reads far apart (none).
  const j = (tool: string, label: string, when: number, status = "done", bot = id.bea) => ins("INSERT INTO action_journal (user_id, bot_id, at, tool, label, decision, status) VALUES (?, ?, ?, ?, ?, 'words', ?)", userA, bot, when, tool, label, status);
  j("gmail_perso__mail_send", "Sending an email — to Marc", at);
  j("bot_email_send", "Sending an email — to the accountant", at);
  j("slack_team__slack_post", "Posting to Slack", at);
  j("google_cal__calendar_create", "Creating an event", at);
  j("page_publish", "Publishing a page", at);
  j("gmail_perso__mail_send", "Sending an email", at, "failed");
  for (let i = 0; i < 4; i++) j("web_fetch", `Reading page ${i}`, at + i * 60_000, "done", id.cid);
  // Hours away from the other searches whatever the time of the run (just after midnight, `at` is minutes after the
  // day's start, so the start itself would sit next to them and join their group).
  j("search_web", "Search far apart 1", at - 5 * 3_600_000 > dayStart ? at - 5 * 3_600_000 : at + 6 * 3_600_000, "done", id.cid);
  j("search_web", "Search far apart 2", at + 3 * 3_600_000, "done", id.cid);
  // A turn changed 14 files (counted 10) and another 2.
  const ada = bots.byId(id.ada)!;
  const files = (n: number) => Array.from({ length: n }, (_, i) => ({ path: `src/f${i}.ts`, change: "modified" as const, added: 1, removed: 0, binary: false, oldSize: 1, newSize: 2 }));
  const big = rows.append(ada, { kind: "card", card: { type: "files", snapId: "s1", baseId: "b1", files: files(12), more: 2, status: "available" } });
  rows.append(ada, { kind: "card", card: { type: "files", snapId: "s2", baseId: "b2", files: files(2), more: 0, status: "available" } });

  const r = await report();
  const table = r.minutes.table;
  assert.deepEqual(table, { ...DEFAULT_MINUTES });
  const c = r.minutes.counts;
  assert.equal(c.task, 1);
  assert.equal(c.bgTask, 1);
  assert.equal(c.goal, 1);
  assert.equal(c.routine, 2, "done + quiet");
  assert.equal(c.job, 1);
  assert.equal(c.fileEdit, FILES_PER_TURN + 2);
  assert.equal(c.emailSent, 2);
  assert.equal(c.messagePosted, 1);
  assert.equal(c.eventBooked, 1);
  assert.equal(c.pagePublished, 1);
  assert.equal(c.research, 1, "4 reads close together; 2 far apart are not research");
  assert.equal(r.minutes.total, minutesSaved(c, table));
  assert.equal(r.minutes.total, 15 + 20 + 30 + 2 * 5 + 5 + 12 * 4 + 2 * 3 + 2 + 3 + 15 + 10);
  const adaGroup = r.done.find((g) => g.botId === id.ada)!;
  const goal = adaGroup.items.find((i) => i.kind === "goal")!;
  assert.equal(goal.title, "Clean the CRM");
  assert.match(goal.detail, /312 duplicates/, "the evidence summary");
  const bigItem = adaGroup.items.find((i) => i.kind === "fileEdit" && i.count === 14)!;
  assert.equal(bigItem.counted, FILES_PER_TURN);
  assert.equal(bigItem.minutes, FILES_PER_TURN * 4);
  assert.deepEqual(bigItem.link, { kind: "row", botId: id.ada, seq: big.seq });
  assert.equal(adaGroup.minutes, adaGroup.items.reduce((a, i) => a + i.minutes, 0));
  assert.ok(!adaGroup.items.some((i) => i.title === "Old task" || i.title === "Open task"));
  const beaGroup = r.done.find((g) => g.botId === id.bea)!;
  assert.deepEqual(beaGroup.items.filter((i) => i.kind === "routine")[0].link, { kind: "botSettings", botId: id.bea, tab: "routines" });
  assert.equal(r.done.find((g) => g.botId === id.cid)!.items.find((i) => i.kind === "research")!.count, 4);
  assert.ok(!r.done.some((g) => g.shared), "A's own bots");
  // Yesterday: only yesterday's task and run.
  const y = await report("a", today.dayBounds("Europe/Paris", undefined, dayStart - 1).date);
  assert.equal(y.minutes.counts.task, 1);
  assert.equal(y.minutes.counts.routine, 1);
  assert.equal(y.today, false);
});

test("a helper's work counts for the bot it works for", async () => {
  const helper = bots.create(userA, { name: "Ada helper", hidden: true, parentId: id.ada });
  ins("INSERT INTO action_journal (user_id, bot_id, at, tool, label, decision, status) VALUES (?, ?, ?, 'bot_email_send', 'Helper email', 'words', 'done')", userA, helper.id, at);
  const r = await report();
  assert.ok(r.done.find((g) => g.botId === id.ada)!.items.some((i) => i.title === "Helper email"));
  assert.ok(!r.done.some((g) => g.botId === helper.id));
  ins("DELETE FROM action_journal WHERE label = 'Helper email'");
});

test("what waits for you: approvals, questions, notices, a paused bot with messages, a failed routine, a sign-in — with deep links", async () => {
  const bea = bots.byId(id.bea)!;
  const cid = bots.byId(id.cid)!;
  const appr = approvals.create(bea.id, userA, bea.generation, 0, "gmail_perso__mail_send");
  const card = rows.append(bea, { kind: "card", card: { type: "approval", approvalId: appr.id, title: "Send the invoice to Marc", detail: "to marc@example.com", tool: "mail_send", source: "", status: "pending" } });
  // An approval already answered elsewhere (the table says so): not waiting.
  const gone = approvals.create(bea.id, userA, bea.generation, 0, "x");
  approvals.resolve(gone.id, "denied");
  rows.append(bea, { kind: "card", card: { type: "approval", approvalId: gone.id, title: "Old approval", detail: "", tool: "x", source: "", status: "pending" } });
  const question = rows.append(cid, { kind: "card", card: { type: "question", question: "Which supplier?", options: ["A", "B"], status: "pending" } }, 5);
  rows.append(cid, { kind: "card", card: { type: "question", question: "Answered", options: [], status: "answered", answer: "A" } });
  rows.append(cid, { kind: "notice", tone: "warn", text: "No progress for 10 minutes", action: { kind: "watch", watch: "stalled", status: "pending", minutes: 10 } });
  rows.append(cid, { kind: "notice", tone: "warn", text: "Settled", action: { kind: "watch", watch: "silent", status: "over" } });
  rows.append(bea, { kind: "card", card: { type: "disk", checkId: "d1", usedPct: 93, totalBytes: 10, freeBytes: 1, items: [], status: "pending" } });
  // Cid is paused with two messages held.
  pauses.set(userA, "bot", id.cid, userA);
  for (let i = 0; i < 2; i++) ins("INSERT INTO bot_queue (bot_id, trigger, status, created_at) VALUES (?, '{}', 'held', ?)", id.cid, at);
  // The routine's last run failed (run3, today); a built-in app needs signing in again.
  ins("INSERT INTO native_accounts (id, user_id, app, label, status, error, created_at) VALUES ('na1', ?, 'gmail', 'perso', 'needs_auth', 'token expired', ?)", userA, at);

  const r = await report();
  const kinds = r.needs.map((n) => n.kind);
  assert.deepEqual([...new Set(kinds)].sort(), ["approval", "connector", "disk", "paused", "question", "routine", "stalled"]);
  assert.equal(r.needs[0].kind, "approval", "approvals first");
  const a = r.needs.find((n) => n.kind === "approval")!;
  assert.equal(a.title, "Send the invoice to Marc");
  assert.deepEqual(a.link, { kind: "row", botId: id.bea, seq: card.seq });
  assert.ok(!r.needs.some((n) => n.title === "Old approval"));
  assert.deepEqual(r.needs.find((n) => n.kind === "question")!.link, { kind: "row", botId: id.cid, seq: question.seq, thread: 5 }, "a card in a thread opens the thread");
  assert.equal(r.needs.find((n) => n.kind === "paused")!.count, 2);
  assert.deepEqual(r.needs.find((n) => n.kind === "routine")!.link, { kind: "botSettings", botId: id.bea, tab: "routines" });
  assert.deepEqual(r.needs.find((n) => n.kind === "connector")!.link, { kind: "settings", section: "connectors" });
  // The same needs, whatever day is looked at (they are now).
  assert.equal((await report("a", "2026-01-01")).needs.length, r.needs.length);
  // Resumed and answered: gone.
  pauses.clear(userA, "bot", id.cid);
  approvals.resolve(appr.id, "allowed");
  const after = await report();
  assert.ok(!after.needs.some((n) => n.kind === "paused" || n.kind === "approval"));
});

test("the day's cost: money, tokens, subscription tokens, per bot; yesterday's lines are not counted", async () => {
  const u = (bot: string, when: number, model: string, i: number, o: number, usd: number, status = "priced", est = 0) =>
    ins("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, price_status, est_cost_usd) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?)", userA, bot, when, model, i, o, usd, status, est);
  q.run("DELETE FROM usage WHERE user_id = ?", userA);
  u(id.ada, at, "x:grok", 1000, 200, 0.5);
  u(id.bea, at, "x:grok", 500, 100, 0.25);
  u(id.bea, at, "claude-code:sonnet", 3000, 1000, 0, "subscription");
  u(id.cid, at, "x:unknown", 100, 100, 0, "unknown", 0.1);
  u(id.ada, dayStart - 10, "x:grok", 9999, 9999, 9);
  const c = (await report()).cost!;
  assert.equal(c.usd, 0.75);
  assert.equal(c.estimatedUsd, 0.1);
  assert.equal(c.inputTokens, 4600);
  assert.equal(c.outputTokens, 1400);
  assert.equal(c.subscriptionTokens, 4000);
  assert.equal(c.turns, 4);
  assert.equal(c.byBot[0].botId, id.ada);
  assert.equal(c.hosted, undefined, "hosted mode is off");
});

test("isolation: B sees nothing of A; V (viewer) sees only Ada's chat-visible results, never Bea's, A's lists or costs", async () => {
  const b = await call("b", "GET", "/today");
  assert.equal(b.status, 200);
  for (const s of [id.ada, id.bea, id.cid, "Clean the CRM", "Write the offer", "Marc", "Morning inbox"]) assert.ok(!b.text.includes(s), `B saw ${s}`);
  assert.equal(b.json.needs.length, 0);
  assert.equal(b.json.cost.usd, 0);
  assert.ok(!(await call("b", "GET", "/today/settings")).text.includes(userA));
  // V: the shared bot's completed goal and changed files; not A's task list, journal, routines, nor Bea or Cid.
  const v = await call("v", "GET", "/today");
  assert.equal(v.status, 200);
  const r: TodayReport = v.json;
  assert.deepEqual(r.done.map((g) => g.botId), [id.ada]);
  assert.ok(r.done[0].shared);
  assert.deepEqual([...new Set(r.done[0].items.map((i) => i.kind))].sort(), ["bgTask", "fileEdit", "goal"]);
  for (const s of [id.bea, id.cid, "Write the offer", "Morning inbox", "Sending an email", "npm run build"]) assert.ok(!v.text.includes(s), `V saw ${s}`);
  assert.equal(r.cost!.usd, 0, "V's own account, not A's");
  // A viewer cannot answer approvals: Ada's pending approval is not V's to fix.
  const ada = bots.byId(id.ada)!;
  const appr = approvals.create(ada.id, userA, ada.generation, 0, "x");
  rows.append(ada, { kind: "card", card: { type: "approval", approvalId: appr.id, title: "Ada approval", detail: "", tool: "x", source: "", status: "pending" } });
  assert.ok(!(await call("v", "GET", "/today")).text.includes("Ada approval"));
  assert.ok((await call("a", "GET", "/today")).text.includes("Ada approval"));
  // Promoted to admin with "owner or admins" approvals, V may answer it: it shows, marked shared.
  q.run("UPDATE workspace_members SET role = 'admin' WHERE user_id = ?", userV);
  q.run("UPDATE bot_shares SET approvals = 'owner_or_admins' WHERE bot_id = ?", id.ada);
  const v2: TodayReport = (await call("v", "GET", "/today")).json;
  const need = v2.needs.find((n) => n.title === "Ada approval")!;
  assert.ok(need?.shared);
  assert.ok(!v2.needs.some((n) => n.botId === id.bea || n.kind === "disk" || n.kind === "connector"));
  q.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ?", userV);
  q.run("UPDATE bot_shares SET approvals = 'owner' WHERE bot_id = ?", id.ada);
  approvals.resolve(appr.id, "denied");
  // Unshared: V sees nothing of Ada any more.
  assert.equal((await call("a", "DELETE", `/bots/${id.ada}/share`)).status, 200);
  const v3 = await call("v", "GET", "/today");
  assert.ok(!v3.text.includes(id.ada) && !v3.text.includes("Clean the CRM"));
  assert.equal((await call("a", "PUT", `/bots/${id.ada}/share`, { workspaceId: id.ws, access: "all" })).status, 200);
});

test("minutes table: defaults, the owner's overrides (checked), per account, and the total follows", async () => {
  assert.equal(TODAY_KINDS.length, Object.keys(DEFAULT_MINUTES).length);
  assert.deepEqual(minutesTable({ emailSent: 7, nope: 3, goal: -1, task: 9999 }), { ...DEFAULT_MINUTES, emailSent: 7 });
  const s0: TodaySettingsView = (await call("a", "GET", "/today/settings")).json;
  assert.deepEqual(s0.overrides, {});
  assert.deepEqual(s0.digest, { enabled: false, hour: 8, push: true, email: false }, "the digest is off by default");
  assert.equal(s0.timezone, "Europe/Paris");
  const base = await report();
  assert.equal((await call("a", "PUT", "/today/settings", { minutes: { emailSent: 10 } })).status, 200);
  const r = await report();
  assert.equal(r.minutes.table.emailSent, 10);
  assert.deepEqual(r.minutes.overridden, ["emailSent"]);
  assert.equal(r.minutes.total, base.minutes.total + 2 * (10 - DEFAULT_MINUTES.emailSent));
  assert.equal(r.done.find((g) => g.botId === id.bea)!.items.find((i) => i.kind === "emailSent")!.minutes, 10);
  for (const bad of [{ minutes: { nope: 3 } }, { minutes: { goal: 481 } }, { minutes: { goal: -1 } }, { minutes: { goal: "30" } }, { minutes: [1] }, { digest: { hour: 24 } }, { digest: { hour: 7.5 } }, { digest: { enabled: "yes" } }]) {
    assert.equal((await call("a", "PUT", "/today/settings", bad)).status, 400, JSON.stringify(bad));
  }
  // B's table is B's own.
  assert.equal((await call("b", "PUT", "/today/settings", { minutes: { emailSent: 60 } })).status, 200);
  assert.equal((await report()).minutes.table.emailSent, 10);
  // Back to the default (null, or the default value itself).
  await call("a", "PUT", "/today/settings", { minutes: { emailSent: null } });
  assert.deepEqual((await report()).minutes.overridden, []);
  await call("a", "PUT", "/today/settings", { minutes: { goal: DEFAULT_MINUTES.goal } });
  assert.deepEqual((await call("a", "GET", "/today/settings")).json.overrides, {});
});

test("digest: off by default; once a day at the chosen hour (the user's timezone); push and/or email; nothing to say, nothing sent", async () => {
  const sent: { push: string[]; mail: { to: string; subject: string; text: string }[] } = { push: [], mail: [] };
  let mailReady = true;
  const sender = {
    push: async (userId: string, title: string, body: string) => { sent.push.push(`${userId}|${title}|${body}`); return 1; },
    mail: async (to: string, subject: string, text: string) => { sent.mail.push({ to, subject, text }); },
    mailReady: () => mailReady,
  };
  const BASE = "https://bots.example.test";
  // 08:05 in Paris on 18 Nov 2026 (UTC+1) = 07:05 UTC.
  const eight = Date.parse("2026-11-18T07:05:00Z");
  assert.deepEqual(await today.runDigests(eight, sender, BASE), [], "nobody switched it on");
  assert.equal((await call("a", "PUT", "/today/settings", { digest: { enabled: true, hour: 8, push: true, email: true } })).status, 200);
  // Something to say about 17 Nov (Paris): a task done that day.
  const on17 = Date.parse("2026-11-17T10:00:00Z");
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('dg1', ?, 'Digest task', 'done', ?, ?)", id.cid, on17, on17);
  assert.deepEqual(await today.runDigests(Date.parse("2026-11-18T06:59:00Z"), sender, BASE), [], "07:59 in Paris: not yet");
  assert.deepEqual(await today.runDigests(eight, sender, BASE), [userA]);
  assert.equal(sent.push.length, 1);
  assert.match(sent.push[0], /Tes bots hier/, "before noon: the day before, in A's language");
  assert.equal(sent.mail.length, 1);
  assert.equal(sent.mail[0].to, "a@example.com");
  assert.match(sent.mail[0].subject, /2026-11-17/);
  assert.match(sent.mail[0].text, /Digest task/);
  assert.match(sent.mail[0].text, /estimation/);
  assert.match(sent.mail[0].text, /\/\?view=today/);
  assert.deepEqual(await today.runDigests(eight + 10 * 60_000, sender, BASE), [], "once a day");
  assert.equal((await call("a", "GET", "/today/settings")).json.lastSent, "2026-11-18");
  // The next day at 08:xx again, push only; the mail channel not configured is skipped quietly.
  await call("a", "PUT", "/today/settings", { digest: { email: false } });
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('dg2', ?, 'Digest task 2', 'done', ?, ?)", id.cid, on17 + 86_400_000, on17 + 86_400_000);
  mailReady = false;
  assert.deepEqual(await today.runDigests(eight + 86_400_000, sender, BASE), [userA]);
  assert.equal(sent.push.length, 2);
  assert.equal(sent.mail.length, 1);
  // From noon on, the day so far ("Ta journée").
  await call("a", "PUT", "/today/settings", { digest: { hour: 18 } });
  const evening = Date.parse("2026-11-20T17:10:00Z");
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('dg3', ?, 'Evening task', 'done', ?, ?)", id.cid, evening - 3_600_000, evening - 3_600_000);
  assert.deepEqual(await today.runDigests(evening, sender, BASE), [userA]);
  assert.match(sent.push[2], /Ta journée avec tes bots/);
  // Nothing waits and nothing was finished: nothing is sent (but the day is marked).
  ins("DELETE FROM native_accounts WHERE user_id = ?", userA);
  q.run("UPDATE rows SET body = json_set(body, '$.card.status', 'done') WHERE bot_id IN (?, ?, ?) AND kind = 'card'", id.ada, id.bea, id.cid);
  q.run("UPDATE rows SET body = json_set(body, '$.action.status', 'over') WHERE bot_id IN (?, ?, ?) AND kind = 'notice'", id.ada, id.bea, id.cid);
  q.run("DELETE FROM routine_runs WHERE status = 'error'");
  // A day well before every fixture and before the real clock: this check must not depend on the day the suite runs.
  assert.deepEqual((await report("a", "2026-10-05")).needs, []);
  assert.deepEqual(await today.runDigests(Date.parse("2026-10-05T16:10:00Z"), sender, BASE), [], "an empty day says nothing");
  // Switched off: nothing.
  await call("a", "PUT", "/today/settings", { digest: { enabled: false } });
  assert.deepEqual(await today.runDigests(Date.parse("2026-10-06T16:10:00Z"), sender, BASE), []);
  // B never got A's digest.
  assert.ok(!sent.push.some((p) => p.startsWith(userB)));
});

test("journalKind: built-in app actions by their action name, own tools by name, reads apart", () => {
  assert.equal(today.journalKind("gmail_work__mail_send"), "emailSent");
  assert.equal(today.journalKind("outlook_x__mail_reply"), "emailSent");
  assert.equal(today.journalKind("bot_email_send"), "emailSent");
  assert.equal(today.journalKind("slack_t__slack_post"), "messagePosted");
  assert.equal(today.journalKind("cal__calendar_update"), "eventBooked");
  assert.equal(today.journalKind("page_publish"), "pagePublished");
  assert.equal(today.journalKind("web_fetch"), "read");
  assert.equal(today.journalKind("gmail_work__mail_search"), null);
  assert.equal(today.journalKind("shell_run"), null);
});
