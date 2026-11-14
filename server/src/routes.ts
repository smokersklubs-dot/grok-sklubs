import { closeSync, createReadStream } from "node:fs";
import path from "node:path";
import { Readable } from "node:stream";
import { Hono, type Context } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { streamSSE } from "hono/streaming";
import { continueAfterStepLimit, decideApproval, enqueue, inQueue, interrupt, noteHandBack, submitUserMessage, type ForcedSkill } from "./agent/loop.js";
import { cleanProfile, fetchSkillMarkdown, saveImportedSkill, undoRevision } from "./agent/tools-team.js";
import { xSearchProvider } from "./xsearch.js";
import { cleanModelList } from "./store.js";
import { RELIABILITY_LIMITS, type RowBody } from "./shared.js";
import { ask, compactIfNeeded, consolidate, memoryStatus } from "./agent/memory.js";
import { telegram } from "./telegram.js";
import { engineLogin, engineLogout, engineModels, engineStatus } from "./agent/engine.js";
import { handleMcp } from "./agent/mcp.js";
import { RESPONSE_ALREADY_SENT } from "@hono/node-server/utils/response";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRoom, dispatchToRoom, validMembers } from "./agent/team.js";
import { retireBot } from "./agent/tools.js";
import { createSession, dropSession, hashPassword, originAllowed, seal, SESSION_COOKIE, setupCodeMatches, setupCodeRequired, signupOpen, userForToken, verifyPassword } from "./auth.js";
import { emit, getLive, subscribe } from "./bus.js";
import { attachmentAt, computerState, isInlineImage, isInlineVideo, listFiles, mimeOf, openLibraryFile, readLibraryFile, removeWorkspace, resolveInWorkspace, screen, storeBytes } from "./computer.js";
import { catalogFor } from "./catalog.js";
import { imageService } from "./images.js";
import { config } from "./config.js";
import { connectors, NeedsClientIdError, oauthRedirectUri } from "./connectors.js";
import { isValidTimezone } from "./cron.js";
import { pickLocale, tr } from "./i18n.js";
import { defaultModelRef, listProviders } from "./llm/index.js";
import { publicRoutine, routines, runs } from "./routines.js";
import { fireCheckin, fireRoutine, schedule, unschedule } from "./scheduler.js";
import { REACTIONS, type CheckinSettings, type ReactionEmoji, type ServerEvent, type VideoStatus } from "./shared.js";
import { videoService } from "./video.js";
import { higgsfieldFor } from "./agent/tools.js";
import { dropRecording, noteInput, recording, retryRecording, saveRecording, startRecording, stopRecording } from "./teach.js";
import { account, audit, auditList, bots, clip, feedback, history, memories, pages, policies, publicBot, publicVault, rows, searchMessages, sections, settings, sha256, skills, tasks, users, vault, type BotRecord, type UserRecord, type VaultFields } from "./store.js";
import { finishTakeover, holdControl, releaseControl } from "./takeover.js";
import { notePresence, push, pushSettings, savePushSettings, sendPush } from "./push.js";
import { parseTotp } from "./totp.js";
import { detectMapping, loginsFrom, parseCsv, type Mapping } from "./vault-import.js";
import { PUSH_KINDS, VAULT_KINDS, type VaultKind } from "./shared.js";
import { q } from "./db.js";
import { connectors as connectorStore } from "./connectors.js";
import type { Attachment } from "./shared.js";
import { csv as usageCsv, summary as usageSummary } from "./usage.js";
import { accounts as nativeAccounts, clients as nativeClients, disconnect as nativeDisconnect, finishSignIn as nativeFinish, publicAccount, startSignIn as nativeStart } from "./native/accounts.js";
import { appOf, appsFor, nativeRedirectUri, setupDocs, setupSteps, VENDOR_NAMES, VENDORS } from "./native/vendors.js";
import { syncSlackSockets } from "./native/triggers.js";
import { isNativeTrigger } from "./routines.js";
import type { NativeVendor, NativeVendorSetup } from "./shared.js";
import { confirmPairing, lastFrame, listDevices, relayDownloads, revokeDevice, stopSession, userSpoke as relayUserSpoke } from "./relay.js";

type Env = { Variables: { user: UserRecord } };
export const api = new Hono<Env>();

class HttpError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 429 | 502, message: string) { super(message); } }
const fail = (status: HttpError["status"], message: string): never => { throw new HttpError(status, message); };

api.onError((err, c) => {
  if (err instanceof HttpError) return c.json({ error: err.message }, err.status);
  console.error("[api]", err);
  return c.json({ error: "Something went wrong on the server." }, 500);
});

const body = async (c: Context): Promise<Record<string, any>> => {
  const parsed = await c.req.json().catch(() => ({}));
  return parsed && typeof parsed === "object" ? parsed : {};
};
const publicUser = (u: UserRecord) => ({ id: u.id, email: u.email, name: u.name, locale: u.locale });
const ownBot = (c: Context<Env>, id = c.req.param("id")): BotRecord => bots.owned(c.get("user").id, id ?? "") ?? fail(404, "That bot does not exist.");
const ownAgent = (c: Context<Env>): BotRecord => { const b = ownBot(c); return b.kind === "agent" ? b : fail(400, "A group chat cannot do that."); };

function startSession(c: Context, userId: string) {
  const s = createSession(userId);
  setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: s.maxAgeSec, secure: config.publicUrl.startsWith("https://") });
}

/** Routes outside /api. */
export const site = new Hono();
// Pages published by bots. They are served in a sandbox: their scripts run, but as a stranger to this
// site — no cookies, no access to the app or its API.
site.get("/p/:token", (c) => {
  const page = pages.byToken(c.req.param("token"), config.publicUrl);
  let html: string | null = null;
  // Read through the library guard: a page file the bot replaced with a link (to the database, to the
  // server's environment…) is refused, never served.
  try { if (page) html = readLibraryFile(page.botId, page.path).toString("utf8"); } catch { /* removed, or not a plain file of the library */ }
  if (!html) return c.text("This page is no longer shared.", 404);
  return c.body(html, 200, {
    "content-type": "text/html; charset=utf-8", "x-content-type-options": "nosniff", "referrer-policy": "no-referrer", "x-robots-tag": "noindex",
    "content-security-policy": "sandbox allow-scripts allow-popups; default-src 'self' data: blob: https: 'unsafe-inline' 'unsafe-eval'; frame-ancestors 'none'",
  });
});

/** Sklubot's tools for a bot running on a subscription tool; the caller proves it is that bot's computer. */
site.post("/mcp/:botId", async (c) => {
  // Only the bots' computers call this, directly on the internal network (ENGINE_BASE_URL). A request that
  // went through a reverse proxy came from the internet: it is refused (Caddy also blocks /mcp/ itself).
  if (c.req.header("x-forwarded-for") || c.req.header("forwarded")) return c.json({ error: "not found" }, 404);
  const env = c.env as { incoming?: IncomingMessage; outgoing?: ServerResponse } | undefined;
  if (!env?.incoming || !env.outgoing) return c.json({ error: "unavailable" }, 503);
  const parsed = await c.req.json().catch(() => undefined);
  await handleMcp(c.req.param("botId"), env.incoming, env.outgoing, parsed);
  return RESPONSE_ALREADY_SENT;
});
site.on(["GET", "DELETE"], "/mcp/:botId", (c) => c.json({ error: "method not allowed" }, 405));

// ── Public routes ────────────────────────────────────────────────────────────
api.get("/health", (c) => c.json({ ok: true, model: defaultModelRef() }));

api.get("/me", (c) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  const video: VideoStatus = { provider: videoService()?.id ?? null, higgsfield: !!user && !!higgsfieldFor(user.id) };
  return c.json({ user: user ? publicUser(user) : null, signupOpen: signupOpen(), setupCodeRequired: setupCodeRequired(), imageGeneration: !!imageService(), video });
});

// Slows down password guessing: a handful of attempts per account, and a few dozen per client address,
// per quarter hour. The table is bounded, so a flood of made-up addresses cannot grow it without end.
const attempts = new Map<string, { n: number; until: number }>();
const MAX_TRACKED = 10_000;
function throttle(key: string, limit = 8) {
  const t = Date.now();
  const cur = attempts.get(key);
  if (cur && cur.until > t && cur.n >= limit) fail(403, "Too many attempts. Wait a few minutes and try again.");
  attempts.delete(key); // re-inserted below, so the map stays ordered from oldest to newest
  attempts.set(key, cur && cur.until > t ? { ...cur, n: cur.n + 1 } : { n: 1, until: t + 15 * 60_000 });
  if (attempts.size > MAX_TRACKED) {
    for (const [k, v] of attempts) if (v.until <= t) attempts.delete(k);
    for (const k of attempts.keys()) { if (attempts.size <= MAX_TRACKED) break; attempts.delete(k); }
  }
}

/**
 * The client's address. Behind our reverse proxy (TRUST_PROXY=1) it is the last X-Forwarded-For entry,
 * the one the proxy itself added; earlier entries come from the client and are ignored. Otherwise the
 * address of the connection.
 */
function clientIp(c: Context): string {
  if (config.trustProxy) {
    const last = (c.req.header("x-forwarded-for") ?? "").split(",").map((s) => s.trim()).filter(Boolean).pop();
    if (last) return last;
  }
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  return env?.incoming?.socket?.remoteAddress ?? "local";
}

// Checked against when the email is unknown, so a wrong address takes as long as a wrong password.
let dummyHash: string | null = null;
const dummyCheck = (password: string) => { dummyHash ??= hashPassword("not-a-real-password"); verifyPassword(password, dummyHash); };

api.post("/auth/signup", async (c) => {
  if (!signupOpen()) fail(403, "New accounts are closed on this server.");
  throttle(`signup:${clientIp(c)}`, 20);
  const b = await body(c);
  // A fresh install waits for its owner: the first account needs the code the installer printed.
  if (setupCodeRequired() && !setupCodeMatches(String(b.setupCode ?? ""))) fail(403, "The setup code is missing or wrong. It was shown at the end of the installation, and is in the server's .env file (SKLUBOT_SETUP_CODE).");
  const email = String(b.email ?? "").trim();
  const password = String(b.password ?? "");
  if (!/^[^@\s]+@[^@\s]+$/.test(email)) fail(400, "Enter a valid email address.");
  if (password.length < 8) fail(400, "Choose a password of at least 8 characters.");
  if (users.byEmail(email)) fail(409, "An account with this email already exists.");
  if (config.allowedEmails.length && !config.allowedEmails.includes(email.toLowerCase())) fail(403, "This address is not allowed to create an account on this server.");
  const locale = pickLocale(b.locale, c.req.header("accept-language"));
  const user = users.create(email, String(b.name ?? ""), hashPassword(password), locale);
  // Every account starts with one main bot so there is someone to talk to straight away.
  bots.create(user.id, {
    name: "Juno", label: tr(locale, "Chief of staff"), primary: true, shape: "pebble", color: "indigo",
    description: tr(locale, "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots."),
  });
  startSession(c, user.id);
  return c.json({ user: publicUser(user) });
});

api.post("/auth/login", async (c) => {
  const b = await body(c);
  const email = String(b.email ?? "").trim().toLowerCase();
  throttle(`ip:${clientIp(c)}`, 30);
  throttle(`login:${email}`);
  const user = users.byEmail(email);
  const password = String(b.password ?? "");
  if (!user) { dummyCheck(password); fail(401, "Wrong email or password."); }
  if (!verifyPassword(password, user!.passHash)) fail(401, "Wrong email or password.");
  attempts.delete(`login:${email}`);
  audit(user!.id, "account", "Signed in");
  startSession(c, user!.id);
  return c.json({ user: publicUser(user!) });
});

/** One-time sign-in link printed on the server's command line (valid 15 minutes, single use). */
api.get("/auth/link", (c) => {
  const token = c.req.query("token") ?? "";
  const row = token ? q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM sign_in_links WHERE token_hash = ?", sha256(token)) : undefined;
  if (row) q.run("DELETE FROM sign_in_links WHERE token_hash = ?", sha256(token));
  if (!row || row.expires_at < Date.now() || !users.byId(row.user_id)) return c.redirect("/?link=expired");
  audit(row.user_id, "account", "Signed in with a one-time link");
  startSession(c, row.user_id);
  return c.redirect("/");
});

api.post("/auth/logout", (c) => {
  dropSession(getCookie(c, SESSION_COOKIE));
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

/** Outside systems call this address to set a webhook routine in motion. The token is the credential. */
api.post("/hooks/:token", async (c) => {
  const r = routines.byHook(c.req.param("token"));
  if (!r || !r.enabled) fail(404, "Unknown or paused hook.");
  const raw = await c.req.text();
  if (raw.length > 200_000) fail(413, "Payload too large.");
  let payload: unknown = raw || undefined;
  try { payload = raw ? JSON.parse(raw) : undefined; } catch { /* keep the raw text */ }
  // Whoever holds the hook's address can send anything: the payload is outside content for the turn it starts.
  fireRoutine(r!, payload, { outside: true });
  return c.json({ ok: true });
});

// The browser comes back here from an app's OAuth sign-in page (the redirect URI shown in the app).
// The state parameter alone identifies the sign-in (single use, 10 minutes); a session, when present, must match it.
const escHtml = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
api.get("/connectors/oauth/callback", async (c) => {
  const session = userForToken(getCookie(c, SESSION_COOKIE));
  let locale = pickLocale(session?.locale, c.req.header("accept-language"));
  let ok = false;
  let message: string;
  try {
    const r = await connectors.finishSignIn({ state: c.req.query("state") ?? "", code: c.req.query("code"), error: c.req.query("error"), iss: c.req.query("iss") }, session?.id);
    const owner = users.byId(r.userId);
    if (owner) locale = owner.locale;
    ok = r.connector.status === "ready";
    message = ok ? tr(locale, "Signed in to {name}. You can close this window.", { name: r.connector.name }) : tr(locale, "Signed in to {name}, but it does not answer yet: {detail}", { name: r.connector.name, detail: r.connector.error ?? "" });
    const bot = r.botId ? bots.owned(r.userId, r.botId) : null;
    if (bot && ok) {
      if (r.seq !== null) rows.updateCard(bot, bot.generation, r.seq, (k) => (k.type === "connect" ? { ...k, status: "connected" } : k));
      enqueue(bot.id, { kind: "system", text: `The user signed in to ${r.connector.name}. Its tools are available now — continue with what you were doing.` });
    }
  } catch (err) {
    message = tr(locale, "The sign-in did not finish: {detail}", { detail: /[{}]/.test((err as Error).message) ? (err as Error).message : tr(locale, (err as Error).message) });
  }
  return signInPage(c, locale, ok, message);
});

/** The page the browser lands on after an app's sign-in: says how it went, tells the app's other tabs, then closes. */
function signInPage(c: Context, locale: "fr" | "en", ok: boolean, message: string) {
  const back = tr(locale, "Back to Sklubot");
  // Tell the app (any open tab, via BroadcastChannel; the opener when it still exists), then close or go back to the app.
  const script = `try{new BroadcastChannel("sklubot-oauth").postMessage({ok:${ok}})}catch(e){}try{window.opener&&window.opener.postMessage({type:"sklubot-oauth",ok:${ok}},${JSON.stringify(config.publicUrl)})}catch(e){}${ok ? 'setTimeout(function(){window.close();setTimeout(function(){location.replace("/")},400)},1200)' : ""}`;
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sklubot</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f6f8;color:#1d1d24;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:420px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 6px 30px rgba(0,0,0,.08);text-align:center}p{line-height:1.5}.ok{color:#137a3f}.ko{color:#b3261e}a{color:#4f46e5}@media(prefers-color-scheme:dark){body{background:#15151a;color:#ececf1}main{background:#1f1f26}}</style></head>
<body><main><p class="${ok ? "ok" : "ko"}">${escHtml(message)}</p><p><a href="/">${escHtml(back)}</a></p></main><script>${script}</script></body></html>`;
  return c.html(html, ok ? 200 : 400, { "referrer-policy": "no-referrer", "cache-control": "no-store" });
}

// Built-in apps: the vendor sends the browser back here (the redirect URI the user registered in their console).
api.get("/native/:vendor/callback", async (c) => {
  const vendor = c.req.param("vendor") as NativeVendor;
  const session = userForToken(getCookie(c, SESSION_COOKIE));
  let locale = pickLocale(session?.locale, c.req.header("accept-language"));
  if (!VENDORS.includes(vendor)) return c.json({ error: "No such endpoint." }, 404);
  let ok = false;
  let message: string;
  try {
    const acc = await nativeFinish(vendor, { state: c.req.query("state") ?? "", code: c.req.query("code"), error: c.req.query("error") }, session?.id);
    locale = users.localeOf(acc.userId);
    ok = true;
    message = tr(locale, "Signed in to {name}. You can close this window.", { name: acc.name });
    syncSlackSockets();
  } catch (err) {
    message = tr(locale, "The sign-in did not finish: {detail}", { detail: /[{}]/.test((err as Error).message) ? (err as Error).message : tr(locale, (err as Error).message) });
  }
  return signInPage(c, locale, ok, message);
});

// ── Everything below needs a session ─────────────────────────────────────────
api.use("*", async (c, next) => {
  const user = userForToken(getCookie(c, SESSION_COOKIE));
  if (!user) return c.json({ error: "Please sign in." }, 401);
  // State-changing requests must come from our own pages, not from another site using the visitor's cookie.
  // An Origin that is not a URL of this site ("null" from a sandboxed page, garbage) is refused too.
  if (c.req.method !== "GET" && !originAllowed(c.req.header("origin"), c.req.header("host"))) return c.json({ error: "Cross-site request refused." }, 403);
  c.set("user", user);
  await next();
});

api.get("/events", (c) =>
  streamSSE(c, async (stream) => {
    const user = c.get("user");
    const queue: ServerEvent[] = [{ type: "hello", now: Date.now() }];
    let wake: (() => void) | null = null;
    const off = subscribe(user.id, (e) => { queue.push(e); wake?.(); });
    stream.onAbort(() => { off(); wake?.(); });
    try {
      while (!stream.aborted) {
        while (queue.length) await stream.writeSSE({ data: JSON.stringify(queue.shift()) });
        const timedOut = await new Promise<boolean>((resolve) => {
          const timer = setTimeout(() => resolve(true), 20_000);
          wake = () => { clearTimeout(timer); resolve(false); };
        });
        wake = null;
        if (timedOut && !queue.length) queue.push({ type: "ping" });
      }
    } finally { off(); }
  }));

api.put("/prefs", async (c) => {
  const b = await body(c);
  users.setPrefs(c.get("user").id, { locale: b.locale === "fr" || b.locale === "en" ? b.locale : undefined, name: typeof b.name === "string" ? b.name : undefined });
  return c.json({ user: publicUser(users.byId(c.get("user").id)!) });
});

api.get("/models", (c) => c.json({
  models: [
    ...listProviders().filter((p) => p.available()).flatMap((p) => p.models.map((m) => ({ ref: `${p.id}:${m}`, provider: p.label, model: m, kind: "api" as const }))),
    ...engineModels(),
  ],
  defaultRef: defaultModelRef(),
}));

// ── Bots ─────────────────────────────────────────────────────────────────────
api.get("/bots", (c) => {
  const list = bots.list(c.get("user").id);
  return c.json({ bots: list.map(publicBot), live: Object.fromEntries(list.map((b) => [b.id, getLive(b.id)])) });
});

api.post("/bots", async (c) => {
  const b = await body(c);
  if (!String(b.name ?? "").trim()) fail(400, "Give the bot a name.");
  const bot = bots.create(c.get("user").id, { name: b.name, label: b.label, description: b.description, instructions: b.instructions, shape: b.shape, color: b.color, mode: b.mode, primary: !!b.primary, character: b.character });
  emit(bot.userId, { type: "roster" });
  return c.json({ bot: publicBot(bot) });
});

api.patch("/bots/:id", async (c) => {
  const bot = ownBot(c);
  const patch = await body(c);
  bots.patch(bot.id, patch);
  bots.announce(bot);
  if (patch.name !== undefined || patch.label !== undefined || patch.color !== undefined) void screen.redress(bot.id).catch(() => {});
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

api.delete("/bots/:id", async (c) => {
  const bot = ownBot(c);
  if (bot.primary) fail(409, "Make another bot your main contact before deleting this one.");
  await retireBot(bot);
  dropRecording(bot.id);
  removeWorkspace(bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/primary", (c) => {
  const bot = ownAgent(c);
  bots.makePrimary(bot.userId, bot.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ ok: true });
});

api.post("/bots/:id/read", (c) => {
  const bot = ownBot(c);
  bots.setUnread(bot.id, 0);
  bots.announce(bot);
  return c.json({ ok: true });
});

/** "Mark as unread": the bot shows an unread badge until it is opened again. */
api.post("/bots/:id/unread", (c) => {
  const bot = ownBot(c);
  bots.markUnread(bot.id);
  bots.announce(bot);
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

/** A copy of a bot: settings, look, instructions and skills; its memories and current conversation only when asked. */
api.post("/bots/:id/duplicate", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const copy = bots.duplicate(bot, { name: typeof b.name === "string" ? b.name : undefined, memories: b.memories === true, conversation: b.conversation === true });
  audit(bot.userId, "account", `Bot duplicated: ${bot.name} → ${copy.name}`, copy.id);
  emit(bot.userId, { type: "roster" });
  return c.json({ bot: publicBot(copy) });
});

// ── Sidebar sections ─────────────────────────────────────────────────────────
api.get("/sections", (c) => c.json({ sections: sections.list(c.get("user").id) }));
api.post("/sections", async (c) => {
  const user = c.get("user");
  const name = String((await body(c)).name ?? "").trim();
  if (!name) fail(400, "Give the section a name.");
  if (sections.list(user.id).length >= 30) fail(409, "You already have 30 sections.");
  const section = sections.create(user.id, name);
  emit(user.id, { type: "sections" });
  return c.json({ section });
});
api.patch("/sections/:id", async (c) => {
  const user = c.get("user");
  const cur = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
  const b = await body(c);
  if (b.name !== undefined && !String(b.name).trim()) fail(400, "Give the section a name.");
  const pos = b.position === undefined || b.position === null ? undefined : Number(b.position);
  sections.update(cur.id, { name: b.name === undefined ? undefined : String(b.name), position: pos !== undefined && Number.isFinite(pos) ? pos : undefined });
  emit(user.id, { type: "sections" });
  return c.json({ section: sections.owned(user.id, cur.id) });
});
api.delete("/sections/:id", (c) => {
  const user = c.get("user");
  const cur = sections.owned(user.id, c.req.param("id")) ?? fail(404, "That section does not exist.");
  sections.remove(user.id, cur.id);
  emit(user.id, { type: "sections" });
  emit(user.id, { type: "roster" });
  return c.json({ ok: true });
});

// ── Conversation ─────────────────────────────────────────────────────────────
api.get("/bots/:id/rows", (c) => {
  const bot = ownBot(c);
  const before = Number(c.req.query("before")) || undefined;
  // ?thread=<seq>: the replies of the thread on that message instead of the main chat.
  const thread = Math.max(0, Number(c.req.query("thread")) || 0);
  return c.json({ generation: bot.generation, thread, rows: rows.list(bot.id, bot.generation, Number(c.req.query("limit")) || 200, before, thread) });
});

/** The message of the current conversation a thread hangs on: a message of the main chat. */
function threadParent(bot: BotRecord, raw: unknown): number {
  if (raw === undefined || raw === null || raw === "" || raw === 0) return 0;
  const seq = Number(raw);
  const parent = Number.isInteger(seq) && seq > 0 ? rows.get(bot.id, bot.generation, seq) : null;
  if (!parent || parent.thread || parent.body.kind !== "message") fail(400, "That message cannot have a thread.");
  return seq;
}

// Reactions: the user puts (or takes back) one of a few emoji under any message. A reaction on a bot's
// message reaches that bot as a short note at the start of its next turn in that chat or thread.
api.post("/bots/:id/rows/:seq/reactions", async (c) => {
  const bot = ownBot(c);
  const emoji = String((await body(c)).emoji ?? "") as ReactionEmoji;
  if (!(REACTIONS as readonly string[]).includes(emoji)) fail(400, "That reaction is not available.");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "message" || row.body.streaming) return fail(400, "Only a message can get a reaction.");
  const user = c.get("user");
  const list = rows.react(bot, bot.generation, row.seq, { emoji, by: "user", name: user.name })!;
  const on = list.some((r) => r.emoji === emoji && r.by === "user");
  const b = row.body;
  // Whose message it is: this bot's own reply, or (in a group chat) the member bot that posted it.
  const author = b.role === "assistant" ? (b.origin?.kind === "bot" ? bots.owned(user.id, b.origin.id) : bot.kind === "agent" ? bot : null) : null;
  if (author && author.kind === "agent") {
    const where = bot.kind === "room" ? ` in the group chat "${bot.name}"` : "";
    const note = `The user reacted ${emoji} to your message${where} "${clip(b.text.replace(/\s+/g, " ").trim() || "(a file)", 100)}".`;
    // In a group chat the member hears about it in its own chat; in the bot's own chat, in the thread the message belongs to.
    const thread = bot.kind === "room" ? 0 : row.thread ?? 0;
    if (on) feedback.add(author.id, author.generation, thread, bot.kind === "room" ? -row.seq : row.seq, emoji, note);
    else feedback.drop(author.id, author.generation, bot.kind === "room" ? -row.seq : row.seq, emoji);
  }
  return c.json({ reactions: list });
});

api.post("/bots/:id/messages", async (c) => {
  const bot = ownBot(c);
  const b = await body(c);
  const text = String(b.text ?? "").trim();
  // Only files this bot already holds under uploads/ can be attached; anything else is ignored.
  const attachments = (Array.isArray(b.attachments) ? b.attachments : []).slice(0, 10)
    .map((p: unknown) => (typeof p === "string" && p.startsWith("uploads/") ? attachmentAt(bot.id, p) : null))
    .filter((a: Attachment | null): a is Attachment => !!a);
  if (!text && !attachments.length) fail(400, "Write a message first.");
  if (text.length > 100_000) fail(413, "That message is too long.");
  const voice = b.origin === "voice";
  // `thread`: a reply in the thread on that message of the main chat.
  const thread = threadParent(bot, b.thread);
  const row = rows.append(bot, { kind: "message", role: "user", text, origin: voice ? { kind: "voice", id: "", name: "Voice" } : undefined, attachments: attachments.length ? attachments : undefined }, thread);
  if (bot.kind === "room") dispatchToRoom(bot, c.get("user"), text, null, 0, false, thread);
  else { relayUserSpoke(bot.id); submitUserMessage(bot, text, voice, attachments, undefined, thread, skillCommand(bot, text)); }
  return c.json({ row });
});

/**
 * "/skill <name> …" at the start of a message: the bot is told to follow that skill (its own, or one a teammate shared).
 * The longest skill name that the text starts with wins, so names with spaces work. The chat shows the text as typed.
 */
export function skillCommand(bot: BotRecord, text: string): ForcedSkill | undefined {
  const m = /^\/skill\s+([\s\S]+)$/i.exec(text.trim());
  if (!m) return undefined;
  const rest = m[1].toLowerCase();
  const found = skills.available(bot.id).filter((k) => rest === k.name.toLowerCase() || rest.startsWith(k.name.toLowerCase() + " ") || rest.startsWith(k.name.toLowerCase() + "\n")).sort((a, b) => b.name.length - a.name.length)[0];
  if (found) return { name: found.name, body: found.body, from: found.own ? undefined : found.botName };
  // An unknown name still reaches the bot, which says so instead of guessing.
  return { name: m[1].split(/\s/)[0], body: "(There is no skill by this name: tell the user, and list the skills you do have.)" };
}

/** "Continue" under a notice that says the bot stopped at its step limit. */
api.post("/bots/:id/rows/:seq/continue", (c) => {
  const bot = ownAgent(c);
  if (!continueAfterStepLimit(bot, Number(c.req.param("seq")))) fail(409, "There is nothing to continue here.");
  return c.json({ ok: true });
});

/** "Undo" under a line saying the bot changed its own settings (self_update). */
api.post("/bots/:id/rows/:seq/undo", (c) => {
  const bot = ownAgent(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "event" || !row.body.undo || row.body.undo.status !== "available") fail(409, "There is nothing to undo here.");
  const ev = row!.body as Extract<RowBody, { kind: "event" }>;
  if (!undoRevision(bot, ev.undo!.revisionId)) fail(409, "That change was already undone.");
  rows.rewrite(bot, row!.generation, row!.seq, { ...ev, undo: { revisionId: ev.undo!.revisionId, status: "undone" } });
  return c.json({ bot: publicBot(bots.byId(bot.id)!) });
});

// ── Reliability (backup models, retries, continuations) and the shared profile ──
const reliabilityOf = (userId: string) => ({ ...settings.reliability(userId), envFallbacks: config.fallbackModels });
api.get("/reliability", (c) => c.json(reliabilityOf(c.get("user").id)));
api.put("/reliability", async (c) => {
  const b = await body(c);
  const int = (v: unknown, max: number) => (v === undefined ? undefined : Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max ? (v as number) : fail(400, `Pick a number from 0 to ${max}.`));
  if (b.fallbackModels !== undefined && !Array.isArray(b.fallbackModels)) fail(400, "fallbackModels must be a list.");
  settings.saveReliability(c.get("user").id, {
    ...(b.fallbackModels !== undefined ? { fallbackModels: cleanModelList(b.fallbackModels) } : {}),
    ...(b.maxRetries !== undefined ? { maxRetries: int(b.maxRetries, RELIABILITY_LIMITS.maxRetries) } : {}),
    ...(b.maxContinuations !== undefined ? { maxContinuations: int(b.maxContinuations, RELIABILITY_LIMITS.maxContinuations) } : {}),
  });
  return c.json(reliabilityOf(c.get("user").id));
});
api.get("/profile", (c) => c.json({ profile: settings.profile(c.get("user").id) }));
api.put("/profile", async (c) => {
  const r = cleanProfile(await body(c));
  if ("error" in r) fail(400, r.error);
  const user = c.get("user");
  const profile = settings.saveProfile(user.id, "fields" in r ? r.fields : {});
  audit(user.id, "account", "Shared profile updated");
  emit(user.id, { type: "profile" });
  return c.json({ profile });
});
/** Which official API x_search uses here, if any. */
api.get("/x-search", (c) => c.json({ provider: xSearchProvider() }));

api.post("/bots/:id/uploads", async (c) => {
  const bot = ownAgent(c);
  if (Number(c.req.header("content-length") ?? 0) > 26_000_000) fail(413, "Files can be up to 25 MB.");
  const form = await c.req.parseBody().catch(() => ({}) as Record<string, unknown>);
  const file = form.file;
  if (!(file instanceof File)) return fail(400, "No file was sent.");
  if (file.size > 25_000_000) fail(413, "Files can be up to 25 MB.");
  if (!file.size) fail(400, "That file is empty.");
  return c.json({ attachment: storeBytes(bot.id, "uploads", file.name, Buffer.from(await file.arrayBuffer())) });
});

api.post("/bots/:id/stop", (c) => { interrupt(ownBot(c).id); return c.json({ ok: true }); });

api.post("/bots/:id/reset", (c) => {
  const bot = ownBot(c);
  interrupt(bot.id);
  const generation = bots.resetConversation(bot.id);
  emit(bot.userId, { type: "reset", botId: bot.id, generation });
  bots.announce(bot);
  return c.json({ generation });
});

api.post("/approvals/:approvalId", async (c) => {
  const decision = (await body(c)).decision;
  if (!["allow", "always", "deny"].includes(decision)) fail(400, "Unknown decision.");
  if (!decideApproval(c.get("user").id, c.req.param("approvalId"), decision)) fail(404, "That request no longer exists.");
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/answer", async (c) => {
  const bot = ownBot(c);
  const answer = String((await body(c)).answer ?? "").trim();
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card" || row.body.card.type !== "question") fail(400, "That is not a question.");
  if (!answer) fail(400, "Pick or write an answer.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "answered", answer } : k));
  // A question asked in a thread is answered in that thread.
  const thread = row!.thread ?? 0;
  rows.append(bot, { kind: "message", role: "user", text: answer }, thread);
  submitUserMessage(bot, `(Answering your question "${card?.type === "question" ? card.question : ""}")\n${answer}`, false, [], undefined, thread);
  return c.json({ ok: true });
});

api.post("/bots/:id/cards/:seq/dismiss", (c) => {
  const bot = ownBot(c);
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  if (!row || row.body.kind !== "card") fail(400, "That is not a card.");
  const card = row!.body.kind === "card" ? row!.body.card : null;
  if (card?.type === "connect" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "connect" ? { ...k, status: "skipped" } : k));
    enqueue(bot.id, { kind: "system", text: `The user chose not to connect ${card.name}. Carry on without it, or say what cannot be done.` });
  } else if (card?.type === "question" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "question" ? { ...k, status: "dismissed" } : k));
  } else if (card?.type === "secret" && card.status === "pending") {
    rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "secret" ? { ...k, status: "dismissed" } : k));
    enqueue(bot.id, { kind: "system", text: `The user chose not to give the secret "${card.name}". Carry on without it, or say what cannot be done.`, thread: row!.thread || undefined });
  }
  return c.json({ ok: true });
});

/**
 * The secure card of secret_request: the value goes from the user's browser straight into the vault, sealed. It is
 * never written to the chat, the bot's history or the activity log, and no API returns it.
 */
api.post("/bots/:id/cards/:seq/secret", async (c) => {
  const bot = ownAgent(c);
  const user = c.get("user");
  const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
  const card = row?.body.kind === "card" && row.body.card.type === "secret" ? row.body.card : fail(400, "That is not a secret request.");
  if (card.status !== "pending") fail(409, "This request was already answered.");
  const b = await body(c);
  const value = typeof b.value === "string" ? b.value.trim() : "";
  if (!value) fail(400, "Type the secret first.");
  if (value.length > 8000) fail(400, "That secret is too long.");
  const host = siteOf(typeof b.host === "string" && b.host.trim() ? b.host : card.host);
  if (!host) fail(400, "Say which host the secret may be sent to.");
  const header = typeof b.header === "string" && b.header.trim() ? b.header.trim() : card.header;
  if (!HEADER_OK(header)) fail(400, "That header name cannot carry a secret.");
  const prefix = typeof b.prefix === "string" ? b.prefix.slice(0, 40) : card.prefix;
  const existing = vault.byName(user.id, card.name);
  if (existing && existing.kind !== "secret") fail(409, "A vault item with this name already exists and is not a secret.");
  const fields: VaultFields = { kind: "secret", name: card.name, site: "", username: "", passwordEnc: seal(value), note: existing?.note ?? clip(card.reason, 500), hosts: [host], header, prefix };
  if (existing) vault.update(existing.id, fields); else vault.create(user.id, fields);
  audit(user.id, "vault", `Secret saved from ${bot.name}'s request: ${card.name} (for ${host})`, bot.id);
  emit(user.id, { type: "vault" });
  rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "secret" ? { ...k, host, header, prefix, status: "saved" } : k));
  enqueue(bot.id, { kind: "system", text: `The user saved the secret "${card.name}" for ${host}. Use it with secret_use (secret: "${card.name}") — you will not see its value. Continue with what you were doing.`, thread: row!.thread || undefined });
  return c.json({ ok: true });
});

/** "I'm done, hand it back": the bot that asked for the user (ask_takeover) carries on. */
api.post("/bots/:id/takeover/:takeoverId/done", (c) => {
  const bot = ownAgent(c);
  const id = c.req.param("takeoverId");
  const row = rows.all(bot.id, bot.generation).reverse().find((r) => r.body.kind === "card" && r.body.card.type === "takeover" && r.body.card.takeoverId === id);
  if (!row) fail(404, "That request no longer exists.");
  releaseControl(bot.id);
  noteHandBack(bot.id);
  audit(bot.userId, "system", `${bot.name}: screen handed back by the user`, bot.id);
  if (!finishTakeover(id, bot.id)) {
    // Nothing waits any more (a restart, or it timed out): the bot hears about it in a new turn.
    const card = row!.body.kind === "card" && row!.body.card.type === "takeover" ? row!.body.card : null;
    if (card?.status === "pending") {
      rows.updateCard(bot, row!.generation, row!.seq, (k) => (k.type === "takeover" ? { ...k, status: "done" } : k));
      enqueue(bot.id, { kind: "system", text: "The user finished what you asked them to do on your screen and handed it back. Look at the screen, then carry on.", thread: row!.thread || undefined });
    }
  }
  return c.json({ ok: true });
});

// ── Knowledge and automation ─────────────────────────────────────────────────
api.get("/bots/:id/bundle", (c) => {
  const bot = ownBot(c);
  return c.json({ memories: memories.list(bot.id), skills: skills.list(bot.id), routines: routines.forBot(bot.id).map((r) => publicRoutine(r, c.get("user").locale)), tasks: tasks.forBot(bot.id), memoryStatus: memoryStatus(bot) });
});

function skillFields(b: Record<string, any>, base?: { name: string; description: string; body: string }) {
  const name = (b.name === undefined ? base?.name ?? "" : String(b.name)).trim().slice(0, 80);
  const description = (b.description === undefined ? base?.description ?? "" : String(b.description)).trim().slice(0, 300);
  const text = (b.body === undefined ? base?.body ?? "" : String(b.body)).trim().slice(0, 20_000);
  if (!name) fail(400, "Give the skill a name.");
  if (!text) fail(400, "Write the steps for this skill.");
  return { name, description, body: text };
}

api.post("/bots/:id/skills", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const f = skillFields(b);
  return c.json({ skill: skills.create(bot.id, f.name, f.description, f.body, b.shared === true) });
});
api.patch("/skills/:id", async (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  const b = await body(c);
  return c.json({ skill: skills.update(cur.id, { ...skillFields(b, cur), shared: typeof b.shared === "boolean" ? b.shared : undefined }) });
});
/** Skills a bot can follow: its own and those its teammates shared (for "/skill" in the composer). */
api.get("/bots/:id/skills/available", (c) => c.json({ skills: skills.refs(ownAgent(c).id) }));
/** The user imports a skill from a public markdown file (their own action: no card). */
api.post("/bots/:id/skills/import", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  let parsed;
  try { parsed = await fetchSkillMarkdown(String(b.url ?? ""), AbortSignal.timeout(25_000)); } catch (err) { fail(400, (err as Error).message); }
  const { skill, replaced } = saveImportedSkill(bot, parsed!, String(b.name ?? ""), b.shared === true);
  audit(bot.userId, "account", `Skill imported for ${bot.name}: ${skill.name}`, bot.id);
  return c.json({ skill, replaced });
});
api.delete("/skills/:id", (c) => {
  const cur = skills.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That skill does not exist.");
  skills.remove(cur.id);
  return c.json({ ok: true });
});
api.post("/bots/:id/memories", async (c) => {
  const bot = ownAgent(c);
  const text = clip(String((await body(c)).text ?? "").trim(), 500);
  if (!text) fail(400, "Write what to remember.");
  const memory = memories.add(bot.id, text, "chat");
  emit(bot.userId, { type: "memories", botId: bot.id });
  return c.json({ memory });
});
api.delete("/memories/:id", (c) => { memories.removeOwned(c.get("user").id, c.req.param("id")); return c.json({ ok: true }); });

api.post("/bots/:id/consolidate", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await consolidate(bot)); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});
api.post("/bots/:id/compact", async (c) => {
  const bot = ownAgent(c);
  try { return c.json(await inQueue(bot.id, () => compactIfNeeded(bots.byId(bot.id)!, true))); } catch (err) { return fail(502, `Could not reach the model: ${(err as Error).message}`); }
});

// Gem hunt: a daily routine where the bot goes through the business data it can reach and celebrates only real gems.
const GEM_HUNT = "Gem hunt";
const GEM_HUNT_PROMPT = [
  "Gem hunt. Go through the business data you can reach: connected apps (analytics, search console, CRM, sales, ads, mailbox, shop), the user's sites and pages you know, files in your library, and what you remember about the business.",
  "Look for rare, high-value opportunities: a qualified lead ready to buy, a search query or page with large traffic upside and weak competition, a sharp change in a key metric, a deal or saving far above normal, an untapped market signal.",
  "Compare with what you noted after earlier hunts (memory_search \"gem hunt\") so you judge what is really unusual for this business.",
  "If you find a gem, call celebrate with the numbers, then explain it and suggest the next step. Save one short memory with today's key figures for the next hunt.",
  "If nothing stands out, do not invent anything: end with stay_quiet.",
].join("\n");
api.get("/gems", (c) => {
  const list = q.all<{ bot_id: string; name: string; body: string; created_at: number }>(
    "SELECT r.bot_id, b.name, r.body, r.created_at FROM rows r JOIN bots b ON b.id = r.bot_id WHERE b.user_id = ? AND r.kind = 'event' AND r.body LIKE '%\"event\":\"cheer\"%' ORDER BY r.created_at DESC LIMIT 100",
    c.get("user").id);
  return c.json({ gems: list.map((r) => { const b = JSON.parse(r.body); return { botId: r.bot_id, botName: r.name, at: r.created_at, reason: b.text, gem: b.gem ?? null }; }) });
});
api.post("/bots/:id/gem-hunt", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const existing = routines.forBot(bot.id).find((r) => r.prompt.startsWith("Gem hunt."));
  if (existing) return c.json({ routine: publicRoutine(existing, c.get("user").locale), created: false });
  const tz = typeof b.timezone === "string" && isValidTimezone(b.timezone) ? b.timezone : "UTC";
  const m = /^(\d{1,2}):(\d{2})$/.exec(String(b.time ?? "08:40"));
  const hh = m ? Math.min(23, Number(m[1])) : 8, mm = m ? Math.min(59, Number(m[2])) : 40;
  const r = routines.create(bot.id, { name: tr(c.get("user").locale, GEM_HUNT), prompt: GEM_HUNT_PROMPT, trigger: "cron", schedule: `${mm} ${hh} * * *`, timezone: tz });
  schedule(r.id);
  emit(c.get("user").id, { type: "routines", botId: bot.id });
  audit(c.get("user").id, "routine", `${bot.name}: gem hunt turned on`, bot.id);
  return c.json({ routine: publicRoutine(r, c.get("user").locale), created: true });
});
api.get("/bots/:id/routines", (c) => c.json({ routines: routines.forBot(ownBot(c).id).map((r) => publicRoutine(r, c.get("user").locale)) }));
const ownRoutine = (c: Context<Env>) => routines.owned(c.get("user").id, c.req.param("id") ?? "") ?? fail(404, "That routine does not exist.");
api.patch("/routines/:id", async (c) => {
  const r = ownRoutine(c);
  const updated = routines.update(r.id, { enabled: !!(await body(c)).enabled })!;
  schedule(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ routine: publicRoutine(updated, c.get("user").locale) });
});
api.get("/routines/:id/runs", (c) => c.json({ runs: runs.list(ownRoutine(c).id) }));
api.post("/routines/:id/run", (c) => { fireRoutine(ownRoutine(c)); return c.json({ ok: true }); });
api.delete("/routines/:id", (c) => {
  const r = ownRoutine(c);
  unschedule(r.id);
  routines.remove(r.id);
  emit(c.get("user").id, { type: "routines", botId: r.botId });
  return c.json({ ok: true });
});

api.get("/tasks", (c) => c.json({ tasks: tasks.forUser(c.get("user").id) }));
api.get("/bots/:id/tasks", (c) => c.json({ tasks: tasks.forBot(ownBot(c).id) }));

// ── Voice calls, search, earlier conversations ───────────────────────────────
const calls = new Map<string, { botId: string; startedAt: number }>();
api.post("/bots/:id/calls", (c) => {
  const bot = ownAgent(c);
  const callId = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  calls.set(callId, { botId: bot.id, startedAt: Date.now() });
  rows.append(bot, { kind: "event", event: "call", text: tr(c.get("user").locale, "Voice call with {bot} started", { bot: bot.name }), call: { id: callId, phase: "started" } });
  return c.json({ callId });
});
api.post("/bots/:id/calls/:callId/end", async (c) => {
  const bot = ownAgent(c);
  const callId = c.req.param("callId");
  const live = calls.get(callId);
  if (!live || live.botId !== bot.id) return c.json({ ok: true, duplicate: true });
  calls.delete(callId);
  const b = await body(c);
  const transcript = (Array.isArray(b.transcript) ? b.transcript : [])
    .filter((l: any) => l && (l.role === "user" || l.role === "assistant") && typeof l.text === "string" && l.text.trim())
    .slice(-200).map((l: any) => ({ role: l.role as "user" | "assistant", text: clip(l.text.trim(), 2000) }));
  const durationMs = Math.max(1000, Date.now() - live.startedAt);
  const secs = Math.round(durationMs / 1000);
  const duration = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const locale = c.get("user").locale;
  const base = tr(locale, "Voice call ended · {duration}", { duration });
  const record = { id: callId, phase: "ended" as const, durationMs, transcript };
  const row = rows.append(bot, { kind: "event", event: "call", text: base, call: record });
  // A one-line summary is added to the row a moment later; the call is already recorded without it.
  if (transcript.length)
    void ask(bot, "You summarise voice calls between a user and their AI teammate.",
      `Write ONE sentence, past tense, third person, at most 25 words, in ${locale === "fr" ? "French" : "English"}, saying what the call was about and what was agreed.\n\n${transcript.map((l: { role: string; text: string }) => `${l.role === "user" ? "User" : bot.name}: ${l.text}`).join("\n").slice(-12_000)}`)
      .then((summary) => { if (summary) rows.rewrite(bot, row.generation, row.seq, { kind: "event", event: "call", text: base, call: { ...record, summary: clip(summary.replace(/\s+/g, " "), 240) } }); })
      .catch(() => {});
  return c.json({ ok: true });
});

api.get("/search", (c) => {
  const query = (c.req.query("q") ?? "").trim();
  return c.json({ hits: query.length >= 2 ? searchMessages(c.get("user").id, query) : [] });
});
api.get("/bots/:id/history/:generation", (c) => {
  const bot = ownBot(c);
  const generation = Number(c.req.param("generation"));
  if (!Number.isInteger(generation) || generation < 1 || generation > bot.generation) fail(404, "That conversation does not exist.");
  // Threads included: each reply carries the seq of the message it hangs on.
  return c.json({ rows: rows.all(bot.id, generation).slice(-2000) });
});

api.get("/audit", (c) => c.json({ entries: auditList(c.get("user").id, Number(c.req.query("before")) || undefined, Number(c.req.query("limit")) || 50) }));

// ── Telegram ─────────────────────────────────────────────────────────────────
api.get("/bots/:id/telegram", (c) => c.json(telegram.status(ownAgent(c))));
api.put("/bots/:id/telegram", async (c) => {
  const bot = ownAgent(c);
  const token = String((await body(c)).token ?? "").trim();
  if (!/^\d+:[\w-]{20,}$/.test(token)) fail(400, "That does not look like a Telegram bot token.");
  try { return c.json(await telegram.connect(bot, token)); } catch (err) { return fail(400, `Telegram refused this token: ${(err as Error).message}`); }
});
api.delete("/bots/:id/telegram", (c) => { telegram.disconnect(ownAgent(c)); return c.json({ ok: true }); });

// ── Shared pages ─────────────────────────────────────────────────────────────
api.get("/pages", (c) => c.json({ pages: pages.list(c.get("user").id, config.publicUrl).map(({ userId, path: _p, ...rest }) => rest) }));
api.delete("/pages/:token", (c) => {
  pages.remove(c.get("user").id, c.req.param("token"));
  emit(c.get("user").id, { type: "pages" });
  return c.json({ ok: true });
});

// ── Account and data ─────────────────────────────────────────────────────────
api.put("/account/password", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  throttle(`pw:${user.id}`);
  if (!verifyPassword(String(b.current ?? ""), user.passHash)) fail(401, "The current password is wrong.");
  if (String(b.next ?? "").length < 8) fail(400, "Choose a password of at least 8 characters.");
  account.setPassword(user.id, hashPassword(String(b.next)));
  // Every other device is signed out; this one stays in.
  account.dropOtherSessions(user.id, sha256(getCookie(c, SESSION_COOKIE) ?? ""));
  audit(user.id, "account", "Password changed");
  return c.json({ ok: true });
});

api.delete("/account", async (c) => {
  const user = c.get("user");
  throttle(`pw:${user.id}`);
  if (!verifyPassword(String((await body(c)).password ?? ""), user.passHash)) fail(401, "The password is wrong.");
  for (const bot of bots.list(user.id, true)) { if (bots.byId(bot.id)) { telegram.disconnect(bot); await retireBot(bot); removeWorkspace(bot.id); } }
  for (const con of connectorStore.list(user.id)) await connectorStore.remove(user.id, con.id);
  account.remove(user.id);
  deleteCookie(c, SESSION_COOKIE, { path: "/" });
  return c.json({ ok: true });
});

const download = (c: Context, name: string, type: string, content: string) =>
  c.body(content, 200, { "content-type": type, "content-disposition": `attachment; filename="${name}"` });

api.get("/export/data", (c) => {
  const user = c.get("user");
  const mine = bots.list(user.id, true);
  const data = {
    exportedAt: new Date().toISOString(), user: publicUser(user),
    bots: mine.map((b) => ({
      ...publicBot(b),
      conversations: Array.from({ length: b.generation }, (_, i) => ({ generation: i + 1, rows: q.all<any>("SELECT seq, thread, created_at, body FROM rows WHERE bot_id = ? AND generation = ? ORDER BY seq", b.id, i + 1).map((r) => ({ seq: r.seq, ...(r.thread ? { thread: r.thread } : {}), at: r.created_at, ...JSON.parse(r.body) })) })),
      memories: memories.list(b.id, 100_000), skills: skills.list(b.id), routines: routines.forBot(b.id).map((r) => publicRoutine(r, user.locale)), tasks: tasks.forBot(b.id),
    })),
    policies: policies.list(user.id), vault: vault.list(user.id).map(publicVault),
    connectors: connectorStore.list(user.id).map((k) => ({ name: k.name, url: k.url })),
    checkins: publicCheckins(user.id), usage: usageSummary(user.id), activity: auditList(user.id, undefined, 200),
  };
  audit(user.id, "account", "Data exported");
  return download(c, "sklubot-data.json", "application/json", JSON.stringify(data, null, 2));
});

api.get("/export/team", (c) => {
  const user = c.get("user");
  const team = bots.list(user.id).filter((b) => b.kind === "agent").map((b) => ({
    name: b.name, label: b.label, description: b.description, instructions: b.instructions, shape: b.shape, color: b.color, mode: b.mode,
    effort: b.effort, model: b.model, autonomy: b.autonomy, disabledTools: b.disabledTools, character: b.character,
    skills: skills.list(b.id).map((s) => ({ name: s.name, description: s.description, body: s.body })),
    routines: routines.forBot(b.id).filter((r) => r.trigger === "cron").map((r) => ({ name: r.name, prompt: r.prompt, schedule: r.schedule, timezone: r.timezone })),
  }));
  return download(c, "sklubot-team.json", "application/json", JSON.stringify({ sklubotTeam: 1, bots: team }, null, 2));
});

api.post("/import/team", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  if (b.sklubotTeam !== 1 || !Array.isArray(b.bots)) fail(400, "This is not a Sklubot team file.");
  let created = 0;
  for (const t of b.bots.slice(0, 30)) {
    if (!t || typeof t.name !== "string" || !t.name.trim()) continue;
    // Imported bots start careful, whatever the file says: a shared file must not hand out trust.
    const bot = bots.create(user.id, { name: t.name, label: t.label, description: t.description, instructions: t.instructions, shape: t.shape, color: t.color, mode: t.mode, effort: t.effort, autonomy: "careful" });
    if (Array.isArray(t.disabledTools)) bots.patch(bot.id, { disabledTools: t.disabledTools });
    if (t.character) bots.patch(bot.id, { character: t.character });
    for (const s of Array.isArray(t.skills) ? t.skills.slice(0, 50) : [])
      if (s && typeof s.name === "string" && typeof s.body === "string" && s.name.trim() && s.body.trim()) skills.create(bot.id, s.name.trim().slice(0, 80), String(s.description ?? "").slice(0, 300), s.body.slice(0, 20_000));
    for (const r of Array.isArray(t.routines) ? t.routines.slice(0, 20) : [])
      if (r && typeof r.name === "string" && typeof r.prompt === "string" && typeof r.schedule === "string") {
        // Imported routines start paused, so nothing runs before you have looked at it.
        try { const made = routines.create(bot.id, { name: r.name, prompt: r.prompt, trigger: "cron", schedule: r.schedule, timezone: isValidTimezone(String(r.timezone)) ? r.timezone : "UTC" }); routines.update(made.id, { enabled: false }); } catch { /* skip a routine that cannot be read */ }
      }
    created++;
  }
  if (created) { emit(user.id, { type: "roster" }); audit(user.id, "account", `Team imported: ${created} bots`); }
  return c.json({ created });
});

api.get("/usage.csv", (c) => download(c, "sklubot-usage.csv", "text/csv; charset=utf-8", usageCsv(c.get("user").id)));

// ── The user's own computers (Sklubot Relais, docs/RELAIS-PROTOCOLE.md) ──────
api.get("/relay/devices", (c) => c.json({ devices: listDevices(c.get("user").id), downloads: relayDownloads() }));
/** Pairing: the user types the code their computer shows. A few tries per account and per address, then a pause. */
const pairTries = new Map<string, number[]>();
function pairThrottle(key: string, limit: number) {
  const t = Date.now();
  const recent = (pairTries.get(key) ?? []).filter((at) => at > t - 10 * 60_000);
  if (recent.length >= limit) fail(429, "Too many attempts. Wait a few minutes and try again.");
  recent.push(t);
  pairTries.set(key, recent);
  if (pairTries.size > 10_000) for (const [k, v] of pairTries) if (!v.some((at) => at > t - 10 * 60_000)) pairTries.delete(k);
}
api.post("/relay/pairings", async (c) => {
  const user = c.get("user");
  const code = String((await body(c)).code ?? "");
  pairThrottle(`user:${user.id}`, 5);
  pairThrottle(`ip:${clientIp(c)}`, 20);
  const device = confirmPairing(user, code);
  if (!device) {
    audit(user.id, "computer", tr(user.locale, "Wrong or expired pairing code"));
    fail(400, "That code is not valid, or it has expired. Check the code shown on your computer.");
  }
  return c.json({ device });
});
api.delete("/relay/devices/:id", (c) => {
  if (!revokeDevice(c.get("user").id, c.req.param("id"))) fail(404, "That computer is not linked.");
  return c.json({ ok: true });
});
/** "Stop": ends the bot's control session on that computer, cancels its commands, and keeps the bot from taking it back on its own. */
api.post("/relay/devices/:id/stop", (c) => {
  if (!stopSession(c.get("user").id, c.req.param("id"))) fail(409, "That computer is not connected.");
  return c.json({ ok: true });
});
/** The last picture seen of the computer (a bot's screenshot or the live view), for when no live view runs. */
api.get("/relay/devices/:id/last", (c) => {
  const id = c.req.param("id");
  const frame = listDevices(c.get("user").id).some((d) => d.id === id) ? lastFrame(id) : null;
  if (!frame) return c.body(null, 204);
  return c.body(new Uint8Array(Buffer.from(frame.data, "base64")), 200, { "content-type": "image/jpeg", "cache-control": "no-store", "x-frame-at": String(frame.at) });
});

// ── Computer and files ───────────────────────────────────────────────────────
api.get("/computer", (c) => c.json(computerState(c.get("user").id)));

api.get("/bots/:id/screen", async (c) => {
  const shot = await screen.peek(ownBot(c).id);
  if (!shot) return c.body(null, 204);
  return c.body(new Uint8Array(shot), 200, { "content-type": "image/jpeg", "cache-control": "no-store" });
});

api.post("/bots/:id/screen/input", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  const uid = bot.userId;
  try {
    // A demonstration under way records what the user does (typed text only as a count).
    noteInput(bot.id, { type: String(b.type), x: Number(b.x), y: Number(b.y), text: typeof b.text === "string" ? b.text : undefined, key: typeof b.key === "string" ? b.key : undefined, dy: Number(b.dy), url: typeof b.url === "string" ? b.url : undefined });
    if (b.type === "goto") await screen.open(bot.id, uid, String(b.url ?? ""));
    else if (!screen.isOpen(bot.id)) fail(409, "This bot's computer is not on yet.");
    else if (b.type === "click") await screen.click(bot.id, uid, Number(b.x), Number(b.y));
    else if (b.type === "type") await screen.type(bot.id, uid, String(b.text ?? ""));
    else if (b.type === "key") await screen.key(bot.id, uid, String(b.key ?? ""));
    else if (b.type === "scroll") await screen.scroll(bot.id, uid, Number(b.x), Number(b.y), Number(b.dy) || 0);
    else fail(400, "Unknown input type.");
  } catch (err) {
    if (err instanceof HttpError) throw err;
    fail(502, (err as Error).message);
  }
  return c.json({ ok: true });
});

api.post("/bots/:id/desktop/wake", async (c) => {
  const bot = ownAgent(c);
  try { await screen.wake(bot.id, bot.userId); } catch (err) { return fail(502, (err as Error).message); }
  return c.json({ ok: true });
});
api.post("/bots/:id/desktop/tidy", async (c) => {
  const bot = ownAgent(c);
  try { await screen.tidy(bot.id, bot.userId); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "system", `${bot.name}: screen tidied`, bot.id);
  return c.json({ ok: true });
});
// "Show me how": record a demonstration on the bot's screen, then review the skill the bot drafts from it.
api.get("/bots/:id/teach", (c) => c.json({ recording: recording(ownAgent(c).id) }));
api.post("/bots/:id/teach/start", (c) => {
  const bot = ownAgent(c);
  try { return c.json({ recording: startRecording(bot) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/stop", async (c) => {
  const bot = ownAgent(c);
  const note = String((await body(c)).note ?? "");
  try { return c.json({ recording: await stopRecording(bot.id, note) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/retry", (c) => {
  const bot = ownAgent(c);
  try { return c.json({ recording: retryRecording(bot.id) }); } catch (err) { return fail(409, (err as Error).message); }
});
api.post("/bots/:id/teach/save", async (c) => {
  const bot = ownAgent(c);
  const b = await body(c);
  try { return c.json(saveRecording(bot, { name: String(b.name ?? ""), when: String(b.when ?? ""), steps: String(b.steps ?? "") })); } catch (err) { return fail(400, (err as Error).message); }
});
api.post("/bots/:id/teach/discard", (c) => { dropRecording(ownAgent(c).id); return c.json({ ok: true }); });
api.post("/bots/:id/desktop/handback", (c) => { const bot = ownAgent(c); releaseControl(bot.id); noteHandBack(bot.id); return c.json({ ok: true }); });
/** The viewer is in control mode ({ on: true }, renewed every 30 s) or left it: the bot's screen actions wait meanwhile. */
api.post("/bots/:id/desktop/control", async (c) => {
  const bot = ownAgent(c);
  if ((await body(c)).on === false) releaseControl(bot.id); else holdControl(bot.id);
  return c.json({ ok: true });
});
api.get("/bots/:id/engine", async (c) => {
  const bot = ownAgent(c);
  try { return c.json({ engines: await engineStatus(bot) }); }
  catch (err) { return c.json({ engines: (["claude-code", "codex"] as const).map((engine) => ({ engine, installed: false, signedIn: null, account: null, detail: (err as Error).message })) }); }
});
api.post("/bots/:id/engine/login", async (c) => {
  const bot = ownAgent(c);
  const engine = (await body(c)).engine === "codex" ? "codex" : "claude-code";
  try { await engineLogin(bot, engine); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "account", `${bot.name}: sign-in to ${engine === "codex" ? "ChatGPT" : "Claude"} started on its computer`, bot.id);
  return c.json({ ok: true });
});
api.post("/bots/:id/engine/logout", async (c) => {
  const bot = ownAgent(c);
  const engine = (await body(c)).engine === "codex" ? "codex" : "claude-code";
  try { await engineLogout(bot, engine); } catch (err) { return fail(502, (err as Error).message); }
  audit(bot.userId, "account", `${bot.name}: signed out of ${engine === "codex" ? "ChatGPT" : "Claude"}`, bot.id);
  return c.json({ ok: true });
});
api.post("/bots/:id/desktop/sleep", async (c) => { await screen.sleep(ownBot(c).id); return c.json({ ok: true }); });
api.post("/bots/:id/desktop/reset", async (c) => { await screen.reset(ownBot(c).id); return c.json({ ok: true }); });

const safePath = (botId: string, rel: string) => { try { return resolveInWorkspace(botId, rel); } catch (err) { return fail(400, (err as Error).message); } };

api.get("/bots/:id/files", (c) => {
  const bot = ownBot(c);
  const rel = c.req.query("path") ?? "";
  safePath(bot.id, rel);
  return c.json({ entries: listFiles(bot.id, rel) });
});

/** Opens a library file for sending: only a plain file inside the library, never through a link. */
function libraryFileFor(botId: string, rel: string) {
  safePath(botId, rel);
  try { return openLibraryFile(botId, rel); } catch { return fail(404, "That file does not exist."); }
}

api.get("/bots/:id/files/download", (c) => {
  const bot = ownBot(c);
  const f = libraryFileFor(bot.id, c.req.query("path") ?? "");
  const name = path.basename(f.full).replace(/[^\w. -]/g, "_");
  return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd })) as unknown as ReadableStream, 200, {
    "content-type": "application/octet-stream", "content-disposition": `attachment; filename="${name}"`, "content-length": String(f.size),
  });
});

/** Shows a library file in the page. Only plain pictures and videos are served inline; everything else is a download, so an uploaded page can never run as ours. */
api.get("/bots/:id/files/view", (c) => {
  const bot = ownBot(c);
  const f = libraryFileFor(bot.id, c.req.query("path") ?? "");
  const mime = mimeOf(f.full);
  // Videos play in the chat's player; nothing else that could run as a page is ever served inline.
  const inline = isInlineImage(mime) || isInlineVideo(mime);
  // Players ask for byte ranges to seek in a video (RFC 9110 §14): one range is served, anything else gets the whole file.
  const range = isInlineVideo(mime) ? /^bytes=(\d*)-(\d*)$/.exec(c.req.header("range") ?? "") : null;
  if (range && (range[1] || range[2]) && f.size > 0) {
    let start = range[1] ? Number(range[1]) : Math.max(0, f.size - Number(range[2]));
    let end = range[1] && range[2] ? Math.min(Number(range[2]), f.size - 1) : f.size - 1;
    if (start >= f.size || start > end) { closeSync(f.fd); return c.body(null, 416, { "content-range": `bytes */${f.size}` }); }
    start = Math.max(0, start); end = Math.max(start, end);
    return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd, start, end })) as unknown as ReadableStream, 206, {
      "content-type": mime, "content-length": String(end - start + 1), "content-range": `bytes ${start}-${end}/${f.size}`, "accept-ranges": "bytes",
      "content-disposition": `inline; filename="${path.basename(f.full).replace(/[^\w. -]/g, "_")}"`,
      "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=300",
    });
  }
  return c.body(Readable.toWeb(createReadStream(f.full, { fd: f.fd })) as unknown as ReadableStream, 200, {
    "content-type": inline ? mime : "application/octet-stream", "content-length": String(f.size), ...(isInlineVideo(mime) ? { "accept-ranges": "bytes" } : {}),
    "content-disposition": `${inline ? "inline" : "attachment"}; filename="${path.basename(f.full).replace(/[^\w. -]/g, "_")}"`,
    "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; sandbox", "cache-control": "private, max-age=300",
  });
});

// ── Vault ────────────────────────────────────────────────────────────────────
const siteOf = (raw: unknown) => {
  const t = String(raw ?? "").trim();
  if (!t) return "";
  try { return new URL(/^[a-z][a-z0-9+.-]*:/i.test(t) ? t : `https://${t}`).hostname.toLowerCase().replace(/^www\./, ""); } catch { return ""; }
};
/** A header name that may carry a secret (RFC 9110 token, and not one that would change where the request goes). */
const HEADER_OK = (h: string) => /^[A-Za-z0-9!#$%&'*+.^_`|~-]{1,64}$/.test(h) && !["host", "cookie", "content-length", "connection", "transfer-encoding"].includes(h.toLowerCase());
function vaultFields(b: Record<string, any>, base?: VaultFields): VaultFields {
  const kind: VaultKind = (VAULT_KINDS as readonly string[]).includes(b.kind) ? b.kind : base?.kind ?? "login";
  const pick = (key: "name" | "site" | "username" | "note", max: number) => (b[key] === undefined ? base?.[key] ?? "" : String(b[key])).trim().slice(0, max);
  const name = pick("name", 80);
  if (!name) fail(400, "Give this item a name.");
  const password = typeof b.password === "string" && b.password ? b.password : null;
  if (password && password.length > 8000) fail(400, "That value is too long.");
  const f: VaultFields = { kind, name, site: pick("site", 300), username: kind === "login" ? pick("username", 300) : "", note: pick("note", 500), passwordEnc: base?.passwordEnc ?? null };
  if (kind === "secret") {
    const raw: unknown[] = Array.isArray(b.hosts) ? b.hosts : b.hosts === undefined ? base?.hosts ?? [] : String(b.hosts).split(/[\s,]+/);
    const hosts = raw.map(siteOf).filter(Boolean).slice(0, 10);
    if (!hosts.length) fail(400, "Say which host this secret may be sent to.");
    const header = (b.header === undefined ? base?.header ?? "" : String(b.header)).trim() || "Authorization";
    if (!HEADER_OK(header)) fail(400, "That header name cannot carry a secret.");
    const prefix = (b.prefix === undefined ? base?.prefix ?? (header.toLowerCase() === "authorization" ? "Bearer " : "") : String(b.prefix)).slice(0, 40);
    Object.assign(f, { site: "", hosts, header, prefix });
  }
  if (kind === "totp") {
    let digits = base?.digits ?? 6, period = base?.period ?? 30;
    if (password) {
      // A pasted otpauth:// URI brings its own settings; only the base32 key is stored.
      try { const seed = parseTotp(password); digits = seed.digits; period = seed.period; f.passwordEnc = seal(seed.secret); }
      catch (err) { return fail(400, (err as Error).message); }
    }
    if (!siteOf(f.site)) fail(400, "Say which site these codes are for.");
    if (!f.passwordEnc) fail(400, "Paste the key or the otpauth:// address the site gave you.");
    Object.assign(f, { digits, period });
    return f;
  }
  if (password) f.passwordEnc = seal(password);
  return f;
}
api.get("/vault", (c) => c.json({ items: vault.list(c.get("user").id).map(publicVault) }));
api.post("/vault", async (c) => {
  const user = c.get("user");
  const f = vaultFields(await body(c));
  if (vault.byName(user.id, f.name)) fail(409, "A login with this name already exists.");
  audit(user.id, "vault", `Vault item added (${f.kind}): ${f.name}`);
  emit(user.id, { type: "vault" });
  return c.json({ item: publicVault(vault.create(user.id, f)) });
});
api.patch("/vault/:id", async (c) => {
  const user = c.get("user");
  const cur = vault.owned(user.id, c.req.param("id")) ?? fail(404, "That login does not exist.");
  const f = vaultFields(await body(c), cur);
  const clash = vault.byName(user.id, f.name);
  if (clash && clash.id !== cur.id) fail(409, "A login with this name already exists.");
  vault.update(cur.id, f);
  return c.json({ item: publicVault(vault.owned(user.id, cur.id)!) });
});
api.delete("/vault/:id", (c) => {
  const cur = vault.owned(c.get("user").id, c.req.param("id")) ?? fail(404, "That login does not exist.");
  vault.remove(cur.id);
  audit(c.get("user").id, "vault", `Vault item removed: ${cur.name}`);
  for (const key of [`vault: ${cur.name}`, `secret: ${cur.name}`, `totp: ${cur.name}`]) policies.remove(c.get("user").id, key);
  return c.json({ ok: true });
});

/**
 * CSV import of logins (see vault-import.ts for the formats). Body: { csv, mapping? }. Without a recognisable header
 * the answer is { needsMapping: true, headers } — header names only, never a value — and the browser sends a mapping.
 * Names already in the vault are skipped, never overwritten.
 */
api.post("/vault/import", async (c) => {
  const user = c.get("user");
  if (Number(c.req.header("content-length") ?? 0) > 5_000_000) fail(413, "That file is too large (5 MB at most).");
  const b = await body(c);
  const text = typeof b.csv === "string" ? b.csv : "";
  if (!text.trim()) fail(400, "That file is empty.");
  const all = parseCsv(text);
  if (all.length < 2) fail(400, "No logins were found in that file.");
  const headers = all[0].map((h) => clip(h.trim(), 60));
  let map: Mapping | null = null;
  if (b.mapping && typeof b.mapping === "object") {
    map = {};
    for (const k of ["name", "url", "username", "password", "note", "totp"] as const) {
      const raw = b.mapping[k];
      const v = Number(raw);
      if (raw !== null && raw !== undefined && raw !== "" && Number.isInteger(v) && v >= 0 && v < headers.length) map[k] = v;
    }
    if (map.password === undefined || (map.name === undefined && map.url === undefined)) fail(400, "Choose at least the password column and a name or address column.");
  } else map = detectMapping(headers);
  if (!map) return c.json({ imported: 0, skipped: 0, totp: 0, needsMapping: true, headers });
  const { logins, skipped } = loginsFrom(all.slice(1, 5001), map);
  let imported = 0, totp = 0, dupes = 0;
  for (const l of logins) {
    if (vault.byName(user.id, l.name)) { dupes++; continue; }
    vault.create(user.id, { kind: "login", name: l.name, site: l.url, username: l.username, passwordEnc: seal(l.password), note: l.note });
    imported++;
    if (l.totp && siteOf(l.url)) {
      const name = clip(`${l.name} (2FA)`, 80);
      try {
        const seed = parseTotp(l.totp);
        if (!vault.byName(user.id, name)) { vault.create(user.id, { kind: "totp", name, site: l.url, username: "", passwordEnc: seal(seed.secret), note: "", digits: seed.digits, period: seed.period }); totp++; }
      } catch { /* not a usable seed: the login is kept without it */ }
    }
  }
  audit(user.id, "vault", `Logins imported from a file: ${imported}${totp ? ` (+${totp} two-factor)` : ""}`);
  emit(user.id, { type: "vault" });
  return c.json({ imported, skipped: skipped + dupes, totp });
});

// ── Push notifications ───────────────────────────────────────────────────────
api.get("/push", (c) => {
  const user = c.get("user");
  const endpoint = c.req.query("endpoint");
  return c.json({ ...push.state(user.id), currentId: endpoint ? push.byEndpoint(user.id, endpoint)?.id ?? null : null });
});
api.post("/push/subscribe", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  let device;
  try { device = push.subscribe(user.id, b.subscription ?? {}, typeof b.label === "string" ? b.label : ""); }
  catch (err) { return fail(400, (err as Error).message); }
  audit(user.id, "account", `Push notifications on for ${device.label}`);
  return c.json({ device });
});
api.post("/push/unsubscribe", async (c) => {
  push.removeEndpoint(c.get("user").id, String((await body(c)).endpoint ?? ""));
  return c.json({ ok: true });
});
api.patch("/push/devices/:id", async (c) => {
  const b = await body(c);
  const device = push.update(c.get("user").id, c.req.param("id"), { enabled: typeof b.enabled === "boolean" ? b.enabled : undefined, label: typeof b.label === "string" ? b.label : undefined }) ?? fail(404, "That device does not exist.");
  return c.json({ device });
});
api.delete("/push/devices/:id", (c) => {
  if (!push.remove(c.get("user").id, c.req.param("id"))) fail(404, "That device does not exist.");
  return c.json({ ok: true });
});
api.put("/push/settings", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const cur = pushSettings(user.id);
  const kinds = { ...cur.kinds };
  for (const k of PUSH_KINDS) if (typeof b.kinds?.[k] === "boolean") kinds[k] = b.kinds[k];
  const qt = b.quiet ?? {};
  const hhmm = (v: unknown, d: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : d);
  if (qt.timezone !== undefined && !isValidTimezone(String(qt.timezone))) fail(400, "Unknown timezone.");
  const next = { kinds, quiet: { enabled: typeof qt.enabled === "boolean" ? qt.enabled : cur.quiet.enabled, start: hhmm(qt.start, cur.quiet.start), end: hhmm(qt.end, cur.quiet.end), timezone: qt.timezone ? String(qt.timezone) : cur.quiet.timezone } };
  savePushSettings(user.id, next);
  return c.json({ settings: next });
});
api.post("/push/test", async (c) => {
  const user = c.get("user");
  const sent = await sendPush(user.id, { kind: "test", title: "Sklubot", body: tr(user.locale, "Notifications work on this device.") });
  return c.json({ sent });
});
/** Open app windows say whether they are visible, so a finished reply is pushed only when nobody is looking. */
api.post("/presence", async (c) => {
  const b = await body(c);
  notePresence(c.get("user").id, String(b.clientId ?? "default"), b.visible === true);
  return c.json({ ok: true });
});

// ── Connectors and permissions ───────────────────────────────────────────────
api.get("/connectors/catalog", (c) => c.json({ apps: catalogFor(c.get("user").locale), oauthRedirectUri: oauthRedirectUri() }));
api.get("/connectors", (c) => c.json({ connectors: connectors.list(c.get("user").id), oauthRedirectUri: oauthRedirectUri() }));

api.post("/connectors", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  let connector;
  const opts = b.auth === "oauth"
    ? { auth: "oauth" as const, clientId: b.clientId ? String(b.clientId) : undefined, clientSecret: b.clientSecret ? String(b.clientSecret) : undefined }
    : { token: b.token ? String(b.token) : undefined };
  try { connector = await connectors.add(user.id, String(b.name ?? ""), String(b.url ?? ""), opts); }
  catch (err) { return fail(400, (err as Error).message); }
  emit(user.id, { type: "connectors" });
  audit(user.id, "apps", connector.status === "needs_auth" ? `App added, waiting for sign-in: ${connector.name}` : `App connected: ${connector.name}`);
  const bot = typeof b.botId === "string" ? bots.owned(user.id, b.botId) : null;
  if (bot && connector.status === "ready") {
    if (Number.isInteger(b.seq)) rows.updateCard(bot, bot.generation, b.seq, (k) => (k.type === "connect" ? { ...k, status: "connected" } : k));
    enqueue(bot.id, { kind: "system", text: `The user connected ${connector.name}. Its tools are available now — continue with what you were doing.` });
  }
  return c.json({ connector });
});

api.post("/connectors/:id/refresh", async (c) => c.json({ connector: (await connectors.refresh(c.get("user").id, c.req.param("id"))) ?? fail(404, "That connector does not exist.") }));
api.delete("/connectors/:id", async (c) => {
  const user = c.get("user");
  const con = connectors.list(user.id).find((k) => k.id === c.req.param("id"));
  await connectors.remove(user.id, c.req.param("id"));
  if (con) audit(user.id, "apps", `App removed: ${con.name}`);
  return c.json({ ok: true });
});

// OAuth sign-in: returns the app's page to open in a popup (or the connector when the sign-in could just be renewed).
// { needsClientId: true } when the app has no dynamic registration: the user then pastes a client ID (and secret).
api.post("/connectors/:id/oauth/start", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  try {
    return c.json(await connectors.startSignIn(user.id, c.req.param("id"), {
      clientId: typeof b.clientId === "string" ? b.clientId : undefined, clientSecret: typeof b.clientSecret === "string" ? b.clientSecret : undefined,
      botId: typeof b.botId === "string" && bots.owned(user.id, b.botId) ? b.botId : undefined, seq: Number.isInteger(b.seq) ? b.seq : undefined,
    }));
  } catch (err) {
    if (err instanceof NeedsClientIdError) return c.json({ needsClientId: true, redirectUri: oauthRedirectUri() });
    return fail(400, (err as Error).message);
  }
});
api.post("/connectors/:id/oauth/disconnect", async (c) => c.json({ connector: (await connectors.signOut(c.get("user").id, c.req.param("id"))) ?? fail(404, "That connector does not exist.") }));

// ── Built-in apps (Gmail, Google Calendar, Google Drive, Outlook, Slack) ─────
const vendorParam = (c: Context<Env>): NativeVendor => { const v = c.req.param("vendor") as NativeVendor; return VENDORS.includes(v) ? v : fail(404, "Unknown app vendor."); };
function vendorSetup(userId: string, locale: "fr" | "en", vendor: NativeVendor): NativeVendorSetup {
  const client = nativeClients.get(userId, vendor);
  return {
    vendor, name: VENDOR_NAMES[vendor], redirectUri: nativeRedirectUri(vendor), steps: setupSteps(vendor, locale), docs: setupDocs(vendor),
    configured: !!client, clientId: client?.clientId ?? null,
    ...(vendor === "microsoft" ? { tenant: client?.tenant ?? "common" } : {}),
    ...(vendor === "slack" ? { hasAppToken: !!client?.appToken } : {}),
  };
}
api.get("/native", (c) => {
  const user = c.get("user");
  return c.json({ apps: appsFor(user.locale), vendors: VENDORS.map((v) => vendorSetup(user.id, user.locale, v)), accounts: nativeAccounts.list(user.id).map(publicAccount) });
});
// The OAuth client the user created. The secret and the Slack app-level token are sealed and never sent back.
api.put("/native/clients/:vendor", async (c) => {
  const user = c.get("user");
  const vendor = vendorParam(c);
  const b = await body(c);
  try {
    nativeClients.set(user.id, vendor, { clientId: String(b.clientId ?? ""), clientSecret: typeof b.clientSecret === "string" ? b.clientSecret : undefined, tenant: typeof b.tenant === "string" ? b.tenant : undefined, appToken: b.appToken === null ? null : typeof b.appToken === "string" ? b.appToken : undefined });
  } catch (err) { return fail(400, (err as Error).message); }
  syncSlackSockets();
  return c.json({ vendor: vendorSetup(user.id, user.locale, vendor) });
});
api.delete("/native/clients/:vendor", (c) => {
  const user = c.get("user");
  nativeClients.remove(user.id, vendorParam(c));
  syncSlackSockets();
  return c.json({ ok: true });
});
// A new labelled account ("Gmail — pro"): returns the vendor's sign-in page to open in a popup.
api.post("/native/accounts", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const app = appOf(String(b.app ?? ""));
  if (!app) return fail(400, "Unknown app.");
  if (!nativeClients.get(user.id, app.vendor)) return fail(400, `Set up your ${VENDOR_NAMES[app.vendor]} OAuth client first.`);
  let acc;
  try { acc = nativeAccounts.create(user.id, app.id, String(b.label ?? "")); } catch (err) { return fail(400, (err as Error).message); }
  return c.json({ account: publicAccount(acc), authorizeUrl: nativeStart(user.id, acc.id) });
});
// Sign in again (never a dead end): a new sign-in for the same account keeps its label, routines and permissions.
api.post("/native/accounts/:id/signin", (c) => {
  const user = c.get("user");
  try { return c.json({ authorizeUrl: nativeStart(user.id, c.req.param("id")) }); } catch (err) { return fail(400, (err as Error).message); }
});
api.patch("/native/accounts/:id", async (c) => {
  const user = c.get("user");
  try { return c.json({ account: publicAccount(nativeAccounts.rename(user.id, c.req.param("id"), String((await body(c)).label ?? ""))) }); } catch (err) { return fail(400, (err as Error).message); }
});
// Disconnect: the vendor is asked to revoke the token where it can, then everything is forgotten here.
api.delete("/native/accounts/:id", async (c) => {
  const user = c.get("user");
  if (!(await nativeDisconnect(user.id, c.req.param("id")))) return fail(404, "That account does not exist.");
  syncSlackSockets();
  for (const b of bots.list(user.id)) emit(user.id, { type: "routines", botId: b.id });
  return c.json({ ok: true });
});

// A routine fed by a built-in app account (new email, new Slack message, upcoming event), set up from the routines screen.
api.post("/bots/:id/routines", async (c) => {
  const user = c.get("user");
  const bot = ownAgent(c);
  const b = await body(c);
  const kind = String(b.kind ?? "");
  if (!isNativeTrigger(kind)) return fail(400, "kind must be email, slack or calendar.");
  const acc = nativeAccounts.owned(user.id, String(b.accountId ?? ""));
  if (!acc) return fail(400, "Pick one of your connected accounts.");
  if (!appOf(acc.app)!.triggers.includes(kind)) return fail(400, `${acc.name} cannot be used for this kind of trigger.`);
  const prompt = String(b.prompt ?? "").trim();
  const name = String(b.name ?? "").trim();
  if (!name || !prompt) return fail(400, "A routine needs a name and an instruction.");
  const channel = String(b.channel ?? "").trim();
  if (kind === "slack" && !channel) return fail(400, "Choose a channel (#name or id), or @dm for direct messages.");
  const r = routines.create(bot.id, {
    name, prompt, trigger: kind,
    native: { accountId: acc.id, query: String(b.query ?? "").trim().slice(0, 300), channel: channel.slice(0, 100), mentionsOnly: !!b.mentionsOnly, leadMin: Math.min(1440, Math.max(1, Math.round(Number(b.leadMin) || 10))), everyMin: Math.min(1440, Math.max(2, Math.round(Number(b.everyMin) || 5))) },
  });
  schedule(r.id);
  syncSlackSockets();
  audit(user.id, "routine", `${bot.name}: routine created — ${r.name} (${publicRoutine(r, "en").describe})`, bot.id);
  rows.append(bot, { kind: "event", event: "routine", text: tr(user.locale, "Routine created: {name} — {when}", { name: r.name, when: publicRoutine(r, user.locale).describe }) });
  emit(user.id, { type: "routines", botId: bot.id });
  return c.json({ routine: publicRoutine(r, user.locale) });
});

api.get("/policies", (c) => c.json({ policies: policies.list(c.get("user").id) }));
api.delete("/policies/:tool", (c) => { policies.remove(c.get("user").id, decodeURIComponent(c.req.param("tool"))); return c.json({ ok: true }); });

// ── Rooms ────────────────────────────────────────────────────────────────────
api.post("/rooms", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const name = String(b.name ?? "").trim().slice(0, 60);
  const ids = validMembers(user.id, b.botIds);
  if (!name) fail(400, "Give the group a name.");
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  return c.json({ id: createRoom(user.id, name, ids).id });
});

const ownRoom = (c: Context<Env>) => { const b = ownBot(c); return b.kind === "room" ? b : fail(404, "That group does not exist."); };
api.get("/rooms/:id/members", (c) => { const room = ownRoom(c); return c.json({ members: room.memberIds.map((id) => bots.byId(id)).filter((b): b is BotRecord => !!b && b.userId === room.userId).map(publicBot) }); });

api.put("/rooms/:id/members", async (c) => {
  const room = ownRoom(c);
  const ids = validMembers(room.userId, (await body(c)).botIds);
  if (ids.length < 2) fail(400, "A group needs at least two bots.");
  const name = (id: string) => bots.byId(id)?.name ?? "a bot";
  const joined = ids.filter((id) => !room.memberIds.includes(id)).map(name);
  const left = room.memberIds.filter((id) => !ids.includes(id)).map(name);
  const loc = c.get("user").locale;
  bots.patch(room.id, { memberIds: ids, description: tr(loc, "Group chat with {n} bots.", { n: ids.length }) });
  if (joined.length || left.length)
    rows.append(room, { kind: "event", event: "members", text: [joined.length ? tr(loc, "{names} joined", { names: joined.join(", ") }) : "", left.length ? tr(loc, "{names} left", { names: left.join(", ") }) : ""].filter(Boolean).join(" · ") });
  emit(room.userId, { type: "roster" });
  return c.json({ ok: true });
});

// ── Check-ins and usage ──────────────────────────────────────────────────────
const publicCheckins = (userId: string): CheckinSettings => { const s = settings.checkins(userId); return { enabled: s.enabled, times: s.times, timezone: s.timezone }; };
api.get("/checkins", (c) => c.json(publicCheckins(c.get("user").id)));
api.put("/checkins", async (c) => {
  const user = c.get("user");
  const b = await body(c);
  const cur = settings.checkins(user.id);
  if (b.timezone !== undefined && !isValidTimezone(String(b.timezone))) fail(400, "Unknown timezone. Use a name like Europe/Paris.");
  const times = Array.isArray(b.times) ? b.times.filter((t: unknown) => typeof t === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(t)).slice(0, 6) : cur.times;
  settings.saveCheckins(user.id, { ...cur, enabled: b.enabled === undefined ? cur.enabled : !!b.enabled, times, timezone: b.timezone === undefined ? cur.timezone : String(b.timezone) });
  return c.json(publicCheckins(user.id));
});
api.post("/checkins/now", (c) => { fireCheckin(c.get("user").id, 0); return c.json({ ok: true }); });

api.get("/usage", (c) => c.json(usageSummary(c.get("user").id)));
api.put("/usage/budget", async (c) => {
  const v = (await body(c)).budgetUsd;
  if (v !== null && !(typeof v === "number" && v >= 0)) fail(400, "The budget must be a positive number, or empty for no limit.");
  settings.setBudget(c.get("user").id, v);
  emit(c.get("user").id, { type: "usage" });
  return c.json(usageSummary(c.get("user").id));
});
