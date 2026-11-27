// @ts-check
'use strict';
/**
 * Safety rules of the relay on the user's own computer (backlog L19 / L32), decided HERE whatever the server asks:
 *
 *  - apps refused by default: terminals and script launchers, system settings and system tools, password managers and
 *    wallets, and Sklubot itself (`DENIED_APPS`). A terminal is only usable when the owner allowed it in Sklubot
 *    (Settings → Computers → Safety rules, sent here as `guard.set`) AND the user said yes on this computer for this
 *    control session;
 *  - the owner's "keep out" list of apps and folders (sent by the server with `guard.set`, it only adds refusals);
 *  - never typing into a focused password field (the Relais has no vault fill: the user types passwords themselves);
 *  - dangerous shortcuts refused (`DANGEROUS_SHORTCUTS`), unless the server says the owner approved a card for that
 *    press AND the user says yes on this computer;
 *  - a script launched by a command is shown (first 40 lines + SHA-256) and refused if it changes before the click.
 *
 * Pure Node (no Electron): unit-tested in test/unit/guard.test.js. The same lists live in server/src/relayguard.ts
 * (the server refuses first, the relay again here); server/test/relay-guard.test.ts checks that both stay equal.
 */
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

/** Lower case, letters and digits only, without ".exe" / ".app" and a leading folder path. @param {unknown} s */
function normApp(s) {
  let v = String(s ?? '').trim().toLowerCase();
  v = v.replace(/\\/g, '/').split('/').pop() || '';
  v = v.replace(/\.(exe|app)$/, '');
  return v.replace(/[^\p{L}\p{N}]+/gu, '');
}

/**
 * Apps refused by default, by group. `names` are shown to the owner (Settings → Computers → Safety rules);
 * `ids` are other names the same apps report (process names, bundle identifiers, X11 WM_CLASS), not shown.
 */
const DENIED_APPS = Object.freeze([
  {
    group: 'terminal',
    names: ['Terminal', 'iTerm2', 'Warp', 'Alacritty', 'kitty', 'WezTerm', 'Hyper', 'Tabby', 'Ghostty', 'Konsole', 'GNOME Terminal', 'GNOME Console', 'Ptyxis', 'xterm', 'Terminator', 'Tilix', 'Guake', 'Yakuake', 'Xfce Terminal', 'LXTerminal', 'MATE Terminal', 'QTerminal', 'foot', 'Command Prompt (cmd)', 'PowerShell', 'Windows Terminal', 'Git Bash', 'WSL'],
    ids: ['com.apple.Terminal', 'iterm', 'com.googlecode.iterm2', 'dev.warp.Warp-Stable', 'wezterm-gui', 'com.mitchellh.ghostty', 'gnome-terminal-server', 'org.gnome.Terminal', 'kgx', 'org.gnome.Console', 'org.gnome.Ptyxis', 'uxterm', 'urxvt', 'rxvt', 'xfce4-terminal', 'mate-terminal', 'sakura', 'terminology', 'cmd', 'powershell_ise', 'pwsh', 'WindowsTerminal', 'wt', 'conhost', 'OpenConsole', 'mintty', 'bash', 'zsh', 'fish', 'sh'],
  },
  {
    group: 'scripts',
    names: ['Script Editor', 'Automator', 'Shortcuts', 'Registry Editor', 'Microsoft Management Console', 'Windows Script Host'],
    ids: ['com.apple.ScriptEditor2', 'com.apple.Automator', 'com.apple.shortcuts', 'regedit', 'regedt32', 'mmc', 'gpedit', 'wscript', 'cscript', 'mshta'],
  },
  {
    group: 'settings',
    names: ['System Settings', 'System Preferences', 'Control Panel', 'Windows Security', 'Task Manager', 'Activity Monitor', 'Disk Utility', 'GNOME Settings', 'KDE System Settings', 'Xfce Settings', 'System Monitor', 'GParted', 'Disks', 'System Configuration (msconfig)'],
    ids: ['com.apple.systempreferences', 'SystemSettings', 'control', 'SecHealthUI', 'taskmgr', 'com.apple.ActivityMonitor', 'com.apple.DiskUtility', 'gnome-control-center', 'org.gnome.Settings', 'systemsettings', 'xfce4-settings-manager', 'gnome-system-monitor', 'ksysguard', 'plasma-systemmonitor', 'gnome-disks', 'msconfig', 'diskmgmt', 'compmgmt'],
  },
  {
    group: 'passwords',
    names: ['1Password', 'Bitwarden', 'KeePass', 'KeePassXC', 'LastPass', 'Dashlane', 'Enpass', 'NordPass', 'Proton Pass', 'Keeper', 'RoboForm', 'Passwords (macOS)', 'Keychain Access', 'Seahorse (Passwords and Keys)', 'KWalletManager', 'Ledger Live', 'Exodus', 'Electrum', 'Trezor Suite', 'Atomic Wallet'],
    ids: ['1password7', 'com.1password.1password', 'com.bitwarden.desktop', 'keepassx', 'org.keepassxc.KeePassXC', 'com.apple.Passwords', 'com.apple.keychainaccess', 'org.gnome.seahorse.Application', 'kwalletmanager5'],
  },
  { group: 'self', names: ['Sklubot'], ids: ['Sklubot Relais', 'fr.sklubot.desktop', 'sklubot-desktop'] },
]);

/** normalized name → group */
const DENIED_INDEX = new Map();
/** Shown names that also count as a word of a window title (long enough, not everyday words). */
const WORD_INDEX = new Map();
const GENERIC_WORDS = new Set(['shortcuts', 'passwords', 'keeper', 'exodus', 'disks', 'hyper', 'tabby', 'kitty']);
for (const g of DENIED_APPS) for (const n of [...g.names, ...g.ids]) {
  // "Command Prompt (cmd)" → also "command prompt"
  for (const v of [normApp(n), normApp(n.replace(/\s*\(.*\)$/, ''))]) {
    DENIED_INDEX.set(v, g.group);
    if (g.names.includes(n) && v.length >= 5 && !GENERIC_WORDS.has(v)) WORD_INDEX.set(v, g.group);
  }
}

/**
 * @typedef {{ app?: string, bundle?: string, pid?: number|null, windowId?: string|null, title?: string, passwordField?: boolean|null }} Active
 * @typedef {{ keepApps: string[], keepFolders: string[], projectFolders?: string[], terminal: boolean }} OwnerGuard
 */

/** Which refused group an app (or the window in front) belongs to, or null. @param {Active} a */
function deniedGroup(a) {
  for (const v of [a.app, a.bundle]) {
    const g = DENIED_INDEX.get(normApp(v));
    if (v && g) return g;
  }
  // The Sklubot web app or desktop app in front (a bot must never answer its own approval cards).
  if (/sklubot/i.test(String(a.title ?? ''))) return 'self';
  return null;
}

/** Same check for a name the bot gives (app.open, window.focus): the name, or a word of a window title. @param {string} name */
function deniedName(name) {
  const g = deniedGroup({ app: name, title: name });
  if (g) return g;
  // A window title such as "Terminal — bash — 80×24" or "1Password — Login".
  const words = String(name).split(/[\s—–\-:|·]+/).map(normApp).filter((w) => w.length >= 3);
  for (const w of words) { const hit = WORD_INDEX.get(w); if (hit) return hit; }
  return null;
}

const lowerPath = (/** @type {string} */ p) => p.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase();
const baseOf = (/** @type {string} */ p) => lowerPath(p).split('/').pop() || '';

/**
 * The owner's "keep out" list: an app (its name, or a word in the window title), or a folder (its name or path shown
 * in the window title). Returns the entry that matched, or null.
 * @param {Active} a @param {OwnerGuard} g
 */
function keepOutHit(a, g) {
  const app = normApp(a.app), bundle = normApp(a.bundle), title = String(a.title ?? '').toLowerCase();
  for (const e of g.keepApps || []) {
    const n = normApp(e);
    if (!n) continue;
    if (n === app || n === bundle || (n.length >= 3 && normApp(title).includes(n))) return e;
  }
  for (const e of g.keepFolders || []) {
    const full = lowerPath(e), base = baseOf(e);
    if ((full.length >= 3 && title.includes(full)) || (base.length >= 3 && title.includes(base))) return e;
  }
  return null;
}

/** Whether a real path is in one of the owner's keep-out folders (absolute entries by prefix, names by segment). @param {string} real @param {string[]} folders */
function inKeepOutFolder(real, folders) {
  const l = lowerPath(real);
  const segs = l.split('/');
  for (const e of folders || []) {
    const full = lowerPath(e);
    if (!full) continue;
    if (/^([a-z]:)?\//.test(full) || full.startsWith('~/')) {
      const abs = full.startsWith('~/') ? lowerPath(path.join(os.homedir(), full.slice(2))) : full;
      if (l === abs || l.startsWith(abs + '/')) return e;
    } else if (segs.includes(full)) return e;
  }
  return null;
}

/** A window that may be a sign-in or password screen, when the system cannot say whether a password field has focus. */
const LOGIN_TITLE = /(password|passwort|contraseña|mot de passe|passcode|\bpin\b|sign[ -]?in|log[ -]?in|connexion|se connecter|unlock|déverrouill|authenticat|authentif)/i;

/** True when typing must be refused: a password field has focus, or (unknown) the window looks like a sign-in. @param {Active} a */
function passwordRisk(a) {
  if (a.passwordField === true) return 'password_field';
  if (a.passwordField !== false && LOGIN_TITLE.test(String(a.title ?? ''))) return 'password_maybe';
  return null;
}

/** Whether two readings are the same window (same app, same process and same window when both say so). @param {Active} a @param {Active} b */
function sameWindow(a, b) {
  if (normApp(a.app) !== normApp(b.app)) return false;
  if (a.pid && b.pid && a.pid !== b.pid) return false;
  if (a.windowId && b.windowId && String(a.windowId) !== String(b.windowId)) return false;
  return true;
}

// ── Shortcuts ──────────────────────────────────────────────────────────────
const MOD_ORDER = ['control', 'alt', 'shift', 'command'];
/** "control+alt+delete" with the modifiers in a fixed order. @param {string} key @param {string[]} modifiers */
function comboOf(key, modifiers) {
  const mods = MOD_ORDER.filter((m) => modifiers.includes(m));
  return [...mods, String(key).toLowerCase()].join('+');
}

/**
 * Shortcuts refused on the user's computer (robotjs names: control, alt, shift, command = ⌘ on macOS, the Windows /
 * Super key elsewhere). `why`: close (closes an app), lock (locks or logs out), system (system menu, task manager,
 * console switch), launcher (opens something that can start any program), switch (switches app or desktop unseen),
 * delete (deletes for good). `platforms`: only there (the same keys do harmless things elsewhere). `ownApp`: allowed
 * on an app the bot opened itself in this control session. `apps`: only when one of these apps is in front.
 * @type {ReadonlyArray<{ combo: string, why: string, platforms?: string[], ownApp?: boolean, apps?: string[] }>}
 */
const DANGEROUS_SHORTCUTS = Object.freeze([
  { combo: 'alt+f4', why: 'close', platforms: ['win32', 'linux'], ownApp: true },
  { combo: 'command+q', why: 'close', platforms: ['darwin'], ownApp: true },
  { combo: 'control+q', why: 'close', platforms: ['linux'], ownApp: true },
  { combo: 'control+alt+delete', why: 'system' },
  { combo: 'control+shift+escape', why: 'system', platforms: ['win32'] },
  { combo: 'control+alt+escape', why: 'system', platforms: ['linux'] },
  { combo: 'control+alt+backspace', why: 'system', platforms: ['linux'] },
  ...Array.from({ length: 12 }, (_, i) => ({ combo: `control+alt+f${i + 1}`, why: 'system', platforms: ['linux'] })),
  { combo: 'alt+command+escape', why: 'system', platforms: ['darwin'] },
  { combo: 'command+x', why: 'system', platforms: ['win32'] },
  { combo: 'command+i', why: 'system', platforms: ['win32'] },
  { combo: 'control+command+q', why: 'lock', platforms: ['darwin'] },
  { combo: 'shift+command+q', why: 'lock', platforms: ['darwin'] },
  { combo: 'alt+shift+command+q', why: 'lock', platforms: ['darwin'] },
  { combo: 'command+l', why: 'lock', platforms: ['win32', 'linux'] },
  { combo: 'control+alt+l', why: 'lock', platforms: ['linux'] },
  { combo: 'command+r', why: 'launcher', platforms: ['win32'] },
  { combo: 'command+s', why: 'launcher', platforms: ['win32'] },
  { combo: 'command+q', why: 'launcher', platforms: ['win32'] },
  { combo: 'command+space', why: 'launcher' },
  { combo: 'alt+command+space', why: 'launcher', platforms: ['darwin'] },
  { combo: 'control+escape', why: 'launcher', platforms: ['win32'] },
  { combo: 'alt+f1', why: 'launcher', platforms: ['linux'] },
  { combo: 'alt+f2', why: 'launcher', platforms: ['linux'] },
  { combo: 'control+alt+t', why: 'launcher', platforms: ['linux'] },
  { combo: 'command+tab', why: 'switch' },
  { combo: 'alt+tab', why: 'switch', platforms: ['win32', 'linux'] },
  { combo: 'control+alt+tab', why: 'switch', platforms: ['win32'] },
  { combo: 'command+d', why: 'switch', platforms: ['win32', 'linux'] },
  { combo: 'shift+delete', why: 'delete', platforms: ['win32', 'linux'], apps: ['explorer', 'nautilus', 'org.gnome.Nautilus', 'dolphin', 'thunar', 'nemo', 'pcmanfm', 'caja'] },
  { combo: 'alt+command+backspace', why: 'delete', platforms: ['darwin'], apps: ['Finder', 'com.apple.finder'] },
  { combo: 'shift+command+backspace', why: 'delete', platforms: ['darwin'] },
  { combo: 'alt+shift+command+backspace', why: 'delete', platforms: ['darwin'] },
]);

/**
 * Whether a key press is a refused shortcut here. `opened`: normalized names of apps the bot opened in this session.
 * @param {{ key: string, modifiers: string[] }} k @param {string} platform @param {Active|null} active @param {Set<string>} [opened]
 * @returns {{ combo: string, why: string } | null}
 */
function shortcutVerdict(k, platform, active, opened = new Set()) {
  const combo = comboOf(k.key, k.modifiers);
  for (const s of DANGEROUS_SHORTCUTS) {
    if (s.combo !== combo) continue;
    if (s.platforms && !s.platforms.includes(platform)) continue;
    if (s.apps && !(active && s.apps.some((n) => normApp(n) === normApp(active.app) || normApp(n) === normApp(active.bundle)))) continue;
    if (s.ownApp && active && opened.has(normApp(active.app))) continue;
    return { combo, why: s.why };
  }
  return null;
}

// ── Scripts launched by a command (L32) ────────────────────────────────────
const INTERPRETERS = new Set(['sh', 'bash', 'zsh', 'dash', 'ksh', 'fish', 'csh', 'tcsh', 'python', 'python2', 'python3', 'py', 'node', 'nodejs', 'deno', 'bun', 'ruby', 'perl', 'php', 'lua', 'rscript', 'osascript', 'pwsh', 'powershell', 'tclsh', 'source', '.', 'cmd']);
const WRAPPERS = new Set(['sudo', 'env', 'nohup', 'time', 'nice', 'exec', 'command', 'builtin', 'doas', 'caffeinate', 'start']);
const SCRIPT_EXT = /\.(sh|bash|zsh|ksh|fish|command|py|pyw|rb|pl|js|mjs|cjs|ts|php|lua|r|ps1|psm1|bat|cmd|vbs|vbe|wsf|applescript|scpt|tcl)$/i;
const MAX_SCRIPTS = 3;
/** Options of an interpreter that take a value (the value is not the script). */
const OPT_WITH_VALUE = new Set(['-W', '-X', '--require', '-r', '--import', '-I', '-ExecutionPolicy', '-executionpolicy']);

/**
 * Split a command line into segments (on unquoted ; && || | & and new lines) and words. A word is "dynamic" when the
 * shell would change it ($VAR, `…`, $(…), *, ?, [, %VAR% on Windows).
 * @param {string} line @param {string} platform
 * @returns {{ text: string, dynamic: boolean }[][]}
 */
function tokenize(line, platform) {
  const win = platform === 'win32';
  /** @type {{ text: string, dynamic: boolean }[][]} */
  const segments = [[]];
  let cur = '', dyn = false, has = false, q = '';
  const push = () => { if (has) segments[segments.length - 1].push({ text: cur, dynamic: dyn }); cur = ''; dyn = false; has = false; };
  const cut = () => { push(); if (segments[segments.length - 1].length) segments.push([]); };
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === q) { q = ''; continue; }
      if (q === '"' && !win && c === '\\' && i + 1 < line.length) { cur += line[++i]; continue; }
      if (q === '"' && (c === '$' || c === '`')) dyn = true;
      if (win && c === '%') dyn = true;
      cur += c; continue;
    }
    if (c === "'" || c === '"') { q = c; has = true; continue; }
    if (!win && c === '\\' && i + 1 < line.length) { cur += line[++i]; has = true; continue; }
    if (c === ' ' || c === '\t') { push(); continue; }
    if (c === ';' || c === '\n' || c === '|' || c === '&') { cut(); continue; }
    if (c === '$' || c === '`' || c === '*' || c === '?' || c === '[' || (win && c === '%')) dyn = true;
    cur += c; has = true;
  }
  push();
  return segments.filter((s) => s.length);
}

/**
 * The script files a command line would run (L32), without running anything. `problem`: a script path only the
 * shell could resolve (variables, wildcards…), or too many scripts: the command must not run then.
 * @param {string} command @param {string} [platform] @param {number} [depth]
 * `optional`: bare names ("build.cmd") that may be programs on the PATH rather than files here: skipped when absent.
 * @returns {{ scripts: string[], optional: string[], problem?: { kind: 'dynamic'|'too_many', word: string } }}
 */
function findScripts(command, platform = process.platform, depth = 0) {
  /** @type {string[]} */
  const scripts = [];
  /** @type {string[]} */
  const optional = [];
  /** @type {{ kind: 'dynamic'|'too_many', word: string } | undefined} */
  let problem;
  const add = (/** @type {{ text: string, dynamic: boolean }} */ w) => {
    if (w.dynamic) { problem = problem || { kind: 'dynamic', word: w.text }; return; }
    if (!scripts.includes(w.text)) scripts.push(w.text);
  };
  const pathLike = (/** @type {string} */ s) => /^(\.{1,2}[\\/]|~[\\/])/.test(s) || ((/[\\/]/.test(s) || /^[a-z]:/i.test(s)) && SCRIPT_EXT.test(s)) || SCRIPT_EXT.test(s);
  for (const seg of tokenize(String(command ?? ''), platform)) {
    let i = 0;
    for (let wrapped = false; i < seg.length; i++) {
      const t = seg[i].text, low = t.toLowerCase();
      if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t) || WRAPPERS.has(low)) { wrapped = WRAPPERS.has(low) || wrapped; continue; }
      if (wrapped && t.startsWith('-')) { if (['-u', '-g', '-n'].includes(t)) i++; continue; }
      break;
    }
    if (i >= seg.length) continue;
    const first = seg[i];
    const name = normApp(first.text) === 'py' ? 'py' : first.text.replace(/\\/g, '/').split('/').pop().toLowerCase().replace(/\.exe$/, '');
    if (INTERPRETERS.has(name)) {
      for (let j = i + 1; j < seg.length; j++) {
        const w = seg[j];
        const low = w.text.toLowerCase();
        // Inline code: what runs is the command itself, already on the card; look inside it once for scripts.
        if (['-c', '/c', '/k', '-e', '-command', '-encodedcommand'].includes(low)) {
          if (low === '-encodedcommand') { problem = problem || { kind: 'dynamic', word: w.text }; break; }
          const inner = seg.slice(j + 1).map((x) => x.text).join(' ');
          if (depth < 1 && inner) { const r = findScripts(inner, platform, depth + 1); r.scripts.forEach((s) => add({ text: s, dynamic: false })); optional.push(...r.optional); if (r.problem) problem = problem || r.problem; }
          break;
        }
        if (low === '-file' || low === '-f') { if (seg[j + 1]) add(seg[j + 1]); break; }
        if (name === 'deno' || name === 'bun') { if (low === 'run' || low.startsWith('-')) continue; }
        if (low === '-m') break; // a module, not a file
        if (w.text.startsWith('-')) { if (OPT_WITH_VALUE.has(w.text)) j++; continue; }
        add(w);
        break;
      }
    } else if (pathLike(first.text) || (first.dynamic && /[\\/]/.test(first.text))) {
      add(first);
      if (!first.dynamic && !/[\\/]/.test(first.text) && !/^[a-z]:/i.test(first.text) && !optional.includes(first.text)) optional.push(first.text);
    }
  }
  if (scripts.length > MAX_SCRIPTS) problem = problem || { kind: 'too_many', word: String(scripts.length) };
  return { scripts: scripts.slice(0, MAX_SCRIPTS), optional: optional.filter((o) => scripts.slice(0, MAX_SCRIPTS).includes(o)), ...(problem ? { problem } : {}) };
}

// ── Commands always asked, whatever the rules (deterministic floor) ─────────
/**
 * Copy of server/src/agent/irreversible.ts DESTRUCTIVE_COMMAND (deletions, git rewrites, SQL drops…), then the relay's
 * own additions. Matched on the whole command line; a heuristic that only ever ADDS a question.
 */
const DESTRUCTIVE_COMMAND = [
  /(^|[;&|(`]|\$\()\s*(sudo\s+)?(rm|rmdir|shred|unlink|wipefs|mkfs(\.\w+)?|dd|truncate|del|erase|rd|format|remove-item|srm)\b/i,
  /\bgit\s+(push\b[^;&|]*\s(--force\b|-f\b|--delete\b)|reset\s+--hard\b|clean\s+-\w*f)/i,
  /\b(drop\s+(table|database|schema)|delete\s+from|truncate\s+table)\b/i,
  /\bcurl\b[^;&|]*\s-X\s*DELETE\b/i,
  /\bfind\b[^;&|]*\s-delete\b/i,
];
const AT_CMD = String.raw`(^|[;&|(\x60]|\$\()\s*`;
/** @type {ReadonlyArray<{ kind: string, re: RegExp }>} */
const FLOOR_EXTRA = Object.freeze([
  { kind: 'git', re: /\bgit\s+(branch\s+[^;&|]*-D\b|push\b[^;&|]*\s\+\S|checkout\s+--\s+\.|filter-branch\b)/i },
  { kind: 'admin', re: new RegExp(AT_CMD + String.raw`(sudo|su|runas|doas|pkexec|gsudo)\b`, 'i') },
  { kind: 'install', re: /\b(apt(-get)?|dnf|yum|zypper|pacman|apk|brew|port|snap|flatpak|choco|winget|scoop)\s+(install|reinstall|remove|uninstall|upgrade|purge|-S\w*)\b/i },
  { kind: 'install', re: /\b(npm|pnpm)\s+(i|install|add|uninstall|remove|rm)\b[^;&|]*\s(-g|--global)\b|\byarn\s+global\b|\bpip3?\s+install\b[^;&|]*\s(--user|--break-system-packages)\b|\b(gem|cargo)\s+install\b/i },
  { kind: 'disk', re: new RegExp(AT_CMD + String.raw`(diskutil|diskpart|fdisk|sfdisk|gdisk|parted|mkswap|mount|umount|losetup|cryptsetup|bcdedit|format-volume|clear-disk|initialize-disk)\b`, 'i') },
  { kind: 'perms', re: new RegExp(AT_CMD + String.raw`(chmod|chown|chgrp|icacls|takeown)\b[^;&|]*\s(-\w*R\b|--recursive\b|/t\b)[^;&|]*\s["']?(/|~|\.\.|[a-z]:\\)`, 'i') },
  { kind: 'remote_script', re: /\b(curl|wget|iwr|irm|invoke-webrequest|invoke-restmethod)\b[^;&]*\|\s*(sudo\s+)?((ba|z|da|k|fi)?sh|python3?|node|perl|ruby|iex|invoke-expression|powershell|pwsh)\b|\b(ba|z)?sh\s+<\(\s*(curl|wget)\b|\biex\s*\(\s*(iwr|irm|invoke-webrequest|invoke-restmethod|\(new-object)/i },
  { kind: 'network', re: /\bssh\b[^;&|]*\s-\w*R\b|\b(nc|ncat|netcat)\b[^;&|]*\s-\w*l|\bsocat\b[^;&|]*\b(tcp|udp)\d?-listen\b|(^|[;&|(\s])(ngrok|cloudflared|localtunnel|lt|bore|frpc|serveo)\b|\btailscale\s+(funnel|serve)\b/i },
  { kind: 'startup', re: /(\.bashrc|\.bash_profile|\.bash_login|\.profile|\.zshrc|\.zprofile|\.zshenv|\.zlogin|config\.fish|powershell_profile\.ps1|\$profile\b|\.config\/autostart|launchagents|launchdaemons|\bcrontab\b|\/etc\/|\\startup\\|currentversion\\run)/i },
  { kind: 'outside', re: /(^|[^\d&])>{1,2}\s*["']?(\/(?!dev\/null\b)|~|\.\.|[a-z]:\\|\$home\b|%userprofile%)/i },
  { kind: 'outside', re: /\b(tee|cp|mv|touch|mkdir|ln|install|rsync|scp|xcopy|robocopy|copy|move|copy-item|move-item|set-content|out-file|new-item)\b[^;&|]*\s["']?(\/(?!dev\/null\b)|~|\.\.|[a-z]:\\|\$home\b|%userprofile%)/i },
]);

const normFolder = (/** @type {string} */ p) => lowerPath(String(p || '')).replace(/^~(?=\/|$)/, '~');
/** Whether a folder is one of the owner's project folders or inside one (as written: the relay checks real paths too). */
function inProjects(/** @type {string} */ cwd, /** @type {string[]} */ projects) {
  const c = normFolder(cwd);
  return projects.some((p) => { const n = normFolder(p); return !!n && (c === n || c.startsWith(n + '/')); });
}

/**
 * Why a command must be asked every time, or null: a deletion or a git rewrite (irreversible.ts), administrator rights,
 * a system-wide install, a disk tool, recursive permissions outside the project, a script downloaded into a shell, a
 * network listener or tunnel, a shell startup file, writing outside the working folder, or a working folder outside
 * the owner's project folders.
 * @param {string} command @param {string} cwd @param {string[]} [projects]
 * @returns {{ kind: string } | null}
 */
function commandFloor(command, cwd, projects = []) {
  const c = String(command ?? '');
  if (DESTRUCTIVE_COMMAND.some((re) => re.test(c))) return { kind: 'delete' };
  for (const f of FLOOR_EXTRA) if (f.re.test(c)) return { kind: f.kind };
  if (cwd && projects.length && !inProjects(cwd, projects)) return { kind: 'outside' };
  return null;
}

/**
 * The part of a command an "Always" or "for this conversation" answer covers: the program and its first plain words
 * (`npm test`, `git status`, `python manage.py`; `npm run dev`). A line with several commands (; && | …) is covered
 * only as a whole, word for word.
 * @param {string} command
 */
function commandPrefix(command) {
  const c = String(command ?? '').trim().replace(/\s+/g, ' ');
  if (/[;&|`\n<>]|\$\(/.test(c)) return c.slice(0, 300);
  const words = c.split(' ');
  const out = [words[0]];
  const max = /^(npm|pnpm|yarn|bun|npx)$/i.test(words[0]) && /^(run|exec|x|dlx)$/i.test(words[1] || '') ? 3 : 2;
  for (let i = 1; i < words.length && out.length < max; i++) {
    if (!/^[A-Za-z0-9][\w.:@-]*$/.test(words[i])) break;
    out.push(words[i]);
  }
  return out.join(' ').slice(0, 120);
}

// ── Vault fill on this computer ─────────────────────────────────────────────
/** Web browsers: a saved login only goes into the page of its own site (the address read from the browser). */
const BROWSERS = Object.freeze(['Google Chrome', 'Chrome', 'Chromium', 'Firefox', 'Safari', 'Microsoft Edge', 'msedge', 'Brave Browser', 'brave', 'Opera', 'Vivaldi', 'Arc', 'com.google.Chrome', 'com.apple.Safari', 'org.mozilla.firefox', 'com.microsoft.edgemac', 'com.brave.Browser', 'company.thebrowser.Browser', 'google-chrome', 'chromium-browser', 'firefox-esr']);
const BROWSER_SET = new Set(BROWSERS.map(normApp));
/** @param {Active} a */
const isBrowser = (a) => BROWSER_SET.has(normApp(a.app)) || BROWSER_SET.has(normApp(a.bundle));

/** "https://login.example.com/x" or "example.com" → "login.example.com". @param {unknown} s */
function hostOf(s) {
  const v = String(s ?? '').trim().toLowerCase();
  if (!v) return '';
  try { return new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(v) ? v : `https://${v}`).hostname.replace(/^www\./, ''); } catch { return ''; }
}
/** The page host is the saved site or one of its subdomains. @param {string} here @param {string} wanted */
const sameSite = (here, wanted) => !!here && !!wanted && (here === wanted || here.endsWith('.' + wanted));

/**
 * Whether a saved item may be typed into the window in front: a browser must show a page of the item's site (address
 * read from the browser), an app must be the app the item names; a password only into a field the system reports as
 * a password field, a username or a one-time code never into one. Returns null when it may, else the refusal code.
 * @param {Active & { url?: string|null }} a @param {{ site: string, field: 'username'|'password'|'code' }} item
 */
function vaultVerdict(a, item) {
  if (deniedGroup(a)) return 'blocked_app';
  if (isBrowser(a)) {
    const here = hostOf(a.url);
    if (!here) return 'host_unknown';
    if (!sameSite(here, hostOf(item.site))) return 'host_mismatch';
  } else if (!normApp(item.site) || (normApp(item.site) !== normApp(a.app) && normApp(item.site) !== normApp(a.bundle))) return 'app_mismatch';
  if (item.field === 'password' && a.passwordField !== true) return 'not_password_field';
  if (item.field !== 'password' && a.passwordField === true) return 'password_field';
  return null;
}

class GuardError extends Error {
  /** @param {string} code @param {string} message */
  constructor(code, message) { super(message); this.code = code; }
}

const PEEK_MAX_BYTES = 1024 * 1024;
const PEEK_LINES = 40;

/** Files that typically hold secrets: never read for a card. */
const SECRET_FILE = /^(\.env(\..*)?|id_(rsa|dsa|ecdsa|ed25519)(\.pub)?|credentials(\.json)?|\.?netrc|wallet\.dat|key4\.db|\.?npmrc|\.?pgpass)$|\.(pem|key|p12|pfx|jks|keystore|kdbx|kdb|gpg|pgp|ovpn|ppk)$/i;

/**
 * Reads a script for the command card: never runs it. Only a regular text file inside the command's folder (or the
 * home folder), not a secret, not in a keep-out folder, 1 MiB at most. Returns its first 40 lines and its SHA-256.
 * @param {{ path: string, cwd?: string|null, home?: string, keepFolders?: string[] }} a
 * @returns {{ path: string, sha256: string, size: number, lines: string[], more: number, binary: boolean }}
 */
function peekScript(a) {
  const home = path.resolve(a.home || os.homedir());
  let base = home;
  if (a.cwd) {
    const c = a.cwd.startsWith('~/') ? path.join(home, a.cwd.slice(2)) : a.cwd;
    try { if (fs.statSync(c).isDirectory()) base = path.resolve(c); } catch { /* home */ }
  }
  const raw = String(a.path || '');
  const abs = raw.startsWith('~/') || raw.startsWith('~\\') ? path.join(home, raw.slice(2)) : path.resolve(base, raw);
  let real, realBase, realHome;
  try { real = fs.realpathSync(abs); } catch { throw new GuardError('not_found', 'script not found'); }
  try { realBase = fs.realpathSync(base); realHome = fs.realpathSync(home); } catch { throw new GuardError('forbidden', 'folder not found'); }
  const inside = (/** @type {string} */ root) => real === root || real.startsWith(root.endsWith(path.sep) ? root : root + path.sep);
  if (!inside(realBase) && !inside(realHome)) throw new GuardError('forbidden', 'the script is outside the command folder and the home folder: not read');
  if (SECRET_FILE.test(path.basename(real))) throw new GuardError('forbidden', 'a file that typically holds secrets: not read');
  if (inKeepOutFolder(real, a.keepFolders || [])) throw new GuardError('forbidden', 'in a folder the owner keeps out of reach');
  const st = fs.statSync(real);
  if (!st.isFile()) throw new GuardError('not_found', 'not a file');
  if (st.size > PEEK_MAX_BYTES) throw new GuardError('too_large', 'script too large to show (1 MiB at most)');
  const data = fs.readFileSync(real);
  const sha256 = crypto.createHash('sha256').update(data).digest('hex');
  const binary = data.subarray(0, 8192).includes(0);
  const all = binary ? [] : data.toString('utf8').split(/\r?\n/);
  if (all.length && all[all.length - 1] === '') all.pop();
  return { path: real, sha256, size: st.size, lines: all.slice(0, PEEK_LINES).map((l) => (l.length > 200 ? l.slice(0, 200) + '…' : l)), more: Math.max(0, all.length - PEEK_LINES), binary };
}

/** SHA-256 of a script as it is right now (null when it cannot be read). @param {{ path: string, cwd?: string|null, home?: string, keepFolders?: string[] }} a */
function scriptHash(a) {
  try { return peekScript(a).sha256; } catch { return null; }
}

/** The owner's rules as the server sent them (guard.set), checked and capped. @param {any} raw @returns {OwnerGuard} */
function parseOwnerGuard(raw) {
  const list = (/** @type {unknown} */ v) => (Array.isArray(v) ? v : []).filter((x) => typeof x === 'string').map((x) => x.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 200)).filter(Boolean).slice(0, 50);
  // Commands are on by default on the owner's own computer (owner decision); only an explicit `false` turns them off.
  return { keepApps: list(raw && raw.keepApps), keepFolders: list(raw && raw.keepFolders), projectFolders: list(raw && raw.projectFolders), terminal: !(raw && raw.terminal === false) };
}

module.exports = {
  DENIED_APPS, DANGEROUS_SHORTCUTS, LOGIN_TITLE, PEEK_LINES, normApp, deniedGroup, deniedName, keepOutHit, inKeepOutFolder, passwordRisk, sameWindow,
  comboOf, shortcutVerdict, tokenize, findScripts, peekScript, scriptHash, parseOwnerGuard, GuardError,
  DESTRUCTIVE_COMMAND, FLOOR_EXTRA, commandFloor, commandPrefix, inProjects, BROWSERS, isBrowser, hostOf, sameSite, vaultVerdict,
};
