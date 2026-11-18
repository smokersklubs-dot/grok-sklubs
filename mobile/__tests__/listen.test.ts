import { setLocale } from "../src/i18n";
import { fromBase64 } from "../src/lib/screen";
import { ReplyListener, type Fetched, type ListenDeps } from "../src/voice/replyListener";

setLocale("fr");

/** « Écouter » (src/voice/replyListener.ts): the server's parts in order, the next fetched while one plays, the phone's voice on 409. */
function setup(answers: Fetched[]) {
  const fetched: number[] = [];
  const played: [number, Uint8Array][] = [];
  const spoken: [string, string][] = [];
  const states: string[] = [];
  let playedFn: ((id: number) => void) | null = null;
  let ttsFn: ((type: string, id: string) => void) | null = null;
  const out = { stops: 0, ttsStops: 0, done: 0 };
  const d: ListenDeps = {
    fetchPart: async (n) => { fetched.push(n); return answers[n] ?? { kind: "error", message: null }; },
    play: (id, b64) => played.push([id, fromBase64(b64)]),
    stopPlayback: () => { out.stops++; },
    onPlayed: (fn) => { playedFn = fn; return () => { playedFn = null; }; },
    speak: (id, text) => spoken.push([id, text]),
    stopSpeaking: () => { out.ttsStops++; },
    onTts: (fn) => { ttsFn = fn; return () => { ttsFn = null; }; },
    set: (p) => states.push(p.status),
    done: () => { out.done++; },
  };
  return { d, fetched, played, spoken, states, out, playedEnd: (i: number) => playedFn?.(played[i][0]), tts: (type: string) => ttsFn?.(type, spoken[0]?.[0] ?? ""), listening: () => !!playedFn };
}
const tick = () => new Promise((r) => setTimeout(r, 0));
const audio = (byte: number, parts: number): Fetched => ({ kind: "audio", wav: new Uint8Array([82, 73, 70, 70, byte]), parts });

test("plays the parts in order, fetching the next one while the current one plays", async () => {
  const s = setup([audio(1, 3), audio(2, 3), audio(3, 3)]);
  const l = new ReplyListener(s.d, "Bonjour.");
  await l.start();
  expect(s.played.map(([, b]) => b[4])).toEqual([1]);
  expect(s.fetched).toEqual([0, 1]);
  s.playedEnd(0); await tick();
  expect(s.played.map(([, b]) => b[4])).toEqual([1, 2]);
  expect(s.fetched).toEqual([0, 1, 2]);
  s.playedEnd(1); await tick();
  s.playedEnd(2); await tick();
  expect(s.out.done).toBe(1);
  expect(s.listening()).toBe(false);
  expect(s.states[0]).toBe("loading");
});

test("no server voice (409): the phone reads the cleaned text, done when it finishes", async () => {
  const s = setup([{ kind: "device" }]);
  const l = new ReplyListener(s.d, "Voir **ceci** :\n```js\nx()\n```");
  await l.start();
  expect(s.spoken[0][1]).toBe("Voir ceci : (code non lu)");
  s.tts("done");
  expect(s.out.done).toBe(1);
});

test("stop: playback stops, nothing more is played; an error says so", async () => {
  const s = setup([audio(1, 2), audio(2, 2)]);
  const l = new ReplyListener(s.d, "x");
  await l.start();
  l.stop();
  s.playedEnd(0); await tick();
  expect(s.played.length).toBe(1);
  expect(s.out.stops).toBe(1);
  expect(s.out.done).toBe(0);
  const e = setup([{ kind: "error", message: "nope" }]);
  await new ReplyListener(e.d, "x").start();
  expect(e.states).toEqual(["loading", "error"]);
});
