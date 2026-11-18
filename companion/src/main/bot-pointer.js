// @ts-check
'use strict';
const path = require('node:path');

/** Electron positions windows and the cursor in desktop DIP, including negative monitor origins.
 * @param {Electron.Point} point @param {Electron.Rectangle} display */
function pointerLayout(point, display) {
  const width = Math.min(160, display.width), height = Math.min(66, display.height);
  const x = Math.max(display.x, Math.min(point.x - 16, display.x + display.width - width));
  const y = Math.max(display.y, Math.min(point.y - 16, display.y + display.height - height));
  return { bounds: { x, y, width, height }, tip: { x: point.x - x, y: point.y - y } };
}

/** The relay calls mark only for its own input. There is no listener for human mouse movements.
 * @param {typeof import('electron')} electron */
function createBotPointer({ BrowserWindow, screen }) {
  /** @type {Electron.BrowserWindow|null} */ let win = null;
  /** @type {NodeJS.Timeout|undefined} */ let timer;
  /** @type {{point: Electron.Point, action: string}|null} */ let target = null;
  let ready = false;

  function close() {
    clearTimeout(timer);
    target = null;
    ready = false;
    if (win && !win.isDestroyed()) win.destroy();
    win = null;
  }
  function paint() {
    if (!win || !ready || !target || win.isDestroyed()) return;
    const layout = pointerLayout(target.point, screen.getDisplayNearestPoint(target.point).bounds);
    win.setBounds(layout.bounds);
    win.webContents.send('pointer:paint', { ...layout.tip, action: target.action });
    if (!win.isVisible()) win.showInactive();
  }
  /** @param {string} action */
  function mark(action) {
    if (!win || win.isDestroyed()) return;
    target = { point: screen.getCursorScreenPoint(), action };
    paint();
    clearTimeout(timer);
    timer = setTimeout(() => { target = null; win?.hide(); }, 2000);
  }
  /** @param {string} name */
  function start(name) {
    close();
    const window = new BrowserWindow({
      width: 160, height: 66, show: false, frame: false, transparent: true, backgroundColor: '#00000000',
      focusable: false, resizable: false, hasShadow: false, skipTaskbar: true, alwaysOnTop: true,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false,
        preload: path.join(__dirname, '../preload/pointer.js') },
    });
    win = window;
    window.setIgnoreMouseEvents(true);
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', (e) => e.preventDefault());
    window.webContents.once('did-finish-load', () => { if (window === win) { ready = true; paint(); } });
    window.loadFile(path.join(__dirname, '../renderer/pointer.html'), { query: { name: name.slice(0, 80) } })
      .catch(() => { if (win === window) close(); });
    mark('start');
  }
  return { start, mark, close };
}

module.exports = { createBotPointer, pointerLayout };
