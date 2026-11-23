import { createHmac, randomBytes } from "node:crypto";
import { subscribe } from "./bus.js";
import { sealValue, unsealValue } from "./datakey.js";
import { q } from "./db.js";
import { newSecret } from "./hooktrust.js";
import { assertPublicUrl, fetchProblem, guardedFetch } from "./net.js";
import type { Row, ServerEvent } from "./shared.js";
import { maskSecrets } from "./shared.js";
import { audit, bots, clip, newId, now, type BotRecord } from "./store.js";

/**
 * L170 — outgoing webhooks: Sklubot calls an address of the owner's when something happens to one of their bots, so other
 * tools (n8n, Zapier, a script) can react without asking every minute. Set per bot in its settings → Accès API.
 *
 * Events: `message.created` (the bot finished a reply: its text), `task.finished` (a goal ended: complete, blocked, limit,
 * stopped or declined, with its summary), `approval.pending` (the bot waits for its owner: the card's title only, never its
 * detail; the answer is only ever given in the app). Body: `{ type, id, timestamp, bot: { id, name }, data }`.
 *
 * Signed like the incoming webhooks (hooktrust.ts), with the Standard Webhooks headers
 * (https://github.com/standard-webhooks/standard-webhooks/blob/main/spec/standard-webhooks.md): `webhook-id`,
 * `webhook-timestamp` (unix seconds), `webhook-signature: v1,<base64 HMAC-SHA256 of "id.timestamp.body">` with the key =
 * the base64 part after "whsec_" of the secret shown once at creation. Verify with any Standard Webhooks library.
 *
 * Delivery: POST through the outbound guard (net.ts: never this server's own network), 10 s timeout, redirects not
 * followed. A 2xx answer delivers; anything else is tried again after 10 s, 1 min, 5 min, 30 min, 2 h, 6 h (then "failed").
 * The same event is never queued twice (unique per webhook and event key). The delivery log keeps the last 100 per
 * webhook (status, tries, HTTP answer — never the secret). Texts go through the secret mask before leaving.
 */
q.run(`CREATE TABLE IF NOT EXISTS bot_webhooks (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  url TEXT NOT NULL, secret_enc TEXT NOT NULL, events TEXT NOT NULL DEFAULT '[]', active INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)`);
q.run(`CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id TEXT PRIMARY KEY, webhook_id TEXT NOT NULL REFERENCES bot_webhooks(id) ON DELETE CASCADE, event TEXT NOT NULL, event_key TEXT NOT NULL,
  payload TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempts INTEGER NOT NULL DEFAULT 0, next_at INTEGER NOT NULL,
  last_status INTEGER, last_error TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, delivered_at INTEGER,
  UNIQUE (webhook_id, event_key))`);
q.run("CREATE INDEX IF NOT EXISTS webhook_deliveries_due ON webhook_deliveries (status, next_at)");

export const WEBHOOK_EVENTS = ["message.created", "task.finished", "approval.pending"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export const MAX_WEBHOOKS_PER_BOT = 5;
/** Waits before each new try (ms): 10 s, 1 min, 5 min, 30 min, 2 h, 6 h. */
export const BACKOFF_MS = [10_000, 60_000, 300_000, 1_800_000, 7_200_000, 21_600_000];
const KEEP = 100;
const FINISHED = new Set(["complete", "blocked", "limit", "stopped", "declined"]);

export interface WebhookView { id: string; url: string; events: WebhookEvent[]; active: boolean; createdAt: number; deliveries: DeliveryView[] }
export interface DeliveryView { id: string; event: string; status: "pending" | "done" | "failed"; attempts: number; lastStatus: number | null; lastError: string; createdAt: number; deliveredAt: number | null }
export class WebhookError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

const cleanEvents = (raw: unknown): WebhookEvent[] => { const l = Array.isArray(raw) ? raw : []; return WEBHOOK_EVENTS.filter((e) => l.includes(e)); };
const parse = (s: string): unknown => { try { return JSON.parse(s); } catch { return []; } };
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

interface HookRow { id: string; user_id: string; bot_id: string; url: string; secret_enc: string; events: string; active: number; created_at: number }
const deliveriesOf = (id: string): DeliveryView[] => q.all<any>("SELECT * FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC, rowid DESC LIMIT 20", id)
  .map((d) => ({ id: d.id, event: d.event, status: d.status, attempts: d.attempts, lastStatus: d.last_status ?? null, lastError: d.last_error, createdAt: d.created_at, deliveredAt: d.delivered_at ?? null }));
const view = (r: HookRow): WebhookView => ({ id: r.id, url: r.url, events: cleanEvents(parse(r.events)), active: !!r.active, createdAt: r.created_at, deliveries: deliveriesOf(r.id) });

export const outWebhooks = {
  list: (botId: string): WebhookView[] => q.all<HookRow>("SELECT * FROM bot_webhooks WHERE bot_id = ? ORDER BY created_at", botId).map(view),
  async create(bot: BotRecord, rawUrl: unknown, rawEvents: unknown): Promise<{ webhook: WebhookView; secret: string }> {
    let u: URL;
    try { u = new URL(String(rawUrl ?? "").trim()); } catch { throw new WebhookError(400, "Give the full address (https://…)."); }
    if (!(u.protocol === "https:" || (allowHttp() && u.protocol === "http:")) || u.username || u.password) throw new WebhookError(400, "Give the full address (https://…).");
    try { await assertPublicUrl(u.toString()); } catch { throw new WebhookError(400, "That address is on a private or local network, which this server does not reach."); }
    const events = cleanEvents(rawEvents);
    if (!events.length) throw new WebhookError(400, "Choose at least one event.");
    if (outWebhooks.list(bot.id).length >= MAX_WEBHOOKS_PER_BOT) throw new WebhookError(409, `This bot already has ${MAX_WEBHOOKS_PER_BOT} webhooks.`);
    const secret = newSecret();
    const id = newId("owh");
    q.run("INSERT INTO bot_webhooks (id, user_id, bot_id, url, secret_enc, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)", id, bot.userId, bot.id, u.toString(), sealValue(secret), JSON.stringify(events), now());
    audit(bot.userId, "channel", `${bot.name}: outgoing webhook to ${u.host} (${events.join(", ")})`, bot.id);
    listenTo(bot.userId);
    return { webhook: view(q.get<HookRow>("SELECT * FROM bot_webhooks WHERE id = ?", id)!), secret };
  },
  setActive: (bot: BotRecord, id: string, on: boolean) => q.run("UPDATE bot_webhooks SET active = ? WHERE id = ? AND bot_id = ?", on ? 1 : 0, id, bot.id).changes > 0,
  remove(bot: BotRecord, id: string): boolean {
    const ok = q.run("DELETE FROM bot_webhooks WHERE id = ? AND bot_id = ?", id, bot.id).changes > 0;
    if (ok) audit(bot.userId, "channel", `${bot.name}: outgoing webhook removed`, bot.id);
    return ok;
  },
  /** Queues a test event (« Envoyer un essai »), delivered by the worker like any other. */
  test(bot: BotRecord, id: string): boolean {
    const r = q.get<HookRow>("SELECT * FROM bot_webhooks WHERE id = ? AND bot_id = ?", id, bot.id);
    if (!r) return false;
    queue(r, "message.created", `test:${randomBytes(6).toString("hex")}`, bot, { test: true, text: "Test from Sklubot" });
    return true;
  },
};

/** The Standard Webhooks headers for a body. */
export function signDelivery(secret: string, id: string, timestamp: number, body: string): Record<string, string> {
  const key = Buffer.from(secret.startsWith("whsec_") ? secret.slice(6) : secret, secret.startsWith("whsec_") ? "base64" : "utf8");
  const sig = createHmac("sha256", key).update(`${id}.${timestamp}.${body}`).digest("base64");
  return { "webhook-id": id, "webhook-timestamp": String(timestamp), "webhook-signature": `v1,${sig}` };
}

function queue(r: HookRow, event: WebhookEvent, key: string, bot: Pick<BotRecord, "id" | "name">, data: Record<string, unknown>) {
  const id = newId("msg");
  const payload = JSON.stringify({ type: event, id, timestamp: new Date().toISOString(), bot: { id: bot.id, name: bot.name }, data });
  const t = now();
  q.run("INSERT OR IGNORE INTO webhook_deliveries (id, webhook_id, event, event_key, payload, next_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, r.id, event, key, payload, t, t);
  q.run("DELETE FROM webhook_deliveries WHERE webhook_id = ? AND id NOT IN (SELECT id FROM webhook_deliveries WHERE webhook_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?)", r.id, r.id, KEEP);
  kick();
}

/** L173 (automations.ts): an owner's trigger sends one internal event to one of the bot's own active webhooks, signed like the others. */
export function queueAutomationEvent(bot: Pick<BotRecord, "id" | "name" | "userId">, webhookId: string, key: string, data: Record<string, unknown>): boolean {
  const r = q.get<HookRow>("SELECT * FROM bot_webhooks WHERE id = ? AND bot_id = ? AND user_id = ? AND active = 1", webhookId, bot.id, bot.userId);
  if (!r) return false;
  queue(r, "automation.event" as WebhookEvent, key, bot, data);
  return true;
}

/** What events a batch of rows of one bot holds (exported for the tests). */
export function eventsOf(rows: Row[]): { event: WebhookEvent; key: string; data: Record<string, unknown> }[] {
  const out: { event: WebhookEvent; key: string; data: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const b = r.body;
    if (b.kind === "message" && b.role === "assistant" && !b.streaming && b.text.trim()) out.push({ event: "message.created", key: `m:${r.generation}:${r.seq}`, data: { seq: r.seq, thread: r.thread ?? 0, text: maskSecrets(b.text, "[secret]").text } });
    if (b.kind === "card" && b.card.type === "approval" && b.card.status === "pending") out.push({ event: "approval.pending", key: `a:${b.card.approvalId}`, data: { approvalId: b.card.approvalId, title: maskSecrets(b.card.title, "[secret]").text } });
    if (b.kind === "card" && b.card.type === "goal" && FINISHED.has(b.card.status)) out.push({ event: "task.finished", key: `g:${b.card.goalId}:${b.card.status}`, data: { taskId: b.card.goalId, status: b.card.status, objective: clip(b.card.objective, 500), summary: maskSecrets(b.card.summary ?? "", "[secret]").text } });
  }
  return out;
}

function onEvent(e: ServerEvent) {
  if (e.type !== "rows") return;
  const hooks = q.all<HookRow>("SELECT * FROM bot_webhooks WHERE bot_id = ? AND active = 1", e.botId);
  if (!hooks.length) return;
  const found = eventsOf(e.rows);
  if (!found.length) return;
  const bot = bots.byId(e.botId);
  if (!bot) return;
  for (const h of hooks) { if (h.user_id !== bot.userId) continue; const wanted = cleanEvents(parse(h.events)); for (const f of found) if (wanted.includes(f.event)) queue(h, f.event, f.key, bot, f.data); }
}

const listening = new Map<string, () => void>();
function listenTo(userId: string) { if (!listening.has(userId)) listening.set(userId, subscribe(userId, onEvent)); }
/** At start-up: listen for every account that has a webhook. */
export function startOutWebhooks() {
  for (const r of q.all<{ user_id: string }>("SELECT DISTINCT user_id FROM bot_webhooks")) listenTo(r.user_id);
  kick();
}

/** One delivery try (exported for the tests). */
export async function deliverOne(d: { id: string; webhook_id: string; payload: string; attempts: number }): Promise<"done" | "pending" | "failed"> {
  const h = q.get<HookRow>("SELECT * FROM bot_webhooks WHERE id = ?", d.webhook_id);
  const secret = h ? unsealValue(h.secret_enc) : null;
  let status: number | null = null, error = "";
  if (!h || !secret) error = "webhook or secret gone";
  else {
    const ts = Math.floor(Date.now() / 1000);
    try {
      const res = await guardedFetch(h.url, { method: "POST", redirect: "manual", headers: { "content-type": "application/json", "user-agent": "Sklubot-Webhooks/1", ...signDelivery(secret, d.id, ts, d.payload) }, body: d.payload, signal: AbortSignal.timeout(10_000) });
      status = res.status;
      await res.body?.cancel().catch(() => {});
      if (res.ok) { q.run("UPDATE webhook_deliveries SET status = 'done', attempts = attempts + 1, last_status = ?, last_error = '', delivered_at = ? WHERE id = ?", status, now(), d.id); return "done"; }
      error = `HTTP ${status}`;
    } catch (err) { error = fetchProblem(err) ?? clip(String((err as Error)?.message ?? err), 120); }
  }
  const attempts = d.attempts + 1;
  const wait = h ? BACKOFF_MS[attempts - 1] : undefined;
  if (wait === undefined) { q.run("UPDATE webhook_deliveries SET status = 'failed', attempts = ?, last_status = ?, last_error = ? WHERE id = ?", attempts, status, error, d.id); return "failed"; }
  q.run("UPDATE webhook_deliveries SET attempts = ?, last_status = ?, last_error = ?, next_at = ? WHERE id = ?", attempts, status, error, now() + wait, d.id);
  return "pending";
}

let running = false;
let timer: NodeJS.Timeout | null = null;
/** Delivers what is due (one at a time per call). */
export async function runDueDeliveries(): Promise<number> {
  if (running) return 0;
  running = true;
  let n = 0;
  try {
    for (const d of q.all<any>("SELECT d.id, d.webhook_id, d.payload, d.attempts FROM webhook_deliveries d JOIN bot_webhooks w ON w.id = d.webhook_id WHERE d.status = 'pending' AND d.next_at <= ? AND w.active = 1 ORDER BY d.next_at LIMIT 20", now())) { await deliverOne(d); n++; }
  } finally { running = false; }
  return n;
}
function kick() {
  if (process.env.NO_SCHEDULER === "1") return;
  if (!timer) { timer = setInterval(() => { void runDueDeliveries().catch((e) => console.error("[webhooks]", e)); }, 5000); timer.unref?.(); }
  setImmediate(() => { void runDueDeliveries().catch(() => {}); });
}
