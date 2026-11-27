import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// Wave 6 comfort routes: L142 GET /bots/stop-causes, L152 GET/PUT /me/commands, L153 GET /doctor (read-only checks and
// the paste text with no path, address, e-mail or secret). Each account sees only its own.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-wave6-"));
process.env.SESSION_SECRET = "wave6-secret-wave6-secret-wave6-secret!!";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
for (const k of ["ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const { api } = await import("../src/routes.js");
const { rows, bots } = await import("../src/store.js");
const { pasteText, scrub, permissionFindings } = await import("../src/doctor.js");
const jar: Record<string, string> = {};
async function call(who: string, method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar[who] ?? "" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) jar[who] = set.split(";")[0];
  return { status: res.status, json: (await res.json().catch(() => null)) as any };
}

const a = await call("a", "POST", "/auth/signup", { email: "ana@example.com", name: "Ana", password: "password-1", locale: "fr" });
await call("b", "POST", "/auth/signup", { email: "ben@example.com", name: "Ben", password: "password-1", locale: "fr" });
assert.equal(a.status, 200, JSON.stringify(a.json));

test("stop causes: one chip per bot that stopped, gone once it answers; never another account's bots", async () => {
  const bot = (await call("a", "GET", "/bots")).json.bots[0];
  assert.deepEqual((await call("a", "GET", "/bots/stop-causes")).json, { causes: {} });
  const rec = bots.byId(bot.id)!;
  rows.append(rec, { kind: "message", role: "user", text: "Fais le rapport" });
  rows.append(rec, { kind: "notice", tone: "warn", text: "Limite d'étapes atteinte", action: { kind: "continue", status: "pending" } });
  const r = (await call("a", "GET", "/bots/stop-causes")).json;
  assert.equal(r.causes[bot.id].cause, "steps");
  assert.equal(r.causes[bot.id].text, "Limite d'étapes atteinte");
  assert.deepEqual((await call("b", "GET", "/bots/stop-causes")).json.causes[bot.id], undefined, "Ben does not see Ana's bot");
  rows.append(rec, { kind: "notice", tone: "info", text: "Arrêté." });
  assert.equal((await call("a", "GET", "/bots/stop-causes")).json.causes[bot.id].cause, "stopped", "the French « Arrêté. » is recognised");
  rows.append(rec, { kind: "message", role: "assistant", text: "Voilà le rapport." });
  assert.equal((await call("a", "GET", "/bots/stop-causes")).json.causes[bot.id], undefined);
});

test("personal commands: saved per account, names checked, secrets refused (French message)", async () => {
  assert.deepEqual((await call("a", "GET", "/me/commands")).json.commands, []);
  const ok = await call("a", "PUT", "/me/commands", { commands: [{ name: "/Bilan", text: "Fais-moi le bilan de la semaine." }, { name: "mails", text: "Résume mes mails non lus." }] });
  assert.equal(ok.status, 200);
  assert.deepEqual(ok.json.commands.map((c: { name: string }) => c.name), ["bilan", "mails"]);
  assert.deepEqual((await call("b", "GET", "/me/commands")).json.commands, [], "Ben has his own list");
  const bad = async (commands: unknown) => (await call("a", "PUT", "/me/commands", { commands }));
  assert.equal((await bad([{ name: "skill", text: "x" }])).status, 400);
  assert.equal((await bad([{ name: "a b", text: "x" }])).status, 400);
  assert.equal((await bad([{ name: "x", text: "a" }, { name: "x", text: "b" }])).status, 400);
  assert.equal((await bad(Array.from({ length: 31 }, (_, i) => ({ name: `c${i}`, text: "x" })))).status, 400);
  const secret = await bad([{ name: "cle", text: "utilise sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD" }]);
  assert.equal(secret.status, 400);
  assert.match(secret.json.error, /mot de passe ni de clé/);
  assert.equal((await call("a", "GET", "/me/commands")).json.commands.length, 2, "a refused list changes nothing");
});

test("doctor: the owner gets the installation lines, another account only its own; read-only", async () => {
  const owner = (await call("a", "GET", "/doctor")).json;
  assert.equal(owner.install, true);
  const ids = owner.findings.map((f: { checkId: string }) => f.checkId);
  for (const id of ["runtime.node", "auth.session_secret", "net.https", "backup.recent", "account.two_factor"]) assert.ok(ids.includes(id), id);
  assert.equal(owner.findings.find((f: { checkId: string }) => f.checkId === "account.two_factor").severity, "warn");
  assert.equal(owner.findings.find((f: { checkId: string }) => f.checkId === "auth.session_secret").severity, "ok");
  const other = (await call("b", "GET", "/doctor")).json;
  assert.equal(other.install, false);
  assert.ok(other.findings.every((f: { scope: string }) => f.scope === "account"), "no installation detail for a plain account");
  const sum = owner.summary;
  assert.equal(sum.critical + sum.warn + sum.info + sum.ok, owner.findings.length);
});

test("doctor paste text and permission rules (adapted from OpenClaw)", () => {
  const text = pasteText([{ checkId: "x.y", severity: "warn", title: "t", detail: "", scope: "account" }], { app: "Sklubot", node: "v22.13.0", words: (k) => (k === "t" ? "Voir /home/ana/sklubot/data et https://moi.example.com ana@example.com sk-proj-abcdefghijklmnopqrstuvwxyz0123456789ABCD" : k) });
  assert.doesNotMatch(text, /\/home\/ana|example\.com|sk-proj/);
  assert.match(text, /\[WARN\] x\.y/);
  assert.equal(scrub("C:\\Users\\ana\\AppData\\x"), "<chemin>");
  const f = permissionFindings({ exists: true, isSymlink: false, mode: 0o777 }, { exists: true, isSymlink: false, mode: 0o644 }, { exists: false, isSymlink: false, mode: 0 });
  assert.deepEqual(f.map((x) => [x.checkId, x.severity]), [["fs.data_dir.perms_world_writable", "critical"], ["fs.database.perms_world_readable", "critical"]]);
  assert.deepEqual(permissionFindings({ exists: true, isSymlink: false, mode: 0o700 }, { exists: true, isSymlink: false, mode: 0o600 }, { exists: true, isSymlink: false, mode: 0o640 }).map((x) => x.checkId), ["fs.env.perms_group_readable"]);
});
