/**
 * "Sauvegarde automatique" — an off-server backup made by the app itself, set up by the instance owner from Settings →
 * Account (a phone is enough: no SSH). Every night at the chosen hour (and on "Sauvegarder maintenant"):
 *
 *   consistent SQLite copy (VACUUM INTO, in a worker thread) + the data folder + the container's secrets
 *     → tar (streamed, tarstream.ts) → gzip → age encryption for the owner's PUBLIC key (agecrypt.ts)
 *     → S3 multipart upload, one part in memory at a time (s3.ts) → retention (N daily + M weekly) → status.
 *
 * Key handling (why a public key and not a passphrase): the server must encrypt at night with nobody there, so it
 * needs something it can use alone. With a passphrase it would have to keep that passphrase readable (sealed with
 * SESSION_SECRET), and anyone who takes the server takes both the bucket credentials and the means to read every
 * backup. With an age X25519 key pair the browser generates (WebCrypto), the owner saves the PRIVATE key (a file, and a
 * copy in a password manager) and the server keeps only the public key: it can encrypt, never decrypt — neither the
 * storage provider nor someone who steals the bucket keys or the server can read past backups. The price: lose the
 * private key and the backups are lost; the UI makes the owner save it before anything is enabled. Restoring:
 * `node server/dist/backupcheck.js restore-from-s3 …` (or `age -d -i key.txt`: the format is standard age v1).
 *
 * The bucket's access key and secret key are sealed (auth.ts seal) and never sent back to the browser.
 *
 * What is NOT in it: the bots' computers (Docker volumes sklubot-home-*, which this container cannot reach and must
 * not: it only has the filtering Docker proxy). After a restore, installs and sign-ins on those computers are to be
 * redone; deploy/backup.sh (over SSH, on the host) includes them. Also left out: the live database files (the copy
 * replaces them), the bots' link sockets, browser caches, the database copies of db-snapshots and pre-migration
 * copies, and this feature's own temporary folder.
 *
 * Runs in the background, one at a time; temporary files only in <DATA_DIR>/.backup-app-tmp (removed after each run;
 * /tmp is a small tmpfs in the production container); each S3 request times out, and the whole run too
 * (AUTO_BACKUP_TIMEOUT_HOURS, 6). The result is written to <DATA_DIR>/backup-status.json, which /api/health reads
 * (monitor.ts), like deploy/backup.sh does. Two failures in a row: a notice in the owner's main chat and a push.
 */
import { lstat, opendir, readlink } from "node:fs/promises"; import { colon, localize } from "./lang/index.js";
import { mkdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { Worker } from "node:worker_threads";
import { createGzip } from "node:zlib";
import type { Context, Hono } from "hono";
import { encryptStream, parseRecipient } from "./agecrypt.js";
import { seal, unseal } from "./auth.js";
import { ARCHIVE_FORMAT, nameDate, NAME_RE, objectName, retentionPlan } from "./backuparchive.js";
import { COUNTED_TABLES } from "./backupcheck.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { ownerId } from "./googlelogin.js";
import { tr } from "./i18n.js";
import { BACKUP_STATUS_FILE } from "./monitor.js";
import { fetchProblem, guardedFetch } from "./net.js";
import { pushLater } from "./push.js";
import { S3Client, S3Error, S3UploadStream, type S3Config } from "./s3.js";
import type { Locale } from "./shared.js";
import { audit, bots, clip, newId, now, randomToken, rows, users, type UserRecord } from "./store.js";
import { sumLine, tarStream, type TarEntry, type TarStats } from "./tarstream.js";

export const TMP_DIR_NAME = ".backup-app-tmp";
const PART_MIN = 5 * 1024 * 1024;
let partSize = Math.max(PART_MIN, Math.floor(Number(process.env.AUTO_BACKUP_PART_MB) || 16) * 1024 * 1024);
const RUN_TIMEOUT_MS = Math.max(0.1, Number(process.env.AUTO_BACKUP_TIMEOUT_HOURS) || 6) * 3_600_000;
/** Hours after the chosen hour during which a missed nightly run (server restarted, busy) still happens that day. */
const CATCH_UP_HOURS = 6;
/** Tests only: smaller parts, to exercise the multipart upload with little data. */
export const setPartSizeForTests = (bytes: number) => { partSize = bytes; };

// ── Settings ─────────────────────────────────────────────────────────────────
export const PROVIDERS = ["ovh", "hetzner", "scaleway", "other"] as const;
export type Provider = (typeof PROVIDERS)[number];
interface Row {
  enabled: number; provider: string; endpoint: string; region: string; bucket: string; path_style: number;
  access_key_enc: string; secret_key_enc: string; prefix: string; recipient: string; hour: number; timezone: string;
  keep_daily: number; keep_weekly: number; failures: number; alerted: number; last_slot: string | null;
}
interface RunRow { id: string; trigger: string; started_at: number; finished_at: number | null; ok: number | null; object_key: string | null; bytes: number | null; files: number | null; duration_ms: number | null; error: string | null }
export interface RunView { id: string; trigger: "schedule" | "manual"; startedAt: number; finishedAt: number | null; ok: boolean | null; name: string | null; bytes: number | null; files: number | null; durationMs: number | null; error: string | null }

const row = () => q.get<Row>("SELECT * FROM instance_backup WHERE id = 1") ?? null;
const toRun = (r: RunRow): RunView => ({ id: r.id, trigger: r.trigger === "manual" ? "manual" : "schedule", startedAt: r.started_at, finishedAt: r.finished_at, ok: r.ok === null ? null : !!r.ok, name: r.object_key ? path.posix.basename(r.object_key) : null, bytes: r.bytes, files: r.files, durationMs: r.duration_ms, error: r.error });

function s3For(r: Pick<Row, "endpoint" | "region" | "bucket" | "path_style">, accessKey: string, secretKey: string): S3Client {
  const cfg: S3Config = { endpoint: r.endpoint, region: r.region || "us-east-1", bucket: r.bucket, accessKey, secretKey, pathStyle: !!r.path_style };
  // Every request through guardedFetch: never this server's own network (unless ALLOW_PRIVATE_FETCH=1, for tests).
  return new S3Client(cfg, (u, i) => guardedFetch(u, i));
}
function clientFromRow(r: Row): S3Client {
  const ak = unseal(r.access_key_enc), sk = unseal(r.secret_key_enc);
  if (!ak || !sk) throw new BackupError(409, "The saved storage keys cannot be read (SESSION_SECRET changed?): enter them again.");
  return s3For(r, ak, sk);
}

export class BackupError extends Error { constructor(public status: 400 | 403 | 409 | 502, message: string) { super(message); } }

/** Local date and time in a time zone ("2026-11-17", 3, 15). */
function localParts(at: Date, timeZone: string): { date: string; hour: number; minute: number } {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(at).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
  } catch { return localParts(at, "UTC"); }
}
const validZone = (z: string) => { try { new Intl.DateTimeFormat("en", { timeZone: z }); return true; } catch { return false; } };

/** When the next scheduled run will start (ms), or null when backups are off. */
export function nextRunAt(r: Pick<Row, "enabled" | "hour" | "timezone" | "last_slot"> | null, from = Date.now()): number | null {
  if (!r || !r.enabled) return null;
  const start = Math.ceil(from / 900_000) * 900_000;
  for (let t = start; t < from + 50 * 3_600_000; t += 900_000) {
    const p = localParts(new Date(t), r.timezone);
    if (p.hour === r.hour && p.minute === 0 && p.date !== r.last_slot) return t;
  }
  return null;
}

// ── State of the current run ─────────────────────────────────────────────────
let running: { id: string; trigger: string; startedAt: number; stage: string; bytes: number; abort: AbortController; done: Promise<RunView> } | null = null;
export const backupRunning = () => !!running;
/** Tests: wait for the current run. */
export const currentRun = () => running?.done ?? null;

export function backupView() {
  const r = row();
  const history = q.all<RunRow>("SELECT * FROM backup_runs ORDER BY started_at DESC LIMIT 10").map(toRun);
  const lastOk = q.get<RunRow>("SELECT * FROM backup_runs WHERE ok = 1 ORDER BY started_at DESC LIMIT 1");
  const ak = r ? unseal(r.access_key_enc) ?? "" : "";
  return {
    configured: !!r, enabled: !!r?.enabled, provider: (r?.provider ?? "ovh") as Provider, endpoint: r?.endpoint ?? "", region: r?.region ?? "",
    bucket: r?.bucket ?? "", pathStyle: !!r?.path_style, prefix: r?.prefix ?? "sklubot/", recipient: r?.recipient ?? "",
    // The access key itself never goes back to the browser: only enough of its end to recognise it.
    accessKeyHint: ak ? `…${ak.slice(-4)}` : "", hasSecret: !!r?.secret_key_enc,
    hour: r?.hour ?? 3, timezone: r?.timezone ?? "UTC", keepDaily: r?.keep_daily ?? 7, keepWeekly: r?.keep_weekly ?? 4,
    failures: r?.failures ?? 0, nextRun: nextRunAt(r),
    running: running ? { startedAt: running.startedAt, trigger: running.trigger, stage: running.stage, bytes: running.bytes } : null,
    last: history.find((h) => h.ok !== null) ?? null, lastOk: lastOk ? toRun(lastOk) : null, history,
  };
}

// ── What goes in ─────────────────────────────────────────────────────────────
/** Chromium cache folders inside browser profiles (rebuilt by the browser; often the largest part of a profile). */
const PROFILE_CACHES = new Set(["Cache", "Code Cache", "GPUCache", "ShaderCache", "GrShaderCache", "DawnCache", "DawnGraphiteCache", "DawnWebGPUCache", "CacheStorage", "ScriptCache", "Crashpad", "component_crx_cache", "optimization_guide_model_store"]);
/** Top-level entries of the data folder left out (see the comment at the top). */
const TOP_EXCLUDED = new Set([TMP_DIR_NAME, ".backup-tmp", "db-snapshots", "botlink", "desk-test", BACKUP_STATUS_FILE, "restore-drill-status.json"]);
export const EXCLUDED_DESCRIPTION = ["live database files (replaced by db.sqlite)", "pre-migration database copies", "db-snapshots/", "botlink/ (sockets)", "desk-test/", "browser caches in profiles/", `${TMP_DIR_NAME}/`, "backup-status.json", "the bots' computers (Docker volumes sklubot-home-*)"];

function excluded(rel: string, abs: string, isDir: boolean): boolean {
  const parts = rel.split("/");
  if (parts.length === 1 && TOP_EXCLUDED.has(parts[0])) return true;
  const db = path.resolve(config.dbPath);
  if (!isDir && (abs === db || abs === `${db}-wal` || abs === `${db}-shm` || abs === `${db}-journal`)) return true;
  if (!isDir && path.dirname(abs) === path.dirname(db) && parts[parts.length - 1].startsWith(`${path.basename(db)}.pre-v`) && abs.endsWith(".bak")) return true;
  if (isDir && parts[0] === "profiles" && PROFILE_CACHES.has(parts[parts.length - 1])) return true;
  return false;
}

/** The data folder, depth first, sorted (files with the size they have now; sockets and devices skipped). */
async function* walkData(root: string, rel = ""): AsyncGenerator<TarEntry> {
  const abs = rel ? path.join(root, rel) : root;
  let dir;
  try { dir = await opendir(abs); } catch { return; }
  const names: string[] = [];
  for await (const d of dir) names.push(d.name);
  names.sort();
  for (const name of names) {
    const r = rel ? `${rel}/${name}` : name;
    const a = path.join(root, r);
    let st;
    try { st = await lstat(a); } catch { continue; } // removed meanwhile
    if (excluded(r, a, st.isDirectory())) continue;
    const common = { name: `data/${r}`, mode: st.mode & 0o7777, mtime: Math.floor(st.mtimeMs / 1000), uid: st.uid, gid: st.gid };
    if (st.isDirectory()) { yield { ...common, type: "dir" }; yield* walkData(root, r); }
    else if (st.isFile()) yield { ...common, type: "file", size: st.size, source: a };
    else if (st.isSymbolicLink()) { try { yield { ...common, type: "symlink", linkname: await readlink(a) }; } catch { /* gone */ } }
  }
}

/** The container's environment, for restoring SESSION_SECRET, DATA_KEYS (datakey.ts) and the API keys (only ever inside the encrypted archive). */
function secretsFile(stamp: string): string {
  const noise = /^(PATH|HOME|HOSTNAME|NODE_VERSION|YARN_VERSION|NODE_ENV|PWD|OLDPWD|SHLVL|TERM|_|npm_.*|INIT_CWD|COLOR|EDITOR)$/;
  const lines = [`# Secrets de Sklubot au ${stamp} (environnement du conteneur Sklubot). SESSION_SECRET (ou DATA_KEYS s'il est réglé) déchiffre le coffre et les connexions.`];
  for (const [k, v] of Object.entries(process.env).sort(([a], [b]) => a.localeCompare(b))) {
    if (v === undefined || noise.test(k) || !/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) continue;
    lines.push(/[\n\r]/.test(v) ? `${k}=${JSON.stringify(v)}` : `${k}=${v}`);
  }
  return `${lines.join("\n")}\n`;
}

/** VACUUM INTO in a worker thread (node:sqlite is synchronous: the app keeps answering meanwhile). */
function snapshotDb(src: string, out: string, timeoutMs: number): Promise<{ integrity: string; userVersion: number; counts: Record<string, number | null> }> {
  const code = `
const { parentPort, workerData } = require("node:worker_threads");
const { DatabaseSync } = require("node:sqlite");
try {
  const db = new DatabaseSync(workerData.src);
  db.exec("PRAGMA busy_timeout = 15000");
  db.exec("VACUUM INTO '" + workerData.out.replace(/'/g, "''") + "'");
  db.close();
  const snap = new DatabaseSync(workerData.out, { readOnly: true });
  const counts = {};
  for (const t of workerData.tables) { try { counts[t] = Number(snap.prepare('SELECT COUNT(*) AS n FROM "' + t + '"').get().n); } catch { counts[t] = null; } }
  const integrity = String(snap.prepare("PRAGMA integrity_check").get().integrity_check);
  const userVersion = Number(snap.prepare("PRAGMA user_version").get().user_version);
  snap.close();
  parentPort.postMessage({ ok: true, integrity, userVersion, counts });
} catch (e) { parentPort.postMessage({ ok: false, error: String((e && e.message) || e) }); }`;
  return new Promise((resolve, reject) => {
    const w = new Worker(code, { eval: true, workerData: { src, out, tables: [...COUNTED_TABLES] } });
    const timer = setTimeout(() => { void w.terminate(); reject(new Error("The database copy took too long.")); }, timeoutMs);
    w.once("message", (m: any) => { clearTimeout(timer); void w.terminate(); if (m.ok) resolve(m); else reject(new Error(`The database copy failed: ${m.error}`)); });
    w.once("error", (e) => { clearTimeout(timer); reject(e); });
  });
}

const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\..*$/, "");

function writeStatus(s: { at: number; archive: string; ok: boolean; bytes?: number; durationMs?: number; error?: string }) {
  const file = path.join(config.dataDir, BACKUP_STATUS_FILE);
  const tmp = `${file}.${process.pid}.tmp`;
  try {
    writeFileSync(tmp, `${JSON.stringify({ ...s, secrets: "age", source: "app" })}\n`, { mode: 0o600 });
    renameSync(tmp, file);
  } catch (err) { console.error("[backup] status not written:", (err as Error).message); }
}

/** Words for a failure, never a secret: S3 errors are already worded; network problems get fetchProblem's words. */
const failureText = (err: unknown) => clip(err instanceof S3Error || err instanceof BackupError ? err.message : fetchProblem(err) ?? (err as Error)?.message ?? String(err), 300);

// ── A run ────────────────────────────────────────────────────────────────────
/** Starts a backup in the background. Throws BackupError(409) when one is running or nothing is set up. */
export function startBackup(trigger: "schedule" | "manual"): { id: string } {
  if (running) throw new BackupError(409, "A backup is already running.");
  const r = row();
  if (!r) throw new BackupError(409, "Set up the automatic backup first.");
  const id = newId("bkp");
  const abort = new AbortController();
  const startedAt = now();
  q.run("INSERT INTO backup_runs (id, trigger, started_at) VALUES (?, ?, ?)", id, trigger, startedAt);
  const state = { id, trigger, startedAt, stage: "starting", bytes: 0, abort, done: null as unknown as Promise<RunView> };
  running = state;
  const timer = setTimeout(() => abort.abort(new Error("The backup took longer than the time limit.")), RUN_TIMEOUT_MS);
  timer.unref();
  state.done = runBackup(r, state).finally(() => { clearTimeout(timer); running = null; });
  void state.done.catch(() => {});
  return { id };
}

async function runBackup(r: Row, state: NonNullable<typeof running>): Promise<RunView> {
  const t0 = Date.now();
  const tmp = path.join(config.dataDir, TMP_DIR_NAME);
  const at = new Date(state.startedAt);
  const key = `${r.prefix}${objectName(at)}`;
  const stats: TarStats = { files: 0, bytes: 0, changed: [] };
  let upload: S3UploadStream | null = null;
  try {
    const s3 = clientFromRow(r);
    rmSync(tmp, { recursive: true, force: true });
    mkdirSync(tmp, { recursive: true, mode: 0o700 });
    state.stage = "database";
    const dbCopy = path.join(tmp, "db.sqlite");
    const db = await snapshotDb(config.dbPath, dbCopy, 30 * 60_000);
    if (db.integrity !== "ok") throw new Error(`The database copy is not intact (${db.integrity.slice(0, 100)}).`);
    const dbRel = path.relative(config.dataDir, path.resolve(config.dbPath));
    const manifest = {
      format: ARCHIVE_FORMAT, kind: "sklubot-app-backup", stamp: stampOf(at), at: at.getTime(), source: "app", publicUrl: config.publicUrl,
      dbPath: dbRel && !dbRel.startsWith("..") && !path.isAbsolute(dbRel) ? dbRel.split(path.sep).join("/") : "sklubot.db",
      db, homes: 0, secrets: "included", excluded: EXCLUDED_DESCRIPTION,
    };
    const sums: string[] = [];
    const dbSize = statSync(dbCopy).size;
    async function* entries(): AsyncGenerator<TarEntry> {
      const t = Math.floor(at.getTime() / 1000);
      yield { name: "manifest.json", type: "file", mode: 0o600, mtime: t, data: Buffer.from(`${JSON.stringify(manifest)}\n`) };
      yield { name: "secrets.env", type: "file", mode: 0o600, mtime: t, data: Buffer.from(secretsFile(manifest.stamp)) };
      yield { name: "db.sqlite", type: "file", mode: 0o644, mtime: t, size: dbSize, source: dbCopy };
      state.stage = "files";
      const st = statSync(config.dataDir);
      yield { name: "data", type: "dir", mode: st.mode & 0o7777, mtime: Math.floor(st.mtimeMs / 1000), uid: st.uid, gid: st.gid };
      yield* walkData(config.dataDir);
      yield { name: "SHA256SUMS", type: "file", mode: 0o600, mtime: t, data: Buffer.from(sums.join("")) };
    }
    upload = new S3UploadStream(s3, key, partSize, state.abort.signal);
    const counter = upload;
    const progress = setInterval(() => { state.bytes = counter.bytes; }, 1000);
    try {
      await pipeline(
        Readable.from(tarStream(entries(), stats, (name, hash) => { if (name !== "SHA256SUMS") sums.push(sumLine(hash, `./${name}`)); }, state.abort.signal)),
        createGzip({ level: 6 }),
        encryptStream(r.recipient),
        upload,
        { signal: state.abort.signal },
      );
    } finally { clearInterval(progress); }
    state.bytes = upload.bytes;
    const durationMs = Date.now() - t0;
    q.run("UPDATE backup_runs SET finished_at = ?, ok = 1, object_key = ?, bytes = ?, files = ?, duration_ms = ? WHERE id = ?", now(), key, upload.bytes, stats.files, durationMs, state.id);
    q.run("UPDATE instance_backup SET failures = 0, alerted = 0 WHERE id = 1");
    writeStatus({ at: now(), archive: path.posix.basename(key), ok: true, bytes: upload.bytes, durationMs });
    if (stats.changed.length) console.log(`[backup] ${stats.changed.length} file(s) changed while they were read (kept as they were listed).`);
    state.stage = "retention";
    await prune(s3, r).catch((err) => console.error("[backup] old backups not pruned:", failureText(err)));
    console.log(`[backup] ${path.posix.basename(key)} sent (${upload.bytes} bytes, ${stats.files} files, ${Math.round(durationMs / 1000)} s).`);
  } catch (err) {
    upload?.destroy(err as Error);
    const text = failureText(err);
    const durationMs = Date.now() - t0;
    q.run("UPDATE backup_runs SET finished_at = ?, ok = 0, error = ?, duration_ms = ?, files = ? WHERE id = ?", now(), text, durationMs, stats.files, state.id);
    q.run("UPDATE instance_backup SET failures = failures + 1 WHERE id = 1");
    writeStatus({ at: now(), archive: path.posix.basename(key), ok: false, error: text, durationMs });
    console.error(`[backup] failed: ${text}`);
    const after = row();
    if (after && after.failures >= 2 && !after.alerted) { q.run("UPDATE instance_backup SET alerted = 1 WHERE id = 1"); alertOwner(text, after.failures); }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  return toRun(q.get<RunRow>("SELECT * FROM backup_runs WHERE id = ?", state.id)!);
}

async function prune(s3: S3Client, r: Row): Promise<string[]> {
  const list = await s3.listObjects(r.prefix);
  const names = list.map((o) => o.key.slice(r.prefix.length)).filter((n) => NAME_RE.test(n));
  const { remove } = retentionPlan(names, r.keep_daily, r.keep_weekly);
  for (const n of remove) await s3.deleteObject(`${r.prefix}${n}`);
  if (remove.length) console.log(`[backup] ${remove.length} old backup(s) removed from the bucket.`);
  return remove;
}

function alertOwner(detail: string, failures: number) {
  const owner = ownerId();
  if (!owner) return;
  const loc: Locale = users.localeOf(owner);
  const text = tr(loc, "The automatic backup failed {n} times in a row: {detail}", { n: failures, detail });
  const main = bots.primary(owner);
  if (main) rows.append(main, { kind: "notice", tone: "warn", text, action: { kind: "settings", section: "account" } });
  pushLater(owner, { kind: "needs", title: tr(loc, "Backup failed"), body: text, tag: "auto-backup" });
  audit(owner, "account", `Automatic backup: ${failures} failures in a row (${clip(detail, 120)})`);
}

// ── The schedule ─────────────────────────────────────────────────────────────
/** One check: is it the chosen hour (or a little after, for a missed run) on a day not done yet? */
export function scheduleTick(at = new Date()): boolean {
  const r = row();
  if (!r || !r.enabled || running) return false;
  const p = localParts(at, r.timezone);
  if (p.date === r.last_slot || p.hour < r.hour || p.hour >= r.hour + CATCH_UP_HOURS) return false;
  q.run("UPDATE instance_backup SET last_slot = ? WHERE id = 1", p.date);
  try { startBackup("schedule"); return true; } catch { return false; }
}
let ticking = false;
export function startAutoBackup() {
  if (config.schedulerOff || ticking) return;
  ticking = true;
  // A run cut off by a restart is marked as failed (nothing of it is in the bucket: the multipart upload was never completed).
  q.run("UPDATE backup_runs SET finished_at = ?, ok = 0, error = 'Interrupted by a restart of the server.' WHERE finished_at IS NULL", now());
  rmSync(path.join(config.dataDir, TMP_DIR_NAME), { recursive: true, force: true });
  setInterval(() => { try { scheduleTick(); } catch (err) { console.error("[backup] schedule:", (err as Error).message); } }, 60_000).unref();
}

// ── Checking a configuration ─────────────────────────────────────────────────
/** Writes, reads back and deletes a tiny object. Returns the steps that worked; throws BackupError(502) with the reason. */
export async function testConnection(s3: S3Client, prefix: string): Promise<{ steps: string[] }> {
  const key = `${prefix}.sklubot-test-${randomToken(6)}`;
  const body = Buffer.from(`Sklubot connection test ${new Date().toISOString()}\n`);
  const steps: string[] = [];
  const step = async (name: string, fn: () => Promise<void>) => {
    try { await fn(); steps.push(name); } catch (err) { throw new BackupError(502, `${name}: ${failureText(err)}`); }
  };
  await step("write", () => s3.putObject(key, body));
  await step("read", async () => {
    const got = Buffer.from(await (await s3.getObject(key)).arrayBuffer());
    if (!got.equals(body)) throw new Error("the object read back is not the one written");
  });
  await step("list", async () => { await s3.listObjects(prefix); });
  await step("delete", () => s3.deleteObject(key));
  return { steps };
}

export async function remoteBackups(): Promise<{ name: string; size: number; at: number }[]> {
  const r = row();
  if (!r) return [];
  const list = await clientFromRow(r).listObjects(r.prefix);
  return list.map((o) => ({ name: o.key.slice(r.prefix.length), size: o.size, at: nameDate(o.key.slice(r.prefix.length))?.getTime() ?? 0 }))
    .filter((o) => NAME_RE.test(o.name)).sort((a, b) => b.at - a.at);
}

// ── Routes (owner only) ──────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "Only the owner of this server can change this.": "Seul le propriétaire de ce serveur peut modifier ceci.",
  "A backup is already running.": "Une sauvegarde est déjà en cours.",
  "Set up the automatic backup first.": "Configure d'abord la sauvegarde automatique.",
  "Enter the storage's address (https://…).": "Entre l'adresse du stockage (https://…).",
  "Enter the region (letters, digits and dashes).": "Entre la région (lettres, chiffres et tirets).",
  "Enter a valid bucket name (3 to 63 lowercase letters, digits, dots or dashes).": "Entre un nom de bucket valide (3 à 63 minuscules, chiffres, points ou tirets).",
  "Enter the access key.": "Entre la clé d'accès.",
  "Enter the secret key.": "Entre la clé secrète.",
  "The folder (prefix) may only contain letters, digits, dots, dashes, underscores and slashes.": "Le dossier (préfixe) ne peut contenir que des lettres, chiffres, points, tirets, tirets bas et barres obliques.",
  "Create the backup key first (step 1).": "Crée d'abord la clé de sauvegarde (étape 1).",
  "This is not an age public key (it starts with age1…).": "Ce n'est pas une clé publique age (elle commence par age1…).",
  "This is not an age X25519 public key (age1…).": "Ce n'est pas une clé publique age X25519 (age1…).",
  "Choose an hour between 0 and 23.": "Choisis une heure entre 0 et 23.",
  "Unknown time zone.": "Fuseau horaire inconnu.",
  "Keep between 1 and 60 daily backups, and 0 to 52 weekly.": "Garde entre 1 et 60 sauvegardes quotidiennes, et 0 à 52 hebdomadaires.",
  "The saved storage keys cannot be read (SESSION_SECRET changed?): enter them again.": "Les clés du stockage enregistrées ne se lisent plus (SESSION_SECRET changé ?) : saisis-les à nouveau.",
  "The endpoint is not a valid address (https://…).": "L'adresse du stockage n'est pas valide (https://…).",
  "The endpoint must start with https://.": "L'adresse du stockage doit commencer par https://.",
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes et réessaie.",
  "write": "écriture", "read": "lecture", "list": "liste", "delete": "suppression",
  "The access key is not known to this storage.": "Ce stockage ne connaît pas cette clé d'accès.",
  "The secret key does not match the access key (or the region is wrong).": "La clé secrète ne correspond pas à la clé d'accès (ou la région est fausse).",
  "The storage refused access: check that the key may write to this bucket.": "Le stockage a refusé l'accès : vérifie que la clé a le droit d'écrire dans ce bucket.",
  "This bucket does not exist at this endpoint (check its name and region).": "Ce bucket n'existe pas à cette adresse (vérifie son nom et sa région).",
  "The region does not match this storage (check the region).": "La région ne correspond pas à ce stockage (vérifie la région).",
  "This bucket lives in another region: use that region's endpoint.": "Ce bucket est dans une autre région : utilise l'adresse de cette région.",
  "That address is on a private or local network, which this server does not reach.": "Cette adresse est sur un réseau privé ou local, que ce serveur ne joint pas.",
  "The request took too long.": "La demande a pris trop de temps.",
  "That address could not be found.": "Cette adresse est introuvable.",
  "That server could not be reached.": "Ce serveur est injoignable.",
};
/** French for a message, including "step: reason" built from known parts. */
const m = (locale: Locale, english: string): string => {
  if (locale === "en") return english;
  const whole = localize(locale, english, FR); // other languages: lang/<code>.ts
  if (whole !== english) return whole;
  const i = english.indexOf(": ");
  const head = i > 0 ? localize(locale, english.slice(0, i), FR) : "";
  if (i > 0 && head !== english.slice(0, i)) return `${head}${colon(locale)}${m(locale, english.slice(i + 2))}`;
  return english;
};

interface Deps { throttle(key: string, limit?: number): void }
const BUCKET_RE = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

function parseSettings(b: Record<string, unknown>, cur: Row | null) {
  const endpointRaw = String(b.endpoint ?? "").trim();
  let endpoint: string;
  try {
    const u = new URL(/^[a-z]+:\/\//i.test(endpointRaw) ? endpointRaw : `https://${endpointRaw}`);
    const httpOk = process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
    if (u.protocol !== "https:" && !(httpOk && u.protocol === "http:")) throw new Error();
    if (u.username || u.password || !u.hostname) throw new Error();
    endpoint = u.origin;
  } catch { throw new BackupError(400, "Enter the storage's address (https://…)."); }
  const region = String(b.region ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{0,40}$/.test(region)) throw new BackupError(400, "Enter the region (letters, digits and dashes).");
  const bucket = String(b.bucket ?? "").trim();
  if (!BUCKET_RE.test(bucket) || bucket.includes("..")) throw new BackupError(400, "Enter a valid bucket name (3 to 63 lowercase letters, digits, dots or dashes).");
  let prefix = String(b.prefix ?? "sklubot/").trim().replace(/^\/+/, "");
  if (prefix.length > 200 || !/^[A-Za-z0-9._\/-]*$/.test(prefix) || prefix.split("/").some((s) => s === "..")) throw new BackupError(400, "The folder (prefix) may only contain letters, digits, dots, dashes, underscores and slashes.");
  if (prefix && !prefix.endsWith("/")) prefix += "/";
  const accessKey = typeof b.accessKey === "string" && b.accessKey.trim() ? b.accessKey.trim().slice(0, 200) : null;
  const secretKey = typeof b.secretKey === "string" && b.secretKey.trim() ? b.secretKey.trim().slice(0, 500) : null;
  if (!accessKey && !cur) throw new BackupError(400, "Enter the access key.");
  if (!secretKey && !cur) throw new BackupError(400, "Enter the secret key.");
  const provider = (PROVIDERS as readonly string[]).includes(String(b.provider)) ? String(b.provider) : "other";
  return { endpoint, region, bucket, prefix, accessKey, secretKey, provider, pathStyle: b.pathStyle === true };
}

export function registerAutoBackupRoutes(api: Hono<any>, deps: Deps) {
  const ownerOnly = (c: Context): UserRecord => {
    const user = c.get("user") as UserRecord;
    if (ownerId() !== user.id) throw new BackupError(403, "Only the owner of this server can change this.");
    return user;
  };
  const handle = (fn: (c: Context, user: UserRecord, b: Record<string, unknown>) => Promise<Response> | Response) => async (c: Context) => {
    const locale = (c.get("user") as UserRecord).locale;
    try {
      const user = ownerOnly(c);
      const b = c.req.method === "GET" || c.req.method === "DELETE" ? {} : ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
      return await fn(c, user, b && typeof b === "object" ? b : {});
    } catch (err) {
      if (err instanceof BackupError) return c.json({ error: m(locale, err.message) }, err.status);
      if (err instanceof Error && /^(This is not an age|The endpoint)/.test(err.message)) return c.json({ error: m(locale, err.message) }, 400);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return c.json({ error: m(locale, "Too many attempts. Wait a few minutes and try again.") }, 403);
      throw err;
    }
  };

  api.get("/settings/backup", handle((c) => c.json(backupView())));

  api.put("/settings/backup", handle((c, user, b) => {
    const cur = row();
    const s = parseSettings(b, cur);
    const recipient = String(b.recipient ?? "").trim();
    if (!recipient) throw new BackupError(400, "Create the backup key first (step 1).");
    parseRecipient(recipient);
    const hour = Number(b.hour);
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new BackupError(400, "Choose an hour between 0 and 23.");
    const timezone = String(b.timezone ?? "UTC").trim() || "UTC";
    if (timezone.length > 64 || !validZone(timezone)) throw new BackupError(400, "Unknown time zone.");
    const keepDaily = Number(b.keepDaily), keepWeekly = Number(b.keepWeekly);
    if (!Number.isInteger(keepDaily) || keepDaily < 1 || keepDaily > 60 || !Number.isInteger(keepWeekly) || keepWeekly < 0 || keepWeekly > 52) throw new BackupError(400, "Keep between 1 and 60 daily backups, and 0 to 52 weekly.");
    const enabled = b.enabled === false ? 0 : 1;
    // Saved after today's hour: the first nightly run is tomorrow ("Sauvegarder maintenant" is there for today).
    const p = localParts(new Date(), timezone);
    const lastSlot = cur && cur.hour === hour && cur.timezone === timezone ? cur.last_slot : p.hour >= hour ? p.date : null;
    q.run(`INSERT INTO instance_backup (id, enabled, provider, endpoint, region, bucket, path_style, access_key_enc, secret_key_enc, prefix, recipient, hour, timezone, keep_daily, keep_weekly, last_slot, updated_at, updated_by)
      VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET enabled = excluded.enabled, provider = excluded.provider, endpoint = excluded.endpoint, region = excluded.region, bucket = excluded.bucket,
      path_style = excluded.path_style, access_key_enc = excluded.access_key_enc, secret_key_enc = excluded.secret_key_enc, prefix = excluded.prefix, recipient = excluded.recipient,
      hour = excluded.hour, timezone = excluded.timezone, keep_daily = excluded.keep_daily, keep_weekly = excluded.keep_weekly, last_slot = excluded.last_slot,
      updated_at = excluded.updated_at, updated_by = excluded.updated_by`,
      enabled, s.provider, s.endpoint, s.region, s.bucket, s.pathStyle ? 1 : 0,
      s.accessKey ? seal(s.accessKey) : cur!.access_key_enc, s.secretKey ? seal(s.secretKey) : cur!.secret_key_enc,
      s.prefix, recipient, hour, timezone, keepDaily, keepWeekly, lastSlot, now(), user.id);
    audit(user.id, "account", `Automatic backup settings saved: ${s.bucket} at ${s.endpoint}, daily at ${hour}:00 (${timezone}), keep ${keepDaily}+${keepWeekly}${enabled ? "" : ", paused"}`);
    return c.json(backupView());
  }));

  api.delete("/settings/backup", handle((c, user) => {
    if (running) throw new BackupError(409, "A backup is already running.");
    q.run("DELETE FROM instance_backup WHERE id = 1");
    audit(user.id, "account", "Automatic backup settings removed (the backups already in the bucket stay there)");
    return c.json(backupView());
  }));

  // Tests the values in the form (the saved keys fill in what is left empty), without saving anything.
  api.post("/settings/backup/test", handle(async (c, user, b) => {
    deps.throttle(`backup-test:${user.id}`, 20);
    const cur = row();
    const s = parseSettings(b, cur);
    const ak = s.accessKey ?? (cur ? unseal(cur.access_key_enc) : null);
    const sk = s.secretKey ?? (cur ? unseal(cur.secret_key_enc) : null);
    if (!ak || !sk) throw new BackupError(409, "The saved storage keys cannot be read (SESSION_SECRET changed?): enter them again.");
    const r = await testConnection(s3For({ endpoint: s.endpoint, region: s.region, bucket: s.bucket, path_style: s.pathStyle ? 1 : 0 }, ak, sk), s.prefix);
    audit(user.id, "account", `Automatic backup: connection test to ${s.bucket} at ${s.endpoint} passed`);
    return c.json({ ok: true, steps: r.steps });
  }));

  api.post("/settings/backup/run", handle((c, user) => {
    deps.throttle(`backup-run:${user.id}`, 20);
    const r = startBackup("manual");
    audit(user.id, "account", "Automatic backup started by hand");
    return c.json({ started: true, id: r.id, view: backupView() }, 202);
  }));

  api.get("/settings/backup/remote", handle(async (c) => {
    try { return c.json({ backups: await remoteBackups() }); } catch (err) { throw err instanceof BackupError ? err : new BackupError(502, failureText(err)); }
  }));
}
