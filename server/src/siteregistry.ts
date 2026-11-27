/**
 * L159 « registre vérifié des sites connectés » (backlog A-FAIRE L159; behaviour from the Noah audit: a site counts as
 * "connected" only after a check — the real page, no password field any more — and goes back to "to reconnect" when the
 * sign-in page comes back. Our own code.)
 *
 *  - Entry: a bot typed a saved password (vault_type, agent/tools.ts) into the password field of a site — Sklubot itself
 *    checked that field (tools-browser.ts typeSecret). The site is « à vérifier ».
 *  - Check: the next pages the bot reads on that site (element snapshots, agent/elements.ts). No password field → the
 *    site is « connecté » (verified at that time). A password field again, later than 2 minutes after the typing or once
 *    it was connected → « à reconnecter ».
 *  - The owner sees the list in Settings → Apps (GET /sites) and can forget a line. Nothing here is a secret: host, bot,
 *    login name and dates only.
 * A password field is told by the field's name (« mot de passe », "password"… in the usual languages): a heuristic, said
 * as such on the screen.
 */
import { q } from "./db.js";
import { bots, now } from "./store.js";

q.run(`CREATE TABLE IF NOT EXISTS site_logins (bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, host TEXT NOT NULL, user_id TEXT NOT NULL, item TEXT NOT NULL DEFAULT '', status TEXT NOT NULL, typed_at INTEGER NOT NULL, verified_at INTEGER, updated_at INTEGER NOT NULL, PRIMARY KEY (bot_id, host))`);
q.run("CREATE INDEX IF NOT EXISTS site_logins_user ON site_logins (user_id)");

export type SiteStatus = "checking" | "connected" | "reconnect";
export interface SiteLogin { botId: string; botName: string; host: string; item: string; status: SiteStatus; typedAt: number; verifiedAt: number | null; updatedAt: number }

const GRACE_MS = 120_000;
const PASSWORD_WORDS = /mot de passe|password|passwort|contrase[ñn]a|senha|wachtwoord|parola d'ordine|lösenord|hasło|пароль/i;

/** A page element that is a password field (by its name or hint). */
export const isPasswordField = (e: { role?: string; name?: string; hint?: string }) =>
  /textbox|searchbox|input|combobox/i.test(String(e.role ?? "")) && PASSWORD_WORDS.test(`${e.name ?? ""} ${e.hint ?? ""}`);

const hostOfUrl = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
/** Same site: equal hosts, or one a subdomain of the other (login.example.com ↔ example.com). */
export const sameSite = (a: string, b: string) => !!a && !!b && (a === b || a.endsWith(`.${b}`) || b.endsWith(`.${a}`));

/** A saved password was typed into a checked password field of `host`. */
export function noteLoginTyped(userId: string, botId: string, host: string, item: string, at = now()) {
  const h = host.toLowerCase().replace(/^www\./, "");
  if (!h) return;
  q.run(`INSERT INTO site_logins (bot_id, host, user_id, item, status, typed_at, verified_at, updated_at) VALUES (?, ?, ?, ?, 'checking', ?, NULL, ?)
    ON CONFLICT(bot_id, host) DO UPDATE SET item = excluded.item, status = 'checking', typed_at = excluded.typed_at, updated_at = excluded.updated_at`, botId, h, userId, item.slice(0, 80), at, at);
}

/** The bot read a page (element snapshot): checks the registered sites it is on. Returns the new status, if any changed. */
export function noteSitePage(botId: string, url: string, elements: { role?: string; name?: string; hint?: string; visible?: boolean }[], at = now()): SiteStatus | null {
  const host = hostOfUrl(url).replace(/^www\./, "");
  if (!host) return null;
  const rows = q.all<{ host: string; status: SiteStatus; typed_at: number }>("SELECT host, status, typed_at FROM site_logins WHERE bot_id = ?", botId).filter((r) => sameSite(r.host, host));
  if (!rows.length) return null;
  const login = elements.some((e) => e.visible !== false && isPasswordField(e));
  let changed: SiteStatus | null = null;
  for (const r of rows) {
    const next: SiteStatus = !login ? "connected" : r.status === "connected" || at - r.typed_at > GRACE_MS ? "reconnect" : r.status;
    if (next === r.status && next !== "connected") continue;
    q.run("UPDATE site_logins SET status = ?, verified_at = CASE WHEN ? = 'connected' THEN ? ELSE verified_at END, updated_at = ? WHERE bot_id = ? AND host = ?", next, next, at, at, botId, r.host);
    if (next !== r.status) changed = next;
  }
  return changed;
}

export const siteRegistry = {
  list(userId: string): SiteLogin[] {
    const names = new Map(bots.list(userId, true).map((b) => [b.id, b.name]));
    return q.all<any>("SELECT * FROM site_logins WHERE user_id = ? ORDER BY updated_at DESC LIMIT 200", userId)
      .map((r) => ({ botId: r.bot_id, botName: names.get(r.bot_id) ?? "?", host: r.host, item: r.item, status: r.status, typedAt: r.typed_at, verifiedAt: r.verified_at, updatedAt: r.updated_at }));
  },
  forget: (userId: string, botId: string, host: string) => q.run("DELETE FROM site_logins WHERE user_id = ? AND bot_id = ? AND host = ?", userId, botId, host).changes > 0,
};

/** Called from agent/elements.ts with each snapshot: never lets a registry problem break a page read. */
export function noteSnapshot(botId: string, s: { url: string; elements: { role?: string; name?: string; hint?: string; visible?: boolean }[] }) {
  try { noteSitePage(botId, s.url, s.elements); } catch { /* the registry is advice, never in the way */ }
}
