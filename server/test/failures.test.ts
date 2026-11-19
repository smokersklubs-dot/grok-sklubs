import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// « Coordinateur d'échecs » (agent/failures.ts): classification of the error texts the server really meets, the decision
// per class (bounded retries, never after an uncertain action, backup model, reconnect card, teammate), dedupe, the
// circuit breaker, isolation between accounts, and every card having a way out.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-fail-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
delete process.env.MAX_BOTS;
delete process.env.FALLBACK_MODELS;

const { registerProvider } = await import("../src/llm/index.js");
const { ProviderError } = await import("../src/llm/types.js");
const { api } = await import("../src/routes.js");
const { setEngineHost, EngineTimeout } = await import("../src/agent/engine.js");
const f = await import("../src/agent/failures.js");
const { bots, botQueue } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const { todayReport } = await import("../src/today.js");
import type { LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, FailureClass, Row } from "../src/shared.js";

f.setFailureTiming({ retryBaseMs: 40, retryMaxMs: 80, breakerOpenMs: 60_000 });
const pushes: { userId: string; tag?: string; body: string }[] = [];
f.setFailurePush((userId, msg) => pushes.push({ userId, tag: msg.tag, body: msg.body }));

// ── Scripted models: `fail` decides, per model, whether a call throws ──────────
type Fail = (model: string, req: TurnRequest) => Error | null;
let fail: Fail = () => null;
const calls: string[] = [];
const provider = (id: string, models: string[]): LlmProvider => ({
  id, label: id, models, available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    calls.push(`${id}:${req.model}`);
    const e = fail(`${id}:${req.model}`, req);
    if (e) throw e;
    const text = `ok from ${id}:${req.model}`;
    req.onText?.(text);
    return { content: [{ type: "text", text }], stopReason: "end", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 }, model: req.model };
  },
});
registerProvider(provider("script", ["script-1", "script-2"]));
registerProvider(provider("alt", ["alt-1"]));

const jars: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (who: string, botId: string): Promise<Row[]> => (await call(who, "GET", `/bots/${botId}/rows?limit=500`)).json.rows;
type FailureCard = Extract<Card, { type: "failure" }>;
const failureCards = async (who: string, botId: string) => (await rowsOf(who, botId)).flatMap((r) => (r.body.kind === "card" && r.body.card.type === "failure" ? [r.body.card as FailureCard] : []));
const idle = (botId: string) => !botQueue.unfinished().some((r) => r.bot_id === botId);
const settle = async (who: string, botId: string) => {
  await until(async () => idle(botId) && !(await call(who, "GET", "/bots")).json.live[botId]?.running, "the bot to settle");
  await new Promise((r) => setTimeout(r, 50));
  await until(async () => idle(botId) && !(await call(who, "GET", "/bots")).json.live[botId]?.running, "the bot to settle (again)");
};
/** Every failure card ever made in this file: each must offer a way out. */
const allCards = () => q.all<{ body: string }>("SELECT body FROM rows WHERE kind = 'card' AND json_extract(body, '$.card.type') = 'failure'").map((r) => JSON.parse(r.body).card as FailureCard);

let a: Bot, b: Bot, mate: Bot, other: Bot;
let userA = "", userB = "";
after(() => { setEngineHost(null); f.resetFailureState(); });

test("setup: two accounts", async () => {
  assert.equal((await call("A", "POST", "/auth/signup", { email: "fail-a@example.com", password: "password-1", locale: "fr" })).status, 200);
  assert.equal((await call("B", "POST", "/auth/signup", { email: "fail-b@example.com", password: "password-1", locale: "en" })).status, 200);
  a = (await call("A", "POST", "/bots", { name: "Alma" })).json.bot;
  other = (await call("B", "POST", "/bots", { name: "Boris" })).json.bot;
  userA = bots.byId(a.id)!.userId;
  userB = bots.byId(other.id)!.userId;
  assert.notEqual(userA, userB);
});

// ── 1. Classification ──────────────────────────────────────────────────────────
test("classification of the error texts the server really meets", () => {
  const cases: [Parameters<typeof f.classifyFailure>[0], FailureClass][] = [
    // llm/anthropic.ts and llm/openai-compat.ts
    [{ err: new ProviderError("Anthropic rejected the credentials. Check ANTHROPIC_API_KEY.", { status: 401, transient: false }) }, "auth_expired"],
    [{ err: new ProviderError("Anthropic rate limit reached.", { status: 429, transient: true }) }, "rate_limited"],
    [{ err: new ProviderError("OpenAI API error 503: Service Unavailable", { status: 503, transient: true }) }, "provider_down"],
    [{ err: new ProviderError("Anthropic API error 529: Overloaded", { status: 529, transient: true }) }, "provider_down"],
    [{ err: new ProviderError("Anthropic could not be reached: Connection error.", { transient: true }) }, "provider_down"],
    [{ err: new ProviderError("Anthropic: the request is too long for the model (prompt is too long: 210000 tokens > 200000 maximum)", { status: 400, transient: false, code: "context_length" }) }, "bad_input"],
    [{ err: new ProviderError("OpenRouter : plus de crédits.", { status: 402, transient: false, code: "out_of_credit" }) }, "out_of_budget"],
    [{ text: "Anthropic API error 400: Your credit balance is too low to access the Anthropic API." }, "out_of_budget"],
    [{ text: "OpenAI API error 429: insufficient_quota — You exceeded your current quota, please check your plan and billing details." }, "out_of_budget"],
    [{ text: "OpenAI API error 400: invalid_request_error: messages.3.content is not valid" }, "bad_input"],
    // Claude Code CLI (result events, stderr)
    [{ text: "Invalid API key · Please run /login" }, "auth_expired"],
    [{ text: "OAuth token refresh failed: refresh token expired, please run /login" }, "auth_expired"],
    [{ text: "OAuth token has expired. Please obtain a new token or refresh your existing token." }, "auth_expired"],
    [{ text: "API Error: 500 {\"type\":\"error\",\"error\":{\"type\":\"api_error\",\"message\":\"Internal server error\"}}" }, "provider_down"],
    [{ text: "API Error: 529 {\"type\":\"error\",\"error\":{\"type\":\"overloaded_error\",\"message\":\"Overloaded\"}}" }, "provider_down"],
    [{ text: "API Error: Request timed out." }, "timeout"],
    [{ text: "You've hit your session limit · resets 3pm (Europe/Paris)" }, "subscription_limit"],
    [{ text: "Ton abonnement Claude a atteint sa limite d'utilisation pour l'instant. Je pourrai continuer dès qu'elle se réinitialise." }, "subscription_limit"],
    [{ text: "Je ne suis pas encore connecté à Claude sur mon ordinateur. Ouvre mes réglages → Cerveau → Se connecter, puis connecte-toi sur mon écran." }, "auth_expired"],
    // Codex CLI
    [{ text: "Your access token could not be refreshed because your refresh token was already used. Please log out and sign in again." }, "auth_expired"],
    [{ text: "unexpected status 401 Unauthorized: Missing bearer or basic authentication in header" }, "auth_expired"],
    [{ text: "You've hit your usage limit. Upgrade to Pro (https://openai.com/chatgpt/pricing) or try again in 2 hours 5 minutes." }, "subscription_limit"],
    [{ text: "stream disconnected before completion: error sending request for url (https://chatgpt.com/backend-api/codex/responses)" }, "provider_down"],
    [{ text: "exceeded retry limit, last status: 429 Too Many Requests" }, "rate_limited"],
    // The bot's computer, the turn's own limits
    [{ text: "Error response from daemon: No such container: sklubot-bot_123" }, "computer_down"],
    [{ text: "Error response from daemon: container 4f2a is not running" }, "computer_down"],
    [{ err: Object.assign(new Error("All computers are busy"), { name: "ComputersBusyError" }) }, "computer_down"],
    [{ err: new EngineTimeout(30 * 60_000) }, "timeout"],
    [{ text: "boom", status: 504 }, "timeout"],
    [{ err: Object.assign(new Error("fetch failed"), { cause: { code: "ETIMEDOUT" } }) }, "timeout"],
    [{ err: Object.assign(new Error("fetch failed"), { cause: { code: "ECONNRESET" } }) }, "provider_down"],
    [{ loopStop: { kind: "fail", tool: "browser_click", count: 5 } }, "tool_error"],
    [{ loopStop: { kind: "same", tool: "screenshot", count: 6 } }, "loop_detected"],
    [{ text: "something odd happened" }, "unknown"],
  ];
  for (const [input, cls] of cases) assert.equal(f.classifyFailure(input).cls, cls, JSON.stringify(input.text ?? (input.err as Error)?.message ?? input.loopStop));
  assert.equal(f.classifyFailure({ loopStop: { kind: "fail", tool: "browser_click", count: 5 } }).tool, "browser_click");
});

// ── 2. Decisions ──────────────────────────────────────────────────────────────
test("retries only for passing problems, bounded, and never after an uncertain action", () => {
  for (const cls of ["provider_down", "rate_limited", "timeout"] as const) {
    assert.equal(f.decideFailure({ cls, retries: 0, uncertain: false }).auto, "retry");
    assert.equal(f.decideFailure({ cls, retries: f.MAX_AUTO_RETRIES - 1, uncertain: false }).auto, "retry");
    const out = f.decideFailure({ cls, retries: f.MAX_AUTO_RETRIES, uncertain: false });
    assert.equal(out.auto, null, "bounded");
    assert.equal(out.card, true);
    assert.equal(out.notify, true);
    const unsure = f.decideFailure({ cls, retries: 0, uncertain: true });
    assert.equal(unsure.auto, null, "never again after an action that may have gone through");
    assert.ok(unsure.remedies.includes("retry"), "the owner may still retry");
  }
  for (const cls of ["auth_expired", "out_of_budget", "tool_error", "computer_down", "loop_detected", "bad_input", "unknown"] as const)
    assert.notEqual(f.decideFailure({ cls, retries: 0, uncertain: false }).auto, "retry", cls);
  const d = f.decideFailure({ cls: "timeout", retries: 1, uncertain: false, rand: 0.5 });
  assert.ok(d.delayMs! > 0 && d.delayMs! <= 80, "backoff within the bounds");
  assert.equal(f.decideFailure({ cls: "provider_down", retries: 0, uncertain: false, breakerOpen: true }).auto, "provider_wait");
  assert.equal(f.decideFailure({ cls: "subscription_limit", retries: 0, uncertain: false }).auto, "wait");
});

test("decisions: backup model, reconnect, teammate, and always a remedy", () => {
  assert.equal(f.decideFailure({ cls: "provider_down", retries: 5, uncertain: false, fallback: "script:script-2" }).auto, "fallback");
  const auth = f.decideFailure({ cls: "auth_expired", retries: 0, uncertain: false, engine: "codex" });
  assert.equal(auth.remedies[0], "reconnect");
  assert.equal(auth.card && auth.notify, true);
  assert.equal(f.decideFailure({ cls: "auth_expired", retries: 0, uncertain: false }).remedies[0], "connect_account");
  assert.equal(f.decideFailure({ cls: "out_of_budget", retries: 0, uncertain: false }).remedies[0], "connect_account");
  assert.equal(f.decideFailure({ cls: "computer_down", retries: 0, uncertain: false }).remedies[0], "restart_computer");
  assert.deepEqual(f.decideFailure({ cls: "tool_error", retries: 0, uncertain: false }).remedies, ["retry", "continue_without"]);
  const hand = f.decideFailure({ cls: "auth_expired", retries: 0, uncertain: false, teammate: { id: "bot_x", name: "Xa" } });
  assert.equal(hand.auto, "handoff");
  assert.equal(hand.notify, false, "handled: no push");
  assert.notEqual(f.decideFailure({ cls: "tool_error", retries: 0, uncertain: false, teammate: { id: "bot_x", name: "Xa" } }).auto, "handoff", "a failed step is not the brain's fault");
  const unblocking = new Set(["retry", "continue_without", "reconnect", "connect_account", "restart_computer", "switch_model", "handoff"]);
  for (const cls of ["provider_down", "rate_limited", "subscription_limit", "auth_expired", "out_of_budget", "tool_error", "computer_down", "timeout", "loop_detected", "bad_input", "unknown"] as const)
    for (const retries of [0, 5]) for (const uncertain of [false, true]) for (const engine of [null, "claude-code"] as const) {
      const out = f.decideFailure({ cls, retries, uncertain, engine });
      assert.ok(out.remedies.length > 0 && out.remedies.some((r) => unblocking.has(r)), `${cls} has a way out`);
    }
});

// ── 3. The coordinator on real turns ────────────────────────────────────────────
test("a passing provider failure is retried automatically and the incident is settled without the owner", async () => {
  f.resetFailureState();
  let n = 0;
  fail = (m) => (m === "script:script-1" && n++ < 2 ? new ProviderError("OpenAI API error 503: Service Unavailable", { status: 503, transient: false }) : null);
  await call("A", "POST", `/bots/${a.id}/messages`, { text: "Résume mes mails du jour" });
  await until(async () => (await failureCards("A", a.id)).some((c) => c.status === "resolved"), "the retried work to go through");
  await settle("A", a.id);
  const [card] = await failureCards("A", a.id);
  assert.equal(card.cls, "provider_down");
  assert.equal(card.status, "resolved");
  const [log] = (await call("A", "GET", `/bots/${a.id}/failures`)).json.failures;
  assert.equal(log.resolvedBy, "auto");
  assert.equal(log.count, 2, "the second failure updated the same incident");
  assert.deepEqual(log.tried.map((t: any) => [t.action, t.ok]), [["retry", false], ["retry", true]]);
  assert.equal(pushes.filter((p) => p.userId === userA).length, 0, "nothing to tell the owner");
  assert.ok((await rowsOf("A", a.id)).some((r) => r.body.kind === "message" && r.body.role === "assistant" && /ok from script/.test(r.body.text)));
});

test("retries stop after the bound: one card asks the owner, with one push", async () => {
  f.resetFailureState();
  fail = (m) => (m === "script:script-1" ? new ProviderError("Anthropic rate limit reached.", { status: 429, transient: false }) : null);
  await call("A", "POST", `/bots/${a.id}/messages`, { text: "Encore" });
  await until(async () => (await failureCards("A", a.id)).some((c) => c.cls === "rate_limited" && c.status === "pending"), "the card to ask");
  await settle("A", a.id);
  const card = (await failureCards("A", a.id)).find((c) => c.cls === "rate_limited")!;
  assert.equal(card.count, 1 + f.MAX_AUTO_RETRIES);
  assert.equal(card.tried.filter((t) => t.action === "retry").length, f.MAX_AUTO_RETRIES);
  assert.ok(card.remedies.includes("retry"));
  assert.equal(pushes.filter((p) => p.userId === userA && p.tag === `failure-${card.failureId}`).length, 1);
  // « Réessayer » from the card: the work goes on and the card settles.
  fail = () => null;
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${card.failureId}`, { action: "retry" })).status, 200);
  await until(async () => (await failureCards("A", a.id)).find((c) => c.failureId === card.failureId)?.status === "resolved", "retry by hand");
  const log = (await call("A", "GET", `/bots/${a.id}/failures`)).json.failures.find((x: any) => x.id === card.failureId);
  assert.equal(log.resolvedBy, "user");
  // A settled incident takes no more buttons.
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${card.failureId}`, { action: "retry" })).status, 409);
});

test("no automatic retry after an action whose outcome is unknown", async () => {
  f.resetFailureState();
  const bot = bots.byId(a.id)!;
  const since = Date.now();
  q.run("INSERT INTO executions (id, bot_id, user_id, tool, label, detail, action_hash, grant_by, quote, status, generation, thread, started_at) VALUES ('exe_unsure', ?, ?, 'bot_email_send', 'Send', '', 'h', '', '', 'uncertain', ?, 0, ?)", bot.id, bot.userId, bot.generation, since + 1);
  const out = f.handleFailure({ bot, trigger: { kind: "user", text: "Envoie le mail" }, thread: 0, since, err: new ProviderError("OpenAI API error 502: Bad Gateway", { status: 502, transient: true }) })!;
  assert.equal(out.cls, "provider_down");
  assert.equal(out.decision.auto, null);
  const card = (await failureCards("A", a.id)).find((c) => c.failureId === out.id)!;
  assert.equal(card.status, "pending");
  assert.equal(card.tried.length, 0);
  // A subscription turn that already did something is never run again on its own either.
  assert.equal(f.handleFailure({ bot, trigger: { kind: "user", text: "x" }, thread: 0, since: Date.now() + 10_000, text: "API Error: Request timed out.", didSomething: true })!.decision.auto, null);
  q.run("DELETE FROM executions WHERE id = 'exe_unsure'");
  await f.actOnFailure(bot, out.id, "dismiss");
});

test("the bot's backup model takes over: logged as fixed automatically, no card", async () => {
  f.resetFailureState();
  b = (await call("A", "POST", "/bots", { name: "Bea" })).json.bot;
  assert.equal((await call("A", "PATCH", `/bots/${b.id}`, { fallbackModels: ["script:script-2"] })).status, 200);
  fail = (m) => (m === "script:script-1" ? new ProviderError("Anthropic API error 529: Overloaded", { status: 529, transient: false }) : null);
  await call("A", "POST", `/bots/${b.id}/messages`, { text: "Fais le point" });
  await settle("A", b.id);
  assert.equal((await failureCards("A", b.id)).length, 0);
  const [log] = (await call("A", "GET", `/bots/${b.id}/failures`)).json.failures;
  assert.equal(log.cls, "provider_down");
  assert.equal(log.status, "resolved");
  assert.equal(log.resolvedBy, "auto");
  assert.deepEqual(log.tried.map((t: any) => [t.action, t.note]), [["fallback", "script:script-2"]]);
  assert.ok((await rowsOf("A", b.id)).some((r) => r.body.kind === "message" && /ok from script:script-2/.test(r.body.text)));
  await call("A", "DELETE", `/bots/${b.id}`);
});

test("a subscription bot signed out gets ONE card with « Reconnecter mon compte »", async () => {
  f.resetFailureState();
  setEngineHost({
    ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {}, hold: () => () => {},
    async exec(_b, _args, _env, _cwd, _input, _signal, onLine) {
      onLine(JSON.stringify({ type: "result", is_error: true, result: "Invalid API key · Please run /login", usage: {} }));
      return { code: 1, stderr: "" };
    },
  });
  const sub = (await call("A", "POST", "/bots", { name: "Sub" })).json.bot as Bot;
  assert.equal((await call("A", "PATCH", `/bots/${sub.id}`, { model: "claude-code:sonnet" })).status, 200);
  assert.equal((await call("A", "PUT", "/reliability", { mutualAid: false })).status, 200);
  for (const text of ["Bonjour", "Tu es là ?"]) { await call("A", "POST", `/bots/${sub.id}/messages`, { text }); await settle("A", sub.id); }
  const cards = await failureCards("A", sub.id);
  assert.equal(cards.length, 1, "the same failure within 10 minutes: one card");
  assert.equal(cards[0].cls, "auth_expired");
  assert.equal(cards[0].engine, "claude-code");
  assert.equal(cards[0].remedies[0], "reconnect");
  assert.equal(cards[0].count, 2);
  assert.equal(cards[0].status, "pending");
  // « Reconnecter » starts the engine's own sign-in (no computer in this test: the server says so, nothing breaks).
  const r = await call("A", "POST", `/bots/${sub.id}/failures/${cards[0].failureId}`, { action: "reconnect" });
  assert.ok(r.status === 200 || r.status === 502, String(r.status));
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${cards[0].failureId}`, { action: "reconnect" })).status, 409, "an API bot has no subscription to reconnect");
  setEngineHost(null);
  assert.equal((await call("A", "PUT", "/reliability", { mutualAid: true })).status, 200);
  await call("A", "DELETE", `/bots/${sub.id}`);
});

test("« Entraide entre bots »: a teammate with a working brain takes the task over — only when it is on", async () => {
  f.resetFailureState();
  mate = (await call("A", "POST", "/bots", { name: "Mia" })).json.bot;
  assert.equal((await call("A", "PATCH", `/bots/${mate.id}`, { model: "alt:alt-1" })).status, 200);
  fail = (m) => (m === "script:script-1" ? new ProviderError("Anthropic rejected the credentials. Check ANTHROPIC_API_KEY.", { status: 401, transient: false }) : null);
  await call("A", "POST", `/bots/${a.id}/messages`, { text: "Prépare le devis pour Durand" });
  await settle("A", a.id);
  await settle("A", mate.id);
  const card = (await failureCards("A", a.id)).find((c) => c.cls === "auth_expired")!;
  assert.equal(card.status, "handed");
  assert.equal(card.teammate?.name, "Mia");
  const got = (await rowsOf("A", mate.id)).find((r) => r.body.kind === "message" && r.body.origin?.kind === "bot" && r.body.origin.id === a.id);
  assert.ok(got, "the teammate got the task");
  assert.match((got!.body as any).text, /Prépare le devis pour Durand/);
  assert.ok(calls.includes("alt:alt-1"), "and did it with its own brain");
  await f.actOnFailure(bots.byId(a.id)!, card.failureId, "dismiss").catch(() => {});
  // Off: no handoff, the owner decides (and the card offers no teammate).
  assert.equal((await call("A", "PUT", "/reliability", { mutualAid: false })).status, 200);
  assert.equal((await call("A", "GET", "/reliability")).json.mutualAid, false);
  f.resetFailureState();
  q.run("UPDATE bot_failures SET status = 'resolved' WHERE bot_id = ?", a.id);
  await call("A", "POST", `/bots/${a.id}/messages`, { text: "Et la facture ?" });
  await settle("A", a.id);
  const off = (await failureCards("A", a.id)).filter((c) => c.cls === "auth_expired").at(-1)!;
  assert.equal(off.status, "pending");
  assert.ok(!off.remedies.includes("handoff"));
  assert.equal(off.remedies[0], "connect_account");
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${off.failureId}`, { action: "handoff" })).status, 409);
  assert.equal((await call("A", "PUT", "/reliability", { mutualAid: true })).status, 200);
  await f.actOnFailure(bots.byId(a.id)!, off.failureId, "dismiss");
  fail = () => null;
});

test("dedupe: the same failure of the same bot within 10 minutes is one card with a counter", async () => {
  f.resetFailureState();
  const bot = bots.byId(a.id)!;
  const before = (await failureCards("A", a.id)).length;
  const one = f.handleFailure({ bot, trigger: { kind: "user", text: "x" }, thread: 0, since: Date.now(), text: "OpenAI API error 400: invalid_request_error: bad image" })!;
  const two = f.handleFailure({ bot, trigger: { kind: "user", text: "x" }, thread: 0, since: Date.now(), text: "OpenAI API error 400: invalid_request_error: bad image" })!;
  const three = f.handleFailure({ bot, trigger: { kind: "user", text: "x" }, thread: 0, since: Date.now(), loopStop: { kind: "fail", tool: "browser_click", count: 5 } })!;
  assert.equal(one.id, two.id);
  assert.notEqual(three.id, one.id, "another class is another incident");
  const cards = await failureCards("A", a.id);
  assert.equal(cards.length, before + 2);
  assert.equal(cards.find((c) => c.failureId === one.id)!.count, 2);
  const tool = cards.find((c) => c.failureId === three.id)!;
  assert.equal(tool.tool, "browser_click");
  assert.deepEqual(tool.remedies, ["retry", "continue_without"]);
  assert.equal(pushes.filter((p) => p.tag === `failure-${one.id}`).length, 1, "one push for the incident, not one per failure");
  await f.actOnFailure(bot, one.id, "dismiss");
  // « Continuer sans » sends the work on without that step.
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${three.id}`, { action: "continue_without" })).status, 200);
  await settle("A", a.id);
  assert.equal((await failureCards("A", a.id)).find((c) => c.failureId === three.id)!.status, "resolved");
});

test("circuit breaker: a provider failing for many bots gives one notice per account, not one card per bot", async () => {
  f.resetFailureState();
  pushes.length = 0;
  const extra = [(await call("A", "POST", "/bots", { name: "C1" })).json.bot as Bot, (await call("A", "POST", "/bots", { name: "C2" })).json.bot as Bot];
  const err = () => new ProviderError("OpenAI API error 503: Service Unavailable", { status: 503, transient: true });
  const ctx = (id: string) => ({ bot: bots.byId(id)!, trigger: { kind: "routine", name: "r", text: "t" } as const, thread: 0, since: Date.now(), err: err(), provider: "flaky" });
  const first = f.handleFailure(ctx(extra[0].id))!;
  const second = f.handleFailure(ctx(other.id))!; // another account, same provider
  const third = f.handleFailure(ctx(extra[1].id))!;
  const fourth = f.handleFailure(ctx(a.id))!;
  assert.equal(first.decision.auto, "retry");
  assert.equal(second.decision.auto, "retry");
  assert.equal(f.breakerOpen("flaky"), true);
  for (const o of [third, fourth]) { assert.equal(o.decision.auto, "provider_wait"); assert.equal(o.card, false); }
  assert.equal(pushes.filter((p) => p.tag === "outage-flaky" && p.userId === userA).length, 1, "one notice for the account");
  assert.equal(pushes.filter((p) => p.tag === "outage-flaky" && p.userId === userB).length, 0, "account B's bot was not under the open breaker");
  const day = todayReport(userA);
  const outage = day.failures!.outages.find((o) => o.provider === "flaky")!;
  assert.ok(outage.bots >= 2);
  assert.equal(todayReport(userB).failures!.outages.some((o) => o.provider === "flaky" && o.bots > 1), false);
  // « Réessayer maintenant »: the account's waiting bots go again (only its own).
  const r = await call("A", "POST", "/failures/outages/retry", { provider: "flaky" });
  assert.equal(r.json.retried, 2);
  for (const x of [...extra, a]) await settle("A", x.id);
  await settle("B", other.id);
  for (const x of extra) await call("A", "DELETE", `/bots/${x.id}`);
  f.resetFailureState();
});

test("isolation: an account never sees or acts on another's incidents", async () => {
  const mine = (await call("A", "GET", `/bots/${a.id}/failures`)).json.failures;
  assert.ok(mine.length > 0);
  assert.equal((await call("B", "GET", `/bots/${a.id}/failures`)).status, 404);
  assert.equal((await call("B", "POST", `/bots/${a.id}/failures/${mine[0].id}`, { action: "retry" })).status, 404);
  // Through its own bot, B still cannot reach A's incident.
  assert.equal((await call("B", "POST", `/bots/${other.id}/failures/${mine[0].id}`, { action: "dismiss" })).status, 409);
  const theirs = (await call("B", "GET", `/bots/${other.id}/failures`)).json.failures;
  assert.ok(theirs.every((x: any) => x.botId === other.id));
  // A teammate is always a bot of the same account.
  const t = f.findTeammate(bots.byId(other.id)!);
  assert.ok(!t || t.userId === userB);
  assert.equal((await call("A", "POST", `/bots/${a.id}/failures/${mine[0].id}`, { action: "explode" })).status, 400);
});

test("Aujourd'hui: the day's summary and the cards that wait", async () => {
  const bot = bots.byId(a.id)!;
  const o = f.handleFailure({ bot, trigger: { kind: "user", text: "x" }, thread: 0, since: Date.now(), text: "Error response from daemon: No such container: sklubot-x" })!;
  const day = todayReport(userA);
  assert.ok(day.failures!.autoFixed >= 2, "fixed automatically today");
  assert.ok(day.failures!.waiting >= 1);
  const need = day.needs.find((n) => n.kind === "failure")!;
  assert.equal(need.title, "L'ordinateur ne marche pas");
  assert.equal(need.botId, a.id);
  const card = (await failureCards("A", a.id)).find((c) => c.failureId === o.id)!;
  assert.equal(card.remedies[0], "restart_computer");
  await f.actOnFailure(bot, o.id, "dismiss");
});

test("every failure card made in this file has a way out", () => {
  const cards = allCards();
  assert.ok(cards.length >= 6);
  for (const c of cards) assert.ok(c.remedies.length > 0, `${c.cls} card has remedies`);
});

test("model, desktop and recovery evidence belong to the same owner's bot and provider", async () => {
  const bot = bots.byId(a.id)!;
  assert.equal((await call("B", "GET", `/bots/${a.id}/work-context`)).status, 404);
  const context = await call("A", "GET", `/bots/${a.id}/work-context`);
  assert.equal(context.status, 200);
  assert.equal(context.json.target, (await import("../src/computer.js")).computerKind());
  const report = { bot, trigger: { kind: "user" as const, text: "images" }, thread: 0, since: Date.now(), provider: "codex", didSomething: true };
  const size = f.handleFailure({ ...report, text: "unexpected status 413 Payload Too Large" })!;
  const incident = f.failures.byId(size.id)!;
  const quota = f.handleFailure({ ...report, existingRemedy: true, text: "429 Too Many Requests" })!;
  f.noteTurnOk(bot, "claude-code:sonnet", 0);
  assert.equal(f.failures.byId(quota.id)?.status, "waiting");
  assert.equal(f.confirmTransportRecovery(bot, size.id, incident.last_at, "codex", 20*1024*1024), false);
  assert.equal(f.confirmTransportRecovery(bot, size.id, incident.last_at - 1, "codex", 26*1024*1024), false);
  assert.equal(f.confirmTransportRecovery(bot, size.id, incident.last_at, "codex", 26*1024*1024), true);
  assert.equal(f.failures.byId(size.id)?.status, "resolved");
  assert.equal(f.failures.byId(quota.id)?.status, "waiting");
});
