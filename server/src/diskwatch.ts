import { statfsSync } from "node:fs";
import { computerKind } from "./computer.js";
import { config } from "./config.js";
import { tr } from "./i18n.js";
import { isSharedMachine, sleepBiggestIdle } from "./linux.js";
import { membersOf } from "./sharedcomputers.js";
import { bots, rows, users } from "./store.js";

/**
 * M2: the server's disk watchdog. Every minute the free space of the disk holding this server's data (the bots' home
 * volumes and libraries live on the same Docker host) is read; under DISK_FREE_MIN_MB, the awake computer that wrote
 * the most to its own disk and is not busy is put to sleep (linux.ts sleepBiggestIdle) so it stops growing, and its
 * bot's chat gets a notice. At most one computer every five minutes; a busy computer is never stopped.
 */
export const watchState = { lastActionAt: 0, everyMs: 60_000, gapMs: 5 * 60_000 };

/** Free bytes on the disk of `dir` (statfs: blocks available to unprivileged users × block size). */
export function freeBytes(dir: string): number | null {
  try { const s = statfsSync(dir); return Number(s.bavail) * Number(s.bsize); } catch { return null; }
}

/** One check (exported for tests): what it did, if anything. */
export async function diskCheck(o: { free?: number | null; at?: number } = {}): Promise<{ key: string; bytes: number } | null> {
  if (computerKind() !== "linux" || !config.diskFreeMinMb) return null;
  const free = o.free === undefined ? freeBytes(config.dataDir) : o.free;
  const at = o.at ?? Date.now();
  if (free === null || free >= config.diskFreeMinMb * 1024 * 1024 || at - watchState.lastActionAt < watchState.gapMs) return null;
  const slept = await sleepBiggestIdle();
  if (!slept) return null;
  watchState.lastActionAt = at;
  const loc = users.localeOf(slept.userId);
  const freeMb = Math.round(free / 1024 / 1024);
  console.log(`[disk] ${freeMb} MB free on the server: computer ${slept.key} put to sleep (${Math.round(slept.bytes / 1e6)} MB written on its own disk).`);
  const botId = isSharedMachine(slept.key) ? membersOf(slept.key)[0] : slept.key;
  const bot = botId ? bots.byId(botId) : null;
  if (bot) rows.append(bot, { kind: "notice", tone: "warn", text: tr(loc, "The server's disk is almost full ({mb} MB left): I put my computer to sleep so it stops filling it. Everything on it is kept. Free some space (or ask the server's owner to), then I can go on.", { mb: freeMb }) });
  return { key: slept.key, bytes: slept.bytes };
}

let timer: NodeJS.Timeout | null = null;
export function startDiskWatchdog() {
  if (timer || !config.diskFreeMinMb) return;
  timer = setInterval(() => { void diskCheck().catch((err) => console.error("[disk watchdog]", err)); }, watchState.everyMs);
  timer.unref();
}
