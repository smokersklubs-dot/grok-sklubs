import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, "..", "..");

/** Minimal .env loader: KEY=value lines, optional quotes, existing environment wins. */
function loadDotEnv(file: string) {
  if (!existsSync(file)) return;
  for (const raw of readFileSync(file, "utf8").split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = value;
  }
}
loadDotEnv(path.join(ROOT, ".env"));

const num = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return process.env[name] && Number.isFinite(v) ? v : fallback;
};
const flag = (name: string, fallback = false) => (process.env[name] === undefined ? fallback : process.env[name] === "1" || process.env[name] === "true");

const dataDir = path.resolve(process.env.DATA_DIR ?? path.join(ROOT, "data"));

export const config = {
  port: num("PORT", 8787),
  dataDir,
  dbPath: process.env.DB_PATH ?? path.join(dataDir, "sklubot.db"),
  workspaceDir: path.join(dataDir, "workspaces"),
  profileDir: path.join(dataDir, "profiles"),
  publicUrl: (process.env.PUBLIC_URL ?? `http://localhost:${num("PORT", 8787)}`).replace(/\/$/, ""),
  sessionSecret: process.env.SESSION_SECRET ?? "",
  /** New accounts: always allowed while no account exists; afterwards only when this is on. */
  openSignup: flag("OPEN_SIGNUP"),
  /** When set, only these addresses may create an account (comma-separated). */
  allowedEmails: (process.env.ALLOWED_EMAILS ?? "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
  /**
   * One-time setup code (written by deploy/install.sh as SKLUBOT_SETUP_CODE): while no account exists, the
   * first sign-up must give it, so a stranger who finds a fresh install cannot claim it. Empty = not needed.
   */
  setupCode: (process.env.SETUP_CODE ?? process.env.SKLUBOT_SETUP_CODE ?? "").trim(),
  /** Behind our own reverse proxy (Caddy, Traefik): the client address is the last entry it adds to X-Forwarded-For. */
  trustProxy: flag("TRUST_PROXY"),
  schedulerOff: flag("NO_SCHEDULER"),
  /** Commands in the bots' own Linux computers: on unless SHELL_ENABLED=0. */
  shellEnabled: flag("SHELL_ENABLED", true),
  /**
   * Without a container runtime a command would run on this server itself. That is only offered when
   * SHELL_ENABLED=1 is set explicitly, and then every command asks the user first.
   */
  hostShell: process.env.SHELL_ENABLED === "1" || process.env.SHELL_ENABLED === "true",
  maxSteps: num("MAX_STEPS", 60),
  maxDesktops: num("MAX_DESKTOPS", 4),
  /**
   * When every awake computer is busy and one more must wake: how long to wait for one to become idle (it is then put to
   * sleep). A busy computer is never put to sleep; past this wait the wake fails with a clear message instead.
   */
  computerWaitMs: Math.max(0, num("COMPUTER_WAIT_SEC", 90)) * 1000,
  desktopIdleMin: num("DESKTOP_IDLE_MIN", 20),
  /** "linux" = a container per bot, "browser" = a browser on this server, "auto" = linux when available. */
  computer: (process.env.COMPUTER ?? "auto") as "auto" | "linux" | "browser",
  desktopImage: process.env.DESKTOP_IMAGE ?? "sklubot-desktop",
  /** Docker network the bots' computers join (set when Sklubot itself runs in a container). */
  desktopNetwork: process.env.DESKTOP_NETWORK ?? "",
  /** How a bot's computer reaches this server's tool endpoint (for bots running on a subscription). */
  engineBaseUrl: (process.env.ENGINE_BASE_URL ?? `http://host.docker.internal:${num("PORT", 8787)}`).replace(/\/$/, ""),
  /** Model choices offered for Codex (ChatGPT subscription); "default" lets Codex pick. */
  codexModels: (process.env.CODEX_MODELS ?? "default").split(",").map((s) => s.trim()).filter(Boolean),
  /** Model choices offered for Claude Code (Claude subscription): aliases the tool accepts. */
  claudeCodeModels: (process.env.CLAUDE_CODE_MODELS ?? "sonnet,opus,fable,haiku").split(",").map((s) => s.trim()).filter(Boolean),
  /**
   * Longest a turn on a subscription tool (Claude Code, Codex) may run, in minutes: past it the tool is stopped, what it
   * did so far is kept, and the user can continue. 0 = no limit.
   */
  engineTurnTimeoutMs: Math.max(0, num("ENGINE_TURN_TIMEOUT_MINUTES", 60)) * 60_000,
  /**
   * bot_message with wait: true (ask another bot and wait for its answer in the same turn). The default wait, and the
   * most a bot may ask for, in seconds. Past it the answer still arrives later, as a message, like an ordinary bot_message.
   */
  botWaitDefaultSec: Math.max(10, num("BOT_WAIT_DEFAULT_SECONDS", 180)),
  botWaitMaxSec: Math.max(10, num("BOT_WAIT_MAX_SECONDS", 600)),
  /** Disk use of a bot's computer (%, of the disk its home folder is on) from which a "disk full" card is shown. */
  diskAlertPct: Math.min(99, Math.max(50, num("DISK_ALERT_PERCENT", 90))),
  /** When Sklubot itself runs in a container: the name of the Docker volume mounted as its data folder, so bots' computers can share their library with it. */
  dataVolume: process.env.DATA_VOLUME ?? "",
  desktopMemory: process.env.DESKTOP_MEMORY ?? "2g",
  desktopCpus: num("DESKTOP_CPUS", 2),
  desktopResolution: process.env.DESKTOP_RESOLUTION ?? "1280x800x24",
  /** Keyboard layout of the bots' computers (an X layout name: "us", "fr", "de"…). Applied when a computer is created. */
  desktopKeyboard: /^[a-z0-9_,()-]{1,40}$/.test(process.env.DESKTOP_KEYBOARD ?? "") ? process.env.DESKTOP_KEYBOARD! : "us",
  compactChars: num("COMPACT_CHARS", 300_000),
  compactKeepTurns: num("COMPACT_KEEP_TURNS", 4),
  consolidateIdleMin: num("CONSOLIDATE_IDLE_MIN", 10),
  promptMemoryChars: num("PROMPT_MEMORY_CHARS", 4000),
  auxModel: process.env.AUX_MODEL ?? "",
  /**
   * Backup models, in order, for accounts that set none of their own (Settings → Models): FALLBACK_MODELS is a
   * comma-separated list; the older single FALLBACK_MODEL is still read and goes last.
   */
  fallbackModels: [...new Set([...(process.env.FALLBACK_MODELS ?? "").split(","), process.env.FALLBACK_MODEL ?? ""].map((s) => s.trim()).filter(Boolean))],
  /** First wait before a new try of a failing model; it doubles each time (with jitter), up to retryMaxWaitMs. */
  retryBaseMs: num("RETRY_BASE_MS", 1000),
  /** Longest wait before a new try. A Retry-After longer than this moves on to the next model instead of waiting. */
  retryMaxWaitMs: num("RETRY_MAX_WAIT_MS", 60_000),
  /** Work left waiting (an open approval, a turn still running) for this long gets one reminder. */
  stuckReminderMs: num("STUCK_REMINDER_HOURS", 4) * 3_600_000,
  /**
   * An approval asked inside a subscription turn lapses after this long without an answer: 25 minutes by default, kept
   * under the 30-minute tool timeout given to the subscription tools (see engine.ts).
   */
  approvalExpireMs: num("APPROVAL_EXPIRE_MIN", 25) * 60_000,
  /** The first bot every new account gets: its name and role (empty = the defaults, "Juno" and "Chief of staff"). */
  firstBotName: (process.env.FIRST_BOT_NAME ?? "").trim().slice(0, 60),
  firstBotLabel: (process.env.FIRST_BOT_LABEL ?? "").trim().slice(0, 60),
  /** Most agent bots this installation holds, all accounts together (group chats and hidden helpers not counted). 0 = no limit. */
  maxBots: Math.max(0, Math.floor(num("MAX_BOTS", 0))),
  /** Shortest gap between two progress updates of one bot. */
  progressGapMs: num("PROGRESS_GAP_S", 20) * 1000,
  /** At most this many bots created by bots (bot_create) per user in 24 hours. */
  botCreatePerDay: num("BOT_CREATE_PER_DAY", 3),
  /** Anti-loop: stop after this many failures in a row of the same tool, or this many identical results in a row. */
  loopFailStreak: num("LOOP_FAIL_STREAK", 4),
  loopSameResult: num("LOOP_SAME_RESULT", 4),
  /** x_search: the X API v2 (with X_BEARER_TOKEN) and xAI's API (with XAI_API_KEY). Base URLs can point elsewhere for tests. */
  xApiBaseUrl: (process.env.X_API_BASE_URL ?? "https://api.x.com").replace(/\/$/, ""),
  xaiSearchModel: process.env.XAI_SEARCH_MODEL ?? "grok-4.7",
  telegramApi: (process.env.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/$/, ""),
  webDist: path.join(ROOT, "web", "dist"),
  // ── Wave 6 ──
  /** Seats a new workspace starts with, and the most an owner may set. */
  workspaceSeats: Math.max(1, num("WORKSPACE_SEATS", 10)),
  workspaceMaxSeats: Math.max(1, num("WORKSPACE_MAX_SEATS", 50)),
  /**
   * The bots' own email addresses: the (sub)domain whose MX record points to this server, and the port the embedded SMTP
   * receiver listens on (0 = off; 25 inside the container, published only when the operator opts in).
   */
  mailDomain: (process.env.MAIL_DOMAIN ?? "").trim().toLowerCase(),
  mailSmtpPort: num("MAIL_SMTP_PORT", 0),
  mailSmtpHost: process.env.MAIL_SMTP_HOST ?? "0.0.0.0",
  /** Host name the receiver announces (banner, Authentication-Results); defaults to the mail domain. */
  mailHostname: (process.env.MAIL_HOSTNAME ?? process.env.MAIL_DOMAIN ?? "").trim().toLowerCase(),
  /** Largest message accepted (bytes), and how many messages one sending address may deliver per hour. */
  mailMaxBytes: num("MAIL_MAX_BYTES", 10 * 1024 * 1024),
  mailPerSenderHour: num("MAIL_PER_SENDER_HOUR", 30),
  mailPerIpMinute: num("MAIL_PER_IP_MINUTE", 20),
  /** Optional TLS certificate and key files (PEM) for STARTTLS on the receiver. Without them, mail arrives in clear. */
  mailTlsCert: process.env.MAIL_TLS_CERT ?? "",
  mailTlsKey: process.env.MAIL_TLS_KEY ?? "",
  /** Server-mediated voice: the self-hosted speech services (internal addresses, set by the operator) and OpenAI's API. */
  voiceSttUrl: (process.env.VOICE_STT_URL ?? "").replace(/\/$/, ""),
  voiceTtsUrl: (process.env.VOICE_TTS_URL ?? "").replace(/\/$/, ""),
  voiceSttProvider: (process.env.VOICE_STT_PROVIDER ?? "whisper-cpp") as "whisper-cpp" | "openai",
  voiceTtsProvider: (process.env.VOICE_TTS_PROVIDER ?? "piper") as "piper" | "openai",
  openaiAudioUrl: (process.env.OPENAI_AUDIO_URL ?? "https://api.openai.com").replace(/\/$/, ""),
};

export function assertConfig() {
  if (config.sessionSecret.length < 16)
    throw new Error("SESSION_SECRET is missing or too short. Generate one with: openssl rand -hex 32");
}
