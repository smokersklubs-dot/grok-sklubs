// L149 — the live screen view: reconnect delays and the give-up point, paste (clipboard then Ctrl+V), the capture's name,
// and the numbered control lease (web/src/lib/reconnect.ts, web/src/lib/controlLease.ts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { BACKOFF_MS, captureName, pasteInto, reconnectDelay, reconnectView } from "../src/lib/reconnect.ts";
import { createControlLease } from "../src/lib/controlLease.ts";

test("a dropped stream is retried after 1, 2, 4, 8 and 15 s, then the view gives up and offers the button", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(reconnectDelay), [1000, 2000, 4000, 8000, 15000, null]);
  assert.equal(BACKOFF_MS.length, 5);
  assert.deepEqual(reconnectView(1, 999), { kind: "wait", attempt: 1, of: 5, seconds: 1 });
  assert.deepEqual(reconnectView(5, 15000), { kind: "wait", attempt: 5, of: 5, seconds: 15 });
  assert.deepEqual(reconnectView(6, 0), { kind: "gave-up" });
});

test("paste: the text becomes the bot's clipboard, then Ctrl+V (pressed, v, released); nothing for an empty clipboard", () => {
  const calls = [];
  const client = { clipboardPasteFrom: (t) => calls.push(["clip", t]), sendKey: (k, c, d) => calls.push(["key", k, c, d]), sendCtrlAltDel: () => {}, toBlob: () => {} };
  assert.equal(pasteInto(client, ""), false);
  assert.equal(calls.length, 0);
  assert.equal(pasteInto(client, "12 rue des Lilas"), true);
  assert.deepEqual(calls, [["clip", "12 rue des Lilas"], ["key", 0xffe3, "ControlLeft", true], ["key", 0x76, "KeyV", undefined], ["key", 0xffe3, "ControlLeft", false]]);
});

test("the capture is a PNG named after the bot and the time", () => {
  assert.equal(captureName("Léa › Compta", new Date(2026, 10, 23, 9, 5, 7)), "ecran-lea-compta-20261123-090507.png");
  assert.equal(captureName("***", new Date(2026, 0, 1, 0, 0, 0)), "ecran-bot-20260101-000000.png");
});

test("numbered control lease: a renewal carries its number; once handed back, a late renewal or a late answer never takes control again", async () => {
  const sent = [];
  let next = 1;
  const lease = createControlLease(async (body) => {
    sent.push(body);
    if (body.on === true && body.epoch === undefined) return { ok: true, epoch: next++ };
    if (body.on === true) return { ok: body.epoch === 1 && !sent.some((b) => b.on === false), epoch: body.epoch };
    return { ok: true };
  });
  await lease.take();
  assert.equal(lease.epoch(), 1);
  await lease.renew();
  assert.deepEqual(sent.at(-1), { on: true, epoch: 1 });
  const late = lease.renew(); // in flight when the user hands back
  await lease.handBack();
  await late;
  assert.deepEqual(sent.find((b) => b.on === false), { on: false, epoch: 1 });
  assert.equal(lease.epoch(), null, "a late answer does not bring the lease back");
  await lease.renew();
  assert.equal(sent.filter((b) => b.on === true).length, 3, "no renewal after handing back");
});
