import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { now } from "./store.js";
import { noteSignal } from "./sentinel/signals.js";
import type { ClickTarget } from "./computer.js";
import type { ElementAnswer, ElementRequest, ElementSnapshot } from "./screen-elements.js";
import type { HeldDownload } from "./browser-downloads.js";
import { BROWSER_PY, browserTrouble, dialogWords, tabNote, type BrowserAnswer, type GuardedClick } from "./browser-cdp.js";
import { refreshImageSandbox, sandboxRunArgs, sandboxSpec } from "./browsersandbox.js";

/**
 * A real Linux computer per bot: one container each, with a graphical desktop, a browser, a terminal
 * and a root shell. The bot's home folder lives in a volume, so installed tools, browser logins and
 * files survive sleep and restarts. Idle computers are stopped ("asleep") and started again on demand.
 */

export interface Exec { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean }

/** Whether a failed docker call's error is about Docker itself: refused by Sklubot's proxy, or Docker unreachable. */
export function dockerTrouble(stderr: string): "proxy_refused" | "daemon_unreachable" | null {
  if (/Refused by Sklubot's Docker proxy/.test(stderr)) return "proxy_refused";
  if (/Cannot connect to the Docker daemon|error during connect|spawn docker ENOENT/.test(stderr)) return "daemon_unreachable";
  return null;
}

/** Runs the docker CLI without a shell, so no argument is ever interpreted. */
type OutputSink = (chunk: Buffer) => Promise<void>;
export function docker(args: string[], opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number; input?: string; output?: OutputSink } = {}): Promise<Exec> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    // A command that exits before reading its input raises EPIPE on it; that is not worth crashing over.
    if (opts.input !== undefined) { child.stdin!.on("error", () => {}); child.stdin!.end(opts.input); }
    const chunks: Buffer[] = [];
    let size = 0, stderr = "", timedOut = false;
    const max = opts.maxBytes ?? 20_000_000;
    let writeError = "";
    const sink = opts.output;
    const writing = sink ? (async () => {
      try {
        for await (const chunk of child.stdout!) {
          size += chunk.length;
          if (size > max) throw Error("VIDEO_TOO_LARGE");
          await sink(chunk);
        }
      } catch (err) { writeError = String(err); child.kill("SIGKILL"); }
    })() : undefined;
    if (!sink) child.stdout!.on("data", (c: Buffer) => { size += c.length; chunks.push(c); while (size > max && chunks.length > 1) size -= chunks.shift()!.length; });
    child.stderr!.on("data", (c: Buffer) => { stderr = (stderr + c.toString("utf8")).slice(-8000); });
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", kill, { once: true });
    const done = (code: number | null) => {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", kill);
      // The Sentinelle counts Docker calls refused by Sklubot's proxy or that cannot reach Docker at all (not a command's own failure).
      if (code !== 0) { const cls = dockerTrouble(stderr); if (cls) noteSignal("docker_error", cls); }
      resolve({ code, stdout: Buffer.concat(chunks), stderr, timedOut });
    };
    child.on("error", (err) => { stderr = String(err.message); done(null); });
    child.on("close", async code => {
      await writing;
      if (writeError) { stderr = writeError; done(1); }
      else done(code);
    });
  });
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
/**
 * A computer is known by its key: a bot's own computer by the bot's id, a shared computer (Part B) by its own id
 * (sharedcomputers.ts). Container and home volume are named after the key.
 */
const nameOf = (key: string) => `sklubot-${safeId(key)}`;
const volumeOf = (key: string) => `sklubot-home-${safeId(key)}`;

// ── Which computer a bot uses (Part B: shared computers) ─────────────────────
export interface ComputerAllocator {
  /** The computer a bot works on right now, or last worked on (never waits): for views that never wake a computer. */
  current(botId: string): string;
  /**
   * Takes the computer for one call (or a whole subscription turn, see holdComputer): the bot's own one at once; a shared
   * one when it is free (another bot driving it makes this wait). Re-entrant for the same bot. Call `release` once.
   */
  acquire(botId: string, userId: string): Promise<{ key: string; release: () => void }>;
  /** The bots whose libraries a computer mounts (own computer: the bot itself). */
  members(key: string): string[];
  isShared(key: string): boolean;
  /** Whether the bot may stop the processes it runs there (a shared computer driven by another bot: no). */
  mayControl(botId: string): boolean;
}
const ownComputers: ComputerAllocator = {
  current: (botId) => botId, acquire: async (botId) => ({ key: botId, release: () => {} }), members: (key) => [key], isShared: () => false, mayControl: () => true,
};
let allocator: ComputerAllocator = ownComputers;
/** Set once at start-up by sharedcomputers.ts (null: every bot has its own computer, as in tests). */
export const setComputerAllocator = (a: ComputerAllocator | null) => { allocator = a ?? ownComputers; };
/** The key of the computer the bot uses now (or last used). */
export const machineOf = (botId: string) => allocator.current(botId);
export const isSharedMachine = (key: string) => allocator.isShared(key);
/** The bots a computer serves (own computer: the bot; shared: its account's shared bots; free computer: its one bot). */
export const machineMembers = (key: string) => allocator.members(key);
/** Memory and CPUs of a computer when it is made (freecomputers.ts: smaller ones); null: DESKTOP_MEMORY / DESKTOP_CPUS. */
let runLimitsOf: (key: string) => { memory: string; cpus: number } | null = () => null;
export const setRunLimits = (fn: typeof runLimitsOf) => { runLimitsOf = fn; };
export const mayControlProcesses = (botId: string) => allocator.mayControl(botId);
/** The container the bot's commands go to: its own computer, or the shared one it works on. */
export const containerName = (botId: string) => nameOf(allocator.current(botId));
/** The container of a computer given by its key (shared computers' views). */
export const containerOfKey = (key: string) => nameOf(key);
/** A bot's library folder on this server (computer.ts workspaceOf), for mounting the libraries of a shared computer. */
let workspaceOfBot: (botId: string) => string = (botId) => path.join(config.workspaceDir, safeId(botId));
export const setWorkspaceSource = (fn: (botId: string) => string) => { workspaceOfBot = fn; };

/** True when a container runtime answers and the desktop image has been built. */
export async function linuxReady(): Promise<{ ok: boolean; reason: string }> {
  const info = await docker(["version", "--format", "{{.Server.Version}}"], { timeoutMs: 8000 });
  if (info.code !== 0) return { ok: false, reason: "Docker is not installed or not running" };
  const image = await docker(["image", "inspect", config.desktopImage, "--format", "{{.Id}}"], { timeoutMs: 8000 });
  if (image.code !== 0) return { ok: false, reason: `the desktop image "${config.desktopImage}" has not been built yet (run: npm run computer:build)` };
  return { ok: true, reason: "" };
}

/**
 * How the bot's library folder reaches its computer. Normally it is a plain folder on this machine.
 * When Sklubot runs in a container, that folder only exists inside a Docker volume, so the same
 * sub-folder of that volume is mounted instead.
 */
function libraryMount(workspace: string, dst = "/root/files", readonly = false): string[] {
  if (!config.dataVolume) return ["-v", `${workspace}:${dst}${readonly ? ":ro" : ""}`];
  const sub = path.relative(config.dataDir, workspace).split(path.sep).join("/");
  return ["--mount", `type=volume,src=${config.dataVolume},dst=${dst},volume-subpath=${sub}${readonly ? ",readonly" : ""}`];
}

// ── The bots' own way to this server (H2) ────────────────────────────────────
/**
 * In "socket" mode (config.botLink) each computer gets a folder of this server's data, mounted read-only at /run/sklubot,
 * holding a Unix socket that only answers that computer's bots (botlink.ts). A forwarder inside the computer (socat,
 * already in the desktop image: `socat TCP-LISTEN:<port>,bind=127.0.0.1,reuseaddr,fork UNIX-CONNECT:<socket>`, options
 * from `socat -hh`, socat 1.7.4) offers it on 127.0.0.1 to Claude Code, Codex and sklubot-api.
 */
export const BOT_LINK_MOUNT = "/run/sklubot";
export const botLinkDir = (key: string) => path.join(config.dataDir, "botlink", safeId(key));
/** Where the computers' programs reach this server's tool endpoint and credential relay. */
export const botBaseUrl = () => (config.botLink === "socket" ? `http://127.0.0.1:${config.botLinkPort}` : config.engineBaseUrl);
let ensureLink: (key: string) => Promise<void> = async (key) => { if (config.botLink === "socket") mkdirSync(botLinkDir(key), { recursive: true }); };
/** Set at start-up by botlink.ts: opens (or reopens) the socket of a computer. */
export const setBotLinkOpener = (fn: (key: string) => Promise<void>) => { ensureLink = fn; };
const linkMount = (key: string): string[] =>
  config.botLink !== "socket" ? []
    : config.dataVolume ? ["--mount", `type=volume,src=${config.dataVolume},dst=${BOT_LINK_MOUNT},readonly,volume-subpath=botlink/${safeId(key)}`]
    : ["-v", `${botLinkDir(key)}:${BOT_LINK_MOUNT}:ro`];
const startForwarder = (key: string) => config.botLink !== "socket" ? Promise.resolve()
  : docker(["exec", "-d", nameOf(key), "socat", `TCP-LISTEN:${config.botLinkPort},bind=127.0.0.1,reuseaddr,fork`, `UNIX-CONNECT:${BOT_LINK_MOUNT}/s.sock`], { timeoutMs: 15_000 }).then(() => {});

/**
 * The computers' network in "socket" mode: a bridge whose containers cannot reach each other
 * (`com.docker.network.bridge.enable_icc=false`), with a fixed interface name so the optional host firewall rules of
 * deploy/install.sh can name it (`com.docker.network.bridge.name`) — both are documented bridge driver options:
 * https://docs.docker.com/engine/network/drivers/bridge/#options. Sklubot's server is not on it. Made once if missing.
 */
export async function ensureBotsNetwork(): Promise<string | null> {
  if (config.botLink !== "socket") return null;
  const name = config.botsNetwork;
  const r = await docker(["network", "inspect", name, "--format", "{{json .Options}}"], { timeoutMs: 10_000 });
  if (r.code === 0) {
    let opts: Record<string, string> = {};
    try { opts = JSON.parse(r.stdout.toString("utf8")) ?? {}; } catch { /* unreadable */ }
    return opts["com.docker.network.bridge.enable_icc"] === "false" ? null
      : `the network ${name} already exists without com.docker.network.bridge.enable_icc=false: the bots' computers can reach each other on it. Remove it (docker network rm ${name}) while no computer runs, and Sklubot makes it again.`;
  }
  const made = await docker(["network", "create", "--driver", "bridge", "-o", "com.docker.network.bridge.enable_icc=false", "-o", "com.docker.network.bridge.name=sklubot-bots", "--label", "sklubot=bots", name], { timeoutMs: 20_000 });
  if (made.code !== 0) throw new Error(`could not create the bots' network ${name}: ${made.stderr.trim().slice(0, 300)}`);
  return null;
}

// ── The team folder (wave 8) ─────────────────────────────────────────────────
/**
 * The account's team folder for a bot's computer: a folder of this server's data (per account, see computer.ts
 * teamDirOf), mounted at /root/team the same way as the library. Null: none for this bot (switched off, not an agent of
 * that account, an invented bot of the desk test). Set once at start-up by computer.ts.
 */
let teamFolderOf: (botId: string, userId: string) => string | null = () => null;
export const setTeamFolderSource = (fn: (botId: string, userId: string) => string | null) => { teamFolderOf = fn; };
/** The team folder of a computer: its bot's; for a shared computer, its account's when one of its bots has it. */
const teamOfKey = (key: string, userId: string) => {
  for (const m of allocator.members(key)) { const t = teamFolderOf(m, userId); if (t) return t; }
  return null;
};
/** The label a computer carries: whether it was made with the team folder ("1") or not ("0"; absent on older ones). */
export const TEAM_LABEL = "sklubot.team";
/**
 * What a computer was made with, besides the team folder: its way to this server (H2), its runtime, and for a shared
 * computer the libraries it mounts. A computer whose label differs (or that has none: made before this label) is made
 * again from the image when it is not in use — its home volume is kept, like for the team folder.
 */
export const SPEC_LABEL = "sklubot.spec";
const specOf = (key: string) => {
  const link = config.botLink === "socket" ? `socket:${config.botsNetwork}` : `net:${config.desktopNetwork || "host"}`;
  const libs = allocator.isShared(key) ? `;libs:${[...allocator.members(key)].sort().join(",")}` : "";
  // L48: `;sb:<profile hash>` once the image runs its browser sandboxed (browsersandbox.ts).
  return `${link};rt:${config.desktopRuntime || "default"}${libs}${sandboxSpec()}`;
};
/** Each computer's team label, by container name, in one call (for the library view). */
export async function teamLabels(): Promise<Map<string, string>> {
  const r = await docker(["ps", "-a", "--filter", "label=sklubot=desktop", "--format", `{{.Names}}\t{{.Label "${TEAM_LABEL}"}}`], { timeoutMs: 10_000 });
  const out = new Map<string, string>();
  for (const line of r.stdout.toString("utf8").split("\n")) { const [name, label] = line.split("\t"); if (name) out.set(name, (label ?? "").trim()); }
  return out;
}
const labelsOf = async (key: string): Promise<Record<string, string> | null> => {
  const r = await docker(["inspect", "--format", "{{json .Config.Labels}}", nameOf(key)], { timeoutMs: 8000 });
  if (r.code !== 0) return null;
  try { return JSON.parse(r.stdout.toString("utf8")) ?? {}; } catch { return {}; }
};

// ── Dressing: each computer looks like its bot's own ─────────────────────────
const HEX: Record<string, string> = {
  ink: "#3a4150", clay: "#a9634a", ember: "#dd5230", amber: "#c08310", moss: "#5a8739", teal: "#138a84",
  sky: "#2c86cf", indigo: "#525dd6", plum: "#8c4ba6", rose: "#cf4576", slate: "#607086",
};
export interface Look { name: string; label: string; color: string; locale: string; owner: string; /** Character type, drawn on the home page. */ kind?: string }
let lookOf: (botId: string) => Look | null = () => null;
/** Tells this module how to find a computer's name, colour and owner by its key (set once at start-up): a bot's, or a shared computer's. */
export const setLookSource = (fn: (botId: string) => Look | null) => { lookOf = fn; };
/** Looks given directly, for computers of bots that are not in the database (the desk test's invented bots). */
const lookOverrides = new Map<string, Look>();
export const setLookOverride = (botId: string, look: Look | null) => { if (look) lookOverrides.set(botId, look); else lookOverrides.delete(botId); };
const currentLook = (botId: string) => lookOverrides.get(botId) ?? lookOf(botId);
/**
 * What dress.py receives. The bot's id travels along: the wallpaper's doodles are laid out from it (B-1), so a renamed
 * bot keeps the same arrangement and only a new colour changes the tints.
 */
const lookPayload = (botId: string, look: Look) => JSON.stringify({ ...look, color: HEX[look.color] ?? look.color, id: botId });

/** The look last applied to each computer by this server process. */
const dressedWith = new Map<string, string>();
/** A dressing under way per bot: every caller waits for the same attempt (U-005). */
const dressing = new Map<string, Promise<void>>();
type DressRunner = (botId: string, payload: string) => Promise<{ code: number | null; stderr: string }>;
let dressRunner: DressRunner = (botId, payload) => docker(["exec", "-i", nameOf(botId), "python3", "/opt/sklubot/dress.py"], { timeoutMs: 60_000, input: payload });
/** For tests: replace what applies a look (null puts the real one back). */
export const setDressRunner = (fn: DressRunner | null) => { dressRunner = fn ?? ((botId, payload) => docker(["exec", "-i", nameOf(botId), "python3", "/opt/sklubot/dress.py"], { timeoutMs: 60_000, input: payload })); };

/**
 * Applies the bot's look to its computer, once per bot and per server run (U-005): concurrent callers share one
 * attempt; a success is remembered (until the look changes or the computer sleeps); a failure is logged and forgotten,
 * so the next request tries again. `force`: apply even if this look was applied already (dress.py still only redoes
 * what changed or died, see its fast path).
 */
export function ensureDressed(botId: string, force = false): Promise<void> {
  const look = currentLook(botId);
  if (!look) return Promise.resolve();
  const payload = lookPayload(botId, look);
  const inflight = dressing.get(botId);
  if (inflight) return force ? inflight.catch(() => {}).then(() => ensureDressed(botId, true)) : inflight;
  if (!force && dressedWith.get(botId) === payload) return Promise.resolve();
  const job = (async () => {
    const r = await dressRunner(botId, payload);
    if (r.code !== 0) throw new Error(`could not dress the screen: ${r.stderr.trim().slice(0, 300) || `exit ${r.code}`}`);
    dressedWith.set(botId, payload);
  })();
  dressing.set(botId, job);
  job.catch((err) => { dressedWith.delete(botId); console.error(`[dress ${botId}]`, (err as Error).message); })
    .finally(() => { if (dressing.get(botId) === job) dressing.delete(botId); });
  return job;
}
const dress = (botId: string) => ensureDressed(botId);

/** Capabilities a bot's computer keeps (Docker's defaults minus MKNOD, NET_RAW, SYS_CHROOT, SETPCAP, SETFCAP, FSETID, NET_BIND_SERVICE). */
export const COMPUTER_CAPS = ["CHOWN", "DAC_OVERRIDE", "FOWNER", "SETUID", "SETGID", "KILL", "AUDIT_WRITE"];

export type Power = "running" | "asleep" | "absent";
interface Machine {
  /** The computer's key (a bot's id, or a shared computer's id). */
  key: string; userId: string; lastUsedAt: number; busy: number; power: Power;
  /** When the container was last seen running (checked again after 120 s). */ verifiedAt?: number;
  /** The spec label read from the container in this server run (undefined: not checked yet, e.g. adopted after a restart). */ spec?: string;
  /** Shared computer: the bot whose library /root/files points at now. */ filesFor?: string;
}
const machines = new Map<string, Machine>();
/** The spec label each computer was really made with, as last read or set by wake (a computer in use keeps its old one). */
const madeWith = new Map<string, string>();
const starting = new Map<string, Promise<void>>();
let changed: (userId: string) => void = () => {};
export const onMachinesChanged = (fn: (userId: string) => void) => { changed = fn; };
/** Told when a computer was just started (from asleep or made anew), e.g. to check its disk (disk.ts): once per bot using it. */
const wokenListeners: ((botId: string, userId: string) => void)[] = [];
const woken = (key: string, userId: string) => { for (const botId of allocator.members(key)) for (const fn of wokenListeners) { try { fn(botId, userId); } catch (err) { console.error("[woken]", err); } } };
export const onComputerWoken = (fn: (botId: string, userId: string) => void) => { wokenListeners.push(fn); };

const powerOfKey = async (key: string): Promise<Power> => {
  const r = await docker(["inspect", "--format", "{{.State.Running}}", nameOf(key)], { timeoutMs: 8000 });
  return r.code !== 0 ? "absent" : r.stdout.toString().trim() === "true" ? "running" : "asleep";
};
/** Whether the computer the bot uses (its own, or the shared one it works on) is on. */
export const powerOf = (botId: string): Promise<Power> => powerOfKey(allocator.current(botId));

function note(key: string, userId: string, power: Power): Machine {
  let m = machines.get(key);
  if (!m) machines.set(key, (m = { key, userId, lastUsedAt: now(), busy: 0, power }));
  if (m.power !== power) { m.power = power; changed(userId); }
  return m;
}

/** Computers being put to sleep right now: they no longer count as awake, and nobody picks them twice. */
const stopping = new Set<string>();
/** Computers allowed to wake (room was made for them) that are still starting: they count as awake already. */
const reserved = new Set<string>();

/** Told just before a computer goes to sleep or is wiped: what runs in it stops (local tool servers, localtools.ts), per bot. */
const stoppingListeners: ((botId: string) => void)[] = [];
export const onComputerStopping = (fn: (botId: string) => void) => { stoppingListeners.push(fn); };
const tellStopping = (key: string) => { for (const botId of allocator.members(key)) for (const fn of stoppingListeners) { try { fn(botId); } catch (err) { console.error("[computer stopping]", err); } } };

async function sleepMachine(key: string) {
  const m = machines.get(key);
  tellStopping(key);
  stopping.add(key);
  try {
    await docker(["stop", "-t", "3", nameOf(key)], { timeoutMs: 30_000 });
    dressedWith.delete(key);
    if (m) { m.filesFor = undefined; note(key, m.userId, "asleep"); }
  } finally { stopping.delete(key); }
}

/** Hosted mode (hosted.ts): how many computers an account may keep awake, and the error when they are all busy. */
let awakeLimitOf: (userId: string) => { max: number; error: () => Error } | null = () => null;
export const setAwakeLimit = (fn: typeof awakeLimitOf) => { awakeLimitOf = fn; };
/** L95 (computerhours.ts): an account past its computer hours gets this error instead of a computer that is asleep. */
let wakeGate: (userId: string) => Error | null = () => null;
export const setWakeGate = (fn: typeof wakeGate) => { wakeGate = fn; };
/** Computers allowed to start under an account's own limit, not running yet (key → account). */
const accountReserved = new Map<string, string>();

/** All the awake computers are busy and none could be put to sleep in time. Nothing was evicted. */
export class ComputersBusyError extends Error {
  constructor(readonly max: number) {
    super(`All ${max} computers are busy right now, and a busy computer is never put to sleep. Try again in a few minutes, or raise MAX_DESKTOPS on the server.`);
    this.name = "ComputersBusyError";
  }
}

/**
 * Makes room for one more awake computer (or browser) without ever stopping one that is busy (a tool call, a command,
 * or a whole Claude Code / Codex turn in it). Under the limit: the slot is taken at once (`take`, synchronous, so two
 * callers can never both take the last slot). At the limit: the least recently used idle one is put to sleep (`pick`
 * marks it synchronously, `free` stops it). All busy: waits, checking every `stepMs`, for up to `waitMs`; past that,
 * ComputersBusyError. We wait rather than go over the limit: on a small server each computer holds its memory
 * (DESKTOP_MEMORY, 2 GB by default), and one too many can push the whole machine out of memory. SuperBot only ever stops
 * the screen of a bot that is not working, and gives up at once when it cannot (superbot server/src/screen.rs:78-107);
 * here a short wait comes first, since a busy computer often frees up within seconds.
 */
export async function makeRoom<T extends { busy: number; lastUsedAt: number }>(o: {
  max: number; awake: () => T[]; take: () => void; pick: (victim: T) => void; free: (victim: T) => Promise<void>; waitMs: number; stepMs?: number;
}): Promise<void> {
  const deadline = Date.now() + o.waitMs;
  for (;;) {
    const awake = o.awake();
    if (awake.length < o.max) { o.take(); return; }
    const victim = [...awake].sort((a, b) => a.lastUsedAt - b.lastUsedAt).find((m) => m.busy === 0);
    if (victim) { o.pick(victim); o.take(); await o.free(victim); return; }
    if (Date.now() >= deadline) throw new ComputersBusyError(o.max);
    await new Promise((r) => setTimeout(r, Math.min(o.stepMs ?? 1000, Math.max(1, deadline - Date.now()))));
  }
}

// ── M2: an optional size limit for each computer's own disk layer ────────────
/**
 * `docker run --storage-opt size=<quota>` (docs.docker.com/reference/cli/docker/container/run/#storage-opt): "only
 * available for the devicemapper, btrfs, overlay2, windowsfilter, and zfs storage drivers. For the overlay2 storage
 * driver, the size option is only available if the backing filesystem is xfs and mounted with the pquota mount option."
 * `docker info` names the driver and the backing filesystem (not the pquota option): overlay2 on xfs, btrfs and zfs are
 * tried; when Docker still refuses the option, the computer is made without it and the quota is not tried again.
 */
let quotaSupport: boolean | null = null;
export const resetQuotaSupport = () => { quotaSupport = null; };
export function quotaPossible(driver: string, backing: string): boolean {
  const d = driver.trim().toLowerCase();
  return d === "btrfs" || d === "zfs" || (d === "overlay2" && backing.trim().toLowerCase() === "xfs");
}
async function quotaArgs(): Promise<string[]> {
  if (!config.desktopDiskQuota) return [];
  if (quotaSupport === null) {
    const r = await docker(["info", "--format", "{{.Driver}}\t{{json .DriverStatus}}"], { timeoutMs: 10_000 });
    const [driver = "", status = "[]"] = r.stdout.toString("utf8").trim().split("\t");
    let backing = "";
    try { backing = (JSON.parse(status) as string[][]).find((p) => p[0] === "Backing Filesystem")?.[1] ?? ""; } catch { /* none */ }
    quotaSupport = r.code === 0 && quotaPossible(driver, backing);
    if (!quotaSupport) console.log(`[computers] DESKTOP_DISK_QUOTA is set but the storage driver (${driver || "?"}${backing ? ` on ${backing}` : ""}) cannot limit a container's size: skipped.`);
  }
  return quotaSupport ? ["--storage-opt", `size=${config.desktopDiskQuota}`] : [];
}

/** The docker run arguments of a computer (exported for tests). */
export function computerRunArgs(key: string, o: { libraries: { dir: string; dst: string }[]; team: string | null; quota: string[] }): string[] {
  const lim = runLimitsOf(key) ?? { memory: config.desktopMemory, cpus: config.desktopCpus };
  return [
    "run", "-d", "--name", nameOf(key), "--hostname", "computer", "--init",
    // How the bot's subscription tools reach this server's tool endpoint: "socket" mode — the bots' own network, cut off
    // from this server's ports and from each other, plus the computer's own socket (see BOT_LINK_MOUNT); "network" mode
    // — on Sklubot's Docker network when it runs in a container (ENGINE_BASE_URL=http://sklubot:3000), or, for a server
    // running directly on this machine (local development), a route to the host as host.docker.internal.
    ...(config.botLink === "socket" ? ["--network", config.botsNetwork] : config.desktopNetwork ? ["--network", config.desktopNetwork] : ["--add-host", "host.docker.internal:host-gateway"]),
    // L10: --memory-swap equal to --memory: no swap on top of the memory limit ("If --memory-swap is set to the same
    // value as --memory … the container does not have access to swap", docs.docker.com/engine/containers/resource_constraints/).
    "--memory", lim.memory, "--memory-swap", lim.memory, "--cpus", String(lim.cpus), "--shm-size", "1g", "--pids-limit", "2048",
    // Only the privileges a desktop, a browser and package installs need (checked one by one: Xvfb,
    // Chromium, x11vnc, apt-get, sudo, su all work with these). No device nodes, raw sockets, chroot or
    // file capabilities, and no way to gain privileges through setuid programs.
    "--cap-drop", "ALL", ...COMPUTER_CAPS.flatMap((cap) => ["--cap-add", cap]), "--security-opt", "no-new-privileges",
    // L48: the seccomp profile that lets Chromium's own sandbox start, for an image that uses it (browsersandbox.ts).
    ...sandboxRunArgs(),
    ...(config.desktopRuntime ? ["--runtime", config.desktopRuntime] : []),
    ...o.quota,
    "-e", `SCREEN_RES=${config.desktopResolution}`,
    "-e", `KEYBOARD=${config.desktopKeyboard}`,
    "-v", `${volumeOf(key)}:/root`,
    ...o.libraries.flatMap((l) => libraryMount(l.dir, l.dst)),
    ...(o.team ? libraryMount(o.team, "/root/team") : []),
    ...linkMount(key),
    "--label", "sklubot=desktop", "--label", `${TEAM_LABEL}=${o.team ? "1" : "0"}`, "--label", `${SPEC_LABEL}=${specOf(key)}`,
    ...(allocator.isShared(key) ? ["--label", "sklubot.shared=1"] : []),
    config.desktopImage,
  ];
}

/** Makes sure the computer is on. Only a few may run at once; the least recently used idle one goes to sleep. */
async function wake(key: string, userId: string, workspace?: string): Promise<Machine> {
  const known = machines.get(key);
  await refreshImageSandbox(docker, config.desktopImage);
  const spec = specOf(key);
  // A computer believed on is checked with Docker at most every 120 s: one removed or stopped behind our back is started
  // again. One not checked in this server run yet, or made with other settings since, goes through the full path below.
  const settled = known?.power === "running" && known.spec === spec;
  if (settled && now() - (known.verifiedAt ?? 0) < 120_000) { known.lastUsedAt = now(); return known; }
  if (settled && !starting.has(key)) {
    if ((await powerOfKey(key)) === "running") { known.verifiedAt = now(); known.lastUsedAt = now(); return known; }
    note(key, userId, "asleep");
    dressedWith.delete(key);
  }
  let pending = starting.get(key);
  if (!pending) {
    pending = (async () => {
      await ensureLink(key);
      let power = await powerOfKey(key);
      const team = teamOfKey(key, userId);
      const labels = power === "absent" ? null : await labelsOf(key);
      if (labels) {
        const m = machines.get(key);
        // The team folder was switched on or off since this computer was made (wave 8): mounts are fixed when a container
        // is created, so an asleep computer is made again from the image — its home volume (/root: files, logins,
        // settings) and its library are kept; what was installed outside /root is not. A running computer keeps it until
        // it next starts. A computer made before this label existed counts as made without the team folder.
        const teamDiffers = power === "asleep" && (labels[TEAM_LABEL] === "1") !== !!team;
        // Made with another way to this server (older computers on Sklubot's own network, H2), another runtime, or
        // other libraries (a shared computer): made again the same way, even when on, as long as nothing runs in it.
        const specDiffers = (labels[SPEC_LABEL] ?? "") !== spec && (power === "asleep" || !(m && m.busy > 0));
        if (teamDiffers || specDiffers) {
          if (power === "running") tellStopping(key);
          const rm = await docker(["rm", "-f", nameOf(key)], { timeoutMs: 30_000 });
          if (rm.code === 0) { power = "absent"; dressedWith.delete(key); if (m) { m.filesFor = undefined; note(key, userId, "absent"); } }
        }
        // Kept as it is (made as it should be, or in use right now): it is known by what it was really made with.
        if (power !== "absent") madeWith.set(key, labels[SPEC_LABEL] ?? "");
      }
      if (power !== "running") {
        const refused = wakeGate(userId);
        if (refused) throw refused;
        // Hosted mode: the account's plan may allow fewer computers awake at once than the server (its own idle one goes
        // to sleep first, like below; all of them busy → a plan-limit error with the way forward).
        const account = awakeLimitOf(userId);
        if (account) {
          await makeRoom({
            max: account.max, waitMs: config.computerWaitMs,
            awake: () => [
              ...[...machines.values()].filter((m) => m.userId === userId && m.power === "running" && !stopping.has(m.key) && m.key !== key),
              ...[...accountReserved].filter(([id, u]) => u === userId && id !== key).map(([id]) => ({ key: id, busy: 1, lastUsedAt: 0 })),
            ],
            take: () => { accountReserved.set(key, userId); },
            pick: (m) => { stopping.add(m.key); },
            free: (m) => sleepMachine(m.key),
          }).catch((err) => { throw err instanceof ComputersBusyError ? account.error() : err; });
        }
        // Awake: running and not being put to sleep, plus the others already allowed to start (counted as busy).
        await makeRoom({
          max: config.maxDesktops, waitMs: config.computerWaitMs,
          awake: () => [
            ...[...machines.values()].filter((m) => m.power === "running" && !stopping.has(m.key) && m.key !== key),
            ...[...reserved].filter((id) => id !== key).map((id) => ({ key: id, busy: 1, lastUsedAt: 0 })),
          ],
          take: () => { reserved.add(key); },
          pick: (m) => { stopping.add(m.key); },
          free: (m) => sleepMachine(m.key),
        });
      }
      if (power === "asleep") {
        const r = await docker(["start", nameOf(key)], { timeoutMs: 60_000 });
        if (r.code !== 0) throw new Error(`could not wake the computer: ${r.stderr.trim().slice(0, 300)}`);
      } else if (power === "absent") {
        const libraries = allocator.isShared(key)
          // A shared computer mounts the library of each bot that uses it, side by side; /root/files points at the one
          // of the bot driving it (pointFilesAt).
          ? allocator.members(key).map((botId) => ({ dir: workspaceOfBot(botId), dst: `/root/libraries/${safeId(botId)}` }))
          : [{ dir: workspace ?? workspaceOfBot(allocator.members(key)[0] ?? key), dst: "/root/files" }];
        const quota = await quotaArgs();
        let r = await docker(computerRunArgs(key, { libraries, team, quota }), { timeoutMs: 120_000 });
        if (r.code !== 0 && quota.length && /storage.?opt|quota|size/i.test(r.stderr)) {
          // The driver refused the size limit after all (no pquota on the xfs mount…): never tried again.
          quotaSupport = false;
          console.log(`[computers] the storage driver refused --storage-opt size (${r.stderr.trim().slice(0, 200)}): computers are made without a disk limit.`);
          await docker(["rm", "-f", nameOf(key)], { timeoutMs: 30_000 });
          r = await docker(computerRunArgs(key, { libraries, team, quota: [] }), { timeoutMs: 120_000 });
        }
        if (r.code !== 0) throw new Error(`could not create the computer: ${r.stderr.trim().slice(0, 300)}`);
        madeWith.set(key, spec);
        // Made without the team folder after having had it: the empty folder its mount left in the home volume goes
        // (rmdir only removes an empty one), so the bot does not mistake it for the shared folder.
        if (!team) await docker(["exec", nameOf(key), "rmdir", "/root/team"], { timeoutMs: 10_000 });
      }
      // The screen needs a moment before it accepts input.
      for (let i = 0; i < 60; i++) {
        const probe = await docker(["exec", nameOf(key), "xdotool", "getdisplaygeometry"], { timeoutMs: 5000 });
        if (probe.code === 0) {
          await startForwarder(key).catch(() => {});
          dressedWith.delete(key);
          await dress(key).catch(() => {});
          if (power !== "running") { try { woken(key, userId); } catch (err) { console.error("[woken]", err); } }
          return;
        }
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("the computer started but its screen did not come up");
    })();
    starting.set(key, pending);
    pending.finally(() => { starting.delete(key); reserved.delete(key); accountReserved.delete(key); }).catch(() => {});
  }
  await pending;
  const m = note(key, userId, "running");
  const made = madeWith.get(key) ?? spec;
  if (m.spec !== made) { m.spec = made; m.filesFor = undefined; }
  m.lastUsedAt = now();
  m.verifiedAt = now();
  return m;
}

/**
 * A shared computer: /root/files becomes the library of the bot driving it (a link to /root/libraries/<bot>). A real
 * folder left there (made by the desktop's start script) is removed when empty, else moved aside, never deleted.
 */
const POINT_FILES = 'set -e; [ -d "/root/libraries/$1" ] || exit 3; if [ -e /root/files ] && [ ! -L /root/files ]; then rmdir /root/files 2>/dev/null || mv /root/files "/root/files-moved-$(date +%s)"; fi; ln -sfn "/root/libraries/$1" /root/files';
async function pointFilesAt(m: Machine, botId: string) {
  if (!allocator.isShared(m.key) || m.filesFor === botId) return;
  const r = await docker(["exec", nameOf(m.key), "sh", "-c", POINT_FILES, "sh", safeId(botId)], { timeoutMs: 15_000 });
  if (r.code !== 0) throw new Error(`could not open this bot's library on the shared computer: ${r.stderr.trim().slice(0, 200) || `exit ${r.code}`}`);
  m.filesFor = botId;
}

/** Wakes the bot's computer (and dresses it) and returns its container's name: for a process that outlives one call (localtools.ts). */
export async function computerReady(botId: string, userId: string, workspace: string): Promise<string> {
  return onMachine(botId, userId, workspace, async (name) => name);
}

async function onMachine<T>(botId: string, userId: string, workspace: string, fn: (name: string) => Promise<T>): Promise<T> {
  // A shared computer is taken for the call: another bot that drives it makes this wait (see the allocator).
  const lease = await allocator.acquire(botId, userId);
  try {
    const m = await wake(lease.key, userId, lease.key === botId ? workspace : undefined);
    // First use since this server started (or after a restart of the container): make sure it is dressed.
    await dress(lease.key).catch(() => {});
    m.busy++;
    try {
      await pointFilesAt(m, botId);
      return await fn(nameOf(lease.key));
    } finally { m.busy--; m.lastUsedAt = now(); }
  } finally { lease.release(); }
}

/**
 * Marks the computer busy for a whole Claude Code / Codex turn (or a side request) run in it: it is never put to sleep
 * meanwhile, and a shared computer stays this bot's until the release, so only one subscription tool runs in it at a time
 * (two would refresh the same sign-in token: "refresh token was already used"). Returns the release (call it once).
 */
export async function holdComputer(botId: string, userId: string, workspace: string): Promise<() => void> {
  const lease = await allocator.acquire(botId, userId);
  try {
    const m = await wake(lease.key, userId, lease.key === botId ? workspace : undefined);
    m.busy++;
    try { await pointFilesAt(m, botId); } catch (err) { m.busy--; throw err; }
    let released = false;
    return () => { if (released) return; released = true; m.busy = Math.max(0, m.busy - 1); m.lastUsedAt = now(); lease.release(); };
  } catch (err) { lease.release(); throw err; }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function x(name: string, ...args: string[]) {
  const r = await docker(["exec", name, "xdotool", ...args], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(`screen action failed: ${r.stderr.trim().slice(0, 200) || "no detail"}`);
  return r.stdout.toString("utf8").trim();
}

export interface LinuxShot { data: string; mediaType: "image/jpeg"; url: string; title: string; /** A line for the bot: a dialog the action opened, a tab it opened… */ notice?: string }
async function grab(name: string): Promise<Buffer> {
  const r = await docker(["exec", name, "import", "-silent", "-window", "root", "-quality", "70", "jpeg:-"], { timeoutMs: 20_000 });
  if (r.code !== 0 || r.stdout.length < 200) throw new Error(`could not capture the screen: ${r.stderr.trim().slice(0, 200)}`);
  return r.stdout;
}
async function capture(name: string): Promise<LinuxShot> {
  const title = await docker(["exec", name, "sh", "-c", "xdotool getactivewindow getwindowname 2>/dev/null || true"], { timeoutMs: 8000 });
  return { data: (await grab(name)).toString("base64"), mediaType: "image/jpeg", url: "", title: title.stdout.toString("utf8").trim() };
}

// xdotool wants X keysym names; people and models say "Enter", "ctrl", "PageDown".
const KEYSYMS: Record<string, string> = {
  enter: "Return", return: "Return", esc: "Escape", escape: "Escape", tab: "Tab", space: "space", backspace: "BackSpace", delete: "Delete",
  up: "Up", down: "Down", left: "Left", right: "Right", arrowup: "Up", arrowdown: "Down", arrowleft: "Left", arrowright: "Right",
  pageup: "Page_Up", pagedown: "Page_Down", home: "Home", end: "End", ctrl: "ctrl", control: "ctrl", alt: "alt", shift: "shift",
  cmd: "super", command: "super", meta: "super", super: "super", win: "super",
};
const keysym = (combo: string) => combo.split("+").map((part) => {
  const k = part.trim();
  return KEYSYMS[k.toLowerCase().replace(/[_\s]/g, "")] ?? (k.length === 1 ? k.toLowerCase() : k);
}).join("+");

/**
 * Types the text it reads on standard input. xdotool alone loses characters that are not on the computer's keyboard
 * ("É", "ô", "€"…; on a US keyboard also "é"): it borrows a key for each one and gives it back before the window has read the keystroke.
 * So those characters are first placed on unused keys, typed like any other, and the keys are freed afterwards.
 * A text with more distinct such characters than there are unused keys (about 19) is typed in several passes;
 * re-placing keys between passes is less dependable in Chromium (roughly one text in eight came out wrong in tests).
 */
const TYPER = String.raw`
import re, subprocess, sys, time
text = sys.stdin.buffer.read().decode("utf-8", "replace")
def run(args, data=None):
    return subprocess.run(args, input=None if data is None else data.encode("utf-8"), capture_output=True)
def send(part):
    r = run(["xdotool", "type", "--delay", "6", "--file", "-"], part)
    if r.returncode != 0:
        sys.stderr.write(r.stderr.decode("utf-8", "replace"))
        sys.exit(r.returncode)
def keymap(pairs):
    if pairs:
        run(["xmodmap"] + [a for code, sym in pairs for a in ("-e", "keycode %d = %s" % (code, sym))])
# Characters the current keyboard layout already has (US, French…): xdotool types those dependably.
known = set()
for value in re.findall(r"0x([0-9a-f]+) \(", run(["xmodmap", "-pk"]).stdout.decode("utf-8", "replace")):
    v = int(value, 16)
    if 0x20 <= v < 0x100:
        known.add(chr(v))
    elif 0x01000000 < v <= 0x0110FFFF:
        known.add(chr(v - 0x01000000))
plain = (lambda ch: ord(ch) < 32 or ch in known) if known else (lambda ch: ord(ch) < 127)
if all(plain(ch) for ch in text):
    send(text)
    sys.exit(0)
listing = run(["xmodmap", "-pke"]).stdout.decode("utf-8", "replace")
free = [int(m.group(1)) for m in re.finditer(r"^keycode\s+(\d+) =\s*$", listing, re.M)][:24]
if not free:
    send(text)
    sys.exit(0)
runs, part, seen = [], "", []
for ch in text:
    if not plain(ch) and ch not in seen:
        if len(seen) == len(free):
            runs.append((part, seen))
            part, seen = "", []
        seen.append(ch)
    part += ch
runs.append((part, seen))
try:
    for part, seen in runs:
        keymap([(free[i], "U%04X" % ord(ch)) for i, ch in enumerate(seen)])
        time.sleep(0.6)
        send(part)
        time.sleep(0.3)
finally:
    keymap([(code, "NoSymbol") for code in free])
`;

/**
 * Runs the browser helper (browser-cdp.ts) in a computer that is on, with its request on standard input: it reads and
 * acts on the bot's active tab, and never leaves a Python traceback for the model (an unreadable answer is said plainly).
 */
async function runBrowser<T = BrowserAnswer>(name: string, req: object, timeoutMs = 40_000): Promise<T> {
  const r = await docker(["exec", "-i", name, "python3", "-c", BROWSER_PY], { timeoutMs, input: JSON.stringify(req), maxBytes: 2_000_000 });
  try { return JSON.parse(r.stdout.toString("utf8")) as T; } catch { throw new Error(r.timedOut ? "the browser did not answer in time. Look at the screen (screen_view): a dialog or a busy page may be in the way." : `the browser could not be reached (exit ${r.code}). Look at the screen (screen_view).`); }
}
/** The helper's answer for a read: a dialog, a refusal or an error becomes an Error in plain words. */
function readable(a: BrowserAnswer): BrowserAnswer {
  const trouble = browserTrouble(a);
  if (trouble) throw new Error(trouble);
  return a;
}

export const linuxScreen = {
  layout: (botId: string, userId: string, ws: string, expression: string) =>
    onMachine(botId, userId, ws, (name) => runBrowser<{ error?: string }>(name, { op: "layout", expression })),
  /** L114: one screenshot per width of `url`, in a temporary tab (browser-cdp.ts op_sheet). */
  sheet: (botId: string, userId: string, ws: string, url: string, widths: number[], moments: number[] = []) =>
    onMachine(botId, userId, ws, async (name) => { const r = await runBrowser<{ error?: string; shots?: { width: number; data: string; scrollWidth?: number; at?: number }[] }>(name, { op: "sheet", url, widths, moments }, 120_000); if (r.error) throw new Error(r.error); return r.shots ?? []; }),
  view: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (n) => { await pause(300); return capture(n); }),
  open: (botId: string, userId: string, ws: string, url: string, newTab = false) => onMachine(botId, userId, ws, async (n) => {
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:/i.test(target)) throw new Error("only http and https addresses can be opened");
    // The running browser is reused (the active tab, or a new tab): never a second Chromium on the same profile.
    const a = await runBrowser(n, { op: "open", url: target, newTab }, 60_000);
    if (a.error) throw new Error(a.error);
    const s = await capture(n);
    return { ...s, url: a.url ?? "", title: a.title || s.title, notice: a.dialog ? dialogWords(a.dialog) : tabNote(a.ctx) };
  }),
  click: (botId: string, userId: string, ws: string, px: number, py: number, button: "left" | "right" | "middle" = "left", double = false) =>
    onMachine(botId, userId, ws, async (n) => {
      await x(n, "mousemove", String(Math.round(px)), String(Math.round(py)), "click", ...(double ? ["--repeat", "2", "--delay", "80"] : []), button === "right" ? "3" : button === "middle" ? "2" : "1");
      await pause(700);
      return capture(n);
    }),
  type: (botId: string, userId: string, ws: string, text: string) => onMachine(botId, userId, ws, async (n) => {
    // The text travels on standard input, so it never shows up in a process list (it may be a password).
    const r = await docker(["exec", "-i", n, "python3", "-c", TYPER], { timeoutMs: 30_000 + text.length * 40, input: text });
    if (r.code !== 0) throw new Error(`typing failed: ${r.stderr.trim().slice(0, 200) || "no detail"}`);
    await pause(300);
    return capture(n);
  }),
  key: (botId: string, userId: string, ws: string, combo: string) => onMachine(botId, userId, ws, async (n) => {
    await x(n, "key", "--", keysym(combo));
    await pause(500);
    return capture(n);
  }),
  scroll: (botId: string, userId: string, ws: string, px: number, py: number, dy: number) => onMachine(botId, userId, ws, async (n) => {
    const notches = Math.min(30, Math.max(1, Math.round(Math.abs(dy) / 120)));
    await x(n, "mousemove", String(Math.round(px)), String(Math.round(py)), "click", "--repeat", String(notches), "--delay", "20", dy < 0 ? "4" : "5");
    await pause(400);
    return capture(n);
  }),
  drag: (botId: string, userId: string, ws: string, x1: number, y1: number, x2: number, y2: number) => onMachine(botId, userId, ws, async (n) => {
    await x(n, "mousemove", String(Math.round(x1)), String(Math.round(y1)), "mousedown", "1");
    await x(n, "mousemove", String(Math.round((x1 + x2) / 2)), String(Math.round((y1 + y2) / 2)));
    await x(n, "mousemove", String(Math.round(x2)), String(Math.round(y2)), "mouseup", "1");
    await pause(400);
    return capture(n);
  }),
  read: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (n) => {
    const a = readable(await runBrowser(n, { op: "read" }));
    return { url: a.url ?? "", title: a.title ?? "", text: a.text ?? "", notice: tabNote(a.ctx) };
  }),
  /** The interactive elements of the browser's front tab (wakes the computer if needed, like page_read). */
  elements: (botId: string, userId: string, ws: string, limit: number) => onMachine(botId, userId, ws, async (n) => {
    const r = await runBrowser<ElementSnapshot & BrowserAnswer>(n, { op: "snapshot", limit });
    readable(r);
    return r;
  }),
  /** Acts on one element of a snapshot; then a screenshot, like the pixel tools (`shot` null when the helper refused, or, L65, when it sent the page back in words: `after`). */
  elementAct: (botId: string, userId: string, ws: string, req: ElementRequest) => onMachine(botId, userId, ws, async (n) => {
    // The helper already waited for a page load and a quiet network (capped) after the action.
    const answer = await runBrowser<ElementAnswer>(n, req);
    if (!answer.ok || req.after) return { answer, shot: null };
    await pause(150);
    const s = await capture(n);
    return { answer, shot: answer.dialog ? { ...s, notice: dialogWords(answer.dialog) } : s };
  }),
  /** L65/L75/L81/L56: one request to the browser helper (wakes the computer like page_read); its answer as it is. */
  browserOp: <T = BrowserAnswer & ElementAnswer>(botId: string, userId: string, ws: string, req: object, timeoutMs = 40_000) =>
    onMachine(botId, userId, ws, (n) => runBrowser<T>(n, req, timeoutMs)),
  /** What an element of a snapshot is (its words, its form) if the computer is on; null otherwise. Never wakes it. */
  async elementInfo(botId: string, req: ElementRequest): Promise<ElementAnswer | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    try { return await runBrowser<ElementAnswer>(nameOf(key), { ...req, action: "info" }); } catch { return null; }
  },
  /** What is under a point of the screen, read in the browser's front tab (null: computer off, no browser, nothing there). Never wakes it. */
  async targetAt(botId: string, expression: string): Promise<{ url: string; target: ClickTarget | null } | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    try { const p = await runBrowser(nameOf(key), { op: "target", expression }, 20_000); return p.error || p.dialog !== undefined ? null : { url: p.url ?? "", target: (p.target as ClickTarget | null) ?? null }; } catch { return null; }
  },
  /** For the live viewer: a picture of the screen if the computer is on. Never wakes it. (A shared computer shows whoever drives it.) */
  async peek(botId: string): Promise<Buffer | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    try { return await grab(nameOf(key)); } catch { return null; }
  },
  isOpen: (botId: string) => machines.get(allocator.current(botId))?.power === "running",
  /** The bot's browser tabs (browser_tabs). */
  tabs: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (n) => readable(await runBrowser(n, { op: "tabs" }))),
  /** Brings one tab to the front (it becomes the active tab), or closes one; then a screenshot. */
  tab: (botId: string, userId: string, ws: string, action: "switch" | "close", tab: string) => onMachine(botId, userId, ws, async (n) => {
    const a = readable(await runBrowser(n, { op: action === "switch" ? "tab_switch" : "tab_close", tab }));
    await pause(250);
    return { answer: a, shot: await capture(n) };
  }),
  /** DS-Bot item 10 (browser-downloads.ts): the downloads held until approved (null: the computer is off). Never wakes it. */
  async heldDownloads(botId: string): Promise<HeldDownload[] | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    try { const a = await runBrowser<{ downloads?: HeldDownload[]; error?: string }>(nameOf(key), { op: "downloads" }, 20_000); return a.downloads ?? null; } catch { return null; }
  },
  /** Saves an approved held download into files/downloads, or deletes it. */
  downloadAct: (botId: string, userId: string, ws: string, action: "release" | "discard", id: string) =>
    onMachine(botId, userId, ws, (n) => runBrowser<{ ok?: boolean; error?: string; path?: string; size?: number; name?: string }>(n, { op: "download", action, id }, 30_000)),
  /** The dialog the active tab shows, if the computer is on (null: none, or it cannot be told). Never wakes it. */
  async dialogInfo(botId: string): Promise<BrowserAnswer | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    try { return await runBrowser(nameOf(key), { op: "dialog_info" }, 20_000); } catch { return null; }
  },
  /** Answers the active tab's dialog, only if it is still the one that was approved (`expect`); then a screenshot. */
  dialogAnswer: (botId: string, userId: string, ws: string, accept: boolean, text: string | undefined, expect: { type: string; message: string } | null) => onMachine(botId, userId, ws, async (n) => {
    const a = await runBrowser(n, { op: "dialog_answer", accept, text, expect });
    if (!a.ok) return { answer: a, shot: null };
    await pause(150);
    const s = await capture(n);
    return { answer: a, shot: a.dialog ? { ...s, notice: dialogWords(a.dialog) } : s };
  }),
  /** Types a secret into the focused field of the active tab, after checking that tab's site down to the field (browser-cdp.ts). */
  secretType: (botId: string, userId: string, ws: string, text: string, host: string, field: string) => onMachine(botId, userId, ws, async (n) => {
    const a = await runBrowser(n, { op: "secret_type", text, host, field });
    return { answer: a, shot: a.ok ? await capture(n) : null };
  }),
  /** A pixel click bound to what was approved: checked on the active tab right before xdotool clicks (browser-cdp.ts). */
  guardedClick: (botId: string, userId: string, ws: string, c: GuardedClick) => onMachine(botId, userId, ws, async (n) => {
    const a = await runBrowser(n, { op: "click", ...c });
    if (!a.ok) return { answer: a, shot: null };
    await pause(150);
    const s = await capture(n);
    return { answer: a, shot: a.dialog ? { ...s, notice: dialogWords(a.dialog) } : s };
  }),
  /** Types with the keyboard after checking the active tab's site (card fields inside a payment provider's frame). */
  guardedKeys: (botId: string, userId: string, ws: string, text: string, host: string) => onMachine(botId, userId, ws, async (n) => {
    const a = await runBrowser(n, { op: "keys", text, host, typer: TYPER }, 30_000 + text.length * 40);
    return { answer: a };
  }),
  /** A smaller picture of the screen for a demonstration recording (960 px wide). Never wakes the computer. */
  async frame(botId: string): Promise<Buffer | null> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return null;
    const r = await docker(["exec", nameOf(key), "import", "-silent", "-window", "root", "-resize", "960x", "-quality", "60", "jpeg:-"], { timeoutMs: 20_000 });
    return r.code === 0 && r.stdout.length > 200 ? r.stdout : null;
  },
  /** The window in front and, when it is the browser, its page address and title (the page's text is not kept). Never wakes the computer. */
  async where(botId: string): Promise<{ title: string; url: string }> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return { title: "", url: "" };
    const name = nameOf(key);
    const win = await docker(["exec", name, "sh", "-c", "xdotool getactivewindow getwindowname 2>/dev/null || true"], { timeoutMs: 8000 });
    const title = win.stdout.toString("utf8").trim();
    if (!/chrom/i.test(title)) return { title, url: "" };
    try { const p = await runBrowser(name, { op: "where" }, 20_000); return { title: p.title || title, url: p.url ?? "" }; } catch { return { title, url: "" }; }
  },
  /**
   * The bot was renamed, relabelled or got a new shape or colour (U-005): a computer that is on is dressed again now;
   * an asleep one will be on its next wake; a bot without a computer gets nothing. A shared computer keeps its own look.
   */
  async redress(botId: string) {
    if (allocator.isShared(allocator.current(botId))) return;
    const m = machines.get(botId);
    if (!m || m.power === "absent") return;
    if (m.power !== "running") { dressedWith.delete(botId); return; }
    await ensureDressed(botId);
  },
  /**
   * The screen check before a turn (B-2): the computer is on (checked with Docker at most every 120 s), its look is
   * applied (once per server run), and the bot's browser answers on its debugging port within 1.5 s — otherwise the
   * browser is (re)started on the bot's profile and home page.
   */
  ready: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (name) => {
    const probe = await docker(["exec", name, "curl", "-fsS", "-m", "1.5", "-o", "/dev/null", "http://127.0.0.1:9222/json/version"], { timeoutMs: 8000 });
    if (probe.code === 0) return;
    const r = await docker(["exec", "-d", name, "/opt/sklubot/open-browser.sh"], { timeoutMs: 20_000 });
    if (r.code !== 0) throw new Error(`could not start the browser: ${r.stderr.trim().slice(0, 200)}`);
  }),
  /** Whether the bot's browser answers on its debugging port right now (1.5 s at most). Never wakes the computer. */
  async browserAnswers(botId: string): Promise<boolean> {
    const key = allocator.current(botId);
    if (machines.get(key)?.power !== "running") return false;
    const probe = await docker(["exec", nameOf(key), "curl", "-fsS", "-m", "1.5", "-o", "/dev/null", "http://127.0.0.1:9222/json/version"], { timeoutMs: 8000 });
    return probe.code === 0;
  },
  /** Closes every window except the desktop's own, keeps logins, reopens the browser on the home page. */
  tidy: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (n) => {
    const r = await docker(["exec", n, "/opt/sklubot/tidy.sh"], { timeoutMs: 30_000 });
    if (r.code !== 0) throw new Error(`could not tidy the screen: ${r.stderr.trim().slice(0, 200)}`);
    await ensureDressed(allocator.current(botId), true);
  }),
  /** Counts as use, so the idle sweep leaves the computer awake. */
  touch: (botId: string) => { const m = machines.get(allocator.current(botId)); if (m) m.lastUsedAt = now(); },
  /**
   * Marks the computer busy for work that runs in it outside onMachine: it is never put to sleep meanwhile, neither to
   * make room for another nor by the idle sweep. Returns the release (call it once). See holdComputer for a whole turn.
   */
  hold: (botId: string): (() => void) => holdMachine(botId),
  wake: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async () => {}),
  /** Puts the bot's computer to sleep. A shared computer another bot is using right now is left on. */
  async sleep(botId: string) {
    const key = allocator.current(botId);
    if (allocator.isShared(key) && (machines.get(key)?.busy ?? 0) > 0) throw new SharedComputerInUseError();
    await sleepMachine(key);
  },
  /** Puts a computer to sleep by its key (shared computers' list, the disk watchdog). */
  sleepKey: (key: string) => sleepMachine(key),
  /**
   * Wipes the bot's own computer: the container and its home volume are deleted; a fresh one is made on next use. A bot
   * that uses a shared computer only wipes its own one (kept from before, if any): the shared one is wiped from its list.
   */
  destroy: (botId: string) => destroyKey(botId),
  destroyKey: (key: string) => destroyKey(key),
};

export class SharedComputerInUseError extends Error {
  constructor() { super("This shared computer is being used by another bot right now. Try again when it has finished."); this.name = "SharedComputerInUseError"; }
}

async function destroyKey(key: string) {
  const m = machines.get(key);
  if (allocator.isShared(key) && (m?.busy ?? 0) > 0) throw new SharedComputerInUseError();
  tellStopping(key);
  await docker(["rm", "-f", nameOf(key)], { timeoutMs: 30_000 });
  await docker(["volume", "rm", "-f", volumeOf(key)], { timeoutMs: 30_000 });
  machines.delete(key);
  dressedWith.delete(key);
  if (m) changed(m.userId);
}

export async function linuxShell(botId: string, userId: string, ws: string, command: string, timeoutSec: number, signal?: AbortSignal) {
  return onMachine(botId, userId, ws, async (n) => {
    const r = await docker(["exec", "-w", "/root", n, "timeout", "-k", "5", String(timeoutSec), "bash", "-lc", command], { timeoutMs: (timeoutSec + 15) * 1000, signal, maxBytes: 200_000 });
    const output = (r.stdout.toString("utf8") + (r.stderr ? (r.stdout.length ? "\n" : "") + r.stderr : "")).slice(-20_000);
    return { code: r.code, output, timedOut: r.timedOut || r.code === 124 };
  });
}

/**
 * Runs one program on the bot's computer with an argument array (wave 7): nothing goes through a shell, so text the
 * user or a model chose (a search query, an address) is passed as one argument and never interpreted. `env`: extra
 * variables for that program only.
 */
export async function linuxExec(botId: string, userId: string, ws: string, argv: string[], timeoutSec: number, opts: { signal?: AbortSignal; env?: Record<string, string>; maxBytes?: number; input?: string; binary?: boolean; output?: OutputSink } = {}) {
  return onMachine(botId, userId, ws, async (n) => {
    const env = Object.entries(opts.env ?? {}).flatMap(([k, v]) => ["-e", `${k}=${v}`]);
    const stdin = opts.input === undefined ? [] : ["-i"];
    const r = await docker(["exec", ...stdin, "-w", "/root", ...env, n, "timeout", "-k", "5", String(timeoutSec), ...argv], { timeoutMs: (timeoutSec + 15) * 1000, signal: opts.signal, maxBytes: opts.maxBytes ?? 4_000_000, input: opts.input, output: opts.output });
    return { code: r.code, stdout: opts.binary ? "" : r.stdout.toString("utf8"), raw: r.stdout, stderr: r.stderr, timedOut: r.timedOut || r.code === 124 };
  });
}

/** Writes a small file on the bot's computer (its content travels on standard input, never in a process list). */
export async function writeComputerFile(botId: string, userId: string, ws: string, file: string, content: string, mode = "600") {
  return onMachine(botId, userId, ws, async (n) => {
    const r = await docker(["exec", "-i", n, "sh", "-c", 'umask 077; mkdir -p "$(dirname "$1")" && cat > "$1" && chmod "$2" "$1"', "sh", file, mode], { timeoutMs: 20_000, input: content });
    if (r.code !== 0) throw new Error(`could not write ${file}: ${r.stderr.trim().slice(0, 200)}`);
  });
}

/**
 * Runs a short sh script against a bot's own disk without waking its computer (disk.ts): inside the computer when it is
 * on; otherwise in a throwaway container of the desktop image with only the bot's home volume and library mounted (no
 * network, the computer's reduced privileges). `args` are passed as positional arguments ("$@"), never through the
 * script's text. Null when the bot has no computer (no home volume) yet.
 */
export async function diskScript(botId: string, workspace: string, script: string, args: string[] = [], timeoutMs = 120_000): Promise<Exec | null> {
  const key = allocator.current(botId);
  if ((await powerOfKey(key)) === "running") return docker(["exec", nameOf(key), "sh", "-c", script, "sh", ...args], { timeoutMs, maxBytes: 2_000_000 });
  const vol = await docker(["volume", "inspect", "--format", "{{.Name}}", volumeOf(key)], { timeoutMs: 8000 });
  if (vol.code !== 0) return null;
  return docker([
    "run", "--rm", "--network", "none", "--memory", "256m", "--pids-limit", "256",
    "--cap-drop", "ALL", ...COMPUTER_CAPS.flatMap((cap) => ["--cap-add", cap]), "--security-opt", "no-new-privileges",
    "-v", `${volumeOf(key)}:/root`, ...libraryMount(workspace), "--label", "sklubot=disk-check",
    "--entrypoint", "sh", config.desktopImage, "-c", script, "sh", ...args,
  ], { timeoutMs, maxBytes: 2_000_000 });
}

/** See linuxScreen.hold. A computer not known yet (never woken by this server) has nothing to hold. */
export function holdMachine(botId: string): () => void {
  const m = machines.get(allocator.current(botId));
  if (!m) return () => {};
  m.busy++;
  let released = false;
  return () => { if (released) return; released = true; m.busy = Math.max(0, m.busy - 1); m.lastUsedAt = now(); };
}

/** The computers of an account (their own ones and its shared ones), as this server knows them. */
export const linuxMachines = (userId: string) => [...machines.values()].filter((m) => m.userId === userId);
/** Every computer this server knows of (freecomputers.ts looks for its own). */
export const allMachines = () => [...machines.values()];
/** One computer by its key (shared computers' list). */
export const machineInfo = (key: string) => machines.get(key) ?? null;

/**
 * After a restart, find the computers that already exist so the app shows them correctly. `owners`: each computer's key
 * (a bot's id, or a shared computer's id) and its account. Their sockets are opened again (H2): a running computer's
 * forwarder reconnects by itself. Each is checked against what it should be on its first use (see wake).
 */
export async function adoptMachines(owners: Map<string, string>) {
  const r = await docker(["ps", "-a", "--filter", "label=sklubot=desktop", "--format", "{{.Names}}\t{{.State}}"], { timeoutMs: 10_000 });
  const byName = new Map([...owners.keys()].map((key) => [nameOf(key), key]));
  for (const line of r.stdout.toString("utf8").split("\n")) {
    const [name, state] = line.split("\t");
    const key = byName.get(name);
    if (!key) continue;
    note(key, owners.get(key)!, state === "running" ? "running" : "asleep");
    if (state === "running") await ensureLink(key).catch((err) => console.error(`[bot link ${key}]`, (err as Error).message));
  }
}

export function sweepIdleMachines() {
  const cutoff = now() - config.desktopIdleMin * 60_000;
  for (const m of machines.values()) if (m.power === "running" && m.busy === 0 && m.lastUsedAt < cutoff) void sleepMachine(m.key);
}

// ── M2: the disk watchdog ────────────────────────────────────────────────────
/**
 * When the disk that holds this server's data runs low (under DISK_FREE_MIN_MB), the awake computer that has written the
 * most to its own disk layer (`docker ps --size`: the container's writable layer) and is not busy is put to sleep, so it
 * stops growing; `notify` tells its account. A busy computer is never stopped. Returns what it did, for the log and tests.
 */
export function parseDockerSize(text: string): number {
  const m = /^\s*([\d.]+)\s*([kKMGT]?)i?B/.exec(text);
  if (!m) return 0;
  const mult: Record<string, number> = { "": 1, k: 1e3, K: 1e3, M: 1e6, G: 1e9, T: 1e12 };
  return Number(m[1]) * (mult[m[2]] ?? 1);
}
export async function sleepBiggestIdle(): Promise<{ key: string; userId: string; bytes: number } | null> {
  const r = await docker(["ps", "--size", "--filter", "label=sklubot=desktop", "--format", "{{.Names}}\t{{.Size}}"], { timeoutMs: 60_000 });
  if (r.code !== 0) return null;
  const byName = new Map([...machines.values()].map((m) => [nameOf(m.key), m]));
  const candidates = r.stdout.toString("utf8").split("\n").map((line) => line.split("\t")).flatMap(([name, size]) => {
    const m = byName.get(name);
    return m && m.power === "running" && m.busy === 0 && !stopping.has(m.key) ? [{ m, bytes: parseDockerSize(size ?? "") }] : [];
  }).sort((a, b) => b.bytes - a.bytes);
  const pick = candidates[0];
  if (!pick) return null;
  await sleepMachine(pick.m.key);
  return { key: pick.m.key, userId: pick.m.userId, bytes: pick.bytes };
}
