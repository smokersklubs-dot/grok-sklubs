import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// nod audit item 5 / row 68 (telegramplus.ts, telegram.ts): ✅/❌ buttons under an approval question in the user's
// language (never for a payment), photos / voice notes / files received into the bot's library (20 MB limit), files the
// bot attaches sent back, long replies split at paragraphs with code blocks kept whole, "typing…" while it works.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-nod-telegram-"));
process.env.SESSION_SECRET = "nod-telegram-secret-nod-telegram-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.DEFAULT_MODEL = "script:script-1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.TELEGRAM_RETRY_MS = "30";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const sent: { method: string; body: any }[] = [];
const updates: any[] = [];
let updateId = 1, messageId = 100;
const FILES: Record<string, { path: string; bytes: Buffer; size: number }> = {
  photo_big: { path: "photos/file_1.jpg", bytes: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), size: 7 },
  voice_1: { path: "voice/file_2.oga", bytes: Buffer.from("OggS-fake-voice"), size: 15 },
  bad_path: { path: "../etc/passwd", bytes: Buffer.from("x"), size: 1 },
};
const local = createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const raw = Buffer.concat(chunks);
  const file = /^\/file\/bot[^/]+\/(.+)$/.exec(url.pathname);
  if (file) { const f = Object.values(FILES).find((x) => x.path === decodeURIComponent(file[1])); res.end(f?.bytes ?? ""); return; }
  const tg = /^\/bot([^/]+)\/(\w+)$/.exec(url.pathname);
  res.setHeader("content-type", "application/json");
  if (!tg) { res.statusCode = 404; res.end("{}"); return; }
  const isJson = String(req.headers["content-type"] ?? "").includes("json");
  const body = isJson ? (raw.length ? JSON.parse(raw.toString()) : {}) : { multipart: raw.toString("latin1") };
  const ok = (result: unknown) => res.end(JSON.stringify({ ok: true, result }));
  if (tg[2] === "getUpdates") {
    for (let i = 0; i < 15 && !updates.some((u) => u.update_id >= body.offset); i++) await new Promise((r) => setTimeout(r, 20));
    return ok(updates.filter((u) => u.update_id >= body.offset));
  }
  sent.push({ method: tg[2], body });
  if (tg[2] === "getMe") return ok({ id: 1, is_bot: true, username: "nod_test_bot" });
  if (tg[2] === "getFile") { const f = FILES[body.file_id]; return f ? ok({ file_id: body.file_id, file_path: f.path, file_size: f.size }) : res.end(JSON.stringify({ ok: false, description: "Bad Request: file is too big" })); }
  return ok({ message_id: ++messageId });
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { telegram, send } = await import("../src/telegram.js");
const { bots, approvals, rows, users } = await import("../src/store.js");
const { splitTelegram, incomingFile, parseApprovalCallback, sendMethodFor, approvalKeyboard } = await import("../src/telegramplus.js");
const { storeBytes } = await import("../src/computer.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const seen: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    seen.push(req);
    return { content: [{ type: "text", text: "Bien reçu." }], stopReason: "end", model: "script-1", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
  },
});
const cookies: Record<string, string> = {};
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: cookies.a ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookies.a = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}
async function until<T>(fn: () => T | Promise<T>, what: string, ms = 8000): Promise<NonNullable<T>> {
  const end = Date.now() + ms;
  for (;;) { const v = await fn(); if (v) return v as NonNullable<T>; if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 25)); }
}
after(() => { telegram.stopAll(); local.closeAllConnections(); local.close(); });

await call("POST", "/auth/signup", { email: "owner@example.com", name: "Owner", password: "password-1", locale: "fr" });
const botId = (await call("GET", "/bots")).json.bots[0].id;
const userId = bots.byId(botId)!.userId;
const status = await telegram.connect(bots.byId(botId)!, "123:abc");
telegram.start();
const push = (u: Record<string, unknown>) => updates.push({ update_id: updateId++, ...u });
push({ message: { message_id: 1, text: `/start ${status.linkCode}`, chat: { id: 42, type: "private" } } });
await until(() => bots.byId(botId)!.telegramChatId === "42", "linked");

test("long replies are split at paragraph breaks, every part within 4096 characters, code blocks closed and reopened", () => {
  const para = "Une phrase assez longue pour remplir la ligne. ".repeat(40);
  const parts = splitTelegram(`${para}\n\n${para}\n\n${para}`);
  assert.ok(parts.length >= 2);
  for (const p of parts) assert.ok(p.length <= 4096, `part of ${p.length}`);
  assert.ok(parts.every((p) => p.endsWith(".")), "cut at a sentence/paragraph boundary, not mid-word");
  const code = "```ts\n" + "const x = 1;\n".repeat(600) + "```";
  const cparts = splitTelegram(code);
  assert.ok(cparts.length >= 2);
  for (const p of cparts) { assert.equal((p.match(/^```/gm) ?? []).length % 2, 0, "each part has balanced fences"); assert.ok(p.length <= 4096); }
  assert.ok(cparts[1].startsWith("```ts\n"), "reopened with its language");
  const emoji = "😀".repeat(3000);
  for (const p of splitTelegram(emoji)) assert.ok(!/[\ud800-\udbff]$/.test(p), "no broken emoji");
  assert.deepEqual(splitTelegram("court"), ["court"]);
});

test("pure helpers: incoming file names and types, callback data within 64 bytes, method per file", () => {
  assert.deepEqual(incomingFile({ photo: [{ file_id: "s", file_size: 1 }, { file_id: "big", file_size: 9 }] }), { fileId: "big", name: "photo.jpg", mime: "image/jpeg", size: 9, voice: false });
  assert.equal(incomingFile({ voice: { file_id: "v" } })!.mime, "audio/ogg");
  assert.equal(incomingFile({ document: { file_id: "d", file_name: "../rapport.pdf", mime_type: "application/pdf" } })!.name, ".._rapport.pdf");
  assert.equal(incomingFile({}), null);
  const kb = approvalKeyboard("apv_0123456789abcdef", "fr");
  assert.equal(kb.inline_keyboard[0][0].text, "✅ Oui");
  assert.equal(kb.inline_keyboard[0][1].text, "❌ Non");
  assert.ok(Buffer.byteLength(kb.inline_keyboard[0][0].callback_data) <= 64);
  assert.deepEqual(parseApprovalCallback("ap:apv_1:y"), { approvalId: "apv_1", allow: true });
  assert.equal(parseApprovalCallback("ap:../x:y"), null);
  assert.equal(sendMethodFor({ mime: "image/png", size: 1000, name: "a.png" })!.method, "sendPhoto");
  assert.equal(sendMethodFor({ mime: "image/png", size: 11 * 1024 * 1024, name: "a.png" })!.method, "sendDocument");
  assert.equal(sendMethodFor({ mime: "audio/ogg", size: 10, name: "v.ogg" })!.method, "sendVoice");
  assert.equal(sendMethodFor({ mime: "application/pdf", size: 51 * 1024 * 1024, name: "big.pdf" }), null);
});

test("an approval question carries ✅ Oui / ❌ Non; a press answers it; a payment is never answered from Telegram", async () => {
  const bot = bots.byId(botId)!;
  const a = approvals.create(bot.id, userId, bot.generation, 1, "app_mail__send", undefined, "h1");
  const ids = await send(bot, "⏳ Envoyer le mail à Camille ?", { kind: "approval", approvalId: a.id });
  const msg = sent.filter((s) => s.method === "sendMessage").at(-1)!;
  assert.deepEqual(msg.body.reply_markup.inline_keyboard[0].map((b: any) => b.text), ["✅ Oui", "❌ Non"]);
  push({ callback_query: { id: "cb1", data: `ap:${a.id}:y`, from: { id: 42 }, message: { message_id: ids[0], chat: { id: 42, type: "private" } } } });
  await until(() => approvals.byId(a.id)!.status !== "pending", "approval answered by the button");
  await until(() => sent.some((s) => s.method === "answerCallbackQuery" && s.body.callback_query_id === "cb1"), "callback answered");
  await until(() => sent.some((s) => s.method === "editMessageReplyMarkup" && s.body.message_id === ids[0]), "buttons removed");
  assert.ok(q.get("SELECT 1 FROM audit WHERE text LIKE '%approval answered from Telegram (button yes)%'"));
  // A second press on the same question: already answered.
  push({ callback_query: { id: "cb2", data: `ap:${a.id}:n`, from: { id: 42 }, message: { message_id: ids[0], chat: { id: 42, type: "private" } } } });
  const second = await until(() => sent.find((s) => s.method === "answerCallbackQuery" && s.body.callback_query_id === "cb2"), "second press answered");
  assert.equal(second.body.text, "Cette demande a déjà une réponse.");
  // A payment: refused from Telegram, stays pending.
  const pay = approvals.create(bot.id, userId, bot.generation, 2, "card: Visa perso", undefined, "h2");
  const pids = await send(bot, "⏳ Payer ?", { kind: "approval", approvalId: pay.id });
  push({ callback_query: { id: "cb3", data: `ap:${pay.id}:y`, from: { id: 42 }, message: { message_id: pids[0], chat: { id: 42, type: "private" } } } });
  const lock = await until(() => sent.find((s) => s.method === "answerCallbackQuery" && s.body.callback_query_id === "cb3"), "payment press answered");
  assert.equal(lock.body.text, "🔒 Celle-ci se valide dans l'appli.");
  assert.equal(approvals.byId(pay.id)!.status, "pending");
  // A press from someone else, or for a message that is not this approval, does nothing.
  const other = approvals.create(bot.id, userId, bot.generation, 3, "app_mail__send", undefined, "h3");
  push({ callback_query: { id: "cb4", data: `ap:${other.id}:y`, from: { id: 7 }, message: { message_id: ids[0], chat: { id: 42, type: "private" } } } });
  push({ callback_query: { id: "cb5", data: `ap:${other.id}:y`, from: { id: 42 }, message: { message_id: ids[0], chat: { id: 42, type: "private" } } } });
  await until(() => sent.some((s) => s.body.callback_query_id === "cb5"), "cb5 answered");
  assert.equal(approvals.byId(other.id)!.status, "pending");
});

test("a photo and a voice note reach the bot as attachments; a file over 20 MB or a bad path is refused with a reason", async () => {
  const before = seen.length;
  push({ message: { message_id: 50, chat: { id: 42, type: "private" }, caption: "Regarde cette photo", photo: [{ file_id: "small", file_size: 1 }, { file_id: "photo_big", file_size: 7 }] } });
  const row = await until(() => rows.list(botId, bots.byId(botId)!.generation, 50).find((r) => r.body.kind === "message" && r.body.role === "user" && r.body.text === "Regarde cette photo"), "photo row");
  assert.equal(row.body.kind === "message" && row.body.attachments?.[0].mime, "image/jpeg");
  await until(() => seen.length > before, "the bot was asked");
  await until(() => sent.some((s) => s.method === "sendChatAction" && s.body.action === "typing"), "typing shown");
  push({ message: { message_id: 51, chat: { id: 42, type: "private" }, voice: { file_id: "voice_1", file_size: 15, mime_type: "audio/ogg" } } });
  const voice = await until(() => rows.list(botId, bots.byId(botId)!.generation, 50).find((r) => r.body.kind === "message" && r.body.role === "user" && /message vocal/.test(r.body.text)), "voice row");
  assert.equal(voice.body.kind === "message" && voice.body.attachments?.[0].mime, "audio/ogg");
  push({ message: { message_id: 52, chat: { id: 42, type: "private" }, document: { file_id: "huge", file_size: 25 * 1024 * 1024, file_name: "film.mov" } } });
  await until(() => sent.find((s) => s.method === "sendMessage" && /dépasse 20 Mo/.test(s.body.text)), "too large said");
  push({ message: { message_id: 53, chat: { id: 42, type: "private" }, document: { file_id: "bad_path", file_size: 1, file_name: "x.txt" } } });
  await until(() => sent.find((s) => s.method === "sendMessage" && /pas pu récupérer ce fichier/.test(s.body.text)), "bad path refused");
  assert.equal(rows.list(botId, bots.byId(botId)!.generation, 80).filter((r) => r.body.kind === "message" && r.body.attachments?.some((a) => a.name === "film.mov" || a.name === "x.txt")).length, 0);
  // From another chat: nothing is downloaded.
  const gets = sent.filter((s) => s.method === "getFile").length;
  push({ message: { message_id: 54, chat: { id: 99, type: "private" }, photo: [{ file_id: "photo_big", file_size: 7 }] } });
  await until(() => sent.find((s) => s.method === "sendMessage" && s.body.chat_id === "99"), "stranger refused");
  assert.equal(sent.filter((s) => s.method === "getFile").length, gets);
});

test("a file the bot attaches to its reply is sent to Telegram (sendDocument / sendPhoto)", async () => {
  const bot = bots.byId(botId)!;
  const file = storeBytes(bot.id, "exports", "rapport.pdf", Buffer.from("%PDF-1.4 fake"));
  rows.append(bot, { kind: "message", role: "user", text: "Envoie-moi le rapport" });
  rows.append(bot, { kind: "message", role: "assistant", text: "Voici le rapport.", attachments: [{ ...file, mime: "application/pdf" }] });
  // The reply event a turn ends with (telegram.start listens to it).
  const { tell } = await import("../src/agent/loop.js");
  tell({ type: "reply", bot, text: "Voici le rapport." });
  const doc = await until(() => sent.find((s) => s.method === "sendDocument"), "document sent");
  assert.match(doc.body.multipart, /name="document"; filename="rapport.pdf"/);
  assert.match(doc.body.multipart, /%PDF-1.4 fake/);
  assert.equal(users.localeOf(userId), "fr");
});
