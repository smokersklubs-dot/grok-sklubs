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
 * It never prints a secret: only which table/column was tried and whether it opened.
 */
import { mkdirSync, readdirSync, rmSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

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

async function main(argv: string[]) {
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
