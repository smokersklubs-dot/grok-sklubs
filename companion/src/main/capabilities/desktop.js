// @ts-check
'use strict';
/**
 * Screen and input capabilities (Electron main process).
 *
 * - Screen capture: Electron desktopCapturer.getSources({ types: ['screen'], thumbnailSize })
 *   https://www.electronjs.org/docs/latest/api/desktop-capturer (macOS ≥ 10.15 needs the
 *   "Screen Recording" permission; Linux with PipeWire shows the system picker).
 * - Mouse/keyboard: @jitsi/robotjs (MIT, N-API prebuilds for win32/darwin/linux, maintained by
 *   Jitsi for Jitsi Meet's remote control): https://github.com/jitsi/robotjs
 *   macOS needs the "Accessibility" permission; Linux works on X11 (XTest), not on native Wayland.
 *
 * Coordinates in the protocol are logical (DIP) coordinates of the primary display, origin at its
 * top-left corner. They are converted for robotjs: identity on macOS (points), and
 * screen.dipToScreenPoint() on Windows/Linux (https://www.electronjs.org/docs/latest/api/screen).
 */
const crypto = require('node:crypto');
const { execFile } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { readForeground } = require('./foreground');

/** @param {typeof import('electron')} electron @param {(action: string) => void} [showPointer]
 * @param {() => object|null} [getSession] */
function createDesktopCaps(electron, showPointer = () => {}, getSession) {
  const { desktopCapturer, screen, shell, systemPreferences } = electron;
  /** @type {any} */
  let robot = null;
  /** @param {string} what */
  const missing = (what) => {
    const e = new Error(`macOS permission missing: ${what}. The user must allow it in System Settings › Privacy & Security.`);
    /** @type {any} */ (e).code = 'permission_missing';
    return e;
  };
  const getRobot = () => {
    // Without Accessibility, macOS silently drops synthetic events: report it instead of pretending.
    if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) throw missing('Accessibility');
    if (!robot) {
      robot = require('@jitsi/robotjs');
      robot.setMouseDelay(2);
      robot.setKeyboardDelay(2);
    }
    return robot;
  };

  const primary = () => screen.getPrimaryDisplay();

  /** @param {number} x @param {number} y */
  const toRobot = (x, y) => {
    const d = primary();
    const lx = Math.max(0, Math.min(d.size.width - 1, x)) + d.bounds.x;
    const ly = Math.max(0, Math.min(d.size.height - 1, y)) + d.bounds.y;
    if (process.platform === 'darwin' || typeof screen.dipToScreenPoint !== 'function') return { x: lx, y: ly };
    const p = screen.dipToScreenPoint({ x: lx, y: ly });
    return { x: Math.round(p.x), y: Math.round(p.y) };
  };

  function screenInfo() {
    const d = primary();
    return {
      width: d.size.width,
      height: d.size.height,
      scaleFactor: d.scaleFactor,
      displayId: String(d.id),
      displays: screen.getAllDisplays().length,
      platform: process.platform,
      session: process.platform === 'linux' ? (process.env.XDG_SESSION_TYPE || (process.env.WAYLAND_DISPLAY ? 'wayland' : 'x11')) : null,
    };
  }

  /** @param {number} maxWidth */
  async function grab(maxWidth) {
    if (process.platform === 'darwin' && ['denied', 'restricted'].includes(systemPreferences.getMediaAccessStatus('screen'))) throw missing('Screen Recording');
    const d = primary();
    const physW = Math.round(d.size.width * d.scaleFactor);
    const physH = Math.round(d.size.height * d.scaleFactor);
    const w = Math.min(maxWidth, physW);
    const h = Math.round((physH * w) / physW);
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: w, height: h } });
    const src = sources.find((s) => s.display_id === String(d.id)) || sources[0];
    if (!src || src.thumbnail.isEmpty()) {
      const e = new Error('screen capture unavailable (permission missing or unsupported session)');
      /** @type {any} */ (e).code = 'unsupported';
      throw e;
    }
    return { image: src.thumbnail, display: d };
  }

  /** @param {{ format: 'jpeg'|'png', maxWidth: number, quality: number }} a */
  async function capture(a) {
    const { image, display } = await grab(a.maxWidth);
    const size = image.getSize();
    const data = a.format === 'png' ? image.toPNG() : image.toJPEG(a.quality);
    return { format: a.format, width: size.width, height: size.height, screenWidth: display.size.width, screenHeight: display.size.height, data };
  }

  /** @param {{ maxWidth: number, quality: number }} a */
  async function captureFrame(a) {
    const { image } = await grab(a.maxWidth);
    const size = image.getSize();
    const data = image.toJPEG(a.quality);
    return { width: size.width, height: size.height, data, hash: crypto.createHash('sha1').update(data).digest('hex') };
  }

  /** @param {{ x: number, y: number }} a */
  function mouseMove(a) {
    const p = toRobot(a.x, a.y);
    getRobot().moveMouse(p.x, p.y);
    showPointer('move');
    return {};
  }

  /** @param {{ x: number|null, y: number|null, button: string, double: boolean }} a */
  function mouseClick(a) {
    const r = getRobot();
    if (a.x !== null && a.y !== null) { const p = toRobot(a.x, a.y); r.moveMouse(p.x, p.y); }
    r.mouseClick(a.button, a.double);
    showPointer('click');
    return {};
  }

  /** @param {{ fromX: number, fromY: number, toX: number, toY: number, button: string }} a */
  async function mouseDrag(a) {
    const r = getRobot();
    const from = toRobot(a.fromX, a.fromY);
    const to = toRobot(a.toX, a.toY);
    const session = getSession?.();
    r.moveMouse(from.x, from.y);
    r.mouseToggle('down', a.button);
    try {
      const steps = 12;
      for (let i = 1; i <= steps; i++) {
        if (getSession && (!session || getSession() !== session)) throw new Error('Control session interrupted');
        r.dragMouse(Math.round(from.x + ((to.x - from.x) * i) / steps), Math.round(from.y + ((to.y - from.y) * i) / steps));
        showPointer('drag');
        await new Promise((res) => setTimeout(res, 8));
      }
    } finally { r.mouseToggle('up', a.button); }
    return {};
  }

  /**
   * Protocol: dy > 0 scrolls down, dx > 0 scrolls right, in wheel notches.
   * robotjs units differ per OS (X11: button clicks with y>0 = up; Windows: wheel delta, 120 per notch;
   * macOS: pixels) — see src/mouse.c in @jitsi/robotjs.
   * @param {{ x: number|null, y: number|null, dx: number, dy: number }} a
   */
  function mouseScroll(a) {
    const r = getRobot();
    if (a.x !== null && a.y !== null) { const p = toRobot(a.x, a.y); r.moveMouse(p.x, p.y); }
    const unit = process.platform === 'win32' ? 120 : process.platform === 'darwin' ? 40 : 1;
    r.scrollMouse(-a.dx * unit, -a.dy * unit);
    showPointer('scroll');
    return {};
  }

  /** @param {{ text: string }} a */
  function keyType(a) {
    getRobot().typeString(a.text);
    return { typed: a.text.length };
  }

  /**
   * A key or a combination. robotjs keyTap presses the modifiers, the key, and releases them; whatever happens, the
   * modifiers are released again afterwards so none can stay held (fail closed, backlog L19).
   * @param {{ key: string, modifiers: string[] }} a
   */
  function keyPress(a) {
    const r = getRobot();
    try {
      if (a.modifiers.length) r.keyTap(a.key, a.modifiers);
      else r.keyTap(a.key);
    } finally {
      for (const m of a.modifiers) { try { r.keyToggle(m, 'up'); } catch { /* not held */ } }
    }
    return {};
  }

  /**
   * Releases every modifier key and mouse button the relay could have pressed (robotjs keyToggle / mouseToggle "up"):
   * called when a control session ends, on Stop and when the connection is lost. Releasing a key that is not held
   * does nothing.
   */
  function releaseAll() {
    if (!robot) return {};
    for (const m of ['shift', 'control', 'alt', 'command']) { try { robot.keyToggle(m, 'up'); } catch { /* ignore */ } }
    for (const b of ['left', 'right', 'middle']) { try { robot.mouseToggle('up', b); } catch { /* ignore */ } }
    return {};
  }

  /** The window in front and whether a password field has focus (foreground.js). Null when it cannot be read. */
  async function activeWindow() {
    return readForeground();
  }

  /** shell.openExternal: https://www.electronjs.org/docs/latest/api/shell @param {{ url: string }} a */
  async function openUrl(a) {
    await shell.openExternal(a.url);
    return {};
  }

  /**
   * Open an application by name, never through a shell.
   * macOS: `open -a <name>` (man open). Windows: PowerShell Start-Process
   * (https://learn.microsoft.com/powershell/module/microsoft.powershell.management/start-process).
   * Linux: `gtk-launch <desktop-id>` if present, else the executable name from PATH.
   * @param {{ name: string }} a
   */
  async function openApp(a) {
    if (process.platform === 'darwin') {
      await execFileP('open', ['-a', a.name]);
    } else if (process.platform === 'win32') {
      await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `Start-Process -FilePath ${psQuote(a.name)}`]);
    } else {
      if (which('gtk-launch')) {
        try { await execFileP('gtk-launch', [a.name]); return { launched: a.name }; } catch { /* fall through */ }
      }
      const exe = which(a.name);
      if (!exe) { const e = new Error('application not found'); /** @type {any} */ (e).code = 'unsupported'; throw e; }
      const { spawn } = require('node:child_process');
      spawn(exe, [], { detached: true, stdio: 'ignore' }).unref();
    }
    return { launched: a.name };
  }

  /** Window titles via desktopCapturer (types: ['window']). */
  async function listWindows() {
    const sources = await desktopCapturer.getSources({ types: ['window'], thumbnailSize: { width: 0, height: 0 } });
    return { windows: sources.map((s) => ({ id: s.id, title: s.name })).slice(0, 200) };
  }

  /**
   * Best effort, depends on the OS:
   * Windows: WScript.Shell AppActivate(title) (https://learn.microsoft.com/previous-versions/windows/internet-explorer/ie-developer/windows-scripting/wzcddbek(v=vs.84)).
   * Linux X11: `wmctrl -a <title>` if wmctrl is installed (man wmctrl).
   * macOS: `open -a <title>` brings an application (not a single window) to the front.
   * @param {{ title: string }} a
   */
  async function focusWindow(a) {
    if (process.platform === 'win32') {
      const { stdout } = await execFileP('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(New-Object -ComObject WScript.Shell).AppActivate(${psQuote(a.title)})`]);
      return { focused: /true/i.test(stdout) };
    }
    if (process.platform === 'darwin') {
      await execFileP('open', ['-a', a.title]);
      return { focused: true, note: 'macOS: application brought to front' };
    }
    if (which('wmctrl')) {
      try { await execFileP('wmctrl', ['-a', a.title]); return { focused: true }; } catch { return { focused: false }; }
    }
    const e = new Error('focusing a window needs wmctrl on Linux (X11)');
    /** @type {any} */ (e).code = 'unsupported';
    throw e;
  }

  return { screenInfo, capture, captureFrame, mouseMove, mouseClick, mouseDrag, mouseScroll, keyType, keyPress, releaseAll, activeWindow, openUrl, openApp, listWindows, focusWindow };
}

/** @param {string} s */
function psQuote(s) {
  return `'${s.replace(/'/g, "''")}'`;
}

/** @param {string} cmd */
function which(cmd) {
  for (const dir of (process.env.PATH || '').split(path.delimiter)) {
    const p = path.join(dir, cmd);
    try { fs.accessSync(p, fs.constants.X_OK); if (fs.statSync(p).isFile()) return p; } catch { /* next */ }
  }
  return null;
}

/** @param {string} file @param {string[]} args @returns {Promise<{ stdout: string, stderr: string }>} */
function execFileP(file, args) {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout: 15_000, windowsHide: true }, (err, stdout, stderr) => {
      if (err) reject(err); else resolve({ stdout: String(stdout), stderr: String(stderr) });
    });
  });
}

module.exports = { createDesktopCaps };
