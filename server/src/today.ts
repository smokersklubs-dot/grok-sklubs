import { isValidTimezone, localParts } from "./cron.js";
import { q } from "./db.js";
import { hostedMode, hostedSettings, isOperator, operatorBlock, subscriptions, budgetEur, spentEur } from "./hosted.js";
import { pauses } from "./pauses.js";
import type { Card, Locale, RowBody, TodayBotDone, TodayCost, TodayDigestSettings, TodayDone, TodayLink, TodayNeed, TodayReport, TodaySettingsView } from "./shared.js";
import { bots, clip, now, users, type BotRecord } from "./store.js";
import { DEFAULT_MINUTES, FILES_PER_TURN, minutesSaved, minutesTable, RESEARCH_GAP_MIN, RESEARCH_MIN_READS, TODAY_KINDS, type TodayKind } from "./todayminutes.js";
import { localMidnight, userTimezone } from "./usagecaps.js";
import { sharedBotsFor, type BotAccess } from "./workspaces.js";
import { criticalNeeds } from "./sentinel/view.js";
import { limitsFor } from "./sublimitview.js";
import { CLASS_TITLES, failureSummary } from "./agent/failures.js";
import { tr } from "./i18n.js";

/**
 * "Aujourd'hui" — one page for the day: what only the user can fix now ("Ce qui t'attend"), what their bots finished
 * that day ("Ce que tes bots ont fini", by bot), the time it saved as an ESTIMATE ("Temps gagné": count × minutes per
 * kind, todayminutes.ts, editable by the owner), and what the day cost ("Coût du jour": money and tokens, as the usage
 * page counts them). Everything is read from what the server already keeps — cards and notices of the chats, approvals,
 * tasks, goals, background tasks, routine runs, jobs, the "Fichiers modifiés" cards, the usage journal, pauses, the
 * health of connections, usage lines — on each request: no model call, nothing stored but the owner's settings.
 *
 * Who sees what (the same rules as the rest of the API): an account sees its own bots (helpers count with the bot they
 * work for). A bot someone shares with you through a workspace adds only what you can already read in its chat (its
 * goals, background tasks and changed files) and, if your role lets you answer for the owner, its pending approvals;
 * never the owner's task list, routines, journal or costs. Days are the user's (profile timezone, else check-ins', else UTC).
 *
 * Same idea as OpenMausBot's server/today.ts and shared/today-outcomes.ts (Apache-2.0; ideas only, our own code).
 */

const DAY_MS = 86_400_000;
const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
/** A failed routine run older than this is no longer "waiting for you" (the next runs said what they had to). */
const ROUTINE_FAIL_WINDOW_MS = 7 * DAY_MS;
/** Rows read per bot when looking for open cards (the newest first). */
const CARD_SCAN = 3000;
const ITEMS_PER_BOT = 200;

export class TodayError extends Error { constructor(public status: 400, message: string) { super(message); } }

const pad = (n: number) => String(n).padStart(2, "0");
/** The user's day `date` (YYYY-MM-DD; default: today where they are): when it starts and ends. */
export function dayBounds(tz: string, date?: string, t = now()): { date: string; start: number; end: number; today: boolean } {
  const p = localParts(t, tz);
  const todayKey = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
  let y = p.year, m = p.month, d = p.day;
  if (date !== undefined && date !== "") {
    const mm = DATE.exec(date);
    const cand = mm ? new Date(Date.UTC(Number(mm[1]), Number(mm[2]) - 1, Number(mm[3]))) : null;
    if (!mm || !cand || cand.getUTCFullYear() !== Number(mm[1]) || cand.getUTCMonth() !== Number(mm[2]) - 1 || cand.getUTCDate() !== Number(mm[3]) || Number(mm[1]) < 2000 || Number(mm[1]) > 2100) {
      throw new TodayError(400, "The date must be a real day written YYYY-MM-DD.");
    }
    y = Number(mm[1]); m = Number(mm[2]); d = Number(mm[3]);
  }
  const key = `${y}-${pad(m)}-${pad(d)}`;
  return { date: key, start: localMidnight(y, m, d, tz), end: localMidnight(y, m, d + 1, tz), today: key === todayKey };
}

// ── Settings (settings.today, migration 10) ─────────────────────────────────────────────────────────────────────
interface Stored { minutes: Partial<Record<TodayKind, number>>; digest: TodayDigestSettings; lastSent: string | null }
export const DEFAULT_DIGEST: TodayDigestSettings = { enabled: false, hour: 8, push: true, email: false };

function readStored(userId: string): Stored {
  let raw: any = {};
  try { raw = JSON.parse(q.get<{ today: string }>("SELECT today FROM settings WHERE user_id = ?", userId)?.today ?? "{}") ?? {}; } catch { raw = {}; }
  const minutes: Partial<Record<TodayKind, number>> = {};
  const table = minutesTable(raw.minutes);
  for (const k of TODAY_KINDS) if (raw.minutes && typeof raw.minutes[k] === "number" && table[k] !== DEFAULT_MINUTES[k]) minutes[k] = table[k];
  const d = raw.digest ?? {};
  const digest: TodayDigestSettings = {
    enabled: d.enabled === true, hour: Number.isInteger(d.hour) && d.hour >= 0 && d.hour <= 23 ? d.hour : DEFAULT_DIGEST.hour,
    push: typeof d.push === "boolean" ? d.push : DEFAULT_DIGEST.push, email: typeof d.email === "boolean" ? d.email : DEFAULT_DIGEST.email,
  };
  return { minutes, digest, lastSent: typeof raw.lastSent === "string" ? raw.lastSent : null };
}
function writeStored(userId: string, s: Stored) {
  q.run("INSERT INTO settings (user_id, today) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET today = excluded.today", userId, JSON.stringify(s));
}

export const todaySettings = {
  /** The minutes table in force for this account (defaults + overrides). */
  table: (userId: string) => minutesTable(readStored(userId).minutes),
  view(userId: string, extra: { mailConfigured: boolean; pushDevices: number }): TodaySettingsView {
    const s = readStored(userId);
    return { digest: s.digest, overrides: s.minutes, defaults: { ...DEFAULT_MINUTES }, timezone: userTimezone(userId), lastSent: s.lastSent, ...extra };
  },
  /**
   * Changes the owner's settings. `minutes`: kind → whole minutes (0–480), or null to go back to the default; unknown
   * kinds and bad values are refused (TodayError). `digest`: any of enabled, hour, push, email.
   */
  save(userId: string, body: { minutes?: unknown; digest?: unknown }): Stored {
    const cur = readStored(userId);
    const minutes = { ...cur.minutes };
    if (body.minutes !== undefined) {
      if (!body.minutes || typeof body.minutes !== "object" || Array.isArray(body.minutes)) throw new TodayError(400, "Minutes must be given per kind.");
      for (const [k, v] of Object.entries(body.minutes as Record<string, unknown>)) {
        if (!(TODAY_KINDS as readonly string[]).includes(k)) throw new TodayError(400, `Unknown kind: ${clip(k, 40)}.`);
        const kind = k as TodayKind;
        if (v === null) { delete minutes[kind]; continue; }
        if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 480) throw new TodayError(400, "Minutes must be a number from 0 to 480.");
        if (Math.round(v) === DEFAULT_MINUTES[kind]) delete minutes[kind]; else minutes[kind] = Math.round(v);
      }
    }
    const digest = { ...cur.digest };
    if (body.digest !== undefined) {
      const d = body.digest as Record<string, unknown>;
      if (!d || typeof d !== "object" || Array.isArray(d)) throw new TodayError(400, "Invalid digest settings.");
      for (const k of ["enabled", "push", "email"] as const) {
        if (d[k] === undefined) continue;
        if (typeof d[k] !== "boolean") throw new TodayError(400, "Invalid digest settings.");
        digest[k] = d[k] as boolean;
      }
      if (d.hour !== undefined) {
        if (!Number.isInteger(d.hour) || (d.hour as number) < 0 || (d.hour as number) > 23) throw new TodayError(400, "The hour must be a whole number from 0 to 23.");
        digest.hour = d.hour as number;
      }
    }
    const next = { minutes, digest, lastSent: cur.lastSent };
    writeStored(userId, next);
    return readStored(userId);
  },
  markSent(userId: string, key: string) { writeStored(userId, { ...readStored(userId), lastSent: key }); },
};

// ── Who is in scope ─────────────────────────────────────────────────────────────────────────────────────────────
interface Scope {
  /** Every own bot id (helpers included) → the bot it shows under (a helper: the bot it works for). */
  own: Map<string, BotRecord>;
  /** Top-level own bots (not helpers). */
  top: BotRecord[];
  shared: BotAccess[];
}
function scopeOf(userId: string): Scope {
  const all = bots.list(userId, true);
  const byId = new Map(all.map((b) => [b.id, b]));
  const own = new Map<string, BotRecord>();
  for (const b of all) {
    let top = b;
    for (let i = 0; i < 3 && top.hidden && top.parentId && byId.get(top.parentId); i++) top = byId.get(top.parentId)!;
    own.set(b.id, top);
  }
  return { own, top: all.filter((b) => !b.hidden), shared: sharedBotsFor(userId).filter((a) => a.canView) };
}
const marks = (n: number) => Array(n).fill("?").join(", ");

// ── "Ce qui t'attend" ───────────────────────────────────────────────────────────────────────────────────────────
interface RowHit { seq: number; thread: number; created_at: number; body: string; generation: number }

/** The open cards and notices of a bot's current conversation, as needs. `approveOnly`: a shared bot (only its approvals). */
function cardNeeds(bot: BotRecord, opts: { approveOnly: boolean; shared: boolean }): TodayNeed[] {
  const found = q.all<RowHit>(
    `SELECT seq, thread, created_at, body, generation FROM rows WHERE bot_id = ? AND generation = ? AND kind IN ('card', 'notice')
       AND (json_extract(body, '$.card.status') = 'pending' OR json_extract(body, '$.card.state') = 'waiting' OR json_extract(body, '$.action.status') = 'pending')
     ORDER BY seq DESC LIMIT ?`, bot.id, bot.generation, CARD_SCAN);
  const out: TodayNeed[] = [];
  for (const r of found) {
    let body: RowBody;
    try { body = JSON.parse(r.body) as RowBody; } catch { continue; }
    const link: TodayLink = { kind: "row", botId: bot.id, seq: r.seq, ...(r.thread ? { thread: r.thread } : {}) };
    const need = (kind: TodayNeed["kind"], title: string, detail = ""): TodayNeed => ({ kind, botId: bot.id, botName: bot.name, title: clip(title.trim(), 200), detail: clip(detail.trim(), 240), at: r.created_at, link, ...(opts.shared ? { shared: true } : {}) });
    if (body.kind === "notice") {
      if (opts.approveOnly) continue;
      const a = body.action;
      if (a?.kind === "watch" && a.status === "pending") out.push(need(a.watch === "silent" ? "silent" : "stalled", body.text));
      else if (a?.kind === "continue" && a.status === "pending") out.push(need("continue", body.text));
      continue;
    }
    if (body.kind !== "card") continue;
    const c: Card = body.card;
    if (c.type === "approval") {
      if (c.status !== "pending") continue;
      const live = q.get<{ status: string }>("SELECT status FROM approvals WHERE id = ?", c.approvalId);
      if (live && live.status !== "pending") continue;
      out.push(need("approval", c.title, c.detail));
      continue;
    }
    if (c.type === "task" && c.state === "waiting" && (c.approval || c.question)) {
      if (c.approval) {
        const live = q.get<{ status: string }>("SELECT status FROM approvals WHERE id = ?", c.approval.approvalId);
        if (live && live.status !== "pending") continue;
        out.push(need("approval", c.approval.title, c.title));
      } else if (!opts.approveOnly) out.push(need("question", c.question ?? c.title, c.title));
      continue;
    }
    if (opts.approveOnly) continue;
    switch (c.type) {
      case "question": if (c.status === "pending") out.push(need("question", c.question, c.options.join(" · "))); break;
      case "cap": if (c.status === "pending") out.push(need("cap", c.botName || bot.name, c.cap ? `${c.cap.period} ${c.cap.unit}` : "")); break;
      case "spend": if (c.status === "pending") out.push(need("spend", c.title, `${c.spentUsd.toFixed(2)} $ / ${c.thresholdUsd.toFixed(2)} $`)); break;
      case "disk": if (c.status === "pending") out.push(need("disk", `${c.usedPct} %`, "")); break;
      case "failure": if (c.status === "pending") out.push(need("failure", tr(users.localeOf(bot.userId), CLASS_TITLES[c.cls]), c.tool ? `${c.tool} · ${c.detail}` : c.detail)); break;
      case "connect": if (c.status === "pending") out.push(need("connector", c.name, c.reason)); break;
      case "secret": if (c.status === "pending") out.push(need("secret", c.name, c.reason)); break;
      case "takeover": if (c.status === "pending" && c.expiresAt > now()) out.push(need("takeover", c.detail || c.reason)); break;
      case "uncertain": if (c.status === "pending") out.push(need("uncertain", c.title, c.detail)); break;
      case "goal": if (c.status === "proposed") out.push(need("goal", c.objective)); break;
      case "skill": if (c.status === "pending") out.push(need("review", c.name, c.when)); break;
      case "apiconnector": if (c.status === "pending") out.push(need("review", c.name, c.host)); break;
      case "memory": if (c.status === "pending") out.push(need("review", c.newText, c.oldText)); break;
      case "pastedsecret": if (c.status === "pending" && c.expiresAt > now()) out.push(need("review", c.name || c.hint, c.host)); break;
      default: break;
    }
  }
  return out;
}

function needsOf(userId: string, scope: Scope, t: number): TodayNeed[] {
  const out: TodayNeed[] = [];
  for (const b of scope.top) out.push(...cardNeeds(b, { approveOnly: false, shared: false }));
  for (const a of scope.shared) if (a.canApprove) out.push(...cardNeeds(a.bot, { approveOnly: true, shared: true }));
  // Paused bots holding messages.
  for (const b of scope.top) {
    if (b.kind !== "agent") continue;
    const p = pauses.of(b);
    if (p && p.queued > 0) out.push({ kind: "paused", botId: b.id, botName: b.name, title: b.name, detail: "", count: p.queued, at: p.since, link: { kind: "bot", botId: b.id } });
  }
  // Routines the server paused after failing, or whose last run failed recently.
  const ownIds = [...scope.own.keys()];
  if (ownIds.length) {
    const list = q.all<{ id: string; bot_id: string; name: string; enabled: number; paused_reason: string | null; last_at: number | null; last_status: string | null; last_note: string | null }>(
      `SELECT r.id, r.bot_id, r.name, r.enabled, r.paused_reason,
         (SELECT at FROM routine_runs x WHERE x.routine_id = r.id AND x.status != 'skipped' ORDER BY at DESC, rowid DESC LIMIT 1) AS last_at,
         (SELECT status FROM routine_runs x WHERE x.routine_id = r.id AND x.status != 'skipped' ORDER BY at DESC, rowid DESC LIMIT 1) AS last_status,
         (SELECT note FROM routine_runs x WHERE x.routine_id = r.id AND x.status != 'skipped' ORDER BY at DESC, rowid DESC LIMIT 1) AS last_note
       FROM routines r WHERE r.bot_id IN (${marks(ownIds.length)})`, ...ownIds);
    for (const r of list) {
      const top = scope.own.get(r.bot_id)!;
      const pausedByServer = !r.enabled && !!r.paused_reason;
      const failed = r.last_status === "error" && (r.last_at ?? 0) > t - ROUTINE_FAIL_WINDOW_MS;
      if (!pausedByServer && !failed) continue;
      out.push({ kind: "routine", botId: top.id, botName: top.name, title: r.name, detail: clip((pausedByServer ? r.paused_reason : r.last_note) || "", 240), at: r.last_at ?? t, link: { kind: "botSettings", botId: top.id, tab: "routines" } });
    }
  }
  // Built-in app accounts to sign in again, and connections whose health check says so.
  for (const a of q.all<{ id: string; app: string; label: string; error: string | null; created_at: number }>("SELECT id, app, label, error, created_at FROM native_accounts WHERE user_id = ? AND status != 'ready'", userId)) {
    out.push({ kind: "connector", botId: null, botName: "", title: `${a.app} — ${a.label}`, detail: clip(a.error ?? "", 240), at: a.created_at, link: { kind: "settings", section: "connectors" } });
  }
  for (const h of q.all<{ name: string; detail: string; how: string; checked_at: number | null }>("SELECT name, detail, how, checked_at FROM credential_health WHERE user_id = ? AND state IN ('broken', 'reconnect')", userId)) {
    out.push({ kind: "connector", botId: null, botName: "", title: h.name, detail: clip(h.how || h.detail, 240), at: h.checked_at ?? t, link: { kind: "settings", section: "keys" } });
  }
  // Hosted mode: the account's plan stops work (suspended, the month's budget used up, payment overdue).
  if (hostedMode() && !isOperator(userId)) {
    const block = operatorBlock(userId);
    const sub = subscriptions.get(userId);
    if (block === "suspended" || block === "budget" || sub?.status === "past_due") {
      out.push({ kind: "plan", botId: null, botName: "", title: block ?? "past_due", detail: "", at: sub?.statusChangedAt ?? t, link: { kind: "settings", section: "subscription" } });
    }
  }
  // The server's owner (and hosted operators): a critical incident of the Sentinelle not acknowledged yet → Surveillance.
  for (const i of criticalNeeds(userId)) out.push({ kind: "incident", botId: null, botName: "", title: i.title, detail: clip(i.detail, 240), at: i.at, link: { kind: "surveillance", incidentId: i.id } });
  const order: TodayNeed["kind"][] = ["incident", "plan", "approval", "question", "takeover", "secret", "cap", "spend", "uncertain", "failure", "disk", "connector", "stalled", "silent", "continue", "paused", "routine", "goal", "review"];
  return out.sort((x, y) => order.indexOf(x.kind) - order.indexOf(y.kind) || y.at - x.at);
}

// ── "Ce que tes bots ont fini" ──────────────────────────────────────────────────────────────────────────────────
const WEB_READS = new Set(["web_fetch", "search_web", "reach_read", "reach_search", "x_search", "browser_open"]);
/** The kind of outcome a successful journal line is, or null. Built-in app tools are named <app>_<label>__<action>. */
export function journalKind(tool: string): TodayKind | "read" | null {
  const action = tool.includes("__") ? tool.slice(tool.lastIndexOf("__") + 2) : tool;
  if (tool === "bot_email_send" || action === "mail_send" || action === "mail_reply") return "emailSent";
  if (action === "slack_post") return "messagePosted";
  if (action === "calendar_create" || action === "calendar_update") return "eventBooked";
  if (tool === "page_publish") return "pagePublished";
  if (WEB_READS.has(tool)) return "read";
  return null;
}

interface Collected { top: BotRecord; shared: boolean; item: Omit<TodayDone, "minutes"> }

function rowLink(bot: BotRecord, generation: number | null, seq: number | null, thread = 0): TodayLink | null {
  if (seq === null || seq === undefined || generation !== bot.generation) return { kind: "bot", botId: bot.id };
  return { kind: "row", botId: bot.id, seq, ...(thread ? { thread } : {}) };
}

function doneOf(userId: string, scope: Scope, start: number, end: number): Collected[] {
  const out: Collected[] = [];
  const add = (top: BotRecord, shared: boolean, kind: TodayKind, at: number, title: string, detail: string, link: TodayLink | null, count = 1, counted = count) =>
    out.push({ top, shared, item: { kind, at, title: clip(title.replace(/\s+/g, " ").trim(), 200), detail: clip(detail.replace(/\s+/g, " ").trim(), 280), count, counted, link } });
  const ownIds = [...scope.own.keys()];
  const sharedMap = new Map(scope.shared.map((a) => [a.bot.id, a.bot]));
  const rowsIds = [...ownIds, ...sharedMap.keys()];
  const topOf = (botId: string): { top: BotRecord; shared: boolean } | null => {
    const o = scope.own.get(botId);
    if (o) return { top: o, shared: false };
    const s = sharedMap.get(botId);
    return s ? { top: s, shared: true } : null;
  };

  if (rowsIds.length) {
    // Goals completed (with their evidence), background tasks finished, files changed: what the chats themselves show.
    for (const g of q.all<{ bot_id: string; objective: string; evidence: string; summary: string; generation: number; thread: number; card_seq: number | null; updated_at: number }>(
      `SELECT bot_id, objective, evidence, summary, generation, thread, card_seq, updated_at FROM bot_goals WHERE bot_id IN (${marks(rowsIds.length)}) AND status = 'complete' AND updated_at >= ? AND updated_at < ?`, ...rowsIds, start, end)) {
      const o = topOf(g.bot_id); if (!o) continue;
      add(o.top, o.shared, "goal", g.updated_at, g.objective, g.evidence || g.summary, o.top.id === g.bot_id ? rowLink(o.top, g.generation, g.card_seq, g.thread) : { kind: "bot", botId: o.top.id });
    }
    for (const b of q.all<{ bot_id: string; title: string; result: string; generation: number; card_seq: number | null; updated_at: number }>(
      `SELECT bot_id, title, result, generation, card_seq, updated_at FROM bg_tasks WHERE bot_id IN (${marks(rowsIds.length)}) AND state = 'done' AND updated_at >= ? AND updated_at < ?`, ...rowsIds, start, end)) {
      const o = topOf(b.bot_id); if (!o) continue;
      add(o.top, o.shared, "bgTask", b.updated_at, b.title, b.result, o.top.id === b.bot_id ? rowLink(o.top, b.generation, b.card_seq) : { kind: "bot", botId: o.top.id });
    }
    for (const r of q.all<{ bot_id: string; generation: number; seq: number; thread: number; created_at: number; body: string }>(
      `SELECT bot_id, generation, seq, thread, created_at, body FROM rows WHERE bot_id IN (${marks(rowsIds.length)}) AND kind = 'card' AND created_at >= ? AND created_at < ?
         AND json_extract(body, '$.card.type') = 'files'`, ...rowsIds, start, end)) {
      const o = topOf(r.bot_id); if (!o) continue;
      let card: Extract<Card, { type: "files" }>;
      try { card = (JSON.parse(r.body) as { card: Extract<Card, { type: "files" }> }).card; } catch { continue; }
      const n = (card.files?.length ?? 0) + (card.more ?? 0);
      if (!n) continue;
      const names = (card.files ?? []).slice(0, 3).map((f) => f.path).join(", ");
      add(o.top, o.shared, "fileEdit", r.created_at, names, card.status === "undone" ? "undone" : "", o.top.id === r.bot_id ? rowLink(o.top, r.generation, r.seq, r.thread) : { kind: "bot", botId: o.top.id }, n, card.status === "undone" ? 0 : Math.min(n, FILES_PER_TURN));
    }
  }

  if (ownIds.length) {
    // The account's own records: the task list, routine runs, long commands, and the usage journal.
    for (const tk of q.all<{ bot_id: string; title: string; note: string; updated_at: number }>(
      `SELECT bot_id, title, note, updated_at FROM tasks WHERE bot_id IN (${marks(ownIds.length)}) AND state = 'done' AND updated_at >= ? AND updated_at < ?`, ...ownIds, start, end)) {
      const top = scope.own.get(tk.bot_id)!;
      add(top, false, "task", tk.updated_at, tk.title, tk.note, { kind: "bot", botId: top.id });
    }
    for (const r of q.all<{ bot_id: string; name: string; note: string; at: number; status: string }>(
      `SELECT r.bot_id, r.name, x.note, x.at, x.status FROM routine_runs x JOIN routines r ON r.id = x.routine_id
       WHERE r.bot_id IN (${marks(ownIds.length)}) AND x.status IN ('done', 'quiet') AND x.at >= ? AND x.at < ?`, ...ownIds, start, end)) {
      const top = scope.own.get(r.bot_id)!;
      add(top, false, "routine", r.at, r.name, r.note, { kind: "botSettings", botId: top.id, tab: "routines" });
    }
    for (const j of q.all<{ bot_id: string; command: string; note: string; ended_at: number }>(
      `SELECT bot_id, command, note, ended_at FROM bot_jobs WHERE bot_id IN (${marks(ownIds.length)}) AND status = 'done' AND ended_at >= ? AND ended_at < ?`, ...ownIds, start, end)) {
      const top = scope.own.get(j.bot_id)!;
      add(top, false, "job", j.ended_at, j.command, j.note, { kind: "bot", botId: top.id });
    }
    const reads = new Map<string, { at: number; label: string }[]>();
    for (const l of q.all<{ bot_id: string; tool: string; label: string; at: number }>(
      "SELECT bot_id, tool, label, at FROM action_journal WHERE user_id = ? AND at >= ? AND at < ? AND status = 'done' ORDER BY at LIMIT 20000", userId, start, end)) {
      const top = scope.own.get(l.bot_id);
      if (!top) continue;
      const kind = journalKind(l.tool);
      if (!kind) continue;
      if (kind === "read") { const list = reads.get(top.id) ?? []; list.push({ at: l.at, label: l.label }); reads.set(top.id, list); continue; }
      add(top, false, kind, l.at, l.label || l.tool, "", { kind: "bot", botId: top.id });
    }
    // Research: RESEARCH_MIN_READS web reads or more by one bot, no gap over RESEARCH_GAP_MIN minutes.
    for (const [botId, list] of reads) {
      const top = scope.own.get(botId)!;
      let run: { at: number; label: string }[] = [];
      const flush = () => { if (run.length >= RESEARCH_MIN_READS) add(top, false, "research", run[run.length - 1].at, run[0].label, run.slice(1, 3).map((x) => x.label).join(" · "), { kind: "bot", botId: top.id }, run.length, 1); run = []; };
      for (const r of list) { if (run.length && r.at - run[run.length - 1].at > RESEARCH_GAP_MIN * 60_000) flush(); run.push(r); }
      flush();
    }
  }
  return out;
}

// ── "Coût du jour" ──────────────────────────────────────────────────────────────────────────────────────────────
function costOf(userId: string, start: number, end: number, t: number): TodayCost {
  const names = new Map(bots.list(userId, true).map((b) => [b.id, b]));
  const nameOf = (id: string) => { const b = names.get(id); const top = b?.hidden && b.parentId ? names.get(b.parentId) ?? b : b; return { id: top?.id ?? id, name: top?.name ?? "" }; };
  const per = q.all<{ bot_id: string; c: number | null; e: number | null; i: number | null; o: number | null; n: number; st: number | null }>(
    `SELECT bot_id, SUM(cost_usd) AS c, SUM(est_cost_usd) AS e, SUM(input_tokens) AS i, SUM(output_tokens) AS o, COUNT(*) AS n,
       SUM(CASE WHEN price_status = 'subscription' THEN input_tokens + output_tokens ELSE 0 END) AS st
     FROM usage WHERE user_id = ? AND at >= ? AND at < ? GROUP BY bot_id`, userId, start, end);
  const byBot = new Map<string, { botId: string; botName: string; usd: number; tokens: number }>();
  const cost: TodayCost = { usd: 0, estimatedUsd: 0, inputTokens: 0, outputTokens: 0, turns: 0, subscriptionTokens: 0, byBot: [] };
  for (const r of per) {
    cost.usd += r.c ?? 0; cost.estimatedUsd += r.e ?? 0; cost.inputTokens += r.i ?? 0; cost.outputTokens += r.o ?? 0; cost.turns += r.n; cost.subscriptionTokens += r.st ?? 0;
    const who = nameOf(r.bot_id);
    const cur = byBot.get(who.id) ?? { botId: who.id, botName: who.name, usd: 0, tokens: 0 };
    cur.usd += (r.c ?? 0) + (r.e ?? 0); cur.tokens += (r.i ?? 0) + (r.o ?? 0);
    byBot.set(who.id, cur);
  }
  cost.byBot = [...byBot.values()].sort((a, b) => b.usd - a.usd || b.tokens - a.tokens).slice(0, 12).map((b) => ({ ...b, usd: Math.round(b.usd * 10_000) / 10_000 }));
  cost.usd = Math.round(cost.usd * 10_000) / 10_000;
  cost.estimatedUsd = Math.round(cost.estimatedUsd * 10_000) / 10_000;
  if (hostedMode() && !isOperator(userId)) {
    const op = q.get<{ c: number | null }>("SELECT SUM(cost_usd + est_cost_usd) AS c FROM usage WHERE user_id = ? AND payer = 'operator' AND at >= ? AND at < ?", userId, start, end)?.c ?? 0;
    const left = budgetEur(userId, t) - spentEur(userId, t);
    cost.hosted = { spentEur: Math.round(op * hostedSettings.get().usdToEur * 100) / 100, budgetLeftEur: Number.isFinite(left) ? Math.round(Math.max(0, left) * 100) / 100 : -1 };
  }
  return cost;
}

// ── The report ──────────────────────────────────────────────────────────────────────────────────────────────────
export function todayReport(userId: string, date?: string, t = now()): TodayReport {
  const tz = userTimezone(userId);
  const day = dayBounds(isValidTimezone(tz) ? tz : "UTC", date, t);
  const scope = scopeOf(userId);
  const table = todaySettings.table(userId);
  const overridden = Object.keys(readStored(userId).minutes);
  const collected = doneOf(userId, scope, day.start, day.end);
  const groups = new Map<string, TodayBotDone>();
  const counts: Partial<Record<TodayKind, number>> = {};
  for (const c of collected) {
    const minutes = c.item.counted * table[c.item.kind];
    counts[c.item.kind] = (counts[c.item.kind] ?? 0) + c.item.counted;
    const g = groups.get(c.top.id) ?? { botId: c.top.id, botName: c.top.name, shared: c.shared, items: [], minutes: 0 };
    g.items.push({ ...c.item, minutes });
    g.minutes += minutes;
    groups.set(c.top.id, g);
  }
  const done = [...groups.values()].map((g) => ({ ...g, items: g.items.sort((a, b) => b.at - a.at).slice(0, ITEMS_PER_BOT) }))
    .sort((a, b) => b.minutes - a.minutes || b.items.length - a.items.length || a.botName.localeCompare(b.botName));
  return {
    date: day.date, timezone: tz, start: day.start, end: day.end, today: day.today, generatedAt: t,
    needs: needsOf(userId, scope, t),
    done,
    minutes: { total: minutesSaved(counts, table), table, counts, overridden },
    cost: costOf(userId, day.start, day.end, t),
    // Subscriptions at their usage limit now, and when they come back (agent/sublimit.ts): today only.
    ...(day.today ? { limits: limitsFor(userId) } : {}),
    // « Coordinateur d'échecs »: incidents fixed automatically and waiting for the owner, providers down now (failures.ts).
    failures: failureSummary(userId, day.start, day.end, t),
  };
}

// ── The daily digest ────────────────────────────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "Your day with your bots": "Ta journée avec tes bots",
  "Your bots yesterday": "Tes bots hier",
  "{n} things wait for you": "{n} choses t'attendent", "1 thing waits for you": "1 chose t'attend", "Nothing waits for you": "Rien ne t'attend",
  "{n} finished": "{n} terminées", "≈ {time} saved (estimate)": "≈ {time} gagnées (estimation)",
  "What waits for you:": "Ce qui t'attend :", "What your bots finished:": "Ce que tes bots ont fini :",
  "Time saved is an estimate: for each kind of result, the number done × the minutes it usually takes by hand (Settings → Today).":
    "Le temps gagné est une estimation : pour chaque type de résultat, le nombre fait × les minutes qu'il prend d'habitude à la main (Réglages → Aujourd'hui).",
  "Cost": "Coût", "Open Sklubot": "Ouvrir Sklubot", "and {n} more": "et {n} de plus",
};
const tx = (loc: Locale, en: string, vars: Record<string, string | number> = {}) => (loc === "fr" ? FR[en] ?? en : en).replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
export const durationText = (min: number) => (min < 60 ? `${min} min` : `${Math.floor(min / 60)} h${min % 60 ? ` ${pad(min % 60)}` : ""}`);

export interface Digest { title: string; body: string; text: string; report: TodayReport }
/** The digest of a day for this user, or null when there is nothing to say (nothing waits, nothing was finished). */
export function buildDigest(userId: string, date: string | undefined, t: number, base: string): Digest | null {
  const loc = users.localeOf(userId);
  const r = todayReport(userId, date, t);
  const doneCount = r.done.reduce((a, g) => a + g.items.length, 0);
  if (!r.needs.length && !doneCount) return null;
  const parts = [
    r.needs.length === 0 ? tx(loc, "Nothing waits for you") : r.needs.length === 1 ? tx(loc, "1 thing waits for you") : tx(loc, "{n} things wait for you", { n: r.needs.length }),
    tx(loc, "{n} finished", { n: doneCount }),
    ...(r.minutes.total ? [tx(loc, "≈ {time} saved (estimate)", { time: durationText(r.minutes.total) })] : []),
    ...(r.cost && r.cost.usd + r.cost.estimatedUsd > 0 ? [`${(r.cost.usd + r.cost.estimatedUsd).toFixed(2)} $`] : []),
  ];
  const lines: string[] = [`${r.date}`, "", parts.join(" · "), ""];
  if (r.needs.length) {
    lines.push(tx(loc, "What waits for you:"));
    for (const n of r.needs.slice(0, 10)) lines.push(`- ${n.botName ? `${n.botName} : ` : ""}${n.title}`);
    if (r.needs.length > 10) lines.push(`  ${tx(loc, "and {n} more", { n: r.needs.length - 10 })}`);
    lines.push("");
  }
  if (doneCount) {
    lines.push(tx(loc, "What your bots finished:"));
    for (const g of r.done) {
      lines.push(`${g.botName} (${g.items.length})`);
      for (const i of g.items.slice(0, 5)) lines.push(`- ${i.title}`);
      if (g.items.length > 5) lines.push(`  ${tx(loc, "and {n} more", { n: g.items.length - 5 })}`);
    }
    lines.push("");
  }
  lines.push(tx(loc, "Time saved is an estimate: for each kind of result, the number done × the minutes it usually takes by hand (Settings → Today)."), "", `${tx(loc, "Open Sklubot")}: ${base.replace(/\/$/, "")}/?view=today`);
  return { title: r.today ? tx(loc, "Your day with your bots") : tx(loc, "Your bots yesterday"), body: parts.join(" · "), text: lines.join("\n"), report: r };
}

export interface DigestSender { push(userId: string, title: string, body: string): Promise<number>; mail(to: string, subject: string, text: string): Promise<void>; mailReady(): boolean }

/**
 * Sends the digests that are due at `t`: for every account that switched it on, once per local day, during the hour it
 * chose (its timezone). Before noon it sums up the day before ("hier"), from noon on the day so far. Nothing is sent
 * when there is nothing to say. The day is marked as sent before sending, so a slow or failing channel never sends twice.
 * Returns the accounts it went to (tests).
 */
export async function runDigests(t: number, send: DigestSender, base: string): Promise<string[]> {
  const sent: string[] = [];
  const candidates = q.all<{ user_id: string }>("SELECT user_id FROM settings WHERE today LIKE '%\"enabled\":true%'");
  for (const { user_id: userId } of candidates) {
    const s = readStored(userId);
    if (!s.digest.enabled || (!s.digest.push && !s.digest.email)) continue;
    const user = users.byId(userId);
    if (!user) continue;
    const tz = userTimezone(userId);
    const p = localParts(t, tz);
    if (p.hour !== s.digest.hour) continue;
    const key = `${p.year}-${pad(p.month)}-${pad(p.day)}`;
    if (s.lastSent === key) continue;
    todaySettings.markSent(userId, key);
    const date = p.hour < 12 ? dayBounds(tz, undefined, localMidnight(p.year, p.month, p.day, tz) - 1).date : key;
    const d = buildDigest(userId, date, t, base);
    if (!d) continue;
    if (s.digest.push) await send.push(userId, d.title, d.body).catch(() => 0);
    if (s.digest.email && send.mailReady()) await send.mail(user.email, `Sklubot · ${d.title} · ${d.report.date}`, d.text).catch((err) => console.error("[today] digest mail:", (err as Error).message));
    sent.push(userId);
  }
  return sent;
}
