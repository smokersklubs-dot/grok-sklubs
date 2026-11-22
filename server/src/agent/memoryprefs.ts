import { db, q } from "../db.js";

/**
 * Small memory settings and records kept beside the notes (tables created at module load, the house pattern):
 *
 * - L88 « Ne rien retenir » for one bot: while it is on, the bot learns nothing from its conversation (the automatic
 *   learning skips its messages and memory_save refuses), and the notes it already has stay as they are.
 * - L71 « Mémoire par le sens » for one account: off by default. When the owner switches it on, notes and searches are
 *   also sent to the account's own AI provider to be turned into "embeddings" (agent/semantic.ts). Nothing else is sent.
 * - L80/L138 the text of each conversation summary, so the owner can read it (« Voir le résumé »).
 */
db.exec(`
  CREATE TABLE IF NOT EXISTS memory_bot_prefs (bot_id TEXT PRIMARY KEY REFERENCES bots(id) ON DELETE CASCADE, no_learn INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS memory_user_prefs (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, semantic INTEGER NOT NULL DEFAULT 0, updated_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS compaction_summaries (
    id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL,
    at INTEGER NOT NULL, before_items INTEGER NOT NULL, after_items INTEGER NOT NULL, summary TEXT NOT NULL, flushed INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX IF NOT EXISTS compaction_summaries_bot ON compaction_summaries(bot_id, generation, id);
`);

export const memoryPrefs = {
  /** « Ne rien retenir » is on for this bot. */
  noLearn: (botId: string) => (q.get<{ no_learn: number }>("SELECT no_learn FROM memory_bot_prefs WHERE bot_id = ?", botId)?.no_learn ?? 0) === 1,
  setNoLearn(botId: string, on: boolean) {
    q.run("INSERT INTO memory_bot_prefs (bot_id, no_learn, updated_at) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET no_learn = excluded.no_learn, updated_at = excluded.updated_at", botId, on ? 1 : 0, Date.now());
  },
  /** « Mémoire par le sens » is on for this account (off unless the owner chose it). */
  semantic: (userId: string) => (q.get<{ semantic: number }>("SELECT semantic FROM memory_user_prefs WHERE user_id = ?", userId)?.semantic ?? 0) === 1,
  setSemantic(userId: string, on: boolean) {
    q.run("INSERT INTO memory_user_prefs (user_id, semantic, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET semantic = excluded.semantic, updated_at = excluded.updated_at", userId, on ? 1 : 0, Date.now());
  },
};

export interface StoredSummary { at: number; before: number; after: number; summary: string; flushed: boolean }
export const summaries = {
  add(botId: string, generation: number, before: number, after: number, summary: string, flushed: boolean) {
    q.run("INSERT INTO compaction_summaries (bot_id, generation, at, before_items, after_items, summary, flushed) VALUES (?, ?, ?, ?, ?, ?, ?)", botId, generation, Date.now(), before, after, summary, flushed ? 1 : 0);
  },
  /** The latest summary of this conversation (generation), or null. */
  latest(botId: string, generation: number): StoredSummary | null {
    const r = q.get<{ at: number; before_items: number; after_items: number; summary: string; flushed: number }>(
      "SELECT at, before_items, after_items, summary, flushed FROM compaction_summaries WHERE bot_id = ? AND generation = ? ORDER BY id DESC LIMIT 1", botId, generation);
    return r ? { at: r.at, before: r.before_items, after: r.after_items, summary: r.summary, flushed: r.flushed === 1 } : null;
  },
};
