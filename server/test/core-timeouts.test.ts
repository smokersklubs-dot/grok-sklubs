import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Cœur, point 1 (audits Hermes § 3.7, OpenClaw flux 3) : un appel au modèle qui se tait ne doit plus tenir le tour ni la
// file du bot. Un faux fournisseur « compatible OpenAI » en HTTP réel : il accepte la connexion puis ne répond jamais
// (plafond de connexion), ou envoie un morceau puis se tait (délai d'inactivité), ou répond bien.
type Mode = "ok" | "never" | "stall";
let mode: Mode = "ok";
const seen: Mode[] = [];
const sse = (text: string) => `data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\n\n`;
const stub = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    seen.push(mode);
    if (mode === "never") return; // the connection stays open, nothing ever comes back
    res.writeHead(200, { "content-type": "text/event-stream" });
    if (mode === "stall") { res.write(sse("Je commence")); return; } // one piece, then silence
    res.write(sse("Bonjour, tout va bien."));
    res.end(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 1, completion_tokens: 1 } })}\n\ndata: [DONE]\n\n`);
  });
});
await new Promise<void>((r) => stub.listen(0, "127.0.0.1", r));
after(() => { stub.closeAllConnections(); stub.close(); });

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-core-timeouts-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.OPENAI_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}/v1`;
process.env.OPENAI_API_KEY = "stub-key";
process.env.OPENAI_MODELS = "stub-1";
process.env.DEFAULT_MODEL = "openai:stub-1";
process.env.MODEL_CONNECT_TIMEOUT_SEC = "0.4";
process.env.MODEL_IDLE_TIMEOUT_SEC = "0.4";
process.env.RETRY_BASE_MS = "20";
process.env.FIRST_REPLY_RESCUE_SEC = "0";
process.env.STALL_NOTICE_MIN = "0";
delete process.env.FALLBACK_MODELS;
delete process.env.FALLBACK_MODEL;
delete process.env.MAX_BOTS;
// The Anthropic SDK reads its address from ANTHROPIC_BASE_URL: the same stub plays a silent Anthropic.
process.env.ANTHROPIC_API_KEY = "stub-key";
process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(stub.address() as AddressInfo).port}`;
delete process.env.XAI_API_KEY;

const { api } = await import("../src/routes.js");
const { config } = await import("../src/config.js");
const { isBusy } = await import("../src/agent/loop.js");
const { isTransient } = await import("../src/agent/reliability.js");
const { classifyFailure, setFailureTiming, resetFailureState } = await import("../src/agent/failures.js");
const { resolveModel, ProviderError } = await import("../src/llm/index.js");
import type { Bot, Row } from "../src/shared.js";

// The failure coordinator's own new tries come quickly here.
setFailureTiming({ retryBaseMs: 30, retryMaxMs: 60, breakerOpenMs: 60_000 });
after(() => resetFailureState());

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
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const replies = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant").map((r) => (r.body as { text: string }).text);

let bot: Bot;
test("setup: a bot on the stub provider, with small timeouts from the environment", async () => {
  await call("POST", "/auth/signup", { email: "timeouts@example.com", password: "password-1", locale: "fr" });
  bot = (await call("POST", "/bots", { name: "Tim" })).json.bot;
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { model: "openai:stub-1", fallbackModels: [] })).status, 200);
  assert.equal(config.modelConnectTimeoutMs, 400);
  assert.equal(config.modelIdleTimeoutMs, 400);
});

test("point 1: a provider that accepts the connection and never answers is cut at the connection ceiling, as a passing error", async () => {
  mode = "never";
  const { provider, model } = resolveModel("openai:stub-1");
  const started = Date.now();
  const err = await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }).then(() => null, (e) => e);
  assert.ok(err instanceof ProviderError, `a ProviderError, got ${err}`);
  assert.ok(Date.now() - started < 3000, "cut close to the ceiling, not left hanging");
  assert.equal(isTransient(err), true, "worth another try (reliability.ts)");
  assert.equal(err.code, "timeout");
  assert.equal(classifyFailure({ err }).cls, "timeout", "the failure coordinator files it under « timeout »");
});

test("point 1: a stream that goes silent after its first piece is cut by the idle timeout", async () => {
  mode = "stall";
  const { provider, model } = resolveModel("openai:stub-1");
  let got = "";
  const started = Date.now();
  const err = await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], onText: (d) => { got += d; } }).then(() => null, (e) => e);
  assert.equal(got, "Je commence", "the first piece did arrive");
  assert.ok(err instanceof ProviderError && err.transient && err.code === "timeout", String(err));
  assert.match(err.message, /sent nothing for/);
  assert.ok(Date.now() - started < 3000);
});

test("point 1: the Anthropic provider is cut the same way (its SDK gets our abort signal)", async () => {
  mode = "never";
  const { provider } = resolveModel("anthropic:claude-haiku-5-5");
  assert.equal(provider.id, "anthropic");
  const started = Date.now();
  const err = await provider.runTurn({ model: "claude-haiku-5-5", system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }] }).then(() => null, (e) => e);
  assert.ok(err instanceof ProviderError && err.transient && err.code === "timeout", String(err));
  assert.ok(Date.now() - started < 3000);
});

test("point 1: the user's own stop is still a stop, never dressed up as a timeout", async () => {
  mode = "never";
  const { provider, model } = resolveModel("openai:stub-1");
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(), 60);
  const err = await provider.runTurn({ model, system: "s", tools: [], effort: "low", messages: [{ role: "user", content: [{ type: "text", text: "hello" }] }], signal: ctl.signal }).then(() => null, (e) => e);
  assert.ok(err && !(err instanceof ProviderError), "the abort passes through as it is");
});

test("point 1: in a turn, a silent call is tried again with backoff and the answer of the next try is shown", async () => {
  mode = "stall";
  const from = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "premier message" });
  await until(() => seen.length >= from + 2, "a second try after the timeout");
  mode = "ok";
  await until(async () => (await replies(bot.id)).includes("Bonjour, tout va bien."), "the reply of the try that worked");
  await until(() => !isBusy(bot.id), "queue released");
  // The piece the silent try had started to write is taken back: no half reply is left in the chat.
  assert.equal((await replies(bot.id)).filter((t) => t.startsWith("Je commence")).length, 0);
});

test("point 1: a provider that stays silent ends the turn with the failure card, and the bot's queue is released", async () => {
  mode = "never";
  await call("POST", `/bots/${bot.id}/messages`, { text: "deuxième message" });
  const card = await until(async () => (await rowsOf(bot.id)).find((r) => r.body.kind === "card" && r.body.card.type === "failure"), "the failure card", 1500);
  assert.equal(card.body.kind === "card" && card.body.card.type === "failure" && card.body.card.cls, "timeout");
  assert.ok(card.body.kind === "card" && card.body.card.type === "failure" && card.body.card.remedies.length > 0, "never a dead end");
  // The coordinator's own new tries end too; then nothing of this bot is left running or queued.
  mode = "ok";
  await until(() => !isBusy(bot.id), "queue released", 1500);
  const before = (await replies(bot.id)).length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "troisième message" });
  await until(async () => (await replies(bot.id)).length > before, "the bot answers again");
});
