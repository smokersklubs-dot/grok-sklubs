'use strict';
/*
 * End-to-end under Xvfb with the REAL Sklubot server (../server) and the real relay (Electron, dev run, test
 * auto-confirm). Run with `bash test/run-e2e.sh` (all e2e files) or `npm run test:e2e:server`.
 *
 * The test plays the user in the web app through the server's HTTP API (sign up, type the pairing code, approve the
 * cards, press Stop, remove the computer) and a bot that runs on the server's demo model. The pairing code is read the
 * way a person reads it on screen would be impractical here, so a byte-level TCP pass-through between the relay and
 * the server picks it out of the stream (unmasked server → client text frame, no compression): nothing is changed.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const net = require('node:net');
const path = require('node:path');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const h = require('./helpers');

const REPO = path.join(h.ROOT, '..');
const until = async (fn, ms = 20000, what = 'condition') => {
  const t = Date.now();
  for (;;) { const v = await fn(); if (v) return v; if (Date.now() - t > ms) throw new Error(`timeout: ${what}`); await h.sleep(150); }
};
const freePort = () => new Promise((resolve) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });

test('real relay ↔ real Sklubot server: pairing, approvals, screenshot, command, Stop, revoke', { timeout: 240_000 }, async (t) => {
  const dataDir = h.tmpDir('sklubot-server-e2e-');
  const relayDir = h.tmpDir('relais-real-');
  const port = await freePort();
  const tsx = path.join(REPO, 'node_modules', '.bin', 'tsx');
  const server = spawn(tsx, [path.join(REPO, 'server', 'src', 'index.ts')], {
    cwd: REPO,
    env: { ...process.env, DATA_DIR: dataDir, PORT: String(port), DEMO_MODE: '1', NO_SCHEDULER: '1', COMPUTER: 'browser', SESSION_SECRET: crypto.randomBytes(32).toString('hex'), PUBLIC_URL: `http://127.0.0.1:${port}` },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverOut = '';
  server.stdout.on('data', (d) => { serverOut += d; });
  server.stderr.on('data', (d) => { serverOut += d; });
  const BASE = `http://127.0.0.1:${port}`;
  await until(() => fetch(`${BASE}/api/health`).then((r) => r.ok, () => false), 60000, `server up\n${serverOut}`);

  // Byte-level pass-through relay → server that notes the pairing code going by.
  let seenCode = '';
  const proxy = net.createServer((client) => {
    const up = net.connect(port, '127.0.0.1');
    client.pipe(up);
    up.on('data', (chunk) => {
      const m = /"type":"pair\.code","code":"([A-Z0-9-]{4,16})"/.exec(chunk.toString('latin1'));
      if (m) seenCode = m[1];
      client.write(chunk);
    });
    const end = () => { client.destroy(); up.destroy(); };
    client.on('error', end); up.on('error', end); client.on('close', end); up.on('close', end);
  });
  await new Promise((r) => proxy.listen(0, '127.0.0.1', r));
  const proxyUrl = `http://127.0.0.1:${proxy.address().port}`;

  const target = h.launchTarget(path.join(relayDir, 'target.log'));
  const relay = h.launchRelay({ dataDir: relayDir, server: proxyUrl, autoconfirm: true });
  t.after(async () => {
    await h.stop(relay); await h.stop(target);
    server.kill('SIGTERM');
    await new Promise((r) => { if (server.exitCode !== null) r(null); else server.once('exit', r); setTimeout(r, 5000); });
    proxy.close();
  });

  let cookie = '';
  const call = async (method, url, body) => {
    const res = await fetch(`${BASE}/api${url}`, { method, headers: { 'content-type': 'application/json', origin: BASE, cookie }, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) cookie = set.split(';')[0];
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* not JSON */ }
    return { status: res.status, json, text };
  };
  const rows = async (botId) => (await call('GET', `/bots/${botId}/rows`)).json.rows;
  const pending = (botId) => until(async () => (await rows(botId)).map((r) => r.body).find((b) => b.kind === 'card' && b.card.type === 'approval' && b.card.status === 'pending'), 20000, 'approval card');
  const said = (botId, re) => until(async () => (await rows(botId)).map((r) => r.body).find((b) => (b.kind === 'message' && b.role === 'assistant' && !b.streaming && re.test(b.text)) || (b.kind === 'event' && re.test(b.text))), 40000, `chat ${re}`);

  const signup = await call('POST', '/auth/signup', { email: 'lea@example.com', name: 'Léa', password: 'password1234', locale: 'fr' });
  assert.equal(signup.status, 200, signup.text);
  const bot = (await call('GET', '/bots')).json.bots.find((b) => b.primary);

  await t.test('pairing: the relay shows a code, the user types it in Sklubot, the token is stored encrypted', async () => {
    await until(() => seenCode, 30000, 'pairing code on the wire');
    await h.sleep(800);
    h.screenshot('server-01-pairing.png');
    const r = await call('POST', '/relay/pairings', { code: seenCode.toLowerCase() });
    assert.equal(r.status, 200, r.text);
    const id = r.json.device.id;
    await until(async () => (await call('GET', '/relay/devices')).json.devices.find((d) => d.id === id && d.status === 'online'), 20000, 'device online');
    const file = path.join(relayDir, 'relais.json');
    await until(() => fs.existsSync(file) && JSON.parse(fs.readFileSync(file, 'utf8')).token, 5000, 'token stored');
    assert.equal(fs.statSync(file).mode & 0o777, 0o600);
    await h.sleep(800);
    h.screenshot('server-02-paired.png');
  });

  await t.test('a bot looks at the computer: approval card, session on the relay, real screenshot to the model', async () => {
    await call('POST', `/bots/${bot.id}/messages`, { text: 'Regarde mon écran' });
    const card = await pending(bot.id);
    assert.equal(card.card.tool, `mycomputer: control: ${bot.name}`);
    assert.equal((await call('POST', `/approvals/${card.card.approvalId}`, { decision: 'allow' })).status, 200);
    await said(bot.id, /a pris le contrôle/);
    await said(bot.id, /Screenshot of .*1280×800/);
    const [d] = (await call('GET', '/relay/devices')).json.devices;
    assert.equal(d.session.botId, bot.id);
    assert.equal(d.session.grant, 'test', 'dev run with the test flag: auto-confirmed on the computer');
    const last = await fetch(`${BASE}/api/relay/devices/${d.id}/last`, { headers: { cookie } });
    assert.equal(last.status, 200);
    const jpg = Buffer.from(await last.arrayBuffer());
    assert.deepEqual([jpg[0], jpg[1]], [0xff, 0xd8], 'a real JPEG from the relay');
    h.screenshot('server-03-session.png');
  });

  await t.test('a command: approved in the app, run by the relay, output back to the bot', async () => {
    // Commands are on by default on the owner's own computer (server relayguard.ts); each one is shown on a card.
    await call('POST', `/bots/${bot.id}/messages`, { text: 'Lance "echo relais-ok-$((6*7))" sur mon ordinateur' });
    const card = await pending(bot.id);
    assert.ok(card.card.tool.startsWith(`mycomputer: command: ${bot.name} | echo`), card.card.tool);
    await call('POST', `/approvals/${card.card.approvalId}`, { decision: 'allow' });
    await said(bot.id, /relais-ok-42/);
  });

  await t.test('Stop in the web app ends the session on the computer', async () => {
    const [d] = (await call('GET', '/relay/devices')).json.devices;
    assert.equal((await call('POST', `/relay/devices/${d.id}/stop`)).status, 200);
    await said(bot.id, /Tu as arrêté le contrôle/);
    await until(async () => !(await call('GET', '/relay/devices')).json.devices[0].session, 10000, 'session over');
    await h.sleep(600);
    h.screenshot('server-04-stopped.png');
  });

  await t.test('removing the computer: the relay forgets its token and does not reconnect', async () => {
    const [d] = (await call('GET', '/relay/devices')).json.devices;
    assert.equal((await call('DELETE', `/relay/devices/${d.id}`)).status, 200);
    const file = path.join(relayDir, 'relais.json');
    await until(() => !JSON.parse(fs.readFileSync(file, 'utf8')).token, 10000, 'token erased');
    await h.sleep(2500);
    assert.deepEqual((await call('GET', '/relay/devices')).json.devices, []);
    h.screenshot('server-05-revoked.png');
  });
});
