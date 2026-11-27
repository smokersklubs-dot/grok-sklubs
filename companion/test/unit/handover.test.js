'use strict';
/**
 * Protocol 1.7: one computer for all the bots of an account — « all my bots » on the session question, and an idle
 * session handed over to the next bot. Never two bots at once; Stop wins everything; commands keep their own rules.
 */
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeCore } = require('./helpers');
const { HANDOVER_IDLE_MS } = require('../../src/main/relay-core');

const ALICE = { id: 'bot_a', name: 'Alice' };
const BOB = { id: 'bot_b', name: 'Bob' };
const CAROL = { id: 'bot_c', name: 'Carol' };
const clock = () => { const c = { t: 1_000_000 }; return { c, now: () => c.t }; };
const events = (h, name) => h.sent.filter((m) => m.type === 'event' && m.name === name);

test('« all my bots »: one yes, then any bot of the account gets the session without a question', async () => {
  const h = makeCore({ answers: { session: 'all' } });
  const r = await h.req('session.start', {}, ALICE);
  assert.equal(r.result.grant, 'account');
  assert.equal(h.account.allBots, true);
  assert.equal(h.bots.bot_a, undefined, 'no per-bot "always" written');
  await h.req('session.end', {}, ALICE);
  const b = await h.req('session.start', {}, BOB);
  assert.equal(b.ok, true);
  assert.equal(b.result.grant, 'account');
  assert.equal(h.prompts.length, 1, 'only the first question');
});

test('the account grant does not lift command confirmations', async () => {
  const h = makeCore({ allBots: true, answers: { command: { decision: 'refuse' } } });
  assert.equal((await h.req('session.start', {}, BOB)).ok, true);
  const r = await h.req('shell.run', { command: 'echo hi' }, BOB);
  assert.equal(r.error.code, 'command_refused');
  assert.equal(h.prompts.filter((p) => p.kind === 'command').length, 1);
});

test('revoked account grant: the next bot is asked again', async () => {
  const h = makeCore({ allBots: true });
  h.account.allBots = false;
  assert.equal((await h.req('session.start', {}, BOB)).error.code, 'consent_refused');
  assert.equal(h.prompts.length, 1);
});

test('busy holder: the newcomer gets busy with the holder and when to ask again; nothing changes', async () => {
  const { c, now } = clock();
  const h = makeCore({ allBots: true, now });
  await h.req('session.start', {}, ALICE);
  c.t += 5_000;
  const r = await h.req('session.start', {}, BOB);
  assert.equal(r.error.code, 'busy');
  assert.deepEqual(r.error.holder, ALICE);
  assert.equal(r.error.retryAfterMs, HANDOVER_IDLE_MS - 5_000);
  assert.equal(h.core.session.botId, 'bot_a');
  assert.equal(h.prompts.length, 0);
});

test(`idle holder (${HANDOVER_IDLE_MS / 1000} s) and a covered newcomer: hand-over without a question, one session only`, async () => {
  const { c, now } = clock();
  const h = makeCore({ allBots: true, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS;
  const r = await h.req('session.start', {}, BOB);
  assert.equal(r.ok, true);
  assert.deepEqual(r.result.from, ALICE);
  assert.equal(h.core.session.botId, 'bot_b');
  const ended = events(h, 'session.ended').pop();
  assert.equal(ended.reason, 'handover');
  assert.deepEqual(ended.to, BOB);
  assert.deepEqual(events(h, 'session.started').pop().from, ALICE);
  assert.equal(h.prompts.length, 0);
  // Alice is now the one without the session.
  assert.equal((await h.req('mouse.click', { x: 1, y: 1 }, ALICE)).error.code, 'busy');
});

test('a per-bot "always" also covers the hand-over', async () => {
  const { c, now } = clock();
  const h = makeCore({ perms: { bot_b: { name: 'Bob', control: 'always' } }, answers: { session: 'once' }, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS + 1;
  assert.equal((await h.req('session.start', {}, BOB)).result.grant, 'always');
  assert.equal(h.core.session.botId, 'bot_b');
});

test('activity resets the idle clock: a working bot is never replaced', async () => {
  const { c, now } = clock();
  const h = makeCore({ allBots: true, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS - 1000;
  await h.req('screen.capture', {}, ALICE);
  c.t += 2000;
  assert.equal((await h.req('session.start', {}, BOB)).error.code, 'busy');
});

test('a running command keeps the holder busy, however long it has been quiet', async () => {
  const { c, now } = clock();
  let finish;
  const h = makeCore({ allBots: true, now, answers: { command: { decision: 'run' } }, extraCaps: { runShell: () => new Promise((r) => { finish = r; }) } });
  await h.req('session.start', {}, ALICE);
  const running = h.req('shell.run', { command: 'sleep 60' }, ALICE);
  await new Promise((r) => setImmediate(r));
  c.t += HANDOVER_IDLE_MS * 3;
  const r = await h.req('session.start', {}, BOB);
  assert.equal(r.error.code, 'busy');
  assert.equal(r.error.retryAfterMs, HANDOVER_IDLE_MS);
  finish({ exitCode: 0, stdout: '', stderr: '', truncated: false, timedOut: false, cancelled: false, durationMs: 1, signal: null });
  await running;
});

test('idle holder, newcomer not covered: asked on the computer (saying who hands over); a yes hands over', async () => {
  const { c, now } = clock();
  const h = makeCore({ answers: { session: 'once' }, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS;
  const r = await h.req('session.start', {}, BOB);
  assert.equal(r.ok, true);
  assert.deepEqual(h.prompts[1].holder, ALICE);
  assert.equal(h.core.session.botId, 'bot_b');
});

test('idle holder, newcomer refused: the holder keeps its session', async () => {
  const { c, now } = clock();
  let n = 0;
  const h = makeCore({ answers: { session: () => Promise.resolve(++n === 1 ? 'once' : 'refuse') }, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS;
  assert.equal((await h.req('session.start', {}, BOB)).error.code, 'consent_refused');
  assert.equal(h.core.session.botId, 'bot_a');
  assert.equal(events(h, 'session.ended').length, 0);
});

test('a third bot that won the computer while the question was open is never replaced', async () => {
  const { c, now } = clock();
  let release;
  const h = makeCore({ answers: { session: (p) => (p.bot.id === 'bot_b' ? new Promise((r) => { release = r; }) : Promise.resolve('once')) }, now });
  await h.req('session.start', {}, ALICE);
  c.t += HANDOVER_IDLE_MS;
  const bob = h.req('session.start', {}, BOB);
  await new Promise((r) => setImmediate(r));
  // Alice lets go and Carol (always allowed) takes the computer while Bob's question is open.
  h.core.endSession('bot');
  h.bots.bot_c = { name: 'Carol', control: 'always' };
  assert.equal((await h.req('session.start', {}, CAROL)).ok, true);
  release('once');
  assert.equal((await bob).error.code, 'busy');
  assert.equal(h.core.session.botId, 'bot_c');
});

test('Stop wins: locked relay refuses every hand-over, even with the account grant', async () => {
  const { c, now } = clock();
  const h = makeCore({ allBots: true, now });
  await h.req('session.start', {}, ALICE);
  h.core.stop('user');
  c.t += HANDOVER_IDLE_MS * 2;
  assert.equal((await h.req('session.start', {}, BOB)).error.code, 'locked');
  assert.equal(h.core.session, null);
});
