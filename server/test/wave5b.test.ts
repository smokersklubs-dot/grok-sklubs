import assert from "node:assert/strict";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w5b-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
// The fake Gmail, Telegram and API servers of these tests listen on this machine.
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.MAX_STEPS = "8";
process.env.RETRY_BASE_MS = "5";
process.env.TELEGRAM_RETRY_MS = "30";
delete process.env.AUX_MODEL;
delete process.env.FALLBACK_MODEL;
delete process.env.FALLBACK_MODELS;

// ── Fake services on this machine: Gmail, Telegram's Bot API, and a small third-party HTTP API ──
const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const NOW = Date.now();
interface FakeMail { id: string; from: string; to: string; subject: string; body: string; at: number; sent?: boolean }
const inbox: FakeMail[] = [
  { id: "m1", from: "Camille Martin <camille.martin@exemple.fr>", to: "zoe@exemple.fr", subject: "Devis novembre", body: "Pouvez-vous confirmer le devis ?", at: NOW - 3600_000 },
  { id: "m2", from: "Lucas <lucas@exemple.fr>", to: "zoe@exemple.fr", subject: "Livraison de votre commande", body: "La livraison est prévue jeudi.", at: NOW - 7200_000 },
  { id: "m3", from: "Exemple <no-reply@accounts.exemple.com>", to: "zoe@exemple.fr", subject: "Votre code de vérification", body: "Votre code est 482913.", at: NOW - 60_000 },
];
const sentRaw: string[] = [];
const apiCalls: { method: string; path: string; auth: string; body: string }[] = [];
const tgSent: { chat_id: string; text: string; message_id: number }[] = [];
const tgReactions: any[] = [];
const tgUpdates: any[] = [];
let tgMessageId = 100;
let tgUpdateId = 1;
const local = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  res.setHeader("content-type", "application/json");
  // Gmail (users.messages.list / get / send).
  if (url.pathname === "/gmail/v1/users/me/messages" && req.method === "GET") {
    res.end(JSON.stringify({ messages: inbox.filter((m) => !m.sent).map((m) => ({ id: m.id, threadId: `t_${m.id}` })) }));
    return;
  }
  const one = /^\/gmail\/v1\/users\/me\/messages\/([^/]+)$/.exec(url.pathname);
  if (one && req.method === "GET") {
    const m = inbox.find((x) => x.id === decodeURIComponent(one[1]));
    if (!m) { res.statusCode = 404; res.end("{}"); return; }
    res.end(JSON.stringify({ id: m.id, threadId: `t_${m.id}`, snippet: m.body, internalDate: String(m.at), labelIds: ["INBOX"], payload: { mimeType: "text/plain", headers: [{ name: "From", value: m.from }, { name: "To", value: m.to }, { name: "Subject", value: m.subject }, { name: "Date", value: new Date(m.at).toUTCString() }], body: { data: b64(m.body) } } }));
    return;
  }
  if (url.pathname === "/gmail/v1/users/me/messages/send" && req.method === "POST") {
    sentRaw.push(Buffer.from(JSON.parse(raw).raw, "base64url").toString());
    res.end(JSON.stringify({ id: `sent_${sentRaw.length}` }));
    return;
  }
  // Telegram Bot API.
  const tg = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  if (tg) {
    const body = raw ? JSON.parse(raw) : {};
    const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
    if (tg[2] === "getMe") return ok({ id: 1, is_bot: true, username: "zoe_test_bot" });
    if (tg[2] === "sendMessage") { const m = { chat_id: String(body.chat_id), text: String(body.text), message_id: ++tgMessageId }; tgSent.push(m); return ok({ message_id: m.message_id }); }
    if (tg[2] === "setMessageReaction") { tgReactions.push(body); return ok(true); }
    if (tg[2] === "getUpdates") {
      for (let i = 0; i < 15 && !tgUpdates.some((u) => u.update_id >= body.offset); i++) await new Promise((r) => setTimeout(r, 20));
      return ok(tgUpdates.filter((u) => u.update_id >= body.offset));
    }
    res.statusCode = 404; res.end(JSON.stringify({ ok: false, description: "no such method" })); return;
  }
  // A third-party API that needs "Authorization: Bearer tok-123" and echoes the token back in several forms.
  if (url.pathname.startsWith("/v1/")) {
    apiCalls.push({ method: req.method!, path: url.pathname + url.search, auth: String(req.headers.authorization ?? ""), body: raw });
    if (req.headers.authorization !== "Bearer tok-123") { res.statusCode = 401; res.end(JSON.stringify({ error: "unauthorized" })); return; }
    res.end(JSON.stringify({ ok: true, path: url.pathname, echo: "tok-123", encoded: encodeURIComponent("tok-123"), b64: Buffer.from("tok-123").toString("base64") }));
    return;
  }
  res.statusCode = 404; res.end("{}");
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const LOCAL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;
process.env.GOOGLE_API_URL = LOCAL;
process.env.TELEGRAM_API_URL = LOCAL;

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { bots, users, approvals, skills, rows: rowStore, redactSecrets, vault, pages } = await import("../src/store.js");
const { accounts } = await import("../src/native/accounts.js");
const { seal } = await import("../src/auth.js");
const { q } = await import("../src/db.js");
const { newTurn } = await import("../src/agent/loop.js");
const { authorize } = await import("../src/agent/authorize.js");
const { probe, committingKind, bindCall } = await import("../src/agent/bind.js");
const { cardScreen, luhnOk, brandOf } = await import("../src/agent/payments.js");
const { anonymise } = await import("../src/agent/anonymise.js");
const { routines, runs, ROUTINE_FAIL_PAUSE } = await import("../src/routines.js");
const { dueRoutine, fireRoutine } = await import("../src/scheduler.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { ideasFromSubjects } = await import("../src/ideas.js");
const { telegram, commandAnswer } = await import("../src/telegram.js");
const { scrubSecret, matchEndpoint } = await import("../src/apiconnectors.js");
const { rules: ruleStore } = await import("../src/rules.js");
const { consolidate } = await import("../src/agent/memory.js");
const { memories } = await import("../src/store.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";

await initComputer();
const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

/** Scripted model (as in the other suites): "call T {json}" → one tool; "chain A {…} >> B {…}" → tools in turn; else echoes. */
const requests: TurnRequest[] = [];
const queue: { name: string; input: any }[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const use = (t: { name: string; input: any }): Block[] => [{ type: "tool_use", id: `call_${requests.length}_${Math.random().toString(36).slice(2, 6)}`, name: t.name, input: t.input }];
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = queue.length ? use(queue.shift()!) : [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const parse = (s: string) => { const m = /(\w+) (\{[^\n]*?\})(?=\s*(>>|\n|$))/.exec(s)!; return { name: m[1], input: JSON.parse(m[2]) }; };
      if (said.includes("chain ")) { const steps = said.slice(said.indexOf("chain ") + 6).split(" >> ").map(parse); queue.push(...steps.slice(1)); content = use(steps[0]); }
      else if (/call \w+ \{/.test(said)) content = use(parse(said.slice(said.indexOf("call ") + 5)));
      else content = [{ type: "text", text: `Echo: ${said.slice(0, 300)}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
} satisfies LlmProvider);

/** A priced model: each step costs 0.60 $ (100 000 tokens in, 10 000 out at claude-opus-5-5's price) and tracks a task. */
registerProvider({ id: "pricey", label: "Pricey", models: ["m"], available: () => true, async runTurn(req) {
  const last = req.messages[req.messages.length - 1];
  const seen = JSON.stringify(last.content);
  if (seen.includes("spend checkpoint and the user chose to continue")) {
    req.onText?.("Fini après le point d'étape.");
    return { content: [{ type: "text", text: "Fini après le point d'étape." }], stopReason: "end", model: "claude-opus-5-5", usage };
  }
  // task_add answers with a new id each time, so the loop guard never sees the same result twice.
  return { content: [{ type: "tool_use", id: `p_${Math.random().toString(36).slice(2)}`, name: "task_add", input: { title: `étape ${Math.random()}` } }], stopReason: "tool_use", model: "claude-opus-5-5", usage: { inputTokens: 100_000, outputTokens: 10_000, cachedTokens: 0 } };
} });
/** The memory learner: answers with whatever facts the test puts here. */
let memoFacts: unknown[] = [];
registerProvider({ id: "memo", label: "Memo", models: ["m"], available: () => true, async runTurn() {
  return { content: [{ type: "text", text: JSON.stringify({ facts: memoFacts }) }], stopReason: "end", model: "memo-m", usage };
} });
after(() => { telegram.stopAll(); local.closeAllConnections(); local.close(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown, as = cookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set && as === cookie) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function until<T>(probeFn: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probeFn(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const cards = (list: Row[], type: Card["type"]) => list.filter((r) => r.body.kind === "card" && r.body.card.type === type).map((r) => ({ seq: r.seq, card: (r.body as { card: Card }).card }));
const pendingApproval = async (bot: Bot) => until(async () => cards(await rowsOf(bot.id), "approval").map((c) => c.card).find((c) => c.type === "approval" && c.status === "pending") as Extract<Card, { type: "approval" }> | undefined, "approval");
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); const l = r.json.live?.[bot.id]; return !l?.running && !l?.awaiting; }, "bot idle");
const steps = (list: Row[], tool: string) => list.filter((r) => r.body.kind === "step" && r.body.tool === tool).map((r) => r.body as Extract<Row["body"], { kind: "step" }>);
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming && r.body.text);
const replied = (bot: Bot, part: string) => until(async () => { const r = lastAssistant(await rowsOf(bot.id)); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply containing "${part}"`);
async function fresh(name: string, patch: Record<string, unknown> = {}): Promise<Bot> {
  const b = (await call("POST", "/bots", { name })).json.bot as Bot;
  return (await call("PATCH", `/bots/${b.id}`, { model: "script:script-1", ...patch })).json.bot as Bot;
}
const historyOf = (botId: string) => q.all<{ content: string }>("SELECT content FROM history WHERE bot_id = ?", botId).map((r) => r.content).join("\n");

let userId = "";
let primary: Bot;
let accountId = "";
const SEND = "gmail_perso__mail_send";
const SEARCH = "gmail_perso__mail_search";

test("setup: an account with a signed-in Gmail mailbox", async () => {
  const r = await call("POST", "/auth/signup", { email: "zoe@example.com", name: "Zoé", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  primary = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  primary = (await call("PATCH", `/bots/${primary.id}`, { model: "script:script-1" })).json.bot;
  const acc = accounts.create(userId, "gmail", "perso");
  accountId = acc.id;
  q.run("UPDATE native_accounts SET status = 'ready', identity = ?, tokens_enc = ? WHERE id = ?", "zoe@exemple.fr", seal(JSON.stringify({ access: "tok", expiresAt: Date.now() + 3600_000 })), acc.id);
});

// ── 1. Spend checkpoints (A5) ───────────────────────────────────────────────
test("spend checkpoint: the task stops before its next step past the threshold, keeps its work, and continue / raise / stop", async () => {
  assert.equal((await call("GET", "/spend")).json.settings.checkpointUsd, 5, "5 $ by default");
  assert.equal((await call("PUT", "/spend", { checkpointUsd: -1 })).status, 400);
  assert.equal((await call("PUT", "/spend", { checkpointUsd: 1 })).json.settings.checkpointUsd, 1);
  const b = await fresh("Dépensier", { model: "pricey:m" });
  await say(b, "fais une grande recherche");
  const spend = await until(async () => cards(await rowsOf(b.id), "spend")[0], "spend card");
  await idle(b);
  const card = spend.card as Extract<Card, { type: "spend" }>;
  assert.equal(card.status, "pending");
  assert.equal(card.scope, "chat");
  assert.equal(card.thresholdUsd, 1);
  assert.ok(card.spentUsd >= 1 && card.spentUsd < 1.9, `stopped right after passing 1 $ (${card.spentUsd})`);
  assert.equal(steps(await rowsOf(b.id), "task_add").length, 2, "two steps ran, the third did not start");
  // Continue: the work picks up where it was (history kept), and finishes.
  assert.equal((await call("POST", `/spend/${card.checkpointId}`, { action: "continue" })).status, 200);
  assert.equal((await call("POST", `/spend/${card.checkpointId}`, { action: "continue" })).status, 409, "answered once");
  await replied(b, "Fini après le point d'étape.");
  assert.match(historyOf(b.id), /task_add/);
  assert.equal((cards(await rowsOf(b.id), "spend")[0].card as Extract<Card, { type: "spend" }>).status, "continued");
  // The journal gives each action its share of the model's spend.
  const j = (await call("GET", `/journal?bot=${b.id}`)).json;
  assert.ok(j.entries.some((e: any) => e.tool === "task_add" && e.costUsd > 0.5), "the step's cost is on its action");
  // Raise: the checkpoint doubles for this piece of work.
  await say(b, "encore une grande recherche");
  const second = await until(async () => cards(await rowsOf(b.id), "spend").find((c) => (c.card as any).status === "pending"), "second spend card");
  await idle(b);
  await call("POST", `/spend/${(second.card as any).checkpointId}`, { action: "raise" });
  await idle(b);
  assert.equal(q.get<{ t: number }>("SELECT threshold_usd AS t FROM spend_scopes WHERE worker_id = ? AND scope_key = 'chat:0'", b.id)?.t, 2);
  // A new message from the user starts the count again (and its threshold stays raised only for that work).
  await say(b, "et une dernière");
  const third = await until(async () => cards(await rowsOf(b.id), "spend").find((c) => (c.card as any).status === "pending"), "third spend card");
  await idle(b);
  assert.equal((await call("POST", `/spend/${(third.card as any).checkpointId}`, { action: "stop" })).status, 200);
  assert.equal((cards(await rowsOf(b.id), "spend").find((c) => (c.card as any).checkpointId === (third.card as any).checkpointId)!.card as any).status, "stopped");
  // A bot set to 0 never stops (here: it reaches the step limit instead).
  const free = await fresh("Libre", { model: "pricey:m", spendCheckpointUsd: 0 });
  assert.equal(free.spendCheckpointUsd, 0);
  await say(free, "cherche sans limite");
  await until(async () => (await rowsOf(free.id)).some((r) => r.body.kind === "notice" && r.body.action?.kind === "continue"), "step limit notice");
  assert.equal(cards(await rowsOf(free.id), "spend").length, 0);
  await call("PUT", "/spend", { checkpointUsd: 5 });
});

// ── 2. Usage journal (A14) ──────────────────────────────────────────────────
test("journal: one line per action with what allowed it, filterable, CSV export, never edited", async () => {
  const b = await fresh("Journaliste", { autonomy: "balanced" });
  await say(b, `réponds à Camille : call ${SEND} {"to":"camille.martin@exemple.fr","subject":"Re","body":"Oui","user_quote":"réponds à Camille"}`);
  await replied(b, "Sent (id");
  await say(b, `écris à Paul : call ${SEND} {"to":"paul@exemple.fr","body":"x"}`);
  const card = await pendingApproval(b);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await idle(b);
  const all = (await call("GET", `/journal?bot=${b.id}`)).json;
  const sent = all.entries.find((e: any) => e.tool === SEND && e.status === "done");
  assert.equal(sent.decision, "words");
  assert.equal(sent.quote, "réponds à Camille");
  assert.equal(sent.origin, "user");
  assert.ok(all.entries.some((e: any) => e.tool === SEND && e.decision === "denied" && e.status === "denied"));
  assert.ok(all.totals.lines >= 2);
  const denied = (await call("GET", `/journal?bot=${b.id}&decision=denied`)).json.entries;
  assert.ok(denied.length >= 1 && denied.every((e: any) => e.decision === "denied"));
  const csv = await call("GET", `/journal.csv?bot=${b.id}`);
  assert.equal(csv.status, 200);
  assert.match(csv.text.split("\n")[0], /^time,bot,tool,action,decision,quote,reason,status,cost_usd,origin$/);
  assert.match(csv.text, /"réponds à Camille"/);
  assert.throws(() => q.run("UPDATE action_journal SET decision = 'free'"), /cannot be edited/);
});

// ── 3. Routines (A7) ────────────────────────────────────────────────────────
test("routines: skipped without a model call when nothing is new, one at a time, no duplicate fires or copies, projected cost", async () => {
  const b = await fresh("Veilleur");
  await say(b, `call routine_create {"name":"Réponses clients","prompt":"Regarde s'il y a une réponse de Camille","kind":"cron","schedule":"0 9 * * *","timezone":"Europe/Paris","only_if_new":["Gmail — perso"]}`);
  await replied(b, "Tool said:");
  const r = routines.forBot(b.id)[0];
  assert.ok(r.skipUnchanged && r.inputs[0] === "Gmail — perso");
  assert.equal(typeof r.projectedMonthlyUsd, "number");
  // The same routine again is not copied.
  await say(b, `call routine_create {"name":"Réponses clients bis","prompt":"Regarde s'il y a une réponse de Camille","kind":"cron","schedule":"0 9 * * *","timezone":"Europe/Paris"}`);
  await replied(b, "identical routine already exists");
  assert.equal(routines.forBot(b.id).length, 1);
  await idle(b);
  // First run: always (nothing to compare with).
  const before = requests.length;
  assert.equal(await dueRoutine(routines.byId(r.id)!, 1_000), "fired");
  assert.equal(await dueRoutine(routines.byId(r.id)!, 1_000), "claimed", "a slot fires once");
  await until(() => runs.list(r.id).some((x) => x.status === "quiet" || x.status === "done"), "first run finished");
  await idle(b);
  const afterFirst = requests.length;
  assert.ok(afterFirst > before);
  // Nothing new in the mailbox: skipped, no model call.
  assert.equal(await dueRoutine(routines.byId(r.id)!, 2_000), "skipped");
  assert.equal(requests.length, afterFirst, "no model call for a skipped run");
  assert.equal(runs.list(r.id)[0].status, "skipped");
  // A new email: it runs.
  inbox.push({ id: "m9", from: "Camille Martin <camille.martin@exemple.fr>", to: "zoe@exemple.fr", subject: "Re: devis", body: "C'est bon pour moi.", at: Date.now() });
  assert.equal(await dueRoutine(routines.byId(r.id)!, 3_000), "fired");
  await until(() => runs.list(r.id).filter((x) => x.status === "quiet" || x.status === "done").length >= 2, "second run");
  await idle(b);
  // One at a time: while a run is under way, a new due time is skipped.
  const running = runs.start(r.id);
  assert.equal(fireRoutine(routines.byId(r.id)!), "busy");
  assert.match(runs.list(r.id).find((x) => x.status === "skipped")!.note, /Still running/);
  assert.equal((await call("POST", `/routines/${r.id}/run`)).status, 409, "run now does not double a run under way");
  runs.finish(running, "done", "");
  // Projected cost: about 30 runs a month at a priced model's typical run.
  const priced = await fresh("Chiffré", { model: "pricey:claude-haiku-5-5" });
  const pr = routines.create(priced.id, { name: "Point", prompt: "Point du jour", trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  const p = routines.byId(pr.id)!.projectedMonthlyUsd!;
  assert.ok(p > 0.02 && p < 0.05, `≈ 30 × 0.0011 $ (${p})`);
});

test("routines: failures are said, pushed after 3 in a row, and the routine pauses after 5; a routine cannot create routines", async () => {
  const b = await fresh("Fragile");
  const r = routines.create(b.id, { name: "Rapport", prompt: "Fais le rapport", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" });
  for (let i = 0; i < ROUTINE_FAIL_PAUSE; i++) runs.finish(runs.start(r.id), "error", `le site ne répond pas (${i})`);
  const now = routines.byId(r.id)!;
  assert.equal(now.failures, ROUTINE_FAIL_PAUSE);
  assert.equal(now.enabled, false);
  assert.match(now.pausedReason!, /5 échecs/);
  const notices = (await rowsOf(b.id)).filter((x) => x.body.kind === "notice").map((x) => (x.body as { text: string }).text);
  assert.ok(notices.some((t) => /La routine « Rapport » a échoué : le site ne répond pas/.test(t)));
  assert.ok(notices.some((t) => /J'ai mis en pause la routine « Rapport »/.test(t)));
  // Turned back on by the user: the count starts over.
  assert.equal((await call("PATCH", `/routines/${r.id}`, { enabled: true })).status, 200);
  assert.equal(routines.byId(r.id)!.failures, 0);
  // A routine's own turn cannot create routines.
  const maker = routines.create(b.id, { name: "Fabrique", prompt: `call routine_create {"name":"x","prompt":"y","kind":"cron","schedule":"0 7 * * *"}`, trigger: "cron", schedule: "0 7 * * *", timezone: "UTC" });
  fireRoutine(routines.byId(maker.id)!);
  await replied(b, "cannot create other routines");
  assert.equal(routines.forBot(b.id).length, 2);
});

// ── 4. Learned skills (A9) and task guides (A10) ────────────────────────────
test("learned skills: proposed after real multi-step work, anonymised, reviewed before saving, outside content when tainted", async () => {
  assert.equal(anonymise("Écrire à camille@exemple.fr, appeler le 06 12 34 56 78, payer 42,90 € pour la commande 123456 de M. Dupont", ["Zoé"]),
    "Écrire à {email}, appeler le {phone}, payer {amount} pour la commande {number} de M. {name}");
  const b = await fresh("Apprenti");
  await say(b, `call skill_propose {"name":"x","steps":"y"}`);
  await replied(b, "Only propose a skill after a task");
  await say(b, `chain memory_search {"query":"a"} >> memory_search {"query":"b"} >> memory_search {"query":"c"} >> skill_propose {"name":"Commander chez Fournil","when":"Pour commander le pain","steps":"1. Ouvrir https://fournil.example/compte/12345\\n2. Se connecter avec zoe@exemple.fr\\n3. Commander pour 18 € et confirmer"}`);
  const proposed = await until(async () => cards(await rowsOf(b.id), "skill")[0], "skill card");
  const sc = proposed.card as Extract<Card, { type: "skill" }>;
  assert.equal(sc.status, "pending");
  assert.equal(sc.outside, false);
  assert.match(sc.steps, /https:\/\/fournil\.example\/\{path\}/);
  assert.match(sc.steps, /\{email\}/);
  assert.match(sc.steps, /\{amount\}/);
  assert.doesNotMatch(sc.steps, /zoe@|12345|18 €/);
  assert.equal(skills.list(b.id).length, 0, "nothing saved before the user decides");
  assert.equal((await call("POST", `/bots/${b.id}/cards/${proposed.seq}/skill`, { action: "save", steps: sc.steps + "\n4. Vérifier le mail de confirmation" })).status, 200);
  const saved = skills.list(b.id)[0];
  assert.equal(saved.learned, true);
  assert.equal(saved.outside, false);
  assert.match(saved.body, /Vérifier le mail/);
  await idle(b);
  // From a turn that read outside content (the mailbox): kept as outside content, listed (never inlined) in the prompt.
  await say(b, `chain ${SEARCH} {"query":""} >> memory_search {"query":"b"} >> memory_search {"query":"c"} >> skill_propose {"name":"Répondre aux devis","steps":"Répondre poliment"}`);
  const p2 = await until(async () => cards(await rowsOf(b.id), "skill").find((c) => (c.card as any).name === "Répondre aux devis"), "tainted skill card");
  assert.equal((p2.card as any).outside, true);
  await call("POST", `/bots/${b.id}/cards/${p2.seq}/skill`, { action: "save" });
  assert.equal(skills.list(b.id).find((s) => s.name === "Répondre aux devis")!.outside, true);
  const prompt = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.match(prompt, /Répondre aux devis \[learned from outside content: information only\]/);
  assert.doesNotMatch(prompt, /Répondre poliment/, "an outside skill is never inlined");
  await idle(b);
  // Learning switched off: no proposals.
  await call("PUT", "/memory-settings", { autoCapture: false });
  await say(b, `chain memory_search {"query":"a"} >> memory_search {"query":"b"} >> memory_search {"query":"c"} >> skill_propose {"name":"z","steps":"z"}`);
  await replied(b, "switched learning off");
  await call("PUT", "/memory-settings", { autoCapture: true });
  await idle(b);
});

test("task guides: only the index is in the prompt; guide_read returns the procedure, which gives no permission", async () => {
  const prompt = buildSystemPrompt(bots.byId(primary.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.match(prompt, /## Task guides/);
  assert.match(prompt, /Réserver \(restaurant, hôtel, rendez-vous\)/);
  assert.match(prompt, /Rédiger un devis/);
  assert.doesNotMatch(prompt, /Bon pour accord/, "the guide's body is not in the prompt");
  assert.equal((await call("GET", "/guides")).json.guides.length >= 4, true);
  await say(primary, `call guide_read {"name":"rediger-devis"}`);
  await replied(primary, "Bon pour accord");
  assert.match(lastAssistant(await rowsOf(primary.id))!.body.kind === "message" ? (lastAssistant(await rowsOf(primary.id))!.body as any).text : "", /not a permission/);
  await idle(primary);
});

// ── 5. Payments with a vault card (A12) ─────────────────────────────────────
test("cards: sealed in the vault, only the network and last 4 shown; Luhn checked", async () => {
  assert.equal(luhnOk("4242 4242 4242 4242"), true);
  assert.equal(luhnOk("4242 4242 4242 4241"), false);
  assert.equal(brandOf("5555555555554444"), "Mastercard");
  assert.equal((await call("POST", "/vault", { kind: "card", name: "Visa perso", number: "4242 4242 4242 4241", expiry: "12/30", cvc: "123" })).status, 400);
  assert.equal((await call("POST", "/vault", { kind: "card", name: "Visa perso", number: "4242424242424242", expiry: "13/30", cvc: "123" })).status, 400);
  const r = await call("POST", "/vault", { kind: "card", name: "Visa perso", number: "4242 4242 4242 4242", expiry: "12/30", cvc: "123", holder: "Zoé Martin", dailyCapUsd: 50 });
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.item.card.brand, "Visa");
  assert.equal(r.json.item.card.last4, "4242");
  assert.equal(r.json.item.card.dailyCapUsd, 50);
  const list = await call("GET", "/vault");
  assert.doesNotMatch(list.text, /4242424242424242|4242 4242 4242 4242|12\/30|Zoé Martin/);
  assert.equal(redactSecrets(userId, "carte 4242424242424242 ok"), "carte [hidden] ok");
});

test("card_fill: every payment asks, bound to amount, merchant, card and page; typed by the server; caps; page changed", async () => {
  const b = await fresh("Acheteur", { autonomy: "trusted" });
  const typed: string[] = [];
  const clicks: number[][] = [];
  let page = "https://shop.example/checkout";
  probe.pageUrl = async () => page;
  cardScreen.click = async (_b, _u, x, y) => { clicks.push([x, y]); };
  cardScreen.type = async (_b, _u, text) => { typed.push(text); };
  const pay = (amount: number, extra = "") => say(b, `paie ${amount} € chez Fournil : call card_fill {"card":"Visa perso","amount":${amount},"currency":"EUR","merchant":"Fournil","fields":[{"field":"number","x":100,"y":200},{"field":"expiry","x":100,"y":240},{"field":"cvc","x":200,"y":240}],"submit":{"x":300,"y":400}${extra},"user_quote":"paie ${amount} € chez Fournil"}`);
  await pay(42.9, `,"seen_host":"evil.example"`);
  const card = await pendingApproval(b);
  assert.equal(card.once, true, "never \"Always\"");
  assert.match(card.title, /payer 42\.9 EUR à Fournil avec Visa perso/);
  assert.match(card.detail, /Page : shop\.example/, "bound to the page the server read, not the one the model wrote");
  assert.equal(typed.length, 0, "nothing typed before the user says yes");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "always" });
  await replied(b, "NOT proof of payment");
  await idle(b);
  assert.deepEqual(typed, ["4242424242424242", "12/30", "123"]);
  assert.deepEqual(clicks, [[100, 200], [100, 240], [200, 240], [300, 400]]);
  assert.doesNotMatch(historyOf(b.id), /4242424242424242/, "the model never sees the number");
  const paid = (await call("GET", "/payments")).json.payments[0];
  assert.equal(paid.status, "submitted");
  assert.equal(paid.host, "shop.example");
  assert.equal((await call("GET", "/vault")).json.items.find((i: any) => i.name === "Visa perso").card.spentTodayUsd, 42.9);
  // "Always" was not kept: the next payment asks again.
  await pay(5);
  const again = await pendingApproval(b);
  // The page changed before the answer: nothing is typed.
  page = "https://evil.example/pay";
  await call("POST", `/approvals/${again.approvalId}`, { decision: "allow" });
  await idle(b);
  assert.equal(steps(await rowsOf(b.id), "card_fill").pop()!.summary, "page changed");
  assert.equal(typed.length, 3);
  // Over the daily cap (50): refused before any card.
  page = "https://shop.example/checkout";
  await pay(20);
  await idle(b);
  assert.equal(cards(await rowsOf(b.id), "approval").filter((c) => (c.card as any).status === "pending").length, 0);
  assert.match(steps(await rowsOf(b.id), "card_fill").pop()!.summary!, /plafond quotidien/);
  assert.equal(typed.length, 3);
});

// ── 6. Committing clicks (A13) ──────────────────────────────────────────────
test("committing clicks: words like payer / envoyer / supprimer need grounding or approval, bound to the control and the page", async () => {
  assert.equal(committingKind("Payer 42,90 €"), "pay");
  assert.equal(committingKind("Commander"), "pay");
  assert.equal(committingKind("Supprimer le compte"), "delete");
  assert.equal(committingKind("Envoyer"), "send");
  assert.equal(committingKind("Publish"), "publish");
  assert.equal(committingKind("Confirmer"), "submit");
  assert.equal(committingKind("Ajouter au panier"), null);
  assert.equal(committingKind("Tout accepter les cookies"), null);
  assert.equal(committingKind("Suivant"), null);
  assert.equal(committingKind("Annuler"), null);
  const b = await fresh("Cliqueur", { autonomy: "trusted" });
  let label = "Suivant";
  probe.target = async () => ({ label, tag: "button", role: "", type: "submit", formAction: "https://shop.example/pay", formMethod: "post", url: "https://shop.example/checkout" });
  // An ordinary click: no card.
  const turn = await newTurn(bots.byId(b.id)!, users.byId(userId)!, 0, new AbortController().signal);
  const plain = { type: "tool_use" as const, id: "c1", name: "screen_click", input: { x: 10, y: 20 } as Record<string, unknown> };
  await bindCall(turn, plain);
  assert.deepEqual(plain.input.seen_target, { label: "Suivant", host: "shop.example", form: "POST https://shop.example/pay" });
  assert.equal((await authorize(turn, plain)).kind, "allow");
  assert.ok((turn.tools.find((t) => t.name === "screen_click")!.inputSchema.properties as Record<string, unknown>).user_quote, "a click can cite the user's words");
  // A pay button: the floor asks, even for a trusted bot with words.
  label = "Payer 42,90 €";
  await say(b, `clique sur payer : call screen_click {"x":10,"y":20,"user_quote":"clique sur payer"}`);
  const card = await pendingApproval(b);
  assert.match(card.title, /cliquer sur « Payer 42,90 € » sur shop\.example/);
  assert.match(card.why!, /paiement demande toujours/);
  assert.equal(card.once, true);
  assert.match(card.detail, /Formulaire : POST https:\/\/shop\.example\/pay/);
  // The page changed before the answer: nothing is clicked.
  label = "Annuler la commande";
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await idle(b);
  assert.equal(steps(await rowsOf(b.id), "screen_click").pop()!.summary, "page changed");
  // A send button with words that only ask to look: out of scope → card.
  label = "Envoyer le message";
  const careful = await fresh("Prudent", { autonomy: "balanced" });
  await say(careful, `regarde la page : call screen_click {"x":10,"y":20,"user_quote":"regarde la page"}`);
  const c2 = await pendingApproval(careful);
  assert.match(c2.why!, /ne demandent pas ce genre d'action/);
  await call("POST", `/approvals/${c2.approvalId}`, { decision: "deny" });
  await idle(careful);
  probe.target = async () => null;
});

// ── 7. API connectors on demand (A16) ───────────────────────────────────────
test("API connectors: proposed by the bot, approved with the token on the card, declared endpoints only, token never shown", async () => {
  assert.equal(scrubSecret(`a tok-123 b ${encodeURIComponent("tok/1 2")} ${Buffer.from("tok-123").toString("base64")}`, "tok-123"), "a [hidden] b tok%2F1%202 [hidden]");
  const b = await fresh("Intégrateur", { autonomy: "careful" });
  await say(b, `call api_connector_propose {"name":"Acme CRM","base_url":"${LOCAL}/v1","secret":"Acme token","endpoints":[{"method":"GET","path":"/contacts/{id}","description":"Un contact"},{"method":"POST","path":"/contacts","description":"Créer un contact"},{"method":"DELETE","path":"/contacts/{id}"},{"method":"GET","path":"/../admin"}]}`);
  const proposed = await until(async () => cards(await rowsOf(b.id), "apiconnector")[0], "connector card");
  const pc = proposed.card as Extract<Card, { type: "apiconnector" }>;
  assert.equal(pc.status, "pending");
  assert.equal(pc.endpoints.length, 3, "an unsafe path is dropped");
  assert.equal(pc.secretSaved, false);
  await idle(b);
  assert.equal((await call("POST", `/bots/${b.id}/cards/${proposed.seq}/apiconnector`, { action: "approve" })).status, 400, "the token is needed");
  assert.equal((await call("POST", `/bots/${b.id}/cards/${proposed.seq}/apiconnector`, { action: "approve", token: "tok-123" })).status, 200);
  const secret = vault.byName(userId, "Acme token")!;
  assert.deepEqual(secret.hosts, ["127.0.0.1"]);
  assert.equal((await call("GET", "/api-connectors")).json.connectors[0].status, "active");
  await idle(b);
  const conn = (await call("GET", "/api-connectors")).json.connectors[0];
  assert.ok(matchEndpoint(conn, "GET", "/contacts/42"));
  assert.equal(matchEndpoint(conn, "GET", "/contacts/42/notes"), null);
  // A read: free, outside content, the token in every form is hidden.
  await say(b, `call api_get {"connector":"Acme CRM","path":"/contacts/42"}`);
  await replied(b, "Status 200");
  const said = (lastAssistant(await rowsOf(b.id))!.body as { text: string }).text;
  assert.doesNotMatch(said, /tok-123|dG9rLTEyMw/);
  assert.equal(apiCalls.at(-1)!.auth, "Bearer tok-123");
  // Not declared: nothing sent.
  const n = apiCalls.length;
  await say(b, `call api_get {"connector":"Acme CRM","path":"/admin/users"}`);
  await replied(b, "not one of Acme CRM's approved endpoints");
  assert.equal(apiCalls.length, n);
  // A write asks (careful bot); a DELETE always asks (the floor), even for a trusted bot.
  await say(b, `call api_send {"connector":"Acme CRM","method":"POST","path":"/contacts","body":{"name":"Camille"}}`);
  const w = await pendingApproval(b).catch(async (e) => { console.log(JSON.stringify((await rowsOf(b.id)).slice(-4), null, 1)); throw e; });
  await call("POST", `/approvals/${w.approvalId}`, { decision: "allow" });
  await replied(b, "Status 200");
  assert.equal(apiCalls.at(-1)!.method, "POST");
  const t = await fresh("Confiant", { autonomy: "trusted" });
  await say(t, `supprime le contact 42 : call api_send {"connector":"Acme CRM","method":"DELETE","path":"/contacts/42","user_quote":"supprime le contact 42"}`);
  const del = await pendingApproval(t);
  assert.match(del.why!, /suppression demande toujours/);
  await call("POST", `/approvals/${del.approvalId}`, { decision: "deny" });
  await idle(t);
});

// ── 8. Telegram commands and reactions (A17) ────────────────────────────────
test("telegram: /taches /etat /usage /memoire /stop answered by the server; 👍 answers an approval, never a payment; reactions on replies are feedback", async () => {
  const b = await fresh("Messager", { autonomy: "careful" });
  const status = await telegram.connect(bots.byId(b.id)!, "123:abc");
  telegram.start();
  const push = (u: Record<string, unknown>) => tgUpdates.push({ update_id: tgUpdateId++, ...u });
  push({ message: { message_id: 1, text: `/start ${status.linkCode}`, chat: { id: 42, type: "private" } } });
  await until(() => bots.byId(b.id)!.telegramChatId === "42", "linked");
  const reply = (part: string | RegExp) => until(() => tgSent.find((m) => (typeof part === "string" ? m.text.includes(part) : part.test(m.text))), `telegram reply ${part}`);
  push({ message: { message_id: 2, text: "/aide", chat: { id: 42, type: "private" } } });
  await reply("/taches (tâches en cours)");
  push({ message: { message_id: 3, text: "/taches", chat: { id: 42, type: "private" } } });
  await reply("Aucune tâche en cours pour Messager.");
  push({ message: { message_id: 4, text: "/usage", chat: { id: 42, type: "private" } } });
  await reply(/Ce mois-ci : [\d.]+ \$ dépensés/);
  push({ message: { message_id: 5, text: "/memoire", chat: { id: 42, type: "private" } } });
  await reply("Messager ne retient encore rien.");
  push({ message: { message_id: 6, text: "/etat", chat: { id: 42, type: "private" } } });
  await reply("Messager : au repos".replace(" :", ":"));
  push({ message: { message_id: 7, text: "/stop", chat: { id: 42, type: "private" } } });
  await reply("⏹ Messager arrêté.");
  assert.equal(requests.filter((r) => JSON.stringify(r.messages).includes("/taches")).length, 0, "commands never reach the model");
  // An approval asked on Telegram: 👍 allows it.
  const before = sentRaw.length;
  push({ message: { message_id: 8, text: `réponds à Camille : call ${SEND} {"to":"camille.martin@exemple.fr","body":"Oui","user_quote":"réponds à Camille"}`, chat: { id: 42, type: "private" } } });
  const ask = await reply("👍 = oui · 👎 = non");
  push({ message_reaction: { chat: { id: 42, type: "private" }, message_id: ask.message_id, new_reaction: [{ type: "emoji", emoji: "👍" }], old_reaction: [] } });
  await until(() => sentRaw.length === before + 1, "mail sent after 👍");
  await idle(b);
  // A reaction on a reply becomes feedback for the bot.
  const answer = await until(() => [...tgSent].reverse().find((m) => m.text.startsWith("Sent (id") || m.text.startsWith("Tool said")), "reply on telegram");
  push({ message_reaction: { chat: { id: 42, type: "private" }, message_id: answer.message_id, new_reaction: [{ type: "emoji", emoji: "❤️" }], old_reaction: [] } });
  await until(() => q.get("SELECT 1 FROM feedback WHERE bot_id = ? AND emoji = '❤️'", b.id), "feedback from telegram");
  // A payment approval is never answered from Telegram.
  const fake = approvals.create(b.id, userId, bots.byId(b.id)!.generation, 1, "card: Visa perso", undefined, "h");
  q.run("INSERT INTO telegram_messages (bot_id, message_id, kind, ref, created_at) VALUES (?, ?, 'approval', ?, ?)", b.id, 9999, fake.id, Date.now());
  push({ message_reaction: { chat: { id: 42, type: "private" }, message_id: 9999, new_reaction: [{ type: "emoji", emoji: "👍" }], old_reaction: [] } });
  await reply("🔒 Celle-ci se valide dans l'appli.");
  assert.equal(approvals.byId(fake.id)!.status, "pending");
  assert.match(commandAnswer(bots.byId(b.id)!, "help"), /\/memoire/);
});

// ── 9. First-task ideas (A19) ───────────────────────────────────────────────
test("first-task ideas: classics by default; from recent email subjects only on opt-in, matched locally (no model call)", async () => {
  const ideas = ideasFromSubjects(["Votre facture de mars", "Invitation : réunion lundi", "Newsletter -20 %"], "fr");
  assert.ok(ideas.length >= 3 && ideas.length <= 5);
  assert.equal(ideas[0].kind, "once");
  assert.ok(ideas.some((i) => i.title === "Faire le point sur mes factures"));
  assert.ok(ideas.some((i) => i.title === "Préparer ma prochaine réunion"));
  const plain = (await call("GET", "/ideas")).json;
  assert.equal(plain.source, "default");
  assert.ok(plain.ideas.some((i: any) => i.title === "Point du matin"));
  const before = requests.length;
  const mail = (await call("GET", "/ideas?mail=1")).json;
  assert.equal(mail.source, "mail");
  assert.ok(mail.sampled >= 3);
  assert.ok(mail.ideas.some((i: any) => i.title === "Relancer les devis"));
  assert.ok(mail.ideas.some((i: any) => i.title === "Suivre mes livraisons"));
  assert.equal(requests.length, before, "no model call");
});

// ── 10. Private pages and targeted edits ────────────────────────────────────
test("pages: private pages only for their owner, signed in; page_edit applies exact find/replace edits", async () => {
  const b = await fresh("Éditeur");
  await say(b, `call page_publish {"name":"suivi","title":"Suivi","html":"<h1>Bonjour</h1><p>Total : 10</p>","visibility":"private"}`);
  await replied(b, "Private");
  const page = pages.list(userId, "https://sklubot.example").find((p) => p.title === "Suivi")!;
  assert.equal(page.visibility, "private");
  assert.equal((await site.request(`/p/${page.token}`)).status, 404, "a stranger gets nothing");
  const own = await site.request(`/p/${page.token}`, { headers: { cookie } });
  assert.equal(own.status, 200);
  assert.match(await own.text(), /Bonjour/);
  const other = await api.request("/auth/signup", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: "eve@example.com", name: "Eve", password: "password123" }) });
  const eve = other.headers.get("set-cookie")?.split(";")[0] ?? "";
  assert.equal((await site.request(`/p/${page.token}`, { headers: { cookie: eve } })).status, 404, "another account gets nothing");
  assert.equal((await call("PATCH", `/pages/${page.token}`, { visibility: "link" })).status, 200);
  assert.equal((await site.request(`/p/${page.token}`)).status, 200);
  await idle(b);
  await say(b, `call page_edit {"name":"suivi","edits":[{"find":"Total : 10","replace":"Total : 12"},{"find":"Bonjour","replace":"Salut"}]}`);
  await replied(b, "Applied 2 edits");
  assert.match(await (await site.request(`/p/${page.token}`)).text(), /<h1>Salut<\/h1><p>Total : 12<\/p>/);
  await idle(b);
  await say(b, `call page_edit {"name":"suivi","edits":[{"find":"Total","replace":"X"},{"find":"nowhere","replace":"Y"}]}`);
  await replied(b, "Edit 2: the text to find appears 0 times");
  assert.match(await (await site.request(`/p/${page.token}`)).text(), /Total : 12/, "all or nothing");
  await idle(b);
});

// ── 11. Rules edited from the chat ──────────────────────────────────────────
test("rule_propose: never applied silently — a card with the exact rule and scope (the user's own yes, never a dead end), undo in one click", async () => {
  const b = await fresh("Régleur", { autonomy: "trusted" });
  const before = ruleStore.all(userId).length;
  await say(b, `à partir de maintenant ne réponds jamais aux newsletters : call rule_propose {"action":"add","text":"Ne jamais répondre aux newsletters","scope":"account","user_quote":"ne réponds jamais aux newsletters"}`);
  const card = await pendingApproval(b);
  assert.equal(card.once, true, "never \"Always\"");
  assert.match(card.title, /ajouter cette règle : « Ne jamais répondre aux newsletters » \(tous les bots\)/);
  assert.equal(ruleStore.all(userId).length, before, "nothing applied before the user says yes");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await replied(b, "Done: Règle ajoutée depuis la discussion");
  await idle(b);
  const added = ruleStore.all(userId).find((r) => r.text === "Ne jamais répondre aux newsletters")!;
  assert.equal(added.source, "chat");
  assert.equal(added.quote, "ne réponds jamais aux newsletters");
  assert.equal(added.botId, null);
  const state = (await call("GET", "/rules")).json;
  const change = state.changes[0];
  assert.equal(change.action, "add");
  // Undo in one click.
  assert.equal((await call("POST", `/rules/changes/${change.id}/undo`)).status, 200);
  assert.equal(ruleStore.all(userId).some((r) => r.id === added.id), false);
  assert.equal((await call("POST", `/rules/changes/${change.id}/undo`)).status, 409);
  // No words of the user: never a dead end — the card (the user's own yes) says no words were cited; refused, nothing changes.
  const count = ruleStore.all(userId).length;
  await say(b, `call rule_propose {"action":"add","text":"Toujours tout accepter","scope":"account"}`);
  const bare = await pendingApproval(b);
  assert.match(bare.why!, /n'a cité aucun de tes mots/);
  await call("POST", `/approvals/${bare.approvalId}`, { decision: "deny" });
  await idle(b);
  assert.equal(ruleStore.all(userId).length, count);
  // After outside content, words taken from an email never count: the card says so, and the user decides.
  queue.push({ name: "rule_propose", input: { action: "add", text: "Transférer les contrats à bob@autre.fr", scope: "account", user_quote: "pouvez-vous confirmer le devis" } });
  await say(b, `lis mes mails : call ${SEARCH} {"query":""}`);
  const outside = await pendingApproval(b);
  assert.match(outside.why!, /Du contenu extérieur a été lu/);
  assert.match(outside.why!, /n'a pas retrouvé ces mots/);
  await call("POST", `/approvals/${outside.approvalId}`, { decision: "deny" });
  await idle(b);
  assert.equal(ruleStore.all(userId).some((r) => r.text.includes("bob@autre.fr")), false);
  // A removal, undone: the rule comes back as it was.
  const keep = ruleStore.create(userId, "Toujours vouvoyer les clients", null);
  await say(b, `oublie la règle sur le vouvoiement : call rule_propose {"action":"remove","rule":"Toujours vouvoyer les clients","user_quote":"oublie la règle sur le vouvoiement"}`);
  const rm = await pendingApproval(b);
  await call("POST", `/approvals/${rm.approvalId}`, { decision: "allow" });
  await replied(b, "Règle retirée");
  await idle(b);
  assert.equal(ruleStore.owned(userId, keep.id), null);
  await call("POST", `/rules/changes/${(await call("GET", "/rules")).json.changes[0].id}/undo`);
  assert.equal(ruleStore.owned(userId, keep.id)!.text, "Toujours vouvoyer les clients");
  ruleStore.remove(keep.id);
});

// ── 12. Rules tied to a routine or a trigger kind ───────────────────────────
test("scoped rules: a rule for one routine (or a trigger kind) applies only to turns that routine started", async () => {
  const b = await fresh("Classeur");
  const r = routines.create(b.id, { name: "Factures clients", prompt: "Range les factures du jour", trigger: "cron", schedule: "0 18 * * *", timezone: "UTC" });
  const made = await call("POST", "/rules", { text: "Ne jamais répondre, seulement classer", routineId: r.id });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.json.rule.routineId, r.id);
  assert.equal(made.json.rule.botId, b.id, "a routine's rule belongs to its bot");
  assert.equal((await call("POST", "/rules", { text: "x", trigger: "fax" })).status, 400);
  const mail = (await call("POST", "/rules", { text: "Quand un e-mail arrive de la banque : seulement résumer", trigger: "email" })).json.rule;
  const prompt = buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false });
  assert.doesNotMatch(prompt, /seulement classer/, "not in the bot's usual prompt");
  assert.doesNotMatch(prompt, /de la banque/);
  assert.ok(ruleStore.forBot(userId, b.id, { trigger: "email" }).some((x) => x.id === mail.id), "a turn started by an email routine gets the email rule");
  assert.ok(!ruleStore.forBot(userId, b.id, { trigger: "cron" }).some((x) => x.id === mail.id));
  const n = requests.length;
  fireRoutine(routines.byId(r.id)!);
  await until(() => requests.length > n, "routine turn");
  await idle(b);
  const first = JSON.stringify(requests[n].messages.at(-1));
  assert.match(first, /for this routine/);
  assert.match(first, /Ne jamais répondre, seulement classer/);
  assert.doesNotMatch(first, /de la banque/, "a cron routine does not get the email rule");
  await call("DELETE", `/rules/${mail.id}`);
});

// ── 13. Memory confidence that grows by itself ──────────────────────────────
test("memory confidence: mentioned once → confirmed when the user says it again; a contradiction contests it and asks which is right", async () => {
  const b = await fresh("Mémoire", { model: "memo:m" });
  const note = memories.add(b.id, "The user works at SKLUBS.", "learned", { quote: "je travaille chez SKLUBS" });
  assert.equal(note.confidence, "once");
  await new Promise((r) => setTimeout(r, 5));
  // The bot's own words never confirm anything.
  rowStore.append(bots.byId(b.id)!, { kind: "message", role: "assistant", text: "Tu m'as dit : je travaille chez SKLUBS" });
  memoFacts = [];
  await consolidate(bots.byId(b.id)!);
  assert.equal(memories.owned(userId, note.id)!.confidence, "once");
  // The user says it again in a later message: confirmed. (A later millisecond: consolidation reads the messages
  // written after the last one it saw, by time; on a fast machine both rows could otherwise share one.)
  await new Promise((r) => setTimeout(r, 5));
  rowStore.append(bots.byId(b.id)!, { kind: "message", role: "user", text: "Comme je te l'ai dit, je travaille chez SKLUBS depuis 2020." });
  await consolidate(bots.byId(b.id)!);
  assert.equal(memories.owned(userId, note.id)!.confidence, "confirmed");
  assert.match(buildSystemPrompt(bots.byId(b.id)!, users.byId(userId)!, { connectorNames: [], browser: false, shell: false }), /\(confirmed\) The user works at SKLUBS\./);
  // A contradiction in the user's own words: contested, and a card asks which is right.
  rowStore.append(bots.byId(b.id)!, { kind: "message", role: "user", text: "Au fait, je travaille maintenant chez Acme." });
  memoFacts = [{ text: "The user works at Acme.", quote: "je travaille maintenant chez Acme", contradicts: "The user works at SKLUBS." }];
  await consolidate(bots.byId(b.id)!);
  assert.equal(memories.owned(userId, note.id)!.status, "contested");
  const q2 = await until(async () => cards(await rowsOf(b.id), "memory")[0], "memory card");
  assert.equal((q2.card as any).newText, "The user works at Acme.");
  // A contradiction quoted from somewhere else (not the user's words) changes nothing.
  memoFacts = [{ text: "The user lives in Lyon.", quote: "il habite à Lyon", contradicts: "The user works at Acme." }];
  await consolidate(bots.byId(b.id)!);
  assert.equal(cards(await rowsOf(b.id), "memory").length, 1);
  assert.equal((await call("POST", `/bots/${b.id}/cards/${q2.seq}/memory`, { choice: "new" })).status, 200);
  assert.equal(memories.owned(userId, note.id)!.status, "archived");
  const now = memories.list(b.id).find((m) => m.text === "The user works at Acme.")!;
  assert.equal(now.confidence, "confirmed");
  // The user can confirm a note themselves; a search marks notes as used.
  const other = memories.add(b.id, "The user prefers short emails.", "chat");
  assert.equal((await call("PATCH", `/memories/${other.id}`, { confidence: "confirmed" })).json.memory.confidence, "confirmed");
  await call("PATCH", `/bots/${b.id}`, { model: "script:script-1" });
  await say(b, `call memory_search {"query":"emails courts short"}`);
  await replied(b, "Tool said:");
  assert.ok(memories.owned(userId, other.id)!.lastUsedAt);
  await idle(b);
});
