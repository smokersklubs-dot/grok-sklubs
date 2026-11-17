import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { after, test } from "node:test";

// The in-app automatic off-server backup (autobackup.ts): owner-only settings, connection test, a real run streamed to
// a local fake S3 (multipart), the archive opened by the standard `age` tool and the system's tar, retention, failure
// alerts, the schedule, and a restore drill end to end (restore-from-s3 → a new data folder → database intact, counts
// equal, a sealed value opens with the SESSION_SECRET the archive carries).
const DATA = mkdtempSync(path.join(tmpdir(), "sklubot-autobackup-"));
process.env.DATA_DIR = DATA;
process.env.SESSION_SECRET = "autobackup-secret-autobackup-secret-0123";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.ALLOW_PRIVATE_FETCH = "1"; // the fake S3 listens on this machine
process.env.SKLUBOT_TEST_MARKER_KEY = "marker-value-in-env";
for (const k of ["OPEN_SIGNUP", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE"]) delete process.env[k];

const { startFakeS3 } = await import("./fixtures/fake-s3.js");
const S3 = { bucket: "sklubot-backups", accessKey: "AKIATESTFAKE1234WXYZ", secretKey: "fake-secret-key-0123456789abcdef", region: "gra" };
const fake = await startFakeS3(S3);
after(() => fake.close());

const { api } = await import("../src/routes.js");
const { q } = await import("../src/db.js");
const { users, bots } = await import("../src/store.js");
const { createSession, hashPassword, seal, unseal } = await import("../src/auth.js");
const { generateIdentity, encryptStream, decryptStream } = await import("../src/agecrypt.js");
const { signV4, EMPTY_SHA256, S3Client } = await import("../src/s3.js");
const ab = await import("../src/autobackup.js");
const { retentionPlan, isoWeek, objectName, readArchive } = await import("../src/backuparchive.js");
const { restoreFromS3, inspectDb, probeSealed } = await import("../src/backupcheck.js");
const { healthReport, resetHealthCache } = await import("../src/monitor.js");
const { workspaceOf } = await import("../src/computer.js");

type Res = { status: number; json: any; text: string };
async function call(method: string, url: string, cookie: string, body?: unknown): Promise<Res> {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, origin: "https://sklubot.example", host: "sklubot.example" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

// The owner (first account) and a second account.
const signup = await api.request("/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "https://sklubot.example", host: "sklubot.example" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-1", name: "Owner", locale: "fr", acceptTerms: true }) });
assert.equal(signup.status, 200, await signup.clone().text());
const owner = users.byEmail("owner@example.test")!;
const ownerCookie = `sklubot_session=${createSession(owner.id).token}`;
const other = users.create("bob@example.test", "Bob", hashPassword("bob-password-1"), "en");
const otherCookie = `sklubot_session=${createSession(other.id).token}`;

// Data worth restoring: a vault value (sealed), a library file, a team file, a browser profile with a cache, a socket dir.
const t = Date.now();
q.run("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('v1', ?, 'Banque', 'moi', ?, ?)", owner.id, seal("hunter2-banque"), t);
const botId = bots.primary(owner.id)!.id;
const ws = workspaceOf(botId);
mkdirSync(ws, { recursive: true });
writeFileSync(path.join(ws, "rapport é.txt"), "contenu de la bibliothèque");
const big = randomBytes(300_000); // incompressible: several multipart parts with the small test part size
writeFileSync(path.join(ws, "gros.bin"), big);
mkdirSync(path.join(DATA, "team", owner.id), { recursive: true });
writeFileSync(path.join(DATA, "team", owner.id, "notes.md"), "# équipe");
mkdirSync(path.join(DATA, "profiles", botId, "Default", "Cache"), { recursive: true });
writeFileSync(path.join(DATA, "profiles", botId, "Default", "Cache", "data_0"), "cache");
writeFileSync(path.join(DATA, "profiles", botId, "Default", "Cookies"), "cookies");
mkdirSync(path.join(DATA, "botlink", botId), { recursive: true });
writeFileSync(path.join(DATA, "botlink", botId, "link.sock"), "");
mkdirSync(path.join(DATA, "db-snapshots"), { recursive: true });
writeFileSync(path.join(DATA, "db-snapshots", "old.db"), "x");

const key = generateIdentity();
const settings = { provider: "ovh", endpoint: fake.url, region: S3.region, bucket: S3.bucket, pathStyle: true, prefix: "prod/sklubot", accessKey: S3.accessKey, secretKey: S3.secretKey, recipient: key.recipient, hour: 3, timezone: "Europe/Paris", keepDaily: 7, keepWeekly: 4 };
const ROUTES: [string, string][] = [["GET", "/settings/backup"], ["PUT", "/settings/backup"], ["DELETE", "/settings/backup"], ["POST", "/settings/backup/test"], ["POST", "/settings/backup/run"], ["GET", "/settings/backup/remote"]];
ab.setPartSizeForTests(64 * 1024);

test("Signature V4 matches the AWS documentation examples (GET Object, ListObjects, GET lifecycle)", () => {
  const base = { host: "examplebucket.s3.amazonaws.com", region: "us-east-1", accessKey: "AKIAIOSFODNN7EXAMPLE", secretKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", date: new Date("2013-05-24T00:00:00Z") };
  const sig = (h: Record<string, string>) => /Signature=([0-9a-f]+)/.exec(h.authorization)![1];
  assert.equal(sig(signV4({ ...base, method: "GET", path: "/test.txt", query: {}, headers: { range: "bytes=0-9" }, payloadHash: EMPTY_SHA256 })), "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
  assert.equal(sig(signV4({ ...base, method: "GET", path: "/", query: { "max-keys": "2", prefix: "J" }, headers: {}, payloadHash: EMPTY_SHA256 })), "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  assert.equal(sig(signV4({ ...base, method: "GET", path: "/", query: { lifecycle: "" }, headers: {}, payloadHash: EMPTY_SHA256 })), "fea454ca298b7da1c68078a5d1bdbfbbe0d65c699e0f91ac7a200a0136783543");
});

const hasAge = spawnSync("age", ["--version"]).status === 0;
test("the browser's key pair (web/src/lib/agekey.ts, WebCrypto X25519) is a valid age key pair", async () => {
  const { makeAgeKey } = await import("../../web/src/lib/agekey.ts");
  const { parseIdentity, recipientOf, parseRecipient } = await import("../src/agecrypt.js");
  for (let i = 0; i < 5; i++) {
    const k = await makeAgeKey();
    assert.match(k.recipient, /^age1[0-9a-z]{58}$/);
    assert.match(k.identity, /^AGE-SECRET-KEY-1[0-9A-Z]{58}$/);
    assert.equal(recipientOf(parseIdentity(k.file)), k.recipient);
    assert.equal(parseRecipient(k.recipient).length, 32);
    if (hasAge) {
      const dir = mkdtempSync(path.join(tmpdir(), "sklubot-webkey-"));
      writeFileSync(path.join(dir, "k.txt"), k.file);
      assert.equal(spawnSync("age-keygen", ["-y", path.join(dir, "k.txt")], { encoding: "utf8" }).stdout.trim(), k.recipient);
    }
  }
});
test("age interoperability: our files open with the age tool, and age's files open here", { skip: hasAge ? false : "the age tool is not installed" }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-age-"));
  writeFileSync(path.join(dir, "key.txt"), key.file);
  assert.equal(spawnSync("age-keygen", ["-y", path.join(dir, "key.txt")], { encoding: "utf8" }).stdout.trim(), key.recipient);
  for (const size of [0, 1, 65_536, 65_537, 200_000]) {
    const plain = randomBytes(size);
    const chunks: Buffer[] = [];
    await pipeline(Readable.from([plain]), encryptStream(key.recipient), async function* (s) { for await (const c of s) chunks.push(c as Buffer); });
    writeFileSync(path.join(dir, "x.age"), Buffer.concat(chunks));
    const back = spawnSync("age", ["-d", "-i", path.join(dir, "key.txt"), path.join(dir, "x.age")], { maxBuffer: 1 << 26 });
    assert.equal(back.status, 0, String(back.stderr));
    assert.ok(Buffer.from(back.stdout).equals(plain), `size ${size}`);
    writeFileSync(path.join(dir, "p.bin"), plain);
    assert.equal(spawnSync("age", ["-r", key.recipient, "-o", path.join(dir, "y.age"), path.join(dir, "p.bin")]).status, 0);
    const out: Buffer[] = [];
    await pipeline(createReadStream(path.join(dir, "y.age"), { highWaterMark: 777 }), decryptStream(key.file), async function* (s) { for await (const c of s) out.push(c as Buffer); });
    assert.ok(Buffer.concat(out).equals(plain));
  }
  // The wrong key, or a changed byte, is refused.
  await assert.rejects(pipeline(createReadStream(path.join(dir, "y.age")), decryptStream(generateIdentity().identity), async function* (s) { for await (const _ of s); }), /does not open/);
  const bad = readFileSync(path.join(dir, "y.age")); bad[bad.length - 5] ^= 1;
  await assert.rejects(pipeline(Readable.from([bad]), decryptStream(key.file), async function* (s) { for await (const _ of s); }), /truncated or was changed/);
});

test("only the owner may see or change the backup settings (the others get 403, nothing leaks)", async () => {
  for (const [method, url] of ROUTES) {
    const r = await call(method, url, otherCookie, method === "GET" || method === "DELETE" ? undefined : settings);
    assert.equal(r.status, 403, `${method} ${url} → ${r.status}`);
  }
  const none = await call("GET", "/settings/backup", ownerCookie);
  assert.equal(none.status, 200);
  assert.equal(none.json.configured, false);
});

test("settings are validated, saved with the keys sealed, and never sent back", async () => {
  assert.equal((await call("PUT", "/settings/backup", ownerCookie, { ...settings, recipient: "" })).status, 400);
  assert.match((await call("PUT", "/settings/backup", ownerCookie, { ...settings, recipient: "age1notakey" })).json.error, /clé publique age/);
  assert.match((await call("PUT", "/settings/backup", ownerCookie, { ...settings, bucket: "Bad_Bucket" })).json.error, /bucket/);
  assert.equal((await call("PUT", "/settings/backup", ownerCookie, { ...settings, endpoint: "ftp://x" })).status, 400);
  assert.equal((await call("PUT", "/settings/backup", ownerCookie, { ...settings, hour: 24 })).status, 400);
  assert.equal((await call("PUT", "/settings/backup", ownerCookie, { ...settings, timezone: "Mars/Olympus" })).status, 400);
  const saved = await call("PUT", "/settings/backup", ownerCookie, settings);
  assert.equal(saved.status, 200, saved.text);
  assert.equal(saved.json.prefix, "prod/sklubot/");
  assert.equal(saved.json.accessKeyHint, "…WXYZ");
  assert.equal(saved.json.hasSecret, true);
  for (const r of [saved, await call("GET", "/settings/backup", ownerCookie)]) {
    assert.ok(!r.text.includes(S3.secretKey) && !r.text.includes(S3.accessKey), "no key in the answer");
  }
  const row = q.get<{ access_key_enc: string; secret_key_enc: string }>("SELECT access_key_enc, secret_key_enc FROM instance_backup")!;
  assert.ok(!row.secret_key_enc.includes(S3.secretKey) && unseal(row.secret_key_enc) === S3.secretKey && unseal(row.access_key_enc) === S3.accessKey);
  // Saving again with the keys left empty keeps them.
  const again = await call("PUT", "/settings/backup", ownerCookie, { ...settings, accessKey: "", secretKey: "", keepDaily: 3 });
  assert.equal(again.status, 200, again.text);
  assert.equal(unseal(q.get<{ secret_key_enc: string }>("SELECT secret_key_enc FROM instance_backup")!.secret_key_enc), S3.secretKey);
  assert.ok(typeof again.json.nextRun === "number" && again.json.nextRun > Date.now());
});

test("Tester la connexion: write, read, list and delete a tiny object; a wrong secret is explained", async () => {
  const ok = await call("POST", "/settings/backup/test", ownerCookie, { ...settings, accessKey: "", secretKey: "" });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual(ok.json.steps, ["write", "read", "list", "delete"]);
  assert.equal([...fake.objects.keys()].filter((k) => k.includes(".sklubot-test-")).length, 0, "the test object is gone");
  const bad = await call("POST", "/settings/backup/test", ownerCookie, { ...settings, secretKey: "wrong-secret" });
  assert.equal(bad.status, 502);
  assert.match(bad.json.error, /écriture : La clé secrète ne correspond pas/);
  const noBucket = await call("POST", "/settings/backup/test", ownerCookie, { ...settings, bucket: "nope-bucket", accessKey: "", secretKey: "" });
  assert.match(noBucket.json.error, /bucket n'existe pas/);
});

let firstName = "";
test("Sauvegarder maintenant: a streamed, encrypted, multipart backup; status for /api/health; history", async () => {
  const r = await call("POST", "/settings/backup/run", ownerCookie);
  assert.equal(r.status, 202, r.text);
  assert.equal((await call("POST", "/settings/backup/run", ownerCookie)).status, 409, "one at a time");
  const run = await ab.currentRun()!;
  assert.equal(run.ok, true, run.error ?? "");
  assert.ok(run.name && /^sklubot-auto-\d{8}-\d{6}\.tar\.gz\.age$/.test(run.name));
  firstName = run.name!;
  const obj = fake.objects.get(`prod/sklubot/${firstName}`)!;
  assert.ok(obj && obj.length > 300_000 && obj.length === run.bytes);
  assert.ok((fake.multipartParts.get(`prod/sklubot/${firstName}`) ?? 0) >= 4, "sent in several parts");
  assert.ok(obj.subarray(0, 22).toString() === "age-encryption.org/v1\n", "an age file");
  assert.ok(!obj.includes(Buffer.from("hunter2")) && !obj.includes(Buffer.from(process.env.SESSION_SECRET!)), "nothing readable");
  assert.ok(!existsSync(path.join(DATA, ab.TMP_DIR_NAME)), "temporary files removed");
  const status = JSON.parse(readFileSync(path.join(DATA, "backup-status.json"), "utf8"));
  assert.equal(status.ok, true); assert.equal(status.source, "app"); assert.equal(status.archive, firstName);
  resetHealthCache();
  const health = await healthReport(0);
  assert.equal(health.checks.backup.state, "ok");
  assert.equal(health.checks.backup.detail?.source, "app");
  const view = (await call("GET", "/settings/backup", ownerCookie)).json;
  assert.equal(view.last.ok, true); assert.equal(view.history.length, 1); assert.equal(view.failures, 0); assert.equal(view.running, null);
  const remote = await call("GET", "/settings/backup/remote", ownerCookie);
  assert.deepEqual(remote.json.backups.map((b: any) => b.name), [firstName]);
});

test("the archive opens with age and tar: what is in it, and what is left out", { skip: hasAge ? false : "the age tool is not installed" }, () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-ab-open-"));
  writeFileSync(path.join(dir, "key.txt"), key.file);
  writeFileSync(path.join(dir, "a.age"), fake.objects.get(`prod/sklubot/${firstName}`)!);
  assert.equal(spawnSync("age", ["-d", "-i", path.join(dir, "key.txt"), "-o", path.join(dir, "a.tar.gz"), path.join(dir, "a.age")]).status, 0);
  mkdirSync(path.join(dir, "x"));
  const x = spawnSync("tar", ["xzf", path.join(dir, "a.tar.gz"), "-C", path.join(dir, "x")], { encoding: "utf8" });
  assert.equal(x.status, 0, x.stderr);
  const sums = spawnSync("sha256sum", ["--quiet", "-c", "SHA256SUMS"], { cwd: path.join(dir, "x"), encoding: "utf8" });
  assert.equal(sums.status, 0, sums.stdout + sums.stderr);
  const top = readdirSync(path.join(dir, "x")).sort();
  assert.deepEqual(top, ["SHA256SUMS", "data", "db.sqlite", "manifest.json", "secrets.env"]);
  const d = path.join(dir, "x", "data");
  assert.equal(readFileSync(path.join(d, "workspaces", path.basename(ws), "rapport é.txt"), "utf8"), "contenu de la bibliothèque");
  assert.ok(readFileSync(path.join(d, "workspaces", path.basename(ws), "gros.bin")).equals(big));
  assert.ok(existsSync(path.join(d, "team", owner.id, "notes.md")));
  assert.ok(existsSync(path.join(d, "profiles", botId, "Default", "Cookies")));
  for (const gone of [path.join("profiles", botId, "Default", "Cache"), "botlink", "db-snapshots", "sklubot.db", "sklubot.db-wal", "backup-status.json", ab.TMP_DIR_NAME]) assert.ok(!existsSync(path.join(d, gone)), `${gone} left out`);
  const secrets = readFileSync(path.join(dir, "x", "secrets.env"), "utf8");
  assert.match(secrets, /^SESSION_SECRET=autobackup-secret-autobackup-secret-0123$/m);
  assert.match(secrets, /^SKLUBOT_TEST_MARKER_KEY=marker-value-in-env$/m);
  const manifest = JSON.parse(readFileSync(path.join(dir, "x", "manifest.json"), "utf8"));
  assert.equal(manifest.format, 3); assert.equal(manifest.dbPath, "sklubot.db"); assert.equal(manifest.db.integrity, "ok");
  // deploy/restore-drill.sh reads the counts with this pattern (same as for deploy/backup.sh's manifests).
  assert.match(JSON.stringify(manifest), /"counts":\{[^}]*"users":2/);
});

test("restore drill: restore-from-s3 into an empty data folder; database, files and secrets all come back", async () => {
  const env = { SKLUBOT_S3_ENDPOINT: fake.url, SKLUBOT_S3_REGION: S3.region, SKLUBOT_S3_BUCKET: S3.bucket, SKLUBOT_S3_ACCESS_KEY: S3.accessKey, SKLUBOT_S3_SECRET_KEY: S3.secretKey, SKLUBOT_S3_PREFIX: "prod/sklubot", SKLUBOT_S3_PATH_STYLE: "1" };
  const work = mkdtempSync(path.join(tmpdir(), "sklubot-ab-restore-"));
  const dest = path.join(work, "data");
  const r = await restoreFromS3({ identity: key.file, outDir: path.join(work, "dl"), extract: dest, metaDir: path.join(work, "meta"), env });
  assert.equal(r.name, firstName);
  assert.equal(r.verify.ok, true, r.verify.problems.join("; "));
  assert.equal(r.extracted?.ok, true);
  const restored = inspectDb(path.join(dest, "sklubot.db"));
  assert.equal(restored.integrity, "ok");
  assert.deepEqual(restored.counts, r.verify.manifest!.db.counts);
  assert.equal(restored.counts.users, 2);
  // The SESSION_SECRET carried by the archive opens the sealed vault value of the restored database.
  const secrets = readFileSync(path.join(work, "meta", "secrets.env"), "utf8");
  const secret = /^SESSION_SECRET=(.*)$/m.exec(secrets)![1];
  assert.equal(secret, process.env.SESSION_SECRET);
  assert.deepEqual(probeSealed(path.join(dest, "sklubot.db"), unseal), { checked: true, ok: true, where: probeSealed(path.join(dest, "sklubot.db"), unseal).where });
  assert.equal(readFileSync(path.join(dest, "workspaces", path.basename(ws), "rapport é.txt"), "utf8"), "contenu de la bibliothèque");
  assert.ok(readFileSync(path.join(dest, "workspaces", path.basename(ws), "gros.bin")).equals(big));
  assert.ok(!existsSync(path.join(dest, "secrets.env")), "the secrets never land in the data folder");
  // A changed byte in the bucket is caught; so is the wrong key.
  const stored = fake.objects.get(`prod/sklubot/${firstName}`)!;
  const tampered = Buffer.from(stored); tampered[Math.floor(tampered.length / 2)] ^= 0x40;
  await assert.rejects(readArchive(Readable.from([tampered]), key.file));
  await assert.rejects(readArchive(Readable.from([stored]), generateIdentity().file), /does not open/);
});

// The same archive through deploy/restore-drill.sh: an isolated container without network, started from it, with the
// image under test doing the decryption (needs Docker and an image with this feature: SKLUBOT_TEST_APP_IMAGE).
const IMG = process.env.SKLUBOT_TEST_APP_IMAGE || "sklubot-server";
const docker = (...a: string[]) => spawnSync("docker", a, { encoding: "utf8", timeout: 120_000 });
const dockerSkip = docker("info").status !== 0 ? "Docker is not available"
  : docker("image", "inspect", IMG).status !== 0 ? `no Sklubot server image (${IMG})`
  : docker("run", "--rm", "--network", "none", IMG, "grep", "-q", "restore-from-s3", "/app/server/dist/backupcheck.js").status !== 0 ? `the ${IMG} image predates the automatic backup: rebuild it` : false;
test("deploy/restore-drill.sh accepts an archive of the automatic backup (isolated copy, health, counts, sealed value)", { skip: dockerSkip, timeout: 600_000 }, () => {
  const repo = path.resolve(import.meta.dirname, "..", "..");
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-ab-drill-"));
  writeFileSync(path.join(dir, firstName), fake.objects.get(`prod/sklubot/${firstName}`)!);
  writeFileSync(path.join(dir, "cle.txt"), key.file, { mode: 0o600 });
  const env = { ...process.env, SKLUBOT_APP_IMAGE: IMG, SKLUBOT_BACKUP_AGE_IDENTITY: path.join(dir, "cle.txt"), SKLUBOT_DATA_VOLUME: `sklubot_test_none_${process.pid}`, SKLUBOT_ENV_FILE: path.join(dir, "no.env") };
  const run = spawnSync("bash", [path.join(repo, "deploy", "restore-drill.sh"), dir], { encoding: "utf8", timeout: 600_000, env });
  const report = run.stdout + run.stderr;
  assert.equal(run.status, 0, report);
  assert.match(report, /archive déchiffrée avec la clé privée, empreintes SHA256SUMS vérifiées/);
  assert.match(report, /users : 2 \(identique/);
  assert.match(report, /une valeur scellée s'ouvre avec le SESSION_SECRET de la sauvegarde/);
  assert.match(report, /RESTAURATION VÉRIFIÉE/);
  // With another key, the drill fails (and says why).
  writeFileSync(path.join(dir, "cle.txt"), generateIdentity().file, { mode: 0o600 });
  const bad = spawnSync("bash", [path.join(repo, "deploy", "restore-drill.sh"), path.join(dir, firstName)], { encoding: "utf8", timeout: 600_000, env });
  assert.notEqual(bad.status, 0);
  assert.match(bad.stdout, /archive non restaurée/);
});

test("retention: the N newest plus the newest of each of the M previous weeks; other objects are never touched", async () => {
  const names = ["sklubot-auto-20261117-031500.tar.gz.age", "sklubot-auto-20261116-031500.tar.gz.age", "sklubot-auto-20261115-031500.tar.gz.age", "sklubot-auto-20261110-031500.tar.gz.age", "sklubot-auto-20261109-031500.tar.gz.age", "sklubot-auto-20261102-031500.tar.gz.age", "sklubot-auto-20261026-031500.tar.gz.age", "notes.txt"];
  assert.equal(isoWeek(new Date("2026-11-16T00:00:00Z")), "2026-W47");
  // 17 and 16 (the 2 newest); then the newest of week 46 (Sunday the 15th) and of week 45 (the 2nd).
  assert.deepEqual(retentionPlan(names, 2, 2), { keep: names.slice(0, 3).concat(["sklubot-auto-20261102-031500.tar.gz.age"]), remove: ["sklubot-auto-20261110-031500.tar.gz.age", "sklubot-auto-20261109-031500.tar.gz.age", "sklubot-auto-20261026-031500.tar.gz.age"] });
  // Old backups in the bucket, then a real run with keep 2 daily + 1 weekly.
  for (const n of ["sklubot-auto-20250101-031500.tar.gz.age", "sklubot-auto-20250102-031500.tar.gz.age", "sklubot-auto-20250110-031500.tar.gz.age"]) fake.objects.set(`prod/sklubot/${n}`, Buffer.from("old"));
  fake.objects.set("prod/sklubot/a-file-of-mine.txt", Buffer.from("keep me"));
  fake.objects.set("elsewhere/sklubot-auto-20200101-000000.tar.gz.age", Buffer.from("other prefix"));
  assert.equal((await call("PUT", "/settings/backup", ownerCookie, { ...settings, accessKey: "", secretKey: "", keepDaily: 2, keepWeekly: 1 })).status, 200);
  await new Promise((r) => setTimeout(r, 1100)); // a new name (second resolution)
  ab.startBackup("manual");
  const run = await ab.currentRun()!;
  assert.equal(run.ok, true, run.error ?? "");
  const left = [...fake.objects.keys()].filter((k) => k.startsWith("prod/sklubot/")).sort();
  assert.deepEqual(left, ["prod/sklubot/a-file-of-mine.txt", "prod/sklubot/sklubot-auto-20250110-031500.tar.gz.age", `prod/sklubot/${firstName}`, `prod/sklubot/${run.name}`].sort());
  assert.ok(fake.objects.has("elsewhere/sklubot-auto-20200101-000000.tar.gz.age"));
});

test("two failures in a row: the owner gets a notice (once), health says backup_failed; a success resets", async () => {
  const backupsBefore = [...fake.objects.keys()].filter((k) => k.startsWith("prod/sklubot/sklubot-auto")).length;
  fake.failWrites = true;
  after(() => { fake.failWrites = false; });
  ab.startBackup("manual");
  assert.equal((await ab.currentRun()!).ok, false);
  const notices = () => q.all<{ body: string }>("SELECT body FROM rows WHERE bot_id = ? AND kind = 'notice'", botId).map((r) => JSON.parse(r.body).text as string).filter((s) => /sauvegarde automatique/i.test(s));
  assert.equal(notices().length, 0, "not after one failure");
  ab.startBackup("schedule");
  const second = await ab.currentRun()!;
  assert.equal(second.ok, false);
  assert.match(second.error ?? "", /InternalError|storage down/);
  assert.equal(notices().length, 1);
  assert.match(notices()[0], /a échoué 2 fois de suite/);
  ab.startBackup("manual");
  await ab.currentRun();
  assert.equal(notices().length, 1, "told once per series");
  const status = JSON.parse(readFileSync(path.join(DATA, "backup-status.json"), "utf8"));
  assert.equal(status.ok, false);
  resetHealthCache();
  assert.equal((await healthReport(0)).checks.backup.code, "backup_failed");
  assert.equal((await call("GET", "/settings/backup", ownerCookie)).json.failures, 3);
  assert.equal([...fake.objects.keys()].filter((k) => k.startsWith("prod/sklubot/sklubot-auto")).length, backupsBefore, "no partial object left");
  fake.failWrites = false;
  ab.startBackup("manual");
  assert.equal((await ab.currentRun()!).ok, true);
  const v = (await call("GET", "/settings/backup", ownerCookie)).json;
  assert.equal(v.failures, 0);
});

test("the schedule: once a day at the chosen local hour (with catch-up), next run computed in the owner's time zone", async () => {
  q.run("UPDATE instance_backup SET hour = 3, timezone = 'Europe/Paris', last_slot = NULL");
  // 2026-11-18 02:10 UTC = 03:10 in Paris (UTC+1 in November).
  assert.equal(ab.scheduleTick(new Date("2026-11-18T01:30:00Z")), false, "02:30 Paris: not yet");
  assert.equal(ab.scheduleTick(new Date("2026-11-18T02:10:00Z")), true);
  const run = await ab.currentRun()!;
  assert.equal(run.trigger, "schedule");
  assert.equal(run.ok, true, run.error ?? "");
  assert.equal(ab.scheduleTick(new Date("2026-11-18T03:10:00Z")), false, "already done today");
  assert.equal(ab.scheduleTick(new Date("2026-11-19T09:00:00Z")), false, "10:00 Paris: past the catch-up window");
  assert.equal(ab.nextRunAt({ enabled: 1, hour: 3, timezone: "Europe/Paris", last_slot: "2026-11-18" }, Date.parse("2026-11-18T05:00:00Z")), Date.parse("2026-11-19T02:00:00Z"));
  assert.equal(ab.nextRunAt({ enabled: 1, hour: 3, timezone: "Asia/Kolkata", last_slot: null }, Date.parse("2026-11-18T00:00:00Z")), Date.parse("2026-11-18T21:30:00Z"));
  assert.equal(ab.nextRunAt({ enabled: 0, hour: 3, timezone: "UTC", last_slot: null }), null);
  assert.equal(objectName(new Date("2026-11-18T02:10:05.123Z")), "sklubot-auto-20261118-021005.tar.gz.age");
});

test("S3 client: list pagination and the multipart upload is aborted when a part fails", async () => {
  const s3 = new S3Client({ endpoint: fake.url, region: S3.region, bucket: S3.bucket, accessKey: S3.accessKey, secretKey: S3.secretKey, pathStyle: true });
  for (let i = 0; i < 5; i++) await s3.putObject(`pag/obj-${i}`, Buffer.from(String(i)));
  assert.equal((await s3.listObjects("pag/")).length, 5, "pages of 2 put together");
  for (let i = 0; i < 5; i++) await s3.deleteObject(`pag/obj-${i}`);
  const before = fake.requests.length;
  const { S3UploadStream } = await import("../src/s3.js");
  const up = new S3UploadStream(s3, "pag/fails", 64 * 1024);
  const partSent = () => fake.requests.slice(before).some((r) => r.method === "PUT" && r.query.includes("partNumber"));
  const source = Readable.from((async function* () {
    yield randomBytes(200_000);
    for (let i = 0; i < 200 && !partSent(); i++) await new Promise((r) => setTimeout(r, 10));
    fake.failWrites = true; // the storage goes down in the middle of the upload
    yield randomBytes(100_000);
  })());
  await assert.rejects(pipeline(source, up));
  fake.failWrites = false;
  const aborted = () => fake.requests.slice(before).some((r) => r.method === "DELETE" && r.query.includes("uploadId"));
  for (let i = 0; i < 100 && !aborted(); i++) await new Promise((r) => setTimeout(r, 20));
  assert.ok(aborted(), "AbortMultipartUpload sent");
  assert.ok(!fake.objects.has("pag/fails"));
});

test("removing the settings keeps the backups in the bucket", async () => {
  const n = [...fake.objects.keys()].length;
  const r = await call("DELETE", "/settings/backup", ownerCookie);
  assert.equal(r.status, 200);
  assert.equal(r.json.configured, false);
  assert.equal([...fake.objects.keys()].length, n);
  assert.equal((await call("POST", "/settings/backup/run", ownerCookie)).status, 409);
});
