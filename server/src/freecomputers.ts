import { config } from "./config.js";
import { freeComputerPlan, hostedMode } from "./hosted.js";
import { allMachines, docker, linuxScreen, machineInfo, setComputerAllocator, setRunLimits, type ComputerAllocator } from "./linux.js";
import { sharedAllocator } from "./sharedcomputers.js";
import { bots, now } from "./store.js";

/**
 * Free computers (docs/OUVERTURE-PUBLIQUE.md): in hosted mode, an account on a plan of kind "free" has NO personal Linux
 * computer. Its bots borrow a disposable one from a small pool that the operator sizes for one server.
 *
 * Why this design (and not a shared, long-lived container): a computer holds a browser profile, sign-ins, downloads and
 * whatever a bot installed. Sharing one long-lived container between strangers would leak all of that from one account to
 * the next, and a per-user home volume cannot be swapped into a running container. So each free computer is:
 *  - one container per BOT (key "fc-<bot id>"), made from the same image with the same hardening as every computer
 *    (linux.ts computerRunArgs: dropped capabilities, no-new-privileges, the bots' isolated network), but smaller
 *    (FREE_COMPUTER_MEMORY, default 1g; FREE_COMPUTER_CPUS, default 1);
 *  - disposable: no personal home kept — the container AND its home volume are wiped once idle for FREE_COMPUTER_IDLE_MIN
 *    minutes (default 5), when its slot goes to someone else, when it was put to sleep, and at start-up. Only the bot's own
 *    library (/root/files, counted in the plan's storage) persists, as for every bot;
 *  - capped: at most FREE_COMPUTERS_MAX (default 1) free computers exist at once on the whole server. Another bot waits
 *    (COMPUTER_WAIT_SEC) for one to be idle for FREE_COMPUTER_GRACE_SEC (default 30, so a turn between two calls keeps its
 *    computer), which is then wiped and handed over; past the wait, a clear "busy" error the bot passes on.
 *    FREE_COMPUTERS_MAX=0: free plans have no computer at all (their bots keep their web and server tools).
 *  - no subscription tool (Claude Code / Codex): their sign-in would not survive (hosted.ts engineBlock).
 * Paid plans and operators keep their personal (and shared) computers exactly as before. FREE_PLAN_COMPUTER=personal
 * turns this off (free plans get a personal computer, limited by the plan's computers awake, as before this file).
 */

const PREFIX = "fc-";
const keyOf = (botId: string) => `${PREFIX}${botId}`;
export const isFreeKey = (key: string) => key.startsWith(PREFIX);
const env = (k: string) => (process.env[k] ?? "").trim();
const numEnv = (k: string, dflt: number, min: number, max: number) => { const n = Number(env(k)); return env(k) && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
export const freeMax = () => Math.floor(numEnv("FREE_COMPUTERS_MAX", 1, 0, 100));
const idleMs = () => numEnv("FREE_COMPUTER_IDLE_MIN", 5, 0.01, 24 * 60) * 60_000;
const graceMs = () => numEnv("FREE_COMPUTER_GRACE_SEC", 30, 0, 3600) * 1000;
/** Options for tests: how long to wait for a slot, and how often to look again. */
export const freeTiming = { waitMs: config.computerWaitMs, stepMs: 1000 };

export class FreeComputersBusyError extends Error {
  constructor(readonly max: number) {
    super(`The free computers of this service are all in use right now (${max} at a time), and none came free in time. Nothing was done on the computer. Tell the user to try again in a few minutes, or to change plan (Settings → My subscription) for a computer of their own.`);
    this.name = "FreeComputersBusyError";
  }
}
export class NoFreeComputerError extends Error {
  constructor() {
    super("The user's plan (free) does not include a computer on this service. Nothing was done. Work with the tools that need no computer (web search, reading pages, files), or tell the user a paid plan includes one (Settings → My subscription).");
    this.name = "NoFreeComputerError";
  }
}

/** Free bots: an agent of an account whose plan gets the free pool (hosted.ts freeComputerPlan). */
const freeBot = (botId: string) => {
  if (!hostedMode()) return null;
  const b = bots.byId(botId);
  return b && b.kind === "agent" && freeComputerPlan(b.userId) ? b : null;
};

/** The pool: each free computer allowed to exist (key → when its slot was taken). */
const slots = new Map<string, { userId: string; at: number }>();
const botOfKey = new Map<string, string>();

/** Whether a slot may go to someone else: its computer is idle since the grace period (or never came up). */
function evictable(key: string): number | null {
  const m = machineInfo(key);
  const s = slots.get(key)!;
  if (!m) return now() - s.at > Math.max(graceMs() * 4, 120_000) ? s.at : null;
  if (m.busy > 0) return null;
  return now() - m.lastUsedAt >= graceMs() ? m.lastUsedAt : null;
}

const wipe = async (key: string) => { slots.delete(key); try { await linuxScreen.destroyKey(key); } catch (err) { console.error(`[free computers] wipe ${key}: ${(err as Error).message}`); } };

/** Takes a slot of the pool for this bot's free computer (re-entrant), waiting while all are busy. */
export async function acquireFree(botId: string, userId: string): Promise<string> {
  const key = keyOf(botId);
  botOfKey.set(key, botId);
  if (slots.has(key)) return key;
  const max = freeMax();
  if (max <= 0) throw new NoFreeComputerError();
  const deadline = Date.now() + freeTiming.waitMs;
  for (;;) {
    if (slots.has(key)) return key;
    if (slots.size < max) { slots.set(key, { userId, at: now() }); return key; }
    const victim = [...slots.keys()].map((k) => [k, evictable(k)] as const).filter(([, t]) => t !== null).sort((a, b) => a[1]! - b[1]!)[0]?.[0];
    if (victim) {
      // Synchronously: the slot changes hands before anything is awaited, so two callers never both take it.
      slots.delete(victim);
      slots.set(key, { userId, at: now() });
      await wipe(victim);
      return key;
    }
    if (Date.now() >= deadline) throw new FreeComputersBusyError(max);
    await new Promise((r) => setTimeout(r, Math.min(freeTiming.stepMs, Math.max(1, deadline - Date.now()))));
  }
}

/** Wipes the free computers that are idle, asleep or gone (every 30 s, and from tests). */
export async function sweepFreeComputers(): Promise<number> {
  let n = 0;
  for (const key of [...slots.keys()]) {
    const m = machineInfo(key);
    const s = slots.get(key)!;
    const stale = !m ? now() - s.at > Math.max(graceMs() * 4, 120_000) : m.busy === 0 && (m.power !== "running" || now() - m.lastUsedAt >= idleMs());
    if (stale) { await wipe(key); n++; }
  }
  // A free computer this server knows of but holds no slot for (put to sleep elsewhere, a slot lost): wiped too.
  for (const m of allMachines()) if (isFreeKey(m.key) && !slots.has(m.key) && m.busy === 0) { await wipe(m.key); n++; }
  return n;
}

/** Wraps the allocator (sharedcomputers.ts): free bots get their disposable computer, every other bot is unchanged. */
export function freeAllocator(inner: ComputerAllocator): ComputerAllocator {
  return {
    current: (botId) => (freeBot(botId) ? keyOf(botId) : inner.current(botId)),
    async acquire(botId, userId) {
      const b = freeBot(botId);
      if (!b) return inner.acquire(botId, userId);
      // Always the bot's own account, whoever started the work (as for shared computers).
      return { key: await acquireFree(botId, b.userId), release: () => {} };
    },
    members: (key) => (isFreeKey(key) ? [botOfKey.get(key) ?? key.slice(PREFIX.length)] : inner.members(key)),
    isShared: (key) => (isFreeKey(key) ? false : inner.isShared(key)),
    mayControl: (botId) => (freeBot(botId) ? true : inner.mayControl(botId)),
  };
}

setComputerAllocator(freeAllocator(sharedAllocator));
setRunLimits((key) => (isFreeKey(key) ? { memory: /^\d+(\.\d+)?[kmg]?$/i.test(env("FREE_COMPUTER_MEMORY")) ? env("FREE_COMPUTER_MEMORY") : "1g", cpus: numEnv("FREE_COMPUTER_CPUS", 1, 0.1, 64) } : null));

let timer: NodeJS.Timeout | null = null;
/** At start-up (hosted mode, Linux computers): free computers left by the previous run are wiped, then swept every 30 s. */
export async function startFreeComputers(): Promise<void> {
  if (!hostedMode() || timer) return;
  const r = await docker(["ps", "-a", "--filter", "label=sklubot=desktop", "--format", "{{.Names}}"], { timeoutMs: 10_000 });
  for (const name of r.stdout.toString("utf8").split("\n").map((s) => s.trim()).filter((s) => s.startsWith(`sklubot-${PREFIX}`))) {
    await docker(["rm", "-f", name], { timeoutMs: 30_000 });
    await docker(["volume", "rm", "-f", name.replace(/^sklubot-/, "sklubot-home-")], { timeoutMs: 30_000 });
  }
  timer = setInterval(() => { void sweepFreeComputers().catch((err) => console.error("[free computers]", err)); }, 30_000);
  timer.unref();
}

/** Tests: the pool's state, and a reset. */
export const _freeSlots = slots;
export const _resetFree = () => { slots.clear(); botOfKey.clear(); };
