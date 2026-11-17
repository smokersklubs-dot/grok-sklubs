/**
 * A streaming tar writer and reader, for the in-app backup (autobackup.ts) and its restore tool (backupcheck.ts).
 *
 * Format: POSIX ustar headers (512-byte blocks: name, mode, uid, gid, size, mtime, checksum, typeflag, linkname,
 * "ustar\0" "00", prefix) with a POSIX pax extended header ('x') in front of an entry whose name or link is too long or
 * not ASCII, or whose size does not fit the 11 octal digits (8 GiB) — the "pax interchange format" of POSIX.1-2001,
 * https://pubs.opengroup.org/onlinepubs/9799919799/utilities/pax.html (sections "ustar Interchange Format" and "pax
 * Interchange Format"). GNU tar, bsdtar and busybox read it; the tests extract an archive with the system's tar.
 *
 * A file is read with the size it had when it was listed: if it shrinks while it is read the rest is zero-filled, if it
 * grows the extra is left out (like GNU tar's "file changed as we read it", the archive stays well-formed).
 */
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, lchownSync, lstatSync, mkdirSync, realpathSync, symlinkSync, utimesSync, chmodSync } from "node:fs";
import { once } from "node:events";
import path from "node:path";
import { Writable } from "node:stream";

export interface TarEntry {
  name: string;
  type: "file" | "dir" | "symlink";
  mode: number;
  mtime: number; // seconds
  uid?: number;
  gid?: number;
  size?: number; // files
  linkname?: string; // symlinks
  /** A file's content: a path to read, or the bytes. */
  source?: string;
  data?: Buffer;
}

const BLOCK = 512;
function octal(buf: Buffer, off: number, len: number, value: number) {
  const s = Math.max(0, Math.floor(value)).toString(8).padStart(len - 1, "0");
  if (s.length > len - 1) throw new Error("tar field overflow");
  buf.write(s, off, len - 1, "ascii");
  buf[off + len - 1] = 0;
}
const fits = (s: string, max: number) => /^[\x20-\x7e]*$/.test(s) && Buffer.byteLength(s) <= max;
function paxRecord(key: string, value: string): string {
  const body = ` ${key}=${value}\n`;
  let len = Buffer.byteLength(body) + 1;
  while (String(len).length + Buffer.byteLength(body) !== len) len = String(len).length + Buffer.byteLength(body);
  return `${len}${body}`;
}
function header(name: string, type: string, o: { mode: number; uid: number; gid: number; size: number; mtime: number; linkname?: string }): Buffer {
  const b = Buffer.alloc(BLOCK);
  b.write(name, 0, 100, "utf8");
  octal(b, 100, 8, o.mode & 0o7777);
  octal(b, 108, 8, o.uid);
  octal(b, 116, 8, o.gid);
  octal(b, 124, 12, o.size);
  octal(b, 136, 12, o.mtime);
  b.fill(0x20, 148, 156);
  b.write(type, 156, 1, "ascii");
  if (o.linkname) b.write(o.linkname, 157, 100, "utf8");
  b.write("ustar\0", 257, 6, "ascii");
  b.write("00", 263, 2, "ascii");
  let sum = 0;
  for (let i = 0; i < BLOCK; i++) sum += b[i];
  b.write(sum.toString(8).padStart(6, "0"), 148, 6, "ascii");
  b[154] = 0; b[155] = 0x20;
  return b;
}
const pad = (n: number) => (n % BLOCK ? Buffer.alloc(BLOCK - (n % BLOCK)) : null);

/** The header block(s) of one entry (a pax header first when needed). */
export function entryHeader(e: TarEntry): Buffer {
  const size = e.type === "file" ? (e.data ? e.data.length : e.size ?? 0) : 0;
  const name = e.type === "dir" && !e.name.endsWith("/") ? `${e.name}/` : e.name;
  const pax: string[] = [];
  let shortName = name;
  if (!fits(name, 100)) { pax.push(paxRecord("path", name)); shortName = `${name.replace(/[^\x20-\x7e]/g, "_").slice(0, 99 - (e.type === "dir" ? 1 : 0))}${e.type === "dir" ? "/" : ""}`; }
  let link = e.linkname ?? "";
  if (link && !fits(link, 100)) { pax.push(paxRecord("linkpath", link)); link = link.replace(/[^\x20-\x7e]/g, "_").slice(0, 100); }
  if (size > 0o77777777777) pax.push(paxRecord("size", String(size)));
  const common = { mode: e.mode, uid: e.uid ?? 0, gid: e.gid ?? 0, mtime: e.mtime };
  const main = header(shortName, e.type === "file" ? "0" : e.type === "dir" ? "5" : "2", { ...common, size: size > 0o77777777777 ? 0 : size, linkname: link });
  if (!pax.length) return main;
  const body = Buffer.from(pax.join(""));
  return Buffer.concat([header(`PaxHeaders/${shortName.replace(/\/$/, "").split("/").pop()!.slice(0, 80)}`, "x", { ...common, mode: 0o644, size: body.length }), body, pad(body.length) ?? Buffer.alloc(0), main]);
}

export interface TarStats { files: number; bytes: number; changed: string[] }

/**
 * The bytes of a tar archive of these entries (an async iterable of entries, so a folder walk can feed it lazily).
 * `onFile` receives each file's name and SHA-256 (hex) once its content has gone out (for a checksum list).
 */
export async function* tarStream(entries: AsyncIterable<TarEntry> | Iterable<TarEntry>, stats: TarStats, onFile?: (name: string, sha256: string, size: number) => void, signal?: AbortSignal): AsyncGenerator<Buffer> {
  for await (const e of entries) {
    signal?.throwIfAborted();
    yield entryHeader(e);
    if (e.type !== "file") continue;
    const h = createHash("sha256");
    let sent = 0;
    if (e.data) { h.update(e.data); sent = e.data.length; if (e.data.length) yield e.data; }
    else if (e.source && (e.size ?? 0) > 0) {
      const want = e.size ?? 0;
      const rs = createReadStream(e.source, { start: 0, end: want - 1, highWaterMark: 256 * 1024 });
      try {
        for await (const chunk of rs as AsyncIterable<Buffer>) {
          signal?.throwIfAborted();
          const c = sent + chunk.length > want ? chunk.subarray(0, want - sent) : chunk;
          sent += c.length; h.update(c);
          yield c;
          if (sent >= want) break;
        }
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err; // removed while we read: zero-filled below
      } finally { rs.destroy(); }
      if (sent < want) {
        stats.changed.push(e.name);
        let left = want - sent;
        const zero = Buffer.alloc(Math.min(left, 256 * 1024));
        while (left > 0) { const z = left >= zero.length ? zero : zero.subarray(0, left); h.update(z); left -= z.length; sent += z.length; yield z; }
      }
    }
    const p = pad(sent);
    if (p) yield p;
    stats.files++; stats.bytes += sent;
    onFile?.(e.name, h.digest("hex"), sent);
  }
  yield Buffer.alloc(BLOCK * 2);
}

// ── Reading ──────────────────────────────────────────────────────────────────
export interface TarReadEntry { name: string; type: "file" | "dir" | "symlink" | "other"; mode: number; mtime: number; uid: number; gid: number; size: number; linkname: string }
export interface TarHandler {
  /** A new entry. Return a sink for its bytes (files only), or nothing to skip them. */
  entry(e: TarReadEntry): { write(chunk: Buffer): void | Promise<void>; end(): void | Promise<void> } | void | Promise<{ write(chunk: Buffer): void | Promise<void>; end(): void | Promise<void> } | void>;
}

const readOctal = (b: Buffer, off: number, len: number) => {
  // GNU base-256 for large values (high bit of the first byte).
  if (b[off] & 0x80) { let v = 0; for (let i = off + 1; i < off + len; i++) v = v * 256 + b[i]; return v; }
  const s = b.toString("ascii", off, off + len).replace(/\0.*$/s, "").trim();
  return s ? parseInt(s, 8) : 0;
};
const cstr = (b: Buffer, off: number, len: number) => { const end = b.indexOf(0, off); return b.toString("utf8", off, end >= 0 && end < off + len ? end : off + len); };
function parsePax(body: Buffer): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < body.length) {
    const sp = body.indexOf(0x20, i);
    if (sp < 0) break;
    const len = parseInt(body.toString("ascii", i, sp), 10);
    if (!len) break;
    const rec = body.toString("utf8", sp + 1, i + len - 1);
    const eq = rec.indexOf("=");
    if (eq > 0) out[rec.slice(0, eq)] = rec.slice(eq + 1);
    i += len;
  }
  return out;
}

/** A Writable that parses a tar stream and hands each entry to `handler`. Fails on a bad checksum or a truncated archive. */
export function tarReader(handler: TarHandler): Writable {
  let buf: Buffer = Buffer.alloc(0);
  let mode: "header" | "body" | "end" = "header";
  let bodyKind: "file" | "pax" | "longname" | "skip" = "skip";
  let left = 0, padAfter = 0, skip = 0, zeroBlocks = 0;
  let sink: { write(c: Buffer): void | Promise<void>; end(): void | Promise<void> } | void;
  let pax: Record<string, string> = {};
  let meta: Buffer[] = [];
  let longName: string | null = null;
  const drive = async () => {
    for (;;) {
      if (mode === "end") { buf = Buffer.alloc(0); return; }
      if (skip > 0) { const n = Math.min(skip, buf.length); buf = buf.subarray(n); skip -= n; if (skip) return; continue; }
      if (mode === "body") {
        if (left === 0) {
          if (bodyKind === "file" && sink) await sink.end();
          if (bodyKind === "pax") pax = { ...pax, ...parsePax(Buffer.concat(meta)) };
          if (bodyKind === "longname") longName = Buffer.concat(meta).toString("utf8").replace(/\0+$/, "");
          sink = undefined; meta = [];
          mode = "header"; skip = padAfter; padAfter = 0;
          continue;
        }
        if (!buf.length) return;
        const n = Math.min(left, buf.length);
        const c = buf.subarray(0, n);
        buf = buf.subarray(n); left -= n;
        if (bodyKind === "file") { if (sink) await sink.write(c); }
        else if (bodyKind === "pax" || bodyKind === "longname") meta.push(Buffer.from(c));
        continue;
      }
      if (buf.length < BLOCK) return;
      const h = buf.subarray(0, BLOCK);
      buf = buf.subarray(BLOCK);
      if (h.every((x) => x === 0)) { if (++zeroBlocks >= 2) mode = "end"; continue; }
      zeroBlocks = 0;
      let sum = 0;
      for (let i = 0; i < BLOCK; i++) sum += i >= 148 && i < 156 ? 0x20 : h[i];
      if (sum !== readOctal(h, 148, 8)) throw new Error("This archive is damaged (bad tar header checksum).");
      const type = String.fromCharCode(h[156] || 0x30);
      let size = readOctal(h, 124, 12);
      const begin = (kind: typeof bodyKind, n: number) => { mode = "body"; bodyKind = kind; left = n; padAfter = n % BLOCK ? BLOCK - (n % BLOCK) : 0; meta = []; };
      if (type === "x") { begin("pax", size); continue; }
      if (type === "g") { begin("skip", size); continue; }
      if (type === "L") { begin("longname", size); continue; }
      const prefix = h.subarray(257, 262).toString("ascii") === "ustar" ? cstr(h, 345, 155) : "";
      let name = longName ?? pax.path ?? (prefix ? `${prefix}/${cstr(h, 0, 100)}` : cstr(h, 0, 100));
      if (pax.size) size = Number(pax.size);
      const linkname = pax.linkpath ?? cstr(h, 157, 100);
      pax = {}; longName = null;
      const kind = type === "0" || type === "7" ? "file" : type === "5" ? "dir" : type === "2" ? "symlink" : "other";
      if (kind === "dir") name = name.replace(/\/+$/, "");
      const dataLen = kind === "file" || kind === "other" ? size : 0;
      sink = await handler.entry({ name, type: kind, mode: readOctal(h, 100, 8), uid: readOctal(h, 108, 8), gid: readOctal(h, 116, 8), mtime: readOctal(h, 136, 12), size: dataLen, linkname });
      begin(kind === "file" ? "file" : "skip", dataLen);
    }
  };
  return new Writable({
    async write(chunk: Buffer, _e, cb) {
      try { buf = buf.length ? Buffer.concat([buf, chunk]) : chunk; await drive(); cb(); } catch (err) { cb(err as Error); }
    },
    async final(cb) {
      try {
        await drive();
        if (mode !== "end") throw new Error("This archive is truncated (no end marker).");
        cb();
      } catch (err) { cb(err as Error); }
    },
  });
}

/** Is `child` inside `root` (both real paths)? */
const inside = (root: string, child: string) => child === root || child.startsWith(root.endsWith(path.sep) ? root : root + path.sep);

/**
 * Extracts entries under `prefix` (e.g. "data/") into `dest`, refusing anything that would land outside it (absolute
 * names, "..", or a path through a symbolic link). Returns the files written.
 */
export function extractTo(dest: string, prefix: string, opts: { keepOwner?: boolean } = {}): TarHandler & { written: number } {
  mkdirSync(dest, { recursive: true });
  const root = realpathSync(dest);
  const out = {
    written: 0,
    async entry(e: TarReadEntry) {
      if (!e.name.startsWith(prefix)) return;
      const rel = e.name.slice(prefix.length);
      if (!rel || rel.startsWith("/") || rel.split("/").some((s) => s === ".." )) return;
      const target = path.join(root, rel);
      const parent = path.dirname(target);
      mkdirSync(parent, { recursive: true });
      if (!inside(root, realpathSync(parent))) throw new Error(`Refused to write outside the destination: ${e.name}`);
      const own = () => { if (opts.keepOwner && process.getuid?.() === 0) { try { lchownSync(target, e.uid, e.gid); } catch { /* best effort */ } } };
      if (e.type === "dir") { mkdirSync(target, { recursive: true }); chmodSync(target, e.mode & 0o7777 || 0o755); own(); return; }
      if (e.type === "symlink") { try { if (lstatSync(target, { throwIfNoEntry: false })) return; symlinkSync(e.linkname, target); own(); } catch { /* skip */ } return; }
      if (e.type !== "file") return;
      const existing = lstatSync(target, { throwIfNoEntry: false });
      if (existing?.isSymbolicLink()) throw new Error(`Refused to write through a symbolic link: ${e.name}`);
      const ws = createWriteStream(target, { mode: e.mode & 0o7777 || 0o644 });
      out.written++;
      return {
        async write(c: Buffer) { if (!ws.write(c)) await once(ws, "drain"); },
        async end() { ws.end(); await once(ws, "finish"); try { chmodSync(target, e.mode & 0o7777 || 0o644); utimesSync(target, e.mtime, e.mtime); } catch { /* best effort */ } own(); },
      };
    },
  };
  return out;
}

/** Quotes a name the way GNU sha256sum does (a leading backslash, \\ and \n escaped) for names it cannot write plainly. */
export function sumLine(hash: string, name: string): string {
  if (/[\\\n\r]/.test(name)) return `\\${hash}  ${name.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/\r/g, "\\r")}\n`;
  return `${hash}  ${name}\n`;
}
export function parseSumLine(line: string): { hash: string; name: string } | null {
  const esc = line.startsWith("\\");
  const m = /^\\?([0-9a-f]{64}) [ *](.*)$/.exec(line);
  if (!m) return null;
  const name = esc ? m[2].replace(/\\(\\|n|r)/g, (_x, c) => (c === "n" ? "\n" : c === "r" ? "\r" : "\\")) : m[2];
  return { hash: m[1], name };
}
