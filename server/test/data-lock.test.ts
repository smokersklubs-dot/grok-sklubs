import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { hostname, tmpdir } from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { fileURLToPath } from "node:url";

// L50: « un seul serveur » on a data folder (datalock.ts). A second server on the same DATA_DIR refuses to start with a
// clear French message; a lock left by a crashed server (its process is gone, or its heartbeat is old on another
// machine) is taken over by itself; a server whose lock was taken away notices it at its next heartbeat.
const { acquireDataLock, DataLockError, isStale, procStartOf, LOCK_FILE, STALE_OTHER_HOST_MS } = await import("../src/datalock.js");

const SERVER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const children: ChildProcess[] = [];
after(() => { for (const c of children) try { c.kill("SIGKILL"); } catch { /* gone */ } });

/** A live process that is not this one (stands for another server). */
function liveProcess(): ChildProcess {
  const c = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
  children.push(c);
  return c;
}
const writeLock = (dir: string, v: Record<string, unknown>) => writeFileSync(path.join(dir, LOCK_FILE), JSON.stringify(v));

test("a second server on the same data folder is refused, with the holder named in French", async () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-lock-"));
  const other = liveProcess();
  await new Promise((r) => setTimeout(r, 100));
  writeLock(dir, { pid: other.pid, host: hostname(), startedAt: Date.now(), heartbeatAt: Date.now(), token: "theirs", procStart: procStartOf(other.pid!) });
  assert.throws(() => acquireDataLock(dir), (err: unknown) => {
    assert.ok(err instanceof DataLockError);
    assert.match((err as Error).message, /Un autre serveur Sklubot utilise déjà ce dossier de données/);
    assert.match((err as Error).message, new RegExp(`processus ${other.pid}`));
    assert.match((err as Error).message, /DATA_DIR/);
    return true;
  });
  assert.equal(JSON.parse(readFileSync(path.join(dir, LOCK_FILE), "utf8")).token, "theirs", "the live lock is left alone");

  // The real server entry point stops before anything else, with exit code 1 and the message.
  const run = spawnSync(process.execPath, ["--import", "tsx", "src/index.ts"], {
    cwd: SERVER, encoding: "utf8", timeout: 60_000,
    env: { ...process.env, DATA_DIR: dir, SESSION_SECRET: "lock-secret-lock-secret-lock-secret-0", NO_SCHEDULER: "1", COMPUTER: "browser", PORT: "0" },
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /Cannot start: Un autre serveur Sklubot utilise déjà ce dossier de données/);
  assert.ok(!existsSync(path.join(dir, "sklubot.db")), "the database was never opened");

  // The holder crashes: its lock is taken over by itself.
  other.kill("SIGKILL");
  await new Promise((r) => other.once("exit", r));
  const lock = acquireDataLock(dir);
  const now = JSON.parse(readFileSync(path.join(dir, LOCK_FILE), "utf8"));
  assert.equal(now.pid, process.pid);
  assert.equal(now.token, lock.token);
  lock.release();
  assert.ok(!existsSync(path.join(dir, LOCK_FILE)), "released on a clean stop");
});

test("stale or live: same pid as ours (container restart), reused pid, other machine by heartbeat", () => {
  const base = { host: "box", pid: 1, at: 1_000_000, procStartOf: (_p: number) => "500", alive: (_p: number) => true };
  const lock = { pid: 1, host: "box", startedAt: 0, heartbeatAt: 999_000, token: "t", procStart: "500" };
  assert.equal(isStale(lock, base), true, "a lock with our own pid is from an earlier life of this process");
  assert.equal(isStale({ ...lock, pid: 42 }, base), false, "same start time: the same live process");
  assert.equal(isStale({ ...lock, pid: 42, procStart: "123" }, base), true, "the pid was reused by another process");
  assert.equal(isStale({ ...lock, pid: 42 }, { ...base, procStartOf: (p) => (p === 1 ? "500" : null) }), true, "gone from /proc");
  assert.equal(isStale({ ...lock, pid: 42, procStart: null }, { ...base, procStartOf: () => null, alive: () => false }), true, "no /proc: a dead pid");
  assert.equal(isStale({ ...lock, pid: 42, procStart: null }, { ...base, procStartOf: () => null }), false, "no /proc, alive, fresh heartbeat");
  assert.equal(isStale({ ...lock, host: "other", heartbeatAt: base.at - 5_000 }, base), false, "another machine, fresh heartbeat");
  assert.equal(isStale({ ...lock, host: "other", heartbeatAt: base.at - STALE_OTHER_HOST_MS - 1 }, base), true, "another machine, silent");
  assert.equal(isStale(null, base), true, "an unreadable lock file");
});

test("a fresh lock from another machine is refused; the holder notices when its lock is taken away", () => {
  const dir = mkdtempSync(path.join(tmpdir(), "sklubot-lock2-"));
  writeLock(dir, { pid: 7, host: "another-machine", startedAt: Date.now(), heartbeatAt: Date.now(), token: "remote", procStart: null });
  assert.throws(() => acquireDataLock(dir), DataLockError);
  writeLock(dir, { pid: 7, host: "another-machine", startedAt: 0, heartbeatAt: Date.now() - STALE_OTHER_HOST_MS - 5_000, token: "remote", procStart: null });
  let lost: unknown = "not called";
  const mine = acquireDataLock(dir, { onLost: (by) => { lost = by?.token; } });
  assert.equal(mine.beat(), true, "heartbeat while holding");
  writeLock(dir, { pid: 8, host: "another-machine", startedAt: Date.now(), heartbeatAt: Date.now(), token: "thief", procStart: null });
  assert.equal(mine.beat(), false);
  assert.equal(lost, "thief");
  mine.release();
  assert.equal(JSON.parse(readFileSync(path.join(dir, LOCK_FILE), "utf8")).token, "thief", "release never deletes someone else's lock");
});
