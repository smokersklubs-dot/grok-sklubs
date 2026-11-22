import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Lot 2 : cache du modèle (L57), recherche d'outils (Hermes, écart 4) et run_steps. Un modèle scénarisé joue le bot ;
// chaque requête qu'il reçoit est aussi mise en forme comme pour Anthropic (buildParams) et pour un fournisseur
// compatible OpenAI (toolsForCall), pour mesurer ce qui resterait en cache d'un appel à l'autre.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-lot2-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.SHELL_ENABLED = "1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.TOOL_SEARCH;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const loop = await import("../src/agent/loop.js");
const { buildParams } = await import("../src/llm/anthropic.js");
const { splitSystem, TURN_CONTEXT_HEADING, messageBreakpoints } = await import("../src/llm/cachelayout.js");
const { toolsForCall, loadedInTurn, searchTools, CORE_TOOLS, TOOL_SEARCH } = await import("../src/llm/toolsearch.js");
const { memories, approvals } = await import("../src/store.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const requests: TurnRequest[] = [];
const queue: { name: string; input: Record<string, unknown> }[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(structuredClone({ ...req, signal: undefined, onText: undefined, onReasoning: undefined, onToolStart: undefined, onActivity: undefined }));
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
    let content: Block[];
    const chain = /chain (.*)/s.exec(said);
    if (results.length && !texts.length && queue.length) { const n = queue.shift()!; content = [{ type: "tool_use", id: `call_${requests.length}`, name: n.name, input: n.input }]; }
    else if (results.length && !texts.length) content = [{ type: "text", text: `Tool said: ${results.map((r) => (r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join(" | ")}` }];
    else if (chain) {
      const steps = chain[1].split(" >> ").map((p) => { const x = /(\w+) (\{.*\})/s.exec(p)!; return { name: x[1], input: JSON.parse(x[2]) as Record<string, unknown> }; });
      queue.push(...steps.slice(1));
      content = [{ type: "tool_use", id: `call_${requests.length}`, name: steps[0].name, input: steps[0].input }];
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
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).map((r) => (r.body as { text: string }).text);
const approvalCards = async (id: string) => (await rowsOf(id)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "approval" ? [r.body.card as Extract<Card, { type: "approval" }>] : []));
const idle = (id: string) => until(() => !loop.isBusy(id), "idle");
const say = (id: string, text: string) => call("POST", `/bots/${id}/messages`, { text });
const fresh = async (name: string): Promise<Bot> => (await call("POST", "/bots", { name })).json.bot;
const of = (botName: string) => requests.filter((r) => r.system.startsWith(`You are ${botName},`));

/** The request as Anthropic gets it, with the cache marks taken off (to compare bytes), and where the marks were. */
function shape(req: TurnRequest) {
  const p = buildParams(req);
  const marks: number[] = [];
  const msgs = (p.messages as any[]).map((m, i) => {
    const content = (m.content as any[]).map((b) => { if (b.cache_control) { marks.push(i); const { cache_control: _, ...rest } = b; return rest; } return b; });
    return JSON.stringify({ role: m.role, content });
  });
  const systemMarks = (p.system as any[]).filter((s) => s.cache_control).length;
  return { head: JSON.stringify({ tools: p.tools, system: (p.system as any[]).map((s) => s.text) }), msgs, marks, systemMarks, params: p };
}
/** How many messages of `prev`'s longest marked prefix are byte-identical in `next` (0: only tools + system are read back). */
function readBack(prev: TurnRequest, next: TurnRequest): { head: boolean; messages: number } {
  const a = shape(prev), b = shape(next);
  if (a.head !== b.head) return { head: false, messages: 0 };
  let best = 0;
  for (const m of a.marks) if (a.msgs.slice(0, m + 1).every((x, i) => b.msgs[i] === x)) best = Math.max(best, m + 1);
  return { head: true, messages: best };
}

test("setup", async () => {
  await call("POST", "/auth/signup", { email: "lot2@example.com", password: "password-1", locale: "fr" });
});

// ── L57 : cache du modèle ─────────────────────────────────────────────────────
test("L57: what changes per turn sits after one heading; the system prompt sent stays byte-identical across turns", async () => {
  const bot = await fresh("Cachou");
  memories.add(bot.id, "La personne aime le thé vert");
  await say(bot.id, 'chain memory_search {"query": "thé"}');
  await idle(bot.id);
  // Something that used to live in the system prompt changes between two turns: a new teammate joins the team.
  await fresh("Nouvelle");
  memories.add(bot.id, "Le rendez-vous chez le dentiste est mardi");
  await say(bot.id, "deuxième message");
  await idle(bot.id);
  await say(bot.id, 'chain memory_search {"query": "dentiste"}');
  await idle(bot.id);
  const mine = of("Cachou");
  assert.ok(mine.length >= 5, `requests: ${mine.length}`);
  // The defect, reproduced: the whole system prompt (team, notes) differs from one turn to the next…
  assert.notEqual(mine[0].system, mine[2].system, "the full prompt changes between turns (team, notes)");
  const { stable, turn } = splitSystem(mine[2].system);
  assert.ok(turn.startsWith(TURN_CONTEXT_HEADING) && /Nouvelle/.test(turn) && /dentiste/.test(turn), "team and notes are in the turn part");
  assert.doesNotMatch(stable, /Nouvelle|dentiste|thé vert|## What you remember|## Right now/, "nothing per-turn in the cached part");
  // …but what is sent as the system prompt (and cached with the tools) is the same bytes every time.
  const heads = new Set(mine.map((r) => shape(r).head));
  assert.equal(heads.size, 1, "tools + system identical on every call");
  // Every call after the first reads back at least tools + system, and inside a turn the whole earlier history.
  let readMsgs = 0;
  for (let i = 1; i < mine.length; i++) {
    const r = readBack(mine[i - 1], mine[i]);
    assert.ok(r.head, `call ${i}: tools + system read back`);
    readMsgs += r.messages;
  }
  assert.ok(readMsgs >= mine.length - 2, `history read back on most calls (got ${readMsgs} messages over ${mine.length - 1} calls)`);
  // Within the last turn (tool call then answer), the second call reads back every message of the first.
  const [a, b] = mine.slice(-2);
  assert.equal(readBack(a, b).messages, shape(a).msgs.length, "the tool loop reads back everything before it");
  // The turn context rides in front of the turn's own message, not in the system prompt.
  const lastMsgs = shape(b).params.messages as any[];
  const startText = JSON.stringify(lastMsgs.find((m, i) => m.role === "user" && i === lastMsgs.length - 3) ?? lastMsgs[lastMsgs.length - 3]);
  assert.match(startText, /For this turn only/);
});

test("L57: never more than 4 cache breakpoints, and never on a reasoning block", () => {
  const last = requests[requests.length - 1];
  const s = shape(last);
  assert.equal(s.systemMarks, 1);
  assert.ok(s.systemMarks + s.marks.length <= 4, `breakpoints: ${s.systemMarks + s.marks.length}`);
  assert.deepEqual(messageBreakpoints([true, false, false, true, false, false, true, false, false]), [2, 5, 8]);
  assert.deepEqual(messageBreakpoints([true]), [0]);
  assert.ok(messageBreakpoints(Array.from({ length: 40 }, (_, i) => i % 2 === 0)).length <= 3);
});

// ── Recherche d'outils ────────────────────────────────────────────────────────
test("tool search: a compact core is sent, the rest is listed by name; a search loads the tool for the rest of the turn", async () => {
  const bot = await fresh("Outils");
  await say(bot.id, 'chain tool_search {"query": "routine_list"} >> routine_list {}');
  await idle(bot.id);
  const mine = of("Outils");
  assert.ok(mine.length >= 3);
  const full = mine[0].tools;
  assert.ok(full.length >= 60, `the turn still holds every tool (${full.length})`);
  assert.ok(full.some((t) => t.name === TOOL_SEARCH));
  // OpenAI-compatible: before the search, the core only; after it, the found tool too.
  const before = toolsForCall(mine[0].tools, mine[0].messages);
  const after = toolsForCall(mine[1].tools, mine[1].messages);
  assert.ok(before.every((t) => CORE_TOOLS.has(t.name)), "core only before searching");
  assert.ok(!before.some((t) => t.name === "routine_list"));
  assert.ok(after.some((t) => t.name === "routine_list"), "loaded after the search");
  assert.deepEqual([...loadedInTurn(mine[1].messages)], ["routine_list"]);
  const bytes = (x: unknown) => JSON.stringify(x).length;
  assert.ok(bytes(before) * 3 < bytes(full), `compact (${bytes(before)} bytes) vs full (${bytes(full)} bytes)`);
  const catalog = before.find((t) => t.name === TOOL_SEARCH)!.description;
  assert.match(catalog, /- routine_list: /, "listed by name and one line");
  // Anthropic: every definition is sent, the others deferred, and the search result becomes a tool_reference.
  const p = buildParams(mine[1]);
  const tools = p.tools as any[];
  assert.equal(tools.find((t) => t.name === "routine_list").defer_loading, true);
  assert.equal(tools.find((t) => t.name === TOOL_SEARCH).defer_loading, undefined, "the search tool itself is never deferred");
  assert.ok(tools.some((t) => !t.defer_loading));
  const res = (p.messages as any[]).flatMap((m) => m.content).find((b: any) => b.type === "tool_result");
  assert.deepEqual(res.content, [{ type: "tool_reference", tool_name: "routine_list" }]);
  // The deferred tool ran through the normal path.
  assert.match((await replies(bot.id)).join("\n"), /Tool said:/);
  // A new turn starts with the core again.
  await say(bot.id, "merci");
  await idle(bot.id);
  const next = of("Outils").at(-1)!;
  assert.ok(!toolsForCall(next.tools, next.messages).some((t) => t.name === "routine_list"), "loaded only for the turn");
  // The same tools list on every call: the Anthropic tool block stays cacheable.
  assert.equal(JSON.stringify(buildParams(mine[0]).tools), JSON.stringify(buildParams(next).tools));
});

test("tool search: switched off, or with few tools, everything is sent as before; the search itself ranks names first", () => {
  const r = of("Outils")[0];
  process.env.TOOL_SEARCH = "off";
  try { assert.equal(toolsForCall(r.tools, r.messages).length, r.tools.length); } finally { delete process.env.TOOL_SEARCH; }
  const few = r.tools.slice(0, 10);
  assert.equal(toolsForCall(few, r.messages).length, 10);
  assert.equal(searchTools(r.tools, "routine_list")[0].name, "routine_list");
  assert.ok(searchTools(r.tools, "mémoire chercher memory").some((t) => t.name.startsWith("memory_")));
});

// ── run_steps ────────────────────────────────────────────────────────────────
test("run_steps: several reads in one step, results combined", async () => {
  const bot = await fresh("Lots");
  await say(bot.id, 'chain run_steps {"steps": [{"tool": "memory_search", "input": {"query": "vacances"}}, {"tool": "guide_read", "input": {"name": "methodes"}}, {"tool": "routine_list", "input": {}}]}');
  await idle(bot.id);
  const said = (await replies(bot.id)).join("\n");
  assert.match(said, /Step 1: memory_search/);
  assert.match(said, /Step 2: guide_read/);
  assert.doesNotMatch(said, /Step 3: routine_list/, "routine_list is not a read-only batchable tool");
  assert.match(said, /Step 3 \(routine_list\) is not a read-only tool/);
});

test("run_steps: a step that needs approval stops the batch and runs nothing more; the direct call asks as before", async () => {
  const bot = await fresh("Garde");
  // A tainted turn (outside content): searching every bot's chats then needs the user's approval.
  loop.enqueue(bot.id, { kind: "system", text: 'chain run_steps {"steps": [{"tool": "guide_read", "input": {"name": "methodes"}}, {"tool": "conversation_search", "input": {"query": "secret", "scope": "everyone"}}, {"tool": "guide_read", "input": {"name": "opendesign"}}]}', tainted: true });
  await idle(bot.id);
  const said = (await replies(bot.id)).join("\n");
  assert.match(said, /Step 1: guide_read/);
  assert.match(said, /Step 2 \(conversation_search\) needs the user's approval/);
  assert.doesNotMatch(said, /Step 3/, "nothing after the stop");
  assert.equal((await approvalCards(bot.id)).length, 0, "no approval is granted or skipped inside the batch");
  // The direct call goes the normal way: an approval card.
  loop.enqueue(bot.id, { kind: "system", text: 'chain conversation_search {"query": "secret", "scope": "everyone"}', tainted: true });
  const card = await until(async () => (await approvalCards(bot.id)).find((c) => c.status === "pending"), "approval card");
  assert.equal(approvals.byId(card.approvalId)?.status, "pending");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await idle(bot.id);
  // A step that changes something is refused outright.
  await say(bot.id, 'chain run_steps {"steps": [{"tool": "shell_run", "input": {"command": "echo non"}}]}');
  await idle(bot.id);
  assert.match((await replies(bot.id)).join("\n"), /Step 1 \(shell_run\) is not a read-only tool/);
  assert.equal((await approvalCards(bot.id)).filter((c) => c.status === "pending").length, 0);
});
