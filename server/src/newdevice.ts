/**
 * L44 « Nouvel appareil »: when an account signs in from a browser or device it has never used, its owner gets an e-mail
 * and a notification (push to their devices, kept in the bell) with the time, the browser and system family and how they
 * signed in, and a « Ce n'est pas moi » link/button that ends that session and asks them to change their password.
 *
 * Recognising a device, without tracking: the first sign-in from a browser puts a random id in an httpOnly cookie
 * (`sklubot_device`, 400 days — the longest lifetime browsers keep, RFC 6265bis §5.5); the server keeps only
 * SHA-256("device:" + id) per account, with a coarse family ("Chrome|Windows") read from the User-Agent. No
 * fingerprinting, no IP address kept, no third-party geolocation: Sklubot has no place to show, so none is shown.
 * Every way in comes here (twofactor.ts openSession: password, Google, passkey, e-mail link, password reset, the one-time
 * link, the app's Google exchange); sign-ups and the very first sign-in of an account that has no known device yet (for
 * instance right after this feature arrives) only remember the device: there is nothing to compare with. Sign-ins to an
 * account still waiting for its address to be confirmed (publicsignup.ts) also only remember the device: no mail goes to
 * an unproven address but the confirmation link.
 *
 * Limits: at most 5 alerts (e-mail + push) per account per hour; more are still listed in Settings → Security and in
 * the audit log, without a message. The « Ce n'est pas moi » link works once, for 7 days; opening it only shows a page
 * with a button (a mail scanner that fetches links uses nothing up), the button posts the token.
 */
import type { Context, Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { originAllowed, SESSION_COOKIE } from "./auth.js";
import { mailConfigured, sendSystemMail } from "./accountmail.js";
import { config } from "./config.js";
import { db, q } from "./db.js";
import { pickLocale } from "./i18n.js";
import { pushSettings, sendPush } from "./push.js";
import type { Locale } from "./shared.js";
import { audit, now, randomToken, sha256, users } from "./store.js";
import { onSessionOpened } from "./twofactor.js";

db.exec(`
CREATE TABLE IF NOT EXISTS known_devices (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, device_hash TEXT NOT NULL, family TEXT NOT NULL,
  first_at INTEGER NOT NULL, last_at INTEGER NOT NULL, PRIMARY KEY (user_id, device_hash)
);
CREATE TABLE IF NOT EXISTS sign_in_alerts (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, session_hash TEXT NOT NULL,
  device_hash TEXT NOT NULL, family TEXT NOT NULL, via TEXT NOT NULL, at INTEGER NOT NULL, notified INTEGER NOT NULL DEFAULT 0,
  link_hash TEXT, link_expires INTEGER, denied_at INTEGER
);
CREATE INDEX IF NOT EXISTS sign_in_alerts_user ON sign_in_alerts(user_id, at);`);

export const DEVICE_COOKIE = "sklubot_device";
const DEVICE_MAX_AGE = 400 * 24 * 3600;
export const ALERTS_PER_HOUR = 5;
export const LINK_MS = 7 * 24 * 3600_000;
const KEEP_DEVICES = 50, KEEP_ALERTS = 50;

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "New sign-in to your Sklubot account": "Nouvelle connexion à ton compte Sklubot",
  "New sign-in: {family}": "Nouvelle connexion : {family}",
  "{browser} on {os}": "{browser} sur {os}",
  "an unknown browser": "un navigateur inconnu", "an unknown system": "un système inconnu", "the Sklubot app": "l'appli Sklubot",
  "password": "mot de passe", "Google": "Google", "Google (app)": "Google (appli)", "passkey": "clé d'accès", "e-mail link": "lien par e-mail",
  "password reset": "mot de passe oublié", "one-time link": "lien à usage unique", "sign-in": "connexion",
  "Someone just signed in to your Sklubot account ({email}) from a device we did not know.": "Quelqu'un vient de se connecter à ton compte Sklubot ({email}) depuis un appareil que nous ne connaissions pas.",
  "When: {when}": "Quand : {when}", "Browser and system: {family}": "Navigateur et système : {family}", "How: {via}": "Comment : {via}",
  "If it was you, there is nothing to do.": "Si c'est toi, tu n'as rien à faire.",
  "If it was not you, open this link: it ends that sign-in. Then change your password.": "Si ce n'est pas toi, ouvre ce lien : il ferme cette connexion. Change ensuite ton mot de passe.",
  "(The link works once, for 7 days.)": "(Le lien marche une seule fois, pendant 7 jours.)",
  "{family}, {when}. Not you? Open Settings → Security.": "{family}, {when}. Pas toi ? Ouvre Réglages → Sécurité.",
  "Was this you?": "C'est bien toi ?",
  "A sign-in from {family} ({via}) on {when}.": "Une connexion depuis {family} ({via}) le {when}.",
  "Not me: end that sign-in": "Ce n'est pas moi : fermer cette connexion",
  "Done: that sign-in is closed": "C'est fait : cette connexion est fermée",
  "That device is signed out and forgotten. Now change your password: open Sklubot, Settings → Account → Password. If you cannot sign in any more, use « Forgot password? » on the sign-in page.": "Cet appareil est déconnecté et oublié. Change maintenant ton mot de passe : ouvre Sklubot, Réglages → Compte → Mot de passe. Si tu ne peux plus te connecter, utilise « Mot de passe oublié ? » sur la page de connexion.",
  "Open Sklubot": "Ouvrir Sklubot",
  "This link has expired or was already used. You can still sign out other devices in Settings → Security.": "Ce lien a expiré ou a déjà servi. Tu peux encore déconnecter les autres appareils dans Réglages → Sécurité.",
  "That sign-in does not exist.": "Cette connexion n'existe pas.",
  "This is the device you are using now.": "C'est l'appareil que tu utilises en ce moment.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes et réessaie.",
};
const m = (locale: Locale, english: string, vars: Record<string, string> = {}) =>
  (locale === "fr" ? FR[english] ?? english : english).replace(/\{(\w+)\}/g, (_x, k: string) => vars[k] ?? "");
class DeviceError extends Error { constructor(public status: 403 | 404 | 409 | 410 | 429, message: string) { super(message); } }

// ── Device family (coarse, from the User-Agent) ─────────────────────────────────────────────────────────────────
export function deviceFamily(ua: string | null | undefined): string {
  const s = String(ua ?? "").slice(0, 512);
  const browser = /Sklubot|okhttp|Expo\b|ReactNative|Dalvik/i.test(s) ? "app"
    : /Edg(e|A|iOS)?\//.test(s) ? "Edge" : /OPR\/|Opera/.test(s) ? "Opera" : /SamsungBrowser/.test(s) ? "Samsung Internet"
    : /Firefox\/|FxiOS/.test(s) ? "Firefox" : /Chrome\/|CriOS|Chromium/.test(s) ? "Chrome" : /Safari\//.test(s) ? "Safari" : "";
  const os = /Windows/.test(s) ? "Windows" : /Android/.test(s) ? "Android" : /iPhone|iPad|iPod|iOS/.test(s) ? "iOS"
    : /Mac OS X|Macintosh/.test(s) ? "macOS" : /CrOS/.test(s) ? "ChromeOS" : /Linux/.test(s) ? "Linux" : "";
  return `${browser}|${os}`;
}
export function familyText(locale: Locale, family: string): string {
  const [browser = "", os = ""] = family.split("|");
  if (browser === "app") return os ? `${m(locale, "the Sklubot app")} (${os})` : m(locale, "the Sklubot app");
  return m(locale, "{browser} on {os}", { browser: browser || m(locale, "an unknown browser"), os: os || m(locale, "an unknown system") });
}
const viaText = (locale: Locale, via: string) => m(locale, via);

function whenText(userId: string, locale: Locale, at: number): string {
  let tz = "UTC";
  try { tz = pushSettings(userId).quiet.timezone || "UTC"; } catch { /* default */ }
  const fmt = (zone: string) => new Intl.DateTimeFormat(locale === "fr" ? "fr-FR" : "en-GB", { dateStyle: "full", timeStyle: "short", timeZone: zone }).format(new Date(at));
  try { return `${fmt(tz)} (${tz})`; } catch { return `${fmt("UTC")} (UTC)`; }
}

// ── Messages ─────────────────────────────────────────────────────────────────────────────────────────────────────
/** A security notification: push (always sent, kept in the bell) and, when the server can send e-mails, an e-mail. */
export function notifySecurity(userId: string, title: string, body: string, tag: string, mailText?: string): void {
  void sendPush(userId, { kind: "security", title, body, tag: `security-${tag}` }).catch((err) => console.error("[security-alert] push", (err as Error).message));
  const user = users.byId(userId);
  if (!user || !mailConfigured()) return;
  void sendSystemMail(user.email, title, mailText ?? body).catch((err) => console.error("[security-alert] mail not sent:", (err as Error).message));
}

// ── Sign-ins ─────────────────────────────────────────────────────────────────────────────────────────────────────
const secure = () => config.publicUrl.startsWith("https://");
const COOKIE_RE = /^[A-Za-z0-9_-]{32,64}$/;

/** Called for every session opened (twofactor.ts). Returns the alert id when the device was new and an alert was made. */
export function noteSignIn(c: Context, userId: string, tokenHash: string, via: string): string | null {
  let id = getCookie(c, DEVICE_COOKIE) ?? "";
  if (!COOKIE_RE.test(id)) id = randomToken(32);
  setCookie(c, DEVICE_COOKIE, id, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: DEVICE_MAX_AGE, secure: secure() });
  const deviceHash = sha256(`device:${id}`);
  const family = deviceFamily(c.req.header("user-agent"));
  const at = now();
  if (q.get("SELECT 1 FROM known_devices WHERE user_id = ? AND device_hash = ?", userId, deviceHash)) {
    q.run("UPDATE known_devices SET last_at = ?, family = ? WHERE user_id = ? AND device_hash = ?", at, family, userId, deviceHash);
    return null;
  }
  const firstEver = !q.get("SELECT 1 FROM known_devices WHERE user_id = ? LIMIT 1", userId);
  q.run("INSERT INTO known_devices (user_id, device_hash, family, first_at, last_at) VALUES (?, ?, ?, ?, ?)", userId, deviceHash, family, at, at);
  q.run("DELETE FROM known_devices WHERE user_id = ? AND device_hash NOT IN (SELECT device_hash FROM known_devices WHERE user_id = ? ORDER BY last_at DESC LIMIT ?)", userId, userId, KEEP_DEVICES);
  // Nothing to compare with on the account's first device. And no alert while the account's address is not confirmed yet
  // (publicsignup.ts holds it): that address is unproven, so alert e-mails would let anyone who signs up with someone
  // else's address mail them up to 5 times an hour by signing in again; the confirmation link is the only mail it gets.
  if (firstEver || q.get<{ p: number }>("SELECT email_verify_pending AS p FROM users WHERE id = ?", userId)?.p === 1) return null;
  const recent = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sign_in_alerts WHERE user_id = ? AND notified = 1 AND at > ?", userId, at - 3600_000)!.n;
  const notify = recent < ALERTS_PER_HOUR;
  const alertId = `sia_${randomToken(12)}`;
  const link = notify ? randomToken(32) : null;
  q.run("INSERT INTO sign_in_alerts (id, user_id, session_hash, device_hash, family, via, at, notified, link_hash, link_expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    alertId, userId, tokenHash, deviceHash, family, via, at, notify ? 1 : 0, link ? sha256(link) : null, link ? at + LINK_MS : null);
  q.run("DELETE FROM sign_in_alerts WHERE user_id = ? AND id NOT IN (SELECT id FROM sign_in_alerts WHERE user_id = ? ORDER BY at DESC LIMIT ?)", userId, userId, KEEP_ALERTS);
  const user = users.byId(userId);
  if (!user) return alertId;
  const locale = user.locale;
  audit(userId, "account", `Signed in from a new device (${familyText("en", family)}, ${via})${notify ? "" : " — alert not sent (more than 5 in an hour)"}`);
  if (notify && link) {
    const when = whenText(userId, locale, at), fam = familyText(locale, family);
    const mail = [
      m(locale, "Someone just signed in to your Sklubot account ({email}) from a device we did not know.", { email: user.email }), "",
      m(locale, "When: {when}", { when }), m(locale, "Browser and system: {family}", { family: fam }), m(locale, "How: {via}", { via: viaText(locale, via) }), "",
      m(locale, "If it was you, there is nothing to do."), "",
      m(locale, "If it was not you, open this link: it ends that sign-in. Then change your password."),
      `${config.publicUrl}/securite/pas-moi?t=${link}`, m(locale, "(The link works once, for 7 days.)"),
    ].join("\n");
    notifySecurity(userId, m(locale, "New sign-in: {family}", { family: fam }), m(locale, "{family}, {when}. Not you? Open Settings → Security.", { family: fam, when }), alertId, mail);
  }
  return alertId;
}
onSessionOpened((e) => { noteSignIn(e.c, e.userId, e.tokenHash, e.via); });

interface AlertRow { id: string; user_id: string; session_hash: string; device_hash: string; family: string; via: string; at: number; notified: number; link_hash: string | null; link_expires: number | null; denied_at: number | null }

/** « Ce n'est pas moi »: ends that session, forgets that device, uses up the link. */
export function denyAlert(a: AlertRow, how: "link" | "app"): void {
  q.tx(() => {
    q.run("DELETE FROM sessions WHERE token_hash = ? AND user_id = ?", a.session_hash, a.user_id);
    q.run("DELETE FROM known_devices WHERE user_id = ? AND device_hash = ?", a.user_id, a.device_hash);
    q.run("UPDATE sign_in_alerts SET denied_at = ?, link_hash = NULL, link_expires = NULL WHERE id = ?", now(), a.id);
  });
  audit(a.user_id, "account", `« Not me »: the sign-in from ${familyText("en", a.family)} was ended (${how === "link" ? "from the e-mail" : "in Settings"}); change the password`);
}

export interface SignInView { id: string; at: number; family: string; via: string; active: boolean; denied: boolean; current: boolean; notified: boolean }
export function signInAlerts(userId: string, currentToken: string | undefined, locale: Locale): SignInView[] {
  const mine = sha256(currentToken ?? "");
  return q.all<AlertRow & { active: number }>(
    "SELECT a.*, EXISTS (SELECT 1 FROM sessions s WHERE s.token_hash = a.session_hash AND s.expires_at > ?) AS active FROM sign_in_alerts a WHERE a.user_id = ? ORDER BY a.at DESC LIMIT 20", now(), userId,
  ).map((a) => ({ id: a.id, at: a.at, family: familyText(locale, a.family), via: viaText(locale, a.via), active: !!a.active, denied: a.denied_at !== null, current: a.session_hash === mine, notified: !!a.notified }));
}

// ── Pages and routes ─────────────────────────────────────────────────────────────────────────────────────────────
const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
function page(c: Context, locale: Locale, title: string, body: string, status: 200 | 400 | 410 = 200) {
  const html = `<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sklubot</title>
<style>body{font-family:system-ui,sans-serif;background:#f6f6f8;color:#1d1d24;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px}main{max-width:440px;background:#fff;border-radius:14px;padding:28px;box-shadow:0 6px 30px rgba(0,0,0,.08)}h1{font-size:1.25rem;margin:0 0 12px}p{line-height:1.5}button,a.btn{display:inline-block;font:inherit;font-weight:600;border:0;border-radius:10px;padding:12px 16px;background:#b3261e;color:#fff;cursor:pointer;text-decoration:none}a.btn{background:#4f46e5}@media(prefers-color-scheme:dark){body{background:#15151a;color:#ececf1}main{background:#1f1f26}}</style></head>
<body><main><h1>${esc(title)}</h1>${body}</main></body></html>`;
  return c.html(html, status, { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'" });
}
const byLink = (token: unknown): AlertRow | null => {
  if (typeof token !== "string" || !/^[A-Za-z0-9_-]{20,80}$/.test(token)) return null;
  const a = q.get<AlertRow>("SELECT * FROM sign_in_alerts WHERE link_hash = ?", sha256(token));
  return a && a.denied_at === null && (a.link_expires ?? 0) >= now() ? a : null;
};

export interface NewDeviceDeps { throttle(key: string, limit?: number): void; clientIp(c: Context): string }

export function registerNewDevicePublic(api: Hono<any>, site: Hono<any>, deps: NewDeviceDeps) {
  // The link of the e-mail: a page with a button, nothing used up by opening it.
  site.get("/securite/pas-moi", (c) => {
    const a = byLink(c.req.query("t"));
    const locale = a ? users.localeOf(a.user_id) : pickLocale(undefined, c.req.header("accept-language"));
    if (!a) return page(c, locale, "Sklubot", `<p>${esc(m(locale, "This link has expired or was already used. You can still sign out other devices in Settings → Security."))}</p><p><a class="btn" href="/">${esc(m(locale, "Open Sklubot"))}</a></p>`, 410);
    const text = m(locale, "A sign-in from {family} ({via}) on {when}.", { family: familyText(locale, a.family), via: viaText(locale, a.via), when: whenText(a.user_id, locale, a.at) });
    return page(c, locale, m(locale, "Was this you?"), `<p>${esc(text)}</p><form method="post" action="/api/auth/not-me"><input type="hidden" name="t" value="${esc(c.req.query("t") ?? "")}"><button type="submit">${esc(m(locale, "Not me: end that sign-in"))}</button></form><p><a href="/">${esc(m(locale, "Open Sklubot"))}</a></p>`);
  });
  api.post("/auth/not-me", async (c) => {
    const json = (c.req.header("content-type") ?? "").includes("application/json");
    const b = json ? await c.req.json().catch(() => ({})) as Record<string, unknown> : await c.req.parseBody().catch(() => ({})) as Record<string, unknown>;
    const locale = pickLocale(undefined, c.req.header("accept-language"));
    if (!originAllowed(c.req.header("origin"), c.req.header("host"))) return c.json({ error: m(locale, "Cross-site request refused.") }, 403);
    try { deps.throttle(`not-me:${deps.clientIp(c)}`, 20); } catch { return c.json({ error: m(locale, "Too many attempts. Wait a few minutes and try again.") }, 429); }
    const a = byLink(b.t);
    if (!a) return json ? c.json({ error: m(locale, "This link has expired or was already used. You can still sign out other devices in Settings → Security.") }, 410)
      : page(c, locale, "Sklubot", `<p>${esc(m(locale, "This link has expired or was already used. You can still sign out other devices in Settings → Security."))}</p>`, 410);
    denyAlert(a, "link");
    const own = users.localeOf(a.user_id);
    if (json) return c.json({ ok: true, changePassword: true });
    return page(c, own, m(own, "Done: that sign-in is closed"), `<p>${esc(m(own, "That device is signed out and forgotten. Now change your password: open Sklubot, Settings → Account → Password. If you cannot sign in any more, use « Forgot password? » on the sign-in page."))}</p><p><a class="btn" href="/?view=account">${esc(m(own, "Open Sklubot"))}</a></p>`);
  });
}

export function registerNewDevicePrivate(api: Hono<any>) {
  api.get("/account/sign-ins", (c) => {
    const user = c.get("user");
    return c.json({ signIns: signInAlerts(user.id, getCookie(c, SESSION_COOKIE), user.locale) });
  });
  api.post("/account/sign-ins/:alertId/not-me", (c) => {
    const user = c.get("user");
    try {
      const a = q.get<AlertRow>("SELECT * FROM sign_in_alerts WHERE id = ? AND user_id = ?", c.req.param("alertId") ?? "", user.id);
      if (!a) throw new DeviceError(404, "That sign-in does not exist.");
      if (a.session_hash === sha256(getCookie(c, SESSION_COOKIE) ?? "")) throw new DeviceError(409, "This is the device you are using now.");
      denyAlert(a, "app");
      return c.json({ ok: true, changePassword: true, signIns: signInAlerts(user.id, getCookie(c, SESSION_COOKIE), user.locale) });
    } catch (err) {
      if (err instanceof DeviceError) return c.json({ error: m(user.locale, err.message) }, err.status);
      throw err;
    }
  });
}
