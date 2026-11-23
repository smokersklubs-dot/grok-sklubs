// L153 « Vérifier ce bot » (src/lib/selfcheck.ts): the word, the message, the three lines.
//
//   npm test -w web
import { test } from "node:test";
import assert from "node:assert/strict";
import { selfCheckLines, selfCheckMessage, selfCheckToken, SELFCHECK_FILE, SELFCHECK_TIMEOUT } from "../src/lib/selfcheck.ts";

test("L153: the word matches the server's shape; the message names the page, the file and the word", () => {
  const tok = selfCheckToken(() => 0.5);
  assert.match(tok, /^SKB-[A-Z0-9]{6,12}$/);
  assert.match(selfCheckToken(() => 0.9999999), /^SKB-[A-Z0-9]{8}$/);
  for (const lang of ["fr", "en"]) {
    const m = selfCheckMessage(lang, tok, "https://x.test/p/abc");
    assert.ok(m.includes(tok) && m.includes(SELFCHECK_FILE) && m.includes("https://x.test/p/abc"));
    assert.equal((m.match(/^\d\./gm) || []).length, 3);
  }
});

test("L153: waiting, then ok or failed; the time limit ends the wait", () => {
  assert.deepEqual(selfCheckLines(null, 0), { page: "wait", file: "wait", journal: "wait", done: false });
  assert.deepEqual(selfCheckLines({ file: "match", page: true, journal: [{ status: "done" }] }, 1000), { page: "ok", file: "ok", journal: "ok", done: true });
  assert.deepEqual(selfCheckLines({ file: "other", page: false, journal: [{ status: "denied" }] }, 1000), { page: "wait", file: "fail", journal: "fail", done: false });
  assert.deepEqual(selfCheckLines({ file: "missing", page: false, journal: [] }, SELFCHECK_TIMEOUT), { page: "fail", file: "fail", journal: "fail", done: true });
});
