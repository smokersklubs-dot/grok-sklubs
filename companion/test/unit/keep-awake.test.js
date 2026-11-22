'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createKeepAwake } = require('../../src/main/keep-awake');

function fakePsb() {
  let next = 1;
  const active = new Map();
  return { active, start: (type) => { const id = next++; active.set(id, type); return id; }, stop: (id) => { active.delete(id); } };
}

test('a control session keeps the display awake, released when it ends (one blocker however often it is reported)', () => {
  const psb = fakePsb();
  const awake = createKeepAwake(psb);
  awake.session(true);
  awake.session(true);
  assert.deepEqual([...psb.active.values()], ['prevent-display-sleep']);
  awake.session(false);
  assert.equal(psb.active.size, 0);
  awake.session(false);
  assert.equal(psb.active.size, 0);
});

test('commands keep the system awake while they run, two at once share one blocker, released even on failure', async () => {
  const psb = fakePsb();
  const awake = createKeepAwake(psb);
  let finish1, finish2;
  const run = awake.during((n) => new Promise((resolve, reject) => { if (n === 1) finish1 = resolve; else finish2 = reject; }));
  const p1 = run(1);
  const p2 = run(2).catch(() => 'failed');
  assert.deepEqual([...psb.active.values()], ['prevent-app-suspension']);
  assert.equal(awake.state().commands, 2);
  finish1({ exitCode: 0 });
  assert.deepEqual(await p1, { exitCode: 0 });
  assert.equal(psb.active.size, 1, 'still one command running');
  finish2(new Error('boom'));
  assert.equal(await p2, 'failed');
  assert.equal(psb.active.size, 0);
});

test('releaseAll lets everything go (relay stopped); a broken powerSaveBlocker never breaks a command', async () => {
  const psb = fakePsb();
  const awake = createKeepAwake(psb);
  awake.session(true);
  awake.hold('command');
  assert.equal(psb.active.size, 2);
  awake.releaseAll();
  assert.equal(psb.active.size, 0);
  const logs = [];
  const broken = createKeepAwake({ start: () => { throw new Error('no dbus'); }, stop: () => {} }, (e) => logs.push(e));
  assert.equal(await broken.during(async () => 42)(), 42);
  assert.ok(logs.some((e) => e.kind === 'warning'));
});
