import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L142: the 30-day spending chart's data (usagedaily.ts: 30 UTC days, oldest first, empty days at 0, estimates apart,
// one account only) and each routine run's duration (routines.ts runs.finish records when it ended; a run still going
// has no duration).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l142-"));
process.env.SESSION_SECRET = "l142-secret-l142-secret-l142-secret-xx";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { usageDaily, DAILY_DAYS } = await import("../src/usagedaily.js");
const { runs } = await import("../src/routines.js");

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies[who] = set.split(";")[0];
  return { status: res.status, json: await res.json().catch(() => null) };
}
await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "other@example.com", password: "password-1", locale: "en" }, "b");
const me = q.get<{ id: string }>("SELECT id FROM users WHERE email = 'owner@example.com'")!.id;
const bot = (await call("GET", "/bots")).json.bots[0];
const DAY = 86_400_000;
const add = (user: string, at: number, cost: number, est = 0) =>
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, est_cost_usd) VALUES (?, ?, ?, 'm', 1, 1, 0, ?, ?)", user, bot.id, at, cost, est);

test("30 days: one bucket a day, oldest first, empty days at 0, estimates apart, older lines left out", () => {
  const now = Date.UTC(2026, 10, 23, 15, 0);
  add(me, Date.UTC(2026, 10, 23, 1), 0.5);
  add(me, Date.UTC(2026, 10, 23, 14), 0.25, 0.1);
  add(me, Date.UTC(2026, 9, 25, 12), 1); // first day of the window
  add(me, Date.UTC(2026, 9, 24, 23), 9); // the day before: out
  add("someone-else", Date.UTC(2026, 10, 23, 2), 7);
  const r = usageDaily(me, now);
  assert.equal(r.days.length, DAILY_DAYS);
  assert.equal(r.days[0].day, "2026-10-25");
  assert.equal(r.days[29].day, "2026-11-23");
  assert.deepEqual(r.days[29], { day: "2026-11-23", costUsd: 0.75, estimatedUsd: 0.1, turns: 2 });
  assert.equal(r.days[0].costUsd, 1);
  assert.equal(r.days.filter((d) => d.turns === 0).length, 28);
  assert.equal(r.totalUsd, 1.75);
  assert.equal(r.estimatedUsd, 0.1);
});

test("the route answers for the signed-in account only", async () => {
  const a = await call("GET", "/usage/daily");
  assert.equal(a.status, 200);
  assert.equal(a.json.days.length, 30);
  const b = await call("GET", "/usage/daily", undefined, "b");
  assert.equal(b.json.totalUsd, 0);
});

test("routine runs: a finished run has a duration, a run under way has none", async () => {
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES ('r1', ?, 'Point', 'x', 'cron', '0 8 * * *', 'UTC', ?)", bot.id, Date.now());
  const done = runs.start("r1");
  q.run("UPDATE routine_runs SET at = at - 90000 WHERE id = ?", done);
  runs.finish(done, "done", "ok");
  const going = runs.start("r1");
  const list = (await call("GET", "/routines/r1/runs")).json.runs as { id: string; durationMs?: number }[];
  const d = list.find((r) => r.id === done)!.durationMs!;
  assert.ok(d >= 90_000 && d < 100_000, String(d));
  assert.equal(list.find((r) => r.id === going)!.durationMs, undefined);
});
