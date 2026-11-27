/**
 * « Autoriser pour cette conversation » (agent/conversationgrants.ts, README « Sécurité »): wire types shared with
 * the web and mobile apps (type-only on their side, plus the idle constant).
 */

/** A grant ends by itself when its owner has written nothing in that conversation for this long. */
export const CONVERSATION_GRANT_IDLE_MS = 12 * 60 * 60_000;

/** Why a grant ended: the owner took it back, nothing written for too long, the conversation was cleared, the bot is gone. */
export type ConversationGrantEnd = "revoked" | "idle" | "cleared" | "bot_gone";

/** An active grant, as the owner sees it in Settings → Permissions. */
export interface ConversationGrantInfo {
  id: string;
  botId: string; botName: string;
  /** 0: the bot's main chat; else the seq of the message the thread hangs on. */
  thread: number;
  /** The tool it covers, in words ("Gmail: mail send", "Run a command"…). */
  label: string;
  /** The permission key it is bound to — the same key an "always" rule would carry ("Gmail: mail_send", "click: host"…). */
  place: string;
  grantedAt: number;
  /** How many actions ran under it, and when the last one did. */
  uses: number; lastUsedAt: number | null;
  /** When it ends if the owner writes nothing more in that conversation. */
  expiresAt: number;
}
