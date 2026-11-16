import assert from "node:assert/strict";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// Wave 8 on real bot computers (Docker and the desktop image): the account's team folder (opt-in, ~/team, one account
// only, picked up at the next start, outside content) and the disk-full card (measured in the computer, deletion only
// of listed paths, after confirmation, never outside the bot's own volumes).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-team-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";
process.env.OPEN_SIGNUP = "1";
process.env.DEFAULT_MODEL = "demo:demo";
// The highest threshold allowed: this machine's real disk must not be what raises the card in these tests.
process.env.DISK_ALERT_PERCENT = "99";
delete process.env.MAX_BOTS;

const { initComputer, readsTeamFolder, screen, teamDirOf, workspaceOf } = await import("../src/computer.js");
const { containerName, docker, linuxScreen } = await import("../src/linux.js");
const { api } = await import("../src/routes.js");
const { builtinTools } = await import("../src/agent/tools.js");
const { buildSystemPrompt } = await import("../src/agent/prompt.js");
const { bots, users } = await import("../src/store.js");
const { checkDisk, deletable, deleteListed, diskRunner, parseMeasure } = await import("../src/disk.js");
await initComputer();

let cookie = "";
async function call(method: string, url: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0];
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}
const sh = async (botId: string, cmd: string) => (await docker(["exec", containerName(botId), "sh", "-c", cmd])).stdout.toString("utf8").trim();
const made: string[] = [];
after(async () => { for (const id of made) await linuxScreen.destroy(id).catch(() => {}); });

let userId = "", a = "", b = "", old = "", stranger = "";
test("setup: an account with three bots, another account with one", async () => {
  await call("POST", "/auth/signup", { email: "team@example.com", password: "password-1", locale: "en" });
  userId = (await call("GET", "/me")).json.user.id;
  old = (await call("POST", "/bots", { name: "Old" })).json.bot.id;
  a = (await call("POST", "/bots", { name: "Ann" })).json.bot.id;
  b = (await call("POST", "/bots", { name: "Ben" })).json.bot.id;
  const other = users.create("other@example.com", "Other", "x", "en");
  stranger = bots.create(other.id, { name: "Stranger" }).id;
  made.push(old, a, b, stranger);
});

test("off by default: a computer made now has no team folder, and nothing changes for it", async () => {
  const t = (await call("GET", "/team-folder")).json.team;
  assert.deepEqual({ available: t.available, enabled: t.enabled, path: t.path }, { available: true, enabled: false, path: "~/team" });
  await screen.wake(old, userId);
  assert.equal(await sh(old, "test -e /root/team && echo yes || echo no"), "no");
  await sh(old, "echo kept > /root/home-file.txt");
});

test("switched on: new computers of this account share ~/team; the library view lists it; another account never gets it", async () => {
  const on = await call("PUT", "/team-folder", { enabled: true });
  assert.equal(on.status, 200);
  assert.equal(on.json.team.enabled, true);
  // The computer already running is not touched; it is listed as waiting for its next start.
  assert.deepEqual(on.json.team.waiting, ["Old"]);
  assert.equal(await sh(old, "test -e /root/team && echo yes || echo no"), "no");
  await screen.wake(a, userId);
  await screen.wake(b, userId);
  await sh(a, "echo from-ann > /root/team/note.txt");
  assert.equal(await sh(b, "cat /root/team/note.txt"), "from-ann");
  const files = (await call("GET", "/team-folder/files")).json.entries;
  assert.ok(files.some((f: { name: string }) => f.name === "note.txt"));
  const dl = await call("GET", "/team-folder/files/download?path=note.txt");
  assert.equal(dl.status, 200);
  assert.equal(dl.text.trim(), "from-ann");
  assert.equal((await call("GET", "/team-folder/files?path=../")).status, 400, "no way out of the folder");
  // Another account's bot: no team folder, even though this account switched it on.
  await screen.wake(stranger, bots.byId(stranger)!.userId);
  assert.equal(await sh(stranger, "test -e /root/team && echo yes || echo no"), "no");
  assert.ok(existsSync(path.join(teamDirOf(userId), "note.txt")));
  // The bot is told about it in its instructions.
  assert.match(buildSystemPrompt(bots.byId(a)!, users.byId(userId)!, { connectorNames: [], browser: true, shell: true, linux: true }), /~\/team is a folder shared/);
});

test("the computer made before picks it up at its next start, keeping its home folder", async () => {
  await screen.sleep(old);
  await screen.wake(old, userId);
  assert.equal(await sh(old, "cat /root/team/note.txt"), "from-ann");
  assert.equal(await sh(old, "cat /root/home-file.txt"), "kept");
  assert.deepEqual((await call("GET", "/team-folder")).json.team.waiting, []);
});

test("what a command may have read from the team folder is outside content", async () => {
  assert.equal(readsTeamFolder("cat ~/team/note.txt"), true);
  assert.equal(readsTeamFolder("grep -r invoice ."), true);
  assert.equal(readsTeamFolder("find ~ -name '*.md'"), true);
  assert.equal(readsTeamFolder("ls -la /root"), true);
  assert.equal(readsTeamFolder("cat ./notes.txt"), false);
  assert.equal(readsTeamFolder("python3 script.py --out report.csv"), false);
  const shell = builtinTools().find((t) => t.spec.name === "shell_run")!;
  const ctx = { bot: bots.byId(b)!, user: users.byId(userId)!, depth: 0, signal: new AbortController().signal };
  const read = await shell.run({ command: "cat ~/team/note.txt" }, ctx);
  assert.equal(read.outside, true);
  assert.match(String(read.content), /from-ann/);
  // A failing command still printed what it read: still outside.
  assert.equal((await shell.run({ command: "cat ~/team/note.txt; exit 3" }, ctx)).outside, true);
  assert.equal((await shell.run({ command: "echo hello" }, ctx)).outside, undefined);
});

test("switched off: computers lose ~/team at their next start; its files stay on the server", async () => {
  const off = await call("PUT", "/team-folder", { enabled: false });
  assert.equal(off.json.team.enabled, false);
  await screen.sleep(b);
  await screen.wake(b, userId);
  assert.equal(await sh(b, "test -e /root/team && echo yes || echo no"), "no");
  assert.ok(existsSync(path.join(teamDirOf(userId), "note.txt")));
});

// ── Disk-full card ───────────────────────────────────────────────────────────
test("only the bot's own home and library can be offered, never what the computer needs or the team folder", () => {
  assert.equal(deletable("/root/files/video.mp4"), true);
  assert.equal(deletable("/root/.cache/pip"), true);
  for (const p of ["/root", "/root/", "/root/files", "/root/team/x", "/root/team", "/root/.codex", "/root/.config", "/root/.config/sklubot-browser/Default", "/root/../etc/passwd", "/etc/passwd", "/root/a\nb", "relative/x"])
    assert.equal(deletable(p), false, p);
  const r = parseMeasure("DF 1000 950 50\n9000\t/root\n4000\t/root/files\n3000\t/root/files/big.bin\n2500\t/root/.cache\n2400\t/root/.cache/pip\n2048\t/root/.codex\n10\t/root/small\n");
  assert.equal(r!.usedPct, 95);
  assert.deepEqual(r!.items.map((i) => i.path), ["/root/files/big.bin", "/root/.cache"], "biggest first, a folder's contents not repeated, tiny ones left out");
});

test("measured in the real computer: big files listed, protected ones not; past the threshold a card; deletion of listed paths only", async () => {
  await sh(a, "mkdir -p /root/.cache/junk /root/.codex && head -c 3000000 /dev/zero > /root/files/big.bin && head -c 2000000 /dev/zero > /root/.cache/junk/x && head -c 4000000 /dev/zero > /root/.codex/keep && ln -sfn /root/team /root/sneaky");
  const report = await checkDisk(bots.byId(a)!, { force: true });
  assert.ok(report && report.totalBytes > 0);
  const paths = report!.items.map((i) => i.path);
  assert.ok(paths.includes("/root/files/big.bin"), paths.join(", "));
  assert.ok(paths.some((p) => p.startsWith("/root/.cache")));
  assert.equal(paths.some((p) => p.startsWith("/root/.codex") || p.startsWith("/root/team")), false);

  // A full disk (as the computer would report it) gives one card; a second check does not repeat it.
  const real = diskRunner.run;
  diskRunner.run = async (id, script, args) => (script.startsWith("df") ? { code: 0, stdout: Buffer.from(`DF 1000000 995000 5000\n3000\t/root/files/big.bin\n2000\t/root/.cache/junk\n`), stderr: "", timedOut: false } : real(id, script, args));
  await checkDisk(bots.byId(a)!, { force: true });
  await checkDisk(bots.byId(a)!, { force: true });
  diskRunner.run = real;
  const rows = (await call("GET", `/bots/${a}/rows?limit=200`)).json.rows;
  const cards = rows.filter((r: any) => r.body.kind === "card" && r.body.card.type === "disk");
  assert.equal(cards.length, 1);
  const card = cards[0];
  assert.equal(card.body.card.usedPct, 100);
  const url = `/bots/${a}/cards/${card.seq}/disk`;
  assert.equal((await call("POST", url, { action: "delete", paths: ["/root/files/big.bin"] })).status, 400, "not without confirmation");
  assert.equal((await call("POST", url, { action: "delete", paths: ["/root/.codex/keep"], confirm: true })).status, 400, "not a listed path");
  assert.equal((await call("POST", url, { action: "delete", paths: ["/root/files/big.bin"], confirm: true })).status, 200);
  assert.equal(await sh(a, "test -e /root/files/big.bin && echo yes || echo no"), "no");
  assert.equal(await sh(a, "test -e /root/.cache/junk/x && echo yes || echo no"), "yes", "what was not ticked stays");
  const after = (await call("GET", `/bots/${a}/rows?limit=200`)).json.rows.find((r: any) => r.seq === card.seq);
  assert.equal(after.body.card.status, "cleaned");
  assert.deepEqual(after.body.card.deleted, ["/root/files/big.bin"]);
  assert.equal((await call("POST", url, { action: "dismiss" })).status, 409, "answered once");

  // Even a listed path is never followed through a link into the team folder.
  writeFileSync(path.join(teamDirOf(userId), "precious.txt"), "do not delete");
  const r = await deleteListed(bots.byId(a)!, [{ path: "/root/sneaky/precious.txt", bytes: 1 }], ["/root/sneaky/precious.txt"]);
  assert.deepEqual(r.deleted, []);
  assert.ok(existsSync(path.join(teamDirOf(userId), "precious.txt")));
  void workspaceOf;
});

test("an asleep computer is measured without being woken", async () => {
  await screen.sleep(a);
  const report = await checkDisk(bots.byId(a)!, { force: true });
  assert.ok(report && report.items.some((i) => i.path.startsWith("/root/.cache")));
  assert.equal(screen.isOpen(a), false);
  assert.equal((await docker(["ps", "-a", "--filter", "label=sklubot=disk-check", "--format", "{{.Names}}"])).stdout.toString().trim(), "", "the throwaway container is gone");
});
