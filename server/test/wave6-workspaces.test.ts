import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w6ws-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.MAX_STEPS = "8";
delete process.env.OPEN_SIGNUP;
delete process.env.AUX_MODEL;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { users, rows: rowStore } = await import("../src/store.js");
const { createSession, hashPassword, SESSION_COOKIE } = await import("../src/auth.js");
const { subscribe } = await import("../src/bus.js");
const { q } = await import("../src/db.js");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Card, Row, ServerEvent, Workspace, WorkspaceAdmin } from "../src/shared.js";

await initComputer();
const usage = { inputTokens: 10, outputTokens: 5, cachedTokens: 0 };

/** Scripted model: "call T {json}" → one tool call; else echoes. Each step costs a little (per-member usage). */
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) content = [{ type: "text", text: "Done." }];
    else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{[^\n]*\})/.exec(said);
      content = m ? [{ type: "tool_use", id: `c_${Math.random().toString(36).slice(2, 8)}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said.slice(0, 200)}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "claude-opus-5-5", usage };
  },
});

let aliceCookie = "";
async function call(method: string, url: string, body?: unknown, as = aliceCookie) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: as, origin: "https://sklubot.example", host: "sklubot.example" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text, cookie: set ? set.split(";")[0] : "" };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
/** An account made directly in the store (new accounts are closed on this server), with a session cookie. */
function person(email: string, name: string) {
  const u = users.create(email, name, hashPassword("password123"), "en");
  return { id: u.id, cookie: `${SESSION_COOKIE}=${createSession(u.id).token}` };
}
const cards = (list: Row[], type: Card["type"]) => list.filter((r) => r.body.kind === "card" && r.body.card.type === type).map((r) => (r.body as { card: Card }).card);

let ws: Workspace;
let alice = { id: "", cookie: "" };
let bot: Bot;
let bob = { id: "", cookie: "" };
let carol = { id: "", cookie: "" };
let dave = { id: "", cookie: "" };
let mallory = { id: "", cookie: "" };

test("personal mode is unchanged: one account sees its own bots, nothing shared", async () => {
  const r = await call("POST", "/auth/signup", { email: "alice@example.com", name: "Alice", password: "password123" });
  assert.equal(r.status, 200, r.text);
  aliceCookie = r.cookie;
  alice = { id: r.json.user.id, cookie: aliceCookie };
  const list = (await call("GET", "/bots")).json.bots as Bot[];
  assert.equal(list.length, 1);
  assert.equal(list[0].access, undefined);
  assert.equal(list[0].sharing, null);
  bot = list[0];
  bot = (await call("PATCH", `/bots/${bot.id}`, { model: "script:script-1", autonomy: "trusted" })).json.bot;
  assert.deepEqual((await call("GET", "/workspaces")).json.workspaces, []);
  // New accounts are closed now (one account exists).
  assert.equal((await call("POST", "/auth/signup", { email: "x@example.com", name: "X", password: "password123" }, "")).status, 403);
});

test("invitations: email-bound, single use, expiring; sign-up through an invitation when sign-ups are closed", async () => {
  ws = (await call("POST", "/workspaces", { name: "Studio" })).json.workspace;
  assert.equal(ws.role, "owner");
  const inv = (await call("POST", `/workspaces/${ws.id}/invites`, { email: "bob@example.com", role: "member" })).json.invite;
  assert.match(inv.link, /\/\?invite=/);
  const token = new URL(inv.link).searchParams.get("invite")!;
  // Only a hash is stored.
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM workspace_invites WHERE token_hash = ?", token)!.n, 0);
  assert.equal((await call("GET", `/invites/${token}`, undefined, "")).json.invite.email, "bob@example.com");
  // Someone else cannot sign up with Bob's link (sign-ups stay closed for them).
  assert.equal((await call("POST", "/auth/signup", { email: "eve@example.com", name: "Eve", password: "password123", invite: token }, "")).status, 403);
  // An existing account with another address cannot accept it.
  mallory = person("mallory@example.com", "Mallory");
  assert.equal((await call("POST", "/invites/accept", { token }, mallory.cookie)).status, 403);
  // Bob signs up with his link: the account is created and he joins as a member.
  const r = await call("POST", "/auth/signup", { email: "bob@example.com", name: "Bob", password: "password123", invite: token }, "");
  assert.equal(r.status, 200, r.text);
  bob = { id: r.json.user.id, cookie: r.cookie };
  assert.equal((await call("GET", "/workspaces", undefined, bob.cookie)).json.workspaces[0].role, "member");
  // Single use.
  assert.equal((await call("POST", "/invites/accept", { token }, bob.cookie)).status, 404);
  assert.equal((await call("GET", `/invites/${token}`, undefined, "")).status, 404);
  // Expired links do not work.
  carol = person("carol@example.com", "Carol");
  const late = (await call("POST", `/workspaces/${ws.id}/invites`, { email: "carol@example.com", role: "viewer" })).json.invite;
  q.run("UPDATE workspace_invites SET expires_at = ? WHERE id = ?", Date.now() - 1, late.id);
  assert.equal((await call("POST", "/invites/accept", { token: new URL(late.link).searchParams.get("invite") }, carol.cookie)).status, 404);
  const ok = (await call("POST", `/workspaces/${ws.id}/invites`, { email: "carol@example.com", role: "viewer" })).json.invite;
  assert.equal((await call("POST", "/invites/accept", { token: new URL(ok.link).searchParams.get("invite") }, carol.cookie)).status, 200);
  dave = person("dave@example.com", "Dave");
  const adm = (await call("POST", `/workspaces/${ws.id}/invites`, { email: "dave@example.com", role: "admin" })).json.invite;
  assert.equal((await call("POST", "/invites/accept", { token: new URL(adm.link).searchParams.get("invite") }, dave.cookie)).status, 200);
});

test("seats: members and pending invitations never exceed them; only the owner sets them", async () => {
  assert.equal((await call("PATCH", `/workspaces/${ws.id}`, { seats: 5 }, dave.cookie)).status, 403);
  assert.equal((await call("PATCH", `/workspaces/${ws.id}`, { seats: 2 })).status, 409);
  assert.equal((await call("PATCH", `/workspaces/${ws.id}`, { seats: 5 })).status, 200);
  assert.equal((await call("POST", `/workspaces/${ws.id}/invites`, { email: "f@example.com", role: "member" })).status, 200);
  assert.equal((await call("POST", `/workspaces/${ws.id}/invites`, { email: "g@example.com", role: "member" })).status, 409);
});

test("a bot shared to a list: only the people on it (and admins) see it; viewers read, never write", async () => {
  const share = (await call("PUT", `/bots/${bot.id}/share`, { workspaceId: ws.id, access: "list", memberIds: [bob.id] })).json.share;
  assert.equal(share.access, "list");
  // Bob sees it, with what he may do; the owner's private settings are not in his view.
  const bobs = (await call("GET", "/bots", undefined, bob.cookie)).json.bots as Bot[];
  const seen = bobs.find((b) => b.id === bot.id)!;
  assert.equal(seen.access?.canTalk, true);
  assert.equal(seen.access?.canApprove, false);
  assert.equal(seen.access?.ownerName, "Alice");
  assert.equal(seen.telegram, null);
  // Carol (viewer, not on the list) does not; Dave (admin) does.
  assert.ok(!((await call("GET", "/bots", undefined, carol.cookie)).json.bots as Bot[]).some((b) => b.id === bot.id));
  assert.equal((await call("GET", `/bots/${bot.id}/rows`, undefined, carol.cookie)).status, 404);
  assert.ok(((await call("GET", "/bots", undefined, dave.cookie)).json.bots as Bot[]).some((b) => b.id === bot.id));
  // Shared to everyone: Carol reads, but cannot write or call.
  await call("PUT", `/bots/${bot.id}/share`, { workspaceId: ws.id, access: "all" });
  assert.equal((await call("GET", `/bots/${bot.id}/rows`, undefined, carol.cookie)).status, 200);
  assert.equal((await call("POST", `/bots/${bot.id}/messages`, { text: "hello" }, carol.cookie)).status, 403);
  assert.equal((await call("POST", `/bots/${bot.id}/calls`, undefined, carol.cookie)).status, 403);
});

test("a member's words never authorise the owner's bot; the owner's do; the approval goes to the owner (admins only by rule)", async () => {
  const events: ServerEvent[] = [];
  const off = subscribe(bob.id, (e) => events.push(e));
  // Alice asks herself: grounded in her words, it runs without a card (trusted bot, quote found).
  await call("POST", `/bots/${bot.id}/messages`, { text: 'mets à jour mon entreprise call profile_update {"company":"Acme","user_quote":"mets à jour mon entreprise"}' });
  await until(async () => { const l = (await call("GET", "/bots")).json.live[bot.id]; return !l?.running && !l?.awaiting && (await call("GET", `/bots/${bot.id}/rows`)).json.rows.some((r: Row) => r.body.kind === "step" && r.body.tool === "profile_update"); }, "alice's step");
  assert.equal(cards((await call("GET", `/bots/${bot.id}/rows`)).json.rows, "approval").length, 0);
  // Bob writes the very same words: his message is marked as his, the turn is careful, and a card asks Alice.
  const r = await call("POST", `/bots/${bot.id}/messages`, { text: 'mets à jour mon entreprise call profile_update {"company":"Evil","user_quote":"mets à jour mon entreprise"}' }, bob.cookie);
  assert.equal(r.status, 200, r.text);
  assert.equal(r.json.row.body.origin.kind, "member");
  assert.equal(r.json.row.body.origin.id, bob.id);
  const card = await until(async () => cards((await call("GET", `/bots/${bot.id}/rows`)).json.rows, "approval").find((c) => c.type === "approval" && c.status === "pending") as Extract<Card, { type: "approval" }> | undefined, "approval card");
  // Bob's live events arrived (the shared conversation reached him).
  assert.ok(events.some((e) => e.type === "rows" && e.botId === bot.id));
  off();
  // Bob writing again does not make Alice's pending approval lapse (his message waits for it to be settled).
  await call("POST", `/bots/${bot.id}/messages`, { text: "tu en es où ?" }, bob.cookie);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal((cards((await call("GET", `/bots/${bot.id}/rows`)).json.rows, "approval").find((c) => c.type === "approval" && c.approvalId === card.approvalId) as Extract<Card, { type: "approval" }>).status, "pending");
  // Bob (member) cannot answer it; Dave (admin) cannot while the rule is "owner".
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" }, bob.cookie)).status, 404);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" }, dave.cookie)).status, 404);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" }, mallory.cookie)).status, 404);
  // The owner lets admins answer: Dave refuses it; "always" from an admin would only count once.
  await call("PUT", `/bots/${bot.id}/share`, { workspaceId: ws.id, access: "all", approvals: "owner_or_admins" });
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" }, dave.cookie)).status, 200);
  await until(async () => cards((await call("GET", `/bots/${bot.id}/rows`)).json.rows, "approval").find((c) => c.type === "approval" && c.approvalId === card.approvalId && c.status === "denied"), "denied card");
  assert.equal(q.get<{ n: number }>("SELECT COUNT(*) AS n FROM policies WHERE user_id = ?", alice.id)!.n, 0);
  // Once settled, Bob's waiting message gets its turn.
  await until(async () => ((await call("GET", `/bots/${bot.id}/rows`)).json.rows as Row[]).some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("tu en es où")), "deferred member turn");
  const admin = (await call("GET", `/workspaces/${ws.id}/admin`, undefined, dave.cookie)).json as WorkspaceAdmin;
  assert.ok(admin.audit.some((a) => a.kind === "approval" && a.actorName === "Dave"));
});

test("role escalation attempts are refused", async () => {
  // A member cannot change roles, invite, or see the admin console.
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${bob.id}`, { role: "admin" }, bob.cookie)).status, 403);
  assert.equal((await call("POST", `/workspaces/${ws.id}/invites`, { email: "z@example.com", role: "member" }, bob.cookie)).status, 403);
  assert.equal((await call("GET", `/workspaces/${ws.id}/admin`, undefined, bob.cookie)).status, 403);
  assert.equal((await call("GET", `/workspaces/${ws.id}/export`, undefined, carol.cookie)).status, 403);
  // An admin cannot make admins, touch the owner, invite an admin, or change their own role.
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${bob.id}`, { role: "admin" }, dave.cookie)).status, 403);
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${alice.id}`, { role: "viewer" }, dave.cookie)).status, 403);
  assert.equal((await call("DELETE", `/workspaces/${ws.id}/members/${alice.id}`, undefined, dave.cookie)).status, 403);
  assert.equal((await call("POST", `/workspaces/${ws.id}/invites`, { email: "y@example.com", role: "admin" }, dave.cookie)).status, 403);
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${dave.id}`, { role: "member" }, dave.cookie)).status, 403);
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${dave.id}`, { role: "owner" })).status, 400);
  assert.equal((await call("DELETE", `/workspaces/${ws.id}`, undefined, dave.cookie)).status, 403);
  // What an admin may do: move a viewer to member.
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${carol.id}`, { role: "member" }, dave.cookie)).status, 200);
  await call("PUT", `/workspaces/${ws.id}/members/${carol.id}`, { role: "viewer" }, dave.cookie);
  // Bot settings: an admin changes the name, never the model or autonomy; a member changes nothing.
  const r = await call("PATCH", `/bots/${bot.id}`, { name: "Juno (team)", model: "anthropic:x", autonomy: "trusted", disabledTools: [] }, dave.cookie);
  assert.equal(r.status, 200, r.text);
  const now = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.id === bot.id) as Bot;
  assert.equal(now.name, "Juno (team)");
  assert.equal(now.model, "script:script-1");
  assert.equal((await call("PATCH", `/bots/${bot.id}`, { name: "pwned" }, bob.cookie)).status, 403);
  // Owner-only routes stay owner-only for everyone else, admins included.
  for (const [m, u] of [["DELETE", `/bots/${bot.id}`], ["GET", `/bots/${bot.id}/bundle`], ["GET", `/bots/${bot.id}/files`], ["POST", `/bots/${bot.id}/reset`], ["PUT", `/bots/${bot.id}/share`], ["POST", `/bots/${bot.id}/duplicate`], ["GET", `/bots/${bot.id}/telegram`]] as const)
    for (const who of [dave, bob]) assert.equal((await call(m, u, m === "GET" ? undefined : { workspaceId: ws.id }, who.cookie)).status, 404, `${who === dave ? "admin" : "member"} ${m} ${u}`);
});

test("cross-workspace attacks are refused", async () => {
  // Mallory has her own workspace; nothing of Alice's is reachable from it.
  const mws = (await call("POST", "/workspaces", { name: "Elsewhere" }, mallory.cookie)).json.workspace as Workspace;
  assert.equal((await call("GET", `/bots/${bot.id}/rows`, undefined, mallory.cookie)).status, 404);
  assert.equal((await call("POST", `/bots/${bot.id}/messages`, { text: "hi" }, mallory.cookie)).status, 404);
  assert.equal((await call("GET", `/workspaces/${ws.id}/admin`, undefined, mallory.cookie)).status, 404);
  assert.equal((await call("GET", `/workspaces/${ws.id}/members`, undefined, mallory.cookie)).status, 404);
  assert.equal((await call("POST", `/workspaces/${ws.id}/invites`, { email: "m2@example.com", role: "admin" }, mallory.cookie)).status, 404);
  assert.equal((await call("PUT", `/workspaces/${ws.id}/members/${mallory.id}`, { role: "admin" }, mallory.cookie)).status, 404);
  // She cannot share one of her bots into Alice's workspace, nor Alice's bot into hers.
  const mbot = (await call("POST", "/bots", { name: "Mal" }, mallory.cookie)).json.bot as Bot;
  assert.equal((await call("PUT", `/bots/${mbot.id}/share`, { workspaceId: ws.id }, mallory.cookie)).status, 404);
  assert.equal((await call("PUT", `/bots/${bot.id}/share`, { workspaceId: mws.id }, mallory.cookie)).status, 404);
  // Alice cannot share her bot into Mallory's workspace either (she is not a member there).
  assert.equal((await call("PUT", `/bots/${bot.id}/share`, { workspaceId: mws.id })).status, 404);
  // Dave, admin of Studio, has no say in Elsewhere.
  assert.equal((await call("GET", `/workspaces/${mws.id}/admin`, undefined, dave.cookie)).status, 404);
  // A member list naming outsiders keeps only members of the workspace.
  const share = (await call("PUT", `/bots/${bot.id}/share`, { workspaceId: ws.id, access: "list", memberIds: [bob.id, mallory.id], approvals: "owner_or_admins" })).json.share;
  assert.deepEqual(share.memberIds, [bob.id]);
  // Resources: only your own item, only with the right role.
  const vault = q.get<{ id: string }>("SELECT id FROM vault WHERE user_id = ?", alice.id);
  assert.equal(vault, undefined);
  q.run("INSERT INTO vault (id, user_id, name, created_at) VALUES ('vlt_a', ?, 'Shared login', ?)", alice.id, Date.now());
  assert.equal((await call("POST", `/workspaces/${ws.id}/resources`, { kind: "vault", id: "vlt_a" }, dave.cookie)).status, 404);
  assert.equal((await call("POST", `/workspaces/${ws.id}/resources`, { kind: "vault", id: "vlt_a" }, bob.cookie)).status, 403);
  assert.equal((await call("POST", `/workspaces/${ws.id}/resources`, { kind: "vault", id: "vlt_a" })).json.resources[0].name, "Shared login");
});

test("admin console: usage per member, export, removing a member and deleting their data", async () => {
  const admin = (await call("GET", `/workspaces/${ws.id}/admin`)).json as WorkspaceAdmin;
  const bobUse = admin.usage.find((u) => u.userId === bob.id)!;
  assert.ok(bobUse.messages >= 1);
  assert.ok(bobUse.costUsd > 0, JSON.stringify([bobUse, q.all("SELECT actor_id, cost_usd, model FROM usage")]));
  assert.equal(admin.bots[0].id, bot.id);
  assert.equal(admin.members.length, 4);
  const exp = await call("GET", `/workspaces/${ws.id}/export`);
  assert.equal(exp.status, 200);
  assert.ok(exp.json.messages.some((m: { memberId: string; text: string }) => m.memberId === bob.id && m.text.includes("Evil")));
  // Dave removes Bob and deletes his data: Bob's message is gone, his access too.
  assert.equal((await call("DELETE", `/workspaces/${ws.id}/members/${bob.id}?purge=1`, undefined, dave.cookie)).status, 200);
  const all = rowStore.all(bot.id, bot.generation);
  assert.ok(!all.some((r) => r.body.kind === "message" && r.body.text.includes("Evil")));
  assert.ok(all.some((r) => r.body.kind === "message" && r.body.text === "[deleted]"));
  assert.equal((await call("GET", `/bots/${bot.id}/rows`, undefined, bob.cookie)).status, 404);
  assert.equal((await call("GET", "/workspaces", undefined, bob.cookie)).json.workspaces.length, 0);
  // The workspace log cannot be edited.
  assert.throws(() => q.run("UPDATE workspace_audit SET text = 'x'"));
  // Leaving, and deleting the workspace: the bot is Alice's private bot again.
  assert.equal((await call("DELETE", `/workspaces/${ws.id}/members/${carol.id}`, undefined, carol.cookie)).status, 200);
  assert.equal((await call("DELETE", `/workspaces/${ws.id}`)).status, 200);
  assert.equal((await call("GET", `/bots/${bot.id}/rows`, undefined, dave.cookie)).status, 404);
  assert.equal(((await call("GET", "/bots")).json.bots as Bot[]).find((b) => b.id === bot.id)!.sharing, null);
});
