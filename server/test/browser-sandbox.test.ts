import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// L48 — Chromium's own sandbox in the bots' computers: the browser runs as the user "browser", the computer is created
// with Sklubot's seccomp profile (Docker's default plus user namespaces), and --no-sandbox never comes back on the
// normal path. The first tests read the files and the docker arguments; the last one starts a real computer when Docker
// and an image with the sandbox are here (SKLUBOT_TEST_DESKTOP_IMAGE can name one, e.g. a thin test layer).
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-sandbox-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "linux";
process.env.MAX_DESKTOPS = "2";
if (process.env.SKLUBOT_TEST_DESKTOP_IMAGE) process.env.DESKTOP_IMAGE = process.env.SKLUBOT_TEST_DESKTOP_IMAGE;

const ROOT = path.resolve(import.meta.dirname, "../..");
const read = (p: string) => readFileSync(path.join(ROOT, p), "utf8");
const sb = await import("../src/browsersandbox.js");
const { computerRunArgs, docker, containerName, linuxScreen, linuxShell } = await import("../src/linux.js");
const { checkCreate, policyFromEnv } = await import("../src/dockerproxy.js");
const { judgeSandbox } = await import("../src/browserfreshness.js");

const NS = { NEWNS: 0x00020000, NEWCGROUP: 0x02000000, NEWUTS: 0x04000000, NEWIPC: 0x08000000, NEWUSER: 0x10000000, NEWPID: 0x20000000, NEWNET: 0x40000000 };

test("open-browser.sh: the browser starts as the user 'browser' without --no-sandbox; the flag only exists in the marked fallbacks", () => {
  const sh = read("docker/desktop/open-browser.sh");
  const lines = sh.split("\n");
  const launch = lines.filter((l) => /\$AS chromium "\$@"/.test(l));
  assert.equal(launch.length, 1, "one normal launch line");
  assert.doesNotMatch(launch[0], /no-sandbox/, "the normal launch never carries --no-sandbox");
  assert.match(sh, /setpriv --reuid=\$BUSER --regid=\$BUSER --init-groups env -i /, "drops to the browser user with a clean environment");
  // Every --no-sandbox is a fallback that says so first (the owner sees it: browserfreshness.ts).
  const flagged = lines.map((l, i) => [l, i] as const).filter(([l]) => /--no-sandbox/.test(l) && !l.trimStart().startsWith("#"));
  assert.equal(flagged.length, 2, flagged.map(([l]) => l).join("\n"));
  for (const [l, i] of flagged) assert.ok(/echo "off/.test(l) || /echo "off/.test(lines[i - 1] ?? ""), `unmarked --no-sandbox: ${l}`);
  // The old flag set is gone from the start of the options.
  assert.doesNotMatch(sh, /exec chromium --no-sandbox --test-type/);
});

test("the image makes the browser user, labels itself, and keeps the profile path the server protects", () => {
  const df = read("docker/desktop/Dockerfile");
  assert.match(df, /useradd --uid 1001 --user-group --create-home --shell \/usr\/sbin\/nologin browser/);
  assert.match(df, /LABEL sklubot\.browser-sandbox="1"/);
  assert.match(read("docker/desktop/open-browser.sh"), /PROFILE=\/root\/.config\/sklubot-browser/);
  assert.match(read("Dockerfile.production"), /COPY docker\/desktop\/seccomp-chromium\.json docker\/desktop\/seccomp-chromium\.json/);
  assert.match(read("docker/desktop/sound.sh"), /chmod 711 \/tmp\/pulse/);
});

test("the seccomp profile is Docker's default plus three narrow rules (user, PID and network namespaces; chroot)", () => {
  const prof = JSON.parse(read("docker/desktop/seccomp-chromium.json"));
  assert.equal(prof.defaultAction, "SCMP_ACT_ERRNO");
  const ours = prof.syscalls.filter((s: { comment?: string }) => s.comment?.startsWith("Sklubot (L48)"));
  assert.deepEqual(ours.map((s: { names: string[] }) => s.names.join()), ["clone", "unshare", "chroot"]);
  for (const s of ours) assert.equal(s.action, "SCMP_ACT_ALLOW");
  const [clone, unshare] = ours;
  const cloneMask = clone.args[0].value, unshareMask = unshare.args[0].value;
  assert.equal(clone.args[0].op, "SCMP_CMP_MASKED_EQ"); assert.equal(clone.args[0].valueTwo, 0);
  // clone: mount, cgroup, UTS and IPC namespaces stay refused; user, PID and network ones are allowed.
  assert.equal(cloneMask, NS.NEWNS | NS.NEWCGROUP | NS.NEWUTS | NS.NEWIPC);
  // unshare: only a user namespace.
  assert.equal(unshareMask, NS.NEWNS | NS.NEWCGROUP | NS.NEWUTS | NS.NEWIPC | NS.NEWPID | NS.NEWNET);
  assert.equal(unshareMask & NS.NEWUSER, 0);
  // Nothing else opened: mount, setns, bpf… stay behind CAP_SYS_ADMIN, as in Docker's default.
  const openly = (name: string) => prof.syscalls.some((s: { names: string[]; action: string; includes?: { caps?: string[] } }) =>
    s.names.includes(name) && s.action === "SCMP_ACT_ALLOW" && !(s.includes?.caps?.length));
  for (const n of ["mount", "umount2", "setns", "pivot_root", "bpf", "keyctl", "open_tree", "move_mount"]) assert.equal(openly(n), false, `${n} must not be allowed`);
  assert.equal(prof.syscalls.length, 65, "Docker's 62 rules + ours");
});

test("docker run: the profile is passed only for an image with the sandbox; no capability is added, no-new-privileges stays", () => {
  const opts = { libraries: [{ dir: "/tmp/x", dst: "/root/files" }], team: null, quota: [] };
  sb.resetBrowserSandbox(false);
  const old = computerRunArgs("bot_sb", opts);
  assert.ok(!old.some((a) => a.startsWith("seccomp=")), "an older image keeps Docker's default profile");
  assert.ok(!old.find((a) => a.startsWith("sklubot.spec="))!.includes(";sb:"));
  sb.resetBrowserSandbox(true);
  const now = computerRunArgs("bot_sb", opts);
  const i = now.indexOf(`seccomp=${sb.SECCOMP_PROFILE_PATH}`);
  assert.ok(i > 0 && now[i - 1] === "--security-opt", now.join(" "));
  assert.ok(now.includes("no-new-privileges"));
  assert.ok(!now.includes("--privileged"));
  const caps = now.flatMap((a, k) => (now[k - 1] === "--cap-add" ? [a] : []));
  assert.deepEqual(caps, ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "KILL", "AUDIT_WRITE"]);
  assert.match(now.find((a) => a.startsWith("sklubot.spec="))!, /;sb:[0-9a-f]{12}$/, "computers made from the older image are made again");
  sb.resetBrowserSandbox();
});

test("Sklubot's Docker proxy lets exactly this profile through, nothing else", () => {
  const policy = policyFromEnv({ DESKTOP_IMAGE: "sklubot-desktop", PROXY_NETWORKS: "sklubot_bots", PROXY_DATA_VOLUME: "sklubot_data" });
  assert.equal(policy.seccompProfiles.length, 1);
  const compact = JSON.stringify(JSON.parse(read("docker/desktop/seccomp-chromium.json")));
  const body = (sec: string[]) => ({ Image: "sklubot-desktop", Labels: { sklubot: "desktop" }, HostConfig: { NetworkMode: "sklubot_bots", CapDrop: ["ALL"], SecurityOpt: sec } });
  assert.equal(checkCreate(body(["no-new-privileges", `seccomp=${compact}`]), new URLSearchParams(), policy), null);
  const wider = JSON.parse(compact); wider.syscalls.push({ names: ["mount"], action: "SCMP_ACT_ALLOW" });
  assert.match(String(checkCreate(body(["no-new-privileges", `seccomp=${JSON.stringify(wider)}`]), new URLSearchParams(), policy)), /not Sklubot's browser profile/);
  assert.match(String(checkCreate(body(["no-new-privileges", "seccomp=unconfined"]), new URLSearchParams(), policy)), /seccomp=unconfined/);
  assert.match(String(checkCreate(body([`seccomp=${compact}`]), new URLSearchParams(), policy)), /no-new-privileges/);
  assert.deepEqual(policyFromEnv({ PROXY_SECCOMP_PROFILES: "/nowhere.json" }).seccompProfiles, []);
});

test("the owner's notice: state of the sandbox, and open-browser.sh's state line", () => {
  assert.equal(judgeSandbox({ image: true, profile: true, oldComputers: 0, unsandboxed: 0 }).state, "ok");
  assert.equal(judgeSandbox({ image: false, profile: true, oldComputers: 3, unsandboxed: 0 }).state, "warn");
  assert.equal(judgeSandbox({ image: true, profile: true, oldComputers: 1, unsandboxed: 0 }).state, "warn");
  assert.equal(judgeSandbox({ image: true, profile: true, oldComputers: 0, unsandboxed: 1 }).state, "warn");
  assert.equal(judgeSandbox({ image: true, profile: false, oldComputers: 0, unsandboxed: 0 }).state, "warn");
  assert.equal(judgeSandbox({ image: null, profile: true, oldComputers: 0, unsandboxed: 0 }).state, "unknown");
  assert.deepEqual(sb.parseSandboxState("on\n"), { on: true, reason: "" });
  assert.deepEqual(sb.parseSandboxState("off no usable sandbox\n"), { on: false, reason: "no usable sandbox" });
  assert.deepEqual(sb.parseSandboxState(""), { on: null, reason: "" });
});

// ── A real computer ──────────────────────────────────────────────────────────
const image = process.env.DESKTOP_IMAGE ?? "sklubot-desktop";
const label = await docker(["image", "inspect", image, "--format", `{{index .Config.Labels "${sb.SANDBOX_LABEL}"}}`], { timeoutMs: 8000 }).catch(() => null);
const real = label?.code === 0 && label.stdout.toString().trim() === "1";
const skip = !real && `no Docker or no desktop image with the browser sandbox here (${image}; build it, or set SKLUBOT_TEST_DESKTOP_IMAGE)`;
const B = "bot_sandbox_real", USER = "usr_sb";
after(async () => { await linuxScreen.destroy(B).catch(() => {}); });

test("a real computer: Chromium runs sandboxed as 'browser' (chrome://sandbox), CDP answers, downloads land in ~/Downloads", { skip, timeout: 240_000 }, async () => {
  sb.resetBrowserSandbox();
  const ws = mkdtempSync(path.join(tmpdir(), "sklubot-sandbox-ws-"));
  assert.equal((await linuxShell(B, USER, ws, "id -u", 60)).output.trim(), "0", "the bot's shell stays root");
  const name = containerName(B);
  const sh = async (cmd: string) => (await docker(["exec", name, "bash", "-c", cmd], { timeoutMs: 60_000 })).stdout.toString("utf8").trim();
  const inspect = JSON.parse((await docker(["inspect", "--format", "{{json .HostConfig.SecurityOpt}}", name])).stdout.toString());
  assert.ok(inspect.includes("no-new-privileges") && inspect.some((s: string) => s.startsWith("seccomp=")), JSON.stringify(inspect).slice(0, 200));
  await docker(["exec", name, "sh", "-c", "pkill -f sklubot-browser; sleep 1; true"]);
  await docker(["exec", "-d", name, "/opt/sklubot/open-browser.sh", "about:blank"]);
  let up = false;
  for (let i = 0; i < 80 && !up; i++) { up = (await docker(["exec", name, "curl", "-fsS", "-m", "1.5", "-o", "/dev/null", "http://127.0.0.1:9222/json/version"])).code === 0; if (!up) await new Promise((r) => setTimeout(r, 500)); }
  assert.ok(up, "CDP answers on 127.0.0.1:9222");
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(await sh("cat /tmp/sklubot-browser-sandbox"), "on");
  const procs = await sh("ps -eo user:12,args | grep '[/]usr/lib/chromium/chromium'");
  assert.ok(procs.length > 0);
  assert.doesNotMatch(procs, /--no-sandbox/, "no Chromium process carries --no-sandbox");
  assert.ok(procs.split("\n").every((l) => l.startsWith("browser")), procs);
  // Renderers live in a PID namespace of their own (the namespace sandbox): /proc/<pid>/status lists two ids on NSpid.
  const nspid = await sh("for p in $(pgrep -f '^/usr/lib/chromium/chromium .*--type=renderer'); do grep '^NSpid:' /proc/$p/status; done");
  assert.ok(nspid.length > 0, "renderers are running");
  for (const line of nspid.split("\n")) assert.ok(line.trim().split(/\s+/).length >= 3, `a renderer outside a namespace: ${line}`);
  // Chromium's own verdict.
  const page = await sh(`python3 - <<'EOF'
import json, urllib.request, time
from websocket import create_connection
t = json.load(urllib.request.urlopen(urllib.request.Request("http://127.0.0.1:9222/json/new?chrome://sandbox", method="PUT")))
time.sleep(2)
ws = create_connection(t["webSocketDebuggerUrl"], origin="http://127.0.0.1:9222")
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": "document.body.innerText", "returnByValue": True}}))
print(json.loads(ws.recv())["result"]["result"]["value"])
ws.send(json.dumps({"id": 2, "method": "Runtime.evaluate", "params": {"expression": "(()=>{const a=document.createElement('a');a.href=URL.createObjectURL(new Blob(['bonjour']));a.download='essai-sandbox.txt';document.body.appendChild(a);a.click();return 1})()", "userGesture": True}}))
ws.recv()
EOF`);
  assert.match(page, /Layer 1 Sandbox\s+Namespace/);
  assert.match(page, /Seccomp-BPF sandbox\s+Yes/);
  assert.match(page, /You are adequately sandboxed\./);
  let saved = "";
  for (let i = 0; i < 20 && saved !== "bonjour"; i++) { saved = await sh("cat /root/Downloads/essai-sandbox.txt 2>/dev/null"); if (saved !== "bonjour") await new Promise((r) => setTimeout(r, 500)); }
  assert.equal(saved, "bonjour", "a download lands in the bot's ~/Downloads, readable by its root shell");
  assert.equal(await sh("stat -c %a /root"), "711", "the browser user may pass through /root, not list it");
  // Sound still reaches the computer's virtual sound card (listen_screen), when the image has it.
  if (await sh("command -v pactl || true")) {
    await sh(`python3 - <<'EOF'
import json, urllib.request
from websocket import create_connection
t = [t for t in json.load(urllib.request.urlopen("http://127.0.0.1:9222/json")) if t["type"] == "page"][0]
ws = create_connection(t["webSocketDebuggerUrl"], origin="http://127.0.0.1:9222")
ws.send(json.dumps({"id": 1, "method": "Runtime.evaluate", "params": {"expression": "(()=>{const c=new AudioContext();const o=c.createOscillator();o.connect(c.destination);o.start();return c.state})()", "userGesture": True}}))
ws.recv()
EOF`);
    let clients = "";
    for (let i = 0; i < 20 && !/chromium/.test(clients); i++) { clients = await sh("pactl list short clients"); if (!/chromium/.test(clients)) await new Promise((r) => setTimeout(r, 500)); }
    assert.match(clients, /chromium/, "the browser plays into the sound card");
  }
});
