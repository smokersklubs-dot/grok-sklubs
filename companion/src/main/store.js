// @ts-check
'use strict';
/**
 * Local settings: server address, device token, per-bot permissions, lock state.
 * Stored in the OS user config dir (Electron `app.getPath('userData')`) as relais.json,
 * written atomically with mode 0600 (directory 0700) on macOS/Linux. On Windows the file
 * lives under %APPDATA%, which is per-user. The device token is additionally encrypted
 * with Electron safeStorage when available (Keychain / DPAPI / libsecret or kwallet):
 * https://www.electronjs.org/docs/latest/api/safe-storage
 * Nothing in here can be changed by the server: only the local UI and RelayCore write it.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{ name: string, control?: 'always', commands?: boolean, firstSeen?: string }} BotPerm
 * @typedef {{ id: string, name: string, path: string, write: boolean }} SharedFolder
 * @typedef {{
 *   version: 1,
 *   server: string | null,
 *   serverName: string,
 *   deviceId: string | null,
 *   token: { scheme: 'safeStorage' | 'plain', value: string } | null,
 *   bots: Record<string, BotPerm>,
 *   autostart: boolean,
 *   locked: boolean,
 *   language: 'auto' | 'fr' | 'en',
 *   folders: SharedFolder[],
 * }} Settings
 * @typedef {{ available(): Promise<boolean>, encrypt(s: string): Promise<Buffer>, decrypt(b: Buffer): Promise<string> }} Crypto
 */

/** @returns {Settings} */
function defaults() {
  return { version: 1, server: null, serverName: '', deviceId: null, token: null, bots: {}, autostart: false, locked: false, language: 'auto', folders: [] };
}

class Store {
  /** @param {string} dir @param {Crypto | null} crypto */
  constructor(dir, crypto) {
    this.dir = dir;
    this.file = path.join(dir, 'relais.json');
    this.crypto = crypto;
    /** @type {Settings} */
    this.s = defaults();
    /** @type {string | null} decrypted token kept in memory only */
    this.tokenPlain = null;
    /** @type {Array<() => void>} */
    this.listeners = [];
  }

  async load() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    if (process.platform !== 'win32') { try { fs.chmodSync(this.dir, 0o700); } catch { /* ignore */ } }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      this.s = { ...defaults(), ...raw, bots: raw && typeof raw.bots === 'object' && raw.bots ? raw.bots : {}, folders: Array.isArray(raw && raw.folders) ? raw.folders.filter((/** @type {any} */ f) => f && typeof f.id === 'string' && typeof f.path === 'string') : [] };
    } catch {
      this.s = defaults();
    }
    this.tokenPlain = null;
    if (this.s.token) {
      try {
        if (this.s.token.scheme === 'safeStorage' && this.crypto) {
          this.tokenPlain = await this.crypto.decrypt(Buffer.from(this.s.token.value, 'base64'));
        } else if (this.s.token.scheme === 'plain') {
          this.tokenPlain = this.s.token.value;
        }
      } catch {
        this.tokenPlain = null; // unreadable (keychain changed): the user will pair again
      }
    }
    return this;
  }

  /** @param {() => void} fn */
  onChange(fn) { this.listeners.push(fn); }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    if (process.platform !== 'win32') fs.chmodSync(tmp, 0o600);
    fs.renameSync(tmp, this.file);
    for (const fn of this.listeners) { try { fn(); } catch { /* ignore */ } }
  }

  get settings() { return this.s; }

  /** @returns {{ deviceId: string, token: string } | null} */
  getAuth() {
    return this.s.deviceId && this.tokenPlain ? { deviceId: this.s.deviceId, token: this.tokenPlain } : null;
  }

  /** @param {string} server */
  setServer(server) {
    if (this.s.server !== server) {
      this.s.server = server;
      this.s.deviceId = null;
      this.s.token = null;
      this.tokenPlain = null;
      this.s.serverName = '';
    }
    this.save();
  }

  /** @param {string} deviceId @param {string} token @param {string} [serverName] */
  async setCredentials(deviceId, token, serverName) {
    this.s.deviceId = deviceId;
    if (serverName !== undefined) this.s.serverName = serverName;
    await this.setToken(token);
  }

  /** @param {string} token */
  async setToken(token) {
    this.tokenPlain = token;
    if (this.crypto && (await this.crypto.available())) {
      this.s.token = { scheme: 'safeStorage', value: (await this.crypto.encrypt(token)).toString('base64') };
    } else {
      this.s.token = { scheme: 'plain', value: token };
    }
    this.save();
  }

  clearCredentials() {
    this.s.deviceId = null;
    this.s.token = null;
    this.tokenPlain = null;
    this.save();
  }

  /** "Forget this server": credentials, server address and per-bot permissions are erased. */
  forgetServer() {
    const keep = { autostart: this.s.autostart, language: this.s.language };
    this.s = { ...defaults(), ...keep };
    this.tokenPlain = null;
    this.save();
  }

  /** @param {string} id */
  getBot(id) { return Object.prototype.hasOwnProperty.call(this.s.bots, id) ? this.s.bots[id] : undefined; }

  /** @param {{ id: string, name: string }} bot @param {'control'|'commands'} key @param {any} value */
  setBotPerm(bot, key, value) {
    const cur = this.getBot(bot.id) || { name: bot.name, firstSeen: new Date().toISOString() };
    cur.name = bot.name || cur.name;
    if (key === 'control') { if (value === 'always') cur.control = 'always'; else delete cur.control; }
    if (key === 'commands') cur.commands = value === true;
    this.s.bots[bot.id] = cur;
    this.save();
  }

  /** @param {string} id */
  removeBot(id) {
    delete this.s.bots[id];
    this.save();
  }

  /** Folders the user shared with Sklubot (protocol 1.1). Only the local UI changes this list. */
  folders() { return this.s.folders; }
  /** @param {string} dir @param {string} name */
  addFolder(dir, name) {
    const existing = this.s.folders.find((f) => f.path === dir);
    if (existing) return existing;
    let n = name || 'Dossier', i = 2;
    const taken = new Set(this.s.folders.map((f) => f.name.toLowerCase()));
    while (taken.has(n.toLowerCase())) n = `${name} ${i++}`;
    const f = { id: `f${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, name: n.slice(0, 80), path: dir, write: false };
    this.s.folders.push(f);
    this.save();
    return f;
  }
  /** @param {string} id @param {boolean} write */
  setFolderWrite(id, write) { const f = this.s.folders.find((x) => x.id === id); if (f) { f.write = write === true; this.save(); } return !!f; }
  /** @param {string} id */
  removeFolder(id) { this.s.folders = this.s.folders.filter((f) => f.id !== id); this.save(); }

  isLocked() { return this.s.locked === true; }
  /** @param {boolean} v */
  setLocked(v) { this.s.locked = v; this.save(); }
  /** @param {boolean} v */
  setAutostart(v) { this.s.autostart = v; this.save(); }
}

module.exports = { Store };
