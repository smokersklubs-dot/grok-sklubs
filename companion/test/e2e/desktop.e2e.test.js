'use strict';
/*
 * End-to-end tests of the Sklubot window under Xvfb (see test/run-e2e.sh), dev or packaged build.
 * Two local web servers stand in for "the user's Sklubot server" (origin A) and "another site" (origin B).
 * The system browser is replaced by a fake `xdg-open` (first in PATH) that writes down the links it is given:
 * that is how Electron's shell.openExternal reaches the browser on Linux.
 *
 * Checked: first-launch server screen (validation, then the web app loads), only origin A loads in the window,
 * other links go to the system browser, permission requests are granted to origin A only (microphone yes, camera
 * no, an origin-B frame no), the preload bridge exists without Node, session cookies and window size survive a
 * restart, and closing the window quits the app when the relay is off.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const h = require('./helpers');

const MODE = process.env.RELAIS_MODE || 'dev';
const packaged = MODE === 'packaged';

const until = async (fn, ms = 20000, what = 'condition') => {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timeout: ${what}`); await h.sleep(150); }
};

/** A tiny web server that records every request and every POST /report {k, v}. */
async function site(handler) {
  const s = { requests: [], reports: {}, port: 0, server: null };
  s.server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => { body += d; });
    req.on('end', () => {
      s.requests.push({ method: req.method, url: req.url, cookie: req.headers.cookie || '' });
      if (req.method === 'POST' && req.url === '/report') {
        try { const { k, v } = JSON.parse(body); s.reports[k] = v; } catch { /* ignore */ }
        res.writeHead(204).end();
        return;
      }
      handler(req, res);
    });
  });
  await new Promise((r) => s.server.listen(0, '127.0.0.1', r));
  s.port = s.server.address().port;
  s.origin = `http://127.0.0.1:${s.port}`;
  return s;
}

function fakeBrowser(dir) {
  const bin = path.join(dir, 'bin');
  const log = path.join(dir, 'xdg-open.log');
  fs.mkdirSync(bin, { recursive: true });
  fs.writeFileSync(log, '');
  fs.writeFileSync(path.join(bin, 'xdg-open'), `#!/bin/sh\necho "$@" >> "${log}"\n`, { mode: 0o755 });
  return { env: { PATH: `${bin}:${process.env.PATH}` }, opened: () => fs.readFileSync(log, 'utf8').split('\n').filter(Boolean) };
}

async function exited(child, ms = 15000) {
  await until(() => child.exitCode !== null || child.signalCode !== null, ms, 'app exit');
}

test(`Sklubot window (${MODE}): origin lock, external links, permissions, persistence`, { timeout: 240_000 }, async (t) => {
  const other = await site((req, res) => {
    if (req.url === '/frame') {
      res.writeHead(200, { 'content-type': 'text/html' });
      res.end(`<!doctype html><body style="background:#00ff00"><script>
        const report = (k, v) => fetch('/report', { method: 'POST', body: JSON.stringify({ k, v }) });
        navigator.mediaDevices.getUserMedia({ audio: true }).then((s) => { report('frameMic', 'ok'); s.getTracks().forEach((x) => x.stop()); }, (e) => report('frameMic', e.name));
      </script></body>`);
      return;
    }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>other</title><p>other site</p>');
  });
  const B = other.origin;
  const mine = await site((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    if (req.url === '/same') { res.writeHead(200, { 'content-type': 'text/html' }); res.end('<!doctype html><title>Same origin child</title><p>child</p>'); return; }
    const headers = { 'content-type': 'text/html; charset=utf-8' };
    if (!/sid=/.test(req.headers.cookie || '')) headers['set-cookie'] = 'sid=desk-session-1; Max-Age=86400; Path=/; HttpOnly; SameSite=Lax';
    res.writeHead(200, headers);
    res.end(`<!doctype html><html><head><title>Sklubot test</title></head>
<body style="margin:0;background:#202020;color:#fff;font:16px sans-serif">
<button id="go" style="position:fixed;left:0;top:0;width:100%;height:180px;background:#ff00ff;border:0;font-size:30px">go</button>
<iframe src="${B}/frame" allow="microphone; clipboard-read; clipboard-write" style="position:fixed;left:20px;top:220px;width:300px;height:120px;border:0"></iframe>
<script>
const report = (k, v) => fetch('/report', { method: 'POST', body: JSON.stringify({ k, v }) });
(async () => {
  report('bridge', { desktop: typeof window.sklubotDesktop, isDesktop: !!(window.sklubotDesktop && window.sklubotDesktop.isDesktop), node: typeof require + '/' + typeof process });
  try { window.sklubotDesktop.setBadge(3); report('badge', 'sent'); } catch (e) { report('badge', String(e)); }
  report('notif', await Notification.requestPermission());
  try { const s = await navigator.mediaDevices.getUserMedia({ audio: true }); report('mic', 'ok'); s.getTracks().forEach((x) => x.stop()); } catch (e) { report('mic', e.name); }
  try { const s = await navigator.mediaDevices.getUserMedia({ video: true }); report('cam', 'ok'); s.getTracks().forEach((x) => x.stop()); } catch (e) { report('cam', e.name); }
  report('ready', true);
})();
document.getElementById('go').onclick = () => {
  window.open('${B}/popup', '_blank');
  window.open('/same', '_blank');
  setTimeout(() => { location.href = '${B}/nav'; }, 400);
  setTimeout(() => report('still', location.href), 2000);
};
</script></body></html>`);
  });
  const A = mine.origin;
  const dataDir = h.tmpDir('sklubot-desk-');
  const browser = fakeBrowser(dataDir);
  fs.writeFileSync(path.join(dataDir, 'sklubot.json'), JSON.stringify({ version: 1, server: A }), { mode: 0o600 });
  // A fake microphone/camera so that "allowed" can be told apart from "no device" under Xvfb (Chromium switch).
  const launch = () => h.launchRelay({ packaged, dataDir, env: browser.env, args: ['--use-fake-device-for-media-stream'] });
  let app = launch();
  t.after(async () => { await h.stop(app); other.server.close(); mine.server.close(); });

  await t.test('the window loads the configured origin; the bridge is there, Node is not', async () => {
    await until(() => mine.reports.ready, 30000, `page ready\n${app.output}`);
    assert.deepEqual(mine.reports.bridge, { desktop: 'object', isDesktop: true, node: 'undefined/undefined' });
    assert.equal(mine.reports.badge, 'sent');
    await h.sleep(800);
    h.screenshot(`desk-${MODE}-01-window.png`);
  });

  await t.test('permissions: notifications and microphone for the server origin; camera and other origins refused', async () => {
    assert.equal(mine.reports.notif, 'granted');
    assert.equal(mine.reports.mic, 'ok');
    assert.equal(mine.reports.cam, 'NotAllowedError');
    await until(() => other.reports.frameMic, 10000, 'frame report');
    assert.equal(other.reports.frameMic, 'NotAllowedError');
  });

  await t.test('other origins never load in the app: links and pop-ups go to the system browser', async () => {
    const btn = await h.waitColor({ x: 0, y: 0, w: 1280, h: 800 }, '#ff00ff');
    h.humanClick(btn.cx, btn.cy);
    await until(() => mine.reports.still, 15000, 'still on origin A');
    assert.ok(mine.reports.still.startsWith(`${A}/`), mine.reports.still);
    await until(() => browser.opened().some((l) => l.includes(`${B}/nav`)) && browser.opened().some((l) => l.includes(`${B}/popup`)), 10000, `xdg-open got the links: ${browser.opened()}`);
    assert.ok(!other.requests.some((r) => r.url === '/nav' || r.url === '/popup'), 'the other site was never loaded by the app');
    await until(() => mine.requests.some((r) => r.url === '/same'), 10000, 'same-origin pop-up opened in the app');
    assert.ok(mine.requests.find((r) => r.url === '/same').cookie.includes('sid=desk-session-1'), 'the in-app pop-up shares the session');
    await h.sleep(500);
    h.screenshot(`desk-${MODE}-02-after-links.png`);
    try { execFileSync('wmctrl', ['-c', 'Same origin child']); } catch { /* no window manager */ }
  });

  await t.test('closing the window quits when the relay is off; cookies and window size survive a restart', async () => {
    execFileSync('wmctrl', ['-c', 'Sklubot test']);
    await exited(app);
    const saved = JSON.parse(fs.readFileSync(path.join(dataDir, 'sklubot.json'), 'utf8'));
    assert.equal(saved.server, A);
    assert.ok(saved.bounds && saved.bounds.width >= 400, JSON.stringify(saved));
    const before = mine.requests.filter((r) => r.url === '/').length;
    mine.reports.ready = false;
    app = launch();
    await until(() => mine.reports.ready, 30000, 'page ready after restart');
    const again = mine.requests.filter((r) => r.url === '/').slice(before);
    assert.ok(again.length && again[0].cookie.includes('sid=desk-session-1'), `cookie kept: ${JSON.stringify(again)}`);
  });
});

test(`first launch (${MODE}): the server screen checks the address, then shows the web app`, { timeout: 120_000 }, async (t) => {
  const mine = await site((req, res) => {
    if (req.url === '/api/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end('{"ok":true}'); return; }
    res.writeHead(200, { 'content-type': 'text/html' });
    res.end('<!doctype html><title>Sklubot test</title><body style="background:#202020;color:#fff"><h1>Bonjour</h1></body>');
  });
  const dataDir = h.tmpDir('sklubot-first-');
  const app = h.launchRelay({ packaged, dataDir });
  t.after(async () => { await h.stop(app); mine.server.close(); });

  // The screen opens with the address field focused and pre-filled with the public server, all selected.
  await h.waitColor({ x: 300, y: 100, w: 680, h: 600 }, '#e2552d', 30000);
  await h.sleep(800);
  h.screenshot(`desk-${MODE}-00-first-launch.png`);

  // xdotool types ':' and '/' reliably under Xvfb (robotjs maps ':' to ';' with this keymap).
  const type = (text) => execFileSync('xdotool', ['type', '--delay', '15', text]);
  type('http://exemple.fr');
  h.robot.keyTap('enter');
  await h.waitColor({ x: 300, y: 100, w: 680, h: 600 }, '#ff6b5e', 10000);
  assert.ok(!fs.existsSync(path.join(dataDir, 'sklubot.json')), 'an http:// address on the Internet is refused');
  h.screenshot(`desk-${MODE}-00b-first-launch-error.png`);

  h.robot.keyTap('a', 'control');
  type(mine.origin);
  await h.sleep(300);
  h.screenshot(`desk-${MODE}-00c-typed.png`);
  h.robot.keyTap('enter');
  await until(() => mine.requests.some((r) => r.url === '/'), 20000, `web app loaded ${JSON.stringify(mine.requests)}\n${app.output}`);
  assert.equal(JSON.parse(fs.readFileSync(path.join(dataDir, 'sklubot.json'), 'utf8')).server, mine.origin);
});
