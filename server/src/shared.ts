/**
 * Wire contract between the Sklubot server and web app.
 * Type-only: the web app imports this file with `import type`.
 */

export const AVATAR_SHAPES = ["circle", "squircle", "hexagon", "diamond", "shield", "drop", "arch", "star", "clover", "pill", "triangle", "octagon"] as const;
export const AVATAR_COLORS = ["ink", "clay", "ember", "amber", "moss", "teal", "sky", "indigo", "plum", "rose", "slate"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Families of tools that can be switched off for a bot. */
export const TOOL_GROUPS = ["computer", "shell", "web", "files", "memory", "routines", "tasks", "team", "apps", "vault", "images", "pages"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];
/** Who answers a message nobody is mentioned in: the first member, every member, or nobody. */
export type RoomRule = "lead" | "everyone" | "mentions";

export type Effort = "low" | "medium" | "high" | "xhigh";
export type BotMode = "personal" | "teammate";
/** How a bot handles actions that change things: ask every time, ask only for connector writes, or never ask. */
export type Autonomy = "careful" | "balanced" | "trusted";

export type Locale = "fr" | "en";
export interface User { id: string; email: string; name: string; locale: Locale }

/** A file shown in the chat. `path` is relative to the bot's library; fetch it with GET /bots/:id/files/view?path=. */
export interface Attachment { name: string; path: string; mime: string; size: number }

export interface Bot {
  id: string;
  kind: "agent" | "room";
  name: string;
  label: string;
  description: string;
  instructions: string;
  shape: AvatarShape;
  color: AvatarColor;
  mode: BotMode;
  primary: boolean;
  effort: Effort;
  /** "provider:model" or "" for the server default. */
  model: string;
  autonomy: Autonomy;
  voice: { name: string; rate: number; lang: string };
  /** Rooms only. */
  roomRule: RoomRule;
  /** Tool families this bot may not use. */
  disabledTools: ToolGroup[];
  /** Username of the Telegram bot wired to this bot, if any. */
  telegram: string | null;
  generation: number;
  unread: number;
  memberIds: string[];
  preview: string;
  lastActivityAt: number;
  createdAt: number;
}

export type ActivityKind =
  | "thinking" | "writing" | "searching" | "reading" | "browsing" | "computer" | "shell"
  | "messaging" | "connector" | "waiting" | "saving" | "remembering" | "planning";

export interface Live {
  running: boolean;
  activity: { kind: ActivityKind; detail?: string; since: number } | null;
  awaiting: { reason: string; since: number } | null;
  startedAt: number | null;
  /** Messages typed while the bot was busy, waiting to be folded into the running turn. */
  queued: number;
}

export interface Origin { kind: "bot" | "routine" | "voice" | "webhook"; id: string; name: string }

export type RowBody =
  | { kind: "message"; role: "user" | "assistant"; text: string; streaming?: boolean; origin?: Origin; sources?: { url: string; title?: string }[]; attachments?: Attachment[] }
  | { kind: "step"; callId: string; tool: string; label: string; status: "running" | "done" | "error" | "waiting" | "denied"; args: Record<string, unknown>; summary?: string }
  | { kind: "card"; card: Card }
  | { kind: "event"; event: "routine" | "task" | "bot" | "reset" | "computer" | "call" | "members"; text: string; call?: CallRecord }
  | { kind: "notice"; tone: "info" | "warn" | "error"; text: string };

export type Card =
  | { type: "approval"; approvalId: string; title: string; detail: string; tool: string; source: string; status: "pending" | "allowed" | "always" | "denied" | "expired" }
  | { type: "question"; question: string; options: string[]; status: "pending" | "answered" | "dismissed"; answer?: string }
  | { type: "connect"; name: string; hint: string; reason: string; status: "pending" | "connected" | "skipped" };

export interface CallRecord { id: string; phase: "started" | "ended"; durationMs?: number; summary?: string; transcript?: { role: "user" | "assistant"; text: string }[] }

export interface Row { botId: string; generation: number; seq: number; rev: number; createdAt: number; body: RowBody }

export interface Memory { id: string; botId: string; text: string; source: "chat" | "learned"; createdAt: number }
export interface Skill { id: string; botId: string; name: string; description: string; body: string; createdAt: number; updatedAt: number }
export interface Task { id: string; botId: string; title: string; state: "working" | "needs_input" | "done"; note: string; createdAt: number; updatedAt: number }

export interface Routine {
  id: string; botId: string; name: string; prompt: string;
  /** "cron" uses `schedule` (5 fields) and `timezone`; "webhook" fires on POST to `hookUrl`; "once" fires at `runAt`; "watch" fires when `watch.target` changes. */
  trigger: "cron" | "webhook" | "once" | "watch";
  watch: { kind: "url" | "file"; target: string; everyMin: number; lastCheckedAt: number | null } | null;
  schedule: string; timezone: string; runAt: number | null; hookUrl: string | null;
  enabled: boolean; lastRunAt: number | null; nextRunAt: number | null; describe: string; createdAt: number;
}

export interface RoutineRun { id: string; routineId: string; at: number; status: "running" | "done" | "quiet" | "error"; note: string }

/** One line of the account's activity log. Never edited or deleted. */
export interface AuditEntry { id: number; at: number; botId: string | null; kind: "tool" | "approval" | "account" | "apps" | "vault" | "routine" | "channel" | "system"; text: string }

export interface TelegramStatus { connected: boolean; username: string | null; linked: boolean; linkCode: string | null }

/** A page a bot published at a public address. */
export interface SharedPage { token: string; botId: string; title: string; url: string; createdAt: number }

export interface SearchHit { botId: string; botName: string; generation: number; current: boolean; seq: number; at: number; role: "user" | "assistant"; snippet: string }

export interface MemoryStatus { lastConsolidatedAt: number | null; historyChars: number; compactAt: number; lastCompactedAt: number | null }
export interface BotBundle { memories: Memory[]; skills: Skill[]; routines: Routine[]; tasks: Task[]; memoryStatus: MemoryStatus }

export interface Connector {
  id: string; name: string; url: string; hasToken: boolean;
  status: "ready" | "error" | "connecting";
  error: string | null; tools: { name: string; description: string; readOnly: boolean }[];
}
/** A saved login. The password itself is never sent to the browser or to a model. */
export interface VaultItem { id: string; name: string; site: string; username: string; hasPassword: boolean; note: string; createdAt: number }

/** A well-known app that can be added as a connector in one step. */
export interface CatalogApp {
  id: string; name: string; category: string; description: string; url: string;
  /** "token": the user pastes an access token. "none": no credential needed. */
  auth: "token" | "none";
  /** Where to get the token, in plain words. */
  tokenHelp: string;
}

export interface Policy { tool: string; mode: "always_allow" | "needs_approval" | "blocked" }

export interface FileEntry { name: string; size: number; modifiedAt: number; dir: boolean }
export interface ComputerState {
  /** "linux": each bot has its own Linux computer. "browser": each bot has a browser on the server. "none": neither is installed. */
  kind: "linux" | "browser" | "none";
  /** Whether bots have a screen at all (kind is not "none"). */
  browser: boolean;
  /** `open` = switched on. Linux computers that exist but are asleep are listed with open: false. */
  desktops: { botId: string; open: boolean; url: string | null; lastUsedAt: number }[];
  maxDesktops: number;
}

export interface CheckinSettings { enabled: boolean; times: string[]; timezone: string }
export interface ModelOption { ref: string; provider: string; model: string }
export interface UsageSummary {
  month: string;
  totals: { inputTokens: number; outputTokens: number; turns: number; costUsd: number };
  byBot: { botId: string; name: string; inputTokens: number; outputTokens: number; turns: number; costUsd: number }[];
  budgetUsd: number | null;
  /** True once this month's spend has passed 80% of the budget. */
  nearBudget: boolean;
}

/** Server → browser events on GET /api/events (one JSON object per SSE message). */
export type ServerEvent =
  | { type: "hello"; now: number }
  | { type: "ping" }
  | { type: "rows"; botId: string; generation: number; rows: Row[] }
  | { type: "reset"; botId: string; generation: number }
  | { type: "live"; botId: string; live: Live }
  | { type: "roster" }
  | { type: "bot"; bot: Bot }
  | { type: "computer"; computer: ComputerState }
  | { type: "routines"; botId: string }
  | { type: "tasks"; botId: string }
  | { type: "memories"; botId: string }
  | { type: "connectors" }
  | { type: "usage" }
  | { type: "pages" };
