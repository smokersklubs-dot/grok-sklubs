import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Lot 4 comfort (22/11): « Sourdine » on one chat holds its notifications back for 8 h or until turned back on, but an
// approval question (« needs ») always notifies; only the owner can change it; bad values are refused.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-comfort-"));
process.env.SESSION_SECRET = "comfort-secret-comfort-secret-comfort";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { chatMutes, mutedPush } = await import("../src/chatmute.js");
const jar: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

test("mute a chat: 8 h or until turned back on; approval questions still notify; owner only", async () => {
  const su = await call("a", "POST", "/auth/signup", { email: "ana@example.com", name: "Ana", password: "password-1", locale: "fr" });
  await call("b", "POST", "/auth/signup", { email: "ben@example.com", name: "Ben", password: "password-1", locale: "fr" });
  assert.equal(su.status, 200, JSON.stringify(su.json));
  const bot = (await call("a", "GET", "/bots")).json.bots[0];
  const me = su.json.user.id;
  assert.deepEqual((await call("a", "GET", `/bots/${bot.id}/mute`)).json, { muted: false, until: null });
  const eight = await call("a", "PUT", `/bots/${bot.id}/mute`, { mute: "8h" });
  assert.equal(eight.json.muted, true);
  assert.ok(Math.abs(eight.json.until - (Date.now() + 8 * 3_600_000)) < 5000);
  assert.equal(mutedPush(me, bot.id, "reply"), true);
  assert.equal(mutedPush(me, bot.id, "needs"), false, "a bot waiting for your OK still notifies");
  assert.equal(mutedPush(me, "other-bot", "reply"), false);
  assert.equal(chatMutes.until(me, bot.id, Date.now() + 9 * 3_600_000), null, "over after 8 hours");
  assert.deepEqual((await call("a", "PUT", `/bots/${bot.id}/mute`, { mute: "forever" })).json, { muted: true, until: null });
  assert.equal(chatMutes.until(me, bot.id, Date.now() + 1e10), Infinity);
  assert.equal((await call("a", "PUT", `/bots/${bot.id}/mute`, { mute: "2y" })).status, 400);
  assert.equal((await call("b", "PUT", `/bots/${bot.id}/mute`, { mute: "off" })).status, 404, "someone else's bot");
  assert.deepEqual((await call("a", "PUT", `/bots/${bot.id}/mute`, { mute: "off" })).json, { muted: false, until: null });
  assert.equal(mutedPush(me, bot.id, "reply"), false);
});
