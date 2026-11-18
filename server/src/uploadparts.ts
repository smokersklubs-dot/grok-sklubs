import { randomUUID } from "node:crypto";
import { closeSync, constants, fdatasyncSync, linkSync, lstatSync, mkdirSync, openSync, realpathSync, statfsSync, unlinkSync, writeSync } from "node:fs";
import path from "node:path";
import type { Context } from "hono";
import { config } from "./config.js";
import { checkLibraryUpload, resolveInWorkspace, storeLibraryFile } from "./computer.js";
import { q } from "./db.js";
import { MAX_UPLOAD_BYTES, PART_BYTES } from "./uploadlimits.js";
import type { Attachment } from "./shared.js";

interface Session { id: string; name: string; total: number; received: number; receipt: string | null }
const staging = path.join(config.dataDir, "incoming-uploads");
const expiresAfter = 2 * 60 * 60_000;
const session = (bot: string, id: string) => q.get<Session>("SELECT * FROM upload_sessions WHERE bot = ? AND id = ?", bot, id);
const stagedPath = (row: Session) => path.join(staging, row.id);
function discard(id: string) {
  try { unlinkSync(path.join(staging, id)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  q.run("DELETE FROM upload_sessions WHERE id = ?", id);
}
export function sweepUploads() {
  q.tx(() => {
    for (const row of q.all<{ id: string }>("SELECT id FROM upload_sessions WHERE touched < ?", Date.now() - expiresAfter)) discard(row.id);
  });
}
export function startUploadSweep() {
  const sweep = () => { try { sweepUploads(); } catch (e) { console.error("[upload cleanup]", e); } };
  sweep();
  setInterval(sweep, 15 * 60_000).unref();
}
export function beginUpload(c: Context, bot: string, owner: string, input: Record<string, unknown>) {
  const { name, size } = input;
  if (typeof name !== "string" || !name.trim() || name.length > 1024 || typeof size !== "number" || !Number.isSafeInteger(size) || size < 1)
    return c.json({ error: "Invalid file name or size." }, 400);
  if (size > MAX_UPLOAD_BYTES) return c.json({ error: "Files can be up to 1 GB." }, 413);
  mkdirSync(staging, { recursive: true, mode: 0o700 });
  return q.tx(() => {
    const active = q.get<{ own: number; reserved: number; remaining: number; count: number }>(
      "SELECT count(CASE WHEN owner=? THEN 1 END) own, coalesce(sum(CASE WHEN owner=? THEN total ELSE 0 END),0) reserved, coalesce(sum(total-received),0) remaining, count(*) count FROM upload_sessions WHERE receipt IS NULL", owner, owner)!;
    if (active.own >= 12 || active.count >= 96) return c.json({ error: "Too many uploads in progress. Try again shortly." }, 429);
    checkLibraryUpload(bot, active.reserved + size, true);
    const disk = statfsSync(staging);
    if (disk.bavail * disk.bsize < size + active.remaining + 200_000_000) return c.json({ error: "Insufficient free storage for this file." }, 507);
    const id = randomUUID();
    q.run("INSERT INTO upload_sessions(id,owner,bot,name,total,touched) VALUES (?,?,?,?,?,?)", id, owner, bot, name, size, Date.now());
    return c.json({ id, partBytes: PART_BYTES });
  });
}

// Publish the completed file on the same volume, atomically and exclusively. On Linux the destination
// directory is pinned by descriptor, even if a desktop changes a directory entry during publication.
function publish(bot: string, row: Session) {
  const source = stagedPath(row);
  const original = lstatSync(source, { bigint: true });
  const dir = resolveInWorkspace(bot, "uploads");
  mkdirSync(dir, { recursive: true });
  const fd = process.platform === "linux" ? openSync(dir, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW) : null;
  try {
    const anchor = fd === null ? dir : `/proc/self/fd/${fd}`;
    if (realpathSync(anchor) !== resolveInWorkspace(bot, "uploads")) throw new Error("Upload directory changed.");
    return storeLibraryFile(bot, "uploads", row.name, target => {
      checkLibraryUpload(bot, row.total, true);
      linkSync(source, path.join(anchor, path.basename(target)));
      checkLibraryUpload(bot, row.total);
    }, existing => {
      const st = lstatSync(existing, { bigint: true });
      return st.isFile() && st.dev === original.dev && st.ino === original.ino;
    });
  } finally { if (fd !== null) closeSync(fd); }
}
async function readPart(req: Request, length: number): Promise<Buffer | null> {
  const reader = req.body?.getReader();
  if (!reader) return null;
  const buffer = Buffer.allocUnsafe(length);
  let offset = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return offset === length ? buffer : null;
      if (value.length > length - offset) { await reader.cancel(); return null; }
      buffer.set(value, offset);
      offset += value.length;
    }
  } finally { reader.releaseLock(); }
}
let reading = 0;
export async function receivePart(c: Context, bot: string, id: string) {
  const row = session(bot, id);
  if (!row) return c.json({ error: "Upload does not exist or has expired." }, 404);
  const at = c.req.query("offset") ?? "";
  const offset = Number(at);
  if (!/^\d+$/.test(at) || offset % PART_BYTES || offset >= row.total || offset > row.received) return c.json({ error: "Unexpected upload offset." }, 409);
  const length = Math.min(PART_BYTES, row.total - offset);
  if (c.req.header("content-length") !== undefined && Number(c.req.header("content-length")) !== length)
    return c.json({ error: "Unexpected upload part length." }, 400);
  if (reading >= 12) { c.header("Retry-After", "1"); return c.json({ error: "Uploads are busy." }, 429); }
  reading++;
  try {
    const bytes = await readPart(c.req.raw, length);
    if (!bytes) return c.json({ error: "Incomplete or oversized upload part." }, 400);
    const result = q.tx(() => {
      // Another request may have committed this part or cancelled the session while the body was arriving.
      const current = session(bot, id);
      if (!current) return null;
      if (current.receipt) return { attachment: JSON.parse(current.receipt) as Attachment };
      if (offset < current.received) return { received: current.received };
      const file = stagedPath(current);
      const fd = openSync(file, constants.O_WRONLY | constants.O_CREAT, 0o600);
      try {
        let written = 0;
        while (written < length) written += writeSync(fd, bytes, written, length - written, offset + written);
        fdatasyncSync(fd);
      } finally { closeSync(fd); }
      const received = offset + length;
      const attachment = received === current.total ? publish(bot, current) : undefined;
      q.run("UPDATE upload_sessions SET received=?, receipt=?, touched=? WHERE id=?", received, attachment ? JSON.stringify(attachment) : null, Date.now(), id);
      return attachment ? { attachment } : { received };
    });
    if (!result) return c.json({ error: "Upload expired." }, 404);
    // The receipt is durable before unlinking the staging name. The sweeper also cleans up after a process exit.
    if (result.attachment) {
      try { unlinkSync(stagedPath(row)); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") console.error("[upload cleanup]", e); }
    }
    return c.json(result);
  } finally { reading--; }
}
export function cancelUpload(c: Context, bot: string, id: string) {
  q.tx(() => { const row = session(bot, id); if (row && !row.receipt) discard(row.id); });
  return c.body(null, 204);
}
