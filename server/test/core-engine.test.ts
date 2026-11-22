import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Cœur, points 3, 4 et 5 pour les bots sur abonnement (Claude Code, Codex) : une carte d'accord qui attend n'est plus
// annulée par un message tapé ; elle ne s'efface plus après 25 min ni au redémarrage (elle est « mise de côté » et sa
// réponse compte toujours) ; une session perdue repart avec un rappel de la conversation et une ligne dans le chat.
// Un faux ordinateur joue le moteur et appelle nos outils par le vrai point d'accès MCP, comme Claude Code ou Codex.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-core-engine-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
// The call of a subscription tool waits 1.2 s for an answer here (25 min by default).
process.env.APPROVAL_EXPIRE_MIN = "0.02";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const loop = await import("../src/agent/loop.js");
const { rebuiltContext, REBUILD_MAX_CHARS, REBUILD_MAX_MESSAGE_CHARS } = await import("../src/agent/session-rebuild.js");
const { approvals, bots, rows: rowStore } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { serve } = await import("@hono/node-server");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";

registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> { req.onText?.("ok"); return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

// The tool endpoint of subscription bots, on a real port (it needs the raw request), and a fake engine computer.
const http = serve({ fetch: site.fetch, port: 0 }) as unknown as Server;
await new Promise((r) => setTimeout(r, 50));
const port = (http.address() as { port: number }).port;
after(() => { http.closeAllConnections?.(); http.close(); setEngineHost(null); });

async function mcp(botId: string, token: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp/${botId}`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).pop() ?? "{}";
  const msg = JSON.parse(data);
  return { text: (msg.result?.content ?? []).map((c: any) => c.text ?? "").join(" "), isError: !!msg.result?.isError };
}

const files = new Map<string, string>();
const execs: { args: string[]; input: string }[] = [];
/** What the engine does on its next turn: one of our tools, over MCP. */
let engineCall: { name: string; args: Record<string, unknown> } | null = null;
/** "lost": a resumed session is gone, as Claude Code (`claude`) and Codex (`codex`) really report it. */
let lost = false;
const CODEX_LOST = "Error: thread/resume: thread/resume failed: no rollout found for thread id 0199a1b2-c3d4-7e5f-8a9b-0c1d2e3f4a5b (code -32600)";
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {},
  writeFile: async (botId, p, content) => { files.set(`${botId}:${p}`, content); },
  async exec(bot, args, _env, _cwd, input, _signal, onLine) {
    execs.push({ args, input });
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    const codex = args[0] === "codex";
    const resuming = codex ? args[2] === "resume" : args.includes("--resume");
    const say = (text: string) => (codex ? emit({ type: "item.completed", item: { type: "agent_message", text } }) : emit({ type: "assistant", message: { content: [{ type: "text", text }] } }));
    if (lost && resuming) {
      if (codex) return { code: 1, stderr: CODEX_LOST };
      emit({ type: "result", is_error: true, result: "No conversation found with session ID 5c1f2d3e-0000-4000-8000-000000000000" });
      return { code: 1, stderr: "" };
    }
    if (codex) emit({ type: "thread.started", thread_id: `thread-${execs.length}` });
    else emit({ type: "system", subtype: "init", session_id: `sess-${execs.length}` });
    const token = /Bearer ([0-9a-f]+)/.exec(files.get(`${bot.id}:/root/.sklubot/mcp.json`) ?? "")?.[1] ?? "";
    // The owner allowed a parked request: the model does what it is told — the same call, with the arguments it is given.
    const allowed = /ALLOWED the action (\w+)[\s\S]*?: (\{.*\})\n/.exec(input);
    const c = allowed ? { name: allowed[1], args: JSON.parse(allowed[2]) as Record<string, unknown> } : engineCall;
    if (!allowed) engineCall = null;
    if (c && !codex) {
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: `mcp__sklubot__${c.name}`, input: c.args }] } });
      const r = await mcp(bot.id, token, c.name, c.args);
      emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", content: r.text, is_error: r.isError }] } });
      say(`Result: ${r.text.slice(0, 160)}`);
    } else say(`Fine: ${input.slice(-40)}`);
    emit(codex ? { type: "turn.completed", usage: {} } : { type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 500): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(20); }
  throw new Error(`timed out waiting for ${label}`);
}
type Approval = Extract<Card, { type: "approval" }>;
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const cardsOf = async (id: string) => (await rowsOf(id)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" ? [r.body.card as Approval] : []));
const pendingCard = (id: string) => until(async () => (await cardsOf(id)).find((c) => c.status === "pending"), "pending approval");
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).map((r) => (r.body as { text: string }).text);
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const memories = (id: string) => q.all<{ text: string }>("SELECT text FROM memories WHERE bot_id = ?", id).map((m) => m.text);
async function engineBot(name: string, model = "claude-code:sonnet"): Promise<Bot> {
  const bot: Bot = (await call("POST", "/bots", { name })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model, fallbackModels: [] })).status, 200);
  return bot;
}

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "engine@example.com", password: "password-1", locale: "fr" });
});

test("points 3 and 4 (subscription): a typed « oui » does not answer or cancel the card; unanswered, the request is parked, not expired", async () => {
  const bot = await engineBot("Emma");
  engineCall = { name: "memory_save", args: { text: "Le chat de Léa s'appelle Pixel." } };
  await say(bot.id, "retiens ça");
  const card = await pendingCard(bot.id);
  // The owner types instead of pressing a button.
  await say(bot.id, "oui");
  await sleep(150);
  assert.equal(approvals.byId(card.approvalId)?.status, "pending", "a typed yes neither approves nor cancels");
  assert.equal((await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)?.status, "pending");
  assert.deepEqual(memories(bot.id), [], "nothing ran on typed words");
  assert.equal((await notices(bot.id)).filter((t) => /boutons/.test(t)).length, 1, "told once that the message waits");
  // Nobody answers in time (1.2 s here, 25 min by default): the tool's call stops waiting and is told to wait for the user.
  await until(async () => (await replies(bot.id)).some((t) => /has not answered this request yet/.test(t)), "the tool told the request is parked");
  await idle(bot.id);
  const parked = (await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)!;
  assert.equal(parked.status, "pending", "the card did not expire");
  assert.equal(parked.parked, true, "and says the bot stopped waiting");
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  assert.deepEqual(memories(bot.id), []);
  // The message typed meanwhile was kept, and answered in its own turn after the tool's turn.
  await until(() => execs.some((e) => /oui$/.test(e.input.trim())), "the kept message got its turn");
  await idle(bot.id);

  // A restart: nothing waits in memory any more. The card is still there to answer.
  assert.equal(loop.expireOrphanApprovals(), 0, "nothing lapses at start-up");
  assert.equal((await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)?.status, "pending");

  // Much later, the owner says yes with the button: the bot is told, makes the same call, and it runs on that approval.
  const before = execs.length;
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await until(() => memories(bot.id).length === 1, "the action ran after the answer");
  await idle(bot.id);
  assert.deepEqual(memories(bot.id), ["Le chat de Léa s'appelle Pixel."]);
  assert.match(execs[before].input, /ALLOWED the action memory_save/);
  assert.ok(execs[before].args.includes("--resume"), "in the same session of the tool");
  const done = (await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)!;
  assert.equal(done.status, "allowed");
  assert.equal(done.outcome, "done", "the card says what became of its single execution");
  assert.equal((await cardsOf(bot.id)).filter((c) => c.status === "pending").length, 0, "no second card for the approved call");
  assert.ok(q.get<{ consumed_at: number | null }>("SELECT consumed_at FROM approvals WHERE id = ?", card.approvalId)?.consumed_at, "used once");

  // The approval was for one execution: the very same call again asks again.
  engineCall = { name: "memory_save", args: { text: "Le chat de Léa s'appelle Pixel." } };
  await say(bot.id, "encore une fois");
  const second = await pendingCard(bot.id);
  assert.notEqual(second.approvalId, card.approvalId);
  await call("POST", `/approvals/${second.approvalId}`, { decision: "deny" });
  await idle(bot.id);
});

test("point 4 (subscription): a different action never rides on a parked approval; a refusal is passed on", async () => {
  const bot = await engineBot("Nora");
  engineCall = { name: "memory_save", args: { text: "Le code du portail est rangé au coffre." } };
  await say(bot.id, "retiens ça");
  const card = await pendingCard(bot.id);
  await until(async () => (await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)?.parked, "parked");
  await idle(bot.id);
  // Allowed, but the tool then asks for something else: that is a new request, with its own card.
  q.run("UPDATE approvals SET status = 'allowed', resolved_at = ? WHERE id = ?", Date.now(), card.approvalId);
  engineCall = { name: "memory_save", args: { text: "Autre chose que ce qui a été approuvé." } };
  await say(bot.id, "fais autre chose");
  const other = await until(async () => (await cardsOf(bot.id)).find((c) => c.status === "pending" && c.approvalId !== card.approvalId), "a card of its own for the other action");
  assert.deepEqual(memories(bot.id), []);
  assert.equal(q.get<{ consumed_at: number | null }>("SELECT consumed_at FROM approvals WHERE id = ?", card.approvalId)?.consumed_at, null, "the approval was not spent on another action");
  // That second request is parked in its turn; the owner refuses it: the bot is told, nothing runs.
  await until(async () => (await cardsOf(bot.id)).find((c) => c.approvalId === other.approvalId)?.parked, "second parked");
  await idle(bot.id);
  const before = execs.length;
  await call("POST", `/approvals/${other.approvalId}`, { decision: "deny" });
  await until(() => execs.length > before, "the bot told about the refusal");
  await idle(bot.id);
  assert.match(execs[before].input, /REFUSED the action memory_save/);
  assert.equal((await cardsOf(bot.id)).find((c) => c.approvalId === other.approvalId)?.status, "denied");
  assert.deepEqual(memories(bot.id), []);
});

test("point 4 (subscription): a restart while the tool's call still waits keeps the card open", async () => {
  const bot = await engineBot("Iris");
  engineCall = { name: "memory_save", args: { text: "Iris préfère le thé." } };
  await say(bot.id, "retiens ça");
  const card = await pendingCard(bot.id);
  // What index.ts does at start-up, while nothing has parked the request yet.
  assert.equal(loop.expireOrphanApprovals(), 0);
  const now = (await cardsOf(bot.id)).find((c) => c.approvalId === card.approvalId)!;
  assert.equal(now.status, "pending");
  assert.equal(now.parked, true);
  await until(async () => (await replies(bot.id)).some((t) => /has not answered this request yet/.test(t)), "the call ended");
  await idle(bot.id);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await until(() => memories(bot.id).length === 1, "ran after the answer");
  await idle(bot.id);
});

test("point 4: a request that cannot be picked up again (a program waiting on the credential relay) still expires, and its card says so", async () => {
  const bot = await engineBot("Rémi");
  const status = await loop.askUser(bots.byId(bot.id)!, { title: "Autoriser l'appel ?", detail: "GET api.example.com", policyKey: "relay: api.example.com", source: "Relais" }, 80);
  assert.equal(status, "expired");
  const card = (await cardsOf(bot.id))[0];
  assert.equal(card.status, "expired", "the web card then offers « Relancer » (Cards.tsx)");
  assert.equal(card.parked, undefined);
});

test("point 5: a lost Claude Code session restarts with the recent conversation, and the chat says so", async () => {
  const bot = await engineBot("Clo");
  await say(bot.id, "Mon projet s'appelle Atlas et la démo est jeudi.");
  await idle(bot.id);
  await say(bot.id, "Le client principal est la mairie de Lyon.");
  await idle(bot.id);
  lost = true;
  const from = execs.length;
  await say(bot.id, "Tu te souviens du nom du projet ?");
  await idle(bot.id);
  lost = false;
  const runs = execs.slice(from);
  assert.equal(runs.length, 2, "one failed resume, one fresh session");
  assert.ok(runs[0].args.includes("--resume"));
  assert.ok(!runs[1].args.includes("--resume"), "the retry is a new session");
  // The new session is told what was said before, oldest first, and then the message to answer.
  assert.match(runs[1].input, /earlier session with this tool was lost/);
  assert.match(runs[1].input, /User: Mon projet s'appelle Atlas et la démo est jeudi\./);
  assert.match(runs[1].input, /User: Le client principal est la mairie de Lyon\./);
  assert.match(runs[1].input, /You: Fine: /, "its own earlier answers too");
  assert.ok(runs[1].input.indexOf("Atlas") < runs[1].input.indexOf("mairie de Lyon"));
  assert.ok(runs[1].input.trim().endsWith("Tu te souviens du nom du projet ?"), "the current message comes last, once");
  assert.equal(runs[1].input.split("Tu te souviens du nom du projet ?").length - 1, 1);
  // And the user sees it.
  const told = (await notices(bot.id)).filter((t) => /Ma session avec Claude Code a été perdue/.test(t));
  assert.equal(told.length, 1, JSON.stringify(await notices(bot.id)));
  assert.ok((await replies(bot.id)).some((t) => t.startsWith("Fine:")), "the turn went through");
});

test("point 5: the same for Codex", async () => {
  const bot = await engineBot("Cody", "codex:default");
  await say(bot.id, "La réunion est déplacée à 15 h.");
  await idle(bot.id);
  lost = true;
  const from = execs.length;
  await say(bot.id, "À quelle heure est la réunion ?");
  await idle(bot.id);
  lost = false;
  const runs = execs.slice(from);
  assert.equal(runs.length, 2);
  assert.notEqual(runs[1].args[2], "resume");
  assert.match(runs[1].input, /User: La réunion est déplacée à 15 h\./);
  assert.equal((await notices(bot.id)).filter((t) => /Ma session avec Codex a été perdue/.test(t)).length, 1);
});

test("point 5: the rebuilt context is bounded, keeps the newest messages, and is never built for someone else's conversation", async () => {
  const bot = await engineBot("Max");
  const rec = bots.byId(bot.id)!;
  for (let i = 0; i < 60; i++) rowStore.append(rec, { kind: "message", role: i % 2 ? "assistant" : "user", text: `message ${i} ${"x".repeat(3000)}` });
  const turn = { bot: rec, generation: rec.generation, thread: 0 };
  const ctx = rebuiltContext(turn, "the current prompt");
  assert.ok(ctx.length > 1000 && ctx.length <= REBUILD_MAX_CHARS + 800, `bounded: ${ctx.length}`);
  assert.match(ctx, /message 59 /, "the newest message is kept");
  assert.doesNotMatch(ctx, /message 3 /, "the oldest are left out");
  assert.ok(ctx.split("\n").every((l) => l.length <= REBUILD_MAX_MESSAGE_CHARS + 800), "long messages are shortened");
  // A Bot API or workspace-member conversation has its own session: it never receives the owner's messages.
  assert.equal(rebuiltContext({ ...turn, engineCaller: "api/key_1" }, "p"), "");
  assert.equal(rebuiltContext({ ...turn, origin: "member" }, "p"), "");
  assert.equal(rebuiltContext({ ...turn, origin: "api" }, "p"), "");
  // Nothing stored before the current message: nothing to add.
  const empty = await engineBot("Vide");
  assert.equal(rebuiltContext({ bot: bots.byId(empty.id)!, generation: 0, thread: 0 }, "p"), "");
});
