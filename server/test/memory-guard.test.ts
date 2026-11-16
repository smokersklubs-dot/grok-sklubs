import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// deploy/memory-guard.sh (swap file + earlyoom for the VPS installer), against fake system commands that write down
// what they are asked. Nothing of this machine is touched: every path the script writes is in a temporary folder.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repo, "deploy", "memory-guard.sh");
const GIB = 1024 * 1024; // KiB

/** The size rule alone: swap_size_gib <memory KiB> <free disk KiB>. */
function size(memKib: number, freeKib: number): number {
  const r = spawnSync("bash", ["-c", `source "${script}"; swap_size_gib ${memKib} ${freeKib}`], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return Number(r.stdout.trim());
}

test("swap size rule: memory rounded up, 2 to 4 GB, none from 8 GB, 5 GB of disk always kept free", () => {
  const disk = 100 * GIB;
  assert.equal(size(1 * GIB - 100, disk), 2);
  assert.equal(size(2 * GIB, disk), 2);
  assert.equal(size(3 * GIB - 50_000, disk), 3);
  assert.equal(size(4 * GIB, disk), 4);
  assert.equal(size(6 * GIB, disk), 4);
  assert.equal(size(8 * GIB, disk), 0);
  assert.equal(size(2 * GIB, 7 * GIB), 2, "7 GB free: 2 GB swap leaves 5");
  assert.equal(size(4 * GIB, 7 * GIB), 2, "shrunk to what leaves 5 GB");
  assert.equal(size(2 * GIB, 5.5 * GIB), 0, "under 1 GB: none");
});

function setup(o: { memKib: number; swaps?: string; freeKib?: number; fs?: string; swaponFails?: boolean; earlyoom?: "installed" | "missing" | "unavailable"; defaults?: string }) {
  const root = mkdtempSync(path.join(tmpdir(), "sklubot-mem-"));
  const bin = path.join(root, "bin"), etc = path.join(root, "etc");
  mkdirSync(bin); mkdirSync(etc);
  const log = path.join(root, "cmd.log");
  const fake = (name: string, body: string) => { writeFileSync(path.join(bin, name), `#!/usr/bin/env bash\necho "${name} $*" >> "${log}"\n${body}\n`); chmodSync(path.join(bin, name), 0o755); };
  writeFileSync(path.join(root, "meminfo"), `MemTotal:       ${o.memKib} kB\nMemFree:          100000 kB\n`);
  const swaps = path.join(root, "swaps");
  writeFileSync(swaps, `Filename\t\t\t\tType\t\tSize\t\tUsed\t\tPriority\n${o.swaps ?? ""}`);
  fake("df", `printf 'Filesystem 1024-blocks Used Available Capacity Mounted\\n/dev/vda 100 50 ${o.freeKib ?? 100 * GIB} 50%% /\\n'`);
  fake("stat", `echo ${o.fs ?? "ext2/ext3"}`);
  fake("fallocate", `: > "\${@: -1}"`);
  fake("mkswap", "exit 0");
  // swapon: a working one adds the file to the fake /proc/swaps, as the kernel would.
  fake("swapon", o.swaponFails ? "exit 1" : `printf '%s file 2097148 0 -2\\n' "$1" >> "${swaps}"`);
  fake("sysctl", "exit 0");
  const eo = path.join(bin, "earlyoom");
  if (o.earlyoom !== "missing" && o.earlyoom !== "unavailable") fake("earlyoom", "exit 0");
  fake("apt-get", o.earlyoom === "unavailable" ? "exit 100" : `[ "$1" = install ] && printf '#!/bin/sh\\nexit 0\\n' > "${eo}" && chmod +x "${eo}"; exit 0`);
  const defaults = path.join(etc, "default-earlyoom");
  if (o.defaults !== undefined) writeFileSync(defaults, o.defaults);
  const fstab = path.join(etc, "fstab");
  writeFileSync(fstab, "UUID=abc / ext4 defaults 0 1\n");
  const env = {
    ...process.env, PATH: `${bin}:/usr/bin:/bin`, SKLUBOT_ALLOW_NONROOT: "1", SKLUBOT_MEMINFO: path.join(root, "meminfo"), SKLUBOT_PROC_SWAPS: swaps,
    SKLUBOT_SWAPFILE: path.join(root, "swapfile"), SKLUBOT_FSTAB: fstab, SKLUBOT_SYSCTL_FILE: path.join(etc, "sysctl.conf"), SKLUBOT_EARLYOOM_DEFAULTS: defaults,
  };
  const run = () => spawnSync("bash", [script], { encoding: "utf8", env, timeout: 20_000 });
  const cmds = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { root, run, cmds, fstab, defaults, swapfile: env.SKLUBOT_SWAPFILE, sysctl: env.SKLUBOT_SYSCTL_FILE };
}

test("small server without swap: a swap file is made, added to fstab once, earlyoom installed and set to spare node/ssh/docker", () => {
  const s = setup({ memKib: 2 * GIB, earlyoom: "missing" });
  const r = s.run();
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /Swap : 2 Go actifs/);
  assert.ok(s.cmds().includes(`fallocate -l 2G ${s.swapfile}`), s.cmds().join("\n"));
  assert.ok(s.cmds().includes(`mkswap ${s.swapfile}`));
  assert.equal((Number.parseInt((spawnSync("stat", ["-c", "%a", s.swapfile], { encoding: "utf8" }).stdout || "0"), 10)), 600);
  assert.match(readFileSync(s.fstab, "utf8"), new RegExp(`^${s.swapfile} none swap sw 0 0$`, "m"));
  assert.match(readFileSync(s.sysctl, "utf8"), /^vm.swappiness=10$/m);
  assert.ok(s.cmds().some((c) => c.startsWith("apt-get install -y -qq earlyoom")));
  const conf = readFileSync(s.defaults, "utf8");
  const args = /^EARLYOOM_ARGS="(.*)"$/m.exec(conf)?.[1] ?? "";
  assert.match(args, /--prefer \^\(chromium\|chrome\|headless_shell\)\$/);
  for (const p of ["node", "caddy", "sshd", "dockerd", "containerd", "containerd-shim", "docker-proxy"]) assert.ok(new RegExp(`--avoid \\S*[(|]${p}[|)]`).test(args), `${p} avoided`);
  assert.doesNotMatch(args, /['\s]\(|'/, "no quotes: systemd splits $EARLYOOM_ARGS at spaces without reading quotes");

  // Second run: nothing new — the swap is active, fstab keeps one line, earlyoom's settings are unchanged.
  const before = s.cmds().length;
  const again = s.run();
  assert.equal(again.status, 0);
  assert.match(again.stdout, /déjà présent/);
  const second = s.cmds().slice(before);
  assert.equal(second.some((c) => /^(fallocate|mkswap|swapon|apt-get)/.test(c)), false, second.join("\n"));
  assert.equal(readFileSync(s.fstab, "utf8").split("\n").filter((l) => l.includes("swapfile")).length, 1);
  assert.equal(readFileSync(s.defaults, "utf8"), conf);
});

test("a server with 8 GB or with a swap already: no swap file", () => {
  const big = setup({ memKib: 16 * GIB });
  assert.match(big.run().stdout, /pas nécessaire/);
  assert.equal(existsSync(big.swapfile), false);
  const has = setup({ memKib: 2 * GIB, swaps: "/dev/vda2 partition 1048572 0 -2\n" });
  assert.match(has.run().stdout, /déjà présent/);
  assert.equal(has.cmds().some((c) => c.startsWith("fallocate")), false);
});

test("not enough disk, Btrfs, or a kernel that refuses swap: nothing is left behind", () => {
  const full = setup({ memKib: 2 * GIB, freeKib: 5 * GIB });
  assert.match(full.run().stdout, /pas assez de place/);
  assert.equal(existsSync(full.swapfile), false);
  const btrfs = setup({ memKib: 2 * GIB, fs: "btrfs" });
  assert.match(btrfs.run().stdout, /Btrfs/);
  assert.equal(existsSync(btrfs.swapfile), false);
  const refused = setup({ memKib: 2 * GIB, swaponFails: true });
  const r = refused.run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /refuse/);
  assert.equal(existsSync(refused.swapfile), false, "the file this run made is removed");
  assert.equal(readFileSync(refused.fstab, "utf8").includes("swap"), false);
});

test("an existing swap file that is not a swap is never touched or deleted", () => {
  const s = setup({ memKib: 2 * GIB, swaponFails: true });
  writeFileSync(s.swapfile, "someone's data");
  assert.match(s.run().stdout, /n'y touche pas/);
  assert.equal(readFileSync(s.swapfile, "utf8"), "someone's data");
});

test("earlyoom: settings the administrator wrote are kept; ours are refreshed; a missing package never fails the install", () => {
  const custom = setup({ memKib: 16 * GIB, earlyoom: "installed", defaults: 'EARLYOOM_ARGS="-m 3 --avoid ^(foo)$"\n' });
  assert.match(custom.run().stdout, /personnalisé/);
  assert.equal(readFileSync(custom.defaults, "utf8"), 'EARLYOOM_ARGS="-m 3 --avoid ^(foo)$"\n');
  const pkgDefault = setup({ memKib: 16 * GIB, earlyoom: "installed", defaults: '# Default settings\nEARLYOOM_ARGS="-r 3600"\n' });
  pkgDefault.run();
  assert.match(readFileSync(pkgDefault.defaults, "utf8"), /--prefer/);
  const none = setup({ memKib: 16 * GIB, earlyoom: "unavailable" });
  const r = none.run();
  assert.equal(r.status, 0);
  assert.match(r.stdout, /indisponible/);
});

test("install.sh runs the memory guard after fetching Sklubot, never as a blocking step", () => {
  const install = readFileSync(path.join(repo, "deploy", "install.sh"), "utf8");
  assert.match(install, /bash deploy\/memory-guard\.sh \|\| info/);
  assert.ok(install.indexOf("memory-guard.sh") > install.indexOf('cd "$DIR"'));
});
