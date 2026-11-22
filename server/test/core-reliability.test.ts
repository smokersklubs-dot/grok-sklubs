import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Cœur, points 2, 3, 4 (modèles API), 6, 7, 8 et 9 des audits (docs/audits) : chaque défaut est d'abord reproduit, puis
// corrigé. Un modèle scénarisé joue le bot ; un accord est demandé par une commande sur le serveur (toujours demandée).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-core-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
// No container runtime here: a command runs on the server itself, which always asks first (an approval card on demand).
process.env.SHELL_ENABLED = "1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { LoopGuard, POLL_SAME_LIMIT, repeatLimit, isPollingTool } = await import("../src/agent/reliability.js");
const { publicLinksIn, linkHint } = await import("../src/agent/links.js");
const { bgTaskHooks } = await import("../src/agent/bgtasks.js");
const { crashedTurn, TurnCrashed } = await import("../src/agent/crashguard.js");
const { SEND_KEY_WINDOW_MS, sendKeys } = await import("../src/sendkeys.js");
const { setFailureTiming, resetFailureState } = await import("../src/agent/failures.js");
const { approvals, paused } = await import("../src/store.js");
const { q } = await import("../src/db.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";

setFailureTiming({ retryBaseMs: 30, retryMaxMs: 60, breakerOpenMs: 60_000 });
after(() => resetFailureState());

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const abortable = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const stop = () => { clearTimeout(t); reject(Object.assign(new Error("aborted"), { name: "AbortError" })); };
  const t = setTimeout(resolve, ms);
  if (signal?.aborted) stop(); else signal?.addEventListener("abort", stop, { once: true });
});

/**
 * Scripted model. In the last message: `call T {json}` → one tool; `chain T {json} >> T {json}` → tools one after
 * another, each after the previous one's result; `slow N: words` → waits N ms, then echoes; `crash now`
 * → reports an uncaught error of this turn (as index.ts does) and then waits for ever; otherwise it echoes the words.
 */
const requests: { texts: string[]; all: string }[] = [];
const queue: { name: string; input: Record<string, unknown> }[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const all = req.messages.map((m) => m.content.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n")).join("\n---\n");
    requests.push({ texts, all });
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    let content: Block[];
    const m = /call (\w+) (\{.*\})/s.exec(said);
    const slow = /slow (\d+): (.*)/s.exec(said);
    if (results.length && !texts.length && queue.length) { const next = queue.shift()!; content = [{ type: "tool_use", id: `call_${requests.length}`, name: next.name, input: next.input }]; }
    else if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else if (said.includes("chain ")) {
      const steps = said.slice(said.indexOf("chain ") + 6).split(" >> ").map((p) => { const x = /(\w+) (\{.*\})/s.exec(p)!; return { name: x[1], input: JSON.parse(x[2]) as Record<string, unknown> }; });
      queue.push(...steps.slice(1));
      content = [{ type: "tool_use", id: `call_${requests.length}`, name: steps[0].name, input: steps[0].input }];
    } else if (m) content = [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }];
    else if (slow) { await abortable(Number(slow[1]), req.signal); content = [{ type: "text", text: `Echo: ${slow[2]}` }]; }
    else if (/crash now/.test(said)) {
      // What index.ts does with an uncaught error: the turn it came from is found and stopped.
      const botId = crashedTurn(new Error("boom in a timer callback"));
      if (botId) loop.interrupt(botId, new TurnCrashed(new Error("boom in a timer callback")));
      await abortable(600_000, req.signal);
      content = [{ type: "text", text: "never" }];
    } else content = [{ type: "text", text: `Echo: ${said}` }];
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
};
registerProvider(scripted);

const jars: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown, who = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string, who = "a"): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`, undefined, who)).json.rows;
const userRows = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "user");
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).map((r) => (r.body as { text: string }).text);
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const approvalCards = async (id: string) => (await rowsOf(id)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" ? [r.body.card as Extract<Card, { type: "approval" }>] : []));
const stepsOf = async (id: string) => (await rowsOf(id)).flatMap((r) => (r.body.kind === "step" ? [r.body] : []));
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string, extra: Record<string, unknown> = {}) => call("POST", `/bots/${id}/messages`, { text, ...extra });
const fresh = async (name: string): Promise<Bot> => (await call("POST", "/bots", { name })).json.bot;
const askedOf = (text: string) => requests.filter((r) => r.texts.some((t) => t.includes(text))).length;

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "core@example.com", password: "password-1", locale: "fr" });
  await call("POST", "/auth/signup", { email: "other@example.com", password: "password-2", locale: "fr" }, "b");
});

// ── Point 2 : identifiant d'envoi ─────────────────────────────────────────────
test("point 2: the same send key sent twice gives one message and one turn, and the first answer again", async () => {
  const bot = await fresh("Idem");
  const first = await say(bot.id, "bonjour une fois", { clientKey: "key-0001-aaaa" });
  // The reply was lost on the way: the composer sends the same message again, with the same key.
  const second = await say(bot.id, "bonjour une fois", { clientKey: "key-0001-aaaa" });
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.json.row.seq, first.json.row.seq, "the original row comes back");
  await idle(bot.id);
  assert.equal((await userRows(bot.id)).length, 1, "one message in the chat");
  assert.equal(askedOf("bonjour une fois"), 1, "one turn");
  assert.deepEqual(await replies(bot.id), ["Echo: bonjour une fois"]);
  // A new key is a new message, even with the same words; no key at all keeps the old behaviour.
  await say(bot.id, "bonjour une fois", { clientKey: "key-0002-bbbb" });
  await say(bot.id, "bonjour une fois");
  await idle(bot.id);
  assert.equal((await userRows(bot.id)).length, 3);
});

test("point 2: two sends at the same instant with one key still make one message", async () => {
  const bot = await fresh("Duo");
  const [a, b] = await Promise.all([say(bot.id, "en double", { clientKey: "key-race-0001" }), say(bot.id, "en double", { clientKey: "key-race-0001" })]);
  assert.equal(a.json.row.seq, b.json.row.seq);
  await idle(bot.id);
  assert.equal((await userRows(bot.id)).length, 1);
});

test("point 2: a key belongs to one account and one bot, for a bounded window", async () => {
  const mine = await fresh("Un");
  const mine2 = await fresh("Deux");
  const theirs: Bot = (await call("POST", "/bots", { name: "Autre" }, "b")).json.bot;
  const key = "key-shared-0001";
  const r1 = await say(mine.id, "chez moi", { clientKey: key });
  const r2 = await say(mine2.id, "chez mon autre bot", { clientKey: key });
  const r3 = await call("POST", `/bots/${theirs.id}/messages`, { text: "chez un autre compte", clientKey: key }, "b");
  assert.equal(r2.json.row.botId, mine2.id);
  assert.equal(r3.json.row.botId, theirs.id, "another account's same key is its own message");
  assert.equal(r3.json.row.body.text, "chez un autre compte");
  assert.equal(r2.json.row.body.text, "chez mon autre bot");
  // Another account never gets my row back with my key, and cannot write to my bot.
  assert.equal((await call("POST", `/bots/${mine.id}/messages`, { text: "x", clientKey: key }, "b")).status, 404);
  await Promise.all([idle(mine.id), idle(mine2.id), idle(theirs.id)]);
  // Past the window, the key is forgotten: the same key is a new message again.
  assert.ok(SEND_KEY_WINDOW_MS >= 3_600_000);
  const me = q.get<{ id: string }>("SELECT id FROM users WHERE email = ?", "core@example.com")!.id;
  assert.equal(sendKeys.find(me, mine.id, key)?.seq, r1.json.row.seq);
  assert.equal(sendKeys.find(me, mine.id, key, Date.now() + SEND_KEY_WINDOW_MS + 1), null);
  assert.equal(sendKeys.find(q.get<{ id: string }>("SELECT id FROM users WHERE email = ?", "other@example.com")!.id, mine.id, key), null, "never found for another account");
  // A key that is not a plain short token is ignored (the message goes through as an ordinary one).
  const odd = await say(mine.id, "clé bizarre", { clientKey: "x".repeat(300) });
  const odd2 = await say(mine.id, "clé bizarre", { clientKey: "x".repeat(300) });
  assert.notEqual(odd.json.row.seq, odd2.json.row.seq);
  await idle(mine.id);
});

// ── Points 3 et 4 : un accord en attente ──────────────────────────────────────
const CMD = 'call shell_run {"command": "echo accord-ok"}';
const pendingCard = (id: string) => until(async () => (await approvalCards(id)).find((c) => c.status === "pending"), "pending approval");

test("point 3: a message typed while an approval waits keeps the card open; a typed « oui » is not an approval", async () => {
  const bot = await fresh("Carla");
  await say(bot.id, CMD);
  const card = await pendingCard(bot.id);
  await idle(bot.id);
  const asked = requests.length;
  await say(bot.id, "oui");
  await say(bot.id, "yes, vas-y");
  await sleep(300);
  await idle(bot.id);
  // The card is still there to answer, the action has not run, and nothing was skipped.
  assert.equal((await approvalCards(bot.id)).find((c) => c.approvalId === card.approvalId)?.status, "pending", "the card stays valid");
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  assert.ok(paused.get(bot.id), "the turn stays parked on its card");
  const step = (await stepsOf(bot.id)).find((s) => s.tool === "shell_run");
  assert.equal(step?.status, "waiting", "typed words never run the action, and never drop it");
  assert.equal(requests.length, asked, "the model is not called while the card waits");
  // The user is told, once, that their message waits behind the card.
  const told = (await notices(bot.id)).filter((t) => /boutons/.test(t));
  assert.equal(told.length, 1, `one notice, got ${JSON.stringify(await notices(bot.id))}`);
  // The decision is taken with the buttons: the action runs once, then the kept messages are answered, in order.
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await until(async () => (await replies(bot.id)).some((t) => t.includes("yes, vas-y")), "the kept messages answered");
  await idle(bot.id);
  assert.equal((await stepsOf(bot.id)).find((s) => s.tool === "shell_run")?.status, "done");
  const said = await replies(bot.id);
  assert.ok(said.some((t) => /accord-ok/.test(t)), `the command ran: ${JSON.stringify(said)}`);
  assert.ok(said.indexOf("Echo: oui") >= 0 && said.indexOf("Echo: oui") < said.indexOf("Echo: yes, vas-y"), "kept messages come after the decision, in order");
  assert.equal((await approvalCards(bot.id)).find((c) => c.approvalId === card.approvalId)?.status, "allowed");
});

test("point 3: refusing with the button drops the action, then the kept message is answered", async () => {
  const bot = await fresh("Denis");
  await say(bot.id, CMD);
  const card = await pendingCard(bot.id);
  await idle(bot.id);
  await say(bot.id, "en fait non, autre chose");
  await sleep(200);
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await until(async () => (await replies(bot.id)).includes("Echo: en fait non, autre chose"), "the kept message answered");
  await idle(bot.id);
  assert.equal((await stepsOf(bot.id)).find((s) => s.tool === "shell_run")?.status, "denied");
  assert.equal((await replies(bot.id)).some((t) => /accord-ok/.test(t)), false, "the command never ran");
});

test("point 3: a routine or a teammate's message that comes meanwhile does not cancel the card either", async () => {
  const bot = await fresh("Rita");
  await say(bot.id, CMD);
  const card = await pendingCard(bot.id);
  await idle(bot.id);
  loop.enqueue(bot.id, { kind: "routine", name: "Veille", text: "routine pendant la carte" });
  loop.enqueue(bot.id, { kind: "bot", fromName: "Ada", text: "message d'un collègue", depth: 1 });
  await sleep(250);
  await idle(bot.id);
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  assert.equal(askedOf("routine pendant la carte"), 0, "the routine waits for the decision");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await until(() => askedOf("routine pendant la carte") === 1 && askedOf("message d'un collègue") === 1, "the waiting work runs after the decision");
  await idle(bot.id);
});

test("point 4: a pending approval of an API bot survives a restart and has no clock; the turn stays parked", async () => {
  const bot = await fresh("Paul");
  await say(bot.id, CMD);
  const card = await pendingCard(bot.id);
  await idle(bot.id);
  await say(bot.id, "message gardé avant le redémarrage");
  await sleep(150);
  // What index.ts does at start-up.
  assert.equal(loop.expireOrphanApprovals(), 0, "nothing lapses");
  loop.recoverInterruptedTurns();
  await sleep(150);
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  assert.equal((await approvalCards(bot.id)).find((c) => c.approvalId === card.approvalId)?.status, "pending");
  // Days later (no timer runs on this card), the owner answers: the parked turn goes on, then the kept message.
  q.run("UPDATE approvals SET created_at = created_at - ? WHERE id = ?", 3 * 86_400_000, card.approvalId);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await until(async () => (await replies(bot.id)).includes("Echo: message gardé avant le redémarrage"), "kept message answered");
  assert.ok((await replies(bot.id)).some((t) => /accord-ok/.test(t)));
  await idle(bot.id);
});

// ── Point 6 : un message tapé pendant un tour que la personne n'a pas lancé ───
const journalOf = (botId: string, tool: string) => q.all<{ origin: string }>("SELECT origin FROM action_journal WHERE bot_id = ? AND tool = ? ORDER BY id", botId, tool).map((r) => r.origin);

test("point 6: words typed during a routine's turn become the user's own turn, with the user's origin", async () => {
  const bot = await fresh("Olga");
  loop.enqueue(bot.id, { kind: "routine", name: "Longue", text: "slow 500: travail de routine" });
  await until(() => askedOf("travail de routine") === 1 && loop.isRunning(bot.id), "the routine's turn running");
  await say(bot.id, 'call memory_search {"query": "mes vacances"}');
  await until(async () => (await replies(bot.id)).some((t) => t.startsWith("Tool said:")), "the user's request answered");
  await idle(bot.id);
  assert.deepEqual(journalOf(bot.id, "memory_search"), ["user"], "the tool ran in a turn of the user's, not in the routine's");
  // The routine's own turn never saw the user's words.
  const routineCalls = requests.filter((r) => r.all.includes("travail de routine") && !r.all.includes("mes vacances"));
  assert.ok(routineCalls.length >= 1);
  // Owner decision (22/11/2026): the routine works in its own thread; the main chat gets its result (agent/routinethread.ts).
  assert.ok((await replies(bot.id)).some((t) => t.includes("Echo: travail de routine")), "the routine still finished its own work");
});

test("point 6: words typed during a teammate's or a system turn are not merged into it either; non-user work never gains the user's origin", async () => {
  const bot = await fresh("Odile");
  loop.enqueue(bot.id, { kind: "bot", fromName: "Ada", text: "slow 400: demande d'un collègue", depth: 1 });
  await until(() => askedOf("demande d'un collègue") === 1 && loop.isRunning(bot.id), "the teammate's turn running");
  await say(bot.id, 'call memory_search {"query": "pendant un collègue"}');
  await idle(bot.id);
  await until(async () => (await replies(bot.id)).some((t) => t.startsWith("Tool said:")), "answered");
  await idle(bot.id);
  assert.deepEqual(journalOf(bot.id, "memory_search"), ["user"]);
  // The other way round: a routine that asks for a tool keeps its own origin, whatever the user typed before or after.
  loop.enqueue(bot.id, { kind: "routine", name: "Outil", text: 'call memory_search {"query": "par la routine"}' });
  await until(() => journalOf(bot.id, "memory_search").length === 2, "the routine's tool call");
  await idle(bot.id);
  assert.deepEqual(journalOf(bot.id, "memory_search"), ["user", "routine"]);
});

test("point 6: words typed during the user's own turn still join it (steering is kept)", async () => {
  const bot = await fresh("Suzie");
  await say(bot.id, "slow 400: première demande");
  await until(() => askedOf("première demande") === 1 && loop.isRunning(bot.id), "the user's turn running");
  const before = requests.length;
  await say(bot.id, "et aussi ceci");
  await until(async () => (await replies(bot.id)).includes("Echo: et aussi ceci"), "the added words answered");
  await idle(bot.id);
  assert.ok(requests.slice(before).some((r) => r.all.includes("première demande") && r.texts.some((t) => t.includes("et aussi ceci"))), "same turn, same history");
});

// ── Point 7 : garde anti-boucle ───────────────────────────────────────────────
const tool = (name: string, input: Record<string, unknown> = {}) => ({ type: "tool_use" as const, id: "x", name, input });
const textOf = (out: { content: unknown }) => (typeof out.content === "string" ? out.content : JSON.stringify(out.content));

test("point 7: the model is warned before the loop guard stops it", () => {
  const g = new LoopGuard(4, 4);
  const outs = [1, 2, 3, 4].map(() => ({ content: "same answer" }));
  assert.equal(g.check(tool("memory_search"), outs[0]), null);
  assert.equal(textOf(outs[0]), "same answer", "nothing added the first time");
  assert.equal(g.check(tool("memory_search"), outs[1]), null);
  assert.match(textOf(outs[1]), /same result as last time/i, "a note from the second identical result on");
  assert.match(textOf(outs[1]), /4/, "it names the limit");
  assert.equal(g.check(tool("memory_search"), outs[2]), null);
  assert.match(textOf(outs[2]), /same result/i);
  assert.deepEqual(g.check(tool("memory_search"), outs[3]), { kind: "same", tool: "memory_search", count: 4 }, "the stop itself is unchanged");
  // Failures in a row are warned about too.
  const f = new LoopGuard(4, 4);
  const fails = [1, 2, 3, 4].map((i) => ({ content: `error ${i}`, isError: true }));
  f.check(tool("web_fetch"), fails[0]);
  f.check(tool("web_fetch"), fails[1]);
  assert.match(textOf(fails[1]), /failed 2 times in a row/);
  f.check(tool("web_fetch"), fails[2]);
  assert.deepEqual(f.check(tool("web_fetch"), fails[3]), { kind: "fail", tool: "web_fetch", count: 4 });
  // A picture result gets its note as one more text part.
  const p = new LoopGuard(4, 4);
  const pics = [1, 2].map(() => ({ content: [{ type: "image" as const, mediaType: "image/png", data: "AAAA" }] }));
  p.check(tool("media_view"), pics[0]);
  p.check(tool("media_view"), pics[1]);
  assert.equal((pics[1].content as unknown[]).length, 2);
});

test("point 7: tools made for polling (screen_view, job_output…) are not stopped at 4 identical results, but still at a bounded limit", () => {
  for (const name of ["screen_view", "job_output", "job_list", "page_read", "element_snapshot", "my_screen"]) assert.equal(isPollingTool(name), true, name);
  for (const name of ["memory_search", "web_fetch", "shell_run", "screen_click", "bot_message"]) assert.equal(isPollingTool(name), false, name);
  assert.ok(POLL_SAME_LIMIT > 4 && POLL_SAME_LIMIT <= 30, "higher, and bounded");
  const g = new LoopGuard(4, 4);
  let stop = null;
  let n = 0;
  const outs: { content: string }[] = [];
  while (!stop && n < 100) { const out = { content: "job still running" }; outs.push(out); stop = g.check(tool("job_output", { id: "j1" }), out); n++; }
  assert.deepEqual(stop, { kind: "same", tool: "job_output", count: POLL_SAME_LIMIT });
  assert.equal(textOf(outs[3]), "job still running", "no nagging at the fourth look");
  assert.match(textOf(outs[POLL_SAME_LIMIT - 2]), /same result/i, "but a warning before the stop");
  // The exact-call limit of one turn is relaxed the same way for them, and only for them.
  assert.equal(repeatLimit("memory_search"), 4);
  assert.equal(repeatLimit("job_output"), POLL_SAME_LIMIT);
});

test("point 7: in a turn, looking six times at something that has not changed yet is no longer cut at four", async () => {
  const bot = await fresh("Pol");
  // task_list with no task gives the same answer every time: the same call, the same result, six times in one turn.
  await say(bot.id, `chain ${[1, 2, 3, 4, 5, 6].map(() => "task_list {}").join(" >> ")}`);
  await until(async () => (await replies(bot.id)).some((t) => t.startsWith("Tool said:")), "the turn's final words");
  await idle(bot.id);
  const steps = (await stepsOf(bot.id)).filter((s) => s.tool === "task_list");
  assert.equal(steps.length, 6);
  assert.deepEqual([...new Set(steps.map((s) => s.status))], ["done"], "none refused as a repeated call");
  assert.equal((await notices(bot.id)).some((t) => /tournais en rond/.test(t)), false, "not stopped by the loop guard");
  queue.length = 0;
});

// ── Point 8 : un tour qui plante ──────────────────────────────────────────────
test("point 8: a turn that crashes outside its own error handling releases the bot and shows a card", async () => {
  const bot = await fresh("Krak");
  const real = bgTaskHooks.started;
  bgTaskHooks.started = (b) => { if (b.id === bot.id) throw new Error("boom before the turn's own try"); return real(b); };
  try {
    await say(bot.id, "premier message qui plante");
    await until(async () => (await rowsOf(bot.id)).some((r) => (r.body.kind === "card" && r.body.card.type === "failure") || (r.body.kind === "notice" && /boom before/.test(r.body.text))), "a card or a line about the crash");
  } finally { bgTaskHooks.started = real; }
  await idle(bot.id);
  assert.equal(loop.isRunning(bot.id), false, "no turn is left « running » for ever");
  assert.equal((await call("GET", "/bots")).json.live[bot.id]?.running ?? false, false, "the chat shows no endless spinner");
  assert.equal(q.get("SELECT 1 AS x FROM active_turns WHERE bot_id = ?", bot.id), undefined, "no turn left to « recover » at the next start");
  const card = (await rowsOf(bot.id)).find((r) => r.body.kind === "card" && r.body.card.type === "failure");
  assert.ok(card, "recorded by the failure coordinator, with a card");
  assert.ok(q.get("SELECT 1 AS x FROM bot_failures WHERE bot_id = ?", bot.id), "an incident is recorded");
  // The bot answers the next message.
  await say(bot.id, "tu es encore là ?");
  await until(async () => (await replies(bot.id)).includes("Echo: tu es encore là ?"), "the bot answers again");
});

test("point 8: an uncaught error raised from a turn stops that turn only, with a card; the server and the other bots go on", async () => {
  const bot = await fresh("Zoé");
  const other = await fresh("Yann");
  await say(other.id, "slow 600: je travaille à côté");
  await say(bot.id, "crash now");
  await until(async () => (await rowsOf(bot.id)).some((r) => r.body.kind === "card" && r.body.card.type === "failure"), "the failure card");
  await idle(bot.id);
  assert.equal((await notices(bot.id)).includes("Arrêté."), false, "not shown as a stop the user asked for");
  await until(async () => (await replies(other.id)).includes("Echo: je travaille à côté"), "the other bot's turn is untouched");
  // Outside any turn, an uncaught error is nobody's: nothing is stopped.
  assert.equal(crashedTurn(new Error("stray")), null);
  await say(bot.id, "et maintenant ?");
  await until(async () => (await replies(bot.id)).includes("Echo: et maintenant ?"), "the bot answers again");
});

// ── Point 9 : liens sans http(s):// ───────────────────────────────────────────
test("point 9: bare domains the user types are recognised as links, conservatively", () => {
  assert.deepEqual(publicLinksIn("regarde youtube.com/watch?v=abc123 stp"), ["https://youtube.com/watch?v=abc123"]);
  assert.deepEqual(publicLinksIn("va voir www.site.fr"), ["https://www.site.fr/"]);
  assert.deepEqual(publicLinksIn("ouvre sklubs.fr, puis dis-moi"), ["https://sklubs.fr/"]);
  assert.deepEqual(publicLinksIn("Le site (exemple-boutique.com/produits/42)."), ["https://exemple-boutique.com/produits/42"]);
  assert.deepEqual(publicLinksIn("https://a.example.org/x et b.example.org/y"), ["https://a.example.org/x", "https://b.example.org/y"], "full and bare links together, in order");
  assert.deepEqual(publicLinksIn("https://youtube.com/watch?v=1 youtube.com/watch?v=1"), ["https://youtube.com/watch?v=1"], "no duplicate");
  // Not links: file names, abbreviations, versions, e-mail addresses, numbers, sentences without a space after the dot.
  for (const s of ["ouvre file.txt et rapport.pdf", "e.g. this, i.e. that, etc.", "version 2.5.1 ou v1.2", "écris à jean@exemple.fr", "node.js et vue.js", "config.json, index.ts, main.py, notes.md, photo.png, archive.zip",
    "Fin de phrase.Début de la suivante", "il est 10.30", "a.b", "mon.fichier.docx", "U.S.A. et p.ex. ceci", "192.168.1.10 et 10.0.0.1", "localhost:3000/page", "serveur.local/admin", "truc.internal"])
    assert.deepEqual(publicLinksIn(s), [], s);
  // The hint the bot gets is the same as for a full address.
  assert.match(linkHint("regarde youtube.com/watch?v=abc123", true), /contains a link \(https:\/\/youtube\.com\/watch\?v=abc123\).*browser_open/);
  assert.match(linkHint("regarde youtube.com/watch?v=abc123", true), /For a video/);
  assert.equal(linkHint("ouvre file.txt", true), "");
});
