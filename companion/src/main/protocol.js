// @ts-check
'use strict';
/**
 * Sklubot Relais — protocol constants and validation helpers.
 * Pure Node module (no Electron) so it can be unit-tested and reused by the fake server.
 * The normative description lives in docs/RELAIS-PROTOCOLE.md.
 */

const PROTOCOL_VERSION = 1;
const CONNECT_PATH = '/api/relay/connect';

/** Size limits (bytes). Server → client messages above MAX_INBOUND are rejected by `ws` (close 1009). */
const LIMITS = Object.freeze({
  MAX_INBOUND_BYTES: 256 * 1024,
  MAX_OUTBOUND_BYTES: 4 * 1024 * 1024,
  MAX_TYPE_TEXT: 2000,
  MAX_COMMAND_BYTES: 8 * 1024,
  DEFAULT_OUTPUT_BYTES: 64 * 1024,
  MAX_OUTPUT_BYTES: 1024 * 1024,
  DEFAULT_TIMEOUT_MS: 30_000,
  MAX_TIMEOUT_MS: 10 * 60_000,
  MAX_BOT_NAME: 60,
  MAX_ID: 64,
  MAX_CAPTURE_WIDTH: 2560,
  MAX_VIEW_FPS: 5,
  MAX_VIEW_WIDTH: 1600,
});

/** WebSocket close codes used by the protocol (4000–4999 is the application range, RFC 6455 §7.4.2). */
const CLOSE = Object.freeze({
  NORMAL: 1000,
  UNAUTHORIZED: 4001,
  REVOKED: 4003,
  PAIRING_EXPIRED: 4004,
  TOO_MANY_MESSAGES: 4008,
  VERSION_UNSUPPORTED: 4009,
  REPLACED: 4010,
  PROTOCOL_ERROR: 4400,
});

/** Operations a bot can request. `session: false` means no active control session is needed. */
const OPS = Object.freeze({
  'session.start': { session: false, input: false },
  'session.end': { session: false, input: false },
  'screen.info': { session: false, input: false },
  'screen.capture': { session: true, input: false },
  'view.start': { session: true, input: false },
  'view.stop': { session: false, input: false },
  'mouse.move': { session: true, input: true },
  'mouse.click': { session: true, input: true },
  'mouse.drag': { session: true, input: true },
  'mouse.scroll': { session: true, input: true },
  'keyboard.type': { session: true, input: true },
  'keyboard.press': { session: true, input: true },
  'app.open': { session: true, input: true },
  'url.open': { session: true, input: true },
  'window.list': { session: true, input: false },
  'window.focus': { session: true, input: true },
  'shell.run': { session: true, input: true },
});

const ERR = Object.freeze({
  INVALID_ARGS: 'invalid_args',
  UNKNOWN_OP: 'unknown_op',
  UNSUPPORTED: 'unsupported',
  NO_SESSION: 'no_session',
  BUSY: 'busy',
  LOCKED: 'locked',
  CONSENT_REFUSED: 'consent_refused',
  CONSENT_EXPIRED: 'consent_expired',
  CONSENT_PENDING: 'consent_pending',
  CONSENT_COOLDOWN: 'consent_cooldown',
  COMMAND_REFUSED: 'command_refused',
  RATE_LIMITED: 'rate_limited',
  TOO_LARGE: 'too_large',
  INTERNAL: 'internal',
  CANCELLED: 'cancelled',
  PERMISSION_MISSING: 'permission_missing',
});

/** Keys accepted by keyboard.press (names follow @jitsi/robotjs' key table, src/robotjs.cc). */
const NAMED_KEYS = new Set([
  'backspace', 'delete', 'enter', 'tab', 'escape', 'up', 'down', 'right', 'left', 'home', 'end',
  'pageup', 'pagedown', 'space', 'insert', 'menu', 'printscreen', 'capslock',
  'f1', 'f2', 'f3', 'f4', 'f5', 'f6', 'f7', 'f8', 'f9', 'f10', 'f11', 'f12',
  'audio_mute', 'audio_vol_down', 'audio_vol_up', 'audio_play', 'audio_pause', 'audio_next', 'audio_prev',
]);
const MODIFIERS = new Set(['control', 'shift', 'alt', 'command']);
const MODIFIER_ALIASES = { ctrl: 'control', cmd: 'command', meta: 'command', super: 'command', win: 'command', option: 'alt' };
const KEY_ALIASES = { esc: 'escape', return: 'enter', del: 'delete', pgup: 'pageup', pgdn: 'pagedown', arrowup: 'up', arrowdown: 'down', arrowleft: 'left', arrowright: 'right' };

class ProtocolError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/** @param {unknown} v */
function isObj(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/**
 * Convert the user-entered server address into the WebSocket URL.
 * Only https (→ wss) is accepted, except for loopback addresses (dev and tests).
 * @param {string} input
 * @returns {{ base: string, wsUrl: string }}
 */
function normalizeServer(input) {
  let raw = String(input || '').trim();
  if (!raw) throw new ProtocolError('invalid_server', 'empty');
  if (!/^[a-z]+:\/\//i.test(raw)) raw = 'https://' + raw;
  const u = new URL(raw);
  const loopback = ['localhost', '127.0.0.1', '[::1]', '::1'].includes(u.hostname);
  if (u.protocol === 'http:' && !loopback) throw new ProtocolError('insecure_server', 'https required');
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new ProtocolError('invalid_server', 'bad scheme');
  if (u.username || u.password) throw new ProtocolError('invalid_server', 'credentials in URL');
  const path = u.pathname.replace(/\/+$/, '');
  const base = `${u.protocol}//${u.host}${path}`;
  const wsUrl = `${u.protocol === 'https:' ? 'wss' : 'ws'}://${u.host}${path}${CONNECT_PATH}`;
  return { base, wsUrl };
}

/** @param {unknown} v @param {string} name */
function num(v, name, { min = -1e6, max = 1e6, int = true } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new ProtocolError(ERR.INVALID_ARGS, `${name} must be a number`);
  if (v < min || v > max) throw new ProtocolError(ERR.INVALID_ARGS, `${name} out of range`);
  return int ? Math.round(v) : v;
}

/** @param {unknown} v @param {string} name @param {number} maxLen */
function str(v, name, maxLen) {
  if (typeof v !== 'string') throw new ProtocolError(ERR.INVALID_ARGS, `${name} must be a string`);
  if (Buffer.byteLength(v, 'utf8') > maxLen) throw new ProtocolError(ERR.TOO_LARGE, `${name} too long`);
  return v;
}

/** @param {unknown} v @param {number} def @param {number} min @param {number} max */
function optNum(v, def, min, max) {
  if (v === undefined || v === null) return def;
  return num(v, 'value', { min, max });
}

/**
 * Normalise a key or a combo such as "ctrl+shift+t".
 * @param {unknown} key @param {unknown} modifiers
 * @returns {{ key: string, modifiers: string[] }}
 */
function parseKey(key, modifiers) {
  let k = str(key, 'key', 64).trim();
  /** @type {string[]} */
  let mods = [];
  if (modifiers !== undefined) {
    if (!Array.isArray(modifiers) || modifiers.length > 4) throw new ProtocolError(ERR.INVALID_ARGS, 'modifiers must be an array');
    mods = modifiers.map((m) => str(m, 'modifier', 16));
  }
  if (k.length > 1 && k.includes('+')) {
    const parts = k.split('+').map((p) => p.trim()).filter(Boolean);
    k = parts.pop() || '';
    mods = mods.concat(parts);
  }
  mods = [...new Set(mods.map((m) => {
    const low = m.toLowerCase();
    const n = /** @type {Record<string,string>} */ (MODIFIER_ALIASES)[low] || low;
    if (!MODIFIERS.has(n)) throw new ProtocolError(ERR.INVALID_ARGS, `unknown modifier ${m}`);
    return n;
  }))];
  if ([...k].length === 1) return { key: k.length === 1 && /[A-Z]/.test(k) && mods.length ? k.toLowerCase() : k, modifiers: mods };
  const low = k.toLowerCase();
  const name = /** @type {Record<string,string>} */ (KEY_ALIASES)[low] || low;
  if (!NAMED_KEYS.has(name)) throw new ProtocolError(ERR.INVALID_ARGS, `unknown key ${k}`);
  return { key: name, modifiers: mods };
}

const BUTTONS = new Set(['left', 'right', 'middle']);

/**
 * Validate and normalise the arguments of an operation. Throws ProtocolError.
 * @param {string} op @param {unknown} rawArgs
 * @returns {Record<string, any>}
 */
function validateArgs(op, rawArgs) {
  const a = rawArgs === undefined ? {} : rawArgs;
  if (!isObj(a)) throw new ProtocolError(ERR.INVALID_ARGS, 'args must be an object');
  const args = /** @type {Record<string, any>} */ (a);
  const btn = (/** @type {unknown} */ b) => {
    const v = b === undefined ? 'left' : str(b, 'button', 8);
    if (!BUTTONS.has(v)) throw new ProtocolError(ERR.INVALID_ARGS, 'button must be left, right or middle');
    return v;
  };
  const coord = (/** @type {unknown} */ v, /** @type {string} */ n) => num(v, n, { min: -100000, max: 100000 });
  switch (op) {
    case 'session.start':
      return { reason: args.reason === undefined ? '' : str(args.reason, 'reason', 300) };
    case 'session.end':
    case 'screen.info':
    case 'window.list':
      return {};
    case 'screen.capture': {
      const format = args.format === undefined ? 'jpeg' : str(args.format, 'format', 8);
      if (format !== 'jpeg' && format !== 'png') throw new ProtocolError(ERR.INVALID_ARGS, 'format must be jpeg or png');
      return {
        format,
        maxWidth: optNum(args.maxWidth, 1280, 64, LIMITS.MAX_CAPTURE_WIDTH),
        quality: optNum(args.quality, 70, 10, 95),
      };
    }
    case 'view.start':
      return {
        maxFps: optNum(args.maxFps, 3, 1, LIMITS.MAX_VIEW_FPS),
        maxWidth: optNum(args.maxWidth, 1280, 64, LIMITS.MAX_VIEW_WIDTH),
        quality: optNum(args.quality, 60, 10, 90),
      };
    case 'view.stop':
      return { viewId: args.viewId === undefined ? null : str(args.viewId, 'viewId', LIMITS.MAX_ID) };
    case 'mouse.move':
      return { x: coord(args.x, 'x'), y: coord(args.y, 'y') };
    case 'mouse.click': {
      const hasXY = args.x !== undefined || args.y !== undefined;
      return {
        x: hasXY ? coord(args.x, 'x') : null,
        y: hasXY ? coord(args.y, 'y') : null,
        button: btn(args.button),
        double: args.double === true,
      };
    }
    case 'mouse.drag':
      return {
        fromX: coord(args.fromX, 'fromX'), fromY: coord(args.fromY, 'fromY'),
        toX: coord(args.toX, 'toX'), toY: coord(args.toY, 'toY'),
        button: btn(args.button),
      };
    case 'mouse.scroll': {
      const hasXY = args.x !== undefined || args.y !== undefined;
      return {
        x: hasXY ? coord(args.x, 'x') : null,
        y: hasXY ? coord(args.y, 'y') : null,
        dx: optNum(args.dx, 0, -100, 100),
        dy: optNum(args.dy, 0, -100, 100),
      };
    }
    case 'keyboard.type':
      return { text: str(args.text, 'text', LIMITS.MAX_TYPE_TEXT * 4).slice(0, LIMITS.MAX_TYPE_TEXT) };
    case 'keyboard.press':
      return parseKey(args.key, args.modifiers);
    case 'url.open': {
      const s = str(args.url, 'url', 4096);
      let u;
      try { u = new URL(s); } catch { throw new ProtocolError(ERR.INVALID_ARGS, 'invalid url'); }
      if (!['http:', 'https:', 'mailto:'].includes(u.protocol)) throw new ProtocolError(ERR.INVALID_ARGS, 'only http, https and mailto');
      return { url: u.toString() };
    }
    case 'app.open': {
      const name = str(args.name, 'name', 100).trim();
      // A plain application name: no path separators, no shell metacharacters.
      if (!/^[\p{L}\p{N} ._+-]{1,100}$/u.test(name) || name.startsWith('-')) throw new ProtocolError(ERR.INVALID_ARGS, 'invalid application name');
      return { name };
    }
    case 'window.focus': {
      const title = str(args.title, 'title', 200);
      if (!title.trim()) throw new ProtocolError(ERR.INVALID_ARGS, 'title required');
      return { title };
    }
    case 'shell.run': {
      const command = str(args.command, 'command', LIMITS.MAX_COMMAND_BYTES);
      if (!command.trim()) throw new ProtocolError(ERR.INVALID_ARGS, 'command required');
      return {
        command,
        timeoutMs: optNum(args.timeoutMs, LIMITS.DEFAULT_TIMEOUT_MS, 100, LIMITS.MAX_TIMEOUT_MS),
        maxOutputBytes: optNum(args.maxOutputBytes, LIMITS.DEFAULT_OUTPUT_BYTES, 256, LIMITS.MAX_OUTPUT_BYTES),
        cwd: args.cwd === undefined ? null : str(args.cwd, 'cwd', 1024),
      };
    }
    default:
      throw new ProtocolError(ERR.UNKNOWN_OP, `unknown op ${op}`);
  }
}

/**
 * Validate a bot descriptor sent by the server.
 * @param {unknown} bot
 * @returns {{ id: string, name: string }}
 */
function parseBot(bot) {
  if (!isObj(bot)) throw new ProtocolError(ERR.INVALID_ARGS, 'bot required');
  const b = /** @type {Record<string, unknown>} */ (bot);
  const id = str(b.id, 'bot.id', LIMITS.MAX_ID);
  if (!/^[A-Za-z0-9_.:-]{1,64}$/.test(id)) throw new ProtocolError(ERR.INVALID_ARGS, 'invalid bot.id');
  // Display name: strip control / bidi-override characters so a name cannot disguise itself.
  const rawName = typeof b.name === 'string' ? b.name : id;
  const name = rawName.replace(/[\u0000-\u001f\u007f‪-‮⁦-⁩​-‏]/g, '').trim().slice(0, LIMITS.MAX_BOT_NAME) || id;
  return { id, name };
}

module.exports = {
  PROTOCOL_VERSION, CONNECT_PATH, LIMITS, CLOSE, OPS, ERR, ProtocolError,
  normalizeServer, validateArgs, parseBot, parseKey, isObj,
};
