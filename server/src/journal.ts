import { q } from "./db.js";
import type { JournalEntry } from "./shared.js";
import { bots, clip, now, redactSecrets } from "./store.js";

/**
 * The detailed usage journal (spec 07 A14): one line per tool call a bot made — when, which bot, which tool, what
 * allowed it (the user's own words, the reviewer, a card, a single-use retry, a policy, nothing needed, or refused),
 * how it ended, and what the model spent since the bot's previous action (the call that led to this one). Lines are
 * added, never changed (a database trigger refuses updates). Known vault values are removed before a line is written.
 */

/** Model spend per bot since its last journal line (in memory: lost on a restart, which only loses a few cents of attribution). */
const pending = new Map<string, number>();
export function noteCost(botId: string, usd: number) { if (usd > 0) pending.set(botId, (pending.get(botId) ?? 0) + usd); }
function takeCost(botId: string): number { const v = pending.get(botId) ?? 0; pending.delete(botId); return v; }

export interface JournalInput { userId: string; botId: string; tool: string; label: string; decision: JournalEntry["decision"]; quote?: string; reason?: string; status: JournalEntry["status"]; origin: string }

export function addJournal(e: JournalInput) {
  try {
    q.run("INSERT INTO action_journal (user_id, bot_id, at, tool, label, decision, quote, reason, status, cost_usd, origin) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      e.userId, e.botId, now(), clip(e.tool, 120), clip(redactSecrets(e.userId, e.label), 200), e.decision, clip(redactSecrets(e.userId, e.quote ?? ""), 400),
      clip(redactSecrets(e.userId, e.reason ?? ""), 300), e.status, takeCost(e.botId), clip(e.origin, 20));
  } catch { /* the journal must never break the action it records */ }
}

export interface JournalFilter { from?: number; to?: number; botId?: string; tool?: string; decision?: string; limit?: number; before?: number }

function where(userId: string, f: JournalFilter): { sql: string; args: (string | number)[] } {
  const parts = ["user_id = ?"];
  const args: (string | number)[] = [userId];
  if (f.from) { parts.push("at >= ?"); args.push(f.from); }
  if (f.to) { parts.push("at < ?"); args.push(f.to); }
  if (f.before) { parts.push("id < ?"); args.push(f.before); }
  if (f.botId) { parts.push("bot_id = ?"); args.push(f.botId); }
  if (f.tool) { parts.push("tool LIKE ?"); args.push(`%${f.tool.replace(/[%_]/g, "")}%`); }
  if (f.decision) { parts.push("decision = ?"); args.push(f.decision); }
  return { sql: parts.join(" AND "), args };
}

export function listJournal(userId: string, f: JournalFilter = {}): JournalEntry[] {
  const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
  const w = where(userId, f);
  const limit = Math.min(100_000, Math.max(1, f.limit ?? 200));
  return q.all<any>(`SELECT * FROM action_journal WHERE ${w.sql} ORDER BY id DESC LIMIT ?`, ...w.args, limit).map((r) => ({
    id: r.id, at: r.at, botId: r.bot_id, botName: names.get(r.bot_id) ?? "—", tool: r.tool, label: r.label, decision: r.decision,
    quote: r.quote, reason: r.reason, status: r.status, costUsd: r.cost_usd, origin: r.origin,
  }));
}

/** Totals for the same filter: lines, spend, and how many ran without asking (grounded or reviewer). */
export function journalTotals(userId: string, f: JournalFilter = {}): { lines: number; costUsd: number; byDecision: Record<string, number> } {
  const w = where(userId, f);
  const rowsBy = q.all<{ decision: string; n: number; c: number }>(`SELECT decision, COUNT(*) AS n, SUM(cost_usd) AS c FROM action_journal WHERE ${w.sql} GROUP BY decision`, ...w.args);
  return { lines: rowsBy.reduce((a, r) => a + r.n, 0), costUsd: rowsBy.reduce((a, r) => a + (r.c ?? 0), 0), byDecision: Object.fromEntries(rowsBy.map((r) => [r.decision, r.n])) };
}

const cell = (v: string | number) => (typeof v === "number" ? String(v) : `"${v.replace(/"/g, '""').replace(/\r?\n/g, " ")}"`);
/** The whole journal for a filter, as CSV (RFC 4180 quoting). */
export function journalCsv(userId: string, f: JournalFilter = {}): string {
  const lines = listJournal(userId, { ...f, limit: 100_000 }).reverse()
    .map((e) => [new Date(e.at).toISOString(), e.botName, e.tool, e.label, e.decision, e.quote, e.reason, e.status, e.costUsd.toFixed(6), e.origin].map(cell).join(","));
  return ["time,bot,tool,action,decision,quote,reason,status,cost_usd,origin", ...lines].join("\n") + "\n";
}
