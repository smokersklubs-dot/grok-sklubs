import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// deploy/uninstall.sh (B-11) against a fake "docker" that answers from a list of what a Sklubot install created and
// writes down every command it receives. The real Docker of this machine is never touched.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const script = path.join(repo, "deploy", "uninstall.sh");

function setup() {
  const root = mkdtempSync(path.join(tmpdir(), "sklubot-uninstall-"));
  const bin = path.join(root, "bin");
  const install = path.join(root, "sklubot");
  mkdirSync(bin); mkdirSync(install);
  writeFileSync(path.join(install, "docker-compose.vps.yml"), "services: {}\n");
  writeFileSync(path.join(install, ".env"), "SKLUBOT_SESSION_SECRET=x\n");
  const log = path.join(root, "docker.log");
  // Canned answers: two bot computers, the four app containers, volumes, networks, images — plus things that are not ours.
  writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env bash
echo "$*" >> "${log}"
case "$*" in
  "ps -a --filter label=sklubot=desktop --format {{.Names}}") grep -q "rm -f sklubot-bot_a" "${log}" 2>/dev/null || printf 'sklubot-bot_a\\nsklubot-bot_b\\n' ;;
  "ps -a --filter label=com.docker.compose.project=sklubot --format {{.Names}}") grep -q "rm -f sklubot-sklubot-1" "${log}" 2>/dev/null || printf 'sklubot-sklubot-1\\nsklubot-docker-proxy-1\\nsklubot-caddy-1\\nsklubot-desktop-image-1\\n' ;;
  "volume ls -q") grep -q "volume rm -f sklubot_data" "${log}" 2>/dev/null && echo other_volume || printf 'sklubot_data\\nsklubot-home-bot_a\\nsklubot-home-bot_b\\nsklubot_caddy_data\\nsklubot_caddy_config\\nother_volume\\n' ;;
  "network ls --format {{.Name}}") grep -q "network rm sklubot_net" "${log}" 2>/dev/null && echo bridge || printf 'bridge\\nsklubot_net\\nsklubot_docker\\n' ;;
  "image ls --format {{.Repository}}:{{.Tag}}") printf 'sklubot-server:latest\\nsklubot-desktop:latest\\ntecnativa/docker-socket-proxy:v0.5.0\\ncaddy:2\\npostgres:16\\n' ;;
  "image rm caddy:2") echo "image is being used by running container" >&2; exit 1 ;;
esac
exit 0
`);
  chmodSync(path.join(bin, "docker"), 0o755);
  const run = (args: string[], input = "", env: Record<string, string> = {}) => spawnSync("bash", [script, ...args], {
    input, encoding: "utf8", timeout: 30_000,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, SKLUBOT_DIR: install, SKLUBOT_ALLOW_NONROOT: "1", SKLUBOT_BACKUP_DIR: path.join(root, "backups"), ...env },
  });
  const commands = () => (existsSync(log) ? readFileSync(log, "utf8").trim().split("\n") : []);
  return { root, install, run, commands };
}

test("B-11: --dry-run lists everything Sklubot created and removes nothing", () => {
  const t = setup();
  const r = t.run(["--dry-run"]);
  assert.equal(r.status, 0, r.stderr);
  for (const item of ["sklubot-bot_a", "sklubot-bot_b", "sklubot-sklubot-1", "sklubot-docker-proxy-1", "sklubot-caddy-1", "sklubot_data", "sklubot-home-bot_a", "sklubot_caddy_data", "sklubot_caddy_config", "sklubot_net", "sklubot_docker", "sklubot-server:latest", "sklubot-desktop:latest", "tecnativa/docker-socket-proxy:v0.5.0", t.install])
    assert.ok(r.stdout.includes(item), `lists ${item}`);
  for (const other of ["other_volume", "postgres:16", "bridge"]) assert.ok(!r.stdout.includes(other), `leaves ${other} out`);
  assert.match(r.stdout, /Mode essai : rien n'a été supprimé/);
  assert.deepEqual(t.commands().filter((c) => /^(rm|stop|volume rm|network rm|image rm|compose)/.test(c)), [], "no removal command at all");
  assert.ok(existsSync(t.install));
});

test("B-11: without OUI nothing is removed", () => {
  const t = setup();
  const r = t.run(["--no-backup"], "oui\n");
  assert.equal(r.status, 1);
  assert.match(r.stdout, /Annulé : rien n'a été supprimé/);
  assert.deepEqual(t.commands().filter((c) => /^(rm|stop|volume rm|network rm|image rm)/.test(c)), []);
  assert.ok(existsSync(t.install));
});

test("B-11: with OUI it stops the bots' computers first, then removes the app, volumes, networks, images and the folder", () => {
  const t = setup();
  const r = t.run(["--no-backup"], "OUI\n");
  const cmds = t.commands().filter((c) => /^(rm|stop|volume rm|network rm|image rm)/.test(c));
  const at = (c: string) => cmds.indexOf(c);
  assert.ok(at("stop -t 5 sklubot-bot_a") >= 0 && at("stop -t 5 sklubot-bot_a") < at("stop -t 10 sklubot-sklubot-1"), "bots first");
  assert.ok(at("rm -f sklubot-docker-proxy-1") >= 0, "the socket proxy goes");
  assert.ok(at("volume rm -f sklubot_data") > at("rm -f sklubot-sklubot-1"));
  for (const v of ["sklubot-home-bot_a", "sklubot-home-bot_b", "sklubot_caddy_data", "sklubot_caddy_config"]) assert.ok(at(`volume rm -f ${v}`) >= 0, v);
  assert.ok(at("network rm sklubot_net") >= 0 && at("network rm sklubot_docker") >= 0);
  assert.ok(at("image rm sklubot-desktop:latest") >= 0);
  assert.equal(cmds.some((c) => /other_volume|postgres|bridge/.test(c)), false, "nothing that is not Sklubot's");
  assert.equal(existsSync(t.install), false, "the install folder is gone");
  assert.match(r.stdout, /✓ volume sklubot_data/);
  assert.match(r.stdout, /image caddy:2 \(encore utilisée par un autre conteneur\)/);
  assert.match(r.stdout, /Plus rien de Sklubot ne tourne ni n'est stocké ici/);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  // Run again: nothing left, no error.
  const again = t.run(["--no-backup"], "OUI\n");
  assert.equal(again.status, 0);
});

test("B-11: the backup is offered first and runs before anything is removed", () => {
  const t = setup();
  const r = t.run([], "", { SKLUBOT_BACKUP: "1", SKLUBOT_CONFIRM: "OUI" });
  // The fake docker copies nothing, but backup.sh still writes its (empty) archive: the order is what matters here.
  const cmds = t.commands();
  const firstRemoval = cmds.findIndex((c) => /^(rm -f|volume rm|network rm)/.test(c));
  const backupStep = cmds.findIndex((c) => c.startsWith("volume inspect sklubot_data"));
  assert.ok(backupStep >= 0, "backup.sh ran");
  assert.ok(firstRemoval > backupStep, "removal only after the backup");
  assert.equal(r.status, 0, r.stdout + r.stderr);
  const kept = readdirSync(path.join(t.root, "backups"));
  assert.ok(kept.some((f) => /^sklubot-sauvegarde-.*\.tar$/.test(f)), "the archive is kept outside the install folder");
  assert.ok(kept.some((f) => f.startsWith("sklubot-env-")), "with a copy of .env");
});
