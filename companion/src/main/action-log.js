// @ts-check
'use strict';
/**
 * Local action log: one JSON line per action, in <userData>/logs/actions.log.
 * Rotated at 5 MB (one previous file kept as actions.1.log). Never contains image data or tokens.
 */
const fs = require('node:fs');
const path = require('node:path');

const MAX_BYTES = 5 * 1024 * 1024;

class ActionLog {
  /** @param {string} dir */
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, 'actions.log');
    fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  }

  /** @param {Record<string, any>} entry */
  write(entry) {
    const line = JSON.stringify({ ts: new Date().toISOString(), ...entry }) + '\n';
    try {
      try {
        if (fs.statSync(this.file).size + line.length > MAX_BYTES) fs.renameSync(this.file, path.join(this.dir, 'actions.1.log'));
      } catch { /* no file yet */ }
      fs.appendFileSync(this.file, line, { mode: 0o600 });
    } catch { /* logging must never break the relay */ }
  }
}

module.exports = { ActionLog };
