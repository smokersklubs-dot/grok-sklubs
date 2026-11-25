'use strict';
// net.fetch (protocol 1.8, L169): a bot's web request through the owner's home connection — asked here the first time
// per bot, never to the home network, its own rate, Stop clears the yes.
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { makeCore } = require('./helpers');
const { createNetExit, validateNetArgs, isPrivateAddress, MAX_RESPONSE } = require('../../src/main/capabilities/netexit');

test('net.fetch: asked on this computer the first time per bot; a refusal sends nothing; Stop clears the yes', async () => {
  const refused = makeCore({ answers: { guard: 'refuse' } });
  const r0 = await refused.req('net.fetch', { url: 'https://example.com/a?secret=1', method: 'GET' });
  assert.equal(r0.error.code, 'consent_refused');
  assert.equal(refused.calls.filter((c) => c.name === 'netFetch').length, 0);
  assert.equal(refused.prompts[0].kind, 'guard:net');
  assert.equal(refused.prompts[0].detail, 'example.com');

  const h = makeCore({ answers: { guard: 'allow' }, extraCaps: { netFetch: () => ({ status: 200, headers: {}, data: 'b2s=', truncated: false }) } });
  assert.equal((await h.req('net.fetch', { url: 'https://example.com/' })).ok, true, 'no control session needed');
  await h.req('net.fetch', { url: 'https://example.org/' });
  assert.equal(h.prompts.length, 1, 'the yes covers this bot');
  await h.req('net.fetch', { url: 'https://example.org/' }, { id: 'bot_b', name: 'Bob' });
  assert.equal(h.prompts.length, 2, 'another bot is asked again');
  const logged = h.logs.find((l) => l.kind === 'request' && l.op === 'net.fetch');
  assert.deepEqual(logged.args, { method: 'GET', host: 'example.com', path: '/', bytes: 0 }, 'the log shows where, never the query');
  h.core.stop('user');
  assert.equal((await h.req('net.fetch', { url: 'https://example.com/' })).error.code, 'locked');
  assert.equal(h.core.netOk.size, 0);
});

test('net.fetch has its own rate: 20 at once, then 2 a second', async () => {
  let t = 0;
  const h = makeCore({ autoConfirm: true, now: () => t, extraCaps: { netFetch: () => ({ status: 200, headers: {}, data: '', truncated: false }) } });
  const codes = [];
  for (let i = 0; i < 22; i++) { const r = await h.req('net.fetch', { url: 'https://example.com/' }); codes.push(r.ok ? 'ok' : r.error.code); }
  assert.equal(codes.filter((c) => c === 'ok').length, 20);
  assert.equal(codes.at(-1), 'rate_limited');
  t += 1000;
  assert.equal((await h.req('net.fetch', { url: 'https://example.com/' })).ok, true);
});

test('net.fetch arguments: http(s) only, no credentials in the address, three methods, safe headers, small bodies', () => {
  for (const url of ['ftp://x.example/', 'file:///etc/passwd', 'https://u:p@example.com/', 'not a url']) assert.throws(() => validateNetArgs({ url }), undefined, url);
  assert.throws(() => validateNetArgs({ url: 'https://example.com/', method: 'DELETE' }), /method/);
  assert.throws(() => validateNetArgs({ url: 'https://example.com/', method: 'GET', body: 'eA==' }), /POST/);
  assert.throws(() => validateNetArgs({ url: 'https://example.com/', method: 'POST', body: Buffer.alloc(200 * 1024).toString('base64') }), /too large/);
  const ok = validateNetArgs({ url: 'https://example.com/', headers: { Cookie: 'a', Authorization: 'b', Accept: 'text/html', 'Signature-Agent': 'sig1="https://x"', 'x-evil': 'y', 'user-agent': 'a\r\nb' } });
  assert.deepEqual(ok.headers, { accept: 'text/html', 'signature-agent': 'sig1="https://x"' });
  assert.equal(ok.method, 'GET');
});

test('net.fetch never reaches the home network: private names and addresses are refused before anything is sent', async () => {
  for (const ip of ['192.168.1.1', '10.0.0.2', '127.0.0.1', '169.254.169.254', '::1', 'fe80::1', '100.100.100.100']) assert.equal(isPrivateAddress(ip), true, ip);
  assert.equal(isPrivateAddress('93.184.215.14'), false);
  const { netFetch } = createNetExit();
  await assert.rejects(netFetch(validateNetArgs({ url: 'http://192.168.1.1/admin' })), (e) => e.code === 'blocked_address');
  // A public-looking name that resolves to the router.
  const tricked = createNetExit({ lookup: (_h, _o, cb) => cb(null, [{ address: '192.168.1.1', family: 4 }]) });
  await assert.rejects(tricked.netFetch(validateNetArgs({ url: 'http://router.example.com/' })), (e) => e.code === 'blocked_address');
});

test('net.fetch fetches, does not follow redirects, sends no cookie back and cuts long answers', async () => {
  const seen = [];
  const server = http.createServer((req, res) => {
    seen.push({ url: req.url, sig: req.headers['signature-agent'], cookie: req.headers.cookie });
    if (req.url === '/moved') { res.writeHead(302, { location: 'https://elsewhere.example/', 'set-cookie': 'a=b' }); return res.end(); }
    if (req.url === '/big') return res.end(Buffer.alloc(MAX_RESPONSE + 10, 1));
    res.setHeader('set-cookie', 'session=x'); res.setHeader('content-type', 'text/plain'); res.end('hello');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const port = server.address().port;
  const { netFetch } = createNetExit({ allowPrivate: true });
  const a = await netFetch(validateNetArgs({ url: `http://127.0.0.1:${port}/x`, headers: { 'signature-agent': 'sig1="https://bots.example"', cookie: 'no' } }));
  assert.equal(a.status, 200);
  assert.equal(Buffer.from(a.data, 'base64').toString(), 'hello');
  assert.equal(a.headers['set-cookie'], undefined);
  assert.equal(seen[0].sig, 'sig1="https://bots.example"');
  assert.equal(seen[0].cookie, undefined);
  const m = await netFetch(validateNetArgs({ url: `http://127.0.0.1:${port}/moved` }));
  assert.equal(m.status, 302);
  assert.equal(m.headers.location, 'https://elsewhere.example/');
  assert.equal(seen.length, 2, 'the redirect was not followed here');
  const big = await netFetch(validateNetArgs({ url: `http://127.0.0.1:${port}/big` }));
  assert.equal(big.truncated, true);
  assert.equal(Buffer.from(big.data, 'base64').length, MAX_RESPONSE);
  server.close();
});
