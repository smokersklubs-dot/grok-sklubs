import assert from "node:assert/strict";
import { appendFileSync, chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * L177 « Android par USB » (androidusb.ts, androidusbroutes.ts, agent/phoneusb.ts; protocol 1.9, RELAIS-PROTOCOLE §20).
 * A fake relay whose android.* answers come from the Relais' OWN code (companion RelayCore + phone-usb.js + adb.js)
 * driving a FAKE adb executable: never a real adb, never a real phone. The owner's answer on the computer is played
 * by the fake consent UI. Fresh DATA_DIR before any server module is imported.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-androidusb-"));
process.env.SESSION_SECRET = "androidusb-secret-androidusb-secret-x";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { relayUpgrade, closeAllRelays } = await import("../src/relay.js");
const { attachLiveScreens } = await import("../src/vnc.js");
const { committingTap } = await import("../src/agent/phoneusb.js");
const { phoneHeld } = await import("../src/androidusb.js");
const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const require = createRequire(import.meta.url);
const { RelayCore } = require("../../companion/src/main/relay-core.js");
const { createAdb } = require("../../companion/src/main/capabilities/adb.js");
const FAKE_ADB = path.join(path.dirname(require.resolve("../../companion/package.json")), "test/unit/fixtures/fake-adb.js");
chmodSync(FAKE_ADB, 0o755);

registerProvider({
  id: "ausb", label: "Scripted", models: ["ausb-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const result = last.content.find((b) => b.type === "tool_result");
    const said = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n");
    let content: Block[];
    if (result && result.type === "tool_result") content = [{ type: "text", text: `Tool said: ${result.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ")}` }];
    else {
      const m = /call (\w+) (\{[^\n]*\})/.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${Math.random().toString(36).slice(2)}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said}` }];
    }
    for (const b of content) if (b.type === "text") req.onText?.(b.text);
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "ausb-1", usage };
  },
} satisfies LlmProvider);

const app = new Hono();
app.route("/api", api);
const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as import("node:http").Server;
await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
attachLiveScreens(server, [relayUpgrade]);
const WS = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/relay/connect`;
after(() => { closeAllRelays(); server.closeAllConnections?.(); server.close(); });

const jars: Record<string, string> = { lea: "", max: "" };
let who: "lea" | "max" = "lea";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jars[who] }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jars[who] = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, ms = 15_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=300`)).json.rows;
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const pendingCard = (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval card");
const replies = async (bot: Bot) => (await rowsOf(bot.id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming);
const seen = new Map<string, number>();
const replied = async (bot: Bot, part: RegExp) => {
  const r = await until(async () => { const all = await replies(bot); if (all.length <= (seen.get(bot.id) ?? 0)) return null; const l = all.at(-1)!.body as { text: string }; return part.test(l.text) && l; }, `reply ${part}`).catch(async (e) => { throw new Error(`${e.message}; last: ${JSON.stringify(((await replies(bot)).at(-1)?.body as any)?.text)}`); });
  seen.set(bot.id, (await replies(bot)).length);
  return r;
};
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running; }, "bot idle");

// ── The fake adb's world (same fixture as companion/test/unit/android-usb.test.js) ──
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]), Buffer.from("IHDR"), Buffer.from([0, 0, 4, 56, 0, 0, 9, 96, 8, 6, 0, 0, 0])]);
const node = (i: number, text: string, cls: string, b: string, extra = "") => `<node index="${i}" text="${text}" resource-id="com.example.chat:id/n${i}" class="android.widget.${cls}" package="com.example.chat" content-desc="" checkable="false" checked="false" clickable="true" focused="false" password="false" bounds="${b}" ${extra}/>`;
const UI_CHAT = `<?xml version='1.0' encoding='UTF-8' standalone='yes' ?><hierarchy rotation="0"><node index="0" text="" resource-id="" class="android.widget.FrameLayout" package="com.example.chat" content-desc="" checkable="false" checked="false" clickable="false" focused="false" password="false" bounds="[0,0][1080,2400]">${node(1, "Envoyer", "Button", "[800,2200][1040,2340]")}${node(2, "Photos", "Button", "[40,2200][300,2340]")}</node></hierarchy>`;
const UI_PASS = UI_CHAT.replace('text="Photos" resource-id="com.example.chat:id/n2" class="android.widget.Button"', 'text="" resource-id="com.example.chat:id/password" class="android.widget.EditText"').replace('focused="false" password="false" bounds="[40,2200]', 'focused="true" password="true" bounds="[40,2200]');
const adbDir = mkdtempSync(path.join(tmpdir(), "fake-adb-server-"));
process.env.FAKE_ADB_DIR = adbDir;
const adbState = (patch: Record<string, unknown>) => writeFileSync(path.join(adbDir, "state.json"), JSON.stringify({ ...(existsSync(path.join(adbDir, "state.json")) ? JSON.parse(readFileSync(path.join(adbDir, "state.json"), "utf8")) : {}), ...patch }));
adbState({ png: PNG.toString("base64"), ui: UI_CHAT, focus: "com.example.chat", devices: [{ serial: "R58M12ABC", state: "device", model: "Pixel_8", android: "15", sdk: 35 }, { serial: "ZY22XYZ", state: "unauthorized" }] });
appendFileSync(path.join(adbDir, "calls.jsonl"), "");
const adbCalls = (): string[][] => readFileSync(path.join(adbDir, "calls.jsonl"), "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l));
const inputs = () => adbCalls().filter((c) => c[2] === "shell" && (c[3] === "input" || c[3] === "monkey")).map((c) => c.slice(3));

/** A relay: the android.* operations are answered by the Relais' own RelayCore over the fake adb. */
class Relay {
  ws!: WebSocket;
  msgs: any[] = [];
  deviceId = "";
  code = "";
  asked: Array<{ kind: string; detail: string }> = [];
  answer: (kind: string) => string = () => "allow";
  adbPath: string | null = FAKE_ADB;
  core = new RelayCore({
    send: (m: unknown) => { this.ws.send(JSON.stringify(m)); return true; },
    caps: new Proxy({}, { get: (_t, name: string) => { const adb = createAdb({ adbPath: this.adbPath }) as Record<string, Function>; return adb[name] ? (a: unknown) => adb[name](a) : async () => ({}); } }),
    ui: {
      askSession: async () => "once", askCommand: async () => ({ decision: "refuse" }),
      askGuard: async (p: { kind: string; detail: string }) => { this.asked.push({ kind: p.kind, detail: p.detail }); return this.answer(p.kind); },
      cancelPrompt: () => {}, onSession: () => {}, onLocked: () => {},
    },
    store: { getBot: () => undefined, setBotPerm: () => {}, isLocked: () => this.locked, setLocked: (v: boolean) => { this.locked = v; } },
    log: () => {},
  });
  locked = false;
  async open() {
    this.ws = new WebSocket(WS);
    this.ws.on("message", (d) => void this.onMessage(JSON.parse(String(d))));
    this.ws.on("error", () => {});
    await new Promise<void>((resolve) => this.ws.once("open", () => resolve()));
    const caps = ["session.start", "session.end", "screen.info", "android.devices", "android.screenshot", "android.ui", "android.tap", "android.swipe", "android.type", "android.key", "android.open", "android.release"];
    this.ws.send(JSON.stringify({ type: "hello", v: 1, protocol: "1.9", auth: null, app: { name: "sklubot-relais", version: "1.0.2" }, device: { name: "portable-lea", platform: "linux", arch: "x64", osRelease: "6.1", locale: "fr-FR" }, capabilities: caps, screen: { width: 1280, height: 800, scaleFactor: 1 }, limits: { maxInboundBytes: 262144, maxViewFps: 5 }, state: { locked: false } }));
    return this;
  }
  private async onMessage(m: any) {
    this.msgs.push(m);
    if (m.type === "pair.code") this.code = m.code;
    if (m.type === "paired") { this.deviceId = m.deviceId; this.ws.send(JSON.stringify({ type: "token.ack", deviceId: m.deviceId })); }
    if (m.type === "welcome") this.ws.send(JSON.stringify({ type: "event", name: "relay.state", ts: new Date().toISOString(), locked: false, session: null }));
    if (m.type === "req") await this.core.handleRequest(m);
  }
  close() { try { this.ws.terminate(); } catch { /* gone */ } }
}

let alice: Bot, relay: Relay;
const deviceId = () => relay.deviceId;
const phonesView = async () => (await call("GET", `/relay/devices/${deviceId()}/android?fresh=1`)).json;

test("setup: Léa, her bot Alice, one computer whose Relais offers Android by USB; Max, another account", async () => {
  who = "max";
  assert.equal((await call("POST", "/auth/signup", { email: "max@example.com", name: "Max", password: "password123", locale: "en" })).status, 200);
  who = "lea";
  assert.equal((await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" })).status, 200);
  alice = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  alice = (await call("PATCH", `/bots/${alice.id}`, { name: "Alice", model: "ausb:ausb-1", autonomy: "trusted" })).json.bot;
  relay = await new Relay().open();
  await until(() => relay.code, "pair code");
  assert.equal((await call("POST", "/relay/pairings", { code: relay.code })).status, 200);
  await until(() => relay.msgs.find((m) => m.type === "welcome"), "welcome");
});

test("Settings → Computers: the phones, model and Android only once the phone allowed the computer; another account gets 404", async () => {
  const v = await phonesView();
  assert.equal(v.supported, true);
  assert.deepEqual(v.adb, { found: true, version: "1.0.41" });
  assert.deepEqual(v.devices.map((d: any) => [d.serial, d.state, d.model ?? null, d.android ?? null, d.inUse]), [["R58M12ABC", "device", "Pixel 8", "15", null], ["ZY22XYZ", "unauthorized", null, null, null]]);
  const sklubotReq = relay.msgs.filter((m) => m.type === "req" && m.op === "android.devices");
  assert.ok(sklubotReq.every((m) => m.bot.id === "sklubot"), "Sklubot asks itself, never as a bot");
  who = "max";
  assert.equal((await call("GET", `/relay/devices/${deviceId()}/android`)).status, 404);
  assert.equal((await call("POST", `/relay/devices/${deviceId()}/android/stop`, { serial: "R58M12ABC" })).status, 404);
  assert.equal((await call("GET", "/relay/devices/nope/android")).status, 404);
  who = "lea";
  assert.equal((await call("POST", `/relay/devices/${deviceId()}/android/stop`, { serial: "bad serial;" })).status, 400);
});

test("first use: a card here (refused → nothing sent), then the computer's own question; the tap goes to adb as given", async () => {
  await say(alice, `call phone_tap {"x":100,"y":200}`);
  let card = await pendingCard(alice);
  assert.equal(card.tool, "phoneusb: use: Alice");
  assert.match(card.title, /Pixel 8 \(Android 15\)/);
  assert.match(card.title, /portable-lea/);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" })).status, 200);
  await idle(alice);
  assert.equal(inputs().length, 0, "nothing reached the phone");
  await say(alice, `call phone_tap {"x":100,"y":200}`);
  card = await pendingCard(alice);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await replied(alice, /Tapped .*at 100,200/);
  assert.deepEqual(relay.asked.map((a) => a.kind), ["phone"], "asked on the computer too");
  assert.match(relay.asked[0].detail, /Pixel 8 · Android 15 \(R58M12ABC\)/);
  assert.deepEqual(inputs().at(-1), ["input", "tap", "100", "200"]);
  const v = await until(async () => { const x = await phonesView(); return x.devices[0].inUse && x; }, "in use");
  assert.equal(v.devices[0].inUse.botName, "Alice", "« utilisé par Alice »");
  const lines = (await rowsOf(alice.id)).filter((r) => r.body.kind === "event" && r.body.event === "relay").map((r) => (r.body as { text: string }).text);
  assert.ok(lines.some((l) => /Alice utilise ton téléphone Pixel 8 \(branché sur portable-lea/.test(l)), lines.join(" | "));
});

test("tapping a control that sends (or installs) asks on a single-use card, from the phone's own words", async () => {
  assert.equal(committingTap("Installer"), "install");
  assert.equal(committingTap("Envoyer"), "send");
  assert.equal(committingTap("Photos"), null);
  await say(alice, `call phone_ui_tree {}`);
  await replied(alice, /\[0\] Button “Envoyer” tappable/);
  const before = inputs().length;
  await say(alice, `call phone_tap {"element":0}`);
  let card = await pendingCard(alice);
  assert.equal(card.tool, "phoneusb: commit: Alice");
  assert.match(card.title, /Envoyer/);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" })).status, 200);
  await idle(alice);
  assert.equal(inputs().length, before, "not tapped");
  await say(alice, `call phone_ui_tree {}`);
  await replied(alice, /Envoyer/);
  await say(alice, `call phone_tap {"element":0}`);
  card = await pendingCard(alice);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await replied(alice, /Tapped “Envoyer” at 920,2270/);
  assert.deepEqual(inputs().at(-1), ["input", "tap", "920", "2270"]);
  // A tap by pixels on the same button, without reading first: the phone is read, and the bot is told to ask.
  await say(alice, `call phone_tap {"x":920,"y":2270}`);
  await replied(alice, /commits something/);
  assert.deepEqual(inputs().at(-1), ["input", "tap", "920", "2270"]);
  assert.equal(inputs().length, before + 1);
});

test("a password: never typed as text; only from the vault, with a card showing •••• (N) — the secret is nowhere in the chat, steps, card or audit", async () => {
  const SECRET = "hunter22";
  assert.equal((await call("POST", "/vault", { name: "Banque mobile", site: "https://banque.example", username: "lea", password: SECRET })).status, 200);
  adbState({ ui: UI_PASS });
  // The bot tries to type it itself: refused by the phone, never forced, nothing typed.
  await say(alice, `call phone_type {"text":"${SECRET}"}`);
  await replied(alice, /phone_vault_fill/);
  assert.ok(!inputs().some((c) => c[1] === "text"), "nothing typed");
  // From the vault: a single-use card naming the item, the field and the app, the secret as dots only.
  await say(alice, `call phone_ui_tree {}`);
  await replied(alice, /password field/);
  await say(alice, `call phone_vault_fill {"item":"Banque mobile","field":"password"}`);
  const card = await pendingCard(alice);
  assert.equal(card.tool, "phoneusb: vault: Alice");
  assert.match(card.title, /mot de passe|password/);
  assert.match(card.title, /com\.example\.chat:id\/password/);
  assert.match(card.detail ?? "", /•••• \(8 caractères\)/);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await replied(alice, /Filled the saved password of "Banque mobile"/);
  assert.equal(relay.asked.at(-1)!.kind, "phone_password", "the computer asked again");
  assert.deepEqual(inputs().at(-1), ["input", "text", `'${SECRET}'`], "it reached the phone only");
  // Only the first, refused attempt carried the text (the bot wrote it itself): the vault fill never did.
  const rowsText = JSON.stringify((await rowsOf(alice.id)).filter((r) => !(r.body.kind === "message" && r.body.role === "user") && !(r.body.kind === "step" && (r.body as any).tool === "phone_type")));
  assert.doesNotMatch(rowsText, new RegExp(SECRET), "not in the card, the steps, the replies or the relay lines");
  const fillStep = (await rowsOf(alice.id)).find((r) => r.body.kind === "step" && (r.body as any).tool === "phone_vault_fill");
  assert.deepEqual((fillStep!.body as any).args, { item: "Banque mobile", field: "password" });
  assert.doesNotMatch(JSON.stringify((await call("GET", "/audit")).json ?? {}), new RegExp(SECRET), "not in the journal");
  adbState({ ui: UI_CHAT });
});

test("« Arrêter » in Settings: the Relais releases the phone and forgets its yes; the bot is held back", async () => {
  const asked = relay.asked.length;
  assert.equal((await call("POST", `/relay/devices/${deviceId()}/android/stop`, { serial: "R58M12ABC" })).status, 200);
  await until(async () => !(await phonesView()).devices[0].inUse, "released");
  assert.equal(relay.core.android.allowed.size, 0, "the Relais forgot the yes");
  assert.equal(phoneHeld(alice.id, deviceId(), "R58M12ABC"), true, "held back: it may not take the phone again on its own");
  // The owner writes to the bot again (that lifts the hold, as for a computer): a new card here, a new question there.
  await say(alice, `call phone_key {"key":"back"}`);
  const card = await pendingCard(alice);
  assert.equal(card.tool, "phoneusb: use: Alice");
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" })).status, 200);
  await replied(alice, /Pressed back/);
  assert.equal(relay.asked.length, asked + 1, "the computer asked again");
  assert.deepEqual(inputs().at(-1), ["input", "keyevent", "4"]);
});

test("Stop on the computer wins: everything locked; adb missing gives the install guide", async () => {
  relay.core.stop("tray");
  await say(alice, `call phone_screen {}`);
  const card = await pendingCard(alice).catch(() => null);
  if (card) await call("POST", `/approvals/${card.approvalId}`, { decision: "allow" });
  await replied(alice, /pressed Stop on the computer: nothing can be done/);
  relay.core.unlock();
  relay.adbPath = null;
  await say(alice, `call phone_devices {}`);
  await replied(alice, /platform-tools/);
  const v = await phonesView();
  assert.deepEqual(v.adb, { found: false });
  relay.adbPath = FAKE_ADB;
});
