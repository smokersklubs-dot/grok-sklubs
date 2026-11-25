// L154 (backlog A-FAIRE): the call outbox (web/src/lib/calloutbox.ts) keeps what a call sends while the network is down
// and sends it again in order, never twice; the wake word (web/src/lib/wakeword.ts) matches only a greeting with the
// bot's name, and is LOCAL only (on-device recognition answering "available").
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";

const { createOutbox, resultOf, OUTBOX_KEY, OUTBOX_MAX_AGE_MS } = await import("../src/lib/calloutbox.ts");
const { heardWake, wakePhrases, localStatus, installLocal, loose } = await import("../src/lib/wakeword.ts");

const memory = () => { const m = new Map(); return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => m.set(k, v), m }; };

test("HTTP answers: no answer, 408, 429 and 5xx are kept for later; other refusals are dropped", () => {
  assert.equal(resultOf(200), "ok");
  assert.equal(resultOf(0), "retry");
  assert.equal(resultOf(503), "retry");
  assert.equal(resultOf(429), "retry");
  assert.equal(resultOf(408), "retry");
  assert.equal(resultOf(400), "drop");
  assert.equal(resultOf(404), "drop");
});

test("network down: the sentence is kept (with its send key); back online: sent in order, then the outbox is empty", async () => {
  const store = memory();
  let online = false;
  const sent = [];
  const box = createOutbox({ storage: () => store, send: async (item) => { if (!online) return "retry"; sent.push(item.body.text); return "ok"; } });
  assert.equal(await box.send({ id: "say:a", path: "/bots/b1/messages", body: { text: "un", clientKey: "k-aaaaaaaa" }, kind: "utterance" }), "retry");
  box.queue({ id: "say:b", path: "/bots/b1/messages", body: { text: "deux", clientKey: "k-bbbbbbbb" }, kind: "utterance" });
  box.queue({ id: "end:c1", path: "/bots/b1/calls/c1/end", body: { transcript: [] }, kind: "end" });
  assert.equal(box.pending().length, 3);
  assert.equal(JSON.parse(store.m.get(OUTBOX_KEY))[0].body.clientKey, "k-aaaaaaaa", "the same key goes again: the server writes it once");
  assert.equal(await box.flush(), 0, "still offline: nothing lost");
  assert.equal(box.pending().length, 3);
  online = true;
  assert.equal(await box.flush(), 3);
  assert.deepEqual(sent, ["un", "deux", undefined]);
  assert.equal(box.pending().length, 0);
});

test("a refusal is dropped (not retried forever); a flush stops at the first item that still cannot go (order kept)", async () => {
  const store = memory();
  const answers = { a: "drop", b: "retry", c: "ok" };
  const box = createOutbox({ storage: () => store, send: async (item) => answers[item.id] });
  for (const id of ["a", "b", "c"]) box.queue({ id, path: "/x", body: {}, kind: "utterance" });
  assert.equal(await box.flush(), 0);
  assert.deepEqual(box.pending().map((i) => i.id), ["b", "c"], "a dropped, b kept and c waits behind it");
  assert.equal(box.pending()[0].tries, 1);
});

test("old items expire after 7 days; a blocked storage never throws (only the outbox is lost)", async () => {
  const store = memory();
  let t = 1_000_000;
  const box = createOutbox({ storage: () => store, now: () => t, send: async () => "retry" });
  box.queue({ id: "old", path: "/x", body: {}, kind: "end" });
  t += OUTBOX_MAX_AGE_MS + 1;
  assert.equal(box.pending().length, 0);
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); } };
  const box2 = createOutbox({ storage: () => blocked, send: async () => "retry" });
  assert.equal(await box2.send({ id: "x", path: "/x", body: {}, kind: "end" }), "retry");
  assert.deepEqual(box2.pending(), []);
});

test("wake word: a greeting with the bot's name or « Ok Sklubot », as whole words; nothing else", () => {
  assert.equal(loose("Salut, Léa !"), "salut lea");
  assert.ok(heardWake("salut Léa", "Léa"));
  assert.ok(heardWake("Euh… hé Léa tu es là", "Léa"));
  assert.ok(heardWake("OK Sklubot", "Juno"));
  assert.ok(!heardWake("Léa est partie", "Léa"), "the name alone is not a call");
  assert.ok(!heardWake("salut Léandre", "Léa"), "whole words only");
  assert.ok(!heardWake("bonjour à tous", "Léa"));
  assert.ok(wakePhrases("A").every((p) => p.includes("sklubot")), "a one-letter name only wakes with « Sklubot »");
});

test("wake word stays off unless the browser recognises speech ON the device (processLocally: true)", async () => {
  const seen = [];
  const ctor = (answer) => ({ available: async (o) => { seen.push(o); return answer; }, install: async () => true });
  assert.equal(await localStatus("fr-FR", ctor("available")), "available");
  assert.deepEqual(seen[0], { langs: ["fr-FR"], processLocally: true });
  assert.equal(await localStatus("fr-FR", ctor("downloadable")), "downloadable");
  assert.equal(await localStatus("fr-FR", ctor("unavailable")), "unavailable");
  assert.equal(await localStatus("fr-FR", ctor("something-new")), "unavailable");
  assert.equal(await localStatus("fr-FR", {}), "unavailable", "an older browser without available()");
  assert.equal(await localStatus("fr-FR", null), "unavailable");
  assert.equal(await localStatus("fr-FR", { available: async () => { throw new Error("x"); } }), "unavailable");
  assert.equal(await installLocal("fr-FR", ctor("downloadable")), true);
  assert.equal(await installLocal("fr-FR", {}), false);
});
