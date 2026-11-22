/**
 * L50 — « Un seul serveur » on a data folder. Two Sklubot servers started by mistake on the same DATA_DIR would both
 * run the bots' queues, the routines and the backups against one database: double turns, double mails, a damaged
 * workspace. The first server takes a lock file, `<DATA_DIR>/server.lock`; a second one refuses to start with a clear
 * French message (and the English one under it, for logs).
 *
 * The lock file holds { pid, host, startedAt, heartbeatAt, token, procStart }. It is created with O_EXCL ("wx"), so two
 * servers starting at the same instant cannot both get it. The holder rewrites `heartbeatAt` every HEARTBEAT_MS.
 *
 * A lock left behind by a crash (kill -9, power cut, container restart) is taken over by itself, safely:
 *   - same machine, its process is gone (or is a different process that reused the number: its start time, read from
 *     /proc on Linux, differs) → stale;
 *   - same machine and the lock's pid is our own pid (a container restarted: we are pid 1 again) → stale;
 *   - same machine, the process cannot be identified for sure (no /proc) but answers, and the heartbeat is older than
 *     STALE_SAME_HOST_MS → stale (a reused number or a frozen server);
 *   - another machine (a shared disk): stale once its heartbeat is older than STALE_OTHER_HOST_MS.
 * Taking over renames the stale file aside (atomic) then creates a new one with O_EXCL again: when two servers find the
 * same stale lock, only one of them gets the new one; the other sees a fresh lock and refuses.
 *
 * If the holder finds, at a heartbeat, that its lock was taken by another server (its token is gone), it stops: two
 * servers must never go on side by side.
 */
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync, writeSync } from "node:fs";
import { hostname } from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";

export const LOCK_FILE = "server.lock";
export const HEARTBEAT_MS = 10_000;
export const STALE_SAME_HOST_MS = 120_000;
export const STALE_OTHER_HOST_MS = 60_000;

export interface LockInfo { pid: number; host: string; startedAt: number; heartbeatAt: number; token: string; procStart: string | null }

export class DataLockError extends Error {
  constructor(readonly holder: LockInfo, readonly dir: string) {
    const when = new Date(holder.startedAt).toLocaleString("fr-FR", { dateStyle: "short", timeStyle: "short" });
    super(
      `Un autre serveur Sklubot utilise déjà ce dossier de données (${dir}) : processus ${holder.pid} sur « ${holder.host} », lancé le ${when}.\n` +
      `Arrête ce serveur avant d'en lancer un deuxième, ou choisis un autre dossier avec DATA_DIR.\n` +
      `S'il s'est arrêté brutalement, relance dans une minute : le verrou sera repris tout seul.\n` +
      `(Another Sklubot server already uses this data folder: process ${holder.pid} on "${holder.host}". Stop it first, or set another DATA_DIR.)`,
    );
  }
}

/** The start time of a process, from /proc (Linux), or null where it cannot be read. */
export function procStartOf(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // Field 22 (starttime), counted after the command name, which is in parentheses and may hold spaces.
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    return rest[19] ?? null;
  } catch { return null; }
}

function alive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch (err) { return (err as NodeJS.ErrnoException).code === "EPERM"; }
}

function readLock(file: string): LockInfo | null {
  try {
    const v = JSON.parse(readFileSync(file, "utf8")) as Partial<LockInfo>;
    if (typeof v.pid !== "number" || typeof v.host !== "string" || typeof v.token !== "string") return null;
    return { pid: v.pid, host: v.host, startedAt: Number(v.startedAt) || 0, heartbeatAt: Number(v.heartbeatAt) || 0, token: v.token, procStart: typeof v.procStart === "string" ? v.procStart : null };
  } catch { return null; }
}

export interface Probe { host: string; pid: number; at: number; procStartOf(pid: number): string | null; alive(pid: number): boolean }
const realProbe = (): Probe => ({ host: hostname(), pid: process.pid, at: Date.now(), procStartOf, alive });

/** Whether a lock found on disk was left behind (true) or belongs to a server still running (false). */
export function isStale(lock: LockInfo | null, p: Probe): boolean {
  if (!lock) return true; // unreadable or half written: nobody can be holding it properly
  const age = p.at - lock.heartbeatAt;
  if (lock.host !== p.host) return age > STALE_OTHER_HOST_MS;
  if (lock.pid === p.pid) return true;
  const start = p.procStartOf(lock.pid);
  if (lock.procStart && start !== null) return start !== lock.procStart;
  if (lock.procStart && start === null && p.procStartOf(p.pid) !== null) return true; // /proc readable for us, not for it: gone
  if (!p.alive(lock.pid)) return true;
  return age > STALE_SAME_HOST_MS;
}

export interface DataLock { file: string; token: string; release(): void; beat(): boolean; stop(): void }

/**
 * Takes the lock on `dir`, or throws DataLockError when another live server holds it. `heartbeat`: rewrite the lock
 * every HEARTBEAT_MS (the running server); `onLost`: called when another server took the lock away.
 */
export function acquireDataLock(dir: string, opts: { heartbeat?: boolean; onLost?: (by: LockInfo | null) => void; probe?: () => Probe } = {}): DataLock {
  mkdirSync(dir, { recursive: true });
  const file = path.join(dir, LOCK_FILE);
  const probe = opts.probe ?? realProbe;
  const token = randomBytes(12).toString("hex");
  const info = (): LockInfo => { const p = probe(); return { pid: p.pid, host: p.host, startedAt, heartbeatAt: p.at, token, procStart: p.procStartOf(p.pid) }; };
  const startedAt = probe().at;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const fd = openSync(file, "wx", 0o600);
      try { writeSync(fd, JSON.stringify(info())); } finally { closeSync(fd); }
      break;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "EEXIST") throw err;
      const held = readLock(file);
      // Written this very instant by another server (empty or half-written file): give it a moment, then judge.
      if (!held && attempt < 2) { const until = Date.now() + 50; while (Date.now() < until) { /* short wait */ } continue; }
      if (!isStale(held, probe())) throw new DataLockError(held!, dir);
      const aside = `${file}.stale-${randomBytes(4).toString("hex")}`;
      try { renameSync(file, aside); } catch { continue; } // someone else moved it first: look again
      // The file moved aside must still be the stale one we judged (not a fresh lock written in between).
      const moved = readLock(aside);
      if (moved && held && moved.token !== held.token && !isStale(moved, probe())) {
        // A live lock written in between: put it back (never over a file that appeared meanwhile) and judge again.
        try { const fd = openSync(file, "wx", 0o600); try { writeSync(fd, readFileSync(aside, "utf8")); } finally { closeSync(fd); } } catch { /* judged again */ }
        try { unlinkSync(aside); } catch { /* already gone */ }
        continue;
      }
      try { unlinkSync(aside); } catch { /* already gone */ }
      console.warn(`[data lock] took over a lock left by process ${held?.pid ?? "?"} on "${held?.host ?? "?"}" (it had stopped).`);
      if (attempt === 4) throw new Error(`Cannot take the data folder lock (${file}).`);
    }
  }
  if (!existsSync(file) || readLock(file)?.token !== token) throw new Error(`Cannot take the data folder lock (${file}).`);

  let timer: NodeJS.Timeout | null = null;
  let released = false;
  const lock: DataLock = {
    file, token,
    beat() {
      if (released) return false;
      const cur = readLock(file);
      if (cur?.token !== token) { lock.stop(); opts.onLost?.(cur); return false; }
      const tmp = `${file}.${token}.tmp`;
      try { writeFileSync(tmp, JSON.stringify(info()), { mode: 0o600 }); renameSync(tmp, file); } catch (err) { console.error("[data lock] heartbeat not written:", (err as Error).message); }
      return true;
    },
    stop() { if (timer) clearInterval(timer); timer = null; },
    release() {
      if (released) return;
      lock.stop();
      released = true;
      try { if (readLock(file)?.token === token) unlinkSync(file); } catch { /* nothing to release */ }
    },
  };
  if (opts.heartbeat) { timer = setInterval(() => lock.beat(), HEARTBEAT_MS); timer.unref(); }
  return lock;
}
