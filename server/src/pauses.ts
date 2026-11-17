import { q } from "./db.js";
import type { BotPause, PauseState } from "./shared.js";

/**
 * "Pause" — the records (migration 6, table bot_pauses). The owner pauses one bot, one sidebar section, or every bot of
 * the account; a bot is paused while any of those covers it, and a helper bot (parent_id) follows the bot it works for.
 * What pausing and resuming DO (stop the running turns, hold the queue, skip routines, release the queue in order) is in
 * agent/pause.ts; this file only reads and writes the records, so the store can tell a bot's state without a cycle.
 *
 * Same idea as OpenMausBot's "Pause bot / department / every bot" (docs/pausing-bots.md, Apache-2.0; ideas only): one
 * switch for "stop all effort for now", that keeps every conversation, memory, setting and routine, until Resume.
 */
export type PauseScope = "bot" | "section" | "all";

interface PauseRow { scope: PauseScope; target: string; since: number }

export const pauses = {
  /** The owner's pauses. */
  state(userId: string): PauseState {
    const rows = q.all<PauseRow>("SELECT scope, target, since FROM bot_pauses WHERE user_id = ? ORDER BY since", userId);
    const all = rows.find((r) => r.scope === "all");
    return {
      all: all ? { since: all.since } : null,
      sections: rows.filter((r) => r.scope === "section").map((r) => ({ id: r.target, since: r.since })),
      bots: rows.filter((r) => r.scope === "bot").map((r) => ({ id: r.target, since: r.since })),
    };
  },
  /** Sets a pause; false when it was already set (its first date is kept). */
  set(userId: string, scope: PauseScope, target: string, byId: string | null): boolean {
    return Number(q.run("INSERT OR IGNORE INTO bot_pauses (user_id, scope, target, since, by_id) VALUES (?, ?, ?, ?, ?)", userId, scope, scope === "all" ? "" : target, Date.now(), byId).changes) > 0;
  },
  /** Lifts a pause; false when there was none. */
  clear(userId: string, scope: PauseScope, target: string): boolean {
    return Number(q.run("DELETE FROM bot_pauses WHERE user_id = ? AND scope = ? AND target = ?", userId, scope, scope === "all" ? "" : target).changes) > 0;
  },
  /** A bot or a section is removed: its pause goes with it. */
  forget: (scope: "bot" | "section", target: string) => q.run("DELETE FROM bot_pauses WHERE scope = ? AND target = ?", scope, target),
  sectionPaused: (userId: string, sectionId: string) => !!q.get("SELECT 1 FROM bot_pauses WHERE user_id = ? AND scope = 'section' AND target = ?", userId, sectionId),
  /**
   * Why this bot is paused, or null. `bot`: its id, owner, section and parent (a helper follows its parent, whose section
   * counts). One small indexed lookup; called for every bot the store reads.
   */
  of(bot: { id: string; userId: string; sectionId: string | null; parentId: string | null }): BotPause | null {
    const rows = q.all<PauseRow>("SELECT scope, target, since FROM bot_pauses WHERE user_id = ?", bot.userId);
    if (!rows.length) return null;
    let selfId = bot.id;
    let sectionId = bot.sectionId;
    if (bot.parentId) {
      const parent = q.get<{ id: string; section_id: string | null }>("SELECT id, section_id FROM bots WHERE id = ?", bot.parentId);
      if (parent) { selfId = parent.id; sectionId = parent.section_id ?? null; }
    }
    const all = rows.find((r) => r.scope === "all");
    const sec = sectionId ? rows.find((r) => r.scope === "section" && r.target === sectionId) : undefined;
    const own = rows.find((r) => r.scope === "bot" && (r.target === selfId || r.target === bot.id));
    const widest = all ?? sec ?? own;
    if (!widest) return null;
    const queued = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_queue WHERE bot_id = ? AND status = 'held'", bot.id)?.n ?? 0;
    return { by: widest.scope, self: !!own, sectionId: sec ? sectionId : null, since: widest.since, queued };
  },
};
