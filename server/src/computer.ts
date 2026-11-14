import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { closeSync, constants as FS, fstatSync, ftruncateSync, lstatSync, mkdirSync, openSync, readdirSync, readFileSync, readlinkSync, realpathSync, rmSync, unlinkSync, writeFileSync, type Stats } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { assertPublicUrl } from "./net.js";
import { emit } from "./bus.js";
import { now } from "./store.js";
import { adoptMachines, linuxMachines, linuxReady, linuxScreen, linuxShell, onMachinesChanged, sweepIdleMachines } from "./linux.js";
import type { Attachment, ComputerState, FileEntry } from "./shared.js";

/**
 * Each bot gets a private "desktop": a folder of its own on disk plus a real browser with its own
 * profile (cookies and logins persist per bot). Everything runs on this server; nothing is rented.
 */

// The browser engine is optional. It is loaded lazily so the server still starts without it.
type Engine = { chromium: { launchPersistentContext(dir: string, opts: Record<string, unknown>): Promise<any> } };
let engine: Engine | null | undefined;
function loadEngine(): Engine | null {
  if (engine !== undefined) return engine;
  const require = createRequire(import.meta.url);
  for (const name of ["playwright", "playwright-core"]) {
    try { engine = require(name) as Engine; return engine; } catch { /* try the next package */ }
  }
  return (engine = null);
}

/** Which kind of computer bots get. Decided once at start-up by initComputer(). */
let kind: ComputerState["kind"] = "none";
export const computerKind = () => kind;
/** True when bots have a screen to look at and act on. */
export const browserAvailable = () => kind !== "none";

export async function initComputer(owners: Map<string, string> = new Map()): Promise<string> {
  const want = config.computer;
  if (want !== "browser") {
    const ready = await linuxReady();
    if (ready.ok) {
      kind = "linux";
      onMachinesChanged((userId) => announce(userId));
      await adoptMachines(owners);
      return "Computers: a Linux desktop per bot (containers)";
    }
    if (want === "linux") throw new Error(`COMPUTER=linux was requested but ${ready.reason}.`);
    kind = loadEngine() ? "browser" : "none";
    return kind === "browser"
      ? `Computers: a browser per bot on this server — for a full Linux computer per bot, ${ready.reason}`
      : `Computers: none — ${ready.reason}; no browser engine either. Bots can still fetch pages, run commands and use connectors.`;
  }
  kind = loadEngine() ? "browser" : "none";
  return kind === "browser" ? "Computers: a browser per bot on this server" : "Computers: none (no browser engine installed)";
}

export const VIEWPORT = { width: 1280, height: 800 };

interface Desktop { botId: string; userId: string; context: any; page: any; lastUsedAt: number; busy: number }
const desktops = new Map<string, Desktop>();
const opening = new Map<string, Promise<Desktop>>();

const safeId = (id: string) => id.replace(/[^a-zA-Z0-9_-]/g, "_");
export const workspaceOf = (botId: string) => {
  const dir = path.join(config.workspaceDir, safeId(botId));
  mkdirSync(dir, { recursive: true });
  return dir;
};

export function computerState(userId: string): ComputerState {
  if (kind === "linux")
    return {
      kind, browser: true, maxDesktops: config.maxDesktops,
      desktops: linuxMachines(userId).sort((a, b) => b.lastUsedAt - a.lastUsedAt).map((m) => ({ botId: m.botId, open: m.power === "running", url: null, lastUsedAt: m.lastUsedAt })),
    };
  return {
    kind, browser: browserAvailable(),
    maxDesktops: config.maxDesktops,
    desktops: [...desktops.values()].filter((d) => d.userId === userId).sort((a, b) => b.lastUsedAt - a.lastUsedAt)
      .map((d) => ({ botId: d.botId, open: true, url: safeUrl(d), lastUsedAt: d.lastUsedAt })),
  };
}
const safeUrl = (d: Desktop): string | null => { try { return d.page.url(); } catch { return null; } };
const announce = (userId: string) => emit(userId, { type: "computer", computer: computerState(userId) });

async function closeDesktop(botId: string) {
  const d = desktops.get(botId);
  if (!d) return;
  desktops.delete(botId);
  try { await d.context.close(); } catch { /* already gone */ }
  announce(d.userId);
}

/** Opens (or reuses) the bot's browser. When the cap is reached the least recently used idle one is closed. */
async function desktop(botId: string, userId: string): Promise<Desktop> {
  const existing = desktops.get(botId);
  if (existing) { existing.lastUsedAt = now(); return existing; }
  const pending = opening.get(botId);
  if (pending) return pending;
  const eng = loadEngine();
  if (!eng) throw new Error("No browser engine is installed on this server. Install one with: npm i playwright && npx playwright install chromium");
  const attempt = (async () => {
    if (desktops.size >= config.maxDesktops) {
      const victims = [...desktops.values()].sort((a, b) => a.lastUsedAt - b.lastUsedAt);
      await closeDesktop((victims.find((d) => d.busy === 0) ?? victims[0]).botId);
    }
    const profile = path.join(config.profileDir, safeId(botId));
    mkdirSync(profile, { recursive: true });
    const context = await eng.chromium.launchPersistentContext(profile, {
      headless: true, viewport: VIEWPORT, acceptDownloads: true, downloadsPath: workspaceOf(botId),
      args: ["--no-first-run", "--disable-dev-shm-usage"],
    });
    const page = context.pages()[0] ?? (await context.newPage());
    // Links that open a new tab would leave the bot looking at a stale page; follow the newest tab instead.
    context.on("page", (p: any) => { const d = desktops.get(botId); if (d) d.page = p; });
    const d: Desktop = { botId, userId, context, page, lastUsedAt: now(), busy: 0 };
    desktops.set(botId, d);
    announce(userId);
    return d;
  })();
  opening.set(botId, attempt);
  try { return await attempt; } finally { opening.delete(botId); }
}

async function withDesktop<T>(botId: string, userId: string, fn: (d: Desktop) => Promise<T>): Promise<T> {
  const d = await desktop(botId, userId);
  d.busy++;
  try { return await fn(d); } finally { d.busy--; d.lastUsedAt = now(); }
}

const settle = (page: any, ms = 600) => page.waitForLoadState("domcontentloaded", { timeout: 8000 }).catch(() => {}).then(() => page.waitForTimeout(ms));

export interface Shot { data: string; mediaType: "image/jpeg"; url: string; title: string }
async function capture(d: Desktop): Promise<Shot> {
  const buf: Buffer = await d.page.screenshot({ type: "jpeg", quality: 70 });
  return { data: buf.toString("base64"), mediaType: "image/jpeg", url: d.page.url(), title: await d.page.title().catch(() => "") };
}

const browserScreen = {
  view: (botId: string, userId: string) => withDesktop(botId, userId, capture),
  open: (botId: string, userId: string, url: string) => withDesktop(botId, userId, async (d) => {
    const target = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : `https://${url}`;
    if (!/^https?:/i.test(target)) throw new Error("only http and https addresses can be opened");
    // This browser runs on the server itself: it must not be pointed at the server's own network.
    await assertPublicUrl(target);
    await d.page.goto(target, { waitUntil: "domcontentloaded", timeout: 40000 });
    await settle(d.page, 800);
    announce(userId);
    return capture(d);
  }),
  click: (botId: string, userId: string, x: number, y: number, button: "left" | "right" | "middle" = "left", double = false) =>
    withDesktop(botId, userId, async (d) => {
      await d.page.mouse.click(x, y, { button, clickCount: double ? 2 : 1 });
      await settle(d.page);
      return capture(d);
    }),
  type: (botId: string, userId: string, text: string) => withDesktop(botId, userId, async (d) => {
    await d.page.keyboard.type(text, { delay: 4 });
    await d.page.waitForTimeout(250);
    return capture(d);
  }),
  key: (botId: string, userId: string, combo: string) => withDesktop(botId, userId, async (d) => {
    await d.page.keyboard.press(normaliseKey(combo));
    await settle(d.page, 400);
    return capture(d);
  }),
  scroll: (botId: string, userId: string, x: number, y: number, dy: number) => withDesktop(botId, userId, async (d) => {
    await d.page.mouse.move(x, y);
    await d.page.mouse.wheel(0, dy);
    await d.page.waitForTimeout(350);
    return capture(d);
  }),
  drag: (botId: string, userId: string, x1: number, y1: number, x2: number, y2: number) => withDesktop(botId, userId, async (d) => {
    await d.page.mouse.move(x1, y1);
    await d.page.mouse.down();
    await d.page.mouse.move(x2, y2, { steps: 12 });
    await d.page.mouse.up();
    await d.page.waitForTimeout(300);
    return capture(d);
  }),
  /** Visible text of the current page — far cheaper than a screenshot when the bot only needs to read. */
  read: (botId: string, userId: string) => withDesktop(botId, userId, async (d) => {
    const text: string = await d.page.evaluate("document.body ? document.body.innerText : ''");
    return { url: d.page.url() as string, title: (await d.page.title().catch(() => "")) as string, text };
  }),
  /** Screenshot for the live viewer. Never opens a browser: returns null when the bot has none. */
  async peek(botId: string): Promise<Buffer | null> {
    const d = desktops.get(botId);
    if (!d) return null;
    try { return await d.page.screenshot({ type: "jpeg", quality: 60 }); } catch { return null; }
  },
  reset: closeDesktop,
  isOpen: (botId: string) => desktops.has(botId),
  async frame(botId: string): Promise<Buffer | null> {
    const d = desktops.get(botId);
    if (!d) return null;
    try { return await d.page.screenshot({ type: "jpeg", quality: 55 }); } catch { return null; }
  },
  async where(botId: string): Promise<{ title: string; url: string }> {
    const d = desktops.get(botId);
    if (!d) return { title: "", url: "" };
    return { url: d.page.url() as string, title: (await d.page.title().catch(() => "")) as string };
  },
};

/** The page address each bot's computer last reported (shown on saved-login cards; it is the computer's word, not proof). */
const reportedUrl = new Map<string, string>();
export const lastKnownUrl = (botId: string) => reportedUrl.get(botId) ?? "";
const noteUrl = <T extends { url: string }>(botId: string, r: T): T => { if (r.url) reportedUrl.set(botId, r.url); return r; };

/** The bot's screen, whichever kind of computer it has. */
export const screen = {
  view: (botId: string, userId: string) => (kind === "linux" ? linuxScreen.view(botId, userId, workspaceOf(botId)) : browserScreen.view(botId, userId)),
  open: (botId: string, userId: string, url: string) => (kind === "linux" ? linuxScreen.open(botId, userId, workspaceOf(botId), url) : browserScreen.open(botId, userId, url)).then((r) => { reportedUrl.set(botId, r.url || url); return r; }),
  click: (botId: string, userId: string, x: number, y: number, button: "left" | "right" | "middle" = "left", double = false) =>
    kind === "linux" ? linuxScreen.click(botId, userId, workspaceOf(botId), x, y, button, double) : browserScreen.click(botId, userId, x, y, button, double),
  type: (botId: string, userId: string, text: string) => (kind === "linux" ? linuxScreen.type(botId, userId, workspaceOf(botId), text) : browserScreen.type(botId, userId, text)),
  key: (botId: string, userId: string, combo: string) => (kind === "linux" ? linuxScreen.key(botId, userId, workspaceOf(botId), combo) : browserScreen.key(botId, userId, combo)),
  scroll: (botId: string, userId: string, x: number, y: number, dy: number) =>
    kind === "linux" ? linuxScreen.scroll(botId, userId, workspaceOf(botId), x, y, dy) : browserScreen.scroll(botId, userId, x, y, dy),
  drag: (botId: string, userId: string, x1: number, y1: number, x2: number, y2: number) =>
    kind === "linux" ? linuxScreen.drag(botId, userId, workspaceOf(botId), x1, y1, x2, y2) : browserScreen.drag(botId, userId, x1, y1, x2, y2),
  read: (botId: string, userId: string) => (kind === "linux" ? linuxScreen.read(botId, userId, workspaceOf(botId)) : browserScreen.read(botId, userId)).then((r) => noteUrl(botId, r)),
  peek: (botId: string) => (kind === "linux" ? linuxScreen.peek(botId) : browserScreen.peek(botId)),
  isOpen: (botId: string) => (kind === "linux" ? linuxScreen.isOpen(botId) : browserScreen.isOpen(botId)),
  /** A picture for a demonstration recording, only if the computer is already on (never wakes it). */
  frame: (botId: string) => (kind === "linux" ? linuxScreen.frame(botId) : kind === "browser" ? browserScreen.frame(botId) : Promise.resolve(null)),
  /** Window title and page address in front, only if the computer is already on. */
  where: (botId: string) => (kind === "linux" ? linuxScreen.where(botId) : kind === "browser" ? browserScreen.where(botId) : Promise.resolve({ title: "", url: "" })),
  /** Switches the computer on without doing anything on it (Linux computers only; a browser opens on first use). */
  wake: async (botId: string, userId: string) => { if (kind === "linux") await linuxScreen.wake(botId, userId, workspaceOf(botId)); },
  /** Linux: close every window, keep logins, reopen the browser on the home page. Browser: close the browser. */
  tidy: (botId: string, userId: string) => (kind === "linux" ? linuxScreen.tidy(botId, userId, workspaceOf(botId)) : browserScreen.reset(botId)),
  /** Re-applies a bot's look to its computer after a rename or a new colour. */
  redress: (botId: string) => (kind === "linux" ? linuxScreen.redress(botId) : Promise.resolve()),
  /** Before a turn that uses the computer (B-2): on, dressed, browser answering. Nothing to do without a Linux computer. */
  ready: (botId: string, userId: string) => (kind === "linux" ? linuxScreen.ready(botId, userId, workspaceOf(botId)) : Promise.resolve()),
  /** Whether the bot's browser answers right now (Linux computers; never wakes one). */
  browserAnswers: (botId: string) => (kind === "linux" ? linuxScreen.browserAnswers(botId) : Promise.resolve(false)),
  /** Linux: put the computer to sleep, keeping everything on it. Browser: close it. */
  sleep: (botId: string) => (kind === "linux" ? linuxScreen.sleep(botId) : browserScreen.reset(botId)),
  /** Linux: wipe the computer and start fresh next time. Browser: close it (logins are kept). */
  reset: (botId: string) => (kind === "linux" ? linuxScreen.destroy(botId) : browserScreen.reset(botId)),
};

const KEY_ALIASES: Record<string, string> = {
  ctrl: "Control", control: "Control", cmd: "Meta", command: "Meta", meta: "Meta", alt: "Alt", option: "Alt", shift: "Shift",
  enter: "Enter", return: "Enter", esc: "Escape", escape: "Escape", tab: "Tab", space: "Space", backspace: "Backspace", delete: "Delete",
  up: "ArrowUp", down: "ArrowDown", left: "ArrowLeft", right: "ArrowRight", pageup: "PageUp", pagedown: "PageDown", home: "Home", end: "End",
};
function normaliseKey(combo: string): string {
  return combo.split("+").map((part) => {
    const k = part.trim();
    return KEY_ALIASES[k.toLowerCase().replace(/[_\s]/g, "")] ?? (k.length === 1 ? k : k.charAt(0).toUpperCase() + k.slice(1));
  }).join("+");
}

/** Close browsers nobody has touched for a while so they do not hold memory forever. */
export function sweepIdleDesktops() {
  if (kind === "linux") return sweepIdleMachines();
  const cutoff = now() - config.desktopIdleMin * 60000;
  for (const d of desktops.values()) if (d.busy === 0 && d.lastUsedAt < cutoff) void closeDesktop(d.botId);
}

export async function closeAllDesktops() {
  await Promise.all([...desktops.keys()].map(closeDesktop));
}

// ── Files ────────────────────────────────────────────────────────────────────
// The library is also mounted, read-write, in the bot's own computer, where the bot is root. Whatever is in
// it may have been made by the bot (or by a page that steered it): links, pipes, devices. So a path is
// never trusted for what it says: no part of it may be a link, and every file is opened without following
// links, checked to be a plain file, and checked again — by where the opened file really is — to sit
// inside the library. Otherwise a link to the database or to the server's own code would be served or
// overwritten.

/** The library's real location (a data folder reached through a link is fine; links inside the library are not). */
const realRootOf = (botId: string) => realpathSync(workspaceOf(botId));
const isInside = (root: string, p: string) => p === root || p.startsWith(root + path.sep);
const NOFOLLOW = FS.O_NOFOLLOW ?? 0;
// Opening a pipe would otherwise wait for a writer forever and freeze the server.
const NONBLOCK = FS.O_NONBLOCK ?? 0;
const lstatOrNull = (p: string): Stats | null => { try { return lstatSync(p); } catch { return null; } };

/** Resolves a user- or model-supplied relative path inside the bot's folder, refusing anything that escapes it or goes through a link. */
export function resolveInWorkspace(botId: string, rel: string): string {
  if (/[\0-\x1f]/.test(rel)) throw new Error("invalid path");
  const root = realRootOf(botId);
  const full = path.resolve(root, rel.replace(/^[/\\]+/, ""));
  if (!isInside(root, full)) throw new Error("that path is outside this bot's folder");
  let cur = root;
  for (const seg of path.relative(root, full).split(path.sep).filter(Boolean)) {
    cur = path.join(cur, seg);
    const st = lstatOrNull(cur);
    if (!st) break; // the rest does not exist yet
    if (st.isSymbolicLink()) throw new Error("that path goes through a link, which is not allowed in the library");
  }
  return full;
}

/** After opening: a plain file, really inside the library (catches a link swapped in after the path was checked). */
function verifyOpened(botId: string, fd: number, full: string): Stats {
  const st = fstatSync(fd);
  if (!st.isFile()) throw new Error("that is not a regular file");
  let actual: string;
  try { actual = readlinkSync(`/proc/self/fd/${fd}`); } catch { actual = realpathSync(full); }
  if (!isInside(realRootOf(botId), actual)) throw new Error("that path is outside this bot's folder");
  return st;
}

/** Opens a library file for reading. The caller closes the descriptor (a read stream given `fd` does it). */
export function openLibraryFile(botId: string, rel: string): { fd: number; full: string; size: number } {
  const full = resolveInWorkspace(botId, rel);
  const fd = openSync(full, FS.O_RDONLY | NOFOLLOW | NONBLOCK);
  try { return { fd, full, size: verifyOpened(botId, fd, full).size }; } catch (err) { closeSync(fd); throw err; }
}

export function readLibraryFile(botId: string, rel: string): Buffer {
  const { fd } = openLibraryFile(botId, rel);
  try { return readFileSync(fd); } finally { closeSync(fd); }
}

/** Writes a library file. `exclusive`: fail if anything already has that name. Returns the full path. */
function writeLibraryFile(botId: string, rel: string, data: string | Buffer, exclusive = false): string {
  const full = resolveInWorkspace(botId, rel);
  mkdirSync(path.dirname(full), { recursive: true });
  resolveInWorkspace(botId, rel); // a link may have appeared while the folders were made
  const fd = openSync(full, FS.O_WRONLY | FS.O_CREAT | NOFOLLOW | NONBLOCK | (exclusive ? FS.O_EXCL : 0), 0o644);
  try {
    try { verifyOpened(botId, fd, full); } catch (err) {
      // Lost a race against a swapped-in link: nothing was written. A file this call just created is removed again.
      if (exclusive) { try { unlinkSync(readlinkSync(`/proc/self/fd/${fd}`)); } catch { /* best effort */ } }
      throw err;
    }
    ftruncateSync(fd, 0);
    writeFileSync(fd, data);
  } finally { closeSync(fd); }
  return full;
}

export function listFiles(botId: string, rel = ""): FileEntry[] {
  const dir = resolveInWorkspace(botId, rel);
  if (!lstatOrNull(dir)?.isDirectory()) return [];
  // Only plain files and folders are listed; links and other special files are left out.
  return readdirSync(dir, { withFileTypes: true })
    .filter((e) => !e.name.startsWith(".") && (e.isFile() || e.isDirectory()))
    .flatMap((e) => {
      const st = lstatOrNull(path.join(dir, e.name));
      return st && (st.isFile() || st.isDirectory()) ? [{ name: e.name, size: st.size, modifiedAt: st.mtimeMs, dir: st.isDirectory() }] : [];
    })
    .sort((a, b) => Number(b.dir) - Number(a.dir) || b.modifiedAt - a.modifiedAt);
}

export function saveFile(botId: string, name: string, content: string): string {
  const clean = name.split(/[/\\]/).map((seg) => seg.replace(/[^a-zA-Z0-9._ -]/g, "_").slice(0, 120)).filter((s) => s && s !== "." && s !== "..").join("/") || "untitled.txt";
  writeLibraryFile(botId, clean, content);
  return clean;
}

const MIME: Record<string, string> = {
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown", csv: "text/csv", json: "application/json", html: "text/html", zip: "application/zip",
  doc: "application/msword", docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel", xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  mp3: "audio/mpeg", wav: "audio/wav", mp4: "video/mp4", mov: "video/quicktime", webm: "video/webm",
};
export const mimeOf = (name: string) => MIME[name.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
/** Picture formats that are safe to show inline and that models can look at. */
export const isInlineImage = (mime: string) => ["image/png", "image/jpeg", "image/gif", "image/webp"].includes(mime);
/** Video formats a browser can play in the chat's player. */
export const isInlineVideo = (mime: string) => ["video/mp4", "video/webm"].includes(mime);

/** Describes a file in the bot's library for showing it in the chat, or null if it is not a plain file there. */
export function attachmentAt(botId: string, rel: string): Attachment | null {
  let full: string;
  try { full = resolveInWorkspace(botId, rel); } catch { return null; }
  const st = lstatOrNull(full);
  if (!st?.isFile()) return null;
  const clean = path.relative(realRootOf(botId), full).split(path.sep).join("/");
  return { name: path.basename(full), path: clean, mime: mimeOf(full), size: st.size };
}

/** Stores an uploaded or generated file in the library without ever overwriting an existing one. */
export function storeBytes(botId: string, folder: string, name: string, bytes: Buffer): Attachment {
  const base = name.replace(/[^a-zA-Z0-9._ -]/g, "_").replace(/^\.+/, "").slice(-100) || "file";
  const dir = resolveInWorkspace(botId, folder);
  const rel = path.relative(realRootOf(botId), dir).split(path.sep).join("/");
  for (let i = 1; i < 10_000; i++) {
    const dot = base.lastIndexOf(".");
    const candidate = i === 1 ? base : dot > 0 ? `${base.slice(0, dot)}-${i}${base.slice(dot)}` : `${base}-${i}`;
    if (lstatOrNull(path.join(dir, candidate))) continue;
    const target = rel ? `${rel}/${candidate}` : candidate;
    try { writeLibraryFile(botId, target, bytes, true); } catch (err) { if ((err as NodeJS.ErrnoException).code === "EEXIST") continue; throw err; }
    return attachmentAt(botId, target)!;
  }
  throw new Error("could not find a free file name");
}

/** Where a library file sits from the bot's own point of view. */
export const botPathOf = (rel: string) => (kind === "linux" ? `~/files/${rel}` : rel);

/** Reads a library picture for a model to look at; null when it is not a picture or is too large. */
export function imageForModel(botId: string, a: Attachment): { mediaType: string; data: string } | null {
  if (!isInlineImage(a.mime) || a.size > 5_000_000) return null;
  try { return { mediaType: a.mime, data: readLibraryFile(botId, a.path).toString("base64") }; } catch { return null; }
}

export function removeWorkspace(botId: string) {
  for (const base of [config.workspaceDir, config.profileDir]) rmSync(path.join(base, safeId(botId)), { recursive: true, force: true });
}

// ── Shell ────────────────────────────────────────────────────────────────────
const OUTPUT_TAIL = 20_000;

/** Runs a command for a bot. Without a Linux computer it runs on this server, in the bot's folder, with a scrubbed environment so no server secret reaches it. */
/** Whether bots can run commands: in their own Linux computer, or — only when explicitly switched on — on this server. */
export const shellAvailable = () => (kind === "linux" ? config.shellEnabled : config.hostShell);
/** Commands run on this server itself (no container runtime): every one asks the user first. */
export const shellOnHost = () => kind !== "linux";

export function runShell(botId: string, userId: string, command: string, timeoutSec: number, signal?: AbortSignal): Promise<{ code: number | null; output: string; timedOut: boolean }> {
  if (!shellAvailable()) return Promise.reject(new Error(kind === "linux" ? "shell access is switched off on this server" : "shell access needs a Linux computer per bot (Docker) on this server; it is not offered on the server itself unless SHELL_ENABLED=1 is set"));
  // On a Linux computer the command runs inside the bot's own machine, never on this server.
  if (kind === "linux") return linuxShell(botId, userId, workspaceOf(botId), command, timeoutSec, signal);
  const cwd = workspaceOf(botId);
  const env = { PATH: process.env.PATH ?? "/usr/bin:/bin", HOME: cwd, LANG: process.env.LANG ?? "C.UTF-8", TERM: "dumb" };
  return new Promise((resolve) => {
    const child = spawn("bash", ["-lc", command], { cwd, env, detached: true, stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    let timedOut = false;
    const add = (chunk: Buffer) => { output = (output + chunk.toString("utf8")).slice(-OUTPUT_TAIL * 2); };
    child.stdout.on("data", add);
    child.stderr.on("data", add);
    const kill = () => { try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already exited */ } };
    const timer = setTimeout(() => { timedOut = true; kill(); }, timeoutSec * 1000);
    signal?.addEventListener("abort", kill, { once: true });
    child.on("error", (err) => { clearTimeout(timer); resolve({ code: null, output: String(err.message), timedOut }); });
    child.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", kill);
      resolve({ code, output: output.slice(-OUTPUT_TAIL), timedOut });
    });
  });
}
