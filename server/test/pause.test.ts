import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// "Pause": pause one bot, a sidebar section, or every bot of the account; resume each. Every entry point that could start
// work is checked while paused (the owner's message, Telegram, mail, routines and webhooks, bot-to-bot, rooms, goals,
// background jobs, approvals' resume, a server restart), and what waited runs in order on resume. API turns and
// subscription turns (a fake engine) are stopped at a safe point. Owner only.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-pause-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.MAIL_DOMAIN = "bots.example.test";
delete process.env.MAX_BOTS;

// A fake Telegram (getMe, getUpdates, sendMessage), as in wave2.test.ts.
const tg = { updates: [] as any[], sent: [] as any[], nextId: 1 };
const local = createServer(async (req, res) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = chunks.length ? Buffer.concat(chunks).toString() : "";
  const json = (v: unknown) => { res.setHeader("content-type", "application/json"); res.end(JSON.stringify(v)); };
  const m = /^\/bot123456:[\w-]+\/(\w+)$/.exec(url.pathname);
  if (m) {
    if (m[1] === "getMe") return json({ ok: true, result: { username: "pause_test_bot" } });
    if (m[1] === "sendMessage") { tg.sent.push(JSON.parse(body)); return json({ ok: true, result: {} }); }
    if (m[1] === "setMessageReaction") return json({ ok: true, result: true });
    if (m[1] === "getUpdates") { await new Promise((r) => setTimeout(r, 40)); return json({ ok: true, result: tg.updates.splice(0) }); }
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { telegram } = await import("../src/telegram.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const { enqueue, recoverInterruptedTurns } = await import("../src/agent/loop.js");
const { fireRoutine, fireCheckin } = await import("../src/scheduler.js");
const { routines } = await import("../src/routines.js");
const { receiveMail, setMailResolver } = await import("../src/botmail.js");
const { botQueue } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, PauseState, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
/** Every prompt each bot was given, in order ("Name: last words"). */
const asked: string[] = [];
const toolResults: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const res = last.content.find((b) => b.type === "tool_result");
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const who = /You are (\w+)/.exec(req.system)?.[1] ?? "?";
    const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage }; };
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    if (res && res.type === "tool_result") {
      const text = res.content.map((c) => (c.type === "text" ? c.text : "")).join(" ");
      toolResults.push(`${who}: ${text}`);
      return say(`${who} done.`);
    }
    asked.push(`${who}: ${said}`);
    // A long step: it ends only when the turn is stopped (a real provider's request is aborted: it throws), or after 20 s.
    if (/work slowly/.test(said)) {
      await new Promise<void>((r, j) => { const t = setTimeout(r, 20_000); req.signal?.addEventListener("abort", () => { clearTimeout(t); j(Object.assign(new Error("aborted"), { name: "AbortError" })); }, { once: true }); });
      return say("slow step over");
    }
    const m = /message (\w+): (.*)/.exec(said);
    if (m) return use("bot_message", { bot: m[1], message: m[2] });
    return say(`${who} heard: ${said.slice(-60)}`);
  },
});

// A fake subscription engine (as in engine-queue.test.ts): "hang" never returns until it is stopped.
const engineInputs: string[] = [];
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  hold: () => () => {},
  async exec(_bot, _args, _env, _cwd, input, signal, onLine) {
    engineInputs.push(input);
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    if (/hang/.test(input)) {
      emit({ type: "system", subtype: "init", session_id: "sess-pause" });
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "h1", name: "Bash", input: { command: "sleep 99999" } }] } });
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      return { code: 130, stderr: "" };
    }
    emit({ type: "assistant", message: { content: [{ type: "text", text: `Engine fine: ${input.slice(-40)}` }] } });
    emit({ type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});
telegram.start();
setMailResolver(async () => { const e = new Error("not found") as Error & { code: string }; e.code = "ENOTFOUND"; throw e; });
after(async () => { setEngineHost(null); telegram.stopAll(); local.closeAllConnections(); await new Promise<void>((r) => local.close(() => r())); });

const jars: Record<string, string> = { a: "", b: "" };
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const botOf = async (id: string): Promise<Bot> => (await call("GET", "/bots")).json.bots.find((b: Bot) => b.id === id);
const running = async (id: string) => !!(await call("GET", "/bots")).json.live[id]?.running;
const idle = (id: string) => until(async () => !(await running(id)), "idle");
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const heldCount = (id: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_queue WHERE bot_id = ? AND status = 'held'", id)!.n;
const askedOf = (name: string) => asked.filter((a) => a.startsWith(`${name}: `));
const audits = () => q.all<{ text: string }>("SELECT text FROM audit ORDER BY id").map((r) => r.text);

let ada: Bot, bea: Bot, cy: Bot, sub: Bot;
test("setup: an owner with four bots (one on a subscription), and a stranger", async () => {
  await call("POST", "/auth/signup", { email: "owner@example.com", password: "password-1", locale: "en" });
  await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
  ada = (await call("POST", "/bots", { name: "Ada" })).json.bot;
  bea = (await call("POST", "/bots", { name: "Bea" })).json.bot;
  cy = (await call("POST", "/bots", { name: "Cy" })).json.bot;
  sub = (await call("POST", "/bots", { name: "Sub" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" })).status, 200);
  assert.equal(ada.pause, null);
  assert.deepEqual((await call("GET", "/pauses")).json, { all: null, sections: [], bots: [] });
});

test("only the owner pauses: a stranger gets 404 on the owner's bot and section, and 'everything' is only their own", async () => {
  const sec = (await call("POST", "/sections", { name: "Ops" })).json.section;
  assert.equal((await call("POST", `/bots/${ada.id}/pause`, undefined, "b")).status, 404);
  assert.equal((await call("POST", `/bots/${ada.id}/resume`, undefined, "b")).status, 404);
  assert.equal((await call("POST", `/sections/${sec.id}/pause`, undefined, "b")).status, 404);
  assert.equal((await call("POST", "/pauses/all", {}, "b")).status, 400);
  assert.equal((await call("POST", "/pauses/all", { paused: true }, "b")).status, 200);
  assert.equal((await botOf(ada.id)).pause, null, "the stranger's 'pause everything' leaves the owner's bots alone");
  assert.equal((await call("POST", "/pauses/all", { paused: false }, "b")).status, 200);
  await call("DELETE", `/sections/${sec.id}`);
});

test("pausing stops an API turn at a safe point; it goes on, first, when the bot is resumed", async () => {
  await call("POST", `/bots/${ada.id}/messages`, { text: "please work slowly on the report" });
  await until(() => askedOf("Ada").some((a) => a.includes("work slowly")), "Ada at work");
  const r = await call("POST", `/bots/${ada.id}/pause`);
  assert.equal(r.status, 200);
  assert.equal(r.json.stopped, 1);
  assert.deepEqual(r.json.state.bots.map((b: { id: string }) => b.id), [ada.id]);
  await idle(ada.id);
  await until(async () => (await notices(ada.id)).some((t) => /^Paused\. What I did so far is kept/.test(t)), "paused notice");
  const bot = await botOf(ada.id);
  assert.equal(bot.pause?.by, "bot");
  assert.equal(bot.pause?.self, true);
  // The continuation waits in the queue.
  await until(() => heldCount(ada.id) === 1, "continuation held");
  assert.ok(audits().some((t) => t.startsWith("Paused: Ada")), "an audit line");
  // A message to it while paused is kept, shown, and waits.
  const before = askedOf("Ada").length;
  await call("POST", `/bots/${ada.id}/messages`, { text: "first while paused" });
  await call("POST", `/bots/${ada.id}/messages`, { text: "second while paused" });
  await until(() => heldCount(ada.id) === 3, "messages held");
  const rows = await rowsOf(ada.id);
  assert.ok(rows.some((x) => x.body.kind === "message" && x.body.text === "second while paused"), "the message is stored and shown");
  assert.ok((await notices(ada.id)).some((t) => t === "Ada is paused: this message is kept and will be handled when it is resumed."));
  assert.equal((await botOf(ada.id)).pause?.queued, 3);
  await sleep(200);
  assert.equal(askedOf("Ada").length, before, "no model call while paused");
  // Resume: the stopped work first, then the messages in the order they came.
  const res = await call("POST", `/bots/${ada.id}/resume`);
  assert.equal(res.json.released, 3);
  await until(() => askedOf("Ada").length >= before + 3, "the waiting work ran");
  await idle(ada.id);
  const after = askedOf("Ada").slice(before);
  assert.match(after[0], /paused you in the middle of your last turn/);
  assert.match(after[1], /first while paused/);
  assert.match(after[2], /second while paused/);
  assert.equal(heldCount(ada.id), 0);
  assert.equal((await botOf(ada.id)).pause, null);
  assert.ok(audits().some((t) => t.startsWith("Resumed: Ada")));
});

test("a subscription turn is stopped the same way (its process ends), and goes on when resumed", async () => {
  await call("POST", `/bots/${sub.id}/messages`, { text: "please hang on this" });
  await until(() => engineInputs.some((i) => i.includes("hang on this")), "engine turn started");
  const r = await call("POST", `/bots/${sub.id}/pause`);
  assert.equal(r.json.stopped, 1);
  await idle(sub.id);
  await until(() => heldCount(sub.id) === 1, "engine continuation held");
  const n = engineInputs.length;
  await call("POST", `/bots/${sub.id}/resume`);
  await until(() => engineInputs.length > n, "engine continued");
  assert.match(engineInputs[n], /paused you in the middle of your last turn/);
  await idle(sub.id);
});

test("routines and webhooks of a paused bot are recorded as skipped; 'run now' is refused; resumed, they run", async () => {
  const t = Date.now();
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, hook_token, created_at) VALUES ('r_hook', ?, 'Hook', 'webhook routine prompt', 'webhook', 'hooktoken_pause', ?)", bea.id, t);
  q.run("INSERT INTO routines (id, bot_id, name, prompt, trigger, schedule, created_at) VALUES ('r_cron', ?, 'Daily', 'daily routine prompt', 'cron', '0 9 * * *', ?)", bea.id, t);
  await call("POST", `/bots/${bea.id}/pause`);
  const hook = await call("POST", "/hooks/hooktoken_pause", { order: 1 });
  assert.equal(hook.status, 200);
  assert.deepEqual(hook.json, { ok: true, skipped: "paused" });
  assert.equal(fireRoutine(routines.byId("r_cron")!), "paused");
  const run = await call("POST", "/routines/r_cron/run");
  assert.equal(run.status, 409);
  assert.match(run.json.error, /paused/);
  const skipped = q.all<{ routine_id: string; note: string }>("SELECT routine_id, note FROM routine_runs WHERE status = 'skipped'");
  assert.ok(skipped.some((s) => s.routine_id === "r_hook" && s.note === "The bot is paused: skipped."));
  assert.ok(skipped.filter((s) => s.routine_id === "r_cron").length >= 2);
  assert.equal(routines.byId("r_cron")!.failures, 0, "a skipped run is not a failure");
  assert.equal(heldCount(bea.id), 0, "routines are not queued");
  assert.equal(askedOf("Bea").length, 0);
  // A routine run already queued when the pause came is skipped too, not run later.
  const runId = q.get<{ id: string }>("SELECT id FROM routine_runs WHERE routine_id = 'r_cron' LIMIT 1")!.id;
  enqueue(bea.id, { kind: "routine", name: "Daily", text: "queued routine prompt", runId });
  await until(() => q.get<{ status: string }>("SELECT status FROM routine_runs WHERE id = ?", runId)!.status === "skipped", "queued run skipped");
  await call("POST", `/bots/${bea.id}/resume`);
  assert.equal(fireRoutine(routines.byId("r_cron")!), "fired");
  await until(() => askedOf("Bea").some((a) => a.includes("daily routine prompt")), "routine ran once resumed");
  assert.ok(!askedOf("Bea").some((a) => a.includes("queued routine prompt")));
  await idle(bea.id);
});

test("bot-to-bot: a paused bot is not messaged (the sender is told); rooms skip it and say so", async () => {
  await call("POST", `/bots/${cy.id}/pause`);
  await call("POST", `/bots/${bea.id}/messages`, { text: "message Cy: can you check the invoices?" });
  await until(() => toolResults.some((r) => r.startsWith("Bea: ") && r.includes("Cy is paused")), "Bea told");
  assert.ok(toolResults.find((r) => r.includes("Cy is paused"))!.includes("Do not route around it"));
  assert.equal(heldCount(cy.id), 0, "nothing was sent to Cy");
  assert.ok(!(await rowsOf(cy.id)).some((r) => r.body.kind === "message" && r.body.text.includes("invoices")));
  await idle(bea.id);
  // A room: Cy is mentioned (and the room's lead); Bea answers, Cy is skipped, the room says so.
  const room = { id: (await call("POST", "/rooms", { name: "Crew", botIds: [cy.id, bea.id] })).json.id as string };
  const before = askedOf("Bea").length;
  await call("POST", `/bots/${room.id}/messages`, { text: "@Cy @Bea status please" });
  await until(() => askedOf("Bea").length > before, "Bea brought in");
  assert.ok((await notices(room.id)).some((t) => t === "Cy is paused and will not answer until it is resumed."));
  // Nobody mentioned and Cy is the lead: the room goes on with the next member.
  const n = askedOf("Bea").length;
  await idle(bea.id);
  await call("POST", `/bots/${room.id}/messages`, { text: "anyone around?" });
  await until(() => askedOf("Bea").length > n, "next member takes it");
  assert.equal(askedOf("Cy").length, 0);
  await idle(bea.id);
  await call("POST", `/bots/${cy.id}/resume`);
});

test("goals are paused with their bot and resumed with it; a job's end does not wake it, it is told once resumed", async () => {
  const t = Date.now();
  q.run("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, created_at, updated_at) VALUES ('g_cy', ?, (SELECT user_id FROM bots WHERE id = ?), 1, 'Tidy the archive', 'active', 5, ?, ?)", cy.id, cy.id, t, t);
  await call("POST", `/bots/${cy.id}/pause`);
  let g = (await call("GET", `/bots/${cy.id}/goals`)).json.goals.find((x: { id: string }) => x.id === "g_cy");
  assert.equal(g.status, "paused");
  assert.equal(g.reason, "its bot is paused");
  // A goal round queued before the pause is let go (the goal comes back with the bot).
  enqueue(cy.id, { kind: "system", text: "goal round prompt", goalRound: "g_cy" });
  // A background job that ended: its message is not delivered now, it is marked to be sent again.
  q.run("INSERT INTO bot_jobs (id, bot_id, user_id, command, status, started_at, ended_at, notified) VALUES ('job_cy', ?, (SELECT user_id FROM bots WHERE id = ?), 'make build', 'done', ?, ?, 1)", cy.id, cy.id, t, t);
  enqueue(cy.id, { kind: "system", text: "job ended prompt", jobIds: ["job_cy"] });
  await until(() => q.get<{ notified: number }>("SELECT notified FROM bot_jobs WHERE id = 'job_cy'")!.notified === 0, "job end set back");
  assert.equal(heldCount(cy.id), 0);
  assert.equal(askedOf("Cy").length, 0);
  await call("POST", `/bots/${cy.id}/resume`);
  g = (await call("GET", `/bots/${cy.id}/goals`)).json.goals.find((x: { id: string }) => x.id === "g_cy");
  assert.ok(["active"].includes(g.status), `goal back to active (${g.status})`);
  await until(() => askedOf("Cy").some((a) => a.includes("Tidy the archive")), "a round of the goal ran");
  q.run("UPDATE bot_goals SET status = 'stopped' WHERE id = 'g_cy'");
  await idle(cy.id);
});

test("Telegram and mail: kept and queued while paused (Telegram says so at once); they run on resume", async () => {
  // Telegram, linked to Bea.
  const st = (await call("PUT", `/bots/${bea.id}/telegram`, { token: "123456:abcdefghijklmnopqrstuvwxyz" })).json;
  tg.updates.push({ update_id: tg.nextId++, message: { text: `/start ${st.linkCode}`, chat: { id: 42, type: "private" } } });
  await until(async () => (await call("GET", `/bots/${bea.id}/telegram`)).json.linked, "linked");
  // Mail, with auto-reply (no routine): a careful turn.
  assert.equal((await call("PUT", `/bots/${bea.id}/email`, { localPart: "bea", autoReply: true })).status, 200);
  await call("POST", `/bots/${bea.id}/pause`);
  tg.updates.push({ update_id: tg.nextId++, message: { message_id: 7, text: "from my phone", chat: { id: 42, type: "private" } } });
  await until(() => tg.sent.some((m) => m.chat_id === "42" && /⏸ Bea is paused/.test(m.text)), "Telegram told");
  const raw = Buffer.from("From: Zoe <zoe@sender.example>\r\nTo: bea@bots.example.test\r\nSubject: Quote\r\nMessage-ID: <q1@sender.example>\r\n\r\nCould you send the quote?\r\n");
  const got = await receiveMail({ raw, mailFrom: "zoe@sender.example", rcpt: ["bea@bots.example.test"], ip: "127.0.0.1", helo: "mx.sender.example" });
  assert.equal(got[0]?.status, "delivered");
  await until(() => heldCount(bea.id) === 2, "Telegram message and mail held");
  const before = askedOf("Bea").length;
  await sleep(150);
  assert.equal(askedOf("Bea").length, before);
  await call("POST", `/bots/${bea.id}/resume`);
  await until(() => askedOf("Bea").length >= before + 2, "both ran");
  const ran = askedOf("Bea").slice(before);
  assert.match(ran[0], /from my phone/);
  assert.match(ran[1], /Could you send the quote/);
  await until(() => tg.sent.some((m) => m.chat_id === "42" && /Bea heard: [\s\S]*from my phone/.test(m.text)), "reply on Telegram after resume");
  await idle(bea.id);
  await call("DELETE", `/bots/${bea.id}/telegram`);
});

test("a section: its bots are paused (one moved in too, one moved out is free); deleting it resumes them", async () => {
  const sec = (await call("POST", "/sections", { name: "Back office" })).json.section;
  await call("PATCH", `/bots/${bea.id}`, { sectionId: sec.id });
  await call("PATCH", `/bots/${cy.id}`, { sectionId: sec.id });
  const r = await call("POST", `/sections/${sec.id}/pause`);
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.state.sections.map((s: { id: string }) => s.id), [sec.id]);
  assert.equal((await call("GET", "/sections")).json.sections.find((s: { id: string }) => s.id === sec.id).paused, true);
  const b = await botOf(bea.id);
  assert.equal(b.pause?.by, "section");
  assert.equal(b.pause?.sectionId, sec.id);
  assert.equal(b.pause?.self, false);
  assert.equal((await botOf(ada.id)).pause, null, "a bot outside the section is not paused");
  // Ada moved in: paused with it. Cy moved out, with a message waiting: free, the message runs.
  await call("PATCH", `/bots/${ada.id}`, { sectionId: sec.id });
  assert.equal((await botOf(ada.id)).pause?.by, "section");
  await call("POST", `/bots/${cy.id}/messages`, { text: "cy waiting message" });
  await until(() => heldCount(cy.id) === 1, "held for Cy");
  await call("PATCH", `/bots/${cy.id}`, { sectionId: null });
  await until(() => askedOf("Cy").some((a) => a.includes("cy waiting message")), "Cy free again");
  await idle(cy.id);
  // Resuming a bot paused only by its section changes nothing: it stays paused, the answer says why.
  await call("POST", `/bots/${bea.id}/resume`);
  assert.equal((await botOf(bea.id)).pause?.by, "section");
  // Deleting the paused section resumes its bots.
  await call("POST", `/bots/${bea.id}/messages`, { text: "bea waiting message" });
  await until(() => heldCount(bea.id) === 1, "held for Bea");
  await call("DELETE", `/sections/${sec.id}`);
  await until(() => askedOf("Bea").some((a) => a.includes("bea waiting message")), "Bea free again");
  assert.equal((await botOf(ada.id)).pause, null);
  assert.deepEqual((await call("GET", "/pauses")).json.sections, []);
  await idle(bea.id);
});

test("everything: every bot (and a bot made later) is paused; resuming everything leaves a bot paused on its own paused", async () => {
  await call("POST", `/bots/${cy.id}/pause`);
  const r = await call("POST", "/pauses/all", { paused: true });
  assert.ok(r.json.state.all);
  const later = (await call("POST", "/bots", { name: "Dee" })).json.bot;
  assert.equal(later.pause?.by, "all");
  for (const id of [ada.id, bea.id, sub.id]) assert.equal((await botOf(id)).pause?.by, "all");
  assert.equal((await botOf(cy.id)).pause?.self, true);
  // The check-in of the main bot does not run while it is paused.
  const main = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  const n = asked.length;
  const owner = q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", main.id)!.user_id;
  fireCheckin(owner, 0);
  await sleep(150);
  assert.equal(asked.length, n);
  assert.equal(heldCount(main.id), 0);
  const back = await call("POST", "/pauses/all", { paused: false });
  assert.equal(back.json.state.all, null);
  assert.equal((await botOf(ada.id)).pause, null);
  assert.equal((await botOf(cy.id)).pause?.by, "bot", "Cy keeps its own pause");
  assert.ok(audits().some((t) => t === "Paused: every bot") && audits().some((t) => t.startsWith("Resumed: every bot")));
  await call("POST", `/bots/${cy.id}/resume`);
});

test("an approval answered while paused waits; a restart keeps work set aside while the bot is still paused", async () => {
  await call("POST", `/bots/${ada.id}/pause`);
  enqueue(ada.id, { kind: "resume" });
  await call("POST", `/bots/${ada.id}/messages`, { text: "after the restart" });
  await until(() => heldCount(ada.id) === 2, "held");
  // A restart: held rows of a bot still paused stay held.
  recoverInterruptedTurns();
  await sleep(100);
  assert.equal(heldCount(ada.id), 2);
  // One left held for a bot that is no longer paused (resumed while the server was down) runs at the restart.
  const row = botQueue.add(bea.id, { kind: "user", text: "held before a crash" })!;
  botQueue.hold(row);
  recoverInterruptedTurns();
  await until(() => askedOf("Bea").some((a) => a.includes("held before a crash")), "replayed");
  await call("POST", `/bots/${ada.id}/resume`);
  await until(() => askedOf("Ada").some((a) => a.includes("after the restart")), "ran after resume");
  await idle(ada.id);
  await idle(bea.id);
});

test("GET /pauses and the bot list agree", async () => {
  await call("POST", `/bots/${bea.id}/pause`);
  const st: PauseState = (await call("GET", "/pauses")).json;
  assert.deepEqual(st.bots.map((b) => b.id), [bea.id]);
  assert.equal((await botOf(bea.id)).pause?.by, "bot");
  await call("POST", `/bots/${bea.id}/resume`);
  assert.deepEqual((await call("GET", "/pauses")).json.bots, []);
});
