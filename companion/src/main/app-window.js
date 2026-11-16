// @ts-check
'use strict';
/**
 * Sklubot desktop app — the main window that shows the user's Sklubot web app, the first-launch server screen,
 * the application menu, the unread badge and the "update available" check.
 *
 * Security (https://www.electronjs.org/docs/latest/tutorial/security):
 *  - contextIsolation on, nodeIntegration off, sandbox on, a minimal preload (src/preload/web-preload.js);
 *  - the web app runs in its own persistent partition ("persist:sklubot"): its cookies survive restarts, and the
 *    relay's local windows (default session, every permission denied) are not affected by anything below;
 *  - only the configured server origin loads in the window (will-navigate / will-redirect); other links open in the
 *    system browser through shell.openExternal after validation (http, https, mailto only);
 *  - permission requests (microphone, notifications, clipboard, full screen) are granted to the server origin only
 *    (session.setPermissionRequestHandler / setPermissionCheckHandler); everything else is denied.
 */
const path = require('node:path');
const { app, BrowserWindow, Menu, shell, session, ipcMain, screen, nativeImage, dialog, net } = require('electron');
const core = require('./desktop-core');

const PARTITION = 'persist:sklubot';
const OAUTH_FRAME = 'sklubot-oauth'; // the name web/src/lib/oauth.ts gives its sign-in popup
const RELEASES_API = 'https://api.github.com/repos/smokersklubs-dot/grok-sklubs/releases?per_page=30';
const RELEASES_PAGE = 'https://github.com/smokersklubs-dot/grok-sklubs/releases';
const DEFAULT_SERVER = 'https://sklubot.sklubs.fr';

/**
 * @param {{
 *   settings: import('./app-settings').AppSettings,
 *   tr: (key: string, vars?: Record<string, string|number>) => string,
 *   dict: () => Record<string, string>,
 *   lang: () => string,
 *   assets: string,
 *   renderer: string,
 *   preloadDir: string,
 *   keepInBackground: () => boolean,
 *   openRelay: () => void,
 *   quit: () => void,
 *   isQuitting: () => boolean,
 *   getAutostart: () => boolean,
 *   setAutostart: (on: boolean) => void,
 *   onBadge: (n: number) => void,
 *   log: (e: Record<string, any>) => void,
 * }} o
 */
function createAppShell(o) {
  /** @type {Electron.BrowserWindow | null} */ let webWin = null;
  /** @type {Electron.BrowserWindow | null} */ let setupWin = null;
  /** @type {string | null} */ let setupError = null;
  /** @type {string} */ let lastRejected = '';
  /** @type {{ version: string, url: string } | null} */ let update = null;
  let badge = 0;
  let saveTimer = /** @type {NodeJS.Timeout | null} */ (null);

  const tr = o.tr;
  const origin = () => o.settings.server;
  const webSession = () => session.fromPartition(PARTITION);
  const icon = () => path.join(o.assets, 'icon.png');

  // ───────────── permissions: only the server origin, only what the web app uses ─────────────
  function setupSession() {
    const ses = webSession();
    ses.setPermissionRequestHandler((_wc, permission, callback, details) => {
      const ok = core.permissionAllowed(permission, details && details.requestingUrl, origin(), /** @type {any} */ (details));
      if (!ok) o.log({ kind: 'desktop.permission.denied', permission, from: core.originOf((details && details.requestingUrl) || '') });
      callback(ok);
    });
    ses.setPermissionCheckHandler((_wc, permission, requestingOrigin, details) =>
      core.permissionAllowed(permission, (details && details.requestingUrl) || requestingOrigin, origin(), /** @type {any} */ (details)));
    // Screen sharing is not offered by the web app: no display-media handler is installed, so such requests fail.
  }

  /** @param {string} url */
  function openExternal(url) {
    if (!core.externalAllowed(url)) { o.log({ kind: 'desktop.external.refused', url: String(url).slice(0, 200) }); return false; }
    shell.openExternal(url).catch(() => undefined);
    return true;
  }

  /**
   * Navigation rules for a window that shows the server's pages: the server origin stays, anything else goes to
   * the system browser.
   * @param {Electron.WebContents} wc
   */
  function lockToOrigin(wc) {
    wc.on('will-navigate', (e, url) => {
      if (core.sameOrigin(url, origin())) return;
      e.preventDefault();
      openExternal(url);
    });
    wc.on('will-redirect', (e, url) => {
      if (!e.isMainFrame || core.sameOrigin(url, origin())) return;
      e.preventDefault();
      openExternal(url);
    });
    wc.setWindowOpenHandler(({ url, frameName }) => {
      // The connectors' sign-in popup (web/src/lib/oauth.ts): opened blank, then sent to the provider's page.
      // It gets no preload powers and every permission is refused (wrong origin), but it shares the cookies so the
      // server's callback page can finish the sign-in.
      if (frameName === OAUTH_FRAME && (url === 'about:blank' || url === '')) {
        return { action: 'allow', overrideBrowserWindowOptions: popupOptions(520, 720) };
      }
      if (core.sameOrigin(url, origin())) return { action: 'allow', overrideBrowserWindowOptions: popupOptions(1000, 760) };
      openExternal(url);
      return { action: 'deny' };
    });
    wc.on('did-create-window', (child, details) => {
      child.removeMenu();
      if (details.frameName === OAUTH_FRAME) lockPopup(child.webContents);
      else lockToOrigin(child.webContents);
    });
    wc.on('context-menu', (_e, p) => contextMenu(wc, p));
  }

  /** The sign-in popup may browse the provider's https pages; it cannot open further windows. @param {Electron.WebContents} wc */
  function lockPopup(wc) {
    wc.on('will-navigate', (e, url) => { if (!/^https?:/i.test(url)) e.preventDefault(); });
    wc.setWindowOpenHandler(({ url }) => { openExternal(url); return { action: 'deny' }; });
  }

  /** @param {number} width @param {number} height @returns {Electron.BrowserWindowConstructorOptions} */
  function popupOptions(width, height) {
    return {
      width, height, autoHideMenuBar: true, icon: icon(),
      webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, partition: PARTITION },
    };
  }

  /** Right-click menu: Electron shows none by default. @param {Electron.WebContents} wc @param {Electron.ContextMenuParams} p */
  function contextMenu(wc, p) {
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const items = [];
    for (const s of (p.dictionarySuggestions || []).slice(0, 5)) items.push({ label: s, click: () => wc.replaceMisspelling(s) });
    if (items.length) items.push({ type: 'separator' });
    if (p.linkURL && /^https?:|^mailto:/i.test(p.linkURL)) {
      items.push({ label: tr('desk.ctx.openLink'), click: () => openExternal(p.linkURL) });
      items.push({ label: tr('desk.ctx.copyLink'), click: () => require('electron').clipboard.writeText(p.linkURL) });
      items.push({ type: 'separator' });
    }
    if (p.isEditable) items.push({ role: 'cut', label: tr('desk.edit.cut'), enabled: p.editFlags.canCut });
    if (p.selectionText || p.isEditable) items.push({ role: 'copy', label: tr('desk.edit.copy'), enabled: p.editFlags.canCopy });
    if (p.isEditable) items.push({ role: 'paste', label: tr('desk.edit.paste'), enabled: p.editFlags.canPaste });
    if (p.isEditable) items.push({ role: 'selectAll', label: tr('desk.edit.selectAll') });
    while (items.length && items[items.length - 1].type === 'separator') items.pop();
    if (items.length) Menu.buildFromTemplate(items).popup();
  }

  // ───────────── main window ─────────────
  function show() {
    if (!origin()) return showSetup();
    showWeb();
  }

  function showWeb() {
    const server = origin();
    if (!server) return showSetup();
    if (webWin && !webWin.isDestroyed()) {
      if (webWin.isMinimized()) webWin.restore();
      webWin.show();
      webWin.focus();
      return;
    }
    const saved = core.visibleBounds(o.settings.s.bounds, screen.getAllDisplays().map((d) => d.workArea));
    webWin = new BrowserWindow({
      width: saved ? saved.width : 1280,
      height: saved ? saved.height : 820,
      ...(saved ? { x: saved.x, y: saved.y } : {}),
      minWidth: 420, minHeight: 480,
      title: 'Sklubot',
      icon: icon(),
      backgroundColor: '#121212',
      show: false,
      webPreferences: {
        preload: path.join(o.preloadDir, 'web-preload.js'),
        contextIsolation: true,
        sandbox: true,
        nodeIntegration: false,
        webSecurity: true,
        partition: PARTITION,
        spellcheck: true,
      },
    });
    if (o.settings.s.maximized) webWin.maximize();
    const wc = webWin.webContents;
    lockToOrigin(wc);
    wc.on('did-fail-load', (_e, code, desc, url, isMainFrame) => {
      // -3 is ERR_ABORTED (a navigation replaced by another one): not an error worth a page.
      if (!isMainFrame || code === -3 || !webWin) return;
      webWin.loadFile(path.join(o.renderer, 'offline.html'), { query: { server: origin() || '', error: desc || String(code), lang: o.lang() } }).catch(() => undefined);
      void url;
    });
    wc.on('render-process-gone', (_e, d) => o.log({ kind: 'desktop.renderer.gone', reason: d.reason }));
    webWin.loadURL(`${server}/`).catch(() => undefined);
    webWin.once('ready-to-show', () => webWin && webWin.show());
    const remember = () => {
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(saveBounds, 600);
    };
    webWin.on('resize', remember);
    webWin.on('move', remember);
    webWin.on('close', (e) => {
      saveBounds();
      if (o.isQuitting()) return;
      // With the relay on (or on macOS, where closing a window never quits an app), the app stays in the tray / Dock.
      if (o.keepInBackground() || process.platform === 'darwin') {
        e.preventDefault();
        if (webWin && webWin.isFullScreen()) webWin.setFullScreen(false);
        webWin && webWin.hide();
        return;
      }
      e.preventDefault();
      o.quit();
    });
    webWin.on('closed', () => { webWin = null; });
    applyBadge();
  }

  function saveBounds() {
    if (!webWin || webWin.isDestroyed()) return;
    const maximized = webWin.isMaximized();
    const b = maximized || webWin.isFullScreen() ? (o.settings.s.bounds || webWin.getNormalBounds()) : webWin.getBounds();
    try { o.settings.setBounds(b, maximized); } catch { /* disk full: not important */ }
  }

  // ───────────── first launch / "Changer de serveur" ─────────────
  function showSetup() {
    if (setupWin && !setupWin.isDestroyed()) { setupWin.show(); setupWin.focus(); return; }
    setupError = null;
    lastRejected = '';
    setupWin = new BrowserWindow({
      width: 560, height: 560, minWidth: 420, minHeight: 480,
      title: 'Sklubot',
      icon: icon(),
      backgroundColor: '#121212',
      show: false,
      webPreferences: { preload: path.join(o.preloadDir, 'setup-preload.js'), contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false },
    });
    const wc = setupWin.webContents;
    wc.on('will-navigate', (e) => e.preventDefault());
    wc.setWindowOpenHandler(() => ({ action: 'deny' }));
    setupWin.removeMenu();
    setupWin.loadFile(path.join(o.renderer, 'server.html'));
    setupWin.once('ready-to-show', () => setupWin && setupWin.show());
    setupWin.on('closed', () => {
      setupWin = null;
      // Closing the very first screen without an address: nothing else to show, unless the relay runs.
      if (!origin() && !o.isQuitting() && !o.keepInBackground() && process.platform !== 'darwin') o.quit();
    });
  }

  /** @param {Electron.IpcMainInvokeEvent} ev */
  const fromSetup = (ev) => !!setupWin && !setupWin.isDestroyed() && ev.sender.id === setupWin.webContents.id;
  /** @param {Electron.IpcMainEvent | Electron.IpcMainInvokeEvent} ev */
  const fromWeb = (ev) => !!webWin && !webWin.isDestroyed() && ev.sender.id === webWin.webContents.id && !!ev.senderFrame && core.sameOrigin(ev.senderFrame.url, origin());

  /** Is a Sklubot server answering at this origin? (GET /api/health, public). @param {string} base */
  async function reachable(base) {
    try {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), 8000);
      const r = await net.fetch(`${base}/api/health`, { signal: ctl.signal, cache: 'no-store' });
      clearTimeout(t);
      return r.ok;
    } catch {
      return false;
    }
  }

  function registerIpc() {
    ipcMain.handle('setup:get', (ev) => {
      if (!fromSetup(ev)) return null;
      return { lang: o.lang(), dict: o.dict(), server: origin() || DEFAULT_SERVER, canCancel: !!origin(), error: setupError };
    });
    ipcMain.handle('setup:submit', async (ev, input) => {
      if (!fromSetup(ev)) return { ok: false };
      let parsed;
      try {
        parsed = core.normalizeAppServer(String(input || ''));
      } catch (e) {
        return { ok: false, error: tr(/** @type {any} */ (e).code === 'insecure' ? 'desk.setup.err.insecure' : 'desk.setup.err.invalid') };
      }
      // A second "Continuer" with the same address uses it even if it did not answer (server starting, captive portal…).
      if (lastRejected !== parsed.origin && !(await reachable(parsed.origin))) {
        lastRejected = parsed.origin;
        return { ok: false, error: tr('desk.setup.err.unreachable') };
      }
      const changed = parsed.origin !== origin();
      o.settings.setServer(parsed.origin);
      o.log({ kind: 'desktop.server', server: parsed.origin });
      buildMenu();
      if (changed && webWin && !webWin.isDestroyed()) webWin.loadURL(`${parsed.origin}/`).catch(() => undefined);
      // Open the main window first: closing the last window first would end the app ("window-all-closed").
      showWeb();
      const done = setupWin;
      setupWin = null;
      if (done && !done.isDestroyed()) done.destroy();
      return { ok: true };
    });
    ipcMain.handle('setup:cancel', (ev) => {
      if (!fromSetup(ev) || !origin()) return false;
      if (setupWin && !setupWin.isDestroyed()) setupWin.close();
      return true;
    });
    // Unread count from the web app (window.sklubotDesktop.setBadge). Only from the main window showing the server origin.
    ipcMain.on('desktop:badge', (ev, n) => {
      const v = core.badgeCount(n);
      if (v === null || !fromWeb(ev)) return;
      badge = v;
      applyBadge();
    });
    // A click on one of the web app's notifications brings the window back (it may be hidden in the tray).
    ipcMain.on('desktop:focus', (ev) => { if (fromWeb(ev)) showWeb(); });
  }

  function applyBadge() {
    try {
      // macOS Dock and Linux Unity launchers (https://www.electronjs.org/docs/latest/api/app#appsetbadgecountcount-linux-macos).
      if (process.platform !== 'win32') app.setBadgeCount(badge);
      // Windows taskbar overlay (https://www.electronjs.org/docs/latest/api/browser-window#winsetoverlayiconoverlay-description-windows).
      if (process.platform === 'win32' && webWin && !webWin.isDestroyed()) {
        webWin.setOverlayIcon(badge > 0 ? nativeImage.createFromPath(path.join(o.assets, 'badge.png')) : null, badge > 0 ? tr('desk.badge', { n: badge }) : '');
      }
    } catch { /* not supported on this desktop */ }
    o.onBadge(badge);
  }

  // ───────────── menu ─────────────
  function buildMenu() {
    const server = origin();
    const mac = process.platform === 'darwin';
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const appItems = [
      { label: tr('desk.menu.reload'), accelerator: 'CmdOrCtrl+R', enabled: !!server, click: () => reload() },
      { label: tr('desk.menu.server'), click: () => showSetup() },
      { label: tr('desk.menu.browser'), enabled: !!server, click: () => { const u = currentUrl(); if (u) openExternal(u); } },
      { type: 'separator' },
      { label: tr('desk.menu.relay'), click: () => o.openRelay() },
      { label: tr('desk.menu.autostart'), type: 'checkbox', checked: o.getAutostart(), click: (item) => { o.setAutostart(item.checked); buildMenu(); } },
      update
        ? { label: tr('desk.update.menu', { version: update.version }), click: () => openDownloadPage() }
        : { label: tr('desk.menu.update'), click: () => { void checkForUpdate(true); } },
      { type: 'separator' },
      ...(mac ? /** @type {Electron.MenuItemConstructorOptions[]} */ ([{ role: 'hide' }, { role: 'hideOthers' }, { role: 'unhide' }, { type: 'separator' }]) : []),
      { label: tr('desk.menu.quit'), accelerator: 'CmdOrCtrl+Q', click: () => o.quit() },
    ];
    /** @type {Electron.MenuItemConstructorOptions[]} */
    const template = [
      { label: 'Sklubot', submenu: appItems },
      {
        label: tr('desk.menu.edit'),
        submenu: [
          { role: 'undo', label: tr('desk.edit.undo') }, { role: 'redo', label: tr('desk.edit.redo') }, { type: 'separator' },
          { role: 'cut', label: tr('desk.edit.cut') }, { role: 'copy', label: tr('desk.edit.copy') }, { role: 'paste', label: tr('desk.edit.paste') },
          { role: 'selectAll', label: tr('desk.edit.selectAll') },
        ],
      },
      {
        label: tr('desk.menu.view'),
        submenu: [
          { role: 'resetZoom', label: tr('desk.view.resetZoom') }, { role: 'zoomIn', label: tr('desk.view.zoomIn') }, { role: 'zoomOut', label: tr('desk.view.zoomOut') },
          { type: 'separator' },
          { role: 'togglefullscreen', label: tr('desk.view.fullscreen') },
          ...(app.isPackaged ? [] : /** @type {Electron.MenuItemConstructorOptions[]} */ ([{ role: 'toggleDevTools' }])),
        ],
      },
      { label: tr('desk.menu.window'), submenu: [{ role: 'minimize', label: tr('desk.window.minimize') }, { role: 'close', label: tr('desk.window.close') }] },
    ];
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
  }

  function reload() {
    const server = origin();
    if (!webWin || webWin.isDestroyed() || !server) return showWeb();
    // From the offline page, go back to the server; otherwise reload the page.
    if (core.sameOrigin(webWin.webContents.getURL(), server)) webWin.webContents.reload();
    else webWin.loadURL(`${server}/`).catch(() => undefined);
  }

  function currentUrl() {
    const server = origin();
    if (!server) return null;
    const u = webWin && !webWin.isDestroyed() ? webWin.webContents.getURL() : '';
    return core.sameOrigin(u, server) ? u : `${server}/`;
  }

  function openDownloadPage() {
    const server = origin();
    openExternal(server ? `${server}/telecharger` : (update && update.url) || RELEASES_PAGE);
  }

  // ───────────── "update available" (no automatic install: see LISEZMOI.md) ─────────────
  /** @param {boolean} interactive */
  async function checkForUpdate(interactive) {
    let latest = null;
    try {
      const r = await net.fetch(RELEASES_API, { headers: { accept: 'application/vnd.github+json', 'user-agent': `Sklubot-Desktop/${app.getVersion()}` } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      latest = core.latestDesktopRelease(await r.json());
    } catch (e) {
      o.log({ kind: 'desktop.update.check_failed', message: /** @type {Error} */ (e).message });
      if (interactive) void dialog.showMessageBox({ type: 'info', message: tr('desk.update.failed') });
      return null;
    }
    const current = app.getVersion();
    if (latest && core.compareVersions(latest.version, current) > 0) {
      update = latest;
      buildMenu();
      if (interactive || o.settings.s.updateNotified !== latest.version) {
        o.settings.setUpdateNotified(latest.version);
        const parent = webWin && !webWin.isDestroyed() && webWin.isVisible() ? webWin : null;
        const opts = { type: /** @type {'info'} */ ('info'), buttons: [tr('desk.update.download'), tr('desk.update.later')], defaultId: 0, cancelId: 1, message: tr('desk.update.available', { version: latest.version, current }) };
        const res = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
        if (res.response === 0) openDownloadPage();
      }
    } else if (interactive) {
      void dialog.showMessageBox({ type: 'info', message: tr('desk.update.none', { current }) });
    }
    return latest;
  }

  setupSession();
  registerIpc();
  buildMenu();

  return {
    show,
    showWeb,
    showSetup,
    buildMenu,
    checkForUpdate,
    get window() { return webWin; },
    get setupWindow() { return setupWin; },
    get badge() { return badge; },
    PARTITION,
  };
}

module.exports = { createAppShell, PARTITION, DEFAULT_SERVER };
