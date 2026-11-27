/**
 * L146 « filtre d'activité dans la liste des bots » (pure, tested in scripts/bot-activity.test.mjs): which bots of the
 * sidebar to show — every bot, those at work, those waiting for you (a question, an approval or an unread reply) or those
 * at rest. A bot that waits for you counts there even while it works, so nothing it asks is hidden.
 */
export type BotActivity = "working" | "waiting" | "idle";
export type ActivityFilter = "all" | BotActivity;
export const ACTIVITY_FILTERS: ActivityFilter[] = ["all", "waiting", "working", "idle"];

interface LiveLike { running: boolean; awaiting: unknown }
interface BotLike { id: string; unread: number }

export function activityOf(bot: BotLike, live: LiveLike | undefined): BotActivity {
  if (live?.awaiting || bot.unread > 0) return "waiting";
  if (live?.running) return "working";
  return "idle";
}

export const matches = (bot: BotLike, live: LiveLike | undefined, f: ActivityFilter) => f === "all" || activityOf(bot, live) === f;

export function activityCounts(bots: BotLike[], live: Record<string, LiveLike | undefined>): Record<ActivityFilter, number> {
  const n: Record<ActivityFilter, number> = { all: bots.length, waiting: 0, working: 0, idle: 0 };
  for (const b of bots) n[activityOf(b, live[b.id])]++;
  return n;
}

/** The filter bar shows from this many bots in the list (below, the list fits on screen anyway). */
export const FILTER_FROM = 4;
export const parseFilter = (v: unknown): ActivityFilter => (ACTIVITY_FILTERS.includes(v as ActivityFilter) ? (v as ActivityFilter) : "all");
