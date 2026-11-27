// @ts-check
'use strict';
/** Arguments of the android.* operations (protocol 1.9, docs/RELAIS-PROTOCOLE.md §20). Throws an Error with `code`. */
const { SERIAL_RE, PACKAGE_RE, KEYCODES, MAX_TEXT } = require('./adb');

/** @param {string} m @param {string} [code] */
const bad = (m, code = 'invalid_args') => Object.assign(new Error(m), { code });
const isObj = (/** @type {unknown} */ v) => !!v && typeof v === 'object' && !Array.isArray(v);
/** Screen pixels of the phone (as in its screenshot). @param {unknown} v @param {string} name */
function px(v, name) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 0 || v > 20_000) throw bad(`${name} must be a number of pixels on the phone's screen`);
  return Math.round(v);
}
/** @param {unknown} v */
function serial(v) {
  if (typeof v !== 'string' || !SERIAL_RE.test(v)) throw bad('serial must be the phone serial given by android.devices');
  return v;
}

/** @param {string} op @param {unknown} raw */
function validateAndroidArgs(op, raw) {
  const a = /** @type {Record<string, any>} */ (isObj(raw) ? raw : raw === undefined ? {} : (() => { throw bad('args must be an object'); })());
  switch (op) {
    case 'android.devices': return {};
    case 'android.release': return a.serial === undefined ? {} : { serial: serial(a.serial) };
    case 'android.screenshot': {
      const maxWidth = a.maxWidth === undefined ? 1080 : a.maxWidth;
      if (typeof maxWidth !== 'number' || maxWidth < 64 || maxWidth > 2560) throw bad('maxWidth must be 64 to 2560');
      return { serial: serial(a.serial), maxWidth: Math.round(maxWidth) };
    }
    case 'android.ui': {
      const maxNodes = a.maxNodes === undefined ? 200 : a.maxNodes;
      if (typeof maxNodes !== 'number' || maxNodes < 1 || maxNodes > 400) throw bad('maxNodes must be 1 to 400');
      return { serial: serial(a.serial), maxNodes: Math.round(maxNodes) };
    }
    case 'android.tap': return { serial: serial(a.serial), x: px(a.x, 'x'), y: px(a.y, 'y'), long: a.long === true };
    case 'android.swipe': {
      const d = a.durationMs === undefined ? 300 : a.durationMs;
      if (typeof d !== 'number' || d < 50 || d > 3000) throw bad('durationMs must be 50 to 3000');
      return { serial: serial(a.serial), fromX: px(a.fromX, 'fromX'), fromY: px(a.fromY, 'fromY'), toX: px(a.toX, 'toX'), toY: px(a.toY, 'toY'), durationMs: Math.round(d) };
    }
    case 'android.type': {
      if (typeof a.text !== 'string' || !a.text) throw bad('text required');
      if (a.text.length > MAX_TEXT) throw bad(`text: ${MAX_TEXT} characters at most`, 'too_large');
      return { serial: serial(a.serial), text: a.text, force: a.force === true };
    }
    case 'android.key': {
      if (typeof a.key !== 'string' || !Object.prototype.hasOwnProperty.call(KEYCODES, a.key)) throw bad(`key must be one of ${Object.keys(KEYCODES).join(', ')}`);
      return { serial: serial(a.serial), key: a.key };
    }
    case 'android.open': {
      if (typeof a.package !== 'string' || a.package.length > 150 || !PACKAGE_RE.test(a.package)) throw bad('package must be an Android package name such as com.example.app');
      return { serial: serial(a.serial), package: a.package };
    }
    default: throw bad(`unknown op ${op}`, 'unknown_op');
  }
}

module.exports = { validateAndroidArgs };
