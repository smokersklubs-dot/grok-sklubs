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
  schedulerOff: flag("NO_SCHEDULER"),
  shellEnabled: flag("SHELL_ENABLED", true),
  maxSteps: num("MAX_STEPS", 60),
  maxDesktops: num("MAX_DESKTOPS", 4),
  desktopIdleMin: num("DESKTOP_IDLE_MIN", 20),
  /** "linux" = a container per bot, "browser" = a browser on this server, "auto" = linux when available. */
  computer: (process.env.COMPUTER ?? "auto") as "auto" | "linux" | "browser",
  desktopImage: process.env.DESKTOP_IMAGE ?? "sklubot-desktop",
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
  webDist: path.join(ROOT, "web", "dist"),
};

export function assertConfig() {
  if (config.sessionSecret.length < 16)
    throw new Error("SESSION_SECRET is missing or too short. Generate one with: openssl rand -hex 32");
}
