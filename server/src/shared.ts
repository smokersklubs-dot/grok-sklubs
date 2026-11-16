/**
 * Wire contract between the Sklubot server and web app.
 * Type-only: the web app imports this file with `import type`.
 */

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
export interface Origin { kind: "bot" | "routine" | "voice" | "webhook" | "nudge" | "member" | "email"; id: string; name: string }

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
   * pick the work back up.
   */
  | { kind: "notice"; tone: "info" | "warn" | "error"; text: string; action?: { kind: "continue"; status: "pending" | "done"; reason?: "timeout" | "busy" } | { kind: "settings"; section: string } };

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
  | { type: "disk"; checkId: string; usedPct: number; totalBytes: number; freeBytes: number; items: { path: string; bytes: number }[]; status: "pending" | "cleaned" | "dismissed"; deleted?: string[]; freedBytes?: number };

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
export interface Skill extends SkillExtras { id: string; botId: string; name: string; description: string; body: string; shared: boolean; learned: boolean; outside: boolean; createdAt: number; updatedAt: number }
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
export const STT_PROVIDERS = ["whisper-cpp", "openai"] as const;
export const TTS_PROVIDERS = ["piper", "openai"] as const;
export type SttProvider = (typeof STT_PROVIDERS)[number];
export type TtsProvider = (typeof TTS_PROVIDERS)[number];
/** `url`: the service's base address ("" = the server's own setting); `hasKey`: an API key is saved (sealed) for it. */
export interface VoiceSettings {
  mode: "auto" | "server" | "browser";
  stt: { provider: SttProvider; url: string; model: string; language: string; hasKey: boolean };
  tts: { provider: TtsProvider; url: string; model: string; voice: string; hasKey: boolean };
  /** Barge-in sensitivity: how loud (0-1 scale) and how long (ms) the user must speak to cut the bot off. */
  bargeIn: { enabled: boolean; minSpeechMs: number };
}
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
