import { spawn } from "node:child_process";
import path from "node:path";
import { config } from "./config.js";
import { now } from "./store.js";

/**
 * A real Linux computer per bot: one container each, with a graphical desktop, a browser, a terminal
 * and a root shell. The bot's home folder lives in a volume, so installed tools, browser logins and
 * files survive sleep and restarts. Idle computers are stopped ("asleep") and started again on demand.
 */

export interface Exec { code: number | null; stdout: Buffer; stderr: string; timedOut: boolean }

/** Runs the docker CLI without a shell, so no argument is ever interpreted. */
export function docker(args: string[], opts: { timeoutMs?: number; signal?: AbortSignal; maxBytes?: number; input?: string } = {}): Promise<Exec> {
  return new Promise((resolve) => {
    const child = spawn("docker", args, { stdio: [opts.input === undefined ? "ignore" : "pipe", "pipe", "pipe"] });
    if (opts.input !== undefined) child.stdin!.end(opts.input);
    const chunks: Buffer[] = [];
    let size = 0, stderr = "", timedOut = false;
    const max = opts.maxBytes ?? 20_000_000;
    child.stdout!.on("data", (c: Buffer) => { size += c.length; chunks.push(c); while (size > max && chunks.length > 1) size -= chunks.shift()!.length; });
    child.stderr!.on("data", (c: Buffer) => { stderr = (stderr + c.toString("utf8")).slice(-8000); });
    const kill = () => child.kill("SIGKILL");
    const timer = setTimeout(() => { timedOut = true; kill(); }, opts.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", kill, { once: true });
    const done = (code: number | null) => { clearTimeout(timer); opts.signal?.removeEventListener("abort", kill); resolve({ code, stdout: Buffer.concat(chunks), stderr, timedOut }); };
    child.on("error", (err) => { stderr = String(err.message); done(null); });
    child.on("close", done);
  });
}

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
export const containerName = (botId: string) => `sklubot-${safeId(botId)}`;
const volumeName = (botId: string) => `sklubot-home-${safeId(botId)}`;

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
function libraryMount(workspace: string): string[] {
  if (!config.dataVolume) return ["-v", `${workspace}:/root/files`];
  const sub = path.relative(config.dataDir, workspace).split(path.sep).join("/");
  return ["--mount", `type=volume,src=${config.dataVolume},dst=/root/files,volume-subpath=${sub}`];
}

export type Power = "running" | "asleep" | "absent";
interface Machine { botId: string; userId: string; lastUsedAt: number; busy: number; power: Power }
const machines = new Map<string, Machine>();
const starting = new Map<string, Promise<void>>();
let changed: (userId: string) => void = () => {};
export const onMachinesChanged = (fn: (userId: string) => void) => { changed = fn; };

async function powerOf(botId: string): Promise<Power> {
  const r = await docker(["inspect", "--format", "{{.State.Running}}", containerName(botId)], { timeoutMs: 8000 });
  return r.code !== 0 ? "absent" : r.stdout.toString().trim() === "true" ? "running" : "asleep";
}

function note(botId: string, userId: string, power: Power): Machine {
  let m = machines.get(botId);
  if (!m) machines.set(botId, (m = { botId, userId, lastUsedAt: now(), busy: 0, power }));
  if (m.power !== power) { m.power = power; changed(userId); }
  return m;
}

async function sleepMachine(botId: string) {
  const m = machines.get(botId);
  await docker(["stop", "-t", "3", containerName(botId)], { timeoutMs: 30_000 });
  if (m) note(botId, m.userId, "asleep");
}

/** Makes sure the bot's computer is on. Only a few may run at once; the least recently used idle one goes to sleep. */
async function wake(botId: string, userId: string, workspace: string): Promise<Machine> {
  const known = machines.get(botId);
  if (known?.power === "running") { known.lastUsedAt = now(); return known; }
  let pending = starting.get(botId);
  if (!pending) {
    pending = (async () => {
      const power = await powerOf(botId);
      if (power !== "running") {
        const awake = [...machines.values()].filter((m) => m.power === "running").sort((a, b) => a.lastUsedAt - b.lastUsedAt);
        if (awake.length >= config.maxDesktops) await sleepMachine((awake.find((m) => m.busy === 0) ?? awake[0]).botId);
      }
      if (power === "asleep") {
        const r = await docker(["start", containerName(botId)], { timeoutMs: 60_000 });
        if (r.code !== 0) throw new Error(`could not wake the computer: ${r.stderr.trim().slice(0, 300)}`);
      } else if (power === "absent") {
        const r = await docker([
          "run", "-d", "--name", containerName(botId), "--hostname", "computer", "--init",
          "--memory", config.desktopMemory, "--cpus", String(config.desktopCpus), "--shm-size", "1g", "--pids-limit", "2048",
          "-e", `SCREEN_RES=${config.desktopResolution}`,
          "-v", `${volumeName(botId)}:/root`, ...libraryMount(workspace),
          "--label", "sklubot=desktop", config.desktopImage,
        ], { timeoutMs: 120_000 });
        if (r.code !== 0) throw new Error(`could not create the computer: ${r.stderr.trim().slice(0, 300)}`);
      }
      // The screen needs a moment before it accepts input.
      for (let i = 0; i < 60; i++) {
        const probe = await docker(["exec", containerName(botId), "xdotool", "getdisplaygeometry"], { timeoutMs: 5000 });
        if (probe.code === 0) return;
        await new Promise((r) => setTimeout(r, 250));
      }
      throw new Error("the computer started but its screen did not come up");
    })();
    starting.set(botId, pending);
    pending.finally(() => starting.delete(botId)).catch(() => {});
  }
  await pending;
  const m = note(botId, userId, "running");
  m.lastUsedAt = now();
  return m;
}

async function onMachine<T>(botId: string, userId: string, workspace: string, fn: (name: string) => Promise<T>): Promise<T> {
  const m = await wake(botId, userId, workspace);
  m.busy++;
  try { return await fn(containerName(botId)); } finally { m.busy--; m.lastUsedAt = now(); }
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function x(name: string, ...args: string[]) {
  const r = await docker(["exec", name, "xdotool", ...args], { timeoutMs: 20_000 });
  if (r.code !== 0) throw new Error(`screen action failed: ${r.stderr.trim().slice(0, 200) || "no detail"}`);
  return r.stdout.toString("utf8").trim();
}

export interface LinuxShot { data: string; mediaType: "image/jpeg"; url: string; title: string }
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

export const linuxScreen = {
  view: (botId: string, userId: string, ws: string) => onMachine(botId, userId, ws, async (n) => { await pause(300); return capture(n); }),
  open: (botId: string, userId: string, ws: string, url: string) => onMachine(botId, userId, ws, async (n) => {
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:/i.test(target)) throw new Error("only http and https addresses can be opened");
    const r = await docker(["exec", "-d", n, "/opt/sklubot/open-browser.sh", target], { timeoutMs: 20_000 });
    if (r.code !== 0) throw new Error(`could not start the browser: ${r.stderr.trim().slice(0, 200)}`);
    await pause(4000);
    return capture(n);
  }),
  click: (botId: string, userId: string, ws: string, px: number, py: number, button: "left" | "right" | "middle" = "left", double = false) =>
    onMachine(botId, userId, ws, async (n) => {
      await x(n, "mousemove", String(Math.round(px)), String(Math.round(py)), "click", ...(double ? ["--repeat", "2", "--delay", "80"] : []), button === "right" ? "3" : button === "middle" ? "2" : "1");
      await pause(700);
      return capture(n);
    }),
  type: (botId: string, userId: string, ws: string, text: string) => onMachine(botId, userId, ws, async (n) => {
    // The text travels on standard input, so it never shows up in a process list (it may be a password).
    const r = await docker(["exec", "-i", n, "xdotool", "type", "--delay", "6", "--file", "-"], { timeoutMs: 20_000 + text.length * 20, input: text });
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
    const r = await docker(["exec", n, "python3", "/opt/sklubot/page-text.py"], { timeoutMs: 30_000 });
    let parsed: { error?: string; url?: string; title?: string; text?: string } = {};
    try { parsed = JSON.parse(r.stdout.toString("utf8")); } catch { throw new Error(`could not read the page: ${r.stderr.trim().slice(0, 200)}`); }
    if (parsed.error) throw new Error(parsed.error);
    return { url: parsed.url ?? "", title: parsed.title ?? "", text: parsed.text ?? "" };
  }),
  /** For the live viewer: a picture of the screen if the computer is on. Never wakes it. */
  async peek(botId: string): Promise<Buffer | null> {
    if (machines.get(botId)?.power !== "running") return null;
    try { return await grab(containerName(botId)); } catch { return null; }
  },
  isOpen: (botId: string) => machines.get(botId)?.power === "running",
  /** Counts as use, so the idle sweep leaves the computer awake. */
  touch: (botId: string) => { const m = machines.get(botId); if (m) m.lastUsedAt = now(); },
  wake: (botId: string, userId: string, ws: string) => wake(botId, userId, ws).then(() => {}),
  sleep: sleepMachine,
  /** Wipes the computer: the container and its home volume are deleted; a fresh one is made on next use. */
  async destroy(botId: string) {
    const m = machines.get(botId);
    await docker(["rm", "-f", containerName(botId)], { timeoutMs: 30_000 });
    await docker(["volume", "rm", "-f", volumeName(botId)], { timeoutMs: 30_000 });
    machines.delete(botId);
    if (m) changed(m.userId);
  },
};

export async function linuxShell(botId: string, userId: string, ws: string, command: string, timeoutSec: number, signal?: AbortSignal) {
  return onMachine(botId, userId, ws, async (n) => {
    const r = await docker(["exec", "-w", "/root", n, "timeout", "-k", "5", String(timeoutSec), "bash", "-lc", command], { timeoutMs: (timeoutSec + 15) * 1000, signal, maxBytes: 200_000 });
    const output = (r.stdout.toString("utf8") + (r.stderr ? (r.stdout.length ? "\n" : "") + r.stderr : "")).slice(-20_000);
    return { code: r.code, output, timedOut: r.timedOut || r.code === 124 };
  });
}

export const linuxMachines = (userId: string) => [...machines.values()].filter((m) => m.userId === userId);

/** After a restart, find the computers that already exist so the app shows them correctly. */
export async function adoptMachines(owners: Map<string, string>) {
  const r = await docker(["ps", "-a", "--filter", "label=sklubot=desktop", "--format", "{{.Names}}\t{{.State}}"], { timeoutMs: 10_000 });
  for (const line of r.stdout.toString("utf8").split("\n")) {
    const [name, state] = line.split("\t");
    const botId = [...owners.keys()].find((id) => containerName(id) === name);
    if (botId) note(botId, owners.get(botId)!, state === "running" ? "running" : "asleep");
  }
}

export function sweepIdleMachines() {
  const cutoff = now() - config.desktopIdleMin * 60_000;
  for (const m of machines.values()) if (m.power === "running" && m.busy === 0 && m.lastUsedAt < cutoff) void sleepMachine(m.botId);
}
