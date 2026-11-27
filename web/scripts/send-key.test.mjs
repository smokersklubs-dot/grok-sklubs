// Send keys of the composer (mobile/shared/sendKey.ts, used by the web and the mobile app): one key per message, the
// same key again while the same message is being retried, a new one once it went through or the message changed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createSendKeys, randomKey, sendKeysFor } from "../../mobile/shared/sendKey.ts";

test("the same message retried keeps its key; a sent or changed message gets a new one", () => {
  let n = 0;
  const keys = createSendKeys(() => `key-${++n}`);
  const first = keys.keyFor('["bonjour",[],false]');
  assert.equal(keys.keyFor('["bonjour",[],false]'), first, "a retry after a lost reply sends the same key");
  assert.notEqual(keys.keyFor('["bonjour !",[],false]'), first, "edited text is another message");
  const edited = keys.keyFor('["bonjour !",[],false]');
  keys.done();
  assert.notEqual(keys.keyFor('["bonjour !",[],false]'), edited, "after a successful send, the same words are a new message");
});

test("keys are plain tokens the server accepts, and differ from one another", () => {
  const seen = new Set();
  for (let i = 0; i < 200; i++) { const k = randomKey(); assert.match(k, /^[A-Za-z0-9_-]{8,100}$/); seen.add(k); }
  assert.equal(seen.size, 200);
});

test("each place has its own keys", () => {
  assert.equal(sendKeysFor("bot-a"), sendKeysFor("bot-a"));
  assert.notEqual(sendKeysFor("bot-a").keyFor("x"), sendKeysFor("bot-b").keyFor("x"));
});
