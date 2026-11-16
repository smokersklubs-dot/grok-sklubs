// @ts-check
'use strict';
/**
 * Settings of the Sklubot window (separate from the relay's relais.json, which this file never touches):
 * the server address shown in the window, the window's size and position, and the last update check.
 * Stored next to relais.json (Electron `app.getPath('userData')`) as sklubot.json, written atomically, mode 0600.
 */
const fs = require('node:fs');
const path = require('node:path');

/**
 * @typedef {{ x: number, y: number, width: number, height: number }} Rect
 * @typedef {{ version: 1, server: string | null, bounds: Rect | null, maximized: boolean, updateNotified: string }} AppPrefs
 */

/** @returns {AppPrefs} */
const defaults = () => ({ version: 1, server: null, bounds: null, maximized: false, updateNotified: '' });

class AppSettings {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'sklubot.json');
    /** @type {AppPrefs} */
    this.s = defaults();
  }

  load() {
    fs.mkdirSync(this.dir, { recursive: true, mode: 0o700 });
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      const d = defaults();
      this.s = {
        ...d,
        server: typeof raw.server === 'string' ? raw.server : null,
        bounds: raw.bounds && typeof raw.bounds === 'object' ? raw.bounds : null,
        maximized: raw.maximized === true,
        updateNotified: typeof raw.updateNotified === 'string' ? raw.updateNotified : '',
      };
    } catch {
      this.s = defaults();
    }
    return this;
  }

  save() {
    const tmp = `${this.file}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.s, null, 2), { mode: 0o600 });
    fs.renameSync(tmp, this.file);
  }

  get server() { return this.s.server; }
  /** @param {string | null} origin */
  setServer(origin) { this.s.server = origin; this.save(); }
  /** @param {Rect} bounds @param {boolean} maximized */
  setBounds(bounds, maximized) { this.s.bounds = bounds; this.s.maximized = maximized; this.save(); }
  /** @param {string} v */
  setUpdateNotified(v) { this.s.updateNotified = v; this.save(); }
}

module.exports = { AppSettings };
