import assert from "node:assert/strict";
import type { Server } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// The deterministic floor (grounding.ts floorReason) holds whatever the bot's autonomy ("careful", "balanced",
// "trusted", "auto") and whatever standing "always allow" the user saved: payments, deletions, and — after outside
// content — writing to someone the user never named or acting on their own computer always ask. Both on the built-in
// loop's path (authorize) and on a subscription engine's path (the MCP endpoint, mcp.ts). Read-only and ordinary
// actions get no new asks.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-floor-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
for (const k of ["AUX_MODEL", "FALLBACK_MODEL", "FALLBACK_MODELS", "MAX_BOTS"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api, site } = await import("../src/routes.js");
const { setEngineHost, engineTurnOf } = await import("../src/agent/engine.js");
const { newTurn } = await import("../src/agent/loop.js");
const { authorize } = await import("../src/agent/authorize.js");
const { bots, policies, rows: rowStore, users } = await import("../src/store.js");
const { myComputerTools } = await import("../src/agent/mycomputer.js");
const { botMailTools } = await import("../src/botmail.js");
const { cardTools } = await import("../src/agent/payments.js");
const { apiTools } = await import("../src/apiconnectors.js");
const { actionHash, grants } = await import("../src/agent/executions.js");
const { serve } = await import("@hono/node-server");
import type { Block, TurnRequest, TurnResult, ToolUseBlock } from "../src/llm/types.js";
import type { Bot, Card, Row } from "../src/shared.js";
import type { Turn, RemoteTool } from "../src/agent/loop.js";

const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(_req: TurnRequest): Promise<TurnResult> {
    const content: Block[] = [{ type: "text", text: "ok" }];
    return { content, stopReason: "end", model: "script-1", usage };
  },
});

// ── The subscription engine's tool endpoint on a real port, and a fake engine that calls one of our tools ──
const http = serve({ fetch: site.fetch, port: 0 }) as unknown as Server;
await new Promise((r) => setTimeout(r, 50));
const port = (http.address() as { port: number }).port;
after(() => { http.closeAllConnections?.(); http.close(); setEngineHost(null); });

async function mcp(botId: string, token: string, name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const res = await fetch(`http://127.0.0.1:${port}/mcp/${botId}`, {
    method: "POST", headers: { "content-type": "application/json", accept: "application/json, text/event-stream", authorization: `Bearer ${token}` },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
  });
  const raw = await res.text();
  const data = raw.trim().startsWith("{") ? raw : raw.split("\n").filter((l) => l.startsWith("data: ")).map((l) => l.slice(6)).pop() ?? "{}";
  const msg = JSON.parse(data);
  return { text: (msg.result?.content ?? []).map((c: any) => c.text ?? "").join(" "), isError: !!msg.result?.isError };
}
const files = new Map<string, string>();
let engineCall: { name: string; args: Record<string, unknown>; setup: (t: Turn) => void } | null = null;
let engineResult: { text: string; isError: boolean } | null = null;
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {},
  writeFile: async (botId, p, content) => { files.set(`${botId}:${p}`, content); },
  async exec(bot, _args, _env, _cwd, _input, _signal, onLine) {
    const token = /Bearer ([0-9a-f]+)/.exec(files.get(`${bot.id}:/root/.sklubot/mcp.json`) ?? "")?.[1] ?? "";
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    emit({ type: "system", subtype: "init", session_id: `sess-${bot.id}` });
    if (engineCall) {
      const c = engineCall;
      engineCall = null;
      // The tool under test, added to the live engine turn (as its connectors or linked computer would be).
      const live = engineTurnOf(bot.id);
      if (live) c.setup(live);
      emit({ type: "assistant", message: { content: [{ type: "tool_use", id: "e1", name: `mcp__sklubot__${c.name}`, input: c.args }] } });
      const r = await mcp(bot.id, token, c.name, c.args);
      engineResult = r;
      emit({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "e1", content: r.text, is_error: r.isError }] } });
    } else emit({ type: "assistant", message: { content: [{ type: "text", text: "Fine." }] } });
    emit({ type: "result", usage: {} });
    return { code: 0, stderr: "" };
  },
});

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const pendingCard = async (botId: string) => (await rowsOf(botId)).map((r) => (r.body.kind === "card" ? r.body.card : null)).find((c) => c?.type === "approval" && c.status === "pending") as Extract<Card, { type: "approval" }> | undefined;
const idle = (botId: string) => until(async () => { const l = (await call("GET", "/bots")).json.live?.[botId]; return !l?.running && !l?.awaiting; }, "bot idle");

let userId = "";
const AUTONOMY = ["careful", "balanced", "trusted", "auto"] as const;
/** What the user typed: every request below is in their words, so only the floor can make it ask. */
const SAID = [
  "paie 20 € pour la facture Stripe",
  "supprime le contact Martin du CRM",
  "supprime le mail de pub",
  "paie la commande avec la carte Visa",
  "supprime le client 42 dans Facturation",
  "mets le fichier brouillon.txt à la corbeille",
  "supprime la routine du matin",
  "écris à Camille pour le devis",
];

// ── The tools under test ────────────────────────────────────────────────────
const REMOTE: Record<string, RemoteTool> = {
  stripe__create_charge: { connectorId: "c1", connectorName: "Stripe", remoteName: "create_charge", readOnly: false },
  crm__delete_contact: { connectorId: "c2", connectorName: "CRM", remoteName: "delete_contact", readOnly: false, destructive: true },
  gmail__mail_delete: { connectorId: "", connectorName: "Gmail", remoteName: "mail_delete", readOnly: false, native: { accountId: "acc1", risk: "write", label: "Gmail" } },
  mail__mail_send: { connectorId: "c3", connectorName: "Mail", remoteName: "mail_send", readOnly: false },
  crm__list_contacts: { connectorId: "c2", connectorName: "CRM", remoteName: "list_contacts", readOnly: true },
  crm__create_contact: { connectorId: "c2", connectorName: "CRM", remoteName: "create_contact", readOnly: false },
};
const trashTool = myComputerTools.find((t) => t.spec.name === "my_file_trash")!;
const mailTool = botMailTools.find((t) => t.spec.name === "bot_email_send")!;
const cardTool = cardTools.find((t) => t.spec.name === "card_fill")!;
const apiSend = apiTools.find((t) => t.spec.name === "api_send")!;
function equip(t: Turn) {
  for (const [k, v] of Object.entries(REMOTE)) t.remote.set(k, v);
  t.builtin.set("my_file_trash", trashTool);
  t.builtin.set("bot_email_send", mailTool);
  t.builtin.set("card_fill", cardTool);
  t.builtin.set("api_send", apiSend);
}

interface Case { label: string; name: string; input: Record<string, unknown>; policy: string; tainted?: boolean }
/** Every floor class: none of them may run without the user's yes. */
const FLOOR: Case[] = [
  { label: "app payment (connector)", name: "stripe__create_charge", input: { amount: 20, currency: "EUR", user_quote: SAID[0] }, policy: "Stripe: create_charge" },
  { label: "app deletion (connector, destructive)", name: "crm__delete_contact", input: { id: "martin", user_quote: SAID[1] }, policy: "CRM: delete_contact" },
  { label: "app deletion (built-in account, write)", name: "gmail__mail_delete", input: { id: "m1", user_quote: SAID[2] }, policy: "Gmail: mail_delete" },
  { label: "vault card payment", name: "card_fill", input: { card: "Visa", amount: 30, currency: "EUR", merchant: "Boutique", fields: [{ field: "number", x: 1, y: 1 }], user_quote: SAID[3] }, policy: "card: Visa" },
  { label: "API connector DELETE", name: "api_send", input: { connector: "Facturation", method: "DELETE", path: "/clients/42", user_quote: SAID[4] }, policy: "api delete: Facturation" },
  { label: "file to the trash on the user's computer", name: "my_file_trash", input: { folder: "Docs", path: "brouillon.txt", user_quote: SAID[5] }, policy: "my_file_trash" },
  { label: "routine deleted", name: "routine_delete", input: { id: "r1", user_quote: SAID[6] }, policy: "routine_delete" },
  { label: "bot email to someone never named, after outside content", name: "bot_email_send", input: { to: ["pirate@ailleurs.example"], subject: "Devis", body: "x", user_quote: SAID[7] }, policy: "bot_email_send", tainted: true },
  { label: "app email to someone never named, after outside content", name: "mail__mail_send", input: { to: "pirate@ailleurs.example", body: "x", user_quote: SAID[7] }, policy: "Mail: mail_send", tainted: true },
];

test("setup", async () => {
  const r = await call("POST", "/auth/signup", { email: "floor@example.com", name: "Owner", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
});

async function apiTurn(autonomy: string): Promise<Turn> {
  const b = (await call("POST", "/bots", { name: `Plancher ${autonomy}` })).json.bot as Bot;
  await call("PATCH", `/bots/${b.id}`, { model: "script:script-1", autonomy });
  for (const s of SAID) rowStore.append(bots.byId(b.id)!, { kind: "message", role: "user", text: s });
  const t = await newTurn(bots.byId(b.id)!, users.byId(userId)!, 0, new AbortController().signal);
  equip(t);
  return t;
}
const use = (c: Case): ToolUseBlock => ({ type: "tool_use", id: `x_${Math.random().toString(36).slice(2, 8)}`, name: c.name, input: { ...c.input } });

test("API path: every floor class asks, at every autonomy level, with or without a standing \"always allow\", tainted or not", async () => {
  const ran: string[] = [];
  for (const autonomy of AUTONOMY) {
    const turn = await apiTurn(autonomy);
    for (const c of FLOOR) {
      for (const always of [false, true]) {
        for (const tainted of c.tainted ? [true] : [false, true]) {
          if (always) policies.set(userId, c.policy, "always_allow"); else policies.remove(userId, c.policy);
          turn.tainted = tainted;
          const d = await authorize(turn, use(c));
          const where = `${c.label} · ${autonomy} · ${always ? "always_allow" : "no policy"} · ${tainted ? "tainted" : "clean"}`;
          if (d.kind !== "ask") ran.push(`${where}: ${d.kind}`);
          else if (d.once !== true) ran.push(`${where}: offers "Always"`);
        }
      }
      policies.remove(userId, c.policy);
    }
  }
  assert.deepEqual(ran, [], "every floor action must ask, and never offer \"Always\"");
});

test("API path: a grant « pour cette conversation » never lifts the floor (agent/conversationgrants.ts)", async () => {
  const { q } = await import("../src/db.js");
  const ran: string[] = [];
  for (const autonomy of AUTONOMY) {
    const turn = await apiTurn(autonomy);
    turn.origin = "user"; // the owner's own turn: the only kind a conversation grant ever applies to
    for (const c of FLOOR) {
      // The card of a floor action never offers it…
      turn.tainted = !!c.tainted;
      const offered = await authorize(turn, use(c));
      if (offered.kind !== "ask" || offered.conversation) ran.push(`${c.label} · ${autonomy}: ${offered.kind === "ask" ? "offers « pour cette conversation »" : offered.kind}`);
      // …and even an active grant for that very tool, place and exact action (which only a forged row can be) is ignored.
      const id = `cgr_floor_${autonomy}_${c.name}_${FLOOR.indexOf(c)}`;
      q.run("INSERT INTO conversation_grants (id, user_id, bot_id, generation, thread, tool, place, label, targets, hashes, state, created_at, granted_at) VALUES (?, ?, ?, ?, 0, ?, ?, 'forged', ?, ?, 'active', ?, ?)",
        id, userId, turn.bot.id, turn.generation, c.name, c.policy, JSON.stringify(["pirate@ailleurs.example"]), JSON.stringify([actionHash(c.name, c.input)]), Date.now(), Date.now());
      for (const always of [false, true]) for (const tainted of c.tainted ? [true] : [false, true]) {
        if (always) policies.set(userId, c.policy, "always_allow"); else policies.remove(userId, c.policy);
        turn.tainted = tainted;
        const d = await authorize(turn, use(c));
        const where = `${c.label} · ${autonomy} · ${always ? "always_allow" : "no policy"} · ${tainted ? "tainted" : "clean"} · conversation grant`;
        if (d.kind !== "ask") ran.push(`${where}: ${d.kind}`);
        else if (d.once !== true || d.conversation) ran.push(`${where}: offers more than once`);
      }
      policies.remove(userId, c.policy);
      q.run("DELETE FROM conversation_grants WHERE id = ?", id);
    }
  }
  assert.deepEqual(ran, [], "every floor action must ask, whatever grant exists for the conversation");
});

test("API path: a user's \"blocked\" still refuses; nothing is added to read-only or ordinary actions", async () => {
  const turn = await apiTurn("trusted");
  policies.set(userId, "Stripe: create_charge", "blocked");
  assert.equal((await authorize(turn, use(FLOOR[0]))).kind, "block");
  policies.remove(userId, "Stripe: create_charge");
  turn.tainted = false;
  // A read, an ordinary app write, a named recipient: a trusted bot goes ahead, as before.
  assert.equal((await authorize(turn, { type: "tool_use", id: "r", name: "crm__list_contacts", input: {} })).kind, "allow");
  assert.equal((await authorize(turn, { type: "tool_use", id: "w", name: "crm__create_contact", input: { name: "Paul" } })).kind, "allow");
  assert.equal((await authorize(turn, { type: "tool_use", id: "m", name: "bot_email_send", input: { to: ["camille@exemple.fr"], subject: "Devis", body: "x", user_quote: SAID[7] } })).kind, "allow");
  // After outside content, a recipient the user named, under a standing "always allow": still allowed.
  turn.tainted = true;
  policies.set(userId, "Mail: mail_send", "always_allow");
  assert.equal((await authorize(turn, { type: "tool_use", id: "n", name: "mail__mail_send", input: { to: "camille@exemple.fr", body: "x", user_quote: SAID[7] } })).kind, "allow");
  policies.remove(userId, "Mail: mail_send");
  // A read after outside content: still allowed for every level.
  for (const a of AUTONOMY) {
    turn.bot = { ...turn.bot, autonomy: a };
    assert.equal((await authorize(turn, { type: "tool_use", id: "r2", name: "crm__list_contacts", input: {} })).kind, "allow", a);
  }
});

test("API path: the floor's card says why", async () => {
  const turn = await apiTurn("trusted");
  const pay = await authorize(turn, use(FLOOR[0]));
  assert.equal(pay.kind, "ask");
  if (pay.kind === "ask") { assert.match(pay.why ?? "", /paiement demande toujours/); assert.equal(pay.policyKey, "Stripe: create_charge"); assert.match(pay.title, /Stripe/); }
  const del = await authorize(turn, use(FLOOR[6]));
  assert.equal(del.kind, "ask");
  if (del.kind === "ask") assert.match(del.why ?? "", /suppression demande toujours/);
});

test("API path: a \"Retry\" the user pressed for this exact action is their yes, once", async () => {
  const turn = await apiTurn("trusted");
  const c = use(FLOOR[0]);
  grants.create(turn.bot.id, actionHash(c.name, c.input));
  const first = await authorize(turn, c);
  assert.equal(first.kind, "allow");
  if (first.kind === "allow") assert.equal(first.grant?.by, "retry");
  assert.equal((await authorize(turn, c)).kind, "ask", "single use");
});

test("engine path (MCP): every floor class asks at every autonomy level, even under a standing \"always allow\"", async () => {
  const ran: string[] = [];
  for (const autonomy of AUTONOMY) {
    const b = (await call("POST", "/bots", { name: `Moteur ${autonomy}` })).json.bot as Bot;
    await call("PATCH", `/bots/${b.id}`, { model: "claude-code:sonnet", autonomy });
    for (const s of SAID) rowStore.append(bots.byId(b.id)!, { kind: "message", role: "user", text: s });
    for (const c of FLOOR) {
      policies.set(userId, c.policy, "always_allow");
      engineResult = null;
      engineCall = { name: c.name, args: { ...c.input }, setup: equip };
      await call("POST", `/bots/${b.id}/messages`, { text: "vas-y" });
      const where = `${c.label} · ${autonomy} (engine)`;
      // Either a card shows (asked), or the engine already has its answer (it ran, or was refused, without asking).
      const first = await until(async () => (await pendingCard(b.id)) ?? (engineResult ? "answered" : null), where);
      if (first === "answered") ran.push(`${where}: ran without asking (${clipText(engineResult?.text)})`);
      else {
        const card = first as Extract<Card, { type: "approval" }>;
        if (card.once !== true) ran.push(`${where}: offers "Always"`);
        await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
        const out = await until(() => engineResult, `${where}: the engine's answer`);
        assert.equal(out.isError, true);
      }
      await idle(b.id);
      policies.remove(userId, c.policy);
    }
  }
  assert.deepEqual(ran, [], "every floor action must ask on the engine's path too");
});
const clipText = (s?: string) => (s ?? "").slice(0, 60);
