import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Wave 10, item 5: long API turns — tool-result pruning, the latest screenshots only, in-turn compaction at 80 % of the
// context window (cut only where every tool call has its result), "too long" errors → compact and retry, spill notices.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w10c-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.CONTEXT_WINDOW_TOKENS = "60000";
delete process.env.MAX_BOTS;

const { registerProvider, ProviderError, isContextTooLong } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { history, bots, botQueue } = await import("../src/store.js");
const ctx = await import("../src/agent/context.js");
import type { Block, ChatMessage, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const text = (t: string): Block => ({ type: "text", text: t });
const img = (n: number): Block => ({ type: "image", mediaType: "image/png", data: `IMG${n}` });
const result = (id: string, content: Block[]): Block => ({ type: "tool_result", toolUseId: id, content: content as any });
const use = (id: string): Block => ({ type: "tool_use", id, name: "screen_view", input: {} });

test("old long tool results are pruned to head + marker + tail; recent ones and short ones are untouched", () => {
  const long = "H".repeat(5000) + "M".repeat(10_000) + "T".repeat(2000);
  const msgs: ChatMessage[] = [
    { role: "user", content: [text("go")] },
    { role: "assistant", content: [use("a")] },
    { role: "user", content: [result("a", [text(long)])] },
    { role: "assistant", content: [use("b")] },
    { role: "user", content: [result("b", [text(long)])] },
  ];
  const out = ctx.pruneOldToolResults(msgs);
  const old = (out[2].content[0] as any).content[0].text as string;
  assert.equal(old.length, 4096 + ctx.PRUNE_MARKER.length + 1024);
  assert.ok(old.startsWith("H".repeat(4096)) && old.endsWith("T".repeat(1024)) && old.includes("[... tool result middle pruned ...]"));
  assert.equal((out[4].content[0] as any).content[0].text, long, "the step in progress is sent whole");
  assert.equal(ctx.pruneText("short"), null);
  assert.equal(msgs[2].content[0], (msgs[2].content[0]), "the history itself is not changed");
  assert.equal(((msgs[2].content[0] as any).content[0].text as string).length, long.length);
});

test("within a turn only the latest screenshots are kept; earlier turns lose theirs", () => {
  const msgs: ChatMessage[] = [{ role: "user", content: [text("old turn"), img(0)] }, { role: "assistant", content: [text("ok")] }, { role: "user", content: [text("new turn")] }];
  for (let i = 1; i <= 11; i++) { msgs.push({ role: "assistant", content: [use(`s${i}`)] }); msgs.push({ role: "user", content: [result(`s${i}`, [text(`shot ${i}`), img(i)])] }); }
  const out = ctx.trimImages(msgs, 8);
  const kept = JSON.stringify(out).match(/IMG\d+/g) ?? [];
  assert.deepEqual(kept, ["IMG4", "IMG5", "IMG6", "IMG7", "IMG8", "IMG9", "IMG10", "IMG11"]);
  assert.match(JSON.stringify(out[0]), /An earlier image was here/);
  assert.match(JSON.stringify(out[4]), /only the latest ones are kept/);
});

test("a history is cut only where every tool call has its result", () => {
  const msgs: ChatMessage[] = [
    { role: "user", content: [text("a".repeat(100))] },
    { role: "assistant", content: [text("b"), { type: "tool_use", id: "x", name: "t", input: {} }, { type: "tool_use", id: "y", name: "t", input: {} }] },
    { role: "user", content: [result("x", [text("r")])] },
    { role: "user", content: [result("y", [text("r".repeat(50))])] },
    { role: "assistant", content: [text("c".repeat(200))] },
    { role: "user", content: [text("d".repeat(300))] },
  ];
  // Between the two results (index 3) is not a cut: y is still open there.
  assert.equal(ctx.balancedCut(msgs, 400), 4);
  assert.equal(ctx.balancedCut(msgs, 1), 5);
  // Keeping 600 characters would mean cutting between a call and its result, or leaving under two messages: no cut.
  assert.equal(ctx.balancedCut(msgs, 600), null);
  assert.equal(ctx.balancedCut(msgs, 100_000), null);
});

test("'too long' errors are recognised; the spill notice says where the full result is", () => {
  assert.ok(isContextTooLong(400, "prompt is too long: 215000 tokens > 200000 maximum"));
  assert.ok(isContextTooLong(400, `{"error":{"message":"This model's maximum context length is 131072 tokens. However, you requested 140000 tokens","code":"context_length_exceeded"}}`));
  assert.ok(isContextTooLong(413, "request_too_large: Request exceeds the maximum allowed number of bytes"));
  assert.equal(isContextTooLong(400, "invalid tool schema"), false);
  assert.equal(isContextTooLong(429, "prompt is too long"), false);
  const full = "x".repeat(30_000);
  const p = ctx.spillPreview(full, "~/.sklubot/outputs/abc.txt");
  assert.ok(p.length < 13_000);
  assert.match(p, /Full result stored at: ~\/\.sklubot\/outputs\/abc\.txt/);
  assert.match(p, /Omitted 18000 characters/);
});

// ── In a real turn ───────────────────────────────────────────────────────────
const seen: TurnRequest[] = [];
let tooLongAbove = Infinity;
const size = (req: TurnRequest) => req.system.length + JSON.stringify(req.tools).length + JSON.stringify(req.messages).length;
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    const last = JSON.stringify(req.messages[req.messages.length - 1]);
    if (/compaction engine/.test(last)) return { content: [text("## Primary request\n- keep going\n## Next step\n- answer")], stopReason: "end", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, model: req.model };
    if (size(req) > tooLongAbove) throw new ProviderError("Scripted API error 400: prompt is too long: 300000 tokens > 200000 maximum", { status: 400, transient: false, code: "context_length" });
    req.onText?.("answered");
    return { content: [text("answered")], stopReason: "end", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, model: req.model };
  },
};
registerProvider(scripted);

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const t = await res.text();
  let json: any = null; try { json = JSON.parse(t); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const settle = (botId: string) => until(async () => !botQueue.unfinished().some((r) => r.bot_id === botId) && !(await call("GET", "/bots")).json.live[botId]?.running, "settle");
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
/** A conversation already long: pairs of a long message and a short answer. */
function fill(bot: Bot, pairs: number, chars: number) {
  const gen = bots.byId(bot.id)!.generation;
  for (let i = 0; i < pairs; i++) {
    history.append(bot.id, gen, { role: "user", content: [text(`${i} ${"w".repeat(chars)}`)] });
    history.append(bot.id, gen, { role: "assistant", content: [text(`reply ${i}`)] });
  }
}

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "w10c@example.com", password: "password-1", locale: "fr" })).status, 200);
});

test("past 80 % of the window, the turn summarises its older part (same prompt and tools, instruction last) and keeps the end", async () => {
  const bot = (await call("POST", "/bots", { name: "Long" })).json.bot as Bot;
  fill(bot, 10, 25_000);
  seen.length = 0;
  await call("POST", `/bots/${bot.id}/messages`, { text: "et maintenant ?" });
  await settle(bot.id);
  const summaryReq = seen.find((r) => /compaction engine/.test(JSON.stringify(r.messages[r.messages.length - 1])));
  assert.ok(summaryReq, "a summary was asked");
  const normal = seen.find((r) => r !== summaryReq)!;
  assert.equal(summaryReq!.system, normal.system, "same system prompt (prefix cache)");
  assert.deepEqual(summaryReq!.tools.map((t) => t.name), normal.tools.map((t) => t.name), "same tools");
  for (const s of ["## Primary request", "## Files", "## Errors", "## Pending", "## Current work", "## Next step", "## Critical context"]) assert.ok(JSON.stringify(summaryReq!.messages).includes(s), s);
  const gen = bots.byId(bot.id)!.generation;
  const h = history.load(bot.id, gen);
  assert.match(JSON.stringify(h[0]), /<compacted-summary>/);
  assert.ok(h.length < 10, `kept ${h.length}`);
  assert.match(JSON.stringify(h), /et maintenant/);
  assert.equal(normal.messages[0].content.some((b) => b.type === "text" && /compacted-summary/.test(b.text)), true, "the model got the checkpoint");
  assert.ok((await rowsOf(bot.id)).some((r) => r.body.kind === "notice" && /résumé ses premières étapes/.test(r.body.text)));
  assert.ok((await rowsOf(bot.id)).some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text === "answered"));
});

test("a 'too long' answer from the provider: compact, then the same model once more (no switch to a backup)", async () => {
  const bot = (await call("POST", "/bots", { name: "Trop" })).json.bot as Bot;
  fill(bot, 6, 20_000);
  seen.length = 0;
  tooLongAbove = 150_000;
  await call("POST", `/bots/${bot.id}/messages`, { text: "continue" });
  await settle(bot.id);
  tooLongAbove = Infinity;
  const rows = await rowsOf(bot.id);
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text === "answered"), JSON.stringify(rows.map((r) => r.body).slice(-4)));
  assert.ok(!rows.some((r) => r.body.kind === "notice" && /backup|secours/.test(r.body.text)));
  assert.ok(seen.some((r) => /compaction engine/.test(JSON.stringify(r.messages[r.messages.length - 1]))));
});
