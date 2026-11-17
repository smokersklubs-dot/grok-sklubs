// The microphone's choice between the browser's speech recognition and the server's (web/src/lib/dictationPlan.ts), and
// the WAV the recorded fallback sends to POST /api/voice/transcribe (16 kHz, 16-bit PCM, mono).
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { dictationRoute, encodeWav, fallbackError, pickRecorderType, toMono16k, MAX_RECORD_MS } from "../src/lib/dictationPlan.ts";

const base = { serverMode: false, serverDictation: false, browser: false, recorder: true, browserFailed: false };

test("server voice for calls: dictation goes through the server too", () => {
  assert.equal(dictationRoute({ ...base, serverMode: true, serverDictation: true, browser: true }), "server");
});

test("browser recognition first when the server only offers dictation", () => {
  assert.equal(dictationRoute({ ...base, serverDictation: true, browser: true }), "browser");
  assert.equal(dictationRoute({ ...base, browser: true }), "browser");
});

test("no recognition in the browser (iOS Safari, Firefox): the server, else the 'unavailable' notice", () => {
  assert.equal(dictationRoute({ ...base, serverDictation: true }), "server");
  assert.equal(dictationRoute({ ...base }), "unavailable");
  assert.equal(dictationRoute({ ...base, serverDictation: true, recorder: false }), "unavailable", "cannot record: nothing to send");
});

test("the browser's recognition failed (network, service-not-allowed…): fall back to recording, else the notice", () => {
  assert.equal(dictationRoute({ ...base, browser: true, browserFailed: true, serverDictation: true }), "server");
  assert.equal(dictationRoute({ ...base, browser: true, browserFailed: true }), "unavailable");
});

test("which recognition errors switch to recording; a refused permission does not", () => {
  for (const code of ["network", "service-not-allowed", "audio-capture", "language-not-supported", "unsupported"]) assert.ok(fallbackError(code), code);
  for (const code of ["not-allowed", "no-speech", "aborted"]) assert.ok(!fallbackError(code), code);
});

test("recorder format: Opus/WebM where it exists, MP4 on Safari, the default otherwise", () => {
  assert.equal(pickRecorderType((t) => t.startsWith("audio/webm")), "audio/webm;codecs=opus");
  assert.equal(pickRecorderType((t) => t === "audio/mp4"), "audio/mp4");
  assert.equal(pickRecorderType(() => false), "");
  assert.ok(MAX_RECORD_MS < 60_000, "stops before the server's one-minute limit");
});

test("48 kHz stereo → 16 kHz mono 16-bit WAV, with a valid header", () => {
  const n = 48000; // one second
  const left = new Float32Array(n).fill(0.5);
  const right = new Float32Array(n).fill(-0.5);
  const tone = new Float32Array(n).map((_, i) => Math.sin((2 * Math.PI * 440 * i) / 48000) * 0.8);
  assert.equal(toMono16k([left, right], 48000).every((v) => Math.abs(v) < 1e-6), true, "channels are averaged");
  const mono = toMono16k([tone], 48000);
  assert.equal(mono.length, 16000);
  const wav = encodeWav(mono);
  const v = new DataView(wav.buffer);
  const str = (a, b) => String.fromCharCode(...wav.subarray(a, b));
  assert.equal(str(0, 4), "RIFF"); assert.equal(str(8, 12), "WAVE"); assert.equal(str(36, 40), "data");
  assert.equal(v.getUint16(20, true), 1, "PCM");
  assert.equal(v.getUint16(22, true), 1, "mono");
  assert.equal(v.getUint32(24, true), 16000);
  assert.equal(v.getUint16(34, true), 16);
  assert.equal(v.getUint32(40, true), 32000);
  assert.equal(wav.length, 44 + 32000);
  const peak = Math.max(...Array.from({ length: 16000 }, (_, i) => Math.abs(v.getInt16(44 + i * 2, true))));
  assert.ok(peak > 20000 && peak <= 32767, `the tone survives the resampling (peak ${peak})`);
  // A slower source is interpolated up; 16 kHz passes through.
  assert.equal(toMono16k([new Float32Array(8000)], 8000).length, 16000);
  assert.equal(toMono16k([new Float32Array(160)], 16000).length, 160);
  // Out-of-range samples are clipped, not wrapped.
  const clipped = new DataView(encodeWav(new Float32Array([2, -2])).buffer);
  assert.deepEqual([clipped.getInt16(44, true), clipped.getInt16(46, true)], [32767, -32768]);
});
