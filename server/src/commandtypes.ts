/**
 * « Centre de commandement » (command.ts, GET /api/command): the wire types and the one rule that turns a bot's records
 * into a state word, shared by the server and the web app (web/src/types.ts re-exports them; kept apart so shared.ts
 * does not grow). Read-only: nothing here changes anything.
 */
import type { AvatarColor, AvatarShape, BotPause, Character, Live, TodayLink } from "./shared.js";

/** What a bot is doing, as the card says it: au travail, en attente de toi, en pause, en veille, en erreur. */
export const COMMAND_STATES = ["working", "waiting", "error", "paused", "idle"] as const;
export type CommandState = (typeof COMMAND_STATES)[number];

/**
 * The state of one card. Order matters: a paused bot is paused whatever else is true; then what only the user can unblock
 * (a card or a question waiting for them); then an incident waiting for them; then work under way; otherwise asleep.
 * `missions`: goals, background tasks or long commands running right now (work goes on without a live turn).
 */
export function commandStateOf(i: { paused: boolean; live: Pick<Live, "running" | "awaiting"> | null; awaiting: number; incidentsWaiting: number; missions: number }): CommandState {
  if (i.paused) return "paused";
  if (i.live?.awaiting || i.awaiting > 0) return "waiting";
  if (i.incidentsWaiting > 0) return "error";
  if (i.live?.running || i.missions > 0) return "working";
  return "idle";
}

/** What the bot works on now: an active goal, a running background task, a task of the list, a long command. */
export interface CommandMission { kind: "goal" | "bgTask" | "task" | "job"; title: string; since: number; link: TodayLink }
/** The last thing the bot finished (goal, background task, task of the list), within the last week. */
export interface CommandResult { kind: "goal" | "bgTask" | "task"; title: string; detail: string; at: number; link: TodayLink }
/** The bot's computer, from the server's cached state (never a call to the computer). `shared`: one of the account's shared computers. */
export interface CommandComputer { power: "on" | "asleep" | "absent"; shared: boolean; name: string }
/** Today's consumption (the user's day): dollars as billed or estimated, and tokens. */
export interface CommandUsage { usd: number; tokens: number }

/** One bot's card. Fields only its owner may read are null for a bot shared with the caller through a workspace. */
export interface CommandCard {
  botId: string;
  name: string;
  label: string;
  shape: AvatarShape;
  color: AvatarColor;
  primary: boolean;
  character: Character;
  /** The caller's sidebar section (own bots), else null. */
  sectionId: string | null;
  /** A bot someone shares with the caller: the workspace, its owner and the caller's role there. */
  shared: { workspaceName: string; ownerName: string; role: string } | null;
  state: CommandState;
  live: Live;
  pause: BotPause | null;
  mission: CommandMission | null;
  /** How many missions run now (the mission shown is the newest). */
  missions: number;
  /** Cards and questions waiting for the caller in this bot's chat (a shared bot: its approvals, if the role answers them). */
  awaiting: number;
  /** Open incidents (« Incidents », agent/failures.ts) and, of those, the ones waiting for the owner. Owner only. */
  incidents: number | null;
  incidentsWaiting: number | null;
  lastResult: CommandResult | null;
  usage: CommandUsage | null;
  computer: CommandComputer | null;
  /** What the caller may do from the card (the routes check again). */
  can: { pause: boolean; stop: boolean; chat: boolean; computer: boolean; incidents: boolean };
  lastActivityAt: number;
}

/** One line of what passed between two bots. `botId`/`seq`/`thread`: where it is in the conversation that received it. */
export interface CommandExchange { at: number; fromId: string; toId: string; text: string; botId: string; seq: number; thread: number }
/**
 * Two bots working together: messages from one to the other (bot_message), a failure handed to a teammate, or both
 * talking in the same group chat — within the window (`windowMs`). `from`/`to` are the two ends (a room: alphabetical).
 */
export interface CommandLink { id: string; kind: "message" | "handoff" | "room"; from: string; to: string; count: number; lastAt: number; roomId: string | null; roomName: string; exchange: CommandExchange[] }

export interface CommandKpis {
  working: number;
  /** Cards waiting for the caller, all bots together (plus bots waiting on them without a card). */
  waiting: number;
  /** Open incidents of the caller's own bots. */
  incidents: number;
  paused: number;
  usage: CommandUsage & { eur: number | null };
  /** Hosted plans: the rate their euros are counted at (cards show their own share in euros with it); else null. */
  eurPerUsd: number | null;
  /** How the consumption is shown: euros (hosted plans), dollars, or tokens (subscriptions only, nothing billed). */
  display: "eur" | "usd" | "tokens";
  computersOn: number;
  computersMax: number;
}

export interface CommandView {
  generatedAt: number;
  windowMs: number;
  sections: { id: string; name: string; paused: boolean }[];
  cards: CommandCard[];
  links: CommandLink[];
  kpis: CommandKpis;
  /** Every bot of the caller is paused ("Tout mettre en pause"). */
  pausedAll: boolean;
}
