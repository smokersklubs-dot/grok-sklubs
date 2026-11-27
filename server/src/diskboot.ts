import { closeSync, existsSync, fsyncSync, mkdirSync, openSync, rmSync, statfsSync, writeSync } from "node:fs";
import http from "node:http";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { boot } from "./bootflag.js";
import { config } from "./config.js";

/**
 * L161 « démarrage sur disque en panne » (10-timon T39; behaviour only, our own code).
 *
 * Before the database opens (db.ts imports this module first), the real server checks its data disk: the folder can be
 * made, a small file can be written and synced, there is at least DISK_BOOT_MIN_MB free, and an existing database can
 * be read. If not, it does NOT stop (Docker would restart it every few seconds, filling the logs of a disk that is
 * already full: thousands of restarts were seen elsewhere) and it opens NOTHING for writing: it serves a "safe mode"
 * card on its usual port — every page shows what is wrong in plain words, the free space and what to do; every /api
 * call answers 503 with the same facts — and looks again every DISK_BOOT_RETRY_SEC seconds. One line in the log when
 * the problem starts or changes, none at each look. When the disk is fine again, the card goes and the server starts
 * as usual (the data-folder lock, then the database). Nothing is ever deleted or rewritten here.
 *
 * Only the real server (datalockboot.ts sets boot.takeLock); tests and command-line tools open the database directly.
 */

export type DiskProblemKind = "readonly" | "full" | "unreachable" | "database";
export interface DiskProblem { kind: DiskProblemKind; dir: string; detail: string; freeMb: number | null }

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && v !== undefined && v !== "" ? n : d; };
export const bootDisk = {
  minFreeMb: Math.max(0, num(process.env.DISK_BOOT_MIN_MB, 200)),
  retryMs: Math.max(0.2, num(process.env.DISK_BOOT_RETRY_SEC, 30)) * 1000,
};

const freeMbOf = (dir: string): number | null => {
  try { const s = statfsSync(dir); return Math.floor((Number(s.bavail) * Number(s.bsize)) / 1024 / 1024); } catch { return null; }
};
const kindOf = (err: unknown): DiskProblemKind => {
  const code = (err as NodeJS.ErrnoException)?.code ?? "";
  if (code === "ENOSPC" || code === "EDQUOT") return "full";
  if (code === "EROFS" || code === "EACCES" || code === "EPERM") return "readonly";
  return "unreachable";
};
const parentThatExists = (dir: string) => { let d = dir; while (!existsSync(d) && path.dirname(d) !== d) d = path.dirname(d); return d; };

/** What is wrong with the data disk, or null when the server can start. Writes one small file and removes it. */
export function probeDisk(dir = config.dataDir, dbPath = config.dbPath, minFreeMb = bootDisk.minFreeMb): DiskProblem | null {
  const fail = (kind: DiskProblemKind, err: unknown) => ({ kind, dir, detail: String((err as Error)?.message ?? err), freeMb: freeMbOf(parentThatExists(dir)) });
  try { mkdirSync(dir, { recursive: true }); mkdirSync(path.dirname(dbPath), { recursive: true }); } catch (err) { return fail(kindOf(err), err); }
  const probe = path.join(dir, ".sklubot-disk-check");
  try {
    const fd = openSync(probe, "w");
    try { writeSync(fd, Buffer.alloc(4096, 0x20)); fsyncSync(fd); } finally { closeSync(fd); }
  } catch (err) { rmSync(probe, { force: true }); return fail(kindOf(err), err); }
  rmSync(probe, { force: true });
  const freeMb = freeMbOf(dir);
  if (freeMb !== null && freeMb < minFreeMb) return { kind: "full", dir, detail: `${freeMb} MB free, ${minFreeMb} MB needed to start`, freeMb };
  if (existsSync(dbPath)) {
    try { const d = new DatabaseSync(dbPath, { readOnly: true }); try { d.prepare("SELECT COUNT(*) AS n FROM sqlite_master").get(); } finally { d.close(); } }
    catch (err) { return { kind: "database", dir, detail: `${path.basename(dbPath)}: ${(err as Error).message}`, freeMb }; }
  }
  return null;
}

const TEXT: Record<DiskProblemKind, { fr: [string, string]; en: [string, string] }> = {
  full: {
    fr: ["Le disque des données est plein", "Sklubot attend sans rien écrire. Libère de la place sur le disque du serveur (vieilles sauvegardes, journaux, images Docker inutilisées : docker system prune), puis il repart tout seul."],
    en: ["The data disk is full", "Sklubot waits without writing anything. Free some space on the server's disk (old backups, logs, unused Docker images: docker system prune); it then starts again by itself."],
  },
  readonly: {
    fr: ["Le disque des données est en lecture seule", "Sklubot ne peut rien y écrire, alors il attend. Souvent le système a protégé un disque abîmé : vérifie le disque du serveur (ou demande à ton hébergeur), puis il repart tout seul."],
    en: ["The data disk is read-only", "Sklubot cannot write to it, so it waits. The system often does this to protect a damaged disk: check the server's disk (or ask your host); it then starts again by itself."],
  },
  unreachable: {
    fr: ["Le dossier des données est introuvable", "Le dossier des données (DATA_DIR) ne peut pas être ouvert : un disque débranché, un volume Docker absent ou un chemin faux. Branche-le ou corrige le chemin, puis il repart tout seul."],
    en: ["The data folder cannot be reached", "The data folder (DATA_DIR) cannot be opened: a disk unplugged, a missing Docker volume or a wrong path. Plug it in or fix the path; it then starts again by itself."],
  },
  database: {
    fr: ["La base de données ne se lit pas", "Le fichier de la base est abîmé ou illisible. Sklubot n'y touche pas. Remets la dernière sauvegarde (docs/SAUVEGARDES.md), puis il repart tout seul."],
    en: ["The database cannot be read", "The database file is damaged or unreadable. Sklubot does not touch it. Put back the latest backup (docs/SAUVEGARDES.md); it then starts again by itself."],
  },
};
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** The safe-mode page: one card, both languages, light and dark, readable on a phone. */
export function safeModePage(p: DiskProblem, retrySec: number): string {
  const fr = TEXT[p.kind].fr, en = TEXT[p.kind].en;
  const free = p.freeMb === null ? "" : `<li>Espace libre : <b>${p.freeMb} Mo</b> <span lang="en">(free space: ${p.freeMb} MB)</span></li>`;
  return `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="refresh" content="${Math.max(5, retrySec)}">
<title>Sklubot — mode sûr</title><style>
:root{--bg:#f4f2ee;--surface:#fff;--text:#1e2024;--text-2:#5a5f67;--border:#e4e0d8;--warn:#9e5e10;--warn-soft:#fbf1df;color-scheme:light dark}
@media (prefers-color-scheme:dark){:root{--bg:#131416;--surface:#1a1c1f;--text:#eceef1;--text-2:#a7adb5;--border:#2b2e32;--warn:#e0a34a;--warn-soft:#35290f}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Arial,sans-serif;padding:24px 16px;display:flex;justify-content:center}
.card{max-width:560px;width:100%;background:var(--surface);border:1px solid var(--border);border-radius:14px;padding:24px}
.chip{display:inline-block;background:var(--warn-soft);color:var(--warn);border-radius:999px;padding:2px 10px;font-size:13px;font-weight:600}
h1{font-size:22px;line-height:1.25;margin:12px 0 8px}p{margin:0 0 12px}.en{color:var(--text-2);font-size:14px;border-top:1px solid var(--border);padding-top:12px;margin-top:16px}
ul{padding-left:20px;margin:0 0 12px;color:var(--text-2);font-size:14px;overflow-wrap:anywhere}code{font-size:13px}
</style></head><body><main class="card" role="main">
<span class="chip">Mode sûr · rien n'est effacé</span>
<h1>${esc(fr[0])}</h1><p>${esc(fr[1])}</p>
<ul><li>Dossier : <code>${esc(p.dir)}</code></li>${free}<li>Détail : ${esc(p.detail)}</li><li>Nouvel essai toutes les ${Math.round(retrySec)} s ; cette page se met à jour toute seule.</li></ul>
<div class="en" lang="en"><b>${esc(en[0])}.</b> ${esc(en[1])} Nothing is deleted.</div>
</main></body></html>`;
}

/**
 * Waits in safe mode while the disk fails (resolves at once when it is fine). Exported for tests with their own probe;
 * the server calls it below.
 */
export async function holdWhileDiskFails(o: { probe?: () => DiskProblem | null; port?: number; retryMs?: number; log?: (line: string) => void } = {}): Promise<{ waitedMs: number; problems: number }> {
  const probe = o.probe ?? (() => probeDisk());
  const log = o.log ?? ((l: string) => console.error(l));
  const retryMs = o.retryMs ?? bootDisk.retryMs;
  let problem = probe();
  if (!problem) return { waitedMs: 0, problems: 0 };
  const since = Date.now();
  let problems = 1;
  let last: string = problem.kind;
  log(`\n[safe mode] Cannot start on this disk: ${problem.kind} — ${problem.detail} (${problem.dir}${problem.freeMb === null ? "" : `, ${problem.freeMb} MB free`}). Nothing is written; looking again every ${Math.round(retryMs / 1000)} s. Mode sûr : rien n'est écrit.\n`);
  const server = http.createServer((req, res) => {
    const p = problem!;
    if ((req.url ?? "").startsWith("/api/")) {
      res.writeHead(503, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "retry-after": String(Math.round(retryMs / 1000)) });
      res.end(JSON.stringify({ status: "safe-mode", error: TEXT[p.kind].en[0], safeMode: { kind: p.kind, dir: p.dir, freeMb: p.freeMb, detail: p.detail, since, retrySec: Math.round(retryMs / 1000) } }));
      return;
    }
    res.writeHead(503, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'", "x-content-type-options": "nosniff" });
    res.end(safeModePage(p, retryMs / 1000));
  });
  await new Promise<void>((resolve) => {
    server.once("error", (err) => { log(`[safe mode] the page could not open on port ${o.port ?? config.port}: ${(err as Error).message}`); resolve(); });
    server.listen(o.port ?? config.port, () => { const a = server.address(); log(`[safe mode] page at http://localhost:${typeof a === "object" && a ? a.port : o.port ?? config.port}/`); resolve(); });
  });
  for (;;) {
    await new Promise((r) => setTimeout(r, retryMs));
    const next = probe();
    if (!next) break;
    const key: string = next.kind;
    if (key !== last) { problems++; last = key; log(`[safe mode] still waiting: ${next.kind} — ${next.detail}`); }
    problem = next;
  }
  server.closeAllConnections();
  await new Promise<void>((resolve) => server.close(() => resolve()));
  log(`[safe mode] The disk is fine again after ${Math.round((Date.now() - since) / 1000)} s: starting.`);
  return { waitedMs: Date.now() - since, problems };
}

if (boot.takeLock) {
  await holdWhileDiskFails();
  boot.takeLock();
}
