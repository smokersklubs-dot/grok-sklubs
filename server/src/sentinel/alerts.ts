import { q } from "../db.js"; import { colon } from "../lang/index.js";
import type { Locale } from "../shared.js";
import { users } from "../store.js";
import { severityWord, word } from "./texts.js";
import { inQuiet, localClock, SEVERITY_RANK, sentinelSettings, toView, watchers, type IncidentRow } from "./view.js";

/**
 * Sentinelle — alerts to the people who watch the server (view.ts watchers), by push and/or e-mail, each with their own
 * settings (Réglages → Surveillance):
 *  - a new incident at or above their minimum severity (warn or critical; info never alerts at once) → one alert; the same
 *    incident never alerts twice, except once more if it becomes critical ("aggravé");
 *  - an incident they were alerted about that resolves → one "résolu" alert (none when it was acknowledged);
 *  - info incidents (and those under their minimum) → the daily digest, at their hour, only when there is something;
 *  - quiet hours: nothing goes out; what was due waits and goes at the end of the quiet hours (if still relevant);
 *  - rate limit: at most ALERT_LIMITS.perHour notifications an hour per person — everything due at one scan goes in ONE
 *    notification, and what is left waits for the next hour.
 * What was sent is recorded in sentinel_alerts (unique per person, incident and kind): this is the de-duplication.
 */
export const ALERT_LIMITS = { perHour: 4, resolvedWithinMs: 24 * 3_600_000, digestWindowMs: 24 * 3_600_000 };

export interface AlertSender {
  push(userId: string, title: string, body: string): Promise<number>;
  mail(to: string, subject: string, text: string): Promise<void>;
  mailReady(): boolean;
}
export interface SentAlert { userId: string; kind: "alert" | "digest"; items: { ref: string; kind: string }[]; channels: string[]; title: string }

type Item = { row: IncidentRow; kind: "open" | "critical" | "resolved" };

function alerted(userId: string, refs: string[]): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i < refs.length; i += 400) {
    const chunk = refs.slice(i, i + 400);
    for (const r of q.all<{ ref: string; kind: string }>(`SELECT ref, kind FROM sentinel_alerts WHERE user_id = ? AND ref IN (${chunk.map(() => "?").join(",")})`, userId, ...chunk)) out.add(`${r.ref}|${r.kind}`);
  }
  return out;
}
const record = (userId: string, items: { ref: string; kind: string }[], channels: string[], t: number) => {
  for (const it of items) q.run("INSERT OR IGNORE INTO sentinel_alerts (user_id, ref, kind, channels, at) VALUES (?, ?, ?, ?, ?)", userId, it.ref, it.kind, channels.join(","), t);
};
/** Notifications (not items) sent to a person in the hour before `t`: one notification = one instant. */
export const sentLastHour = (userId: string, t: number) => q.get<{ n: number }>("SELECT COUNT(DISTINCT at) AS n FROM sentinel_alerts WHERE user_id = ? AND at > ? AND kind IN ('open', 'critical', 'resolved')", userId, t - 3_600_000)?.n ?? 0;

/** What is due for one person now (before quiet hours and the rate limit). */
export function dueFor(userId: string, t: number): Item[] {
  const s = sentinelSettings.get(userId);
  const min = Math.max(1, SEVERITY_RANK[s.minSeverity]);
  const active = q.all<IncidentRow>("SELECT * FROM sentinel_incidents WHERE status != 'resolved' AND acked_at IS NULL AND severity IN ('warn', 'critical')").filter((r) => SEVERITY_RANK[r.severity] >= min);
  const resolved = q.all<IncidentRow>("SELECT * FROM sentinel_incidents WHERE status = 'resolved' AND acked_at IS NULL AND resolved_at >= ?", t - ALERT_LIMITS.resolvedWithinMs);
  const seen = alerted(userId, [...active, ...resolved].map((r) => r.id));
  const out: Item[] = [];
  for (const r of active) {
    if (r.severity === "critical" && !seen.has(`${r.id}|critical`)) out.push({ row: r, kind: "critical" });
    else if (r.severity === "warn" && !seen.has(`${r.id}|open`) && !seen.has(`${r.id}|critical`)) out.push({ row: r, kind: "open" });
  }
  for (const r of resolved) if ((seen.has(`${r.id}|open`) || seen.has(`${r.id}|critical`)) && !seen.has(`${r.id}|resolved`)) out.push({ row: r, kind: "resolved" });
  const rank = (i: Item) => (i.kind === "critical" ? 0 : i.kind === "open" ? 1 : 2);
  return out.sort((a, b) => rank(a) - rank(b) || b.row.last_at - a.row.last_at);
}

function compose(userId: string, loc: Locale, items: Item[], base: string): { title: string; body: string; text: string } {
  const opened = items.filter((i) => i.kind !== "resolved");
  const closed = items.filter((i) => i.kind === "resolved");
  const view = (r: IncidentRow) => toView(r, userId, loc, undefined);
  const wasOpen = (i: Item) => i.kind === "critical" && alerted(userId, [i.row.id]).has(`${i.row.id}|open`);
  let title: string;
  if (opened.length === 1 && !closed.length) title = `${wasOpen(opened[0]) ? word("escalated", loc) : severityWord(opened[0].row.severity, loc)}${colon(loc)}${view(opened[0].row).title}`;
  else if (opened.length) title = word("new_many", loc, { n: opened.length });
  else if (closed.length === 1) title = `${word("resolved_one", loc)}${colon(loc)}${view(closed[0].row).title}`;
  else title = word("resolved_many", loc, { n: closed.length });
  const lines = items.map((i) => { const v = view(i.row); return i.kind === "resolved" ? `✓ ${v.title}` : `${i.row.severity === "critical" ? "‼" : "!"} ${v.title}`; });
  const body = items.length === 1 ? (items[0].kind === "resolved" ? `${word("now_ok", loc)} ${view(items[0].row).title}` : view(items[0].row).explanation) : lines.join("\n");
  const link = `${base}/?view=surveillance`;
  const blocks = items.map((i) => {
    const v = view(i.row);
    if (i.kind === "resolved") return `✓ ${word("now_ok", loc)} ${v.title}`;
    return `[${severityWord(i.row.severity, loc)}] ${v.title}\n${v.explanation}\n${word("mail_fix", loc)} ${v.fix}`;
  });
  const text = `${word("mail_intro", loc)}\n\n${blocks.join("\n\n")}\n\n${word("mail_open", loc)} ${link}\n\n— Sklubot\n${word("mail_footer", loc)}\n`;
  return { title, body, text };
}

async function deliver(userId: string, s: ReturnType<typeof sentinelSettings.get>, send: AlertSender, msg: { title: string; body: string; text: string }): Promise<string[]> {
  const channels: string[] = [];
  if (s.push) { try { if ((await send.push(userId, msg.title, msg.body)) > 0) channels.push("push"); } catch (err) { console.error("[sentinel push]", (err as Error).message); } }
  const email = users.byId(userId)?.email;
  if (s.email && email && send.mailReady()) { try { await send.mail(email, `[Sklubot] ${msg.title}`, msg.text); channels.push("email"); } catch (err) { console.error("[sentinel mail]", (err as Error).message); } }
  return channels;
}

/** Sends what is due to every watcher. Returns what went out (for the scan's log and the tests). */
export async function dispatchAlerts(t: number, send: AlertSender, base: string): Promise<SentAlert[]> {
  const out: SentAlert[] = [];
  for (const userId of watchers()) {
    const s = sentinelSettings.get(userId);
    if (!s.push && !s.email) continue;
    if (inQuiet(s, t)) continue;
    const loc = users.localeOf(userId);
    const due = dueFor(userId, t);
    if (due.length && sentLastHour(userId, t) < ALERT_LIMITS.perHour) {
      const msg = compose(userId, loc, due, base);
      const channels = await deliver(userId, s, send, msg);
      const items = due.map((i) => ({ ref: i.row.id, kind: i.kind }));
      record(userId, items, channels, t);
      out.push({ userId, kind: "alert", items, channels, title: msg.title });
    }
    // The daily digest of info incidents (and those under the person's minimum severity), at their hour.
    const clock = localClock(t, s.timezone);
    const ref = `digest:${clock.date}`;
    if (s.digest && clock.hour >= s.digestHour && !alerted(userId, [ref]).has(`${ref}|digest`)) {
      const min = SEVERITY_RANK[s.minSeverity];
      const rows = q.all<IncidentRow>("SELECT * FROM sentinel_incidents WHERE last_at >= ? ORDER BY last_at DESC LIMIT 200", t - ALERT_LIMITS.digestWindowMs)
        .filter((r) => r.severity === "info" || SEVERITY_RANK[r.severity] < min);
      if (rows.length) {
        const views = rows.slice(0, 12).map((r) => toView(r, userId, loc, undefined));
        const lines = views.map((v) => `• ${v.title} — ${v.explanation}`);
        const title = word("digest_title", loc);
        const text = `${word("digest_intro", loc)}\n\n${lines.join("\n")}\n\n${word("mail_open", loc)} ${base}/?view=surveillance\n\n— Sklubot\n${word("mail_footer", loc)}\n`;
        const channels = await deliver(userId, s, send, { title, body: views.map((v) => v.title).join(" · "), text });
        record(userId, [{ ref, kind: "digest" }], channels, t);
        out.push({ userId, kind: "digest", items: rows.map((r) => ({ ref: r.id, kind: "digest" })), channels, title });
      }
    }
  }
  return out;
}
