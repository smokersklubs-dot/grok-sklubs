'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCore } = require('./helpers');

test('requests need a session; session needs local consent (refused by default)', async () => {
  const h = makeCore();
  assert.equal((await h.req('mouse.click', { x: 1, y: 1 })).error.code, 'no_session');
  const r = await h.req('session.start');
  assert.equal(r.error.code, 'consent_refused');
  assert.equal(h.prompts.length, 1);
  assert.equal(h.calls.length, 0);
});

test('shell command is refused without local confirmation even inside a session', async () => {
  const h = makeCore({ answers: { session: 'once' } });
  assert.equal((await h.req('session.start')).ok, true);
  const r = await h.req('shell.run', { command: 'echo hi' });
  assert.equal(r.ok, false);
  assert.equal(r.error.code, 'command_refused');
  assert.equal(h.calls.filter((c) => c.name === 'runShell').length, 0);
  assert.equal(h.prompts.filter((p) => p.kind === 'command').length, 1);
});

test('confirmed command runs; the yes covers the session\'s other ordinary commands, not a sensitive one, not the next session', async () => {
  const h = makeCore({ answers: { session: 'once', command: { decision: 'run' } } });
  await h.req('session.start');
  assert.equal((await h.req('shell.run', { command: 'echo hi' })).ok, true);
  // Next ordinary command: no prompt.
  await h.req('shell.run', { command: 'echo again' });
  assert.equal(h.prompts.filter((p) => p.kind === 'command').length, 1);
  // On the floor: asked every time, saying why.
  await h.req('shell.run', { command: 'rm -rf build' });
  const floor = h.prompts.filter((p) => p.kind === 'command');
  assert.equal(floor.length, 2);
  assert.equal(floor[1].floor, 'delete');
  await h.req('session.end');
  await h.req('session.start');
  await h.req('shell.run', { command: 'echo hi' });
  assert.equal(h.prompts.filter((p) => p.kind === 'command').length, 3, 'asked again in a new session');
});

test('"always allow this bot" skips the prompt next time; other bot is busy', async () => {
  const h = makeCore({ answers: { session: 'always' } });
  assert.equal((await h.req('session.start')).result.grant, 'always');
  assert.equal(h.bots.bot_a.control, 'always');
  assert.equal((await h.req('session.start', {}, { id: 'bot_b', name: 'Bob' })).error.code, 'busy');
  await h.req('session.end');
  assert.equal((await h.req('session.start')).ok, true);
  assert.equal(h.prompts.length, 1);
});

test('server cannot grant itself permissions: no such operation exists', async () => {
  const h = makeCore();
  for (const op of ['consent.set', 'permissions.set', 'relay.unlock', 'settings.update', 'constructor', '__proto__', 'toString']) {
    const r = await h.req(op, { commands: true });
    assert.equal(r.error.code, 'unknown_op', op);
  }
  assert.deepEqual(h.bots, {});
});

test('cooldown: a refused bot cannot re-prompt immediately (no dialog shown)', async () => {
  const h = makeCore();
  await h.req('session.start');
  const r = await h.req('session.start');
  assert.equal(r.error.code, 'consent_cooldown');
  assert.ok(r.error.retryAfterMs > 0);
  assert.equal(h.prompts.length, 1);
});

test('unanswered prompt expires and counts as refusal', async () => {
  const h = makeCore({ answers: { session: () => new Promise(() => {}) }, gateOptions: { promptTimeoutMs: 20 } });
  const r = await h.req('session.start');
  assert.equal(r.error.code, 'consent_expired');
});

test('mouse/keyboard input is refused while a consent dialog is open', async () => {
  let release;
  const h = makeCore({ answers: { session: 'once', command: () => new Promise((r) => { release = r; }) } });
  await h.req('session.start');
  const pendingShell = h.req('shell.run', { command: 'echo hi' });
  await new Promise((r) => setImmediate(r));
  const click = await h.req('mouse.click', { x: 10, y: 10 });
  assert.equal(click.error.code, 'consent_pending');
  const typed = await h.req('keyboard.type', { text: 'y' });
  assert.equal(typed.error.code, 'consent_pending');
  release({ decision: 'refuse' });
  assert.equal((await pendingShell).error.code, 'command_refused');
});

test('Stop locks the relay: everything refused, no prompt, until local unlock', async () => {
  const h = makeCore({ answers: { session: 'once' }, perms: { bot_a: { name: 'Alice', control: 'always' } } });
  await h.req('session.start');
  h.core.stop('hotkey');
  assert.equal(h.core.session, null);
  assert.equal(h.isLocked(), true);
  const ended = h.sent.find((m) => m.type === 'event' && m.name === 'session.ended');
  assert.equal(ended.reason, 'hotkey');
  assert.ok(h.sent.find((m) => m.type === 'event' && m.name === 'relay.locked'));
  assert.equal((await h.req('session.start')).error.code, 'locked');
  assert.equal((await h.req('screen.capture')).error.code, 'locked');
  assert.equal(h.prompts.length, 0);
  h.core.unlock();
  assert.equal((await h.req('session.start')).ok, true);
});

test('test auto-confirm flag (injected by the local process only) skips prompts', async () => {
  const h = makeCore({ autoConfirm: true });
  assert.equal((await h.req('session.start')).result.grant, 'test');
  assert.equal((await h.req('shell.run', { command: 'echo' })).ok, true);
  assert.equal(h.prompts.length, 0);
});

test('request flood is rate limited', async () => {
  const h = makeCore();
  const results = [];
  for (let i = 0; i < 80; i++) results.push(await h.req('screen.info'));
  assert.ok(results.some((r) => r.error && r.error.code === 'rate_limited'));
});

test('action log never contains screenshot data', async () => {
  const h = makeCore({ answers: { session: 'once' } });
  await h.req('session.start');
  await h.req('screen.capture');
  assert.ok(!JSON.stringify(h.logs).includes('"data"'));
});
