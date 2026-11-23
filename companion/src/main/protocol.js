// @ts-check
'use strict';
/**
 * Sklubot Relais — protocol constants and validation helpers.
 * Pure Node module (no Electron) so it can be unit-tested and reused by the fake server.
 * The normative description lives in docs/RELAIS-PROTOCOLE.md.
 */

const PROTOCOL_VERSION = 1;
/**
 * Minor revision, sent as hello.protocol (informational). 1.1 adds the fs.* operations (files in folders the user
 * shared on this computer); a 1.0 server ignores the new capabilities, a 1.1 server only uses them when listed.
 * 1.3 adds the safety rules (§14): window.active, script.peek, guard.set, `expect` on input, `force` on
 * keyboard.press, `scripts` on shell.run, and the refusal codes blocked_app, keep_out, password_field… (guard.js).
 * 1.4: commands on by default (owner switch), project folders, shell.start/read/stop (background), output streamed as
 * `shell.output` events, vault.type (a saved login typed by the relay after its own checks).
 * 1.5 (L164): ax.tree / ax.act — the accessibility tree of an app and actions by reference (macOS, Windows only).
 */
const PROTOCOL_REVISION = '1.5';
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
  MAX_TIMEOUT_MS: 60 * 60_000,
  MAX_BOT_NAME: 60,
  MAX_ID: 64,
  MAX_CAPTURE_WIDTH: 2560,
  MAX_VIEW_FPS: 5,
  MAX_VIEW_WIDTH: 1600,
  // Files (1.1). Reads come back in a relay → server message (4 MiB), writes arrive in a server → relay one (256 KiB).
  DEFAULT_READ_BYTES: 64 * 1024,
  MAX_READ_BYTES: 256 * 1024,
  MAX_WRITE_BYTES: 200 * 1024,
  MAX_LIST_ENTRIES: 500,
  MAX_PATH: 1024,
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
  // Files (1.1): only inside folders the user shared in this app; no control session (no mouse, no keyboard).
  'fs.roots': { session: false, input: false },
  'fs.list': { session: false, input: false },
  'fs.read': { session: false, input: false },
  'fs.write': { session: false, input: true },
  'fs.trash': { session: false, input: true },
  // Safety rules (1.3): the window in front, a script shown on the command card, the owner's rules from Sklubot.
  'window.active': { session: true, input: false },
  'script.peek': { session: true, input: false },
  'guard.set': { session: false, input: false },
  // Commands in the background (dev servers…), and a saved login typed by the relay itself (vault fill, guard.js).
  'shell.start': { session: true, input: true },
  'shell.read': { session: true, input: false },
  'shell.stop': { session: true, input: false },
  'vault.type': { session: true, input: true },
  // Accessibility tree (1.5, L164): read an app's controls, act on one by reference (capabilities/accessibility.js).
  'ax.tree': { session: true, input: false },
  'ax.act': { session: true, input: true },
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
  // Files (1.1).
  FORBIDDEN: 'forbidden',
  READ_ONLY: 'read_only',
  NOT_FOUND: 'not_found',
  EXISTS: 'exists',
  BINARY: 'binary',
  // Safety rules (1.3).
  BLOCKED_APP: 'blocked_app',
  KEEP_OUT: 'keep_out',
  PASSWORD_FIELD: 'password_field',
  WINDOW_CHANGED: 'window_changed',
  FOREGROUND_UNKNOWN: 'foreground_unknown',
  BLOCKED_SHORTCUT: 'blocked_shortcut',
  SCRIPT_CHANGED: 'script_changed',
  SCRIPT_UNREADABLE: 'script_unreadable',
  TERMINAL_OFF: 'terminal_off',
  HOST_MISMATCH: 'host_mismatch',
  HOST_UNKNOWN: 'host_unknown',
  APP_MISMATCH: 'app_mismatch',
  NOT_PASSWORD_FIELD: 'not_password_field',
  // Accessibility (1.5).
  STALE_REF: 'stale_ref',
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
 * `expect` on an input operation (1.3): the window the server saw in front; the relay refuses if another one is in
 * front right before it acts. Absent: the relay still applies its own rules.
 * @param {unknown} v
 */
function parseExpect(v) {
  if (v === undefined || v === null) return null;
  if (!isObj(v)) throw new ProtocolError(ERR.INVALID_ARGS, 'expect must be an object');
  const e = /** @type {Record<string, unknown>} */ (v);
  return {
    app: str(e.app, 'expect.app', 200),
    pid: e.pid === undefined || e.pid === null ? null : num(e.pid, 'expect.pid', { min: 0, max: 2 ** 31 }),
    windowId: e.windowId === undefined || e.windowId === null ? null : str(e.windowId, 'expect.windowId', 64),
  };
}

/** @param {unknown} v @param {string} name */
function parseStrList(v, name) {
  if (v === undefined) return [];
  if (!Array.isArray(v) || v.length > 50) throw new ProtocolError(ERR.INVALID_ARGS, `${name} must be a list of 50 at most`);
  return v.map((x) => str(x, name, 200));
}

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
      return { x: coord(args.x, 'x'), y: coord(args.y, 'y'), expect: parseExpect(args.expect) };
    case 'mouse.click': {
      const hasXY = args.x !== undefined || args.y !== undefined;
      return {
        x: hasXY ? coord(args.x, 'x') : null,
        y: hasXY ? coord(args.y, 'y') : null,
        button: btn(args.button),
        double: args.double === true,
        expect: parseExpect(args.expect),
      };
    }
    case 'mouse.drag':
      return {
        fromX: coord(args.fromX, 'fromX'), fromY: coord(args.fromY, 'fromY'),
        toX: coord(args.toX, 'toX'), toY: coord(args.toY, 'toY'),
        button: btn(args.button),
        expect: parseExpect(args.expect),
      };
    case 'mouse.scroll': {
      const hasXY = args.x !== undefined || args.y !== undefined;
      return {
        x: hasXY ? coord(args.x, 'x') : null,
        y: hasXY ? coord(args.y, 'y') : null,
        dx: optNum(args.dx, 0, -100, 100),
        dy: optNum(args.dy, 0, -100, 100),
        expect: parseExpect(args.expect),
      };
    }
    case 'keyboard.type':
      return { text: str(args.text, 'text', LIMITS.MAX_TYPE_TEXT * 4).slice(0, LIMITS.MAX_TYPE_TEXT), expect: parseExpect(args.expect) };
    case 'keyboard.press':
      return { ...parseKey(args.key, args.modifiers), force: args.force === true, expect: parseExpect(args.expect) };
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
    case 'shell.run':
    case 'shell.start': {
      const command = str(args.command, 'command', LIMITS.MAX_COMMAND_BYTES);
      if (!command.trim()) throw new ProtocolError(ERR.INVALID_ARGS, 'command required');
      return {
        command,
        timeoutMs: optNum(args.timeoutMs, LIMITS.DEFAULT_TIMEOUT_MS, 100, LIMITS.MAX_TIMEOUT_MS),
        maxOutputBytes: optNum(args.maxOutputBytes, LIMITS.DEFAULT_OUTPUT_BYTES, 256, LIMITS.MAX_OUTPUT_BYTES),
        cwd: args.cwd === undefined ? null : str(args.cwd, 'cwd', 1024),
        scripts: parseScripts(args.scripts),
        streamRef: args.streamRef === undefined || args.streamRef === null ? null : str(args.streamRef, 'streamRef', LIMITS.MAX_ID),
      };
    }
    case 'shell.read':
    case 'shell.stop':
      return { jobId: str(args.jobId, 'jobId', LIMITS.MAX_ID) };
    case 'vault.type': {
      const field = str(args.field, 'field', 10);
      if (!['username', 'password', 'code'].includes(field)) throw new ProtocolError(ERR.INVALID_ARGS, 'field must be username, password or code');
      const expect = parseExpect(args.expect);
      if (!expect) throw new ProtocolError(ERR.INVALID_ARGS, 'expect required');
      const text = str(args.text, 'text', 2000);
      if (!text) throw new ProtocolError(ERR.INVALID_ARGS, 'text required');
      return { text, field, site: str(args.site, 'site', 300), expect };
    }
    case 'window.active':
      return {};
    case 'script.peek':
      return { path: str(args.path, 'path', LIMITS.MAX_PATH), cwd: args.cwd === undefined || args.cwd === null ? null : str(args.cwd, 'cwd', 1024) };
    case 'guard.set':
      return { keepApps: parseStrList(args.keepApps, 'keepApps'), keepFolders: parseStrList(args.keepFolders, 'keepFolders'), projectFolders: parseStrList(args.projectFolders, 'projectFolders'), terminal: args.terminal !== false };
    case 'ax.tree': {
      const app = args.app === undefined || args.app === null ? null : str(args.app, 'app', 100).trim();
      if (app !== null && (!/^[\p{L}\p{N} ._+-]{1,100}$/u.test(app) || app.startsWith('-'))) throw new ProtocolError(ERR.INVALID_ARGS, 'invalid application name');
      return { app: app || null, interactiveOnly: args.interactiveOnly !== false };
    }
    case 'ax.act': {
      const action = str(args.action, 'action', 16);
      if (!['press', 'set_value', 'focus', 'toggle', 'select', 'expand'].includes(action)) throw new ProtocolError(ERR.INVALID_ARGS, 'action must be press, set_value, focus, toggle, select or expand');
      const text = args.text === undefined ? '' : str(args.text, 'text', LIMITS.MAX_TYPE_TEXT * 4).slice(0, LIMITS.MAX_TYPE_TEXT);
      if (action === 'set_value' && args.text === undefined) throw new ProtocolError(ERR.INVALID_ARGS, 'text required');
      return { ref: str(args.ref, 'ref', 40), action, text, background: args.background === true, expect: parseExpect(args.expect) };
    }
    case 'fs.roots':
      return {};
    case 'fs.list':
      return { root: str(args.root, 'root', 200), path: args.path === undefined ? '' : str(args.path, 'path', LIMITS.MAX_PATH) };
    case 'fs.read':
      return { root: str(args.root, 'root', 200), path: str(args.path, 'path', LIMITS.MAX_PATH), maxBytes: optNum(args.maxBytes, LIMITS.DEFAULT_READ_BYTES, 1, LIMITS.MAX_READ_BYTES) };
    case 'fs.write': {
      const mode = args.mode === undefined ? 'create' : str(args.mode, 'mode', 10);
      if (mode !== 'create' && mode !== 'replace') throw new ProtocolError(ERR.INVALID_ARGS, 'mode must be create or replace');
      return { root: str(args.root, 'root', 200), path: str(args.path, 'path', LIMITS.MAX_PATH), text: str(args.text, 'text', LIMITS.MAX_WRITE_BYTES), mode };
    }
    case 'fs.trash':
      return { root: str(args.root, 'root', 200), path: str(args.path, 'path', LIMITS.MAX_PATH) };
    default:
      throw new ProtocolError(ERR.UNKNOWN_OP, `unknown op ${op}`);
  }
}

/** `scripts` on shell.run (1.3): the scripts the owner saw on Sklubot's card, by SHA-256. @param {unknown} v */
function parseScripts(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v) || v.length > 3) throw new ProtocolError(ERR.INVALID_ARGS, 'scripts must be a list of 3 at most');
  return v.map((x) => {
    if (!isObj(x)) throw new ProtocolError(ERR.INVALID_ARGS, 'script must be an object');
    const o = /** @type {Record<string, unknown>} */ (x);
    const sha256 = str(o.sha256, 'sha256', 64);
    if (!/^[0-9a-f]{64}$/.test(sha256)) throw new ProtocolError(ERR.INVALID_ARGS, 'sha256 must be 64 hex characters');
    return { path: str(o.path, 'path', LIMITS.MAX_PATH), sha256 };
  });
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
  PROTOCOL_VERSION, PROTOCOL_REVISION, CONNECT_PATH, LIMITS, CLOSE, OPS, ERR, ProtocolError,
  normalizeServer, validateArgs, parseBot, parseKey, isObj,
};
