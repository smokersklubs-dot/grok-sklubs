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

const { computerKind, computerState, initComputer, runShell, saveFile, screen, workspaceOf } = await import("../src/computer.js");
await initComputer();
const linux = computerKind() === "linux";
const skip = !linux && "no container runtime or desktop image here (npm run computer:build)";

const A = "bot_linux_a", B = "bot_linux_b", USER = "usr_1";
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
