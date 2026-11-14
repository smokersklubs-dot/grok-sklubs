'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Store } = require('../../src/main/store');

const fakeCrypto = {
  available: async () => true,
  encrypt: async (s) => Buffer.from('ENC:' + Buffer.from(s).toString('hex')),
  decrypt: async (b) => Buffer.from(b.toString().slice(4), 'hex').toString(),
};

test('token encrypted at rest, file 0600, dir 0700, forget erases everything', { skip: process.platform === 'win32' }, async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relais-'));
  const s = await new Store(path.join(dir, 'p'), fakeCrypto).load();
  s.setServer('https://ex.com');
  await s.setCredentials('dev1', 'secret-token-abcdefghijkl', 'Srv');
  s.setBotPerm({ id: 'b', name: 'B' }, 'commands', true);
  const raw = fs.readFileSync(s.file, 'utf8');
  assert.ok(!raw.includes('secret-token'));
  assert.equal(fs.statSync(s.file).mode & 0o777, 0o600);
  assert.equal(fs.statSync(path.join(dir, 'p')).mode & 0o777, 0o700);
  const s2 = await new Store(path.join(dir, 'p'), fakeCrypto).load();
  assert.deepEqual(s2.getAuth(), { deviceId: 'dev1', token: 'secret-token-abcdefghijkl' });
  s2.forgetServer();
  const s3 = await new Store(path.join(dir, 'p'), fakeCrypto).load();
  assert.equal(s3.getAuth(), null);
  assert.equal(s3.settings.server, null);
  assert.deepEqual(s3.settings.bots, {});
});

test('changing server drops credentials', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'relais-'));
  const s = await new Store(dir, fakeCrypto).load();
  s.setServer('https://a.com');
  await s.setCredentials('d', 'tttttttttttttttttttt');
  s.setServer('https://b.com');
  assert.equal(s.getAuth(), null);
});
