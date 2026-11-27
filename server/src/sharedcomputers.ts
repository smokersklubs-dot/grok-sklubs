import { config } from "./config.js";
import { q } from "./db.js";
import { machineInfo, setComputerAllocator, type ComputerAllocator } from "./linux.js";
import type { SharedComputerView } from "./shared.js";
import { bots, newId, now } from "./store.js";
import { QueueNotice } from "./sharedqueue.js";

/**
 * Part B: shared computers. Besides each bot's own Linux computer, an account has one or more shared computers (one to
 * begin with, up to MAX_SHARED_COMPUTERS). A bot set to "shared" (Bot.computerMode) works on the first free one; its
 * home folder (files, browser profile, Claude / ChatGPT sign-ins) is shared by the bots that use it.
 *
 * Rules:
 *  - A shared computer belongs to one account; only that account's agent bots set to "shared" ever get it.
 *  - One bot at a time drives it: the computer is taken for each call (a click, a command, a page read) and, for a
 *    subscription bot (Claude Code / Codex), for its whole turn — so two subscription tools never run in it at once
 *    (they would refresh the same sign-in token). Another bot waits for it (COMPUTER_WAIT_SEC), then gets a clear
 *    "busy" message. Taking is re-entrant for the same bot (its tool calls during its own turn).
 *  - A bot goes back to the shared computer it used last when it is free, else the first free one, in order.
 *  - Each bot keeps its own library: the computer mounts the library of every bot set to "shared" at
 *    /root/libraries/<bot>, and /root/files points at the one of the bot driving it (linux.ts pointFilesAt). The bots
 *    sharing a computer can therefore read each other's libraries there, as they share everything else on it.
 */

export interface SharedComputerRecord { id: string; userId: string; name: string; position: number; createdAt: number }
const toRec = (r: any): SharedComputerRecord => ({ id: r.id, userId: r.user_id, name: r.name, position: r.position, createdAt: r.created_at });

export const sharedComputers = {
  list: (userId: string): SharedComputerRecord[] => q.all("SELECT * FROM shared_computers WHERE user_id = ? ORDER BY position, created_at", userId).map(toRec),
  byId: (id: string): SharedComputerRecord | null => { const r = q.get("SELECT * FROM shared_computers WHERE id = ?", id); return r ? toRec(r) : null; },
  all: (): SharedComputerRecord[] => q.all("SELECT * FROM shared_computers ORDER BY user_id, position").map(toRec),
  /** The account's shared computers, the first one made if it has none yet. */
  ensure(userId: string): SharedComputerRecord[] {
    const list = sharedComputers.list(userId);
    return list.length ? list : [sharedComputers.add(userId)];
  },
  add(userId: string): SharedComputerRecord {
    const list = sharedComputers.list(userId);
    if (list.length >= config.maxSharedComputers) throw new SharedLimitError(config.maxSharedComputers);
    const position = list.length ? Math.max(...list.map((c) => c.position)) + 1 : 0;
    const rec = { id: newId("shc"), userId, name: `#${position + 1}`, position, createdAt: now() };
    q.run("INSERT INTO shared_computers (id, user_id, name, position, created_at) VALUES (?, ?, ?, ?, ?)", rec.id, userId, rec.name, rec.position, rec.createdAt);
    return rec;
  },
  remove: (id: string) => q.run("DELETE FROM shared_computers WHERE id = ?", id),
};

export class SharedLimitError extends Error {
  constructor(readonly max: number) { super(`An account can have at most ${max} shared computers.`); this.name = "SharedLimitError"; }
}
/** Every shared computer of the account is driven by another bot, and none came free in time. */
export class SharedComputersBusyError extends Error {
  constructor(readonly count: number) {
    super(count === 1
      ? "The shared computer is being used by another bot right now, and did not come free in time. Try again in a few minutes, or add a shared computer (Settings → Computers)."
      : `All ${count} shared computers are being used by other bots right now, and none came free in time. Try again in a few minutes, or add a shared computer (Settings → Computers).`);
    this.name = "SharedComputersBusyError";
  }
}

// ── Taking a shared computer ─────────────────────────────────────────────────
interface Lease { key: string; botId: string; userId: string; depth: number }
/** Told when a shared computer is taken or comes free (the app shows who drives it). */
let changed: (userId: string) => void = () => {};
export const onSharedChanged = (fn: (userId: string) => void) => { changed = fn; };
/** Who drives each shared computer right now (key → lease), and what each bot holds (bot → lease). */
const byKey = new Map<string, Lease>();
const byBot = new Map<string, Lease>();
/** The shared computer each bot used last, and the bots each computer had last (most recent first). */
const lastOf = new Map<string, string>();
const recent = new Map<string, string[]>();
/** Waiting callers are woken as soon as a computer comes free (checked again every `step` anyway). */
const waiters = new Set<() => void>();
/** L161: per account, the bots waiting for a shared computer, in the order they came. */
const queues = new Map<string, string[]>();
const wakeWaiters = () => { for (const w of [...waiters]) w(); };

const sharedBot = (botId: string) => {
  const b = bots.byId(botId);
  return b && b.kind === "agent" && b.computerMode === "shared" ? b : null;
};

function take(botId: string, userId: string, key: string): Lease {
  const lease = { key, botId, userId, depth: 1 };
  byKey.set(key, lease);
  byBot.set(botId, lease);
  lastOf.set(botId, key);
  recent.set(key, [botId, ...(recent.get(key) ?? []).filter((b) => b !== botId)].slice(0, 5));
  try { changed(userId); } catch { /* the app's view only */ }
  return lease;
}
function release(lease: Lease) {
  lease.depth--;
  if (lease.depth > 0) return;
  if (byKey.get(lease.key) === lease) byKey.delete(lease.key);
  if (byBot.get(lease.botId) === lease) byBot.delete(lease.botId);
  try { changed(lease.userId); } catch { /* the app's view only */ }
  wakeWaiters();
}
const once = (lease: Lease) => { let done = false; return () => { if (!done) { done = true; release(lease); } }; };

/** Options for tests: how long to wait for a free computer, and how often to look again. */
export const leaseTiming = { waitMs: config.computerWaitMs, stepMs: 1000 };

/**
 * Takes a shared computer of the bot's account: the one it holds already (re-entrant), else the one it used last if
 * free, else the first free one in order. Waits while all are taken; past leaseTiming.waitMs, SharedComputersBusyError.
 */
export async function acquireShared(botId: string, userId: string): Promise<{ key: string; release: () => void }> {
  const held = byBot.get(botId);
  if (held) { held.depth++; return { key: held.key, release: once(held) }; }
  const deadline = Date.now() + leaseTiming.waitMs;
  // L161: waiters of an account take the computers that come free in the order they arrived, and say so (sharedqueue.ts).
  const line = queues.get(userId) ?? []; queues.set(userId, line);
  let notice: QueueNotice | null = null;
  try {
    for (;;) {
      // Read each time: the owner may add a computer while bots wait.
      const list = sharedComputers.ensure(userId).filter((c) => c.userId === userId);
      const last = lastOf.get(botId);
      const order = [...list.filter((c) => c.id === last), ...list.filter((c) => c.id !== last)];
      const free = order.filter((c) => !byKey.has(c.id));
      const pos = line.indexOf(botId);
      if (free.length > (pos === -1 ? line.length : pos)) { const lease = take(botId, userId, free[0].id); notice?.got(); return { key: free[0].id, release: once(lease) }; }
      if (pos === -1) { line.push(botId); try { changed(userId); } catch { /* the app's view only */ } }
      const left = deadline - Date.now();
      if (left <= 0) { notice?.gaveUp(); throw new SharedComputersBusyError(list.length); }
      notice ??= new QueueNotice(botId);
      notice.waiting(list.map((c) => byKey.get(c.id)?.botId).filter((b): b is string => !!b), line.slice(0, line.indexOf(botId)));
      await new Promise<void>((resolve) => {
        const done = () => { waiters.delete(done); clearTimeout(timer); resolve(); };
        const timer = setTimeout(done, Math.min(leaseTiming.stepMs, left));
        waiters.add(done);
      });
    }
  } finally {
    const i = line.indexOf(botId);
    if (i !== -1) { line.splice(i, 1); wakeWaiters(); try { changed(userId); } catch { /* the app's view only */ } }
  }
}

/** L161: the bots of an account waiting for a shared computer, first in line first. */
export const sharedQueue = (userId: string): string[] => [...(queues.get(userId) ?? [])];

/** The bots set to "shared" in the computer's account: the libraries it mounts and who may use its socket. */
export function membersOf(key: string): string[] {
  const rec = sharedComputers.byId(key);
  if (!rec) return [];
  return bots.list(rec.userId, true).filter((b) => b.kind === "agent" && b.computerMode === "shared").map((b) => b.id).sort();
}

export const sharedAllocator: ComputerAllocator = {
  current(botId) {
    const held = byBot.get(botId);
    if (held) return held.key;
    const b = sharedBot(botId);
    if (!b) return botId;
    const list = sharedComputers.ensure(b.userId);
    const last = lastOf.get(botId);
    return list.find((c) => c.id === last)?.id ?? list[0].id;
  },
  async acquire(botId) {
    const b = sharedBot(botId);
    if (!b) return { key: botId, release: () => {} };
    // Isolation: always among the shared computers of the bot's own account, whoever started the work.
    return acquireShared(botId, b.userId);
  },
  members: (key) => (sharedComputers.byId(key) ? membersOf(key) : [key]),
  isShared: (key) => !!sharedComputers.byId(key),
  mayControl(botId) {
    const b = sharedBot(botId);
    if (!b) return true;
    const key = sharedAllocator.current(botId);
    const holder = byKey.get(key);
    return !holder || holder.botId === botId;
  },
};

/** Who drives a shared computer now (null: free). */
export const sharedHolder = (key: string) => byKey.get(key)?.botId ?? null;

/** The account's shared computers as the app shows them. */
export function sharedView(userId: string): SharedComputerView[] {
  return sharedComputers.list(userId).map((c) => {
    const m = machineInfo(c.id);
    return { id: c.id, name: c.name, power: m?.power ?? "absent", busyWith: sharedHolder(c.id), lastBots: recent.get(c.id) ?? [], waiting: sharedQueue(userId), lastUsedAt: m?.lastUsedAt ?? null };
  });
}

/** Keys and accounts of every shared computer (for adoptMachines after a restart). */
export const sharedOwners = () => new Map(sharedComputers.all().map((c) => [c.id, c.userId] as [string, string]));

/** For tests: forget who holds what. */
export function resetLeases() { byKey.clear(); byBot.clear(); lastOf.clear(); recent.clear(); queues.clear(); wakeWaiters(); }

setComputerAllocator(sharedAllocator);
