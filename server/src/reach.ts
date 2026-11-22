import { computerKind, workspaceOf } from "./computer.js";
import { emit } from "./bus.js";
import { linuxExec } from "./linux.js";
import { devices as relayDevices } from "./relay.js";
import type { ReachLogin, ReachState } from "./shared.js";
import { audit, clip, type BotRecord } from "./store.js";
import { tr } from "./i18n.js";
import type { BuiltinTool, ToolContext, ToolOutput } from "./agent/tools.js";
import type { ToolSpec } from "./llm/types.js";
import { cached, cachePolicy, remember } from "./thirdparty.js";

/**
 * Agent Reach (MIT, https://github.com/Panniantong/Agent-Reach, v1.6.1) on every bot's Linux computer: a read-only
 * command-line tool that searches and reads the web and social sites and prints one JSON object per command. It is
 * installed in the desktop image from the pinned GitHub release asset (docker/desktop/Dockerfile).
 *
 * What we rely on, checked against `agent-reach --help` and its own source (agent_reach/runtime/result.py) for v1.6.1:
 *  - `agent-reach <channel> search <query> [--limit N]`, `agent-reach read <url>`, `agent-reach doctor` (no network),
 *    `agent-reach channels`, `agent-reach login|logout <channel>`, `agent-reach setup` (non-interactive, JSON);
 *  - every command prints {schema_version, ok, channel, action, backend, items, meta, error} (or `result` for management
 *    commands); `error` is {code, message, hint} with codes NEED_SETUP, NEED_LOGIN, UPSTREAM_BROKEN, TIMEOUT,
 *    RATE_LIMITED, PLATFORM_BLOCKED, NOT_FOUND, BAD_INPUT, BUSY;
 *  - `login <channel>` for browser channels starts Agent Reach's own browser with a window (it needs a display: our
 *    desktop sets DISPLAY=:1) on the site's sign-in page and returns at once; the user signs in there themselves. Its
 *    browser takes the debugging port 9222 by default, which our Chromium uses, so the image sets REACH_BROWSER_PORT
 *    (read first by agent_reach/runtime/browser.py configured_port()).
 * Outbound services it uses: r.jina.ai (page reading) and Exa (mcp.exa.ai, web search), plus the sites themselves.
 *
 * Here: every call runs `agent-reach` with an argument array through `docker exec` (no shell), its JSON is parsed and
 * trimmed, and what comes back is outside content. There are no posting, commenting or messaging tools — Agent Reach
 * has none, and none are offered.
 */

export interface ReachRun { code: number | null; stdout: string; stderr: string; timedOut: boolean }
export type ReachRunner = (botId: string, userId: string, argv: string[], timeoutSec: number, signal?: AbortSignal) => Promise<ReachRun>;
const realRunner: ReachRunner = (botId, userId, argv, timeoutSec, signal) => linuxExec(botId, userId, workspaceOf(botId), ["agent-reach", ...argv], timeoutSec, { signal });
let runner: ReachRunner = realRunner;
let overridden = false;
/** For tests: replace what runs agent-reach on a bot's computer (null puts the real one back). */
export function setReachRunner(fn: ReachRunner | null) { runner = fn ?? realRunner; overridden = !!fn; }
/** Agent Reach runs on the bots' own Linux computers only. */
export const reachAvailable = () => overridden || computerKind() === "linux";

/** Channels whose reading may use a login the user does themselves on the bot's screen. */
export const LOGIN_CHANNELS: { channel: string; label: string }[] = [
  { channel: "reddit", label: "Reddit" }, { channel: "twitter", label: "X (Twitter)" }, { channel: "instagram", label: "Instagram" }, { channel: "facebook", label: "Facebook" },
];
const CHANNEL = /^[a-z][a-z0-9]{1,20}$/;

export interface Envelope { ok: boolean; channel?: string | null; action?: string | null; backend?: string | null; items?: any[]; result?: any; error?: { code?: string; message?: string; hint?: string } | null }

/** The JSON object agent-reach printed (the last line that parses), or null. */
export function parseEnvelope(stdout: string): Envelope | null {
  const lines = stdout.trim().split("\n").reverse();
  for (const line of lines) {
    const s = line.trim();
    if (!s.startsWith("{")) continue;
    try { const v = JSON.parse(s); if (v && typeof v === "object" && "ok" in v) return v as Envelope; } catch { /* not this line */ }
  }
  try { const v = JSON.parse(stdout); if (v && typeof v === "object" && "ok" in v) return v as Envelope; } catch { /* not JSON */ }
  return null;
}

/** Bots whose computer was checked for Agent Reach's first-run setup by this server process. */
const setUp = new Set<string>();
async function ensureSetup(bot: BotRecord, signal?: AbortSignal) {
  if (setUp.has(bot.id)) return;
  // A home volume made before Agent Reach was in the image has no state yet: run its own (non-interactive) setup once.
  const probe = await runner(bot.id, bot.userId, ["doctor"], 60, signal);
  const env = parseEnvelope(probe.stdout);
  if (!env?.ok || !Array.isArray(env.result?.channels) || env.result.channels.every((c: any) => c.status === "not_added")) await runner(bot.id, bot.userId, ["setup"], 300, signal);
  setUp.add(bot.id);
}

async function run(bot: BotRecord, argv: string[], timeoutSec: number, signal?: AbortSignal): Promise<Envelope> {
  await ensureSetup(bot, signal).catch(() => {});
  const r = await runner(bot.id, bot.userId, argv, timeoutSec, signal);
  const env = parseEnvelope(r.stdout);
  if (env) return env;
  if (r.timedOut) return { ok: false, error: { code: "TIMEOUT", message: `no answer within ${timeoutSec} s` } };
  if (/executable file not found|agent-reach: not found|No such file/i.test(r.stderr)) return { ok: false, error: { code: "NEED_SETUP", message: "Agent Reach is not installed on this computer", hint: "The desktop image must be rebuilt (npm run computer:build)." } };
  return { ok: false, error: { code: "UPSTREAM_BROKEN", message: clip(r.stderr.trim() || `exit ${r.code}`, 300) } };
}

/** YouTube refusing this server ("Sign in to confirm you're not a bot") rather than the video being missing. */
export function youtubeBlocked(env: Envelope, channel: string): boolean {
  const msg = `${env.error?.message ?? ""} ${env.error?.hint ?? ""}`;
  return channel === "youtube" && (env.error?.code === "PLATFORM_BLOCKED" || /sign in to confirm|not a bot/i.test(msg));
}

const one = (v: unknown, max: number) => clip(String(v ?? "").replace(/\s+\n/g, "\n").trim(), max);

/** Items → numbered text for the model, trimmed (each item and the whole). */
export function formatItems(items: any[], perItem = 1500, total = 15_000): string {
  const out: string[] = [];
  let size = 0;
  for (const [i, it] of items.entries()) {
    if (!it || typeof it !== "object") continue;
    const head = [`${i + 1}. ${one(it.title || it.name || it.url || "(untitled)", 200)}`, it.url ? `   ${one(it.url, 400)}` : "", [it.author ? `by ${one(it.author, 80)}` : "", it.published_at ? one(it.published_at, 40) : ""].filter(Boolean).join(" · ")].filter(Boolean);
    const body = it.text ? `   ${one(it.text, perItem).replace(/\n/g, "\n   ")}` : "";
    const block = [...head.map((h, k) => (k === 2 ? `   ${h}` : h)), body].filter(Boolean).join("\n");
    if (size + block.length > total) { out.push(`(${items.length - i} more not shown)`); break; }
    out.push(block);
    size += block.length;
  }
  return out.join("\n\n") || "No results.";
}

/**
 * YouTube refuses this server (data-centre addresses). Never a dead end, and never left to the owner while there is a
 * way the bot can try itself — in this order:
 *  1. the bot's own computer browser: open the video page, accept YouTube's cookie consent if it shows one (a cookie
 *     choice, reversible: not a commitment — bind.ts treats "Tout accepter" / "Accept all" as a step), then read the
 *     transcript panel with the element tools;
 *  2. if that page is refused too: the owner's own computer through Sklubot Relais, only with their yes (ask_user);
 *  3. the video's sound on the bot's computer (play it and listen), when its tools can;
 *  4. when all of that fails: ONE question card with the remedies (open it on my own computer (Relais), paste the
 *     transcript, skip) — never a bare "YouTube blocks access".
 */
export function youtubeBlockedGuide(c: Pick<ToolContext, "user" | "bot">, done: { browser?: boolean } = {}): string {
  const loc = c.user.locale;
  const paired = relayDevices.count(c.user.id) > 0 && !c.bot.disabledTools.includes("mycomputer");
  const options = [tr(loc, "Open the video on my own computer (Relais)"), tr(loc, "Paste the transcript"), tr(loc, "Skip it")];
  const steps = [
    done.browser ? "" : "1. Open the video in YOUR computer's browser (browser_open with its address). If YouTube shows a cookie consent page (consent.youtube.com, \"Before you continue\" / \"Avant d'accéder à YouTube\"), accept it (\"Tout accepter\" / \"Accept all\"): it is only a cookie choice, reversible, and needs no approval. Then expand the description, press \"Show transcript\" / \"Afficher la transcription\" (element_snapshot, element_click) and read it with page_read.",
    `${done.browser ? "1" : "2"}. If your browser is refused too ("Sign in to confirm you're not a bot"): ${paired
      ? "the user's own computer is paired with Sklubot Relais — ask them (ask_user) whether you may open the video there (my_open, then my_screen), and only do it if they agree."
      : "the user's own computer could open it if they pair it with Sklubot Relais (Settings → Computers): that is one of the choices of the card below."}`,
    `${done.browser ? "2" : "3"}. If your computer can hear the video (play it, then listen_screen, or its own audio tools), transcribe its sound that way.`,
    `${done.browser ? "3" : "4"}. Only when all of that failed: call ask_user ONCE, with question "${tr(loc, "YouTube refuses my server, so I could not read this video's transcript. How do we go on?")}" and options ${JSON.stringify(options)}. Do not just tell the user that YouTube blocks access: the card is the message.`,
  ].filter(Boolean);
  return `YouTube is refusing this server ("Sign in to confirm you're not a bot"): it blocks many data-centre addresses. Do not retry this tool and do not try another tool on this server for this video. Go on in this order:\n${steps.join("\n")}`;
}

function failure(env: Envelope, channel: string, c: ToolContext): ToolOutput {
  const loc = c.user.locale;
  if (youtubeBlocked(env, channel)) {
    const paired = relayDevices.count(c.user.id) > 0 && !c.bot.disabledTools.includes("mycomputer");
    return { content: youtubeBlockedGuide(c), isError: true, summary: tr(loc, paired ? "YouTube blocks this server — your computer can help" : "YouTube blocks this server") };
  }
  const e = env.error ?? {};
  const code = e.code ?? "ERROR";
  const extra = code === "NEED_LOGIN" ? " The user can sign in themselves in your settings (Reading logins), on your screen, preferably with a secondary account. Never ask for a password."
    : code === "PLATFORM_BLOCKED" ? " Stop here: the user must resolve the site's verification themselves (they can take over your screen)."
    : code === "RATE_LIMITED" ? " Wait before trying this channel again." : "";
  return { content: `Agent Reach could not do it: ${code} — ${one(e.message, 500)}${e.hint ? `\nHint: ${one(e.hint, 400)}` : ""}${extra}`, isError: true, summary: code.toLowerCase().replace(/_/g, " ") };
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

/** Agent Reach's web search, for the provider chain (providers.ts): items or a thrown error. */
export async function reachWebSearch(bot: BotRecord, query: string, signal?: AbortSignal): Promise<{ title: string; url: string; snippet: string }[]> {
  const env = await run(bot, ["web", "search", query.replace(/^-+/, "").slice(0, 400), "--limit", "8"], 90, signal);
  if (!env.ok) { const err = new Error(`${env.error?.code ?? "ERROR"}: ${env.error?.message ?? ""}`); (err as any).final = env.error?.code === "BAD_INPUT"; throw err; }
  return (env.items ?? []).filter((i) => i?.url).map((i) => ({ title: String(i.title ?? i.url), url: String(i.url), snippet: clip(String(i.text ?? ""), 400) }));
}

/** L87: one channel's read-only search for the deep research (researchsources.ts), as Agent Reach's envelope. */
export const reachChannelSearch = (bot: BotRecord, channel: string, query: string, limit: number, signal?: AbortSignal) =>
  run(bot, [channel, "search", query.replace(/^-+/, "").slice(0, 400), "--limit", String(limit)], 90, signal);

/** YouTube subtitles through Agent Reach, for the transcription chain. */
export async function reachSubtitles(bot: BotRecord, target: string, lang: string | undefined, signal?: AbortSignal): Promise<{ text: string; blocked?: boolean }> {
  const env = await run(bot, ["youtube", "subtitle", target, ...(lang ? ["--lang", lang] : [])], 120, signal);
  if (!env.ok) { const err = new Error(`${env.error?.code ?? "ERROR"}: ${env.error?.message ?? ""}`); (err as any).blocked = youtubeBlocked(env, "youtube"); (err as any).final = env.error?.code === "NOT_FOUND" || env.error?.code === "BAD_INPUT"; throw err; }
  return { text: (env.items ?? []).map((i) => String(i?.text ?? "")).join("\n").trim() };
}

export const reachTools: BuiltinTool[] = [
  {
    spec: {
      name: "reach_search",
      description: "Search one channel with Agent Reach on your computer (read-only): web, github, youtube, reddit, twitter, instagram, facebook, bilibili, v2ex, linkedin… Returns titles, links and excerpts. Logged-in channels (Reddit, X, Instagram, Facebook) work best once the user signed in in your settings. Set fresh to true to skip the short cache.",
      inputSchema: obj({ channel: str("Channel name, e.g. web, reddit, youtube, github, twitter"), query: str("What to search for"), limit: { type: "integer", description: "How many results (1-20, default 6)" }, fresh: { type: "boolean", description: "Force a new search instead of a recent cached answer" } }, ["channel", "query"]),
    },
    activity: "searching", label: "Searching with Agent Reach", group: "reach", outside: true, detail: (a) => clip(`${a.channel ?? ""}: ${a.query ?? ""}`, 60),
    run: async (a, c) => {
      const channel = String(a.channel ?? "").trim().toLowerCase();
      const query = String(a.query ?? "").trim().replace(/^-+/, "").slice(0, 400);
      if (!CHANNEL.test(channel)) return { content: "Give a channel name such as web, reddit, youtube, github or twitter (reach_status lists them).", isError: true };
      if (!query) return { content: "Say what to search for.", isError: true };
      const limit = Math.min(20, Math.max(1, Math.round(Number(a.limit) || 6)));
      const args = { channel, query, limit };
      const hit = a.fresh ? null : cached(c.user.id, "reach_search", "agent-reach", args);
      if (hit) return { content: `${hit.note}\n${hit.response}`, summary: `${tr(c.user.locale, "cached")} · ${hit.age}` };
      const env = await run(c.bot, [channel, "search", query, "--limit", String(limit)], 120, c.signal);
      if (!env.ok) return failure(env, channel, c);
      const items = env.items ?? [];
      const text = `Agent Reach · ${channel}${env.backend ? ` (via ${env.backend})` : ""}\n\n${formatItems(items)}`;
      if (items.length) remember(c.user.id, "reach_search", "agent-reach", args, text, cachePolicy(c.user.id, "reach_search"));
      return { content: text, summary: `${items.length} · ${channel}` };
    },
  },
  {
    spec: {
      name: "reach_read",
      description: "Read a link with Agent Reach on your computer (read-only): it picks the right channel from the address (a web page, a Reddit post with comments, a YouTube video's details, a GitHub repository, a tweet…).",
      inputSchema: obj({ url: str("The http(s) address to read"), fresh: { type: "boolean", description: "Force a new read instead of a recent cached answer" } }, ["url"]),
    },
    activity: "reading", label: "Reading with Agent Reach", group: "reach", outside: true, detail: (a) => { try { return new URL(String(a.url)).hostname; } catch { return undefined; } },
    run: async (a, c) => {
      const url = String(a.url ?? "").trim();
      let u: URL;
      try { u = new URL(url); } catch { return { content: "Give a full http(s) address.", isError: true }; }
      if (u.protocol !== "https:" && u.protocol !== "http:") return { content: "Only http and https addresses can be read.", isError: true };
      const args = { url: u.toString() };
      const hit = a.fresh ? null : cached(c.user.id, "reach_read", "agent-reach", args);
      if (hit) return { content: `${hit.note}\n${hit.response}`, summary: `${tr(c.user.locale, "cached")} · ${hit.age}` };
      const env = await run(c.bot, ["read", u.toString()], 150, c.signal);
      const channel = String(env.channel ?? (/youtu\.?be/.test(u.hostname) ? "youtube" : "web"));
      if (!env.ok) return failure(env, channel, c);
      const items = env.items ?? [];
      const text = `Agent Reach · ${channel}${env.backend ? ` (via ${env.backend})` : ""}\n\n${formatItems(items, 12_000, 20_000)}`;
      if (items.length) remember(c.user.id, "reach_read", "agent-reach", args, text, cachePolicy(c.user.id, "reach_read"));
      return { content: text, summary: clip(String(items[0]?.title ?? u.hostname), 80) };
    },
  },
  {
    spec: { name: "reach_status", description: "Which Agent Reach channels work on your computer right now, and which reading logins the user has done (no network).", inputSchema: obj({}) },
    activity: "reading", label: "Checking Agent Reach", group: "reach",
    run: async (_a, c) => {
      const st = await reachState(c.bot, c.signal);
      if (!st.available) return { content: `Agent Reach is not available: ${st.reason}`, isError: true };
      return {
        content: `Agent Reach ${st.version ?? ""}\nChannels: ${st.channels.map((x) => `${x.channel} (${x.status})`).join(", ")}\nReading logins: ${st.logins.map((l) => `${l.label}: ${l.loggedIn ? "signed in" : l.loggedIn === false ? "not signed in" : "unknown"}`).join(", ")}\nOnly reading is possible: there is no way to post, comment or send messages, and you must not try.`,
        summary: `${st.channels.filter((x) => x.status === "ready").length} ready`,
      };
    },
  },
];

/** Channels and login states, from `agent-reach doctor` (no network) and `agent-reach channels`. */
export async function reachState(bot: BotRecord, signal?: AbortSignal): Promise<ReachState> {
  if (!reachAvailable()) return { available: false, reason: "this server gives bots no Linux computer (Docker)", version: null, logins: [], channels: [] };
  const doctor = await run(bot, ["doctor"], 60, signal);
  if (!doctor.ok) return { available: false, reason: `${doctor.error?.code ?? "ERROR"}: ${doctor.error?.message ?? ""}`, version: null, logins: [], channels: [] };
  const channels: { channel: string; status: string; hint?: string }[] = (doctor.result?.channels ?? []).map((x: any) => ({ channel: String(x.channel), status: String(x.status), hint: x.hint ? String(x.hint) : undefined }));
  const list = await run(bot, ["channels"], 30, signal);
  const loginOf = new Map<string, boolean | null>();
  for (const ch of (list as any).channels ?? []) if (ch?.login) loginOf.set(String(ch.name), typeof ch.login.logged_in === "boolean" ? ch.login.logged_in : null);
  const logins: ReachLogin[] = LOGIN_CHANNELS.map(({ channel, label }) => {
    const st = channels.find((x) => x.channel === channel);
    return { channel, label, loggedIn: loginOf.get(channel) ?? null, status: st?.status ?? "unknown", hint: st?.hint ?? "" };
  });
  return { available: true, reason: "", version: typeof doctor.result?.version === "string" ? doctor.result.version : null, logins, channels: channels.map(({ channel, status }) => ({ channel, status })) };
}

/**
 * "Sign in" from the bot's settings: Agent Reach opens its browser window on the bot's desktop at the site's sign-in
 * page; the user signs in there themselves (the model never sees it). "Sign out": Agent Reach forgets that login.
 */
export async function reachLogin(bot: BotRecord, channel: string, action: "login" | "logout"): Promise<{ ok: boolean; message: string; opened?: string }> {
  if (!LOGIN_CHANNELS.some((l) => l.channel === channel)) return { ok: false, message: "unknown channel" };
  if (!reachAvailable()) return { ok: false, message: "this server gives bots no Linux computer (Docker)" };
  const env = await run(bot, [action, channel], action === "login" ? 240 : 60);
  audit(bot.userId, "computer", `${bot.name}: reading login ${action === "login" ? "opened" : "removed"} (${channel})`, bot.id);
  emit(bot.userId, { type: "reach", botId: bot.id });
  if (!env.ok) return { ok: false, message: `${env.error?.code ?? "ERROR"}: ${clip(env.error?.message ?? "", 300)}` };
  const item = (env.items ?? [])[0] ?? {};
  return { ok: true, message: action === "login" ? String(item.next ?? "") : "", opened: item.opened ? String(item.opened) : undefined };
}
