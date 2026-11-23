import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L76 (telegramsend.ts): a message to Telegram is checked and retried (429 retry_after, 5xx), never retried on a
// refusal that will not change (403), a notice in the web chat when it still fails (once per 10 minutes), and a link
// to the card under what the bot waits on.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l76-"));
process.env.SESSION_SECRET = "l76-secret-l76-secret-l76-secret-l76";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://bots.example.test";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

let plan: { status: number; body: unknown }[] = [];
const sent: { method: string; body: any }[] = [];
let mid = 500;
const local = createServer(async (req, res) => {
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const m = /^\/bot[^/]+\/(\w+)$/.exec(new URL(req.url ?? "/", "http://x").pathname);
  res.setHeader("content-type", "application/json");
  const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
  if (m?.[1] === "getMe") return res.end(JSON.stringify({ ok: true, result: { id: 1, is_bot: true, username: "l76_bot" } }));
  if (m?.[1] === "getUpdates") { await new Promise((r) => setTimeout(r, 50)); return res.end(JSON.stringify({ ok: true, result: [] })); }
  sent.push({ method: m?.[1] ?? "", body });
  const next = m?.[1] === "sendMessage" ? plan.shift() : undefined;
  if (next) { res.statusCode = next.status; return res.end(JSON.stringify(next.body)); }
  res.end(JSON.stringify({ ok: true, result: { message_id: ++mid } }));
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
process.env.TELEGRAM_API_URL = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { telegram, send } = await import("../src/telegram.js");
const { retryDelay, setSendSleep, cardLink, cardLinkLine, failedNotice, SEND_TRIES } = await import("../src/telegramsend.js");
const { bots, users, rows } = await import("../src/store.js");
after(() => { telegram.stopAll(); local.closeAllConnections(); local.close(); });

const waits: number[] = [];
setSendSleep(async (ms) => { waits.push(ms); });
const owner = users.create("l76@test.local", "A", "unused", "fr");
const created = bots.create(owner.id, { name: "Tg" });
await telegram.connect(bots.byId(created.id)!, "123:fake-token-for-tests");
bots.linkTelegram(created.id, "42");
const bot = () => bots.byId(created.id)!;
const notices = () => rows.list(created.id, bot().generation, 50).filter((r) => r.body.kind === "notice" && /Telegram/.test((r.body as any).text));

test("L76 retry rules: 429 waits retry_after (capped at 30 s), 5xx and network 1 s then 3 s, 4xx never", () => {
  assert.equal(retryDelay(Object.assign(new Error("x"), { status: 429, retryAfter: 4 }), 1), 4000);
  assert.equal(retryDelay(Object.assign(new Error("x"), { status: 429, retryAfter: 999 }), 1), 30_000);
  assert.equal(retryDelay(Object.assign(new Error("x"), { status: 502 }), 1), 1000);
  assert.equal(retryDelay(new Error("fetch failed"), 2), 3000);
  assert.equal(retryDelay(Object.assign(new Error("x"), { status: 403 }), 1), null);
  assert.equal(retryDelay(Object.assign(new Error("x"), { status: 400 }), 1), null);
});

test("L76 a 429 then a 502 are retried and the message arrives once; no notice", async () => {
  sent.length = 0; waits.length = 0;
  plan = [{ status: 429, body: { ok: false, error_code: 429, description: "Too Many Requests: retry after 2", parameters: { retry_after: 2 } } }, { status: 502, body: { ok: false, description: "Bad Gateway" } }];
  const ids = await send(bot(), "Bonjour");
  assert.equal(ids.length, 1);
  assert.equal(sent.filter((s) => s.method === "sendMessage").length, 3);
  assert.deepEqual(waits, [2000, 3000]);
  assert.equal(notices().length, 0);
});

test("L76 a 403 is not retried and leaves one notice in the web chat; a second failure soon after adds none", async () => {
  sent.length = 0; waits.length = 0;
  plan = [{ status: 403, body: { ok: false, error_code: 403, description: "Forbidden: bot was blocked by the user" } }];
  assert.deepEqual(await send(bot(), "Réponse"), []);
  assert.equal(sent.length, 1, "not retried");
  assert.equal(notices().length, 1);
  assert.match((notices()[0].body as any).text, /^Un message n'a pas pu partir sur Telegram\. Telegram refuse : le bot a peut-être été bloqué dans Telegram\. Il reste lisible ici\.$/);
  plan = Array.from({ length: SEND_TRIES }, () => ({ status: 500, body: { ok: false, description: "Internal" } }));
  assert.deepEqual(await send(bot(), "Encore"), []);
  assert.equal(sent.length, 1 + SEND_TRIES, "5xx tried SEND_TRIES times");
  assert.equal(notices().length, 1, "at most one notice per 10 minutes");
  assert.equal(failedNotice(bot(), new Error("x"), Date.now() + 11 * 60_000), true, "after 10 minutes, a new notice");
});

test("L76 the link to the card opens this bot in the app", () => {
  assert.equal(cardLink(created.id), `https://bots.example.test/?bot=${created.id}`);
  assert.equal(cardLinkLine(created.id, true), `Ouvrir la carte : https://bots.example.test/?bot=${created.id}`);
  assert.match(cardLinkLine(created.id, false), /^Open the card: https:\/\/bots\.example\.test\/\?bot=/);
});
