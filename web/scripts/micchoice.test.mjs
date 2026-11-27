// L154 « choix du micro et reconnexion » (web/src/lib/micchoice.ts): the chosen microphone is an `ideal` device (an
// unplugged one falls back), the choice survives a blocked storage, and a stopped track calls back once.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";

const store = new Map();
globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v), removeItem: (k) => store.delete(k) };
const { micConstraints, preferredMic, setPreferredMic, watchMic } = await import("../src/lib/micchoice.ts");

test("no choice: the base constraints unchanged; a choice: an ideal deviceId (never exact)", () => {
  const base = { echoCancellation: true };
  assert.deepEqual(micConstraints(base, ""), base);
  assert.deepEqual(micConstraints(base, "mic-2"), { echoCancellation: true, deviceId: { ideal: "mic-2" } });
});

test("the choice is remembered, cleared with an empty id, and a blocked storage never throws", () => {
  setPreferredMic("mic-3");
  assert.equal(preferredMic(), "mic-3");
  setPreferredMic("");
  assert.equal(preferredMic(), "");
  const saved = globalThis.localStorage;
  globalThis.localStorage = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(preferredMic(), "");
  assert.doesNotThrow(() => setPreferredMic("x"));
  globalThis.localStorage = saved;
});

test("a microphone that stops by itself calls back once; after unwatching, never", () => {
  const listeners = new Set();
  const track = { addEventListener: (_n, f) => listeners.add(f), removeEventListener: (_n, f) => listeners.delete(f) };
  const stream = { getAudioTracks: () => [track] };
  let lost = 0;
  const unwatch = watchMic(stream, () => lost++);
  for (const f of [...listeners]) { f(); f(); }
  assert.equal(lost, 1);
  const again = watchMic(stream, () => lost++);
  again();
  for (const f of [...listeners]) f();
  assert.equal(lost, 1, "unwatched before it stopped");
  unwatch();
});
