import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * Sklubot Relais, server side (docs/RELAIS-PROTOCOLE.md), driven through the real protocol: a small relay written
 * here (the inverse of companion/test/fake-server.js) connects to a real HTTP server running the real API and the
 * real upgrade handler, and plays the user's computer. A scripted model plays the bot.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-relay-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { relayUpgrade, closeAllRelays } = await import("../src/relay.js");
const { attachLiveScreens } = await import("../src/vnc.js");
const { q } = await import("../src/db.js");
const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, RelayDevice, Row } from "../src/shared.js";

// ── Scripted model: "call T {json}" → one tool; "chain A {…} >> B {…}" → tools in turn; else echoes ──
const requests: TurnRequest[] = [];
const queue: { name: string; input: any }[] = [];
registerProvider({
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
} satisfies LlmProvider);

// ── The real server: the API and the single upgrade listener of index.ts ──
const app = new Hono();
app.route("/api", api);
const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as import("node:http").Server;
await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
attachLiveScreens(server, [relayUpgrade]);
const port = (server.address() as AddressInfo).port;
const HTTP = `http://127.0.0.1:${port}`;
const WS = `ws://127.0.0.1:${port}/api/relay/connect`;
after(() => { closeAllRelays(); server.closeAllConnections?.(); server.close(); });

let cookie = "";
async function call(method: string, url: string, body?: unknown, extra: Record<string, string> = {}) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, ...extra }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${label}`);
}
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const pendingApproval = (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval card");
const decide = (id: string, decision: "allow" | "always" | "deny") => call("POST", `/approvals/${id}`, { decision });
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running && !r.json.live?.[bot.id]?.awaiting; }, "bot idle");
const lastReply = async (bot: Bot) => [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming)?.body as { text: string } | undefined;
const replied = (bot: Bot, part: string | RegExp) => until(async () => { const r = await lastReply(bot); return r && (typeof part === "string" ? r.text.includes(part) : part.test(r.text)) && r; }, `reply ${part}`);
const relayLines = async (bot: Bot) => (await rowsOf(bot.id)).filter((r) => r.body.kind === "event" && r.body.event === "relay").map((r) => (r.body as { text: string }).text);
const devicesNow = async (): Promise<RelayDevice[]> => (await call("GET", "/relay/devices")).json.devices;

const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

type Answer = { result?: any; error?: { code: string; message?: string; retryAfterMs?: number } } | undefined | Promise<Answer>;

/** A relay as the protocol describes it: hello, pairing, tokens, requests, events and frames. */
class TestRelay {
  ws!: WebSocket;
  msgs: any[] = [];
  reqs: any[] = [];
  closed: { code: number; reason: string } | null = null;
  code = "";
  deviceId = "";
  token = "";
  pendingToken = "";
  ackRotation = true;
  session: { botId: string; botName: string } | null = null;
  handlers: Record<string, (args: any, msg: any) => Answer> = {
    "session.start": (_a, m) => {
      this.session = { botId: m.bot.id, botName: m.bot.name };
      setTimeout(() => this.event("session.started", { bot: m.bot, grant: "once", sessionId: "s1" }), 5);
      return { result: { sessionId: "s1", grant: "once" } };
    },
    "session.end": (_a, m) => {
      if (this.session) setTimeout(() => this.event("session.ended", { bot: m.bot, reason: "bot", sessionId: "s1" }), 5);
      this.session = null;
      return { result: {} };
    },
    "screen.capture": () => ({ result: { format: "jpeg", width: 640, height: 400, screenWidth: 1280, screenHeight: 800, data: JPEG } }),
    "view.start": () => ({ result: { viewId: "v1", maxFps: 3 } }),
    "view.stop": (a) => { setTimeout(() => this.event("view.stopped", { viewId: a.viewId ?? "v1", reason: "requested" }), 5); return { result: {} }; },
    "shell.run": (a) => ({ result: { exitCode: 0, signal: null, stdout: `ran: ${a.command}\n`, stderr: "", truncated: false, timedOut: false, cancelled: false, durationMs: 12 } }),
  };

  async open(auth: { deviceId: string; token: string } | null, headers: Record<string, string> = {}, hello: Record<string, unknown> = {}) {
    if (auth) { this.deviceId = auth.deviceId; this.token = auth.token; }
    this.ws = new WebSocket(WS, { headers });
    this.ws.on("message", (d, isBinary) => { if (!isBinary) this.onMessage(JSON.parse(String(d))); });
    this.ws.on("close", (code, reason) => { this.closed = { code, reason: String(reason) }; });
    this.ws.on("error", () => {});
    await new Promise<void>((resolve, reject) => { this.ws.once("open", () => resolve()); this.ws.once("unexpected-response", (_r, res) => reject(new Error(`HTTP ${res.statusCode}`))); this.ws.once("error", reject); });
    this.send({
      type: "hello", v: 1, auth, app: { name: "sklubot-relais", version: "0.1.0" },
      device: { name: "portable-lea", platform: "linux", arch: "x64", osRelease: "6.1", locale: "fr-FR" },
      capabilities: ["session.start", "session.end", "screen.info", "screen.capture", "view.start", "view.stop", "mouse.move", "mouse.click", "mouse.drag", "mouse.scroll", "keyboard.type", "keyboard.press", "app.open", "url.open", "window.list", "window.focus", "shell.run"],
      screen: { width: 1280, height: 800, scaleFactor: 1 }, limits: { maxInboundBytes: 262144, maxViewFps: 5 }, state: { locked: false }, ...hello,
    });
    return this;
  }
  send(m: unknown) { this.ws.send(typeof m === "string" ? m : JSON.stringify(m)); }
  event(name: string, data: Record<string, unknown> = {}) { this.send({ type: "event", name, ts: new Date().toISOString(), ...data }); }
  private async onMessage(m: any) {
    this.msgs.push(m);
    if (m.type === "pair.code") this.code = m.code;
    if (m.type === "paired") { this.deviceId = m.deviceId; this.token = m.token; this.send({ type: "token.ack", deviceId: m.deviceId }); }
    if (m.type === "token.rotate") { if (this.ackRotation) { this.token = m.token; this.send({ type: "token.ack", deviceId: this.deviceId }); } else this.pendingToken = m.token; }
    if (m.type === "welcome") this.event("relay.state", { locked: false, session: null });
    if (m.type === "req") {
      this.reqs.push(m);
      const h = this.handlers[m.op];
      const a = await (h ? h(m.args, m) : { result: {} });
      if (a) this.send({ type: "res", id: m.id, ok: !a.error, ...(a.error ? { error: a.error } : { result: a.result ?? {} }) });
    }
  }
  waitFor(pred: (m: any) => boolean, label: string, ms = 10_000) { return until(() => this.msgs.find(pred), label, ms); }
  waitReq(op: string, from = 0) { return until(() => this.reqs.slice(from).find((r) => r.op === op), `request ${op}`); }
  waitClosed(ms = 10_000) { return until(() => this.closed, "socket closed", ms); }
  close() { try { this.ws.terminate(); } catch { /* gone */ } }
}

let bot: Bot;
let userId = "";
let relay: TestRelay;

test("setup: account and bot", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  assert.ok(bot);
});

test("before any computer is linked, the bot has no 'my computer' tools", async () => {
  requests.length = 0;
  await say(bot, "hello");
  await replied(bot, "Echo: hello");
  assert.ok(!requests.at(-1)!.tools.some((t) => t.name.startsWith("my_")), "no relay tools without a device");
});

test("a web page cannot open a device connection (Origin present → 403)", async () => {
  await assert.rejects(new TestRelay().open(null, { origin: "https://evil.example" }), /HTTP 403/);
});

test("pairing: the relay gets a code, the user types it in the web app, the relay is paired and welcomed", async () => {
  relay = await new TestRelay().open(null);
  const pc = await relay.waitFor((m) => m.type === "pair.code", "pair.code");
  assert.match(pc.code, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{4}$/, "8 characters without look-alikes, shown XXXX-XXXX");
  const ttl = Date.parse(pc.expiresAt) - Date.now();
  assert.ok(ttl > 9 * 60_000 && ttl <= 10 * 60_000, "valid 10 minutes");

  assert.equal((await call("POST", "/relay/pairings", { code: "AAAA-AAAA" })).status, 400, "a wrong code is refused");
  // Typed by hand: lower case, no dash, spaces.
  const typed = ` ${pc.code.replace("-", "").toLowerCase().slice(0, 4)} ${pc.code.replace("-", "").toLowerCase().slice(4)} `;
  const ok = await call("POST", "/relay/pairings", { code: typed });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.device.name, "portable-lea");
  assert.equal(ok.json.device.platform, "linux");
  const paired = await relay.waitFor((m) => m.type === "paired", "paired");
  assert.match(paired.deviceId, /^[A-Za-z0-9_.:-]{1,64}$/);
  assert.match(paired.token, /^[A-Za-z0-9._~-]{16,512}$/);
  assert.equal(paired.serverName, "Sklubot de Léa");
  const welcome = await relay.waitFor((m) => m.type === "welcome", "welcome");
  assert.deepEqual([welcome.v, welcome.deviceId], [1, paired.deviceId]);
  assert.ok(!relay.msgs.some((m) => m.type === "token.rotate"), "a fresh token is not rotated straight away");
  assert.equal((await call("POST", "/relay/pairings", { code: pc.code })).status, 400, "single use");

  const [d] = await devicesNow();
  assert.equal(d.status, "online");
  // The token is stored only as a hash, and no API returns it.
  const stored = q.get<{ token_hash: string }>("SELECT token_hash FROM relay_devices WHERE id = ?", d.id)!;
  assert.notEqual(stored.token_hash, relay.token);
  assert.doesNotMatch(JSON.stringify(await call("GET", "/relay/devices")), new RegExp(relay.token));
  const audit = (await call("GET", "/audit")).json.entries.map((e: any) => `${e.kind} ${e.text}`).join("\n");
  assert.match(audit, /computer Ordinateur relié: portable-lea \(Linux\)/);
});

test("token rotation on each connection: the old token is refused once the new one is acknowledged", async () => {
  const before = relay.token;
  relay.close();
  await until(async () => (await devicesNow())[0].status === "offline", "offline after close");
  relay = await new TestRelay().open({ deviceId: relayDeviceId(), token: before });
  await relay.waitFor((m) => m.type === "welcome", "welcome");
  const rot = await relay.waitFor((m) => m.type === "token.rotate", "token.rotate");
  assert.notEqual(rot.token, before);
  await until(() => !q.get<{ pending_hash: string | null }>("SELECT pending_hash FROM relay_devices WHERE id = ?", relayDeviceId())!.pending_hash, "rotation committed");

  const stale = await new TestRelay().open({ deviceId: relayDeviceId(), token: before });
  assert.equal((await stale.waitClosed()).code, 4001, "old token refused");
  assert.equal(relay.closed, null, "a refused attempt does not disturb the live connection");
});

test("a rotation the relay never acknowledged: both tokens still open the device, the new one becomes the token", async () => {
  const current = relay.token;
  relay.close();
  await until(async () => (await devicesNow())[0].status === "offline", "offline");
  const forgetful = new TestRelay();
  forgetful.ackRotation = false;
  relay = await forgetful.open({ deviceId: relayDeviceId(), token: current });
  await relay.waitFor((m) => m.type === "token.rotate", "token.rotate");
  const next = relay.pendingToken;
  relay.close();
  await until(async () => (await devicesNow())[0].status === "offline", "offline");
  // The relay saved the new token but its ack was lost: it comes back with the new one.
  relay = await new TestRelay().open({ deviceId: relayDeviceId(), token: next });
  await relay.waitFor((m) => m.type === "welcome", "welcome with the unacknowledged token");
  await relay.waitFor((m) => m.type === "token.rotate", "rotated again");
  await until(() => !q.get<{ pending_hash: string | null }>("SELECT pending_hash FROM relay_devices WHERE id = ?", relayDeviceId())!.pending_hash, "committed");
  const old = await new TestRelay().open({ deviceId: relayDeviceId(), token: current });
  assert.equal((await old.waitClosed()).code, 4001, "the token before is gone for good");
});

test("one connection per device: a newer one closes the older with 4010", async () => {
  const first = relay;
  const second = await new TestRelay().open({ deviceId: relayDeviceId(), token: first.token });
  second.deviceId = relayDeviceId();
  await second.waitFor((m) => m.type === "welcome", "welcome");
  assert.equal((await first.waitClosed()).code, 4010);
  relay = second;
  await relay.waitFor((m) => m.type === "token.rotate", "rotation");
  await until(() => !q.get<{ pending_hash: string | null }>("SELECT pending_hash FROM relay_devices WHERE id = ?", relayDeviceId())!.pending_hash, "committed");
  assert.equal((await devicesNow())[0].status, "online");
});

let deviceIdCache = "";
function relayDeviceId(): string {
  deviceIdCache ||= q.get<{ id: string }>("SELECT id FROM relay_devices WHERE user_id = ?", userId)!.id;
  return deviceIdCache;
}

test("a bot looks at the user's computer: approval card first, then the relay's session, then the picture reaches the model", async () => {
  requests.length = 0;
  await say(bot, 'call my_screen {"reason":"Check the invoice"}');
  const card = await pendingApproval(bot);
  assert.equal(card.tool, `mycomputer: control: ${bot.name}`);
  assert.match(card.title, /prendre le contrôle de portable-lea/);
  assert.ok(!card.once, "taking control can be allowed always");
  assert.equal(relay.reqs.length, 0, "nothing reaches the computer before the user allows it");
  await decide(card.approvalId, "allow");
  const start = await relay.waitReq("session.start");
  assert.deepEqual(start.bot, { id: bot.id, name: bot.name }, "the real bot id and name are sent");
  assert.equal(start.args.reason, "Check the invoice");
  const cap = await relay.waitReq("screen.capture");
  assert.equal(cap.args.format, "jpeg");
  await replied(bot, "Tool said:");
  const result = requests.flatMap((r) => r.messages).flatMap((m) => m.content).find((b) => b.type === "tool_result" && b.content.some((c) => c.type === "image"));
  assert.ok(result && result.type === "tool_result", "the screenshot reached the model as an image");
  const img = result.content.find((c) => c.type === "image")!;
  assert.equal(img.type === "image" && img.data, JPEG);
  assert.match(JSON.stringify(result.content), /What follows came from outside/, "marked as outside content");
  await until(async () => (await relayLines(bot)).some((l) => /a pris le contrôle de portable-lea/.test(l)), "chat line: took control");
  const [d] = await devicesNow();
  assert.equal(d.session?.botId, bot.id);
  await idle(bot);
});

test("a click inside the session: no new card, coordinates scaled from the screenshot to the screen", async () => {
  const from = relay.reqs.length;
  await say(bot, 'call my_click {"x":100,"y":50}');
  const click = await relay.waitReq("mouse.click", from);
  assert.deepEqual([click.args.x, click.args.y, click.args.button], [200, 100, "left"], "640×400 picture of a 1280×800 screen");
  await relay.waitReq("screen.capture", from);
  await replied(bot, "Clicked at (100, 50)");
  assert.ok(!(await rowsOf(bot.id)).some((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending"));
  await idle(bot);
});

test("a command: the app's approval card, then the computer's own answer; 'Always' works until outside content", async () => {
  let from = relay.reqs.length;
  await say(bot, 'call my_command {"command":"ls ~/Documents"}');
  const card = await pendingApproval(bot);
  assert.equal(card.tool, `mycomputer: command: ${bot.name}`);
  assert.match(card.detail, /ls ~\/Documents/);
  assert.equal(relay.reqs.slice(from).filter((r) => r.op === "shell.run").length, 0);
  await decide(card.approvalId, "always");
  const run = await relay.waitReq("shell.run", from);
  assert.equal(run.args.command, "ls ~/Documents");
  await replied(bot, "ran: ls ~/Documents");
  await idle(bot);
  const audit = (await call("GET", "/audit")).json.entries.map((e: any) => e.text).join("\n");
  assert.match(audit, /commande ls ~\/Documents/);

  // Allowed always, in a fresh turn: no card.
  from = relay.reqs.length;
  await say(bot, 'call my_command {"command":"pwd"}');
  await relay.waitReq("shell.run", from);
  await replied(bot, "ran: pwd");
  await idle(bot);

  // After outside content (its own screenshot), every command asks again, and "Always" is not offered.
  from = relay.reqs.length;
  await say(bot, 'chain my_screen {} >> my_command {"command":"whoami"}');
  const strict = await pendingApproval(bot);
  assert.equal(strict.once, true);
  assert.match(strict.title, /a lu du contenu extérieur/);
  await decide(strict.approvalId, "always"); // counts as once
  await relay.waitReq("shell.run", from);
  await replied(bot, "ran: whoami");
  await idle(bot);
  const policy = (await call("GET", "/policies")).json.policies.find((p: any) => p.tool === `mycomputer: command: ${bot.name}`);
  assert.equal(policy.mode, "always_allow", "the earlier 'Always' stays as it was, nothing more");
});

test("a refusal on the computer is surfaced to the bot and the user, and never retried automatically", async () => {
  // End the current session first, from the relay side (as if idle).
  relay.event("session.ended", { bot: { id: bot.id, name: bot.name }, reason: "idle", sessionId: "s1" });
  relay.session = null;
  await until(async () => !(await devicesNow())[0].session, "session gone");
  relay.handlers["session.start"] = () => ({ error: { code: "consent_refused", message: "the user refused the control session" } });
  const from = relay.reqs.length;
  await say(bot, "call my_screen {}");
  const card = await pendingApproval(bot);
  await decide(card.approvalId, "allow");
  await replied(bot, /refused, on their computer/);
  await idle(bot);
  assert.equal(relay.reqs.slice(from).filter((r) => r.op === "session.start").length, 1, "asked once, not retried");
  assert.ok((await relayLines(bot)).some((l) => /refusé sur l'ordinateur/.test(l)), "the user sees it in the chat");
  const steps = (await rowsOf(bot.id)).filter((r) => r.body.kind === "step" && r.body.tool === "my_screen");
  assert.match(JSON.stringify(steps.at(-1)!.body), /refusé sur l'ordinateur/);

  // A cooldown answer carries its wait to the bot.
  relay.handlers["session.start"] = () => ({ error: { code: "consent_cooldown", message: "x", retryAfterMs: 41_250 } });
  await say(bot, "call my_screen {}");
  await decide((await pendingApproval(bot)).approvalId, "allow");
  await replied(bot, /before 42 s/);
  await idle(bot);
  relay.handlers["session.start"] = (_a, m) => {
    relay.session = { botId: m.bot.id, botName: m.bot.name };
    setTimeout(() => relay.event("session.started", { bot: m.bot, grant: "once", sessionId: "s2" }), 5);
    return { result: { sessionId: "s2", grant: "once" } };
  };
});

test("the live view: started when someone watches during a session, frames relayed with flow control, stopped when nobody watches", async () => {
  // A session again (allowed always from now on for this bot).
  await say(bot, "call my_screen {}");
  await decide((await pendingApproval(bot)).approvalId, "always");
  await replied(bot, "Tool said:");
  await idle(bot);
  const id = relayDeviceId();
  const from = relay.reqs.length;
  // Only pages of this site with the user's session may watch.
  await assert.rejects(new Promise((res, rej) => { const w = new WebSocket(`${HTTP.replace("http", "ws")}/api/relay/devices/${id}/view`); w.on("open", res); w.on("unexpected-response", (_q, r) => rej(new Error(`HTTP ${r.statusCode}`))); w.on("error", rej); }), /HTTP 401/);
  const viewer = new WebSocket(`${HTTP.replace("http", "ws")}/api/relay/devices/${id}/view`, { headers: { cookie, origin: HTTP } });
  const seen: any[] = [];
  viewer.on("message", (d) => seen.push(JSON.parse(String(d))));
  await new Promise((r) => viewer.once("open", r));
  const start = await relay.waitReq("view.start", from);
  assert.equal(start.bot.id, bot.id, "the view runs under the session's bot");
  assert.ok(start.args.maxFps >= 1 && start.args.maxFps <= 5 && start.args.maxWidth <= 1600);
  await until(() => seen.some((m) => m.type === "status" && m.view === "live"), "viewer told the view is live");
  relay.send({ type: "frame", viewId: "v1", seq: 1, format: "jpeg", width: 1280, height: 800, data: JPEG });
  relay.send({ type: "frame", viewId: "v1", seq: 2, format: "jpeg", width: 1280, height: 800, data: JPEG });
  await until(() => seen.filter((m) => m.type === "frame" && m.seq > 0).length === 2, "two frames forwarded");
  await sleep(100);
  assert.ok(!relay.msgs.some((m) => m.type === "view.ack"), "not acknowledged before the browser has shown them");
  viewer.send(JSON.stringify({ type: "ack", seq: 2 }));
  await relay.waitFor((m) => m.type === "view.ack" && m.seq === 2 && m.viewId === "v1", "ack 2");
  assert.ok(relay.msgs.some((m) => m.type === "view.ack" && m.seq === 1), "ack 1 too");
  // The last picture is available for the panel.
  const last = await api.request(`/relay/devices/${id}/last`, { headers: { cookie } });
  assert.equal(last.status, 200);
  assert.equal(last.headers.get("content-type"), "image/jpeg");
  viewer.close();
  await relay.waitReq("view.stop", from);
});

test("Stop in the web app ends the session on the computer and holds the bot back; Stop on the computer locks it", async () => {
  const id = relayDeviceId();
  let from = relay.reqs.length;
  assert.equal((await call("POST", `/relay/devices/${id}/stop`)).status, 200);
  const end = await relay.waitReq("session.end", from);
  assert.equal(end.bot.id, bot.id);
  await until(async () => (await relayLines(bot)).some((l) => /Tu as arrêté le contrôle de portable-lea/.test(l)), "chat line: you stopped it");
  await until(async () => !(await devicesNow())[0].session, "no session");
  // The bot may not take it back on its own, even though control is allowed always.
  from = relay.reqs.length;
  // A routine-like turn (not a message from the user) tries to look again.
  const { enqueue } = await import("../src/agent/loop.js");
  enqueue(bot.id, { kind: "system", text: "call my_screen {}" });
  await replied(bot, /stopped your control of this computer from Sklubot/);
  await idle(bot);
  assert.equal(relay.reqs.slice(from).filter((r) => r.op === "session.start").length, 0);
  // Writing to the bot lifts the hold.
  await say(bot, "hello again");
  await replied(bot, "Echo: hello again");
  await idle(bot);

  // Stop pressed on the computer: the relay says locked; the bot is refused without bothering the computer.
  relay.event("relay.locked", { source: "hotkey" });
  await until(async () => (await devicesNow())[0].locked, "locked");
  await until(async () => (await relayLines(bot)).some((l) => /Stop a été pressé sur portable-lea/.test(l)), "chat line: locked");
  from = relay.reqs.length;
  await say(bot, "call my_screen {}");
  await replied(bot, /pressed Stop on their computer/);
  await idle(bot);
  assert.equal(relay.reqs.length, from, "nothing sent while locked");
  relay.event("relay.unlocked");
  await until(async () => !(await devicesNow())[0].locked, "unlocked");
});

test("a session that ended under the bot: reopened only when the app allows it without asking", async () => {
  // Fresh session (control allowed always: no card).
  await say(bot, "call my_screen {}");
  await replied(bot, "Tool said:");
  await idle(bot);
  // The relay forgets the session without telling (e.g. its event was lost): the next click answers no_session.
  let refusedOnce = false;
  relay.handlers["mouse.click"] = () => { if (!refusedOnce) { refusedOnce = true; return { error: { code: "no_session", message: "start a control session first" } }; } return { result: {} }; };
  const from = relay.reqs.length;
  await say(bot, 'call my_click {"x":10,"y":10}');
  await replied(bot, "Clicked at (10, 10)");
  await idle(bot);
  const ops = relay.reqs.slice(from).map((r) => r.op);
  assert.deepEqual(ops.slice(0, 3), ["mouse.click", "session.start", "mouse.click"], "no_session → session.start with a reason → the click once more");
  delete relay.handlers["mouse.click"];
});

test("the 'mycomputer' tool group can be switched off per bot", async () => {
  const off = await call("PATCH", `/bots/${bot.id}`, { disabledTools: ["mycomputer"] });
  assert.equal(off.status, 200, off.text);
  requests.length = 0;
  await say(bot, "anything");
  await replied(bot, "Echo: anything");
  assert.ok(!requests.at(-1)!.tools.some((t) => t.name.startsWith("my_")));
  await call("PATCH", `/bots/${bot.id}`, { disabledTools: [] });
  requests.length = 0;
  await say(bot, "again");
  await replied(bot, "Echo: again");
  assert.ok(requests.at(-1)!.tools.some((t) => t.name === "my_screen"));
});

test("malformed input and floods close the offending connection, never the server", async () => {
  const raw = async (send: (ws: WebSocket) => void) => {
    const ws = new WebSocket(WS);
    ws.on("error", () => {});
    await new Promise((r) => ws.once("open", r));
    const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
    send(ws);
    return closed;
  };
  assert.equal(await raw((ws) => ws.send(Buffer.from([1, 2, 3]))), 4400, "binary");
  assert.equal(await raw((ws) => ws.send("{not json")), 4400, "bad JSON");
  assert.equal(await raw((ws) => ws.send(JSON.stringify({ no: "type" }))), 4400, "no type");
  assert.equal(await raw((ws) => ws.send(JSON.stringify([1, 2]))), 4400, "not an object");
  assert.equal(await raw((ws) => ws.send(JSON.stringify({ type: "res", id: "x", ok: true }))), 4400, "anything before hello");
  assert.equal(await raw((ws) => ws.send(JSON.stringify({ type: "hello", v: 2, auth: null }))), 4009, "unsupported version");
  assert.equal(await raw((ws) => ws.send(JSON.stringify({ type: "hello", v: 1, auth: { deviceId: 5, token: [] } }))), 4001, "garbage auth");
  assert.equal(await raw((ws) => ws.send(JSON.stringify({ type: "hello", v: 1, auth: { deviceId: "dev_nope", token: "x".repeat(43) } }))), 4001, "unknown device");
  assert.equal(await raw((ws) => ws.send("x".repeat(6 * 1024 * 1024))), 1009, "over maxPayload");
  // A paired relay that floods.
  const flood = await new TestRelay().open({ deviceId: relayDeviceId(), token: relay.token });
  flood.deviceId = relayDeviceId();
  await flood.waitFor((m) => m.type === "welcome", "welcome");
  assert.equal((await relay.waitClosed()).code, 4010);
  relay = flood;
  await relay.waitFor((m) => m.type === "token.rotate", "rotation");
  await until(() => !q.get<{ pending_hash: string | null }>("SELECT pending_hash FROM relay_devices WHERE id = ?", relayDeviceId())!.pending_hash, "committed");
  // Odd but well-formed messages are ignored: unknown types, answers to nothing, bad frames and events.
  for (const m of [{ type: "whatever" }, { type: "res", id: "r999999", ok: true }, { type: "res" }, { type: "frame", viewId: 1 }, { type: "frame", viewId: "v9", seq: 1, width: 1, height: 1, data: "<script>" }, { type: "event", name: "session.started", bot: { id: "bad id!" } }, { type: "event" }, { type: "token.ack", deviceId: "other" }]) relay.send(m);
  await sleep(200);
  assert.equal(relay.closed, null, "well-formed oddities do not close the connection");
  const victim = relay;
  for (let i = 0; i < 260; i++) victim.send({ type: "whatever", i });
  assert.equal((await victim.waitClosed()).code, 4008, "more than 200 messages in a second");
  // The server is fine and serves others.
  const health = await fetch(`${HTTP}/api/health`);
  assert.equal(health.status, 200);
  relay = await new TestRelay().open({ deviceId: relayDeviceId(), token: victim.token });
  relay.deviceId = relayDeviceId();
  await relay.waitFor((m) => m.type === "welcome", "welcome after the flood");
  await relay.waitFor((m) => m.type === "token.rotate", "rotation");
  await until(() => !q.get<{ pending_hash: string | null }>("SELECT pending_hash FROM relay_devices WHERE id = ?", relayDeviceId())!.pending_hash, "committed");
});

test("pairing attempts are limited per account", async () => {
  // A second account, so the first one's devices are untouched.
  const keep = cookie;
  cookie = "";
  await call("POST", "/auth/signup", { email: "mallory@example.com", name: "M", password: "password123" });
  const statuses: number[] = [];
  for (let i = 0; i < 6; i++) statuses.push((await call("POST", "/relay/pairings", { code: `ZZZZ-ZZZ${i + 2}` })).status);
  assert.deepEqual(statuses, [400, 400, 400, 400, 400, 429]);
  cookie = keep;
});

test("revoke: the relay is told, closed with 4003, and its token no longer opens anything", async () => {
  const id = relayDeviceId();
  const token = relay.token;
  assert.equal((await call("DELETE", `/relay/devices/${id}`)).status, 200);
  await relay.waitFor((m) => m.type === "revoke", "revoke message");
  assert.equal((await relay.waitClosed()).code, 4003);
  assert.deepEqual(await devicesNow(), []);
  const again = await new TestRelay().open({ deviceId: id, token });
  assert.equal((await again.waitClosed()).code, 4001);
  assert.equal((await call("DELETE", `/relay/devices/${id}`)).status, 404);
});
