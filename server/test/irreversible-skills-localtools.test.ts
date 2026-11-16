import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-irr-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.MAX_STEPS = "8";
delete process.env.AUX_MODEL;
delete process.env.FALLBACK_MODEL;
delete process.env.FALLBACK_MODELS;

const FAKE = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures", "fake-mcp-stdio.mjs");

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { initComputer } = await import("../src/computer.js");
const { policies, skills, skillText } = await import("../src/store.js");
const { irreversibility, destructiveCommand } = await import("../src/agent/irreversible.js");
const { destructiveHint } = await import("../src/connectors.js");
const { setLauncher, setLocalToolTimeouts, dockerExecArgs, checkCommand, localTools } = await import("../src/localtools.js");
const { linuxScreen } = await import("../src/linux.js");
const { builtinTools } = await import("../src/agent/tools.js");
import type { LlmProvider, TurnRequest, TurnResult, Block } from "../src/llm/types.js";
import type { Bot, Card, LocalToolsState, Row, Skill } from "../src/shared.js";
import type { StdioServerParameters } from "@modelcontextprotocol/sdk/client/stdio.js";

await initComputer();
const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };

/** Scripted model: "call T {json}" → one tool call; a tool result → "Tool said: …"; else an echo. */
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
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{[^\n]*\})\s*$/.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said.slice(0, 300)}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
} satisfies LlmProvider);

// ── A launcher that runs the command on this machine instead of in a bot's container ──
let unavailable: string | null = null;
const launched: StdioServerParameters[] = [];
const stopped: string[] = [];
const holds: string[] = [];
setLauncher({
  unavailable: () => unavailable,
  async params(_bot, _id, command, args) {
    const p: StdioServerParameters = { command: command === "node" ? process.execPath : command, args, env: { PATH: process.env.PATH ?? "" }, stderr: "pipe" };
    launched.push(p);
    return p;
  },
  async stop(_botId, id) { stopped.push(id); },
  hold(botId) { holds.push(botId); return () => {}; },
});
setLocalToolTimeouts({ start: 15_000, call: 15_000 });
after(async () => { await localTools.closeAll(); setLauncher(null); setLocalToolTimeouts(null); });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
/** Where each bot's chat stood when the user last spoke: replies are looked for after it. */
const mark = new Map<string, number>();
async function say(bot: Bot, text: string) {
  mark.set(bot.id, Math.max(0, ...(await rowsOf(bot.id)).map((r) => r.seq)));
  return call("POST", `/bots/${bot.id}/messages`, { text });
}
type Approval = Extract<Card, { type: "approval" }>;
const approvalsOf = (list: Row[]) => list.filter((r) => r.body.kind === "card" && r.body.card.type === "approval").map((r) => (r.body as { card: Approval }).card);
const pendingApproval = (bot: Bot) => until(async () => approvalsOf(await rowsOf(bot.id)).find((c) => c.status === "pending"), "approval");
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming && r.body.text);
const replied = (bot: Bot, part: string) => until(async () => { const r = lastAssistant((await rowsOf(bot.id)).filter((x) => x.seq > (mark.get(bot.id) ?? 0))); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply containing "${part}"`);
const replyText = (r: Row) => (r.body.kind === "message" ? r.body.text : "");
async function fresh(name: string, patch: Record<string, unknown> = {}): Promise<Bot> {
  const b = (await call("POST", "/bots", { name })).json.bot as Bot;
  return (await call("PATCH", `/bots/${b.id}`, { model: "script:script-1", ...patch })).json.bot as Bot;
}
const localState = async (bot: Bot) => (await call("GET", `/bots/${bot.id}/local-tools`)).json as LocalToolsState;
const serverReady = (bot: Bot, name: string) => until(async () => (await localState(bot)).servers.find((s) => s.name === name && s.status === "ready"), `${name} ready`);

let userId = "";
test("setup: an account (French)", async () => {
  const r = await call("POST", "/auth/signup", { email: "irr@example.com", name: "Iris", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
});

// ── 1. Irreversible actions ─────────────────────────────────────────────────
test("irreversibility: decided from the tool, the server-read click target and the arguments", () => {
  const builtin = new Map<string, any>(builtinTools().map((b) => [b.spec.name, b]));
  builtin.set("shell_run", {}); // offered only where commands can run; here it only needs to be a known built-in
  const remote = new Map<string, any>([
    ["gm_send", { connectorId: "", connectorName: "Gmail — perso", remoteName: "mail_send", readOnly: false, native: { accountId: "a", risk: "write", label: "" } }],
    ["gm_draft", { connectorId: "", connectorName: "Gmail — perso", remoteName: "mail_draft", readOnly: false, native: { accountId: "a", risk: "safe", label: "" } }],
    ["gm_read", { connectorId: "", connectorName: "Gmail — perso", remoteName: "mail_read", readOnly: true, native: { accountId: "a", risk: "read", label: "" } }],
    ["cal_del", { connectorId: "", connectorName: "Agenda", remoteName: "calendar_delete", readOnly: false, native: { accountId: "a", risk: "write", label: "" } }],
    ["app_x__create_issue", { connectorId: "c", connectorName: "X", remoteName: "create_issue", readOnly: false }],
    ["app_x__reset", { connectorId: "c", connectorName: "X", remoteName: "reset", readOnly: false, destructive: true }],
    ["app_x__delete_list", { connectorId: "c", connectorName: "X", remoteName: "delete_list", readOnly: true }],
  ]);
  const turn = { builtin, remote } as any;
  const kind = (name: string, input: Record<string, unknown> = {}) => irreversibility(turn, name, input)?.kind ?? null;
  assert.equal(kind("bot_email_send", { to: "a@b.c" }), "send");
  assert.equal(kind("card_fill", { amount: 12 }), "pay");
  assert.equal(kind("page_publish", { name: "x" }), "publish");
  assert.equal(kind("page_publish", { name: "x", visibility: "private" }), null);
  assert.equal(kind("api_send", { method: "DELETE", path: "/v1/items/3" }), "delete");
  assert.equal(kind("api_send", { method: "POST", path: "/v1/messages/send" }), "send");
  assert.equal(kind("api_send", { method: "PATCH", path: "/v1/messages/3" }), null);
  assert.equal(kind("routine_delete", { id: "r" }), "delete");
  assert.equal(kind("memory_save", { text: "x" }), null);
  // The model's own claims do not count: unknown tools, and a click without the server's own reading of its target.
  assert.equal(kind("made_up_send_tool"), null);
  assert.equal(kind("screen_click", { x: 1, y: 2, label: "Payer" }), null);
  assert.equal(kind("screen_click", { x: 1, y: 2, seen_target: { label: "Payer maintenant", host: "shop.example", form: "" } }), "pay");
  assert.equal(kind("element_click", { ref: "e1", seen_target: { label: "Envoyer", host: "mail.example", form: "" } }), "send");
  assert.equal(kind("element_click", { ref: "e1", seen_target: { label: "Valider", host: "x.example", form: "POST /f" } }), "submit");
  assert.equal(kind("element_click", { ref: "e1", seen_target: { label: "Enregistrer", host: "x.example", form: "" } }), null);
  assert.equal(kind("element_click", { ref: "e1", seen_target: { label: "Ajouter au panier", host: "x.example", form: "" } }), null);
  assert.equal(kind("element_click", { ref: "e1", seen_target: { label: "Réserver", host: "x.example", form: "" } }), "book");
  // Built-in apps: by their action; drafts and reads never.
  assert.equal(kind("gm_send"), "send");
  assert.equal(kind("gm_draft"), null);
  assert.equal(kind("gm_read"), null);
  assert.equal(kind("cal_del"), "delete");
  // Connector tools: their name, plus an explicit destructiveHint (which can only add the warning).
  assert.equal(kind("app_x__create_issue"), null);
  assert.equal(kind("app_x__reset"), "destructive");
  assert.equal(kind("app_x__delete_list"), null);
  // Commands.
  assert.equal(kind("shell_run", { command: "ls -la && rm -rf build" }), "command");
  assert.equal(kind("shell_run", { command: "npm run format --check" }), null);
  assert.ok(destructiveCommand("git push --force origin main"));
  assert.ok(destructiveCommand("psql -c 'DROP TABLE users'"));
  assert.ok(destructiveCommand("find . -name '*.tmp' -delete"));
  assert.ok(!destructiveCommand("cat firmware.bin | head"));
  assert.ok(!destructiveCommand("echo remove me"));
  // MCP annotations: only an explicit destructiveHint on a tool that is not read-only.
  assert.equal(destructiveHint({ destructiveHint: true }), true);
  assert.equal(destructiveHint({ readOnlyHint: true, destructiveHint: true }), false);
  assert.equal(destructiveHint({}), false);
  assert.equal(destructiveHint(undefined), false);
});

// ── 3. Local tool servers (with 1: their irreversible tools) ───────────────────
test("local tool server: argv for the bot's container, input checks", () => {
  assert.deepEqual(dockerExecArgs("sklubot-bot_1", "lts_1", "npx", ["-y", "pkg; rm -rf /", "$(id)"]),
    ["exec", "-i", "-w", "/root", "sklubot-bot_1", "setsid", "-w", "sh", "-c", 'mkdir -p /tmp/sklubot-tools && echo $$ > "$0" && exec "$@"', "/tmp/sklubot-tools/lts_1.pid", "npx", "-y", "pkg; rm -rf /", "$(id)"]);
  assert.equal(checkCommand("npx", ["-y", "x"]), null);
  assert.ok(checkCommand("npx -y x", []));
  assert.ok(checkCommand("bash;rm", []));
  assert.ok(checkCommand("npx", ["a\nb"]));
  assert.ok(checkCommand("npx", "x"));
});

let notesBot: Bot;
test("local tool server: added by the owner, started, its tools offered and called like an app's (outside content)", async () => {
  notesBot = await fresh("Notes");
  const r = await call("POST", `/bots/${notesBot.id}/local-tools`, { name: "Notes", command: "node", args: [FAKE] });
  assert.equal(r.status, 200, r.text);
  const ready = await serverReady(notesBot, "Notes");
  assert.deepEqual(ready.tools.map((t) => t.name).sort(), ["echo", "list_notes", "send_message", "wipe_store"]);
  assert.equal(ready.tools.find((t) => t.name === "list_notes")?.readOnly, true);
  // A read-only tool runs without a card; its result is outside content.
  await say(notesBot, "call cmd_notes__list_notes {}");
  const done = await replied(notesBot, "Tool said:");
  assert.match(replyText(done), /notes: courses, banque/);
  const req = requests.at(-1)!;
  assert.ok(req.tools.some((t) => t.name === "cmd_notes__send_message"));
  assert.match(JSON.stringify(req.messages.at(-1)), /outside/i);
  assert.ok(holds.includes(notesBot.id), "the computer is held awake during a call");
  // Another bot of the same user does not get these tools: they belong to this bot's computer.
  const other = await fresh("Autre");
  await say(other, "hello");
  await replied(other, "Echo:");
  assert.ok(!requests.at(-1)!.tools.some((t) => t.name.startsWith("cmd_notes__")));
});

test("an irreversible action: red reason on the card, no standing permission even if Always is sent", async () => {
  await say(notesBot, `call cmd_notes__send_message {"to":"bob@example.com","text":"Salut"}`);
  const card = await pendingApproval(notesBot);
  assert.equal(card.irreversible, true);
  assert.equal(card.once, true);
  assert.equal(card.irreversibleReason, "un message ou un e-mail envoyé ne peut pas être repris.");
  const r = await call("POST", `/approvals/${card.approvalId}`, { decision: "always" });
  assert.equal(r.status, 200, r.text);
  const done = await replied(notesBot, "Tool said:");
  assert.match(replyText(done), /sent to bob@example.com/);
  const answered = approvalsOf(await rowsOf(notesBot.id)).find((c) => c.approvalId === card.approvalId)!;
  assert.equal(answered.status, "allowed", "Always on an irreversible card counts as once");
  assert.notEqual(policies.get(userId, "Notes: send_message"), "always_allow");
  // A second send asks again.
  await say(notesBot, `call cmd_notes__send_message {"to":"bob@example.com","text":"Encore"}`);
  const again = await pendingApproval(notesBot);
  assert.equal(again.irreversible, true);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "deny" });
  await replied(notesBot, "Tool said:");
});

test("a destructiveHint tool is flagged; an ordinary write is not, and keeps Always", async () => {
  await say(notesBot, "call cmd_notes__wipe_store {}");
  const wipe = await pendingApproval(notesBot);
  assert.equal(wipe.irreversible, true);
  assert.match(wipe.irreversibleReason ?? "", /définitivement/);
  await call("POST", `/approvals/${wipe.approvalId}`, { decision: "deny" });
  await replied(notesBot, "Tool said:");
  await say(notesBot, `call cmd_notes__echo {"text":"coucou"}`);
  const echo = await pendingApproval(notesBot);
  assert.ok(!echo.irreversible);
  assert.ok(!echo.once);
  await call("POST", `/approvals/${echo.approvalId}`, { decision: "always" });
  assert.match(replyText(await replied(notesBot, "Tool said:")), /echo: coucou/);
  assert.equal(policies.get(userId, "Notes: echo"), "always_allow");
});

test("local tool server: stops with the computer, starts again when needed", async () => {
  const before = launched.length;
  await linuxScreen.sleep(notesBot.id);
  await until(async () => (await localState(notesBot)).servers[0]?.status === "stopped", "stopped");
  await until(() => stopped.length > 0, "its process group stopped");
  // Its tools are still offered (from the saved list) and the server starts on the next call.
  await say(notesBot, "call cmd_notes__list_notes {}");
  assert.match(replyText(await replied(notesBot, "notes: courses")), /Tool said/);
  assert.equal(launched.length, before + 1);
});

test("local tool server: a failing command shows why and waits before the next start; Retry clears the wait", async () => {
  const b = await fresh("Panne");
  await call("POST", `/bots/${b.id}/local-tools`, { name: "Cassé", command: "node", args: ["-e", "console.error('boom: missing package'); process.exit(3)"] });
  const failed = await until(async () => (await localState(b)).servers.find((s) => s.status === "error"), "error");
  assert.match(failed.error ?? "", /n'a pas pu démarrer|n'a pas répondu/);
  assert.equal(failed.detail, "boom: missing package");
  assert.ok((failed.retryInSec ?? 0) > 0);
  // A call meanwhile fails clearly, without starting it again.
  const n = launched.length;
  await assert.rejects(localTools.call(failed.id, "x", {}), /not running: it failed a moment ago/);
  assert.equal(launched.length, n);
  const r = await call("POST", `/local-tools/${failed.id}/restart`);
  assert.equal(r.status, 200);
  await until(() => launched.length === n + 1, "restarted");
  // Someone else's server: 404.
  const other = await call("DELETE", "/local-tools/lts_nope");
  assert.equal(other.status, 404);
  await call("DELETE", `/local-tools/${failed.id}`);
  assert.equal((await localState(b)).servers.length, 0);
});

test("local tool server: a server that dies during a call is reported, never retried on its own", async () => {
  const b = await fresh("Crash");
  await call("POST", `/bots/${b.id}/local-tools`, { name: "Crash", command: "node", args: [FAKE, "--crash-on-call"] });
  const ready = await serverReady(b, "Crash");
  const n = launched.length;
  await assert.rejects(localTools.call(ready.id, "list_notes", {}));
  const st = await until(async () => (await localState(b)).servers.find((s) => s.status === "error"), "error after crash");
  assert.match(st.error ?? "", /arrêté tout seul/);
  assert.equal(launched.length, n, "not restarted by itself");
});

test("local tool server: without a Linux computer, a clear error", async () => {
  unavailable = "Local tool servers run on the bot's own Linux computer, and this Sklubot server gives bots no Linux computer (Docker is not available). Ask whoever runs the server to enable Linux computers.";
  try {
    const st = await localState(notesBot);
    assert.equal(st.available, false);
    assert.match(st.reason ?? "", /ne donne pas d'ordinateur Linux/);
    assert.equal(st.servers[0].status, "unavailable");
    const r = await call("POST", `/bots/${notesBot.id}/local-tools`, { name: "X", command: "npx", args: [] });
    assert.equal(r.status, 400);
    assert.match(r.json.error, /ordinateur Linux/);
    // Its tools are not offered, and the bot cannot propose one.
    await say(notesBot, "hello again");
    await replied(notesBot, "Echo: hello again");
    const tools = requests.at(-1)!.tools.map((t) => t.name);
    assert.ok(!tools.some((t) => t.startsWith("cmd_")));
    assert.ok(!tools.includes("local_tool_server_add"));
  } finally { unavailable = null; }
});

test("a bot can only propose a local tool server: the card always asks, shows the command, never offers Always", async () => {
  const b = await fresh("Propose", { autonomy: "trusted" });
  // Even an earlier "always" for this tool does not let it through: the gate is strict.
  policies.set(userId, "local_tool_server_add", "always_allow");
  await say(b, `call local_tool_server_add {"name":"Fichiers","command":"node","args":[${JSON.stringify(FAKE)}],"reason":"lire des fichiers"}`);
  const card = await pendingApproval(b);
  assert.equal(card.once, true);
  assert.match(card.detail, /Commande : .*fake-mcp-stdio\.mjs/);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await replied(b, "Tool said:");
  assert.equal((await localState(b)).servers.length, 0, "nothing added without the yes");
  await say(b, `call local_tool_server_add {"name":"Fichiers","command":"node","args":[${JSON.stringify(FAKE)}]}`);
  const again = await pendingApproval(b);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "always" });
  assert.match(replyText(await replied(b, "Tool said:")), /Added "Fichiers" with 4 tools/);
  // Its tools come with the next turn.
  await say(b, "next");
  await replied(b, "Echo: next");
  assert.ok(requests.at(-1)!.tools.some((t) => t.name === "cmd_fichiers__list_notes"));
});

// ── 2. Richer skills ────────────────────────────────────────────────────────
test("skills: structured parts stored, shown in the prompt and in skill_read; old skills read as before", async () => {
  const b = await fresh("Compta");
  const legacy = skills.create(b.id, "Ancienne", "Quand on demande", "1. Faire\n2. Finir");
  assert.equal(legacy.needs, "");
  assert.equal(skillText(legacy), "Use when: Quand on demande\n1. Faire\n2. Finir", "an old skill reads exactly as before");
  const r = await call("POST", `/bots/${b.id}/skills`, { name: "Facture", description: "Quand une facture arrive", body: "1. Ouvrir\n2. Payer", needs: "Gmail connecté", approvals: "Étape 2 : le paiement", check: "Le statut est Payée", output: "Le numéro de facture" });
  assert.equal(r.status, 200, r.text);
  const s = r.json.skill as Skill;
  assert.deepEqual([s.needs, s.approvals, s.check, s.output], ["Gmail connecté", "Étape 2 : le paiement", "Le statut est Payée", "Le numéro de facture"]);
  // A partial update (sharing) keeps them; an explicit empty string clears one.
  const shared = (await call("PATCH", `/skills/${s.id}`, { shared: true })).json.skill as Skill;
  assert.equal(shared.check, "Le statut est Payée");
  const cleared = (await call("PATCH", `/skills/${s.id}`, { output: "" })).json.skill as Skill;
  assert.equal(cleared.output, "");
  assert.equal(cleared.needs, "Gmail connecté");
  // In the prompt (inlined) and through skill_read.
  await say(b, "call skill_read {\"name\":\"Facture\"}");
  const done = await replied(b, "Tool said:");
  assert.match(replyText(done), /Needs first \(accounts, access, files\): Gmail connecté/);
  assert.match(replyText(done), /Steps that need the user's approval.*Étape 2 : le paiement/);
  assert.match(replyText(done), /How to check the result: Le statut est Payée/);
  const system = requests.at(-1)!.system;
  assert.match(system, /### Facture\nUse when: Quand une facture arrive\nNeeds first/);
  assert.match(system, /### Ancienne\nUse when: Quand on demande\n1\. Faire/);
  // "/skill Facture" gives the whole skill to the bot.
  await say(b, "/skill Facture maintenant");
  await replied(b, "Echo:");
  assert.match(JSON.stringify(requests.at(-1)!.messages), /How to check the result: Le statut est Payée/);
});

test("skills: skill_save fills the parts; saving again without them keeps them; the team export carries them", async () => {
  const b = await fresh("Sauveur");
  await say(b, `call skill_save {"name":"Commande","when":"Pour commander","steps":"1. Choisir\\n2. Payer","needs":"Compte boutique","approvals":"Le paiement","check":"Mail de confirmation reçu","output":"Numéro de commande"}`);
  await replied(b, "Tool said: Skill saved.");
  let k = skills.list(b.id).find((x) => x.name === "Commande")!;
  assert.deepEqual([k.needs, k.approvals, k.check, k.output], ["Compte boutique", "Le paiement", "Mail de confirmation reçu", "Numéro de commande"]);
  await say(b, `call skill_save {"name":"Commande","when":"Pour commander","steps":"1. Choisir\\n2. Payer\\n3. Vérifier"}`);
  await replied(b, "Tool said: Skill updated.");
  k = skills.list(b.id).find((x) => x.name === "Commande")!;
  assert.equal(k.body, "1. Choisir\n2. Payer\n3. Vérifier");
  assert.equal(k.check, "Mail de confirmation reçu");
  const spec = builtinTools().find((t) => t.spec.name === "skill_save")!.spec;
  assert.deepEqual(Object.keys(spec.inputSchema.properties).sort(), ["approvals", "check", "name", "needs", "output", "shared", "steps", "when"]);
  const exp = await api.request("/export/team", { headers: { cookie } });
  const team = JSON.parse(await exp.text());
  const exported = team.bots.find((x: any) => x.name === "Sauveur").skills.find((x: any) => x.name === "Commande");
  assert.equal(exported.check, "Mail de confirmation reçu");
});
