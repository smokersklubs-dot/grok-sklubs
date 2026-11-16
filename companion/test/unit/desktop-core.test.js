'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const d = require('../../src/main/desktop-core');
const { AppSettings } = require('../../src/main/app-settings');

test('server address: https required except on this computer; only the origin is kept', () => {
  assert.deepEqual(d.normalizeAppServer('https://sklubot.sklubs.fr'), { origin: 'https://sklubot.sklubs.fr', url: 'https://sklubot.sklubs.fr/' });
  assert.equal(d.normalizeAppServer('  sklubot.example.com/chat?x=1#y ').origin, 'https://sklubot.example.com');
  assert.equal(d.normalizeAppServer('https://Sklubot.Example.com:8443/').origin, 'https://sklubot.example.com:8443');
  assert.equal(d.normalizeAppServer('http://localhost:8899').origin, 'http://localhost:8899');
  assert.equal(d.normalizeAppServer('http://127.0.0.1:3000').origin, 'http://127.0.0.1:3000');
  assert.equal(d.normalizeAppServer('http://[::1]:3000').origin, 'http://[::1]:3000');
  for (const [bad, code] of [['http://sklubot.example.com', 'insecure'], ['http://192.168.1.2', 'insecure'], ['', 'invalid'], ['ftp://x.fr', 'invalid'], ['javascript:alert(1)', 'invalid'], ['file:///etc/passwd', 'invalid'], ['https://user:pw@x.fr', 'invalid'], ['https://', 'invalid']]) {
    assert.throws(() => d.normalizeAppServer(bad), (e) => e.code === code, bad);
  }
});

test('origin checks: scheme, host and port must all match', () => {
  const o = 'https://sklubot.sklubs.fr';
  assert.ok(d.sameOrigin('https://sklubot.sklubs.fr/chat?bot=1', o));
  assert.ok(!d.sameOrigin('http://sklubot.sklubs.fr/', o));
  assert.ok(!d.sameOrigin('https://sklubot.sklubs.fr:444/', o));
  assert.ok(!d.sameOrigin('https://evil.sklubot.sklubs.fr/', o));
  assert.ok(!d.sameOrigin('https://sklubot.sklubs.fr.evil.com/', o));
  assert.ok(!d.sameOrigin('about:blank', o));
  assert.ok(!d.sameOrigin('data:text/html,hi', o));
  assert.ok(!d.sameOrigin('https://sklubot.sklubs.fr/', null));
});

test('external links: web pages and e-mail only', () => {
  assert.ok(d.externalAllowed('https://github.com/x'));
  assert.ok(d.externalAllowed('http://example.com/'));
  assert.ok(d.externalAllowed('mailto:a@b.fr'));
  for (const bad of ['file:///etc/passwd', 'javascript:alert(1)', 'smb://host/share', 'sklubot://relay', 'ms-settings:privacy', 'https://u:p@x.fr', 'not a url', `https://x.fr/${'a'.repeat(9000)}`]) {
    assert.ok(!d.externalAllowed(bad), bad);
  }
});

test('permissions: only the server origin, only the listed ones, microphone without camera', () => {
  const o = 'https://sklubot.sklubs.fr';
  const page = 'https://sklubot.sklubs.fr/';
  for (const p of ['notifications', 'clipboard-read', 'clipboard-sanitized-write', 'fullscreen']) assert.ok(d.permissionAllowed(p, page, o), p);
  assert.ok(d.permissionAllowed('media', page, o, { mediaTypes: ['audio'] }));
  assert.ok(!d.permissionAllowed('media', page, o, { mediaTypes: ['video'] }));
  assert.ok(!d.permissionAllowed('media', page, o, { mediaTypes: ['audio', 'video'] }));
  assert.ok(!d.permissionAllowed('media', page, o, { mediaTypes: [] }));
  assert.ok(d.permissionAllowed('media', page, o, { mediaType: 'audio' }));
  assert.ok(!d.permissionAllowed('media', page, o, { mediaType: 'video' }));
  for (const p of ['geolocation', 'display-capture', 'openExternal', 'usb', 'hid', 'serial', 'midiSysex', 'unknown']) assert.ok(!d.permissionAllowed(p, page, o), p);
  assert.ok(!d.permissionAllowed('notifications', 'https://evil.example/', o));
  assert.ok(!d.permissionAllowed('notifications', undefined, o));
  assert.ok(!d.permissionAllowed('notifications', page, null));
});

test('versions and the newest desktop release', () => {
  assert.ok(d.compareVersions('1.0.1', '1.0.0') > 0);
  assert.ok(d.compareVersions('1.10.0', '1.9.9') > 0);
  assert.ok(d.compareVersions('1.0.0', '1.0.0-beta.1') > 0);
  assert.equal(d.compareVersions('v2.0.0', '2.0.0'), 0);
  assert.equal(d.compareVersions('garbage', '1.0.0'), 0);
  const rel = d.latestDesktopRelease([
    { tag_name: 'relais-v9.0.0', html_url: 'https://github.com/o/r/releases/tag/relais-v9.0.0' },
    { tag_name: 'desktop-v1.2.0', html_url: 'https://github.com/o/r/releases/tag/desktop-v1.2.0' },
    { tag_name: 'desktop-v1.3.0', draft: true },
    { tag_name: 'desktop-v1.4.0-beta.1', prerelease: true },
    { tag_name: 'desktop-v1.1.9', html_url: 'https://evil.example/' },
  ]);
  assert.deepEqual(rel, { version: '1.2.0', url: 'https://github.com/o/r/releases/tag/desktop-v1.2.0' });
  assert.equal(d.latestDesktopRelease({ message: 'rate limited' }), null);
});

test('badge count is clamped; garbage is ignored', () => {
  assert.equal(d.badgeCount(3), 3);
  assert.equal(d.badgeCount(-4), 0);
  assert.equal(d.badgeCount(2.7), 2);
  assert.equal(d.badgeCount(1e9), 9999);
  for (const bad of ['3', null, undefined, NaN, Infinity, {}]) assert.equal(d.badgeCount(bad), null);
});

test('window rectangle kept only when still on a screen', () => {
  const screens = [{ x: 0, y: 0, width: 1920, height: 1080 }];
  assert.deepEqual(d.visibleBounds({ x: 100, y: 80, width: 1200, height: 800 }, screens), { x: 100, y: 80, width: 1200, height: 800 });
  assert.equal(d.visibleBounds({ x: 3000, y: 80, width: 1200, height: 800 }, screens), null);
  assert.equal(d.visibleBounds({ x: 0, y: 0, width: 100, height: 100 }, screens), null);
  assert.equal(d.visibleBounds(null, screens), null);
});

test('migration from the former "Sklubot Relais" folder: copied once, never overwrites, old folder untouched', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sklubot-mig-'));
  const oldDir = path.join(root, 'Sklubot Relais');
  const newDir = path.join(root, 'Sklubot');
  fs.mkdirSync(path.join(oldDir, 'logs'), { recursive: true });
  const settings = JSON.stringify({ version: 1, server: 'https://x.fr', bots: { b1: { name: 'Alice', control: 'always' } }, folders: [] });
  fs.writeFileSync(path.join(oldDir, 'relais.json'), settings);
  fs.writeFileSync(path.join(oldDir, 'logs', 'actions.log'), '{"kind":"paired"}\n');
  assert.equal(d.migrateRelaisDir(oldDir, newDir), true);
  assert.equal(fs.readFileSync(path.join(newDir, 'relais.json'), 'utf8'), settings);
  assert.ok(fs.existsSync(path.join(newDir, 'logs', 'actions.log')));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(newDir, 'relais.json')).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(oldDir, 'relais.json'), '{"changed":true}');
  assert.equal(d.migrateRelaisDir(oldDir, newDir), false, 'never twice');
  assert.equal(fs.readFileSync(path.join(newDir, 'relais.json'), 'utf8'), settings);
  assert.equal(d.migrateRelaisDir(path.join(root, 'none'), path.join(root, 'n2')), false);
  assert.equal(d.migrateRelaisDir(newDir, newDir), false);
});

test('window settings file: defaults, round trip, 0600, never the relay file', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sklubot-app-'));
  const s = new AppSettings(dir).load();
  assert.equal(s.server, null);
  s.setServer('https://sklubot.sklubs.fr');
  s.setBounds({ x: 1, y: 2, width: 900, height: 700 }, true);
  const again = new AppSettings(dir).load();
  assert.equal(again.server, 'https://sklubot.sklubs.fr');
  assert.deepEqual(again.s.bounds, { x: 1, y: 2, width: 900, height: 700 });
  assert.equal(again.s.maximized, true);
  assert.ok(!fs.existsSync(path.join(dir, 'relais.json')));
  if (process.platform !== 'win32') assert.equal(fs.statSync(path.join(dir, 'sklubot.json')).mode & 0o777, 0o600);
  fs.writeFileSync(path.join(dir, 'sklubot.json'), '{not json');
  assert.equal(new AppSettings(dir).load().server, null);
});
