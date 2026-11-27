import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

/**
 * The user's own files through Sklubot Relais (spec 07 A15, relay protocol 1.1): a relay written here plays the user's
 * computer over the real protocol and answers the fs.* operations; a scripted model plays the bot.
 */
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-w5b-files-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { relayUpgrade, closeAllRelays } = await import("../src/relay.js");
const { attachLiveScreens } = await import("../src/vnc.js");
const { routines } = await import("../src/routines.js");
const { fireRoutine } = await import("../src/scheduler.js");
const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
import type { Block, LlmProvider, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";

const requests: TurnRequest[] = [];
registerProvider({
  id: "script", label: "Scripted", models: ["script-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    requests.push(req);
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "[image]")).join(" ") : ""}` }];
    } else {
      const said = (texts[texts.length - 1] ?? "").replace(/^(\[[^\]\n]*\]\n)+/, "");
      const m = /call (\w+) (\{[^\n]*\})/.exec(said);
      content = m ? [{ type: "tool_use", id: `call_${requests.length}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: `Echo: ${said}` }];
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

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
async function until<T>(probe: () => Promise<T | undefined | false | null> | T | undefined | false | null, label: string, ms = 20_000): Promise<T> {
  const end = Date.now() + ms;
  while (Date.now() < end) { const v = await probe(); if (v) return v; await new Promise((r) => setTimeout(r, 20)); }
  throw new Error(`timed out waiting for ${label}`);
}
const rowsOf = async (botId: string): Promise<Row[]> => (await call("GET", `/bots/${botId}/rows?limit=300`)).json.rows;
const say = (bot: Bot, text: string) => call("POST", `/bots/${bot.id}/messages`, { text });
const idle = (bot: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[bot.id]?.running && !r.json.live?.[bot.id]?.awaiting; }, "bot idle");
const lastReply = async (bot: Bot) => [...(await rowsOf(bot.id))].reverse().find((r) => r.body.kind === "message" && r.body.role === "assistant" && !r.body.streaming)?.body as { text: string } | undefined;
const replied = (bot: Bot, part: string | RegExp) => until(async () => { const r = await lastReply(bot); return r && (typeof part === "string" ? r.text.includes(part) : part.test(r.text)) && r; }, `reply ${part}`);
const pendingApproval = (bot: Bot) => until(async () => { const r = (await rowsOf(bot.id)).find((x) => x.body.kind === "card" && x.body.card.type === "approval" && x.body.card.status === "pending"); return r?.body.kind === "card" && r.body.card.type === "approval" ? r.body.card : null; }, "approval card");

const BASE_CAPS = ["session.start", "session.end", "screen.info", "screen.capture", "view.start", "view.stop", "mouse.move", "mouse.click", "mouse.drag", "mouse.scroll", "keyboard.type", "keyboard.press", "app.open", "url.open", "window.list", "window.focus", "shell.run"];
const FS_CAPS = ["fs.roots", "fs.list", "fs.read", "fs.write", "fs.trash"];

/** A relay as docs/RELAIS-PROTOCOLE.md describes it (pairing, requests), with shared folders it answers fs.* for. */
class FileRelay {
  ws!: WebSocket;
  msgs: any[] = [];
  reqs: any[] = [];
  deviceId = "";
  token = "";
  files: Record<string, string> = { "Documents/notes.txt": "Liste de courses : pain, lait", "Documents/factures/mars.txt": "Facture 42" };
  async open(auth: { deviceId: string; token: string } | null, caps: string[]) {
    this.ws = new WebSocket(WS);
    this.ws.on("message", (d) => this.onMessage(JSON.parse(String(d))));
    this.ws.on("error", () => {});
    await new Promise<void>((resolve, reject) => { this.ws.once("open", () => resolve()); this.ws.once("error", reject); });
    this.send({ type: "hello", v: 1, protocol: "1.1", auth, app: { name: "sklubot-relais", version: "0.2.0" }, device: { name: "portable-zoe", platform: "linux", arch: "x64", osRelease: "6.1", locale: "fr-FR" }, capabilities: caps, screen: { width: 1280, height: 800, scaleFactor: 1 }, limits: { maxInboundBytes: 262144, maxViewFps: 5 }, state: { locked: false } });
    return this;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  private answer(m: any): { result?: any; error?: { code: string; message: string } } {
    const a = m.args ?? {};
    if (m.op === "fs.roots") return { result: { roots: [{ id: "r1", name: "Documents", path: "~/Documents", write: true }, { id: "r2", name: "Photos", path: "~/Photos", write: false }] } };
    if (m.op === "fs.list") return { result: { entries: Object.keys(this.files).filter((k) => k.startsWith(`${a.root}/${a.path ? `${a.path}/` : ""}`)).map((k) => ({ name: k.split("/").slice(1).join("/"), dir: false, size: this.files[k].length, modifiedAt: 1 })), truncated: false } };
    if (m.op === "fs.read") {
      if (String(a.path).startsWith(".")) return { error: { code: "forbidden", message: "hidden" } };
      const f = this.files[`${a.root}/${a.path}`];
      return f === undefined ? { error: { code: "not_found", message: "no such file" } } : { result: { text: f, size: f.length, truncated: false } };
    }
    if (m.op === "fs.write") {
      if (a.root === "Photos") return { error: { code: "read_only", message: "read only" } };
      const key = `${a.root}/${a.path}`;
      const had = key in this.files;
      if (had && a.mode !== "replace") return { error: { code: "exists", message: "exists" } };
      this.files[key] = a.text;
      return { result: { written: a.text.length, previous: had ? "trashed" : null } };
    }
    if (m.op === "fs.trash") { delete this.files[`${a.root}/${a.path}`]; return { result: { trashed: true } }; }
    return { result: {} };
  }
  private onMessage(m: any) {
    this.msgs.push(m);
    if (m.type === "paired") { this.deviceId = m.deviceId; this.token = m.token; this.send({ type: "token.ack", deviceId: m.deviceId }); }
    if (m.type === "token.rotate") { this.token = m.token; this.send({ type: "token.ack", deviceId: this.deviceId }); }
    if (m.type === "welcome") this.send({ type: "event", name: "relay.state", ts: new Date().toISOString(), locked: false, session: null });
    if (m.type === "req") {
      this.reqs.push(m);
      const a = this.answer(m);
      this.send({ type: "res", id: m.id, ok: !a.error, ...(a.error ? { error: a.error } : { result: a.result ?? {} }) });
    }
  }
  waitFor(pred: (m: any) => boolean, label: string) { return until(() => this.msgs.find(pred), label); }
  close() { try { this.ws.terminate(); } catch { /* gone */ } }
}

let bot: Bot;
let relay: FileRelay;

test("setup: account, bot, and a computer linked with a relay that speaks protocol 1.1", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "zoe@example.com", name: "Zoé", password: "password123", locale: "fr" })).status, 200);
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  bot = (await call("PATCH", `/bots/${bot.id}`, { model: "script:script-1", autonomy: "trusted" })).json.bot;
  relay = await new FileRelay().open(null, [...BASE_CAPS, ...FS_CAPS]);
  const pc = await relay.waitFor((m) => m.type === "pair.code", "pair.code");
  assert.equal((await call("POST", "/relay/pairings", { code: pc.code })).status, 200);
  await relay.waitFor((m) => m.type === "welcome", "welcome");
  await until(async () => (await call("GET", "/relay/devices")).json.devices[0]?.capabilities.includes("fs.read"), "file capabilities seen");
});

test("files: list the shared folders and a folder, read a text file — reads are free but outside content", async () => {
  await say(bot, `call my_files {}`);
  await replied(bot, "Documents (read and write)");
  assert.match((await lastReply(bot))!.text, /Photos \(read only\)/);
  await say(bot, `call my_files {"folder":"Documents"}`);
  await replied(bot, "notes.txt");
  await say(bot, `lis mes notes : call my_file_read {"folder":"Documents","path":"notes.txt"}`);
  await replied(bot, "Liste de courses : pain, lait");
  assert.ok(relay.reqs.some((r) => r.op === "fs.read" && r.args.root === "Documents" && r.args.path === "notes.txt"));
  // The relay refuses hidden files; the bot is told not to insist.
  await say(bot, `call my_file_read {"folder":"Documents","path":".ssh/id_rsa"}`);
  await replied(bot, "not in a folder the user shared");
  await idle(bot);
});

test("files: every write and every trash needs its own approval (never \"Always\"); read-only folders and existing files are refused", async () => {
  const before = relay.reqs.filter((r) => r.op === "fs.write").length;
  await say(bot, `écris le résumé : call my_file_write {"folder":"Documents","path":"resume.txt","text":"Résumé de la semaine","user_quote":"écris le résumé"}`);
  const card = await pendingApproval(bot);
  assert.equal(card.once, true);
  assert.match(card.title, /écrire resume\.txt dans Documents sur portable-zoe/);
  assert.equal(relay.reqs.filter((r) => r.op === "fs.write").length, before, "nothing written before the answer");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "always" });
  await replied(bot, "Wrote Documents/resume.txt");
  assert.equal(relay.files["Documents/resume.txt"], "Résumé de la semaine");
  await idle(bot);
  // Asked again next time ("Always" is not kept for files).
  await say(bot, `remplace-le : call my_file_write {"folder":"Documents","path":"resume.txt","text":"v2","mode":"replace","user_quote":"remplace-le"}`);
  const again = await pendingApproval(bot);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "allow" });
  await replied(bot, "previous version is in the computer's trash");
  await idle(bot);
  await say(bot, `call my_file_write {"folder":"Photos","path":"x.txt","text":"x"}`);
  const ro = await pendingApproval(bot);
  await call("POST", `/approvals/${ro.approvalId}`, { decision: "allow" });
  await replied(bot, "shared that folder for reading only");
  await idle(bot);
  await say(bot, `call my_file_trash {"folder":"Documents","path":"resume.txt"}`);
  const tr = await pendingApproval(bot);
  assert.match(tr.title, /corbeille/);
  await call("POST", `/approvals/${tr.approvalId}`, { decision: "allow" });
  await replied(bot, "Moved Documents/resume.txt to the trash");
  assert.equal("Documents/resume.txt" in relay.files, false);
  await idle(bot);
});

test("nod 9: file access switched off from the chat; a file tool then asks on a card (never Always) that turns it back on; Refuse keeps it off", async () => {
  const dev = (await call("GET", "/relay/devices")).json.devices[0].id;
  const filesOn = async () => (await call("GET", `/relay/devices/${dev}/guard`)).json.filesOn;
  assert.equal(await filesOn(), true, "on by default (folders shared on the computer are already an opt-in)");
  await say(bot, `coupe l'accès à mes fichiers : call my_file_access {"on":false}`);
  await replied(bot, "is now off");
  assert.equal(await filesOn(), false);
  await idle(bot);
  const reads = relay.reqs.filter((r) => r.op === "fs.read").length;
  await say(bot, `lis mes notes : call my_file_read {"folder":"Documents","path":"notes.txt"}`);
  const card = await pendingApproval(bot);
  assert.equal(card.once, true, "never Always");
  assert.match(card.title, /accès à tes fichiers sur portable-zoe.* est coupé/i);
  assert.equal(relay.reqs.filter((r) => r.op === "fs.read").length, reads, "nothing read before the answer");
  await call("POST", `/approvals/${card.approvalId}`, { decision: "deny" });
  await idle(bot);
  assert.equal(await filesOn(), false, "Refuse keeps it off");
  assert.equal(relay.reqs.filter((r) => r.op === "fs.read").length, reads);
  await say(bot, `lis mes notes : call my_file_read {"folder":"Documents","path":"notes.txt"}`);
  const again = await pendingApproval(bot);
  await call("POST", `/approvals/${again.approvalId}`, { decision: "allow" });
  await replied(bot, "Liste de courses : pain, lait");
  assert.equal(await filesOn(), true, "Allow turns it back on and the same request continues");
  await idle(bot);
  // Settings → Computers: the same switch.
  const off = await call("PUT", `/relay/devices/${dev}/guard`, { filesOn: false });
  assert.equal(off.json.filesOn, false);
  assert.equal((await call("PUT", `/relay/devices/${dev}/guard`, { filesOn: "no" })).status, 400);
  await say(bot, `call my_file_write {"folder":"Documents","path":"n2.txt","text":"x","user_quote":"x"}`);
  const write = await pendingApproval(bot);
  assert.match(write.why ?? write.note ?? JSON.stringify(write), /rallume aussi/);
  await call("POST", `/approvals/${write.approvalId}`, { decision: "deny" });
  await idle(bot);
  assert.equal((await call("PUT", `/relay/devices/${dev}/guard`, { filesOn: true })).json.filesOn, true);
});

test("files: never from a routine (or any work the user did not start), and an old relay without files is told to update", async () => {
  const r = routines.create(bot.id, { name: "Lire mes notes", prompt: `call my_file_read {"folder":"Documents","path":"notes.txt"}`, trigger: "cron", schedule: "0 9 * * *", timezone: "UTC" });
  const reads = relay.reqs.filter((x) => x.op === "fs.read").length;
  fireRoutine(routines.byId(r.id)!);
  await replied(bot, "only be used in work the user started themselves");
  assert.equal(relay.reqs.filter((x) => x.op === "fs.read").length, reads, "nothing asked of the computer");
  await idle(bot);
  // The same computer reconnecting with a version-1.0 relay (no fs.* capabilities).
  const auth = { deviceId: relay.deviceId, token: relay.token };
  relay.close();
  const old = await new FileRelay().open(auth, BASE_CAPS);
  await old.waitFor((m) => m.type === "welcome", "welcome (old relay)");
  await say(bot, `call my_files {}`);
  await replied(bot, "too old for files");
  old.close();
});
