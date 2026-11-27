'use strict';
/* Safety rules of the relay on the user's computer (guard.js, relay-core.js; backlog L19 / L32). */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const G = require('../../src/main/guard');
const F = require('../../src/main/capabilities/foreground');
const { makeCore } = require('./helpers');

const TERMINAL = { app: 'gnome-terminal-server', bundle: 'gnome-terminal-server', pid: 7, windowId: '0x9', title: 'lea@pc: ~', passwordField: false };

test('refused apps: terminals, settings, password managers, Sklubot itself; ordinary apps pass', () => {
  assert.equal(G.deniedGroup({ app: 'Terminal', bundle: 'com.apple.Terminal' }), 'terminal');
  assert.equal(G.deniedGroup({ app: 'WindowsTerminal' }), 'terminal');
  assert.equal(G.deniedGroup({ app: 'powershell.exe' }), 'terminal');
  assert.equal(G.deniedGroup({ app: 'System Settings', bundle: 'com.apple.systempreferences' }), 'settings');
  assert.equal(G.deniedGroup({ app: 'SystemSettings' }), 'settings');
  assert.equal(G.deniedGroup({ app: '1Password' }), 'passwords');
  assert.equal(G.deniedGroup({ app: 'KeePassXC' }), 'passwords');
  assert.equal(G.deniedGroup({ app: 'regedit' }), 'scripts');
  assert.equal(G.deniedGroup({ app: 'firefox', title: 'Sklubot — Léa' }), 'self', 'the Sklubot web app in a browser');
  assert.equal(G.deniedGroup({ app: 'TextEdit', title: 'Notes' }), null);
  assert.equal(G.deniedName('Terminal — bash — 80×24'), 'terminal', 'a window title');
  assert.equal(G.deniedName('Calculator'), null);
  assert.equal(G.deniedName('Version control - Code'), null, 'everyday words are not app names');
});

test('keep-out list: apps by name or title word, folders by path or name in the title', () => {
  const g = { keepApps: ['Banque Populaire', 'Signal'], keepFolders: ['/home/lea/Impots', 'Medical'], terminal: false };
  assert.equal(G.keepOutHit({ app: 'Signal', title: 'Signal' }, g), 'Signal');
  assert.equal(G.keepOutHit({ app: 'firefox', title: 'Banque Populaire — Mon compte' }, g), 'Banque Populaire');
  assert.equal(G.keepOutHit({ app: 'nautilus', title: 'Impots' }, g), '/home/lea/Impots');
  assert.equal(G.keepOutHit({ app: 'gedit', title: '~/Medical/scan.txt - gedit' }, g), 'Medical');
  assert.equal(G.keepOutHit({ app: 'gedit', title: 'notes.txt' }, g), null);
  assert.equal(G.inKeepOutFolder('/home/lea/Impots/2025/a.sh', g.keepFolders), '/home/lea/Impots');
  assert.equal(G.inKeepOutFolder('/home/lea/Docs/Medical/x', g.keepFolders), 'Medical');
  assert.equal(G.inKeepOutFolder('/home/lea/Docs/x', g.keepFolders), null);
});

test('dangerous shortcuts: the explicit list, per platform, closing allowed only on an app the bot opened', () => {
  const k = (s) => { const { parseKey } = require('../../src/main/protocol'); return parseKey(s); };
  assert.deepEqual(G.shortcutVerdict(k('alt+f4'), 'win32', { app: 'notepad' }), { combo: 'alt+f4', why: 'close' });
  assert.equal(G.shortcutVerdict(k('alt+f4'), 'win32', { app: 'notepad' }, new Set(['notepad'])), null, 'its own app');
  assert.deepEqual(G.shortcutVerdict(k('cmd+q'), 'darwin', { app: 'Mail' }), { combo: 'command+q', why: 'close' });
  assert.deepEqual(G.shortcutVerdict(k('ctrl+alt+del'), 'linux', null), { combo: 'control+alt+delete', why: 'system' });
  assert.deepEqual(G.shortcutVerdict(k('win+r'), 'win32', null), { combo: 'command+r', why: 'launcher' });
  assert.equal(G.shortcutVerdict(k('cmd+r'), 'darwin', null), null, '⌘R reloads a page on a Mac');
  assert.deepEqual(G.shortcutVerdict(k('cmd+space'), 'darwin', null), { combo: 'command+space', why: 'launcher' });
  assert.deepEqual(G.shortcutVerdict(k('win+l'), 'win32', null), { combo: 'command+l', why: 'lock' });
  assert.deepEqual(G.shortcutVerdict(k('ctrl+alt+f3'), 'linux', null), { combo: 'control+alt+f3', why: 'system' });
  assert.deepEqual(G.shortcutVerdict(k('shift+delete'), 'win32', { app: 'explorer' }), { combo: 'shift+delete', why: 'delete' });
  assert.equal(G.shortcutVerdict(k('shift+delete'), 'win32', { app: 'WINWORD' }), null, 'cut in a text editor');
  assert.equal(G.shortcutVerdict(k('ctrl+c'), 'linux', null), null);
});

test('scripts a command launches: interpreters, paths, wrappers, chains, inline code; dynamic paths are a problem', () => {
  assert.deepEqual(G.findScripts('bash run.sh', 'linux').scripts, ['run.sh']);
  assert.deepEqual(G.findScripts('./deploy.sh --prod', 'linux').scripts, ['./deploy.sh']);
  assert.deepEqual(G.findScripts('sudo -u bob python3 -u tools/x.py arg', 'linux').scripts, ['tools/x.py']);
  assert.deepEqual(G.findScripts('cd app && npm test && sh ./b.sh', 'linux').scripts, ['./b.sh']);
  assert.deepEqual(G.findScripts('bash -c "source ~/env.sh; ls"', 'linux').scripts, ['~/env.sh']);
  assert.deepEqual(G.findScripts('python -m http.server', 'linux').scripts, []);
  assert.deepEqual(G.findScripts('ls -la ~/Documents', 'linux').scripts, []);
  assert.deepEqual(G.findScripts('powershell -ExecutionPolicy Bypass -File C:\\scripts\\a.ps1', 'win32').scripts, ['C:\\scripts\\a.ps1']);
  assert.deepEqual(G.findScripts('cmd /c build.bat', 'win32'), { scripts: ['build.bat'], optional: ['build.bat'] });
  assert.equal(G.findScripts('bash $HOME/x.sh', 'linux').problem.kind, 'dynamic');
  assert.equal(G.findScripts('sh ./a.sh; sh ./b.sh; sh ./c.sh; sh ./d.sh', 'linux').problem.kind, 'too_many');
});

test('peeking a script: 40 lines and SHA-256, inside the folder only, never a secret or a keep-out folder', () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-home-'));
  fs.mkdirSync(path.join(home, 'proj'));
  fs.writeFileSync(path.join(home, 'proj', 'run.sh'), Array.from({ length: 55 }, (_, i) => `echo ${i}`).join('\n') + '\n');
  fs.writeFileSync(path.join(home, 'proj', 'id_rsa'), 'secret');
  const p = G.peekScript({ path: 'run.sh', cwd: path.join(home, 'proj'), home });
  assert.equal(p.lines.length, 40);
  assert.equal(p.more, 15);
  assert.match(p.sha256, /^[0-9a-f]{64}$/);
  assert.throws(() => G.peekScript({ path: 'id_rsa', cwd: path.join(home, 'proj'), home }), /secrets/);
  assert.throws(() => G.peekScript({ path: '/etc/hostname', home }), (e) => e.code === 'forbidden' || e.code === 'not_found');
  assert.throws(() => G.peekScript({ path: 'run.sh', cwd: path.join(home, 'proj'), home, keepFolders: ['proj'] }), /keeps out/);
  assert.throws(() => G.peekScript({ path: 'nope.sh', cwd: path.join(home, 'proj'), home }), (e) => e.code === 'not_found');
});

test('foreground parsers (macOS, Windows, X11)', () => {
  assert.deepEqual(F.parseMac('Safari\ncom.apple.Safari\n512\nConnexion\nAXSecureTextField\n'), { app: 'Safari', bundle: 'com.apple.Safari', pid: 512, windowId: null, title: 'Connexion', passwordField: true });
  assert.equal(F.parseWin('{"app":"notepad","pid":12,"windowId":"6553","title":"a.txt","password":false}').passwordField, false);
  assert.equal(F.parseWin('{"app":"chrome","pid":12,"windowId":"6553","title":"x","password":null}').passwordField, null);
  assert.equal(F.parseWin('not json'), null);
  assert.equal(F.parseXpropRoot('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x3a00007'), '0x3a00007');
  assert.equal(F.parseXpropRoot('_NET_ACTIVE_WINDOW(WINDOW): window id # 0x0'), null);
  const w = F.parseXpropWindow('WM_CLASS(STRING) = "gnome-terminal-server", "Gnome-terminal"\n_NET_WM_NAME(UTF8_STRING) = "lea@pc: ~"\n_NET_WM_PID(CARDINAL) = 4242\n', '0x3a00007');
  assert.deepEqual(w, { app: 'Gnome-terminal', bundle: 'gnome-terminal-server', pid: 4242, windowId: '0x3a00007', title: 'lea@pc: ~', passwordField: null });
  assert.equal(G.deniedGroup(w), 'terminal');
});

// ── RelayCore: the same rules enforced on the computer, whatever the server sends ──
async function inSession(opts) {
  const h = makeCore({ ...opts, answers: { session: 'once', ...(opts.answers || {}) } });
  assert.equal((await h.req('session.start')).ok, true);
  return h;
}
const did = (h, name) => h.calls.filter((c) => c.name === name).length;

test('core: typing into a password field is refused; a sign-in window with unknown focus too; tab still works', async () => {
  const h = await inSession({ active: { app: 'firefox', pid: 3, title: 'Mail', passwordField: true } });
  assert.equal((await h.req('keyboard.type', { text: 'hunter2' })).error.code, 'password_field');
  assert.equal((await h.req('keyboard.press', { key: 'ctrl+v' })).error.code, 'password_field');
  assert.equal((await h.req('keyboard.press', { key: 'tab' })).ok, true, 'moving out of the field');
  h.fg.current = { app: 'firefox', pid: 3, title: 'Connexion — Ma banque', passwordField: null };
  assert.equal((await h.req('keyboard.type', { text: 'x' })).error.code, 'password_field');
  assert.equal(did(h, 'keyType'), 0);
});

test('core: refused apps in front, keep-out windows, unknown foreground (fail closed), window changed since the server looked', async () => {
  const h = await inSession({ active: { app: '1Password', pid: 9, title: '1Password' } });
  assert.equal((await h.req('mouse.click', { x: 1, y: 1 })).error.code, 'blocked_app');
  h.fg.current = null;
  assert.equal((await h.req('mouse.click', { x: 1, y: 1 })).error.code, 'foreground_unknown');
  h.fg.current = { app: 'firefox', pid: 3, title: 'Banque Populaire' };
  await h.req('guard.set', { keepApps: ['Banque Populaire'], keepFolders: [] });
  assert.equal((await h.req('keyboard.type', { text: 'x' })).error.code, 'keep_out');
  h.fg.current = { app: 'gedit', pid: 4, windowId: '0x2', title: 'a.txt' };
  assert.equal((await h.req('keyboard.type', { text: 'x', expect: { app: 'firefox', pid: 3 } })).error.code, 'window_changed');
  assert.equal((await h.req('keyboard.type', { text: 'x', expect: { app: 'gedit', pid: 4, windowId: '0x2' } })).ok, true);
  assert.equal((await h.req('app.open', { name: 'Terminal' })).error.code, 'blocked_app', 'terminals off by default');
  assert.equal((await h.req('app.open', { name: 'KeePassXC' })).error.code, 'blocked_app');
  assert.equal((await h.req('window.focus', { title: 'Banque Populaire' })).error.code, 'keep_out');
  assert.equal(did(h, 'mouseClick') + did(h, 'openApp') + did(h, 'focusWindow'), 0);
});

test('core: terminal windows stay refused for clicks and typing (commands go through shell.run); commands on by default, off when the owner says so', async () => {
  const h = await inSession({ active: TERMINAL, answers: { command: { decision: 'run' } } });
  assert.equal((await h.req('keyboard.type', { text: 'ls' })).error.code, 'blocked_app');
  assert.equal((await h.req('app.open', { name: 'Terminal' })).error.code, 'blocked_app');
  assert.equal((await h.req('shell.run', { command: 'echo hi' })).ok, true, 'on by default');
  await h.req('guard.set', { keepApps: [], keepFolders: [], terminal: false });
  assert.equal((await h.req('shell.run', { command: 'echo hi' })).error.code, 'terminal_off');
});

test('core: project folder by default, keep-out folder refused, background commands started, read and stopped, output streamed', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-proj-'));
  const h = await inSession({ answers: { command: { decision: 'run' } } });
  await h.req('guard.set', { keepApps: [], keepFolders: ['/home/lea/Impots'], projectFolders: [dir] });
  await h.req('shell.run', { command: 'echo hi', streamRef: 'ref1' });
  assert.equal(h.calls.find((c) => c.name === 'runShell').args.cwd, dir, 'runs in the project folder');
  assert.equal((await h.req('shell.run', { command: 'ls', cwd: '/home/lea/Impots/2025' })).error.code, 'keep_out');
  assert.equal((await h.req('shell.run', { command: 'cat /home/lea/Impots/a.txt' })).error.code, 'keep_out');
  const started = await h.req('shell.start', { command: 'npm run dev' });
  assert.equal(started.ok, true);
  const jobId = started.result.jobId;
  await new Promise((r) => setTimeout(r, 20));
  const read = await h.req('shell.read', { jobId });
  assert.equal(read.result.running, false, 'the fake finished at once');
  assert.equal((await h.req('shell.stop', { jobId })).ok, true);
  assert.equal((await h.req('shell.read', { jobId: 'j99' })).error.code, 'not_found');
  // A command outside the project folders is on the floor: asked every time.
  h.prompts.length = 0;
  await h.req('shell.run', { command: 'ls', cwd: '/srv/other' });
  assert.equal(h.prompts[0]?.floor, 'outside');
});

test('core: output is streamed to Sklubot as shell.output events (grouped, capped)', async () => {
  const h = await inSession({ answers: { command: { decision: 'run' } } });
  const r = h.core.outputStream('ref9');
  r('stdout', 'bonjour '); r('stdout', 'le monde'); r('stderr', 'attention');
  r.flush();
  const ev = h.sent.filter((m) => m.type === 'event' && m.name === 'shell.output');
  assert.deepEqual(ev.map((e) => [e.ref, e.stream, e.text]), [['ref9', 'stdout', 'bonjour le monde'], ['ref9', 'stderr', 'attention']]);
});

test('core: vault fill types only after its own checks (same window, site, password field) and never logs the text', async () => {
  const page = { app: 'Google Chrome', pid: 5, windowId: '0x5', title: 'Connexion', passwordField: true, url: 'https://login.example.com/session' };
  const h = await inSession({ active: page });
  const expect = { app: 'Google Chrome', pid: 5, windowId: '0x5' };
  const ok = await h.req('vault.type', { text: 's3cret-pw', field: 'password', site: 'example.com', expect });
  assert.equal(ok.ok, true, JSON.stringify(ok));
  assert.equal(h.calls.find((c) => c.name === 'keyType').args.text, 's3cret-pw');
  assert.equal((await h.req('vault.type', { text: 's3cret-pw', field: 'password', site: 'other.com', expect })).error.code, 'host_mismatch');
  assert.equal((await h.req('vault.type', { text: 's3cret-pw', field: 'password', site: 'example.com', expect: { ...expect, pid: 6 } })).error.code, 'window_changed');
  assert.equal((await h.req('vault.type', { text: 'lea', field: 'username', site: 'example.com', expect })).error.code, 'password_field');
  h.fg.current = { ...page, url: null };
  assert.equal((await h.req('vault.type', { text: 's3cret-pw', field: 'password', site: 'example.com', expect })).error.code, 'host_unknown');
  h.fg.current = { ...page, passwordField: false };
  assert.equal((await h.req('vault.type', { text: 's3cret-pw', field: 'password', site: 'example.com', expect })).error.code, 'not_password_field');
  h.fg.current = { app: 'Spotify', pid: 5, windowId: '0x5', title: 'Spotify', passwordField: true };
  assert.equal((await h.req('vault.type', { text: 'x', field: 'password', site: 'example.com', expect: { app: 'Spotify', pid: 5, windowId: '0x5' } })).error.code, 'app_mismatch');
  assert.ok(!JSON.stringify(h.logs).includes('s3cret-pw'), 'never in the local action log');
  assert.ok(!JSON.stringify(h.sent).includes('s3cret-pw'), 'never sent back');
});

test('core: dangerous shortcuts refused; forced ones need a yes on the computer; closing the bot\'s own app is fine', async () => {
  const h = await inSession({ platform: 'win32', active: { app: 'notepad', pid: 5, title: 'a.txt - Notepad' }, answers: { guard: 'refuse' } });
  assert.equal((await h.req('keyboard.press', { key: 'win+r' })).error.code, 'blocked_shortcut');
  assert.equal((await h.req('keyboard.press', { key: 'alt+f4' })).error.code, 'blocked_shortcut');
  assert.equal((await h.req('keyboard.press', { key: 'win+l', force: true })).error.code, 'blocked_shortcut', 'refused on the computer');
  assert.equal(h.prompts.filter((p) => p.kind === 'guard:shortcut').length, 1);
  assert.equal(did(h, 'keyPress'), 0);
  await h.req('app.open', { name: 'notepad' });
  assert.equal((await h.req('keyboard.press', { key: 'alt+f4' })).ok, true, 'the app it opened');
  assert.equal((await h.req('keyboard.press', { key: 'ctrl+s' })).ok, true);
});

test('core: held keys and buttons are released when the session ends, on Stop and on disconnect', async () => {
  const h = await inSession({});
  await h.req('session.end');
  assert.equal(did(h, 'releaseAll'), 1);
  await h.req('session.start');
  h.core.stop('user');
  assert.equal(did(h, 'releaseAll'), 2);
  h.core.onDisconnected();
  assert.ok(did(h, 'releaseAll') >= 3);
});

test('core: a command running a script shows 40 lines + hash, always asks, refuses if it changed before the click or differs from the card', async () => {
  const dir = fs.mkdtempSync(path.join(os.homedir(), '.sklubot-guard-test-'));
  try {
    const file = path.join(dir, 'run.sh');
    fs.writeFileSync(file, 'echo bonjour\n');
    const sha = G.peekScript({ path: file }).sha256;
    // "always" for this bot's commands does not cover a script.
    const h = await inSession({ perms: { bot_a: { name: 'Alice', commands: true } }, answers: { command: { decision: 'run' } } });
    assert.equal((await h.req('shell.run', { command: 'bash run.sh', cwd: dir })).ok, true);
    const asked = h.prompts.find((p) => p.kind === 'command');
    assert.ok(asked, 'asked despite "always"');
    assert.deepEqual(asked.scripts[0].lines, ['echo bonjour']);
    assert.equal(asked.scripts[0].sha256, sha);
    // Changed while the question was open.
    const h2 = await inSession({ answers: { command: () => { fs.writeFileSync(file, 'rm -rf ~\n'); return Promise.resolve({ decision: 'run' }); } } });
    assert.equal((await h2.req('shell.run', { command: 'bash run.sh', cwd: dir })).error.code, 'script_changed');
    assert.equal(did(h2, 'runShell'), 0);
    // Not the one the owner saw on Sklubot's card.
    const h3 = await inSession({ answers: { command: { decision: 'run' } } });
    assert.equal((await h3.req('shell.run', { command: 'bash run.sh', cwd: dir, scripts: [{ path: 'run.sh', sha256: sha } ] })).error.code, 'script_changed');
    assert.equal((await h3.req('script.peek', { path: 'run.sh', cwd: dir })).result.lines[0], 'rm -rf ~');
    assert.equal((await h3.req('shell.run', { command: 'bash $X/run.sh', cwd: dir })).error.code, 'script_unreadable');
    assert.equal(did(h3, 'runShell'), 0);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});
