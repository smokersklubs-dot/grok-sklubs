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
  /** When Sklubot itself runs in a container: the name of the Docker volume mounted as its data folder, so bots' computers can share their library with it. */
  dataVolume: process.env.DATA_VOLUME ?? "",
  desktopMemory: process.env.DESKTOP_MEMORY ?? "2g",
  desktopCpus: num("DESKTOP_CPUS", 2),
  desktopResolution: process.env.DESKTOP_RESOLUTION ?? "1280x800x24",
  compactChars: num("COMPACT_CHARS", 300_000),
  compactKeepTurns: num("COMPACT_KEEP_TURNS", 4),
  consolidateIdleMin: num("CONSOLIDATE_IDLE_MIN", 10),
  promptMemoryChars: num("PROMPT_MEMORY_CHARS", 4000),
  auxModel: process.env.AUX_MODEL ?? "",
  /** Model to switch to for one turn when the bot's own model is unreachable. */
  fallbackModel: process.env.FALLBACK_MODEL ?? "",
  telegramApi: (process.env.TELEGRAM_API_URL ?? "https://api.telegram.org").replace(/\/$/, ""),
  webDist: path.join(ROOT, "web", "dist"),
};

export function assertConfig() {
  if (config.sessionSecret.length < 16)
    throw new Error("SESSION_SECRET is missing or too short. Generate one with: openssl rand -hex 32");
}
