import { config } from "./config.js";
import { computerKind, workspaceOf } from "./computer.js";
import { q } from "./db.js";
import { diskScript, onComputerWoken } from "./linux.js";
import { bots, newId, rows, type BotRecord } from "./store.js";
import type { Card } from "./shared.js";

/**
 * A full disk on a bot's computer (wave 8, item 10b). When its computer starts, or a turn, a tool or a command fails
 * with a no-space error, the disk its home folder is on is measured (df, du inside the computer — or, when it is
 * asleep, in a throwaway container with only its own volumes). Past DISK_ALERT_PERCENT, a card lists the biggest files
 * and folders of the bot's own home and library; the user ticks what to delete and confirms. Nothing is ever deleted
 * on its own; only paths the card listed can be deleted, and only inside the bot's home volume (/root) or its library
 * (/root/files) — never the team folder, which other bots share, nor the sign-ins and settings the computer needs.
 */

/** The words of a no-space failure: Linux (ENOSPC, "No space left on device"), quotas, and tools that say it plainly. */
export const NO_SPACE = /no space left on device|\bENOSPC\b|disk quota exceeded|\bEDQUOT\b|not enough (?:free )?(?:disk )?space/i;

/** Never offered for deletion (nor anything inside them, nor a folder that holds them): what the computer needs to work. */
export const PROTECTED = ["/root/.sklubot", "/root/.config/sklubot-browser", "/root/.claude", "/root/.claude.json", "/root/.codex", "/root/.agent-reach", "/root/.ssh", "/root/team"];
const inOrUnder = (p: string, base: string) => p === base || p.startsWith(base + "/");

/** Whether a path may be offered for deletion: inside the home volume or the library, not one of the roots, not protected. */
export function deletable(p: string): boolean {
  if (typeof p !== "string" || p.length > 1000 || /[\0-\x1f]/.test(p)) return false;
  if (!p.startsWith("/root/") || p.split("/").some((seg) => seg === ".." || seg === ".") || p.endsWith("/")) return false;
  if (p === "/root/files") return false;
  return !PROTECTED.some((base) => inOrUnder(p, base) || inOrUnder(base, p));
}

/**
 * Measures the disk: one "DF total used avail" line (KiB, the filesystem of /root), then "size<TAB>path" lines for the
 * biggest files and folders up to 3 levels down in /root and the library, each on its own filesystem (-x: the team
 * folder and other mounts are not walked). Run with sh in the bot's computer (see diskScript).
 */
const MEASURE = `df -Pk /root | awk 'NR==2 {print "DF", $2, $3, $4}'
{ du -a -x -k -d 3 /root 2>/dev/null; du -a -x -k -d 3 /root/files 2>/dev/null; } | sort -rn | head -n 400`;

/**
 * Deletes the paths given as arguments, each only if its folder really is under /root (links resolved) and not in the
 * team folder; rm stays on one filesystem. Prints DEL / SKIP / GONE / FAIL per path, then the DF line.
 */
const DELETE = `for p in "$@"; do
  parent=$(dirname -- "$p"); real=$(realpath -e -- "$parent" 2>/dev/null) || { echo "GONE $p"; continue; }
  case "$real/" in /root/team/*) echo "SKIP $p"; continue;; /root/*) ;; *) echo "SKIP $p"; continue;; esac
  if [ ! -e "$p" ] && [ ! -L "$p" ]; then echo "GONE $p"; continue; fi
  if rm -rf --one-file-system -- "$p"; then echo "DEL $p"; else echo "FAIL $p"; fi
done
df -Pk /root | awk 'NR==2 {print "DF", $2, $3, $4}'`;

export interface DiskItem { path: string; bytes: number }
export interface DiskReport { usedPct: number; totalBytes: number; freeBytes: number; items: DiskItem[] }

/** Reads MEASURE's output: the disk's use and the biggest deletable items (a folder's own contents are not repeated). */
export function parseMeasure(out: string, max = 12): DiskReport | null {
  const df = /^DF (\d+) (\d+) (\d+)$/m.exec(out);
  if (!df) return null;
  const [total, used, avail] = [Number(df[1]), Number(df[2]), Number(df[3])];
  const all: DiskItem[] = [];
  for (const line of out.split("\n")) {
    const m = /^(\d+)\t(\/root\/.+)$/.exec(line);
    if (m && deletable(m[2])) all.push({ path: m[2], bytes: Number(m[1]) * 1024 });
  }
  all.sort((a, b) => b.bytes - a.bytes);
  const items: DiskItem[] = [];
  for (const it of all) {
    if (it.bytes < 1024 * 1024) break;
    if (items.some((x) => inOrUnder(it.path, x.path) || inOrUnder(x.path, it.path))) continue;
    items.push(it);
    if (items.length >= max) break;
  }
  const denom = used + avail || total;
  return { usedPct: denom ? Math.round((used / denom) * 100) : 0, totalBytes: total * 1024, freeBytes: avail * 1024, items };
}

/** Replaceable in tests: how the script runs against a bot's disk. */
export const diskRunner = {
  run: (botId: string, script: string, args: string[] = []) => diskScript(botId, workspaceOf(botId), script, args),
};

const lastCheck = new Map<string, number>();
const CHECK_EVERY_MS = 10 * 60_000;
const pendingCardOf = (botId: string, generation: number) =>
  q.get<{ seq: number }>("SELECT seq FROM rows WHERE bot_id = ? AND generation = ? AND kind = 'card' AND body LIKE '%\"type\":\"disk\"%' AND body LIKE '%\"status\":\"pending\"%' ORDER BY seq DESC LIMIT 1", botId, generation)?.seq ?? null;

/**
 * Measures the bot's disk and, past the threshold, shows the card (at most one pending card per bot; at most one check
 * every 10 minutes unless `force`). Returns what it measured (null: no Linux computer, nothing to measure, too soon).
 */
export async function checkDisk(bot: BotRecord, opts: { force?: boolean } = {}): Promise<DiskReport | null> {
  if (computerKind() !== "linux" || bot.kind !== "agent") return null;
  if (!opts.force && Date.now() - (lastCheck.get(bot.id) ?? 0) < CHECK_EVERY_MS) return null;
  lastCheck.set(bot.id, Date.now());
  const r = await diskRunner.run(bot.id, MEASURE);
  if (!r || r.code !== 0) return null;
  const report = parseMeasure(r.stdout.toString("utf8"));
  if (!report || report.usedPct < config.diskAlertPct) return report;
  const fresh = bots.byId(bot.id);
  if (!fresh || pendingCardOf(fresh.id, fresh.generation) !== null) return report;
  const card: Card = { type: "disk", checkId: newId("dsk"), usedPct: report.usedPct, totalBytes: report.totalBytes, freeBytes: report.freeBytes, items: report.items, status: "pending" };
  rows.append(fresh, { kind: "card", card }, 0);
  bots.bumpUnread(fresh.id);
  return report;
}

/** Something failed: if it says the disk is full, check it (in the background; errors are only logged). */
export function noteDiskTrouble(bot: BotRecord | null | undefined, text: unknown) {
  if (!bot || typeof text !== "string" || !NO_SPACE.test(text)) return;
  void checkDisk(bot).catch((err) => console.error(`[disk ${bot.id}]`, (err as Error)?.message ?? err));
}

/** The user confirmed: deletes the chosen paths (each one listed on the card), then measures again. */
export async function deleteListed(bot: BotRecord, listed: DiskItem[], chosen: string[]): Promise<{ deleted: string[]; skipped: string[]; freedBytes: number; freeBytes: number | null }> {
  const allowed = new Set(listed.map((i) => i.path));
  const paths = [...new Set(chosen)].filter((p) => allowed.has(p) && deletable(p));
  if (!paths.length) return { deleted: [], skipped: chosen, freedBytes: 0, freeBytes: null };
  const r = await diskRunner.run(bot.id, DELETE, paths);
  const out = r?.stdout.toString("utf8") ?? "";
  const deleted = paths.filter((p) => out.split("\n").includes(`DEL ${p}`) || out.split("\n").includes(`GONE ${p}`));
  const freedBytes = listed.filter((i) => deleted.includes(i.path)).reduce((n, i) => n + i.bytes, 0);
  const df = /^DF (\d+) (\d+) (\d+)$/m.exec(out);
  return { deleted, skipped: paths.filter((p) => !deleted.includes(p)), freedBytes, freeBytes: df ? Number(df[3]) * 1024 : null };
}

// A computer that just started is checked once (throttled): a disk filling up is caught before work fails on it.
onComputerWoken((botId) => {
  const b = bots.byId(botId);
  if (b) void checkDisk(b).catch((err) => console.error(`[disk ${botId}]`, (err as Error)?.message ?? err));
});
