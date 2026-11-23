/**
 * Memory under the owner's control, the rest of L66 (audits mem0, claude-mem; docs/cleanroom/10-timon.md T67, ideas only):
 *
 *  - « Ne pas retenir ce message »: the owner marks one of their messages; the automatic learning (memory.ts) never reads
 *    it, whatever it says. Unmarking it lets the next passes read it only if the mark has not moved past it.
 *  - Removed facts are never learned again: a note the owner deleted (« Oublier »), or the bot set aside at the owner's
 *    request, leaves a tombstone (its text). The automatic learning and an unasked memory_save skip any fact similar to
 *    a tombstone; only the owner's own explicit « retiens… » brings it back (and lifts the tombstone).
 *  - A fresh conversation is proposed: the current conversation may still hold what was removed (T67), so a notice in
 *    the bot's main chat says so and points to « Nouvelle conversation ». Nothing is reset without the owner.
 *
 * Tables at load (the house pattern); they go with their bot (ON DELETE CASCADE).
 */
import { q } from "../db.js";
import { clip, now, rows, users, type BotRecord } from "../store.js";
import { similar } from "./memory.js";

q.run(`CREATE TABLE IF NOT EXISTS memory_skip_rows (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, generation INTEGER NOT NULL, seq INTEGER NOT NULL, at INTEGER NOT NULL,
  PRIMARY KEY (bot_id, generation, seq))`);
q.run(`CREATE TABLE IF NOT EXISTS memory_tombstones (
  id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, text TEXT NOT NULL, at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS memory_tombstones_bot ON memory_tombstones(bot_id, id)");

/** Tombstones kept per bot (the oldest go first). */
export const MAX_TOMBSTONES = 500;

export const memoryKeep = {
  skip(botId: string, generation: number, seq: number, on: boolean) {
    if (on) q.run("INSERT OR IGNORE INTO memory_skip_rows (bot_id, generation, seq, at) VALUES (?, ?, ?, ?)", botId, generation, seq, now());
    else q.run("DELETE FROM memory_skip_rows WHERE bot_id = ? AND generation = ? AND seq = ?", botId, generation, seq);
  },
  skipped: (botId: string, generation: number, seq: number) => !!q.get("SELECT 1 FROM memory_skip_rows WHERE bot_id = ? AND generation = ? AND seq = ?", botId, generation, seq),
  /** The marked messages of a conversation generation (for the learning pass and the chat). */
  skippedSeqs: (botId: string, generation: number) => new Set(q.all<{ seq: number }>("SELECT seq FROM memory_skip_rows WHERE bot_id = ? AND generation = ?", botId, generation).map((r) => r.seq)),

  bury(botId: string, text: string) {
    const t = clip(String(text ?? "").trim(), 500);
    if (!t) return;
    q.run("INSERT INTO memory_tombstones (bot_id, text, at) VALUES (?, ?, ?)", botId, t, now());
    q.run("DELETE FROM memory_tombstones WHERE bot_id = ? AND id NOT IN (SELECT id FROM memory_tombstones WHERE bot_id = ? ORDER BY id DESC LIMIT ?)", botId, botId, MAX_TOMBSTONES);
  },
  /** A fact like one the owner removed: never learned again by itself. */
  buried: (botId: string, text: string) => q.all<{ text: string }>("SELECT text FROM memory_tombstones WHERE bot_id = ?", botId).some((r) => similar(r.text, text)),
  /** The owner explicitly asked to remember it again: the tombstones it matches are lifted. */
  unbury(botId: string, text: string) {
    for (const r of q.all<{ id: number; text: string }>("SELECT id, text FROM memory_tombstones WHERE bot_id = ?", botId)) if (similar(r.text, text)) q.run("DELETE FROM memory_tombstones WHERE id = ?", r.id);
  },
  count: (botId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM memory_tombstones WHERE bot_id = ?", botId)!.n,
};

/** After a note was removed: the bot's main chat proposes a fresh conversation (at most one notice per bot per hour). */
const lastProposed = new Map<string, number>();
export function proposeFreshConversation(bot: Pick<BotRecord, "id" | "userId">, at = now()) {
  if ((lastProposed.get(bot.id) ?? 0) > at - 3600_000) return false;
  lastProposed.set(bot.id, at);
  const fr = users.localeOf(bot.userId) === "fr";
  rows.append(bot, { kind: "notice", tone: "info", text: fr
    ? "Note retirée de la mémoire : le bot ne la réapprendra pas tout seul. La conversation en cours peut encore la contenir : pour repartir propre, démarre une « Nouvelle conversation »."
    : "Note removed from memory: the bot will not learn it again by itself. The current conversation may still hold it: to start clean, begin a « New conversation »." });
  return true;
}
