import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Centre de commandement » (command.ts, GET /api/command): one call with every card of the caller's team — state word,
// mission, last result, incidents, cards waiting, today's consumption, computer — the links between bots working
// together (messages, a failure handed over, a group chat), the header figures; and who sees what: a stranger nothing,
// a workspace viewer only the shared bot's chat-visible parts (no costs, incidents, computer or owner actions).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-command-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.DEFAULT_MODEL = "cmdx:c-1";
delete process.env.HOSTED_MODE;
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots, rows, approvals } = await import("../src/store.js");
const { setLive, clearLive } = await import("../src/bus.js");
const { resetCommandCache } = await import("../src/command.js");
const { commandStateOf } = await import("../src/commandtypes.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";
import type { CommandCard, CommandView } from "../src/commandtypes.js";

registerProvider({
  id: "cmdx", label: "Command test", models: ["c-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> { return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "c-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } }; },
});

const ORIGIN = process.env.PUBLIC_URL!;
type Who = "a" | "b" | "v";
const jars: Record<Who, string> = { a: "", b: "", v: "" };
async function call(who: Who, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", origin: ORIGIN, host: "bots.example.test", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const view = async (who: Who): Promise<{ v: CommandView; text: string }> => {
  resetCommandCache();
  const r = await call(who, "GET", "/command");
  assert.equal(r.status, 200, r.text);
  return { v: r.json, text: r.text };
};
const card = (v: CommandView, botId: string): CommandCard => v.cards.find((c) => c.botId === botId)!;
const ins = (sql: string, ...p: (string | number | null)[]) => q.run(sql, ...p);

let userA = "", userV = "";
const id: Record<string, string> = {};
const t = Date.now();

test("setup: A with three bots and a group chat, a stranger B, V a viewer of A's workspace where Ada is shared", async () => {
  userA = (await call("a", "POST", "/auth/signup", { email: "a@example.com", name: "Alice", password: "password123" })).json.user.id;
  await call("b", "POST", "/auth/signup", { email: "b@example.com", name: "Bob", password: "password123" });
  userV = (await call("v", "POST", "/auth/signup", { email: "v@example.com", name: "Vera", password: "password123" })).json.user.id;
  id.ada = (await call("a", "POST", "/bots", { name: "Ada" })).json.bot.id;
  id.bea = (await call("a", "POST", "/bots", { name: "Bea" })).json.bot.id;
  id.cid = (await call("a", "POST", "/bots", { name: "Cid" })).json.bot.id;
  id.bobBot = (await call("b", "POST", "/bots", { name: "Bobby" })).json.bot.id;
  // Signing up makes a first bot: it is put aside, so the team is exactly the bots made here.
  for (const u of [userA, userV]) for (const b of bots.list(u)) if (![id.ada, id.bea, id.cid].includes(b.id)) q.run("DELETE FROM bots WHERE id = ?", b.id);
  for (const b of bots.list(q.get<{ id: string }>("SELECT id FROM users WHERE email = 'b@example.com'")!.id)) if (b.id !== id.bobBot) q.run("DELETE FROM bots WHERE id = ?", b.id);
  const room = await call("a", "POST", "/rooms", { name: "War room", botIds: [id.ada, id.bea, id.cid] });
  assert.equal(room.status, 200, room.text);
  id.room = room.json.id;
  id.ws = (await call("a", "POST", "/workspaces", { name: "Studio" })).json.workspace.id;
  const inv = (await call("a", "POST", `/workspaces/${id.ws}/invites`, { email: "v@example.com", role: "viewer" })).json.invite;
  assert.equal((await call("v", "POST", "/invites/accept", { token: new URL(inv.link).searchParams.get("invite") })).status, 200);
  assert.equal((await call("a", "PUT", `/bots/${id.ada}/share`, { workspaceId: id.ws, access: "all" })).status, 200);
});

test("the state word: paused, then waiting for you, then an incident waiting, then work under way, else asleep", () => {
  const base = { paused: false, live: null, awaiting: 0, incidentsWaiting: 0, missions: 0 };
  assert.equal(commandStateOf(base), "idle");
  assert.equal(commandStateOf({ ...base, missions: 1 }), "working");
  assert.equal(commandStateOf({ ...base, live: { running: true, awaiting: null } }), "working");
  assert.equal(commandStateOf({ ...base, missions: 1, incidentsWaiting: 1 }), "error");
  assert.equal(commandStateOf({ ...base, incidentsWaiting: 1, awaiting: 2 }), "waiting");
  assert.equal(commandStateOf({ ...base, live: { running: true, awaiting: { reason: "ok?", since: 1 } } }), "waiting");
  assert.equal(commandStateOf({ ...base, awaiting: 3, paused: true }), "paused");
});

test("A's cards: mission, last result, waiting cards, incidents, consumption, computer and actions; group chats are not cards", async () => {
  const ada = bots.byId(id.ada)!, bea = bots.byId(id.bea)!, cid = bots.byId(id.cid)!;
  // Ada: an active goal (her mission), a finished background task (her last result), today's usage.
  ins("INSERT INTO bot_goals (id, bot_id, user_id, generation, objective, status, max_rounds, created_at, updated_at) VALUES ('g1', ?, ?, ?, 'Find three suppliers', 'active', 5, ?, ?)", ada.id, userA, ada.generation, t - 60_000, t - 60_000);
  ins("INSERT INTO bg_tasks (id, bot_id, title, goal, state, result, generation, created_at, updated_at) VALUES ('bg1', ?, 'Compare prices', 'x', 'done', 'B is 12 % cheaper', ?, ?, ?)", ada.id, ada.generation, t - 120_000, t - 30_000);
  ins("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, 'x:y', 1000, 500, 0, 0.42)", userA, ada.id, t - 1000);
  // Bea: an approval waiting for A, and a task of the list under way.
  const appr = approvals.create(bea.id, userA, bea.generation, 0, "mail_send");
  rows.append(bea, { kind: "card", card: { type: "approval", approvalId: appr.id, title: "Send the invoice", detail: "", tool: "mail_send", source: "", status: "pending" } });
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('tk1', ?, 'Weekly report', 'working', ?, ?)", bea.id, t, t);
  // Cid: an incident waiting for A, another one handled automatically.
  ins("INSERT INTO bot_failures (id, user_id, bot_id, class, detail, status, first_at, last_at) VALUES ('f1', ?, ?, 'tool_error', 'x', 'waiting', ?, ?)", userA, cid.id, t, t);
  ins("INSERT INTO bot_failures (id, user_id, bot_id, class, detail, status, first_at, last_at) VALUES ('f2', ?, ?, 'rate_limited', 'x', 'auto', ?, ?)", userA, cid.id, t, t);

  const { v } = await view("a");
  assert.deepEqual(v.cards.map((c) => c.botId).sort(), [id.ada, id.bea, id.cid].sort(), "agents only, no group chat, nothing of B");
  const a = card(v, id.ada), b = card(v, id.bea), c = card(v, id.cid);
  assert.equal(a.state, "working");
  assert.equal(a.mission?.kind, "goal");
  assert.equal(a.mission?.title, "Find three suppliers");
  assert.equal(a.lastResult?.title, "Compare prices");
  assert.equal(a.lastResult?.detail, "B is 12 % cheaper");
  assert.deepEqual(a.usage, { usd: 0.42, tokens: 1500 });
  // No computer on this test server (none started): « Voir l'ordinateur » is not offered, and the card says nothing of one.
  assert.deepEqual(a.can, { pause: true, stop: true, chat: true, computer: a.computer !== null, incidents: true });
  assert.equal(a.shared, null);
  assert.equal(b.state, "waiting");
  assert.equal(b.awaiting, 1);
  assert.equal(b.mission?.kind, "task");
  assert.equal(c.state, "error");
  assert.equal(c.incidents, 2);
  assert.equal(c.incidentsWaiting, 1);
  if (c.computer) assert.equal(c.computer.power, "absent", "no browser open yet");
  assert.equal(v.kpis.working, 1);
  assert.equal(v.kpis.waiting, 1);
  assert.equal(v.kpis.incidents, 2);
  assert.equal(v.kpis.display, "usd");
  assert.equal(v.kpis.usage.usd, 0.42);
  assert.equal(v.kpis.usage.eur, null);
  assert.equal(v.pausedAll, false);
  approvals.resolve(appr.id, "denied");
});

test("live activity and pauses change the cards; « Tout mettre en pause » shows on every card", async () => {
  setLive(userA, id.cid, { running: true, activity: { kind: "browsing", detail: "supplier.example", since: t }, startedAt: t });
  ins("UPDATE bot_failures SET status = 'resolved' WHERE id = 'f1'");
  let { v } = await view("a");
  assert.equal(card(v, id.cid).state, "working");
  assert.equal(card(v, id.cid).live.activity?.kind, "browsing");
  clearLive(userA, id.cid);
  assert.equal((await call("a", "POST", `/bots/${id.bea}/pause`)).status, 200);
  ({ v } = await view("a"));
  assert.equal(card(v, id.bea).state, "paused");
  assert.equal(v.kpis.paused, 1);
  assert.equal((await call("a", "POST", "/pauses/all", { paused: true })).status, 200);
  ({ v } = await view("a"));
  assert.equal(v.pausedAll, true);
  assert.ok(v.cards.every((c) => c.state === "paused"));
  assert.equal((await call("a", "POST", "/pauses/all", { paused: false })).status, 200);
  assert.equal((await call("a", "POST", `/bots/${id.bea}/resume`)).status, 200);
  ({ v } = await view("a"));
  assert.equal(v.pausedAll, false);
  assert.ok(!v.cards.some((c) => c.state === "paused"));
});

test("links: a message between two bots, a failure handed to a teammate, two bots talking in the same group chat", async () => {
  const ada = bots.byId(id.ada)!, bea = bots.byId(id.bea)!, room = bots.byId(id.room)!;
  // An old message (two days ago) does not count (rows are read newest first, so it comes before the others).
  const old = rows.append(bea, { kind: "message", role: "user", text: "Ancient", origin: { kind: "bot", id: id.cid, name: "Cid" } });
  ins("UPDATE rows SET created_at = ? WHERE bot_id = ? AND seq = ?", t - 2 * 86_400_000, bea.id, old.seq);
  rows.append(bea, { kind: "message", role: "user", text: "Can you check the supplier list?", origin: { kind: "bot", id: ada.id, name: ada.name } });
  rows.append(bea, { kind: "message", role: "user", text: "Thanks!", origin: { kind: "bot", id: ada.id, name: ada.name } });
  ins("INSERT INTO bot_failures (id, user_id, bot_id, class, detail, tried, status, first_at, last_at, resolved_at) VALUES ('f3', ?, ?, 'provider_down', 'x', ?, 'handed', ?, ?, ?)", userA, id.cid, JSON.stringify([{ action: "handoff", at: t, ok: true, note: "Ada" }]), t, t, t);
  rows.append(room, { kind: "message", role: "assistant", text: "I take the budget part.", origin: { kind: "bot", id: id.bea, name: "Bea" } });
  rows.append(room, { kind: "message", role: "assistant", text: "I do the timeline.", origin: { kind: "bot", id: id.cid, name: "Cid" } });
  const { v } = await view("a");
  const msg = v.links.find((l) => l.kind === "message")!;
  assert.ok(msg, JSON.stringify(v.links));
  assert.deepEqual([msg.from, msg.to], [id.ada, id.bea]);
  assert.equal(msg.count, 2);
  assert.equal(msg.exchange[0].botId, id.bea);
  assert.ok(msg.exchange.some((e) => e.text === "Can you check the supplier list?"));
  const hand = v.links.find((l) => l.kind === "handoff")!;
  assert.deepEqual([hand.from, hand.to], [id.cid, id.ada]);
  const roomLink = v.links.find((l) => l.kind === "room")!;
  assert.deepEqual([roomLink.from, roomLink.to].sort(), [id.bea, id.cid].sort());
  assert.equal(roomLink.roomName, "War room");
  assert.equal(roomLink.count, 2);
  assert.ok(!v.links.some((l) => l.exchange.some((e) => e.text === "Ancient")));
});

test("a stranger sees none of A's bots; a viewer sees the shared bot without costs, incidents, computer or owner actions", async () => {
  const b = await view("b");
  assert.deepEqual(b.v.cards.map((c) => c.botId), [id.bobBot]);
  for (const s of [id.ada, id.bea, id.cid, "Find three suppliers", "War room", "supplier list"]) assert.ok(!b.text.includes(s), `B saw ${s}`);
  assert.equal(b.v.kpis.usage.usd, 0);

  ins("INSERT INTO bot_failures (id, user_id, bot_id, class, detail, status, first_at, last_at) VALUES ('f4', ?, ?, 'tool_error', 'x', 'waiting', ?, ?)", userA, id.ada, t, t);
  const v = await view("v");
  assert.deepEqual(v.v.cards.map((c) => c.botId), [id.ada], "only the shared bot");
  const ada = v.v.cards[0];
  assert.equal(ada.shared?.workspaceName, "Studio");
  assert.equal(ada.shared?.role, "viewer");
  assert.equal(ada.usage, null);
  assert.equal(ada.incidents, null);
  assert.equal(ada.computer, null);
  assert.deepEqual(ada.can, { pause: false, stop: false, chat: true, computer: false, incidents: false });
  assert.equal(ada.state, "working", "an incident of the owner does not make it « en erreur » for the viewer");
  assert.equal(ada.mission?.title, "Find three suppliers", "a goal is what the chat shows");
  assert.equal(v.v.links.length, 0, "no link to a bot V cannot see");
  for (const s of [id.bea, id.cid, "Weekly report", "War room", "supplier list"]) assert.ok(!v.text.includes(s), `V saw ${s}`);
  assert.equal(v.v.kpis.incidents, 0);
  assert.equal(v.v.kpis.usage.usd, 0, "V's own consumption, not A's");
  // A viewer answers no approval: Ada's waits only for A.
  const adaRec = bots.byId(id.ada)!;
  const appr = approvals.create(adaRec.id, userA, adaRec.generation, 0, "x");
  rows.append(adaRec, { kind: "card", card: { type: "approval", approvalId: appr.id, title: "Ada approval", detail: "", tool: "x", source: "", status: "pending" } });
  assert.equal(card((await view("v")).v, id.ada).awaiting, 0);
  assert.equal(card((await view("a")).v, id.ada).awaiting, 1);
  // An admin with « owner or admins » approvals answers it: it counts for them.
  q.run("UPDATE workspace_members SET role = 'admin' WHERE user_id = ?", userV);
  q.run("UPDATE bot_shares SET approvals = 'owner_or_admins' WHERE bot_id = ?", id.ada);
  assert.equal(card((await view("v")).v, id.ada).awaiting, 1);
  q.run("UPDATE workspace_members SET role = 'viewer' WHERE user_id = ?", userV);
  q.run("UPDATE bot_shares SET approvals = 'owner' WHERE bot_id = ?", id.ada);
  approvals.resolve(appr.id, "denied");
  // Unshared: nothing of A any more.
  assert.equal((await call("a", "DELETE", `/bots/${id.ada}/share`)).status, 200);
  assert.deepEqual((await view("v")).v.cards, []);
  // The owner's actions stay the owner's: V cannot pause or stop A's bot.
  assert.equal((await call("v", "POST", `/bots/${id.ada}/pause`)).status, 404);
  assert.equal((await call("v", "POST", `/bots/${id.ada}/stop`)).status, 404);
});

test("the answer is cached briefly, so polls and bursts of events cost one build", async () => {
  resetCommandCache();
  const first = (await call("a", "GET", "/command")).json as CommandView;
  ins("INSERT INTO tasks (id, bot_id, title, state, created_at, updated_at) VALUES ('tk_cache', ?, 'Fresh task', 'working', ?, ?)", id.cid, Date.now(), Date.now());
  const second = (await call("a", "GET", "/command")).json as CommandView;
  assert.equal(second.generatedAt, first.generatedAt);
  assert.equal(card((await view("a")).v, id.cid).mission?.title, "Fresh task");
});
