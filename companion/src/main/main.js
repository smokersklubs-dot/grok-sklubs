// @ts-check
'use strict';
/**
 * Sklubot desktop app — Electron main process.
 * The Sklubot window (the user's web app, see app-window.js) plus the relay built in: the relay (connection + core)
 * is wired to its own local UI exactly as in the former "Sklubot Relais" app: relay panel, consent dialogs,
 * always-on-top "session active" banner, tray icon and the global Stop hotkey.
 * Electron APIs used are documented at https://www.electronjs.org/docs/latest/api/app (and siblings).
 */
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const electron = require('electron');
const { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, globalShortcut, dialog, shell, screen, Notification, safeStorage, systemPreferences, desktopCapturer } = electron;

const { Store } = require('./store');
const { ActionLog } = require('./action-log');
const { RelayCore } = require('./relay-core');
const { RelayConnection } = require('./connection');
const { normalizeServer, OPS, LIMITS, PROTOCOL_REVISION } = require('./protocol');
const { createDesktopCaps } = require('./capabilities/desktop');
const { createBotPointer } = require('./bot-pointer');
const { runShell } = require('./capabilities/shell');
const { createFileCaps, shareProblem } = require('./capabilities/files');
const i18n = require('./i18n');
const { AppSettings } = require('./app-settings');
const { createAppShell } = require('./app-window');
const { migrateRelaisDir } = require('./desktop-core');

// ───────────────────────── process-level setup (before "ready") ─────────────────────────

// SKLUBOT_DATA_DIR (or the older SKLUBOT_RELAIS_DATA_DIR) moves the settings folder: tests and portable use only.
const DATA_DIR_OVERRIDE = process.env.SKLUBOT_DATA_DIR || process.env.SKLUBOT_RELAIS_DATA_DIR;
if (DATA_DIR_OVERRIDE) app.setPath('userData', path.resolve(DATA_DIR_OVERRIDE));

// Since Electron 38, Linux defaults to native Wayland in a Wayland session
// (https://www.electronjs.org/docs/latest/breaking-changes#changed-ozone-platform-default-to-auto-on-linux).
// robotjs injects input through X11 XTest, so we stay on X11/XWayland where it can work at all.
if (process.platform === 'linux') app.commandLine.appendSwitch('ozone-platform', 'x11');

/**
 * Test-only automatic consent. Honoured ONLY in an unpackaged dev run (`app.isPackaged === false`)
 * and only from the local process environment, which the server has no way to set.
 * A packaged build ignores it completely.
 */
const TEST_AUTOCONFIRM = !app.isPackaged && process.env.SKLUBOT_RELAIS_TEST_AUTOCONFIRM === '1';

const HOTKEY = 'CommandOrControl+Alt+Shift+S';
const hotkeyLabel = () => (process.platform === 'darwin' ? '⌘ ⌥ ⇧ S' : lang === 'en' ? 'Ctrl + Alt + Shift + S' : 'Ctrl + Alt + Maj + S');
const ASSETS = path.join(__dirname, '..', '..', 'assets');
const RENDERER = path.join(__dirname, '..', 'renderer');
const PRELOAD = path.join(__dirname, '..', 'preload', 'preload.js');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => { if (appShell) appShell.show(); });
  app.whenReady().then(boot).catch((e) => {
    console.error(e);
    app.exit(1);
  });
}

// ───────────────────────── state ─────────────────────────

/** @type {Store} */ let store;
/** @type {ActionLog} */ let actionLog;
/** @type {RelayCore} */ let core;
/** @type {RelayConnection | null} */ let conn = null;
/** @type {Electron.BrowserWindow | null} */ let mainWin = null;
/** @type {Electron.BrowserWindow | null} */ let bannerWin = null;
/** @type {ReturnType<typeof createBotPointer>} */ let pointer;
/** @type {Electron.Tray | null} */ let tray = null;
/** @type {AppSettings} */ let appSettings;
/** @type {ReturnType<typeof createAppShell> | null} */ let appShell = null;
let unread = 0;
let hotkeyOk = false;
let quitting = false;
/** @type {Record<string,string>} */ let dict = i18n.fr;
let lang = /** @type {'fr'|'en'} */ ('fr');
/** @type {{ code: string, expiresAt: string|null } | null} */ let pairing = null;
/** @type {Map<string, { kind: 'session'|'command'|'terminal'|'shortcut', bot: { id: string, name: string }, data: any, resolve: (v: any) => void, win: Electron.BrowserWindow, shownAt: number, deadline: number }>} */
const prompts = new Map();
/** @type {string | null} */ let setupError = null;
/** @type {string | null} */ let folderError = null;

/** @param {string} key @param {Record<string, string|number>} [vars] */
const tr = (key, vars) => i18n.t(dict, key, vars);

/** @param {Record<string, any>} e */
const log = (e) => {
  actionLog.write(e);
  if (process.env.SKLUBOT_RELAIS_DEBUG === '1') console.log('[relais]', JSON.stringify(e));
};

// ───────────────────────── boot ─────────────────────────

async function boot() {
  const userData = app.getPath('userData');
  // The app was called "Sklubot Relais" before: copy its settings once (pairing, shared folders, bots' permissions).
  if (!DATA_DIR_OVERRIDE) {
    try {
      if (migrateRelaisDir(path.join(app.getPath('appData'), 'Sklubot Relais'), userData)) console.log('[sklubot] relay settings copied from the former Sklubot Relais folder');
    } catch (e) { console.error('[sklubot] could not copy the former Sklubot Relais settings:', e); }
  }
  store = await new Store(userData, safeStorage ? {
    available: () => safeStorage.isAsyncEncryptionAvailable(),
    encrypt: (s) => safeStorage.encryptStringAsync(s),
    decrypt: async (b) => (await safeStorage.decryptStringAsync(b)).result,
  } : null).load();
  actionLog = new ActionLog(path.join(userData, 'logs'));
  lang = i18n.pickLanguage(app.getLocale(), store.settings.language);
  dict = i18n.strings(lang);
  if (process.platform === 'win32') app.setAppUserModelId('fr.sklubot.desktop');
  appSettings = new AppSettings(userData).load();

  pointer = createBotPointer(electron);
  const desktop = createDesktopCaps(electron, (action) => pointer.mark(action), () => core?.state().prompt ? null : core?.session);
  core = new RelayCore({
    send: (msg) => (conn ? conn.send(msg) : false),
    // Files: only in the folders the user shares below; the previous version of a file goes to the OS trash.
    caps: { ...desktop, runShell, ...createFileCaps({ getFolders: () => store.folders(), trash: (p) => shell.trashItem(p) }) },
    ui: consentUI,
    store,
    log,
    autoConfirm: TEST_AUTOCONFIRM,
  });
  if (TEST_AUTOCONFIRM) log({ kind: 'warning', message: 'TEST MODE: consent prompts are auto-confirmed (dev run only)' });

  registerIpc();
  createTray();
  hotkeyOk = globalShortcut.register(HOTKEY, () => core.stop('hotkey'));
  if (!hotkeyOk) log({ kind: 'warning', message: `global shortcut ${HOTKEY} unavailable` });

  if (!store.settings.server && process.env.SKLUBOT_RELAIS_SERVER) {
    try { store.setServer(normalizeServer(process.env.SKLUBOT_RELAIS_SERVER).base); } catch { /* ignore */ }
  }
  appShell = createAppShell({
    settings: appSettings,
    tr,
    dict: () => dict,
    lang: () => lang,
    assets: ASSETS,
    renderer: RENDERER,
    preloadDir: path.dirname(PRELOAD),
    keepInBackground: relayEnabled,
    openRelay: () => showMain(),
    quit: () => quit(),
    isQuitting: () => quitting,
    getAutostart: () => store.settings.autostart,
    setAutostart: (on) => { store.setAutostart(on); applyAutostart(on); pushState(); },
    onBadge: (n) => { unread = n; updateTray(); },
    log,
  });
  appShell.show();
  if (store.settings.server) startConnection();
  applyAutostart(store.settings.autostart);
  pushState();
  // "Update available" check (GitHub Releases, no automatic install): packaged builds only, a little after start.
  if (app.isPackaged && process.env.SKLUBOT_NO_UPDATE_CHECK !== '1') setTimeout(() => { if (appShell) void appShell.checkForUpdate(false); }, 15_000);
}

/** The relay is on when the user set it up in the relay panel (a server address there); "Oublier ce serveur" turns it off. */
function relayEnabled() {
  return !!(store && store.settings.server);
}

app.on('window-all-closed', () => {
  // With the relay on, the app keeps running in the tray. Otherwise: quit on Windows/Linux, stay in the Dock on macOS.
  if (process.platform !== 'darwin' && !relayEnabled()) quit();
});
// macOS: a click on the Dock icon reopens the window.
app.on('activate', () => { if (appShell) appShell.show(); });
app.on('before-quit', () => { quitting = true; });
app.on('will-quit', () => globalShortcut.unregisterAll());

function quit() {
  quitting = true;
  if (conn) conn.stop();
  app.quit();
}

// ───────────────────────── connection ─────────────────────────

function startConnection() {
  if (conn) { conn.stop(); conn.removeAllListeners(); }
  pairing = null;
  const server = store.settings.server;
  if (!server) return;
  const { wsUrl } = normalizeServer(server);
  conn = new RelayConnection({
    wsUrl,
    core,
    log,
    userAgent: `SklubotRelais/${app.getVersion()} (${process.platform})`,
    getAuth: () => store.getAuth(),
    hello: () => ({
      app: { name: 'sklubot-relais', version: app.getVersion() },
      device: { name: os.hostname().slice(0, 64), platform: process.platform, arch: process.arch, osRelease: os.release(), locale: app.getLocale() },
      protocol: PROTOCOL_REVISION,
      capabilities: capabilityList(),
      screen: safeScreenInfo(),
      limits: { maxInboundBytes: LIMITS.MAX_INBOUND_BYTES, maxViewFps: LIMITS.MAX_VIEW_FPS },
      state: { locked: store.isLocked() },
    }),
    onPaired: async ({ deviceId, token, serverName }) => {
      await store.setCredentials(deviceId, token, serverName);
      log({ kind: 'paired', deviceId, serverName });
    },
    onTokenRotated: async (token) => {
      await store.setToken(token);
      log({ kind: 'token.rotated' });
    },
    onRevoked: async () => {
      store.clearCredentials();
      log({ kind: 'revoked' });
    },
  });
  conn.on('status', () => { if (conn && conn.status !== 'pairing') pairing = null; pushState(); });
  conn.on('pairing', (p) => { pairing = p; pushState(); showMain(); });
  conn.on('online', () => { core.event('relay.state', { locked: store.isLocked(), session: null }); pushState(); });
  conn.start();
}

function capabilityList() {
  return Object.keys(OPS).filter((op) => !(op === 'window.focus' && process.platform === 'linux' && !hasWmctrl()));
}

function hasWmctrl() {
  return (process.env.PATH || '').split(path.delimiter).some((d) => { try { fs.accessSync(path.join(d, 'wmctrl'), fs.constants.X_OK); return true; } catch { return false; } });
}

function safeScreenInfo() {
  const d = screen.getPrimaryDisplay();
  return { width: d.size.width, height: d.size.height, scaleFactor: d.scaleFactor };
}

// ───────────────────────── consent UI (local only) ─────────────────────────

const consentUI = {
  /** @param {{ promptId: string, bot: { id: string, name: string }, reason: string, timeoutMs: number }} p */
  askSession(p) {
    return openPrompt('session', p.promptId, p.bot, { reason: p.reason }, p.timeoutMs);
  },
  /** @param {{ promptId: string, bot: { id: string, name: string }, command: string, cwd: string|null, timeoutMs: number, scripts?: any[], floor?: string }} p */
  askCommand(p) {
    return openPrompt('command', p.promptId, p.bot, { command: p.command, cwd: p.cwd, scripts: p.scripts || [], floor: p.floor || null }, p.timeoutMs);
  },
  /** A terminal for this session, or a protected shortcut (guard.js): asked here, on this computer. */
  /** @param {{ promptId: string, bot: { id: string, name: string }, kind: 'terminal'|'shortcut', detail: string, timeoutMs: number }} p */
  askGuard(p) {
    return openPrompt(p.kind, p.promptId, p.bot, { detail: p.detail }, p.timeoutMs);
  },
  /** @param {string} promptId */
  cancelPrompt(promptId) {
    const pr = prompts.get(promptId);
    if (!pr) return;
    prompts.delete(promptId);
    pr.resolve(pr.kind === 'command' ? { decision: 'expired' } : 'expired');
    if (!pr.win.isDestroyed()) pr.win.destroy();
    pushState();
  },
  /** @param {any} session */
  onSession(session) {
    if (session) { showBanner(session.botName); pointer.start(session.botName); }
    else { pointer.close(); hideBanner(); }
    updateTray();
    pushState();
  },
  /** @param {boolean} locked */
  onLocked(locked) {
    if (locked && Notification.isSupported()) new Notification({ title: tr('app.name'), body: tr('notify.locked') }).show();
    updateTray();
    pushState();
  },
};

/**
 * @param {'session'|'command'|'terminal'|'shortcut'} kind @param {string} promptId @param {{ id: string, name: string }} bot
 * @param {any} data @param {number} timeoutMs
 */
function openPrompt(kind, promptId, bot, data, timeoutMs) {
  return new Promise((resolve) => {
    const area = screen.getPrimaryDisplay().workArea;
    const width = 600;
    const height = kind === 'command' ? ((data.scripts || []).length ? 640 : 440) : 340;
    const win = new BrowserWindow({
      width, height,
      x: Math.round(area.x + (area.width - width) / 2),
      y: Math.round(area.y + (area.height - height) / 2),
      resizable: false, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: false, show: false, frame: false,
      title: tr('app.name'),
      backgroundColor: '#0f1720',
      icon: path.join(ASSETS, 'icon.png'),
      webPreferences: secureWebPrefs(),
    });
    win.setAlwaysOnTop(true, 'floating');
    lockDownContents(win);
    const deadline = Date.now() + timeoutMs;
    prompts.set(promptId, { kind, bot, data, resolve, win, shownAt: Date.now(), deadline });
    win.on('closed', () => {
      const pr = prompts.get(promptId);
      if (!pr) return;
      prompts.delete(promptId);
      pr.resolve(kind === 'command' ? { decision: 'refuse' } : 'refuse');
      pushState();
    });
    win.loadFile(path.join(RENDERER, 'consent.html'), { query: { id: promptId } });
    win.once('ready-to-show', () => { win.show(); win.focus(); });
    pushState();
  });
}

/** Called by the consent window. Only accepted from the window that owns the prompt. */
function answerPrompt(/** @type {Electron.IpcMainInvokeEvent} */ ev, /** @type {any} */ promptId, /** @type {any} */ decision, /** @type {any} */ extra) {
  const pr = typeof promptId === 'string' ? prompts.get(promptId) : undefined;
  if (!pr || pr.win.isDestroyed() || ev.sender.id !== pr.win.webContents.id) return false;
  // Ignore clicks in the first 700 ms (avoids answering by accident while typing/clicking elsewhere).
  if (Date.now() - pr.shownAt < 700) return false;
  const allowed = pr.kind === 'session' ? ['once', 'always', 'refuse'] : pr.kind === 'command' ? ['run', 'refuse'] : ['allow', 'refuse'];
  if (!allowed.includes(decision)) return false;
  prompts.delete(promptId);
  if (pr.kind !== 'command') pr.resolve(decision);
  // A command that runs a script is asked every time: the "always" box is not offered, and not taken.
  else pr.resolve({ decision, alwaysForBot: decision === 'run' && !(pr.data.scripts || []).length && !!(extra && extra.alwaysForBot === true) });
  pr.win.destroy();
  pushState();
  return true;
}

// ───────────────────────── windows ─────────────────────────

function secureWebPrefs() {
  return { preload: PRELOAD, contextIsolation: true, sandbox: true, nodeIntegration: false, webSecurity: true, spellcheck: false };
}

/** No navigation, no new windows, no permissions: the UI only shows local files. @param {Electron.BrowserWindow} win */
function lockDownContents(win) {
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.session.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
  win.removeMenu();
}

function showMain() {
  if (!app.isReady()) return;
  if (mainWin && !mainWin.isDestroyed()) { mainWin.show(); mainWin.focus(); return; }
  mainWin = new BrowserWindow({
    width: 560, height: 680, minWidth: 460, minHeight: 520,
    title: tr('app.name'),
    backgroundColor: '#0f1720',
    icon: path.join(ASSETS, 'icon.png'),
    show: false,
    webPreferences: secureWebPrefs(),
  });
  lockDownContents(mainWin);
  mainWin.loadFile(path.join(RENDERER, 'index.html'));
  mainWin.once('ready-to-show', () => mainWin && mainWin.show());
  // The relay panel is a secondary window of the app: closing it only hides it.
  mainWin.on('close', (e) => {
    if (!quitting) { e.preventDefault(); mainWin && mainWin.hide(); }
  });
  mainWin.on('closed', () => { mainWin = null; });
}

/** @param {string} botName */
function showBanner(botName) {
  const area = screen.getPrimaryDisplay().workArea;
  const width = 460;
  const height = 56;
  if (!bannerWin || bannerWin.isDestroyed()) {
    bannerWin = new BrowserWindow({
      width, height,
      x: Math.round(area.x + (area.width - width) / 2), y: area.y + 12,
      frame: false, resizable: false, movable: true, minimizable: false, maximizable: false, fullscreenable: false,
      alwaysOnTop: true, skipTaskbar: true, show: false, transparent: false, hasShadow: true,
      backgroundColor: '#b42318',
      focusable: process.platform !== 'linux', // stays clickable; avoids stealing keyboard focus
      webPreferences: secureWebPrefs(),
    });
    // 'screen-saver' is the highest documented level (BrowserWindow.setAlwaysOnTop).
    bannerWin.setAlwaysOnTop(true, 'screen-saver');
    bannerWin.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    lockDownContents(bannerWin);
    bannerWin.loadFile(path.join(RENDERER, 'banner.html'));
    bannerWin.once('ready-to-show', () => bannerWin && bannerWin.showInactive());
    bannerWin.on('close', (e) => { if (!quitting && core.session) e.preventDefault(); });
    bannerWin.on('closed', () => { bannerWin = null; });
  } else {
    bannerWin.showInactive();
  }
  void botName;
}

function hideBanner() {
  if (bannerWin && !bannerWin.isDestroyed()) bannerWin.destroy();
  bannerWin = null;
}

// ───────────────────────── tray ─────────────────────────

function trayIcon(/** @type {'idle'|'active'|'paused'|'unread'} */ kind) {
  const file = path.join(ASSETS, `tray-${kind}.png`);
  const img = nativeImage.createFromPath(file);
  return img.isEmpty() ? nativeImage.createFromPath(path.join(ASSETS, 'icon.png')).resize({ width: 16, height: 16 }) : img;
}

function createTray() {
  try {
    tray = new Tray(trayIcon('idle'));
    tray.on('click', () => { if (appShell) appShell.show(); });
    updateTray();
  } catch (e) {
    tray = null;
    log({ kind: 'warning', message: `tray unavailable: ${/** @type {Error} */ (e).message}` });
  }
}

function updateTray() {
  if (!tray) return;
  const active = !!(core && core.session);
  const relayOn = relayEnabled();
  const paused = relayOn && (!conn || conn.status === 'paused');
  tray.setImage(trayIcon(active ? 'active' : paused ? 'paused' : unread > 0 ? 'unread' : 'idle'));
  const unreadText = unread > 0 ? ` — ${tr('tray.unread', { n: unread })}` : '';
  tray.setToolTip(relayOn ? tr('tray.tooltip', { status: active ? tr('session.active', { bot: core.session ? core.session.botName : '' }) : statusText() }) + unreadText : `Sklubot${unreadText}`);
  // macOS menu bar: the count next to the icon (Tray.setTitle is macOS only).
  if (process.platform === 'darwin') tray.setTitle(unread > 0 ? String(unread > 99 ? '99+' : unread) : '');
  /** @type {Electron.MenuItemConstructorOptions[]} */
  const items = [
    { label: tr('tray.open'), click: () => { if (appShell) appShell.show(); } },
    { label: tr('tray.relay'), click: () => showMain() },
    { type: 'separator' },
    { label: tr('tray.stop'), enabled: active, click: () => core.stop('tray') },
  ];
  if (relayOn) {
    items.push(conn && conn.status === 'paused'
      ? { label: tr('btn.resume'), click: () => resume() }
      : { label: tr('btn.pause'), enabled: !!conn, click: () => pause() });
  }
  items.push({ type: 'separator' }, { label: tr('tray.quit'), click: () => quit() });
  tray.setContextMenu(Menu.buildFromTemplate(items));
}

function pause() { if (conn) { conn.pause(); log({ kind: 'paused' }); } updateTray(); pushState(); }
function resume() { if (conn) { conn.start(); log({ kind: 'resumed' }); } else startConnection(); updateTray(); pushState(); }

// ───────────────────────── autostart (off by default) ─────────────────────────

/**
 * macOS/Windows: app.setLoginItemSettings (https://www.electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings-macos-windows).
 * Linux: an XDG autostart entry in ~/.config/autostart (https://specifications.freedesktop.org/autostart-spec/latest/).
 * @param {boolean} on
 */
function applyAutostart(on) {
  try {
    if (process.platform === 'linux') {
      const dir = path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart');
      const file = path.join(dir, 'sklubot.desktop');
      if (on) {
        const exec = process.env.APPIMAGE || process.execPath;
        fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Sklubot\nExec="${exec.replace(/"/g, '')}"\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(file)) {
        fs.unlinkSync(file);
      }
    } else if (app.isPackaged) {
      app.setLoginItemSettings({ openAtLogin: on });
    }
  } catch (e) {
    log({ kind: 'warning', message: `autostart: ${/** @type {Error} */ (e).message}` });
  }
}

// ───────────────────────── UI state + IPC ─────────────────────────

function statusText() {
  if (!conn) return tr('status.idle');
  const server = store.settings.serverName || (store.settings.server || '').replace(/^https?:\/\//, '');
  switch (conn.status) {
    case 'online': return tr('status.online', { server });
    case 'connecting': return tr('status.connecting', { server });
    case 'pairing': return tr('pair.waiting');
    case 'waiting': return tr('status.waiting', { s: conn.lastError || '…' });
    case 'paused': return tr('status.paused');
    case 'unauthorized': return tr(conn.lastError === 'revoked' ? 'status.revoked' : 'status.unauthorized');
    case 'outdated': return tr('status.outdated');
    case 'replaced': return tr('status.replaced');
    default: return tr('status.idle');
  }
}

function permissions() {
  if (process.platform === 'darwin') {
    return {
      screen: systemPreferences.getMediaAccessStatus('screen') === 'granted',
      accessibility: systemPreferences.isTrustedAccessibilityClient(false),
    };
  }
  return null;
}

function uiState() {
  const s = store.settings;
  let view = 'main';
  if (!s.server) view = 'setup';
  else if (!store.getAuth() && (!conn || ['connecting', 'pairing', 'waiting'].includes(conn.status))) view = 'pairing';
  return {
    view,
    lang,
    setupError,
    // The relay panel's address field starts with the server shown in the Sklubot window.
    suggestedServer: appSettings ? appSettings.server : null,
    server: s.server,
    serverName: s.serverName,
    status: conn ? conn.status : 'idle',
    statusText: statusText(),
    pairing,
    session: core.session ? { botName: core.session.botName, grant: core.session.grant, startedAt: core.session.startedAt } : null,
    locked: store.isLocked(),
    bots: Object.entries(s.bots).map(([id, b]) => ({ id, name: b.name, control: b.control === 'always', commands: b.commands === true })),
    folders: store.folders().map((f) => ({ id: f.id, name: f.name, path: f.path, write: f.write === true })),
    folderError,
    autostart: s.autostart,
    hotkey: hotkeyLabel(),
    hotkeyOk,
    permissions: permissions(),
    wayland: process.platform === 'linux' && (process.env.XDG_SESSION_TYPE === 'wayland' || !!process.env.WAYLAND_DISPLAY),
    testMode: TEST_AUTOCONFIRM,
    logPath: actionLog.file,
    version: app.getVersion(),
    protocol: PROTOCOL_REVISION,
  };
}

function pushState() {
  if (!store) return;
  const st = uiState();
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed()) w.webContents.send('state', st);
  }
  updateTray();
}

/** @param {Electron.IpcMainInvokeEvent} ev */
const fromMain = (ev) => !!mainWin && !mainWin.isDestroyed() && ev.sender.id === mainWin.webContents.id;

function registerIpc() {
  ipcMain.handle('i18n', () => ({ lang, dict, hotkey: hotkeyLabel() }));
  ipcMain.handle('state', () => uiState());
  ipcMain.handle('prompt:get', (ev, id) => {
    const pr = typeof id === 'string' ? prompts.get(id) : undefined;
    if (!pr || ev.sender.id !== pr.win.webContents.id) return null;
    return { kind: pr.kind, bot: pr.bot, data: pr.data, deadline: pr.deadline, testMode: TEST_AUTOCONFIRM };
  });
  ipcMain.handle('prompt:answer', (ev, id, decision, extra) => answerPrompt(ev, id, decision, extra));
  ipcMain.handle('banner:get', () => ({ botName: core.session ? core.session.botName : '', testMode: TEST_AUTOCONFIRM }));
  // Stop is always allowed, from any of our windows.
  ipcMain.handle('session:stop', () => { core.stop('user'); return true; });

  ipcMain.handle('server:set', (ev, input) => {
    if (!fromMain(ev)) return false;
    try {
      const { base } = normalizeServer(String(input || ''));
      setupError = null;
      store.setServer(base);
      startConnection();
    } catch (e) {
      setupError = /** @type {any} */ (e).code === 'insecure_server' ? tr('setup.err.insecure') : tr('setup.err.invalid');
    }
    pushState();
    return !setupError;
  });
  ipcMain.handle('pairing:cancel', (ev) => {
    if (!fromMain(ev)) return false;
    if (conn) { conn.stop(); conn.removeAllListeners(); conn = null; }
    store.forgetServer();
    pushState();
    return true;
  });
  ipcMain.handle('relay:pause', (ev) => { if (fromMain(ev)) pause(); return true; });
  ipcMain.handle('relay:resume', (ev) => { if (fromMain(ev)) resume(); return true; });
  ipcMain.handle('relay:repair', (ev) => {
    if (!fromMain(ev)) return false;
    store.clearCredentials();
    startConnection();
    pushState();
    return true;
  });
  ipcMain.handle('relay:forget', async (ev) => {
    if (!fromMain(ev) || !mainWin) return false;
    const r = await dialog.showMessageBox(mainWin, { type: 'warning', buttons: [tr('btn.forget'), tr('pair.cancel')], defaultId: 1, cancelId: 1, message: tr('forget.confirm') });
    if (r.response !== 0) return false;
    if (conn) { conn.stop(); conn.removeAllListeners(); conn = null; }
    store.forgetServer();
    log({ kind: 'server.forgotten' });
    pushState();
    return true;
  });
  ipcMain.handle('relay:unlock', (ev) => {
    if (!fromMain(ev) || core.session || prompts.size) return false;
    core.unlock();
    pushState();
    return true;
  });
  ipcMain.handle('bot:set', (ev, id, key, value) => {
    if (!fromMain(ev) || typeof id !== 'string' || !store.getBot(id)) return false;
    if (key !== 'control' && key !== 'commands') return false;
    const granting = value === true;
    // Granting more power is refused while a bot controls the mouse: it could click this toggle itself.
    if (granting && (core.session || prompts.size)) return false;
    const bot = { id, name: /** @type {any} */ (store.getBot(id)).name };
    store.setBotPerm(bot, key, key === 'control' ? (granting ? 'always' : null) : granting);
    log({ kind: 'permission.changed', bot, key, value: granting });
    pushState();
    return true;
  });
  ipcMain.handle('bot:remove', (ev, id) => {
    if (!fromMain(ev) || typeof id !== 'string') return false;
    store.removeBot(id);
    log({ kind: 'permission.removed', botId: id });
    pushState();
    return true;
  });
  // Shared folders: chosen here in the system's folder dialog, never by the server.
  ipcMain.handle('folder:add', async (ev) => {
    if (!fromMain(ev) || !mainWin) return false;
    // Sharing more is refused while a bot controls the mouse: it could click this itself.
    if (core.session || prompts.size) return false;
    const r = await dialog.showOpenDialog(mainWin, { properties: ['openDirectory'] });
    if (r.canceled || !r.filePaths[0]) return false;
    const dir = r.filePaths[0];
    const why = shareProblem(dir);
    if (why) { folderError = tr('folders.refused', { why }); pushState(); return false; }
    folderError = null;
    const f = store.addFolder(fs.realpathSync(dir), path.basename(dir));
    log({ kind: 'folder.shared', folder: f.path });
    pushState();
    return true;
  });
  ipcMain.handle('folder:write', (ev, id, on) => {
    if (!fromMain(ev) || typeof id !== 'string') return false;
    if (on === true && (core.session || prompts.size)) return false;
    const ok = store.setFolderWrite(id, on === true);
    if (ok) log({ kind: 'folder.write', id, write: on === true });
    pushState();
    return ok;
  });
  ipcMain.handle('folder:remove', (ev, id) => {
    if (!fromMain(ev) || typeof id !== 'string') return false;
    store.removeFolder(id);
    log({ kind: 'folder.removed', id });
    pushState();
    return true;
  });
  ipcMain.handle('autostart:set', (ev, on) => {
    if (!fromMain(ev)) return false;
    if (on === true && (core.session || prompts.size)) return false;
    store.setAutostart(on === true);
    applyAutostart(on === true);
    if (appShell) appShell.buildMenu();
    pushState();
    return true;
  });
  ipcMain.handle('log:open', (ev) => { if (fromMain(ev)) shell.showItemInFolder(actionLog.file); return true; });
  ipcMain.handle('perm:request', async (ev, which) => {
    if (!fromMain(ev) || process.platform !== 'darwin') return false;
    // Both calls make macOS show its own permission prompt (Electron systemPreferences / desktopCapturer docs).
    if (which === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true);
    if (which === 'screen') { try { await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: 1, height: 1 } }); } catch { /* ignore */ } }
    pushState();
    return true;
  });
}
