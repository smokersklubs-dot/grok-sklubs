/**
 * Fake data for « Coordinateur d'échecs » in the dev gallery (Gallery.tsx): failure cards in every status, the bot's
 * « Incidents » list (Activité tab) and the Aujourd'hui summary. Never shipped: the gallery is development only.
 */
import type { Card, FailureSummary, FailureView } from "../types";
import { NOW, type FixtureOptions } from "./fixtures";

const MIN = 60_000;
type FailureCard = Extract<Card, { type: "failure" }>;

export function failureCardFixtures(o: FixtureOptions): FailureCard[] {
  const L = (fr: string, en: string) => (o.lang === "fr" ? fr : en);
  const long = (s: string) => (o.long ? `${s} ${L("Avec un message d'erreur beaucoup plus long que prévu, pour vérifier qu'il passe à la ligne sur un téléphone.", "With a much longer error message than expected, to check that it wraps on a phone.")}` : s);
  return [
    { type: "failure", failureId: "fail_auth", cls: "auth_expired", engine: "claude-code", status: "pending", count: 2, detail: long("Invalid API key · Please run /login"), tried: [], remedies: ["reconnect", "switch_model", "handoff"], teammate: { id: "bot_other", name: "Atlas" } },
    { type: "failure", failureId: "fail_tool", cls: "tool_error", tool: "browser_click", status: "pending", count: 1, detail: long(L("l'outil browser_click a échoué 5 fois de suite", "the tool browser_click failed 5 times in a row")), tried: [], remedies: ["retry", "continue_without"] },
    { type: "failure", failureId: "fail_retry", cls: "provider_down", status: "retrying", count: 2, detail: "OpenAI API error 503: Service Unavailable", tried: [{ action: "retry", at: NOW - 2 * MIN, ok: false }, { action: "retry", at: NOW - MIN, ok: null }], remedies: ["retry", "switch_model"], retryAt: NOW + 40_000 },
    { type: "failure", failureId: "fail_pc", cls: "computer_down", status: "pending", count: 1, detail: "Error response from daemon: No such container: sklubot-bot_juno", tried: [], remedies: ["restart_computer", "retry"] },
    { type: "failure", failureId: "fail_budget", cls: "out_of_budget", status: "handed", count: 1, detail: "Anthropic API error 400: Your credit balance is too low to access the Anthropic API.", tried: [{ action: "handoff", at: NOW - 6 * MIN, ok: true, note: "Atlas" }], remedies: ["connect_account", "switch_model", "handoff"], teammate: { id: "bot_other", name: "Atlas" } },
    { type: "failure", failureId: "fail_ok", cls: "rate_limited", status: "resolved", count: 3, detail: "Anthropic rate limit reached.", tried: [{ action: "retry", at: NOW - 30 * MIN, ok: false }, { action: "retry", at: NOW - 29 * MIN, ok: true }], remedies: ["retry", "switch_model"] },
    { type: "failure", failureId: "fail_loop", cls: "loop_detected", tool: "screenshot", status: "dismissed", count: 1, detail: L("l'outil screenshot a renvoyé exactement le même résultat 6 fois de suite", "the tool screenshot returned exactly the same result 6 times in a row"), tried: [], remedies: ["continue_without", "retry"] },
  ];
}

export function incidentsFixture(empty: boolean): FailureView[] {
  if (empty) return [];
  const base = { botId: "bot_gallery", provider: "anthropic", detail: "", resolvedAt: null as number | null };
  return [
    { ...base, id: "f1", cls: "auth_expired", tool: "", provider: "claude-code", status: "waiting", resolvedBy: "", count: 2, firstAt: NOW - 8 * MIN, lastAt: NOW - 3 * MIN, tried: [] },
    { ...base, id: "f2", cls: "provider_down", tool: "", status: "retrying", resolvedBy: "", count: 2, firstAt: NOW - 14 * MIN, lastAt: NOW - 12 * MIN, tried: [{ action: "retry", at: NOW - 13 * MIN, ok: false }, { action: "retry", at: NOW - 12 * MIN, ok: null }] },
    { ...base, id: "f3", cls: "rate_limited", tool: "", status: "resolved", resolvedBy: "auto", count: 3, firstAt: NOW - 62 * MIN, lastAt: NOW - 60 * MIN, tried: [{ action: "retry", at: NOW - 61 * MIN, ok: false }, { action: "retry", at: NOW - 60 * MIN, ok: true }], resolvedAt: NOW - 59 * MIN },
    { ...base, id: "f4", cls: "provider_down", tool: "", status: "resolved", resolvedBy: "auto", count: 1, firstAt: NOW - 3 * 60 * MIN, lastAt: NOW - 3 * 60 * MIN, tried: [{ action: "fallback", at: NOW - 3 * 60 * MIN, ok: true, note: "openai:gpt-5.1" }], resolvedAt: NOW - 3 * 60 * MIN },
    { ...base, id: "f5", cls: "out_of_budget", tool: "", status: "handed", resolvedBy: "auto", count: 1, firstAt: NOW - 5 * 60 * MIN, lastAt: NOW - 5 * 60 * MIN, tried: [{ action: "handoff", at: NOW - 5 * 60 * MIN, ok: true, note: "Atlas" }], resolvedAt: NOW - 5 * 60 * MIN },
    { ...base, id: "f6", cls: "tool_error", tool: "browser_click", status: "resolved", resolvedBy: "user", count: 1, firstAt: NOW - 26 * 60 * MIN, lastAt: NOW - 26 * 60 * MIN, tried: [], resolvedAt: NOW - 25 * 60 * MIN },
  ];
}

export const failureSummaryFixture = (empty: boolean): FailureSummary | undefined =>
  empty ? undefined : { autoFixed: 2, waiting: 1, outages: [{ provider: "anthropic", bots: 3, since: NOW - 25 * MIN }] };
