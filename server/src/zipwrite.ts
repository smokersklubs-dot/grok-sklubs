import { crc32, deflateRawSync } from "node:zlib";

/**
 * A small zip writer (APPNOTE.TXT 6.3.10: local file headers, central directory, end of central directory; method 8
 * "deflate" when it is smaller, else 0 "stored"; general purpose bit 11 for UTF-8 names), for downloads made of a few
 * text files (notesarchive.ts). No zip64: refused past 65 535 entries or 4 GB, far beyond what it is used for.
 * https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT
 */
export interface ZipFile { name: string; data: Buffer | string; mtime?: Date }

function dosTime(d: Date): { time: number; date: number } {
  const y = Math.max(1980, d.getFullYear());
  return { time: (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2), date: ((y - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate() };
}

export function writeZip(files: ZipFile[]): Buffer {
  if (files.length > 0xffff) throw new Error("Too many files for one zip.");
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name.replace(/\\/g, "/").replace(/^\/+/, ""), "utf8");
    const raw = typeof f.data === "string" ? Buffer.from(f.data, "utf8") : f.data;
    const packed = deflateRawSync(raw);
    const deflate = packed.length < raw.length;
    const body = deflate ? packed : raw;
    const crc = crc32(raw) >>> 0;
    const { time, date } = dosTime(f.mtime ?? new Date());
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(20, 4); local.writeUInt16LE(0x0800, 6); local.writeUInt16LE(deflate ? 8 : 0, 8);
    local.writeUInt16LE(time, 10); local.writeUInt16LE(date, 12); local.writeUInt32LE(crc, 14); local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(name.length, 26); local.writeUInt16LE(0, 28);
    const dir = Buffer.alloc(46);
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(deflate ? 8 : 0, 10);
    dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(body.length, 20); dir.writeUInt32LE(raw.length, 24);
    dir.writeUInt16LE(name.length, 28); dir.writeUInt16LE(0, 30); dir.writeUInt16LE(0, 32); dir.writeUInt16LE(0, 34); dir.writeUInt16LE(0, 36);
    dir.writeUInt32LE(0o100644 * 0x10000, 38); dir.writeUInt32LE(offset, 42);
    parts.push(local, name, body);
    central.push(dir, name);
    offset += local.length + name.length + body.length;
    if (offset > 0xffffffff) throw new Error("The zip would be too large.");
  }
  const cd = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...parts, cd, end]);
}
