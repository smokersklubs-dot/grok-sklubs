import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// H2 and Part B on real computers (Docker and the desktop image): the bots' own network (no traffic between computers),
// each computer's own socket to this server (only its bots' routes), and shared computers (one container per account,
// each bot's own library at ~/files). Skipped when Docker or the desktop image is missing.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-link-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "4";
process.env.BOT_LINK = "socket";
process.env.BOTS_NETWORK = "sklubot_bots_linktest";
process.env.DISK_ALERT_PERCENT = "99";
delete process.env.DATA_VOLUME;

const { docker, linuxReady } = await import("../src/linux.js");
const ready = await linuxReady();
const skip = ready.ok ? false : `no Docker computers here: ${ready.reason}`;

const { initComputer, runShell, screen, workspaceOf } = await import("../src/computer.js");
const { botLinkRoutes } = await import("../src/routes.js");
const { initBotLinks, closeAllBotLinks } = await import("../src/botlink.js");
const { membersOf, sharedComputers } = await import("../src/sharedcomputers.js");
const { containerName } = await import("../src/linux.js");
const { bots, users } = await import("../src/store.js");

const u1 = users.create("live1@example.com", "Live one", "x");
const u2 = users.create("live2@example.com", "Live two", "x");
const x = bots.create(u1.id, { name: "Own" });
const a = bots.create(u1.id, { name: "Ana" });
const b = bots.create(u1.id, { name: "Ben" });
const c = bots.create(u2.id, { name: "Cy" });
for (const s of [a, b, c]) bots.patch(s.id, { computerMode: "shared" });

if (!skip) { initBotLinks(botLinkRoutes, membersOf); await initComputer(); }

const sh = async (botId: string, userId: string, cmd: string) => (await runShell(botId, userId, cmd, 30)).output.trim();
after(async () => {
  if (skip) return;
  for (const id of [x.id]) await screen.reset(id).catch(() => {});
  for (const u of [u1, u2]) for (const sc of sharedComputers.list(u.id)) await screen.resetShared(sc.id).catch(() => {});
  closeAllBotLinks();
  await docker(["network", "rm", "sklubot_bots_linktest"]);
});

test("H2: a computer sits on the bots' own network, reaches this server only through its socket, only for its own bot", { skip }, async () => {
  const opts = (await docker(["network", "inspect", "sklubot_bots_linktest", "--format", "{{json .Options}}"])).stdout.toString();
  assert.match(opts, /"com.docker.network.bridge.enable_icc":"false"/);
  const net = (await docker(["inspect", "--format", "{{json .NetworkSettings.Networks}}", containerName(x.id)])).code;
  assert.equal(net, 1, "no computer yet");
  const hostname = await sh(x.id, u1.id, "hostname");
  assert.equal(hostname, "computer");
  const nets = JSON.parse((await docker(["inspect", "--format", "{{json .NetworkSettings.Networks}}", containerName(x.id)])).stdout.toString());
  assert.deepEqual(Object.keys(nets), ["sklubot_bots_linktest"]);
  // The forwarder is up a moment after the wake.
  const code = (url: string, method = "POST") => sh(x.id, u1.id, `for i in 1 2 3 4 5 6 7 8 9 10; do o=$(curl -s -o /dev/null -w '%{http_code}' -X ${method} -m 5 ${url}) && [ "$o" != 000 ] && break; sleep 0.5; done; echo $o`);
  assert.equal(await code(`http://127.0.0.1:39100/mcp/${x.id}`), "401", "its own bot's endpoint answers (no token: refused)");
  assert.equal(await code(`http://127.0.0.1:39100/mcp/${a.id}`), "404", "another bot's endpoint does not exist on this socket");
  assert.equal(await code(`http://127.0.0.1:39100/mcp/${c.id}`), "404");
  assert.equal(await code("http://127.0.0.1:39100/api/health", "GET"), "404", "nothing else of the server is reachable");
  assert.equal(await code(`http://127.0.0.1:39100/egress/${a.id}/k/api.example.com/`, "GET"), "404");
  assert.equal(await code(`http://127.0.0.1:39100/egress/${x.id}/k/api.example.com/`, "GET"), "401");
  // The socket folder is read-only in the computer.
  assert.match(await sh(x.id, u1.id, "touch /run/sklubot/x 2>&1 || true"), /Read-only/);
});

test("Part B: bots of one account share one computer, each with its own library at ~/files; another account has its own", { skip }, async () => {
  const sa = await sh(a.id, u1.id, "echo from-ana > ~/files/ana.txt; readlink /root/files; cat /etc/hostname >/dev/null; echo $(hostname)");
  const sb = await sh(b.id, u1.id, "echo from-ben > ~/files/ben.txt; readlink /root/files; ls ~/files");
  assert.equal(containerName(a.id), containerName(b.id));
  assert.match(sa, new RegExp(`/root/libraries/${a.id}`));
  assert.match(sb, new RegExp(`/root/libraries/${b.id}`));
  assert.doesNotMatch(sb, /ana\.txt/);
  assert.equal(readFileSync(path.join(workspaceOf(a.id), "ana.txt"), "utf8").trim(), "from-ana");
  assert.equal(readFileSync(path.join(workspaceOf(b.id), "ben.txt"), "utf8").trim(), "from-ben");
  assert.ok(!existsSync(path.join(workspaceOf(a.id), "ben.txt")));
  // The home folder (sign-ins, browser) is shared.
  await sh(a.id, u1.id, "echo signed-in > ~/.shared-proof");
  assert.equal(await sh(b.id, u1.id, "cat ~/.shared-proof"), "signed-in");
  // Another account: another computer, which cannot see the first one's files.
  assert.notEqual(containerName(c.id), containerName(a.id));
  assert.equal(await sh(c.id, u2.id, "cat ~/.shared-proof 2>/dev/null || echo none"), "none");
  // The shared computer's socket answers its own bots, not the other account's.
  const code = (url: string) => sh(a.id, u1.id, `curl -s -o /dev/null -w '%{http_code}' -X POST -m 5 ${url}`);
  assert.equal(await code(`http://127.0.0.1:39100/mcp/${b.id}`), "401");
  assert.equal(await code(`http://127.0.0.1:39100/mcp/${c.id}`), "404");
});

test("H2: computers cannot reach each other on the bots' network", { skip }, async () => {
  const ipOf = async (name: string) => (await docker(["inspect", "--format", "{{(index .NetworkSettings.Networks \"sklubot_bots_linktest\").IPAddress}}", name])).stdout.toString().trim();
  const other = await ipOf(containerName(c.id));
  assert.match(other, /^\d+\.\d+\.\d+\.\d+$/);
  // A web server in one computer: unreachable from another one, while the computer itself reaches it.
  await sh(c.id, u2.id, "(setsid python3 -m http.server 8099 --bind 0.0.0.0 >/dev/null 2>&1 &) ; sleep 1; echo started");
  assert.equal(await sh(c.id, u2.id, "curl -s -o /dev/null -w '%{http_code}' -m 3 http://127.0.0.1:8099/"), "200");
  const out = await sh(x.id, u1.id, `curl -s -o /dev/null -w '%{http_code}' -m 3 http://${other}:8099/ || true`);
  assert.equal(out.replace(/\D/g, "") || "000", "000");
});
