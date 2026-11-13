/**
 * Wire contract between the Sklubot server and web app.
 * Type-only: the web app imports this file with `import type`.
 */

export const AVATAR_SHAPES = ["circle", "squircle", "hexagon", "diamond", "shield", "drop", "arch", "star", "clover", "pill", "triangle", "octagon"] as const;
export const AVATAR_COLORS = ["ink", "clay", "ember", "amber", "moss", "teal", "sky", "indigo", "plum", "rose", "slate"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

export type Effort = "low" | "medium" | "high" | "xhigh";
export type BotMode = "personal" | "teammate";
/** How a bot handles actions that change things: ask every time, ask only for connector writes, or never ask. */
export type Autonomy = "careful" | "balanced" | "trusted";

export interface User { id: string; email: string; name: string }

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
  | { kind: "message"; role: "user" | "assistant"; text: string; streaming?: boolean; origin?: Origin; sources?: { url: string; title?: string }[] }
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
  /** "cron" uses `schedule` (5 fields) and `timezone`; "webhook" fires on POST to `hookUrl`; "once" fires at `runAt`. */
  trigger: "cron" | "webhook" | "once";
  schedule: string; timezone: string; runAt: number | null; hookUrl: string | null;
  enabled: boolean; lastRunAt: number | null; nextRunAt: number | null; describe: string; createdAt: number;
}

export interface MemoryStatus { lastConsolidatedAt: number | null; historyChars: number; compactAt: number; lastCompactedAt: number | null }
export interface BotBundle { memories: Memory[]; skills: Skill[]; routines: Routine[]; tasks: Task[]; memoryStatus: MemoryStatus }

export interface Connector {
  id: string; name: string; url: string; hasToken: boolean;
  status: "ready" | "error" | "connecting";
  error: string | null; tools: { name: string; description: string; readOnly: boolean }[];
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
  | { type: "usage" };
