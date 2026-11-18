import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";

// P0-06: the dedicated, versioned data key (datakey.ts) and its rotation (datakeyrotate.ts). Values sealed by the old
// code (key derived from SESSION_SECRET, no prefix) keep opening; new values carry their key id; the rotation re-seals
// every sealed column and JSON field in one transaction; a missing or wrong key gives null with a clear reason; the
// encrypted backup carries DATA_KEYS and its restored database opens with them.
const DATA = mkdtempSync(path.join(tmpdir(), "sklubot-datakey-"));
process.env.DATA_DIR = DATA;
process.env.SESSION_SECRET = "datakey-secret-datakey-secret-0123456789";
process.env.NO_SCHEDULER = "1";
process.env.COMPUTER = "browser";
process.env.PUBLIC_URL = "https://sklubot.example";
process.env.ALLOW_PRIVATE_FETCH = "1"; // the fake S3 listens on this machine
for (const k of ["OPEN_SIGNUP", "ALLOWED_EMAILS", "SETUP_CODE", "SKLUBOT_SETUP_CODE", "HOSTED_MODE", "DATA_KEYS", "DATA_KEY"]) delete process.env[k];

const K1 = randomBytes(32).toString("base64");
const K2 = randomBytes(32).toString("hex");
const OTHER = randomBytes(32).toString("base64url");

const { startFakeS3 } = await import("./fixtures/fake-s3.js");
const S3 = { bucket: "sklubot-backups", accessKey: "AKIATESTFAKE1234WXYZ", secretKey: "fake-secret-key-0123456789abcdef", region: "gra" };
const fake = await startFakeS3(S3);
after(() => fake.close());

const { api } = await import("../src/routes.js");
const { db, q } = await import("../src/db.js");
const { users } = await import("../src/store.js");
const { createSession, seal, unseal } = await import("../src/auth.js");
const dk = await import("../src/datakey.js");
const { rotateDataKeys, reportText, KNOWN_SEALED } = await import("../src/datakeyrotate.js");
const { generateIdentity } = await import("../src/agecrypt.js");
const ab = await import("../src/autobackup.js");
const { restoreFromS3, probeSealed } = await import("../src/backupcheck.js");

/** Exactly what auth.ts seal() did before the keyring (kept here to prove old values still open). */
function legacySeal(plain: string, secret = process.env.SESSION_SECRET!): string {
  const key = createHash("sha256").update("connector-tokens:" + secret).digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv, { authTagLength: 16 });
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), body].map((b) => b.toString("base64")).join(".");
}
const setKeys = (v: string | undefined) => { if (v === undefined) delete process.env.DATA_KEYS; else process.env.DATA_KEYS = v; };
after(() => setKeys(undefined));

async function call(method: string, url: string, cookie: string, body?: unknown) {
  const res = await api.request(url, { method, headers: { "content-type": "application/json", cookie, origin: "https://sklubot.example", host: "sklubot.example" }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json: any = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json, text };
}

const signup = await api.request("/auth/signup", { method: "POST", headers: { "content-type": "application/json", origin: "https://sklubot.example", host: "sklubot.example" }, body: JSON.stringify({ email: "owner@example.test", password: "owner-password-1", name: "Owner", locale: "fr" }) });
assert.equal(signup.status, 200, await signup.clone().text());
const owner = users.byEmail("owner@example.test")!;
const ownerCookie = `sklubot_session=${createSession(owner.id).token}`;
const other = users.create("bob@example.test", "Bob", "scrypt$x$y", "en");
const otherCookie = `sklubot_session=${createSession(other.id).token}`;

test("without DATA_KEYS: values sealed by the old code still open, new ones carry the id s0", () => {
  const old = legacySeal("ancienne valeur");
  assert.doesNotMatch(old, /^v2:/);
  assert.equal(unseal(old), "ancienne valeur");
  const fresh = seal("nouvelle valeur");
  assert.match(fresh, /^v2:s0:[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]+\.[A-Za-z0-9+/=]*$/);
  assert.equal(unseal(fresh), "nouvelle valeur");
  assert.equal(dk.keyIdOf(old), "s0");
  assert.equal(dk.keyIdOf(fresh), "s0");
  assert.deepEqual(dk.checkDataKeys(), { current: "s0", ids: ["s0"] });
});

test("with DATA_KEYS: new values carry the newest key's id; older keys and legacy values still open", () => {
  const legacy = legacySeal("legacy");
  const s0 = seal("sous s0");
  setKeys(`k1:${K1}`);
  const v1 = seal("sous k1");
  assert.match(v1, /^v2:k1:/);
  setKeys(` k2:${K2} , k1:${K1} `);
  const v2 = seal("sous k2");
  assert.match(v2, /^v2:k2:/);
  for (const [v, plain] of [[legacy, "legacy"], [s0, "sous s0"], [v1, "sous k1"], [v2, "sous k2"]]) assert.equal(unseal(v), plain);
  // DATA_KEY: one key, its id from the fingerprint (the same wherever it is written).
  setKeys(undefined);
  process.env.DATA_KEY = K1;
  const id = dk.keyring().current.id;
  assert.match(id, /^k[0-9a-f]{8}$/);
  assert.match(seal("x"), new RegExp(`^v2:${id}:`));
  delete process.env.DATA_KEY;
});

test("a wrong, missing or damaged key gives null — never an exception — with a clear reason", () => {
  setKeys(`k1:${K1}`);
  const v1 = seal("secret");
  setKeys(`k1:${OTHER}`); // same id, another key
  assert.equal(unseal(v1), null);
  const wrong = dk.openValue(v1);
  assert.deepEqual(wrong, { ok: false, reason: "wrong-key", keyId: "k1" });
  assert.match(dk.failureText(wrong as any), /data key "k1"/);
  setKeys(`k9:${K2}`); // k1 gone from the keyring
  const unknown = dk.openValue(v1);
  assert.deepEqual(unknown, { ok: false, reason: "unknown-key", keyId: "k1" });
  assert.match(dk.failureText(unknown as any), /no longer in DATA_KEYS: add that key back/);
  // Relabelling a value with another key id fails too (the id is authenticated as GCM additional data).
  setKeys(`k2:${K1},k1:${K1}`);
  assert.equal(unseal(v1), "secret");
  assert.equal(unseal(v1.replace(/^v2:k1:/, "v2:k2:")), null);
  for (const junk of ["", "garbage", "v2:k1:", "v2:k1:a.b.c", "a.b", "v2:../x:a.b.c", "v2:k1:" + "A".repeat(10) + ".." ]) assert.equal(unseal(junk), null, junk);
  // A shortened GCM tag is refused (as before the keyring).
  const parts = v1.slice("v2:k1:".length).split(".");
  assert.equal(unseal(`v2:k1:${parts[0]}.${Buffer.from(parts[1], "base64").subarray(0, 12).toString("base64")}.${parts[2]}`), null);
  // An unprefixed value with a SESSION_SECRET that is not the one it was sealed with.
  assert.equal(unseal(legacySeal("x", "another-session-secret-0000000000")), null);
  assert.equal(dk.openValue(legacySeal("x", "another-session-secret-0000000000")).ok, false);
  setKeys(undefined);
});

test("a malformed DATA_KEYS stops the server with the reason", () => {
  assert.throws(() => dk.parseKeyring({ DATA_KEYS: "k1:short" }, "s"), /32 bytes/);
  assert.throws(() => dk.parseKeyring({ DATA_KEYS: `k1:${K1},k1:${K2}` }, "s"), /used twice/);
  assert.throws(() => dk.parseKeyring({ DATA_KEYS: `s0:${K1}` }, "s"), /reserved/);
  assert.throws(() => dk.parseKeyring({ DATA_KEYS: `bad id!:${K1}` }, "s"), /letters, digits/);
  assert.throws(() => dk.parseKeyring({ DATA_KEY: "nope" }, "s"), /DATA_KEY/);
  assert.deepEqual(dk.parseKeyring({ DATA_KEYS: `${K1}` }, "").keys.map((k) => k.source), ["DATA_KEYS"]);
  process.env.DATA_KEYS = "k1:tooshort";
  assert.throws(() => dk.checkDataKeys(), /openssl rand -base64 32/);
  setKeys(undefined);
});

test("rotation: dry run counts, the real run re-seals every column and JSON field, then the old keys can go", async () => {
  // Values under every generation of key, in several of the sealed places.
  setKeys(undefined);
  const t = Date.now();
  q.run("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('vl', ?, 'Legacy', '', ?, ?)", owner.id, legacySeal("pw-legacy"), t);
  q.run("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('vs', ?, 'S0', '', ?, ?)", owner.id, seal("pw-s0"), t);
  setKeys(`k1:${K1}`);
  q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, created_at) VALUES ('c1', ?, 'MCP', 'https://mcp.example', ?, ?)", owner.id, seal("tok-k1"), t);
  q.run("INSERT INTO server_keys (name, public, private_enc, created_at) VALUES ('test', 'pub', ?, ?)", legacySeal("{\"jwk\":1}"), t);
  q.run("INSERT INTO settings (user_id, voice) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET voice = excluded.voice", owner.id, JSON.stringify({ mode: "auto", sttKeyEnc: legacySeal("stt-key"), fishKeyEnc: seal("fish-key") }));
  q.run("INSERT INTO two_factor (user_id, secret_enc, enabled_at, updated_at) VALUES (?, ?, ?, ?)", other.id, legacySeal("JBSWY3DPEHPK3PXP"), t, t);
  // One value no key opens: reported and left as it is.
  const broken = legacySeal("lost", "a-session-secret-nobody-has-anymore-000");
  q.run("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('vx', ?, 'Lost', '', ?, ?)", owner.id, broken, t);

  setKeys(`k2:${K2},k1:${K1}`);
  const snapshot = () => JSON.stringify(q.all("SELECT password_enc FROM vault ORDER BY id")) + JSON.stringify(q.all("SELECT voice FROM settings"));
  const before = snapshot();
  const dry = rotateDataKeys(db, { dryRun: true });
  assert.equal(snapshot(), before, "the dry run writes nothing");
  assert.equal(dry.newKey, "k2");
  assert.equal(dry.resealed, 7);
  assert.equal(dry.unreadable, 1);
  assert.ok(dry.problems.some((p) => p.includes("vault.password_enc")));
  const where = dry.locations.map((l) => l.where);
  for (const known of Object.keys(KNOWN_SEALED)) assert.ok(where.includes(known), `${known} is scanned`);
  assert.ok(where.includes("settings.voice (sttKeyEnc, ttsKeyEnc, fishKeyEnc)"));
  assert.match(reportText(dry), /Essai à blanc/);

  // Owner-only over HTTP; the rotate route is a dry run unless told otherwise.
  assert.equal((await call("GET", "/admin/data-key", otherCookie)).status, 404);
  assert.equal((await call("POST", "/admin/data-key/rotate", otherCookie, { dryRun: false })).status, 404);
  const viaApi = await call("POST", "/admin/data-key/rotate", ownerCookie, {});
  assert.equal(viaApi.status, 200);
  assert.equal(viaApi.json.report.dryRun, true);
  assert.equal(snapshot(), before);

  const real = rotateDataKeys(db);
  assert.equal(real.resealed, 7);
  assert.equal(real.unreadable, 1);
  // Everything readable is now under k2 (the unreadable value is untouched).
  for (const r of q.all<{ id: string; password_enc: string }>("SELECT id, password_enc FROM vault WHERE id IN ('vl','vs','vx')")) {
    if (r.id === "vx") assert.equal(r.password_enc, broken);
    else assert.match(r.password_enc, /^v2:k2:/);
  }
  const voice = JSON.parse(q.get<{ voice: string }>("SELECT voice FROM settings WHERE user_id = ?", owner.id)!.voice);
  assert.match(voice.sttKeyEnc, /^v2:k2:/); assert.match(voice.fishKeyEnc, /^v2:k2:/); assert.equal(voice.mode, "auto");
  // A second run has nothing left to do.
  assert.equal(rotateDataKeys(db).resealed, 0);

  // The old keys — k1 and the key derived from SESSION_SECRET — can go: k2 alone opens everything.
  const onlyK2 = dk.parseKeyring({ DATA_KEYS: `k2:${K2}` }, "");
  assert.deepEqual(onlyK2.keys.map((k) => k.id), ["k2"]);
  const open = (v: string) => { const o = dk.openValue(v, onlyK2); return o.ok ? o.value : null; };
  assert.equal(open(q.get<{ password_enc: string }>("SELECT password_enc FROM vault WHERE id = 'vl'")!.password_enc), "pw-legacy");
  assert.equal(open(q.get<{ password_enc: string }>("SELECT password_enc FROM vault WHERE id = 'vs'")!.password_enc), "pw-s0");
  assert.equal(open(q.get<{ token_enc: string }>("SELECT token_enc FROM connectors WHERE id = 'c1'")!.token_enc), "tok-k1");
  assert.equal(open(q.get<{ private_enc: string }>("SELECT private_enc FROM server_keys WHERE name = 'test'")!.private_enc), "{\"jwk\":1}");
  assert.equal(open(q.get<{ secret_enc: string }>("SELECT secret_enc FROM two_factor WHERE user_id = ?", other.id)!.secret_enc), "JBSWY3DPEHPK3PXP");
  assert.equal(open(voice.sttKeyEnc), "stt-key");
  // Without k2, nothing opens any more (and nothing crashes).
  assert.equal(dk.openValue(voice.fishKeyEnc, dk.parseKeyring({ DATA_KEYS: `k1:${K1}` }, process.env.SESSION_SECRET!)).ok, false);
  q.run("DELETE FROM vault WHERE id = 'vx'");
  q.run("DELETE FROM server_keys WHERE name = 'test'");
});

test("backup and restore: the encrypted archive carries DATA_KEYS; the restored database opens with it, not without", async () => {
  setKeys(`k2:${K2},k1:${K1}`);
  q.run("INSERT INTO vault (id, user_id, name, username, password_enc, created_at) VALUES ('vb', ?, 'Banque', '', ?, ?)", owner.id, seal("hunter2-banque"), Date.now());
  const key = generateIdentity();
  ab.setPartSizeForTests(64 * 1024);
  const saved = await call("PUT", "/settings/backup", ownerCookie, { provider: "ovh", endpoint: fake.url, region: S3.region, bucket: S3.bucket, pathStyle: true, prefix: "dk", accessKey: S3.accessKey, secretKey: S3.secretKey, recipient: key.recipient, hour: 3, timezone: "Europe/Paris", keepDaily: 7, keepWeekly: 4 });
  assert.equal(saved.status, 200, saved.text);
  assert.match(q.get<{ secret_key_enc: string }>("SELECT secret_key_enc FROM instance_backup")!.secret_key_enc, /^v2:k2:/);
  assert.equal((await call("POST", "/settings/backup/run", ownerCookie)).status, 202);
  const run = await ab.currentRun()!;
  assert.equal(run.ok, true, run.error ?? "");
  const obj = fake.objects.get(`dk/${run.name}`)!;
  assert.ok(!obj.includes(Buffer.from(K2)) && !obj.includes(Buffer.from(K1)), "the keys are only inside the encrypted archive");

  const work = mkdtempSync(path.join(tmpdir(), "sklubot-dk-restore-"));
  const dest = path.join(work, "data");
  const env = { SKLUBOT_S3_ENDPOINT: fake.url, SKLUBOT_S3_REGION: S3.region, SKLUBOT_S3_BUCKET: S3.bucket, SKLUBOT_S3_ACCESS_KEY: S3.accessKey, SKLUBOT_S3_SECRET_KEY: S3.secretKey, SKLUBOT_S3_PREFIX: "dk", SKLUBOT_S3_PATH_STYLE: "1" };
  const r = await restoreFromS3({ identity: key.file, outDir: path.join(work, "dl"), extract: dest, metaDir: path.join(work, "meta"), env });
  assert.equal(r.verify.ok, true, r.verify.problems.join("; "));
  assert.equal(r.verify.dataKeys, true);
  const secrets = readFileSync(path.join(work, "meta", "secrets.env"), "utf8");
  const keys = /^DATA_KEYS=(.*)$/m.exec(secrets)![1];
  const session = /^SESSION_SECRET=(.*)$/m.exec(secrets)![1];
  // A new server with the archive's settings (as after a real restore) opens the sealed values.
  const ring = dk.parseKeyring({ DATA_KEYS: keys }, session);
  const opener = (v: string) => { const o = dk.openValue(v, ring); return o.ok ? o.value : null; };
  const probe = probeSealed(path.join(dest, "sklubot.db"), opener);
  assert.equal(probe.checked, true); assert.equal(probe.ok, true, probe.where);
  // The old key alone (as if DATA_KEYS had been forgotten when restoring) does not: the probe says so instead of crashing.
  const without = dk.parseKeyring({}, session);
  const probeWithout = probeSealed(path.join(dest, "sklubot.db"), (v) => { const o = dk.openValue(v, without); return o.ok ? o.value : null; });
  assert.equal(probeWithout.ok, false);
  setKeys(undefined);
});
