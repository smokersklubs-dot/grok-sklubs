'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { FakeServer } = require('../fake-server');
const { RelayConnection, backoffDelay } = require('../../src/main/connection');
const { normalizeServer } = require('../../src/main/protocol');
const { makeCore } = require('./helpers');

test('backoff grows exponentially with jitter and is capped', () => {
  assert.equal(backoffDelay(0, () => 0.5), 1000);
  assert.equal(backoffDelay(3, () => 0.5), 8000);
  assert.equal(backoffDelay(20, () => 0.5), 60000);
  assert.ok(backoffDelay(0, () => 0) >= 700 && backoffDelay(0, () => 1) <= 1300);
});

function makeConn(server, auth, h) {
  const conn = new RelayConnection({
    wsUrl: normalizeServer(server.url).wsUrl,
    core: h.core,
    log: () => {},
    getAuth: () => auth.value,
    hello: () => ({ app: { name: 'test', version: '0' }, capabilities: [] }),
    onPaired: async ({ deviceId, token }) => { auth.value = { deviceId, token }; },
    onTokenRotated: async (token) => { auth.value = { ...auth.value, token }; },
    onRevoked: async () => { auth.value = null; },
  });
  h.core.d.send = (m) => conn.send(m);
  return conn;
}

const until = async (fn, ms = 5000) => { const t = Date.now(); while (!fn()) { if (Date.now() - t > ms) throw new Error('timeout'); await new Promise((r) => setTimeout(r, 20)); } };

test('pairing, welcome, token rotation, re-auth with rotated token, old token rejected, pause sends nothing', async () => {
  const server = new FakeServer();
  await server.start();
  const auth = { value: null };
  const h = makeCore({ autoConfirm: true });
  const conn = makeConn(server, auth, h);
  conn.start();
  const hello = await server.waitFor((m) => m.type === 'hello');
  assert.equal(hello.auth, null);
  await until(() => conn.status === 'pairing');
  assert.match(conn.pairing.code, /^[A-Z0-9]{4}-[A-Z0-9]{4}$/);
  // Requests before authentication are ignored.
  server.send({ type: 'req', id: 'early', bot: { id: 'b', name: 'B' }, op: 'screen.info', args: {} });
  assert.ok(server.confirmPairing(conn.pairing.code));
  await until(() => conn.status === 'online');
  assert.ok(!server.received.some((m) => m.type === 'res' && m.id === 'early'));
  const first = auth.value.token;
  const r = await server.request('screen.info');
  assert.equal(r.ok, true);

  server.rotateToken();
  await new Promise((res) => server.once('rotated', res));
  assert.notEqual(auth.value.token, first);

  // Reconnect with the rotated token.
  server.ws.close(1012, 'restart');
  await until(() => conn.status === 'waiting');
  await until(() => conn.status === 'online', 8000);
  const hellos = server.received.filter((m) => m.type === 'hello');
  assert.equal(hellos.at(-1).auth.token, auth.value.token);

  // Pause: nothing more is sent.
  conn.pause();
  await new Promise((r) => setTimeout(r, 200));
  const count = server.received.length;
  h.core.event('should.not.be.sent');
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(server.received.length, count);
  assert.equal(server.ws, null);

  // Old token is rejected → unauthorized, no reconnect loop.
  auth.value = { ...auth.value, token: first };
  conn.start();
  await until(() => conn.status === 'unauthorized');
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(conn.status, 'unauthorized');
  conn.stop();
  await server.close();
});

test('oversized server message closes the socket (maxPayload)', async () => {
  const server = new FakeServer();
  await server.start();
  const auth = { value: null };
  const h = makeCore();
  const conn = makeConn(server, auth, h);
  conn.start();
  await until(() => conn.status === 'pairing');
  server.ws.send(JSON.stringify({ type: 'x', pad: 'a'.repeat(300 * 1024) }));
  await until(() => conn.status === 'waiting');
  conn.stop();
  await server.close();
});
