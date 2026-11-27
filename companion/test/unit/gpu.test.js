'use strict';
// gpu.http (protocol 1.6): the owner's own Wan2GP on 127.0.0.1 — asked here the first time, loopback only, Stop clears it.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { makeCore } = require('./helpers');
const { createGpuHttp, validateGpuArgs, CHUNK } = require('../../src/main/capabilities/gpu');

test('gpu.http: asked on this computer the first time per bot and port; a refusal sends nothing; Stop clears the yes', async () => {
  const refused = makeCore({ answers: { guard: 'refuse' } });
  const r0 = await refused.req('gpu.http', { port: 7866, method: 'POST', path: '/mcp', body: Buffer.from('{}').toString('base64') });
  assert.equal(r0.error.code, 'consent_refused');
  assert.equal(refused.calls.filter((c) => c.name === 'gpuHttp').length, 0);
  assert.equal(refused.prompts[0].kind, 'guard:gpu');
  assert.match(refused.prompts[0].detail, /127\.0\.0\.1:7866/);

  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: { gpuHttp: () => ({ status: 200, headers: {}, size: 2, offset: 0, data: 'e30=', token: null }) } });
  assert.equal((await h.req('gpu.http', { port: 7866, method: 'POST', path: '/mcp' })).ok, true, 'no control session needed');
  await h.req('gpu.http', { port: 7866, method: 'POST', path: '/mcp' });
  assert.equal(h.prompts.length, 1, 'the yes covers the next requests');
  await h.req('gpu.http', { port: 7867, method: 'POST', path: '/mcp' });
  assert.equal(h.prompts.length, 2, 'another port is asked again');
  h.core.stop('user');
  assert.equal((await h.req('gpu.http', { port: 7866, method: 'POST', path: '/mcp' })).error.code, 'locked');
});

test('gpu.http arguments: a path only (never a host), three methods, small bodies, safe headers', () => {
  assert.throws(() => validateGpuArgs({ port: 80, method: 'GET', path: '/' }), /port/);
  assert.throws(() => validateGpuArgs({ port: 7866, method: 'DELETE', path: '/' }), /method/);
  for (const path of ['http://evil/', '//evil/x', 'mcp', '/a b', '/x\\y']) assert.throws(() => validateGpuArgs({ port: 7866, method: 'GET', path }), /path/, path);
  assert.throws(() => validateGpuArgs({ port: 7866, method: 'PUT', path: '/u', body: Buffer.alloc(200 * 1024).toString('base64') }), /too large/);
  const ok = validateGpuArgs({ port: 7866, method: 'post', path: '/mcp', headers: { 'Content-Type': 'application/json', cookie: 'x', authorization: 'y', 'mcp-session-id': 's1' } });
  assert.deepEqual(ok.headers, { 'content-type': 'application/json', 'mcp-session-id': 's1' });
  assert.equal(ok.method, 'POST');
});

test('gpu.http talks to 127.0.0.1 only and returns a long answer in pieces', async () => {
  const big = Buffer.alloc(CHUNK + 1000, 7);
  const server = http.createServer((req, res) => { res.setHeader('mcp-session-id', 'sess'); res.setHeader('set-cookie', 'a=b'); res.end(req.url === '/big' ? big : 'small'); });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = /** @type {any} */ (server.address()).port;
  const seen = [];
  const { gpuHttp } = createGpuHttp({ request: (o, cb) => { seen.push(o.host); return http.request(o, cb); } });
  const small = await gpuHttp(validateGpuArgs({ port, method: 'GET', path: '/small' }));
  assert.equal(Buffer.from(small.data, 'base64').toString(), 'small');
  assert.deepEqual(small.headers, { 'mcp-session-id': 'sess' }, 'no cookie comes back');
  const first = await gpuHttp(validateGpuArgs({ port, method: 'GET', path: '/big' }));
  assert.ok(first.token);
  const rest = await gpuHttp(validateGpuArgs({ port, read: { token: first.token, offset: CHUNK } }));
  assert.equal(rest.token, null);
  assert.equal(Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(rest.data, 'base64')]).length, big.length);
  assert.deepEqual([...new Set(seen)], ['127.0.0.1']);
  server.close();
});
