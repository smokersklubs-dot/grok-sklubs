import { createHash } from "node:crypto";
import { q } from "./db.js";
import type { ThirdPartySpend } from "./shared.js";
import { bots, newId, now, settings } from "./store.js";
import { record as recordUsage, recordServiceCost, spentThisMonth } from "./usage.js";
import { hostedMode, operatorBlock, toolRefusal } from "./hosted.js";
import { capName, moneyLeft, turnAttended } from "./usagecaps.js";

/**
 * Wave 7 (spec 08) — what paid third-party tools cost (A4) and a cache for read-only data calls (A5).
 *
 * A4. Money is counted in micro-dollars (integers), never in floating point, so many tiny calls add up exactly. Before a
 * paid call the maximum it can cost is reserved; afterwards the real cost is settled (and goes into the usage table, so
 * the spend checkpoint, the monthly budget and the journal count it like model spend) and the difference is released.
 * A call the provider does not bill when it fails costs nothing. The same request sent again (a retry after a cut) with
 * the same idempotency key is not charged twice and gets the stored result back. A bot can have a daily cap on paid
 * third-party tools, on top of the monthly budget. Refusals are sentences the bot can act on.
 *
 * A5. Only read-only data calls are cached, never an action, a job's status or the user's account information. Each tool
 * (or provider) has a policy: forbid (the provider's terms exclude it), temp (a maximum age) or keep. Without a policy:
 * temp and short. "fresh" forces a real call. Errors and empty answers are never kept. Each account sees only its own.
 */

export const toMicros = (usd: number) => Math.round(usd * 1_000_000);
export const fromMicros = (m: number) => m / 1_000_000;
const usd = (m: number) => `${fromMicros(m).toFixed(2)} $`;
const dayStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()); };
const monthStart = () => { const d = new Date(); return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1); };
/** A settled or released request older than this is a new request, even with the same arguments. */
export const IDEMPOTENCY_WINDOW_MS = 10 * 60_000;

/** Same arguments in any key order → the same text. */
export function stableJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stableJson).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v as object).sort().filter((k) => (v as any)[k] !== undefined).map((k) => `${JSON.stringify(k)}:${stableJson((v as any)[k])}`).join(",")}}`;
  return JSON.stringify(v ?? null);
}
const hash = (s: string) => createHash("sha256").update(s).digest("hex");

/** Third-party money committed by a bot today (settled at its real cost, plus what is reserved right now). */
function committedToday(botId: string): number {
  return q.get<{ s: number | null }>("SELECT SUM(CASE WHEN status = 'settled' THEN actual_micros WHEN status = 'reserved' THEN reserved_micros ELSE 0 END) AS s FROM tool_spend WHERE bot_id = ? AND created_at >= ?", botId, dayStart())?.s ?? 0;
}
function reservedForUser(userId: string): number {
  return q.get<{ s: number | null }>("SELECT SUM(reserved_micros) AS s FROM tool_spend WHERE user_id = ? AND status = 'reserved' AND created_at >= ?", userId, monthStart())?.s ?? 0;
}
function monthUsage(userId: string): number {
  // Model calls whose price is unknown count at their conservative estimate, like the monthly budget (usage.ts).
  return toMicros(spentThisMonth(userId, monthStart()));
}

export type Reservation =
  | { kind: "reserved"; id: string; reservedUsd: number }
  | { kind: "replay"; result: string }
  | { kind: "busy" }
  | { kind: "refused"; reason: "daily_cap" | "budget" | "usage_cap"; message: string };

/** The key of "this same request": a key the caller gives, else the bot, the tool, the provider and the arguments. */
export const idemKeyOf = (botId: string, tool: string, provider: string, args: unknown, given?: string) => hash(given ? `given|${botId}|${given}` : `${botId}|${tool}|${provider}|${stableJson(args)}`);

/** Reserves the most a paid call can cost, or refuses it in words the bot can act on. */
export function reserve(f: { userId: string; botId: string; tool: string; provider: string; maxUsd: number; idemKey: string; /** Paid with the account's own key (mediakeys.ts): the operator's plan budget does not apply. */ ownKey?: boolean }): Reservation {
  const max = Math.max(0, toMicros(f.maxUsd));
  return q.tx((): Reservation => {
    const prev = q.get<{ id: string; status: string; result: string | null; created_at: number; settled_at: number | null }>("SELECT id, status, result, created_at, settled_at FROM tool_spend WHERE user_id = ? AND idem_key = ?", f.userId, f.idemKey);
    if (prev && prev.status === "reserved") return { kind: "busy" };
    if (prev && prev.status === "settled" && prev.result !== null && now() - (prev.settled_at ?? prev.created_at) < IDEMPOTENCY_WINDOW_MS) return { kind: "replay", result: prev.result };
    const bot = bots.byId(f.botId);
    const cap = bot?.thirdPartyDailyCapUsd ?? null;
    if (cap !== null) {
      const used = committedToday(f.botId);
      if (used + max > toMicros(cap)) return {
        kind: "refused", reason: "daily_cap",
        message: `Budget refusal: this paid call could cost up to ${usd(max)}. ${bot?.name ?? "This bot"}'s daily cap on paid tools is ${usd(toMicros(cap))} and ${usd(used)} is already used today (${usd(Math.max(0, toMicros(cap) - used))} left). Nothing was spent. Options: ask the user to raise the cap (your settings → Paid tools), wait until tomorrow (UTC), or use a free way.`,
      };
    }
    // Usage caps (usagecaps.ts): a money cap that stops this work (an "everything" cap, or any cap for work no person
    // started) must have room for the most this call can cost.
    const room = bot ? moneyLeft(bot, turnAttended(bot.id)) : null;
    if (room && max > toMicros(room.left)) return {
      kind: "refused", reason: "usage_cap",
      message: `Usage cap refusal: this paid call could cost up to ${usd(max)}, and ${capName(room.cap, "en")} of ${usd(toMicros(room.cap.limit))} has ${usd(toMicros(room.left))} left. Nothing was spent. Tell the user: they can raise the cap (Settings → Usage) or wait until it resets; or use a free way.`,
    };
    const budget = settings.budget(f.userId);
    if (budget !== null && budget > 0) {
      const spent = monthUsage(f.userId) + reservedForUser(f.userId);
      if (spent + max > toMicros(budget)) return {
        kind: "refused", reason: "budget",
        message: `Budget refusal: this paid call could cost up to ${usd(max)}, and the account's monthly budget of ${usd(toMicros(budget))} has ${usd(Math.max(0, toMicros(budget) - spent))} left. Nothing was spent. Tell the user: they can raise the budget (Settings → Usage), or you can use a free way.`,
      };
    }
    // Hosted mode: paid third-party calls run on the service's keys; the plan's monthly AI budget must cover the most this
    // call can cost on top of what is spent and reserved (nothing for an operator, or with hosted mode off).
    const held = max > 0 && !f.ownKey ? operatorBlock(f.userId, fromMicros(reservedForUser(f.userId) + max)) : null;
    if (held) return { kind: "refused", reason: "budget", message: toolRefusal(held) };
    if (prev) {
      q.run("UPDATE tool_spend SET status = 'reserved', reserved_micros = ?, actual_micros = 0, result = NULL, created_at = ?, settled_at = NULL, tool = ?, provider = ? WHERE id = ?", max, now(), f.tool, f.provider, prev.id);
      return { kind: "reserved", id: prev.id, reservedUsd: fromMicros(max) };
    }
    const id = newId("tsp");
    q.run("INSERT INTO tool_spend (id, user_id, bot_id, tool, provider, idem_key, reserved_micros, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, f.userId, f.botId, f.tool, f.provider, f.idemKey, max, now());
    return { kind: "reserved", id, reservedUsd: fromMicros(max) };
  });
}

/** The call went through: its real cost is recorded (usage, checkpoint, journal) and the rest of the reservation freed. */
export function settle(id: string, actualUsd: number, result: string, model?: string, ownKey = false) {
  const r = q.get<{ user_id: string; bot_id: string; tool: string; provider: string; status: string }>("SELECT user_id, bot_id, tool, provider, status FROM tool_spend WHERE id = ?", id);
  if (!r || r.status !== "reserved") return;
  const micros = Math.max(0, toMicros(actualUsd));
  q.run("UPDATE tool_spend SET status = 'settled', actual_micros = ?, result = ?, settled_at = ? WHERE id = ?", micros, result.slice(0, 200_000), now(), id);
  // The account's own key (mediakeys.ts) pays: a "reported" line paid by the account, never the operator's (hosted mode).
  if (ownKey) recordServiceCost(r.user_id, r.bot_id, model ?? `${r.tool}:${r.provider}`, fromMicros(micros), hostedMode() ? "own" : "");
  else recordUsage(r.user_id, r.bot_id, model ?? `${r.tool}:${r.provider}`, { inputTokens: 0, outputTokens: 0, cachedTokens: 0 }, fromMicros(micros));
}

/** The call failed and the provider does not bill failures: nothing is spent. */
export function release(id: string) {
  q.run("UPDATE tool_spend SET status = 'released', settled_at = ? WHERE id = ? AND status = 'reserved'", now(), id);
}

export function thirdPartySummary(userId: string, botId?: string): ThirdPartySpend {
  const where = botId ? "bot_id = ?" : "user_id = ?";
  const who = botId ?? userId;
  const sum = (since: number) => q.get<{ s: number | null }>(`SELECT SUM(actual_micros) AS s FROM tool_spend WHERE ${where} AND status = 'settled' AND created_at >= ?`, who, since)?.s ?? 0;
  const recent = q.all<{ created_at: number; bot_id: string; tool: string; provider: string; actual_micros: number; reserved_micros: number; status: string }>(`SELECT created_at, bot_id, tool, provider, actual_micros, reserved_micros, status FROM tool_spend WHERE ${where} ORDER BY created_at DESC LIMIT 20`, who)
    .map((r) => ({ at: r.created_at, botId: r.bot_id, tool: r.tool, provider: r.provider, usd: fromMicros(r.status === "reserved" ? r.reserved_micros : r.actual_micros), status: r.status }));
  return { todayUsd: fromMicros(sum(dayStart())), capUsd: botId ? bots.byId(botId)?.thirdPartyDailyCapUsd ?? null : null, monthUsd: fromMicros(sum(monthStart())), recent };
}

// ── A5: response cache ──────────────────────────────────────────────────────
export interface CachePolicy { mode: "forbid" | "temp" | "keep"; ttlSec: number }
/** Built-in policies per tool or provider ("provider:<id>"); a user's own settings (Settings → Keys) override them. */
export const DEFAULT_CACHE: Record<string, CachePolicy> = {
  search_web: { mode: "temp", ttlSec: 3600 },
  reach_search: { mode: "temp", ttlSec: 3600 },
  reach_read: { mode: "temp", ttlSec: 6 * 3600 },
  transcribe: { mode: "keep", ttlSec: 30 * 86_400 },
  api_get: { mode: "temp", ttlSec: 15 * 60 },
  // A third-party router's terms are unknown to us: nothing it returns is kept.
  "provider:treg": { mode: "forbid", ttlSec: 0 },
};
const FALLBACK: CachePolicy = { mode: "temp", ttlSec: 15 * 60 };

export function cacheSettings(userId: string): Record<string, CachePolicy> {
  const raw = q.get<{ cache_policy: string }>("SELECT cache_policy FROM settings WHERE user_id = ?", userId)?.cache_policy ?? "{}";
  try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; }
}
export function saveCacheSettings(userId: string, input: unknown): Record<string, CachePolicy> {
  const clean: Record<string, CachePolicy> = {};
  if (input && typeof input === "object") for (const [k, v] of Object.entries(input as Record<string, any>)) {
    if (!/^[a-z0-9_:-]{1,60}$/i.test(k) || !v || typeof v !== "object") continue;
    const mode = v.mode === "forbid" || v.mode === "keep" ? v.mode : "temp";
    clean[k] = { mode, ttlSec: Math.min(90 * 86_400, Math.max(0, Math.round(Number(v.ttlSec) || 0))) };
  }
  q.run("INSERT INTO settings (user_id, cache_policy) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET cache_policy = excluded.cache_policy", userId, JSON.stringify(clean));
  return clean;
}

/** The policy for a tool, or for a provider (which wins when it forbids: its terms come first). */
export function cachePolicy(userId: string, tool: string, provider?: string): CachePolicy {
  const mine = cacheSettings(userId);
  const prov = provider ? mine[`provider:${provider}`] ?? DEFAULT_CACHE[`provider:${provider}`] : undefined;
  if (prov?.mode === "forbid") return prov;
  return mine[tool] ?? prov ?? DEFAULT_CACHE[tool] ?? FALLBACK;
}

const cacheKey = (tool: string, provider: string, args: unknown) => hash(`${tool}|${provider}|${stableJson(args)}`);

/** "il y a 2 h" — for the bot, in English. */
export function ageText(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 1) return "less than a minute";
  if (min < 60) return `${min} min`;
  const h = Math.round(min / 60);
  return h < 48 ? `${h} h` : `${Math.round(h / 24)} days`;
}

/** A fresh enough cached answer, with its age, or null (also null when the policy forbids keeping it). */
export function cached(userId: string, tool: string, provider: string, args: unknown): { response: string; age: string; note: string; createdAt: number } | null {
  const policy = cachePolicy(userId, tool, provider);
  if (policy.mode === "forbid") return null;
  const r = q.get<{ response: string; created_at: number; expires_at: number | null }>("SELECT response, created_at, expires_at FROM tool_cache WHERE user_id = ? AND cache_key = ?", userId, cacheKey(tool, provider, args));
  if (!r) return null;
  const maxAge = policy.mode === "keep" ? Math.max(policy.ttlSec, 86_400) : policy.ttlSec;
  if ((r.expires_at !== null && r.expires_at <= now()) || now() - r.created_at > maxAge * 1000) return null;
  const age = ageText(now() - r.created_at);
  return { response: r.response, age, createdAt: r.created_at, note: `[Cached answer, obtained ${age} ago. Call again with fresh: true if you need fresh data.]` };
}

/** Keeps a useful answer (never an error or an empty one: the caller only passes real results). */
export function remember(userId: string, tool: string, provider: string, args: unknown, response: string, policy: CachePolicy) {
  if (policy.mode === "forbid" || !response.trim() || policy.ttlSec <= 0) return;
  const expires = policy.mode === "keep" ? null : now() + policy.ttlSec * 1000;
  q.run("INSERT INTO tool_cache (user_id, cache_key, tool, provider, response, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(user_id, cache_key) DO UPDATE SET response = excluded.response, created_at = excluded.created_at, expires_at = excluded.expires_at",
    userId, cacheKey(tool, provider, args), tool, provider, response.slice(0, 200_000), now(), expires);
  // Old entries go: a cache must not grow without end.
  q.run("DELETE FROM tool_cache WHERE user_id = ? AND expires_at IS NOT NULL AND expires_at < ?", userId, now());
}
