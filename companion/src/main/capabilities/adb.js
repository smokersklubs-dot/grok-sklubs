// @ts-check
'use strict';
/**
 * Android phones plugged into THIS computer by USB (protocol 1.9, docs/RELAIS-PROTOCOLE.md §20, A-FAIRE L177), driven
 * with Google's own `adb` from the Android SDK Platform-Tools that the owner installed himself. Nothing is ever
 * downloaded here: when `adb` is not found, the Relais says how to install it (renderer guide, i18n `android.guide.*`).
 *
 * Every command below comes from the official documentation, nothing is invented:
 *  - `adb devices -l`, the states `device` / `offline` / `unauthorized`, `-s <serial>`, `adb shell <command>`,
 *    `adb exec-out screencap -p` (PNG on standard output), the RSA-key dialog that the PHONE shows before any command
 *    is accepted: https://developer.android.com/tools/adb (« Query for devices », « Send commands to a specific
 *    device », « Take a screenshot », « Connect to a device over USB » note on Android 4.2.2+).
 *  - `adb version`: the same page (adb prints its version; used only to say "found").
 *  - `getprop ro.product.model`, `ro.build.version.release`, `ro.build.version.sdk`: Android system properties read
 *    with the device shell's `getprop` (https://developer.android.com/tools/adb « Issue shell commands »; property
 *    names from android.os.Build: https://developer.android.com/reference/android/os/Build).
 *  - `monkey -p <package> -c android.intent.category.LAUNCHER 1`: launches the app's launcher activity
 *    (https://developer.android.com/studio/test/other-testing-tools/monkey, options -p and -c, event count 1).
 *  - `input tap x y`, `input swipe x1 y1 x2 y2 [ms]`, `input text <text>` (spaces written %s), `input keyevent <code>`:
 *    the device's `input` command (usage printed by `adb shell input`; shown in Google's Android CLI agent reference
 *    on developer.android.com). Key codes: https://developer.android.com/reference/android/view/KeyEvent.
 *  - `uiautomator dump <file>`: the UI hierarchy as XML (usage printed by `adb shell uiautomator`; node attributes
 *    text, resource-id, class, package, content-desc, checkable, checked, clickable, focused, password, bounds).
 *  - `dumpsys window`: the focused window (https://developer.android.com/tools/dumpsys); read for `mCurrentFocus`.
 *
 * Arguments go to `adb` as an argument list (execFile, never a local shell). `adb shell` hands its words to the
 * phone's shell, so every word sent there is either a validated number, a validated package name, or single-quoted.
 */
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const SERIAL_RE = /^[A-Za-z0-9._:-]{1,64}$/;
const PACKAGE_RE = /^[A-Za-z][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)+$/;
const MAX_TEXT = 500;
const MAX_SHOT_BYTES = 12 * 1024 * 1024;
const DUMP_PATH = '/sdcard/sklubot-ui.xml';
/** KeyEvent codes (developer.android.com/reference/android/view/KeyEvent). */
const KEYCODES = Object.freeze({ back: 4, home: 3, recents: 187, enter: 66, delete: 67, tab: 61, escape: 111 });

/** @param {string} m @param {string} [code] */
const bad = (m, code = 'invalid_args') => Object.assign(new Error(m), { code });

/**
 * Where `adb` may be: on PATH, else the usual Platform-Tools folders (the SDK Manager installs it in
 * `android_sdk/platform-tools/`; the standalone zip is often unpacked in the home or Downloads folder).
 * @param {{ env?: NodeJS.ProcessEnv, platform?: string, home?: string, exists?: (p: string) => boolean }} [o]
 */
function findAdb(o = {}) {
  const env = o.env || process.env;
  const platform = o.platform || process.platform;
  const home = o.home || os.homedir();
  const exists = o.exists || ((/** @type {string} */ p) => { try { fs.accessSync(p, platform === 'win32' ? fs.constants.F_OK : fs.constants.X_OK); return fs.statSync(p).isFile(); } catch { return false; } });
  const exe = platform === 'win32' ? 'adb.exe' : 'adb';
  const dirs = [];
  for (const d of String(env.PATH || env.Path || '').split(platform === 'win32' ? ';' : ':')) if (d) dirs.push(d);
  for (const v of [env.ANDROID_HOME, env.ANDROID_SDK_ROOT]) if (v) dirs.push(path.join(v, 'platform-tools'));
  if (platform === 'darwin') dirs.push(path.join(home, 'Library', 'Android', 'sdk', 'platform-tools'));
  if (platform === 'win32' && env.LOCALAPPDATA) dirs.push(path.join(env.LOCALAPPDATA, 'Android', 'Sdk', 'platform-tools'));
  if (platform === 'linux') dirs.push(path.join(home, 'Android', 'Sdk', 'platform-tools'));
  dirs.push(path.join(home, 'platform-tools'), path.join(home, 'Downloads', 'platform-tools'), path.join(home, 'Téléchargements', 'platform-tools'));
  for (const d of dirs) { const p = path.join(d, exe); if (exists(p)) return p; }
  return null;
}

/** `adb devices -l` → [{ serial, state, model? }]. @param {string} out */
function parseDevices(out) {
  const list = [];
  for (const line of String(out).split(/\r?\n/)) {
    const t = line.trim();
    if (!t || /^List of devices/i.test(t) || t.startsWith('*')) continue;
    const parts = t.split(/\s+/);
    const [serial, state] = parts;
    if (!serial || !state || !SERIAL_RE.test(serial)) continue;
    /** @type {{ serial: string, state: string, model?: string, usb: boolean }} */
    const d = { serial, state: /^[a-z ]{1,20}$/.test(state) ? state : 'unknown', usb: parts.some((p) => p.startsWith('usb:')) };
    // `model:` is only printed for a phone that accepted this computer (USB debugging authorised).
    const m = parts.find((p) => p.startsWith('model:'));
    if (m && state === 'device') d.model = m.slice(6).replace(/_/g, ' ').slice(0, 60);
    list.push(d);
  }
  return list.slice(0, 16);
}

/** Width and height of a PNG (IHDR). @param {Buffer} b */
function pngSize(b) {
  if (b.length < 24 || b.readUInt32BE(0) !== 0x89504e47 || b.toString('ascii', 12, 16) !== 'IHDR') return null;
  return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
}

/** XML attribute values as uiautomator writes them. @param {string} s */
const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_m, n) => String.fromCodePoint(Number(n) || 32)).replace(/&amp;/g, '&');

/**
 * A `uiautomator dump` → the app in front and its nodes. A password field's text is never kept (`••••`).
 * @param {string} xml @param {number} [maxNodes]
 */
function parseUiDump(xml, maxNodes = 200) {
  /** @type {any[]} */
  const nodes = [];
  /** @type {Map<string, number>} */
  const packages = new Map();
  let total = 0;
  let focusedPassword = null;
  let focusedEdit = null;
  for (const m of String(xml).matchAll(/<node\b([^>]*?)\/?>/g)) {
    /** @type {Record<string, string>} */
    const a = {};
    for (const at of m[1].matchAll(/([a-z-]+)="([^"]*)"/g)) a[at[1]] = unxml(at[2]);
    total++;
    if (a.package) packages.set(a.package, (packages.get(a.package) || 0) + 1);
    const password = a.password === 'true';
    const focused = a.focused === 'true';
    const edit = /EditText/.test(a.class || '');
    if (focused && (edit || password)) { focusedEdit = { id: a['resource-id'] || '', package: a.package || '' }; focusedPassword = password; }
    const bm = /\[(-?\d+),(-?\d+)\]\[(-?\d+),(-?\d+)\]/.exec(a.bounds || '');
    const text = password ? (a.text ? '••••' : '') : (a.text || '').slice(0, 300);
    const desc = (a['content-desc'] || '').slice(0, 200);
    const click = a.clickable === 'true';
    // Keep what a bot can read or act on; layout-only nodes are dropped.
    if (!text && !desc && !click && !edit && !password) continue;
    if (nodes.length >= maxNodes) continue;
    /** @type {Record<string, any>} */
    const n = { bounds: bm ? [Number(bm[1]), Number(bm[2]), Number(bm[3]) - Number(bm[1]), Number(bm[4]) - Number(bm[2])] : [0, 0, 0, 0] };
    if (text) n.text = text;
    if (desc) n.desc = desc;
    if (a['resource-id']) n.id = a['resource-id'].slice(0, 120);
    if (a.class) n.class = a.class.replace(/^android\.widget\./, '').slice(0, 60);
    if (click) n.click = true;
    if (edit) n.edit = true;
    if (password) n.password = true;
    if (focused) n.focused = true;
    if (a.checkable === 'true') n.checked = a.checked === 'true';
    nodes.push(n);
  }
  const app = [...packages.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] || '';
  return { package: app, nodes, truncated: nodes.length >= maxNodes && total > nodes.length, focusedEdit, focusedPassword };
}

/** The package of the focused window in `dumpsys window` (null when unreadable: callers refuse then). @param {string} out */
function parseFocus(out) {
  const m = /mCurrentFocus=Window\{[^}]*?\s([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\/[^\s}]*\}/.exec(out)
    || /mFocusedApp=[^\n]*?\s([A-Za-z][A-Za-z0-9_]*(?:\.[A-Za-z0-9_]+)+)\/[^\s}]*/.exec(out);
  return m ? m[1] : null;
}

/** Single-quote one word for the phone's shell. @param {string} s */
const shq = (s) => `'${s.replace(/'/g, "'\\''")}'`;

/** `input text` takes printable ASCII; a space is written %s (so a literal "%s" cannot be typed). @param {string} text */
function inputText(text) {
  if (text.length > MAX_TEXT) throw bad(`text: ${MAX_TEXT} characters at most`, 'too_large');
  if (!/^[\x20-\x7e]*$/.test(text)) throw bad('the phone keyboard over USB types plain letters, digits and signs only (no accents, emoji or new lines)', 'unsupported');
  if (text.includes('%s')) throw bad('"%s" cannot be typed over USB', 'unsupported');
  return shq(text.replace(/ /g, '%s'));
}

/**
 * @param {{ adbPath?: string|null, find?: () => string|null, run?: (file: string, args: string[], o: { timeoutMs: number, maxBuffer: number, signal?: AbortSignal }) => Promise<Buffer> }} [deps]
 */
function createAdb(deps = {}) {
  const locate = () => (deps.adbPath !== undefined ? deps.adbPath : (deps.find || findAdb)());
  const run = deps.run || ((file, args, o) => new Promise((done, fail) => {
    execFile(file, args, { encoding: 'buffer', timeout: o.timeoutMs, maxBuffer: o.maxBuffer, windowsHide: true, signal: o.signal }, (err, stdout, stderr) => {
      if (err) return fail(Object.assign(new Error(String(stderr || err.message).trim().slice(0, 300) || 'adb failed'), { code: 'internal' }));
      done(/** @type {Buffer} */ (stdout));
    });
  }));
  /** @param {string[]} args @param {{ timeoutMs?: number, maxBuffer?: number, signal?: AbortSignal }} [o] */
  const adb = async (args, o = {}) => {
    const file = locate();
    if (!file) throw bad('adb (Android Platform-Tools) is not installed on this computer', 'adb_missing');
    return run(file, args, { timeoutMs: o.timeoutMs || 15_000, maxBuffer: o.maxBuffer || 1024 * 1024, signal: o.signal });
  };
  /** @param {string} serial @param {string[]} words @param {object} [o] */
  const sh = async (serial, words, o) => (await adb(['-s', serial, 'shell', ...words], o)).toString('utf8');

  return {
    /** Phones seen by adb. Model and Android version only for a phone that authorised this computer. */
    async androidDevices() {
      const file = locate();
      if (!file) return { adb: { found: false }, devices: [] };
      let version = '';
      try { version = ((/Android Debug Bridge version ([0-9.]+)/.exec((await adb(['version'], { timeoutMs: 5000 })).toString('utf8')) || [])[1]) || ''; } catch { /* still listed below */ }
      const list = parseDevices((await adb(['devices', '-l'], { timeoutMs: 10_000 })).toString('utf8'));
      for (const d of list) {
        if (d.state !== 'device') continue;
        try {
          const [rel, sdk, model] = (await sh(d.serial, ['getprop', 'ro.build.version.release', ';', 'getprop', 'ro.build.version.sdk', ';', 'getprop', 'ro.product.model'], { timeoutMs: 8000 })).split(/\r?\n/).map((x) => x.trim());
          /** @type {any} */ (d).android = (rel || '').slice(0, 12);
          /** @type {any} */ (d).sdk = Number(sdk) || null;
          if (model) d.model = model.slice(0, 60);
        } catch { /* keep the line from adb devices */ }
      }
      return { adb: { found: true, version }, devices: list };
    },
    /** @param {{ serial: string, signal?: AbortSignal }} a */
    async androidScreenshot(a) {
      const png = await adb(['-s', a.serial, 'exec-out', 'screencap', '-p'], { timeoutMs: 20_000, maxBuffer: MAX_SHOT_BYTES, signal: a.signal });
      const size = pngSize(png);
      if (!size) throw bad('the phone did not send a picture (is the screen on?)', 'unsupported');
      return { format: 'png', ...size, data: png };
    },
    /** @param {{ serial: string, x: number, y: number, long?: boolean, signal?: AbortSignal }} a */
    async androidTap(a) {
      // A long press is a swipe that does not move (same point, 600 ms).
      await sh(a.serial, a.long ? ['input', 'swipe', String(a.x), String(a.y), String(a.x), String(a.y), '600'] : ['input', 'tap', String(a.x), String(a.y)], { signal: a.signal });
    },
    /** @param {{ serial: string, fromX: number, fromY: number, toX: number, toY: number, durationMs: number, signal?: AbortSignal }} a */
    async androidSwipe(a) {
      await sh(a.serial, ['input', 'swipe', String(a.fromX), String(a.fromY), String(a.toX), String(a.toY), String(a.durationMs)], { signal: a.signal });
    },
    /** @param {{ serial: string, text: string, signal?: AbortSignal }} a */
    async androidType(a) {
      await sh(a.serial, ['input', 'text', inputText(a.text)], { signal: a.signal });
      return { typed: a.text.length };
    },
    /** @param {{ serial: string, key: keyof typeof KEYCODES, signal?: AbortSignal }} a */
    async androidKey(a) {
      await sh(a.serial, ['input', 'keyevent', String(KEYCODES[a.key])], { signal: a.signal });
    },
    /** @param {{ serial: string, package: string, signal?: AbortSignal }} a */
    async androidOpen(a) {
      const out = await sh(a.serial, ['monkey', '-p', a.package, '-c', 'android.intent.category.LAUNCHER', '1'], { timeoutMs: 20_000, signal: a.signal });
      if (/No activities found|monkey aborted/i.test(out)) throw bad(`no app ${a.package} to open on this phone`, 'not_found');
      return { launched: true, package: a.package };
    },
    /** @param {{ serial: string, maxNodes?: number, signal?: AbortSignal }} a */
    async androidUi(a) {
      await sh(a.serial, ['uiautomator', 'dump', DUMP_PATH], { timeoutMs: 20_000, signal: a.signal });
      const xml = (await adb(['-s', a.serial, 'exec-out', 'cat', DUMP_PATH], { timeoutMs: 10_000, maxBuffer: 8 * 1024 * 1024, signal: a.signal })).toString('utf8');
      void sh(a.serial, ['rm', '-f', DUMP_PATH], { timeoutMs: 5000 }).catch(() => {});
      if (!/<hierarchy\b/.test(xml)) throw bad('the phone could not read its screen (is it unlocked?)', 'foreground_unknown');
      return parseUiDump(xml, a.maxNodes || 200);
    },
    /** The package in front, or null. @param {{ serial: string, signal?: AbortSignal }} a */
    async androidFocus(a) {
      try { return parseFocus(await sh(a.serial, ['dumpsys', 'window'], { timeoutMs: 8000, maxBuffer: 8 * 1024 * 1024, signal: a.signal })); } catch { return null; }
    },
  };
}

module.exports = { createAdb, findAdb, parseDevices, parseUiDump, parseFocus, pngSize, inputText, shq, KEYCODES, SERIAL_RE, PACKAGE_RE, MAX_TEXT };
