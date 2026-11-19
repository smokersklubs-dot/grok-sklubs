import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { after, test } from "node:test";

// SK-P0-04 with the real Docker of this machine: deploy/backup.sh (online database copy, a computer's home, secrets
// encrypted with a passphrase, manifest, rotation) then deploy/restore-drill.sh (isolated project without network,
// /api/health, counts, one sealed value opened). Everything is made under test names and removed afterwards; the real
// install's volumes (sklubot_data, sklubot-home-*) are never touched.
// Needs Docker and a Sklubot server image (SKLUBOT_TEST_APP_IMAGE, else "sklubot-server"); skipped cleanly without them
// (CI builds both the bots' computer image and the server image).
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const docker = (...args: string[]) => spawnSync("docker", args, { encoding: "utf8", timeout: 120_000 });
const IMG = process.env.SKLUBOT_TEST_APP_IMAGE || "sklubot-server";
const hasDocker = docker("info").status === 0;
const hasImage = hasDocker && docker("image", "inspect", IMG).status === 0;
// An image built before backupcheck.js existed can't prove the key: build a current one (docker compose build) to run this.
const currentImage = hasImage && docker("run", "--rm", "--network", "none", "--entrypoint", "test", IMG, "-f", "/app/server/dist/backupcheck.js").status === 0;
const skip = !hasDocker ? "Docker is not available" : !hasImage ? `no Sklubot server image (${IMG})` : !currentImage ? `the ${IMG} image predates backupcheck.js: rebuild it` : false;

const id = `t${Date.now().toString(36)}${process.pid}`;
const VOL = `sklubot_test_data_${id}`;
const HOMEP = `sklubot-testhome-${id}-`;
const HOME = `${HOMEP}bot1`;
const APP = `sklubot-test-app-${id}`;
const SECRET = "drill-secret-drill-secret-drill-secret-0123";
const root = mkdtempSync(path.join(tmpdir(), "sklubot-drill-"));
const backups = path.join(root, "backups");
const pass = path.join(root, "pass.txt");
const env = {
  ...process.env, SKLUBOT_BACKUP_DIR: backups, SKLUBOT_BACKUP_PASSPHRASE_FILE: pass, SKLUBOT_DATA_VOLUME: VOL,
  SKLUBOT_APP_IMAGE: IMG, SKLUBOT_HOME_PREFIX: HOMEP, SKLUBOT_ENV_FILE: path.join(root, "no.env"),
  SKLUBOT_BACKUP_KEEP_DAILY: "2", SKLUBOT_BACKUP_KEEP_WEEKLY: "1", SKLUBOT_BACKUP_REMOTE: "",
};
const run = (script: string, args: string[] = [], extra: Record<string, string> = {}) =>
  spawnSync("bash", [path.join(repo, "deploy", script), ...args], { encoding: "utf8", timeout: 600_000, env: { ...env, ...extra } });

after(() => {
  if (skip) return;
  docker("rm", "-f", APP);
  docker("volume", "rm", "-f", VOL, HOME);
});

const SEED = `
const { q } = await import("/app/server/dist/db.js");
const { seal } = await import("/app/server/dist/auth.js");
const fs = await import("node:fs");
const t = Date.now();
q.run("INSERT INTO users (id, email, name, pass_hash, created_at) VALUES ('u1', 'a@example.com', 'A', 'scrypt$x$y', ?)", t);
q.run("INSERT INTO bots (id, user_id, name, shape, color, is_primary, created_at, updated_at) VALUES ('b1', 'u1', 'Juno', 'pebble', 'indigo', 1, ?, ?), ('b2', 'u1', 'Robin', 'pebble', 'teal', 0, ?, ?)", t, t, t, t);
for (let i = 1; i <= 5; i++) q.run("INSERT INTO rows (bot_id, generation, seq, rev, kind, body, created_at) VALUES ('b1', 1, ?, 1, 'message', '{}', ?)", i, t);
q.run("INSERT INTO vault (id, user_id, name, password_enc, created_at) VALUES ('v1', 'u1', 'Site', ?, ?)", seal("hunter2"), t);
fs.mkdirSync("/data/workspaces/b1", { recursive: true });
fs.writeFileSync("/data/workspaces/b1/rapport.txt", "contenu de la bibliothèque");
`;

test("backup then restore drill, with the real Docker", { skip }, () => {
  writeFileSync(pass, "une phrase de passe d'essai\n");
  assert.equal(docker("volume", "create", VOL).status, 0);
  const seeded = docker("run", "--rm", "-v", `${VOL}:/data`, "-e", "DATA_DIR=/data", "-e", `SESSION_SECRET=${SECRET}`, IMG, "node", "--no-warnings", "--input-type=module", "-e", SEED);
  assert.equal(seeded.status, 0, seeded.stderr);
  docker("volume", "create", HOME);
  docker("run", "--rm", "-v", `${HOME}:/h`, IMG, "sh", "-c", "mkdir -p /h/.config && echo connecté > /h/.config/login");
  // Stands for the running app (compose service "sklubot", as on the VPS and under Coolify): the copy is made online, and
  // the secrets come from its environment (Coolify keeps them there, not in a .env).
  const app = docker("run", "-d", "--name", APP, "--label", "com.docker.compose.service=sklubot", "--label", "com.docker.compose.project=sklubot-test",
    "-v", `${VOL}:/data`, "-e", `SESSION_SECRET=${SECRET}`, "-e", "DATA_DIR=/data", IMG, "sleep", "600");
  assert.equal(app.status, 0, app.stderr);

  // Older archives, for the rotation: kept = the 2 newest + the newest of 1 earlier week.
  mkdirSync(backups, { recursive: true });
  for (const f of ["sklubot-sauvegarde-20250101-030000.tar", "sklubot-sauvegarde-20250102-030000.tar", "sklubot-sauvegarde-20250110-030000.tar", "sklubot-sauvegarde-20250111-030000.tar"]) writeFileSync(path.join(backups, f), "");
  const b = run("backup.sh");
  assert.equal(b.status, 0, b.stdout + b.stderr);
  assert.match(b.stdout, /1 compte\(s\), 2 bot\(s\), 5 ligne\(s\)/);
  assert.match(b.stdout, /chiffrés avec la phrase de passe/);
  const archives = readdirSync(backups).filter((f) => f.endsWith(".tar")).sort();
  assert.equal(archives.length, 3, archives.join(" "));
  assert.deepEqual(archives.slice(0, 2), ["sklubot-sauvegarde-20250110-030000.tar", "sklubot-sauvegarde-20250111-030000.tar"]);
  const latest = path.join(backups, archives[2]);
  const list = spawnSync("tar", ["tf", latest], { encoding: "utf8" }).stdout;
  for (const f of ["./manifest.json", "./SHA256SUMS", "./db.sqlite", "./data.tar.gz", "./secrets.env.enc", `./homes/${HOME}.tar.gz`]) assert.ok(list.includes(f), `${f} in the archive`);
  assert.ok(!list.includes("secrets.env\n"), "no clear secrets in the archive");
  assert.ok(!existsSync(path.join(backups, "secrets")), "nothing clear beside it either");
  const manifest = JSON.parse(spawnSync("tar", ["xOf", latest, "./manifest.json"], { encoding: "utf8" }).stdout);
  assert.deepEqual([manifest.db.integrity, manifest.db.counts.users, manifest.db.counts.bots, manifest.db.counts.rows, manifest.secrets, manifest.homes], ["ok", 1, 2, 5, "openssl", 1]);
  // The live database is not in the data archive: its consistent copy is db.sqlite.
  const inner = spawnSync("sh", ["-c", `tar xOf "${latest}" ./data.tar.gz | tar tzf -`], { encoding: "utf8" }).stdout;
  assert.ok(inner.includes("./workspaces/b1/rapport.txt"));
  assert.ok(!/\.\/sklubot\.db(-wal|-shm)?\n/.test(inner));
  // /api/health reads this.
  const status = JSON.parse(docker("run", "--rm", "-v", `${VOL}:/data`, IMG, "cat", "/data/backup-status.json").stdout);
  assert.equal(status.ok, true);
  assert.equal(status.secrets, "openssl");
  assert.equal(docker("inspect", "-f", "{{.State.Running}} {{.State.Paused}}", APP).stdout.trim(), "true false", "the app kept running");

  const d = run("restore-drill.sh");
  assert.equal(d.status, 0, d.stdout + d.stderr);
  assert.match(d.stdout, /RESTAURATION VÉRIFIÉE/);
  assert.match(d.stdout, /users : 1 \(identique/);
  assert.match(d.stdout, /rows : 5 \(identique/);
  assert.match(d.stdout, /valeur scellée s'ouvre avec le SESSION_SECRET de la sauvegarde \(vault\.password_enc\)/);
  assert.ok(readFileSync(path.join(backups, "restore-drill-dernier.txt"), "utf8").includes("RESTAURATION VÉRIFIÉE"));
  assert.equal(docker("volume", "ls", "-q", "--filter", "name=sklubot-drill-").stdout.trim(), "", "the drill's project and volume are gone");

  // A wrong passphrase: the drill says the key cannot be checked, and fails.
  const wrong = path.join(root, "wrong.txt");
  writeFileSync(wrong, "pas la bonne\n");
  const w = run("restore-drill.sh", [latest], { SKLUBOT_BACKUP_PASSPHRASE_FILE: wrong });
  assert.equal(w.status, 1, w.stdout + w.stderr);
  assert.match(w.stdout, /secrets de la sauvegarde non ouverts/);
  assert.match(w.stdout, /NE s'ouvre PAS/);
});
