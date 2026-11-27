import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * « Un ordinateur pour tous mes bots » (computershare.ts, agent/computerqueue.ts, relay.ts hand-over): the account
 * yes « pour tous mes bots » on the control card, the hand-over of an idle computer (older relay: Sklubot ends the
 * idle session; relay 1.7: the relay does it), the line in the chat of a bot that waits, Stop winning everything,
 * « Ordinateur de ce bot », and account isolation. Real API, real upgrade handler, a small relay played here.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-share-"));
process.env.SESSION_SECRET = "share-secret-share-secret-share-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { relayUpgrade, closeAllRelays, holderIdleMs } = await import("../src/relay.js");
const { attachLiveScreens } = await import("../src/vnc.js");
const { HANDOVER, waitingFor } = await import("../src/agent/computerqueue.js");
const { q } = await import("../src/db.js");
const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

// A scripted model: "call T {json}" → that tool once, then it says what the tool answered.
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
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
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "script-1", usage };
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
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows`)).json.rows;
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const pendingCard = (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval card");
const lastReply = async (bot: Bot) => [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming)?.body as { text: string } | undefined;
const replies = async (bot: Bot) => (await rowsOf(bot.id)).filter((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming).length;
const seen = new Map<string, number>();
/** The bot's next reply (after the last one a test already waited for) matches. */
const replied = async (bot: Bot, part: RegExp) => {
  const r = await until(async () => { const n = await replies(bot); if (n <= (seen.get(bot.id) ?? 0)) return null; const l = await lastReply(bot); return l && part.test(l.text) && l; }, `reply ${part}`);
  seen.set(bot.id, await replies(bot));
  return r;
};
const notices = async (bot: Bot) => (await rowsOf(bot.id)).filter((r) => r.body.kind === "notice").map((r) => (r.body as { text: string }).text);
const relayLines = async (bot: Bot) => (await rowsOf(bot.id)).filter((r) => r.body.kind === "event" && r.body.event === "relay").map((r) => (r.body as { text: string }).text);
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running; }, "bot idle");

const JPEG = "/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAP////////////////////////////////////////////////////////////////////////////////////////////////////////////wgALCAABAAEBAREA/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxA=";

/** A relay: one session at a time like the real one; `handover` plays a relay 1.7 that hands an idle session over. */
class Relay {
  ws!: WebSocket;
  msgs: any[] = [];
  reqs: any[] = [];
  deviceId = "";
  token = "";
  session: { id: string; name: string } | null = null;
  n = 0;
  constructor(private readonly handover = false) {}
  async open(auth: { deviceId: string; token: string } | null) {
    this.ws = new WebSocket(WS);
    this.ws.on("message", (d) => this.onMessage(JSON.parse(String(d))));
    this.ws.on("error", () => {});
    await new Promise<void>((resolve) => this.ws.once("open", () => resolve()));
    const caps = ["session.start", "session.end", "screen.info", "screen.capture", "view.start", "view.stop", "window.active", ...(this.handover ? ["session.handover"] : [])];
    this.send({ type: "hello", v: 1, auth, app: { name: "sklubot-relais", version: "1.0.1" }, device: { name: "portable-lea", platform: "linux", arch: "x64", osRelease: "6.1", locale: "fr-FR" }, capabilities: caps, screen: { width: 1280, height: 800, scaleFactor: 1 }, limits: { maxInboundBytes: 262144, maxViewFps: 5 }, state: { locked: false } });
    return this;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  event(name: string, data: Record<string, unknown> = {}) { this.send({ type: "event", name, ts: new Date().toISOString(), ...data }); }
  end(reason = "bot", extra: Record<string, unknown> = {}) { const s = this.session; this.session = null; if (s) this.event("session.ended", { bot: s, reason, sessionId: "s", ...extra }); }
  private onMessage(m: any) {
    this.msgs.push(m);
    if (m.type === "pair.code") this.code = m.code;
    if (m.type === "paired") { this.deviceId = m.deviceId; this.token = m.token; this.send({ type: "token.ack", deviceId: m.deviceId }); }
    if (m.type === "token.rotate") { this.token = m.token; this.send({ type: "token.ack", deviceId: this.deviceId }); }
    if (m.type === "welcome") this.event("relay.state", { locked: false, session: null });
    if (m.type !== "req") return;
    if (m.op !== "guard.set") this.reqs.push(m);
    const ok = (result: any = {}) => this.send({ type: "res", id: m.id, ok: true, result });
    const bot = { id: m.bot.id, name: m.bot.name };
    if (m.op === "session.start") {
      if (this.session && this.session.id !== bot.id) {
        if (!this.handover) return this.send({ type: "res", id: m.id, ok: false, error: { code: "busy", message: "another bot has the control session" } });
        const from = this.session;
        this.end("handover", { to: bot });
        this.session = bot;
        this.event("session.started", { bot, grant: "account", sessionId: `s${++this.n}`, from });
        return ok({ sessionId: `s${this.n}`, grant: "account", from });
      }
      this.session = bot;
      this.event("session.started", { bot, grant: "once", sessionId: `s${++this.n}` });
      return ok({ sessionId: `s${this.n}`, grant: "once" });
    }
    if (m.op === "session.end") { if (this.session?.id === bot.id) this.end("bot"); return ok(); }
    if (m.op === "screen.capture") return this.session?.id === bot.id ? ok({ format: "jpeg", width: 640, height: 400, screenWidth: 1280, screenHeight: 800, data: JPEG }) : this.send({ type: "res", id: m.id, ok: false, error: { code: this.session ? "busy" : "no_session", message: "x" } });
    if (m.op === "view.start") return ok({ viewId: "v1", maxFps: 3 });
    return ok();
  }
  code = "";
  close() { try { this.ws.terminate(); } catch { /* gone */ } }
}

let alice: Bot, bob: Bot, relay: Relay, leaId = "";
const deviceId = () => relay.deviceId;
const sessionOf = async () => (await call("GET", "/relay/devices")).json.devices.find((d: any) => d.id === deviceId())?.session?.botName ?? null;

test("setup: one account, two bots, one linked computer", async () => {
  const r = await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" });
  assert.equal(r.status, 200, r.text);
  leaId = r.json.user.id;
  alice = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  await call("PATCH", `/bots/${alice.id}`, { name: "Alice" });
  alice = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.id === alice.id);
  bob = (await call("POST", "/bots", { name: "Bob" })).json.bot;
  relay = await new Relay().open(null);
  await until(() => relay.code, "pair code");
  assert.equal((await call("POST", "/relay/pairings", { code: relay.code })).status, 200);
  await until(() => relay.msgs.find((m) => m.type === "welcome"), "welcome");
  Object.assign(HANDOVER, { pollMs: 30, announceAfterMs: 0, idleMs: 60_000 });
});

test("« pour tous mes bots » on Alice's control card: allowed now, and the account policy is on", async () => {
  await say(alice, "call my_screen {}");
  const card = await pendingCard(alice);
  assert.equal(card.tool, "mycomputer: control: Alice");
  assert.equal((await call("GET", "/relay/all-bots")).json.on, false);
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "allbots" })).status, 200);
  await replied(alice, /Tool said:/);
  assert.equal((await call("GET", "/relay/all-bots")).json.on, true);
  assert.equal(await sessionOf(), "Alice");
});

test("busy holder: Bob gets no card, waits in line and says so in his chat; goes on when Alice lets go", async () => {
  await idle(alice);
  await say(bob, "call my_screen {}");
  await until(() => waitingFor(deviceId()).includes(bob.id), "Bob in line");
  const line = await until(async () => (await notices(bob)).find((t) => t.startsWith("En attente de l'ordinateur")), "waiting line");
  assert.match(line, /^En attente de l'ordinateur portable-lea \(Linux\), utilisé par Alice\. Je continue tout seul dès qu'il est libre\.$/);
  assert.ok(!(await rowsOf(bob.id)).some((r) => r.body.kind === "card" && r.body.card.type === "approval"), "no card: the account said yes for all its bots");
  assert.equal(relay.reqs.filter((r) => r.op === "session.start" && r.bot.id === bob.id).length, 0, "never two bots: Bob does not even ask while Alice drives");
  relay.end("bot"); // Alice lets go on the computer
  await replied(bob, /Tool said:/);
  assert.equal(await sessionOf(), "Bob");
  assert.ok((await notices(bob)).some((t) => /^J'ai attendu \d+ s l'ordinateur portable-lea \(Linux\) ; c'est mon tour, je continue\.$/.test(t)), "the line is closed");
  assert.equal(waitingFor(deviceId()).length, 0);
});

test("idle holder through an older relay: Sklubot ends Bob's session for Alice", async () => {
  await idle(bob);
  HANDOVER.idleMs = 150;
  await until(() => (holderIdleMs(deviceId()) ?? 0) >= 150, "Bob idle");
  const before = relay.reqs.length;
  await say(alice, "call my_screen {}");
  await replied(alice, /Tool said:.*\[image\]/);
  const sent = relay.reqs.slice(before).map((r) => `${r.op}:${r.bot.name}${r.op === "session.end" ? `:${r.args?.reason}` : ""}`);
  assert.deepEqual(sent.slice(0, 2), ["session.end:Bob:handover", "session.start:Alice"]);
  assert.equal(await sessionOf(), "Alice");
  assert.ok((await relayLines(bob)).includes("Bob ne faisait plus rien sur portable-lea (Linux) : il a laissé la main à Alice."));
});

test("relay 1.7 (session.handover): Sklubot does not end the session itself; the relay hands over, the chat says who", async () => {
  await idle(alice);
  relay.close();
  const auth = { deviceId: relay.deviceId, token: relay.token };
  relay = Object.assign(await new Relay(true).open(auth), { deviceId: auth.deviceId, token: auth.token });
  await until(() => relay.msgs.find((m) => m.type === "welcome"), "welcome again");
  // Alice takes it again (no card: account yes), then stays quiet.
  await say(alice, "call my_screen {}");
  await until(async () => (await sessionOf()) === "Alice", "Alice holds");
  await idle(alice);
  await until(() => (holderIdleMs(deviceId()) ?? 0) >= HANDOVER.idleMs, "Alice idle");
  const before = relay.reqs.length;
  await say(bob, "call my_screen {}");
  await replied(bob, /Tool said:.*\[image\]/);
  assert.deepEqual(relay.reqs.slice(before).map((r) => `${r.op}:${r.bot.name}`).slice(0, 1), ["session.start:Bob"]);
  assert.equal(await sessionOf(), "Bob");
  assert.ok((await relayLines(bob)).includes("Alice a laissé la main à Bob sur portable-lea (Linux)."));
  assert.ok((await relayLines(alice)).includes("Alice ne faisait plus rien sur portable-lea (Linux) : il a laissé la main à Bob."));
});

test("Stop in Sklubot wins: the bot waiting in line stops waiting too", async () => {
  await idle(bob);
  HANDOVER.idleMs = 60_000;
  // Bob is busy (a request under way would also count): make him active now.
  await say(bob, "call my_screen {}");
  await replied(bob, /Tool said:/);
  await idle(bob);
  await say(alice, "call my_screen {}");
  await until(() => waitingFor(deviceId()).includes(alice.id), "Alice in line");
  assert.equal((await call("POST", `/relay/devices/${deviceId()}/stop`)).status, 200);
  await replied(alice, /Tool said: Stopped\./);
  assert.equal(waitingFor(deviceId()).length, 0);
  assert.ok((await notices(alice)).includes("J'ai arrêté d'attendre l'ordinateur portable-lea (Linux)."));
});

test("a line of two: the second says its place; after the longest wait both give up and say so", async () => {
  await idle(alice);
  await say(bob, "call my_screen {}"); // Bob writes again (Stop held him back until then) and takes the computer
  await replied(bob, /Tool said:.*\[image\]/);
  await idle(bob);
  const carol = (await call("POST", "/bots", { name: "Carol" })).json.bot as Bot;
  HANDOVER.maxWaitMs = 1500;
  await say(alice, "call my_screen {}");
  await until(() => waitingFor(deviceId()).includes(alice.id), "Alice in line");
  await say(carol, "call my_screen {}");
  const line = await until(async () => (await notices(carol)).find((t) => t.includes("numéro 2")), "Carol's place");
  assert.equal(line, "En attente de l'ordinateur portable-lea (Linux), utilisé par Bob : numéro 2 dans la file, après Alice. Je continue tout seul dès qu'il est libre.");
  await replied(alice, /Tool said: Another bot has the control session/);
  await replied(carol, /Tool said: Another bot has the control session/);
  assert.ok((await notices(alice)).some((t) => /^L'ordinateur portable-lea \(Linux\) était encore utilisé après \d+ s : j'ai arrêté d'attendre\./.test(t)));
  assert.equal(await sessionOf(), "Bob", "the holder kept it all along");
  HANDOVER.maxWaitMs = 10 * 60_000;
});

test("« Ordinateur de ce bot »: the choice, an offline choice said clearly, back to « celui qui est connecté »", async () => {
  await idle(alice);
  q.run("INSERT INTO relay_devices (id, user_id, name, platform, arch, os_release, app_version, token_hash, rotated_at, created_at, last_seen_at) VALUES ('dev_bureau', ?, 'bureau', 'darwin', 'arm64', '14', '1.0.1', 'x', 1, 9e15, 1)", leaId);
  const view = (await call("GET", `/bots/${alice.id}/computer`)).json;
  assert.equal(view.deviceId, null);
  assert.deepEqual(view.devices.map((d: any) => [d.name, d.online]), [["portable-lea", true], ["bureau", false]]);
  assert.equal((await call("PUT", `/bots/${alice.id}/computer`, { deviceId: "dev_bureau" })).json.deviceId, "dev_bureau");
  await say(alice, "call my_screen {}");
  await replied(alice, /set to use the computer "bureau".*not connected right now/);
  await idle(alice);
  assert.equal((await call("PUT", `/bots/${alice.id}/computer`, { deviceId: "nope" })).status, 404);
  assert.equal((await call("PUT", `/bots/${alice.id}/computer`, { deviceId: 3 })).status, 400);
  assert.equal((await call("PUT", `/bots/${alice.id}/computer`, { deviceId: null })).json.deviceId, null);
});

test("isolation: another account never sees nor sets this account's bots, computers or policy", async () => {
  who = "max";
  assert.equal((await call("POST", "/auth/signup", { email: "max@example.com", name: "Max", password: "password123", locale: "en" })).status, 200);
  assert.equal((await call("GET", `/bots/${alice.id}/computer`)).status, 404);
  assert.equal((await call("PUT", `/bots/${alice.id}/computer`, { deviceId: null })).status, 404);
  const mine = (await call("GET", "/bots")).json.bots[0] as Bot;
  assert.equal((await call("PUT", `/bots/${mine.id}/computer`, { deviceId: relay.deviceId })).status, 404, "Léa's computer is not Max's");
  assert.equal((await call("GET", "/relay/all-bots")).json.on, false);
  who = "lea";
  assert.equal((await call("GET", "/relay/all-bots")).json.on, true);
});

test("« Retirer » in Settings → Computers: the next bot without a session is asked again", async () => {
  assert.equal((await call("DELETE", "/relay/all-bots")).json.on, false);
  relay.end("bot");
  await until(async () => (await sessionOf()) === null, "free");
  await say(alice, "call my_screen {}");
  const card = await pendingCard(alice);
  assert.equal(card.tool, "mycomputer: control: Alice");
  assert.equal((await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" })).status, 200);
  await idle(alice);
});

test("« pour tous mes bots » is refused on a card that is not about taking control", async () => {
  q.run("INSERT INTO approvals (id, bot_id, user_id, seq, generation, tool, created_at) VALUES ('apr_x', ?, ?, 0, 0, 'vault: Banque', 1)", alice.id, leaId);
  const r = await call("POST", "/approvals/apr_x", { decision: "allbots" });
  assert.equal(r.status, 400);
  assert.equal((await call("GET", "/relay/all-bots")).json.on, false);
});
