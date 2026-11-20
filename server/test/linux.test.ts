import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { networkInterfaces, tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-linux-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "auto";
process.env.MAX_DESKTOPS = "1";

const { attachmentAt, computerKind, computerState, initComputer, listFiles, readLibraryFile, runShell, saveFile, screen, storeBytes, workspaceOf } = await import("../src/computer.js");
await initComputer();
const linux = computerKind() === "linux";
const skip = !linux && "no container runtime or desktop image here (npm run computer:build)";

const A = "bot_linux_a", B = "bot_linux_b", USER = "usr_1";
test("a silent meeting on the bot's desktop saves the exact end of its own upload", { skip }, async () => {
  const { meetingTranscribe } = await import("../src/meetings.js");
  const { wavOf } = await import("../src/voice/vad.js");
  const { users, bots } = await import("../src/store.js");
  const user = users.create("meeting@desktop.test", "Meeting", "x", "fr");
  const bot = bots.create(user.id, { name: "Meeting" });
  try {
    const file = storeBytes(bot.id, "uploads", "reunion.wav", wavOf(new Int16Array(16000)));
    const ctx = { user, bot, depth: 0, signal: AbortSignal.timeout(90000) };
    const result = await meetingTranscribe.run({ file: file.path }, ctx);
    assert.equal(result.isError, undefined, String(result.content));
    const match = /Saved (meetings\/[0-9a-f]+\/00000000\.txt)/.exec(String(result.content));
    assert.ok(match);
    assert.match(readLibraryFile(bot.id, match[1]).toString(), /0s – 1\.0s/);
    assert.throws(() => readLibraryFile(B, match[1]));
  } finally { await screen.reset(bot.id); }
});
// A page served from this machine, reachable from inside the bot's computer through the container bridge.
const site = createServer((_req, res) => {
  res.setHeader("content-type", "text/html");
  res.end(`<title>Bridge page</title><body style="margin:0"><h1 id="h">Waiting</h1><button onclick="document.getElementById('h').textContent='Pressed'" style="position:fixed;left:0;top:0;width:100vw;height:100vh;font-size:40px">Press</button>`);
});
await new Promise<void>((r) => site.listen(0, "0.0.0.0", () => r()));
const port = (site.address() as { port: number }).port;
const hostIp = Object.entries(networkInterfaces()).find(([name]) => name === "docker0")?.[1]?.find((a) => a.family === "IPv4")?.address ?? "172.17.0.1";

after(async () => {
  site.closeAllConnections(); site.close();
  if (linux) { await screen.reset(A); await screen.reset(B); }
});

test("a bot gets its own Linux computer with a desktop and a root shell", { skip }, async () => {
  const who = await runShell(A, USER, "whoami && cat /etc/os-release | head -1 && echo $DISPLAY", 30);
  assert.equal(who.code, 0);
  assert.match(who.output, /^root\n/);
  assert.match(who.output, /Debian/);
  assert.match(who.output, /:1/);
  const shot = await screen.view(A, USER);
  assert.ok(Buffer.from(shot.data, "base64").length > 3000, "the screen shows a desktop");
  assert.deepEqual(computerState(USER).desktops.map((d) => [d.botId, d.open]), [[A, true]]);
});

test("the server's secrets and files are not visible from the bot's computer", { skip }, async () => {
  const r = await runShell(A, USER, "echo secret=[$SESSION_SECRET]; ls /home /root/files | tr '\\n' ' '", 30);
  assert.match(r.output, /secret=\[\]/);
  assert.doesNotMatch(r.output, /grok-sklubs/);
});

test("files flow both ways between the library and ~/files", { skip }, async () => {
  saveFile(A, "from-server.txt", "hello bot");
  assert.equal((await runShell(A, USER, "cat ~/files/from-server.txt && echo made-here > ~/files/from-bot.txt", 30)).output.trim(), "hello bot");
  assert.equal(readFileSync(path.join(workspaceOf(A), "from-bot.txt"), "utf8").trim(), "made-here");
});

test("the bot can open a page in its browser, read it and click on it", { skip }, async () => {
  const opened = await screen.open(A, USER, `http://${hostIp}:${port}/`);
  writeFileSync(path.join(process.env.DATA_DIR!, "linux-browser.jpg"), Buffer.from(opened.data, "base64"));
  let page = { title: "", text: "" };
  for (let i = 0; i < 20 && page.title !== "Bridge page"; i++) { await new Promise((r) => setTimeout(r, 500)); page = await screen.read(A, USER).catch(() => page); }
  assert.equal(page.title, "Bridge page");
  assert.match(page.text, /Waiting/);
  await screen.click(A, USER, 640, 500);
  assert.match((await screen.read(A, USER)).text, /Pressed/);
  assert.ok((await screen.peek(A))!.length > 3000);
});

test("typed text arrives exactly, including awkward characters", { skip }, async () => {
  // Wait for the terminal window to really be there (a fixed pause was flaky on a busy machine), and focus it.
  await runShell(A, USER, "pkill chromium; rm -f /tmp/typed.txt; (xterm -title typetest -e 'read -r line; printf %s \"$line\" > /tmp/typed.txt' &) ; for i in $(seq 1 100); do DISPLAY=:1 wmctrl -l | grep -q typetest && break; sleep 0.1; done; DISPLAY=:1 wmctrl -a typetest; sleep 0.3", 30);
  // No click: a fixed point can miss the small terminal window and take its focus away (the window is already focused above).
  await screen.type(A, USER, `p@ss "w0rd" $HOME & it's`);
  await screen.key(A, USER, "Enter");
  assert.equal((await runShell(A, USER, "for i in $(seq 1 50); do [ -s /tmp/typed.txt ] && break; sleep 0.1; done; cat /tmp/typed.txt", 30)).output, `p@ss "w0rd" $HOME & it's`);
});

test("what a bot installs survives sleep, and only so many computers run at once", { skip }, async () => {
  await runShell(A, USER, "echo kept > ~/note.txt", 30);
  // MAX_DESKTOPS=1: waking B puts A to sleep.
  assert.match((await runShell(B, USER, "hostname", 30)).output, /computer/);
  assert.deepEqual(computerState(USER).desktops.map((d) => [d.botId, d.open]).sort(), [[A, false], [B, true]]);
  assert.equal(await screen.peek(A), null, "looking at a sleeping computer does not wake it");
  assert.equal((await runShell(A, USER, "cat ~/note.txt", 30)).output.trim(), "kept");
  assert.equal((await runShell(B, USER, "cat ~/note.txt 2>&1", 30)).code, 1, "each bot's computer is separate");
});

test("a long command is cut off at its time limit", { skip }, async () => {
  const r = await runShell(A, USER, "sleep 30", 2);
  assert.equal(r.timedOut, true);
});

test("links a bot makes in its library never reach the server's own files", { skip }, async () => {
  // In the bot's computer these point at its own /etc; read by the server they would be the server's.
  const made = await runShell(A, USER, "cd ~/files && ln -sf /etc/hostname leak.txt && ln -sfn /etc etc-dir && mkfifo pipe && echo plain > plain.txt && echo ok", 30);
  assert.match(made.output, /ok/);
  assert.equal(attachmentAt(A, "leak.txt"), null);
  assert.throws(() => readLibraryFile(A, "leak.txt"));
  assert.throws(() => readLibraryFile(A, "etc-dir/hostname"));
  assert.throws(() => readLibraryFile(A, "pipe"), "a pipe is refused at once, not waited on");
  assert.throws(() => saveFile(A, "etc-dir/sklubot-was-here", "x"));
  assert.throws(() => saveFile(A, "leak.txt", "overwritten"));
  assert.throws(() => storeBytes(A, "etc-dir", "x.txt", Buffer.from("x")));
  assert.equal(readFileSync("/etc/hostname", "utf8").includes("overwritten"), false);
  const names = listFiles(A).map((e) => e.name);
  assert.ok(names.includes("plain.txt"));
  assert.equal(names.some((n) => ["leak.txt", "etc-dir", "pipe"].includes(n)), false, "links and pipes are not listed");
  assert.equal(readLibraryFile(A, "plain.txt").toString().trim(), "plain");
});

test("a bot's computer runs with few privileges, yet installs and the desktop still work", { skip }, async () => {
  const r = await runShell(A, USER, "grep -E '^(CapEff|NoNewPrivs)' /proc/self/status; mknod /tmp/dev c 1 3 2>&1 | head -1; touch /tmp/o && chown nobody /tmp/o && echo chown-ok; su nobody -s /bin/sh -c id", 30);
  const capEff = BigInt("0x" + /CapEff:\s*([0-9a-f]+)/.exec(r.output)![1]);
  // CHOWN 0, DAC_OVERRIDE 1, FOWNER 3, KILL 5, SETGID 6, SETUID 7, AUDIT_WRITE 29: nothing else.
  assert.equal(capEff, (1n << 0n) | (1n << 1n) | (1n << 3n) | (1n << 5n) | (1n << 6n) | (1n << 7n) | (1n << 29n));
  assert.match(r.output, /NoNewPrivs:\s*1/);
  assert.match(r.output, /Operation not permitted/, "no device nodes");
  assert.match(r.output, /chown-ok/);
  assert.match(r.output, /uid=65534\(nobody\)/);
  assert.ok(Buffer.from((await screen.view(A, USER)).data, "base64").length > 3000, "the desktop is up");
});
