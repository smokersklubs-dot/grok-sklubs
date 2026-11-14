import { q } from "./db.js";
import { emit } from "./bus.js";
import { tr } from "./i18n.js";
import { audit, bots, now, rows, settings, users } from "./store.js";
import type { TurnUsage } from "./llm/types.js";
import type { UsageSummary } from "./shared.js";

/** USD per million tokens [input, output, cached input]. Unknown models are metered in tokens only. */
const PRICES: Record<string, [number, number, number]> = {
  "claude-fable-5-2": [8, 40, 0.2],
  "claude-opus-5-5": [4, 20, 0.2],
  "claude-sonnet-5-5": [2, 10, 0.1],
  "claude-haiku-5-5": [0.1, 0.5, 0.01],
};

export function costOf(model: string, u: TurnUsage): number {
  const p = PRICES[model];
  if (!p) return 0;
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  return (fresh * p[0] + u.outputTokens * p[1] + u.cachedTokens * p[2]) / 1_000_000;
}

export function record(userId: string, botId: string, model: string, u: TurnUsage) {
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    userId, botId, now(), model, u.inputTokens, u.outputTokens, u.cachedTokens, costOf(model, u));
  emit(userId, { type: "usage" });
  if (budgetJustNeared(userId)) {
    const main = bots.primary(userId);
    if (main) rows.append(main, { kind: "notice", tone: "warn", text: tr(users.localeOf(userId), "You have used 80% of this month's budget.") });
    audit(userId, "system", "80% of this month's budget is used");
  }
}

function monthStart(): { start: number; label: string } {
  const d = new Date();
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` };
}

export function summary(userId: string): UsageSummary {
  const { start, label } = monthStart();
  const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
  const per = q.all<{ bot_id: string; i: number; o: number; n: number; c: number }>(
    "SELECT bot_id, SUM(input_tokens) AS i, SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_usd) AS c FROM usage WHERE user_id = ? AND at >= ? GROUP BY bot_id ORDER BY c DESC, o DESC", userId, start);
  const byBot = per.map((r) => ({ botId: r.bot_id, name: names.get(r.bot_id) ?? "Removed bot", inputTokens: r.i, outputTokens: r.o, turns: r.n, costUsd: r.c }));
  const totals = byBot.reduce((a, b) => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, turns: a.turns + b.turns, costUsd: a.costUsd + b.costUsd }),
    { inputTokens: 0, outputTokens: 0, turns: 0, costUsd: 0 });
  const budgetUsd = settings.budget(userId);
  return { month: label, totals, byBot, budgetUsd, nearBudget: budgetUsd !== null && budgetUsd > 0 && totals.costUsd >= budgetUsd * 0.8 };
}

/** Returns true exactly once per month: the first time spending passes 80% of the budget. */
export function budgetJustNeared(userId: string): boolean {
  const s = summary(userId);
  if (!s.nearBudget || settings.budgetWarned(userId) === s.month) return false;
  settings.setBudgetWarned(userId, s.month);
  return true;
}

export function csv(userId: string): string {
  const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
  const lines = q.all<any>("SELECT * FROM usage WHERE user_id = ? AND at >= ? ORDER BY at", userId, monthStart().start)
    .map((r) => [new Date(r.at).toISOString(), `"${(names.get(r.bot_id) ?? "Removed bot").replace(/"/g, '""')}"`, r.model, r.input_tokens, r.output_tokens, r.cached_tokens, r.cost_usd.toFixed(6)].join(","));
  return ["time,bot,model,input_tokens,output_tokens,cached_tokens,cost_usd", ...lines].join("\n") + "\n";
}

/** True when a monthly budget is set and already spent. */
export function overBudget(userId: string): boolean {
  const budget = settings.budget(userId);
  if (budget === null) return false;
  const spent = q.get<{ c: number | null }>("SELECT SUM(cost_usd) AS c FROM usage WHERE user_id = ? AND at >= ?", userId, monthStart().start)?.c ?? 0;
  return spent >= budget;
}
