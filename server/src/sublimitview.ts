import { q } from "./db.js";
import type { Engine, SubscriptionLimitView } from "./shared.js";
import { users } from "./store.js";

/**
 * What Today and Surveillance show of the subscriptions at their usage limit (agent/sublimit.ts keeps them in
 * subscription_limits, migration 15). Read-only and free of the agent layer, so the Sentinelle's routes may use it.
 */
interface LimitRow { user_id: string; engine: Engine; until: number; source: "event" | "default"; detected_at: number }

function views(rowsOf: LimitRow[], viewer: string | null): SubscriptionLimitView[] {
  return rowsOf.map((r) => {
    const told = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM subscription_limit_bots WHERE user_id = ? AND engine = ?", r.user_id, r.engine)?.n ?? 0;
    const queued = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_queue JOIN bots ON bots.id = bot_queue.bot_id WHERE bot_queue.status = 'limited' AND bots.user_id = ? AND bots.model LIKE ?", r.user_id, `${r.engine}:%`)?.n ?? 0;
    const view: SubscriptionLimitView = { engine: r.engine, until: r.until, since: r.detected_at, source: r.source, bots: told, queued };
    if (viewer !== null) view.account = r.user_id === viewer ? null : users.byId(r.user_id)?.email ?? null;
    return view;
  });
}
/** The account's own limits now (Today). */
export const limitsFor = (userId: string): SubscriptionLimitView[] =>
  views(q.all<LimitRow>("SELECT * FROM subscription_limits WHERE user_id = ? AND until > ? ORDER BY until", userId, Date.now()), null);
/** Every account's limits now (Surveillance, for its watchers). */
export const allLimits = (viewer: string): SubscriptionLimitView[] =>
  views(q.all<LimitRow>("SELECT * FROM subscription_limits WHERE until > ? ORDER BY until LIMIT 200", Date.now()), viewer);
