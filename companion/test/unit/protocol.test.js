'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeServer, validateArgs, parseBot, parseKey } = require('../../src/main/protocol');

test('normalizeServer: https → wss, path kept, http refused except loopback', () => {
  assert.deepEqual(normalizeServer('sklubot.example.com'), { base: 'https://sklubot.example.com', wsUrl: 'wss://sklubot.example.com/api/relay/connect' });
  assert.equal(normalizeServer('https://ex.com/base/').wsUrl, 'wss://ex.com/base/api/relay/connect');
  assert.equal(normalizeServer('http://127.0.0.1:8787').wsUrl, 'ws://127.0.0.1:8787/api/relay/connect');
  assert.throws(() => normalizeServer('http://ex.com'), /https required/);
  assert.throws(() => normalizeServer('ftp://ex.com'));
  assert.throws(() => normalizeServer('https://user:pw@ex.com'));
});

test('validateArgs: clamps and rejects', () => {
  assert.deepEqual(validateArgs('screen.capture', {}), { format: 'jpeg', maxWidth: 1280, quality: 70 });
  assert.throws(() => validateArgs('screen.capture', { maxWidth: 99999 }), /out of range/);
  // L159: another screen only when asked; 0 = main, up to 16 screens.
  assert.deepEqual(validateArgs('screen.capture', { display: 1 }), { format: 'jpeg', maxWidth: 1280, quality: 70, display: 1 });
  assert.throws(() => validateArgs('screen.capture', { display: 16 }), /out of range/);
  assert.throws(() => validateArgs('screen.capture', { display: -1 }), /out of range/);
  assert.throws(() => validateArgs('mouse.move', { x: 'a', y: 1 }));
  assert.throws(() => validateArgs('url.open', { url: 'file:///etc/passwd' }), /only http/);
  assert.throws(() => validateArgs('url.open', { url: 'javascript:alert(1)' }));
  assert.throws(() => validateArgs('app.open', { name: 'calc; rm -rf ~' }), /invalid application name/);
  assert.throws(() => validateArgs('app.open', { name: '../bin/sh' }));
  assert.throws(() => validateArgs('app.open', { name: '-e' }));
  assert.deepEqual(validateArgs('app.open', { name: 'Firefox' }), { name: 'Firefox' });
  assert.throws(() => validateArgs('shell.run', { command: 'x'.repeat(9000) }), /too long/);
  assert.throws(() => validateArgs('shell.run', { command: 'ls', timeoutMs: 1e9 }), /out of range/);
  assert.throws(() => validateArgs('nope', {}), /unknown op/);
  assert.throws(() => validateArgs('mouse.move', []), /object/);
});

test('parseKey: combos and aliases', () => {
  assert.deepEqual(parseKey('ctrl+shift+T'), { key: 't', modifiers: ['control', 'shift'] });
  assert.deepEqual(parseKey('Enter'), { key: 'enter', modifiers: [] });
  assert.deepEqual(parseKey('a', ['cmd']), { key: 'a', modifiers: ['command'] });
  assert.deepEqual(parseKey('+'), { key: '+', modifiers: [] });
  assert.throws(() => parseKey('banana'));
  assert.throws(() => parseKey('a', ['hyper']));
});

test('parseBot strips control and bidi characters', () => {
  assert.deepEqual(parseBot({ id: 'b1', name: 'Al‮ice\u0000' }), { id: 'b1', name: 'Alice' });
  assert.throws(() => parseBot({ id: 'b 1' }));
  assert.equal(parseBot({ id: 'b2', name: 'x'.repeat(200) }).name.length, 60);
});
