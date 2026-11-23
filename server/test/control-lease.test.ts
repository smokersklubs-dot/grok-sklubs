import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-lease-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const { controlRequest, userDriving, releaseControl } = await import("../src/takeover.js");

// L149 — the numbered control lease (takeover.ts controlRequest).
test("each control session gets a number; a renewal with an old number is refused; an old hand-back never ends a newer lease", () => {
  const a = controlRequest("bot_x", { on: true });
  assert.equal(a.ok, true);
  assert.equal(typeof a.epoch, "number");
  assert.equal(userDriving("bot_x"), true);
  assert.deepEqual(controlRequest("bot_x", { on: true, epoch: a.epoch }), { ok: true, epoch: a.epoch });
  // Hand back, then a renewal that was still on the network arrives: refused, the bot keeps its screen.
  assert.deepEqual(controlRequest("bot_x", { on: false, epoch: a.epoch }), { ok: true });
  assert.equal(userDriving("bot_x"), false);
  assert.deepEqual(controlRequest("bot_x", { on: true, epoch: a.epoch }), { ok: false, epoch: a.epoch });
  assert.equal(userDriving("bot_x"), false, "a late renewal never takes control again");
  // A new session; a late hand-back of the old one does not end it.
  const b = controlRequest("bot_x", { on: true });
  assert.ok(b.epoch! > a.epoch!);
  controlRequest("bot_x", { on: false, epoch: a.epoch });
  assert.equal(userDriving("bot_x"), true);
  // A viewer without numbers (older app) still hands back.
  releaseControl("bot_x");
  assert.equal(userDriving("bot_x"), false);
  // After a restart the lease is unknown: the renewal is refused, so the viewer takes a new one.
  assert.equal(controlRequest("bot_y", { on: true, epoch: 99 }).ok, false);
});
