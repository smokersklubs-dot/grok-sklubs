import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L91: « case masquée » (a one-time code typed by the user into a hidden box goes straight into the page's field; the bot
// never sees it) and « fais-le toi-même » (ask_takeover reason password). Also the routes of L95 (computer hours) and
// L83 (mail signature) through the API, with their account checks.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-codebox-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";
process.env.DEFAULT_MODEL = "demo:demo";
process.env.CODE_WAIT_MS = "20000";

const { api } = await import("../src/routes.js");
const { bots, users, rows } = await import("../src/store.js");
const { TAKEOVER_REASONS } = await import("../src/shared.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { answerCode } = await import("../src/agent/codebox.js");
const { docker } = await import("../src/linux.js");

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined || method === "GET" ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
assert.equal((await call("POST", "/auth/signup", { email: "codes@example.com", password: "password123" })).status, 200);
const lea = users.all()[0];
const { createSession, SESSION_COOKIE } = await import("../src/auth.js");
const stranger = users.create("stranger@example.com", "Stranger", "x", "en");
const strangerCookie = `${SESSION_COOKIE}=${createSession(stranger.id).token}`;

test("L91: « fais-le toi-même » — ask_takeover offers the reason password", () => {
  assert.ok((TAKEOVER_REASONS as readonly string[]).includes("password"));
});

test("L95 / L83 routes: computer hours and a mail signature, only for their own account", async () => {
  const h = await call("PUT", "/usage/computer-hours", { hours: 12 });
  assert.equal(h.status, 200);
  assert.equal(h.json.ownCapHours, 12);
  assert.equal((await call("PUT", "/usage/computer-hours", { hours: 9999 })).status, 400);
  assert.equal((await call("GET", "/usage/computer-hours")).json.capHours, 12);
  const { accounts } = await import("../src/native/accounts.js");
  const acc = accounts.create(lea.id, "gmail", "perso");
  assert.equal((await call("PUT", `/native/accounts/${acc.id}/signature`, { text: "Léa" })).json.text, "Léa");
  assert.equal((await call("GET", `/native/accounts/${acc.id}/signature`)).json.text, "Léa");
  const keep = cookie; cookie = strangerCookie;
  try {
    assert.equal((await call("GET", `/native/accounts/${acc.id}/signature`)).status, 404, "another account's mailbox: not found");
    assert.equal((await call("PUT", `/native/accounts/${acc.id}/signature`, { text: "Pirate" })).status, 404);
    assert.equal((await call("GET", "/usage/computer-hours")).json.capHours, null, "caps are per account");
  } finally { cookie = keep; }
});

const dockerUp = (await docker(["info"], { timeoutMs: 8000 }).catch(() => ({ code: 1 }))).code === 0;
test("L91: the code goes from the hidden box into the page's field; the bot never sees it", { skip: !dockerUp && "Docker is not running" }, async () => {
  const { initComputer, screen, workspaceOf } = await import("../src/computer.js");
  const { containerName, linuxScreen } = await import("../src/linux.js");
  await initComputer();
  const bot = bots.create(lea.id, { name: "Codey", autonomy: "balanced" });
  after(async () => { await linuxScreen.destroy(bot.id).catch(() => {}); });
  writeFileSync(path.join(workspaceOf(bot.id), "otp.html"), `<!doctype html><title>Bank</title><label>SMS code <input id="otp" autocomplete="one-time-code"></label><button>Verify</button>`);
  await screen.wake(bot.id, lea.id);
  const n = containerName(bot.id);
  await docker(["exec", n, "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  await docker(["exec", "-d", "-w", "/root/files", n, "python3", "-m", "http.server", "8061", "--bind", "127.0.0.1"]);
  await new Promise((r) => setTimeout(r, 800));
  const tools = builtinTools({});
  const tool = (x: string) => tools.find((t) => t.spec.name === x)!;
  const ctx = () => ({ bot: bots.byId(bot.id)!, user: users.byId(lea.id)!, depth: 0, signal: new AbortController().signal }) as never;
  const text = (o: { content: unknown }) => (typeof o.content === "string" ? o.content : JSON.stringify(o.content));
  assert.ok(tool("code_request"), "offered on a Linux computer");
  assert.match(tool("ask_takeover").spec.description, /reason password: never change one yourself/, "« fais-le toi-même »");
  await tool("browser_open").run({ url: "http://127.0.0.1:8061/otp.html" }, ctx());
  const snap = text(await tool("element_snapshot").run({}, ctx()));
  const field = /\[([0-9a-f]{4}\.\d+)\] textbox "SMS code"/.exec(snap)?.[1] ?? "";
  const button = /\[([0-9a-f]{4}\.\d+)\] button "Verify"/.exec(snap)?.[1] ?? "";
  assert.ok(field && button, snap);
  const notField = await tool("code_request").run({ ref: button, detail: "x" }, ctx());
  assert.ok(notField.isError && /not a text field/.test(text(notField)));

  // The user dismisses once, then types the code.
  const first = tool("code_request").run({ ref: field, detail: "The bank's SMS code" }, ctx());
  await new Promise((r) => setTimeout(r, 300));
  const card = () => rows.all(bot.id, bots.byId(bot.id)!.generation).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "code")!.body as { card: { codeId: string; status: string; label: string; host: string } };
  assert.equal(card().card.status, "pending");
  assert.deepEqual([card().card.label, card().card.host], ["SMS code", "127.0.0.1"]);
  assert.equal((await call("POST", `/bots/${bot.id}/code/${card().card.codeId}`, { dismiss: true })).status, 200);
  const dismissed = await first;
  assert.ok(dismissed.isError && /does not have the code/.test(text(dismissed)));
  assert.equal(card().card.status, "dismissed");

  const second = tool("code_request").run({ ref: field, detail: "The bank's SMS code" }, ctx());
  await new Promise((r) => setTimeout(r, 300));
  const id = card().card.codeId;
  assert.equal((await call("POST", `/bots/${bot.id}/code/${id}`, { code: "12<script>" })).status, 400, "a code is letters and digits");
  const keep = cookie; cookie = strangerCookie;
  assert.equal((await call("POST", `/bots/${bot.id}/code/${id}`, { code: "000000" })).status, 404, "another account cannot answer");
  cookie = keep;
  assert.equal((await call("POST", `/bots/${bot.id}/code/${id}`, { code: "482913" })).status, 200);
  const done = await second;
  assert.ok(!done.isError, text(done));
  assert.match(text(done), /The user's code was typed into “SMS code” on 127\.0\.0\.1 \(read back: the field holds it\)\. You did not see it/);
  assert.doesNotMatch(text(done), /482913/, "never in the bot's answer");
  assert.equal(card().card.status, "typed");
  assert.doesNotMatch(JSON.stringify(rows.all(bot.id, bots.byId(bot.id)!.generation)), /482913/, "never in the chat");
  const value = await linuxScreen.targetAt(bot.id, "({ v: document.getElementById('otp').value })");
  assert.equal((value?.target as { v: string }).v, "482913", "the page's field holds it");
  const again = text(await tool("element_snapshot").run({}, ctx()));
  assert.match(again, /textbox "SMS code" value="\(the code you were given, hidden\)"/);
  assert.doesNotMatch(again, /482913/, "never in a later listing");
  assert.equal(answerCode(bot.id, id, { code: "1" }), "gone", "answered once");
});
