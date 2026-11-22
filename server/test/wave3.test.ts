import assert from "node:assert/strict";
import { createECDH, createDecipheriv, createHmac, createPublicKey, verify } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w3-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
// The fake push service and API of these tests listen on this machine; outside tests such addresses are refused.
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.SHELL_ENABLED = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";

// ── A fake push service (records and answers per endpoint) and a fake API that wants a key ──
const pushed: { path: string; headers: IncomingMessage["headers"]; body: Buffer }[] = [];
const apiSeen: { path: string; headers: IncomingMessage["headers"]; body: string }[] = [];
const local = createServer(async (req: IncomingMessage, res: ServerResponse) => {
  const url = new URL(req.url!, "http://x");
  const chunks: Buffer[] = [];
  for await (const c of req) chunks.push(c as Buffer);
  const body = Buffer.concat(chunks);
  if (url.pathname.startsWith("/push/")) {
    pushed.push({ path: url.pathname, headers: req.headers, body });
    res.statusCode = url.pathname.includes("gone") ? 410 : 201; res.end(); return;
  }
  if (url.pathname.startsWith("/api/")) {
    apiSeen.push({ path: url.pathname, headers: req.headers, body: body.toString() });
    if (req.headers.authorization !== "Bearer sk-live-SECRET-12345") { res.statusCode = 401; res.end("no"); return; }
    res.setHeader("content-type", "application/json");
    // A careless API that echoes the key back: it must never reach the model or the chat.
    res.end(JSON.stringify({ ok: true, echoed: "sk-live-SECRET-12345", path: url.pathname }));
    return;
  }
  res.statusCode = 404; res.end();
});
await new Promise<void>((r) => local.listen(0, "127.0.0.1", () => r()));
const base = `http://127.0.0.1:${(local.address() as { port: number }).port}`;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { screen, initComputer, browserAvailable } = await import("../src/computer.js");
await initComputer();
/** Screen tools exist only where bots have a screen (a browser engine here; the screen itself is stubbed below). */
const noScreen = !browserAvailable() && "no browser engine installed";
const { vault, policies, bots, users } = await import("../src/store.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { unseal } = await import("../src/auth.js");
const { q } = await import("../src/db.js");
const { encryptPush, vapidHeader, inQuietHours, DEFAULT_PUSH } = await import("../src/push.js");
const { hotp, parseTotp, totpNow, base32Decode, generatePassword } = await import("../src/totp.js");
const { parseCsv, detectMapping } = await import("../src/vault-import.js");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

/** Scripted model, as in the other suites: "call T {json}" → one tool; "chain A {…} >> B {…}" → tools in turn; else echoes. */
const requests: TurnRequest[] = [];
const queue: { name: string; input: any }[] = [];
const scripted: LlmProvider = {
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    const use = (t: { name: string; input: any }): Block[] => [{ type: "tool_use", id: `call_${requests.length}`, name: t.name, input: t.input }];
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = queue.length ? use(queue.shift()!) : [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const parse = (s: string) => { const m = /(\w+) (\{[^\n]*?\})(?=\s*(>>|\n|$))/.exec(s)!; return { name: m[1], input: JSON.parse(m[2]) }; };
      if (said.includes("chain ")) { const steps = said.slice(said.indexOf("chain ") + 6).split(" >> ").map(parse); queue.push(...steps.slice(1)); content = use(steps[0]); }
      else if (/call \w+ \{/.test(said)) content = use(parse(said.slice(said.indexOf("call ") + 5)));
      else content = [{ type: "text", text: `Echo: ${said}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
  },
};
registerProvider(scripted);
after(() => { local.closeAllConnections(); local.close(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string): Promise<T> {
  for (let i = 0; i < 1600; i++) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 25)); }
  throw new Error(`timed out waiting for ${label}`);
}
const lastAssistant = (list: Row[]) => [...list].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming && r.body.text);
const replied = (bot: Bot, part: string) => until(async () => { const r = lastAssistant(await rowsOf(bot.id)); return r?.body.kind === "message" && r.body.text.includes(part) && r; }, `reply containing "${part}"`);
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const cardOf = <T extends string>(type: T) => (bot: Bot) => until(async () => { const r = [...(await rowsOf(bot.id))].reverse().find((x) => x.body.kind === "card" && x.body.card.type === type); return r?.body.kind === "card" ? { row: r, card: r.body.card as any } : null; }, `${type} card`);
const pendingApproval = async (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval");
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running && !r.json.live?.[bot.id]?.awaiting; }, "bot idle");
const historyText = (botId: string) => q.all<{ content: string }>("SELECT content FROM history WHERE bot_id = ?", botId).map((r) => r.content).join("\n");

let bot: Bot;
let userId = "";

test("setup", async () => {
  const r = await call("POST", "/auth/signup", { email: "nina@example.com", name: "Nina", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  assert.ok(bot);
});

// ── Web Push: the standards' own test vectors, then real deliveries to a fake push service ──
test("push: encryption reproduces the RFC 8291 section 5 example byte for byte", () => {
  const ua = Buffer.from("BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4", "base64url");
  const body = encryptPush(ua, Buffer.from("BTBZMqHH6r4Tts7J_aSIgg", "base64url"), Buffer.from("When I grow up, I want to be a watermelon"), {
    salt: Buffer.from("DGv6ra1nlYgDCS1FRnbzlw", "base64url"), senderPrivate: Buffer.from("yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw", "base64url"),
  });
  assert.equal(body.toString("base64url"), "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN");
  // 86-octet header + 41 + 1 delimiter + 16 tag (the example's "Content-Length: 145" line does not match its own body).
  assert.equal(body.length, 144);
});

/** What a browser does with a push message (RFC 8291 section 3.4 from the user agent's side). */
function decryptPush(body: Buffer, uaPrivate: Buffer, auth: Buffer): string {
  const ua = createECDH("prime256v1"); ua.setPrivateKey(uaPrivate);
  const salt = body.subarray(0, 16), idlen = body[20], asPublic = body.subarray(21, 21 + idlen);
  const h = (k: Buffer, d: Buffer) => createHmac("sha256", k).update(d).digest();
  const prkKey = h(auth, ua.computeSecret(asPublic));
  const ikm = h(prkKey, Buffer.concat([Buffer.from("WebPush: info\0"), ua.getPublicKey(), asPublic, Buffer.from([1])]));
  const prk = h(salt, ikm);
  const d = createDecipheriv("aes-128-gcm", h(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16), h(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12));
  const rec = body.subarray(21 + idlen);
  d.setAuthTag(rec.subarray(rec.length - 16));
  const plain = Buffer.concat([d.update(rec.subarray(0, rec.length - 16)), d.final()]);
  assert.equal(plain[plain.length - 1], 2, "last-record delimiter");
  return plain.subarray(0, plain.length - 1).toString();
}

function vapidOk(header: string, endpoint: string) {
  const m = /^vapid t=([^,]+), k=(.+)$/.exec(header);
  assert.ok(m, header);
  const [h, c, sig] = m![1].split(".");
  const claims = JSON.parse(Buffer.from(c, "base64url").toString());
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { typ: "JWT", alg: "ES256" });
  assert.equal(claims.aud, new URL(endpoint).origin, "aud is the push service's origin");
  assert.ok(claims.exp > Date.now() / 1000 && claims.exp <= Date.now() / 1000 + 24 * 3600, "exp within 24 h (RFC 8292 section 2)");
  assert.equal(claims.sub, "https://sklubot.example");
  const raw = Buffer.from(m![2], "base64url");
  const key = createPublicKey({ key: { kty: "EC", crv: "P-256", x: raw.subarray(1, 33).toString("base64url"), y: raw.subarray(33).toString("base64url") }, format: "jwk" });
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")), "ES256 signature verifies with k");
}

const device = () => { const e = createECDH("prime256v1"); e.generateKeys(); return { ecdh: e, auth: Buffer.from("0123456789abcdef") }; };
const phone = device();
let phoneId = "";

test("push: devices subscribe with checked keys; the VAPID key is made once and its private half sealed", async () => {
  const first = await call("GET", "/push");
  assert.equal(Buffer.from(first.json.publicKey, "base64url").length, 65);
  assert.equal((await call("GET", "/push")).json.publicKey, first.json.publicKey, "generated once");
  const stored = q.get<{ private_enc: string }>("SELECT private_enc FROM server_keys WHERE name = 'vapid'")!;
  assert.doesNotMatch(stored.private_enc, /"d"/, "sealed at rest");

  assert.equal((await call("POST", "/push/subscribe", { subscription: { endpoint: "ftp://x/y", keys: { p256dh: phone.ecdh.getPublicKey("base64url"), auth: phone.auth.toString("base64url") } } })).status, 400);
  assert.equal((await call("POST", "/push/subscribe", { subscription: { endpoint: `${base}/push/a`, keys: { p256dh: "abc", auth: "def" } } })).status, 400, "bad keys");
  const ok = await call("POST", "/push/subscribe", { subscription: { endpoint: `${base}/push/phone`, keys: { p256dh: phone.ecdh.getPublicKey("base64url"), auth: phone.auth.toString("base64url") } }, label: "Pixel" });
  assert.equal(ok.status, 200, ok.text);
  phoneId = ok.json.device.id;
  const state = (await call("GET", `/push?endpoint=${encodeURIComponent(`${base}/push/phone`)}`)).json;
  assert.equal(state.currentId, phoneId);
  assert.deepEqual(state.devices.map((d: any) => d.label), ["Pixel"]);
  assert.doesNotMatch(JSON.stringify(state), /p256dh|auth_enc|0123456789abcdef/, "the subscription's keys never come back");
});

test("push: a test notification is encrypted for the device, signed with VAPID, and readable by it", async () => {
  pushed.length = 0;
  const r = await call("POST", "/push/test");
  assert.equal(r.json.sent, 1);
  const got = pushed[0];
  assert.equal(got.headers["content-encoding"], "aes128gcm");
  assert.ok(Number(got.headers.ttl) > 0);
  assert.equal(got.headers.urgency, "high");
  vapidOk(String(got.headers.authorization), `${base}/push/phone`);
  const payload = JSON.parse(decryptPush(got.body, phone.ecdh.getPrivateKey(), phone.auth));
  assert.equal(payload.body, "Les notifications fonctionnent sur cet appareil.");
});

test("push: a bot that needs the user is pushed (with the bot to open); kinds, quiet hours and device switches are respected", async () => {
  pushed.length = 0;
  // Commands on the server itself always ask: the approval card is a "needs you".
  await say(bot, 'call shell_run {"command": "echo hi"}');
  await pendingApproval(bot);
  await until(() => pushed.length >= 1, "push");
  const p = JSON.parse(decryptPush(pushed[0].body, phone.ecdh.getPrivateKey(), phone.auth));
  assert.equal(p.kind, "needs");
  assert.equal(p.botId, bot.id);
  assert.equal(p.url, `/?bot=${bot.id}`);
  assert.equal(p.title, bot.name);
  const card = await pendingApproval(bot);
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await idle(bot);

  // A reply is pushed only while no app window is visible.
  await call("POST", "/presence", { clientId: "tab1", visible: true });
  pushed.length = 0;
  await say(bot, "Bonjour");
  await replied(bot, "Echo: Bonjour");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushed.length, 0, "visible: no push for a reply");
  await call("POST", "/presence", { clientId: "tab1", visible: false });
  await say(bot, "Encore");
  await replied(bot, "Echo: Encore");
  await until(() => pushed.length >= 1, "reply push");
  assert.equal(JSON.parse(decryptPush(pushed[0].body, phone.ecdh.getPrivateKey(), phone.auth)).kind, "reply");

  // Replies switched off.
  await call("PUT", "/push/settings", { kinds: { reply: false } });
  pushed.length = 0;
  await say(bot, "Trois");
  await replied(bot, "Echo: Trois");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushed.length, 0, "kind off");
  await call("PUT", "/push/settings", { kinds: { reply: true } });

  // Quiet hours cover the whole day here: nothing but a test goes.
  assert.equal((await call("PUT", "/push/settings", { quiet: { timezone: "Mars/Olympus" } })).status, 400);
  await call("PUT", "/push/settings", { quiet: { enabled: true, start: "00:00", end: "23:59", timezone: "Europe/Paris" } });
  pushed.length = 0;
  await say(bot, "Quatre");
  await replied(bot, "Echo: Quatre");
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(pushed.length, 0, "quiet hours");
  await call("PUT", "/push/settings", { quiet: { enabled: false } });

  // This device switched off.
  await call("PATCH", `/push/devices/${phoneId}`, { enabled: false });
  assert.equal((await call("POST", "/push/test")).json.sent, 0);
  await call("PATCH", `/push/devices/${phoneId}`, { enabled: true });
});

test("push: quiet hours across midnight", () => {
  const s = { ...DEFAULT_PUSH, quiet: { enabled: true, start: "22:00", end: "07:00", timezone: "UTC" } };
  assert.equal(inQuietHours(s, new Date("2026-01-01T23:30:00Z")), true);
  assert.equal(inQuietHours(s, new Date("2026-01-01T06:59:00Z")), true);
  assert.equal(inQuietHours(s, new Date("2026-01-01T12:00:00Z")), false);
});

test("push: a subscription the push service says is gone (410) is forgotten", async () => {
  const gone = device();
  await call("POST", "/push/subscribe", { subscription: { endpoint: `${base}/push/gone`, keys: { p256dh: gone.ecdh.getPublicKey("base64url"), auth: gone.auth.toString("base64url") } }, label: "Old laptop" });
  assert.equal((await call("GET", "/push")).json.devices.length, 2);
  await call("POST", "/push/test");
  assert.deepEqual((await call("GET", "/push")).json.devices.map((d: any) => d.label), ["Pixel"]);
  assert.match(vapidHeader("https://fcm.googleapis.com/fcm/send/abc"), /^vapid t=/);
});

// ── The bot asks for help and waits; the user's hands on the screen come first ──
test("takeover: the bot's screen actions are refused while the user drives, and allowed again after", { skip: noScreen }, async () => {
  screen.isOpen = () => true;
  screen.click = async () => ({ data: "", mediaType: "image/jpeg", url: "https://example.com/", title: "Example" });
  await call("POST", `/bots/${bot.id}/desktop/control`, { on: true });
  assert.equal((await call("GET", "/bots")).json.live[bot.id].driving, true);
  await say(bot, 'call screen_click {"x": 10, "y": 20}');
  await replied(bot, "The user is driving your screen right now");
  const step = [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "step" && r.body.tool === "screen_click")!;
  assert.equal(step.body.kind === "step" && step.body.status, "error");
  await call("POST", `/bots/${bot.id}/desktop/handback`);
  await say(bot, 'call screen_click {"x": 11, "y": 20}');
  await replied(bot, "Clicked at (11, 20)");
});

test("takeover: ask_takeover shows a card, pushes, waits until the user hands back, then the bot looks again", { skip: noScreen }, async () => {
  process.env.TAKEOVER_TIMEOUT_MS = "60000";
  pushed.length = 0;
  await say(bot, 'call ask_takeover {"reason": "captcha", "detail": "Coche la case du CAPTCHA puis valide."}');
  const { card } = await cardOf("takeover")(bot);
  assert.equal(card.status, "pending");
  assert.equal(card.reason, "captcha");
  await until(async () => (await call("GET", "/bots")).json.live[bot.id]?.awaiting, "awaiting");
  // Reply pushes of the previous turns may still be on their way: look for the takeover one among them.
  const bodies = () => pushed.filter((p) => p.path === "/push/phone").map((p) => JSON.parse(decryptPush(p.body, phone.ecdh.getPrivateKey(), phone.auth)).body as string);
  await until(() => bodies().some((b) => /a besoin de toi sur son écran/.test(b)), "takeover push");
  // The turn really waits.
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(lastAssistant(await rowsOf(bot.id))?.body.kind === "message" && /finished and handed/.test((lastAssistant(await rowsOf(bot.id))!.body as any).text), false);
  assert.equal((await call("POST", `/bots/${bot.id}/takeover/tko_nope/done`)).status, 404);
  assert.equal((await call("POST", `/bots/${bot.id}/takeover/${card.takeoverId}/done`)).status, 200);
  await replied(bot, "The user finished and handed the screen back");
  assert.equal((await cardOf("takeover")(bot)).card.status, "done");
});

test("takeover: after the timeout the bot is told the user did not come back", { skip: noScreen }, async () => {
  process.env.TAKEOVER_TIMEOUT_MS = "300";
  await say(bot, 'call ask_takeover {"reason": "2fa", "detail": "Entre le code reçu par SMS."}');
  await replied(bot, "did not come back within 30 minutes");
  assert.equal((await cardOf("takeover")(bot)).card.status, "timeout");
  process.env.TAKEOVER_TIMEOUT_MS = "60000";
});

// ── Vault: secrets the model never sees, TOTP, generated passwords, CSV import ──
test("vault: secret_request → secure card → secret_use injects it for the bound host only; it never reaches the model or the chat", async () => {
  await say(bot, 'call secret_request {"name": "Acme API", "reason": "Pour lire tes commandes", "host": "127.0.0.1"}');
  const { row, card } = await cardOf("secret")(bot);
  assert.deepEqual([card.status, card.host, card.header, card.prefix], ["pending", "127.0.0.1", "Authorization", "Bearer "]);
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${row.seq}/secret`, { value: "" })).status, 400);
  const before = requests.length;
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${row.seq}/secret`, { value: "sk-live-SECRET-12345" })).status, 200);
  await until(() => requests.length > before, "bot told");
  assert.match(JSON.stringify(requests[before].messages.slice(-1)), /saved the secret \\"Acme API\\"/);
  assert.equal((await call("POST", `/bots/${bot.id}/cards/${row.seq}/secret`, { value: "again" })).status, 409, "single use");
  const items = (await call("GET", "/vault")).json.items;
  const item = items.find((i: any) => i.name === "Acme API");
  assert.deepEqual([item.kind, item.hosts, item.hasPassword], ["secret", ["127.0.0.1"], true]);
  await idle(bot);

  // First use asks; allowed, the key goes in the header and the echoed key is hidden everywhere.
  apiSeen.length = 0;
  await say(bot, `call secret_use {"secret": "Acme API", "url": "${base}/api/orders"}`);
  const ask = await pendingApproval(bot);
  assert.equal(ask.tool, "secret: Acme API");
  await call("POST", `/approvals/${ask.approvalId}`, { decision: "always" });
  await replied(bot, "Status 200");
  assert.equal(apiSeen[0].headers.authorization, "Bearer sk-live-SECRET-12345");
  const everything = JSON.stringify(await rowsOf(bot.id)) + historyText(bot.id) + JSON.stringify((await call("GET", "/vault")).json) + JSON.stringify((await call("GET", "/audit")).json);
  assert.doesNotMatch(everything, /sk-live-SECRET-12345/, "the value is nowhere a model or a browser can read it");
  assert.match(historyText(bot.id), /\[hidden\]/);

  // Another host: refused, nothing sent.
  apiSeen.length = 0;
  await say(bot, `call secret_use {"secret": "Acme API", "url": "${base.replace("127.0.0.1", "localhost")}/api/orders"}`);
  await replied(bot, "may only be sent to 127.0.0.1");
  assert.equal(apiSeen.length, 0);

  // After outside content, "Always" no longer counts: it asks again.
  await say(bot, `chain web_fetch {"url": "${base}/push/x"} >> secret_use {"secret": "Acme API", "url": "${base}/api/orders"}`);
  const again = await pendingApproval(bot);
  assert.match(again.title, /a lu du contenu extérieur/);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "deny" });
  await idle(bot);
});

test("totp: RFC 6238 test vectors, otpauth URIs, and totp_code only on the bound site", { skip: noScreen }, async () => {
  // RFC 6238 Appendix B, SHA-1, seed "12345678901234567890", 8 digits.
  const key = Buffer.from("12345678901234567890");
  assert.equal(hotp(key, Math.floor(59 / 30), 8), "94287082");
  assert.equal(hotp(key, Math.floor(1111111109 / 30), 8), "07081804");
  assert.equal(hotp(key, Math.floor(20000000000 / 30), 8), "65353130");
  assert.deepEqual(base32Decode("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ"), key);
  const seed = parseTotp("otpauth://totp/Acme:nina@example.com?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ&issuer=Acme&digits=8&period=30");
  assert.deepEqual([seed.digits, seed.period, seed.issuer, seed.account], [8, 30, "Acme", "nina@example.com"]);
  assert.equal(totpNow(seed, 59_000).code, "94287082");
  assert.throws(() => parseTotp("not base32 !"));

  const created = await call("POST", "/vault", { kind: "totp", name: "Acme 2FA", site: "acme.example", password: "otpauth://totp/Acme?secret=GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ" });
  assert.equal(created.status, 200, created.text);
  assert.deepEqual([created.json.item.kind, created.json.item.digits, created.json.item.period], ["totp", 6, 30]);
  assert.equal((await call("POST", "/vault", { kind: "totp", name: "No site", password: "GEZDGNBV" })).status, 400);

  screen.read = async () => ({ title: "Login", url: "https://login.acme.example/2fa", text: "" });
  await say(bot, 'call totp_code {"item": "Acme 2FA"}');
  const r = await replied(bot, "Current code for Acme 2FA");
  const code = /: (\d{6}) /.exec((r.body as any).text)![1];
  // The code changes every 30 s: under load the reply and this check can fall on either side of a change.
  const seedNow = parseTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ");
  assert.ok([totpNow(seedNow).code, totpNow(seedNow, Date.now() - 30_000).code].includes(code), code);

  screen.read = async () => ({ title: "Evil", url: "https://evil.example/", text: "" });
  await say(bot, 'call totp_code {"item": "Acme 2FA"}');
  await replied(bot, "No code was given");

  // Tainted turn: asks first.
  screen.read = async () => ({ title: "Login", url: "https://acme.example/", text: "" });
  await say(bot, `chain web_fetch {"url": "${base}/push/y"} >> totp_code {"item": "Acme 2FA"}`);
  const ask = await pendingApproval(bot);
  assert.equal(ask.tool, "totp: Acme 2FA");
  await call("POST", `/approvals/${ask.approvalId}`, { decision: "allow" });
  await replied(bot, "Current code for Acme 2FA");
});

test("vault: password_generate saves a strong password the model never sees", async () => {
  const pw = generatePassword({ length: 24 });
  assert.equal(pw.length, 24);
  assert.match(pw, /[a-z]/); assert.match(pw, /[A-Z]/); assert.match(pw, /\d/); assert.match(pw, /[^A-Za-z0-9]/);
  assert.doesNotMatch(generatePassword({ length: 30, symbols: false }), /[^A-Za-z0-9]/);

  await say(bot, 'call password_generate {"name": "Fournisseur", "site": "portal.example.com", "username": "nina", "length": 22}');
  await replied(bot, 'login "Fournisseur"');
  const item = vault.byName(userId, "Fournisseur")!;
  const value = unseal(item.passwordEnc!)!;
  assert.equal(value.length, 22);
  assert.doesNotMatch(JSON.stringify(await rowsOf(bot.id)) + historyText(bot.id), new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  await say(bot, 'call password_generate {"name": "Fournisseur", "site": "portal.example.com"}');
  await replied(bot, "never replaced");
});

test("vault: CSV import (generic, Bitwarden with TOTP, unknown columns → mapping), duplicates skipped, values never echoed", async () => {
  assert.deepEqual(parseCsv('a,"b, c","d ""q"""\r\n1,2,3\n'), [["a", "b, c", 'd "q"'], ["1", "2", "3"]]);
  assert.ok(detectMapping(["folder", "favorite", "type", "name", "notes", "fields", "reprompt", "login_uri", "login_username", "login_password", "login_totp"]));
  assert.equal(detectMapping(["foo", "bar"]), null);

  const generic = await call("POST", "/vault/import", { csv: "name,url,username,password\nBanque,https://banque.example,nina,pw-banque-1\nSans mdp,https://x.example,nina,\n" });
  assert.deepEqual(generic.json, { imported: 1, skipped: 1, totp: 0 });
  const bw = await call("POST", "/vault/import", { csv: "folder,favorite,type,name,notes,fields,reprompt,login_uri,login_username,login_password,login_totp\n,,login,Shop,,,0,https://shop.example,nina,pw-shop-2,GEZDGNBVGY3TQOJQ\n,,login,Banque,,,0,https://banque.example,nina,pw-other,\n" });
  assert.deepEqual(bw.json, { imported: 1, skipped: 1, totp: 1 });
  assert.equal(vault.byName(userId, "Shop (2FA)")!.kind, "totp");

  const odd = "Libellé;x,Adresse,Identifiant,Secret\nCRM,https://crm.example,nina,pw-crm-3\n";
  const first = await call("POST", "/vault/import", { csv: odd });
  assert.equal(first.json.needsMapping, true);
  assert.deepEqual(first.json.headers, ["Libellé;x", "Adresse", "Identifiant", "Secret"]);
  assert.doesNotMatch(first.text, /pw-crm-3/);
  const mapped = await call("POST", "/vault/import", { csv: odd, mapping: { name: 0, url: 1, username: 2, password: 3 } });
  assert.equal(mapped.json.imported, 1);
  assert.doesNotMatch(JSON.stringify((await call("GET", "/vault")).json), /pw-/);
});

// ── Organising bots ──────────────────────────────────────────────────────────
test("organise: sections, pin, hide, move, mark unread", async () => {
  const other = (await call("POST", "/bots", { name: "Max" })).json.bot as Bot;
  assert.deepEqual([other.pinned, other.sectionId, other.listHidden], [false, null, false]);
  assert.equal((await call("POST", "/sections", { name: " " })).status, 400);
  const sales = (await call("POST", "/sections", { name: "Ventes" })).json.section;
  const ops = (await call("POST", "/sections", { name: "Ops" })).json.section;
  assert.deepEqual((await call("GET", "/sections")).json.sections.map((s: any) => s.name), ["Ventes", "Ops"]);
  await call("PATCH", `/sections/${ops.id}`, { name: "Opérations", position: 0 });
  await call("PATCH", `/sections/${sales.id}`, { position: 1 });
  assert.deepEqual((await call("GET", "/sections")).json.sections.map((s: any) => s.name), ["Opérations", "Ventes"]);

  let b = (await call("PATCH", `/bots/${other.id}`, { pinned: true, sectionId: sales.id })).json.bot;
  assert.deepEqual([b.pinned, b.sectionId], [true, sales.id]);
  const note = "Présenter la prochaine campagne dans un tableau chronologique.";
  assert.equal((await call("PATCH", `/sections/${sales.id}`, { instructions: note })).json.section.instructions, note);
  assert.equal((await call("PATCH", `/sections/${sales.id}`, { instructions: "x".repeat(4001) })).status, 400);
  const promptFor = (id: string) => buildSystemPrompt(bots.byId(id)!, users.byId(userId)!, { browser: false, shell: false, connectorNames: [] });
  assert.ok(promptFor(other.id).includes(note));
  b = (await call("PATCH", `/bots/${other.id}`, { sectionId: "sec_not_mine" })).json.bot;
  assert.equal(b.sectionId, null, "only the user's own sections");
  assert.ok(!promptFor(other.id).includes(note), "leaving the project removes its instructions");
  await call("PATCH", `/bots/${other.id}`, { sectionId: sales.id, listHidden: true });
  b = (await call("GET", "/bots")).json.bots.find((x: Bot) => x.id === other.id);
  assert.equal(b.listHidden, true, "a hidden bot is still listed (under Hidden) and still works");
  await call("DELETE", `/sections/${sales.id}`);
  b = (await call("GET", "/bots")).json.bots.find((x: Bot) => x.id === other.id);
  assert.equal(b.sectionId, null, "its bots go back to the default list");

  const unread = await call("POST", `/bots/${other.id}/unread`);
  assert.equal(unread.json.bot.unread, 1);
  await call("POST", `/bots/${other.id}/read`);
  assert.equal((await call("GET", "/bots")).json.bots.find((x: Bot) => x.id === other.id).unread, 0);
});

test("organise: duplicate copies settings, look, instructions and skills; memories and conversation only when asked", async () => {
  await call("PATCH", `/bots/${bot.id}`, { instructions: "Toujours vouvoyer les clients.", character: { eyes: "visor", accessory: "halo" }, disabledTools: ["video"] });
  await call("POST", `/bots/${bot.id}/skills`, { name: "Relance", description: "Relancer un client", body: "1. Ouvrir le CRM" });
  await call("POST", `/bots/${bot.id}/memories`, { text: "Nina préfère le matin." });
  const plain = (await call("POST", `/bots/${bot.id}/duplicate`, {})).json.bot as Bot;
  assert.equal(plain.name, `${bot.name} (copy)`);
  assert.equal(plain.primary, false);
  assert.equal(plain.instructions, "Toujours vouvoyer les clients.");
  assert.deepEqual([plain.character.eyes, plain.character.accessory, plain.disabledTools], ["visor", "halo", ["video"]]);
  const bundle = (await call("GET", `/bots/${plain.id}/bundle`)).json;
  assert.deepEqual(bundle.skills.map((s: any) => s.name), ["Relance"]);
  assert.equal(bundle.memories.length, 0);
  assert.equal((await rowsOf(plain.id)).length, 0);

  const full = (await call("POST", `/bots/${bot.id}/duplicate`, { name: `${bot.name} bis`, memories: true, conversation: true })).json.bot as Bot;
  assert.equal(full.name, `${bot.name} bis`);
  assert.deepEqual((await call("GET", `/bots/${full.id}/bundle`)).json.memories.map((m: any) => m.text), ["Nina préfère le matin."]);
  const copied = await rowsOf(full.id);
  assert.ok(copied.some((r) => r.body.kind === "message" && r.body.text === "Bonjour"));
  // The copy goes on talking from where the conversation stood.
  await say(full, "Suite");
  await replied(full, "Echo: Suite");
  assert.equal(policies.get(userId, "secret: Acme API"), "always_allow");
});
