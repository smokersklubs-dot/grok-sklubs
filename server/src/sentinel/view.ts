import { q } from "../db.js";
import { hostedMode, isOperator, ownerAccountId } from "../hosted.js";
import { SENTINEL_SEVERITIES, type Locale, type SentinelIncidentView, type SentinelLink, type SentinelSettings, type SentinelSeverity, type SentinelState } from "../shared.js";
import { bots, now, users } from "../store.js";
import { userTimezone } from "../usagecaps.js";
import { linkFor, render, word, type TextVars } from "./texts.js";

/**
 * Sentinelle — who may see the incidents, how an incident is shown to them, and their alert settings.
 *
 * The watchers: the server's owner (the oldest account), and in hosted mode the operators (hosted.ts isOperator).
 * Nobody else sees the page or its routes (404, like /api/health/deep). An incident about another account names it by
 * its e-mail and never shows that account's bot or routine names; the viewer's own are named.
 */
export const canWatch = (userId: string): boolean => (hostedMode() ? isOperator(userId) : userId === ownerAccountId());
/** Everyone who watches this server (the owner first). */
export function watchers(): string[] {
  const owner = ownerAccountId();
  if (!owner) return [];
  if (!hostedMode()) return [owner];
  const ops = q.all<{ id: string }>("SELECT id FROM users WHERE server_role = 'operator' AND id != ? ORDER BY created_at", owner).map((r) => r.id);
  return [owner, ...ops];
}

export interface IncidentRow {
  id: string; fingerprint: string; kind: string; severity: SentinelSeverity; status: "open" | "ongoing" | "resolved"; params: string;
  user_id: string | null; bot_id: string | null; count: number; peak: number; seen: number; first_at: number; last_at: number;
  resolved_at: number | null; acked_at: number | null; acked_by: string | null;
}
export const SEVERITY_RANK: Record<SentinelSeverity, number> = { info: 0, warn: 1, critical: 2 };
export const stateOf = (r: Pick<IncidentRow, "status" | "acked_at">): SentinelState => (r.status === "resolved" ? "resolved" : r.acked_at ? "acknowledged" : r.status);
export const parseParams = (raw: string): Record<string, string | number> => { try { const v = JSON.parse(raw); return v && typeof v === "object" ? v : {}; } catch { return {}; } };

const HOUR = 3_600_000;
/** The measure per hour over the 24 hours up to `t` (oldest first), per incident. */
export function sparklines(ids: string[], t = now()): Map<string, number[]> {
  const out = new Map<string, number[]>();
  if (!ids.length) return out;
  const top = Math.floor(t / HOUR) * HOUR;
  const from = top - 23 * HOUR;
  for (const id of ids) out.set(id, new Array(24).fill(0));
  for (let i = 0; i < ids.length; i += 400) {
    const chunk = ids.slice(i, i + 400);
    for (const r of q.all<{ incident_id: string; hour: number; value: number }>(`SELECT incident_id, hour, value FROM sentinel_samples WHERE hour >= ? AND incident_id IN (${chunk.map(() => "?").join(",")})`, from, ...chunk)) {
      const at = Math.round((r.hour - from) / HOUR);
      const line = out.get(r.incident_id);
      if (line && at >= 0 && at < 24) line[at] = r.value;
    }
  }
  return out;
}

/** The names an incident may show to this viewer, and where "Ouvrir" goes for them. */
function namesFor(r: IncidentRow, params: Record<string, string | number>, viewer: string, loc: Locale): { vars: TextVars; link: SentinelLink | null; account: string | null } {
  const own = !r.user_id || r.user_id === viewer;
  const email = r.user_id && !own ? users.byId(r.user_id)?.email ?? null : null;
  const accountWord = own ? word("your_account", loc) : email ?? word("removed_account", loc);
  const vars: TextVars = { account: accountWord };
  let link = linkFor(r.kind);
  const bot = r.bot_id ? bots.byId(r.bot_id) : null;
  if (r.kind === "tool_errors") {
    vars.bot = bot ? (own ? bot.name : word("some_bot", loc, { account: accountWord })) : word("removed_bot", loc);
    link = bot && own ? { kind: "bot", botId: bot.id } : null;
  }
  if (r.kind === "routine_failures") {
    const name = typeof params.routineId === "string" ? q.get<{ name: string }>("SELECT name FROM routines WHERE id = ?", params.routineId)?.name : undefined;
    vars.routine = own && name ? `« ${name} »${bot ? ` (${bot.name})` : ""}` : word("some_routine", loc, { account: accountWord });
    link = bot && own ? { kind: "botSettings", botId: bot.id, tab: "routines" } : null;
  }
  // Settings links only make sense for the viewer's own account (the operator administers the others).
  if (!own && link?.kind === "settings" && link.section !== "admin") link = hostedMode() ? { kind: "settings", section: "admin" } : null;
  return { vars, link, account: own ? null : email };
}

export function toView(r: IncidentRow, viewer: string, loc: Locale, spark: number[] | undefined): SentinelIncidentView {
  const params = parseParams(r.params);
  const { vars, link, account } = namesFor(r, params, viewer, loc);
  const text = render(r.kind, params, vars, loc);
  return {
    id: r.id, fingerprint: r.fingerprint, kind: r.kind, severity: r.severity, state: stateOf(r), ...text,
    count: r.count, peak: r.peak, seen: r.seen, firstAt: r.first_at, lastAt: r.last_at, resolvedAt: r.resolved_at,
    ackedAt: r.acked_at, ackedBy: r.acked_by ? users.byId(r.acked_by)?.name ?? null : null,
    sparkline: spark ?? new Array(24).fill(0), link, account,
  };
}

const ORDER = "CASE severity WHEN 'critical' THEN 0 WHEN 'warn' THEN 1 ELSE 2 END, last_at DESC";
export const activeRows = (): IncidentRow[] => q.all<IncidentRow>(`SELECT * FROM sentinel_incidents WHERE status != 'resolved' ORDER BY ${ORDER} LIMIT 500`);
export const historyRows = (limit = 100): IncidentRow[] => q.all<IncidentRow>("SELECT * FROM sentinel_incidents WHERE status = 'resolved' ORDER BY resolved_at DESC LIMIT ?", limit);
export const incidentRow = (id: string): IncidentRow | null => q.get<IncidentRow>("SELECT * FROM sentinel_incidents WHERE id = ?", id) ?? null;

export function views(rows: IncidentRow[], viewer: string, t = now()): SentinelIncidentView[] {
  const loc = users.localeOf(viewer);
  const spark = sparklines(rows.map((r) => r.id), t);
  return rows.map((r) => toView(r, viewer, loc, spark.get(r.id)));
}

/** "Aujourd'hui": the critical incidents not acknowledged yet, for a watcher (nobody else gets any). */
export function criticalNeeds(userId: string): { id: string; title: string; detail: string; at: number }[] {
  if (!canWatch(userId)) return [];
  const rows = q.all<IncidentRow>("SELECT * FROM sentinel_incidents WHERE status != 'resolved' AND severity = 'critical' AND acked_at IS NULL ORDER BY last_at DESC LIMIT 5");
  const loc = users.localeOf(userId);
  return rows.map((r) => { const v = toView(r, userId, loc, undefined); return { id: r.id, title: v.title, detail: v.explanation, at: r.first_at }; });
}

// ── Settings (Réglages → Surveillance) ─────────────────────────────────────────────────────────────────────────────
export const DEFAULT_SETTINGS: SentinelSettings = { push: true, email: true, minSeverity: "warn", digest: true, digestHour: 9, quiet: { enabled: false, start: "22:00", end: "07:00" }, timezone: "UTC" };
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const validZone = (tz: string) => { try { new Intl.DateTimeFormat("en", { timeZone: tz }); return true; } catch { return false; } };

export class SentinelError extends Error { constructor(public status: 400 | 404 | 409 | 429, message: string) { super(message); } }

/** Cleans settings from the browser (or the database); `strict` throws on a bad value instead of keeping the base's. */
export function cleanSettings(raw: any, base: SentinelSettings = DEFAULT_SETTINGS, strict = false): SentinelSettings {
  const bad = (msg: string) => { if (strict) throw new SentinelError(400, msg); };
  const out: SentinelSettings = { ...base, quiet: { ...base.quiet } };
  if (!raw || typeof raw !== "object") return out;
  for (const k of ["push", "email", "digest"] as const) if (raw[k] !== undefined) { if (typeof raw[k] === "boolean") out[k] = raw[k]; else bad("Invalid value."); }
  if (raw.minSeverity !== undefined) { if ((SENTINEL_SEVERITIES as readonly string[]).includes(raw.minSeverity)) out.minSeverity = raw.minSeverity; else bad("Unknown severity."); }
  if (raw.digestHour !== undefined) { const h = Number(raw.digestHour); if (Number.isInteger(h) && h >= 0 && h <= 23) out.digestHour = h; else bad("Choose an hour between 0 and 23."); }
  if (raw.timezone !== undefined) { const tz = String(raw.timezone).trim(); if (tz && tz.length <= 64 && validZone(tz)) out.timezone = tz; else bad("Unknown time zone."); }
  if (raw.quiet && typeof raw.quiet === "object") {
    if (raw.quiet.enabled !== undefined) { if (typeof raw.quiet.enabled === "boolean") out.quiet.enabled = raw.quiet.enabled; else bad("Invalid value."); }
    for (const k of ["start", "end"] as const) if (raw.quiet[k] !== undefined) { if (HHMM.test(String(raw.quiet[k]))) out.quiet[k] = String(raw.quiet[k]); else bad("Quiet hours are written HH:MM."); }
  }
  return out;
}
export const sentinelSettings = {
  get(userId: string): SentinelSettings {
    const raw = q.get<{ value: string }>("SELECT value FROM sentinel_settings WHERE user_id = ?", userId)?.value;
    let v: any = {};
    try { v = raw ? JSON.parse(raw) : {}; } catch { /* defaults */ }
    return cleanSettings(v, { ...DEFAULT_SETTINGS, timezone: userTimezone(userId) });
  },
  save(userId: string, raw: unknown): SentinelSettings {
    const next = cleanSettings(raw, sentinelSettings.get(userId), true);
    q.run("INSERT INTO sentinel_settings (user_id, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at", userId, JSON.stringify(next), now());
    return next;
  },
};
/** Local "HH:MM" and "YYYY-MM-DD" in a time zone. */
export function localClock(t: number, tz: string): { hm: string; hour: number; date: string } {
  try {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((p) => [p.type, p.value]));
    return { hm: `${parts.hour}:${parts.minute}`, hour: Number(parts.hour), date: `${parts.year}-${parts.month}-${parts.day}` };
  } catch { const d = new Date(t).toISOString(); return { hm: d.slice(11, 16), hour: Number(d.slice(11, 13)), date: d.slice(0, 10) }; }
}
export function inQuiet(s: SentinelSettings, t: number): boolean {
  if (!s.quiet.enabled) return false;
  const { hm } = localClock(t, s.timezone);
  const { start, end } = s.quiet;
  if (start === end) return false;
  return start < end ? hm >= start && hm < end : hm >= start || hm < end;
}
