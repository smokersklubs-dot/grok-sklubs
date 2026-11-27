import assert from "node:assert/strict";
import { spawnSync, type SpawnSyncOptions } from "node:child_process";
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

// deploy/auto-update.sh (A-FAIRE L168): off by default, quiet window, signed tags only (a throwaway GnuPG key; a tag
// signed by another key or not signed is refused), backup first, health check, automatic rollback; never applied in
// hosted mode. Against a throwaway git repository, a fake "docker", a fake "curl" and fake backup/restore scripts.
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const hasGpg = spawnSync("gpg", ["--version"]).status === 0;
const root = mkdtempSync(path.join(tmpdir(), "sklubot-autoupdate-"));
const sh = (cmd: string, args: string[], opts: SpawnSyncOptions = {}) => {
  const r = spawnSync(cmd, args, { encoding: "utf8", ...opts });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")}: ${r.stderr}`);
  return String(r.stdout).trim();
};
const env0 = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.test", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.test", GIT_CONFIG_GLOBAL: "/dev/null" };
const install = path.join(root, "install"), origin = path.join(root, "origin.git"), work = path.join(root, "work"), bin = path.join(root, "bin");
const gSigner = path.join(root, "gpg-signer"), gTrusted = path.join(root, "gpg-trusted"), gOther = path.join(root, "gpg-other");
const log = path.join(root, "calls.log");
let fpr = "", otherFpr = "";

function genKey(home: string, who: string) {
  mkdirSync(home, { mode: 0o700 });
  sh("gpg", ["--batch", "--passphrase", "", "--quick-gen-key", `${who} <${who}@example.test>`, "ed25519", "sign", "never"], { env: { ...env0, GNUPGHOME: home } });
  return sh("gpg", ["--list-secret-keys", "--with-colons"], { env: { ...env0, GNUPGHOME: home } }).split("\n").find((l) => l.startsWith("fpr"))!.split(":")[9];
}
function commitAndTag(tag: string, opts: { sign?: "signer" | "other" | false } = {}) {
  writeFileSync(path.join(work, "VERSION"), tag);
  sh("git", ["-C", work, "add", "."], { env: env0 });
  sh("git", ["-C", work, "commit", "-qm", tag], { env: env0 });
  const s = opts.sign ?? "signer";
  if (s) sh("git", ["-C", work, "-c", `user.signingkey=${s === "signer" ? fpr : otherFpr}`, "tag", "-s", tag, "-m", tag], { env: { ...env0, GNUPGHOME: s === "signer" ? gSigner : gOther } });
  else sh("git", ["-C", work, "tag", "-a", tag, "-m", tag], { env: env0 });
  sh("git", ["-C", work, "push", "-q", "origin", "HEAD:main", tag], { env: env0 });
  return sh("git", ["-C", work, "rev-parse", "HEAD"]);
}
function run(extraEnv: Record<string, string> = {}, envFile = "SKLUBOT_AUTO_UPDATE=1\n") {
  writeFileSync(path.join(install, ".env"), envFile);
  const r = spawnSync("bash", [path.join(install, "deploy", "auto-update.sh"), "run"], { encoding: "utf8", env: { ...env0, PATH: `${bin}:${process.env.PATH}`, SKLUBOT_UPDATE_FORCE: "1", SKLUBOT_UPDATE_GNUPGHOME: gTrusted, SKLUBOT_HEALTH_WAIT: "0", SKLUBOT_HEALTH_TRIES: "2", SKLUBOT_UPDATE_LOG: path.join(root, "au.log"), ...extraEnv } });
  const status = existsSync(path.join(install, "auto-update-status.json")) ? JSON.parse(readFileSync(path.join(install, "auto-update-status.json"), "utf8")) : null;
  return { code: r.status, status, head: sh("git", ["-C", install, "rev-parse", "HEAD"]), stderr: r.stderr };
}

test("setup: repository, keys, fake docker / curl / backup", { skip: !hasGpg && "gpg is not installed" }, () => {
  fpr = genKey(gSigner, "release"); otherFpr = genKey(gOther, "attacker");
  mkdirSync(gTrusted, { mode: 0o700 });
  const pub = spawnSync("gpg", ["--export", fpr], { env: { ...env0, GNUPGHOME: gSigner } }).stdout;
  spawnSync("gpg", ["--batch", "--import"], { input: pub, env: { ...env0, GNUPGHOME: gTrusted } });
  sh("git", ["init", "-q", "--bare", origin]);
  sh("git", ["init", "-q", "-b", "main", work]);
  sh("git", ["-C", work, "remote", "add", "origin", origin]);
  commitAndTag("v1.0.0");
  sh("git", ["clone", "-q", origin, install], { env: env0 });
  sh("git", ["-C", install, "checkout", "-q", "--detach", "v1.0.0"]);
  mkdirSync(path.join(install, "deploy"));
  copyFileSync(path.join(repo, "deploy", "auto-update.sh"), path.join(install, "deploy", "auto-update.sh"));
  writeFileSync(path.join(install, "deploy", "backup.sh"), `#!/usr/bin/env bash\nmkdir -p sauvegardes; f=sauvegardes/sklubot-sauvegarde-$(date +%s%N).tar; echo x > $f; echo "backup $(cat VERSION)" >> "${log}"\n`);
  writeFileSync(path.join(install, "deploy", "restore.sh"), `#!/usr/bin/env bash\necho "restore $1 yes=$SKLUBOT_RESTORE_YES" >> "${log}"\n`);
  chmodSync(path.join(install, "deploy", "backup.sh"), 0o755); chmodSync(path.join(install, "deploy", "restore.sh"), 0o755);
  writeFileSync(path.join(install, ".git", "info", "exclude"), "sauvegardes/\n.env\nauto-update*\ndeploy/\n");
  mkdirSync(bin);
  writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env bash\necho "docker $* @ $(cat VERSION)" >> "${log}"\n`);
  // Healthy unless the running version is listed in ${root}/bad.
  writeFileSync(path.join(bin, "curl"), `#!/usr/bin/env bash\nv=$(cat "${install}/VERSION"); grep -qx "$v" "${root}/bad" 2>/dev/null && exit 22; exit 0\n`);
  chmodSync(path.join(bin, "docker"), 0o755); chmodSync(path.join(bin, "curl"), 0o755);
});

test("off by default; the quiet window", { skip: !hasGpg && "gpg is not installed" }, () => {
  const off = run({}, "");
  assert.equal(off.status.result, "off");
  assert.ok(!existsSync(log), "nothing ran");
  const w = (win: string, now: string) => spawnSync("bash", [path.join(install, "deploy", "auto-update.sh"), "in-window", win, now]).status === 0;
  assert.equal(w("03:00-05:00", "04:10"), true);
  assert.equal(w("03:00-05:00", "05:00"), false);
  assert.equal(w("23:00-02:00", "01:30"), true, "a window over midnight");
  assert.equal(w("23:00-02:00", "12:00"), false);
  assert.equal(run({ SKLUBOT_UPDATE_FORCE: "0", SKLUBOT_UPDATE_WINDOW: "00:00-00:01" }).status.result, (new Date().getHours() === 0 && new Date().getMinutes() === 0) ? "uptodate" : "waiting");
});

test("unsigned or wrongly signed versions are refused; no signer configured: refused", { skip: !hasGpg && "gpg is not installed" }, () => {
  const v0 = sh("git", ["-C", install, "rev-parse", "HEAD"]);
  commitAndTag("v1.1.0", { sign: false });
  // The newest version signed by a trusted key is still the one running: the unsigned and foreign-signed ones are ignored.
  let r = run();
  assert.equal(r.status.result, "uptodate"); assert.equal(r.status.version, "v1.0.0"); assert.equal(r.head, v0);
  commitAndTag("v1.2.0", { sign: "other" });
  r = run();
  assert.equal(r.status.result, "uptodate"); assert.equal(r.status.version, "v1.0.0"); assert.equal(r.head, v0);
  r = run({ SKLUBOT_UPDATE_GNUPGHOME: "" });
  assert.equal(r.status.result, "refused"); assert.match(r.status.message, /signataire/);
  assert.ok(!existsSync(log), "no backup, no rebuild");
});

test("a signed version: backup first, then rebuild, health OK → updated", { skip: !hasGpg && "gpg is not installed" }, () => {
  const c = commitAndTag("v1.3.0");
  const r = run();
  assert.equal(r.status.result, "updated", r.stderr);
  assert.equal(r.head, c);
  const calls = readFileSync(log, "utf8").trim().split("\n");
  assert.equal(calls[0], "backup v1.0.0", "the backup is made on the old version, before anything changes");
  assert.match(calls[1], /^docker compose -f docker-compose.vps.yml up -d --build @ v1.3.0$/);
  assert.equal(run().status.result, "uptodate");
});

test("health fails after the update → automatic rollback to the previous version", { skip: !hasGpg && "gpg is not installed" }, () => {
  const before = sh("git", ["-C", install, "rev-parse", "HEAD"]);
  commitAndTag("v1.4.0");
  writeFileSync(path.join(root, "bad"), "v1.4.0\n");
  const r = run();
  assert.equal(r.code, 1);
  assert.equal(r.status.result, "rolled_back");
  assert.equal(r.head, before);
  assert.ok(!readFileSync(log, "utf8").includes("restore"), "the code rollback was enough");
});

test("rollback still unhealthy → the backup taken before is restored", { skip: !hasGpg && "gpg is not installed" }, () => {
  commitAndTag("v1.5.0");
  writeFileSync(path.join(root, "bad"), "v1.5.0\nv1.3.0\n");
  const r = run();
  assert.match(readFileSync(log, "utf8"), /restore .*sklubot-sauvegarde-\d+\.tar yes=OUI/);
  assert.equal(r.status.result, "error", "still unhealthy after the restore: says so");
  writeFileSync(path.join(root, "bad"), "");
});

test("hosted mode: never applied without the operator, only announced", { skip: !hasGpg && "gpg is not installed" }, () => {
  const before = sh("git", ["-C", install, "rev-parse", "HEAD"]);
  commitAndTag("v1.6.0");
  const r = run({}, "SKLUBOT_AUTO_UPDATE=1\nSKLUBOT_HOSTED_MODE=1\n");
  assert.equal(r.status.result, "available");
  assert.equal(r.status.version, "v1.6.0");
  assert.equal(r.head, before);
});

test("L95: every long-running service of both compose files has a memory limit", () => {
  for (const f of ["docker-compose.vps.yml", "docker-compose.coolify.yml"]) {
    const text = readFileSync(path.join(repo, f), "utf8");
    const services = text.slice(text.indexOf("\nservices:\n"), text.search(/\n(networks|volumes):\n/)).split(/\n(?=  [a-z][\w-]*:\n)/).slice(1);
    for (const s of services) {
      const name = /^  ([\w-]+):/.exec(s)![1];
      if (!/restart: unless-stopped/.test(s)) continue; // one-shot jobs (image builds, model download)
      assert.match(s, /mem_limit:/, `${f}: ${name} has no mem_limit`);
    }
  }
});
