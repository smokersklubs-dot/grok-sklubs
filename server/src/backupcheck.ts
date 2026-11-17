/**
 * Backup checks (SK-P0-04), run inside a Sklubot container by deploy/restore-drill.sh (and usable by hand):
 *
 *   node server/dist/backupcheck.js            → JSON: integrity_check, row counts, and whether one sealed value
 *                                                 (vault, connector token…) opens with this server's SESSION_SECRET
 *   node server/dist/backupcheck.js counts F   → JSON: integrity_check and row counts of the database file F only
 *   node server/dist/backupcheck.js snapshot [N] → an online, consistent copy of the database (VACUUM INTO) in
 *                                                 <DATA_DIR>/db-snapshots, keeping the N newest (7). For a Coolify
 *                                                 scheduled task inside the container: it protects against a bad update
 *                                                 or a corrupted file, NOT against losing the server (same disk) — the
 *                                                 full, off-server backup is deploy/backup.sh on the host.
 *
 *
 * The in-app backup to S3 (autobackup.ts; archives `sklubot-auto-….tar.gz.age`, encrypted with age for the owner's
 * public key — format in backuparchive.ts). The private key file (AGE-SECRET-KEY-1…) is given with --identity:
 *
 *   node server/dist/backupcheck.js keygen                          → a new age key pair (like age-keygen)
 *   node server/dist/backupcheck.js decrypt --identity K [IN] [OUT]  → the plain .tar.gz (stdin/stdout by default)
 *   node server/dist/backupcheck.js verify --identity K ARCHIVE      → decrypts and checks every file (SHA256SUMS)
 *   node server/dist/backupcheck.js extract --identity K ARCHIVE DATA_DIR [--meta DIR]
 *                                         → restores the data folder into DATA_DIR (data files, then the database at
 *                                           its dbPath), manifest.json and secrets.env into DIR (default: next to the
 *                                           archive, mode 600; never inside DATA_DIR). Run on an EMPTY data folder,
 *                                           with Sklubot stopped.
 *   node server/dist/backupcheck.js s3-list                          → the backups in the bucket
 *   node server/dist/backupcheck.js restore-from-s3 --identity K [--name NAME|latest] [--out DIR] [--extract DATA_DIR] [--meta DIR]
 *                                         → downloads one backup (the latest by default) to DIR, verifies it end to end,
 *                                           and with --extract restores it as `extract` does
 *   The bucket comes from the environment (not the command line, which other users of the machine can see):
 *   SKLUBOT_S3_ENDPOINT, SKLUBOT_S3_REGION, SKLUBOT_S3_BUCKET, SKLUBOT_S3_ACCESS_KEY, SKLUBOT_S3_SECRET_KEY,
 *   SKLUBOT_S3_PREFIX (sklubot/), SKLUBOT_S3_PATH_STYLE=1 for path-style addressing.
 *
 * It never prints a secret: only which table/column was tried and whether it opened.
 */
import { createReadStream, createWriteStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

/** The tables a backup's manifest counts (deploy/backup.sh counts the same ones). */
export const COUNTED_TABLES = ["users", "bots", "rows", "memories", "skills", "routines", "connectors", "vault", "usage"] as const;

export function inspectDb(file: string): { integrity: string; userVersion: number; counts: Record<string, number | null> } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const integrity = String((db.prepare("PRAGMA integrity_check").get() as Record<string, unknown>)?.integrity_check ?? "unknown");
    const userVersion = Number((db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version);
    const counts: Record<string, number | null> = {};
    for (const t of COUNTED_TABLES) {
      try { counts[t] = Number((db.prepare(`SELECT COUNT(*) AS n FROM "${t}"`).get() as { n: number }).n); } catch { counts[t] = null; }
    }
    return { integrity, userVersion, counts };
  } finally { db.close(); }
}

/** One sealed value of the database (any column whose name ends in _enc), and whether `open` turns it back into text. */
export function probeSealed(file: string, open: (sealed: string) => string | null): { checked: boolean; ok: boolean; where?: string } {
  const db = new DatabaseSync(file, { readOnly: true });
  try {
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as { name: string }[]).map((r) => r.name);
    for (const t of tables) {
      for (const c of (db.prepare(`PRAGMA table_info("${t}")`).all() as { name: string }[]).map((r) => r.name).filter((n) => n.endsWith("_enc"))) {
        const row = db.prepare(`SELECT "${c}" AS v FROM "${t}" WHERE "${c}" IS NOT NULL AND "${c}" <> '' LIMIT 1`).get() as { v: string } | undefined;
        if (row?.v) return { checked: true, ok: open(row.v) !== null, where: `${t}.${c}` };
      }
    }
    return { checked: false, ok: false };
  } finally { db.close(); }
}

/** VACUUM INTO a dated file (https://www.sqlite.org/lang_vacuum.html#vacuuminto): consistent while the server writes. */
export function snapshot(dbFile: string, dir: string, keep = 7): { file: string; removed: string[] } {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\..*/, "");
  const file = path.join(dir, `sklubot-${stamp}.db`);
  const db = new DatabaseSync(dbFile);
  try { db.exec("PRAGMA busy_timeout = 10000"); db.exec(`VACUUM INTO '${file.replace(/'/g, "''")}'`); } finally { db.close(); }
  const all = readdirSync(dir).filter((f) => /^sklubot-\d{8}-\d{6}\.db$/.test(f)).sort().reverse();
  const removed = all.slice(Math.max(1, keep));
  for (const f of removed) rmSync(path.join(dir, f), { force: true });
  return { file, removed };
}

// ── The in-app backup's archives ─────────────────────────────────────────────
function flag(argv: string[], name: string): string | undefined {
  const i = argv.indexOf(`--${name}`);
  if (i < 0) return undefined;
  const v = argv[i + 1];
  argv.splice(i, 2);
  return v;
}
function identityFrom(file: string | undefined): string {
  if (!file) throw new Error("give the private key file with --identity <file> (AGE-SECRET-KEY-1…)");
  return readFileSync(file, "utf8");
}
/** The bucket, from SKLUBOT_S3_* environment variables. */
export async function s3FromEnv(env: NodeJS.ProcessEnv = process.env) {
  const { S3Client } = await import("./s3.js");
  const need = (k: string) => { const v = (env[k] ?? "").trim(); if (!v) throw new Error(`set ${k}`); return v; };
  let prefix = (env.SKLUBOT_S3_PREFIX ?? "sklubot/").trim().replace(/^\/+/, "");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  const endpoint = need("SKLUBOT_S3_ENDPOINT");
  const s3 = new S3Client({ endpoint: /^https?:\/\//.test(endpoint) ? endpoint : `https://${endpoint}`, region: (env.SKLUBOT_S3_REGION ?? "").trim() || "us-east-1", bucket: need("SKLUBOT_S3_BUCKET"), accessKey: need("SKLUBOT_S3_ACCESS_KEY"), secretKey: need("SKLUBOT_S3_SECRET_KEY"), pathStyle: env.SKLUBOT_S3_PATH_STYLE === "1" || env.SKLUBOT_S3_PATH_STYLE === "true" }, undefined, 15 * 60_000);
  return { s3, prefix };
}
export async function listRemote(env: NodeJS.ProcessEnv = process.env) {
  const { NAME_RE } = await import("./backuparchive.js");
  const { s3, prefix } = await s3FromEnv(env);
  return (await s3.listObjects(prefix)).map((o) => ({ name: o.key.slice(prefix.length), size: o.size, lastModified: o.lastModified })).filter((o) => NAME_RE.test(o.name)).sort((a, b) => b.name.localeCompare(a.name));
}
/**
 * Downloads one backup from the bucket (the latest by default), checks it end to end with the private key, and with
 * `extract` restores it into that data folder. The download goes to `outDir` first (never straight into the data).
 */
export async function restoreFromS3(o: { identity: string; name?: string; outDir: string; extract?: string; metaDir?: string; env?: NodeJS.ProcessEnv }) {
  const { readArchive } = await import("./backuparchive.js");
  const { s3, prefix } = await s3FromEnv(o.env);
  const list = await listRemote(o.env);
  const name = !o.name || o.name === "latest" ? list[0]?.name : o.name;
  if (!name || !list.some((b) => b.name === name)) throw new Error(list.length ? `no backup named ${o.name} in the bucket` : "no backup in the bucket (check SKLUBOT_S3_PREFIX)");
  mkdirSync(o.outDir, { recursive: true, mode: 0o700 });
  const file = path.join(o.outDir, name);
  const res = await s3.getObject(`${prefix}${name}`);
  await pipeline(Readable.fromWeb(res.body as any), createWriteStream(`${file}.part`, { mode: 0o600 }));
  renameSync(`${file}.part`, file);
  const check = await readArchive(createReadStream(file), o.identity);
  if (!check.ok || !o.extract) return { file, name, verify: check, extracted: null };
  const meta = o.metaDir ?? path.join(o.outDir, `${name}.meta`);
  const extracted = await readArchive(createReadStream(file), o.identity, { dest: o.extract, metaDir: meta, keepOwner: true });
  return { file, name, verify: check, extracted, meta };
}
const summary = (r: { ok: boolean; manifest: Record<string, any> | null; files: number; bytes: number; checked: number; problems: string[]; hasSecrets: boolean; sessionSecret: boolean }) =>
  ({ ok: r.ok, files: r.files, bytes: r.bytes, checked: r.checked, problems: r.problems.slice(0, 20), secrets: r.hasSecrets, sessionSecret: r.sessionSecret, stamp: r.manifest?.stamp, dbPath: r.manifest?.dbPath, db: r.manifest?.db });

async function archiveCommand(cmd: string, argv: string[]): Promise<number> {
  const { decryptTo, readArchive } = await import("./backuparchive.js");
  if (cmd === "keygen") {
    const { generateIdentity } = await import("./agecrypt.js");
    const k = generateIdentity();
    process.stdout.write(k.file);
    process.stderr.write(`Public key: ${k.recipient}\n`);
    return 0;
  }
  const idFile = flag(argv, "identity");
  if (cmd === "decrypt") {
    const identity = identityFrom(idFile);
    await decryptTo(argv[0] && argv[0] !== "-" ? createReadStream(argv[0]) : process.stdin, identity, argv[1] && argv[1] !== "-" ? createWriteStream(argv[1], { mode: 0o600 }) : process.stdout);
    return 0;
  }
  if (cmd === "verify") {
    if (!argv[0]) throw new Error("usage: backupcheck verify --identity <key file> <archive.tar.gz.age>");
    const r = await readArchive(createReadStream(argv[0]), identityFrom(idFile));
    process.stdout.write(JSON.stringify(summary(r)) + "\n");
    return r.ok ? 0 : 3;
  }
  if (cmd === "extract") {
    const metaFlag = flag(argv, "meta");
    if (!argv[0] || !argv[1]) throw new Error("usage: backupcheck extract --identity <key file> <archive.tar.gz.age> <data folder> [--meta <folder>]");
    const identity = identityFrom(idFile);
    const meta = metaFlag ?? `${argv[0]}.meta`;
    if (path.resolve(meta).startsWith(path.resolve(argv[1]) + path.sep)) throw new Error("--meta must not be inside the data folder (it receives the secrets)");
    const r = await readArchive(createReadStream(argv[0]), identity, { dest: argv[1], metaDir: meta, keepOwner: true });
    process.stdout.write(JSON.stringify({ ...summary(r), meta }) + "\n");
    return r.ok ? 0 : 3;
  }
  if (cmd === "s3-list") { process.stdout.write(JSON.stringify(await listRemote()) + "\n"); return 0; }
  if (cmd === "restore-from-s3") {
    const name = flag(argv, "name"), out = flag(argv, "out") ?? ".", extract = flag(argv, "extract"), meta = flag(argv, "meta");
    if (extract && existsSync(extract) && readdirSync(extract).length && !argv.includes("--force")) throw new Error(`${extract} is not empty: restore into an empty data folder (or add --force)`);
    const r = await restoreFromS3({ identity: identityFrom(idFile), name, outDir: out, extract, metaDir: meta });
    process.stdout.write(JSON.stringify({ file: r.file, verify: summary(r.verify), extracted: r.extracted ? summary(r.extracted) : null, meta: r.meta ?? null }) + "\n");
    return r.verify.ok && (!extract || r.extracted?.ok) ? 0 : 3;
  }
  return -1;
}

async function main(argv: string[]) {
  if (["keygen", "decrypt", "verify", "extract", "s3-list", "restore-from-s3"].includes(argv[0])) {
    const code = await archiveCommand(argv[0], argv.slice(1));
    if (code) process.exitCode = code;
    return;
  }
  if (argv[0] === "snapshot") {
    const { config } = await import("./config.js");
    const keep = Math.max(1, Math.floor(Number(argv[1]) || 7));
    const r = snapshot(config.dbPath, path.join(config.dataDir, "db-snapshots"), keep);
    process.stdout.write(JSON.stringify({ ...r, ...inspectDb(r.file) }) + "\n");
    return;
  }
  if (argv[0] === "counts") {
    if (!argv[1]) throw new Error("usage: backupcheck counts <database file>");
    process.stdout.write(JSON.stringify(inspectDb(argv[1])) + "\n");
    return;
  }
  // The full check uses the server's own settings (DB_PATH / DATA_DIR, SESSION_SECRET) and its own unseal().
  const { config } = await import("./config.js");
  const { unseal } = await import("./auth.js");
  const report = { ...inspectDb(config.dbPath), sealed: probeSealed(config.dbPath, unseal) };
  process.stdout.write(JSON.stringify(report) + "\n");
}

if (process.argv[1] && /backupcheck\.(js|ts)$/.test(process.argv[1])) {
  main(process.argv.slice(2)).catch((err) => { process.stderr.write(`backupcheck: ${(err as Error).message}\n`); process.exit(2); });
}
