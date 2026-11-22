import { q } from "../db.js";
import { postBudget, type BudgetState, type BudgetStore, type ChannelState, type PostEntry } from "./roombudget.js";

/**
 * L53 — the anti-loop state of bot posts (roombudget.ts) kept in SQLite, so the bot-to-bot breaker and the room loop guard
 * survive a restart. Two tables created at module load (house pattern): the recent posts (an hour or so, pruned as they
 * age) and one row per channel ("room:<id>" or "dm:<a>:<b>") with its counters and whether its breaker is open.
 * Imported by team.ts, which every bot-to-bot path goes through; from then on the shared `postBudget` writes through here.
 */
q.run(`CREATE TABLE IF NOT EXISTS bot_post_log (
  user_id TEXT NOT NULL, channel TEXT NOT NULL, bot_id TEXT NOT NULL, norm TEXT NOT NULL, at INTEGER NOT NULL, to_user INTEGER NOT NULL DEFAULT 0)`);
q.run("CREATE INDEX IF NOT EXISTS bot_post_log_user ON bot_post_log (user_id, at)");
q.run(`CREATE TABLE IF NOT EXISTS bot_post_channels (
  user_id TEXT NOT NULL, channel TEXT NOT NULL, since_human INTEGER NOT NULL DEFAULT 0, to_user TEXT NOT NULL DEFAULT '{}', open INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, channel))`);

export const dbBudgetStore: BudgetStore = {
  load(userId: string, since: number): BudgetState {
    const log = q.all<{ channel: string; bot_id: string; norm: string; at: number; to_user: number }>("SELECT channel, bot_id, norm, at, to_user FROM bot_post_log WHERE user_id = ? AND at >= ? ORDER BY at, rowid", userId, since)
      .map((r): PostEntry => ({ channel: r.channel, botId: r.bot_id, norm: r.norm, at: r.at, toUser: !!r.to_user }));
    const channels = new Map<string, ChannelState>();
    for (const r of q.all<{ channel: string; since_human: number; to_user: string; open: number }>("SELECT channel, since_human, to_user, open FROM bot_post_channels WHERE user_id = ?", userId)) {
      let toUser: Record<string, number> = {};
      try { toUser = JSON.parse(r.to_user) as Record<string, number>; } catch { /* unreadable: counters start over */ }
      channels.set(r.channel, { sinceHuman: r.since_human, toUser: new Map(Object.entries(toUser)), open: !!r.open });
    }
    return { log, channels };
  },
  addPost(userId, e) {
    q.run("INSERT INTO bot_post_log (user_id, channel, bot_id, norm, at, to_user) VALUES (?, ?, ?, ?, ?, ?)", userId, e.channel, e.botId, e.norm.slice(0, 4000), e.at, e.toUser ? 1 : 0);
  },
  saveChannel(userId, key, c) {
    q.run("INSERT INTO bot_post_channels (user_id, channel, since_human, to_user, open) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, channel) DO UPDATE SET since_human = excluded.since_human, to_user = excluded.to_user, open = excluded.open",
      userId, key, c.sinceHuman, JSON.stringify(Object.fromEntries(c.toUser)), c.open ? 1 : 0);
  },
  dropChannel(userId, key) { q.run("DELETE FROM bot_post_channels WHERE user_id = ? AND channel = ?", userId, key); },
  prune(userId, before) { q.run("DELETE FROM bot_post_log WHERE user_id = ? AND at < ?", userId, before); },
  clear() { q.run("DELETE FROM bot_post_log"); q.run("DELETE FROM bot_post_channels"); },
};

postBudget.useStore(dbBudgetStore);
