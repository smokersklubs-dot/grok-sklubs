import { q } from "./db.js";

/**
 * Lot 4 comfort — « Mettre en sourdine » one chat: no phone or browser notification from that bot for 8 hours, or until
 * the owner turns it back on. Approval questions (« needs ») still notify: a bot waiting for your OK must never wait in
 * silence. Messages, work and Telegram are untouched; only notifications (push.ts sendPush) are held back.
 */
q.run(`CREATE TABLE IF NOT EXISTS chat_mutes (
  bot_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, until INTEGER NOT NULL
)`);

/** 0 = until turned back on. */
export const MUTE_HOURS = { "8h": 8, forever: 0 } as const;
export type MuteChoice = keyof typeof MUTE_HOURS | "off";

export const chatMutes = {
  /** Muted until this time (ms), Infinity for "until turned back on", or null when not muted. */
  until(userId: string, botId: string, at = Date.now()): number | null {
    const r = q.get<{ until: number }>("SELECT until FROM chat_mutes WHERE bot_id = ? AND user_id = ?", botId, userId);
    if (!r) return null;
    if (r.until === 0) return Infinity;
    return r.until > at ? r.until : null;
  },
  set(userId: string, botId: string, choice: MuteChoice, at = Date.now()) {
    if (choice === "off") { q.run("DELETE FROM chat_mutes WHERE bot_id = ? AND user_id = ?", botId, userId); return; }
    const h = MUTE_HOURS[choice];
    q.run("INSERT INTO chat_mutes (bot_id, user_id, until) VALUES (?, ?, ?) ON CONFLICT(bot_id) DO UPDATE SET user_id = excluded.user_id, until = excluded.until", botId, userId, h === 0 ? 0 : at + h * 3_600_000);
  },
  view(userId: string, botId: string) {
    const u = chatMutes.until(userId, botId);
    return { muted: u !== null, until: u === null || u === Infinity ? null : u };
  },
};

/** Whether a notification about this bot is held back (push.ts). Approval questions always go. */
export const mutedPush = (userId: string, botId: string | undefined, kind: string) => !!botId && kind !== "needs" && kind !== "test" && chatMutes.until(userId, botId) !== null;
