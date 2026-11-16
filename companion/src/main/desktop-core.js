// @ts-check
'use strict';
/**
 * Sklubot desktop app — pure helpers (no Electron import, unit-tested in test/unit/desktop-core.test.js):
 * server address validation, which URLs may load in the app window, which links may open in the system browser,
 * which permission requests are granted, version comparison for the "update available" check, and the
 * one-time migration of the old "Sklubot Relais" settings folder.
 */
const fs = require('node:fs');
const path = require('node:path');

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

class ServerAddressError extends Error {
  /** @param {'invalid'|'insecure'} code */
  constructor(code) { super(code); this.code = code; }
}

/**
 * The address of the user's Sklubot server, as typed on the first-launch screen.
 * https is required, except for a server on this computer (localhost / 127.0.0.1 / ::1), like the relay.
 * @param {string} input
 * @returns {{ origin: string, url: string }}
 */
function normalizeAppServer(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new ServerAddressError('invalid');
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) raw = 'https://' + raw;
  let u;
  try { u = new URL(raw); } catch { throw new ServerAddressError('invalid'); }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') throw new ServerAddressError('invalid');
  if (u.username || u.password) throw new ServerAddressError('invalid');
  if (!u.hostname) throw new ServerAddressError('invalid');
  if (u.protocol === 'http:' && !LOOPBACK.has(u.hostname)) throw new ServerAddressError('insecure');
  // The web app lives at the root of its origin (the server serves it at "/"), so only the origin is kept.
  return { origin: u.origin, url: `${u.origin}/` };
}

/** @param {string} url @returns {string | null} */
function originOf(url) {
  try {
    const u = new URL(url);
    return u.origin === 'null' ? null : u.origin;
  } catch {
    return null;
  }
}

/** True when `url` belongs to the configured server origin (scheme + host + port all equal). @param {string} url @param {string | null} origin */
function sameOrigin(url, origin) {
  return !!origin && originOf(url) === origin;
}

/**
 * Links that may be handed to the system browser (shell.openExternal). Only web pages and e-mail links:
 * never file:, javascript:, custom app schemes or anything with credentials in it.
 * @param {string} url
 */
function externalAllowed(url) {
  let u;
  try { u = new URL(url); } catch { return false; }
  if (u.protocol === 'mailto:') return url.length <= 2048;
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  return url.length <= 8192;
}

/**
 * Permissions the Sklubot web app may get, and only for the server origin:
 * microphone (voice and calls — audio only, never the camera), notifications, clipboard, and full screen (videos).
 * Permission names from https://www.electronjs.org/docs/latest/api/session#sessetpermissionrequesthandlerhandler
 */
const GRANTED = new Set(['media', 'notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']);

/**
 * @param {string} permission
 * @param {string | undefined | null} requestingUrl the requesting frame's URL (or origin)
 * @param {string | null} origin the configured server origin
 * @param {{ mediaTypes?: string[], mediaType?: string }} [details]
 */
function permissionAllowed(permission, requestingUrl, origin, details = {}) {
  if (!origin || !GRANTED.has(permission)) return false;
  if (!requestingUrl || originOf(requestingUrl) !== origin) return false;
  if (permission === 'media') {
    if (Array.isArray(details.mediaTypes)) return details.mediaTypes.length > 0 && details.mediaTypes.every((m) => m === 'audio');
    if (details.mediaType) return details.mediaType === 'audio';
  }
  return true;
}

/** "1.2.3" → [1,2,3]; anything after a "-" (pre-release) makes it lower than the plain version. @param {string} v */
function parseVersion(v) {
  const m = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/.exec(String(v || '').trim());
  if (!m) return null;
  return { nums: [Number(m[1]), Number(m[2]), Number(m[3])], pre: m[4] || '' };
}

/** @param {string} a @param {string} b @returns {number} >0 when a is newer than b */
function compareVersions(a, b) {
  const x = parseVersion(a);
  const y = parseVersion(b);
  if (!x || !y) return 0;
  for (let i = 0; i < 3; i++) if (x.nums[i] !== y.nums[i]) return x.nums[i] - y.nums[i];
  if (x.pre === y.pre) return 0;
  if (!x.pre) return 1;
  if (!y.pre) return -1;
  return x.pre < y.pre ? -1 : 1;
}

/**
 * The newest published desktop release in a GitHub "List releases" answer
 * (https://docs.github.com/en/rest/releases/releases#list-releases): tags `desktop-vX.Y.Z`, no drafts, no pre-releases.
 * @param {any} releases
 * @param {string} [prefix]
 * @returns {{ version: string, url: string } | null}
 */
function latestDesktopRelease(releases, prefix = 'desktop-v') {
  if (!Array.isArray(releases)) return null;
  let best = null;
  for (const r of releases) {
    if (!r || r.draft || r.prerelease || typeof r.tag_name !== 'string' || !r.tag_name.startsWith(prefix)) continue;
    const version = r.tag_name.slice(prefix.length);
    if (!parseVersion(version)) continue;
    if (!best || compareVersions(version, best.version) > 0) best = { version, url: typeof r.html_url === 'string' && /^https:\/\/github\.com\//.test(r.html_url) ? r.html_url : '' };
  }
  return best;
}

/** Badge count from the web app: a whole number between 0 and 9999, anything else is ignored. @param {unknown} n */
function badgeCount(n) {
  if (typeof n !== 'number' || !Number.isFinite(n)) return null;
  return Math.max(0, Math.min(9999, Math.floor(n)));
}

/**
 * The app used to be called "Sklubot Relais", so its settings lived in "<appData>/Sklubot Relais". On the first
 * launch of "Sklubot", the relay settings (server, shared folders, bots' permissions, encrypted token) and the
 * action log are copied over once. The old folder is left untouched.
 * @param {string} oldDir
 * @param {string} newDir
 * @returns {boolean} true when something was copied
 */
function migrateRelaisDir(oldDir, newDir) {
  const oldFile = path.join(oldDir, 'relais.json');
  const newFile = path.join(newDir, 'relais.json');
  if (path.resolve(oldDir) === path.resolve(newDir)) return false;
  if (fs.existsSync(newFile) || !fs.existsSync(oldFile)) return false;
  fs.mkdirSync(newDir, { recursive: true, mode: 0o700 });
  fs.copyFileSync(oldFile, newFile);
  if (process.platform !== 'win32') { try { fs.chmodSync(newFile, 0o600); } catch { /* ignore */ } }
  const oldLogs = path.join(oldDir, 'logs');
  if (fs.existsSync(oldLogs)) {
    try { fs.cpSync(oldLogs, path.join(newDir, 'logs'), { recursive: true, errorOnExist: false, force: false }); } catch { /* the log is a convenience */ }
  }
  fs.writeFileSync(path.join(newDir, 'migrated-from-relais.txt'), `Copied from ${oldDir} on ${new Date().toISOString()}\n`);
  return true;
}

/**
 * Keeps a saved window rectangle only if it is still mostly on one of the screens (a monitor may have been unplugged).
 * @param {{ x: number, y: number, width: number, height: number } | null | undefined} b
 * @param {Array<{ x: number, y: number, width: number, height: number }>} workAreas
 */
function visibleBounds(b, workAreas) {
  if (!b || ![b.x, b.y, b.width, b.height].every((v) => typeof v === 'number' && Number.isFinite(v))) return null;
  if (b.width < 400 || b.height < 300) return null;
  for (const a of workAreas) {
    const w = Math.min(b.x + b.width, a.x + a.width) - Math.max(b.x, a.x);
    const h = Math.min(b.y + b.height, a.y + a.height) - Math.max(b.y, a.y);
    if (w >= Math.min(200, b.width) && h >= Math.min(120, b.height)) return { x: Math.round(b.x), y: Math.round(b.y), width: Math.round(b.width), height: Math.round(b.height) };
  }
  return null;
}

module.exports = { normalizeAppServer, ServerAddressError, originOf, sameOrigin, externalAllowed, permissionAllowed, GRANTED, compareVersions, latestDesktopRelease, badgeCount, migrateRelaisDir, visibleBounds };
