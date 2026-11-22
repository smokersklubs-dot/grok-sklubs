// L142: the stop-cause chip of a bot in the sidebar (stopcause.ts), from its latest main-chat rows.
import { test } from "node:test";
import assert from "node:assert/strict";
import { stopCauseOf } from "../src/stopcause.js";
import type { Row, RowBody } from "../src/shared.js";

let seq = 0;
const row = (body: RowBody, thread?: number): Row => ({ seq: ++seq, botId: "b", createdAt: 1000 + seq, body, ...(thread ? { thread } : {}) }) as Row;
const msg = (role: "user" | "assistant", text: string) => row({ kind: "message", role, text } as RowBody);
const notice = (extra: object) => row({ kind: "notice", tone: "warn", text: "x", ...extra } as RowBody);

test("each stopping notice gives its cause; steps and cards after it do not hide it", () => {
  assert.equal(stopCauseOf([msg("user", "go"), notice({ action: { kind: "continue", status: "pending" } })])?.cause, "steps");
  assert.equal(stopCauseOf([notice({ action: { kind: "continue", status: "pending", reason: "timeout" } })])?.cause, "timeout");
  assert.equal(stopCauseOf([notice({ action: { kind: "continue", status: "pending", reason: "busy" } })])?.cause, "busy");
  assert.equal(stopCauseOf([notice({ action: { kind: "continue", status: "pending", reason: "gone" } })])?.cause, "interrupted");
  assert.equal(stopCauseOf([notice({ action: { kind: "plan", reason: "budget" } })])?.cause, "plan");
  assert.equal(stopCauseOf([notice({ action: { kind: "sublimit", engine: "codex", until: 0, notify: false, status: "waiting" } })])?.cause, "sublimit");
  assert.equal(stopCauseOf([notice({ tone: "info", text: "Arrêté." })], ["Stopped.", "Arrêté."])?.cause, "stopped");
  assert.equal(stopCauseOf([notice({ tone: "error", text: "Le modèle a refusé." })])?.cause, "error");
  assert.equal(stopCauseOf([notice({ text: "I stopped because I was going round in circles: same page." })])?.cause, "loop");
  const steps = [notice({ tone: "error", text: "boom" }), row({ kind: "step", status: "done" } as unknown as RowBody), row({ kind: "card" } as unknown as RowBody)];
  assert.equal(stopCauseOf(steps)?.cause, "error");
  assert.equal(stopCauseOf(steps)?.text, "boom");
});

test("no chip once the bot answered, you wrote, the work was continued or the limit is over", () => {
  assert.equal(stopCauseOf([notice({ tone: "error", text: "boom" }), msg("assistant", "Voilà")]), null);
  assert.equal(stopCauseOf([notice({ tone: "error", text: "boom" }), msg("user", "réessaie")]), null);
  assert.equal(stopCauseOf([notice({ action: { kind: "continue", status: "done" } })]), null);
  assert.equal(stopCauseOf([notice({ action: { kind: "sublimit", engine: "codex", until: 0, notify: false, status: "back" } })]), null);
  assert.equal(stopCauseOf([]), null);
});

test("information notices and thread rows are skipped", () => {
  assert.equal(stopCauseOf([notice({ tone: "error", text: "boom" }), notice({ tone: "info", action: { kind: "note", noteId: 1, status: "pending" } })])?.cause, "error");
  assert.equal(stopCauseOf([notice({ tone: "error", text: "boom" }), msg("assistant", "dans un fil")].map((r, i) => (i === 1 ? { ...r, thread: 3 } : r)))?.cause, "error");
  assert.equal(stopCauseOf([notice({ tone: "info", text: "Pour info" })]), null);
});
