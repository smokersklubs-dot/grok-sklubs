/**
 * The archive of the in-app backup (autobackup.ts), and the tools that read it back (backupcheck.ts). No database
 * import here: the restore tool runs on a server whose data folder is empty or not mounted yet.
 *
 * An object in the bucket is named `<prefix>sklubot-auto-AAAAMMJJ-HHMMSS.tar.gz.age` (UTC) and is:
 *
 *   age v1 (X25519, the owner's public key; agecrypt.ts)
 *     └─ gzip (RFC 1952)
 *          └─ tar (ustar + pax; tarstream.ts), entries in this order:
 *               manifest.json   {"format":3,"kind":"sklubot-app-backup","stamp","at","source":"app","dbPath",
 *                                "db":{"integrity","userVersion","counts":{users,bots,rows…}},"homes":0,
 *                                "secrets":"included","excluded":[…]}
 *               secrets.env     the app container's environment (SESSION_SECRET, DATA_KEYS, API keys…) — only ever inside the
 *                               encrypted archive
 *               db.sqlite       a consistent copy of the database (VACUUM INTO)
 *               data/…          the data folder (bot libraries, team folders, browser profiles without caches…)
 *               SHA256SUMS      the SHA-256 of every file above, in `sha256sum -c` format (last, as it is computed
 *                               while the archive streams out)
 *
 * The manifest's "dbPath" and "db.counts" use the same names as deploy/backup.sh's archives (format 2), so
 * deploy/restore-drill.sh compares counts the same way for both.
 */
import { createHash } from "node:crypto";
import { once } from "node:events";
import { createWriteStream, mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PassThrough, Writable, type Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";
import { decryptStream } from "./agecrypt.js";
import { extractTo, parseSumLine, tarReader, type TarReadEntry } from "./tarstream.js";

export const ARCHIVE_FORMAT = 3;
export const NAME_RE = /^sklubot-auto-(\d{8})-(\d{6})\.tar\.gz\.age$/;
export const objectName = (d: Date) => `sklubot-auto-${d.toISOString().replace(/[-:]/g, "").replace("T", "-").replace(/\..*$/, "")}.tar.gz.age`;
/** The date in a backup's name (UTC), or null for a name that is not one of ours. */
export function nameDate(name: string): Date | null {
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const d = new Date(`${m[1].slice(0, 4)}-${m[1].slice(4, 6)}-${m[1].slice(6, 8)}T${m[2].slice(0, 2)}:${m[2].slice(2, 4)}:${m[2].slice(4, 6)}Z`);
  return Number.isNaN(d.getTime()) ? null : d;
}
/** ISO 8601 week of a date (UTC): "2026-W46". */
export function isoWeek(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const y0 = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  const w = Math.ceil(((t.getTime() - y0.getTime()) / 86_400_000 + 1) / 7);
  return `${t.getUTCFullYear()}-W${String(w).padStart(2, "0")}`;
}
/**
 * Which backups to keep: the `keepDaily` newest, plus the newest of each of the `keepWeekly` previous weeks that have
 * one (same rule as deploy/backup.sh). Names that are not ours are never in either list (never deleted).
 */
export function retentionPlan(names: string[], keepDaily: number, keepWeekly: number): { keep: string[]; remove: string[] } {
  const ours = names.filter((n) => nameDate(n)).sort().reverse();
  const keep: string[] = [], remove: string[] = [];
  const weeks = new Set<string>();
  ours.forEach((n, i) => {
    if (i < Math.max(1, keepDaily)) { keep.push(n); return; }
    const w = isoWeek(nameDate(n)!);
    if (!weeks.has(w) && weeks.size < keepWeekly) { weeks.add(w); keep.push(n); return; }
    remove.push(n);
  });
  return { keep, remove };
}

export interface ArchiveReport {
  ok: boolean;
  manifest: Record<string, any> | null;
  files: number;
  bytes: number;
  checked: number;
  problems: string[];
  hasSecrets: boolean;
  sessionSecret: boolean;
  /** secrets.env holds a dedicated data key (DATA_KEYS / DATA_KEY, datakey.ts): needed with it to open the sealed values. */
  dataKeys: boolean;
}

/**
 * Reads an archive (the encrypted stream) end to end: decrypts it with the private key, checks every file against
 * SHA256SUMS, and, when `dest` is given, writes the data folder there (data/… into dest, db.sqlite at dest/<dbPath>).
 * `metaDir` receives manifest.json and secrets.env (mode 600) — never inside the data folder.
 */
export async function readArchive(input: Readable, identityText: string, opts: { dest?: string; metaDir?: string; keepOwner?: boolean } = {}): Promise<ArchiveReport> {
  const hashes = new Map<string, string>();
  const sizes = new Map<string, number>();
  let sums = "";
  let manifestText = "";
  let secretsText = "";
  let dbRel = "sklubot.db";
  const extract = opts.dest ? extractTo(opts.dest, "data/", { keepOwner: opts.keepOwner }) : null;
  const dbTmp = opts.dest ? path.join(opts.dest, ".restore-db.sqlite.part") : null;
  if (opts.metaDir) mkdirSync(opts.metaDir, { recursive: true, mode: 0o700 });
  const handler = {
    async entry(e: TarReadEntry) {
      if (e.type !== "file") return extract && e.name.startsWith("data/") ? extract.entry(e) : undefined;
      const h = createHash("sha256");
      let size = 0;
      const text: Buffer[] = [];
      const small = e.name === "manifest.json" || e.name === "secrets.env" || e.name === "SHA256SUMS";
      let inner: { write(c: Buffer): void | Promise<void>; end(): void | Promise<void> } | void;
      if (extract && e.name.startsWith("data/")) inner = await extract.entry(e);
      else if (dbTmp && e.name === "db.sqlite") {
        const ws = createWriteStream(dbTmp, { mode: 0o644 });
        inner = { async write(c: Buffer) { if (!ws.write(c)) await once(ws, "drain"); }, async end() { ws.end(); await once(ws, "finish"); } };
      }
      return {
        async write(c: Buffer) { h.update(c); size += c.length; if (small && size <= 4 << 20) text.push(Buffer.from(c)); if (inner) await inner.write(c); },
        async end() {
          if (inner) await inner.end();
          if (e.name === "SHA256SUMS") { sums = Buffer.concat(text).toString("utf8"); return; }
          hashes.set(e.name, h.digest("hex")); sizes.set(e.name, size);
          if (e.name === "manifest.json") { manifestText = Buffer.concat(text).toString("utf8"); try { const m = JSON.parse(manifestText); if (typeof m.dbPath === "string") dbRel = m.dbPath; } catch { /* reported below */ } }
          if (e.name === "secrets.env") secretsText = Buffer.concat(text).toString("utf8");
        },
      };
    },
  };
  await pipeline(input, decryptStream(identityText), createGunzip(), tarReader(handler));

  const problems: string[] = [];
  let manifest: Record<string, any> | null = null;
  try { manifest = JSON.parse(manifestText); } catch { problems.push("manifest.json is missing or unreadable"); }
  if (manifest && manifest.format !== ARCHIVE_FORMAT) problems.push(`unknown archive format ${manifest.format}`);
  if (!sums) problems.push("SHA256SUMS is missing");
  let checked = 0;
  const listed = new Set<string>();
  for (const line of sums.split("\n")) {
    if (!line) continue;
    const p = parseSumLine(line);
    if (!p) { problems.push("SHA256SUMS has a malformed line"); continue; }
    const name = p.name.replace(/^\.\//, "");
    listed.add(name);
    const got = hashes.get(name);
    if (got === undefined) problems.push(`missing from the archive: ${name}`);
    else if (got !== p.hash) problems.push(`checksum mismatch: ${name}`);
    else checked++;
  }
  for (const name of hashes.keys()) if (!listed.has(name)) problems.push(`not in SHA256SUMS: ${name}`);
  if (!hashes.has("db.sqlite")) problems.push("db.sqlite is missing");

  if (opts.dest && dbTmp && hashes.has("db.sqlite")) {
    const target = path.resolve(opts.dest, dbRel);
    if (!target.startsWith(path.resolve(opts.dest) + path.sep)) problems.push("the manifest's dbPath points outside the data folder");
    else { mkdirSync(path.dirname(target), { recursive: true }); for (const s of ["", "-wal", "-shm", "-journal"]) rmSync(target + s, { force: true }); renameSync(dbTmp, target); }
  }
  if (opts.metaDir) {
    if (manifestText) writeFileSync(path.join(opts.metaDir, "manifest.json"), manifestText, { mode: 0o600 });
    if (secretsText) writeFileSync(path.join(opts.metaDir, "secrets.env"), secretsText, { mode: 0o600 });
  }
  let files = 0, bytes = 0;
  for (const [n, s] of sizes) if (n.startsWith("data/")) { files++; bytes += s; }
  return { ok: problems.length === 0, manifest, files, bytes, checked, problems, hasSecrets: !!secretsText, sessionSecret: /^(SKLUBOT_)?SESSION_SECRET=./m.test(secretsText), dataKeys: /^(SKLUBOT_)?DATA_KEYS?=./m.test(secretsText) };
}

/** Decrypts an archive to a plain .tar.gz stream (for `tar xzf`), without checking it. */
export async function decryptTo(input: Readable, identityText: string, output: Writable | PassThrough): Promise<void> {
  await pipeline(input, decryptStream(identityText), output);
}
