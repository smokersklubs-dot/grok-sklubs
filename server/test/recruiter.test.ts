import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Bot recruteur » (agent/recruit.ts): the main bot proposes ONE new specialist on a card, which is the approval;
// « Créer » sets it up (careful, skills, paused routines, its section) and hands it the request, whose answer comes back
// to the main bot; « Non merci » leaves nothing; the limits hold; only the main bot proposes; no account sees another's.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-recruit-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.MAX_STEPS = "8";
process.env.BOT_CREATE_PER_DAY = "2";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, sections, setBotGuard, setMaxBots, skills } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const { PlanLimitError } = await import("../src/hosted.js");
const { q } = await import("../src/db.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, RecruitCard, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
/** Scripted model (as in wave7.test.ts): "call T {json}" → one tool; else echoes the tool's result or the message. */
const requests: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = ([...texts].reverse().find((t) => /call \w+ \{/.test(t)) ?? texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{[^\n]*\})\s*$/.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said.slice(0, 300)}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
} satisfies LlmProvider);

let cookie = "";
let other = "";
async function call(method: string, url: string, body?: unknown, as?: string) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as ?? cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, cookie: res.headers.get("set-cookie")?.split(";")[0] ?? "" };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string, as?: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`, undefined, as)).json.rows;
const say = (bot: { id: string }, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const recruitRows = (list: Row[]) => list.filter((r) => r.body.kind === "card" && r.body.card.type === "recruit");
const cardOf = (r: Row) => (r.body as { card: Card }).card as RecruitCard;
const toolNames = (req: TurnRequest) => req.tools.map((t) => t.name);
/** Nothing queued or running for this bot (its queue rows are all done). */
const idle = (botId: string) => until(() => !q.get("SELECT 1 FROM bot_queue WHERE bot_id = ? AND status != 'done'", botId) && true, "idle");
const errorSteps = async (botId: string) => (await rowsOf(botId)).filter((r) => r.body.kind === "step" && r.body.tool === "bot_propose" && r.body.status === "error").length;
const historyOf = (botId: string) => q.all<{ content: string }>("SELECT content FROM history WHERE bot_id = ?", botId).map((r) => r.content).join("\n");

let primary: Bot;
let userId = "";
const proposal = (o: Record<string, unknown> = {}) => `call bot_propose ${JSON.stringify({
  name: "Lina", role: "Comptabilité", why: "Les factures reviennent chaque mois et personne ne fait la compta.",
  instructions: "Range les factures et tiens le tableau des dépenses.", skills: ["methode-de-travail", "pas-une-competence"],
  routines: [{ name: "Factures de la semaine", schedule: "0 9 * * 1", prompt: "Range les factures de la semaine." }],
  task: "Trie les 14 factures d'octobre et donne le total.", ...o,
})}`;
/** Sends a proposal and returns its card row once the turn is over. */
async function propose(o: Record<string, unknown> = {}): Promise<Row> {
  const before = recruitRows(await rowsOf(primary.id)).length;
  await say(primary, proposal(o));
  return until(async () => { const list = recruitRows(await rowsOf(primary.id)); return list.length > before && list.at(-1); }, "recruit card");
}

test("setup: two accounts; the main bot in a section", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  cookie = r.cookie;
  userId = r.json.user.id;
  primary = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  primary = (await call("PATCH", `/bots/${primary.id}`, { model: "script:script-1" })).json.bot;
  const sec = sections.create(userId, "Bureau");
  bots.patch(primary.id, { sectionId: sec.id });
  const o = await call("POST", "/auth/signup", { email: "zoe@example.com", name: "Zoé", password: "password123", locale: "fr" });
  assert.equal(o.status, 200, o.text);
  other = o.cookie;
});

test("the main bot (only) is told how to recruit and has bot_propose; a teammate has neither", async () => {
  await say(primary, "bonjour");
  await until(() => requests.find((q) => q.system.includes("Recruiting:")), "primary turn");
  const req = requests.find((q) => q.system.includes("Recruiting:"))!;
  assert.ok(toolNames(req).includes("bot_propose"));
  assert.match(req.system, /methode-de-travail/);
  assert.match(req.system, /never when a teammate fits/);
  // bot_propose is the approval: it takes no user_quote and asks for no approval card.
  assert.ok(!("user_quote" in req.tools.find((t) => t.name === "bot_propose")!.inputSchema.properties));
  await idle(primary.id);
});

test("proposal card: name, role, why, instructions, known Bibliothèque skills, routines paused, brain, task; nothing created", async () => {
  const before = bots.list(userId).length;
  const row = await propose();
  const c = cardOf(row);
  assert.equal(c.status, "pending");
  assert.equal(c.name, "Lina"); assert.equal(c.role, "Comptabilité");
  assert.match(c.why, /factures/);
  assert.deepEqual(c.skills, [{ id: "methode-de-travail", title: "Méthode de travail" }]); // the unknown id is dropped
  assert.equal(c.routines.length, 1); assert.equal(c.routines[0].schedule, "0 9 * * 1"); assert.ok(c.routines[0].when);
  assert.equal(c.brain, "same"); assert.match(c.brainLabel, /script/);
  assert.match(c.task, /14 factures/);
  assert.equal(c.limit, undefined);
  assert.equal(bots.list(userId).length, before, "the card alone creates nothing");
  // No approval card: the proposal card is the approval.
  assert.ok(!(await rowsOf(primary.id)).some((r) => r.body.kind === "card" && r.body.card.type === "approval"));
  await idle(primary.id);
  // At most one proposal per conversation per day, unless the user asked for a new teammate.
  const errs = await errorSteps(primary.id);
  await say(primary, proposal({ name: "Paul", role: "Juriste" }));
  await until(async () => (await errorSteps(primary.id)) > errs, "refused second proposal");
  assert.match(historyOf(primary.id), /already proposed a new teammate/);
  assert.equal(recruitRows(await rowsOf(primary.id)).length, 1);
  await idle(primary.id);
});

test("« Créer »: the bot exists (careful, same brain, primary's section), skills added, routines paused, task handed, follow-up", async () => {
  const row = recruitRows(await rowsOf(primary.id))[0];
  const r = await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "create", name: "Lina", role: "Comptabilité", instructions: "Range les factures (modifié)." });
  assert.equal(r.status, 200, r.text);
  const lina = bots.byName(userId, "Lina")!;
  assert.ok(lina);
  assert.equal(lina.autonomy, "careful");
  assert.equal(lina.model, "script:script-1");
  assert.equal(lina.instructions, "Range les factures (modifié).");
  assert.equal(lina.sectionId, bots.byId(primary.id)!.sectionId);
  assert.equal(lina.createdBy, primary.id);
  assert.equal(lina.relayEnabled, false, "no credential relay: nothing beyond what a new bot has");
  assert.deepEqual(skills.list(lina.id).map((s) => s.name), ["Méthode de travail"]);
  const rt = routines.forBot(lina.id);
  assert.equal(rt.length, 1); assert.equal(rt[0].enabled, false, "routines start paused");
  const card = cardOf((await rowsOf(primary.id)).find((x) => x.seq === row.seq)!);
  assert.equal(card.status, "created"); assert.equal(card.botId, lina.id);
  // The primary says it handed it over…
  assert.ok((await rowsOf(primary.id)).some((x) => x.body.kind === "message" && x.body.role === "assistant" && x.body.text.includes("J'ai confié ça à Lina")));
  // …the request reached Lina from the primary…
  const handed = await until(async () => (await rowsOf(lina.id)).find((x) => x.body.kind === "message" && x.body.role === "user" && x.body.origin?.kind === "bot" && x.body.origin.id === primary.id), "handover");
  assert.match(handed.body.kind === "message" ? handed.body.text : "", /14 factures/);
  // …and Lina's answer comes back to the primary, which then replies to the user.
  const back = await until(async () => (await rowsOf(primary.id)).find((x) => x.body.kind === "message" && x.body.role === "user" && x.body.origin?.kind === "bot" && x.body.origin.id === lina.id), "follow-up");
  await until(async () => (await rowsOf(primary.id)).some((x) => x.seq > back.seq && x.body.kind === "message" && x.body.role === "assistant" && !x.body.streaming && x.body.text), "primary reports");
  // Answered once: a second click is refused.
  assert.equal((await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "create" })).status, 409);
  await idle(primary.id); await idle(lina.id);
});

test("« Non merci » leaves nothing; a teammate with the role already blocks a proposal", async () => {
  const count = bots.list(userId).length;
  const row = await propose({ name: "Paul", role: "Juriste", user_asked: true });
  await idle(primary.id);
  const r = await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "decline" });
  assert.equal(r.status, 200);
  assert.equal(cardOf((await rowsOf(primary.id)).find((x) => x.seq === row.seq)!).status, "declined");
  assert.equal(bots.list(userId).length, count);
  assert.equal(bots.byName(userId, "Paul"), null);
  // Lina already does bookkeeping: no new bot for that role.
  const n = recruitRows(await rowsOf(primary.id)).length;
  const errs = await errorSteps(primary.id);
  await say(primary, proposal({ name: "Max", user_asked: true }));
  await until(async () => (await errorSteps(primary.id)) > errs, "refused");
  assert.match(historyOf(primary.id), /Lina already has this role/);
  assert.equal(recruitRows(await rowsOf(primary.id)).length, n);
  await idle(primary.id);
});

test("limits: the hosted plan, the team size and the daily quota show on the card; nothing is created", async () => {
  // The hosted plan's bot limit (the guard hosted.ts installs, simulated): « Créer » is refused and the card shows it.
  const row = await propose({ name: "Nora", role: "Juriste", user_asked: true });
  await idle(primary.id);
  setBotGuard(() => { throw new PlanLimitError("bots", "Your plan allows {n} bots. Remove one, or change plan (Settings → Credits), to create another.", { n: 3 }); });
  try {
    const r = await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "create" });
    assert.equal(r.status, 409);
    assert.match(r.json.error, /Limite de ton offre atteinte \(3 bots\)/);
    const c = cardOf((await rowsOf(primary.id)).find((x) => x.seq === row.seq)!);
    assert.equal(c.limit, "plan"); assert.equal(c.status, "pending");
    assert.equal(bots.byName(userId, "Nora"), null);
  } finally { setBotGuard(() => {}); }
  // The installation is full: the card says so from the start.
  setMaxBots(1);
  try {
    const full = await propose({ name: "Iris", role: "Traductrice", user_asked: true });
    assert.equal(cardOf(full).limit, "team");
    await idle(primary.id);
  } finally { setMaxBots(0); }
  // The daily quota of bots created by bots (2 here): Nora goes through, then the next one is blocked.
  assert.equal((await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "create" })).status, 200);
  await idle(primary.id);
  const late = await propose({ name: "Hugo", role: "Graphiste", user_asked: true });
  assert.equal(cardOf(late).limit, "daily"); assert.equal(cardOf(late).limitN, 2);
  await idle(primary.id);
  const r = await call("POST", `/bots/${primary.id}/cards/${late.seq}/recruit`, { action: "create" });
  assert.equal(r.status, 409);
  assert.equal(bots.byName(userId, "Hugo"), null);
  for (const n of ["Nora", "Lina"]) { const b = bots.byName(userId, n); if (b) await idle(b.id); }
});

test("a teammate cannot propose: no tool, no card", async () => {
  const lina = bots.byName(userId, "Lina")!;
  const before = requests.length;
  await say(lina, proposal({ name: "Zed", role: "Veilleur", user_asked: true }));
  await idle(lina.id);
  await until(() => requests.length > before, "teammate turn");
  assert.ok(requests.slice(before).every((q) => !toolNames(q).includes("bot_propose") && !q.system.includes("Recruiting:")));
  assert.equal(recruitRows(await rowsOf(lina.id)).length, 0);
  assert.equal(bots.byName(userId, "Zed"), null);
});

test("isolation: another account can neither see nor answer the card, nor see the new bot", async () => {
  const row = recruitRows(await rowsOf(primary.id)).at(-1)!;
  assert.equal((await call("POST", `/bots/${primary.id}/cards/${row.seq}/recruit`, { action: "decline" }, other)).status, 404);
  assert.equal((await call("GET", `/bots/${primary.id}/rows?limit=5`, undefined, other)).status, 404);
  const theirs = (await call("GET", "/bots", undefined, other)).json.bots as Bot[];
  assert.ok(!theirs.some((b) => b.name === "Lina" || b.name === "Nora"));
  assert.equal(cardOf((await rowsOf(primary.id)).find((x) => x.seq === row.seq)!).status, "pending");
});
