import assert from "node:assert/strict";
import { createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

/**
 * L177 — iPhone Live Activity, server side (liveactivity.ts): off by default, the APNs provider token (ES256 JWT), the
 * ActivityKit payload and headers, the pace of pushes, the routes (account isolation) and dead tokens. Fake APNs only:
 * nothing here talks to Apple. Local data in a temporary folder.
 */
const dir = mkdtempSync(path.join(tmpdir(), "sklubot-liveactivity-"));
process.env.DATA_DIR = dir;
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "http://127.0.0.1";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";

const { api } = await import("../src/routes.js");
const la = await import("../src/liveactivity.js");
const { taskActivityState, parseStopUrl, stopUrl } = await import("../src/clientshared/taskactivity.js");
const { setLive, clearLive } = await import("../src/bus.js");
const { bots } = await import("../src/store.js");

const { privateKey, publicKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
const keyFile = path.join(dir, "AuthKey_TEST.p8");
writeFileSync(keyFile, privateKey.export({ type: "pkcs8", format: "pem" }) as string);
const ON = { LIVE_ACTIVITY_PUSH: "1", APNS_KEY_FILE: keyFile, APNS_KEY_ID: "ABC123DEFG", APNS_TEAM_ID: "DEF123GHIJ", APNS_BUNDLE_ID: "fr.sklubot.app" };
const setOn = (on: boolean) => { for (const [k, v] of Object.entries(ON)) { if (on) process.env[k] = v; else delete process.env[k]; } };

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}
const sentReqs: { host: string; path: string; headers: Record<string, string>; body: any }[] = [];
let answer = { status: 200 } as { status: number; reason?: string };
la.setApnsTransport(async (r) => { sentReqs.push({ ...r, body: JSON.parse(r.body) }); return answer; });
after(() => { la.setApnsTransport(null); la.resetLiveActivityState(); setOn(false); });
const tick = () => new Promise((r) => setTimeout(r, 20));
const TOKEN = "a1".repeat(32), TOKEN2 = "b2".repeat(32);

test("off by default: no settings means disabled, and every half-set case stays off", () => {
  setOn(false);
  assert.deepEqual(la.liveActivitySettings(), { enabled: false, reason: "off" });
  assert.equal(la.liveActivitySettings({ LIVE_ACTIVITY_PUSH: "1" }).enabled, false);
  assert.equal(la.liveActivitySettings({ ...ON, APNS_KEY_ID: "short" }).enabled, false);
  assert.equal(la.liveActivitySettings({ ...ON, APNS_KEY_FILE: path.join(dir, "missing.p8") }).enabled, false);
  const s = la.liveActivitySettings(ON);
  assert.equal(s.enabled, true);
  assert.equal(s.enabled && s.sandbox, false);
});

test("provider token: ES256 JWT with kid, iss and iat, verifiable with the key", () => {
  const jwt = la.apnsJwt(privateKey.export({ type: "pkcs8", format: "pem" }) as string, "ABC123DEFG", "DEF123GHIJ", 1437179036);
  const [h, c, s] = jwt.split(".");
  assert.deepEqual(JSON.parse(Buffer.from(h, "base64url").toString()), { alg: "ES256", kid: "ABC123DEFG" });
  assert.deepEqual(JSON.parse(Buffer.from(c, "base64url").toString()), { iss: "DEF123GHIJ", iat: 1437179036 });
  assert.equal(Buffer.from(s, "base64url").length, 64); // raw r||s, as JOSE wants
  assert.ok(verify("sha256", Buffer.from(`${h}.${c}`), { key: createPublicKey(publicKey.export({ type: "spki", format: "pem" })), dsaEncoding: "ieee-p1363" }, Buffer.from(s, "base64url")));
  assert.ok(la.JWT_LIFETIME_MS >= 20 * 60_000 && la.JWT_LIFETIME_MS < 60 * 60_000);
});

test("payload and headers follow Apple's ActivityKit push format", () => {
  const state = { step: "Lit la page", steps: 3, startedAt: 1_700_000_000, awaiting: false };
  assert.deepEqual(la.activityPayload("update", state, 1_700_000_100_000), { aps: { timestamp: 1_700_000_100, event: "update", "content-state": state } });
  const end = la.activityPayload("end", state, 1_700_000_100_000).aps;
  assert.equal(end.event, "end");
  assert.equal(end["dismissal-date"], 1_700_000_100 + la.DISMISS_AFTER_S);
  const h = la.apnsHeaders({ bundleId: "fr.sklubot.app" }, 5, "jwt");
  assert.equal(h["apns-push-type"], "liveactivity");
  assert.equal(h["apns-topic"], "fr.sklubot.app.push-type.liveactivity");
  assert.equal(h["apns-priority"], "5");
  assert.equal(h.authorization, "bearer jwt");
});

test("state of a task: main chat, a lane, waiting, ended; stop link round trip", () => {
  const base = { running: true, activity: { kind: "reading", detail: "  Lit\n la page  ", since: 1_000_000 }, awaiting: null, startedAt: 900_000, steps: 4 };
  assert.deepEqual(taskActivityState(base, 0), { step: "Lit la page", steps: 4, startedAt: 900, awaiting: false });
  assert.equal(taskActivityState(base, 2), null);
  assert.equal(taskActivityState({ ...base, running: false }, 0), null);
  assert.equal(taskActivityState({ ...base, running: false, awaiting: { reason: "Accord pour envoyer", since: 1 } }, 0)?.awaiting, true);
  const lanes = { ...base, tasks: [{ thread: 0, running: true, activity: null, awaiting: null, startedAt: 1000 }, { thread: 7, running: true, activity: { kind: "browsing", since: 5000 }, awaiting: null, startedAt: 4000 }] };
  assert.deepEqual(taskActivityState(lanes, 7, (k) => `[${k}]`), { step: "[browsing]", steps: 0, startedAt: 4, awaiting: false });
  assert.equal(taskActivityState({ ...base, activity: { kind: "x", detail: "é".repeat(200), since: 1 } }, 0)!.step.length, 80);
  assert.deepEqual(parseStopUrl(stopUrl("bot_abc123", 7)), { botId: "bot_abc123", thread: 7 });
  assert.deepEqual(parseStopUrl("sklubot://stop/bot_x"), { botId: "bot_x", thread: 0 });
  assert.equal(parseStopUrl("sklubot://stop/../etc?thread=1"), null);
  assert.equal(parseStopUrl("https://evil.example/stop/bot_x"), null);
});

test("pace: first state and waiting changes at once (10), ordinary updates at most every 15 s (5), end", () => {
  const s = { step: "a", steps: 1, startedAt: 1, awaiting: false };
  assert.deepEqual(la.decide(undefined, s, 0), { kind: "update", priority: 10 });
  assert.deepEqual(la.decide({ state: s, at: 0 }, s, 1000), { kind: "none" });
  assert.deepEqual(la.decide({ state: s, at: 0 }, { ...s, step: "b" }, 1000), { kind: "wait", ms: la.MIN_GAP_MS - 1000 });
  assert.deepEqual(la.decide({ state: s, at: 0 }, { ...s, step: "b" }, la.MIN_GAP_MS), { kind: "update", priority: 5 });
  assert.deepEqual(la.decide({ state: s, at: 0 }, { ...s, awaiting: true }, 10), { kind: "update", priority: 10 });
  assert.deepEqual(la.decide({ state: s, at: 0 }, null, 10), { kind: "end" });
});

let botId = "", userId = "";
test("routes: refused while off, then a token follows the bot's live state to the end", async () => {
  setOn(false);
  assert.equal((await call("POST", "/auth/signup", { email: "ana@example.com", name: "Ana", password: "password123", locale: "fr" })).status, 200);
  botId = (await call("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
  userId = bots.byId(botId)!.userId;
  assert.deepEqual((await call("GET", "/live-activity")).json, { enabled: false });
  assert.equal((await call("POST", `/bots/${botId}/live-activity`, { token: TOKEN })).status, 409);
  setOn(true);
  assert.deepEqual((await call("GET", "/live-activity")).json, { enabled: true });
  assert.equal((await call("POST", `/bots/${botId}/live-activity`, { token: "not-hex" })).status, 400);
  assert.equal((await call("POST", `/bots/${botId}/live-activity`, { token: TOKEN, thread: 0 })).status, 200);
  setLive(userId, botId, { running: true, startedAt: Date.now(), activity: { kind: "reading", detail: "Lit la page", since: Date.now() }, steps: 1 });
  await tick();
  assert.equal(sentReqs.length, 1);
  const first = sentReqs[0];
  assert.equal(first.host, "api.push.apple.com");
  assert.equal(first.path, `/3/device/${TOKEN}`);
  assert.equal(first.headers["apns-priority"], "10");
  assert.equal(first.body.aps.event, "update");
  assert.equal(first.body.aps["content-state"].step, "Lit la page");
  // A new step within 15 s is held back, not lost.
  setLive(userId, botId, { activity: { kind: "browsing", detail: "Ouvre le site", since: Date.now() }, steps: 2 });
  await tick();
  assert.equal(sentReqs.length, 1);
  clearLive(userId, botId);
  await tick();
  assert.equal(sentReqs.length, 2);
  assert.equal(sentReqs[1].body.aps.event, "end");
  assert.equal(sentReqs[1].headers["apns-priority"], "10");
  // Ended: the token is gone, later states send nothing.
  setLive(userId, botId, { running: true, startedAt: Date.now() });
  await tick();
  assert.equal(sentReqs.length, 2);
  clearLive(userId, botId);
});

test("isolation: another account can neither use a bot nor remove a token that is not its own", async () => {
  assert.equal((await call("POST", `/bots/${botId}/live-activity`, { token: TOKEN2 })).status, 200);
  const mine = cookie; cookie = "";
  assert.equal((await call("POST", "/auth/signup", { email: "ben@example.com", name: "Ben", password: "password123", locale: "fr" })).status, 200);
  assert.equal((await call("POST", `/bots/${botId}/live-activity`, { token: "c3".repeat(32) })).status, 404);
  const benBot = (await call("GET", "/bots")).json.bots.find((b: any) => b.primary).id;
  assert.equal((await call("POST", `/bots/${benBot}/live-activity`, { token: TOKEN2 })).status, 409);
  assert.equal((await call("DELETE", `/live-activity/${TOKEN2}`)).status, 404);
  cookie = mine;
  sentReqs.length = 0;
  setLive(userId, botId, { running: true, startedAt: Date.now(), activity: { kind: "thinking", since: Date.now() } });
  await tick();
  assert.equal(sentReqs.length, 1, "Ana's token still works after Ben's delete");
});

test("a dead token (410) is dropped and never retried", async () => {
  answer = { status: 410, reason: "Unregistered" };
  setLive(userId, botId, { awaiting: { reason: "Accord", since: Date.now() } });
  await tick();
  assert.equal(sentReqs.length, 2);
  answer = { status: 200 };
  setLive(userId, botId, { awaiting: null });
  await tick();
  assert.equal(sentReqs.length, 2);
  assert.ok(la.deadToken(400, "BadDeviceToken"));
  assert.ok(!la.deadToken(429, "TooManyRequests"));
  clearLive(userId, botId);
});
