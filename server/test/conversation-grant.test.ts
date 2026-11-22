import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// « Autoriser pour cette conversation » (agent/conversationgrants.ts): the third answer on an approval card. A grant is
// bound to account · bot · conversation (generation + thread) · tool · place (the permission key an "always" rule
// would carry). It never lifts the deterministic floor, never serves a routine, another conversation, bot or account,
// ends on idle / clear / revoke, and after outside content only covers the recipients it was granted on.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-convgrant-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { newTurn, waitForApproval, runReserved } = await import("../src/agent/loop.js");
const { authorize } = await import("../src/agent/authorize.js");
const { q } = await import("../src/db.js");
const { auditList, bots, policies, rows: rowStore, users } = await import("../src/store.js");
const { listJournal } = await import("../src/journal.js");
const { actionHash } = await import("../src/agent/executions.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { CONVERSATION_GRANT_IDLE_MS } = await import("../src/conversationgranttypes.js");
import type { Block, TurnRequest, TurnResult, ToolUseBlock } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";
import type { ConversationGrantInfo } from "../src/conversationgranttypes.js";
import type { Turn, RemoteTool } from "../src/agent/loop.js";
import type { Decision } from "../src/agent/authorize.js";

let reviewerCalls = 0;
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> {
    reviewerCalls++;
    const content: Block[] = [{ type: "text", text: "{\"decision\":\"ask\",\"reason\":\"je préfère demander\"}" }];
    return { content, stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});

const jars: Record<string, string> = { owner: "", other: "" };
async function call(who: "owner" | "other", method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const REMOTE: Record<string, RemoteTool> = {
  crm__create_contact: { connectorId: "c2", connectorName: "CRM", remoteName: "create_contact", readOnly: false },
  crm__update_contact: { connectorId: "c2", connectorName: "CRM", remoteName: "update_contact", readOnly: false },
  crm__delete_contact: { connectorId: "c2", connectorName: "CRM", remoteName: "delete_contact", readOnly: false, destructive: true },
  stripe__create_charge: { connectorId: "c1", connectorName: "Stripe", remoteName: "create_charge", readOnly: false },
  agenda__create_event: { connectorId: "c3", connectorName: "Agenda", remoteName: "create_event", readOnly: false },
  notes__add_note: { connectorId: "c4", connectorName: "Notes", remoteName: "add_note", readOnly: false },
  gmail__mail_label: { connectorId: "", connectorName: "Gmail", remoteName: "mail_label", readOnly: false, native: { accountId: "acc1", risk: "write", label: "Gmail" } },
};
/** The owner's own words: Camille and Paul are named, so the floor has nothing to say about writing to them. */
const SAID = ["ajoute les nouveaux contacts dans le CRM", "invite Camille (camille@exemple.fr) et Paul (paul@exemple.fr) à la réunion pour le devis"];

const clickTool = builtinTools().find((t) => t.spec.name === "screen_click")!;
let ownerId = "", otherId = "";
async function makeBot(who: "owner" | "other", name: string, autonomy = "balanced"): Promise<string> {
  const b = (await call(who, "POST", "/bots", { name })).json.bot as Bot;
  await call(who, "PATCH", `/bots/${b.id}`, { model: "script:script-1", autonomy });
  for (const s of SAID) rowStore.append(bots.byId(b.id)!, { kind: "message", role: "user", text: s });
  return b.id;
}
/** A turn the owner started by writing in that conversation (origin "user"), with the app tools under test. */
async function turnOf(botId: string, o: { origin?: string; thread?: number; tainted?: boolean } = {}): Promise<Turn> {
  const bot = bots.byId(botId)!;
  const t = await newTurn(bot, users.byId(bot.userId)!, 0, new AbortController().signal);
  for (const [k, v] of Object.entries(REMOTE)) t.remote.set(k, v);
  if (!t.builtin.has("screen_click")) t.builtin.set("screen_click", clickTool);
  t.origin = o.origin ?? "user";
  t.thread = o.thread ?? 0;
  t.tainted = !!o.tainted;
  return t;
}
let n = 0;
const use = (name: string, input: Record<string, unknown> = {}): ToolUseBlock => ({ type: "tool_use", id: `x${++n}`, name, input: { ...input } });
const contact = (name = "Paul") => use("crm__create_contact", { name });
type AskDecision = Extract<Decision, { kind: "ask" }>;
function asks(d: Decision, label: string): AskDecision { assert.equal(d.kind, "ask", `${label}: must ask`); return d as AskDecision; }
function passes(d: Decision, label: string): string {
  assert.equal(d.kind, "allow", `${label}: must pass without asking`);
  if (d.kind !== "allow") return "";
  assert.equal(d.grant?.by, "conversation", label);
  assert.ok(d.grant?.grantId, label);
  return d.grant!.grantId!;
}
/** Shows the card for this call (as the loop does) and answers it through the real route, as `who`. */
async function answer(turn: Turn, c: ToolUseBlock, decision: string, who: "owner" | "other" = "owner"): Promise<{ status: string; http: number; card: Extract<Card, { type: "approval" }>; ask: AskDecision }> {
  const ask = asks(await authorize(turn, c), "before any grant");
  const out: { approvalId?: string } = {};
  const waiting = waitForApproval(turn, c, ask, out);
  const r = await call(who, "POST", `/approvals/${out.approvalId}`, { decision });
  if (r.status !== 200) await call("owner", "POST", `/approvals/${out.approvalId}`, { decision: "deny" });
  const status = await waiting;
  const rowsNow = (await call("owner", "GET", `/bots/${turn.bot.id}/rows?limit=500`)).json.rows as Row[];
  const card = rowsNow.map((x) => (x.body.kind === "card" ? x.body.card : null)).find((x) => x?.type === "approval" && x.approvalId === out.approvalId) as Extract<Card, { type: "approval" }>;
  return { status, http: r.status, card, ask };
}
const grantsOf = async (who: "owner" | "other" = "owner") => (await call(who, "GET", "/conversation-grants")).json.grants as ConversationGrantInfo[];
const stateOf = (id: string) => q.get<{ state: string; ended_reason: string | null; uses: number }>("SELECT state, ended_reason, uses FROM conversation_grants WHERE id = ?", id);

test("setup: two accounts", async () => {
  const a = await call("owner", "POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password123", locale: "fr" });
  assert.equal(a.status, 200, a.text);
  ownerId = a.json.user.id;
  const b = await call("other", "POST", "/auth/signup", { email: "other@example.com", name: "Other", password: "password123", locale: "fr" });
  assert.equal(b.status, 200, b.text);
  otherId = b.json.user.id;
  assert.notEqual(ownerId, otherId);
});

let botId = "", grantId = "";

test("the card offers it; once granted, the same tool at the same place passes without asking — and nothing else does", async () => {
  botId = await makeBot("owner", "Juno");
  const turn = await turnOf(botId);
  const first = await answer(turn, contact("Paul"), "conversation");
  assert.equal(first.ask.conversation, true, "the card offers « pour cette conversation »");
  assert.equal(first.ask.policyKey, "CRM: create_contact");
  assert.equal(first.status, "allowed", "it is first a yes for the action on the card");
  assert.equal(first.card.conversation, true);
  assert.equal(first.card.grantedFor, "conversation");
  const list = await grantsOf();
  assert.equal(list.length, 1);
  grantId = list[0].id;
  assert.deepEqual({ botId: list[0].botId, place: list[0].place, thread: list[0].thread, uses: list[0].uses }, { botId, place: "CRM: create_contact", thread: 0, uses: 0 });
  assert.ok(Math.abs(list[0].expiresAt - (Date.now() + CONVERSATION_GRANT_IDLE_MS)) < 60_000, "12 h after the owner last wrote");
  assert.equal(policies.get(ownerId, "CRM: create_contact"), null, "no standing rule was saved");

  // Same tool, same place, same conversation — other arguments, a later turn of the owner: no card.
  assert.equal(passes(await authorize(turn, contact("Paul")), "same action"), grantId);
  assert.equal(passes(await authorize(await turnOf(botId), contact("Zoé")), "same tool and place, a later turn"), grantId);
  assert.equal(stateOf(grantId)!.uses, 2);

  // A different tool (even of the same app), and a different app.
  assert.equal(asks(await authorize(turn, use("crm__update_contact", { id: "1", name: "Paul" })), "different tool").policyKey, "CRM: update_contact");
  asks(await authorize(turn, use("notes__add_note", { text: "x" })), "different app");
  // A different conversation of the same bot: a thread.
  asks(await authorize(await turnOf(botId, { thread: 7 }), contact()), "different conversation (thread)");
  // A routine, another bot's message, a system turn, a turn that resumed by itself, a member, the Bot API.
  for (const origin of ["routine", "bot", "system", "resume", "nudge", "member", "api", undefined]) {
    const t = await turnOf(botId);
    t.origin = origin;
    const d = asks(await authorize(t, contact()), `origin ${origin}`);
    assert.notEqual(d.conversation, true, `origin ${origin}: not even offered`);
  }
  // Another bot of the same account.
  const second = await makeBot("owner", "Max");
  asks(await authorize(await turnOf(second), contact()), "different bot");
  // Another account, with a bot of its own doing the same thing.
  const theirs = await makeBot("other", "Juno");
  asks(await authorize(await turnOf(theirs), contact()), "other account");
});

test("same tool, different place: a click granted on one site still asks on another", async () => {
  const turn = await turnOf(botId);
  const click = (host: string) => use("screen_click", { x: 10, y: 10, seen_target: { label: "Enregistrer", host, form: "" } });
  const first = await answer(turn, click("compta.example"), "conversation");
  assert.equal(first.ask.policyKey, "click: compta.example");
  assert.equal(first.card.grantedFor, "conversation");
  passes(await authorize(turn, click("compta.example")), "same site");
  assert.equal(asks(await authorize(turn, click("ailleurs.example")), "another site").policyKey, "click: ailleurs.example");
  // A click that pays or deletes on the granted site is the floor's: never covered.
  const pay = asks(await authorize(turn, use("screen_click", { x: 1, y: 1, seen_target: { label: "Payer", host: "compta.example", form: "" } })), "paying click");
  assert.equal(pay.once, true);
  assert.notEqual(pay.conversation, true);
});

test("the floor stays above it: payments and deletions always ask, never offer it, and a forged grant changes nothing", async () => {
  const turn = await turnOf(botId);
  const floor: [ToolUseBlock, string][] = [[use("stripe__create_charge", { amount: 20, currency: "EUR" }), "Stripe: create_charge"], [use("crm__delete_contact", { id: "martin" }), "CRM: delete_contact"]];
  for (const [c, place] of floor) {
    const d = asks(await authorize(turn, c), place);
    assert.equal(d.once, true, `${place}: single use`);
    assert.notEqual(d.conversation, true, `${place}: « pour cette conversation » is not offered`);
    // The owner's own client sends "conversation" anyway: it counts as once, and no grant is made.
    const before = (await grantsOf()).length;
    const a = await answer(turn, { ...c, id: `again${++n}` }, "conversation");
    assert.equal(a.status, "allowed");
    assert.notEqual(a.card.grantedFor, "conversation");
    assert.equal((await grantsOf()).length, before, `${place}: no grant`);
    // Even a grant written straight into the table (which nothing in the product does) does not lift the floor.
    q.run("INSERT INTO conversation_grants (id, user_id, bot_id, generation, thread, tool, place, label, hashes, state, created_at, granted_at) VALUES (?, ?, ?, ?, 0, ?, ?, 'forged', ?, 'active', ?, ?)",
      `cgr_forged_${c.name}`, ownerId, botId, bots.byId(botId)!.generation, c.name, place, JSON.stringify([actionHash(c.name, c.input)]), Date.now(), Date.now());
    for (const tainted of [false, true]) for (const autonomy of ["careful", "balanced", "trusted", "auto"] as const) {
      const t = await turnOf(botId, { tainted });
      t.bot = { ...t.bot, autonomy };
      const again = asks(await authorize(t, c), `${place} · ${autonomy} · ${tainted ? "tainted" : "clean"} with a forged grant`);
      assert.equal(again.once, true);
    }
    q.run("DELETE FROM conversation_grants WHERE id = ?", `cgr_forged_${c.name}`);
  }
});

test("never wider than « Toujours »: where a standing rule would not be honoured, neither is the grant", async () => {
  // A built-in app write after outside content asks whatever was allowed before (judgeNative): not offered, not covered.
  const tainted = await turnOf(botId, { tainted: true });
  const label = use("gmail__mail_label", { id: "m1", label: "Devis" });
  const d = asks(await authorize(tainted, label), "built-in app write after outside content");
  assert.notEqual(d.conversation, true);
  // In a clean turn it is offered and granted; the tainted turn still asks.
  const clean = await turnOf(botId);
  const g = await answer(clean, label, "conversation");
  assert.equal(g.card.grantedFor, "conversation");
  passes(await authorize(clean, { ...label, id: "l2" }), "clean turn");
  asks(await authorize(tainted, { ...label, id: "l3" }), "the same action after outside content");
  // The owner's own "ask first" on that key wins over the grant.
  policies.set(ownerId, "CRM: create_contact", "needs_approval");
  const strict = asks(await authorize(clean, contact()), "« demande d'abord »");
  assert.notEqual(strict.conversation, true);
  policies.set(ownerId, "CRM: create_contact", "blocked");
  assert.equal((await authorize(clean, contact())).kind, "block");
  policies.remove(ownerId, "CRM: create_contact");
  passes(await authorize(clean, contact()), "back to the grant");
});

test("after outside content, only the recipients it was granted on — and the probe never spends a model call", async () => {
  const b = await makeBot("owner", "Courrier");
  const clean = await turnOf(b);
  // (A message or an e-mail is irreversible: its card is single use and never offers this. An invitation is not.)
  const mail = (to: string) => use("agenda__create_event", { title: "Devis", attendees: to.split(", ") });
  const first = await answer(clean, mail("camille@exemple.fr"), "conversation");
  assert.equal(first.card.grantedFor, "conversation");
  // A clean turn of the owner: the place is granted, as an "always" rule would allow — within this conversation.
  passes(await authorize(clean, mail("paul@exemple.fr")), "clean turn, another recipient the owner named");
  // Outside content was read: the granted recipient passes, another one asks (Paul was named, so the floor is silent:
  // it is the grant itself that refuses to stretch).
  const tainted = await turnOf(b, { tainted: true });
  passes(await authorize(tainted, mail("camille@exemple.fr")), "tainted, granted recipient");
  const other = asks(await authorize(tainted, mail("paul@exemple.fr")), "tainted, different recipient");
  assert.equal(other.policyKey, "Agenda: create_event");
  asks(await authorize(tainted, mail("camille@exemple.fr, paul@exemple.fr")), "tainted, one recipient more");
  // No recipient to compare (a CRM contact): after outside content only the exact action the owner saw on the card.
  const crm = await turnOf(botId, { tainted: true });
  passes(await authorize(crm, contact("Paul")), "tainted, the exact action granted");
  asks(await authorize(crm, contact("Pirate")), "tainted, another action");

  const before = reviewerCalls;
  const auto = await turnOf(botId);
  auto.bot = { ...auto.bot, autonomy: "auto" };
  await authorize(auto, use("notes__add_note", { text: "x" }));
  assert.ok(reviewerCalls - before <= 1, "the reviewer is asked once at most: the grant's own probe never calls a model");
});

test("someone else's click never makes a grant; bots have no tool for it", async () => {
  const turn = await turnOf(botId);
  const c = use("notes__add_note", { text: "liste" });
  // Another account answering the owner's card: 404, nothing granted.
  const foreign = await answer(turn, c, "conversation", "other");
  assert.equal(foreign.http, 404);
  assert.notEqual(foreign.card.grantedFor, "conversation");
  asks(await authorize(turn, { ...c, id: "n2" }), "after a stranger's attempt");
  assert.deepEqual(await grantsOf("other"), [], "the other account sees none of the owner's grants");
  assert.equal((await call("other", "DELETE", `/conversation-grants/${grantId}`)).status, 404, "nor can it revoke one");
  assert.equal(stateOf(grantId)!.state, "active");
  // Nothing a model can call creates, extends or lists grants.
  const names = [...turn.builtin.keys(), ...turn.tools.map((t) => t.name)];
  assert.deepEqual(names.filter((x) => /grant|conversation_allow/i.test(x)), []);
  assert.doesNotMatch(turn.system, /conversation-grants|pour cette conversation|for this conversation/i);
});

test("every use is in the journal and the audit log, with the grant that allowed it", async () => {
  const turn = await turnOf(botId);
  const c = contact("Lina");
  const d = await authorize(turn, c);
  const id = passes(d, "granted");
  // The connector does not exist here: the run fails, and is journalled all the same.
  await runReserved(turn, c, d.kind === "allow" ? d.grant : undefined, "", actionHash(c.name, c.input), () => {});
  const line = listJournal(ownerId, { botId }).find((e) => e.tool === "crm__create_contact");
  assert.ok(line, "a journal line");
  assert.equal(line!.decision, "conversation");
  assert.match(line!.reason || "", new RegExp(id));
  assert.equal(line!.origin, "user");
  const audit = auditList(ownerId, undefined, 200).map((a) => a.text);
  assert.ok(audit.some((x) => x.includes("autorisé pour cette conversation") && x.includes(id)), "the grant itself is in the audit log");
});

test("it ends by itself: nothing written by the owner for 12 h (using it does not keep it alive)", async () => {
  const b = await makeBot("owner", "Veille");
  const turn = await turnOf(b);
  await answer(turn, contact(), "conversation");
  const id = passes(await authorize(turn, contact()), "fresh grant");
  const info = (await grantsOf()).find((g) => g.id === id)!;
  assert.equal(info.uses, 1);
  // 11 h later it still holds; its end did not move because the bot used it.
  const hours = (h: number) => {
    const at = Date.now() - h * 3_600_000;
    q.run("UPDATE conversation_grants SET granted_at = ?, created_at = ? WHERE id = ?", at, at, id);
    q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", at, b);
  };
  hours(11);
  passes(await authorize(turn, contact()), "11 h later");
  const later = (await grantsOf()).find((g) => g.id === id)!;
  assert.ok(Math.abs(later.expiresAt - (Date.now() + 3_600_000)) < 60_000, "one hour left: uses do not push the end back");
  // The owner writes again: 12 h from that message.
  rowStore.append(bots.byId(b)!, { kind: "message", role: "user", text: "continue" });
  assert.ok((await grantsOf()).find((g) => g.id === id)!.expiresAt > Date.now() + 11 * 3_600_000);
  // 13 h of silence (what a restart finds in the database is enough to end it: nothing lives in memory).
  hours(13);
  const d = asks(await authorize(turn, contact()), "13 h later");
  assert.equal(d.conversation, true, "the card offers it again");
  assert.deepEqual({ ...stateOf(id) }, { state: "ended", ended_reason: "idle", uses: 2 });
  assert.equal((await grantsOf()).some((g) => g.id === id), false);
});

test("the owner revokes it (Settings → Permissions)", async () => {
  const b = await makeBot("owner", "Retrait");
  const turn = await turnOf(b);
  await answer(turn, contact(), "conversation");
  const id = passes(await authorize(turn, contact()), "granted");
  assert.equal((await call("owner", "DELETE", `/conversation-grants/${id}`)).status, 200);
  asks(await authorize(turn, contact()), "after revoking");
  assert.equal(stateOf(id)!.ended_reason, "revoked");
  assert.equal((await call("owner", "DELETE", `/conversation-grants/${id}`)).status, 404, "already gone");
  assert.ok(auditList(ownerId, undefined, 200).some((a) => a.text.includes(id) && /retirée par toi/.test(a.text)));
});

test("clearing the conversation ends it", async () => {
  const b = await makeBot("owner", "Efface");
  const turn = await turnOf(b);
  await answer(turn, contact(), "conversation");
  const id = passes(await authorize(turn, contact()), "granted");
  assert.equal((await call("owner", "POST", `/bots/${b}/reset`)).status, 200);
  for (const s of SAID) rowStore.append(bots.byId(b)!, { kind: "message", role: "user", text: s });
  asks(await authorize(await turnOf(b), contact()), "the new conversation");
  asks(await authorize(turn, contact()), "a turn left over from the cleared conversation");
  assert.equal((await grantsOf()).some((g) => g.id === id), false);
  assert.equal(stateOf(id)!.ended_reason, "cleared");
  // Deleting the bot removes its grants with it.
  await answer(await turnOf(b), contact(), "conversation");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM conversation_grants WHERE bot_id = ? AND state = 'active'", b)!.n, 1);
  assert.equal((await call("owner", "DELETE", `/bots/${b}`)).status, 200);
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM conversation_grants WHERE bot_id = ?", b)!.n, 0);
});
