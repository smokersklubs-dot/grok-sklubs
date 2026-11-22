/**
 * DS-Bot item 4 (channelgroups.ts): wire types of the group chats a bot is in on Slack, Discord or Telegram.
 * Shared by the server and the web settings screen.
 */
import type { ContactChannel } from "./channeltypes.js";

/** `pending`: someone called the bot there, the owner has not decided; `allowed`: turned on; `blocked`: refused (silence). */
export type GroupStatus = "pending" | "allowed" | "blocked";
/** `mention`: answers only when @mentioned or replied to; `all`: every message of the group. */
export type GroupTrigger = "mention" | "all";
/** `approved`: the owner and the people on the bot's allow-list of that service; `everyone`: anyone in the group. */
export type GroupWho = "approved" | "everyone";

export interface ChannelGroup {
  id: string;
  channel: ContactChannel;
  /** The group's id on the service (Slack channel C…, Discord channel id, Telegram chat id, negative for groups). */
  chatId: string;
  name: string;
  status: GroupStatus;
  trigger: GroupTrigger;
  who: GroupWho;
  createdAt: number;
  lastSeenAt: number | null;
}

export const GROUP_LIMITS = { maxPending: 10, perGroupPerMinute: 30, perPersonPerMinute: 8, noticeEveryMs: 60 * 60 * 1000 } as const;
