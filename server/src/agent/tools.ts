import { unseal } from "../auth.js";
import { emit, getLive } from "../bus.js";
import { attachmentAt, botPathOf, browserAvailable, computerKind, runShell, saveFile, screen, storeBytes, type Shot } from "../computer.js";
import { generateImage, imageService } from "../images.js";
import { config } from "../config.js";
import { isValidTimezone, parseCron } from "../cron.js";
import { tr } from "../i18n.js";
import type { ImageBlock, TextBlock, ToolSpec } from "../llm/types.js";
import { describeRoutine, routines } from "../routines.js";
import { schedule, unschedule } from "../scheduler.js";
import type { ActivityKind } from "../shared.js";
import { bots, clip, memories, rows, settings, tasks, vault, type BotRecord, type UserRecord } from "../store.js";
import { interrupt } from "./loop.js";
import { createRoom, deliverBotMessage, dispatchToRoom, MAX_HELPERS, MAX_HOPS, startHelper } from "./team.js";

export interface ToolContext { bot: BotRecord; user: UserRecord; depth: number; signal: AbortSignal }
export interface ToolOutput {
  content: string | Array<TextBlock | ImageBlock>;
  /** One short line shown next to the step in the chat. */
  summary?: string;
  isError?: boolean;
  /** Stop the turn once this batch of calls is finished. */
  endTurn?: boolean;
}
export interface BuiltinTool {
  spec: ToolSpec;
  activity: ActivityKind;
  label: string;
  /** Sensitive tools ask first unless the bot is trusted with them. */
  sensitive?: boolean;
  /** Asks permission per call under its own key (English templates; {bot} and the vars are filled in). */
  gate?: (args: Record<string, any>) => { key: string; title: string; reason: string; source: string; vars: Record<string, string> } | null;
  /** Extra detail for the live activity line. */
  detail?: (args: Record<string, any>) => string | undefined;
  run(args: Record<string, any>, ctx: ToolContext): Promise<ToolOutput>;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });
const int = (description: string) => ({ type: "integer", description });

const shot = (s: Shot, caption: string): ToolOutput => ({
  content: [
    { type: "text", text: `${caption}\n${s.url ? `Page: ${s.title || "(untitled)"} — ${s.url}` : `Window in front: ${s.title || "(the desktop)"}`}\nThe screenshot is ${config.desktopResolution.split("x").slice(0, 2).join("×")}; coordinates start at the top-left corner.` },
    { type: "image", mediaType: s.mediaType, data: s.data },
  ],
  summary: clip(s.title || s.url || "screen", 80),
});

const tool = (name: string, description: string, schema: ToolSpec["inputSchema"], rest: Omit<BuiltinTool, "spec">): BuiltinTool =>
  ({ spec: { name, description, inputSchema: schema }, ...rest });

const screenTools: BuiltinTool[] = [
  tool("screen_view", "Take a screenshot of your screen to see what is on it right now.", obj({}), {
    activity: "computer", label: "Looking at the screen",
    run: async (_a, c) => shot(await screen.view(c.bot.id, c.user.id), "Current screen."),
  }),
  tool("browser_open", "Open a web address in your browser and return a screenshot of the loaded page.", obj({ url: str("Address to open, e.g. https://example.com") }, ["url"]), {
    activity: "browsing", label: "Opening a page", detail: (a) => hostOf(a.url),
    run: async (a, c) => shot(await screen.open(c.bot.id, c.user.id, String(a.url)), `Opened ${a.url}.`),
  }),
  tool("page_read", "Return the visible text of the page currently open in your browser. Use this to read; use screen_view when layout or images matter.", obj({}), {
    activity: "reading", label: "Reading the page",
    run: async (_a, c) => {
      const p = await screen.read(c.bot.id, c.user.id);
      return { content: `${p.title}\n${p.url}\n\n${clip(p.text, 40_000)}`, summary: clip(p.title || p.url, 80) };
    },
  }),
  tool("screen_click", "Click at a position on the screen. Take a screenshot first so the coordinates are current.",
    obj({ x: int("Pixels from the left edge"), y: int("Pixels from the top edge"), button: { type: "string", enum: ["left", "right", "middle"] }, double: { type: "boolean", description: "Double-click" } }, ["x", "y"]), {
    activity: "computer", label: "Clicking",
    run: async (a, c) => shot(await screen.click(c.bot.id, c.user.id, +a.x, +a.y, a.button ?? "left", !!a.double), `Clicked at (${a.x}, ${a.y}).`),
  }),
  tool("screen_type", "Type text into whatever currently has keyboard focus.", obj({ text: str("Text to type") }, ["text"]), {
    activity: "computer", label: "Typing",
    run: async (a, c) => shot(await screen.type(c.bot.id, c.user.id, String(a.text)), `Typed ${String(a.text).length} characters.`),
  }),
  tool("screen_key", "Press a key or a combination, e.g. Enter, Escape, Tab, PageDown, ctrl+a, ctrl+l.", obj({ keys: str("Key name, or several joined with +") }, ["keys"]), {
    activity: "computer", label: "Pressing keys",
    run: async (a, c) => shot(await screen.key(c.bot.id, c.user.id, String(a.keys)), `Pressed ${a.keys}.`),
  }),
  tool("screen_scroll", "Scroll the page at a position.", obj({ x: int("Pixels from the left"), y: int("Pixels from the top"), direction: { type: "string", enum: ["up", "down"] }, amount: int("Notches to scroll, default 3") }, ["x", "y", "direction"]), {
    activity: "computer", label: "Scrolling",
    run: async (a, c) => shot(await screen.scroll(c.bot.id, c.user.id, +a.x, +a.y, (a.direction === "up" ? -1 : 1) * 120 * Math.max(1, +(a.amount ?? 3))), `Scrolled ${a.direction}.`),
  }),
  tool("screen_drag", "Press the mouse at one point, move to another and release.", obj({ from_x: int("Start x"), from_y: int("Start y"), to_x: int("End x"), to_y: int("End y") }, ["from_x", "from_y", "to_x", "to_y"]), {
    activity: "computer", label: "Dragging",
    run: async (a, c) => shot(await screen.drag(c.bot.id, c.user.id, +a.from_x, +a.from_y, +a.to_x, +a.to_y), "Dragged."),
  }),
];

function hostOf(url: unknown): string | undefined {
  try { return new URL(/^[a-z]+:/i.test(String(url)) ? String(url) : `https://${url}`).hostname.replace(/^www\./, ""); } catch { return undefined; }
}

/** Crude but dependable HTML → text: enough for a model to read an article or a docs page. */
function htmlToText(html: string): string {
  return html
    .replace(/<(script|style|noscript|svg|template)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr)[^>]*>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ").replace(/\n\s*\n\s*/g, "\n\n").trim();
}

const workTools: BuiltinTool[] = [
  tool("web_fetch", "Download a web page or text file and return its readable text. No browser needed.", obj({ url: str("http(s) address") }, ["url"]), {
    activity: "reading", label: "Reading a page", detail: (a) => hostOf(a.url),
    run: async (a, c) => {
      const url = String(a.url);
      if (!/^https?:\/\//i.test(url)) return { content: "Only http and https addresses can be fetched.", isError: true };
      const res = await fetch(url, { signal: AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]), headers: { "user-agent": "Mozilla/5.0 (compatible; assistant)" }, redirect: "follow" });
      const type = res.headers.get("content-type") ?? "";
      if (!/text|json|xml|javascript/.test(type)) return { content: `Fetched ${url} (status ${res.status}) but it is ${type || "binary"} content, not text.`, isError: !res.ok };
      const body = await res.text();
      return { content: `Status ${res.status}\n\n${clip(/html/.test(type) ? htmlToText(body) : body, 40_000)}`, summary: `${res.status} · ${hostOf(url) ?? ""}`, isError: !res.ok };
    },
  }),
  tool("shell_run", "Run a shell command on your computer and return its exit code and output.", obj({ command: str("Command line to run with bash"), timeout_seconds: int("Give up after this many seconds (default 120, max 290)") }, ["command"]), {
    activity: "shell", label: "Running a command", sensitive: true, detail: (a) => clip(String(a.command ?? ""), 60),
    run: async (a, c) => {
      const timeout = Math.min(290, Math.max(1, Number(a.timeout_seconds) || 120));
      const r = await runShell(c.bot.id, c.user.id, String(a.command), timeout, c.signal);
      return { content: `${r.timedOut ? `Timed out after ${timeout}s.` : `Exit code ${r.code}.`}\n${r.output || "(no output)"}`, summary: r.timedOut ? "timed out" : `exit ${r.code}`, isError: r.timedOut || r.code !== 0 };
    },
  }),
  tool("file_save", "Save a text file into your library so the user can open or download it. Use for reports, notes, drafts, data.", obj({ filename: str("File name, optionally with folders, e.g. reports/weekly.md"), content: str("Full text content") }, ["filename", "content"]), {
    activity: "saving", label: "Saving a file", detail: (a) => String(a.filename ?? ""),
    run: async (a, c) => {
      const saved = saveFile(c.bot.id, String(a.filename), String(a.content));
      return { content: `Saved as ${saved}.`, summary: saved };
    },
  }),
];

/** Library paths as the bot writes them ("~/files/x", "/root/files/x" or "x") → path inside the library. */
const libraryPath = (p: string) => p.trim().replace(/^(~|\/root)\/files\//, "").replace(/^\.\//, "");

const shareTools: BuiltinTool[] = [
  tool("file_send", "Show a file from your library to the user in the chat. Pictures appear inline; other files as a download.", obj({ path: str("Path of the file in your library"), caption: str("A line to go with it") }, ["path"]), {
    activity: "saving", label: "Sending a file", detail: (a) => String(a.path ?? ""),
    run: async (a, c) => {
      const att = attachmentAt(c.bot.id, libraryPath(String(a.path)));
      if (!att) return { content: `There is no file at ${a.path} in your library.`, isError: true };
      rows.append(c.bot, { kind: "message", role: "assistant", text: typeof a.caption === "string" ? a.caption : "", attachments: [att] });
      bots.bumpUnread(c.bot.id);
      return { content: "The user can see it in the chat now.", summary: att.name };
    },
  }),
  tool("image_generate", "Create a picture from a description. It is saved in your library and shown to the user in the chat.", obj({ prompt: str("What the picture should show, in detail: subject, style, colours, framing"), filename: str("Short file name without extension") }, ["prompt"]), {
    activity: "saving", label: "Creating an image",
    run: async (a, c) => {
      const img = await generateImage(String(a.prompt), c.signal);
      const ext = img.mime === "image/jpeg" ? "jpg" : img.mime === "image/webp" ? "webp" : "png";
      const att = storeBytes(c.bot.id, "images", `${String(a.filename ?? "image").trim() || "image"}.${ext}`, img.bytes);
      rows.append(c.bot, { kind: "message", role: "assistant", text: "", attachments: [att] });
      bots.bumpUnread(c.bot.id);
      return { content: `Created and shown to the user. Saved as ${botPathOf(att.path)}.`, summary: att.name };
    },
  }),
];

const vaultTools: BuiltinTool[] = [
  tool("vault_list", "List the logins the user has saved for you to use: names, sites and usernames. Passwords are never shown to you.", obj({}), {
    activity: "remembering", label: "Checking saved logins",
    run: async (_a, c) => {
      const items = vault.list(c.user.id);
      return { content: items.length ? JSON.stringify(items.map((i) => ({ name: i.name, site: i.site, username: i.username, has_password: i.hasPassword, note: i.note || undefined }))) : "No logins are saved. Ask the user to add one in Settings → Vault.", summary: `${items.length}` };
    },
  }),
  tool("vault_type", "Type a saved username or password into the field that has keyboard focus on your screen. Click the field first. You never see the password; the user is asked before it is used.",
    obj({ item: str("Name of the saved login"), field: { type: "string", enum: ["username", "password"] } }, ["item", "field"]), {
    activity: "computer", label: "Typing a saved login", detail: (a) => String(a.item ?? ""),
    gate: (a) => ({ key: `vault: ${String(a.item ?? "").trim()}`, title: "Allow {bot} to type the saved {field} for {item}?", reason: "type a saved login for {item}", source: "Vault", vars: { item: String(a.item ?? ""), field: a.field === "username" ? "username" : "password" } }),
    run: async (a, c) => {
      const item = vault.byName(c.user.id, String(a.item));
      if (!item) return { content: `No saved login is called "${a.item}". Use vault_list to see the names.`, isError: true };
      const value = a.field === "username" ? item.username : item.passwordEnc ? unseal(item.passwordEnc) : null;
      if (!value) return { content: `That login has no ${a.field} saved.`, isError: true };
      const s = await screen.type(c.bot.id, c.user.id, value);
      return { ...shot(s, `Typed the saved ${a.field} into the focused field.`), summary: `${item.name} · ${a.field}` };
    },
  }),
];

const memoryTools: BuiltinTool[] = [
  tool("memory_save", "Remember a lasting fact or preference. Write one short, self-contained sentence.", obj({ text: str("The fact to remember") }, ["text"]), {
    activity: "remembering", label: "Saving a note",
    run: async (a, c) => {
      const text = clip(String(a.text).trim(), 500);
      if (!text) return { content: "Nothing to remember.", isError: true };
      memories.add(c.bot.id, text, "chat");
      emit(c.user.id, { type: "memories", botId: c.bot.id });
      return { content: "Remembered.", summary: clip(text, 80) };
    },
  }),
  tool("memory_search", "Search everything you have remembered. Returns the most recent matches.", obj({ query: str("Words to look for") }, ["query"]), {
    activity: "remembering", label: "Checking notes",
    run: async (a, c) => {
      const terms = String(a.query).toLowerCase().split(/\s+/).filter((w) => w.length > 2);
      const all = memories.list(c.bot.id, 2000);
      const hits = (terms.length ? all.filter((m) => terms.some((t) => m.text.toLowerCase().includes(t))) : all).slice(0, 20);
      return { content: hits.length ? hits.map((m) => `- ${m.text} (${new Date(m.createdAt).toISOString().slice(0, 10)})`).join("\n") : "No matching memories.", summary: `${hits.length} found` };
    },
  }),
];

function announceRoutine(c: ToolContext, text: string) {
  rows.append(c.bot, { kind: "event", event: "routine", text });
  emit(c.user.id, { type: "routines", botId: c.bot.id });
}

function checkSchedule(scheduleExpr: string, tz: string): string | null {
  try { parseCron(scheduleExpr); } catch (e) { return `Invalid schedule: ${(e as Error).message}.`; }
  return isValidTimezone(tz) ? null : `Unknown timezone "${tz}". Use an IANA name such as Europe/Paris.`;
}

const routineTools: BuiltinTool[] = [
  tool("routine_create",
    "Create a routine: an instruction you will carry out later without being asked. Three kinds — 'cron' repeats on a schedule, 'once' runs a single time, 'webhook' runs whenever an outside system calls its web address.",
    obj({
      name: str("Short name"), prompt: str("What to do on each run, written as a complete instruction to yourself"),
      kind: { type: "string", enum: ["cron", "once", "webhook"] },
      schedule: str("For cron: five fields — minute hour day-of-month month day-of-week, e.g. '0 9 * * 1-5'"),
      run_at: str("For once: ISO 8601 date and time with offset, e.g. 2030-01-31T09:00:00+01:00"),
      timezone: str("IANA timezone for cron schedules, e.g. Europe/Paris. Ask the user if you do not know it."),
    }, ["name", "prompt", "kind"]), {
    activity: "planning", label: "Setting up a routine",
    run: async (a, c) => {
      const kind = a.kind as "cron" | "once" | "webhook";
      const tz = a.timezone ? String(a.timezone) : "UTC";
      let runAt: number | null = null;
      if (kind === "cron") {
        const problem = checkSchedule(String(a.schedule ?? ""), tz);
        if (problem) return { content: problem, isError: true };
      } else if (kind === "once") {
        runAt = Date.parse(String(a.run_at ?? ""));
        if (!Number.isFinite(runAt) || runAt <= Date.now()) return { content: "run_at must be a valid date and time in the future.", isError: true };
      } else if (kind !== "webhook") return { content: "kind must be cron, once or webhook.", isError: true };
      const r = routines.create(c.bot.id, { name: String(a.name), prompt: String(a.prompt), trigger: kind, schedule: kind === "cron" ? String(a.schedule) : "", timezone: tz, runAt });
      schedule(r.id);
      announceRoutine(c, tr(c.user.locale, "Routine created: {name} — {when}", { name: r.name, when: describeRoutine(r, c.user.locale) }));
      return { content: JSON.stringify({ id: r.id, when: describeRoutine(r), webhook_url: r.hookUrl ?? undefined }), summary: r.name };
    },
  }),
  tool("routine_list", "List your routines with their ids, schedules and state.", obj({}), {
    activity: "planning", label: "Checking routines",
    run: async (_a, c) => {
      const list = routines.forBot(c.bot.id);
      return { content: list.length ? JSON.stringify(list.map((r) => ({ id: r.id, name: r.name, when: describeRoutine(r), enabled: r.enabled, prompt: r.prompt, webhook_url: r.hookUrl ?? undefined }))) : "You have no routines.", summary: `${list.length} routines` };
    },
  }),
  tool("routine_update", "Change one of your routines. Only the fields you pass are changed.",
    obj({ id: str("Routine id"), name: str("New name"), prompt: str("New instruction"), schedule: str("New five-field schedule"), timezone: str("New IANA timezone"), enabled: { type: "boolean", description: "Pause (false) or resume (true)" } }, ["id"]), {
    activity: "planning", label: "Updating a routine",
    run: async (a, c) => {
      const cur = routines.byId(String(a.id));
      if (!cur || cur.botId !== c.bot.id) return { content: "No routine of yours has that id.", isError: true };
      if (cur.trigger === "cron") {
        const problem = checkSchedule(a.schedule ?? cur.schedule, a.timezone ?? cur.timezone);
        if (problem) return { content: problem, isError: true };
      }
      const r = routines.update(cur.id, { name: a.name, prompt: a.prompt, schedule: cur.trigger === "cron" ? a.schedule : undefined, timezone: a.timezone, enabled: typeof a.enabled === "boolean" ? a.enabled : undefined })!;
      schedule(r.id);
      announceRoutine(c, tr(c.user.locale, "Routine updated: {name} — {when}", { name: r.name, when: r.enabled ? describeRoutine(r, c.user.locale) : tr(c.user.locale, "paused") }));
      return { content: "Updated.", summary: r.name };
    },
  }),
  tool("routine_delete", "Delete one of your routines for good.", obj({ id: str("Routine id") }, ["id"]), {
    activity: "planning", label: "Removing a routine",
    run: async (a, c) => {
      const cur = routines.byId(String(a.id));
      if (!cur || cur.botId !== c.bot.id) return { content: "No routine of yours has that id.", isError: true };
      unschedule(cur.id);
      routines.remove(cur.id);
      emit(c.user.id, { type: "routines", botId: c.bot.id });
      return { content: "Deleted.", summary: cur.name };
    },
  }),
  tool("checkins_set", "Turn proactive check-ins on or off and set their times. Only the user's main bot performs check-ins. Ask for the timezone if you do not know it.",
    obj({ enabled: { type: "boolean" }, times: { type: "array", items: { type: "string" }, description: "Local times as HH:MM, 24-hour, at most 6" }, timezone: str("IANA timezone") }, ["enabled"]), {
    activity: "planning", label: "Adjusting check-ins",
    run: async (a, c) => {
      const cur = settings.checkins(c.user.id);
      if (a.timezone && !isValidTimezone(String(a.timezone))) return { content: `Unknown timezone "${a.timezone}".`, isError: true };
      const times = Array.isArray(a.times) ? a.times.filter((t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6) : cur.times;
      const next = { ...cur, enabled: !!a.enabled, times: times.length ? times : cur.times, timezone: a.timezone ? String(a.timezone) : cur.timezone };
      settings.saveCheckins(c.user.id, next);
      const text = next.enabled ? `Check-ins at ${next.times.join(", ")} (${next.timezone})` : "Check-ins off";
      return { content: text, summary: text };
    },
  }),
];

const taskTools: BuiltinTool[] = [
  tool("task_add", "Start tracking a piece of work so the user can follow it. Returns the task id.", obj({ title: str("What is being done") }, ["title"]), {
    activity: "planning", label: "Tracking a task",
    run: async (a, c) => {
      const t = tasks.create(c.bot.id, String(a.title));
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      return { content: JSON.stringify({ id: t.id }), summary: t.title };
    },
  }),
  tool("task_update", "Update a tracked task: still working, waiting on the user, or done.",
    obj({ id: str("Task id"), state: { type: "string", enum: ["working", "needs_input", "done"] }, note: str("One line on where it stands") }, ["id", "state"]), {
    activity: "planning", label: "Updating a task",
    run: async (a, c) => {
      if (!["working", "needs_input", "done"].includes(a.state)) return { content: "state must be working, needs_input or done.", isError: true };
      const t = tasks.update(c.bot.id, String(a.id), a.state, typeof a.note === "string" ? clip(a.note, 500) : undefined);
      if (!t) return { content: "No task of yours has that id.", isError: true };
      emit(c.user.id, { type: "tasks", botId: c.bot.id });
      return { content: "Updated.", summary: `${t.title} → ${t.state.replace("_", " ")}` };
    },
  }),
];

const teamTools: BuiltinTool[] = [
  tool("bot_message", "Send a message to another bot on the team. Their answer arrives later as a message to you.", obj({ bot: str("The bot's name"), message: str("What you need, with all the context they need") }, ["bot", "message"]), {
    activity: "messaging", label: "Messaging a teammate", detail: (a) => String(a.bot ?? ""),
    run: async (a, c) => {
      const target = bots.byName(c.user.id, String(a.bot));
      const names = bots.list(c.user.id).filter((b) => b.kind === "agent" && b.id !== c.bot.id).map((b) => b.name);
      if (!target) return { content: `No bot is called "${a.bot}". The team: ${names.join(", ") || "nobody else yet"}.`, isError: true };
      if (target.id === c.bot.id) return { content: "That is you.", isError: true };
      if (target.kind === "room") return { content: "That is a group chat; use room_post.", isError: true };
      if (c.depth >= MAX_HOPS) return { content: "This exchange has bounced between bots too many times. Wrap up and report to the user instead.", isError: true };
      deliverBotMessage(c.bot, target, String(a.message), c.depth);
      return { content: `Delivered to ${target.name}. Their reply will reach you as a new message.`, summary: `to ${target.name}` };
    },
  }),
  tool("helper_start", "Start a temporary helper that works on a self-contained goal in parallel and reports back when done.", obj({ goal: str("Everything the helper needs to know: the goal, the context, what to report"), label: str("A few words naming the job") }, ["goal"]), {
    activity: "messaging", label: "Starting a helper",
    run: async (a, c) => {
      if (c.bot.parentId || c.depth >= 2) return { content: "Helpers cannot start further helpers.", isError: true };
      if (bots.children(c.bot.id).length >= MAX_HELPERS) return { content: `You already have ${MAX_HELPERS} helpers. Stop one first.`, isError: true };
      const h = startHelper(c.bot, String(a.goal), a.label ? String(a.label) : undefined, c.depth);
      return { content: JSON.stringify({ id: h.id, name: h.name, note: "It will report back when finished." }), summary: h.name };
    },
  }),
  tool("helper_list", "List your helpers and what each is doing.", obj({}), {
    activity: "messaging", label: "Checking on helpers",
    run: async (_a, c) => {
      const list = bots.children(c.bot.id).map((h) => {
        const live = getLive(h.id);
        return { id: h.id, name: h.name, running: live.running, activity: live.activity?.kind ?? null, last_message: clip(h.preview, 300), started: new Date(h.createdAt).toISOString() };
      });
      return { content: list.length ? JSON.stringify(list) : "You have no helpers.", summary: `${list.length} helpers` };
    },
  }),
  tool("helper_message", "Send a follow-up message to one of your helpers.", obj({ id: str("Helper id"), message: str("What to tell it") }, ["id", "message"]), {
    activity: "messaging", label: "Messaging a helper",
    run: async (a, c) => {
      const h = bots.byId(String(a.id));
      if (!h || h.parentId !== c.bot.id) return { content: "No helper of yours has that id.", isError: true };
      if (c.depth >= MAX_HOPS + 2) return { content: "You and this helper have gone back and forth too many times. Wrap up with what you have.", isError: true };
      deliverBotMessage(c.bot, h, String(a.message), c.depth);
      return { content: "Delivered.", summary: h.name };
    },
  }),
  tool("helper_stop", "Stop one of your helpers and remove it.", obj({ id: str("Helper id") }, ["id"]), {
    activity: "messaging", label: "Stopping a helper",
    run: async (a, c) => {
      const h = bots.byId(String(a.id));
      if (!h || h.parentId !== c.bot.id) return { content: "No helper of yours has that id.", isError: true };
      await retireBot(h);
      return { content: "Stopped and removed.", summary: h.name };
    },
  }),
  tool("room_create", "Create a group chat with several bots.", obj({ name: str("Group name"), bots: { type: "array", items: { type: "string" }, description: "Names of the bots to include" } }, ["name", "bots"]), {
    activity: "messaging", label: "Creating a group",
    run: async (a, c) => {
      const wanted: string[] = Array.isArray(a.bots) ? a.bots.map(String) : [];
      const found = wanted.map((n) => bots.byName(c.user.id, n)).filter((b): b is BotRecord => !!b && b.kind === "agent");
      const missing = wanted.filter((n) => !found.some((b) => b.name.toLowerCase() === n.trim().toLowerCase()));
      const ids = [...new Set(found.map((b) => b.id))];
      if (ids.length < 2) return { content: `A group needs at least two bots. Not found: ${missing.join(", ") || "—"}.`, isError: true };
      const room = createRoom(c.user.id, String(a.name).trim().slice(0, 60) || "Group", ids);
      rows.append(room, { kind: "event", event: "members", text: tr(c.user.locale, "{bot} created this group with {names}.", { bot: c.bot.name, names: found.map((b) => b.name).join(", ") }) });
      return { content: JSON.stringify({ id: room.id, missing }), summary: room.name };
    },
  }),
  tool("room_post", "Post a message into a group chat you belong to. This ends your turn.", obj({ room: str("The group's name"), text: str("Your message") }, ["room", "text"]), {
    activity: "messaging", label: "Posting to a group", detail: (a) => String(a.room ?? ""),
    run: async (a, c) => {
      const room = bots.byName(c.user.id, String(a.room));
      if (!room || room.kind !== "room") return { content: `No group chat is called "${a.room}".`, isError: true };
      if (!room.memberIds.includes(c.bot.id)) return { content: "You are not a member of that group.", isError: true };
      const text = String(a.text);
      rows.append(room, { kind: "message", role: "assistant", text, origin: { kind: "bot", id: c.bot.id, name: c.bot.name } });
      bots.bumpUnread(room.id);
      bots.announce(room);
      dispatchToRoom(room, c.user, text, c.bot, c.depth);
      return { content: "Posted.", summary: room.name, endTurn: true };
    },
  }),
];

const userTools: BuiltinTool[] = [
  tool("ask_user", "Ask the user a question that only they can answer. Offer a few ready-made answers. This ends your turn; their answer arrives as their next message.",
    obj({ question: str("The question"), options: { type: "array", items: { type: "string" }, description: "Up to six suggested answers" } }, ["question"]), {
    activity: "waiting", label: "Asking you",
    run: async (a, c) => {
      const options = (Array.isArray(a.options) ? a.options.map(String) : []).slice(0, 6);
      rows.append(c.bot, { kind: "card", card: { type: "question", question: String(a.question), options, status: "pending" } });
      return { content: "The question is in front of the user. Stop here and wait for their answer.", summary: clip(String(a.question), 80), endTurn: true };
    },
  }),
  tool("connector_request", "Ask the user to connect an app you need (a remote tool server). This ends your turn.", obj({ app: str("Name of the app or service"), reason: str("Why you need it, in one sentence"), hint: str("If you know it: the address of the app's tool server") }, ["app", "reason"]), {
    activity: "waiting", label: "Asking to connect an app",
    run: async (a, c) => {
      rows.append(c.bot, { kind: "card", card: { type: "connect", name: clip(String(a.app), 60), hint: clip(String(a.hint ?? ""), 300), reason: clip(String(a.reason), 300), status: "pending" } });
      return { content: "The user has been asked to connect it. Stop here; you will be told when it is connected or skipped.", summary: String(a.app), endTurn: true };
    },
  }),
  tool("stay_quiet", "End your turn without sending anything. Use it when a check-in, routine or group message leaves you with nothing worth saying.", obj({ reason: str("Why there is nothing to say") }), {
    activity: "thinking", label: "Nothing to report",
    run: async () => ({ content: "Understood.", endTurn: true }),
  }),
];

/** Stops a bot's work and removes it together with its files and browser. */
export async function retireBot(b: BotRecord) {
  interrupt(b.id);
  for (const r of routines.forBot(b.id)) unschedule(r.id);
  for (const child of bots.children(b.id)) await retireBot(child);
  await screen.reset(b.id);
  bots.remove(b.id);
}

export function builtinTools(): BuiltinTool[] {
  return [
    ...(browserAvailable() ? screenTools : []),
    // On its own Linux computer a bot's commands are contained, so they do not need a permission card.
    ...workTools.filter((t) => t.spec.name !== "shell_run" || config.shellEnabled).map((t) => (t.spec.name === "shell_run" && computerKind() === "linux" ? { ...t, sensitive: false } : t)),
    ...shareTools.filter((t) => t.spec.name !== "image_generate" || imageService()),
    ...(browserAvailable() ? vaultTools : []),
    ...memoryTools, ...routineTools, ...taskTools, ...teamTools, ...userTools,
  ];
}
