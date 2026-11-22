/**
 * « Coordinateur d'échecs » (agent/failures.ts): the wire types, re-exported by shared.ts (kept apart so shared.ts does
 * not grow). The card itself is the "failure" member of shared.ts Card:
 *  `cls`: what kind of failure (the title comes from it, in the reader's language); `tool`: the step that failed
 *  (tool_error, loop_detected); `detail`: what was said (clipped, never a secret); `tried`: what was tried automatically;
 *  `remedies`: the buttons, at least one of which unblocks; `count`: the same failure again within 10 minutes (one card,
 *  updated). Status: "pending" (waits for the owner), "retrying" (a new try under way or planned at `retryAt`),
 *  "handed" (given to `teammate`), "resolved", "dismissed". What the bot did before the failure is always kept.
 */
// ── « Coordinateur d'échecs » (agent/failures.ts) ───────────────────────────────────────────────────────────────
/** The failure taxonomy: one stable code per kind of failure, for the API and the subscription (engine) paths alike. */
export const FAILURE_CLASSES = ["provider_down", "rate_limited", "subscription_limit", "auth_expired", "out_of_budget", "tool_error", "computer_down", "timeout", "loop_detected", "bad_input", "server_fault", "unknown"] as const;
export type FailureClass = (typeof FAILURE_CLASSES)[number];
/** A button under a failure card: each one either unblocks the work or opens the place where it is unblocked. */
export const FAILURE_REMEDIES = ["retry", "continue_without", "reconnect", "connect_account", "restart_computer", "switch_model", "handoff"] as const;
export type FailureRemedy = (typeof FAILURE_REMEDIES)[number];
/** What the coordinator did on its own: a new try, the backup model, a teammate, waiting for a reset or for the provider. */
export type FailureAuto = "retry" | "fallback" | "handoff" | "wait" | "provider_wait";
/** One automatic attempt. `ok`: null while it is under way; `note`: the backup model or the teammate's name. */
export interface FailureTry { action: FailureAuto | "image_check" | "quota_check"; at: number; ok: boolean | null; note?: string }
/** auto: handled automatically, still under way; waiting: waits for the owner; retrying: the owner asked for a new try. */
export type FailureStatus = "auto" | "waiting" | "retrying" | "resolved" | "handed" | "dismissed";
/** One line of the bot's « Incidents » (Activité tab). `resolvedBy`: "auto" (fixed without the owner) or "user". */
export interface FailureView { id: string; botId: string; cls: FailureClass; tool: string; provider: string; detail: string; tried: FailureTry[]; status: FailureStatus; resolvedBy: "" | "auto" | "user"; count: number; firstAt: number; lastAt: number; resolvedAt: number | null }
/** « Aujourd'hui »: incidents of the day fixed automatically, those that wait for the owner, and providers down right now. */
export interface FailureSummary { autoFixed: number; waiting: number; outages: { provider: string; bots: number; since: number }[] }
