import assert from "node:assert/strict";
import { createHash, createPublicKey, verify } from "node:crypto";
import { mkdtempSync } from "node:fs";
import http from "node:http";
import net, { type AddressInfo } from "node:net";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { WebSocket } from "ws";

// L169 — the bot's exit: a proxy per bot (HTTP CONNECT and SOCKS5 fakes), the owner's home connection through the
// Relais (a fake relay that answers net.fetch with the Relais' own code) or Tailscale (a SOCKS5 fake standing for the
// tailscale container), Web Bot Auth signatures (a verifier written here from RFC 9421 and the draft), the browser's
// tunnel. Local fakes only; a fresh DATA_DIR before any server module is imported.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l169-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.ALLOW_PRIVATE_FETCH = "1";
process.env.PUBLIC_URL = "https://bots.example.test";
process.env.BOT_LINK = "socket";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["HOSTED_MODE", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "TAILSCALE_PROXY", "EGRESS_TEST_URL"]) delete process.env[k];

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { bots } = await import("../src/store.js");
const { relayUpgrade, closeAllRelays } = await import("../src/relay.js");
const { attachLiveScreens } = await import("../src/vnc.js");
const { botFetch, testEgress, tunnelSpec, _assumeLinuxComputers } = await import("../src/botroute.js");
const { registerWebBotAuthDirectory } = await import("../src/botrouteroutes.js");
const { handleComputerConnect, openTunnels } = await import("../src/botforward.js");
const { applyBrowserPolicy, setBrowserPolicyWriter } = await import("../src/netpolicy.js");
const { thumbprint } = await import("../src/webbotauth.js");
const { parseProxyAddress } = await import("../src/proxyconnect.js");
const { serve } = await import("@hono/node-server");
const { Hono } = await import("hono");
import type { Block, TurnRequest, TurnResult } from "../src/llm/types.js";
import type { Bot, Row } from "../src/shared.js";
const companion = createRequire(import.meta.url)("../../companion/src/main/capabilities/netexit.js");

// ── A scripted model: "call <tool> <json>" makes one tool call; then the tool's answer is the reply. ──
registerProvider({
  id: "l169", label: "Scripted", models: ["l169-1"], available: () => true,
  async runTurn(req: TurnRequest): Promise<TurnResult> {
    const usage = { inputTokens: 1, outputTokens: 1, cachedTokens: 0 };
    const last = req.messages[req.messages.length - 1];
    const results = last.content.filter((b) => b.type === "tool_result");
    const texts = last.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text);
    let content: Block[];
    if (results.length && !texts.length) {
      const r = results[0];
      content = [{ type: "text", text: `Tool said: ${r.type === "tool_result" ? r.content.map((c) => (c.type === "text" ? c.text : "")).join(" ") : ""}` }];
    } else {
      const m = /call (\w+) (\{[^\n]*\})/.exec(texts[texts.length - 1] ?? "");
      content = m ? [{ type: "tool_use", id: `c${Date.now()}`, name: m[1], input: JSON.parse(m[2]) }] : [{ type: "text", text: "ok" }];
    }
    return { content, stopReason: content.some((b) => b.type === "tool_use") ? "tool_use" : "end", model: "l169-1", usage };
  },
});

// ── The site the bots visit (a page, a redirect to a blocked site, a trace page that says the caller's address). ──
const seen: Array<{ url: string; headers: http.IncomingHttpHeaders }> = [];
const site = http.createServer((req, res) => {
  seen.push({ url: req.url ?? "", headers: req.headers });
  if (req.url === "/moved") { res.writeHead(302, { location: "http://blocked.example/" }); return res.end(); }
  if (req.url === "/hop") { res.writeHead(302, { location: "/page" }); return res.end(); }
  if (req.url === "/cdn-cgi/trace") { res.setHeader("content-type", "text/plain"); return res.end("fl=1\nip=203.0.113.77\nts=1\n"); }
  res.setHeader("content-type", "text/html"); res.end("<h1>Bonjour du site</h1>");
});
// ── An HTTP proxy (CONNECT only, Basic login « alice / s3cret »). ──
const connects: string[] = [];
const sitePortRef = { port: 0 };
const httpProxy = http.createServer((_req, res) => res.writeHead(405).end());
httpProxy.on("connect", (req, sock: net.Socket, head) => {
  connects.push(req.url ?? "");
  if (req.headers["proxy-authorization"] !== `Basic ${Buffer.from("alice:s3cret").toString("base64")}`) return sock.end("HTTP/1.1 407 Proxy Authentication Required\r\n\r\n");
  const [h, p] = (req.url ?? "").split(":");
  // site.example:80 is the fake site (the browser's tunnel only opens ports 80 and 443).
  const up = net.connect(h === "site.example" && p === "80" ? sitePortRef.port : Number(p), h === "site.example" ? "127.0.0.1" : h, () => { sock.write("HTTP/1.1 200 OK\r\n\r\n"); up.write(head); up.pipe(sock); sock.pipe(up); });
  up.on("error", () => sock.destroy()); sock.on("error", () => up.destroy());
});
// ── A SOCKS5 proxy (RFC 1928 / 1929, login « bob / pw »); also plays the tailscale container's SOCKS5 server. ──
const socksTargets: string[] = [];
const socks = net.createServer((c) => {
  let stage = 0; let buf = Buffer.alloc(0);
  c.on("error", () => {});
  c.on("data", function onData(d) {
    buf = Buffer.concat([buf, d]);
    if (stage === 0 && buf.length >= 2 + buf[1]) { const methods = [...buf.subarray(2, 2 + buf[1])]; buf = buf.subarray(2 + buf[1]); stage = 1; c.write(Buffer.from([5, methods.includes(2) ? 2 : 0xff])); if (!methods.includes(2)) c.end(); }
    if (stage === 1 && buf.length >= 2 && buf.length >= 3 + buf[1] && buf.length >= 3 + buf[1] + buf[2 + buf[1]]) {
      const u = buf.subarray(2, 2 + buf[1]).toString(); const pl = buf[2 + buf[1]]; const pw = buf.subarray(3 + buf[1], 3 + buf[1] + pl).toString();
      buf = buf.subarray(3 + buf[1] + pl); stage = 2; c.write(Buffer.from([1, u === "bob" && pw === "pw" ? 0 : 1]));
    }
    if (stage === 2 && buf.length >= 5 && buf[3] === 3 && buf.length >= 7 + buf[4]) {
      const host = buf.subarray(5, 5 + buf[4]).toString(); const port = buf.readUInt16BE(5 + buf[4]); buf = buf.subarray(7 + buf[4]); stage = 3;
      socksTargets.push(`${host}:${port}`);
      c.off("data", onData);
      const up = net.connect(port, host === "site.example" ? "127.0.0.1" : host, () => { c.write(Buffer.from([5, 0, 0, 1, 0, 0, 0, 0, 0, 0])); up.pipe(c); c.pipe(up); if (buf.length) up.write(buf); });
      up.on("error", () => c.destroy());
    }
  });
});
const listen = (s: net.Server) => new Promise<number>((r) => s.listen(0, "127.0.0.1", () => r((s.address() as AddressInfo).port)));
const sitePort = await listen(site), httpProxyPort = await listen(httpProxy), socksPort = await listen(socks);
sitePortRef.port = sitePort;
const SITE = `http://site.example:${sitePort}`;
/** The same site reached directly (no proxy resolves site.example then). */
const SITE_DIRECT = `http://127.0.0.1:${sitePort}`;
// site.example is the fake site on 127.0.0.1: the proxies resolve it (as real proxies do); this server never needs to.
const dns = await import("node:dns");
const lookup = dns.promises.lookup;
(dns.promises as any).lookup = (host: string, o: any) => (host === "site.example" ? Promise.resolve(o?.all ? [{ address: "127.0.0.1", family: 4 }] : { address: "127.0.0.1", family: 4 }) : lookup(host, o));

// ── The server (for the relay's WebSocket) ──
const app = new Hono();
app.route("/api", api);
registerWebBotAuthDirectory(app);
const server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }) as unknown as http.Server;
await new Promise<void>((r) => (server.listening ? r() : server.once("listening", () => r())));
attachLiveScreens(server, [relayUpgrade]);
const WS = `ws://127.0.0.1:${(server.address() as AddressInfo).port}/api/relay/connect`;
after(() => { closeAllRelays(); server.closeAllConnections?.(); server.close(); site.close(); httpProxy.close(); socks.close(); });

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
const lastText = async (b: Bot) => ([...(await rowsOf(b.id))].reverse().find((x) => x.body.kind === "message" && x.body.role === "assistant" && !x.body.streaming)?.body as { text: string } | undefined)?.text;
const replied = (b: Bot, part: RegExp) => until(async () => { const t = await lastText(b); return t && part.test(t) && t; }, `reply ${part}`, 15_000).catch(async (e) => { throw new Error(`${e.message}; last reply: ${await lastText(b)}; rows: ${JSON.stringify((await rowsOf(b.id)).slice(-3).map((r) => r.body)).slice(0, 1500)}`); });
const idle = (b: Bot) => until(async () => { const r = await call("GET", "/bots"); return !r.json.live?.[b.id]?.running && !r.json.live?.[b.id]?.awaiting; }, "bot idle");

// ── The verifier: what a site does with a signed request (RFC 9421 §3.2, draft-ietf-webbotauth-httpsig-protocol-01 §5). ──
function parseDict(v: string): Record<string, string> { const out: Record<string, string> = {}; for (const m of v.matchAll(/([a-z0-9_*-]+)=("(?:[^"\\]|\\.)*"|:[^:]*:|\([^)]*\)[^,]*)/g)) out[m[1]] = m[2]; return out; }
async function verifySigned(h: http.IncomingHttpHeaders, now = Math.floor(Date.now() / 1000)) {
  const agentDict = parseDict(String(h["signature-agent"]));
  const input = parseDict(String(h["signature-input"]))["sig1"];
  const sig = parseDict(String(h.signature))["sig1"];
  assert.ok(input && sig && agentDict.sig1, `the three headers carry the same label: ${JSON.stringify(h)}`);
  const comps = /^\(([^)]*)\)/.exec(input)![1];
  assert.equal(comps, `"@authority" "signature-agent";key="sig1"`);
  const p = Object.fromEntries([...input.slice(input.indexOf(")") + 1).matchAll(/;([a-z]+)=("[^"]*"|\d+)/g)].map((m) => [m[1], m[2].replace(/^"|"$/g, "")]));
  assert.equal(p.tag, "web-bot-auth");
  assert.ok(Number(p.created) <= now + 5 && Number(p.expires) > now && Number(p.expires) - Number(p.created) <= 86400, "valid now, at most 24 h");
  // The directory, fetched where Signature-Agent points (here: the test app, same path).
  const dirUrl = new URL(JSON.parse(agentDict.sig1));
  assert.equal(dirUrl.protocol, "https:");
  const dir = await app.request(dirUrl.pathname);
  assert.equal(dir.headers.get("content-type"), "application/http-message-signatures-directory+json");
  const jwk = (await dir.json()).keys.find((k: any) => thumbprint(k.x) === p.keyid);
  assert.ok(jwk, "keyid is the JWK thumbprint of a key in the directory");
  const base = `"@authority": ${String(h.host).toLowerCase()}\n"signature-agent";key="sig1": ${agentDict.sig1}\n"@signature-params": ${input}`;
  return verify(null, Buffer.from(base), createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" }), Buffer.from(sig.slice(1, -1), "base64"));
}

// ── A relay that answers net.fetch with the Relais' own code (companion/src/main/capabilities/netexit.js). ──
class HomeRelay {
  ws!: WebSocket; msgs: any[] = []; reqs: any[] = [];
  exit = companion.createNetExit({ allowPrivate: true, lookup: (h: string, o: any, cb: any) => (h === "site.example" ? cb(null, [{ address: "127.0.0.1", family: 4 }]) : require("node:dns").lookup(h, o, cb)) });
  async open(caps: string[]) {
    this.ws = new WebSocket(WS);
    this.ws.on("message", (d) => void this.onMessage(JSON.parse(String(d))));
    this.ws.on("error", () => {});
    await new Promise<void>((resolve, reject) => { this.ws.once("open", () => resolve()); this.ws.once("error", reject); });
    this.send({ type: "hello", v: 1, protocol: "1.8", auth: null, app: { name: "sklubot-relais", version: "1.0.2" }, device: { name: "pc-maison", platform: "linux", arch: "x64", osRelease: "6.1", locale: "fr-FR" }, capabilities: caps, screen: { width: 1280, height: 800, scaleFactor: 1 }, limits: { maxInboundBytes: 262144, maxViewFps: 5 }, state: { locked: false } });
    return this;
  }
  send(m: unknown) { this.ws.send(JSON.stringify(m)); }
  private async onMessage(m: any) {
    this.msgs.push(m);
    if (m.type === "paired") this.send({ type: "token.ack", deviceId: m.deviceId });
    if (m.type === "welcome") this.send({ type: "event", name: "relay.state", ts: new Date().toISOString(), locked: false, session: null });
    if (m.type === "req") {
      this.reqs.push(m);
      if (m.op !== "net.fetch") return this.send({ type: "res", id: m.id, ok: true, result: {} });
      try { this.send({ type: "res", id: m.id, ok: true, result: await this.exit.netFetch(companion.validateNetArgs(m.args)) }); }
      catch (e: any) { this.send({ type: "res", id: m.id, ok: false, error: { code: e.code ?? "internal", message: e.message } }); }
    }
  }
  waitFor(pred: (m: any) => boolean, label: string) { return until(() => this.msgs.find(pred), label); }
  close() { try { this.ws.terminate(); } catch { /* gone */ } }
}
const require = createRequire(import.meta.url);

let bot: Bot;
let record: ReturnType<typeof bots.byId> & {};

test("setup: an owner (French) and a bot on the scripted model", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "lea@example.com", name: "Léa", password: "password123", locale: "fr" })).status, 200);
  bot = (await call("GET", "/bots")).json.bots.find((b: Bot) => b.primary);
  bot = (await call("PATCH", `/bots/${bot.id}`, { model: "l169:l169-1", autonomy: "trusted" })).json.bot;
  record = bots.byId(bot.id)!;
  const g = await call("GET", `/bots/${bot.id}/egress`);
  assert.equal(g.json.egress.route, "direct", "direct by default");
  assert.equal(g.json.egress.sign, false, "Web Bot Auth off by default");
  assert.equal(g.json.egress.canSign, true);
});

test("proxy addresses: http, https, socks5 (socks5h too), host:port; nothing else", () => {
  assert.deepEqual(parseProxyAddress("socks5h://u:p%40ss@proxy.example:1081"), { scheme: "socks5", host: "proxy.example", port: 1081, username: "u", password: "p@ss" });
  assert.deepEqual(parseProxyAddress("proxy.example:3128"), { scheme: "http", host: "proxy.example", port: 3128 });
  assert.equal(parseProxyAddress("https://proxy.example")?.port, 443);
  for (const bad of ["ftp://x:1", "http://x:99999", "http://x/path", "", "a b"]) assert.equal(parseProxyAddress(bad), null, bad);
});

test("HTTP proxy: the login is sealed and never comes back; web_fetch goes through it; a wrong password is a clear error", async () => {
  const put = await call("PUT", `/bots/${bot.id}/egress`, { route: "proxy", proxy: `http://alice:s3cret@127.0.0.1:${httpProxyPort}` });
  assert.equal(put.status, 200, put.text);
  assert.deepEqual(put.json.egress.proxy, { address: `http://127.0.0.1:${httpProxyPort}`, hasLogin: true });
  assert.doesNotMatch(put.text, /s3cret|alice/, "neither the password nor the user name is sent back");
  const row = q.get<{ proxy_user: string; proxy_pass: string }>("SELECT proxy_user, proxy_pass FROM bot_egress WHERE bot_id = ?", bot.id)!;
  assert.ok(!row.proxy_pass.includes("s3cret") && !row.proxy_user.includes("alice"), "sealed in the database");
  assert.equal(tunnelSpec(bot.id)?.password, "s3cret");

  const before = connects.length;
  await call("POST", `/bots/${bot.id}/messages`, { text: `call web_fetch {"url":"${SITE}/page"}` });
  await replied(bot, /Bonjour du site/);
  await idle(bot);
  assert.equal(connects.length, before + 1);
  assert.equal(connects.at(-1), `site.example:${sitePort}`, "the proxy opened the site (and resolved its name)");

  process.env.EGRESS_TEST_URL = `${SITE}/cdn-cgi/trace`;
  const ok = await call("POST", `/bots/${bot.id}/egress/test`);
  assert.equal(ok.json.test.ok, true, ok.text);
  assert.equal(ok.json.test.ip, "203.0.113.77", "« Tester » says the address sites see");

  await call("PUT", `/bots/${bot.id}/egress`, { username: "alice", password: "wrong" });
  const bad = await call("POST", `/bots/${bot.id}/egress/test`);
  assert.equal(bad.json.test.ok, false);
  assert.equal(bad.json.test.error, "Le proxy refuse le nom d'utilisateur ou le mot de passe.");
  await call("PUT", `/bots/${bot.id}/egress`, { username: "alice", password: "s3cret" });
});

test("the network policy still applies on top: refused before the proxy is touched, and on every redirect", async () => {
  await call("PUT", "/network/blocked-sites", { hosts: "blocked.example" });
  const before = connects.length;
  await assert.rejects(botFetch(record, `${SITE}/moved`), /blocked\.example/);
  assert.equal(connects.length, before + 1, "only the first hop went out; the redirect to the blocked site did not");
  await call("PUT", `/bots/${bot.id}/network`, { mode: "none" });
  await call("POST", `/bots/${bot.id}/messages`, { text: `call web_fetch {"url":"${SITE}/page"}` });
  await replied(bot, /n'a pas accès à Internet|no internet access/);
  await idle(bot);
  assert.equal(connects.length, before + 1, "nothing reached the proxy");
  await call("PUT", `/bots/${bot.id}/network`, { mode: "all" });
});

test("SOCKS5 proxy with a login; a proxy on a private network is refused without ALLOW_PRIVATE_FETCH; errors in plain words", async () => {
  const put = await call("PUT", `/bots/${bot.id}/egress`, { route: "proxy", proxy: `socks5://127.0.0.1:${socksPort}`, username: "bob", password: "pw" });
  assert.equal(put.json.egress.proxy.address, `socks5://127.0.0.1:${socksPort}`);
  const res = await botFetch(record, `${SITE}/hop`);
  assert.match(await res.text(), /Bonjour du site/);
  assert.deepEqual(socksTargets.slice(-2), [`site.example:${sitePort}`, `site.example:${sitePort}`], "the redirect hop also went through the proxy");
  delete process.env.ALLOW_PRIVATE_FETCH;
  const priv = await call("PUT", `/bots/${bot.id}/egress`, { proxy: "socks5://10.1.2.3:1080" });
  assert.equal(priv.status, 400);
  assert.match(priv.json.error, /réseau privé ou local/);
  process.env.ALLOW_PRIVATE_FETCH = "1";
  const dead = await call("PUT", `/bots/${bot.id}/egress`, { proxy: "socks5://127.0.0.1:1" });
  assert.equal(dead.status, 200);
  assert.match((await call("POST", `/bots/${bot.id}/egress/test`)).json.test.error, /injoignable/);
  assert.equal((await call("PUT", `/bots/${bot.id}/egress`, { route: "proxy", proxy: "pas une adresse" })).status, 400);
  const cleared = await call("DELETE", `/bots/${bot.id}/egress/proxy`);
  assert.equal(cleared.json.egress.route, "direct");
  assert.equal(cleared.json.egress.proxy, null);
});

test("Web Bot Auth: off by default; when on, every hop is signed and a verifier accepts it; the directory is served and signed", async () => {
  // RFC 8037 Appendix A.3: the thumbprint of the example Ed25519 key.
  assert.equal(thumbprint("11qYAYKxCrfVS_7TyWQHOg7hcvPapiMlrwIaaPcHURo"), "kPrK_qmxVWaYVA9wwBF6Iuo3vVzz7TxHCTwXBygrS4k");
  seen.length = 0;
  await (await botFetch(record, `${SITE_DIRECT}/page`)).text();
  assert.equal(seen[0].headers.signature, undefined, "not signed while off");
  const on = await call("PUT", `/bots/${bot.id}/egress`, { sign: true });
  assert.equal(on.json.egress.sign, true);
  assert.ok(on.json.egress.keyId);
  seen.length = 0;
  await (await botFetch(record, `${SITE_DIRECT}/hop`)).text();
  assert.equal(seen.length, 2);
  for (const s of seen) assert.equal(await verifySigned(s.headers), true, `hop ${s.url} verifies`);
  assert.notEqual(seen[0].headers.signature, seen[1].headers.signature, "each hop has its own signature (fresh nonce)");
  // A tampered authority fails.
  assert.equal(await verifySigned({ ...seen[0].headers, host: "other.example" }), false);
  // The directory response: content digest and its own signature (Appendix B.1).
  const dir = await app.request("/.well-known/http-message-signatures-directory");
  const body = await dir.text();
  assert.equal(dir.headers.get("content-digest"), `sha-256=:${createHash("sha256").update(body).digest("base64")}:`);
  const input = dir.headers.get("signature-input")!.replace(/^sig1=/, "");
  assert.match(input, /^\("@authority";req "content-digest"\);created=\d+;expires=\d+;keyid="[A-Za-z0-9_-]{43}";alg="ed25519";tag="http-message-signatures-directory"$/);
  const jwk = JSON.parse(body).keys[0];
  const base = `"@authority";req: bots.example.test\n"content-digest": ${dir.headers.get("content-digest")}\n"@signature-params": ${input}`;
  assert.equal(verify(null, Buffer.from(base), createPublicKey({ key: { kty: "OKP", crv: "Ed25519", x: jwk.x }, format: "jwk" }), Buffer.from(dir.headers.get("signature")!.slice(6, -1), "base64")), true);
  assert.equal(jwk.d, undefined, "never the private key");
});

test("home exit through the Relais: asked by net.fetch, network policy on top, not signed unless the owner opts in; offline is clear", async () => {
  const relay = await new HomeRelay().open(["session.start", "session.end", "screen.info", "net.fetch"]);
  const pc = await relay.waitFor((m) => m.type === "pair.code", "pair.code");
  assert.equal((await call("POST", "/relay/pairings", { code: pc.code })).status, 200);
  await relay.waitFor((m) => m.type === "welcome", "welcome");
  const g = await until(async () => { const r = await call("GET", `/bots/${bot.id}/egress`); return r.json.egress.devices[0]?.capable && r.json.egress; }, "net.fetch seen");
  const put = await call("PUT", `/bots/${bot.id}/egress`, { route: "relay", deviceId: g.devices[0].id });
  assert.equal(put.json.egress.route, "relay");
  assert.equal(put.json.egress.browser, "relay", "the browser is not covered by the Relais exit (said in the settings)");
  seen.length = 0;
  await call("POST", `/bots/${bot.id}/messages`, { text: `call web_fetch {"url":"${SITE}/hop"}` });
  await replied(bot, /Bonjour du site/);
  await idle(bot);
  const asked = relay.reqs.filter((r) => r.op === "net.fetch");
  assert.ok(asked.length >= 2, "both hops went through the computer");
  assert.equal(asked[0].bot.id, bot.id);
  assert.ok(seen.every((s) => s.headers.signature === undefined), "Web Bot Auth is on, but never through the home exit without the opt-in");
  await call("PUT", `/bots/${bot.id}/egress`, { signHome: true });
  seen.length = 0;
  await (await botFetch(record, `${SITE}/page`)).text();
  assert.equal(await verifySigned(seen[0].headers), true, "signed after the opt-in");
  // Policy on a redirect, through the Relais too.
  await assert.rejects(botFetch(record, `${SITE}/moved`), /blocked\.example/);
  // The computer goes away.
  relay.close();
  await until(async () => !(await call("GET", `/bots/${bot.id}/egress`)).json.egress.devices[0]?.online, "relay offline");
  const t = await call("POST", `/bots/${bot.id}/egress/test`);
  assert.equal(t.json.test.error, "Le Relais de ton ordinateur n'est pas connecté : ouvre Sklubot dessus (l'ordinateur doit rester allumé).");
});

test("home exit through Tailscale: only when the operator set TAILSCALE_PROXY; goes through its SOCKS5 server; not signed without the opt-in", async () => {
  await call("PUT", `/bots/${bot.id}/egress`, { signHome: false });
  const no = await call("PUT", `/bots/${bot.id}/egress`, { route: "tailscale" });
  assert.equal(no.status, 409);
  assert.match(no.json.error, /TAILSCALE_PROXY/);
  process.env.TAILSCALE_PROXY = `socks5://bob:pw@127.0.0.1:${socksPort}`;
  const yes = await call("PUT", `/bots/${bot.id}/egress`, { route: "tailscale" });
  assert.equal(yes.status, 200);
  assert.equal(yes.json.egress.tailscale, true);
  seen.length = 0;
  const n = socksTargets.length;
  await (await botFetch(record, `${SITE}/page`)).text();
  assert.equal(socksTargets.length, n + 1);
  assert.equal(seen[0].headers.signature, undefined);
  // The exit goes away (the operator removed TAILSCALE_PROXY): the bot never falls back to direct on its own.
  delete process.env.TAILSCALE_PROXY;
  const n2 = seen.length;
  await assert.rejects(botFetch(record, `${SITE}/page`), /not available/);
  assert.match((await call("POST", `/bots/${bot.id}/egress/test`)).json.test.error, /n'est plus disponible/);
  assert.equal(seen.length, n2, "nothing was sent directly");
  process.env.TAILSCALE_PROXY = `socks5://bob:pw@127.0.0.1:${socksPort}`;
  process.env.HOSTED_MODE = "1";
  assert.equal((await call("PUT", `/bots/${bot.id}/egress`, { route: "tailscale" })).status, 409, "never on a shared server");
  delete process.env.HOSTED_MODE;
});

test("the bot's browser: Chromium policy points at the computer's socket; the tunnel checks the policy and goes through the proxy", async () => {
  await call("PUT", `/bots/${bot.id}/egress`, { route: "proxy", proxy: `http://alice:s3cret@127.0.0.1:${httpProxyPort}`, sign: false });
  let written = "";
  setBrowserPolicyWriter(async (_b, content) => { written = content; });
  _assumeLinuxComputers(true);
  await applyBrowserPolicy(record, true);
  const pol = JSON.parse(written);
  assert.deepEqual(pol.ProxySettings, { ProxyMode: "fixed_servers", ProxyServer: "127.0.0.1:39100" });
  assert.equal(pol.HttpsOnlyMode, "force_enabled");
  assert.deepEqual(pol.URLBlocklist, ["blocked.example"], "the URL lists are kept");
  assert.doesNotMatch(written, /s3cret|alice/, "the login never goes to the computer");

  // A stand-in for the computer's socket server: CONNECT handled by botforward.ts.
  const sock = http.createServer();
  sock.on("connect", (req, s, head) => void handleComputerConnect(bot.id, req, s, head));
  const port = await listen(sock);
  const connectVia = (target: string) => new Promise<{ status: number; socket: net.Socket }>((resolve) => {
    const c = net.connect(port, "127.0.0.1", () => c.write(`CONNECT ${target} HTTP/1.1\r\nHost: ${target}\r\n\r\n`));
    c.once("data", (d) => { resolve({ status: Number(/HTTP\/1\.1 (\d+)/.exec(d.toString())?.[1]), socket: c }); });
  });
  const blocked = await connectVia("blocked.example:443");
  assert.equal(blocked.status, 403, "the owner's blocked site is refused at the tunnel");
  blocked.socket.destroy();
  assert.equal((await connectVia("site.example:22")).status, 403, "ports 443 and 80 only");
  const before = connects.length;
  const okc = await connectVia("site.example:80");
  assert.equal(okc.status, 200);
  assert.equal(connects.length, before + 1, "the tunnel went through the bot's proxy");
  okc.socket.write("GET /page HTTP/1.1\r\nHost: site.example\r\nConnection: close\r\n\r\n");
  const page = await new Promise<string>((r) => { let t = ""; okc.socket.on("data", (d) => (t += d)); okc.socket.on("close", () => r(t)); });
  assert.match(page, /Bonjour du site/);
  await until(() => openTunnels(bot.id) === 0, "tunnel released");

  await call("PUT", `/bots/${bot.id}/egress`, { route: "direct" });
  await applyBrowserPolicy(record, true);
  assert.equal(JSON.parse(written).ProxySettings, undefined, "back to direct: no proxy in the policy");
  assert.equal((await connectVia("site.example:443")).status, 403);
  _assumeLinuxComputers(false);
  sock.close();
});

test("another account's bot answers 404 on every exit route", async () => {
  const mine = cookie;
  cookie = "";
  assert.equal((await call("POST", "/auth/signup", { email: "max@example.com", name: "Max", password: "password123", locale: "en" })).status, 200);
  for (const [m, u] of [["GET", "egress"], ["PUT", "egress"], ["DELETE", "egress/proxy"], ["POST", "egress/test"]] as const) {
    assert.equal((await call(m, `/bots/${bot.id}/${u}`, m === "PUT" ? { route: "direct" } : undefined)).status, 404, `${m} ${u}`);
  }
  cookie = mine;
});
