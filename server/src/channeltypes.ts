/**
 * L162 (+ OpenClaw I2, I3, I8, E11): wire types of a bot's extra channels — Slack, Discord, an existing mailbox read over
 * IMAP — and of the people other than the owner who may talk to it there (access requests and allow-list).
 */
import type { ChannelGroup } from "./channelgrouptypes.js";

/** The chat channels where someone other than the owner can ask for access with a short code. */
export const CONTACT_CHANNELS = ["telegram", "slack", "discord"] as const;
export type ContactChannel = (typeof CONTACT_CHANNELS)[number];

/** `pending`: asked, waits for the owner (1 h at most); `allowed`: on the allow-list; `blocked`: refused by the owner. */
export type ContactStatus = "pending" | "allowed" | "blocked";

export interface ChannelContact {
  id: string;
  channel: ContactChannel;
  /** The person's id on that service (Telegram user id, Slack user id U…, Discord user id). */
  externalId: string;
  name: string;
  status: ContactStatus;
  /** Pending only: the code the person received, to compare with what they tell the owner. */
  code: string | null;
  /** Pending only: when the request lapses. */
  expiresAt: number | null;
  createdAt: number;
  lastSeenAt: number | null;
}

/** Limits of access requests (taken from OpenClaw's pairing: 8 characters, 1 hour, 3 waiting per channel). */
export const PAIRING = { codeLength: 8, ttlMs: 60 * 60 * 1000, maxPending: 3 } as const;

export interface SlackChannelStatus {
  connected: boolean;
  team: string | null;
  botUser: string | null;
  /** The owner's own Slack user is linked (sent the link code to the bot). */
  linked: boolean;
  linkCode: string | null;
  online: boolean;
  error: string | null;
}

export interface DiscordChannelStatus {
  connected: boolean;
  botUser: string | null;
  linked: boolean;
  linkCode: string | null;
  online: boolean;
  error: string | null;
  /** The address that adds the bot to a server (OAuth2 "bot" scope), from its application id. */
  inviteUrl: string | null;
}

export interface ImapChannelStatus {
  connected: boolean;
  host: string | null;
  port: number | null;
  username: string | null;
  mailbox: string | null;
  allowedSenders: string[];
  autoReply: boolean;
  /** Minutes between two checks. */
  everyMinutes: number;
  lastCheckAt: number | null;
  error: string | null;
  /** Mails held because their sender is not approved yet ("Name <address>"), newest first. */
  held: { from: string; subject: string; at: number }[];
}

export interface BotChannels {
  slack: SlackChannelStatus;
  discord: DiscordChannelStatus;
  imap: ImapChannelStatus;
  contacts: ChannelContact[];
  /** DS-Bot item 4: the group chats (Slack channels, Discord server channels, Telegram groups) where the bot was called. */
  groups: ChannelGroup[];
}
