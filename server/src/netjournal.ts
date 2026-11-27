import { q } from "./db.js";
import { tr } from "./i18n.js";
import { audit, bots, now, rows, users, type BotRecord } from "./store.js";
import { securitySettings } from "./securitysettings.js";

/**
 * L39 — the network journal of each bot, and the alert on a host it never reached before (Timon audit, cleanroom T63,
 * written from the behaviour only).
 *
 * What is written: the HOST only (never a path, a query, a header or a body), how it was reached (`via`: page, fetch,
 * click, API, secret, relay, media…), first and last time, how many times. 2 000 hosts per bot, kept 30 days after
 * their last use. Recorded by the server where IT makes or sees the connection: web_fetch, browser_open, a click that
 * lands on another site (agent/clickhosts.ts), media_save, secret_use, api_get / api_send, the credential relay of the
 * bot's computer (egress.ts). What it cannot see is said in the view: programs on the bot's computer that go to the
 * internet by themselves, without the relay, and the sub-resources a page loads in the bot's browser.
 *
 * The alert: the first time a bot reaches a host it never reached, a line in its chat — at most one per bot every 15
 * minutes (the others carry the "new" badge in the journal) — when the owner turned alerts on (Settings → Security,
 * off by default, securitysettings.ts). Always, whatever the setting, for a host reached by a click after outside
 * content (L33): that one is never quiet.
 */
q.run(`CREATE TABLE IF NOT EXISTS bot_hosts (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, host TEXT NOT NULL, via TEXT NOT NULL DEFAULT '',
  first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, count INTEGER NOT NULL DEFAULT 1, tainted INTEGER NOT NULL DEFAULT 0, alerted INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bot_id, host))`);
q.run("CREATE INDEX IF NOT EXISTS bot_hosts_recent ON bot_hosts (bot_id, last_at)");

export const MAX_HOSTS = 2000;
const KEEP_MS = 30 * 24 * 3600_000;
export const ALERT_EVERY_MS = 15 * 60_000;
export type HostVia = "page" | "fetch" | "click" | "api" | "secret" | "relay" | "media" | "connector";
export interface HostEntry { host: string; via: string; firstAt: number; lastAt: number; count: number; tainted: boolean; fresh: boolean }

const lastAlert = new Map<string, number>();
/** A host name as it is kept: lower case, no "www.", no port; "" when it is not one. */
export function cleanHost(raw: unknown): string {
  const s = String(raw ?? "").trim().toLowerCase();
  let h = s;
  try { if (/^[a-z][a-z0-9+.-]*:\/\//.test(s)) h = new URL(s).hostname; } catch { return ""; }
  h = h.replace(/^\[|\]$/g, "").replace(/:\d+$/, "").replace(/^www\./, "").replace(/\.$/, "");
  return /^[a-z0-9.:_-]{1,253}$/.test(h) ? h : "";
}

/**
 * Notes that `bot` reached `host`. Returns whether it is a host this bot never reached. `force`: alert whatever the
 * setting and the 15-minute spacing (a click to another site after outside content), `tainted`: reached in a turn that
 * read outside content (shown in the journal).
 */
export function noteHost(bot: Pick<BotRecord, "id" | "userId" | "name">, rawHost: unknown, via: HostVia, opts: { tainted?: boolean; force?: boolean } = {}): boolean {
  const host = cleanHost(rawHost);
  if (!host) return false;
  const t = now();
  const had = q.get<{ count: number }>("SELECT count FROM bot_hosts WHERE bot_id = ? AND host = ?", bot.id, host);
  if (had) {
    q.run("UPDATE bot_hosts SET last_at = ?, count = count + 1, tainted = MAX(tainted, ?) WHERE bot_id = ? AND host = ?", t, opts.tainted ? 1 : 0, bot.id, host);
    return false;
  }
  q.run("INSERT INTO bot_hosts (bot_id, host, via, first_at, last_at, count, tainted) VALUES (?, ?, ?, ?, ?, 1, ?)", bot.id, host, via, t, t, opts.tainted ? 1 : 0);
  q.run("DELETE FROM bot_hosts WHERE bot_id = ? AND (last_at < ? OR host NOT IN (SELECT host FROM bot_hosts WHERE bot_id = ? ORDER BY last_at DESC LIMIT ?))", bot.id, t - KEEP_MS, bot.id, MAX_HOSTS);
  const on = securitySettings.get(bot.userId).netAlerts;
  if (opts.force || (on && t - (lastAlert.get(bot.id) ?? 0) >= ALERT_EVERY_MS)) {
    lastAlert.set(bot.id, t);
    q.run("UPDATE bot_hosts SET alerted = 1 WHERE bot_id = ? AND host = ?", bot.id, host);
    const full = bots.byId(bot.id);
    if (full) {
      const loc = users.localeOf(bot.userId);
      rows.append(full, { kind: "notice", tone: opts.force ? "warn" : "info", text: tr(loc, opts.force ? "{bot} followed a link to a new site, {host}, after reading outside content. Check that you expected it." : "{bot} reached a new site for the first time: {host} ({via}). Its network journal is in its settings (Security).", { bot: bot.name, host, via: tr(loc, VIA_LABEL[via]) }) });
      audit(bot.userId, "tool", `${bot.name}: new host ${host} (${via})`, bot.id);
    }
  }
  return true;
}

export const VIA_LABEL: Record<HostVia, string> = { page: "page opened", fetch: "page read", click: "click", api: "API call", secret: "call with a secret", relay: "program on its computer", media: "file downloaded", connector: "app" };

/** The journal of one bot, most recent first; `fresh`: first reached in the last 24 hours. */
export function hostJournal(botId: string, limit = 200): HostEntry[] {
  const t = now();
  return q.all<any>("SELECT * FROM bot_hosts WHERE bot_id = ? ORDER BY last_at DESC LIMIT ?", botId, Math.min(MAX_HOSTS, Math.max(1, limit)))
    .map((r) => ({ host: r.host, via: r.via, firstAt: r.first_at, lastAt: r.last_at, count: r.count, tainted: !!r.tainted, fresh: t - r.first_at < 24 * 3600_000 }));
}
/** Tests: forget the 15-minute spacing. */
export const resetHostAlerts = () => lastAlert.clear();
