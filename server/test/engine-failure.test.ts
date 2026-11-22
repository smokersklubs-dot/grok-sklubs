import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

// L27: the engine's failure classes come from structured fields (engine-failure.ts), and a fault of Sklubot itself is
// never tried again on its own (failures.ts "server_fault"). Pure functions; no server.
process.env.DATA_DIR = mkdtempSync(path.join(tmpdir(), "sklubot-ef2-"));
process.env.SESSION_SECRET = "test-secret-test-secret-test-secret";
process.env.NO_SCHEDULER = "1";

const ef = await import("../src/agent/engine-failure.js");
const { classifyFailure, decideFailure, remediesFor } = await import("../src/agent/failures.js");
const { collectSideReply } = await import("../src/agent/sidereply.js");
const { FAILURE_CLASSES } = await import("../src/failuretypes.js");

test("every documented SDKAssistantMessageError code has a class, except 'unknown' (left to the words)", () => {
  const want: Record<string, string | null> = {
    authentication_failed: "auth_expired", oauth_org_not_allowed: "auth_expired", cloud_credential_error: "auth_expired",
    billing_error: "out_of_budget", account_on_hold: "out_of_budget", rate_limit: "rate_limited", overloaded: "provider_down",
    server_error: "provider_down", invalid_request: "bad_input", model_not_found: "bad_input", max_output_tokens: "bad_input", unknown: null,
  };
  for (const [code, cls] of Object.entries(want)) assert.equal(ef.claudeErrorClass(code), cls, code);
  assert.equal(ef.claudeErrorClass(42), null);
});

test("HTTP statuses: 401/403 sign-in, 402 budget, 429 rate, 408/504 timeout, 5xx service, other 4xx request", () => {
  const cases: [unknown, string | null][] = [[401, "auth_expired"], [403, "auth_expired"], [402, "out_of_budget"], [429, "rate_limited"], [408, "timeout"], [504, "timeout"], [529, "provider_down"], [500, "provider_down"], [404, "bad_input"], [413, "bad_input"], [200, null], [null, null], ["500", null]];
  for (const [s, cls] of cases) assert.equal(ef.statusClass(s), cls, String(s));
  assert.equal(ef.claudeFailureClass("rate_limit", { api_error_status: 500 }), "rate_limited", "the assistant's code wins");
  assert.equal(ef.claudeFailureClass(null, { api_error_status: 401 }), "auth_expired");
});

test("lost session: the 2.1.330 form (no init, error_during_execution, num_turns 0) and the older words; never on a fresh start", () => {
  const recorded = { type: "result", subtype: "error_during_execution", is_error: true, num_turns: 0, errors: ["No conversation found with session ID: 00000000-0000-4000-8000-000000000000"] };
  assert.equal(ef.claudeSessionMissing(recorded, true, false), true);
  assert.equal(ef.claudeSessionMissing({ ...recorded, errors: ["Keine Unterhaltung."] }, true, false), true, "structured, whatever the words");
  assert.equal(ef.claudeSessionMissing({ ...recorded, errors: ["boom"] }, true, true), false, "after init the session did start");
  assert.equal(ef.claudeSessionMissing(recorded, false, false), false, "nothing was resumed");
  assert.equal(ef.claudeSessionMissing({ type: "result", is_error: true, result: "No conversation found with session ID: x" }, true, true), true, "older text form");
  assert.equal(ef.claudeErrorText(recorded), recorded.errors[0]);
});

test("L24: sklubotToolsMissing stops on failed / needs-auth / missing, goes on with connected / pending / no field", () => {
  assert.equal(ef.sklubotToolsMissing({ mcp_servers: [{ name: "sklubot", status: "failed" }] }), "failed");
  assert.equal(ef.sklubotToolsMissing({ mcp_servers: [{ name: "sklubot", status: "needs-auth" }] }), "needs-auth");
  assert.equal(ef.sklubotToolsMissing({ mcp_servers: [{ name: "other", status: "connected" }] }), "missing");
  assert.equal(ef.sklubotToolsMissing({ mcp_servers: [{ name: "sklubot", status: "connected" }, { name: "other", status: "failed" }] }), null, "another server's failure is not ours");
  assert.equal(ef.sklubotToolsMissing({ mcp_servers: [{ name: "sklubot", status: "pending" }] }), null);
  assert.equal(ef.sklubotToolsMissing({ session_id: "x" }), null);
  assert.ok(ef.CODEX_TOOLS_MISSING.test("Failed to create session: required MCP servers failed to initialize: sklubot: handshaking"));
});

test("L17: claudeTurnTokens reads `usage` only, never total_cost_usd / modelUsage", () => {
  const r = { usage: { input_tokens: 2, output_tokens: 3, cache_read_input_tokens: 3841, cache_creation_input_tokens: 63 }, total_cost_usd: 0.00093067, modelUsage: { m: { inputTokens: 6, outputTokens: 9, cacheReadInputTokens: 7337, cacheCreationInputTokens: 4261 } } };
  assert.deepEqual(ef.claudeTurnTokens(r), { inputTokens: 3906, outputTokens: 3, cachedTokens: 3841 });
  assert.deepEqual(ef.claudeTurnTokens({}), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
  assert.deepEqual(ef.claudeTurnTokens({ usage: { input_tokens: -5, output_tokens: Number.NaN } }), { inputTokens: 0, outputTokens: 0, cachedTokens: 0 });
});

test("server_fault: a class of the wire list, set from structured input or this server's own error codes, never retried", () => {
  assert.ok((FAILURE_CLASSES as readonly string[]).includes("server_fault"));
  assert.equal(classifyFailure({ text: "anything at all", cls: "server_fault" }).cls, "server_fault");
  assert.equal(classifyFailure({ text: "rate limit exceeded 429", cls: "auth_expired" }).cls, "auth_expired", "structured wins over words");
  const oom = Object.assign(new Error("Cannot allocate"), { code: "ENOMEM" });
  assert.equal(classifyFailure({ err: oom }).cls, "server_fault");
  const full = Object.assign(new Error("database or disk is full"), { code: "SQLITE_FULL" });
  assert.equal(classifyFailure({ err: full }).cls, "server_fault");
  const d = decideFailure({ cls: "server_fault", retries: 0, uncertain: false, breakerOpen: false, teammate: { id: "b2", name: "Two" } });
  assert.deepEqual({ auto: d.auto, card: d.card, notify: d.notify }, { auto: null, card: true, notify: true }, "no retry, no handoff: one card");
  assert.ok(remediesFor("server_fault").length >= 1);
  // The same input without a structured class is still read from its words, as before.
  assert.equal(classifyFailure({ text: "API Error: 503 service unavailable" }).cls, "provider_down");
});

test("side requests: structured fields first (a reworded sign-in error is still 'reconnect')", () => {
  const r = collectSideReply("claude-code");
  r.line(JSON.stringify({ type: "assistant", error: "authentication_failed", message: { content: [{ type: "text", text: "Sitzung abgelaufen" }] } }));
  r.line(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 401, result: "Sitzung abgelaufen" }));
  assert.throws(() => r.finish({ code: 1, stderr: "" }, false), /doit être renouvelée/);
  const m = collectSideReply("claude-code");
  m.line(JSON.stringify({ type: "assistant", error: "model_not_found", message: { content: [] } }));
  m.line(JSON.stringify({ type: "result", subtype: "success", is_error: true, api_error_status: 404, result: "?" }));
  assert.throws(() => m.finish({ code: 1, stderr: "" }, false), /modèle sélectionné est indisponible/);
});
