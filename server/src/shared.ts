/**
 * Wire contract between the Sklubot server and web app.
 * Type-only: the web app imports this file with `import type`.
 */
import type { TodayKind } from "./todayminutes.js";

export const AVATAR_SHAPES = ["pebble", "egg", "mochi", "bean", "cloud", "cat", "bear", "ghost", "circle", "squircle", "hexagon", "diamond", "shield", "drop", "arch", "star", "clover", "pill", "triangle", "octagon"] as const;
export const AVATAR_COLORS = ["ink", "clay", "ember", "amber", "moss", "teal", "sky", "indigo", "plum", "rose", "slate"] as const;
export type AvatarShape = (typeof AVATAR_SHAPES)[number];
export type AvatarColor = (typeof AVATAR_COLORS)[number];

/** Families of tools that can be switched off for a bot. */
export const TOOL_GROUPS = ["computer", "shell", "web", "files", "memory", "routines", "tasks", "team", "apps", "vault", "images", "video", "pages", "mycomputer", "reach"] as const;
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
/**
 * How a bot handles actions that change things: ask every time, ask only for connector writes, or never ask.
 * "auto" (wave 5): a reviewer model checks each sensitive action against the user's rules, their own words and whether
 * outside content was read, and answers allow / ask / deny (see server/src/agent/authorize.ts). Some actions always ask.
 */
export type Autonomy = "careful" | "balanced" | "trusted" | "auto";
export const AUTONOMIES = ["careful", "balanced", "trusted", "auto"] as const;

/**
 * Why a state-changing action ran without a card (or with one): "words" — the bot cited the user's own words and the
 * server found them in a message of this conversation, within scope; "reviewer" — the automatic reviewer allowed it
 * ("auto" mode); "approval" — the user said yes on a card; "retry" — the user asked to retry an action whose outcome
 * was uncertain. `quote`: the user's exact words; `reason`: the reviewer's or the server's short reason.
 */
export interface Grant { by: "words" | "reviewer" | "approval" | "retry"; quote?: string; reason?: string }

/**
 * A rule in the user's own words ("ne jamais envoyer d'e-mail à un client sans me demander"). `botId` null: every bot.
 * Wave 5b: `routineId` — only for turns started by that routine; `trigger` — only for turns started by a routine of that
 * kind ("email": when an email arrives…). `source` "chat": added from the chat (rule_propose, approved on a card), with
 * the user's words that asked for it in `quote`.
 */
export interface Rule { id: string; botId: string | null; text: string; enabled: boolean; createdAt: number; routineId: string | null; trigger: RuleTrigger | null; source: "user" | "chat"; quote: string }
export const RULE_TRIGGERS = ["cron", "once", "webhook", "watch", "email", "slack", "calendar", "botmail"] as const;
export type RuleTrigger = (typeof RULE_TRIGGERS)[number];
/** A change a bot made to the rules from the chat (approved by the user), undoable in one click. */
export interface RuleChange { id: string; action: "add" | "change" | "remove"; ruleId: string; botId: string | null; text: string; before: string | null; quote: string; createdAt: number; undoneAt: number | null }
/** Rules and the automatic reviewer. `reviewerModel`: "provider:model", "" = AUX_MODEL, else the bot's own model. */
export interface RulesState { rules: Rule[]; reviewerModel: string; auxModel: string; changes: RuleChange[] }

/** Topics never learned into memory unless the user turns them on (or explicitly asks to remember one thing). */
export const SENSITIVE_CATEGORIES = ["health", "religion", "politics", "sexuality", "origin", "location", "financial", "legal"] as const;
export type SensitiveCategory = (typeof SENSITIVE_CATEGORIES)[number];
/**
 * Account memory settings. `autoCapture`: notes learned from the user's own messages. `allowSensitive`: categories the
 * user agreed to have learned. `style`: the writing-style profile learned (opt-in) from the user's sent messages.
 */
export interface MemorySettings {
  autoCapture: boolean;
  allowSensitive: Record<SensitiveCategory, boolean>;
  style: { enabled: boolean; profile: string; updatedAt: number | null; source: "mail" | "chat" | null; samples: number };
}

/** Proactive nudges of one bot: a quiet read-only preparation pass that may raise at most `perDay` nudges a day. */
export interface NudgeSettings { enabled: boolean; perDay: number; budgetUsd: number; everyMin: number }
export const DEFAULT_NUDGES: NudgeSettings = { enabled: false, perDay: 3, budgetUsd: 0.2, everyMin: 60 };

/** A background task a bot started from the chat (task_start). It runs in its own hidden helper. */
export type BgTaskState = "running" | "waiting" | "done" | "failed" | "stopped";
export interface BgTask { id: string; botId: string; title: string; state: BgTaskState; steps: number; result: string; createdAt: number; updatedAt: number }

// ── Wave 5b ─────────────────────────────────────────────────────────────────
/** Account spend settings (spec 07 A5): the default checkpoint in USD for every bot (0: off). */
export interface SpendSettings { checkpointUsd: number }
export const DEFAULT_SPEND_CHECKPOINT_USD = 5;
/** Where a spend checkpoint stopped: a chat (or thread) turn, a background task, a routine run. */
export type SpendScope = "chat" | "task" | "routine";

/** A built-in task guide (spec 07 A10): a short procedure we wrote, read by the bot only when the job matches. */
export interface Guide { id: string; name: string; description: string }

/** One endpoint of an API connector the bot proposed and the user approved (spec 07 A16). `path` may hold {placeholders}. */
export interface ApiEndpoint { method: "GET" | "POST" | "PUT" | "PATCH" | "DELETE"; path: string; description: string }
/**
 * An HTTP API connector created on demand. `secret`: the vault secret (sent only to `host`, in its own header) the
 * server adds to every call; the bot never sees it. "pending": proposed, waiting for the user's review.
 */
export interface ApiConnector { id: string; name: string; baseUrl: string; host: string; secret: string; endpoints: ApiEndpoint[]; status: "pending" | "active"; createdAt: number }

/**
 * One line of the detailed usage journal (spec 07 A14): every tool call a bot made, with what allowed it.
 * `decision`: "words" (the user's quote checked out), "reviewer", "approval" (a card), "retry" (single-use grant),
 * "policy" (an "always" rule, a trusted bot), "free" (a read or a harmless step), "denied" (refused or blocked).
 * `costUsd`: the model spend since the bot's previous action (the call that led to this one). `origin`: what started
 * the turn (user, routine, bot, system, nudge, resume).
 */
export interface JournalEntry {
  id: number; at: number; botId: string; botName: string; tool: string; label: string;
  decision: "words" | "reviewer" | "approval" | "retry" | "policy" | "free" | "denied";
  quote: string; reason: string; status: "done" | "failed" | "uncertain" | "denied"; costUsd: number; origin: string;
}

/** A payment a bot made with a vault card (spec 07 A12). "filled": the card was typed on the page, which is not proof of payment. */
export interface Payment { id: string; botId: string; cardId: string; cardName: string; amount: number; currency: string; merchant: string; host: string; status: "approved" | "filled" | "submitted" | "failed" | "uncertain"; createdAt: number }

/** A first task the user could give a bot (spec 07 A19). */
export interface TaskIdea { title: string; prompt: string; kind: "once" | "recurring"; why: string }

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
   * "Pause": set while the owner paused this bot, its section, or every bot of the account (null: not paused). A paused bot
   * runs nothing: what comes for it waits in its queue (or is skipped, for routines) until it is resumed.
   */
  pause: BotPause | null;
  /**
   * Backup models for this bot, tried in order when its own model fails ("provider:model" refs). null: the account's
   * list (Settings → Models) is used.
   */
  fallbackModels: string[] | null;
  /** Proactive nudges (wave 5): off by default. */
  nudges: NudgeSettings;
  /**
   * Spend checkpoint of this bot (wave 5b, spec 07 A5), in USD: once a task (a chat turn and what follows it, a
   * background task, a routine run) has spent this much since the user last spoke to it, it stops before its next step
   * and asks. null: the account's setting (Settings → Usage). 0: never stops.
   */
  spendCheckpointUsd: number | null;
  /** The bot that created this one with bot_create (null: created by the user). */
  createdBy: string | null;
  /**
   * Wave 7 (spec 08 A1): programs on this bot's Linux computer may call APIs with the user's vault secrets through
   * Sklubot's credential relay (the key is added outside the computer and never enters it). Off by default.
   */
  relayEnabled: boolean;
  /**
   * Part B: "own" — the bot has a Linux computer of its own (the default); "shared" — it works on one of its account's
   * shared computers (files, browser and sign-ins shared with the other bots set to "shared"), one bot at a time.
   */
  computerMode: "own" | "shared";
  /** Wave 7 (spec 08 A4): daily cap in USD on paid third-party tools for this bot (null: none; the monthly budget still applies). */
  thirdPartyDailyCapUsd: number | null;
  /**
   * Wave 6. Set only for a bot someone else owns and shares with you through a workspace: who owns it and what your role
   * lets you do with it. Absent for your own bots (personal mode is unchanged).
   */
  access?: SharedAccess;
  /** Wave 6: the workspace this bot (one of yours) is shared to, if any. */
  sharing?: BotShare | null;
  generation: number;
  unread: number;
  memberIds: string[];
  preview: string;
  lastActivityAt: number;
  createdAt: number;
}

/** A sidebar section the user created to file bots under. `paused`: the owner paused the whole section (pauses.ts). */
export interface BotSection { id: string; name: string; position: number; createdAt: number; paused: boolean }

/**
 * Why a bot is paused (pauses.ts). `by`: the widest pause that holds it — "all" (every bot of the account), "section"
 * (its sidebar section, `sectionId`) or "bot" (itself; for a helper, the bot it works for). `self`: the bot is also paused
 * on its own (resuming its section or everything leaves it paused). `since`: when the pause in `by` was set.
 * `queued`: work waiting for it, run in order when it is resumed.
 */
export interface BotPause { by: "bot" | "section" | "all"; self: boolean; sectionId: string | null; since: number; queued: number }

/** GET /pauses: what the owner paused. */
export interface PauseState { all: { since: number } | null; sections: { id: string; since: number }[]; bots: { id: string; since: number }[] }
/** POST pause / resume answers: the new state, how many running turns were stopped, how many queued jobs were let go. */
export interface PauseResult { state: PauseState; stopped: number; released: number }

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
  /**
   * Tool calls announced since the running turn started (progress lines included; the engine's own tool-finding calls
   * do not count). Reset to 0 at the start of each turn; updated on each new call, even while the bot waits for the user.
   */
  steps?: number;
}

/** `nudge`: the user pressed "Do it" on a nudge (the words come from a preparation pass, so they never authorise anything). */
/**
 * `member` (wave 6): a person of a workspace the bot is shared with wrote it (`id`: their user id). Their words are never
 * the owner's: they do not authorise actions (grounding ignores them) and the turn they start is careful from its first
 * step. `email`: a mail received at the bot's own address (outside content).
 */
/** `api`: sent by an outside program through one of the owner's Bot API keys (botapi.ts): `id` is the key's id, `name` its name. */
export interface Origin { kind: "bot" | "routine" | "voice" | "webhook" | "nudge" | "member" | "email" | "api"; id: string; name: string }

/**
 * Bot API (botapi.ts, docs/API-BOT.md): what a key may do. `read`: the bot's info and its conversation (messages and
 * replies only). `write`: send it a message. `tasks`: give it a goal (goal mode). No scope reaches approvals, deletion,
 * settings, the vault, connectors or another bot.
 */
export const BOT_API_SCOPES = ["read", "write", "tasks"] as const;
export type BotApiScope = (typeof BOT_API_SCOPES)[number];
/** A key as its owner sees it in the bot's settings: never the key itself (shown once, at creation), only its start. */
export interface BotApiKeyView { id: string; name: string; prefix: string; scopes: BotApiScope[]; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }
/** Bot API settings of one bot: its keys, the most it may have, and the addresses to call. */
export interface BotApiKeysView { keys: BotApiKeyView[]; max: number; baseUrl: string; mcpUrl: string }

/** The small set of reactions anyone (the user or a bot) can put under a message. */
export const REACTIONS = ["👍", "❤️", "😂", "🎉", "🤔", "👀", "🙏", "👎"] as const;
export type ReactionEmoji = (typeof REACTIONS)[number];
/** One reaction under a message. `by`: "user", or the id of the bot that reacted (`name` is its name). */
export interface Reaction { emoji: ReactionEmoji; by: string; name: string }
/** Under a message that has a thread: how many replies it has, and when the last one came. */
export interface Replies { count: number; lastAt: number }

export type RowBody =
  | { kind: "message"; role: "user" | "assistant"; text: string; streaming?: boolean; origin?: Origin; sources?: { url: string; title?: string }[]; attachments?: Attachment[]; reactions?: Reaction[]; replies?: Replies }
  /** `grant`: what allowed this state-changing action (the user's quote, the reviewer's reason, a card). */
  | { kind: "step"; callId: string; tool: string; label: string; status: "running" | "done" | "error" | "waiting" | "denied"; args: Record<string, unknown>; summary?: string; grant?: Grant }
  | { kind: "card"; card: Card }
  /** `relay`: something happened on one of the user's own computers (Sklubot Relais): a control session started or ended, Stop was pressed, a request was refused there. */
  /**
   * `progress`: a short interim update the bot posted during long work (progress_update); a light line, not its reply.
   * `selfupdate`: the bot changed its own settings (self_update); `undo` offers to put them back.
   */
  | { kind: "event"; event: "routine" | "task" | "bot" | "reset" | "computer" | "call" | "members" | "cheer" | "relay" | "progress" | "selfupdate"; text: string; call?: CallRecord; gem?: Gem; tone?: "info" | "warn"; undo?: { revisionId: string; status: "available" | "undone" } }
  /**
   * `action`: a button under the notice. "continue": the bot stopped at its step limit — or, `reason: "timeout"`, a turn on
   * a subscription tool reached its time limit; `reason: "busy"`, its computer could not start, every one being busy — and can
   * pick the work back up; `reason: "gone"`, the subscription tool's process ended without finishing the turn.
   * "watch": the turn watch (agent/watch.ts), see WatchNoticeAction.
   */
  | { kind: "notice"; tone: "info" | "warn" | "error"; text: string; action?: { kind: "continue"; status: "pending" | "done"; reason?: "timeout" | "busy" | "gone" } | { kind: "settings"; section: string } | HostedNoticeAction | WatchNoticeAction };

/**
 * The turn watch's notice (agent/watch.ts), at most one of each per turn. `watch`: "silent" — the AI has sent nothing yet
 * (first-reply rescue: "Wait", "Switch AI for this message" when `next` is set, "Check the Claude / ChatGPT connection"
 * when `engine` is set); "stalled" — no progress for `minutes` ("Keep waiting", "Stop and resume").
 * `status`: "pending" (the buttons are live), "waiting" (the user chose to wait), "switched" (the message went to `next`),
 * "stopped" (stopped, and a continuation queued), "settled" (the work moved again), "over" (the turn ended meanwhile).
 * `next`: the label of the next model of the bot's fallback chain. `engine`: the turn runs on a subscription tool.
 */
export interface WatchNoticeAction { kind: "watch"; watch: "silent" | "stalled"; status: "pending" | "waiting" | "switched" | "stopped" | "settled" | "over"; minutes?: number; next?: string; engine?: Engine }

/**
 * Hosted mode: the way forward under a notice that stopped work because of the account's plan (hosted.ts). "budget": the
 * month's AI budget on the service's keys is used up (top up, use one's own key, or wait until `resetAt`); "suspended":
 * the account is suspended; "byok": the plan uses the customer's own keys only; "engines": a Claude / ChatGPT
 * subscription bot that this person may not run; "limit": a plan limit (`limit` says which); "payment": the trial or the
 * paid period is over (grace period before suspension).
 */
export interface HostedNoticeAction { kind: "plan"; reason: HostedStopReason; limit?: PlanLimitKind; resetAt?: number; contactUrl?: string }

/** One file a turn changed (see the "files" card). */
export interface FileChange { path: string; change: "added" | "modified" | "deleted"; added: number | null; removed: number | null; binary: boolean; oldSize: number | null; newSize: number | null }

export type Card =
  /** `once`: "Always" is not offered (e.g. a command on the user's own computer after outside content); choosing it anyway counts as allowing once. */
  /**
   * `why`: why the server asks instead of going ahead (no quote of the user's words, a quote not found, out of scope,
   * the reviewer's reason, an action that always asks). `quote`: the words the bot cited, when it cited any.
   * `outcome`: once allowed, what became of the single execution this approval is bound to.
   * `irreversible`: the action cannot be undone once it runs (a message sent, a payment, a deletion, a page published, a
   * form confirmed…), as the server decided from the tool and its arguments (agent/irreversible.ts); `irreversibleReason`
   * says why, in the user's language. Such a card is always `once`: "Always" is never offered for it.
   */
  | { type: "approval"; approvalId: string; title: string; detail: string; tool: string; source: string; status: "pending" | "allowed" | "always" | "denied" | "expired"; once?: boolean; why?: string; quote?: string; outcome?: "done" | "failed" | "uncertain"; irreversible?: boolean; irreversibleReason?: string }
  /**
   * An action whose outcome is unknown (the server stopped, or the call timed out, while it ran). It is never replayed on
   * its own: the user says it went through, asks the bot to check, or retries it once.
   */
  | { type: "uncertain"; executionId: string; title: string; detail: string; status: "pending" | "done" | "checking" | "retried" | "dismissed" }
  /**
   * A background task (task_start). `helperId`: the hidden helper doing the work (its live state gives the step counter).
   * `question`: what it asks the user while waiting; `approval`: an approval it waits on, answered from this card.
   */
  | { type: "task"; taskId: string; helperId: string; title: string; state: BgTaskState; steps: number; now?: string; result?: string; question?: string; approval?: { approvalId: string; title: string; detail: string; /** Why the action it waits on cannot be undone (see the approval card). */ irreversible?: string } }
  /** A nudge from a quiet preparation pass: "Do it", "Later" (snoozed) or "Never for this" (the matter never comes back). */
  | { type: "nudge"; nudgeId: string; title: string; body: string; status: "pending" | "doing" | "later" | "never" }
  | { type: "question"; question: string; options: string[]; status: "pending" | "answered" | "dismissed"; answer?: string }
  | { type: "connect"; name: string; hint: string; reason: string; status: "pending" | "connected" | "skipped" }
  /** The bot needs the user on its screen (CAPTCHA, 2FA code, login, payment…) and waits until they hand it back, or `expiresAt`. */
  | { type: "takeover"; takeoverId: string; reason: TakeoverReason; detail: string; status: "pending" | "done" | "timeout" | "cancelled"; expiresAt: number }
  /**
   * The bot asks for a secret (an API key…) by name. The user types it into this card, which posts it straight to the
   * server: it is sealed in the vault and never shown to the model, in the chat or by any API.
   */
  | { type: "secret"; name: string; reason: string; host: string; header: string; prefix: string; status: "pending" | "saved" | "dismissed" }
  /**
   * A spend checkpoint (wave 5b): the task spent `spentUsd` since the user last spoke to it, past `thresholdUsd`. It
   * stopped before its next step (nothing done is lost): "continue" (up to the next checkpoint), "raise" (doubles the
   * checkpoint for this task, then continues) or "stop". `title`: what the task is.
   */
  | { type: "spend"; checkpointId: string; title: string; scope: SpendScope; spentUsd: number; thresholdUsd: number; status: "pending" | "continued" | "raised" | "stopped" }
  /**
   * A procedure the bot learned from a task it just did (skill_propose), anonymised, for the user to review before it
   * is saved. `outside`: the task read outside content, so the skill is kept as outside content (it never authorises).
   */
  | { type: "skill"; name: string; when: string; steps: string; outside: boolean; status: "pending" | "saved" | "dismissed" }
  /** An API connector the bot proposed (api_connector_propose): the user reviews it, gives the token if needed, and approves. */
  /** The user said something that contradicts a note (wave 5b): which is right? "old" keeps the note, "new" replaces it. */
  | { type: "memory"; memoryId: string; oldText: string; newText: string; quote: string; status: "pending" | "kept" | "replaced" }
  /** Wave 6: a mail received at the bot's own address. `held`: kept out of the bot's reach (sender not allowed, failed DMARC, spam). */
  | { type: "mail"; mailId: string; from: string; subject: string; snippet: string; auth: MailAuth; spam: number; status: "delivered" | "held" | "released" | "replied" }
  | { type: "apiconnector"; connectorId: string; name: string; baseUrl: string; host: string; secret: string; secretSaved: boolean; endpoints: ApiEndpoint[]; status: "pending" | "approved" | "dismissed" }
  /**
   * Wave 8: the disk of the bot's computer is nearly full (`usedPct` of the disk its home folder is on). `items`: the
   * biggest files and folders of its own home (/root) and library (/root/files), largest first. The user ticks some and
   * confirms; only listed paths can be deleted, nothing is ever deleted on its own. `deleted` / `freedBytes`: what was.
   */
  /**
   * The user pasted something that looks like a secret in a message: it was masked ("[secret masqué]") before the
   * message was stored or sent to any model, and is held in the server's memory only until `expiresAt`. The user saves
   * it to the vault (as a secret for `host`) or discards it. `hint`: a well-known format prefix ("sk-", "ghp_"…), never
   * any of the value itself; `length`: its length. `name`, `host`: suggested, then what it was saved as.
   */
  | { type: "pastedsecret"; pendingId: string; kind: "key" | "token" | "password" | "private-key"; hint: string; length: number; name: string; host: string; status: "pending" | "saved" | "discarded" | "expired"; expiresAt: number }
  /**
   * "Fichiers modifiés" (snapshots.ts): the files a turn changed in the bot's home folder (/root), as paths relative to
   * it, with lines added and removed (null for a binary file) and sizes in bytes. `more`: changed files not listed.
   * `baseId` / `snapId`: the private snapshots of the turn's start and end. "Annuler" (owner only, confirmed) restores
   * the listed files to the start; `restored` / `changedSince` (changed again after the turn, left as they are).
   */
  | { type: "files"; snapId: string; baseId: string; files: FileChange[]; more: number; status: "available" | "undone" | "expired"; restored?: string[]; changedSince?: string[] }
  /**
   * Goal mode ("Objectif"): the bot keeps working across rounds, without the user pressing Continue, until it marks the
   * goal complete (with evidence) or blocked (with a reason), or reaches `maxRounds`. `status`: "proposed" (the bot
   * proposed it, the user accepts or declines), "active", "paused" (by the user, a stop, an error), "complete",
   * "blocked", "limit" (round cap reached), "stopped", "declined". `waiting`: why an active goal is not running a round
   * right now ("approval", "user": a question or a card, "checkpoint": a spend checkpoint). `summary`: the latest status
   * line the bot gave (goal_update); `evidence`: what proves it is done; `reason`: why it paused or is blocked.
   */
  | { type: "goal"; goalId: string; objective: string; status: GoalStatus; rounds: number; maxRounds: number; summary?: string; evidence?: string; reason?: string; waiting?: GoalWaiting }
  | { type: "disk"; checkId: string; usedPct: number; totalBytes: number; freeBytes: number; items: { path: string; bytes: number }[]; status: "pending" | "cleaned" | "dismissed"; deleted?: string[]; freedBytes?: number }
  /**
   * A usage cap is reached (usagecaps.ts): one card per cap, period and limit. `cap`: which one (scope, period, unit,
   * limit, who set it, what it stops); `used`: what was counted when the card was made; `resetAt`: when the period ends,
   * shown in `timezone` (the user's). `held`: how much work was set aside under it ("Continue" runs it once the cap no
   * longer stops it); `skipped`: background work let go under it (routines come back at their next time). `canRaise`:
   * the account's own cap (an operator's cap is not the customer's to raise). Status: "pending" (live buttons),
   * "continued" (the held work went on), "raised" (the owner raised the cap here, then it went on), "waiting" (the user
   * chose to wait for the reset). "Switch model" opens the bot's settings.
   */
  | { type: "cap"; stopId: string; botName: string; cap: UsageCapView; used: number; resetAt: number; timezone: string; held: number; skipped: number; canRaise: boolean; status: "pending" | "continued" | "raised" | "waiting" };

export type GoalStatus = "proposed" | "active" | "paused" | "complete" | "blocked" | "limit" | "stopped" | "declined";
export type GoalWaiting = "" | "approval" | "user" | "checkpoint";
/**
 * A long command running in the background on a bot's Linux computer (shell_run with background: true, or one that
 * outlived its time limit). Its output goes to `log` on that computer. `status`: "running", then "done" (exit 0),
 * "failed" (other exit code), "stopped" (job_stop, the Stop button, its time cap, or the computer was reset) or "lost"
 * (the computer went away while it ran).
 */
export interface BotJob { id: string; botId: string; command: string; status: "running" | "done" | "failed" | "stopped" | "lost"; exitCode: number | null; startedAt: number; endedAt: number | null; log: string; note: string }

/** Why a bot hands its screen to the user. */
export const TAKEOVER_REASONS = ["captcha", "2fa", "login", "payment", "other"] as const;
export type TakeoverReason = (typeof TAKEOVER_REASONS)[number];

export interface CallRecord { id: string; phase: "started" | "ended"; durationMs?: number; summary?: string; transcript?: { role: "user" | "assistant"; text: string }[] }

/** `thread`: set on a thread reply, the seq of the message (in the main chat) that the thread hangs on. */
export interface Row { botId: string; generation: number; seq: number; rev: number; createdAt: number; body: RowBody; thread?: number }

/**
 * `status`: "active" notes are used; "contested" ones are used with caution (the user doubted them, or a newer note says
 * otherwise); "archived" ones are kept but never used. `quote`: the user's own words a learned note came from.
 * `category`: a sensitive category the note touches (null: none), kept only because the user allowed it.
 */
export type MemoryStatus = "active" | "archived" | "contested";
/**
 * `confidence` (wave 5b): "once" — mentioned once; "confirmed" — the user said it again in a later message (a verified
 * quote of their own words) or confirmed it. Confirmed notes come first in the prompt; a "once" note neither confirmed
 * nor used for 90 days drops in priority (never deleted). `lastUsedAt`: last time it was found relevant.
 */
export interface Memory { id: string; botId: string; text: string; source: "chat" | "learned" | "import"; createdAt: number; status: MemoryStatus; quote: string; category: SensitiveCategory | null; confidence: "once" | "confirmed"; confirmedAt: number | null; lastUsedAt: number | null }
/** `shared`: every bot of the user can read and follow it (it shows in their skill index). */
/**
 * `learned`: proposed by the bot after a task and approved by the user (spec 07 A9). `outside`: it came from a turn that
 * read outside content: treated as outside content (information, never an authorisation).
 */
/**
 * Optional structured parts of a skill (empty string: not given). `needs`: accounts, access or files it needs first;
 * `check`: how to check the result; `output`: what to hand back at the end; `approvals`: the steps that need the user's
 * approval before they are done.
 */
export interface SkillExtras { needs: string; check: string; output: string; approvals: string }
export const SKILL_EXTRA_KEYS = ["needs", "check", "output", "approvals"] as const;
/** `draft`: imported from outside and not activated yet by the user: listed in the settings, never given to the bot. */
export interface Skill extends SkillExtras { id: string; botId: string; name: string; description: string; body: string; shared: boolean; learned: boolean; outside: boolean; draft: boolean; createdAt: number; updatedAt: number }
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
  trigger: "cron" | "webhook" | "once" | "watch" | NativeTrigger | "botmail";
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
  /**
   * Wave 5b (spec 07 A7). `skipUnchanged`: a cron routine that waits for something new in `inputs` (mail accounts,
   * web addresses): the server checks them first and skips the run without calling the model when nothing changed (the
   * first run and the one after a failure always happen). `failures`: failed runs in a row; `pausedReason`: why the
   * server paused it (too many failures). `running`: a run is under way (a new due time is skipped meanwhile).
   * `projectedMonthlyUsd`: what it should cost a month at its schedule (null: cannot be told).
   */
  skipUnchanged: boolean; inputs: string[]; failures: number; pausedReason: string | null; running: boolean; projectedMonthlyUsd: number | null;
}

/** `skipped`: nothing new in its inputs, or still running from the previous due time: no model call. */
export interface RoutineRun { id: string; routineId: string; at: number; status: "running" | "done" | "quiet" | "error" | "skipped"; note: string; costUsd: number }

/** One line of the account's activity log. Never edited or deleted. */
export interface AuditEntry { id: number; at: number; botId: string | null; kind: "tool" | "approval" | "account" | "apps" | "vault" | "routine" | "channel" | "system" | "computer"; text: string }

export interface TelegramStatus { connected: boolean; username: string | null; linked: boolean; linkCode: string | null }

/** A page a bot published at a public address. */
/** `visibility`: "link" — anyone with the address; "private" — only the owner, signed in to this Sklubot. */
export interface SharedPage { token: string; botId: string; title: string; url: string; createdAt: number; visibility: "link" | "private" }

export interface SearchHit { botId: string; botName: string; generation: number; current: boolean; seq: number; at: number; role: "user" | "assistant"; snippet: string; /** A thread reply: the seq of the message the thread hangs on. */ thread?: number }

export interface MemoryBookkeeping { lastConsolidatedAt: number | null; historyChars: number; compactAt: number; lastCompactedAt: number | null }
export interface BotBundle { memories: Memory[]; skills: Skill[]; routines: Routine[]; tasks: Task[]; memoryStatus: MemoryBookkeeping; bgTasks: BgTask[] }

/** How a connector proves who we are: nothing, a pasted access token, or an OAuth sign-in in the browser. */
export type ConnectorAuth = "none" | "token" | "oauth";
export interface Connector {
  id: string; name: string; url: string; hasToken: boolean; auth: ConnectorAuth;
  /** "needs_auth": an OAuth app that is not signed in, or whose sign-in could not be renewed. */
  status: "ready" | "error" | "connecting" | "needs_auth";
  error: string | null; tools: { name: string; description: string; readOnly: boolean }[];
  /** The HTTP status the app answered with when it refused the connection (401 wrong key, 404 wrong address...), so the page can explain it in the user's language. */
  errorStatus?: number;
  /** OAuth apps only. Tokens themselves never leave the server. */
  oauth?: { signedIn: boolean; customClient: boolean };
}
/**
 * A local tool server: an MCP server the owner starts with a command (e.g. `npx -y some-mcp-server`) on ONE bot's own
 * Linux computer, spoken to over its standard input and output. Never run on the Sklubot server itself.
 * "stopped": not running (started when the bot needs its tools; it stops when the computer sleeps). "error": the last
 * start failed or it stopped on its own (`retryInSec`: when it may start again). "unavailable": this server gives bots no
 * Linux computer. `error` is in the user's language; `detail`: the last line the program wrote to its error output.
 */
export interface LocalToolServer {
  id: string; botId: string; name: string; command: string; args: string[];
  status: "stopped" | "starting" | "ready" | "error" | "unavailable";
  error: string | null; detail?: string; retryInSec?: number;
  tools: { name: string; description: string; readOnly: boolean }[];
  createdAt: number;
}
export interface LocalToolsState { available: boolean; reason: string | null; servers: LocalToolServer[] }
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
export const VAULT_KINDS = ["login", "secret", "totp", "card"] as const;
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
  /** secret (wave 7, spec 08 A2): an optional read-only https address on one of its hosts, used to check the key. */
  checkUrl: string;
  /** totp: code length and period in seconds. */
  digits: number; period: number;
  /**
   * card (wave 5b, spec 07 A12): only the network and the last 4 digits are ever shown (to the user and the model);
   * number, expiry, CVC and the name on it stay sealed. Spending caps per day and per month (null: none), and what was
   * spent with it today and this month (UTC).
   */
  card: { brand: string; last4: string; dailyCapUsd: number | null; monthlyCapUsd: number | null; spentTodayUsd: number; spentMonthUsd: number } | null;
}
/** Result of a CSV import of logins. `needsMapping`: the columns were not recognised; only the header names are sent back. */
export interface VaultImportResult { imported: number; skipped: number; totp: number; needsMapping?: boolean; headers?: string[] }

// ── Push notifications (Web Push) ──────────────────────────────────────────
/** What can be pushed: a bot needs the user, a gem, a reply finished while the app was hidden, a routine's result. */
export const PUSH_KINDS = ["needs", "gem", "reply", "routine", "computer", "nudge"] as const;
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
/**
 * Wave 8: the account's team folder, shared at ~/team (/root/team) by the computers of the account's own bots — never
 * with another account's. `available`: bots have Linux computers on this server. A computer gets the change the next
 * time it starts (after it went to sleep, or a restart); `waiting`: names of bots whose computer has not yet.
 */
export interface TeamFolderState { available: boolean; enabled: boolean; since: number | null; path: string; waiting: string[] }
export interface ComputerState {
  /** "linux": each bot has its own Linux computer. "browser": each bot has a browser on the server. "none": neither is installed. */
  kind: "linux" | "browser" | "none";
  /** Whether bots have a screen at all (kind is not "none"). */
  browser: boolean;
  /** `open` = switched on. Linux computers that exist but are asleep are listed with open: false. */
  desktops: { botId: string; open: boolean; url: string | null; lastUsedAt: number }[];
  maxDesktops: number;
  /** Part B: the account's shared computers (Linux computers only), and how many it may have. */
  shared?: SharedComputerView[];
  maxShared?: number;
}

/** One shared computer of the account (Part B). */
export interface SharedComputerView {
  id: string;
  name: string;
  /** "running": on; "asleep": off, everything kept; "absent": not made yet (made on first use). */
  power: "running" | "asleep" | "absent";
  /** The bot driving it right now (null: free). */
  busyWith: string | null;
  /** Bots that used it last (most recent first). */
  lastBots: string[];
  lastUsedAt: number | null;
}

export interface CheckinSettings { enabled: boolean; times: string[]; timezone: string }
/**
 * "api": billed per token through an API key on the server.
 * "subscription": runs through the official command-line tool of the provider inside the bot's own
 * computer, signed in with the user's personal subscription (Claude Pro/Max, ChatGPT Plus/Pro).
 */
export interface ModelOption { ref: string; provider: string; model: string; kind: "api" | "subscription"; engine?: Engine }

/**
 * A model of a provider the user set up (Settings → Models → API providers). `contextWindow` in tokens; prices in $ per
 * million tokens (input, output, cached input); null: not given (the use is then counted in tokens only).
 */
export interface ApiProviderModel { id: string; contextWindow: number | null; input: number | null; output: number | null; cached: number | null }
/**
 * An OpenAI-compatible provider the user set up, for their account only. Its models are referenced as "<id>:<model>"
 * (ids start with "up-"). `hasKey`: a key is saved — the key itself never leaves the server. `preset`: "deepseek" when
 * made from that preset. `images`: whether its models read images.
 */
export interface ApiProvider { id: string; name: string; baseUrl: string; hasKey: boolean; models: ApiProviderModel[]; preset: string | null; images: boolean; createdAt: number; updatedAt: number }
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
/**
 * The state of a bot's subscription engine as the engine panel shows it. "ready": signed-in tool, nothing running;
 * "working": a turn runs on it; "starting": a restart is under way; "error": the last turn or restart failed (`error`
 * says why); "stopped": the bot's computer is asleep or gone (a restart wakes it).
 */
export interface EngineRuntime {
  engine: Engine | null;
  /** The model alias the bot uses ("default" when the tool picks). */
  model: string;
  status: "ready" | "working" | "starting" | "error" | "stopped";
  error: string | null;
  since: number;
}
/** One check of the desk test (an end-to-end run on a real bot computer). */
export interface DeskCheck { id: string; label: string; ok: boolean; detail: string; ms: number }
/** A desk test run: started from Settings → Computer, or from the operator command (npm run desk:test). */
export interface DeskTestRun {
  id: string;
  status: "running" | "passed" | "failed" | "error";
  startedAt: number; finishedAt: number | null;
  checks: DeskCheck[];
  /** Pictures taken during the run, served by GET /computer/desk-test/shots/:name. */
  shots: string[];
  error: string | null;
}
/** A subscription tool's windows (fractions 0–1) and, in a summary, this month's tokens of its turns (from `usage`). */
export interface SubscriptionUsage { engine: Engine; fiveHour: number | null; sevenDay: number | null; resetsAt: number | null; at: number; inputTokens?: number; outputTokens?: number; turns?: number }
export interface UsageSummary {
  month: string;
  /** costUsd: known costs only. unknownTokens: tokens of calls to a model without a price; estimatedUsd: their conservative estimate (counted by budgets). */
  totals: { inputTokens: number; outputTokens: number; turns: number; costUsd: number; unknownTokens: number; estimatedUsd: number };
  byBot: { botId: string; name: string; inputTokens: number; outputTokens: number; turns: number; costUsd: number; unknownTokens: number; estimatedUsd: number }[];
  /** Models used this month without a known price ("coût inconnu"). */
  unknownModels: string[];
  budgetUsd: number | null;
  /** Latest known use of the subscription windows (fractions 0–1), per engine. */
  subscriptions: SubscriptionUsage[];
  /** True once this month's spend has passed 80% of the budget. */
  nearBudget: boolean;
}

// ── Usage caps (usagecaps.ts) ─────────────────────────────────────────────────────────────────────────────────────
export type CapPeriod = "day" | "month";
/** "usd": money (known costs + the conservative estimate of unknown prices); "tokens": input (cached included) + output. */
export type CapUnit = "usd" | "tokens";
/** "unattended": stops only work no person started (the default); "everything": a person's own messages too. */
export type CapMode = "unattended" | "everything";
/** "self": the account's owner set it; "operator": the hosted service's operator set it on this customer (read-only to them). */
export type CapSetBy = "self" | "operator";
/** One cap as set: the account's (botId null) or one bot's (its helpers count with it). */
export interface UsageCapView {
  key: string; botId: string | null; period: CapPeriod; unit: CapUnit; limit: number; mode: CapMode; warnPercent: number; setBy: CapSetBy; updatedAt: number;
}
/** A cap measured now: `used` in its unit for its current period, `percent` of the limit, and when that period ends. */
export interface CapStateView extends UsageCapView { used: number; percent: number; warn: boolean; reached: boolean; periodKey: string; resetAt: number }
export interface UsageAmount { usd: number; tokens: number }
/**
 * GET /usage/caps: today and this month (in `timezone`, the user's), for the account and for each bot (its helpers
 * included), with every cap and how far it is used. `budget`: the monthly budget (Settings → Usage, UTC month, stops
 * everything) shown alongside, as it is a cap of its own kind.
 */
export interface UsageCapsView {
  timezone: string; dayKey: string; monthKey: string; dayResetAt: number; monthResetAt: number; owner: boolean;
  account: { today: UsageAmount; month: UsageAmount; caps: CapStateView[] };
  bots: { botId: string; name: string; today: UsageAmount; month: UsageAmount; caps: CapStateView[] }[];
  budget: { usd: number | null; spentUsd: number; resetAt: number };
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
  /** From the relay's hello: "darwin" | "win32" | "linux" | "android"…, the CPU, the OS release and the relay's version. */
  platform: string; arch: string; osRelease: string; appVersion: string;
  /** "phone": the Sklubot Android app (protocol 1.2, taps instead of a mouse, no commands); "computer": Sklubot Relais. */
  kind: "computer" | "phone";
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
/** One Sklubot desktop build served under /download/ (named Sklubot-<version>-<os>.<ext>). */
export interface DesktopDownload { name: string; url: string; os: "windows" | "mac" | "linux"; kind: "exe" | "zip" | "dmg" | "AppImage" | "deb"; size: number; version: string }
/** The public download page (/telecharger): Android app, desktop builds on this server, and the releases page. */
export interface AppDownloads { android: { url: string; size: number; version?: string; name?: string } | null; desktop: DesktopDownload[]; releasesUrl: string }

// ── Wave 6 ──────────────────────────────────────────────────────────────────
/**
 * Workspace roles. owner: everything, including admins, seats and deleting the workspace; admin: members below admin,
 * every shared bot (talk, limited settings, approvals when the bot's rule allows), shared resources, usage, export;
 * member: talk to the shared bots on their list and read those conversations; viewer: read those conversations only.
 */
export const WORKSPACE_ROLES = ["owner", "admin", "member", "viewer"] as const;
export type WorkspaceRole = (typeof WORKSPACE_ROLES)[number];
/** What each role may do. The server checks these on every route; the web app only uses them to hide buttons. */
export const ROLE_PERMISSIONS: Record<WorkspaceRole, { view: boolean; talk: boolean; allBots: boolean; botSettings: boolean; approve: boolean; manageMembers: boolean; manageAdmins: boolean; resources: boolean; usage: boolean; export: boolean; deleteWorkspace: boolean }> = {
  owner: { view: true, talk: true, allBots: true, botSettings: true, approve: true, manageMembers: true, manageAdmins: true, resources: true, usage: true, export: true, deleteWorkspace: true },
  admin: { view: true, talk: true, allBots: true, botSettings: true, approve: true, manageMembers: true, manageAdmins: false, resources: true, usage: true, export: true, deleteWorkspace: false },
  member: { view: true, talk: true, allBots: false, botSettings: false, approve: false, manageMembers: false, manageAdmins: false, resources: false, usage: false, export: false, deleteWorkspace: false },
  viewer: { view: true, talk: false, allBots: false, botSettings: false, approve: false, manageMembers: false, manageAdmins: false, resources: false, usage: false, export: false, deleteWorkspace: false },
};
export interface Workspace { id: string; name: string; ownerId: string; seats: number; role: WorkspaceRole; memberCount: number; createdAt: number }
export interface WorkspaceMember { userId: string; name: string; email: string; role: WorkspaceRole; joinedAt: number }
export interface WorkspaceInvite { id: string; email: string; role: Exclude<WorkspaceRole, "owner">; expiresAt: number; createdAt: number; usedAt: number | null; /** Only in the answer that created it: the single-use link. */ link?: string }
/** Who may answer an approval card of a shared bot: its owner only, or its owner and the workspace's admins. */
export type ApprovalRule = "owner" | "owner_or_admins";
/** One of your bots shared to a workspace. access "all": every member; "list": only `memberIds` (admins always). */
export interface BotShare { workspaceId: string; workspaceName: string; access: "all" | "list"; memberIds: string[]; approvals: ApprovalRule }
/** What you may do with a bot someone shared with you. */
export interface SharedAccess { workspaceId: string; workspaceName: string; ownerName: string; role: WorkspaceRole; canTalk: boolean; canManage: boolean; canApprove: boolean }
export interface WorkspaceResource { kind: "vault" | "connector"; id: string; name: string; sharedBy: string; sharedByName: string; createdAt: number }
export interface WorkspaceAuditEntry { id: number; at: number; actorId: string; actorName: string; kind: string; text: string }
export interface MemberUsage { userId: string; name: string; role: WorkspaceRole; messages: number; costUsd: number; approvals: number; lastActiveAt: number | null }
export interface WorkspaceAdmin { workspace: Workspace; members: WorkspaceMember[]; invites: WorkspaceInvite[]; usage: MemberUsage[]; bots: { id: string; name: string; ownerName: string; share: BotShare }[]; resources: WorkspaceResource[]; audit: WorkspaceAuditEntry[] }

/** SPF / DKIM / DMARC results of a received mail, as mailauth reported them ("pass", "fail", "none", "softfail"…). */
export interface MailAuth { spf: string; dkim: string; dmarc: string }
/** A bot's own email address (self-hosted inbound mail). */
export interface BotEmail { address: string | null; domain: string | null; enabled: boolean; allowedSenders: string[]; autoReply: boolean; receiving: boolean }
export interface InboundMail { id: string; botId: string; from: string; to: string; subject: string; text: string; auth: MailAuth; spam: number; status: "delivered" | "held" | "released" | "replied"; reason: string; size: number; receivedAt: number }
/** The user's SMTP relay for the bots' outgoing mail. The password and DKIM key are sealed, never returned. */
export interface MailRelay { host: string; port: number; secure: boolean; username: string; hasPassword: boolean; fromDomain: string; dkimSelector: string; hasDkimKey: boolean }

/** Server-mediated voice (wave 6). "browser": the browser's own speech recognition and synthesis (the old mode). */
export const STT_PROVIDERS = ["whisper-cpp", "openai", "fish"] as const;
export const TTS_PROVIDERS = ["piper", "openai", "fish", "kokoro"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
/** `url`: the service's base address ("" = the server's own setting); `hasKey`: an API key is saved (sealed) for it. */
export interface VoiceSettings {
  mode: "auto" | "server" | "browser";
  stt: { provider: SttProvider; url: string; model: string; language: string; hasKey: boolean };
  tts: { provider: TtsProvider; url: string; model: string; voice: string; hasKey: boolean };
  /** Barge-in sensitivity: how loud (0-1 scale) and how long (ms) the user must speak to cut the bot off. */
  bargeIn: { enabled: boolean; minSpeechMs: number };
  /** Fish Audio (voice/fish.ts): one key (sealed, never returned) for its speech, transcription and voice library. */
  fish?: { hasKey: boolean };
}
/**
 * A bot's own voice (voice/botvoice.ts), chosen in its settings: from Fish Audio's library (`voiceId` = the voice's public
 * id there, sent as `reference_id`) or the self-hosted Kokoro (`voiceId` = a Kokoro voice such as "ff_siwis", or a
 * weighted mix); `name`/`author` as listed; `language` "" = the bot's language.
 */
export interface BotVoiceChoice { provider: "fish" | "kokoro"; voiceId: string; name: string; author: string; language: string }
/** One voice of the self-hosted Kokoro (GET /voice/kokoro/voices): language and gender read from the id's prefix. */
export interface KokoroVoice { id: string; name: string; language: string; gender: "female" | "male" | ""; grade: string }
/** One voice of Fish Audio's library as the picker shows it (GET /voice/fish/voices). */
export interface FishVoice { id: string; title: string; description: string; languages: string[]; tags: string[]; likes: number; uses: number; author: string; licensed: boolean; visibility: string; state: string }
/** What a call will use: "server" when speech-to-text and text-to-speech are both reachable, else "browser". */
export interface VoiceStatus { mode: "server" | "browser"; stt: string | null; tts: string | null; reason: string }

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
  /** A bot's local tool servers changed (added, started, stopped, failed): GET /bots/:id/local-tools again. */
  | { type: "localtools"; botId: string }
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
  /** Something was paused or resumed (a bot, a section, everything): bots, sections and GET /pauses again. */
  | { type: "pauses" }
  /** Vault items changed (a secret saved from a card, an import…). */
  | { type: "vault" }
  /** The user's linked computers or their live state changed (connection, session, Stop, a question on screen). */
  | { type: "relay"; devices: RelayDevice[] }
  /** The shared profile changed (from Settings or a bot's profile_update). */
  | { type: "profile" }
  /** The user's rules or the reviewer model changed. */
  | { type: "rules" }
  /** Memory settings (sensitive topics, writing style) changed. */
  | { type: "memorySettings" }
  /** API connectors created on demand changed. */
  | { type: "apiConnectors" }
  /** Wave 6: your workspaces, their members or shared bots changed. */
  | { type: "workspaces" }
  /** Wave 6: a bot's mailbox changed (a mail arrived, was released…). */
  | { type: "mail"; botId: string }
  /** Wave 7: the health of keys and connections changed (a check ran). */
  | { type: "health" }
  /** Wave 7: temporary public links changed. */
  | { type: "publicLinks" }
  /** Wave 7: a bot's reading logins (Agent Reach) changed. */
  | { type: "reach"; botId: string };

// ── Wave 7 ──────────────────────────────────────────────────────────────────
/**
 * A reading channel of Agent Reach on a bot's computer that needs (or may use) a login the user does themselves on the
 * bot's screen. `loggedIn`: as Agent Reach reports it (null: unknown). `status`: its own word (ready, needs_user_action,
 * not_added, broken…).
 */
export interface ReachLogin { channel: string; label: string; loggedIn: boolean | null; status: string; hint: string }
export interface ReachState { available: boolean; reason: string; version: string | null; logins: ReachLogin[]; channels: { channel: string; status: string }[] }

/**
 * Health of a key or a connection (spec 08 A2). ok: works; broken: the provider refused it; reconnect: sign in again;
 * uncertain: the provider could not be reached (5xx, timeout) — not counted as broken; never: no zero-cost check is
 * possible (nothing is invented). `rateLimited`: the last check met a rate limit (not a failure).
 */
export type HealthState = "ok" | "broken" | "reconnect" | "uncertain" | "never";
export interface CredentialHealth {
  kind: "vault" | "api" | "native" | "connector"; id: string; name: string; state: HealthState;
  detail: string; checkedAt: number | null; how: string; rateLimited?: boolean;
  /** A pasted token that cannot be renewed: re-paste it when it expires. */
  manualToken?: boolean;
}

/** A temporary public link to one library file (spec 08 A8). The address is shown only once, when it is created. */
export interface PublicLink { id: string; botId: string; botName: string; path: string; mime: string; size: number; expiresAt: number; revokedAt: number | null; createdAt: number; downloads: number; url?: string }

/** Preview of a project import (spec 08 A6): names and guessed hosts only, never a value. */
export interface ImportVariable { name: string; isSecret: boolean; provider: string | null; hosts: string[]; header: string; prefix: string; exists: boolean; reason: string }
export interface ImportSkill { name: string; description: string; path: string; mentionsKey: boolean; exists: boolean }
export interface ImportPreview { previewId: string; variables: ImportVariable[]; skills: ImportSkill[]; ignored: string[] }
export interface ImportReport { created: string[]; updated: string[]; skipped: string[]; toComplete: string[]; skills: string[]; health: { name: string; state: HealthState; detail: string }[] }

// ── "Importer depuis Grok Bot" (grokimport.ts, docs/IMPORT-GROK.md) ─────────────────────────────────────────────
/**
 * The user asks the assistant they use elsewhere to describe its bots with the prompt below, then pastes its reply here.
 * The reply must hold one ```json block: { "format": "sklubot-bots", "version": 1, "bots": [...] }. The prompt and the
 * format are Sklubot's own (docs/IMPORT-GROK.md documents every field).
 */
export const GROK_EXPORT_FORMAT = "sklubot-bots";
export const GROK_EXPORT_VERSION = 1;
const EXPORT_SHAPE = `{
  "format": "sklubot-bots",
  "version": 1,
  "bots": [
    {
      "name": "",
      "role": "",
      "personality": "",
      "instructions": "",
      "memories": [""],
      "skills": [{ "name": "", "when": "", "steps": [""] }],
      "routines": [{ "name": "", "schedule": "", "cron": "", "timezone": "", "task": "" }],
      "apps": [""]
    }
  ]
}`;
export const GROK_EXPORT_PROMPT_FR = `Je déplace mes bots vers une autre application. Prépare un export de chacun des bots (ou assistants) que tu fais tourner pour moi, en respectant exactement ces règles.

1. Ta réponse contient UN SEUL bloc de code, ouvert par \`\`\`json et fermé par \`\`\`. Une phrase avant ou après le bloc est permise, rien d'autre dans le bloc.
2. Le bloc est un JSON valide (guillemets droits, aucune virgule en trop, aucun commentaire) de cette forme exacte :
${EXPORT_SHAPE}
3. Un objet par bot dans "bots". Ce que veut dire chaque champ :
   - "name" : le nom du bot.
   - "role" : son travail, en une ou deux phrases.
   - "personality" : sa personnalité et son ton.
   - "instructions" : les consignes qu'il suit, telles que je les lui ai données.
   - "memories" : les faits sur moi qu'il garde et que j'ai accepté de partager. Un fait par ligne ; je les relirai un par un.
   - "skills" : ses savoir-faire ; pour chacun, son nom, quand s'en servir ("when") et ses étapes dans l'ordre ("steps").
   - "routines" : ses tâches régulières ; "schedule" dit quand en mots simples, "cron" donne l'expression cron à 5 champs si tu en es sûr (sinon ""), "timezone" le fuseau horaire (par exemple "Europe/Paris", sinon ""), "task" ce qu'il fait à chaque fois.
   - "apps" : les applications qui lui sont connectées, par leur nom seulement (par exemple "Gmail").
4. Une rubrique vide reste vide : [] ou "". N'invente rien.
5. Ne mets JAMAIS dans l'export : mot de passe, clé d'API, jeton (token), cookie, code de vérification, identifiant de connexion, numéro de carte ou de compte bancaire, ni aucune donnée privée d'autres personnes (leurs coordonnées, leurs messages). Si un texte en contient, remplace ce passage par [RETIRÉ].`;
export const GROK_EXPORT_PROMPT_EN = `I am moving my bots to another app. Prepare an export of each bot (or assistant) you run for me, following these rules exactly.

1. Your reply contains ONE code block only, opened with \`\`\`json and closed with \`\`\`. A sentence before or after the block is fine; nothing else goes inside the block.
2. The block is valid JSON (straight quotes, no extra commas, no comments) in exactly this shape:
${EXPORT_SHAPE}
3. One object per bot in "bots". What each field means:
   - "name": the bot's name.
   - "role": its job, in one or two sentences.
   - "personality": its personality and tone.
   - "instructions": the instructions it follows, as I gave them.
   - "memories": the facts about me it keeps and that I agreed to share. One fact per line; I will review each one.
   - "skills": what it knows how to do; for each, its name, when to use it ("when") and its steps in order ("steps").
   - "routines": its recurring jobs; "schedule" says when in plain words, "cron" gives the 5-field cron expression if you are sure (otherwise ""), "timezone" the time zone (for example "Europe/Paris", otherwise ""), "task" what it does each time.
   - "apps": the apps connected to it, by name only (for example "Gmail").
4. An empty section stays empty: [] or "". Do not make anything up.
5. NEVER put in the export: passwords, API keys, tokens, cookies, verification codes, sign-in details, card or bank account numbers, or any private data about other people (their contact details, their messages). If a text contains any, replace that part with [REMOVED].`;

export interface GrokImportSkill { name: string; when: string; steps: string }
/** `cron`: a valid 5-field expression, or "" (the routine then needs one before it can be created); `describe`: when it runs, in words. */
export interface GrokImportRoutine { name: string; schedule: string; cron: string; timezone: string; task: string; describe: string }
/** `flagged`: something that looked like a secret was taken out of it. */
export interface GrokImportMemory { text: string; flagged: boolean }
export interface GrokImportBot {
  name: string; nameTaken: boolean; role: string; personality: string; instructions: string;
  memories: GrokImportMemory[]; skills: GrokImportSkill[]; routines: GrokImportRoutine[]; apps: string[];
}
/** What was taken out before the preview: where (e.g. "Ava › skill “Invoices”"), and what it looked like. Never the value. */
export interface GrokImportStripped { where: string; kind: SecretFound["kind"] | "cookie" | "card" | "field" }
export type GrokImportWarningCode =
  | "no_version" | "newer_version" | "repaired" | "several_blocks" | "too_many_bots" | "too_many_items" | "unknown_fields"
  | "routine_no_cron" | "bots_limit" | "routines_limit" | "team_full";
export interface GrokImportWarning { code: GrokImportWarningCode; n?: number; detail?: string }
export interface GrokImportPreview {
  previewId: string; bots: GrokImportBot[];
  /** Every app named by the bots, once each (the "to connect" checklist). */
  apps: string[];
  stripped: GrokImportStripped[]; warnings: GrokImportWarning[];
  /** Room left on the plan (null: no limit): bots that can still be created, routines that can still be active. */
  room: { bots: number | null; activeRoutines: number | null };
}
/** What the user kept in the preview. Indexes point into the preview; names may be edited; memories: the ticked indexes. */
export interface GrokImportChoice {
  index: number; include: boolean; name?: string;
  skills?: { index: number; include: boolean; name?: string }[];
  routines?: { index: number; include: boolean; name?: string; cron?: string }[];
  memories?: number[];
  /** The apps kept on the bot's to-do list (indexes; left out: all of them). */
  apps?: number[];
}
export interface GrokImportReport {
  bots: { id: string; name: string }[]; skills: number; routines: number; memories: number;
  /** Routines left out for want of a valid schedule (listed in the bot's to-do notice). */
  unscheduled: string[];
  apps: string[];
}

// ── "Modèles d'équipe": the portable team file (teamfile.ts, docs/MODELES-EQUIPE.md) ───────────────────────────────
/**
 * One Markdown file per team: YAML front matter (the team's title, description, icon, category…) then one "## Bot: name"
 * section per bot. Only names, roles, personality, instructions, skills, routines, suggested apps and the look travel in
 * it; models, autonomy, computers, connectors, keys, memories and workspaces never do (the parser drops them and says so).
 */
export const TEAM_FILE_FORMAT = "sklubot-equipe";
export const TEAM_FILE_VERSION = 1;
/** The icons a template may ask for (names of the web app's Icon set). */
export const TEMPLATE_ICONS = ["users", "chart", "search", "target", "mail", "calendar", "book", "image", "star", "bulb", "shield", "globe", "folder", "sun", "brain", "wrench", "phone", "chat", "tasks", "send"] as const;
export type TemplateIcon = (typeof TEMPLATE_ICONS)[number];
/** Gallery filters. */
export const TEMPLATE_CATEGORIES = ["commerce", "marketing", "sales", "admin", "finance", "support", "personal", "research"] as const;
export type TemplateCategory = (typeof TEMPLATE_CATEGORIES)[number];
/** A bot's look as a file carries it: null shape or colour lets Sklubot pick one. */
export interface TeamFileLook { shape: AvatarShape | null; color: AvatarColor | null; character: Character }
export interface TeamFileMeta {
  title: string; description: string; icon: TemplateIcon; category: TemplateCategory | null; tags: string[]; language: string; author: string;
}
export interface TeamFileBot {
  name: string; nameTaken: boolean; role: string; personality: string; instructions: string; look: TeamFileLook;
  skills: GrokImportSkill[]; routines: GrokImportRoutine[]; apps: string[];
}
/** A field or section the file carried that is not on the allowlist: dropped before the preview. */
export interface TeamFileRemoved { where: string; field: string; reason: "forbidden" | "unknown" | "secret" }
export interface TeamFileSource { kind: "template" | "file" | "url"; label: string; url?: string }
/** A built-in template, as the gallery lists it. */
export interface TemplateSummary extends TeamFileMeta {
  id: string; bots: { name: string; role: string; look: TeamFileLook }[]; skills: number; routines: number; apps: string[];
}
export interface TeamFilePreview {
  previewId: string; source: TeamFileSource; meta: TeamFileMeta; bots: TeamFileBot[];
  /** Every app named by the bots, once each. */
  apps: string[];
  /** Secret-looking values replaced by a marker (where, what kind; never the value). */
  masked: GrokImportStripped[];
  removed: TeamFileRemoved[];
  warnings: GrokImportWarning[];
  room: { bots: number | null; activeRoutines: number | null };
}
/** What the user kept: as for the Grok import, without memories (a team file never carries any). */
export type TeamFileChoice = Omit<GrokImportChoice, "memories">;
export interface TeamFileReport {
  bots: { id: string; name: string }[]; skills: number; routines: number; unscheduled: string[]; apps: string[];
  section: { id: string; name: string } | null;
}
export interface TeamFileExport { filename: string; text: string; bots: number; masked: number }

/** Paid third-party tool calls (spec 08 A4), in micro-dollars (integers): reserved before, settled after. */
export interface ThirdPartySpend { todayUsd: number; capUsd: number | null; monthUsd: number; recent: { at: number; botId: string; tool: string; provider: string; usd: number; status: string }[] }
/** One step of a provider chain (spec 08 A3): who was tried and why it was set aside. */
export interface ProviderAttempt { provider: string; tier: "owned" | "free" | "paid"; outcome: "served" | "empty" | "error" | "skipped" | "too_expensive" | "needs_consent"; detail: string; costUsd: number }

// ── A secret pasted in a chat message ────────────────────────────────────────
/**
 * Formats that are a key, a token or a password and almost never anything else (low false positives): provider key
 * prefixes (sk-…, sk_live_…, ghp_…, github_pat_…, glpat-…, xox?-…, AKIA…, AIza…, xai-…, hf_…), Telegram bot tokens,
 * JWTs, PEM private keys, and a labelled value ("password: …", "mot de passe = …", "api key: …", "token: …"). A long
 * random string alone is not enough (document ids, hashes and URLs look like that). Shared by the server (which masks
 * them before anything is stored or sent to a model) and the composer (which warns before sending).
 */
const SECRET_FORMATS: { kind: "key" | "token" | "password" | "private-key"; re: RegExp; group?: number }[] = [
  { kind: "private-key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|$)/g },
  { kind: "key", re: /\bsk-(?:ant-|proj-|or-|svcacct-)?[A-Za-z0-9_-]{20,}/g },
  { kind: "key", re: /\b(?:sk|rk)_(?:live|test)_[A-Za-z0-9]{16,}/g },
  { kind: "token", re: /\bgh[pousr]_[A-Za-z0-9]{36,}/g },
  { kind: "token", re: /\bgithub_pat_[A-Za-z0-9_]{40,}/g },
  { kind: "token", re: /\bglpat-[A-Za-z0-9_-]{20,}/g },
  { kind: "token", re: /\bxox[abeprs]-[A-Za-z0-9-]{10,}/g },
  { kind: "key", re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g },
  { kind: "key", re: /\bAIza[0-9A-Za-z_-]{35}/g },
  { kind: "key", re: /\bxai-[A-Za-z0-9]{20,}/g },
  { kind: "token", re: /\bhf_[A-Za-z0-9]{30,}/g },
  { kind: "token", re: /\b\d{8,10}:AA[A-Za-z0-9_-]{33}\b/g },
  { kind: "token", re: /\beyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/g },
  {
    kind: "password", group: 2,
    re: /(?<![\p{L}\p{N}_])(password|passwd|pwd|passcode|mot de passe|mdp|api[_ -]?key|cl[eé] (?:d'|de l'|d')?api|access[_ -]?token|auth[_ -]?token|bearer token|secret|token)\s*(?:[:=]|=>)\s*["'«]?\s*([^\s"'»]{4,300})/giu,
  },
];
/** Values that are clearly not a secret even after "password:" (a placeholder, stars, an earlier mask). */
const NOT_A_SECRET = /^(?:\*+|x+|\.+|•+|<[^>]*>?|\[.*|\{\{.*|null|none|undefined|aucun|vide|empty|changeme|example|exemple)$/i;

export interface SecretFound { start: number; end: number; value: string; kind: "key" | "token" | "password" | "private-key" }

/** The secrets in a text, in order, without overlaps. */
export function findSecrets(text: string): SecretFound[] {
  if (!text || text.length < 8) return [];
  const all: SecretFound[] = [];
  for (const f of SECRET_FORMATS) {
    f.re.lastIndex = 0;
    for (const m of text.matchAll(f.re)) {
      const value = f.group ? m[f.group] : m[0];
      if (!value || NOT_A_SECRET.test(value)) continue;
      // "secret: …" and "token: …" also open ordinary sentences: only a value that looks generated counts there.
      if (f.group && /^(?:secret|token)$/i.test(m[1]) && !(/\d/.test(value) && /[A-Za-z]/.test(value)) && value.length < 16) continue;
      const start = (m.index ?? 0) + (f.group ? m[0].lastIndexOf(value) : 0);
      all.push({ start, end: start + value.length, value, kind: f.kind });
    }
  }
  all.sort((a, b) => a.start - b.start || b.end - a.end);
  const out: SecretFound[] = [];
  for (const s of all) if (!out.length || s.start >= out[out.length - 1].end) out.push(s);
  return out;
}

/** The text with every secret replaced by `placeholder`, and the secrets taken out. */
export function maskSecrets(text: string, placeholder: string): { text: string; secrets: SecretFound[] } {
  const secrets = findSecrets(text);
  if (!secrets.length) return { text, secrets };
  let out = "";
  let at = 0;
  for (const s of secrets) { out += text.slice(at, s.start) + placeholder; at = s.end; }
  return { text: out + text.slice(at), secrets };
}


// ── Hosted mode (hosted.ts; only when HOSTED_MODE=1) ─────────────────────────────────────────────────────────────────
export type PlanKind = "free" | "included" | "byok";
export type SubscriptionStatus = "trial" | "active" | "past_due" | "suspended";
export type HostedStopReason = "budget" | "suspended" | "byok" | "engines" | "limit" | "payment";
export type PlanLimitKind = "bots" | "routines" | "computers" | "storage";
/** A plan as the instance owner edits it. Limits: null = no limit. Prices and budgets in euros, per month. */
export interface HostedPlan {
  id: string; kind: PlanKind; nameFr: string; nameEn: string; descriptionFr: string; descriptionEn: string;
  priceEur: number; aiBudgetEur: number; maxBots: number | null; maxAwakeComputers: number | null; storageGb: number | null; maxRoutines: number | null;
  public: boolean; position: number; archived: boolean;
}
/** The operator's estimates for paid services without a price per call (USD). They are estimates, not provider prices. */
export interface HostedEstimates { imageUsd: number; videoUsd: number; sttUsdPerMinute: number; ttsUsdPer1kChars: number }
/** Details printed in the legal templates; empty fields show as [À COMPLÉTER]. */
export interface HostedLegal { company: string; legalForm: string; capital: string; address: string; siret: string; vat: string; director: string; email: string; phone: string; host: string; mediator: string }
export interface HostedSettings {
  usdToEur: number; trialDays: number; graceDays: number; trialBudgetEur: number; contactUrl: string; signupDefaultPlan: string;
  /** Whether customer accounts may run bots on their own Claude Code / Codex sign-in (never the operator's). */
  subscriptionEngines: boolean;
  estimates: HostedEstimates; legal: HostedLegal;
}
/** "Mon abonnement": what a customer sees of their own account. */
export interface HostedAccountView {
  operator: boolean;
  plan: HostedPlan | null; status: SubscriptionStatus | null;
  trialEndsAt: number | null; periodEnd: number | null; graceEndsAt: number | null;
  month: string; resetAt: number; spentEur: number; budgetEur: number; creditEur: number; operatorKeys: boolean;
  usage: { bots: number; maxBots: number | null; routines: number; maxRoutines: number | null; awake: number; maxAwake: number | null; storageBytes: number; storageLimitBytes: number | null };
  contactUrl: string; plans: HostedPlan[];
}
export interface AdminCustomer {
  id: string; name: string; email: string; createdAt: number; operator: boolean; owner: boolean;
  planId: string | null; status: SubscriptionStatus | null; trialEndsAt: number | null; periodEnd: number | null; graceEndsAt: number | null;
  spentEur: number; budgetEur: number; creditEur: number; lastActivity: number | null; bots: number; computers: number; awake: number;
}
export interface AdminAuditEntry { id: number; at: number; actorLabel: string; targetId: string | null; targetEmail: string | null; action: string; detail: string }
export interface PlanInviteView { id: string; planId: string; email: string; expiresAt: number; usedAt: number | null; createdAt: number; link?: string }

// ── "Aujourd'hui" (today.ts) ─────────────────────────────────────────────────────────────────────────────────────
/** What a "Today" item opens: a row of a bot's chat (in a thread when `thread` is set), a bot, its settings, or a settings section. */
export type TodayLink =
  | { kind: "row"; botId: string; seq: number; thread?: number }
  | { kind: "bot"; botId: string }
  | { kind: "botSettings"; botId: string; tab: "general" | "routines" }
  | { kind: "settings"; section: "usage" | "connectors" | "keys" | "subscription" }
  | { kind: "surveillance"; incidentId?: string };
/**
 * Something only the user can fix. `kind`: approval, question (a question card, or a background task asking), cap (a
 * usage cap card), spend (a spend checkpoint), paused (a paused bot holding `count` messages), stalled / silent (the turn
 * watch's notice), continue (stopped at its step limit), routine (a failed or server-paused routine), connector (a
 * built-in app or a connection to sign in again, or a "connect" card), disk (its computer's disk is nearly full),
 * takeover (it needs you on its screen), secret (it asks for a key), uncertain (an action whose outcome is unknown),
 * goal (a proposed goal), review (a skill, an API connector, a memory conflict or a pasted secret to look at),
 * plan (hosted mode: the account's plan stops work), incident (the server's owner or an operator: a critical incident of
 * the Sentinelle is open — `title` is its title, already in the user's language). `title`: the card's own words (data, not translated).
 */
export type TodayNeedKind = "approval" | "question" | "cap" | "spend" | "paused" | "stalled" | "silent" | "continue" | "routine" | "connector" | "disk" | "takeover" | "secret" | "uncertain" | "goal" | "review" | "plan" | "incident";
export interface TodayNeed { kind: TodayNeedKind; botId: string | null; botName: string; title: string; detail: string; at: number; count?: number; shared?: boolean; link: TodayLink }
/** One thing a bot finished. `count`: how many it stands for (files of a turn, reads of a research); minutes = counted × table. */
export interface TodayDone { kind: TodayKind; at: number; title: string; detail: string; count: number; counted: number; minutes: number; link: TodayLink | null }
export interface TodayBotDone { botId: string; botName: string; shared: boolean; items: TodayDone[]; minutes: number }
export interface TodayCost {
  /** Priced model cost, plus the conservative estimate for models without a known price (as the usage page counts). */
  usd: number; estimatedUsd: number; inputTokens: number; outputTokens: number; turns: number;
  /** Tokens of turns on a Claude / ChatGPT subscription (no per-token charge). */
  subscriptionTokens: number;
  byBot: { botId: string; botName: string; usd: number; tokens: number }[];
  /** Hosted mode, a customer: what the service's keys cost that day in euros, and what is left of the month's budget. */
  hosted?: { spentEur: number; budgetLeftEur: number };
}
export interface TodayReport {
  date: string; timezone: string; start: number; end: number; today: boolean; generatedAt: number;
  needs: TodayNeed[];
  done: TodayBotDone[];
  minutes: { total: number; table: Record<TodayKind, number>; counts: Partial<Record<TodayKind, number>>; overridden: string[] };
  /** The caller's own account only (a shared bot's costs are its owner's). */
  cost: TodayCost;
}
/** Settings → Aujourd'hui: the morning digest and the owner's minutes. `hour`: 0–23 in the user's timezone. */
export interface TodayDigestSettings { enabled: boolean; hour: number; push: boolean; email: boolean }
export interface TodaySettingsView {
  digest: TodayDigestSettings; overrides: Partial<Record<TodayKind, number>>;
  defaults: Record<TodayKind, number>; timezone: string; mailConfigured: boolean; pushDevices: number; lastSent: string | null;
}

// ── "Sentinelle" / page Surveillance (sentinel/) ─────────────────────────────────────────────────────────────────
export const SENTINEL_SEVERITIES = ["info", "warn", "critical"] as const;
export type SentinelSeverity = (typeof SENTINEL_SEVERITIES)[number];
/** open: first seen; ongoing: seen again; acknowledged: an operator said they know (still active); resolved: quiet since. */
export type SentinelState = "open" | "ongoing" | "acknowledged" | "resolved";
/** What "Ouvrir" opens: a settings section, a bot or its settings (only the viewer's own bots), or the health checks. */
export type SentinelLink =
  | { kind: "settings"; section: "account" | "connectors" | "usage" | "models" | "admin" | "notifications" }
  | { kind: "bot"; botId: string }
  | { kind: "botSettings"; botId: string; tab: "general" | "routines" }
  | { kind: "health" };
export interface SentinelIncidentView {
  id: string; fingerprint: string; kind: string; severity: SentinelSeverity; state: SentinelState;
  /** In the viewer's language. */
  title: string; explanation: string; fix: string;
  count: number; peak: number; seen: number; firstAt: number; lastAt: number; resolvedAt: number | null;
  ackedAt: number | null; ackedBy: string | null;
  /** The measure per hour over the last 24 hours (oldest first, 24 values). */
  sparkline: number[];
  link: SentinelLink | null;
  /** The account it concerns (its e-mail), when it is not the viewer's own. */
  account: string | null;
}
export interface SentinelDetectorRun { name: string; ok: boolean; ms: number; skipped?: boolean; error?: string }
export interface SentinelScanInfo { at: number; durationMs: number; detectors: SentinelDetectorRun[]; opened: number; resolved: number }
/** The /api/health/deep checks, as the page shows them (monitor.ts). */
export interface SentinelHealth { status: "ok" | "degraded" | "down"; code: string; at: number; checks: { name: string; state: "ok" | "degraded" | "down" | "off" | "unknown"; code: string; detail?: Record<string, unknown> }[] }
export interface SentinelOverview {
  incidents: SentinelIncidentView[];
  /** Resolved incidents, the most recent first. */
  history: SentinelIncidentView[];
  health: SentinelHealth | null;
  counts: Record<SentinelSeverity, number>;
  lastScan: SentinelScanInfo | null;
  nextScanAt: number | null;
  everyMin: number;
}
export interface SentinelQuiet { enabled: boolean; start: string; end: string }
export interface SentinelSettings {
  push: boolean; email: boolean; minSeverity: SentinelSeverity; digest: boolean; digestHour: number; quiet: SentinelQuiet; timezone: string;
}
export interface SentinelSettingsView { settings: SentinelSettings; mailConfigured: boolean; pushDevices: number; email: string }
