/**
 * L184 « métriques » (OpenClaw audit L11 "OpenTelemetry / Prometheus metrics" — behaviour only, our own code).
 *
 *  - GET /api/metrics: the numbers in the Prometheus text format (https://prometheus.io/docs/instrumenting/exposition_formats/),
 *    for a monitoring tool. Off unless the server's owner sets METRICS_TOKEN (32 characters or more); the scraper sends
 *    `Authorization: Bearer <token>`. Whole-server totals, counts only: no names, no text, no address.
 *  - GET /api/usage-metrics (signed in): the same numbers for the signed-in account, for the « Métriques » panel.
 */
import { timingSafeEqual } from "node:crypto";
import { q } from "./db.js";

export interface UsageMetrics {
  bots: number; rooms: number; connectors: number;
  messages: { user: number; assistant: number }; messages24h: number;
  tokens: { input: number; output: number; cached: number }; costUsd: number; costUsd30d: number; tokens24h: number;
  approvalsPending: number; routineRuns: { ok: number; failed: number; other: number };
  days: { day: string; costUsd: number; tokens: number }[];
}

// routines.ts: a run ends "done" or "quiet" (nothing new), "error" when it failed; "running" and "skipped" are other.
const OK = ["done", "quiet"], FAILED = ["error"];
const sum = (runs: { status: string; c: number }[], set: string[]) => runs.filter((r) => set.includes(r.status)).reduce((a, r) => a + r.c, 0);
const n = (sql: string, ...p: (string | number)[]) => Number(q.get<{ v: number | null }>(sql, ...p)?.v ?? 0);

/** One account's numbers, or the whole server's (`userId` null). */
export function usageMetrics(userId: string | null, at = Date.now()): UsageMetrics {
  const u = userId === null ? "1 = 1" : "user_id = ?";
  const b = userId === null ? "1 = 1" : "b.user_id = ?";
  const p = userId === null ? [] : [userId];
  const day = 86_400_000;
  const msg = (role: string) => n(`SELECT COUNT(*) AS v FROM rows r JOIN bots b ON b.id = r.bot_id WHERE ${b} AND r.kind = 'message' AND json_extract(r.body, '$.role') = ?`, ...p, role);
  const runs = q.all<{ status: string; c: number }>(`SELECT rr.status AS status, COUNT(*) AS c FROM routine_runs rr JOIN routines ro ON ro.id = rr.routine_id JOIN bots b ON b.id = ro.bot_id WHERE ${b} GROUP BY rr.status`, ...p);
  const days = q.all<{ d: number; cost: number; tok: number }>(`SELECT CAST(at / ${day} AS INTEGER) AS d, SUM(cost_usd) AS cost, SUM(input_tokens + output_tokens) AS tok FROM usage WHERE ${u} AND at >= ? GROUP BY d ORDER BY d`, ...p, at - 14 * day);
  return {
    bots: n(`SELECT COUNT(*) AS v FROM bots WHERE ${u} AND kind = 'agent' AND hidden = 0`, ...p),
    rooms: n(`SELECT COUNT(*) AS v FROM bots WHERE ${u} AND kind = 'room' AND hidden = 0`, ...p),
    connectors: n(`SELECT COUNT(*) AS v FROM connectors WHERE ${u}`, ...p),
    messages: { user: msg("user"), assistant: msg("assistant") },
    messages24h: n(`SELECT COUNT(*) AS v FROM rows r JOIN bots b ON b.id = r.bot_id WHERE ${b} AND r.kind = 'message' AND r.created_at >= ?`, ...p, at - day),
    tokens: { input: n(`SELECT SUM(input_tokens) AS v FROM usage WHERE ${u}`, ...p), output: n(`SELECT SUM(output_tokens) AS v FROM usage WHERE ${u}`, ...p), cached: n(`SELECT SUM(cached_tokens) AS v FROM usage WHERE ${u}`, ...p) },
    costUsd: n(`SELECT SUM(cost_usd) AS v FROM usage WHERE ${u}`, ...p),
    costUsd30d: n(`SELECT SUM(cost_usd) AS v FROM usage WHERE ${u} AND at >= ?`, ...p, at - 30 * day),
    tokens24h: n(`SELECT SUM(input_tokens + output_tokens) AS v FROM usage WHERE ${u} AND at >= ?`, ...p, at - day),
    approvalsPending: n(`SELECT COUNT(*) AS v FROM approvals WHERE ${u} AND status = 'pending'`, ...p),
    routineRuns: { ok: sum(runs, OK), failed: sum(runs, FAILED), other: runs.filter((r) => !OK.includes(r.status) && !FAILED.includes(r.status)).reduce((a, r) => a + r.c, 0) },
    days: days.map((d) => ({ day: new Date(d.d * day).toISOString().slice(0, 10), costUsd: Math.round((d.cost ?? 0) * 10000) / 10000, tokens: d.tok ?? 0 })),
  };
}

/** The Prometheus text exposition of the server's totals. */
export function prometheusText(m: UsageMetrics): string {
  const out: string[] = [];
  const metric = (name: string, type: "gauge" | "counter", help: string, values: [Record<string, string>, number][]) => {
    out.push(`# HELP ${name} ${help}`, `# TYPE ${name} ${type}`);
    for (const [labels, v] of values) { const l = Object.entries(labels).map(([k, x]) => `${k}="${x}"`).join(","); out.push(`${name}${l ? `{${l}}` : ""} ${Number.isFinite(v) ? v : 0}`); }
  };
  metric("sklubot_bots", "gauge", "Bots (agents) on this server.", [[{}, m.bots]]);
  metric("sklubot_groups", "gauge", "Group chats on this server.", [[{}, m.rooms]]);
  metric("sklubot_apps", "gauge", "Apps (MCP connectors) added.", [[{}, m.connectors]]);
  metric("sklubot_messages_total", "counter", "Chat messages kept, by who wrote them.", [[{ role: "user" }, m.messages.user], [{ role: "assistant" }, m.messages.assistant]]);
  metric("sklubot_tokens_total", "counter", "AI model tokens used.", [[{ type: "input" }, m.tokens.input], [{ type: "output" }, m.tokens.output], [{ type: "cached" }, m.tokens.cached]]);
  metric("sklubot_cost_usd_total", "counter", "Estimated AI cost in US dollars.", [[{}, m.costUsd]]);
  metric("sklubot_approvals_pending", "gauge", "Approval cards waiting for an answer.", [[{}, m.approvalsPending]]);
  metric("sklubot_routine_runs_total", "counter", "Routine runs by result.", [[{ result: "ok" }, m.routineRuns.ok], [{ result: "failed" }, m.routineRuns.failed], [{ result: "other" }, m.routineRuns.other]]);
  return `${out.join("\n")}\n`;
}

/** The scraper's token, checked in constant time. Off (false) when METRICS_TOKEN is unset or too short. */
export function metricsAllowed(header: string | undefined, token = process.env.METRICS_TOKEN ?? ""): boolean {
  if (token.length < 32) return false;
  const got = Buffer.from(/^Bearer (.+)$/.exec(header ?? "")?.[1] ?? "");
  const want = Buffer.from(token);
  return got.length === want.length && timingSafeEqual(got, want);
}
