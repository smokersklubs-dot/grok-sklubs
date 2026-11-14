/**
 * Wire contract between the Sklubot server and web app.
 * Type-only: the web app imports this file with `import type`.
 */

export const AVATAR_SHAPES = ["pebble", "egg", "mochi", "bean", "cloud", "cat", "bear", "ghost", "circle", "squircle", "hexagon", "diamond", "shield", "drop", "arch", "star", "clover", "pill", "triangle", "octagon"] as const;
export const AVATAR_COLORS = ["ink", "clay", "ember", "amber", "moss", "teal", "sky", "indigo", "plum", "rose", "slate"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Families of tools that can be switched off for a bot. */
export const TOOL_GROUPS = ["computer", "shell", "web", "files", "memory", "routines", "tasks", "team", "apps", "vault", "images", "video", "pages", "mycomputer"] as const;
export type ToolGroup = (typeof TOOL_GROUPS)[number];
/** Who answers a message nobody is mentioned in: the first member, every member, or nobody. */
export type RoomRule = "lead" | "everyone" | "mentions";

/** How a bot's animated character looks and moves. Every field has a default; old bots get them all. */
export const EYE_STYLES = ["googly", "round", "oval", "wide", "dot", "sleepy", "visor"] as const;
export const ACCESSORIES = ["none", "antenna", "sprout", "bow", "headset", "cap", "halo"] as const;
export const IDLE_MOTIONS = ["breathe", "float", "sway", "bounce", "still"] as const;
/** mascot: a body with eyes. dots: a minimal face of a few morphing dots. muse: an abstract shape of light with a coloured halo. */
export const CHARACTER_TYPES = ["mascot", "dots", "muse"] as const;
export interface Character {
  type: (typeof CHARACTER_TYPES)[number];
  /** Any colour as #RRGGBB; when set it replaces the bot's named colour for the character. */
  customColor: string | null;
  eyes: (typeof EYE_STYLES)[number];
  mouth: boolean;
  cheeks: boolean;
  accessory: (typeof ACCESSORIES)[number];
  idle: (typeof IDLE_MOTIONS)[number];
  /** 0 = barely moves, 1 = lively. */
  intensity: number;
  /** Eyes follow the mouse pointer. */
  followCursor: boolean;
  blink: boolean;
  /** Euphoria: when the bot finds a real gem for the user it goes wild for a few seconds (rainbow, shaking, sparkles). */
  euphoria: boolean;
  /** During euphoria the bot also shouts with joy (a sound in the browser). */
  shout: boolean;
  /** How good an opportunity must be (its own score, 0-100) before the bot goes euphoric. */
  gemThreshold: number;
}
/** What kind of gem the bot found while working on the user's business. */
export const GEM_KINDS = ["lead", "seo", "data", "opportunity", "deal", "saving", "other"] as const;
export type GemKind = (typeof GEM_KINDS)[number];
export interface Gem { kind: GemKind; score: number; why: string; value: string }
/** At most this many euphorias per bot in 24 hours: gems are rare. */
export const GEMS_PER_DAY = 2;
export const DEFAULT_CHARACTER: Character = { type: "mascot", customColor: null, eyes: "googly", mouth: true, cheeks: false, accessory: "none", idle: "breathe", intensity: 0.6, followCursor: true, blink: true, euphoria: true, shout: true, gemThreshold: 85 };

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
  character: Character;
  /** Rooms only. */
  roomRule: RoomRule;
  /** Tool families this bot may not use. */
  disabledTools: ToolGroup[];
  /** Username of the Telegram bot wired to this bot, if any. */
  telegram: string | null;
  /** Shown in the pinned section at the top of the sidebar. */
  pinned: boolean;
  /** The user's own sidebar section it is filed under (null: the default "Team" list). */
  sectionId: string | null;
  /** Hidden from the sidebar by the user (still works; listed under "Hidden"). */
  listHidden: boolean;
  /**
   * Backup models for this bot, tried in order when its own model fails ("provider:model" refs). null: the account's
   * list (Settings → Models) is used.
   */
  fallbackModels: string[] | null;
  /** The bot that created this one with bot_create (null: created by the user). */
  createdBy: string | null;
  generation: number;
  unread: number;
  memberIds: string[];
  preview: string;
  lastActivityAt: number;
  createdAt: number;
}

/** A sidebar section the user created to file bots under. */
export interface BotSection { id: string; name: string; position: number; createdAt: number }

export type ActivityKind =
  | "thinking" | "writing" | "searching" | "reading" | "browsing" | "computer" | "shell"
  | "messaging" | "connector" | "waiting" | "saving" | "remembering" | "planning" | "filming";

export interface Live {
  running: boolean;
  activity: { kind: ActivityKind; detail?: string; since: number } | null;
  awaiting: { reason: string; since: number } | null;
  startedAt: number | null;
  /** Messages typed while the bot was busy, waiting to be folded into the running turn. */
  queued: number;
  /** A short line about what the bot is thinking right now (from its reasoning), while a turn runs. */
  caption?: string | null;
  /** The running turn is a thread reply: the seq of the message the thread hangs on (absent or 0: the main chat). */
  thread?: number;
  /** The user is driving this bot's screen (control mode open): the bot's own screen actions are refused meanwhile. */
  driving?: boolean;
}

export interface Origin { kind: "bot" | "routine" | "voice" | "webhook"; id: string; name: string }

/** The small set of reactions anyone (the user or a bot) can put under a message. */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🤔", "👀", "🙏", "👎"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];
/** One reaction under a message. `by`: "user", or the id of the bot that reacted (`name` is its name). */
export interface Reaction { emoji: ReactionEmoji; by: string; name: string }
/** Under a message that has a thread: how many replies it has, and when the last one came. */
export interface Replies { count: number; lastAt: number }

export type RowBody =
  | { kind: "message"; role: "user" | "assistant"; text: string; streaming?: boolean; origin?: Origin; sources?: { url: string; title?: string }[]; attachments?: Attachment[]; reactions?: Reaction[]; replies?: Replies }
  | { kind: "step"; callId: string; tool: string; label: string; status: "running" | "done" | "error" | "waiting" | "denied"; args: Record<string, unknown>; summary?: string }
  | { kind: "card"; card: Card }
  /** `relay`: something happened on one of the user's own computers (Sklubot Relais): a control session started or ended, Stop was pressed, a request was refused there. */
  /**
   * `progress`: a short interim update the bot posted during long work (progress_update); a light line, not its reply.
   * `selfupdate`: the bot changed its own settings (self_update); `undo` offers to put them back.
   */
  | { kind: "event"; event: "routine" | "task" | "bot" | "reset" | "computer" | "call" | "members" | "cheer" | "relay" | "progress" | "selfupdate"; text: string; call?: CallRecord; gem?: Gem; tone?: "info" | "warn"; undo?: { revisionId: string; status: "available" | "undone" } }
  /** `action`: a button under the notice. "continue": the bot stopped at its step limit and can pick the work back up. */
  | { kind: "notice"; tone: "info" | "warn" | "error"; text: string; action?: { kind: "continue"; status: "pending" | "done" } };

export type Card =
  /** `once`: "Always" is not offered (e.g. a command on the user's own computer after outside content); choosing it anyway counts as allowing once. */
  | { type: "approval"; approvalId: string; title: string; detail: string; tool: string; source: string; status: "pending" | "allowed" | "always" | "denied" | "expired"; once?: boolean }
  | { type: "question"; question: string; options: string[]; status: "pending" | "answered" | "dismissed"; answer?: string }
  | { type: "connect"; name: string; hint: string; reason: string; status: "pending" | "connected" | "skipped" }
  /** The bot needs the user on its screen (CAPTCHA, 2FA code, login, payment…) and waits until they hand it back, or `expiresAt`. */
  | { type: "takeover"; takeoverId: string; reason: TakeoverReason; detail: string; status: "pending" | "done" | "timeout" | "cancelled"; expiresAt: number }
  /**
   * The bot asks for a secret (an API key…) by name. The user types it into this card, which posts it straight to the
   * server: it is sealed in the vault and never shown to the model, in the chat or by any API.
   */
  | { type: "secret"; name: string; reason: string; host: string; header: string; prefix: string; status: "pending" | "saved" | "dismissed" };

/** Why a bot hands its screen to the user. */
export const TAKEOVER_REASONS = ["captcha", "2fa", "login", "payment", "other"] as const;
export type TakeoverReason = (typeof TAKEOVER_REASONS)[number];

export interface CallRecord { id: string; phase: "started" | "ended"; durationMs?: number; summary?: string; transcript?: { role: "user" | "assistant"; text: string }[] }

/** `thread`: set on a thread reply, the seq of the message (in the main chat) that the thread hangs on. */
export interface Row { botId: string; generation: number; seq: number; rev: number; createdAt: number; body: RowBody; thread?: number }

export interface Memory { id: string; botId: string; text: string; source: "chat" | "learned"; createdAt: number }
/** `shared`: every bot of the user can read and follow it (it shows in their skill index). */
export interface Skill { id: string; botId: string; name: string; description: string; body: string; shared: boolean; createdAt: number; updatedAt: number }
/** A skill a bot can use: one of its own, or one another bot of the same user shared. */
export interface SkillRef { id: string; name: string; description: string; botId: string; botName: string; own: boolean; shared: boolean }

/**
 * Facts about the user that every bot knows (injected into each bot's prompt). Edited in Settings → Profile, or by a
 * bot with profile_update (asked first once it has read outside content).
 */
export interface Profile { name: string; timezone: string; company: string; preferences: string; updatedAt: number | null }

/**
 * How turns survive a failing model. `fallbackModels`: the account's backup models, tried in order (a bot can override
 * the list). `maxRetries`: new tries of the same model on a passing error (rate limit, overload, 5xx, network) before
 * the next model. `maxContinuations`: automatic continuations of a reply cut off by the output limit.
 * `envFallbacks`: backups set by the server's admin (FALLBACK_MODELS), used when the account sets none.
 */
export interface ReliabilitySettings { fallbackModels: string[]; maxRetries: number; maxContinuations: number; envFallbacks: string[] }
export const RELIABILITY_LIMITS = { maxRetries: 6, maxContinuations: 5, fallbackModels: 5 } as const;

/** Which official API x_search uses: the X API v2 recent search (X_BEARER_TOKEN), xAI's x_search tool (XAI_API_KEY), or none. */
export type XSearchProvider = "x" | "xai" | null;
export interface Task { id: string; botId: string; title: string; state: "working" | "needs_input" | "done"; note: string; createdAt: number; updatedAt: number }

/** Routine triggers fed by a built-in app account (see NativeAccount). */
export const NATIVE_TRIGGERS = ["email", "slack", "calendar"] as const;
export type NativeTrigger = (typeof NATIVE_TRIGGERS)[number];

export interface Routine {
  id: string; botId: string; name: string; prompt: string;
  /**
   * "cron" uses `schedule` (5 fields) and `timezone`; "webhook" fires on POST to `hookUrl`; "once" fires at `runAt`; "watch" fires when `watch.target` changes.
   * "email" / "slack" / "calendar" fire once per new item of a built-in app account (see `native`).
   */
  trigger: "cron" | "webhook" | "once" | "watch" | NativeTrigger;
  watch: { kind: "url" | "file"; target: string; everyMin: number; lastCheckedAt: number | null } | null;
  /**
   * Built-in app triggers. email: a new message matching `query`; slack: a new message in `channel` ("@dm" = direct
   * messages to the app), only mentions of the app when `mentionsOnly`; calendar: an event starting in `leadMin` minutes.
   */
  native: {
    accountId: string; account: string; accountStatus: NativeAccount["status"] | "missing";
    query: string; channel: string; mentionsOnly: boolean; leadMin: number; everyMin: number; lastCheckedAt: number | null;
  } | null;
  schedule: string; timezone: string; runAt: number | null; hookUrl: string | null;
  enabled: boolean; lastRunAt: number | null; nextRunAt: number | null; describe: string; createdAt: number;
}

export interface RoutineRun { id: string; routineId: string; at: number; status: "running" | "done" | "quiet" | "error"; note: string }

/** One line of the account's activity log. Never edited or deleted. */
export interface AuditEntry { id: number; at: number; botId: string | null; kind: "tool" | "approval" | "account" | "apps" | "vault" | "routine" | "channel" | "system" | "computer"; text: string }

export interface TelegramStatus { connected: boolean; username: string | null; linked: boolean; linkCode: string | null }

/** A page a bot published at a public address. */
export interface SharedPage { token: string; botId: string; title: string; url: string; createdAt: number }

export interface SearchHit { botId: string; botName: string; generation: number; current: boolean; seq: number; at: number; role: "user" | "assistant"; snippet: string; /** A thread reply: the seq of the message the thread hangs on. */ thread?: number }

export interface MemoryStatus { lastConsolidatedAt: number | null; historyChars: number; compactAt: number; lastCompactedAt: number | null }
export interface BotBundle { memories: Memory[]; skills: Skill[]; routines: Routine[]; tasks: Task[]; memoryStatus: MemoryStatus }

/** How a connector proves who we are: nothing, a pasted access token, or an OAuth sign-in in the browser. */
export type ConnectorAuth = "none" | "token" | "oauth";
export interface Connector {
  id: string; name: string; url: string; hasToken: boolean; auth: ConnectorAuth;
  /** "needs_auth": an OAuth app that is not signed in, or whose sign-in could not be renewed. */
  status: "ready" | "error" | "connecting" | "needs_auth";
  error: string | null; tools: { name: string; description: string; readOnly: boolean }[];
  /** OAuth apps only. Tokens themselves never leave the server. */
  oauth?: { signedIn: boolean; customClient: boolean };
}
// ── Built-in apps ("native" integrations through the vendors' own REST APIs) ──────────────────────────
/** Who issues the OAuth client the user creates in their own console. */
export type NativeVendor = "google" | "microsoft" | "slack";
export type NativeAppId = "gmail" | "gcalendar" | "gdrive" | "outlook" | "slack";
/** What a built-in app offers, and how to create the OAuth client it needs (steps verified against the vendor's docs). */
export interface NativeApp {
  id: NativeAppId; vendor: NativeVendor; name: string; category: string; description: string;
  /** Exact OAuth scopes requested (Slack: bot scopes). */
  scopes: string[];
  /** What the bots can do with it, and which routine triggers it feeds. */
  capabilities: string[]; triggers: NativeTrigger[];
}
export interface NativeVendorSetup {
  vendor: NativeVendor; name: string;
  /** The redirect URI to register in the vendor's console, exactly. */
  redirectUri: string;
  /** Step-by-step instructions to create the OAuth client, in the user's language. */
  steps: string[];
  /** Official documentation the steps come from. */
  docs: { label: string; url: string }[];
  /** The client is saved (the secret itself is never sent back). */
  configured: boolean; clientId: string | null;
  /** Microsoft: the directory to sign in with ("common" by default). */
  tenant?: string;
  /** Slack: an app-level token is saved (instant triggers through Socket Mode). */
  hasAppToken?: boolean;
}
/** One signed-in account of a built-in app, e.g. "Gmail — perso". Tokens never leave the server. */
export interface NativeAccount {
  id: string; app: NativeAppId; label: string;
  /** "<App> — <label>": how bots, approvals and routines name it. */
  name: string;
  /** The address (or Slack workspace) it is signed in as, once known. */
  identity: string | null;
  /** "needs_auth": never signed in, or the sign-in could not be renewed: the user signs in again. */
  status: "ready" | "needs_auth";
  error: string | null; createdAt: number;
}

/**
 * What a vault item holds. login: a username and password typed into a site. secret: an API key or token, sent only
 * in one HTTP header to the hosts bound to it. totp: the seed of a two-factor code generator, for one site.
 */
export const VAULT_KINDS = ["login", "secret", "totp"] as const;
export type VaultKind = (typeof VAULT_KINDS)[number];
/** A vault item. The secret value itself (password, key, TOTP seed) is never sent to the browser or to a model. */
export interface VaultItem {
  id: string; kind: VaultKind; name: string;
  /** login, totp: the site it belongs to. */
  site: string; username: string;
  /** A value is saved (password, key or seed). */
  hasPassword: boolean; note: string; createdAt: number;
  /** secret: the hosts it may be sent to, the header it goes in and the text before it (e.g. "Bearer "). */
  hosts: string[]; header: string; prefix: string;
  /** totp: code length and period in seconds. */
  digits: number; period: number;
}
/** Result of a CSV import of logins. `needsMapping`: the columns were not recognised; only the header names are sent back. */
export interface VaultImportResult { imported: number; skipped: number; totp: number; needsMapping?: boolean; headers?: string[] }

// ── Push notifications (Web Push) ──────────────────────────────────────────
/** What can be pushed: a bot needs the user, a gem, a reply finished while the app was hidden, a routine's result. */
export const PUSH_KINDS = ["needs", "gem", "reply", "routine", "computer"] as const;
export type PushKind = (typeof PUSH_KINDS)[number];
/** One browser or phone that receives push notifications. Its keys never leave the server. */
export interface PushDevice { id: string; label: string; enabled: boolean; createdAt: number; lastOkAt: number | null; failures: number }
export interface PushSettings {
  kinds: Record<PushKind, boolean>;
  /** Nothing is pushed between `start` and `end` (HH:MM, local time in `timezone`); the window may span midnight. */
  quiet: { enabled: boolean; start: string; end: string; timezone: string };
}
/** `publicKey`: the server's VAPID key (base64url, uncompressed P-256 point) to subscribe with. */
export interface PushState { publicKey: string; devices: PushDevice[]; settings: PushSettings }

/** A well-known app that can be added as a connector in one step. */
export interface CatalogApp {
  id: string; name: string; category: string; description: string; url: string;
  /** "token": the user pastes an access token. "none": no credential needed. "oauth": the user signs in on the app's own page. */
  auth: ConnectorAuth;
  /** Set for a built-in app: it is connected through Settings → Apps → Built-in apps, not as a tool server. */
  native?: NativeAppId;
  /** OAuth apps: "dynamic" = Sklubot registers itself; "manual" = the user creates an app/connector there and pastes its client ID (and secret). */
  oauthClient?: "dynamic" | "manual";
  /** Where to get the token (or the client ID), in plain words. */
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
/**
 * "api": billed per token through an API key on the server.
 * "subscription": runs through the official command-line tool of the provider inside the bot's own
 * computer, signed in with the user's personal subscription (Claude Pro/Max, ChatGPT Plus/Pro).
 */
export interface ModelOption { ref: string; provider: string; model: string; kind: "api" | "subscription"; engine?: Engine }
export type Engine = "claude-code" | "codex";
export interface EngineStatus {
  engine: Engine;
  /** The tool is present on the bot's computer. */
  installed: boolean;
  /** Signed in with a subscription on this bot's computer. null = could not be checked (computer off). */
  signedIn: boolean | null;
  /** Account shown by the tool when it says so (e.g. an e-mail or plan), else null. */
  account: string | null;
  detail: string | null;
}
export interface SubscriptionUsage { engine: Engine; fiveHour: number | null; sevenDay: number | null; resetsAt: number | null; at: number }
export interface UsageSummary {
  month: string;
  totals: { inputTokens: number; outputTokens: number; turns: number; costUsd: number };
  byBot: { botId: string; name: string; inputTokens: number; outputTokens: number; turns: number; costUsd: number }[];
  budgetUsd: number | null;
  /** Latest known use of the subscription windows (fractions 0–1), per engine. */
  subscriptions: SubscriptionUsage[];
  /** True once this month's spend has passed 80% of the budget. */
  nearBudget: boolean;
}

/** How bots can make videos on this server: through the user's Higgsfield app, a video API, both or neither. */
export interface VideoStatus { provider: "xai" | "gemini" | "demo" | null; higgsfield: boolean }

/** A step-by-step skill the bot wrote from a demonstration, waiting for the user to check it. */
export interface SkillDraft { name: string; when: string; steps: string }
/**
 * A demonstration the user is recording on a bot's screen ("Show me how"), then the skill drafted from it.
 * Only counts and special keys are kept from the keyboard, never what was typed.
 */
export interface Recording {
  id: string; botId: string; startedAt: number; stoppedAt: number | null;
  status: "recording" | "processing" | "review" | "error";
  /** Screenshots and input events captured so far. */
  frames: number; events: number;
  /** Longest a recording may run, in ms (10 minutes). */
  maxMs: number;
  error: string | null;
  draft: SkillDraft | null;
}

// ── Sklubot Relais: the user's own computers (docs/RELAIS-PROTOCOLE.md) ─────────────
/**
 * One of the user's own computers, linked through the Sklubot Relais app. The device token is stored only as a hash
 * and never leaves the server. Live fields (status, locked, session, asking, screen) come from its open connection.
 */
export interface RelayDevice {
  id: string; name: string;
  /** From the relay's hello: "darwin" | "win32" | "linux"…, the CPU, the OS release and the relay's version. */
  platform: string; arch: string; osRelease: string; appVersion: string;
  /** "paused": the user paused the relay on that computer (it said bye); "offline": no connection. */
  status: "online" | "offline" | "paused";
  /** The user pressed Stop on the computer: everything is refused until they re-allow control there. */
  locked: boolean;
  /** The bot that has the control session on that computer, if any. */
  session: { botId: string; botName: string; grant: "once" | "always" | "test"; since: number } | null;
  /** A consent question is open on the computer right now. */
  asking: { botId: string; botName: string; kind: "session" | "command"; since: number } | null;
  /** Main screen size in logical points, from the hello. */
  screen: { width: number; height: number } | null;
  capabilities: string[];
  createdAt: number; lastSeenAt: number | null;
}
/** Where to get the relay app: built files served by this server under /download/, else the project's releases page. */
export interface RelayDownloads { files: { name: string; url: string; platform: "windows" | "mac" | "linux"; size: number }[]; releasesUrl: string }

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
  /** Built-in app accounts or their OAuth clients changed. */
  | { type: "native" }
  | { type: "usage" }
  | { type: "pages" }
  /** The bot found a gem for the user (celebrate tool): play its euphoria now. */
  | { type: "cheer"; botId: string; reason: string; gem?: Gem }
  /** A demonstration on a bot's screen started, moved on, or ended (null: nothing recorded any more). */
  | { type: "recording"; botId: string; recording: Recording | null }
  /** The user's sidebar sections changed. */
  | { type: "sections" }
  /** Vault items changed (a secret saved from a card, an import…). */
  | { type: "vault" }
  /** The user's linked computers or their live state changed (connection, session, Stop, a question on screen). */
  | { type: "relay"; devices: RelayDevice[] }
  /** The shared profile changed (from Settings or a bot's profile_update). */
  | { type: "profile" };
