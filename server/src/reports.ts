import { randomUUID } from "node:crypto"; import { localize } from "./lang/index.js"; import type { Locale } from "./shared.js"; import { tr } from "./i18n.js";
import type { Context, Hono } from "hono";
import { q } from "./db.js";
import { screen } from "./pastedsecrets.js";
import { fail } from "./routeinput.js";
import { canWatch } from "./sentinel/view.js";
import { audit, bots, clip, now, rows, users, type UserRecord } from "./store.js";

/**
 * L31 — « Signaler cette réponse » (web and mobile). Store rules for apps with generated content ask for a way to report
 * an AI answer; it is also how bad answers reach whoever runs the server.
 *
 * The bot's owner reports one of its replies with a reason from a short list and, if they want, a few words. The report
 * keeps a MASKED copy of the reply and of the few messages before it (secrets, e-mail addresses, phone, card and bank
 * numbers, the paths and queries of web addresses are replaced), so the report still makes sense if the conversation
 * is later cleared. It is shown to the server's owner — and, in hosted mode, its operators — on the « Surveillance »
 * page (sentinel/view.ts canWatch), and goes nowhere else: no e-mail, no push, nothing leaves the server.
 *
 *   POST /bots/:id/rows/:seq/report   { reason, note? }   the caller's own bot; a finished reply of a bot. Reporting the
 *                                                          same reply again updates the report.
 *   GET  /reports                                         watchers only (404 for anyone else): open first, then handled
 *   POST /reports/:reportId/done      { done }            watchers only: « Marquer comme traité » / reopen
 */
q.run(`CREATE TABLE IF NOT EXISTS message_reports (
  id TEXT PRIMARY KEY, owner_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, bot_id TEXT NOT NULL, bot_name TEXT NOT NULL,
  generation INTEGER NOT NULL, seq INTEGER NOT NULL, thread INTEGER NOT NULL DEFAULT 0, reason TEXT NOT NULL, note TEXT NOT NULL DEFAULT '',
  text_masked TEXT NOT NULL, context TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
  handled_at INTEGER, handled_by TEXT, UNIQUE (bot_id, generation, seq, owner_id))`);

export const REPORT_REASONS = ["wrong", "harmful", "offensive", "private", "other"] as const;
export type ReportReason = (typeof REPORT_REASONS)[number];
export interface ContextLine { who: "user" | "bot"; name: string; text: string }
export interface MessageReport {
  id: string; botName: string; account: string; reason: ReportReason; note: string; text: string; context: ContextLine[];
  status: "open" | "done"; createdAt: number; handledAt: number | null;
}

/**
 * The masked copy: secrets first (the same detector as a pasted key, pastedsecrets.ts), then what identifies a person
 * or an account. Errs on the side of hiding too much; the reason and the note say what was wrong.
 */
export function maskForReport(text: string, locale: Locale = "fr"): string {
  let s = screen(text, locale).text;
  s = s.replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, "[e-mail]");
  s = s.replace(/\b(https?:\/\/[^\s/?#)]+)([^\s)]*)/gi, (_m, origin: string, rest: string) => (rest && rest !== "/" ? `${origin}/…` : origin));
  s = s.replace(/\b[A-Z]{2}\d{2}(?:[ ]?[A-Z0-9]{4}){3,7}(?:[ ]?[A-Z0-9]{1,3})?\b/g, "[IBAN]");
  s = s.replace(/\b(?:\d[ -]?){13,19}\b/g, (m) => (m.replace(/\D/g, "").length >= 13 ? tr(locale, "[card number]") : m));
  s = s.replace(/(?:\+\d{1,3}[\s.-]?)?(?:\(?\d{1,4}\)?[\s.-]?){2,5}\d{2,4}\b/g, (m) => (m.replace(/\D/g, "").length >= 9 ? tr(locale, "[phone]") : m));
  return s;
}

const CONTEXT_LINES = 4;

function contextOf(botId: string, generation: number, seq: number, thread: number, locale: Locale): ContextLine[] {
  const found = q.all<{ body: string }>(
    "SELECT body FROM rows WHERE bot_id = ? AND generation = ? AND seq < ? AND thread = ? AND kind = 'message' ORDER BY seq DESC LIMIT ?",
    botId, generation, seq, thread, CONTEXT_LINES,
  ).reverse();
  const out: ContextLine[] = [];
  for (const r of found) {
    try {
      const b = JSON.parse(r.body) as { role?: string; text?: string; origin?: { name?: string } };
      if (!b.text?.trim()) continue;
      out.push({ who: b.role === "assistant" ? "bot" : "user", name: clip(b.origin?.name ?? "", 60), text: clip(maskForReport(b.text, locale), 600) });
    } catch { /* an unreadable row is left out */ }
  }
  return out;
}

const toReport = (r: any): MessageReport => {
  let context: ContextLine[] = [];
  try { context = JSON.parse(r.context); } catch { /* none */ }
  const owner = users.byId(r.owner_id);
  return {
    id: r.id, botName: r.bot_name, account: owner ? `${owner.name || owner.email} <${owner.email}>` : "?", reason: r.reason, note: r.note, text: r.text_masked,
    context, status: r.status === "done" ? "done" : "open", createdAt: r.created_at, handledAt: r.handled_at ?? null,
  };
};

export const reports = {
  /** Files (or updates) the owner's report on one reply. Returns its id. */
  file(owner: UserRecord, bot: { id: string; name: string; generation: number }, row: { seq: number; thread?: number; text: string }, reason: ReportReason, note: string): string {
    const loc = owner.locale;
    const thread = row.thread ?? 0;
    const text = clip(maskForReport(row.text, loc), 4000);
    const ctx = JSON.stringify(contextOf(bot.id, bot.generation, row.seq, thread, loc));
    const cleanNote = clip(maskForReport(note, loc).trim(), 500);
    const id = randomUUID();
    q.run(`INSERT INTO message_reports (id, owner_id, bot_id, bot_name, generation, seq, thread, reason, note, text_masked, context, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (bot_id, generation, seq, owner_id) DO UPDATE SET reason = excluded.reason, note = excluded.note, text_masked = excluded.text_masked,
        context = excluded.context, status = 'open', created_at = excluded.created_at, handled_at = NULL, handled_by = NULL`,
      id, owner.id, bot.id, clip(bot.name, 80), bot.generation, row.seq, thread, reason, cleanNote, text, ctx, now());
    return q.get<{ id: string }>("SELECT id FROM message_reports WHERE bot_id = ? AND generation = ? AND seq = ? AND owner_id = ?", bot.id, bot.generation, row.seq, owner.id)!.id;
  },
  list: (): MessageReport[] => q.all("SELECT * FROM message_reports ORDER BY CASE status WHEN 'open' THEN 0 ELSE 1 END, created_at DESC LIMIT 200").map(toReport),
  openCount: (): number => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM message_reports WHERE status = 'open'")?.n ?? 0,
  mark(id: string, done: boolean, by: string): boolean {
    return Number(q.run("UPDATE message_reports SET status = ?, handled_at = ?, handled_by = ? WHERE id = ?", done ? "done" : "open", done ? now() : null, done ? by : null, id).changes) === 1;
  },
};

type Env = { Variables: { user: UserRecord } };
const FR: Record<string, string> = {
  "That bot does not exist.": "Ce bot n'existe pas.",
  "Only a reply of a bot can be reported.": "Seule une réponse d'un bot peut être signalée.",
  "Choose a reason.": "Choisis une raison.",
  "No such endpoint.": "Cette adresse n'existe pas.",
  "That report does not exist.": "Ce signalement n'existe pas.",
};
const m = (c: Context<Env>, en: string) => localize(c.get("user").locale, en, FR);

export function registerReportRoutes(api: Hono<Env>) {
  api.post("/bots/:id/rows/:seq/report", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "") ?? fail(404, m(c, "That bot does not exist."));
    const row = rows.get(bot.id, bot.generation, Number(c.req.param("seq")));
    const b = row?.body;
    if (!row || b?.kind !== "message" || b.role !== "assistant" || b.streaming) return fail(400, m(c, "Only a reply of a bot can be reported."));
    const body = await c.req.json().catch(() => ({})) as { reason?: unknown; note?: unknown };
    const reason = String(body?.reason ?? "") as ReportReason;
    if (!(REPORT_REASONS as readonly string[]).includes(reason)) fail(400, m(c, "Choose a reason."));
    const note = typeof body?.note === "string" ? body.note : "";
    const id = reports.file(user, bot, { seq: row.seq, thread: row.thread, text: b.text || "(—)" }, reason, note);
    audit(user.id, "account", `Reported a reply of ${bot.name} (${reason})`, bot.id);
    return c.json({ ok: true, reportId: id });
  });

  const watcher = (c: Context<Env>) => (canWatch(c.get("user").id) ? c.get("user") : fail(404, m(c, "No such endpoint.")));
  api.get("/reports", (c) => { watcher(c); return c.json({ reports: reports.list(), open: reports.openCount() }, 200, { "cache-control": "no-store" }); });
  api.post("/reports/:reportId/done", async (c) => {
    const user = watcher(c);
    const body = await c.req.json().catch(() => ({})) as { done?: unknown };
    if (!reports.mark(c.req.param("reportId") ?? "", body?.done !== false, user.id)) fail(404, m(c, "That report does not exist."));
    return c.json({ reports: reports.list(), open: reports.openCount() });
  });
}
