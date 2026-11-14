'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ConsentGate } = require('../../src/main/consent');

test('one prompt at a time, cooldown after refusal, long cooldown after 3', () => {
  let now = 0;
  const g = new ConsentGate({ now: () => now });
  assert.equal(g.check('a'), null);
  g.open('a', 'session');
  assert.equal(g.check('b'), 'consent_pending');
  g.close(true);
  assert.equal(g.check('a'), 'consent_cooldown');
  assert.equal(g.check('b'), null);
  now += 61_000;
  assert.equal(g.check('a'), null);
  g.open('a', 'session'); g.close(true);
  now += 61_000;
  g.open('a', 'session'); g.close(true);
  now += 61_000;
  assert.equal(g.check('a'), 'consent_cooldown', '3 refusals in 10 min → long cooldown');
  assert.ok(g.cooldownLeft('a') > 8 * 60_000);
});

test('global limit: 6 prompts per 10 minutes whatever the bot', () => {
  let now = 0;
  const g = new ConsentGate({ now: () => now });
  for (let i = 0; i < 6; i++) { assert.equal(g.check(`b${i}`), null); g.open(`b${i}`, 'session'); g.close(false); now += 1000; }
  assert.equal(g.check('b9'), 'rate_limited');
  now += 10 * 60_000;
  assert.equal(g.check('b9'), null);
});
