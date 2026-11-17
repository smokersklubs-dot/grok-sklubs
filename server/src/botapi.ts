import { randomBytes } from "node:crypto";
import type { IncomingMessage } from "node:http";
import type { Context, Hono } from "hono";
import { config } from "./config.js";
import { q } from "./db.js";
import { subscribe } from "./bus.js";
import { clientAddress } from "./net.js";
import { RateWindow } from "./hardening.js";
import { audit, bots, clip, newId, now, paused, rows, sha256, users, type BotRecord, type UserRecord } from "./store.js";
import { pauses } from "./pauses.js";
import { capHolds } from "./usagecaps.js";
import { hostedMode, suspended } from "./hosted.js";
import { hostedHoldsBot, isBusy, submitApiMessage, type ApiAuthor } from "./agent/loop.js";
import { createGoal, goals } from "./agent/goals.js";
import { screen as screenSecrets } from "./pastedsecrets.js";
import { BOT_API_SCOPES, type BotApiKeyView, type BotApiKeysView, type BotApiScope, type Locale, type Row } from "./shared.js";

/**
 * "Accès API" — per-bot API keys, the REST API under /api/v1 and the limited MCP control server (botmcp.ts).
 * docs/API-BOT.md is the user's guide.
 *
 * A key belongs to ONE bot of ONE account and is made by its owner in the bot's settings. It is shown once
 * (`sk_bot_` + 32 random bytes, base64url); only its SHA-256 is stored, with its first characters for display. It carries
 * scopes: `read` (the bot's info and its conversation: messages and replies only), `write` (send it a message), `tasks`
 * (give it a goal). There is deliberately no scope for approvals, deletion, settings, the vault, connectors, other bots or
 * the account: no route of this file reaches them, and an approval is only ever answered by the owner in the app.
 *
 * What a program sends is never the owner's word (agent/loop.ts submitApiMessage, agent/authorize.ts): its message is
 * outside content (the turn starts careful), it never counts as the owner's quote, and every action that cannot be undone
 * waits for the owner's own yes, whatever the bot's trust level. It is unattended work for usage caps (no person watches
 * a program's call), and it respects "Pause", the caps and, in hosted mode, the plan (refused up front, with a code).
 *
 * The routes live on the main web port under /api/v1 (registered in routes.ts before the session check). They are never
 * served on the bots' own sockets (botlink.ts serves only /mcp/<bot> and /egress/<bot>).
 *
 * Ideas from OpenMausBot's Bot API (docs/bot-api.md: key shown once and kept hashed, a key per bot, the caller cannot
 * answer approvals) and its MCP server (scripts/mcp-server.ts: a deliberately small tool set, no approvals, deletion or
 * credentials), Apache-2.0 — ideas only, our own code.
 */

export const KEY_PREFIX = "sk_bot_";
/** How many characters of a key are kept and shown (the fixed start plus six random ones). */
const SHOWN = KEY_PREFIX.length + 6;
/** The most keys (not revoked) one bot may have. */
export const MAX_KEYS_PER_BOT = 10;
/** The longest message or objective a program may send (characters). */
export const MAX_TEXT = 20_000;
/** Long-polling: the default and the longest wait for a reply (seconds). */
export const WAIT_DEFAULT_S = 30;
export const WAIT_MAX_S = 120;
/** Waits one key may hold open at once. */
const MAX_WAITS_PER_KEY = 4;

/** Per client address (every call, a wrong key included), per key (every call) and per key for what starts a turn. */
export const apiLimits = {
  perAddress: new RateWindow(120, 60_000),
  perKey: new RateWindow(60, 60_000),
  writes: new RateWindow(10, 60_000),
};
const waiting = new Map<string, number>();

export interface ApiKeyRecord { id: string; userId: string; botId: string; name: string; prefix: string; scopes: BotApiScope[]; createdAt: number; lastUsedAt: number | null; revokedAt: number | null }

const toKey = (r: any): ApiKeyRecord => ({
  id: r.id, userId: r.user_id, botId: r.bot_id, name: r.name, prefix: r.prefix, scopes: cleanScopes(safeJson(r.scopes)),
  createdAt: r.created_at, lastUsedAt: r.last_used_at ?? null, revokedAt: r.revoked_at ?? null,
});
const safeJson = (s: string): unknown => { try { return JSON.parse(s); } catch { return []; } };
export const publicKey = (k: ApiKeyRecord): BotApiKeyView => ({ id: k.id, name: k.name, prefix: k.prefix, scopes: k.scopes, createdAt: k.createdAt, lastUsedAt: k.lastUsedAt, revokedAt: k.revokedAt });

/** The known scopes in `raw`, each once, in their usual order. */
export function cleanScopes(raw: unknown): BotApiScope[] {
  const list = Array.isArray(raw) ? raw : [];
  return BOT_API_SCOPES.filter((s) => list.includes(s));
}

/** A refusal of the Bot API: its HTTP status, a stable code for programs and a sentence for people. */
export class BotApiError extends Error {
  constructor(public status: 400 | 401 | 403 | 404 | 409 | 413 | 429, public code: string, message: string, public extra: Record<string, unknown> = {}) { super(message); this.name = "BotApiError"; }
}
const say = (loc: Locale | undefined, en: string, fr: string) => (loc === "fr" ? fr : en);

export const apiKeys = {
  list: (botId: string): ApiKeyRecord[] => q.all("SELECT * FROM bot_api_keys WHERE bot_id = ? ORDER BY revoked_at IS NOT NULL, created_at DESC", botId).map(toKey),
  activeCount: (botId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM bot_api_keys WHERE bot_id = ? AND revoked_at IS NULL", botId)!.n,
  byId: (id: string): ApiKeyRecord | null => { const r = q.get("SELECT * FROM bot_api_keys WHERE id = ?", id); return r ? toKey(r) : null; },
  /** A new key for the owner's bot. Returns the key itself, which is never stored nor shown again. */
  create(user: UserRecord, bot: BotRecord, rawName: unknown, rawScopes: unknown): { key: ApiKeyRecord; secret: string } {
    const loc = user.locale;
    if (bot.kind !== "agent" || bot.parentId || bot.userId !== user.id) throw new BotApiError(400, "not_a_bot", say(loc, "Only one of your own bots can have API keys.", "Seul un de tes propres bots peut avoir des clés API."));
    const name = String(rawName ?? "").replace(/\s+/g, " ").trim();
    if (!name) throw new BotApiError(400, "name", say(loc, "Give the key a name (the program that will use it).", "Donne un nom à la clé (le programme qui va s'en servir)."));
    if (name.length > 60) throw new BotApiError(400, "name", say(loc, "That name is too long (60 characters at most).", "Ce nom est trop long (60 caractères au plus)."));
    const scopes = cleanScopes(rawScopes);
    if (!scopes.length) throw new BotApiError(400, "scopes", say(loc, "Choose at least one permission: read, write or tasks.", "Choisis au moins une permission : lire, écrire ou tâches."));
    const secret = KEY_PREFIX + randomBytes(32).toString("base64url");
    const id = newId("bak");
    const t = now();
    q.tx(() => {
      if (apiKeys.activeCount(bot.id) >= MAX_KEYS_PER_BOT) throw new BotApiError(409, "too_many_keys", say(loc, `This bot already has ${MAX_KEYS_PER_BOT} keys. Revoke one to create another.`, `Ce bot a déjà ${MAX_KEYS_PER_BOT} clés. Révoque-en une pour en créer une autre.`));
      q.run("INSERT INTO bot_api_keys (id, user_id, bot_id, name, prefix, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)", id, user.id, bot.id, name, secret.slice(0, SHOWN), sha256(secret), JSON.stringify(scopes), t);
    });
    audit(user.id, "channel", `${bot.name}: API key "${name}" created (${scopes.join(", ")}; ${secret.slice(0, SHOWN)}…)`, bot.id);
    return { key: apiKeys.byId(id)!, secret };
  },
  /** Revokes one of the owner's keys of this bot; false when there is no such key (or it was already revoked). */
  revoke(user: UserRecord, bot: BotRecord, keyId: string): boolean {
    const k = apiKeys.byId(keyId);
    if (!k || k.botId !== bot.id || k.userId !== user.id || k.revokedAt) return false;
    q.run("UPDATE bot_api_keys SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", now(), keyId);
    audit(user.id, "channel", `${bot.name}: API key "${k.name}" revoked (${k.prefix}…)`, bot.id);
    return true;
  },
  /** The live key a caller presents, or null (unknown, revoked, its bot or account gone, or no longer theirs). */
  verify(secret: string): { key: ApiKeyRecord; bot: BotRecord; user: UserRecord } | null {
    if (!secret.startsWith(KEY_PREFIX) || secret.length < SHOWN + 10 || secret.length > 200) return null;
    const r = q.get("SELECT * FROM bot_api_keys WHERE key_hash = ?", sha256(secret));
    if (!r) return null;
    const key = toKey(r);
    if (key.revokedAt) return null;
    const bot = bots.owned(key.userId, key.botId);
    const user = users.byId(key.userId);
    if (!bot || !user || bot.kind !== "agent") return null;
    return { key, bot, user };
  },
  /** Notes a call (at most one write a minute per key). */
  touch(key: ApiKeyRecord) {
    const t = now();
    if (!key.lastUsedAt || t - key.lastUsedAt > 60_000) q.run("UPDATE bot_api_keys SET last_used_at = ? WHERE id = ?", t, key.id);
  },
};

/** The bot's API settings as its owner sees them. */
export function keysView(botId: string): BotApiKeysView {
  return { keys: apiKeys.list(botId).map(publicKey), max: MAX_KEYS_PER_BOT, baseUrl: `${config.publicUrl}/api/v1`, mcpUrl: `${config.publicUrl}/api/v1/mcp` };
}

// ── The caller ───────────────────────────────────────────────────────────────
/** Who calls: the key, its bot (re-read at each call) and the bot's owner. */
export interface Caller { key: ApiKeyRecord; bot: BotRecord; user: UserRecord }
const author = (c: Caller): ApiAuthor => ({ keyId: c.key.id, name: c.key.name });

/**
 * Checks the Authorization header and the rate limits. `address`: the client's address (for wrong keys too).
 * Throws BotApiError; on success the key's last use is noted.
 */
export function authenticate(header: string | undefined | null, address: string, locale?: Locale): Caller {
  if (apiLimits.perAddress.over(address)) throw new BotApiError(429, "rate_limited", say(locale, "Too many requests. Wait a minute and try again.", "Trop de requêtes. Attends une minute et réessaie."));
  const m = /^Bearer\s+(\S+)\s*$/i.exec(header ?? "");
  const found = m ? apiKeys.verify(m[1]) : null;
  if (!found) throw new BotApiError(401, "unauthorized", say(locale, "Missing, wrong or revoked API key (Authorization: Bearer sk_bot_…).", "Clé API absente, fausse ou révoquée (Authorization: Bearer sk_bot_…)."));
  if (apiLimits.perKey.over(found.key.id)) throw new BotApiError(429, "rate_limited", say(found.user.locale, "Too many requests for this key. Wait a minute and try again.", "Trop de requêtes pour cette clé. Attends une minute et réessaie."));
  apiKeys.touch(found.key);
  return found;
}

export function requireScope(c: Caller, scope: BotApiScope) {
  if (!c.key.scopes.includes(scope)) {
    const names = { read: say(c.user.locale, "read", "lire"), write: say(c.user.locale, "write", "écrire"), tasks: say(c.user.locale, "tasks", "tâches") };
    throw new BotApiError(403, "scope", say(c.user.locale, `This key does not have the "${names[scope]}" permission.`, `Cette clé n'a pas la permission « ${names[scope]} ».`), { scope });
  }
}

/**
 * Whether new work may be given to the bot now: not paused, not stopped by a usage cap (API work is unattended), account
 * not suspended, plan allows it (hosted mode). Refused up front, so the program knows at once and nothing piles up.
 */
function assertCanWork(c: Caller) {
  const loc = c.user.locale;
  if (hostedMode() && suspended(c.user.id)) throw new BotApiError(403, "suspended", say(loc, "The account is suspended: it is read-only.", "Le compte est suspendu : il est en lecture seule."));
  if (pauses.of(c.bot)) throw new BotApiError(409, "paused", say(loc, `${c.bot.name} is paused by its owner. Try again once it is resumed.`, `${c.bot.name} est en pause (mis par son propriétaire). Réessaie à la reprise.`));
  const why = hostedHoldsBot(c.bot);
  if (why) throw new BotApiError(403, "plan", say(loc, "The account's plan does not let this bot work right now (budget used up, or a model the plan does not allow).", "L'offre du compte ne permet pas à ce bot de travailler pour l'instant (budget épuisé, ou modèle non permis par l'offre)."), { reason: why });
  const cap = capHolds(c.bot);
  if (cap) throw new BotApiError(429, "usage_cap", say(loc, "A usage cap the owner set is reached: work no person started (the API included) waits until it resets.", "Un plafond d'usage fixé par le propriétaire est atteint : le travail lancé par personne (l'API comprise) attend sa remise à zéro."), { resetAt: cap.resetAt });
  if (apiLimits.writes.over(c.key.id)) throw new BotApiError(429, "rate_limited", say(loc, "Too many messages for this key (10 a minute). Wait a minute and try again.", "Trop de messages pour cette clé (10 par minute). Attends une minute et réessaie."));
}

/** The message of the main chat a thread hangs on (0: the main chat). */
function threadOf(c: Caller, raw: unknown): number {
  if (raw === undefined || raw === null || raw === "" || raw === 0) return 0;
  const seq = Number(raw);
  const parent = Number.isInteger(seq) && seq > 0 ? rows.get(c.bot.id, c.bot.generation, seq) : null;
  if (!parent || parent.thread || parent.body.kind !== "message") throw new BotApiError(400, "thread", say(c.user.locale, "That message cannot have a thread.", "Ce message ne peut pas avoir de fil."));
  return seq;
}

function cleanText(c: Caller, raw: unknown, what: "text" | "objective"): string {
  if (typeof raw !== "string" || !raw.trim()) throw new BotApiError(400, what, say(c.user.locale, `Send a non-empty "${what}".`, `Envoie un « ${what} » non vide.`));
  if (raw.length > MAX_TEXT) throw new BotApiError(413, "too_long", say(c.user.locale, `"${what}" is too long (${MAX_TEXT} characters at most).`, `« ${what} » est trop long (${MAX_TEXT} caractères au plus).`));
  // A secret pasted by a program is masked before anything is stored or sent to a model (pastedsecrets.ts).
  return screenSecrets(raw.trim(), c.user.locale).text;
}

// ── What a key can do ────────────────────────────────────────────────────────
export function botInfo(c: Caller) {
  const p = pauses.of(c.bot);
  return {
    bot: { id: c.bot.id, name: c.bot.name, label: c.bot.label, description: c.bot.description, paused: !!p, busy: isBusy(c.bot.id), waitingForOwner: !!paused.get(c.bot.id) },
    key: { id: c.key.id, name: c.key.name, scopes: c.key.scopes },
  };
}

/** A message as a program reads it: the words only. Tool steps, cards (and whatever they hold), notices are left out. */
export interface ApiMessage { seq: number; thread: number; role: "user" | "assistant"; from: "owner" | "bot" | "api" | "member" | "voice" | "other"; name: string; text: string; at: number }
function apiMessage(c: Caller, r: Row): ApiMessage | null {
  if (r.body.kind !== "message" || r.body.streaming) return null;
  const o = r.body.origin;
  const from: ApiMessage["from"] = r.body.role === "assistant" ? "bot" : !o ? "owner" : o.kind === "api" || o.kind === "member" || o.kind === "voice" ? o.kind : "other";
  const name = r.body.role === "assistant" ? (o?.kind === "bot" ? o.name : c.bot.name) : o ? (o.kind === "voice" ? c.user.name : o.name) : c.user.name;
  const files = r.body.attachments?.length ? `\n[${r.body.attachments.map((a) => a.name).join(", ")}]` : "";
  return { seq: r.seq, thread: r.thread ?? 0, role: r.body.role, from, name, text: r.body.text + files, at: r.createdAt };
}
const rowOf = (r: any): Row => ({ botId: r.bot_id, generation: r.generation, seq: r.seq, rev: r.rev, createdAt: r.created_at, body: JSON.parse(r.body), ...(r.thread ? { thread: r.thread } : {}) });

/**
 * The conversation's messages after `after` (a seq), oldest first, in the main chat or one thread. A reply still being
 * written ends the page (it comes in a later call, complete), so a program that reads on from `next` misses nothing.
 */
export function readMessages(c: Caller, o: { after?: unknown; thread?: unknown; limit?: unknown }) {
  requireScope(c, "read");
  const after = Math.max(0, Math.floor(Number(o.after) || 0));
  const thread = o.thread === undefined || o.thread === null || o.thread === "" ? 0 : Math.max(0, Math.floor(Number(o.thread) || 0));
  const limit = Math.min(200, Math.max(1, Math.floor(Number(o.limit) || 50)));
  const found = q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'message' AND seq > ? ORDER BY seq LIMIT ?", c.bot.id, c.bot.generation, thread, after, limit + 1).map(rowOf);
  const messages: ApiMessage[] = [];
  let partial = false;
  for (const r of found.slice(0, limit)) {
    if (r.body.kind === "message" && r.body.streaming) { partial = true; break; }
    const m = apiMessage(c, r);
    if (m) messages.push(m);
  }
  return { thread, messages, next: messages.length ? messages[messages.length - 1].seq : after, more: partial || found.length > limit };
}

/** Sends the bot a message, as an outside program (agent/loop.ts submitApiMessage). */
export function sendMessage(c: Caller, o: { text?: unknown; thread?: unknown }) {
  requireScope(c, "write");
  const text = cleanText(c, o.text, "text");
  const thread = threadOf(c, o.thread);
  assertCanWork(c);
  const row = rows.append(c.bot, { kind: "message", role: "user", text, origin: { kind: "api", id: c.key.id, name: c.key.name } }, thread);
  bots.bumpUnread(c.bot.id);
  submitApiMessage(c.bot, text, author(c), thread);
  return { seq: row.seq, thread, status: "queued" as const };
}

/** Gives the bot a goal (goal mode, agent/goals.ts): it works on it across rounds; the owner sees its card and can stop it. */
export function createTask(c: Caller, o: { objective?: unknown; thread?: unknown; maxRounds?: unknown }) {
  requireScope(c, "tasks");
  const objective = cleanText(c, o.objective, "objective");
  const thread = threadOf(c, o.thread);
  assertCanWork(c);
  const row = rows.append(c.bot, { kind: "message", role: "user", text: objective, origin: { kind: "api", id: c.key.id, name: c.key.name } }, thread);
  // Tainted: its later rounds stay careful; origin "api": they stay the program's work (authorize.ts, usage caps).
  const g = createGoal(c.bot, { objective, thread, origin: "api", maxRounds: Number(o.maxRounds) || undefined, tainted: true });
  audit(c.user.id, "channel", `${c.bot.name}: goal set through the API key "${c.key.name}" — ${clip(objective, 120)}`, c.bot.id);
  submitApiMessage(c.bot, objective, author(c), thread, g.id);
  return { seq: row.seq, thread, task: taskView(goals.byId(g.id)!) };
}

const taskView = (g: NonNullable<ReturnType<typeof goals.byId>>) => ({ id: g.id, objective: g.objective, status: g.status, rounds: g.rounds, maxRounds: g.maxRounds, summary: g.summary, reason: g.reason, thread: g.thread });

export function readTask(c: Caller, id: string) {
  requireScope(c, "tasks");
  const g = goals.byId(id);
  if (!g || g.botId !== c.bot.id || g.origin !== "api") throw new BotApiError(404, "not_found", say(c.user.locale, "No such task.", "Tâche inconnue."));
  return { task: taskView(g) };
}

export type ReplyStatus = "working" | "done" | "no_reply" | "needs_approval" | "paused";
/**
 * Where the answer to message `seq` stands: the bot's messages after it in the same conversation, up to the next message
 * that is not the bot's; "working" while the bot still has work queued or a reply is being written, "needs_approval"
 * while it waits for its owner (nobody outside can answer that), "paused" when its owner paused it.
 */
export function replyState(c: Caller, seq: number): { status: ReplyStatus; seq: number; thread: number; replies: ApiMessage[]; reply: string } {
  const bot = bots.byId(c.bot.id) ?? c.bot;
  const row = Number.isInteger(seq) && seq > 0 ? rows.get(bot.id, bot.generation, seq) : null;
  if (!row || row.body.kind !== "message" || row.body.role !== "user") throw new BotApiError(404, "not_found", say(c.user.locale, "No such message.", "Message inconnu."));
  const thread = row.thread ?? 0;
  const later = q.all("SELECT * FROM rows WHERE bot_id = ? AND generation = ? AND thread = ? AND kind = 'message' AND seq > ? ORDER BY seq LIMIT 50", bot.id, bot.generation, thread, seq).map(rowOf);
  const replies: ApiMessage[] = [];
  let writing = false;
  for (const r of later) {
    if (r.body.kind !== "message") continue;
    if (r.body.role === "user") break;
    if (r.body.streaming) { writing = true; break; }
    const m = apiMessage(c, r);
    if (m) replies.push(m);
  }
  const status: ReplyStatus = paused.get(bot.id) ? "needs_approval" : pauses.of(bot) ? "paused" : writing || isBusy(bot.id) ? "working" : replies.length ? "done" : "no_reply";
  return { status, seq, thread, replies, reply: replies.map((r) => r.text).join("\n\n") };
}

/** Long-polling: waits (at most `timeoutS` seconds) until the answer to `seq` is no longer "working". */
export async function waitReply(c: Caller, seq: number, timeoutS: unknown, signal?: AbortSignal, maxS = WAIT_MAX_S) {
  requireScope(c, "read");
  const limit = Math.min(maxS, Math.max(0, Number(timeoutS ?? WAIT_DEFAULT_S) || 0));
  let state = replyState(c, seq);
  if (state.status !== "working" || limit === 0) return state;
  const held = waiting.get(c.key.id) ?? 0;
  if (held >= MAX_WAITS_PER_KEY) throw new BotApiError(429, "too_many_waits", say(c.user.locale, `This key already waits for ${MAX_WAITS_PER_KEY} replies. Wait for one to come back first.`, `Cette clé attend déjà ${MAX_WAITS_PER_KEY} réponses. Attends que l'une revienne d'abord.`));
  waiting.set(c.key.id, held + 1);
  try {
    const until = Date.now() + limit * 1000;
    while (state.status === "working" && Date.now() < until && !signal?.aborted) {
      // Woken by the bot's activity (its rows, its state), else at least every second.
      await new Promise<void>((resolve) => {
        let off = () => {};
        const done = () => { clearTimeout(timer); off(); signal?.removeEventListener("abort", done); resolve(); };
        const timer = setTimeout(done, Math.min(1000, Math.max(0, until - Date.now())));
        off = subscribe(c.user.id, (e) => { if ("botId" in e && e.botId === c.bot.id) done(); });
        signal?.addEventListener("abort", done, { once: true });
      });
      // A small pause so the reply's last rows are written before it is read.
      await new Promise((r) => setTimeout(r, 50));
      state = replyState(c, seq);
    }
    return state;
  } finally {
    const n = (waiting.get(c.key.id) ?? 1) - 1;
    if (n <= 0) waiting.delete(c.key.id); else waiting.set(c.key.id, n);
  }
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
export function apiClientIp(c: Context): string {
  const env = c.env as { incoming?: IncomingMessage } | undefined;
  return clientAddress(config.trustProxy, env?.incoming?.socket?.remoteAddress, c.req.header("x-forwarded-for"));
}
const callerOf = (c: Context): Caller => authenticate(c.req.header("authorization"), apiClientIp(c), c.req.header("accept-language")?.toLowerCase().startsWith("fr") ? "fr" : "en");

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  const raw = await c.req.text();
  if (raw.length > 256 * 1024) throw new BotApiError(413, "too_large", "Request too large.");
  if (!raw.trim()) return {};
  let parsed: unknown;
  try { parsed = JSON.parse(raw); } catch { throw new BotApiError(400, "bad_json", "The body is not valid JSON."); }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new BotApiError(400, "bad_json", "The body must be a JSON object.");
  return parsed as Record<string, unknown>;
}

/** Runs a Bot API handler: refusals become `{error, code}` with their status; nothing is cached. */
const handle = (fn: (c: Context) => Promise<Response> | Response) => async (c: Context) => {
  c.header("cache-control", "no-store");
  try { return await fn(c); } catch (err) {
    if (err instanceof BotApiError) {
      if (err.status === 429) c.header("retry-after", "60");
      if (err.status === 401) c.header("www-authenticate", 'Bearer realm="sklubot"');
      return c.json({ error: err.message, code: err.code, ...err.extra }, err.status);
    }
    throw err;
  }
};

/**
 * The REST API and the MCP endpoint (Bearer key, no session). Registered on the /api app before its session check, like
 * the webhooks: a request here never needs (nor uses) a session cookie.
 */
export function registerBotApi(api: Hono<any>, mcp: (c: Context, caller: Caller) => Promise<Response>) {
  api.get("/v1/bot", handle((c) => c.json(botInfo(callerOf(c)))));
  api.get("/v1/bot/messages", handle((c) => c.json(readMessages(callerOf(c), { after: c.req.query("after"), thread: c.req.query("thread"), limit: c.req.query("limit") }))));
  api.post("/v1/bot/messages", handle(async (c) => {
    const caller = callerOf(c);
    const out = sendMessage(caller, await jsonBody(c));
    return c.json({ ...out, wait: `/api/v1/bot/messages/${out.seq}/wait` }, 202);
  }));
  api.get("/v1/bot/messages/:seq/wait", handle(async (c) => c.json(await waitReply(callerOf(c), Number(c.req.param("seq")), c.req.query("timeout"), c.req.raw.signal))));
  api.post("/v1/bot/tasks", handle(async (c) => { const caller = callerOf(c); return c.json(createTask(caller, await jsonBody(c)), 202); }));
  api.get("/v1/bot/tasks/:taskId", handle((c) => c.json(readTask(callerOf(c), c.req.param("taskId") ?? ""))));
  // The MCP control server (botmcp.ts): Streamable HTTP, stateless, POST only (no server-initiated stream to offer).
  api.post("/v1/mcp", handle(async (c) => mcp(c, callerOf(c))));
  api.on(["GET", "DELETE"], "/v1/mcp", handle((c) => { callerOf(c); return c.json({ error: "Method not allowed.", code: "method" }, 405, { allow: "POST" }); }));
}

/** The owner's routes (session): list, create (the key is in that one answer), revoke. */
export function registerBotApiOwner(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  api.get("/bots/:id/api-keys", (c) => c.json(keysView(ownAgent(c).id)));
  api.post("/bots/:id/api-keys", handle(async (c) => {
    const bot = ownAgent(c);
    const user = c.get("user") as UserRecord;
    const b = await c.req.json().catch(() => ({})) as Record<string, unknown>;
    const { key, secret } = apiKeys.create(user, bot, b.name, b.scopes);
    return c.json({ key: publicKey(key), secret, ...keysView(bot.id) });
  }));
  api.delete("/bots/:id/api-keys/:keyId", handle((c) => {
    const bot = ownAgent(c);
    if (!apiKeys.revoke(c.get("user") as UserRecord, bot, c.req.param("keyId") ?? "")) throw new BotApiError(404, "not_found", say((c.get("user") as UserRecord).locale, "No such key.", "Clé inconnue."));
    return c.json(keysView(bot.id));
  }));
}
