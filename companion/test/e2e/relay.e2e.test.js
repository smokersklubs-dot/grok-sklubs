'use strict';
/*
 * End-to-end tests under Xvfb (see test/run-e2e.sh). A fake Sklubot server pairs with the real relay
 * (Electron, dev or packaged build), then drives it like a bot would. The test also plays the human:
 * it looks at the screen and clicks the consent dialog / Stop button.
 *
 *   RELAIS_MODE=dev       → `electron .` (unpackaged); the auto-confirm test flag is honoured.
 *   RELAIS_MODE=packaged  → dist/linux-unpacked; the flag must be ignored.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FakeServer } = require('../fake-server');
const h = require('./helpers');

const MODE = process.env.RELAIS_MODE || 'dev';
const packaged = MODE === 'packaged';
const ALICE = { id: 'bot_alice', name: 'Alice' };
const BOB = { id: 'bot_bob', name: 'Bob' };

const until = async (fn, ms = 15000, what = 'condition') => {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error(`timeout: ${what}`); await h.sleep(100); }
};
const event = (server, name, pred = () => true) => server.waitFor((m) => m.type === 'event' && m.name === name && pred(m), 20000, `event ${name}`);

async function pair(server, relay) {
  const hello = await server.waitFor((m) => m.type === 'hello', 30000, 'hello');
  assert.equal(hello.v, 1);
  assert.equal(hello.auth, null, 'first launch has no device token');
  assert.ok(hello.capabilities.includes('screen.capture') && hello.capabilities.includes('shell.run'));
  await until(() => !!server.pairCode, 10000, 'pair code');
  return hello;
}

/** Consent dialog: primary button = accent colour; "Refuser" = first secondary button on the same row. */
async function consentButtons(kind) {
  const height = kind === 'command' ? 440 : 340;
  const region = { x: (1280 - 600) / 2, y: Math.round((800 - height) / 2), w: 600, h: height };
  const primary = await h.waitColor({ ...region, y: region.y + region.h - 90, h: 90 }, '#3ccfb4');
  const bmp = h.robot.screen.capture(region.x, primary.y + primary.h - 3, region.w, 1);
  const runs = [];
  let start = -1;
  for (let x = 0; x < region.w; x++) {
    const c = bmp.colorAt(x, 0);
    const isBtn = c === '1c2a39' || c === '2a3a4c';
    if (isBtn && start < 0) start = x;
    if (!isBtn && start >= 0) { if (x - start > 30) runs.push([start, x]); start = -1; }
  }
  const refuse = runs.length ? { cx: region.x + Math.round((runs[0][0] + runs[0][1]) / 2), cy: primary.cy } : null;
  return { primary, refuse, region };
}

test(`relay end-to-end (${MODE})`, { timeout: 240_000 }, async (t) => {
  const server = new FakeServer();
  await server.start();
  const dataDir = h.tmpDir('relais-e2e-');
  const targetLog = path.join(dataDir, 'target.log');
  const target = h.launchTarget(targetLog);
  let relay = h.launchRelay({ packaged, dataDir, server: server.url, autoconfirm: true });
  t.after(async () => { await h.stop(relay); await h.stop(target); await server.close(); });

  await t.test('pairing: code shown locally, confirmed on the server, token stored 0600 and encrypted', async () => {
    await pair(server, relay);
    await h.sleep(1200);
    h.screenshot(`${MODE}-01-pairing.png`);
    assert.ok(server.confirmPairing(server.pairCode));
    await event(server, 'relay.state');
    const file = path.join(dataDir, 'relais.json');
    await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token, 5000, 'token stored');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    const token = server.tokens.get(server.deviceId);
    assert.ok(!fs.readFileSync(file, 'utf8').includes(token), 'token is not stored in clear text');
    assert.equal(saved.token.scheme, 'safeStorage');
  });

  if (!packaged) {
    await t.test('dev run with the local test flag: session auto-confirmed', async () => {
      const r = await server.request('session.start', { reason: 'test' }, ALICE);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.grant, 'test');
    });
  } else {
    await t.test('packaged build ignores the test flag: a real consent dialog appears; the human allows once', async () => {
      const pending = server.request('session.start', { reason: 'test' }, ALICE);
      await event(server, 'consent.requested');
      const { primary } = await consentButtons('session');
      await h.sleep(1100); // buttons are disabled for ~1 s
      h.humanClick(primary.cx, primary.cy);
      const r = await pending;
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.grant, 'once');
    });
  }

  await t.test('screen.info and screen.capture', async () => {
    const info = await server.request('screen.info', {}, ALICE);
    assert.deepEqual([info.result.width, info.result.height], [1280, 800]);
    const shot = await server.request('screen.capture', { maxWidth: 640, format: 'jpeg', quality: 60 }, ALICE);
    assert.equal(shot.ok, true, JSON.stringify(shot.error));
    assert.equal(shot.result.width, 640);
    assert.equal(shot.result.height, 400);
    const buf = Buffer.from(shot.result.data, 'base64');
    assert.equal(buf[0], 0xff); assert.equal(buf[1], 0xd8);
    fs.writeFileSync(path.join(h.SHOTS, `${MODE}-capture-by-bot.jpg`), buf);
    const png = await server.request('screen.capture', { maxWidth: 320, format: 'png' }, ALICE);
    assert.equal(Buffer.from(png.result.data, 'base64').subarray(1, 4).toString(), 'PNG');
  });

  await t.test('mouse click, keyboard type, shortcut, scroll, right click', async () => {
    const r1 = await server.request('mouse.click', { x: 200, y: 380 }, ALICE);
    assert.equal(r1.ok, true, JSON.stringify(r1));
    await until(() => h.readTarget(targetLog).some((e) => e.type === 'mousedown' && e.button === 0), 5000, 'click received');
    const down = h.readTarget(targetLog).find((e) => e.type === 'mousedown');
    assert.ok(Math.abs(down.screenX - 200) <= 2 && Math.abs(down.screenY - 380) <= 2, JSON.stringify(down));
    assert.equal((await server.request('keyboard.type', { text: 'Bonjour Sklubot' }, ALICE)).ok, true);
    await until(() => h.readTarget(targetLog).some((e) => e.type === 'value' && e.value.includes('Bonjour Sklubot')), 5000, 'typed text');
    assert.equal((await server.request('keyboard.press', { key: 'ctrl+a' }, ALICE)).ok, true);
    assert.equal((await server.request('keyboard.type', { text: 'X' }, ALICE)).ok, true);
    await until(() => { const v = h.readTarget(targetLog).filter((e) => e.type === 'value').pop(); return v && v.value === 'X'; }, 5000, 'ctrl+a replaced text');
    assert.equal((await server.request('keyboard.press', { key: 'Enter' }, ALICE)).ok, true);
    assert.equal((await server.request('mouse.scroll', { x: 200, y: 380, dy: 3 }, ALICE)).ok, true);
    await until(() => h.readTarget(targetLog).some((e) => e.type === 'wheel' && e.deltaY > 0), 5000, 'wheel down');
    assert.equal((await server.request('mouse.click', { x: 220, y: 400, button: 'right' }, ALICE)).ok, true);
    await until(() => h.readTarget(targetLog).some((e) => e.type === 'contextmenu'), 5000, 'right click');
    assert.equal((await server.request('mouse.click', { x: 220, y: 400, double: true }, ALICE)).ok, true);
    await until(() => h.readTarget(targetLog).some((e) => e.type === 'dblclick'), 5000, 'double click');
    assert.equal((await server.request('mouse.move', { x: 640, y: 700 }, ALICE)).ok, true);
    const pos = h.robot.getMousePos();
    assert.deepEqual([pos.x, pos.y], [640, 700]);
    assert.equal((await server.request('mouse.drag', { fromX: 120, fromY: 300, toX: 300, toY: 320 }, ALICE)).ok, true);
  });

  await t.test('invalid requests are refused', async () => {
    assert.equal((await server.request('url.open', { url: 'file:///etc/passwd' }, ALICE)).error.code, 'invalid_args');
    assert.equal((await server.request('app.open', { name: 'sh; reboot' }, ALICE)).error.code, 'invalid_args');
    assert.equal((await server.request('consent.grant', { commands: true }, ALICE)).error.code, 'unknown_op');
    assert.equal((await server.request('screen.capture', {}, BOB)).error.code, 'busy');
  });

  await t.test('window.list', async () => {
    const r = await server.request('window.list', {}, ALICE);
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.ok(r.result.windows.some((w) => w.title === 'Cible de test'), JSON.stringify(r.result.windows));
    const f = await server.request('window.focus', { title: 'Cible de test' }, ALICE);
    assert.equal(f.ok, true, JSON.stringify(f));
    assert.equal(f.result.focused, true);
  });

  if (!packaged) {
    await t.test('shell.run (auto-confirmed by the local dev flag): output, exit code, cap, timeout', async () => {
      const r = await server.request('shell.run', { command: 'echo hello && uname -s' }, ALICE);
      assert.equal(r.ok, true, JSON.stringify(r));
      assert.equal(r.result.stdout, 'hello\nLinux\n');
      assert.equal(r.result.exitCode, 0);
      const cap = await server.request('shell.run', { command: 'head -c 100000 /dev/zero | tr "\\0" z', maxOutputBytes: 1000 }, ALICE);
      assert.equal(cap.result.stdout.length, 1000);
      assert.equal(cap.result.truncated, true);
      const slow = await server.request('shell.run', { command: 'sleep 20', timeoutMs: 500 }, ALICE);
      assert.equal(slow.result.timedOut, true);
    });
  } else {
    await t.test('packaged: shell command needs the human; refusing it blocks it', async () => {
      const pending = server.request('shell.run', { command: 'echo should-not-run > /tmp/relais-should-not-exist' }, ALICE);
      await event(server, 'consent.requested', (m) => m.kind === 'command');
      const { refuse } = await consentButtons('command');
      assert.ok(refuse, 'refuse button found');
      await h.sleep(1100);
      h.humanClick(refuse.cx, refuse.cy);
      const r = await pending;
      assert.equal(r.error.code, 'command_refused');
      assert.ok(!fs.existsSync('/tmp/relais-should-not-exist'));
    });
  }

  await t.test('live view: frames at ≤ 5 fps with acks, stops on request', async () => {
    const start = await server.request('view.start', { maxFps: 4, maxWidth: 480, quality: 50 }, ALICE);
    assert.equal(start.ok, true, JSON.stringify(start));
    const before = server.frames.length;
    const t0 = Date.now();
    // Change the screen so frames are not deduplicated.
    for (let i = 0; i < 8; i++) { await server.request('keyboard.type', { text: String(i) }, ALICE); await h.sleep(300); }
    const got = server.frames.slice(before);
    const elapsed = (Date.now() - t0) / 1000;
    assert.ok(got.length >= 3, `frames: ${got.length}`);
    assert.ok(got.length / elapsed <= 5.5, `fps ${got.length / elapsed}`);
    assert.equal(got[0].width, 480);
    assert.equal((await server.request('view.stop', { viewId: start.result.viewId }, ALICE)).ok, true);
    await h.sleep(800);
    const n = server.frames.length;
    await h.sleep(1000);
    assert.equal(server.frames.length, n, 'no frames after view.stop');
  });

  await t.test('global hotkey stops the session and locks the relay', async () => {
    h.screenshot(`${MODE}-03-session-active.png`);
    h.robot.keyTap('s', ['control', 'alt', 'shift']);
    const ended = await event(server, 'session.ended');
    assert.equal(ended.reason, 'hotkey');
    await event(server, 'relay.locked');
    assert.equal((await server.request('mouse.move', { x: 10, y: 10 }, ALICE)).error.code, 'locked');
    assert.equal((await server.request('session.start', {}, ALICE)).error.code, 'locked');
    assert.equal((await server.request('screen.capture', {}, ALICE)).error.code, 'locked');
    await h.sleep(500);
    h.screenshot(`${MODE}-06-locked.png`);
  });

  await t.test('token rotation, restart re-authenticates with the new token, lock survives restart', async () => {
    server.rotateToken();
    await new Promise((r) => server.once('rotated', r));
    const newToken = server.tokens.get(server.deviceId);
    await h.stop(relay);
    server.received.length = 0;
    relay = h.launchRelay({ packaged, dataDir, server: server.url, autoconfirm: true });
    const hello = await server.waitFor((m) => m.type === 'hello', 30000, 'hello after restart');
    assert.equal(hello.auth.token, newToken);
    assert.equal(hello.state.locked, true);
    await event(server, 'relay.state');
    assert.equal((await server.request('session.start', {}, ALICE)).error.code, 'locked');
  });

  await t.test('action log written locally', () => {
    const log = fs.readFileSync(path.join(dataDir, 'logs', 'actions.log'), 'utf8');
    assert.ok(log.includes('"op":"mouse.click"'));
    assert.ok(log.includes('"kind":"locked"'));
    assert.ok(!log.includes('"data"'), 'no image data in the log');
    assert.ok(!log.includes(server.tokens.get(server.deviceId)), 'no token in the log');
  });
});

test(`consent defaults with a real dialog (${MODE}, no test flag)`, { timeout: 240_000, skip: packaged }, async (t) => {
  const server = new FakeServer();
  await server.start();
  const dataDir = h.tmpDir('relais-consent-');
  const relay = h.launchRelay({ packaged, dataDir, server: server.url, autoconfirm: false });
  t.after(async () => { await h.stop(relay); await server.close(); });
  await pair(server, relay);
  server.confirmPairing(server.pairCode);
  await event(server, 'relay.state');

  await t.test('session dialog shown; human allows once; banner appears', async () => {
    const pending = server.request('session.start', { reason: 'Ranger ton bureau' }, ALICE);
    await event(server, 'consent.requested');
    const { primary } = await consentButtons('session');
    await h.sleep(1200);
    h.screenshot('02-consent-session.png');
    h.screenshot('02-consent-session-crop.png', '600x340+340+230');
    h.humanClick(primary.cx, primary.cy);
    const r = await pending;
    assert.equal(r.ok, true, JSON.stringify(r));
    assert.equal(r.result.grant, 'once');
    await h.waitColor({ x: 410, y: 12, w: 460, h: 56 }, '#b42318');
    await h.sleep(600);
    h.screenshot('03-banner.png', '460x56+410+12');
    h.screenshot('04-main-with-session.png');
  });

  await t.test('shell command: dialog shown, input blocked meanwhile, refused, then cooldown without dialog', async () => {
    const pending = server.request('shell.run', { command: 'rm -rf ~/Documents/important', timeoutMs: 1000 }, ALICE);
    await event(server, 'consent.requested', (m) => m.kind === 'command');
    const { refuse } = await consentButtons('command');
    assert.equal((await server.request('mouse.click', { x: 10, y: 10 }, ALICE)).error.code, 'consent_pending');
    await h.sleep(1200);
    h.screenshot('05-consent-command.png');
    h.screenshot('05-consent-command-crop.png', '600x440+340+180');
    h.humanClick(refuse.cx, refuse.cy);
    const r = await pending;
    assert.equal(r.error.code, 'command_refused');
    const again = await server.request('shell.run', { command: 'echo again' }, ALICE);
    assert.equal(again.error.code, 'consent_cooldown');
  });

  await t.test('another bot cannot take over; Stop on the banner ends and locks', async () => {
    assert.equal((await server.request('session.start', {}, BOB)).error.code, 'busy');
    const stopBtn = await h.waitColor({ x: 410 + 460 - 120, y: 12, w: 120, h: 56 }, '#ffffff');
    h.humanClick(stopBtn.cx, stopBtn.cy);
    const ended = await event(server, 'session.ended');
    assert.equal(ended.reason, 'user_stop');
    await event(server, 'relay.locked');
    assert.equal((await server.request('session.start', {}, BOB)).error.code, 'locked');
    await h.sleep(500);
    h.screenshot('06-locked-main.png');
  });
});
