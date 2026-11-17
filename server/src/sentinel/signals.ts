/**
 * Sentinelle — in-process signals: small counters the rest of the server bumps when something worth watching happens
 * and leaves no row of its own in the database (a failed model call, a refused sign-in, a line on the error log, a
 * notice of the turn watch, a refused Docker call). The scanner (sentinel/index.ts) reads them every few minutes.
 *
 * Deliberately tiny and dependency-free, so any module can import it (linux.ts, routes.ts, agent/loop.ts…) without a
 * cycle: one Map of timestamps per (kind, key), trimmed to the last 24 hours, bounded in size. Nothing is written to
 * disk: after a restart the counts start again from zero (an open incident then simply resolves once quiet). Only a
 * short key is kept (a provider and an error class, a client address, a tool's name) — never a message's text.
 */
export type SignalKind = "turn_failure" | "engine_silent" | "engine_stalled" | "engine_gone" | "login_failure" | "error_log" | "uncaught" | "docker_error";

const KEEP_MS = 24 * 3_600_000;
const MAX_PER_KEY = 5_000;
const MAX_KEYS = 500;
const store = new Map<SignalKind, Map<string, number[]>>();

/** One occurrence. `key` groups occurrences (≤ 120 characters). Never throws. */
export function noteSignal(kind: SignalKind, key = "", at = Date.now()): void {
  try {
    let byKey = store.get(kind);
    if (!byKey) store.set(kind, (byKey = new Map()));
    const k = String(key).slice(0, 120);
    let list = byKey.get(k);
    if (!list) {
      if (byKey.size >= MAX_KEYS) {
        // The key seen least recently goes (a flood of made-up keys cannot grow the table without end).
        let oldest: string | null = null, oldestAt = Infinity;
        for (const [kk, v] of byKey) { const last = v[v.length - 1] ?? 0; if (last < oldestAt) { oldestAt = last; oldest = kk; } }
        if (oldest !== null) byKey.delete(oldest);
      }
      byKey.set(k, (list = []));
    }
    list.push(at);
    if (list.length > MAX_PER_KEY || (list.length % 200 === 0 && list[0] < at - KEEP_MS)) {
      const cut = at - KEEP_MS;
      let i = 0;
      while (i < list.length && list[i] < cut) i++;
      list.splice(0, Math.max(i, list.length - MAX_PER_KEY));
    }
  } catch { /* a counter must never break what it counts */ }
}

export interface SignalCount { key: string; count: number; last: number }
/** Occurrences of a kind since `since` (inclusive), per key, most frequent first. */
export function countSignals(kind: SignalKind, since: number, until = Number.POSITIVE_INFINITY): SignalCount[] {
  const out: SignalCount[] = [];
  for (const [key, list] of store.get(kind) ?? []) {
    let n = 0, last = 0;
    for (let i = list.length - 1; i >= 0; i--) { const t = list[i]; if (t < since) break; if (t <= until) { n++; if (t > last) last = t; } }
    if (n) out.push({ key, count: n, last });
  }
  return out.sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
/** Tests: forget everything. */
export const resetSignals = () => store.clear();

/**
 * Why a model call or a subscription turn failed, as a short class (never the message itself): "auth" (a key refused,
 * a sign-in to redo — Claude Code's or Codex's "refresh token", 401/403), "rate_limit" (429, usage limit), "context"
 * (too long for the model), "overloaded" (529), "server" (5xx), "network", "timeout", or "other".
 */
export type FailureCode = "auth" | "rate_limit" | "context" | "overloaded" | "server" | "network" | "timeout" | "other";
export function failureCode(message: unknown, status?: number | null, code?: string | null): FailureCode {
  const m = String(message ?? "");
  if (code === "context_length" || /context.?(length|window)|prompt is too long|too many tokens|maximum context|input is too long/i.test(m)) return "context";
  if (status === 401 || status === 403 || /refresh.?token|unauthori[sz]ed|authenticat|invalid.{0,24}(api.?key|token|credential)|not (logged|signed) in|log ?in again|sign ?in again|\/login\b|expired.{0,24}(token|session|credential)|oauth.{0,24}(expired|invalid|revoked)|permission denied.{0,24}(api|key)/i.test(m)) return "auth";
  if (status === 429 || /rate.?limit|usage limit|too many requests|quota exceeded|exceeded your current quota/i.test(m)) return "rate_limit";
  if (status === 529 || /overloaded/i.test(m)) return "overloaded";
  if ((status ?? 0) >= 500 || /server error \d{3}|\b5\d\d\b.{0,12}(error|internal)/i.test(m)) return "server";
  if (/ECONN(RESET|REFUSED)|ETIMEDOUT|ENOTFOUND|EAI_AGAIN|EPIPE|UND_ERR|fetch failed|socket hang up|network/i.test(m)) return "network";
  if (/timed? ?out|timeout/i.test(m)) return "timeout";
  return "other";
}
/** A failed model call or subscription turn: `provider` is the model's provider id ("anthropic", "claude_code", "codex"…). */
export function noteTurnFailure(provider: string, message: unknown, status?: number | null, code?: string | null): void {
  const p = String(provider || "unknown").replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 40) || "unknown";
  noteSignal("turn_failure", `${p}:${failureCode(message, status, code)}`);
}

let installed = false;
/**
 * The error counter: every line written with console.error counts as one "error_log" signal (its text is not kept).
 * Installed once at start-up (index.ts); the original console.error still writes the line.
 */
export function installErrorCounter(): void {
  if (installed) return;
  installed = true;
  const original = console.error.bind(console);
  console.error = (...args: unknown[]) => { noteSignal("error_log", "console"); original(...args); };
}
