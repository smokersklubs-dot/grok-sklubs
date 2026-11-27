/**
 * L143 — the routines in your own calendar app: an iCalendar feed (RFC 5545, https://www.rfc-editor.org/rfc/rfc5545)
 * of the next 30 days of runs of your scheduled and one-off routines. Read-only: the feed only lists times and names
 * (never an instruction, an address or a result). Its address holds a secret token; only a fingerprint (SHA-256) of the
 * token is kept, so the link is shown once; « Nouveau lien » replaces it and « Retirer le lien » stops it at once.
 * One feed per account; another account's routines are never in it (hosted mode included).
 *
 *   GET    /routine-calendar           { active, createdAt }               (session)
 *   POST   /routine-calendar           { url, createdAt } — a new link (the old one stops working)
 *   DELETE /routine-calendar           the link stops working
 *   GET    /calendar/:token.ics        text/calendar (no session: the token is the key)
 */
import { createHash } from "node:crypto";
import type { Context, Hono } from "hono";
import { q } from "./db.js";
import { config } from "./config.js";
import { nextRun } from "./cron.js";
import { describeRoutine, routines } from "./routines.js";
import { audit, bots, randomToken, users, type UserRecord } from "./store.js";
import { isPaused } from "./agent/loop.js";

q.run(`CREATE TABLE IF NOT EXISTS routine_calendar_feeds (
  user_id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, last_read_at INTEGER
)`);

const DAYS = 30;
const MAX_PER_ROUTINE = 100;
const MAX_EVENTS = 1000;
const hash = (token: string) => createHash("sha256").update(token).digest("hex");

export const calendarFeeds = {
  status(userId: string): { active: boolean; createdAt: number | null; lastReadAt: number | null } {
    const r = q.get<{ created_at: number; last_read_at: number | null }>("SELECT created_at, last_read_at FROM routine_calendar_feeds WHERE user_id = ?", userId);
    return { active: !!r, createdAt: r?.created_at ?? null, lastReadAt: r?.last_read_at ?? null };
  },
  /** A new token (the previous one, if any, stops working). */
  create(userId: string, at = Date.now()): string {
    const token = randomToken(24);
    q.run("INSERT INTO routine_calendar_feeds (user_id, token_hash, created_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET token_hash = excluded.token_hash, created_at = excluded.created_at, last_read_at = NULL", userId, hash(token), at);
    return token;
  },
  revoke(userId: string) { q.run("DELETE FROM routine_calendar_feeds WHERE user_id = ?", userId); },
  userOf(token: string): string | null {
    if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
    return q.get<{ user_id: string }>("SELECT user_id FROM routine_calendar_feeds WHERE token_hash = ?", hash(token))?.user_id ?? null;
  },
};

export const feedUrl = (token: string) => `${config.publicUrl}/api/calendar/${token}.ics`;

/** RFC 5545 §3.3.11: backslash, semicolon, comma and newlines escaped in TEXT values. */
export function icsText(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
}
/** RFC 5545 §3.1: lines longer than 75 octets are folded (CRLF + one space), never inside a UTF-8 character. */
export function foldLine(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  let size = 0;
  for (const ch of line) {
    const n = Buffer.byteLength(ch, "utf8");
    const limit = parts.length ? 74 : 75; // continuation lines start with a space
    if (size + n > limit) { parts.push(cur); cur = ""; size = 0; }
    cur += ch; size += n;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}
const stamp = (t: number) => new Date(t).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

export interface FeedEvent { uid: string; start: number; summary: string; description: string }

/** The next DAYS days of runs of this account's routines that run at set times (scheduled, once), on bots not paused. */
export function feedEvents(userId: string, from = Date.now()): FeedEvent[] {
  const locale = users.localeOf(userId);
  const end = from + DAYS * 86_400_000;
  const out: FeedEvent[] = [];
  for (const bot of bots.list(userId)) {
    if (isPaused(bot)) continue;
    for (const r of routines.forBot(bot.id)) {
      if (!r.enabled || (r.trigger !== "cron" && r.trigger !== "once")) continue;
      const summary = `${bot.name} — ${r.name}`;
      const description = describeRoutine(r, locale);
      if (r.trigger === "once") {
        if (r.runAt && !r.lastRunAt && r.runAt >= from && r.runAt <= end) out.push({ uid: `${r.id}-${r.runAt}@sklubot`, start: r.runAt, summary, description });
        continue;
      }
      let t = from;
      for (let i = 0; i < MAX_PER_ROUTINE; i++) {
        const next = nextRun(r.schedule, r.timezone, t);
        if (!next || next > end) break;
        out.push({ uid: `${r.id}-${next}@sklubot`, start: next, summary, description });
        t = next;
      }
    }
  }
  return out.sort((a, b) => a.start - b.start).slice(0, MAX_EVENTS);
}

export function feedIcs(userId: string, from = Date.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Sklubot//Routines//FR", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", "X-WR-CALNAME:Sklubot — routines", "REFRESH-INTERVAL;VALUE=DURATION:PT1H", "X-PUBLISHED-TTL:PT1H"];
  for (const e of feedEvents(userId, from)) {
    lines.push("BEGIN:VEVENT", `UID:${e.uid}`, `DTSTAMP:${stamp(from)}`, `DTSTART:${stamp(e.start)}`, "DURATION:PT15M", `SUMMARY:${icsText(e.summary)}`, `DESCRIPTION:${icsText(e.description)}`, "TRANSP:TRANSPARENT", "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(foldLine).join("\r\n") + "\r\n";
}

type Env = { Variables: { user: UserRecord } };

/** Behind the session (routineplusroutes.ts). */
export function registerRoutineIcalRoutes(api: Hono<Env>) {
  api.get("/routine-calendar", (c) => c.json(calendarFeeds.status(c.get("user").id)));
  api.post("/routine-calendar", (c) => {
    const user = c.get("user");
    const token = calendarFeeds.create(user.id);
    audit(user.id, "routine", "Calendar feed of routines: new link");
    return c.json({ url: feedUrl(token), ...calendarFeeds.status(user.id) });
  });
  api.delete("/routine-calendar", (c) => {
    const user = c.get("user");
    calendarFeeds.revoke(user.id);
    audit(user.id, "routine", "Calendar feed of routines: link removed");
    return c.json(calendarFeeds.status(user.id));
  });
}

/** Before the session check (routes.ts): the token is the only key. */
export function registerRoutineIcalPublic(api: Hono<any>) {
  api.get("/calendar/:file", (c: Context) => {
    const token = (c.req.param("file") ?? "").replace(/\.ics$/, "");
    const userId = calendarFeeds.userOf(token);
    if (!userId) return c.text("Not found", 404);
    q.run("UPDATE routine_calendar_feeds SET last_read_at = ? WHERE user_id = ?", Date.now(), userId);
    return c.body(feedIcs(userId), 200, { "content-type": "text/calendar; charset=utf-8", "cache-control": "private, no-store", "x-robots-tag": "noindex" });
  });
}
