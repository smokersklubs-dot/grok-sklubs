import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// « Qui répond » in group chats (agent/roomrouting.ts): in "auto" a mention still wins; an un-mentioned message goes to
// the member a free first pass (name, role words) or a small fast decision model picks; a timeout, an unsure answer or no
// model falls back to the lead; "none" wakes nobody; the decision's cost is written to usage; a subscription engine is
// never used to decide; strangers, hidden helpers, someone else's bots and paused bots are never chosen. Plus the room's
// settings (discreet, offer before starting with a yes by reply or reaction), « Plutôt demander à… » and room_handoff.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-routing-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.AUX_MODEL = "router:fast-1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const { config } = await import("../src/config.js");
const { bots } = await import("../src/store.js");
const { q } = await import("../src/db.js");
const routing = await import("../src/agent/roomrouting.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row, RouteNoticeAction } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

// The bots' own model: records "Name: what it was told", and acts on a few words of it.
const asked: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const who = /You are (\w+)/.exec(req.system)?.[1] ?? "?";
    const say = (text: string): TurnResult => ({ content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage });
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    if (last.content.some((b) => b.type === "tool_result")) return say("ok");
    asked.push(`${who}: ${said}`);
    if (/do NOT start it yet/.test(said)) return use("room_post", { room: "Crew", text: `${who}: I can take this${/TVA/.test(said) ? " (TVA)" : ""}.` });
    if (/hand over to Zoe/.test(said) && who !== "Zoe") return use("room_handoff", { room: "Crew", to: "Zoe", message: "the support side is yours" });
    return use("stay_quiet", { reason: "test" });
  },
});

// The quick decision model. `mode` says how it answers; every call is counted and its prompt kept.
let mode: { pick?: number; confidence?: number; also?: number; task?: boolean; slowMs?: number; garbage?: boolean } = {};
const routerCalls: { system: string; prompt: string }[] = [];
registerProvider({
  id: "router", label: "Router", models: ["fast-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const prompt = req.messages[0].content.map((b) => (b.type === "text" ? b.text : "")).join("");
    routerCalls.push({ system: req.system, prompt });
    assert.ok(req.maxTokens! <= 200, "the decision is capped in tokens");
    assert.deepEqual(req.tools, []);
    if (mode.slowMs) await sleep(mode.slowMs); // ignores the abort on purpose: its cost must still be recorded
    const text = mode.garbage ? "I think Marc?" : JSON.stringify({ pick: mode.pick ?? 0, confidence: mode.confidence ?? 0.9, task: mode.task ?? false, also: mode.also ?? 0, reason: "best fit" });
    return { content: [{ type: "text", text }], stopReason: "end", model: "fast-1", usage: { inputTokens: 120, outputTokens: 12, cachedTokens: 0, costUsd: 0.00002 } };
  },
});

// A subscription engine that must never be asked to route.
const engineInputs: string[] = [];
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {}, hold: () => () => {},
  async exec(_bot, _args, _env, _cwd, input, _signal, onLine) {
    engineInputs.push(input);
    onLine(JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "engine" }] } }));
    onLine(JSON.stringify({ type: "result", usage: {} }));
    return { code: 0, stderr: "" };
  },
});
after(() => setEngineHost(null));

const jars: Record<string, string> = { a: "", b: "" };
async function call(method: string, url: string, body?: unknown, who: "a" | "b" = "a") {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const routeNotices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice" && r.body.action?.kind === "route");
const askedOf = (name: string) => asked.filter((a) => a.startsWith(`${name}: `));
const running = async (id: string) => !!(await call("GET", "/bots")).json.live[id]?.running;
const allIdle = async () => { for (let i = 0; i < 200; i++) { let busy = false; for (const b of [lea, marc, zoe]) if (await running(b.id)) busy = true; if (!busy) return; await sleep(25); } };
/** Posts in the room and waits until the routing step is over. */
async function post(text: string) {
  asked.length = 0;
  assert.equal((await call("POST", `/bots/${room}/messages`, { text })).status, 200);
  await routing.routingSettled();
}

let lea: Bot, marc: Bot, zoe: Bot, room = "";
test("setup: an owner with three member bots in an automatic group chat, and a stranger", async () => {
  await call("POST", "/auth/signup", { email: "owner@example.com", password: "password-1", locale: "en" });
  await call("POST", "/auth/signup", { email: "stranger@example.com", password: "password-1", locale: "en" }, "b");
  lea = (await call("POST", "/bots", { name: "Lea", label: "Compta", description: "Factures, TVA et notes de frais." })).json.bot;
  marc = (await call("POST", "/bots", { name: "Marc", label: "Marketing", description: "Réseaux sociaux et campagnes." })).json.bot;
  zoe = (await call("POST", "/bots", { name: "Zoe", label: "Support", description: "Répond aux clients." })).json.bot;
  room = (await call("POST", "/rooms", { name: "Crew", botIds: [lea.id, marc.id, zoe.id] })).json.id;
  assert.equal((await call("PATCH", `/bots/${room}`, { roomRule: "auto" })).status, 200);
  const got = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.id === room);
  assert.equal(got.roomRule, "auto");
  assert.deepEqual((await call("GET", `/bots/${room}/routing`)).json.routing, { discreet: false, askFirst: false });
});

test("a mention wins: no decision is made and only the bot named answers", async () => {
  const before = routerCalls.length;
  await post("@Marc can you look at the launch?");
  await until(() => askedOf("Marc").length, "Marc");
  await allIdle();
  assert.equal(routerCalls.length, before);
  assert.equal(askedOf("Lea").length + askedOf("Zoe").length, 0);
  assert.equal((await routeNotices(room)).length, 0);
});

test("the free first pass: a member's role in the message picks it, without the model", async () => {
  const before = routerCalls.length;
  await post("Question de compta : la facture de mars est-elle partie ?");
  await until(() => askedOf("Lea").length, "Lea");
  await allIdle();
  assert.equal(routerCalls.length, before);
  const n = (await routeNotices(room)).at(-1)!;
  const a = (n.body as { action: RouteNoticeAction }).action;
  assert.equal(a.botId, lea.id); assert.equal(a.by, "keywords"); assert.equal(a.status, "open");
  assert.match((n.body as { text: string }).text, /→ Lea \(Compta\) took the question/);
  assert.match(askedOf("Lea")[0], /You were picked to answer this message/);
});

test("auto routes to the bot the decision model picks; the decision's cost is written to usage", async () => {
  mode = { pick: 2, confidence: 0.9 };
  const before = routerCalls.length;
  await post("Someone should look into the newsletter numbers?");
  await until(() => askedOf("Marc").length, "Marc");
  await allIdle();
  assert.equal(routerCalls.length, before + 1);
  const last = routerCalls.at(-1)!;
  assert.match(last.system, new RegExp(routing.ROUTER_MARK.slice(0, 30)));
  assert.match(last.prompt, /1\. Lea — role: Compta/); assert.match(last.prompt, /2\. Marc — role: Marketing/);
  assert.equal(askedOf("Lea").length + askedOf("Zoe").length, 0);
  const a = ((await routeNotices(room)).at(-1)!.body as { action: RouteNoticeAction }).action;
  assert.equal(a.by, "model"); assert.equal(a.botId, marc.id);
  const u = q.all<{ bot_id: string; model: string; cost_usd: number }>("SELECT bot_id, model, cost_usd FROM usage WHERE model = 'fast-1'");
  assert.ok(u.length >= 1 && u.every((r) => r.bot_id === room), "billed to the group");
  assert.equal(u.at(-1)!.cost_usd, 0.00002);
});

test("a timeout falls back to the lead within ~1.5 s, and the late answer's cost is still recorded", async () => {
  mode = { pick: 3, confidence: 0.9, slowMs: 2200 };
  const t0 = Date.now();
  const costs = () => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM usage WHERE model = 'fast-1'")!.n;
  const paid = costs();
  await post("Who can check this for me?");
  assert.ok(Date.now() - t0 < 2000, "the choice does not wait for the slow model");
  await until(() => askedOf("Lea").length, "the lead");
  assert.equal(askedOf("Zoe").length, 0);
  const a = ((await routeNotices(room)).at(-1)!.body as { action: RouteNoticeAction }).action;
  assert.equal(a.by, "lead"); assert.match(a.why, /took too long/);
  await until(() => costs() > paid, "the late cost");
  await allIdle();
  mode = {};
});

test("\"none\": chit-chat wakes nobody, and the line says so", async () => {
  mode = { pick: 0, confidence: 0.95 };
  await post("haha nice weekend everyone");
  await sleep(150);
  assert.equal(asked.length, 0);
  const n = (await routeNotices(room)).at(-1)!;
  assert.equal((n.body as { action: RouteNoticeAction }).action.by, "none");
  assert.match((n.body as { text: string }).text, /Nobody answers/);
});

test("an unsure or unreadable answer falls back to the lead", async () => {
  mode = { pick: 3, confidence: 0.3 };
  await post("Any thoughts on this one?");
  await until(() => askedOf("Lea").length, "lead (unsure)");
  await allIdle();
  mode = { garbage: true };
  await post("And about that other one?");
  await until(() => askedOf("Lea").length, "lead (garbage)");
  await allIdle();
  assert.equal(askedOf("Zoe").length + askedOf("Marc").length, 0);
  mode = {};
});

test("a subscription engine is never used to route, even when every bot and the main bot run on one", async () => {
  const main = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  if (main) await call("PATCH", `/bots/${main.id}`, { model: "claude-code:sonnet" });
  const aux = config.auxModel;
  (config as { auxModel: string }).auxModel = "claude-code:sonnet";
  try {
    const ref = routing.routingModelRef(bots.byId(lea.id)!.userId);
    assert.ok(ref && !/^(claude-code|codex):/.test(ref), `an API model, not ${ref}`);
  } finally { (config as { auxModel: string }).auxModel = aux; }
  mode = { pick: 3, confidence: 0.9 };
  await post("Somebody to take a look, please?");
  await until(() => askedOf("Zoe").length, "Zoe");
  await allIdle();
  assert.ok(!engineInputs.some((i) => i.includes(routing.ROUTER_MARK)), "no routing prompt went to the engine");
  mode = {};
});

test("isolation: someone else's bot, a hidden helper and a paused member are never offered to the model; strangers get 404", async () => {
  const stranger = (await call("POST", "/bots", { name: "Intruder", label: "Compta" }, "b")).json.bot;
  const helper = bots.create(bots.byId(lea.id)!.userId, { name: "Lea › draft", label: "Compta", hidden: true, parentId: lea.id });
  const r = bots.byId(room)!;
  q.run("UPDATE bots SET members = ? WHERE id = ?", JSON.stringify([...r.memberIds, stranger.id, helper.id]), room);
  assert.equal((await call("POST", `/bots/${marc.id}/pause`)).status, 200);
  mode = { pick: 1, confidence: 0.9 };
  await post("Could somebody have a look?");
  const last = routerCalls.at(-1)!.prompt;
  assert.doesNotMatch(last, /Intruder|draft|Marc/);
  const cands = routing.candidatesOf(bots.byId(room)!).map((b) => b.name);
  assert.deepEqual(cands, ["Lea", "Zoe"]);
  assert.equal((await call("POST", `/bots/${marc.id}/resume`)).status, 200);
  q.run("UPDATE bots SET members = ? WHERE id = ?", JSON.stringify(r.memberIds), room);
  await allIdle();
  // The stranger cannot read, change or re-route this group.
  assert.equal((await call("GET", `/bots/${room}/routing`, undefined, "b")).status, 404);
  assert.equal((await call("PUT", `/bots/${room}/routing`, { discreet: true }, "b")).status, 404);
  const seq = (await routeNotices(room)).at(-1)!.seq;
  assert.equal((await call("POST", `/bots/${room}/rows/${seq}/reroute`, { botId: zoe.id }, "b")).status, 404);
  assert.equal((await call("GET", `/bots/${lea.id}/routing`)).status, 400);
  mode = {};
});

test("« Plutôt demander à… »: the message goes to the member chosen; a non-member is refused", async () => {
  mode = { pick: 1, confidence: 0.9 };
  await post("Please sort this out?");
  await until(() => askedOf("Lea").length, "Lea");
  await allIdle();
  const n = (await routeNotices(room)).at(-1)!;
  asked.length = 0;
  const other = (await call("POST", "/bots", { name: "Outsider" })).json.bot;
  assert.equal((await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: other.id })).status, 409);
  assert.equal((await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: lea.id })).status, 409);
  const res = await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: zoe.id });
  assert.equal(res.status, 200);
  assert.equal(res.json.action.status, "rerouted");
  await until(() => askedOf("Zoe").length, "Zoe");
  assert.match(askedOf("Zoe")[0], /Please sort this out\?/);
  const again = (await rowsOf(room)).find((r) => r.seq === n.seq)!;
  assert.match((again.body as { text: string }).text, /→ Zoe \(Support\) took the question · you asked/);
  await allIdle();
  mode = {};
});

test("discreet off: one other member may add a relevant point; discreet on: only the chosen member is woken", async () => {
  mode = { pick: 2, confidence: 0.9, also: 1 };
  await post("What should the next campaign focus on?");
  await until(() => askedOf("Marc").length && askedOf("Lea").length, "Marc and Lea");
  assert.match(askedOf("Lea")[0], /You were not asked/);
  await allIdle();
  assert.equal((await call("PUT", `/bots/${room}/routing`, { discreet: true })).json.routing.discreet, true);
  await post("And the one after that?");
  await until(() => askedOf("Marc").length, "Marc");
  await sleep(100);
  assert.equal(askedOf("Lea").length, 0);
  assert.match(askedOf("Marc")[0], /set to discreet/);
  await allIdle();
  await call("PUT", `/bots/${room}/routing`, { discreet: false });
  mode = {};
});

test("offer before starting: the bot offers, then starts on a « oui » — or on a 👍 on its offer", async () => {
  assert.equal((await call("PUT", `/bots/${room}/routing`, { askFirst: true })).json.routing.askFirst, true);
  await post("Question de compta : peux-tu préparer la facture de mars ?");
  await until(() => askedOf("Lea").length, "Lea's offer");
  assert.match(askedOf("Lea")[0], /do NOT start it yet/);
  await until(async () => (await rowsOf(room)).some((r) => r.body.kind === "message" && r.body.text === "Lea: I can take this."), "the offer posted");
  await allIdle();
  assert.ok(routing.pendingOffer(room)?.offerSeq, "the offer's message is known");
  await post("oui");
  await until(() => askedOf("Lea").some((a) => /said yes to your offer/.test(a)), "Lea starts");
  assert.equal(askedOf("Marc").length + askedOf("Zoe").length, 0);
  await allIdle();
  // Second offer, accepted with a reaction on it.
  await post("Question de compta : peux-tu vérifier la TVA de mars ?");
  await until(() => routing.pendingOffer(room)?.offerSeq, "second offer");
  await allIdle();
  asked.length = 0;
  const seq = routing.pendingOffer(room)!.offerSeq!;
  assert.equal((await call("POST", `/bots/${room}/rows/${seq}/reactions`, { emoji: "👍" })).status, 200);
  await until(() => askedOf("Lea").some((a) => /said yes to your offer/.test(a) && /TVA/.test(a)), "Lea starts after 👍");
  assert.equal(routing.pendingOffer(room), null);
  await allIdle();
  await call("PUT", `/bots/${room}/routing`, { askFirst: false });
});

test("room_handoff: a member hands over to another member with a visible message", async () => {
  await post("@Lea please hand over to Zoe");
  await until(() => askedOf("Zoe").some((a) => /handed this over to you/.test(a)), "Zoe gets the hand-off");
  const msgs = (await rowsOf(room)).filter((r) => r.body.kind === "message" && r.body.origin?.kind === "bot" && r.body.origin.id === lea.id);
  assert.ok(msgs.some((r) => /^@Zoe, I'm handing this over to you: the support side is yours/.test((r.body as { text: string }).text)));
  await allIdle();
});

test("the other rules are unchanged: \"lead\" answers with the first member and calls no model", async () => {
  assert.equal((await call("PATCH", `/bots/${room}`, { roomRule: "lead" })).status, 200);
  const before = routerCalls.length;
  await post("Marketing question for whoever");
  await until(() => askedOf("Lea").length, "lead");
  await allIdle();
  assert.equal(routerCalls.length, before);
  assert.equal(askedOf("Marc").length, 0);
});

test("rate limit: past 30 quick choices a minute, the lead answers without a model call", async () => {
  routing.resetRoutingLimits();
  mode = { pick: 2, confidence: 0.9 };
  const r = bots.byId(room)!;
  const before = routerCalls.length;
  const picks: string[] = [];
  for (let i = 0; i < 33; i++) picks.push((await routing.chooseResponder(r, `Anyone around for item ${i}?`)).by);
  assert.equal(routerCalls.length - before, 30);
  assert.deepEqual(picks.slice(30), ["lead", "lead", "lead"]);
  mode = {};
});

test("with an OpenRouter account, the quick choice uses its cheapest priced model (never a free or an expensive one)", async () => {
  const { apiProviders } = await import("../src/apimodels.js");
  const { openRouterBase } = await import("../src/openrouter.js");
  const owner = bots.byId(lea.id)!.userId;
  const m = (id: string, input: number, output: number) => ({ id, contextWindow: 100_000, input, output, cached: null, images: false });
  const p = apiProviders.create(owner, { name: "OpenRouter", baseUrl: openRouterBase(), key: "sk-or-test-not-real", models: [m("big/expensive", 3, 15), m("small/cheap", 0.1, 0.4), m("x/free", 0, 0)], preset: "openrouter", images: false });
  try {
    assert.equal(routing.routingModelRef(owner), `${p.id}:small/cheap`);
    // The stranger has no OpenRouter: their choice is the server's usual API model, never this account's provider.
    const other = (await call("GET", "/bots", undefined, "b")).json.bots[0] as Bot;
    assert.equal(routing.routingModelRef(bots.byId(other.id)!.userId), "router:fast-1");
  } finally { apiProviders.remove(owner, p.id); }
});
