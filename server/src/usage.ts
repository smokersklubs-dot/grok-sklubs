import { q } from "./db.js";
import { emit } from "./bus.js";
import { tr } from "./i18n.js";
import { audit, bots, now, rows, settings, users } from "./store.js";
import type { TurnUsage } from "./llm/types.js";
import type { Engine, SubscriptionUsage, UsageSummary } from "./shared.js";
import { addSpend } from "./agent/spend.js";
import { noteCost } from "./journal.js";

/**
 * Latest known use of each account's subscription windows (Claude Code, Codex), as the tools report it. Kept in the
 * database (subscription_usage, migration 2) so it survives a restart; the token counts of those turns are in `usage`.
 */
export function noteSubscription(userId: string, u: SubscriptionUsage) {
  q.run("INSERT INTO subscription_usage (user_id, engine, five_hour, seven_day, resets_at, at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, engine) DO UPDATE SET five_hour = excluded.five_hour, seven_day = excluded.seven_day, resets_at = excluded.resets_at, at = excluded.at",
    userId, u.engine, u.fiveHour, u.sevenDay, u.resetsAt, u.at);
  emit(userId, { type: "usage" });
}
function subscriptionsOf(userId: string, since: number): SubscriptionUsage[] {
  const tokens = new Map(q.all<{ e: string; i: number; o: number; n: number }>(
    "SELECT CASE WHEN model LIKE 'codex:%' THEN 'codex' ELSE 'claude-code' END AS e, SUM(input_tokens) AS i, SUM(output_tokens) AS o, COUNT(*) AS n FROM usage WHERE user_id = ? AND at >= ? AND (model LIKE 'claude-code:%' OR model LIKE 'codex:%') GROUP BY e",
    userId, since).map((r) => [r.e, r]));
  return q.all<{ engine: Engine; five_hour: number | null; seven_day: number | null; resets_at: number | null; at: number }>("SELECT * FROM subscription_usage WHERE user_id = ? ORDER BY engine", userId)
    .map((r) => ({ engine: r.engine, fiveHour: r.five_hour, sevenDay: r.seven_day, resetsAt: r.resets_at, at: r.at, inputTokens: tokens.get(r.engine)?.i ?? 0, outputTokens: tokens.get(r.engine)?.o ?? 0, turns: tokens.get(r.engine)?.n ?? 0 }));
}

/** USD per million tokens: [input (not cached), output, cached input]. */
export type Prices = [number, number, number];
interface BuiltinPrice {
  provider: "anthropic" | "xai" | "openai";
  prices: Prices;
  /** Tiered models: a request whose prompt (input tokens, cached included) reaches `atPrompt` is billed at `prices` for all its tokens. */
  over?: { atPrompt: number; prices: Prices };
}

/**
 * Built-in prices of the models the server's own keys (.env: ANTHROPIC_API_KEY, XAI_API_KEY, OPENAI_API_KEY) are set
 * up for (llm/index.ts, llm/anthropic.ts). Taken ONLY from the providers' official pricing pages, read on 2026-11-16:
 *  - Anthropic — https://platform.claude.com/docs/en/about-claude/pricing ("Model pricing" table: base input, cache hits
 *    and refreshes, output). Claude Haiku 5.5 has a second tier for prompts over 100,000 tokens (same table).
 *    Not modelled: cache writes (1.25x / 2x input), batch, fast mode, US-only inference (1.1x) — Sklubot uses none of them.
 *  - xAI — https://docs.x.ai/docs/models (grok-4.7: input $2.00, cached input $0.50, output $6.00; prompts of 200k tokens
 *    or more: $4.00 / $1.00 / $12.00 for all tokens of the request). Region us-east-1/us-west-2; us-central-1 is listed
 *    10% higher on the same page — set the price in Settings → Models if your key bills there.
 *  - OpenAI — https://developers.openai.com/api/docs/pricing (Standard tier, text tokens: gpt-5 $1.25 / cached $0.125 /
 *    output $10.00; gpt-5-mini $0.25 / $0.025 / $2.00; gpt-5-nano $0.05 / $0.005 / $0.40).
 * A model not listed here (another XAI_MODELS / OPENAI_MODELS entry, a model of another OpenAI-compatible service) has
 * NO built-in price: it is "unknown" until the instance owner sets one (model_prices). Nothing is guessed.
 * A built-in price only applies while its provider's address is the official one (an OPENAI_BASE_URL pointing to another
 * service bills its own prices for the same model names).
 */
const BUILTIN: Record<string, BuiltinPrice> = {
  "claude-fable-5-2": { provider: "anthropic", prices: [8, 40, 0.2] },
  "claude-opus-5-5": { provider: "anthropic", prices: [4, 20, 0.2] },
  "claude-sonnet-5-5": { provider: "anthropic", prices: [2, 10, 0.1] },
  "claude-haiku-5-5": { provider: "anthropic", prices: [0.1, 0.5, 0.01], over: { atPrompt: 100_001, prices: [0.5, 2.5, 0.05] } },
  "grok-4.7": { provider: "xai", prices: [2, 6, 0.5], over: { atPrompt: 200_000, prices: [4, 12, 1] } },
  "gpt-5": { provider: "openai", prices: [1.25, 10, 0.125] },
  "gpt-5-mini": { provider: "openai", prices: [0.25, 2, 0.025] },
  "gpt-5-nano": { provider: "openai", prices: [0.05, 0.4, 0.005] },
};
export const PRICE_SOURCES = {
  anthropic: "https://platform.claude.com/docs/en/about-claude/pricing",
  xai: "https://docs.x.ai/docs/models",
  openai: "https://developers.openai.com/api/docs/pricing",
  checkedOn: "2026-11-16",
} as const;

const OFFICIAL: Record<BuiltinPrice["provider"], [string, string]> = {
  anthropic: ["ANTHROPIC_BASE_URL", "api.anthropic.com"],
  xai: ["XAI_BASE_URL", "api.x.ai"],
  openai: ["OPENAI_BASE_URL", "api.openai.com"],
};
function officialEndpoint(provider: BuiltinPrice["provider"]): boolean {
  const [env, host] = OFFICIAL[provider];
  const v = process.env[env];
  if (!v) return true;
  try { return new URL(v).hostname === host; } catch { return false; }
}

/**
 * The estimate used for a model without a price, per million tokens: the highest price of each kind in the built-in
 * table (any tier). Why this choice: a budget or a spend checkpoint that counts an unknown model as free never stops it
 * (what an operator's free plan cannot afford), while refusing the model outright breaks bots that work. Counting it at
 * the dearest known rate keeps the budget and the checkpoints working — they stop earlier rather than later — and the
 * screens say "coût inconnu" with the tokens, so nobody mistakes the estimate for a bill. Setting the real price
 * (Settings → Models) replaces the estimate for the calls that follow.
 */
export const UNKNOWN_ESTIMATE: Prices = (() => {
  const all = Object.values(BUILTIN).flatMap((b) => [b.prices, ...(b.over ? [b.over.prices] : [])]);
  return [0, 1, 2].map((i) => Math.max(...all.map((p) => p[i]))) as Prices;
})();

/** Prices the instance owner set (model_prices); they win over the built-in table. */
export const ownerPrices = {
  list: () => q.all<{ model: string; input: number | null; output: number | null; cached: number | null; note: string; updated_at: number }>("SELECT * FROM model_prices ORDER BY model"),
  get(model: string): Prices | null {
    const r = q.get<{ input: number | null; output: number | null; cached: number | null }>("SELECT input, output, cached FROM model_prices WHERE model = ?", model);
    if (!r || (r.input === null && r.output === null)) return null;
    return [r.input ?? 0, r.output ?? 0, r.cached ?? r.input ?? 0];
  },
  set(model: string, p: { input: number | null; output: number | null; cached: number | null; note?: string }, by: string) {
    if (p.input === null && p.output === null && p.cached === null) { q.run("DELETE FROM model_prices WHERE model = ?", model); return; }
    q.run("INSERT INTO model_prices (model, input, output, cached, note, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(model) DO UPDATE SET input = excluded.input, output = excluded.output, cached = excluded.cached, note = excluded.note, updated_by = excluded.updated_by, updated_at = excluded.updated_at",
      model, p.input, p.output, p.cached, (p.note ?? "").slice(0, 200), by, now());
  },
};

/** Prices the user gave for a model of their own providers (apimodels.ts), when it has some. */
let priceSource: (userId: string, model: string) => Prices | null = () => null;
export const setPriceSource = (fn: (userId: string, model: string) => Prices | null) => { priceSource = fn; };

export type PriceOrigin = "owner" | "builtin" | "user";
export interface PriceInfo { prices: Prices; over?: { atPrompt: number; prices: Prices }; origin: PriceOrigin; source?: string }

/** Where `model`'s price comes from: the owner's prices, then the built-in table (official address only), then the user's own providers. */
export function priceInfo(model: string, userId?: string): PriceInfo | null {
  const own = ownerPrices.get(model);
  if (own) return { prices: own, origin: "owner" };
  const b = BUILTIN[model];
  if (b && officialEndpoint(b.provider)) return { prices: b.prices, over: b.over, origin: "builtin", source: PRICE_SOURCES[b.provider] };
  const u = userId ? priceSource(userId, model) : null;
  return u ? { prices: u, origin: "user" } : null;
}

/** The (base tier) price of `model` for this user, or null when it is unknown. */
export function priceFor(model: string, userId?: string): Prices | null {
  return priceInfo(model, userId)?.prices ?? null;
}

const priced = (p: Prices, u: TurnUsage) => {
  const fresh = Math.max(0, u.inputTokens - u.cachedTokens);
  return (fresh * p[0] + u.outputTokens * p[1] + u.cachedTokens * p[2]) / 1_000_000;
};

/** A subscription tool (Claude Code, Codex): no per-token charge, its use is shown as tokens and window percentages. */
export const isSubscriptionModel = (model: string) => model.startsWith("claude-code:") || model.startsWith("codex:");

/** The real cost of a call (0 when the price is unknown: see costEstimate). */
export function costOf(model: string, u: TurnUsage, userId?: string): number {
  const info = priceInfo(model, userId);
  if (!info) return 0;
  const p = info.over && u.inputTokens >= info.over.atPrompt ? info.over.prices : info.prices;
  return priced(p, u);
}

/** How a call is priced: its cost, the status written to `usage`, and the conservative estimate for an unknown price. */
export function costEstimate(model: string, u: TurnUsage, userId?: string): { cost: number; status: "priced" | "unknown" | "subscription"; estimate: number } {
  if (isSubscriptionModel(model)) return { cost: 0, status: "subscription", estimate: 0 };
  if (model === "demo") return { cost: 0, status: "priced", estimate: 0 }; // the built-in demonstration model is free
  if (priceInfo(model, userId)) return { cost: costOf(model, u, userId), status: "priced", estimate: 0 };
  return { cost: 0, status: "unknown", estimate: priced(UNKNOWN_ESTIMATE, u) };
}

/** Accounts already told this month that a model has no price (one notice per account, model and month). */
const unknownWarned = new Set<string>();

/** Who started the bot's running turn (loop.ts registers it; usage.ts cannot import loop.ts). */
let actorHook: (botId: string) => string | null = () => null;
export const setActorHook = (fn: (botId: string) => string | null) => { actorHook = fn; };

/**
 * Hosted mode (hosted.ts): who pays for a usage line — "operator", "own" or "subscription". Without hosted mode it says
 * nothing ("") and the line is written exactly as before.
 */
let payerHook: (userId: string, model: string, u: TurnUsage, status: string) => string = () => "";
export const setPayerHook = (fn: typeof payerHook) => { payerHook = fn; };

/** `costUsd`: the price the service itself reported (e.g. a video), used instead of our token price list. */
export function record(userId: string, botId: string, model: string, u: TurnUsage, costUsd?: number) {
  const e = costUsd !== undefined ? { cost: costUsd, status: "reported" as const, estimate: 0 } : costEstimate(model, u, userId);
  const payer = payerHook(userId, model, u, e.status);
  // actor_id (wave 6): the workspace member whose message started the turn, for per-member usage (null: the owner).
  if (payer) q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, actor_id, price_status, est_cost_usd, payer) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    userId, botId, now(), model, u.inputTokens, u.outputTokens, u.cachedTokens, e.cost, actorHook(botId), e.status, e.estimate, payer);
  else q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, actor_id, price_status, est_cost_usd) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    userId, botId, now(), model, u.inputTokens, u.outputTokens, u.cachedTokens, e.cost, actorHook(botId), e.status, e.estimate);
  // The task's spend checkpoint (A5) counts the same money — for an unknown price, the conservative estimate, so a
  // checkpoint still stops the work. The journal's per-action cost (A14) only ever shows real, known costs.
  addSpend(botId, e.cost + e.estimate);
  noteCost(botId, e.cost);
  emit(userId, { type: "usage" });
  if (e.status === "unknown") warnUnknown(userId, model);
  if (budgetJustNeared(userId)) {
    const main = bots.primary(userId);
    if (main) rows.append(main, { kind: "notice", tone: "warn", text: tr(users.localeOf(userId), "You have used 80% of this month's budget.") });
    audit(userId, "system", "80% of this month's budget is used");
  }
}

/**
 * Hosted mode only: a paid service the operator's keys paid for and that reports no price (a picture, a voice minute…),
 * counted at the operator's estimate (hosted settings) like an unknown model price: est_cost_usd, status "unknown".
 */
export function recordEstimate(userId: string, botId: string, label: string, estimateUsd: number, payer: string) {
  q.run("INSERT INTO usage (user_id, bot_id, at, model, input_tokens, output_tokens, cached_tokens, cost_usd, actor_id, price_status, est_cost_usd, payer) VALUES (?, ?, ?, ?, 0, 0, 0, 0, ?, 'unknown', ?, ?)",
    userId, botId, now(), label, botId ? actorHook(botId) : null, Math.max(0, estimateUsd), payer);
  if (botId) addSpend(botId, Math.max(0, estimateUsd));
  emit(userId, { type: "usage" });
}

function warnUnknown(userId: string, model: string) {
  const key = `${userId}|${model}|${monthStart().label}`;
  if (unknownWarned.has(key)) return;
  unknownWarned.add(key);
  const loc = users.localeOf(userId);
  const main = bots.primary(userId);
  const text = tr(loc, "The price of the model {model} is unknown: its tokens are counted, and budgets and spend checkpoints count them at the highest known price ({in} $ / {out} $ per million tokens). The owner of this server can set its real price in Settings → Models.",
    { model, in: UNKNOWN_ESTIMATE[0], out: UNKNOWN_ESTIMATE[1] });
  if (main) rows.append(main, { kind: "notice", tone: "warn", text });
  audit(userId, "system", `Model without a known price used: ${model} (counted at the conservative estimate for budgets)`);
}

function monthStart(): { start: number; label: string } {
  const d = new Date();
  return { start: Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1), label: `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}` };
}

export function summary(userId: string): UsageSummary {
  const { start, label } = monthStart();
  const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
  const per = q.all<{ bot_id: string; i: number; o: number; n: number; c: number; ut: number; e: number }>(
    `SELECT bot_id, SUM(input_tokens) AS i, SUM(output_tokens) AS o, COUNT(*) AS n, SUM(cost_usd) AS c,
       SUM(CASE WHEN price_status = 'unknown' THEN input_tokens + output_tokens ELSE 0 END) AS ut, SUM(est_cost_usd) AS e
     FROM usage WHERE user_id = ? AND at >= ? GROUP BY bot_id ORDER BY c DESC, o DESC`, userId, start);
  const byBot = per.map((r) => ({ botId: r.bot_id, name: names.get(r.bot_id) ?? "Removed bot", inputTokens: r.i, outputTokens: r.o, turns: r.n, costUsd: r.c, unknownTokens: r.ut ?? 0, estimatedUsd: r.e ?? 0 }));
  const totals = byBot.reduce((a, b) => ({ inputTokens: a.inputTokens + b.inputTokens, outputTokens: a.outputTokens + b.outputTokens, turns: a.turns + b.turns, costUsd: a.costUsd + b.costUsd, unknownTokens: a.unknownTokens + b.unknownTokens, estimatedUsd: a.estimatedUsd + b.estimatedUsd }),
    { inputTokens: 0, outputTokens: 0, turns: 0, costUsd: 0, unknownTokens: 0, estimatedUsd: 0 });
  const unknownModels = q.all<{ model: string }>("SELECT DISTINCT model FROM usage WHERE user_id = ? AND at >= ? AND price_status = 'unknown' ORDER BY model", userId, start).map((r) => r.model);
  const budgetUsd = settings.budget(userId);
  // The budget meter counts the conservative estimate of unknown prices too (see UNKNOWN_ESTIMATE).
  const counted = totals.costUsd + totals.estimatedUsd;
  return { month: label, totals, byBot, budgetUsd, subscriptions: subscriptionsOf(userId, start), unknownModels, nearBudget: budgetUsd !== null && budgetUsd > 0 && counted >= budgetUsd * 0.8 };
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
    .map((r) => [new Date(r.at).toISOString(), `"${(names.get(r.bot_id) ?? "Removed bot").replace(/"/g, '""')}"`, r.model, r.input_tokens, r.output_tokens, r.cached_tokens, r.cost_usd.toFixed(6), r.price_status || "", (r.est_cost_usd ?? 0).toFixed(6)].join(","));
  return ["time,bot,model,input_tokens,output_tokens,cached_tokens,cost_usd,price_status,estimated_usd_if_unknown", ...lines].join("\n") + "\n";
}

/**
 * What this month's spending counts as for budgets: known costs plus the conservative estimate of calls whose price is
 * unknown (est_cost_usd, see UNKNOWN_ESTIMATE). Also used by the paid third-party tools' budget check (thirdparty.ts).
 */
export function spentThisMonth(userId: string, since = monthStart().start): number {
  return q.get<{ c: number | null }>("SELECT SUM(cost_usd + est_cost_usd) AS c FROM usage WHERE user_id = ? AND at >= ?", userId, since)?.c ?? 0;
}

/** True when a monthly budget is set and already spent (unknown prices counted at their conservative estimate). */
export function overBudget(userId: string): boolean {
  const budget = settings.budget(userId);
  if (budget === null) return false;
  return spentThisMonth(userId) >= budget;
}
