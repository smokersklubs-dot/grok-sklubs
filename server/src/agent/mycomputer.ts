import { setLive } from "../bus.js";
import { tr } from "../i18n.js";
import type { ImageBlock, TextBlock, ToolSpec } from "../llm/types.js";
import { pushLater } from "../push.js";
import { deviceKindOf, devices, heldBack, labelOf, liveDevice, listDevices, relayRequest, type DeviceKind, type RelayResult } from "../relay.js";
import { audit, bots, clip, policies, rows } from "../store.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./tools.js";

/**
 * "mycomputer": the bot uses one of the user's own computers through Sklubot Relais (relay.ts, protocol in
 * docs/RELAIS-PROTOCOLE.md). Two locks, both required:
 *  - on the computer, the relay asks the user itself (control session, then each command) and enforces Stop;
 *  - here, the app's approval cards (the gates below): taking control, and every command, the first time; always
 *    again after outside content (strict); "Always" can be chosen per bot, except for a command after outside content.
 * Screenshots, window titles and command output come from the user's computer: outside content for the turn.
 * Refusals (consent_*, locked, busy, rate_limited, permission_missing…) are never retried here: the bot and the user
 * are told, and the bot is asked not to insist.
 *
 * Phones (protocol 1.2, §13: the Android app, device kind "phone") use the same tools, mapped to the phone's own
 * operations: my_click → touch.tap, my_drag/my_scroll → touch.swipe, my_key → global.action (back, home, recents,
 * notifications, quick_settings, enter), my_windows → screen.read (the app in front and its on-screen text). There is
 * no command on a phone (my_command is not offered and refused), nor shared files or window switching.
 */

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const numb = (description: string) => ({ type: "number", description });
const DEVICE = str("Which of the user's computers or phones (its name), only needed when several are connected");
const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool => ({ spec: { name, description, inputSchema: schema }, group: "mycomputer", ...rest });

export const controlKey = (botName: string) => `mycomputer: control: ${botName}`;
export const commandKey = (botName: string) => `mycomputer: command: ${botName}`;
const urlKey = (botName: string) => `mycomputer: url: ${botName}`;

interface Target { id: string; name: string; label: string; kind: DeviceKind }

/** The device a call is about: the one named, else the only one connected. */
function pick(userId: string, wanted: unknown): { target?: Target; error?: string } {
  const all = devices.list(userId);
  if (!all.length) return { error: "The user has no computer or phone linked to Sklubot. They can link one in Settings → Computers (with the Sklubot Relais app, or the Sklubot Android app for a phone)." };
  const w = typeof wanted === "string" ? wanted.trim().toLowerCase() : "";
  let row = w ? all.find((d) => d.id.toLowerCase() === w) ?? all.find((d) => d.name.toLowerCase() === w) ?? all.find((d) => d.name.toLowerCase().startsWith(w)) : undefined;
  if (w && !row) return { error: `No linked computer is called "${clip(String(wanted), 60)}". Linked: ${all.map((d) => d.name).join(", ")}.` };
  if (!row) {
    const up = all.filter((d) => liveDevice(userId, d.id));
    if (up.length > 1) return { error: `Several computers are connected (${up.map((d) => d.name).join(", ")}). Say which one with "device".` };
    row = up[0] ?? (all.length === 1 ? all[0] : undefined);
    if (!row) return { error: `None of the user's devices is connected right now (${all.map((d) => d.name).join(", ")}). The Sklubot Relais app must be running on the computer, or the relay turned on in the Sklubot Android app on the phone.` };
  }
  return { target: { id: row.id, name: row.name, label: labelOf(row), kind: deviceKindOf(row) } };
}

const hasSession = (userId: string, deviceId: string, botId: string) => liveDevice(userId, deviceId)?.session?.botId === botId;

// ── Approval cards (server side, on top of the computer's own questions) ─────
type Gate = NonNullable<BuiltinTool["gate"]>;
const SOURCE = "My computer";
const CONTROL_NOTE = "The computer will also ask on its own screen. Stop there (or here, under My computer) at any time.";

function controlCard(botName: string, label: string, tainted: boolean, note = CONTROL_NOTE): ReturnType<Gate> {
  return {
    key: controlKey(botName), strict: tainted, vars: { device: label }, source: SOURCE, note,
    title: tainted ? "{bot} has read outside content. Allow it to take control of {device}?" : "Allow {bot} to take control of {device} (see the screen, use the mouse and the keyboard)?",
    reason: "take control of {device}",
  };
}

/** Taking control: asked when the bot has no session on that computer yet. Within its session, the computer's own Stop rules. */
const controlGate: Gate = (a, ctx) => {
  const bot = bots.byId(ctx.botId);
  if (!bot) return null;
  const { target } = pick(bot.userId, a.device);
  if (!target || !liveDevice(bot.userId, target.id)) return null; // the tool itself explains
  return hasSession(bot.userId, target.id, bot.id) ? null : controlCard(bot.name, target.label, ctx.tainted);
};

/** Opening an address after outside content could carry what the bot read out in the URL: asked every time then. */
const openGate: Gate = (a, ctx) => {
  const control = controlGate(a, ctx);
  if (control || !ctx.tainted || typeof a.url !== "string" || !a.url.trim()) return control;
  const bot = bots.byId(ctx.botId);
  const { target } = bot ? pick(bot.userId, a.device) : {};
  if (!bot || !target) return null;
  return { key: urlKey(bot.name), strict: true, once: true, vars: { device: target.label, url: clip(a.url, 200) }, source: SOURCE, title: "{bot} has read outside content. Allow it to open {url} on {device}?", reason: "open an address on {device}" };
};

/** Every command, the first time; always again (and never "Always") after outside content. The computer asks too. */
const commandGate: Gate = (a, ctx) => {
  const bot = bots.byId(ctx.botId);
  if (!bot) return null;
  const { target } = pick(bot.userId, a.device);
  // Without a session the tool answers "take control first", and a phone has no commands: no card for a command that cannot run.
  if (!target || target.kind === "phone" || !hasSession(bot.userId, target.id, bot.id)) return null;
  return {
    key: commandKey(bot.name), strict: ctx.tainted, once: ctx.tainted, vars: { device: target.label }, source: SOURCE,
    title: ctx.tainted ? "{bot} has read outside content. Allow it to run this command on {device}?" : "Allow {bot} to run a command on {device}?",
    reason: "run a command on {device}",
    note: ctx.tainted ? "After outside content, every command on your computer is asked here, and on the computer itself." : "The computer will also show the exact command and ask before it runs.",
  };
};

// ── Refusals and errors: told to the bot (never retried) and to the user ─────
const REFUSALS: Record<string, { model: string; user?: string; summary: string }> = {
  consent_refused: { model: "The user refused, on their computer, to let you control it. Do not ask again now: carry on without it, or ask them in the chat what they prefer.", user: "Control of {device} was refused on the computer.", summary: "refused on the computer" },
  consent_expired: { model: "Nobody answered the permission question on the computer within 60 seconds (that counts as a refusal). Do not retry on your own: tell the user you need them at that computer.", user: "Nobody answered on {device}.", summary: "no answer on the computer" },
  consent_cooldown: { model: "You were refused on that computer a moment ago: it will not ask the user again before {wait}. Do not retry before then, and not in a loop.", user: "{bot} must wait before asking {device} again.", summary: "asked too soon" },
  consent_pending: { model: "A permission question is open on the computer right now: mouse, keyboard and commands wait until the user answers it. Do not retry in a loop; wait for the user.", summary: "question open on the computer" },
  command_refused: { model: "The user refused this command on their computer. Do not run it another way (in a terminal window, a script…): carry on without it or ask them.", user: "The command was refused on {device}.", summary: "command refused on the computer" },
  locked: { model: "The user pressed Stop on their computer: everything is refused until they allow control again there, themselves. Do not retry. Tell them what you were doing and wait.", user: "{device} is locked (Stop was pressed there): {bot} cannot use it until you allow control again on that computer.", summary: "locked (Stop)" },
  rate_limited: { model: "Too many requests or permission questions on that computer. Do not retry on your own; wait {wait} at least, or ask the user.", user: "{device} is limiting {bot}'s requests.", summary: "too many requests" },
  busy: { model: "Another bot has the control session on that computer right now. Do not retry in a loop: tell the user, or wait until it is free.", user: "{device} is busy with another bot.", summary: "another bot has control" },
  permission_missing: { model: "The computer lacks a system permission the relay needs (on macOS: Screen Recording and Accessibility for Sklubot Relais). Ask the user to grant it in the system settings, then to tell you.", user: "{device} needs a system permission for Sklubot Relais (macOS: Screen Recording / Accessibility).", summary: "system permission missing" },
  offline: { model: "That computer is not connected right now (the Sklubot Relais app is closed, paused, or the computer is off). Do not retry in a loop: tell the user.", summary: "computer offline" },
  timeout: { model: "The computer did not answer in time. Check its state (look again) before doing anything else; do not repeat an action that may have gone through.", summary: "no answer in time" },
  stopped: { model: "Stopped.", summary: "stopped" },
  // Files (protocol 1.1): refusals decided by the relay on the computer, from the folders the user shared there.
  forbidden: { model: "The relay refused: that file or folder is not in a folder the user shared with Sklubot, or it is hidden, a system or backup folder, a file that typically holds secrets, or a program. Do not try another path to it.", summary: "refused by the computer" },
  read_only: { model: "The user shared that folder for reading only, on their computer. Do not try to write there: tell them, or save the file in your own library instead.", summary: "read-only folder" },
  not_found: { model: "No such file or folder there.", summary: "not found" },
  exists: { model: "A file of that name already exists: nothing was written. Pick another name, or use mode \"replace\" if the user asked to change that file (its old version goes to the trash).", summary: "already exists" },
  too_large: { model: "Too large for the relay (reading: 256 KiB of text at most; writing: 200 KiB).", summary: "too large" },
  // Phones (protocol 1.2): refusals decided on the phone itself.
  blocked_app: { model: "The app on the phone's screen is one the user blocked (banking, payment or another app they chose), or it is Sklubot itself (which you may look at but never tap or type in). Nothing was done. Do not try to reach it another way: ask the user to do that part themselves.", user: "{bot} was refused on {device}: the app on screen is blocked there.", summary: "blocked app on the phone" },
  screen_locked: { model: "The phone is locked (its lock screen is showing). Do not try to unlock it: ask the user to unlock their phone, then to tell you.", user: "{bot} is waiting: {device} is locked.", summary: "phone locked" },
  binary: { model: "That file is not text: it cannot be read this way.", summary: "not text" },
};

const seconds = (ms?: number) => (ms && ms > 0 ? `${Math.ceil(ms / 1000)} s` : "a minute");

/** On a phone, the system permission is the accessibility service, turned on by the user in Android's settings. */
const PHONE_PERMISSION = { model: "The Sklubot accessibility service is off on the phone: without it the phone cannot be seen or used. Ask the user to turn it on (Sklubot app → Phone control → Open accessibility settings), then to tell you.", user: "{device} needs the Sklubot accessibility service (Android settings → Accessibility).", summary: "accessibility service off" };

function refusal(c: ToolContext, t: Target, r: Extract<RelayResult, { ok: false }>): ToolOutput {
  const known = t.kind === "phone" && r.code === "permission_missing" ? PHONE_PERMISSION : REFUSALS[r.code];
  const loc = c.user.locale;
  if (!known) return { content: `The ${t.kind === "phone" ? "phone" : "computer"} answered with an error (${r.code}): ${r.message}`, isError: true, summary: clip(r.code, 40) };
  const vars = { device: t.label, bot: c.bot.name, wait: seconds(r.retryAfterMs) };
  if (known.user) {
    const line = tr(loc, known.user, vars);
    rows.append(c.bot, { kind: "event", event: "relay", text: line, tone: "warn" });
    audit(c.user.id, "computer", `${c.bot.name} : ${line}`, c.bot.id);
  }
  return { content: known.model.replace("{wait}", vars.wait), isError: true, summary: tr(loc, known.summary) };
}

// ── Running a request inside a control session ───────────────────────────────
const call = (c: ToolContext, t: Target, op: string, args: Record<string, unknown>, timeoutMs = 30_000) =>
  relayRequest(t.id, { id: c.bot.id, name: c.bot.name }, op, args, { timeoutMs, signal: c.signal });

async function startSession(c: ToolContext, t: Target, reason: string): Promise<RelayResult> {
  const loc = c.user.locale;
  setLive(c.user.id, c.bot.id, { running: true, activity: { kind: "waiting", since: Date.now() }, awaiting: { reason: tr(loc, "answer on {device}", { device: t.label }), since: Date.now() } });
  // A consent question waits up to 60 s on the computer (§7).
  const r = await call(c, t, "session.start", { reason: clip(reason || `${c.bot.name} would like to use this computer for you.`, 300) }, 90_000);
  setLive(c.user.id, c.bot.id, { running: true, awaiting: null, activity: { kind: "computer", detail: t.name, since: Date.now() } });
  return r;
}

type Need = "control" | "session-only";

/**
 * Finds the computer, makes sure this bot has a control session on it, then runs `fn`. A session is only opened here
 * when the app's approval already covers it (the gate asked for this call, or "Always" for this bot outside a tainted
 * turn); a session that ended under the bot's feet sends it back through the card otherwise.
 */
async function inSession(c: ToolContext, a: Record<string, any>, need: Need, reason: string, fn: (t: Target) => Promise<ToolOutput>): Promise<ToolOutput> {
  const p = pick(c.user.id, a.device);
  if (!p.target) return { content: p.error!, isError: true, summary: tr(c.user.locale, "no computer") };
  const t = p.target;
  const live = liveDevice(c.user.id, t.id);
  if (!live) return refusal(c, t, { ok: false, code: "offline", message: "" });
  if (heldBack(c.bot.id, t.id)) return { content: "The user stopped your control of this computer from Sklubot. Do not take control again unless they ask you to.", isError: true, summary: tr(c.user.locale, "stopped by you") };
  if (live.locked) return refusal(c, t, { ok: false, code: "locked", message: "" });
  if (live.session && live.session.botId !== c.bot.id) return refusal(c, t, { ok: false, code: "busy", message: "" });
  const hadSession = live.session?.botId === c.bot.id;
  if (!hadSession) {
    if (need === "session-only") return { content: `You have no control session on ${t.label}. Look at its screen with my_screen first: that asks the user for control.`, isError: true, summary: tr(c.user.locale, "no control session") };
    const s = await startSession(c, t, reason);
    if (!s.ok) return refusal(c, t, s);
  }
  const out = await fn(t);
  return out;
}

/** One request; a lost session is reopened only when the app's approval allows it without asking. */
async function act(c: ToolContext, t: Target, op: string, args: Record<string, unknown>, timeoutMs?: number): Promise<RelayResult> {
  const r = await call(c, t, op, args, timeoutMs);
  if (r.ok || r.code !== "no_session") return r;
  const allowed = policies.get(c.user.id, controlKey(c.bot.name)) === "always_allow" && !c.tainted;
  if (!allowed) return { ok: false, code: "session_ended", message: "" };
  const s = await startSession(c, t, "");
  if (!s.ok) return s;
  return call(c, t, op, args, timeoutMs);
}

const SESSION_ENDED: ToolOutput = { content: "Your control session on this computer has ended (on the computer). If you still need it, call the tool again: the user will be asked for control again.", isError: true, summary: "session ended" };
const failed = (c: ToolContext, t: Target, r: RelayResult): ToolOutput => (r.ok ? { content: "" } : r.code === "session_ended" ? { ...SESSION_ENDED, summary: tr(c.user.locale, "session ended") } : refusal(c, t, r));

/** Takes a screenshot of the computer: the picture for the model, and the scale for later clicks. */
async function capture(c: ToolContext, t: Target): Promise<{ text: string; image: ImageBlock } | RelayResult> {
  const live = liveDevice(c.user.id, t.id);
  // A phone screen is tall (e.g. 1080×2400): 720 pixels wide is enough to read it, and keeps the picture small.
  const maxWidth = Math.max(64, Math.min(t.kind === "phone" ? 720 : 1280, live?.screen?.width ?? 1280));
  const r = await act(c, t, "screen.capture", { format: "jpeg", maxWidth, quality: 70 });
  if (!r.ok) return r;
  const res = r.result as { format?: string; width?: number; height?: number; screenWidth?: number; screenHeight?: number; data?: string };
  if (typeof res.data !== "string" || !res.data) return { ok: false, code: "internal", message: "empty capture" };
  const text = t.kind === "phone"
    ? `Screenshot of the phone ${t.label}: ${res.width}×${res.height} pixels (the screen itself is ${res.screenWidth}×${res.screenHeight}). Give coordinates to my_click (a tap), my_drag and my_scroll in pixels of this picture, from its top-left corner. my_windows lists the text on screen with positions.`
    : `Screenshot of ${t.label}: ${res.width}×${res.height} pixels (the screen itself is ${res.screenWidth}×${res.screenHeight}). Give coordinates to my_click, my_drag and my_scroll in pixels of this picture, from its top-left corner.`;
  return { text, image: { type: "image", mediaType: res.format === "png" ? "image/png" : "image/jpeg", data: res.data } };
}

/** A position in the last screenshot → screen coordinates (§6: x = xImage × screenWidth / width). */
function toScreen(c: ToolContext, t: Target, x: number, y: number): { x: number; y: number } {
  const live = liveDevice(c.user.id, t.id);
  const cap = live?.lastCapture;
  const sx = cap ? Math.round((x * cap.screenWidth) / cap.width) : Math.round(x);
  const sy = cap ? Math.round((y * cap.screenHeight) / cap.height) : Math.round(y);
  const w = live?.screen?.width ?? cap?.screenWidth, h = live?.screen?.height ?? cap?.screenHeight;
  return { x: Math.max(0, w ? Math.min(w - 1, sx) : sx), y: Math.max(0, h ? Math.min(h - 1, sy) : sy) };
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** After an action: say what was done and show the screen as it is now (a failed look is not an error of the action). */
async function done(c: ToolContext, t: Target, said: string, summary: string): Promise<ToolOutput> {
  await pause(600);
  const shot = await capture(c, t);
  if ("image" in shot) return { content: [{ type: "text", text: `${said}\n${shot.text}` } as TextBlock, shot.image], summary };
  return { content: `${said} (No new screenshot: ${shot.ok ? "" : shot.code}.)`, summary };
}

const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : Number(v));

// ── Phones (protocol 1.2, §13) ───────────────────────────────────────────────
/** my_key on a phone: Android's global actions, and enter in the focused field. */
const PHONE_KEYS: Record<string, string> = {
  back: "back", escape: "back", esc: "back", home: "home", recents: "recents", overview: "recents", app_switch: "recents", apps: "recents",
  notifications: "notifications", quick_settings: "quick_settings", quicksettings: "quick_settings", enter: "enter", return: "enter",
};
const PHONE_KEY_LIST = "back, home, recents, notifications, quick_settings, enter";

/** A scroll on a phone is a swipe the other way: to see further down, the finger moves up. */
function phoneSwipe(c: ToolContext, t: Target, direction: string, notches: number, at: { x?: number; y?: number }): Record<string, number> {
  const live = liveDevice(c.user.id, t.id);
  const w = live?.screen?.width ?? live?.lastCapture?.screenWidth ?? 1080;
  const h = live?.screen?.height ?? live?.lastCapture?.screenHeight ?? 2400;
  const cx = at.x ?? Math.round(w / 2), cy = at.y ?? Math.round(h / 2);
  const vertical = direction === "up" || direction === "down";
  const span = Math.round(Math.min(0.7, 0.15 * Math.max(1, Math.min(10, notches))) * (vertical ? h : w));
  const sign = direction === "down" || direction === "right" ? 1 : -1;
  const clampX = (v: number) => Math.max(1, Math.min(w - 2, Math.round(v))), clampY = (v: number) => Math.max(1, Math.min(h - 2, Math.round(v)));
  return vertical
    ? { fromX: clampX(cx), fromY: clampY(cy + (sign * span) / 2), toX: clampX(cx), toY: clampY(cy - (sign * span) / 2), durationMs: 350 }
    : { fromX: clampX(cx + (sign * span) / 2), fromY: clampY(cy), toX: clampX(cx - (sign * span) / 2), toY: clampY(cy), durationMs: 350 };
}

/** The phone's screen text (screen.read) for the model, with positions in the last screenshot's pixels when there is one. */
function phoneScreenText(c: ToolContext, t: Target, r: Record<string, unknown>): string {
  const cap = liveDevice(c.user.id, t.id)?.lastCapture;
  const sx = (v: number) => (cap ? Math.round((v * cap.width) / cap.screenWidth) : Math.round(v));
  const sy = (v: number) => (cap ? Math.round((v * cap.height) / cap.screenHeight) : Math.round(v));
  const app = (r.app ?? {}) as { package?: unknown; label?: unknown };
  const nodes = Array.isArray(r.nodes) ? (r.nodes as { text?: unknown; desc?: unknown; bounds?: unknown; click?: unknown; edit?: unknown; focused?: unknown; checked?: unknown }[]).slice(0, 400) : [];
  const lines = nodes.map((n) => {
    const b = Array.isArray(n.bounds) ? n.bounds.map(Number) : [0, 0, 0, 0];
    const label = [n.text, n.desc].map((x) => clip(String(x ?? ""), 200)).filter(Boolean).join(" — ") || "(no text)";
    const tags = [n.edit ? "text field" : "", n.click ? "tappable" : "", n.focused ? "focused" : "", n.checked === true ? "checked" : n.checked === false ? "unchecked" : ""].filter(Boolean).join(", ");
    return `- "${label}"${tags ? ` [${tags}]` : ""} at (${sx(b[0] + b[2] / 2)}, ${sy(b[1] + b[3] / 2)})`;
  });
  const where = cap ? "positions are in pixels of your last screenshot" : "positions are screen pixels (take a screenshot with my_screen before tapping)";
  return `App in front on the phone ${t.label}: ${clip(String(app.label ?? "?"), 80)} (${clip(String(app.package ?? "?"), 120)}).\nOn-screen text and controls (${where}):\n${lines.join("\n") || "(nothing readable)"}${r.truncated ? "\n(more elements not shown)" : ""}`;
}

const NOT_ON_PHONE = (what: string): ToolOutput => ({ content: `${what} is not available on a phone.`, isError: true, summary: "not on a phone" });

// ── The user's own files (spec 07 A15, relay protocol 1.1) ──────────────────
export const FILE_OPS = ["fs.roots", "fs.list", "fs.read", "fs.write", "fs.trash"];
const filesKey = (botName: string) => `myfiles: write: ${botName}`;
const FOLDER = str("The shared folder, by the name my_files lists (e.g. \"Documents\")");
const FILE_PATH = str("Path inside that folder, with / between folders (e.g. \"factures/2026/mars.txt\")");

/** Writing or trashing a file: asked every time, never "Always" (the relay also needs the folder shared for writing). */
const filesWriteGate: Gate = (a, ctx) => {
  const bot = bots.byId(ctx.botId);
  if (!bot) return null;
  const { target } = pick(bot.userId, a.device);
  if (!target) return null;
  const trash = a.mode === undefined && a.text === undefined;
  return {
    key: filesKey(bot.name), strict: true, once: true, source: SOURCE, vars: { device: target.label, path: clip(String(a.path ?? ""), 200), folder: clip(String(a.folder ?? ""), 80) },
    title: trash ? "Allow {bot} to move {path} (in {folder}) to the trash on {device}?" : "Allow {bot} to write {path} in {folder} on {device}?",
    reason: trash ? "move a file to the trash on {device}" : "write a file on {device}",
    note: trash ? "It goes to the computer's trash, never deleted for good." : "If the file exists, its previous version goes to the computer's trash first.",
  };
};

/**
 * Finds the computer for a file operation. The user's files are only for work the user started themselves in this
 * chat: never from a routine, a nudge, a background task, a helper or a message from another bot (an email from a
 * stranger must not make the bot read the user's documents).
 */
function filesTarget(c: ToolContext, a: Record<string, any>): { target: Target } | { out: ToolOutput } {
  if (c.origin !== "user" || c.bot.parentId) return { out: { content: "The user's own files can only be used in work the user started themselves in this chat — not from a routine, a background task, a nudge or a message from another bot. Ask the user in the chat.", isError: true, summary: tr(c.user.locale, "not from background work") } };
  const p = pick(c.user.id, a.device);
  if (!p.target) return { out: { content: p.error!, isError: true, summary: tr(c.user.locale, "no computer") } };
  const live = liveDevice(c.user.id, p.target.id);
  if (!live) return { out: refusal(c, p.target, { ok: false, code: "offline", message: "" }) };
  if (live.locked) return { out: refusal(c, p.target, { ok: false, code: "locked", message: "" }) };
  if (p.target.kind === "phone") return { out: { content: `${p.target.label} is a phone: shared folders exist only on computers (Sklubot Relais).`, isError: true, summary: tr(c.user.locale, "not on a phone") } };
  if (!FILE_OPS.every((op) => live.capabilities.includes(op))) return { out: { content: `The Sklubot Relais app on ${p.target.label} is too old for files (it needs protocol 1.1). Ask the user to update it.`, isError: true, summary: tr(c.user.locale, "relay too old") } };
  return { target: p.target };
}

const fileTools: BuiltinTool[] = [
  tool("my_files", "List the folders the user shared with Sklubot on their own computer (in the Sklubot Relais app), or the content of one of them. Hidden, system and secret files are never shown.",
    obj({ folder: str("Optional: a shared folder to list (by name); without it, the shared folders themselves"), path: str("Optional: a subfolder inside it"), device: DEVICE }), {
    activity: "reading", label: "Listing your files", outside: true, audited: true, detail: (a) => clip(String(a.folder ?? ""), 40),
    run: async (a, c) => {
      const f = filesTarget(c, a);
      if ("out" in f) return f.out;
      const t = f.target;
      if (!a.folder) {
        const r = await call(c, t, "fs.roots", {});
        if (!r.ok) return failed(c, t, r);
        const roots = Array.isArray(r.result.roots) ? (r.result.roots as { name?: unknown; write?: unknown }[]).slice(0, 50) : [];
        return { content: roots.length ? `Folders the user shared on ${t.label}:\n${roots.map((x) => `- ${clip(String(x.name ?? ""), 80)}${x.write ? " (read and write)" : " (read only)"}`).join("\n")}` : `The user has not shared any folder on ${t.label}. They can add one in the Sklubot Relais app (Shared folders).`, summary: `${roots.length}` };
      }
      const r = await call(c, t, "fs.list", { root: clip(String(a.folder), 80), path: clip(String(a.path ?? ""), 1000) });
      if (!r.ok) return failed(c, t, r);
      const entries = Array.isArray(r.result.entries) ? (r.result.entries as { name?: unknown; dir?: unknown; size?: unknown; modifiedAt?: unknown }[]).slice(0, 500) : [];
      const lines = entries.map((e) => `- ${clip(String(e.name ?? ""), 200)}${e.dir ? "/" : ` (${Number(e.size) || 0} bytes)`}`);
      return { content: `${a.folder}/${a.path ?? ""} on ${t.label}:\n${lines.join("\n") || "(empty)"}${r.result.truncated ? "\n(more entries not shown)" : ""}`, summary: `${entries.length}` };
    },
  }),
  tool("my_file_read", "Read a text file from a folder the user shared on their own computer (256 KiB at most). Only when the user asked for it.",
    obj({ folder: FOLDER, path: FILE_PATH, device: DEVICE }, ["folder", "path"]), {
    activity: "reading", label: "Reading one of your files", outside: true, audited: true, detail: (a) => clip(String(a.path ?? ""), 60),
    run: async (a, c) => {
      const f = filesTarget(c, a);
      if ("out" in f) return f.out;
      const r = await call(c, f.target, "fs.read", { root: clip(String(a.folder), 80), path: clip(String(a.path ?? ""), 1000) });
      if (!r.ok) return failed(c, f.target, r);
      return { content: `${a.folder}/${a.path} (${Number(r.result.size) || 0} bytes${r.result.truncated ? ", only the start" : ""}):\n\n${clip(String(r.result.text ?? ""), 60_000)}`, summary: clip(String(a.path), 60) };
    },
  }),
  tool("my_file_write", "Write a text file in a folder the user shared for writing on their own computer. mode \"create\" (default) never overwrites; \"replace\" changes an existing file, whose previous version goes to the computer's trash. The user is asked every time. No programs or shortcuts.",
    obj({ folder: FOLDER, path: FILE_PATH, text: str("The full text of the file"), mode: { type: "string", enum: ["create", "replace"] }, device: DEVICE }, ["folder", "path", "text"]), {
    activity: "saving", label: "Writing one of your files", audited: true, gate: filesWriteGate, detail: (a) => clip(String(a.path ?? ""), 60),
    run: async (a, c) => {
      const f = filesTarget(c, a);
      if ("out" in f) return f.out;
      const text = String(a.text ?? "");
      if (Buffer.byteLength(text) > 200 * 1024) return { content: "That is too long to write on the computer (200 KiB at most).", isError: true };
      const r = await call(c, f.target, "fs.write", { root: clip(String(a.folder), 80), path: clip(String(a.path ?? ""), 1000), text, mode: a.mode === "replace" ? "replace" : "create" });
      if (!r.ok) return failed(c, f.target, r);
      audit(c.user.id, "computer", `${c.bot.name} → ${f.target.label} : ${tr(c.user.locale, "file written")} ${clip(`${a.folder}/${a.path}`, 200)}`, c.bot.id);
      return { content: `Wrote ${a.folder}/${a.path} on ${f.target.label}${r.result.previous === "trashed" ? " (its previous version is in the computer's trash)" : ""}.`, summary: clip(String(a.path), 60) };
    },
  }),
  tool("my_file_trash", "Move a file from a folder the user shared for writing to the computer's trash (never deleted for good). The user is asked every time.",
    obj({ folder: FOLDER, path: FILE_PATH, device: DEVICE }, ["folder", "path"]), {
    activity: "saving", label: "Moving one of your files to the trash", audited: true, gate: filesWriteGate, detail: (a) => clip(String(a.path ?? ""), 60),
    run: async (a, c) => {
      const f = filesTarget(c, a);
      if ("out" in f) return f.out;
      const r = await call(c, f.target, "fs.trash", { root: clip(String(a.folder), 80), path: clip(String(a.path ?? ""), 1000) });
      if (!r.ok) return failed(c, f.target, r);
      audit(c.user.id, "computer", `${c.bot.name} → ${f.target.label} : ${tr(c.user.locale, "file moved to the trash")} ${clip(`${a.folder}/${a.path}`, 200)}`, c.bot.id);
      return { content: `Moved ${a.folder}/${a.path} to the trash on ${f.target.label}.`, summary: clip(String(a.path), 60) };
    },
  }),
];

export const myComputerTools: BuiltinTool[] = [
  ...fileTools,
  tool("my_computers", "List the user's own computers and phones linked through Sklubot Relais or the Sklubot Android app (not your own computer): whether each is connected, locked by the user, or controlled by a bot right now.", obj({}), {
    activity: "computer", label: "Checking your computers",
    run: async (_a, c) => {
      const list = listDevices(c.user.id);
      if (!list.length) return { content: "The user has no computer or phone linked. They can link one in Settings → Computers, with the Sklubot Relais app (computer) or the Sklubot Android app (phone).", summary: tr(c.user.locale, "none linked") };
      const lines = list.map((d) => `- ${d.name} (${d.kind === "phone" ? "phone, " : ""}${d.platform || "?"}): ${d.status}${d.locked ? ", locked by the user (Stop)" : ""}${d.session ? `, controlled by ${d.session.botId === c.bot.id ? "you" : d.session.botName}` : ""}${d.screen ? `, screen ${d.screen.width}×${d.screen.height}` : ""}`);
      return { content: `The user's devices:\n${lines.join("\n")}\nUse my_screen to look at one: that asks the user for control (on the device and here). On a phone there are no commands.`, summary: `${list.length}` };
    },
  }),
  tool("my_screen", "Take a screenshot of the USER'S OWN computer or phone (through Sklubot Relais or the Sklubot Android app), to see what is on it. The first time, this asks the user for control of the device. It is their real device: act only as they asked, carefully.",
    obj({ device: DEVICE, reason: str("Why you need their computer, in one sentence: shown to the user in the permission question") }), {
    activity: "computer", label: "Looking at your computer", outside: true, audited: true, gate: controlGate, detail: (a) => (typeof a.device === "string" ? a.device : undefined),
    run: async (a, c) => inSession(c, a, "control", String(a.reason ?? ""), async (t) => {
      const shot = await capture(c, t);
      if (!("image" in shot)) return failed(c, t, shot);
      return { content: [{ type: "text", text: shot.text }, shot.image], summary: t.name };
    }),
  }),
  tool("my_click", "Click on the user's own computer, or tap on their phone, at a position in your last my_screen screenshot (pixels from its top-left corner). Returns a new screenshot.",
    obj({ x: numb("Pixels from the left of the screenshot"), y: numb("Pixels from the top of the screenshot"), button: { type: "string", enum: ["left", "right", "middle"] }, double: { type: "boolean", description: "Double-click (double tap on a phone)" }, long_press: { type: "boolean", description: "Phone only: press and hold" }, device: DEVICE }, ["x", "y"]), {
    activity: "computer", label: "Clicking on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      const p = toScreen(c, t, num(a.x), num(a.y));
      if (t.kind === "phone") {
        const long = a.long_press === true || a.button === "right";
        const r = await act(c, t, "touch.tap", { ...p, long, double: !long && a.double === true });
        if (!r.ok) return failed(c, t, r);
        return done(c, t, `${long ? "Long-pressed" : a.double ? "Double-tapped" : "Tapped"} at (${a.x}, ${a.y}).`, `${p.x}, ${p.y}`);
      }
      const button = a.button === "right" || a.button === "middle" ? a.button : "left";
      const r = await act(c, t, "mouse.click", { ...p, button, double: a.double === true });
      if (!r.ok) return failed(c, t, r);
      return done(c, t, `${a.double ? "Double-clicked" : button === "right" ? "Right-clicked" : "Clicked"} at (${a.x}, ${a.y}).`, `${p.x}, ${p.y}`);
    }),
  }),
  tool("my_drag", "Press the mouse at one point of the user's computer, move to another and release (positions in your last screenshot's pixels).",
    obj({ from_x: numb("Start x"), from_y: numb("Start y"), to_x: numb("End x"), to_y: numb("End y"), device: DEVICE }, ["from_x", "from_y", "to_x", "to_y"]), {
    activity: "computer", label: "Dragging on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      const from = toScreen(c, t, num(a.from_x), num(a.from_y)), to = toScreen(c, t, num(a.to_x), num(a.to_y));
      // On a phone: press and hold, then move without lifting.
      const r = t.kind === "phone"
        ? await act(c, t, "touch.swipe", { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y, durationMs: 600, hold: true })
        : await act(c, t, "mouse.drag", { fromX: from.x, fromY: from.y, toX: to.x, toY: to.y });
      if (!r.ok) return failed(c, t, r);
      return done(c, t, "Dragged.", "");
    }),
  }),
  tool("my_scroll", "Scroll on the user's computer or phone (on a phone: a swipe), optionally at a position of your last screenshot. \"down\" shows what is further down.",
    obj({ direction: { type: "string", enum: ["up", "down", "left", "right"] }, amount: numb("Notches, default 3 (max 100; on a phone 1–10, 3 ≈ half a screen)"), x: numb("Optional: pixels from the left"), y: numb("Optional: pixels from the top"), device: DEVICE }, ["direction"]), {
    activity: "computer", label: "Scrolling on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      const n = Math.max(1, Math.min(100, Math.round(num(a.amount ?? 3)) || 3));
      const at = a.x !== undefined && a.y !== undefined ? toScreen(c, t, num(a.x), num(a.y)) : {};
      const d = String(a.direction);
      const r = t.kind === "phone"
        ? await act(c, t, "touch.swipe", phoneSwipe(c, t, d, n, at))
        : await act(c, t, "mouse.scroll", { ...at, dx: d === "left" ? -n : d === "right" ? n : 0, dy: d === "up" ? -n : d === "down" ? n : 0 });
      if (!r.ok) return failed(c, t, r);
      return done(c, t, `Scrolled ${d}.`, d);
    }),
  }),
  tool("my_type", "Type text on the user's computer or phone, into whatever has keyboard focus there (click or tap the field first).", obj({ text: str("Text to type"), device: DEVICE }, ["text"]), {
    activity: "computer", label: "Typing on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      const text = String(a.text ?? "");
      if (!text) return { content: "Nothing to type.", isError: true };
      if (text.length > 10_000) return { content: "That is too long to type (10 000 characters at most). Save it to a file instead.", isError: true };
      for (let i = 0; i < text.length; i += 2000) {
        const r = await act(c, t, "keyboard.type", { text: text.slice(i, i + 2000) });
        if (!r.ok) return failed(c, t, r);
      }
      return done(c, t, `Typed ${text.length} characters.`, `${text.length}`);
    }),
  }),
  tool("my_key", `Press a key or a combination on the user's computer, e.g. enter, escape, tab, pagedown, ctrl+c, cmd+space, ctrl+shift+t. On a phone: ${PHONE_KEY_LIST}.`, obj({ keys: str("Key name, or modifiers and a key joined with +"), device: DEVICE }, ["keys"]), {
    activity: "computer", label: "Pressing keys on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone") {
        const action = PHONE_KEYS[String(a.keys ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_")];
        if (!action) return { content: `On a phone, my_key accepts only: ${PHONE_KEY_LIST}. To type text, use my_type.`, isError: true, summary: clip(String(a.keys), 30) };
        const r = await act(c, t, "global.action", { action });
        if (!r.ok) return failed(c, t, r);
        return done(c, t, `Pressed ${action} on the phone.`, action);
      }
      const r = await act(c, t, "keyboard.press", { key: clip(String(a.keys ?? "").trim(), 64) });
      if (!r.ok) return failed(c, t, r);
      return done(c, t, `Pressed ${a.keys}.`, clip(String(a.keys), 30));
    }),
  }),
  tool("my_open", "On the user's computer or phone, open a web address in their default browser (http, https or mailto) or start an application by its plain name (e.g. \"Calculator\", \"TextEdit\", \"notepad\"; on a phone its name as shown, e.g. \"Agenda\", or its package name).",
    obj({ url: str("Address to open"), app: str("Application name"), device: DEVICE }), {
    activity: "computer", label: "Opening on your computer", outside: true, audited: true, gate: openGate, detail: (a) => clip(String(a.url ?? a.app ?? ""), 60),
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      const url = typeof a.url === "string" ? a.url.trim() : "";
      const app = typeof a.app === "string" ? a.app.trim() : "";
      if (!url === !app) return { content: "Give either url or app.", isError: true };
      const r = url ? await act(c, t, "url.open", { url }) : await act(c, t, "app.open", { name: app });
      if (!r.ok) return failed(c, t, r);
      await pause(900);
      return done(c, t, url ? `Opened ${url}.` : `Started ${app}.`, clip(url || app, 60));
    }),
  }),
  tool("my_windows", "List the open windows on the user's computer (their titles). On a phone: the app in front and the text and controls on screen, with positions.", obj({ device: DEVICE }), {
    activity: "computer", label: "Listing your windows", outside: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone") {
        const r = await act(c, t, "screen.read", { maxNodes: 200 });
        if (!r.ok) return failed(c, t, r);
        return { content: phoneScreenText(c, t, r.result), summary: clip(String((r.result.app as { label?: unknown } | undefined)?.label ?? ""), 40) };
      }
      const r = await act(c, t, "window.list", {});
      if (!r.ok) return failed(c, t, r);
      const list = Array.isArray(r.result.windows) ? (r.result.windows as { title?: unknown }[]).map((w) => clip(String(w?.title ?? ""), 200)).filter(Boolean).slice(0, 80) : [];
      return { content: list.length ? `Open windows on ${t.label}:\n${list.map((x) => `- ${x}`).join("\n")}` : "No window titles were reported.", summary: `${list.length}` };
    }),
  }),
  tool("my_window_focus", "Bring a window of the user's computer to the front, by its title (on macOS: the application of that name).", obj({ title: str("Window title, or part of it"), device: DEVICE }, ["title"]), {
    activity: "computer", label: "Switching windows on your computer", outside: true, audited: true, gate: controlGate,
    run: async (a, c) => inSession(c, a, "control", "", async (t) => {
      if (t.kind === "phone") return { content: "A phone has no windows to bring forward: open the app with my_open (or my_key recents).", isError: true, summary: tr(c.user.locale, "not on a phone") };
      const r = await act(c, t, "window.focus", { title: clip(String(a.title ?? ""), 200) });
      if (!r.ok) return failed(c, t, r);
      return done(c, t, r.result.focused === false ? `No window matched "${a.title}".${r.result.note ? ` ${r.result.note}` : ""}` : `Brought "${a.title}" to the front.`, clip(String(a.title), 40));
    }),
  }),
  tool("my_command", "Run a shell command on the user's own computer (their default shell, in their home folder unless cwd is given) and return its output. The user is asked here and on the computer, with the exact command. You need a control session (my_screen) first.",
    obj({ command: str("The command line"), timeout_seconds: numb("Give up after this many seconds (default 30, max 600)"), cwd: str("Folder to run it in"), device: DEVICE }, ["command"]), {
    activity: "shell", label: "Running a command on your computer", outside: true, audited: true, gate: commandGate, detail: (a) => clip(String(a.command ?? ""), 60),
    run: async (a, c) => {
      // A phone never runs commands (its relay does not offer shell.run): refused here, nothing is sent.
      const p = pick(c.user.id, a.device);
      if (p.target?.kind === "phone") return { ...NOT_ON_PHONE(`Running commands on ${p.target.label}`), summary: tr(c.user.locale, "not on a phone") };
      return inSession(c, a, "session-only", "", async (t) => {
      const command = String(a.command ?? "");
      if (!command.trim()) return { content: "Give a command.", isError: true };
      if (Buffer.byteLength(command) > 8192) return { content: "That command is too long (8 KiB at most).", isError: true };
      const timeoutMs = Math.round(Math.max(1, Math.min(600, num(a.timeout_seconds ?? 30) || 30)) * 1000);
      const loc = c.user.locale;
      audit(c.user.id, "computer", `${c.bot.name} → ${t.label} : ${tr(loc, "command")} ${clip(command, 300)}`, c.bot.id);
      // The computer shows its own question (up to 60 s) before the command's own time starts.
      const r = await act(c, t, "shell.run", { command, timeoutMs, maxOutputBytes: 64 * 1024, ...(typeof a.cwd === "string" && a.cwd.trim() ? { cwd: clip(a.cwd, 1000) } : {}) }, timeoutMs + 75_000);
      if (!r.ok) return failed(c, t, r);
      const o = r.result as { exitCode?: number | null; signal?: string | null; stdout?: string; stderr?: string; truncated?: boolean; timedOut?: boolean; cancelled?: boolean; durationMs?: number };
      const head = o.timedOut ? `Timed out after ${timeoutMs / 1000}s.` : o.cancelled ? "Cancelled." : `Exit code ${o.exitCode ?? "?"}${o.signal ? ` (signal ${o.signal})` : ""}.`;
      const body = [o.stdout ? `stdout:\n${clip(String(o.stdout), 30_000)}` : "", o.stderr ? `stderr:\n${clip(String(o.stderr), 10_000)}` : ""].filter(Boolean).join("\n\n") || "(no output)";
      const summary = o.timedOut ? tr(loc, "timed out") : o.cancelled ? tr(loc, "cancelled") : `exit ${o.exitCode ?? "?"}`;
      pushLater(c.user.id, { kind: "computer", title: t.label, body: tr(loc, "{bot} ran a command: {command}", { bot: c.bot.name, command: clip(command, 120) }), botId: c.bot.id, tag: `relay-cmd-${t.id}` });
      audit(c.user.id, "computer", `${c.bot.name} → ${t.label} : ${summary}`, c.bot.id);
      return { content: `${head}${o.truncated ? " (output truncated)" : ""}\n${body}`, summary, isError: !!o.timedOut || (typeof o.exitCode === "number" && o.exitCode !== 0) };
      });
    },
  }),
  tool("my_release", "Give control of the user's computer or phone back to them (end your control session) when you are done with it.", obj({ device: DEVICE }), {
    activity: "computer", label: "Handing your computer back",
    run: async (a, c) => {
      const p = pick(c.user.id, a.device);
      if (!p.target) return { content: p.error!, isError: true };
      if (!hasSession(c.user.id, p.target.id, c.bot.id)) return { content: "You had no control session there.", summary: tr(c.user.locale, "nothing to release") };
      const r = await call(c, p.target, "session.end", {});
      return r.ok ? { content: "Control handed back to the user.", summary: p.target.name } : failed(c, p.target, r);
    },
  }),
];
