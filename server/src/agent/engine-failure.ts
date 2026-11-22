/*
 * Portions adapted from storytold/craft-anything (https://github.com/storytold/craft-anything, commit
 * 8cec25d02007db604b57ce6735ad4eb44a1a9948: crates/ai/src/failure.rs `TurnFailure::claude` / `from_api`, and the
 * init check of crates/ai/src/cli_agents/adapters.rs), Copyright (c) 2026 ArtCraft Team and the Craft Anything
 * contributors, MIT OR Apache-2.0 (used here under MIT); modified for Sklubot: rewritten in TypeScript, mapped onto
 * Sklubot's failure classes (failuretypes.ts), Sklubot's own MCP server name, and the session check and token count of
 * engine.ts.
 */
import type { FailureClass } from "../shared.js";
import type { TurnUsage } from "../llm/types.js";

/**
 * What a subscription engine's failure IS, read from the structured fields of its stream, never from its English
 * sentences (L27). A reworded message from Claude Code or Codex must not change the remedy shown, nor whether the work is
 * tried again. The words are kept only for the person reading the card, and as a last resort when the tool gives no
 * structured field at all (older versions, Codex: see below).
 *
 * Claude Code (`claude -p --output-format stream-json`), documented in the Agent SDK reference
 * (code.claude.com/docs/en/agent-sdk/typescript):
 *  - SDKAssistantMessage `error?: SDKAssistantMessageError`: 'authentication_failed' | 'oauth_org_not_allowed' |
 *    'account_on_hold' | 'billing_error' | 'rate_limit' | 'overloaded' | 'invalid_request' | 'model_not_found' |
 *    'server_error' | 'max_output_tokens' | 'cloud_credential_error' | 'unknown'.
 *  - SDKResultMessage `api_error_status?: number | null` ("the HTTP status code of the API error that terminated the
 *    conversation"), `subtype` ("success" | "error_max_turns" | "error_during_execution" | "error_max_budget_usd" |
 *    "error_max_structured_output_retries"), `errors: string[]` on the error arm.
 *  - SDKSystemMessage init `mcp_servers: { name: string; status: string; source?: string }[]`.
 *  Checked live with Claude Code 2.1.330 (2026-11-22): an unknown model gives an assistant line with
 *  `error: "model_not_found"` and a result with `is_error: true, api_error_status: 404, terminal_reason: "api_error"`;
 *  `--resume <unknown id>` gives ONE result line `subtype: "error_during_execution", num_turns: 0,
 *  errors: ["No conversation found with session ID: …"]` and no init line at all (its text is in `errors`, not in
 *  `result`); an unreachable MCP server shows `{"name":"sklubot","status":"failed"}` in init, a working one
 *  `"connected"`, and the turn goes on either way.
 *
 * Codex (`codex exec --json`): its failure events carry a message only (codex-rs/exec/src/exec_events.rs:
 * `ThreadErrorEvent { message: String }`), so Codex failures stay classified by the failure coordinator from their words
 * (failures.ts), except the limit and lost-session messages already matched on the binary's own Display strings
 * (sublimit.ts, engine.ts CODEX_LOST_SESSION) and the required-server startup failure below.
 */

/** Claude Code's `assistant.error` codes (see above), as Sklubot's failure classes. Unknown codes: null (words decide). */
const CLAUDE_ERROR_CLASSES: Record<string, FailureClass> = {
  authentication_failed: "auth_expired", oauth_org_not_allowed: "auth_expired", cloud_credential_error: "auth_expired",
  billing_error: "out_of_budget", account_on_hold: "out_of_budget",
  invalid_request: "bad_input", model_not_found: "bad_input", max_output_tokens: "bad_input",
  rate_limit: "rate_limited",
  server_error: "provider_down", overloaded: "provider_down",
};
export function claudeErrorClass(code: unknown): FailureClass | null {
  return typeof code === "string" ? CLAUDE_ERROR_CLASSES[code] ?? null : null;
}

/** An HTTP status of the service, as a class (Craft Anything's `from_api` table). */
export function statusClass(status: unknown): FailureClass | null {
  if (typeof status !== "number" || !Number.isInteger(status)) return null;
  if (status === 401 || status === 403) return "auth_expired";
  if (status === 402) return "out_of_budget";
  if (status === 429) return "rate_limited";
  if (status === 408 || status === 504) return "timeout";
  if (status >= 500 && status <= 599) return "provider_down";
  if (status >= 400 && status <= 499) return "bad_input";
  return null;
}

/** The class of a Claude Code turn that ended on an error: the assistant's error code first, then the result's HTTP status. */
export function claudeFailureClass(assistantError: unknown, result: { api_error_status?: unknown } | null | undefined): FailureClass | null {
  return claudeErrorClass(assistantError) ?? statusClass(result?.api_error_status);
}

/**
 * `--resume <id>` named a conversation that is not on the computer: the CLI ends with one error result and never starts a
 * session (no init line, no turn). Structured: subtype "error_during_execution" with num_turns 0 before any init. The
 * older text form ("No conversation found…" in `result`, or in `errors` as 2.1.330 writes it) is still accepted.
 */
export function claudeSessionMissing(result: any, resumed: boolean, sawInit: boolean): boolean {
  if (!resumed || !result || result.type !== "result") return false;
  if (!sawInit && result.subtype === "error_during_execution" && (result.num_turns ?? 0) === 0) return true;
  const words = [typeof result.result === "string" ? result.result : "", ...(Array.isArray(result.errors) ? result.errors.filter((x: unknown) => typeof x === "string") : [])].join(" ");
  return /no conversation found|session.*not found/i.test(words);
}

/** The words of an error result: `result`, else its `errors` (the error arm), else its subtype. */
export function claudeErrorText(result: any): string {
  if (typeof result?.result === "string" && result.result.trim()) return result.result;
  const errors = Array.isArray(result?.errors) ? result.errors.filter((x: unknown) => typeof x === "string").join(" ") : "";
  return errors || String(result?.subtype ?? "");
}

/** The name Sklubot's own tool server has in the engine's MCP configuration (engine.ts claudeTurn / codexTurn). */
export const SKLUBOT_MCP = "sklubot";

/**
 * L24: the init line says Sklubot's own tool server did not join. Returns its status ("failed", "needs-auth", "missing"…)
 * when the turn must stop, null when it may go on. "connected" and "pending" go on (as in Craft Anything: a server still
 * starting is not refused; its tools fail on their own if it never comes). An init without the `mcp_servers` field (an
 * older CLI, a test's fake) says nothing and goes on.
 */
export function sklubotToolsMissing(init: any): string | null {
  const list = init?.mcp_servers;
  if (!Array.isArray(list)) return null;
  const ours = list.find((s: any) => s && s.name === SKLUBOT_MCP);
  if (!ours) return "missing";
  const status = typeof ours.status === "string" ? ours.status : "unknown";
  return status === "connected" || status === "pending" ? null : status;
}

/**
 * Codex with `mcp_servers.sklubot.required=true` ("Require this enabled server to be ready at startup", Codex configuration
 * reference, learn.chatgpt.com/docs/config-file/config-reference) refuses to start when our server does not answer: exit
 * code 1, no JSON event, and on standard error "Failed to create session: required MCP servers failed to initialize:
 * sklubot: …" — checked live with codex-cli 0.169.0 (the desktop image's version), whose binary holds this wording in
 * codex-mcp/src/connection_manager/required.rs. Codex has no structured field for it, so this is its own fixed wording.
 */
export const CODEX_TOOLS_MISSING = /required MCP servers failed to initialize/i;

/**
 * L17: the tokens one Claude Code invocation used, from its `result` line. Checked live with Claude Code 2.1.330
 * (2026-11-22, three turns of one session, the 2nd and 3rd with `--resume`): `usage` is the invocation's own (turn 2:
 * 2 in / 3 out / 2 847 cache read / 1 019 cache write; turn 3: 2 / 3 / 3 841 / 63), while `total_cost_usd` and
 * `modelUsage` are the WHOLE session's running totals (turn 3: modelUsage 6 in / 9 out / 7 337 / 4 261, the sum of the
 * three). Craft Anything measured the same for `total_cost_usd` (crates/ai/src/cli_agents/claude_cost.rs, 2026-11-09).
 * So only `usage` is read: a resumed turn is never counted with everything before it. `total_cost_usd` and `modelUsage`
 * are deliberately ignored (a subscription turn has no price of its own; its cost is the plan's).
 */
export function claudeTurnTokens(result: any): TurnUsage {
  const u = result?.usage ?? {};
  const n = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : 0);
  return { inputTokens: n(u.input_tokens) + n(u.cache_creation_input_tokens) + n(u.cache_read_input_tokens), outputTokens: n(u.output_tokens), cachedTokens: n(u.cache_read_input_tokens) };
}
