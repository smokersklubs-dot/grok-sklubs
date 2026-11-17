import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Anti-loop limits for bot posts in group chats and bot-to-bot messages (agent/roombudget.ts): each rule on its own,
// then two scripted bots ping-ponging in a room that get stopped, and a human message that lets them go again.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-loop-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of Object.keys(process.env)) if (k.startsWith("BOT_LOOP_")) delete process.env[k];

const rb = await import("../src/agent/roombudget.js");
const { decide, DEFAULT_LIMITS, dmChannel, limitsFromEnv, normalize, PostBudget, roomChannel, similar, addressesNoBot } = rb;

const T0 = 1_700_000_000_000;
const room = roomChannel("r1");
const fresh = (limits = DEFAULT_LIMITS) => new PostBudget(limits);
const post = (b: InstanceType<typeof PostBudget>, botId: string, text: string, at = T0, channel = room, toUser = false) =>
  b.attempt("u1", { channel, botId, text, now: at, toUser });

test("limits: defaults, env overrides, 0 turns a rule off, junk ignored", () => {
  assert.deepEqual(limitsFromEnv({}), DEFAULT_LIMITS);
  const l = limitsFromEnv({ BOT_LOOP_BREAKER: "10", BOT_LOOP_PER_MINUTE: "0", BOT_LOOP_DUPLICATE_SEC: "60", BOT_LOOP_ESCALATE: "nope", BOT_LOOP_PER_HOUR: "-3" });
  assert.equal(l.breakerAfter, 10);
  assert.equal(l.perMinute, 0);
  assert.equal(l.duplicateMs, 60_000);
  assert.equal(l.escalateAfter, DEFAULT_LIMITS.escalateAfter);
  assert.equal(l.perHour, DEFAULT_LIMITS.perHour);
});

test("similarity: case, accents, punctuation and mentions ignored; near-same wording; whole-word containment", () => {
  assert.equal(normalize("@Bea  Voilà, le RÉSUMÉ !"), "voila le resume");
  assert.ok(similar(normalize("Here is the weekly report for the team"), normalize("here is the weekly report for the team!!")));
  assert.ok(similar(normalize("here is the full weekly report for our team today"), normalize("here is the full weekly report for our team today ok")));
  assert.ok(similar(normalize("the quarterly numbers look fine to me"), normalize("Ada says: the quarterly numbers look fine to me")));
  assert.ok(!similar(normalize("here is my answer number 1"), normalize("here is my answer number 11")));
  assert.ok(!similar(normalize("ok"), normalize("okay")));
  assert.ok(addressesNoBot("Done, here you go", ["Bea"]));
  assert.ok(!addressesNoBot("@bea your turn", ["Bea"]));
  assert.ok(!addressesNoBot("@everyone done", ["Bea"]));
});

test("decide is pure: it changes nothing", () => {
  const state = { log: [{ channel: room, botId: "a", norm: "hello there team", at: T0, toUser: false }], channels: new Map() };
  const before = JSON.stringify({ log: state.log, ch: [...state.channels] });
  const v = decide(state, { channel: room, botId: "a", text: "Hello there, team", now: T0 + 1000 }, DEFAULT_LIMITS);
  assert.equal(v.allow, false);
  assert.equal(JSON.stringify({ log: state.log, ch: [...state.channels] }), before);
});

test("duplicate: the same bot, same room, near-same text within the window", () => {
  const b = fresh();
  assert.equal(post(b, "a", "Status: all builds are green").allow, true);
  const v = post(b, "a", "status — all builds are GREEN.", T0 + 30_000);
  assert.equal(v.allow, false);
  assert.equal(!v.allow && v.rule, "duplicate");
  assert.match(!v.allow ? v.reason : "", /Do not retry/);
  // Another room, or after the window: fine.
  assert.equal(post(b, "a", "Status: all builds are green", T0 + 31_000, roomChannel("r2")).allow, true);
  assert.equal(post(b, "a", "Status: all builds are green", T0 + DEFAULT_LIMITS.duplicateMs + 1).allow, true);
});

test("ring: the same content passed around two bots is refused when it comes back (rooms and bot_message alike)", () => {
  const b = fresh();
  const text = "Please double check the invoice totals for March";
  assert.equal(post(b, "a", text, T0, dmChannel("a", "b")).allow, true);
  assert.equal(post(b, "b", `@Cy ${text}`, T0 + 1000, room).allow, true, "one forward is fine");
  const back = post(b, "a", `Bea says: ${text}`, T0 + 2000, dmChannel("a", "c"));
  assert.equal(!back.allow && back.rule, "ring");
  const third = post(b, "c", text, T0 + 3000, roomChannel("r9"));
  assert.equal(!third.allow && third.rule, "ring");
  // Short words are never a ring.
  const s = fresh();
  assert.equal(post(s, "a", "ok", T0, dmChannel("a", "b")).allow, true);
  assert.equal(post(s, "b", "ok", T0, dmChannel("a", "b")).allow, true);
  assert.equal(post(s, "c", "ok", T0, room).allow, true);
});

test("rate: per bot and room, per minute and per hour", () => {
  const b = fresh({ ...DEFAULT_LIMITS, breakerAfter: 0 });
  for (let i = 0; i < 4; i++) assert.equal(post(b, "a", `update ${i} about the launch plan`, T0 + i * 1000).allow, true);
  const v = post(b, "a", "update 9 about the launch plan", T0 + 5000);
  assert.equal(!v.allow && v.rule, "rate");
  assert.match(!v.allow ? v.reason : "", /4 a minute/);
  assert.equal(post(b, "b", "another bot is not limited by a", T0 + 5000).allow, true);
  assert.equal(post(b, "a", "a minute later it is fine again", T0 + 61_000).allow, true);
  const h = fresh({ ...DEFAULT_LIMITS, breakerAfter: 0, perHour: 3 });
  for (let i = 0; i < 3; i++) assert.equal(post(h, "a", `hourly note ${i} on the topic`, T0 + i * 120_000).allow, true);
  const hv = post(h, "a", "hourly note 7 on the topic", T0 + 400_000);
  assert.match(!hv.allow ? hv.reason : "", /3 an hour/);
});

test("breaker: six bot posts in a row without a human open it once; a human message closes it", () => {
  const b = fresh();
  for (let i = 0; i < 6; i++) assert.equal(post(b, i % 2 ? "b" : "a", `@x message number ${i} in the loop`, T0 + i * 20_000).allow, true);
  const first = post(b, "a", "@x message number 6 in the loop", T0 + 200_000);
  assert.equal(!first.allow && first.rule, "breaker");
  assert.equal(!first.allow && first.opened, true, "the refusal that opens it says so (the room line is posted once)");
  assert.ok(b.isOpen("u1", room));
  const again = post(b, "b", "@x something else entirely now", T0 + 210_000);
  assert.equal(!again.allow && again.rule, "breaker");
  assert.equal(!again.allow && again.opened, false);
  // Other rooms and other accounts are not affected.
  assert.equal(post(b, "a", "@x fine in another room", T0 + 210_000, roomChannel("r2")).allow, true);
  assert.equal(b.attempt("u2", { channel: room, botId: "a", text: "other account", now: T0 }).allow, true);
  b.human("u1", room);
  assert.ok(!b.isOpen("u1", room));
  assert.equal(post(b, "a", "@x back to work after the user wrote", T0 + 220_000).allow, true);
  // bot_message chains have their own breaker per pair of bots.
  const d = fresh();
  for (let i = 0; i < 6; i++) assert.equal(post(d, i % 2 ? "b" : "a", `dm step ${i} of the plan`, T0 + i * 20_000, dmChannel("a", "b")).allow, true);
  const dv = post(d, "a", "dm step 6 of the plan", T0 + 200_000, dmChannel("b", "a"));
  assert.equal(!dv.allow && dv.rule, "breaker");
});

test("escalate: a bot that wrote to the user twice without an answer waits; others may still answer once", () => {
  const b = fresh();
  assert.equal(post(b, "a", "Shall I publish the article?", T0, room, true).allow, true);
  assert.equal(post(b, "a", "Waiting for your go to publish", T0 + 60_000, room, true).allow, true);
  const v = post(b, "a", "Any news about publishing?", T0 + 120_000, room, true);
  assert.equal(!v.allow && v.rule, "escalate");
  const sneaky = post(b, "a", "@Bea can you ask the user for me", T0 + 121_000, room, false);
  assert.equal(!sneaky.allow && sneaky.rule, "escalate", "not by mentioning another bot either");
  assert.equal(post(b, "b", "I can review it before you publish", T0 + 122_000, room, true).allow, true);
  b.human("u1", room);
  assert.equal(post(b, "a", "Thanks, publishing it now", T0 + 130_000, room, true).allow, true);
});

// ── End to end: two scripted bots ping-ponging in a room ─────────────────────
const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { enqueue } = await import("../src/agent/loop.js");
const { postBudget } = await import("../src/agent/roombudget.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let n = 0;
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const who = /You are (\w+)/.exec(req.system)?.[1] ?? "?";
    const res = last.content.find((b) => b.type === "tool_result");
    const say = (text: string): TurnResult => ({ content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage });
    if (res && res.type === "tool_result") return say("ok");
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    // Each one always answers the other in the group, with a new text every time (so only the breaker can stop them).
    if (/group chat "Loop"|kick the loop/.test(said)) {
      const other = who === "Ping" ? "Pong" : "Ping";
      return { content: [{ type: "tool_use", id: `c_${++n}`, name: "room_post", input: { room: "Loop", text: `@${other} here is my answer number ${n}` } }], stopReason: "tool_use", model: "script-1", usage };
    }
    return say(`${who} heard you`);
  },
});

let jar = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 600): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const botPosts = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "message" && r.body.origin?.kind === "bot");
const noticesOf = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const idle = async (ids: string[]) => { const live = (await call("GET", "/bots")).json.live; return ids.every((id) => !live[id]?.running); };

test("end to end: two bots ping-ponging in a room are stopped by the breaker; a human message lets them go again", async () => {
  postBudget.reset(DEFAULT_LIMITS);
  await call("POST", "/auth/signup", { email: "loop@example.com", password: "password-1", locale: "fr" });
  const ping = (await call("POST", "/bots", { name: "Ping" })).json.bot as Bot;
  const pong = (await call("POST", "/bots", { name: "Pong" })).json.bot as Bot;
  const created = await call("POST", "/rooms", { name: "Loop", botIds: [ping.id, pong.id] });
  assert.equal(created.status, 200, created.text);
  const roomId = created.json.id as string;

  // Something other than a human (a routine, a goal round) restarts the exchange again and again. MAX_HOPS ends each chain
  // after a few answers; the breaker catches the series: six bot posts in a row, then nothing more.
  for (let kick = 0; kick < 3; kick++) {
    const before = n;
    enqueue(ping.id, { kind: "system", text: "kick the loop", depth: 0 });
    await until(() => n > before, `kick ${kick}`);
    await sleep(150);
    await until(() => idle([ping.id, pong.id]), "quiet");
    await sleep(150);
  }
  await until(() => idle([ping.id, pong.id]), "quiet at the end");
  assert.equal((await botPosts(roomId)).length, DEFAULT_LIMITS.breakerAfter, "exactly six bot posts got through");
  const line = "Les bots se répondent en boucle : j'arrête ici. Écris un message pour les relancer.";
  assert.deepEqual((await noticesOf(roomId)).filter((t) => t === line), [line], "the room says so, once, in the owner's language");
  // Each refused post is an error step in the bot's own chat ("stopped: possible loop"), and ends its turn.
  const refused = [...await rowsOf(ping.id), ...await rowsOf(pong.id)].filter((r) => r.body.kind === "step" && r.body.tool === "room_post" && r.body.status === "error");
  assert.ok(refused.length >= 2, `the bots were refused (${refused.length})`);
  assert.ok(refused.every((r) => r.body.kind === "step" && r.body.summary === "arrêté : boucle probable"));

  // The user writes in the room: the breaker closes and the lead (Ping) answers again.
  const sent = await call("POST", `/bots/${roomId}/messages`, { text: "Bon, on reprend : que reste-t-il à faire ?" });
  assert.equal(sent.status, 200, sent.text);
  await until(async () => (await botPosts(roomId)).length > DEFAULT_LIMITS.breakerAfter, "a bot post after the human message");
  await until(() => idle([ping.id, pong.id]), "quiet after the human");
  const after = (await botPosts(roomId)).length;
  assert.ok(after > DEFAULT_LIMITS.breakerAfter && after <= DEFAULT_LIMITS.breakerAfter * 2, `posts after the human: ${after}`);
});
