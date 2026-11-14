import { createHash } from "node:crypto";
import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { Grant } from "../shared.js";
import { audit, bots, clip, newId, now, rows, users, type BotRecord } from "../store.js";
import { QUOTE_ARG } from "./grounding.js";

/**
 * Action-bound, single-use execution (spec 07 A3).
 *  - An action is identified by a hash of the tool's name and its canonical arguments (keys sorted; the bot's
 *    `user_quote` left out, since it does not change what runs). An approval is bound to that hash: anything else needs
 *    a new approval, and an approval runs at most once (approvals.consume).
 *  - Before a state-changing action runs, a "reservation" is written (status running); it is closed as done or failed.
 *    When the outcome is unknown — the server stopped mid-call, the call timed out, the turn was stopped while it ran —
 *    it becomes "uncertain": it is never replayed automatically, and the user gets a card ("did it go through?") with
 *    "It went through", "Check" (the bot looks, without redoing it) and "Retry" (one single-use grant for that exact action).
 */

/** Canonical JSON: object keys sorted at every level, the bot's quote dropped. */
export function canonical(value: unknown, top = true): string {
  if (Array.isArray(value)) return `[${value.map((v) => canonical(v, false)).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).filter(([k, v]) => v !== undefined && !(top && k === QUOTE_ARG)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v, false)}`).join(",")}}`;
  }
  return JSON.stringify(value ?? null);
}
export const actionHash = (tool: string, args: Record<string, unknown>) => createHash("sha256").update(`${tool}\n${canonical(args)}`).digest("hex");

export type ExecStatus = "running" | "done" | "failed" | "uncertain";
export interface ExecutionRecord { id: string; botId: string; userId: string; approvalId: string | null; tool: string; label: string; detail: string; actionHash: string; grantBy: string; quote: string; status: ExecStatus; generation: number; thread: number; cardSeq: number | null; startedAt: number; finishedAt: number | null }
const toExec = (r: any): ExecutionRecord => ({ id: r.id, botId: r.bot_id, userId: r.user_id, approvalId: r.approval_id ?? null, tool: r.tool, label: r.label, detail: r.detail, actionHash: r.action_hash, grantBy: r.grant_by, quote: r.quote, status: r.status, generation: r.generation, thread: r.thread, cardSeq: r.card_seq ?? null, startedAt: r.started_at, finishedAt: r.finished_at ?? null });

export const executions = {
  begin(bot: BotRecord, f: { tool: string; label: string; detail: string; hash: string; approvalId?: string | null; grant?: Grant | null; thread: number }): string {
    const id = newId("exe");
    q.run("INSERT INTO executions (id, bot_id, user_id, approval_id, tool, label, detail, action_hash, grant_by, quote, generation, thread, started_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, bot.id, bot.userId, f.approvalId ?? null, f.tool, clip(f.label, 200), clip(f.detail, 1600), f.hash, f.grant?.by ?? "", clip(f.grant?.quote ?? "", 500), bot.generation, f.thread, now());
    return id;
  },
  byId: (id: string) => { const r = q.get("SELECT * FROM executions WHERE id = ?", id); return r ? toExec(r) : null; },
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM executions WHERE id = ? AND user_id = ?", id, userId); return r ? toExec(r) : null; },
  /** Closes a reservation (only one still running). Returns false when it was already closed. */
  finish: (id: string, status: Exclude<ExecStatus, "running">) => Number(q.run("UPDATE executions SET status = ?, finished_at = ? WHERE id = ? AND status = 'running'", status, now(), id).changes) > 0,
  setCard: (id: string, seq: number) => q.run("UPDATE executions SET card_seq = ? WHERE id = ?", seq, id),
  running: () => q.all("SELECT * FROM executions WHERE status = 'running'").map(toExec),
};

/** Single-use grants for one exact action (the user pressed "Retry"): valid 30 minutes, used once. */
export const grants = {
  create(botId: string, hash: string, ttlMs = 30 * 60_000) {
    q.run("INSERT INTO action_grants (id, bot_id, action_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", newId("grt"), botId, hash, now(), now() + ttlMs);
  },
  /** Takes the grant for this exact action, if there is one: true once. */
  take(botId: string, hash: string): boolean {
    const r = q.get<{ id: string }>("SELECT id FROM action_grants WHERE bot_id = ? AND action_hash = ? AND used_at IS NULL AND expires_at > ? ORDER BY created_at LIMIT 1", botId, hash, now());
    return !!r && Number(q.run("UPDATE action_grants SET used_at = ? WHERE id = ? AND used_at IS NULL", now(), r.id).changes) > 0;
  },
};

/**
 * An error that leaves the outcome unknown (the request may have reached the service): a timeout, a connection dropped
 * mid-way, the turn stopped while the call ran. A connection refused or an unknown host never reached it: a plain failure.
 */
export function outcomeUnknown(err: unknown, aborted: boolean): boolean {
  if (aborted) return true;
  const codes: string[] = [];
  for (let e: any = err, i = 0; e && i < 5; e = e.cause, i++) { if (e.code) codes.push(String(e.code)); if (e.name) codes.push(String(e.name)); }
  if (codes.some((c) => ["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN", "EHOSTUNREACH"].includes(c))) return false;
  if (codes.some((c) => ["ECONNRESET", "ETIMEDOUT", "EPIPE", "UND_ERR_SOCKET", "UND_ERR_CLOSED", "UND_ERR_HEADERS_TIMEOUT", "UND_ERR_BODY_TIMEOUT", "AbortError", "TimeoutError"].includes(c))) return true;
  const m = String((err as Error)?.message ?? err);
  return /took too long|time(d)?\s?out|timeout|aborted|socket hang up|other side closed|fetch failed/i.test(m);
}

/** Marks a reservation uncertain and puts the card in the bot's chat (in the conversation the action belonged to). */
export function markUncertain(id: string): boolean {
  if (!executions.finish(id, "uncertain")) return false;
  const e = executions.byId(id)!;
  const bot = bots.byId(e.botId);
  if (!bot) return true;
  const loc = users.localeOf(bot.userId);
  if (e.generation === bot.generation) {
    const card = rows.append(bot, { kind: "card", card: { type: "uncertain", executionId: e.id, title: e.label, detail: e.detail, status: "pending" } }, e.thread || 0);
    executions.setCard(e.id, card.seq);
    bots.bumpUnread(bot.id);
  }
  audit(bot.userId, "tool", `${bot.name} : ${e.label} — ${tr(loc, "outcome unknown, not replayed")}`, bot.id);
  return true;
}

/** At start-up: every reservation left running by the stop becomes uncertain (nothing is replayed). */
export function sweepUncertain(): number {
  let n = 0;
  for (const e of executions.running()) if (markUncertain(e.id)) n++;
  return n;
}
