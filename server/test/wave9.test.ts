import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Wave 9: (1) API providers the user sets up (DeepSeek preset), usable as the main or a backup model, and the backup
// chain after a failed subscription turn; (2) "Fichiers modifiés" snapshots with undo; (3) a secret pasted in a message.
const DATA = mkdtempSync(path.join(tmpdir(), "sklubot-w9-"));
process.env.DATA_DIR = DATA;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.ALLOW_PRIVATE_FETCH = "1";
delete process.env.MAX_BOTS;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { setEngineHost } = await import("../src/agent/engine.js");
const { findSecrets, maskSecrets } = await import("../src/shared.js");
const { looksSecret } = await import("../src/agent/sensitive.js");
const { heldCount } = await import("../src/pastedsecrets.js");
const { history, vault } = await import("../src/store.js");
const { unseal } = await import("../src/auth.js");
const { q } = await import("../src/db.js");
const { SNAP_SCRIPT, snapRunner, parseTake, settled } = await import("../src/snapshots.js");
const { DEEPSEEK_PRESET } = await import("../src/apimodels.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

// ── A scripted model (the server's own) ─────────────────────────────────────
const scriptedSeen: TurnRequest[] = [];
/** What the scripted model does on its next turn, besides answering (e.g. write a file in the bot's home). */
let onScriptedTurn: (() => void) | null = null;
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    scriptedSeen.push(req);
    onScriptedTurn?.();
    const last = req.messages[req.messages.length - 1];
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    const content: Block[] = [{ type: "text", text: `ok: ${said.slice(-40)}` }];
    return { content, stopReason: "end", usage: { inputTokens: 10, outputTokens: 5, cachedTokens: 0 }, model: req.model };
  },
};
registerProvider(scripted);

// ── A fake OpenAI-compatible API (DeepSeek-like: streamed reasoning_content, /models) ──
const KEY = "sk-test-deepseek-0123456789abcdefghij";
const apiSeen: { path: string; auth: string; body: any }[] = [];
const fake = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (c) => { raw += c; });
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : null;
    apiSeen.push({ path: req.url ?? "", auth: String(req.headers.authorization ?? ""), body });
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end("{}"); return; }
    if (req.method === "GET" && req.url === "/models") {
      res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ object: "list", data: [{ id: "deepseek-flash", object: "model", context_window: 1000000 }, { id: "deepseek-v4-pro", object: "model" }] }));
      return;
    }
    if (req.method === "POST" && req.url === "/chat/completions") {
      res.writeHead(200, { "content-type": "text/event-stream" });
      const send = (o: unknown) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({ choices: [{ index: 0, delta: { reasoning_content: "thinking it over" } }] });
      send({ choices: [{ index: 0, delta: { content: "Hello from DeepSeek" } }] });
      send({ choices: [{ index: 0, delta: {}, finish_reason: "stop" }] });
      send({ choices: [], usage: { prompt_tokens: 1_000_000, completion_tokens: 1_000_000, prompt_tokens_details: { cached_tokens: 0 } } });
      res.end("data: [DONE]\n\n");
      return;
    }
    res.writeHead(404).end("{}");
  });
});
await new Promise<void>((r) => fake.listen(0, "127.0.0.1", () => r()));
const BASE = `http://127.0.0.1:${(fake.address() as { port: number }).port}`;
after(() => { fake.close(); setEngineHost(null); });

// ── Helpers ──────────────────────────────────────────────────────────────────
function client() {
  let cookie = "";
  return async (method: string, url: string, body?: unknown) => {
    const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get("set-cookie");
    if (set) cookie = set.split(";")[0];
    const text = await res.text();
    let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
}
const call = client();
const other = client();
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 800; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=500`)).json.rows;
const idle = (botId: string) => until(async () => !(await call("GET", "/bots")).json.live[botId]?.running, "idle");

let bot: Bot;
test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "w9@example.com", password: "password-1", locale: "fr" })).status, 200);
  bot = (await call("POST", "/bots", { name: "Neuf" })).json.bot;
  assert.equal((await other("POST", "/auth/signup", { email: "w9b@example.com", password: "password-1", locale: "en" })).status, 200);
});

// ── 3. A secret pasted in a message ──────────────────────────────────────────
test("secret formats are found with few false positives", () => {
  const hit = ["sk-proj-abcdefghijklmnopqrstuvwxyz0123", "ghp_abcdefghijklmnopqrstuvwxyz0123456789", "mot de passe : Tr0ub4dor&3", "password=hunter22", "AKIAIOSFODNN7EXAMPLE",
    "xoxb-1234567890-abcdefghij", "api_key: AIzaSyA1234567890abcdefghijklmnopqrstu", "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----", "token: 9f8e7d6c5b4a"];
  for (const t of hit) assert.ok(findSecrets(t).length, `should be found: ${t}`);
  const miss = ["le token est expiré", "Le secret : travailler dur", "https://docs.google.com/document/d/1BxiMVs0XRA5nFMdKvBdBZjgmUUqptlbs74OgvE2upms/edit", "password: ****",
    "commit 3f2a9c1e8b7d6a5f4e3d2c1b0a9f8e7d6c5b4a3f", "mon mot de passe est trop court", "rendez-vous à 14:30", "sk-"];
  for (const t of miss) assert.equal(findSecrets(t).length, 0, `should not be found: ${t}`);
  assert.equal(maskSecrets("clé sk-ant-api03-abcdefghijklmnopqrstuv ok", "[X]").text, "clé [X] ok");
  assert.ok(looksSecret("ghp_abcdefghijklmnopqrstuvwxyz0123456789"));
});

const SECRET = "sk-ant-api03-SuperSecretValue0123456789";
test("a pasted secret is masked before it is stored or sent to the model, and a card offers the vault", async () => {
  scriptedSeen.length = 0;
  const r = await call("POST", `/bots/${bot.id}/messages`, { text: `Voici ma clé ${SECRET} pour Anthropic` });
  assert.equal(r.status, 200);
  assert.equal(r.json.row.body.text, "Voici ma clé [secret masqué] pour Anthropic");
  await idle(bot.id);
  const rows = await rowsOf(bot.id);
  const card = rows.find((x) => x.body.kind === "card" && x.body.card.type === "pastedsecret");
  assert.ok(card && card.body.kind === "card" && card.body.card.type === "pastedsecret");
  const c = card!.body.kind === "card" && card!.body.card.type === "pastedsecret" ? card!.body.card : null;
  assert.equal(c!.hint, "sk-ant-");
  assert.equal(c!.host, "api.anthropic.com");
  // Nowhere: not in the chat rows, the model's history, what the model received, nor the database file.
  assert.ok(!JSON.stringify(rows).includes(SECRET));
  assert.ok(!JSON.stringify(history.load(bot.id, bot.generation)).includes(SECRET));
  assert.ok(!JSON.stringify(scriptedSeen.map((s) => s.messages)).includes(SECRET));
  assert.ok(scriptedSeen.some((s) => JSON.stringify(s.messages).includes("[secret masqué]")));
  assert.ok(!q.all<{ body: string }>("SELECT body FROM rows").some((x) => x.body.includes(SECRET)));
  assert.equal(heldCount(), 1);
  // Saved: sealed in the vault for the host, and the bot is told its name only.
  const saved = await call("POST", `/bots/${bot.id}/cards/${card!.seq}/pasted-secret`, { action: "save", name: "Anthropic", host: "api.anthropic.com" });
  assert.equal(saved.status, 200, saved.text);
  const item = vault.byName((await call("GET", "/me")).json.user.id, "Anthropic");
  assert.ok(item && item.kind === "secret" && item.hosts?.includes("api.anthropic.com"));
  assert.equal(unseal(item!.passwordEnc!), SECRET);
  assert.equal(heldCount(), 0);
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${card!.seq}/pasted-secret`, { action: "save", name: "X", host: "x.com" })).status, 409);
  await idle(bot.id);
  assert.ok(!JSON.stringify(await rowsOf(bot.id)).includes(SECRET));
  assert.ok(!(await call("GET", "/vault")).text.includes(SECRET));
});

test("a discarded pasted secret is forgotten; one no longer held cannot be saved", async () => {
  await call("POST", `/bots/${bot.id}/messages`, { text: "password: Zebra-Horse-42" });
  await idle(bot.id);
  const cards = (await rowsOf(bot.id)).filter((x) => x.body.kind === "card" && x.body.card.type === "pastedsecret" && x.body.card.status === "pending");
  assert.equal(cards.length, 1);
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${cards[0].seq}/pasted-secret`, { action: "discard" })).status, 200);
  assert.equal(heldCount(), 0);
  // Another user cannot answer this bot's card.
  await call("POST", `/bots/${bot.id}/messages`, { text: "mdp = AutreMotDePasse9" });
  await idle(bot.id);
  const next = (await rowsOf(bot.id)).filter((x) => x.body.kind === "card" && x.body.card.type === "pastedsecret" && x.body.card.status === "pending")[0];
  assert.equal((await other("POST", `/bots/${bot.id}/cards/${next.seq}/pasted-secret`, { action: "save", name: "X", host: "x.com" })).status, 404);
  // Lost (as after a restart): the card says so.
  const { forgetHeld } = await import("../src/pastedsecrets.js");
  const card = next.body.kind === "card" && next.body.card.type === "pastedsecret" ? next.body.card : null;
  forgetHeld(card!.pendingId);
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${next.seq}/pasted-secret`, { action: "save", name: "Site", host: "example.com" })).status, 409);
  const after = (await rowsOf(bot.id)).find((x) => x.seq === next.seq)!;
  assert.equal(after.body.kind === "card" && after.body.card.type === "pastedsecret" ? after.body.card.status : "", "expired");
});

// ── 1. API providers set up by the user ──────────────────────────────────────
let providerId = "";
test("a provider is saved with its key sealed; the key never comes back; other accounts do not see it", async () => {
  // A private address is refused unless private fetches are allowed (here they are, for the fake server).
  process.env.ALLOW_PRIVATE_FETCH = "0";
  assert.equal((await call("POST", "/api-providers", { name: "Local", baseUrl: "https://127.0.0.1:9/v1", key: "k", models: [] })).status, 400);
  assert.equal((await call("POST", "/api-providers", { name: "Plain", baseUrl: "http://example.com/v1", key: "k", models: [] })).status, 400);
  process.env.ALLOW_PRIVATE_FETCH = "1";
  const presets = (await call("GET", "/api-providers")).json.presets;
  assert.equal(presets.deepseek.baseUrl, "https://api.deepseek.com");
  assert.deepEqual(presets.deepseek.models.map((m: { id: string }) => m.id), ["deepseek-flash", "deepseek-v4-pro"]);
  // The test button and the model list, with the key typed in the form (not saved yet).
  assert.deepEqual((await call("POST", "/api-providers/test", { baseUrl: BASE, key: "wrong" })).json, { ok: false, detail: "The provider refused this key." });
  assert.equal((await call("POST", "/api-providers/test", { baseUrl: BASE, key: KEY })).json.ok, true);
  const listed = (await call("POST", "/api-providers/models", { baseUrl: BASE, key: KEY })).json;
  assert.equal(listed.ok, true);
  assert.equal(listed.models[0].contextWindow, 1000000);
  const created = await call("POST", "/api-providers", { name: "DeepSeek", baseUrl: BASE, key: KEY, preset: "deepseek", models: DEEPSEEK_PRESET.models });
  assert.equal(created.status, 200, created.text);
  providerId = created.json.provider.id;
  assert.match(providerId, /^up-/);
  assert.equal(created.json.provider.hasKey, true);
  assert.equal(created.json.provider.images, false);
  assert.ok(!created.text.includes(KEY));
  assert.ok(!(await call("GET", "/api-providers")).text.includes(KEY));
  assert.ok(!q.all<{ key_enc: string }>("SELECT key_enc FROM user_providers").some((r) => r.key_enc.includes(KEY)));
  const models = (await call("GET", "/models")).json.models.map((m: { ref: string }) => m.ref);
  assert.ok(models.includes(`${providerId}:deepseek-flash`));
  assert.ok(!(await other("GET", "/models")).json.models.some((m: { ref: string }) => m.ref.startsWith("up-")));
  assert.deepEqual((await other("GET", "/api-providers")).json.providers, []);
  assert.equal((await other("PATCH", `/api-providers/${providerId}`, { name: "mine" })).status, 404);
  // The saved key is used by the test button when none is typed.
  assert.equal((await call("POST", "/api-providers/test", { id: providerId, baseUrl: BASE })).json.ok, true);
});

test("a bot runs on the user's provider: guarded request, reasoning sent back, real cost with the set prices", async () => {
  const b2 = (await call("POST", "/bots", { name: "Deep" })).json.bot as Bot;
  assert.equal((await call("PATCH", `/bots/${b2.id}`, { model: `${providerId}:deepseek-flash` })).status, 200);
  apiSeen.length = 0;
  await call("POST", `/bots/${b2.id}/messages`, { text: "Bonjour" });
  await idle(b2.id);
  const rows = await rowsOf(b2.id);
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("Hello from DeepSeek")), JSON.stringify(rows.slice(-3)));
  const first = apiSeen.find((s) => s.path === "/chat/completions")!;
  assert.equal(first.auth, `Bearer ${KEY}`);
  assert.equal(first.body.model, "deepseek-flash");
  // Peak price of deepseek-flash: 0.3 $ in + 1.2 $ out per million.
  const cost = q.get<{ c: number }>("SELECT cost_usd AS c FROM usage WHERE bot_id = ? ORDER BY at DESC LIMIT 1", b2.id)!.c;
  assert.ok(Math.abs(cost - 1.5) < 1e-9, `cost ${cost}`);
  apiSeen.length = 0;
  await call("POST", `/bots/${b2.id}/messages`, { text: "Encore" });
  await idle(b2.id);
  const second = apiSeen.find((s) => s.path === "/chat/completions")!;
  const assistants = second.body.messages.filter((m: { role: string }) => m.role === "assistant");
  assert.ok(assistants.length >= 1);
  assert.equal(assistants[assistants.length - 1].reasoning_content, "thinking it over");
});

// ── 1b. A failed subscription turn goes on with the first backup API model ────
let engineMode: "fail" | "ok" = "fail";
setEngineHost({
  ensure: async () => {}, ready: async () => {}, awake: () => true, kill: async () => {}, writeFile: async () => {},
  async exec(_bot, _args, _env, _cwd, _input, _signal, onLine) {
    const emit = (e: unknown) => onLine(JSON.stringify(e));
    emit({ type: "thread.started", thread_id: "th-1" });
    emit({ type: "item.started", item: { id: "c1", type: "command_execution", command: "touch report.md" } });
    emit({ type: "item.completed", item: { id: "c1", type: "command_execution", status: "completed", exit_code: 0 } });
    // A plain failure (a usage limit has its own way, agent/sublimit.ts, tested in sublimit.test.ts).
    if (engineMode === "fail") { emit({ type: "turn.failed", error: { message: "stream disconnected before completion" } }); return { code: 1, stderr: "" }; }
    emit({ type: "item.completed", item: { type: "agent_message", text: "Done by Codex" } });
    emit({ type: "turn.completed", usage: {} });
    return { code: 0, stderr: "" };
  },
});

test("without a backup model, a failed subscription turn stops as before", async () => {
  const cx = (await call("POST", "/bots", { name: "Cx" })).json.bot as Bot;
  assert.equal((await call("PATCH", `/bots/${cx.id}`, { model: "codex:default" })).status, 200);
  scriptedSeen.length = 0;
  await call("POST", `/bots/${cx.id}/messages`, { text: "Fais le rapport" });
  await idle(cx.id);
  const rows = await rowsOf(cx.id);
  assert.ok(rows.some((r) => r.body.kind === "notice" && r.body.text.includes("stream disconnected")));
  assert.ok(!rows.some((r) => r.body.kind === "notice" && r.body.text.includes("modèle de secours")));
  assert.equal(scriptedSeen.length, 0);
});

test("with a backup model, the turn carries on there, told what was already done", async () => {
  const cx = (await call("POST", "/bots", { name: "Cx2" })).json.bot as Bot;
  assert.equal((await call("PATCH", `/bots/${cx.id}`, { model: "codex:default" })).status, 200);
  assert.equal((await call("PUT", "/reliability", { fallbackModels: [`${providerId}:deepseek-flash`] })).status, 200);
  apiSeen.length = 0;
  await call("POST", `/bots/${cx.id}/messages`, { text: "Fais le rapport" });
  await idle(cx.id);
  const rows = await rowsOf(cx.id);
  const notice = rows.find((r) => r.body.kind === "notice" && r.body.text.includes("modèle de secours"));
  assert.ok(notice && notice.body.kind === "notice" && notice.body.text.includes("Codex a échoué") && notice.body.text.includes("DeepSeek deepseek-flash"), JSON.stringify(rows.map((r) => r.body)));
  assert.ok(rows.some((r) => r.body.kind === "message" && r.body.role === "assistant" && r.body.text.includes("Hello from DeepSeek")));
  const sent = JSON.stringify(apiSeen.find((s) => s.path === "/chat/completions")!.body.messages);
  assert.match(sent, /do NOT do any of it again/);
  assert.match(sent, /touch report\.md/);
  assert.match(sent, /Fais le rapport/);
  // A turn that worked never calls the backup.
  engineMode = "ok";
  apiSeen.length = 0;
  await call("POST", `/bots/${cx.id}/messages`, { text: "Encore" });
  await idle(cx.id);
  assert.equal(apiSeen.length, 0);
  assert.ok((await rowsOf(cx.id)).some((r) => r.body.kind === "message" && r.body.text === "Done by Codex"));
  await call("PUT", "/reliability", { fallbackModels: [] });
});

// ── 2. "Fichiers modifiés" ───────────────────────────────────────────────────
/** Runs the snapshot script here, against a folder standing for the bot's /root. */
const homes = new Map<string, string>();
const homeOf = (botId: string) => { let h = homes.get(botId); if (!h) { h = mkdtempSync(path.join(DATA, "home-")); homes.set(botId, h); } return h; };
function runLocal(botId: string, args: string[]) {
  return new Promise<{ code: number | null; stdout: Buffer; stderr: string }>((resolve) => {
    const child = spawn("sh", ["-c", SNAP_SCRIPT, "sh", ...args], { env: { ...process.env, SNAP_ROOT: homeOf(botId) } });
    const out: Buffer[] = []; let err = "";
    child.stdout.on("data", (c) => out.push(c));
    child.stderr.on("data", (c) => { err += c; });
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(out), stderr: err }));
  });
}

test("the snapshot script lists what changed and leaves the excluded folders out", async () => {
  const id = "unit";
  const h = homeOf(id);
  mkdirSync(path.join(h, "proj/.git"), { recursive: true }); mkdirSync(path.join(h, "node_modules/x"), { recursive: true }); mkdirSync(path.join(h, ".codex"), { recursive: true });
  writeFileSync(path.join(h, "a.txt"), "a\n"); writeFileSync(path.join(h, "node_modules/x/i.js"), "x"); writeFileSync(path.join(h, ".codex/auth.json"), "{}");
  writeFileSync(path.join(h, "proj/.git/HEAD"), "ref"); writeFileSync(path.join(h, "proj/main.py"), "print(1)\n");
  const first = parseTake((await runLocal(id, ["take", "s1", "", "20000", "300000", "5120", "40", "1048576"])).stdout);
  assert.equal(first?.id, "s1");
  writeFileSync(path.join(h, "a.txt"), "a\nb\n"); writeFileSync(path.join(h, "new.bin"), Buffer.from([0, 1, 2, 3, 0, 255]));
  writeFileSync(path.join(h, "node_modules/x/i.js"), "changed"); writeFileSync(path.join(h, ".codex/auth.json"), "{\"t\":1}"); rmSync(path.join(h, "proj/main.py"));
  const second = parseTake((await runLocal(id, ["take", "s2", "s1", "20000", "300000", "5120", "40", "1048576"])).stdout);
  assert.deepEqual(second?.changes?.map((c) => [c.path, c.change, c.added, c.removed, c.binary]).sort(), [
    ["a.txt", "modified", 1, 0, false], ["new.bin", "added", null, null, true], ["proj/main.py", "deleted", 0, 1, false],
  ]);
  assert.equal(second?.changes?.find((c) => c.path === "new.bin")?.newSize, 6);
  // Too many files: skipped, with no error.
  assert.match((await runLocal(id, ["take", "s3", "s2", "1", "300000", "5120", "40", "1048576"])).stdout.toString(), /^SKIP too-many/m);
  // Restore never writes outside the home, through a link or with "..".
  const outside = mkdtempSync(path.join(DATA, "outside-"));
  const { symlinkSync } = await import("node:fs");
  symlinkSync(outside, path.join(h, "out"));
  const r = (await runLocal(id, ["restore", "s1", "s2", "1", "../escape.txt", "out/x.txt", "a.txt"])).stdout.toString();
  assert.match(r, /^SKIP \.\.\/escape\.txt$/m);
  assert.match(r, /^SKIP out\/x\.txt$/m);
  assert.match(r, /^OK a\.txt$/m);
  assert.equal(readFileSync(path.join(h, "a.txt"), "utf8"), "a\n");
  assert.ok(!existsSync(path.join(outside, "x.txt")));
});

test("a turn that changes files gets a card; the owner can see a diff and undo it", async () => {
  snapRunner.forceEnabled = true;
  snapRunner.running = async () => true;
  snapRunner.exec = (botId, args) => runLocal(botId, args);
  snapRunner.any = (botId, args) => runLocal(botId, args);
  const fb = (await call("POST", "/bots", { name: "Files" })).json.bot as Bot;
  const h = homeOf(fb.id);
  writeFileSync(path.join(h, "notes.md"), "one\ntwo\n");
  onScriptedTurn = () => { writeFileSync(path.join(h, "notes.md"), "one\nTWO\nthree\n"); writeFileSync(path.join(h, "created.txt"), "new\n"); };
  await call("POST", `/bots/${fb.id}/messages`, { text: "Écris" });
  await idle(fb.id);
  onScriptedTurn = null;
  await settled(fb.id);
  const card = (await rowsOf(fb.id)).find((r) => r.body.kind === "card" && r.body.card.type === "files")!;
  assert.ok(card, "files card");
  const fc = card.body.kind === "card" && card.body.card.type === "files" ? card.body.card : null;
  assert.deepEqual(fc!.files.map((f) => [f.path, f.change, f.added, f.removed]), [["created.txt", "added", 1, 0], ["notes.md", "modified", 2, 1]]);
  const d = await call("GET", `/bots/${fb.id}/cards/${card.seq}/files/diff?path=notes.md`);
  assert.equal(d.status, 200);
  assert.match(d.json.diff, /^\+TWO$/m);
  assert.equal((await call("GET", `/bots/${fb.id}/cards/${card.seq}/files/diff?path=../etc/passwd`)).status, 400);
  // Not someone else's; not without confirming; only listed paths.
  assert.equal((await other("POST", `/bots/${fb.id}/cards/${card.seq}/files`, { action: "undo", confirm: true })).status, 404);
  assert.equal((await call("POST", `/bots/${fb.id}/cards/${card.seq}/files`, { action: "undo" })).status, 400);
  assert.equal((await call("POST", `/bots/${fb.id}/cards/${card.seq}/files`, { action: "undo", confirm: true, paths: ["other.txt"] })).status, 400);
  // A file changed again after the turn is left alone.
  writeFileSync(path.join(h, "created.txt"), "edited by hand\n");
  const u = await call("POST", `/bots/${fb.id}/cards/${card.seq}/files`, { action: "undo", confirm: true });
  assert.equal(u.status, 200, u.text);
  assert.deepEqual(u.json.restored, ["notes.md"]);
  assert.deepEqual(u.json.changedSince, ["created.txt"]);
  assert.equal(readFileSync(path.join(h, "notes.md"), "utf8"), "one\ntwo\n");
  assert.equal(readFileSync(path.join(h, "created.txt"), "utf8"), "edited by hand\n");
  const after = (await rowsOf(fb.id)).find((r) => r.seq === card.seq)!;
  assert.equal(after.body.kind === "card" && after.body.card.type === "files" ? after.body.card.status : "", "undone");
  assert.equal((await call("POST", `/bots/${fb.id}/cards/${card.seq}/files`, { action: "undo", confirm: true })).status, 409);
  // A turn that changes nothing adds no card.
  const before = (await rowsOf(fb.id)).filter((r) => r.body.kind === "card" && r.body.card.type === "files").length;
  await call("POST", `/bots/${fb.id}/messages`, { text: "Rien" });
  await idle(fb.id);
  await settled(fb.id);
  assert.equal((await rowsOf(fb.id)).filter((r) => r.body.kind === "card" && r.body.card.type === "files").length, before);
  snapRunner.forceEnabled = false;
});
