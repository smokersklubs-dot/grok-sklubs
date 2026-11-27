import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L143: a routine's parameters ({{name=default}}, a form at « Lancer maintenant », defaults on a scheduled run) and the
// iCalendar feed of the routines (read-only, secret link, replaced or removed at once, one account only).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l143-"));
process.env.SESSION_SECRET = "l143-secret-l143-secret-l143-secret-xx";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { routineParams, fillParams, cleanParamValues } = await import("../src/clientshared/routineparams.js");
const { feedEvents, feedIcs, foldLine, icsText } = await import("../src/routineical.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const asked: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    asked.push(JSON.stringify(req.messages));
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who: "a" | "b" | "none" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: who === "none" ? "" : cookies[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && who !== "none") cookies[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, type: res.headers.get("content-type") ?? "" };
}

await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
await call("POST", "/auth/signup", { email: "other@example.com", password: "password-1", locale: "en" }, "b");
const bot = (await call("GET", "/bots")).json.bots[0];
const other = (await call("GET", "/bots", undefined, "b")).json.bots[0];
const t0 = Date.now();
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES ('p1', ?, 'Météo', 'Donne la météo de {{ville=Paris}} pour {{jour}}, en {{ Ville }}.', 'cron', '0 8 * * *', 'Europe/Paris', ?)", bot.id, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES ('p2', ?, 'Point, hebdo; secret', 'Fais le point.', 'cron', '30 9 * * 1', 'Europe/Paris', ?)", bot.id, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, run_at, schedule, timezone, created_at) VALUES ('p3', ?, 'Rappel', 'Rappelle-moi.', 'once', ?, '', 'Europe/Paris', ?)", bot.id, t0 + 3 * 86_400_000, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at, enabled) VALUES ('p4', ?, 'Éteinte', 'x', 'cron', '0 7 * * *', 'Europe/Paris', ?, 0)", bot.id, t0);
q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, timezone, created_at) VALUES ('o1', ?, 'Autre compte', 'x', 'cron', '0 6 * * *', 'UTC', ?)", other.id, t0);

test("params: found in order, default kept, names compared without case, at most 10", () => {
  assert.deepEqual(routineParams("Météo de {{ville=Paris}} pour {{jour}} ({{VILLE}})"), [{ name: "ville", fallback: "Paris" }, { name: "jour", fallback: "" }]);
  assert.equal(routineParams(Array.from({ length: 14 }, (_, i) => `{{p${i}}}`).join(" ")).length, 10);
  assert.deepEqual(routineParams("Rien {ici} ni {{ }}"), []);
});

test("params: value given, else default, else the placeholder stays", () => {
  const p = "Météo de {{ville=Paris}} pour {{jour}} en {{Ville}}.";
  assert.equal(fillParams(p), "Météo de Paris pour {{jour}} en Paris.");
  assert.equal(fillParams(p, { ville: "Lyon", jour: "demain" }), "Météo de Lyon pour demain en Lyon.");
  assert.equal(fillParams("Sans paramètre {x}", { x: "y" }), "Sans paramètre {x}");
});

test("params: values are one line, at most 500 characters, without placeholders of their own", () => {
  const v = cleanParamValues({ a: "l1\nl2", b: "x".repeat(900), c: "{{d}}", e: 3, f: { no: 1 }, g: null });
  assert.equal(v.a, "l1 l2");
  assert.equal(v.b.length, 500);
  assert.equal(v.c, "d");
  assert.equal(v.e, "3");
  assert.equal("f" in v || "g" in v, false);
  assert.deepEqual(cleanParamValues(["x"]), {});
  assert.deepEqual(cleanParamValues("x"), {});
});

test("params: « Lancer maintenant » sends the typed values; the instruction saved is unchanged", async () => {
  const extras = (await call("GET", "/routines/p1/extras")).json;
  const res = await call("POST", "/routines/p1/run", { revision: extras.revision, params: { ville: "Lyon", jour: "lundi" } });
  assert.equal(res.status, 200, res.text);
  const queued = q.get<{ request: string }>("SELECT trigger AS request FROM bot_queue WHERE bot_id = ? ORDER BY rowid DESC LIMIT 1", bot.id);
  assert.ok(queued, "the run was queued");
  assert.match(queued!.request, /Donne la météo de Lyon pour lundi, en Lyon\./);
  const saved = q.get<{ prompt: string }>("SELECT prompt FROM routines WHERE id = 'p1'")!;
  assert.equal(saved.prompt, "Donne la météo de {{ville=Paris}} pour {{jour}}, en {{ Ville }}.");
});

test("calendar: no link at first; a new link works without a session; a new one replaces it; removing stops it", async () => {
  assert.deepEqual((await call("GET", "/routine-calendar")).json.active, false);
  const first = (await call("POST", "/routine-calendar")).json;
  assert.match(first.url, /\/api\/calendar\/[A-Za-z0-9_-]{32}\.ics$/);
  const path1 = new URL(first.url).pathname.replace(/^\/api/, "");
  const feed = await call("GET", path1, undefined, "none");
  assert.equal(feed.status, 200);
  assert.match(feed.type, /^text\/calendar/);
  assert.match(feed.text, /^BEGIN:VCALENDAR\r\n/);
  assert.match(feed.text, /END:VCALENDAR\r\n$/);
  assert.equal(feed.text.includes("Autre compte"), false, "another account's routines are never in it");
  assert.equal(feed.text.includes("Éteinte"), false, "a routine turned off is not in it");
  assert.equal(feed.text.includes("Donne la météo"), false, "never the instruction");
  assert.match(feed.text, /SUMMARY:.* — Point\\, hebdo\\; secret/);
  assert.equal((await call("GET", "/routine-calendar")).json.active, true);
  const second = (await call("POST", "/routine-calendar")).json;
  assert.notEqual(second.url, first.url);
  assert.equal((await call("GET", path1, undefined, "none")).status, 404, "the old link stops working");
  const path2 = new URL(second.url).pathname.replace(/^\/api/, "");
  assert.equal((await call("GET", path2, undefined, "none")).status, 200);
  await call("DELETE", "/routine-calendar");
  assert.equal((await call("GET", path2, undefined, "none")).status, 404, "removed: stops at once");
  assert.equal((await call("GET", "/calendar/not-a-token.ics", undefined, "none")).status, 404);
  assert.equal((await call("GET", "/routine-calendar", undefined, "none")).status, 401);
});

test("calendar: 30 days of runs, the one-off routine once, sorted", () => {
  const ev = feedEvents((q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", bot.id))!.user_id, t0);
  const daily = ev.filter((e) => e.uid.startsWith("p1-"));
  assert.ok(daily.length >= 29 && daily.length <= 31, `daily runs: ${daily.length}`);
  assert.ok(ev.filter((e) => e.uid.startsWith("p2-")).length >= 4);
  assert.equal(ev.filter((e) => e.uid.startsWith("p3-")).length, 1);
  assert.ok(ev.every((e, i) => i === 0 || ev[i - 1].start <= e.start));
  const ics = feedIcs(q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", bot.id)!.user_id, t0);
  assert.ok(ics.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75), "lines folded at 75 octets");
  assert.match(ics, /DTSTART:\d{8}T\d{6}Z/);
});

test("calendar: text escaping and folding follow RFC 5545", () => {
  assert.equal(icsText("a,b;c\\d\ne"), "a\\,b\\;c\\\\d\\ne");
  const long = "SUMMARY:" + "é".repeat(60);
  const folded = foldLine(long);
  assert.ok(folded.split("\r\n").every((l) => Buffer.byteLength(l, "utf8") <= 75));
  assert.equal(folded.split("\r\n").map((l, i) => (i ? l.slice(1) : l)).join(""), long, "unfolding gives the line back");
});
