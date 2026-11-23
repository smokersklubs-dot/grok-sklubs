import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L155 — leading a group of bots: « stop @Bot » kept after a restart (a database row), the task's owner with « Réassigner »
// and « Archiver » / « Restaurer », and a time limit per member (agent/roomholds.ts, agent/roomrouting.ts, roomroutes.ts).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-roomholds-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ROOM_LIMIT_POLL_MS = "40";
process.env.ROOM_LIMIT_MINUTE_MS = "400";
delete process.env.AUX_MODEL;
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const holds = await import("../src/agent/roomholds.js");
const routing = await import("../src/agent/roomrouting.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row, RouteNoticeAction } from "../src/shared.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const asked: string[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const who = /You are (\w+)/.exec(req.system)?.[1] ?? "?";
    const done = (text: string): TurnResult => ({ content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage });
    if (last.content.some((b) => b.type === "tool_result")) return done("ok");
    asked.push(`${who}: ${said}`);
    // « take your time »: a turn that runs until it is stopped.
    if (/take your time/.test(said)) await new Promise<void>((resolve) => { const t = setTimeout(resolve, 20_000); req.signal?.addEventListener("abort", () => { clearTimeout(t); resolve(); }); });
    return { content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name: "stay_quiet", input: { reason: "test" } }], stopReason: "tool_use", model: "script-1", usage };
  },
});

let jar = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500`)).json.rows;
const notices = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const askedOf = (name: string) => asked.filter((a) => a.startsWith(`${name}: `));
const running = async (id: string) => !!(await call("GET", "/bots")).json.live[id]?.running;
async function allIdle() { for (let i = 0; i < 200; i++) { let busy = false; for (const b of [lea, marc]) if (await running(b.id)) busy = true; if (!busy) return; await sleep(25); } }
async function post(text: string) { asked.length = 0; assert.equal((await call("POST", `/bots/${room}/messages`, { text })).status, 200); await routing.routingSettled(); await sleep(60); await allIdle(); }

test("reading the order: a stop word next to the mention holds, far from it nothing, quotes never count", () => {
  assert.deepEqual(holds.classifyHoldDirective("stop @Léa", ["L"]), { hold: ["L"], holdAll: false, release: [], releaseAll: false });
  assert.deepEqual(holds.classifyHoldDirective("@Léa arrête", ["L"]).hold, ["L"]);
  assert.deepEqual(holds.classifyHoldDirective("@Léa, tu sais où est l'arrêt de bus ? dis-moi, et pas de pause", ["L"]).hold, [], "far from the mention: not an order");
  assert.deepEqual(holds.classifyHoldDirective("> stop @Léa\nqu'en penses-tu @Marc ?", ["L", "M"]).hold, [], "a quote is not an order");
  assert.equal(holds.classifyHoldDirective("stop @everyone", []).holdAll, true);
  assert.equal(holds.classifyHoldDirective("reprends", []).releaseAll, true);
  assert.deepEqual(holds.classifyHoldDirective("reprends @Léa", ["L"]).release, ["L"]);
  assert.equal(holds.onlyHoldOrder("stop @Léa"), true);
  assert.equal(holds.onlyHoldOrder("@Léa stop et regarde la facture"), false);
  assert.equal(holds.parseLimit(0), undefined); assert.equal(holds.parseLimit(241), undefined); assert.equal(holds.parseLimit(2.5), undefined);
  assert.equal(holds.parseLimit(30), 30); assert.equal(holds.parseLimit(null), null);
});

let lea: Bot, marc: Bot, room = "";
test("setup: a group with Lea (lead) and Marc", async () => {
  await call("POST", "/auth/signup", { email: "owner@example.com", password: "password-1", locale: "fr" });
  lea = (await call("POST", "/bots", { name: "Lea", label: "Compta" })).json.bot;
  marc = (await call("POST", "/bots", { name: "Marc", label: "Marketing" })).json.bot;
  room = (await call("POST", "/rooms", { name: "Crew", botIds: [lea.id, marc.id] })).json.id;
  assert.equal((await call("PATCH", `/bots/${room}`, { roomRule: "everyone" })).status, 200);
});

test("« stop @Lea »: nobody is woken by the order, Lea is skipped by every message, the hold is a database row, « reprends @Lea » brings her back", async () => {
  await post("stop @Lea");
  assert.equal(asked.length, 0, "the order itself wakes nobody");
  assert.ok((await notices(room)).some((t) => t === "Lea est en attente dans ce groupe : écris « reprends @Lea » pour le relancer."));
  // Kept after a restart: the hold lives in the database, not in memory.
  assert.ok(q.get("SELECT 1 FROM room_holds WHERE room_id = ? AND bot_id = ?", room, lea.id));
  assert.deepEqual((await call("GET", `/bots/${room}/limits`)).json.held, [lea.id]);
  await post("Bonjour à tous, un point sur la semaine ?");
  assert.equal(askedOf("Lea").length, 0, "held: not woken by « everyone »");
  assert.equal(askedOf("Marc").length, 1);
  // Not picked by the automatic mode either.
  assert.ok(!routing.candidatesOf((await import("../src/store.js")).bots.byId(room)!).some((b) => b.id === lea.id));
  await post("reprends @Lea");
  assert.equal(asked.length, 0);
  assert.ok((await notices(room)).includes("Lea est de retour dans le groupe."));
  assert.ok(!q.get("SELECT 1 FROM room_holds WHERE room_id = ? AND bot_id = ?", room, lea.id));
  await post("Et maintenant ?");
  assert.equal(askedOf("Lea").length, 1);
});

test("a time limit per member: a turn for the group that runs past it is stopped and the group says so", async () => {
  assert.equal((await call("PUT", `/bots/${room}/limits`, { botId: lea.id, minutes: 0 })).status, 400);
  assert.equal((await call("PUT", `/bots/${room}/limits`, { botId: "nope", minutes: 5 })).status, 400);
  const r = await call("PUT", `/bots/${room}/limits`, { botId: lea.id, minutes: 1 });
  assert.equal(r.status, 200);
  assert.deepEqual(r.json.limits, { [lea.id]: 1 });
  asked.length = 0;
  await call("POST", `/bots/${room}/messages`, { text: "@Lea take your time on the yearly report" });
  await until(() => askedOf("Lea").length, "Lea started");
  await until(async () => (await notices(room)).find((t) => t.startsWith("Lea a dépassé sa limite de temps dans ce groupe (1 min)")), "limit notice");
  await until(async () => !(await running(lea.id)), "Lea stopped");
  assert.equal((await call("PUT", `/bots/${room}/limits`, { botId: lea.id, minutes: null })).json.limits[lea.id], undefined);
});

test("the task's owner: « Réassigner » more than once, « Archiver » closes it (no reassigning), « Restaurer » brings it back", async () => {
  assert.equal((await call("PATCH", `/bots/${room}`, { roomRule: "auto" })).status, 200);
  await post("Question de compta : la facture de mars ?");
  const n = (await rowsOf(room)).filter((x) => x.body.kind === "notice" && x.body.action?.kind === "route").at(-1)!;
  const act = () => rowsOf(room).then((rs) => (rs.find((x) => x.seq === n.seq)!.body as { action: RouteNoticeAction }).action);
  assert.equal((await act()).botId, lea.id);
  assert.equal((await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: marc.id })).json.action.status, "rerouted");
  await allIdle();
  const back = await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: lea.id });
  assert.equal(back.status, 200, "a rerouted task can be reassigned again");
  assert.equal(back.json.action.botId, lea.id);
  await allIdle();
  assert.equal((await call("POST", `/bots/${room}/rows/${n.seq}/archive`, { archived: "yes" })).status, 400);
  const arch = await call("POST", `/bots/${room}/rows/${n.seq}/archive`, { archived: true });
  assert.equal(arch.json.action.status, "archived");
  assert.equal((await act()).status, "archived");
  const refused = await call("POST", `/bots/${room}/rows/${n.seq}/reroute`, { botId: marc.id });
  assert.equal(refused.status, 409);
  assert.equal(refused.json.error, "Cette tâche est archivée. Restaure-la d'abord.");
  const restored = await call("POST", `/bots/${room}/rows/${n.seq}/archive`, { archived: false });
  assert.equal(restored.json.action.status, "rerouted");
  assert.equal(restored.json.action.archivedFrom, undefined);
  assert.equal((await call("POST", `/bots/${lea.id}/rows/${n.seq}/archive`, { archived: true })).status, 400, "only a group has tasks");
});
