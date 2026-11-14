// @ts-check
'use strict';
/**
 * Files in folders the user shared with Sklubot (protocol 1.1, spec 07 A15). Pure Node so it can be unit-tested; the
 * trash is injected (Electron `shell.trashItem`, https://www.electronjs.org/docs/latest/api/shell#shelltrashitempath).
 *
 * Decided here, on the user's computer, whatever the server asks:
 *  - only inside a folder the user added in this app (dialog), resolved through real paths so a link cannot lead out;
 *  - shared folders must be inside the home folder (not the home folder itself) or on an external disk, and never a
 *    system folder, an application-data folder or a backup;
 *  - hidden files and folders (a name starting with "."), and files that typically hold secrets (keys, certificates,
 *    password databases, environment files…) are neither listed, read nor written;
 *  - writing needs the folder shared "read and write"; no programs or shortcuts are created; an existing file is only
 *    replaced in "replace" mode, and its previous version goes to the trash first; nothing is ever deleted for good;
 *  - size caps: reading 256 KiB of text at most (binary files refused), writing 200 KiB, listing 500 entries.
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { ERR, LIMITS } = require('../protocol');

class FileError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

/** Files that typically hold secrets (matched on the name, case-insensitive). */
const SECRET_NAMES = [
  /^\.env(\..*)?$/, /^id_(rsa|dsa|ecdsa|ed25519)(\.pub)?$/, /\.(pem|key|p12|pfx|jks|keystore|kdbx|kdb|keychain|keychain-db|gpg|pgp|asc|ovpn|ppk|cer|crt|der)$/,
  /^credentials(\.json)?$/, /^\.?netrc$/, /^wallet\.dat$/, /^(login|logins)\.json$/, /^key4\.db$/, /^cookies(\.sqlite)?$/, /^secrets?(\..*)?$/, /^\.?npmrc$/, /^\.?pgpass$/,
];
/** Programs and shortcuts a bot may not create. */
const NO_CREATE = /\.(exe|msi|bat|cmd|com|scr|ps1|psm1|vbs|vbe|wsf|jar|apk|app|dmg|pkg|deb|rpm|sh|bash|zsh|command|lnk|url|desktop|webloc|inetloc|dll|so|dylib|reg|scpt|workflow)$/i;
/** Folders a share may never be or sit in (lower-cased path segments, after the home folder or anywhere). */
const SYSTEM_SEGMENTS = new Set(['library', 'appdata', 'application data', 'applications', 'program files', 'program files (x86)', 'programdata', 'windows', 'system', 'system32', 'backups.backupdb', 'time machine backups', '$recycle.bin', 'system volume information', 'node_modules']);
const SYSTEM_ROOTS = ['/etc', '/usr', '/bin', '/sbin', '/var', '/opt', '/boot', '/dev', '/proc', '/sys', '/root', '/private', '/system', '/library', '/applications', '/snap', '/srv', '/tmp'];
const EXTERNAL_ROOTS = ['/volumes/', '/media/', '/mnt/', '/run/media/'];

const lower = (/** @type {string} */ p) => p.replace(/\\/g, '/').toLowerCase();

/** Whether a name is hidden or looks like it holds secrets. @param {string} name */
function refusedName(name) {
  return name.startsWith('.') || SECRET_NAMES.some((r) => r.test(name.toLowerCase()));
}

/**
 * Whether a folder may be shared: inside the home folder (not the home folder itself) or on an external disk, with no
 * hidden, system or backup folder on the way. Returns null when it may, else the reason (English, for logs and UI).
 * @param {string} dir @param {{ home?: string, platform?: string }} [o]
 */
function shareProblem(dir, o = {}) {
  const home = path.resolve(o.home || os.homedir());
  const platform = o.platform || process.platform;
  let real;
  try { real = fs.realpathSync(dir); } catch { return 'folder not found'; }
  if (!fs.statSync(real).isDirectory()) return 'not a folder';
  const l = lower(real);
  const lh = lower(home);
  const inHome = l.startsWith(lh + '/') ;
  const external = platform === 'win32' ? /^[d-z]:\//.test(l) : EXTERNAL_ROOTS.some((r) => l.startsWith(r));
  if (l === lh) return 'the whole home folder cannot be shared: pick a folder inside it';
  if (!inHome && !external) return 'only folders inside your home folder or on an external disk can be shared';
  if (!inHome && SYSTEM_ROOTS.some((r) => l === r || l.startsWith(r + '/'))) return 'system folder';
  const rest = inHome ? l.slice(lh.length + 1) : l;
  for (const seg of rest.split('/').filter(Boolean)) {
    if (seg.startsWith('.')) return 'hidden folder';
    if (SYSTEM_SEGMENTS.has(seg)) return 'system, application or backup folder';
  }
  return null;
}

/**
 * @typedef {{ id: string, name: string, path: string, write: boolean }} Folder
 * @param {{ getFolders: () => Folder[], trash: (p: string) => Promise<void>, home?: string, platform?: string }} deps
 */
function createFileCaps(deps) {
  const home = path.resolve(deps.home || os.homedir());
  const opts = { home, platform: deps.platform };

  /** The shared folder a request names (by id or name), still allowed. @param {string} ref */
  function rootOf(ref) {
    const want = String(ref || '').trim().toLowerCase();
    const f = deps.getFolders().find((x) => x.id.toLowerCase() === want || x.name.toLowerCase() === want);
    if (!f) throw new FileError(ERR.FORBIDDEN, 'not a folder shared with Sklubot');
    if (shareProblem(f.path, opts)) throw new FileError(ERR.FORBIDDEN, 'this shared folder is no longer allowed');
    return { ...f, real: fs.realpathSync(f.path) };
  }

  /**
   * A path inside a shared folder: no "..", no hidden or secret-looking segment, and once resolved (links followed as
   * far as the path exists), still inside the folder.
   * @param {string} ref @param {string} rel
   */
  function resolve(ref, rel) {
    const root = rootOf(ref);
    const segs = String(rel || '').replace(/\\/g, '/').split('/').filter((s) => s !== '' && s !== '.');
    for (const s of segs) {
      if (s === '..') throw new FileError(ERR.FORBIDDEN, 'paths may not go up');
      if (refusedName(s)) throw new FileError(ERR.FORBIDDEN, 'hidden or secret file');
      if (SYSTEM_SEGMENTS.has(s.toLowerCase())) throw new FileError(ERR.FORBIDDEN, 'system or backup folder');
    }
    const full = path.join(root.real, ...segs);
    // Resolve the deepest existing part, so a link inside the folder cannot point outside it.
    let probe = full;
    const tail = [];
    while (!fs.existsSync(probe) && probe !== root.real) { tail.unshift(path.basename(probe)); probe = path.dirname(probe); }
    const real = path.join(fs.realpathSync(probe), ...tail);
    if (real !== root.real && !real.startsWith(root.real + path.sep)) throw new FileError(ERR.FORBIDDEN, 'outside the shared folder');
    return { root, full: real, segs };
  }

  const display = (/** @type {string} */ p) => (lower(p).startsWith(lower(home) + '/') ? '~' + p.slice(home.length).replace(/\\/g, '/') : p);

  return {
    async fsRoots() {
      return { roots: deps.getFolders().filter((f) => !shareProblem(f.path, opts)).map((f) => ({ id: f.id, name: f.name, path: display(f.path), write: f.write === true })) };
    },
    /** @param {{ root: string, path: string }} a */
    async fsList(a) {
      const { full } = resolve(a.root, a.path);
      let st;
      try { st = fs.statSync(full); } catch { throw new FileError(ERR.NOT_FOUND, 'no such folder'); }
      if (!st.isDirectory()) throw new FileError(ERR.NOT_FOUND, 'not a folder');
      const entries = [];
      let truncated = false;
      for (const d of fs.readdirSync(full, { withFileTypes: true })) {
        if (refusedName(d.name) || d.isSymbolicLink() || (!d.isFile() && !d.isDirectory())) continue;
        if (entries.length >= LIMITS.MAX_LIST_ENTRIES) { truncated = true; break; }
        let size = 0, modifiedAt = 0;
        try { const s = fs.statSync(path.join(full, d.name)); size = d.isFile() ? s.size : 0; modifiedAt = s.mtimeMs; } catch { continue; }
        entries.push({ name: d.name, dir: d.isDirectory(), size, modifiedAt: Math.round(modifiedAt) });
      }
      entries.sort((x, y) => (x.dir === y.dir ? x.name.localeCompare(y.name) : x.dir ? -1 : 1));
      return { entries, truncated };
    },
    /** @param {{ root: string, path: string, maxBytes: number }} a */
    async fsRead(a) {
      const { full } = resolve(a.root, a.path);
      let st;
      try { st = fs.statSync(full); } catch { throw new FileError(ERR.NOT_FOUND, 'no such file'); }
      if (!st.isFile()) throw new FileError(ERR.NOT_FOUND, 'not a file');
      const max = Math.min(a.maxBytes || LIMITS.DEFAULT_READ_BYTES, LIMITS.MAX_READ_BYTES);
      const fd = fs.openSync(full, 'r');
      try {
        const buf = Buffer.alloc(Math.min(max, st.size));
        const n = fs.readSync(fd, buf, 0, buf.length, 0);
        const head = buf.subarray(0, n);
        if (head.subarray(0, 8192).includes(0)) throw new FileError(ERR.BINARY, 'not a text file');
        return { text: head.toString('utf8'), size: st.size, truncated: st.size > n };
      } finally { fs.closeSync(fd); }
    },
    /** @param {{ root: string, path: string, text: string, mode: 'create'|'replace' }} a */
    async fsWrite(a) {
      const { root, full, segs } = resolve(a.root, a.path);
      if (!root.write) throw new FileError(ERR.READ_ONLY, 'this folder is shared for reading only');
      if (!segs.length) throw new FileError(ERR.INVALID_ARGS, 'give a file name');
      if (NO_CREATE.test(full)) throw new FileError(ERR.FORBIDDEN, 'programs and shortcuts cannot be created');
      if (Buffer.byteLength(a.text, 'utf8') > LIMITS.MAX_WRITE_BYTES) throw new FileError(ERR.TOO_LARGE, 'too large');
      let previous = null;
      if (fs.existsSync(full)) {
        if (!fs.statSync(full).isFile()) throw new FileError(ERR.EXISTS, 'a folder has that name');
        if (a.mode !== 'replace') throw new FileError(ERR.EXISTS, 'a file of that name already exists');
        // Never overwritten in place: the old version goes to the trash first.
        await deps.trash(full);
        previous = 'trashed';
      }
      fs.mkdirSync(path.dirname(full), { recursive: true });
      const tmp = path.join(path.dirname(full), `.sklubot-${process.pid}-${Date.now()}.tmp`);
      fs.writeFileSync(tmp, a.text, { mode: 0o644, flag: 'wx' });
      fs.renameSync(tmp, full);
      return { written: Buffer.byteLength(a.text, 'utf8'), previous };
    },
    /** @param {{ root: string, path: string }} a */
    async fsTrash(a) {
      const { root, full, segs } = resolve(a.root, a.path);
      if (!root.write) throw new FileError(ERR.READ_ONLY, 'this folder is shared for reading only');
      if (!segs.length) throw new FileError(ERR.FORBIDDEN, 'a shared folder itself cannot be trashed');
      if (!fs.existsSync(full)) throw new FileError(ERR.NOT_FOUND, 'no such file');
      await deps.trash(full);
      return { trashed: true };
    },
  };
}

module.exports = { createFileCaps, shareProblem, refusedName, FileError };
