import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Cards and message actions (backlog A-FAIRE L79, L83, L98, L136, L139): rich questions and plans, the editable draft in
// an approval card, « Annuler » on reversible changes, edit / write again / branch, and the « À toi » inbox.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-turncards-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { approvals, bots, paused, rows, laneKey, settings, skills } = await import("../src/store.js");
const { routines } = await import("../src/routines.js");
const { actionHash } = await import("../src/agent/executions.js");
const { applyDraftEdit, draftOf } = await import("../src/agent/draftedit.js");
const { mailFingerprint } = await import("../src/native/mailproof.js");
const { undoChange, offerUndo } = await import("../src/agent/undoable.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const seen: { last: string; all: string }[] = [];
const results: string[] = [];
const textOf = (blocks: Block[]) => blocks.map((b) => (b.type === "text" ? b.text : b.type === "tool_result" ? b.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : "")).join("\n");
let routineId = "";
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const said = textOf(last.content);
    seen.push({ last: said, all: req.messages.map((m) => textOf(m.content)).join("\n") });
    const say = (text: string): TurnResult => { req.onText?.(text); return { content: [{ type: "text", text }] as Block[], stopReason: "end", model: "script-1", usage }; };
    const use = (name: string, input: unknown): TurnResult => ({ content: [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name, input: input as Record<string, unknown> }], stopReason: "tool_use", model: "script-1", usage });
    if (last.content.some((b) => b.type === "tool_result")) { results.push(said); return say("noted"); }
    if (/ASKRICH/.test(said)) return use("ask_user", { question: "Which offer?", options: ["Basic", "Pro"], recommended: "Pro", why: "The price depends on it", irreversible: true, multiple: true, images: ["files/plan.png", "https://tracker.example.net/x.png", "../etc/passwd"], questions: [{ question: "Start when?", options: ["Today", "Monday"], recommended: "Monday" }, { question: "Who signs?", options: ["Me", "My partner"] }] });
    if (/ASKFIVE/.test(said)) return use("ask_user", { question: "Many", questions: [1, 2, 3, 4, 5].map((n) => ({ question: `Q${n}` })) });
    if (/PLANONE/.test(said)) return use("plan_propose", { title: "Move the shop", steps: ["Export products", "Create the new shop", "Switch the domain"], why: "It touches the live shop" });
    if (/PLANTWO/.test(said)) return use("plan_propose", { title: "Move the shop", steps: ["Export products", "Create the new shop", "Test an order", "Switch the domain"], irreversible: true });
    if (/SAVESKILL/.test(said)) return use("skill_save", { name: "Invoices", steps: "1. Open the invoices\n2. Export the month" });
    if (/SETPROFILE/.test(said)) return use("profile_update", { company: "Acme Bakery" });
    if (/PAUSEROUTINE/.test(said)) return use("routine_update", { id: routineId, enabled: false });
    return say(`reply to: ${said.slice(-80)}`);
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, tries = 400): Promise<T> {
  for (let i = 0; i < tries; i++) { const v = await probe(); if (v) return v; await sleep(25); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (id: string, thread = 0): Promise<Row[]> => (await call("GET", `/bots/${id}/rows?limit=500${thread ? `&thread=${thread}` : ""}`)).json.rows;
const idle = (id: string) => until(async () => !(await call("GET", "/bots")).json.live[id]?.running, "idle");
const say = async (id: string, text: string) => { const before = seen.length; await call("POST", `/bots/${id}/messages`, { text }); await until(() => seen.length > before, `the turn for ${text}`); await idle(id); };
const cards = async (id: string) => (await rowsOf(id)).filter((r) => r.body.kind === "card");

let bot: Bot; let userId = "";
test("setup", async () => {
  const s = await call("POST", "/auth/signup", { email: "cards@example.com", password: "password-1", locale: "en" });
  userId = s.json?.user?.id ?? "";
  bot = (await call("POST", "/bots", { name: "Carder" })).json.bot;
  userId ||= q.get<{ user_id: string }>("SELECT user_id FROM bots WHERE id = ?", bot.id)!.user_id;
});

test("L79: a rich question card — why, recommended, irreversible, several answers, own pictures only, 2-4 questions", async () => {
  await say(bot.id, "ASKRICH please");
  const c = (await cards(bot.id)).at(-1)!;
  assert.ok(c.body.kind === "card" && c.body.card.type === "question");
  const k = c.body.kind === "card" && c.body.card.type === "question" ? c.body.card : null;
  assert.equal(k!.recommended, "Pro");
  assert.equal(k!.why, "The price depends on it");
  assert.equal(k!.irreversible, true);
  assert.equal(k!.multiple, true);
  assert.deepEqual(k!.images, ["files/plan.png"], "outside addresses and path tricks are dropped");
  assert.equal(k!.questions?.length, 2);
  assert.equal(k!.questions?.[0].recommended, "Monday");
  // Answered as before: the answer is the owner's next message.
  const before = seen.length;
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${c.seq}/answer`, { answer: "Which offer? Pro\nStart when? Monday\nWho signs? Me" })).status, 200);
  await until(() => seen.slice(before).some((s) => /Answering your question "Which offer\?"/.test(s.last) && /Start when\? Monday/.test(s.last)), "the answer");
  await idle(bot.id);
});

test("L79: more than 4 questions on a card is refused", async () => {
  const before = results.length;
  await say(bot.id, "ASKFIVE");
  await until(() => results.length > before, "the tool result");
  assert.match(results.at(-1)!, /give 2 to 4 questions/);
});

test("L79: plan_propose — approve / note / change, and version 2 shows what changed", async () => {
  await say(bot.id, "PLANONE");
  const first = (await cards(bot.id)).at(-1)!;
  const p1 = first.body.kind === "card" && first.body.card.type === "question" ? first.body.card : null;
  assert.equal(p1!.plan?.version, 1);
  assert.deepEqual(p1!.options, ["Approve", "Approve with a note", "Change it"]);
  assert.equal(p1!.recommended, "Approve");
  await say(bot.id, "PLANTWO");
  const second = (await cards(bot.id)).at(-1)!;
  const p2 = second.body.kind === "card" && second.body.card.type === "question" ? second.body.card : null;
  assert.equal(p2!.plan?.version, 2);
  assert.deepEqual(p2!.plan?.added, ["Test an order"]);
  assert.deepEqual(p2!.plan?.removed, []);
  assert.equal(p2!.irreversible, true);
});

test("L139: the « À toi » inbox lists every waiting card of every bot, newest first", async () => {
  const other: Bot = (await call("POST", "/bots", { name: "Other" })).json.bot;
  await say(other.id, "PLANONE");
  const res = await call("GET", "/inbox");
  assert.equal(res.status, 200);
  const items = res.json.items as { botId: string; botName: string; kind: string; card: { type: string; status: string } }[];
  assert.ok(items.every((i) => i.card.status === "pending"));
  assert.equal(items[0].botName, "Other", "newest first");
  assert.ok(items.some((i) => i.botId === bot.id && i.kind === "question"));
  assert.equal(res.json.counts.all, items.length);
  assert.equal(res.json.counts.question, items.filter((i) => i.kind === "question").length);
});

test("L83: the words of a mail card can be corrected; the approval re-binds to exactly the edited text", async () => {
  const call0 = { type: "tool_use" as const, id: "c_mail", name: "gmail_main__mail_send", input: { to: "ana@example.org", subject: "Devis", body: "Bonjour Ana, voici le devs." } };
  assert.deepEqual(draftOf(call0), { subject: "Devis", body: "Bonjour Ana, voici le devs." });
  assert.deepEqual(draftOf({ name: "shell_run", input: { command: "ls" } }), {}, "only message tools");
  const rec = bots.byId(bot.id)!;
  const card = rows.append(rec, { kind: "card", card: { type: "approval", approvalId: "apr_draft1", title: "Send?", detail: "", tool: "gmail", source: "Gmail", status: "pending", draft: draftOf(call0) } });
  approvals.create(rec.id, rec.userId, rec.generation, card.seq, "gmail", "apr_draft1", actionHash(call0.name, call0.input));
  paused.set(laneKey(bot.id, 0), { system: "", tools: [], modelRef: "script:script-1", pending: [call0], results: [], stepSeq: {}, generation: rec.generation, approvalId: "apr_draft1", depth: 0, endTurn: false });
  // Recipients are not words: refused through the route, nothing changes.
  const refused = await call("POST", "/approvals/apr_draft1", { decision: "allow", draft: { to: "eve@example.org" } });
  assert.equal(refused.status, 409);
  assert.equal(approvals.byId("apr_draft1")!.status, "pending");
  assert.equal(applyDraftEdit(rec.userId, "apr_draft1", { body: "Bonjour Ana, voici le devis." }), null);
  const state = paused.get<{ pending: { input: Record<string, string> }[] }>(laneKey(bot.id, 0))!;
  assert.equal(state.pending[0].input.body, "Bonjour Ana, voici le devis.");
  assert.equal(state.pending[0].input.to, "ana@example.org", "the recipient never changes");
  const shown = rows.get(bot.id, rec.generation, card.seq)!;
  assert.ok(shown.body.kind === "card" && shown.body.card.type === "approval" && shown.body.card.edited === true && /voici le devis\./.test(shown.body.card.detail));
  // The single-use exact-action check holds for the edited text only.
  approvals.resolve("apr_draft1", "allowed");
  assert.equal(approvals.consume("apr_draft1", actionHash(call0.name, call0.input)), false, "the old text is no longer approved");
  assert.equal(approvals.consume("apr_draft1", actionHash(call0.name, state.pending[0].input)), true, "the edited text is");
  // L29: the fingerprint compared with the wire is taken from these arguments, i.e. the corrected text.
  assert.equal(mailFingerprint({ to: ["ana@example.org"], subject: "Devis", body: state.pending[0].input.body }), mailFingerprint({ to: ["Ana <ana@example.org>"], subject: "Devis", body: "Bonjour Ana, voici le devis.\n" }));
  paused.clear(laneKey(bot.id, 0));
});

test("L98: a saved skill, the profile and a paused routine are applied at once, with « Annuler »", async () => {
  await say(bot.id, "SAVESKILL");
  assert.ok(skills.list(bot.id).some((k) => k.name === "Invoices"));
  const undo = async () => {
    const r = (await rowsOf(bot.id)).filter((x) => x.body.kind === "notice" && x.body.action?.kind === "undo").at(-1)!;
    const a = r.body.kind === "notice" && r.body.action?.kind === "undo" ? r.body.action : null;
    const res = await call("POST", `/bots/${bot.id}/undo/${a!.undoId}`, { seq: r.seq });
    return { res, r, a };
  };
  let u = await undo();
  assert.equal(u.res.status, 200);
  assert.ok(!skills.list(bot.id).some((k) => k.name === "Invoices"), "the new skill is removed");
  assert.equal((await call("POST", `/bots/${bot.id}/undo/${u.a!.undoId}`, { seq: u.r.seq })).status, 409, "only once");
  const done = (await rowsOf(bot.id)).find((x) => x.seq === u.r.seq)!;
  assert.equal(done.body.kind === "notice" && done.body.action?.kind === "undo" ? done.body.action.status : "", "done");

  await say(bot.id, "SETPROFILE");
  assert.equal(settings.profile(userId).company, "Acme Bakery");
  u = await undo();
  assert.equal(u.res.status, 200);
  assert.equal(settings.profile(userId).company, "", "the profile is back");

  routineId = routines.create(bot.id, { name: "Morning", prompt: "check mail", trigger: "cron", schedule: "0 8 * * *", timezone: "UTC" }).id;
  await say(bot.id, "PAUSEROUTINE");
  assert.equal(routines.byId(routineId)!.enabled, false);
  assert.ok((await rowsOf(bot.id)).some((x) => x.body.kind === "notice" && /paused the routine Morning/.test(x.body.text)));
  u = await undo();
  assert.equal(routines.byId(routineId)!.enabled, true, "running again");
});

test("L98: after the undo window, « Annuler » says so", () => {
  const rec = bots.byId(bot.id)!;
  const id = offerUndo(rec, { kind: "profile", ref: userId, before: settings.profile(userId), text: "x" }, Date.now() - 2 * 86_400_000);
  assert.equal(undoChange(rec, id), "expired");
});

test("L136: editing a sent message keeps the old one and gives the bot the new version", async () => {
  await say(bot.id, "hello ALPHA");
  const mine = (await rowsOf(bot.id)).filter((r) => r.body.kind === "message" && r.body.role === "user" && r.body.text === "hello ALPHA").at(-1)!;
  const before = seen.length;
  const res = await call("POST", `/bots/${bot.id}/rows/${mine.seq}/edit`, { text: "hello BETA" });
  assert.equal(res.status, 200);
  await until(() => seen.slice(before).some((s) => /The user edited one of their earlier messages\. It said:\n«hello ALPHA»/.test(s.last) && /hello BETA/.test(s.last)), "the edited turn");
  await idle(bot.id);
  const old = (await rowsOf(bot.id)).find((r) => r.seq === mine.seq)!;
  assert.equal(old.body.kind === "message" ? old.body.text : "", "hello ALPHA", "still readable");
  assert.equal(old.body.kind === "message" ? old.body.editedTo : 0, res.json.row.seq);
  assert.equal(res.json.row.body.editOf, mine.seq);
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${mine.seq}/edit`, { text: "again" })).status, 409, "edit the newest version");
  const reply = (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.role === "assistant")!;
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${reply.seq}/edit`, { text: "x" })).status, 400, "not the bot's words");
});

test("L136: write the latest reply again; an older one is refused", async () => {
  const replies = (await rowsOf(bot.id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant");
  const before = seen.length;
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${replies.at(-1)!.seq}/regenerate`)).status, 200);
  await until(() => seen.slice(before).some((s) => /The user asked for another answer/.test(s.last)), "the new version");
  await idle(bot.id);
  assert.equal((await rowsOf(bot.id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant").length, replies.length + 1, "the old reply stays, the new one is added");
  assert.equal((await call("POST", `/bots/${bot.id}/rows/${replies[0].seq}/regenerate`)).status, 409);
});

test("L136: a branch from a message is a thread that knows the conversation up to there", async () => {
  const msg = (await rowsOf(bot.id)).find((r) => r.body.kind === "message" && r.body.role === "user" && r.body.text === "hello BETA")!;
  const res = await call("POST", `/bots/${bot.id}/rows/${msg.seq}/branch`);
  assert.equal(res.status, 200);
  assert.equal(res.json.thread, msg.seq);
  const before = seen.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: "try another way", thread: msg.seq });
  await until(() => seen.slice(before).some((s) => /This thread is a branch of your main chat/.test(s.all) && /User: hello ALPHA/.test(s.all) && /try another way/.test(s.last)), "the branch's first turn");
  await idle(bot.id);
});
