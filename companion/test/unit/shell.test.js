'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { runShell } = require('../../src/main/capabilities/shell');

const base = { timeoutMs: 5000, maxOutputBytes: 65536, cwd: null };

test('runs a command and captures output', { skip: process.platform === 'win32' }, async () => {
  const r = await runShell({ ...base, command: 'echo hello; echo oops 1>&2; exit 3' });
  assert.equal(r.stdout, 'hello\n');
  assert.equal(r.stderr, 'oops\n');
  assert.equal(r.exitCode, 3);
});

test('output cap', { skip: process.platform === 'win32' }, async () => {
  const r = await runShell({ ...base, command: 'head -c 200000 /dev/zero | tr "\\0" a', maxOutputBytes: 1000 });
  assert.equal(r.stdout.length, 1000);
  assert.equal(r.truncated, true);
});

test('timeout kills the whole process tree', { skip: process.platform === 'win32' }, async () => {
  const t = Date.now();
  const r = await runShell({ ...base, command: 'sleep 30 & sleep 30; echo never', timeoutMs: 300 });
  assert.equal(r.timedOut, true);
  assert.ok(Date.now() - t < 3000);
});

test('abort signal cancels', { skip: process.platform === 'win32' }, async () => {
  const ac = new AbortController();
  setTimeout(() => ac.abort(), 100);
  const r = await runShell({ ...base, command: 'sleep 30', signal: ac.signal });
  assert.equal(r.cancelled, true);
});
