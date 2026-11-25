import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L161 (second half): bot themes, notes readable outside the app, global recap, start on a failing disk, late answers,
// the queue of a shared computer, the team-folder write lock. Each contract is written here first.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-l161b-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.OPEN_SIGNUP = "1";
process.env.EMAIL_VERIFICATION = "0";
process.env.DEFAULT_MODEL = "l161b:r";
delete process.env.MAX_BOTS;
delete process.env.HOSTED_MODE;

const { registerProvider } = await import("../src/llm/index.js");
const { api } = await import("../src/routes.js");
const { bots, users, rows, settings } = await import("../src/store.js");
const { teamDirOf } = await import("../src/computer.js");
const lock = await import("../src/teamlock.js");
const { teamFolderTools } = await import("../src/agent/tools-teamfolder.js");
import type { TurnRequest, TurnResult } from "../src/llm/types.js";

const said: string[] = [];
registerProvider({ id: "l161b", label: "Scripted", models: ["r"], available: () => true, async runTurn(req: TurnRequest): Promise<TurnResult> {
  const last = req.messages[req.messages.length - 1];
  said.push(typeof last?.content === "string" ? last.content : (last?.content ?? []).map((b: any) => b.text ?? (Array.isArray(b.content) ? b.content.map((x: any) => x.text ?? "").join("\n") : String(b.content ?? ""))).join("\n"));
  return { content: [{ type: "text", text: "ok" }], stopReason: "end", model: "r", usage: { inputTokens: 1, outputTokens: 1, cachedTokens: 0 } };
} });

let cookie = "";
async function call(method: string, url: string, body?: unknown, jar?: { cookie: string }) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie: jar ? jar.cookie : cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) { if (jar) jar.cookie = set.split(";")[0]; else cookie = set.split(";")[0]; }
  const buf = Buffer.from(await res.arrayBuffer());
  let json: any = null; try { json = JSON.parse(buf.toString("utf8")); } catch { /* not JSON */ }
  return { status: res.status, json, text: buf.toString("utf8"), buf, headers: res.headers };
}
const other = { cookie: "" };
let userId = "";
const fresh = async (name: string, jar?: { cookie: string }) => (await call("POST", "/bots", { name }, jar)).json.bot as { id: string; generation: number };
const until = async (ok: () => boolean | Promise<boolean>, what: string, ms = 8000) => {
  const end = Date.now() + ms;
  while (!(await ok())) { if (Date.now() > end) throw new Error(`timed out waiting for ${what}`); await new Promise((r) => setTimeout(r, 20)); }
};

test("setup", async () => {
  assert.equal((await call("POST", "/auth/signup", { email: "l161b@example.com", password: "password-1", locale: "fr" })).status, 200);
  userId = users.byEmail("l161b@example.com")!.id;
  assert.equal((await call("POST", "/auth/signup", { email: "l161b-other@example.com", password: "password-1", locale: "fr" }, other)).status, 200);
});

// ── 7. Team-folder write lock ──
test("team lock: paths stay inside the folder; a lock refuses another bot's write and its writing commands, never its reads", async () => {
  lock.resetTeamLocks();
  assert.equal(lock.teamRel("~/team/clients/liste.csv"), "clients/liste.csv");
  assert.equal(lock.teamRel("/root/team/a.md"), "a.md");
  assert.equal(lock.teamRel("../../etc/passwd"), null);
  assert.equal(lock.teamRel(""), null);
  assert.equal(lock.teamRel(".verrous.json"), null, "the lock list itself is not writable");
  const lea = { id: "bot_lea", userId, name: "Léa" };
  const hugo = { id: "bot_hugo", userId, name: "Hugo" };
  const taken = lock.takeLock(lea, "~/team/clients/liste.csv", 99);
  assert.ok("lock" in taken);
  assert.equal(Math.round(((taken as any).lock.until - (taken as any).lock.since) / 60_000), lock.LOCK_MAX_MIN, "capped at 30 minutes");
  const mirror = JSON.parse(readFileSync(path.join(teamDirOf(userId), lock.LOCKS_FILE), "utf8"));
  assert.equal(mirror.verrous[0].fichier, "clients/liste.csv");
  assert.equal(mirror.verrous[0].bot, "Léa");
  const refused = lock.takeLock(hugo, "clients/liste.csv", 5);
  assert.match((refused as any).error, /Léa is changing "clients\/liste\.csv"/);
  const w = await lock.writeTeamText(hugo, "clients/liste.csv", "x");
  assert.match((w as any).error, /Léa is changing/);
  assert.match(lock.shellLockRefusal(hugo, "echo 1 >> ~/team/clients/liste.csv")!, /Not run: Léa/);
  assert.match(lock.shellLockRefusal(hugo, "cd ~/team/clients && sed -i 's/a/b/' liste.csv")!, /Not run/);
  assert.equal(lock.shellLockRefusal(hugo, "cat ~/team/clients/liste.csv"), null, "reading is never refused");
  assert.equal(lock.shellLockRefusal(lea, "echo 1 >> ~/team/clients/liste.csv"), null, "the holder may write");
  assert.equal(lock.shellLockRefusal(hugo, "echo 1 > ~/team/autre.csv"), null, "another file is free");
  assert.ok("path" in (await lock.writeTeamText(lea, "clients/liste.csv", "a;b\n")), "the holder writes");
  assert.equal(lock.releaseLock(hugo, "clients/liste.csv"), false, "only the holder lets go");
  assert.equal(lock.releaseLock(lea, "clients/liste.csv"), true);
  assert.ok(!existsSync(path.join(teamDirOf(userId), lock.LOCKS_FILE)), "no lock left: the list file goes");
  assert.ok("path" in (await lock.writeTeamText(hugo, "clients/liste.csv", "c;d\n", { append: true })));
  assert.equal(readFileSync(path.join(teamDirOf(userId), "clients/liste.csv"), "utf8"), "a;b\nc;d\n");
});

test("team lock: 20 writes at once from two bots are serialised, whole, and an outdated version is refused with who changed it", async () => {
  lock.resetTeamLocks();
  const lea = { id: "bot_lea", userId, name: "Léa" };
  const hugo = { id: "bot_hugo", userId, name: "Hugo" };
  const results = await Promise.all(Array.from({ length: 20 }, (_, i) => lock.writeTeamText(i % 2 ? lea : hugo, "journal.md", `ligne ${i}\n`, { append: true })));
  assert.ok(results.every((r) => "path" in r));
  const lines = readFileSync(path.join(teamDirOf(userId), "journal.md"), "utf8").trim().split("\n");
  assert.equal(lines.length, 20, "no write lost");
  assert.deepEqual(lines, Array.from({ length: 20 }, (_, i) => `ligne ${i}`), "in the order they were asked");
  const read = lock.readTeamText(lea, "journal.md") as any;
  assert.equal(read.version, lock.fingerprint(readFileSync(path.join(teamDirOf(userId), "journal.md"))));
  assert.ok("path" in (await lock.writeTeamText(hugo, "journal.md", "réécrit\n")));
  const late = await lock.writeTeamText(lea, "journal.md", "ma version\n", { expected: read.version });
  assert.match((late as any).error, /changed since you read it \(Hugo wrote it\)/);
  assert.match((await lock.writeTeamText(lea, "neuf.md", "x", { expected: "absent" }) as any).path, /neuf\.md/);
  assert.match((await lock.writeTeamText(hugo, "neuf.md", "y", { expected: "absent" }) as any).error, /changed since/);
});

test("team lock tools: refused while the team folder is off; work once it is on", async () => {
  lock.resetTeamLocks();
  const b = bots.byId((await fresh("Équipier")).id)!;
  const ctx = { bot: b, user: users.byId(userId)!, depth: 0, signal: new AbortController().signal } as any;
  const t = (n: string) => teamFolderTools.find((x) => x.spec.name === n)!;
  settings.saveTeam(userId, false);
  assert.equal((await t("team_file_write").run({ path: "a.md", content: "x" }, ctx)).isError, true);
  settings.saveTeam(userId, true);
  const w = await t("team_file_write").run({ path: "a.md", content: "bonjour" }, ctx);
  assert.match(String(w.content), /Written: ~\/team\/a\.md/);
  const r = await t("team_file_read").run({ path: "a.md" }, ctx);
  assert.match(String(r.content), /^Version [0-9a-f]{16}\n\nbonjour$/);
  assert.match(String((await t("team_lock").run({ path: "a.md", minutes: 5 }, ctx)).content), /Locked ~\/team\/a\.md/);
  assert.match(String((await t("team_unlock").run({ path: "*" }, ctx)).content), /Let go of 1 file/);
  assert.ok(teamFolderTools.every((x) => x.group === "team"));
});

// ── 6. Queue of a shared computer ──
test("shared queue: the second and third bots say they wait, behind whom, take their turn in order, and the line says how long", async () => {
  const sc = await import("../src/sharedcomputers.js");
  const { queueTiming } = await import("../src/sharedqueue.js");
  sc.resetLeases(); sc.leaseTiming.waitMs = 3000; sc.leaseTiming.stepMs = 20; queueTiming.announceAfterMs = 0;
  const ids = [];
  for (const n of ["Hugo", "Léa", "Max"]) { const b = await fresh(n); bots.patch(b.id, { computerMode: "shared" }); ids.push(b.id); }
  const [hugo, lea, max] = ids;
  const first = await sc.acquireShared(hugo, userId);
  const order: string[] = [];
  const pLea = sc.acquireShared(lea, userId).then((l) => { order.push("lea"); return l; });
  await until(() => sc.sharedQueue(userId).length === 1, "Léa in line");
  const pMax = sc.acquireShared(max, userId).then((l) => { order.push("max"); return l; });
  await until(() => sc.sharedQueue(userId).length === 2, "Max in line");
  assert.deepEqual(sc.sharedQueue(userId), [lea, max]);
  assert.deepEqual(sc.sharedView(userId)[0].waiting, [lea, max], "the app sees the line");
  const notice = (id: string) => rows.list(id, bots.byId(id)!.generation).filter((r) => r.body.kind === "notice").map((r) => (r.body as any).text as string);
  await until(() => notice(max).length === 1 && notice(lea).length === 1, "both lines");
  assert.equal(notice(lea)[0], "L'ordinateur partagé est utilisé par Hugo. J'attends mon tour (je suis le prochain). Je reprends tout seul dès qu'il se libère.");
  assert.equal(notice(max)[0], "L'ordinateur partagé est utilisé par Hugo. J'attends mon tour : 2e dans la file, derrière Léa. Je reprends tout seul dès qu'il se libère.");
  first.release();
  const lLea = await pLea;
  assert.deepEqual(order, ["lea"], "first in line first");
  await until(() => /c'est mon tour/.test(notice(lea)[0]), "Léa's line closed");
  assert.match(notice(lea)[0], /^J'ai attendu \d+ s l'ordinateur partagé ; c'est mon tour, je reprends\.$/);
  await until(() => /utilisé par Léa/.test(notice(max)[0]), "Max's line follows who drives");
  assert.match(notice(max)[0], /utilisé par Léa\. J'attends mon tour \(je suis le prochain\)/);
  lLea.release();
  (await pMax).release();
  assert.deepEqual(order, ["lea", "max"]);
  assert.deepEqual(sc.sharedQueue(userId), [], "nobody left in line");
  // A wait that runs out says so, and leaves the line.
  sc.leaseTiming.waitMs = 200;
  const again = await sc.acquireShared(hugo, userId);
  await assert.rejects(sc.acquireShared(lea, userId), sc.SharedComputersBusyError);
  assert.match(notice(lea).at(-1)!, /encore pris après \d+ s : j'ai arrêté d'attendre/);
  assert.deepEqual(sc.sharedQueue(userId), []);
  again.release();
  // Short hand-overs stay silent.
  queueTiming.announceAfterMs = 60_000; sc.leaseTiming.waitMs = 3000;
  const h = await sc.acquireShared(hugo, userId);
  const before = notice(max).length;
  const p = sc.acquireShared(max, userId);
  setTimeout(() => h.release(), 60);
  (await p).release();
  assert.equal(notice(max).length, before, "no line for a wait under the announce delay");
});

// ── 5. Late answer delivered only if still useful ──
test("late answer: timely → a turn; after the owner moved on → kept and given with the next message, no turn; closed task → only recorded", async () => {
  const { LATE_AFTER_MS, answerFate } = await import("../src/agent/lateanswer.js");
  const b = bots.byId((await fresh("Questions")).id)!;
  const ask = (question: string) => rows.append(b, { kind: "card", card: { type: "question", question, options: ["Oui", "Non"], status: "pending" } } as any, 0);
  // Timely: delivered as before.
  const q1 = ask("On commence lundi ?");
  const n0 = said.length;
  const r1 = await call("POST", `/bots/${b.id}/cards/${q1.seq}/answer`, { answer: "Oui" });
  assert.equal(r1.json.fate, "deliver");
  await until(() => said.slice(n0).some((s) => /Answering your question "On commence lundi \?"/.test(s)), "the timely answer");
  // Moved on: the owner wrote something else after the question.
  const q2 = ask("Quel format pour le devis ?");
  rows.append(b, { kind: "message", role: "user", text: "Laisse tomber le devis, regarde mes mails." }, 0);
  const n1 = said.length;
  const r2 = await call("POST", `/bots/${b.id}/cards/${q2.seq}/answer`, { answer: "PDF" });
  assert.equal(r2.json.fate, "moved_on");
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(said.length, n1, "no new turn for a late answer");
  const list = rows.list(b.id, b.generation);
  assert.equal((list.find((r) => r.seq === q2.seq)!.body as any).card.status, "answered", "the card says answered");
  assert.ok(list.some((r) => r.body.kind === "message" && (r.body as any).text === "PDF"), "the answer shows in the chat");
  assert.ok(list.some((r) => r.body.kind === "notice" && /La conversation est passée à autre chose/.test((r.body as any).text)));
  // The next owner message carries it, once.
  await call("POST", `/bots/${b.id}/messages`, { text: "Alors, ces mails ?" });
  await until(() => said.slice(n1).some((s) => /A late answer: earlier, the user also answered your older question "Quel format pour le devis \?": PDF/.test(s)), "the late answer with the next message");
  const n2 = said.length;
  await call("POST", `/bots/${b.id}/messages`, { text: "Merci" });
  await until(() => said.length > n2, "the next turn");
  assert.ok(!said.slice(n2).some((s) => /A late answer/.test(s)), "given once");
  // Too old, or another question since: moved on too.
  const old = { seq: 1, generation: b.generation, thread: 0, createdAt: Date.now() - LATE_AFTER_MS - 1000 };
  assert.equal(answerFate(b, { ...old, seq: 10_000 }), "moved_on");
  // A helper whose task is done: only recorded.
  const { bgTasks } = await import("../src/agent/bgtasks.js");
  const helper = bots.create(userId, { name: "Aide", hidden: true, parentId: b.id } as any);
  const qh = rows.append(helper, { kind: "card", card: { type: "question", question: "Je continue ?", options: [], status: "pending" } } as any, 0);
  const { q } = await import("../src/db.js");
  q.run("INSERT INTO bg_tasks (id, bot_id, helper_id, title, goal, state, steps, result, generation, created_at, updated_at) VALUES ('bg_l161', ?, ?, 't', 'g', 'done', 1, 'fini', 1, 1, 1)", b.id, helper.id);
  assert.equal(bgTasks.byHelper(helper.id)!.state, "done");
  assert.equal(answerFate(helper, { seq: qh.seq, generation: qh.generation, thread: 0, createdAt: qh.createdAt }), "closed");
  // Another account cannot answer.
  assert.equal((await call("POST", `/bots/${b.id}/cards/${q2.seq}/answer`, { answer: "x" }, other)).status, 404);
});

// ── 4. Start on a failing disk ──
test("failing disk: the probe names the problem; the server waits in safe mode (one log line, a 503 card, nothing written) and starts once the disk is fine", async () => {
  const { probeDisk, safeModePage, holdWhileDiskFails } = await import("../src/diskboot.js");
  const base = mkdtempSync(path.join(tmpdir(), "sklubot-disk-"));
  // A folder that cannot be made (a file stands where its parent should be).
  writeFileSync(path.join(base, "blocker"), "x");
  const p1 = probeDisk(path.join(base, "blocker", "data"), path.join(base, "blocker", "data", "sklubot.db"), 0)!;
  assert.equal(p1.kind, "unreachable");
  // Not enough free space.
  const p2 = probeDisk(path.join(base, "ok"), path.join(base, "ok", "sklubot.db"), 1e12)!;
  assert.equal(p2.kind, "full");
  assert.match(p2.detail, /MB free, 1000000000000 MB needed/);
  // A database that cannot be read is named, and left alone.
  writeFileSync(path.join(base, "ok", "sklubot.db"), "pas une base sqlite ".repeat(100));
  const p3 = probeDisk(path.join(base, "ok"), path.join(base, "ok", "sklubot.db"), 0)!;
  assert.equal(p3.kind, "database");
  assert.equal(readFileSync(path.join(base, "ok", "sklubot.db"), "utf8"), "pas une base sqlite ".repeat(100), "untouched");
  assert.equal(probeDisk(path.join(base, "fine"), path.join(base, "fine", "sklubot.db"), 0), null);
  assert.deepEqual((await import("node:fs")).readdirSync(path.join(base, "fine")), [], "the probe file is removed");
  const html = safeModePage(p2, 30);
  assert.match(html, /Le disque des données est plein/);
  assert.match(html, /The data disk is full/);
  assert.match(html, /rien n'est effacé/);
  // In-process: the card answers while the problem lasts; one line, however many looks; then it lets the start go on.
  let looks = 0;
  const lines: string[] = [];
  const holding = holdWhileDiskFails({ probe: () => (++looks < 6 ? p2 : null), port: 0, retryMs: 30, log: (l) => lines.push(l) });
  const r = await holding;
  assert.equal(r.problems, 1);
  assert.equal(lines.filter((l) => /Cannot start on this disk/.test(l)).length, 1, "one line for the problem");
  assert.ok(lines.some((l) => /The disk is fine again/.test(l)));
  assert.ok(looks >= 6);
});

test("failing disk: the real server entry point serves the safe-mode card, then starts by itself when the folder can be made", async () => {
  const { spawn } = await import("node:child_process");
  const { rmSync, mkdirSync } = await import("node:fs");
  const base = mkdtempSync(path.join(tmpdir(), "sklubot-diskboot-"));
  const blocker = path.join(base, "disk");
  writeFileSync(blocker, "x"); // DATA_DIR's parent is a file: the folder cannot be made
  const dataDir = path.join(blocker, "data");
  const child = spawn(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: path.join(import.meta.dirname, ".."),
    env: { ...Object.fromEntries(Object.entries(process.env).filter(([k]) => k !== "DB_PATH")), DATA_DIR: dataDir, SESSION_SECRET: "disk-secret-disk-secret-disk-secret-0", NO_SCHEDULER: "1", COMPUTER: "browser", PORT: "0", DISK_BOOT_RETRY_SEC: "0.3", DISK_BOOT_MIN_MB: "0" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let out = "";
  child.stdout.on("data", (d) => { out += d; });
  child.stderr.on("data", (d) => { out += d; });
  try {
    await until(() => /\[safe mode\] page at http:\/\/localhost:(\d+)\//.test(out), "the safe-mode page", 60_000);
    const port = /\[safe mode\] page at http:\/\/localhost:(\d+)\//.exec(out)![1];
    const health = await fetch(`http://localhost:${port}/api/health`);
    assert.equal(health.status, 503);
    const j = await health.json() as any;
    assert.equal(j.status, "safe-mode");
    assert.equal(j.safeMode.kind, "unreachable");
    const page = await fetch(`http://localhost:${port}/`);
    assert.equal(page.status, 503);
    assert.match(await page.text(), /Le dossier des données est introuvable/);
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal((out.match(/Cannot start on this disk/g) ?? []).length, 1, "one log line, not one per look");
    assert.equal(child.exitCode, null, "it does not stop (no restart loop)");
    // The disk comes back: the server starts on its own.
    rmSync(blocker); mkdirSync(blocker);
    await until(() => /Sklubot is running at/.test(out), "the normal start", 90_000);
    assert.match(out, /The disk is fine again/);
    assert.ok(existsSync(path.join(dataDir, "sklubot.db")), "the database opens only now");
  } finally { child.kill("SIGKILL"); }
});

// ── 1. Themes created by the bot ──
test("themes: the server's colours and pairs are the app's own (tokens.css, check-contrast.mjs)", async () => {
  const { BASE, PAIRS, THRESHOLDS } = await import("../src/botthemes.js");
  const web = await import("../../web/scripts/check-contrast.mjs" as string);
  const themes = web.parseThemes(readFileSync(path.join(import.meta.dirname, "../../web/src/styles/tokens.css"), "utf8"));
  for (const mode of ["light", "dark"] as const) {
    const hex = Object.fromEntries(Object.entries(themes[mode] as Record<string, string>).filter(([, v]) => /^#[0-9a-f]{6}$/i.test(v) || /^var\(/.test(v)));
    assert.deepEqual(BASE[mode], hex, `${mode}: botthemes.ts BASE must equal tokens.css`);
  }
  assert.deepEqual(PAIRS, web.PAIRS.map((p: string[]) => [p[0], p[1], p[2]]), "the same pairs, in order");
  assert.deepEqual(THRESHOLDS, web.THRESHOLDS);
});

test("themes: a bot proposes, a faint theme is refused with the pairs to fix, the owner applies, goes back, removes; others see nothing", async () => {
  const { themeTools } = await import("../src/agent/tools-theme.js");
  const b = bots.byId((await fresh("Décoratrice")).id)!;
  const ctx = { bot: b, user: users.byId(userId)!, depth: 0, signal: new AbortController().signal } as any;
  const propose = themeTools[0];
  const faint = await propose.run({ name: "Brume", light: { "--text-2": "#bbbbbb" } }, ctx);
  assert.equal(faint.isError, true);
  assert.match(String(faint.content), /light: --text-2 on --surface is [\d.]+:1, needs 4\.5:1/);
  assert.match(String((await propose.run({ name: "X", light: { "--danger": "#ff0000" } }, ctx)).content), /--danger cannot be themed/);
  assert.match(String((await propose.run({ name: "X", dark: { "--bg": "red" } }, ctx)).content), /must be a colour written #rrggbb/);
  assert.equal((await call("GET", "/themes")).json.themes.length, 0, "nothing saved");
  const ok = await propose.run({ name: "Sable", note: "Tons chauds", light: { "--bg": "#f6efe3", "--surface": "#fffaf2", "--accent": "#7a3d12", "--accent-fg": "#ffffff" }, dark: { "--bg": "#17130e", "--surface": "#201a13" } }, ctx);
  assert.equal(ok.isError, undefined, String(ok.content));
  const list = await call("GET", "/themes");
  assert.equal(list.json.themes.length, 1);
  const th = list.json.themes[0];
  assert.equal(th.name, "Sable"); assert.equal(th.botName, "Décoratrice"); assert.equal(th.applied, false); assert.equal(th.check.ok, true);
  assert.equal(list.json.applied, null, "a bot never applies it");
  assert.ok(rows.list(b.id, b.generation).some((r) => r.body.kind === "notice" && /Décoratrice propose un thème de couleurs pour l'appli : Sable/.test((r.body as any).text)));
  // Another account: nothing, and cannot apply or remove it.
  assert.equal((await call("GET", "/themes", undefined, other)).json.themes.length, 0);
  assert.equal((await call("POST", `/themes/${th.id}/apply`, {}, other)).status, 404);
  assert.equal((await call("DELETE", `/themes/${th.id}`, undefined, other)).status, 404);
  const applied = await call("POST", `/themes/${th.id}/apply`, {});
  assert.equal(applied.status, 200);
  assert.equal(applied.json.applied.id, th.id);
  assert.equal(applied.json.applied.light["--bg"], "#f6efe3");
  const back = await call("POST", "/themes/reset", {});
  assert.equal(back.json.applied, null);
  assert.equal(back.json.themes.length, 1, "kept, to apply again later");
  // A theme stored before a change of the app's colours that no longer passes cannot be applied.
  const { q } = await import("../src/db.js");
  q.run("UPDATE bot_themes SET light = ? WHERE id = ?", JSON.stringify({ "--text": "#dddddd" }), th.id);
  const refused = await call("POST", `/themes/${th.id}/apply`, {});
  assert.equal(refused.status, 409);
  assert.match(refused.json.error, /contrast check/);
  assert.equal((await call("DELETE", `/themes/${th.id}`)).json.themes.length, 0);
  // At most 30 kept.
  for (let i = 0; i < 32; i++) await propose.run({ name: `T${i}`, light: { "--bg": "#f5f1ea" } }, ctx);
  assert.equal((await call("GET", "/themes")).json.themes.length, 30);
});

// ── 2. Notes readable outside the app ──
test("notes archive: a zip of Markdown files, one per note by state, with the index, the documents and the profile; owner only", async () => {
  const { memories } = await import("../src/store.js");
  const { readZip } = await import("../src/projectimport.js");
  const b = bots.byId((await fresh("Mémoire")).id)!;
  memories.add(b.id, "Aime le thé vert, pas de sucre");
  const contested = memories.add(b.id, "Habite à Lyon");
  memories.setStatus(contested.id, "contested");
  const gone = memories.add(b.id, "Ancien numéro : 06 00 00 00 00");
  memories.setStatus(gone.id, "archived");
  const { q } = await import("../src/db.js");
  q.run("INSERT INTO doc_base (id, user_id, scope_kind, scope_id, name, text, created_at) VALUES ('doc_l161', ?, 'bot', ?, 'Tarifs 2026', 'Forfait : 90 €', 1)", userId, b.id);
  settings.saveProfile(userId, { name: "Camille", company: "Atelier C" } as any);
  const res = await call("GET", `/bots/${b.id}/notes.zip`);
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("content-type"), "application/zip");
  assert.match(res.headers.get("content-disposition")!, /filename\*=UTF-8''Notes-memoire-\d{4}-\d{2}-\d{2}\.zip/);
  const files = readZip(res.buf);
  const names = files.map((f) => f.path).sort();
  assert.deepEqual(names, ["LISEZMOI.md", "documents/tarifs-2026.md", "notes/archivees/001-ancien-numero-06-00-00-00-00.md", "notes/contestees/001-habite-a-lyon.md", "notes/utilisees/001-aime-le-the-vert-pas-de-sucre.md", "profil.md"]);
  const text = (n: string) => files.find((f) => f.path === n)!.data.toString("utf8");
  assert.match(text("notes/utilisees/001-aime-le-the-vert-pas-de-sucre.md"), /^# Aime le thé vert, pas de sucre\n\nAime le thé vert, pas de sucre\n\n---\n- État : utilisée\n- Écrite le : \d{4}-\d{2}-\d{2} · Source : conversation\n- Confiance : entendue une fois\n$/);
  assert.match(text("LISEZMOI.md"), /# Notes de Mémoire/);
  assert.match(text("LISEZMOI.md"), /notes\/utilisees\/ : 1 note\(s\) que le bot utilise/);
  assert.match(text("documents/tarifs-2026.md"), /Forfait : 90 €/);
  assert.match(text("profil.md"), /Camille/);
  assert.equal((await call("GET", `/bots/${b.id}/notes.zip`, undefined, other)).status, 404, "another account gets nothing");
  // The system's own unzip reads it too.
  const { spawnSync } = await import("node:child_process");
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-notes-"));
  writeFileSync(path.join(dir, "n.zip"), res.buf);
  const py = spawnSync("python3", ["-I", "-c", "import zipfile,sys; z=zipfile.ZipFile(sys.argv[1]); print(z.testzip()); print(len(z.namelist()))", path.join(dir, "n.zip")], { encoding: "utf8" });
  if (py.status === 0) assert.equal(py.stdout.trim(), "None\n6", "a standard zip reader finds no error");
});

// ── 3. Global recap ──
test("global recap: every bot in one recap — finished, waiting, open goals, left aside — bounded text; owner only", async () => {
  const { q } = await import("../src/db.js");
  const { globalRecap, RECAP_TEXT_MAX, DORMANT_DAYS } = await import("../src/globalrecap.js");
  const busy = bots.byId((await fresh("Rédactrice")).id)!;
  const asleep = bots.byId((await fresh("Comptable")).id)!;
  const t = Date.now();
  const goal = (id: string, botId: string, objective: string, status: string, at: number) => q.run("INSERT INTO bot_goals (id, bot_id, user_id, generation, thread, objective, status, max_rounds, evidence, created_at, updated_at) VALUES (?, ?, ?, 1, 0, ?, ?, 5, 'fait', ?, ?)", id, botId, userId, objective, status, at, at);
  goal("g_done", busy.id, "Écrire la newsletter", "complete", t - 3600_000);
  goal("g_open", asleep.id, "Clôturer les comptes 2025", "active", t - 40 * 86_400_000);
  rows.append(busy, { kind: "card", card: { type: "question", question: "Quel titre ?", options: [], status: "pending" } } as any, 0);
  rows.append(asleep, { kind: "message", role: "assistant", text: "Je m'occupe des comptes." }, 0);
  q.run("UPDATE rows SET created_at = ? WHERE bot_id = ?", t - (DORMANT_DAYS + 6) * 86_400_000, asleep.id);
  const res = await call("GET", "/recap?days=7");
  assert.equal(res.status, 200);
  const r = res.json;
  assert.equal(r.days, 7);
  const red = r.bots.find((x: any) => x.botName === "Rédactrice");
  const compta = r.bots.find((x: any) => x.botName === "Comptable");
  assert.equal(red.finished, 1); assert.deepEqual(red.highlights, ["Écrire la newsletter"]); assert.equal(red.waiting >= 1, true); assert.equal(red.dormant, false);
  assert.equal(compta.dormant, true); assert.deepEqual(compta.openGoals, ["Clôturer les comptes 2025"]);
  assert.equal(r.bots[0].dormant, true, "the bots left aside come first");
  assert.match(r.text, /^Récapitulatif de tes bots, 7 derniers jours — \d+ chose/);
  assert.match(r.text, /• Comptable : 0 finie ; au point mort depuis \d+ j \(objectif « Clôturer les comptes 2025 »\)/);
  assert.match(r.text, /• Rédactrice : 1 finie ; \d+ t'attend/);
  assert.ok(r.text.length <= RECAP_TEXT_MAX);
  assert.equal((await call("GET", "/recap?days=999")).json.days, 31, "capped");
  const theirs = (await call("GET", "/recap", undefined, other)).json;
  assert.ok(!theirs.bots.some((x: any) => x.botName === "Rédactrice"), "another account sees only its own bots");
  // The bot's tool: the same text, own bots only, no model call.
  const { recapTools } = await import("../src/agent/tools-recap.js");
  const n = said.length;
  const out = await recapTools[0].run({ days: 7 }, { bot: busy, user: users.byId(userId)!, depth: 0, signal: new AbortController().signal } as any);
  assert.equal(String(out.content), globalRecap(userId, { days: 7, ownOnly: true, locale: "fr" }).text);
  assert.equal(said.length, n, "no model call");
  // Bounded even with many bots.
  for (let i = 0; i < 12; i++) { const x = bots.byId((await fresh(`Bot ${i}`)).id)!; goal(`g_${i}`, x.id, "Objectif ".repeat(40) + i, "complete", t - 1000); }
  const big = globalRecap(userId, { days: 7, locale: "fr" });
  assert.ok(big.text.length <= RECAP_TEXT_MAX);
  assert.match(big.text, /autres? bots? sans rien de neuf|…$/);
});
