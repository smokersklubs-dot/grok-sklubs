'use strict';
/*
 * End-to-end test of protocol 1.1 (files) under Xvfb: the real relay (Electron), a fake server, and a folder the user
 * shared in the relay (written into its settings before launch, as the folder dialog would). The server asks for
 * fs.roots / fs.list / fs.read / fs.write / fs.trash; refusals are decided on the computer.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { FakeServer } = require('../fake-server');
const h = require('./helpers');

const MODE = process.env.RELAIS_MODE || 'dev';
const ALICE = { id: 'bot_alice', name: 'Alice' };
const until = async (fn, ms = 15000, what = 'condition') => {
  const t = Date.now();
  while (!(await fn())) { if (Date.now() - t > ms) throw new Error(`timeout: ${what}`); await h.sleep(100); }
};

test(`files end-to-end (${MODE})`, { timeout: 180_000 }, async (t) => {
  const server = new FakeServer();
  await server.start();
  const dataDir = h.tmpDir('relais-files-');
  // Shared folders must be inside the home folder: a scratch folder there, removed at the end.
  const homeDir = fs.mkdtempSync(path.join(os.homedir(), 'relais-files-'));
  const docs = path.join(homeDir, 'Documents');
  fs.mkdirSync(docs);
  fs.writeFileSync(path.join(docs, 'notes.txt'), 'Liste : pain, lait');
  fs.writeFileSync(path.join(docs, '.env'), 'TOKEN=secret');
  fs.writeFileSync(path.join(dataDir, 'relais.json'), JSON.stringify({ version: 1, folders: [{ id: 'f1', name: 'Documents', path: docs, write: true }] }), { mode: 0o600 });
  const relay = h.launchRelay({ packaged: MODE === 'packaged', dataDir, server: server.url, autoconfirm: MODE !== 'packaged' });
  t.after(async () => { await h.stop(relay); await server.close(); fs.rmSync(homeDir, { recursive: true, force: true }); });

  const hello = await server.waitFor((m) => m.type === 'hello', 30000, 'hello');
  assert.equal(hello.protocol, '1.1');
  for (const op of ['fs.roots', 'fs.list', 'fs.read', 'fs.write', 'fs.trash']) assert.ok(hello.capabilities.includes(op), op);
  await until(() => !!server.pairCode, 10000, 'pair code');
  assert.ok(server.confirmPairing(server.pairCode));
  await server.waitFor((m) => m.type === 'event' && m.name === 'relay.state', 20000, 'relay.state');

  await t.test('roots, list and read without a control session; hidden and secret files never shown', async () => {
    const roots = await server.request('fs.roots', {}, ALICE);
    assert.equal(roots.ok, true, JSON.stringify(roots));
    assert.deepEqual(roots.result.roots.map((r) => [r.name, r.write]), [['Documents', true]]);
    const list = await server.request('fs.list', { root: 'Documents', path: '' }, ALICE);
    assert.deepEqual(list.result.entries.map((e) => e.name), ['notes.txt']);
    assert.equal((await server.request('fs.read', { root: 'Documents', path: 'notes.txt' }, ALICE)).result.text, 'Liste : pain, lait');
    assert.equal((await server.request('fs.read', { root: 'Documents', path: '.env' }, ALICE)).error.code, 'forbidden');
    assert.equal((await server.request('fs.read', { root: 'Documents', path: '../../.bashrc' }, ALICE)).error.code, 'forbidden');
  });

  await t.test('write creates, never overwrites unless replace; trash moves to the OS trash', async () => {
    assert.equal((await server.request('fs.write', { root: 'Documents', path: 'rapport.txt', text: 'v1' }, ALICE)).ok, true);
    assert.equal(fs.readFileSync(path.join(docs, 'rapport.txt'), 'utf8'), 'v1');
    assert.equal((await server.request('fs.write', { root: 'Documents', path: 'rapport.txt', text: 'v2' }, ALICE)).error.code, 'exists');
    assert.equal((await server.request('fs.write', { root: 'Documents', path: 'run.sh', text: 'echo' }, ALICE)).error.code, 'forbidden');
    const trash = await server.request('fs.trash', { root: 'Documents', path: 'rapport.txt' }, ALICE);
    assert.equal(trash.ok, true, JSON.stringify(trash));
    assert.equal(fs.existsSync(path.join(docs, 'rapport.txt')), false, 'gone from the folder (in the trash)');
  });

  await t.test('the shared folder is shown in the relay window', async () => {
    await h.sleep(800);
    h.screenshot(`${MODE}-07-shared-folders.png`);
  });
});
