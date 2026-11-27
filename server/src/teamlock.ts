import { createHash, randomBytes } from "node:crypto";
import { closeSync, constants as FS, existsSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { resolveInTeam, teamDirOf } from "./computer.js";

/**
 * L161 « verrou d'écriture sur le dossier d'équipe » (audit CLI-Anything n° 8; idea from its `_locked_save_json`, our own
 * code). The team folder (~/team, computer.ts) is shared by the bots of one account: two of them must never write the
 * same file at the same time, and one must not overwrite what another just changed without having read it.
 *
 *  - Every write through team_file_write is serialised per file (one writer at a time, the others wait their turn) and
 *    atomic (a temporary file next to it, then a rename: a reader never sees half a file).
 *  - A bot that edits a file with its own commands (a script, a spreadsheet tool) first takes team_lock on it, at most
 *    LOCK_MAX_MIN minutes: until it lets go (or the time is up), another bot's team_file_write and its shell commands that
 *    write that file are refused with who holds it and until when. The locks are also written to ~/team/.verrous.json so
 *    the bots' own commands can see them.
 *  - team_file_read gives a version (the content's fingerprint); team_file_write with `expected` refuses when the file
 *    changed since, naming the bot that changed it.
 *
 * In memory (one server drives every computer of an account): a restart lets every lock go, which is the safe way round
 * (nobody waits for a lock whose holder is gone).
 */

export const LOCK_MAX_MIN = 30;
export const LOCKS_FILE = ".verrous.json";
const MAX_WRITE = 2_000_000;

export interface TeamLock { userId: string; path: string; botId: string; botName: string; since: number; until: number }
interface Writer { botId: string; botName: string; at: number }
type Bot = { id: string; userId: string; name: string };

const locks = new Map<string, TeamLock>();
const lastWriter = new Map<string, Writer>();
const queues = new Map<string, Promise<unknown>>();
const keyOf = (userId: string, rel: string) => `${userId}\0${rel}`;

/** "~/team/a/b.md", "/root/team/a/b.md", "./a/b.md" → "a/b.md"; null for an empty path or one that leaves the folder. */
export function teamRel(raw: unknown): string | null {
  const s = String(raw ?? "").trim().replace(/\\/g, "/").replace(/^(~|\/root|\$HOME)\/team(\/|$)/, "").replace(/^\/+/, "");
  if (!s || /[\0-\x1f]/.test(s)) return null;
  const n = path.posix.normalize(s);
  if (!n || n === "." || n === ".." || n.startsWith("../") || n === LOCKS_FILE) return null;
  return n.replace(/\/+$/, "");
}

export const fingerprint = (data: string | Buffer) => createHash("sha256").update(data).digest("hex").slice(0, 16);

/** The live lock on a file (an expired one is dropped). */
export function lockOn(userId: string, rel: string, t = Date.now()): TeamLock | null {
  const k = keyOf(userId, rel);
  const l = locks.get(k);
  if (l && l.until <= t) { locks.delete(k); mirror(userId); return null; }
  return l ?? null;
}
export function locksOf(userId: string, t = Date.now()): TeamLock[] {
  return [...locks.values()].filter((l) => l.userId === userId).filter((l) => lockOn(userId, l.path, t)).sort((a, b) => a.path.localeCompare(b.path));
}

/** The locks as a file in the team folder, for the bots' own commands (best effort: the in-memory map is the rule). */
function mirror(userId: string) {
  try {
    const list = [...locks.values()].filter((l) => l.userId === userId && l.until > Date.now()).map((l) => ({ fichier: l.path, bot: l.botName, depuis: new Date(l.since).toISOString(), jusqua: new Date(l.until).toISOString() }));
    const file = path.join(teamDirOf(userId), LOCKS_FILE);
    if (!list.length) { rmSync(file, { force: true }); return; }
    writeFileSync(file, JSON.stringify({ note: "Fichiers du dossier d'équipe verrouillés par un bot (team_lock). N'écris pas ces fichiers avant la fin du verrou.", verrous: list }, null, 2));
  } catch { /* the folder may not exist on this server */ }
}

const minutesLeft = (l: TeamLock, t: number) => Math.max(1, Math.ceil((l.until - t) / 60_000));
const heldText = (l: TeamLock, t: number) => `${l.botName} is changing "${l.path}" right now (lock for ${minutesLeft(l, t)} more min). Wait for it to finish, or work on another file.`;

export function takeLock(bot: Bot, raw: unknown, minutes: unknown, t = Date.now()): { lock: TeamLock } | { error: string } {
  const rel = teamRel(raw);
  if (!rel) return { error: "Give the path of a file inside the team folder, e.g. clients/liste.csv." };
  const min = Math.min(LOCK_MAX_MIN, Math.max(1, Math.round(Number(minutes) || 10)));
  const cur = lockOn(bot.userId, rel, t);
  if (cur && cur.botId !== bot.id) return { error: heldText(cur, t) };
  const lock: TeamLock = { userId: bot.userId, path: rel, botId: bot.id, botName: bot.name, since: cur?.since ?? t, until: t + min * 60_000 };
  locks.set(keyOf(bot.userId, rel), lock);
  mirror(bot.userId);
  return { lock };
}

export function releaseLock(bot: Bot, raw: unknown): boolean {
  const rel = teamRel(raw);
  if (!rel) return false;
  const cur = lockOn(bot.userId, rel);
  if (!cur || cur.botId !== bot.id) return false;
  locks.delete(keyOf(bot.userId, rel));
  mirror(bot.userId);
  return true;
}

/** Everything a bot holds (the bot is deleted, or its turn ends with team_unlock all). */
export function releaseAllOf(botId: string): number {
  const mine = [...locks.entries()].filter(([, l]) => l.botId === botId);
  for (const [k] of mine) locks.delete(k);
  for (const u of new Set(mine.map(([, l]) => l.userId))) mirror(u);
  return mine.length;
}

/** One writer at a time per file: `fn` runs after the writes queued before it. */
async function inTurn<T>(k: string, fn: () => T | Promise<T>): Promise<T> {
  const before = queues.get(k) ?? Promise.resolve();
  const run = before.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  queues.set(k, tail);
  try { return await run; } finally { if (queues.get(k) === tail) queues.delete(k); }
}

export function readTeamText(bot: Bot, raw: unknown): { path: string; content: string; version: string; lock: TeamLock | null } | { error: string } {
  const rel = teamRel(raw);
  if (!rel) return { error: "Give the path of a file inside the team folder." };
  let full: string;
  try { full = resolveInTeam(bot.userId, rel); } catch (err) { return { error: (err as Error).message }; }
  if (!existsSync(full)) return { error: `There is no file "${rel}" in the team folder yet.` };
  const fd = openSync(full, FS.O_RDONLY | (FS.O_NOFOLLOW ?? 0) | (FS.O_NONBLOCK ?? 0));
  try {
    const st = fstatSync(fd);
    if (!st.isFile()) return { error: `"${rel}" is a folder, not a file.` };
    if (st.size > MAX_WRITE) return { error: `"${rel}" is too big to read here (${Math.round(st.size / 1e6)} MB); read the part you need with a command.` };
    const data = readFileSync(fd);
    return { path: rel, content: data.toString("utf8"), version: fingerprint(data), lock: lockOn(bot.userId, rel) };
  } finally { closeSync(fd); }
}

export interface WriteResult { path: string; version: string; bytes: number; waitedMs: number }

/**
 * Writes a text file of the team folder, alone and whole. Refused when another bot holds a lock on it, or when
 * `expected` (a version from team_file_read) is given and the file changed since.
 */
export async function writeTeamText(bot: Bot, raw: unknown, content: unknown, o: { append?: boolean; expected?: unknown } = {}): Promise<WriteResult | { error: string }> {
  const rel = teamRel(raw);
  if (!rel) return { error: "Give the path of a file inside the team folder, e.g. notes/reunion.md." };
  const text = String(content ?? "");
  if (Buffer.byteLength(text) > MAX_WRITE) return { error: "That is too long for one write (2 MB at most)." };
  const queuedAt = Date.now();
  return inTurn(keyOf(bot.userId, rel), () => {
    const t = Date.now();
    const held = lockOn(bot.userId, rel, t);
    if (held && held.botId !== bot.id) return { error: heldText(held, t) };
    let full: string;
    try { full = resolveInTeam(bot.userId, rel); } catch (err) { return { error: (err as Error).message }; }
    const before = existsSync(full) ? readFileSync(full) : null;
    if (o.expected !== undefined && o.expected !== null && o.expected !== "") {
      const now = before ? fingerprint(before) : "absent";
      if (now !== String(o.expected)) {
        const w = lastWriter.get(keyOf(bot.userId, rel));
        return { error: `"${rel}" changed since you read it${w && w.botId !== bot.id ? ` (${w.botName} wrote it)` : ""}. Read it again with team_file_read, merge your change, then write.` };
      }
    }
    const data = o.append && before ? Buffer.concat([before, Buffer.from(text)]) : Buffer.from(text);
    mkdirSync(path.dirname(full), { recursive: true });
    // Atomic: a temporary file in the same folder, then a rename over the old one.
    const tmp = path.join(path.dirname(full), `.${path.basename(full)}.${randomBytes(4).toString("hex")}.tmp`);
    try { writeFileSync(tmp, data, { flag: "wx" }); renameSync(tmp, full); } catch (err) { rmSync(tmp, { force: true }); return { error: `Could not write "${rel}": ${(err as Error).message}` }; }
    lastWriter.set(keyOf(bot.userId, rel), { botId: bot.id, botName: bot.name, at: t });
    return { path: rel, version: fingerprint(data), bytes: data.length, waitedMs: t - queuedAt };
  });
}

/** Words of a command that change files (redirections, moves, copies, removals, in-place edits, writers). */
const WRITES = /(^|[^<>&0-9])>>?|\b(tee|mv|cp|rm|rmdir|truncate|touch|install|rsync|unzip|tar|dd|ln|chmod|chown)\b|\bsed\s+(-[a-zA-Z]*i|--in-place)|\bperl\s+-[a-zA-Z]*i|\bpython3?\b|\bnode\b|\blibreoffice\b|\bsoffice\b|\bcurl\b[^|;&]*\s-o\b|\bwget\b/;

/**
 * shell_run: a command that writes and names a file another bot has locked is refused (the lock's holder and how long
 * it has left). The file is named by its path inside the folder or its file name, in the command's words.
 */
export function shellLockRefusal(bot: Bot, command: string, t = Date.now()): string | null {
  if (!/\bteam\b/.test(command) || !WRITES.test(command)) return null;
  for (const l of locksOf(bot.userId, t)) {
    if (l.botId === bot.id) continue;
    const base = path.posix.basename(l.path);
    if (command.includes(l.path) || new RegExp(`(^|[\\s/'"=])${base.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[\\s'";|&)])`).test(command)) {
      return `Not run: ${heldText(l, t)} (team folder lock, ~/team/${LOCKS_FILE}).`;
    }
  }
  return null;
}

/** For tests. */
export function resetTeamLocks() { locks.clear(); lastWriter.clear(); queues.clear(); }
