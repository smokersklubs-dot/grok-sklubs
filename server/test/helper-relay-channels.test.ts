import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L25 (RESTE 23/11): the owner's message reaches the helper at work also when it comes from the owner's Telegram chat
// (text and a file's caption) and from their linked Slack / Discord (channelrelay.ts ownerMessage) — never from a
// stranger's chat. Fake Telegram API on a local port, scripted model, a helper kept busy with a slow call.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-relaych-"));
process.env.SESSION_SECRET = "relay-ch-secret-relay-ch-secret-0001";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.TELEGRAM_RETRY_MS = "30";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY", "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "XAI_API_KEY"]) delete process.env[k];

const updates: any[] = [];
let updateId = 1, messageId = 100;
const local = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks).toString();
  const tg = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  res.setHeader("content-type", "application/json");
  if (!tg) { res.statusCode = 404; res.end("{}"); return; }
  const body = raw && String(req.headers["content-type"]).includes("json") ? JSON.parse(raw) : {};
  const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
  if (tg[2] === "getUpdates") {
    for (let i = 0; i < 15 && !updates.some((u) => u.update_id >= body.offset); i++) await new Promise((r) => setTimeout(r, 20));
    return ok(updates.filter((u) => u.update_id >= body.offset));
  }
  if (tg[2] === "getMe") return ok({ id: 1, is_bot: true, username: "relay_test_bot" });
  return ok({ message_id: ++messageId });
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { telegram } = await import("../src/telegram.js");
const { ownerMessage } = await import("../src/channelrelay.js");
const { bots, rows } = await import("../src/store.js");
const { startHelper } = await import("../src/agent/team.js");
const { interrupt, runningThreads } = await import("../src/agent/loop.js");
const { waitingNotes } = await import("../src/agent/steering.js");
const { RELAY_PREFIX } = await import("../src/agent/helperrelay.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
let release = false;
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const last = req.messages[req.messages.length - 1];
    const text = last.content.map((b) => (b.type === "text" ? b.text : "")).join(" ");
    if (/work slowly/.test(text)) { for (let i = 0; i < 600 && !req.signal?.aborted && !release; i++) await sleep(25); if (req.signal?.aborted) throw new Error("aborted"); }
    return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});
let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(fn: () => T | Promise<T>, what: string, ms = 10_000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as NonNullable<T>; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await sleep(25); }
}
after(() => { release = true; telegram.stopAll(); local.closeAllConnections(); local.close(); });

await call("POST", "/auth/signup", { email: "relay@example.com", name: "Owner", password: "password-1", locale: "en" });
const botId = (await call("GET", "/bots")).json.bots[0].id as string;
const status = await telegram.connect(bots.byId(botId)!, "123:abc");
telegram.start();
const push = (u: Record<string, unknown>) => updates.push({ update_id: updateId++, ...u });
push({ message: { message_id: 1, text: `/start ${status.linkCode}`, chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Owner" } } });
await until(() => bots.byId(botId)!.telegramChatId === "42", "linked");

const parent = bots.byId(botId)!;
const prefix = RELAY_PREFIX.replaceAll("{parent}", parent.name);
const helper = startHelper(parent, "work slowly RELAYJOB", "job", 0);
await until(() => runningThreads(helper.id).length > 0, "helper running");
const notesWith = (re: RegExp) => waitingNotes(helper.id).filter((n: { text: string }) => re.test(n.text));

test("L25: the owner's Telegram message also reaches the helper at work", async () => {
  push({ message: { message_id: 2, text: "TGRELAY also check the opening hours", chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Owner" } } });
  const notes = await until(() => { const n = notesWith(/TGRELAY/); return n.length ? n : null; }, "relayed note");
  assert.equal(notes.length, 1);
  assert.ok(notes[0].text.startsWith(prefix));
  const notices = rows.list(botId, bots.byId(botId)!.generation, 200).filter((r) => r.body.kind === "notice" && /Also passed to the helper at work/.test(r.body.text));
  assert.ok(notices.length >= 1, "the chat says the helper got it");
});

test("L25: a stranger's Telegram message never reaches the helper", async () => {
  push({ message: { message_id: 3, text: "STRANGERWORDS do something", chat: { id: 77, type: "private" }, from: { id: 77, first_name: "Camille" } } });
  push({ message: { message_id: 4, text: "TGAFTER marker", chat: { id: 42, type: "private" }, from: { id: 42, first_name: "Owner" } } });
  await until(() => notesWith(/TGAFTER/).length > 0, "the owner's later note");
  assert.equal(notesWith(/STRANGERWORDS/).length, 0);
});

test("L25: the owner's message from Slack / Discord also reaches the helper at work", async () => {
  const sent: string[] = [];
  ownerMessage(bots.byId(botId)!, "slack", "SLACKRELAY and the prices", [], { text: async (t: string) => { sent.push(t); } });
  const notes = await until(() => { const n = notesWith(/SLACKRELAY/); return n.length ? n : null; }, "slack note");
  assert.ok(notes[0].text.startsWith(prefix));
  interrupt(helper.id);
  await until(() => runningThreads(helper.id).length === 0, "helper stopped");
});
