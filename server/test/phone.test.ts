import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * Phones as relay devices (docs/RELAIS-PROTOCOLE.md §13, revision 1.2): a fake phone relay — the server-side view of
 * the Android app in android/app/src/main/java/app/sklubot/android/relay — pairs with kind "phone" against the real
 * server, and the bot's "my computer" tools are mapped to the phone's operations. A scripted model plays the bot.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-phone-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";
// Public servers verify e-mail addresses (publicsignup.ts); this file signs accounts up without an SMTP server.
process.env.EMAIL_VERIFICATION = "0";

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

/** The hello of the Sklubot Android app (RelayHub.hello in the app). */
const PHONE_HELLO = {
  protocol: "1.2",
  app: { name: "sklubot-android", version: "1.1.0" },
  device: { name: "Pixel de Léa", platform: "android", kind: "phone", arch: "arm64-v8a", osRelease: "15 (API 35)", model: "Google Pixel 8", locale: "fr-FR" },
  capabilities: ["session.start", "session.end", "screen.info", "screen.capture", "screen.read", "touch.tap", "touch.swipe", "keyboard.type", "global.action", "app.open", "url.open"],
  screen: { width: 1080, height: 2400, scaleFactor: 2.625 },
  limits: { maxInboundBytes: 262144, maxViewFps: 0 },
  state: { locked: false, accessibility: true },
};

/** A phone: no mouse, no keyboard keys, no shell, no live view. Answers the phone's own operations. */
function phoneRelay(): TestRelay {
  const r = new TestRelay();
  r.handlers["screen.capture"] = () => ({ result: { format: "jpeg", width: 540, height: 1200, screenWidth: 1080, screenHeight: 2400, data: JPEG } });
  r.handlers["screen.read"] = () => ({ result: { app: { package: "com.example.agenda", label: "Agenda" }, truncated: false, nodes: [
    { text: "Nouveau rendez-vous", bounds: [100, 2000, 400, 120], click: true },
    { text: "", desc: "Rechercher", bounds: [900, 100, 120, 120], click: true },
    { text: "Titre", bounds: [40, 600, 1000, 140], edit: true, focused: true },
  ] } });
  for (const op of ["mouse.click", "mouse.drag", "mouse.scroll", "keyboard.press", "window.list", "window.focus", "shell.run", "view.start"]) {
    r.handlers[op] = () => ({ error: { code: "unknown_op", message: op === "shell.run" ? "commands are not available on a phone" : "unknown operation" } });
  }
  r.handlers["keyboard.type"] = (a) => ({ result: { typed: a.text.length, method: "set_text" } });
  r.handlers["app.open"] = (a) => ({ result: { launched: a.name, package: "com.example.agenda" } });
  return r;
}

let bot: Bot;
let userId = "";
let phone: TestRelay;
let phoneId = "";

test("setup: account and bot", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  userId = r.json.user.id;
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  assert.ok(bot);
});

test("pairing a phone: the device is listed with kind 'phone' and platform Android", async () => {
  phone = await phoneRelay().open(null, {}, PHONE_HELLO);
  const pc = await phone.waitFor((m) => m.type === "pair.code", "pair.code");
  const ok = await call("POST", "/relay/pairings", { code: pc.code });
  assert.equal(ok.status, 200, ok.text);
  assert.equal(ok.json.device.kind, "phone");
  assert.equal(ok.json.device.platform, "android");
  await phone.waitFor((m) => m.type === "welcome", "welcome");
  const [d] = await devicesNow();
  phoneId = d.id;
  assert.deepEqual([d.kind, d.status, d.name, d.screen?.width, d.screen?.height], ["phone", "online", "Pixel de Léa", 1080, 2400]);
  assert.ok(!d.capabilities.includes("shell.run"));
  assert.equal(q.get<{ kind: string }>("SELECT kind FROM relay_devices WHERE id = ?", d.id)!.kind, "phone");
  const audit = (await call("GET", "/audit")).json.entries.map((e: any) => e.text).join("\n");
  assert.match(audit, /Téléphone relié: Pixel de Léa \(Android\)/);
});

test("with only a phone linked, no command, file or window-switching tool is offered", async () => {
  requests.length = 0;
  await say(bot, "hello");
  await replied(bot, "Echo: hello");
  const names = requests.at(-1)!.tools.map((t) => t.name);
  for (const n of ["my_screen", "my_click", "my_scroll", "my_type", "my_key", "my_open", "my_windows", "my_drag", "my_release", "my_computers"]) assert.ok(names.includes(n), `${n} offered`);
  for (const n of ["my_command", "my_files", "my_file_read", "my_file_write", "my_file_trash", "my_window_focus"]) assert.ok(!names.includes(n), `${n} not offered`);
});

test("my_screen on the phone: the app's card, then the phone's session, then a 720-wide screenshot", async () => {
  requests.length = 0;
  await say(bot, 'call my_screen {"reason":"Regarder ton agenda"}');
  const card = await pendingApproval(bot);
  assert.equal(card.tool, `mycomputer: control: ${bot.name}`);
  assert.match(card.title, /Pixel de Léa \(Android\)/);
  assert.equal(phone.reqs.length, 0, "nothing reaches the phone before the user allows it");
  await decide(card.approvalId, "allow");
  const start = await phone.waitReq("session.start");
  assert.equal(start.args.reason, "Regarder ton agenda");
  const cap = await phone.waitReq("screen.capture");
  assert.equal(cap.args.maxWidth, 720);
  await replied(bot, "Tool said:");
  const said = JSON.stringify(requests.flatMap((r) => r.messages).flatMap((m) => m.content).filter((b) => b.type === "tool_result"));
  assert.match(said, /Screenshot of the phone Pixel de Léa \(Android\): 540×1200 pixels/);
  await idle(bot);
});

test("my_click → touch.tap, scaled from the screenshot to the screen; long press and double tap", async () => {
  let from = phone.reqs.length;
  await say(bot, 'call my_click {"x":100,"y":200}');
  const tap = await phone.waitReq("touch.tap", from);
  assert.deepEqual([tap.args.x, tap.args.y, tap.args.long, tap.args.double], [200, 400, false, false], "540×1200 picture of a 1080×2400 screen");
  await replied(bot, "Tapped at (100, 200)");
  await idle(bot);
  assert.ok(!phone.reqs.slice(from).some((r) => r.op.startsWith("mouse.")), "no mouse operation is sent to a phone");
  from = phone.reqs.length;
  await say(bot, 'call my_click {"x":10,"y":20,"long_press":true}');
  assert.equal((await phone.waitReq("touch.tap", from)).args.long, true);
  await replied(bot, "Long-pressed");
  await idle(bot);
  from = phone.reqs.length;
  await say(bot, 'call my_click {"x":10,"y":20,"double":true}');
  assert.equal((await phone.waitReq("touch.tap", from)).args.double, true);
  await replied(bot, "Double-tapped");
  await idle(bot);
});

test("my_scroll → a swipe the other way; my_drag → a held swipe", async () => {
  let from = phone.reqs.length;
  await say(bot, 'call my_scroll {"direction":"down"}');
  const sw = await phone.waitReq("touch.swipe", from);
  assert.equal(sw.args.fromX, sw.args.toX, "vertical");
  assert.ok(sw.args.fromY > sw.args.toY, "to see further down, the finger moves up");
  assert.ok(sw.args.fromY - sw.args.toY > 800 && sw.args.fromY - sw.args.toY < 1300, "about half the screen by default");
  assert.ok(!sw.args.hold);
  await replied(bot, "Scrolled down");
  await idle(bot);
  from = phone.reqs.length;
  await say(bot, 'call my_scroll {"direction":"right","amount":2,"x":270,"y":600}');
  const h = await phone.waitReq("touch.swipe", from);
  assert.equal(h.args.fromY, 1200);
  assert.ok(h.args.fromX > h.args.toX, "to see what is to the right, the finger moves left");
  await replied(bot, "Scrolled right");
  await idle(bot);
  from = phone.reqs.length;
  await say(bot, 'call my_drag {"from_x":100,"from_y":100,"to_x":300,"to_y":500}');
  const drag = await phone.waitReq("touch.swipe", from);
  assert.deepEqual([drag.args.fromX, drag.args.fromY, drag.args.toX, drag.args.toY, drag.args.hold], [200, 200, 600, 1000, true]);
  await replied(bot, "Dragged");
  await idle(bot);
});

test("my_key → global actions; keyboard combinations are refused without reaching the phone; my_type types", async () => {
  let from = phone.reqs.length;
  await say(bot, 'call my_key {"keys":"back"}');
  assert.equal((await phone.waitReq("global.action", from)).args.action, "back");
  await replied(bot, "Pressed back on the phone");
  await idle(bot);
  for (const [k, action] of [["Home", "home"], ["recents", "recents"], ["notifications", "notifications"], ["enter", "enter"], ["escape", "back"]]) {
    from = phone.reqs.length;
    await say(bot, `call my_key {"keys":"${k}"}`);
    assert.equal((await phone.waitReq("global.action", from)).args.action, action);
    await idle(bot);
  }
  from = phone.reqs.length;
  await say(bot, 'call my_key {"keys":"ctrl+c"}');
  await replied(bot, /accepts only: back, home, recents, notifications, quick_settings, enter/);
  await idle(bot);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "global.action" || r.op === "keyboard.press").length, 0);
  from = phone.reqs.length;
  await say(bot, 'call my_type {"text":"Dentiste"}');
  assert.equal((await phone.waitReq("keyboard.type", from)).args.text, "Dentiste");
  await replied(bot, "Typed 8 characters");
  await idle(bot);
});

test("my_open → app.open by name, url.open for an address", async () => {
  let from = phone.reqs.length;
  await say(bot, 'call my_open {"app":"Agenda"}');
  assert.equal((await phone.waitReq("app.open", from)).args.name, "Agenda");
  await replied(bot, "Started Agenda");
  await idle(bot);
  from = phone.reqs.length;
  await say(bot, 'call my_open {"url":"https://example.com/rdv"}');
  assert.equal((await phone.waitReq("url.open", from)).args.url, "https://example.com/rdv");
  await replied(bot, "Opened https://example.com/rdv");
  await idle(bot);
});

test("my_windows → the app in front and the on-screen text, at positions of the last screenshot", async () => {
  const from = phone.reqs.length;
  requests.length = 0;
  await say(bot, "call my_windows {}");
  await phone.waitReq("screen.read", from);
  await replied(bot, /App in front on the phone/);
  await idle(bot);
  const text = JSON.stringify(requests.flatMap((r) => r.messages).flatMap((m) => m.content).filter((b) => b.type === "tool_result"));
  assert.match(text, /App in front on the phone Pixel de Léa \(Android\): Agenda \(com.example.agenda\)/);
  // [100, 2000, 400, 120] → centre (300, 2060) on the screen → (150, 1030) in the 540×1200 screenshot.
  assert.match(text, /\\"Nouveau rendez-vous\\" \[tappable\] at \(150, 1030\)/);
  assert.match(text, /\\"Rechercher\\" \[tappable\] at \(480, 80\)/);
  assert.match(text, /\\"Titre\\" \[text field, focused\]/);
  assert.match(text, /What follows came from outside/, "the phone's screen text is outside content");
  assert.ok(!phone.reqs.slice(from).some((r) => r.op === "window.list"));
});

test("my_command, even if a model calls it, never reaches a phone", async () => {
  const from = phone.reqs.length;
  await say(bot, 'call my_command {"command":"rm -rf /sdcard"}');
  await replied(bot, /There is no tool called "my_command"/);
  await idle(bot);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "shell.run").length, 0);
  assert.ok(!(await rowsOf(bot.id)).some((r) => r.body.kind === "card" && r.body.card.type === "approval" && r.body.card.status === "pending" && /command/.test(r.body.card.tool)), "no command card for a phone");
});

test("refusals decided on the phone: blocked app, lock screen, accessibility off; told to the bot and the user, never retried", async () => {
  phone.handlers["screen.capture"] = () => ({ error: { code: "blocked_app", message: "the app on screen is blocked on this phone" } });
  let from = phone.reqs.length;
  await say(bot, "call my_screen {}");
  await replied(bot, /one the user blocked/);
  await idle(bot);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "screen.capture").length, 1, "asked once");
  assert.ok((await relayLines(bot)).some((l) => /l'appli à l'écran y est bloquée/.test(l)), "the user sees it in the chat");

  phone.handlers["screen.capture"] = () => ({ error: { code: "screen_locked", message: "the phone is locked" } });
  from = phone.reqs.length;
  await say(bot, "call my_screen {}");
  await replied(bot, /The phone is locked/);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "screen.capture").length, 1);
  await idle(bot);

  phone.handlers["touch.tap"] = () => ({ error: { code: "permission_missing", message: "the Sklubot accessibility service is off on this phone" } });
  from = phone.reqs.length;
  await say(bot, 'call my_click {"x":1,"y":1}');
  await replied(bot, /accessibility service is off on the phone/);
  await idle(bot);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "touch.tap").length, 1);
  delete phone.handlers["touch.tap"];
  phone.handlers["screen.capture"] = () => ({ result: { format: "jpeg", width: 540, height: 1200, screenWidth: 1080, screenHeight: 2400, data: JPEG } });

  // A refusal of control on the phone itself.
  phone.event("session.ended", { bot: { id: bot.id, name: bot.name }, reason: "user_stop", sessionId: "s1" });
  phone.session = null;
  await until(async () => !(await devicesNow())[0].session, "session gone");
  phone.handlers["session.start"] = () => ({ error: { code: "consent_refused", message: "the user refused the control session" } });
  from = phone.reqs.length;
  await say(bot, "call my_screen {}");
  await decide((await pendingApproval(bot)).approvalId, "allow");
  await replied(bot, /refused, on their computer/);
  await idle(bot);
  assert.equal(phone.reqs.slice(from).filter((r) => r.op === "session.start").length, 1, "not retried");
});

test("a computer and a phone: commands are offered for the computer, refused for the phone", async () => {
  const computer = await new TestRelay().open(null);
  const pc = await computer.waitFor((m) => m.type === "pair.code", "pair.code");
  assert.equal((await call("POST", "/relay/pairings", { code: pc.code })).status, 200);
  await computer.waitFor((m) => m.type === "welcome", "welcome");
  const list = await devicesNow();
  assert.deepEqual(list.map((d) => d.kind).sort(), ["computer", "phone"]);
  requests.length = 0;
  await say(bot, "hi");
  await replied(bot, "Echo: hi");
  assert.ok(requests.at(-1)!.tools.some((t) => t.name === "my_command"), "a computer is linked: commands exist");
  const from = phone.reqs.length;
  await say(bot, 'call my_command {"command":"ls","device":"Pixel de Léa"}');
  await replied(bot, /not available on a phone/);
  await idle(bot);
  assert.equal(phone.reqs.length, from, "nothing sent to the phone");

  // A computer's token cannot turn it into a phone: the kind is the one chosen at pairing.
  const token = computer.token, id = computer.deviceId;
  computer.close();
  await until(async () => (await devicesNow()).find((d) => d.id === id)?.status === "offline", "offline");
  const again = await new TestRelay().open({ deviceId: id, token }, {}, { device: { name: "x", platform: "android", kind: "phone" } });
  await again.waitFor((m) => m.type === "welcome", "welcome");
  assert.equal((await devicesNow()).find((d) => d.id === id)?.kind, "computer");
  again.close();
});

test("removing the phone revokes it (4003)", async () => {
  assert.equal((await call("DELETE", `/relay/devices/${phoneId}`)).status, 200);
  await phone.waitFor((m) => m.type === "revoke", "revoke");
  assert.equal((await phone.waitClosed()).code, 4003);
  assert.ok(!(await devicesNow()).some((d) => d.kind === "phone"));
  void userId;
});
