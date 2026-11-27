/**
 * "Ouverture publique" (docs/OUVERTURE-PUBLIQUE.md): what a server open to strangers needs on top of OPEN_SIGNUP —
 * the public landing page's data, anti-bot checks on sign-up, e-mail verification of new accounts, and the guided first run.
 *
 * Everything here is off unless the operator turns it on. With OPEN_SIGNUP and HOSTED_MODE both off (the default), every
 * check below answers "nothing to do", the landing route answers 404 like an unknown address, and no account is ever
 * marked unverified or sent to the first run: the server behaves exactly as before.
 *
 *  - Landing (GET /api/public/landing): only while OPEN_SIGNUP=1. The real template gallery (titles, descriptions, the
 *    bots' looks — never the files' instructions), the offered plans in hosted mode, and the Turnstile site key.
 *  - Anti-bot on open sign-ups (not on the very first account, not on an invitation):
 *      · Cloudflare Turnstile when TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY are both set. The token is checked on the
 *        server with Siteverify (https://developers.cloudflare.com/turnstile/get-started/server-side-validation/):
 *        POST https://challenges.cloudflare.com/turnstile/v0/siteverify, JSON body { secret, response, remoteip,
 *        idempotency_key }; answer { success, "error-codes", challenge_ts, hostname, action, cdata }. A token is at most
 *        2048 characters, valid 300 s, single use. The secret never leaves the server (only the site key is sent to
 *        browsers). Any failure to reach Siteverify refuses the sign-up (fail closed).
 *      · Rate limits on top of the existing per-address one: SIGNUP_PER_IP (default 5) and SIGNUP_GLOBAL (default 30)
 *        attempts per quarter hour, through routes.ts's throttle.
 *      · A small built-in list of disposable e-mail domains (DISPOSABLE_EMAIL_BLOCK=0 turns it off).
 *  - E-mail verification is MANDATORY whenever it applies (OPEN_SIGNUP or HOSTED_MODE, and EMAIL_VERIFICATION is not 0):
 *    "compte obligatoire, sinon ça ne fonctionne pas". A new password account gets a link (32 random bytes, only its
 *    SHA-256 stored, single use, valid until the account's deadline). Until it is opened the account can sign in, but
 *    the session middleware (routes.ts → emailGateBlocks) answers 403 { code: "email_unverified" } to every route except
 *    the few that let it confirm, change its address, sign out, export or delete itself (EMAIL_GATE_ALLOWED); the voice,
 *    relay and screen sockets refuse it too; its first bot is only created once the address is proven (first_bot,
 *    migration 14). Google sign-in counts as verified (googlelogin.ts requires `email_verified`). Accounts that existed
 *    before migration 13, and the owner (the oldest account), are never held.
 *  - Without SMTP the server cannot send the link: password sign-ups (other than the very first account) are refused
 *    with a clear message ("utilise Continuer avec Google"); Google sign-ups still work. The Sentinelle raises it.
 *  - An account still unverified UNVERIFIED_ACCOUNT_TTL_HOURS (default 5) after its creation is deleted by the
 *    scheduler's sweep (sweepUnverified, every 10 minutes), with an entry in the owner's activity log. A resent link
 *    never goes past that deadline.
 *  - First run: new public accounts get onboarding_pending; POST /onboarding/commit uses the team-file import
 *    (teamfile.ts: careful autonomy, draft skills, paused routines, the account's default model) within the plan's room.
 */
import { randomUUID } from "node:crypto"; import { localize } from "./lang/index.js"; import { isLocale } from "./clientshared/locales.js"; import { byLocale } from "./lang/index.js";
import type { Context, Hono } from "hono";
import { mailConfigured, sendSystemMail } from "./accountmail.js";
import { originAllowed } from "./auth.js";
import { config } from "./config.js";
import { creditPacks, paymentsOn } from "./credits.js";
import { q } from "./db.js";
import { HostedError, hostedMode, hostedSettings, isPlanLimit, planLimitError, planRoom, plans } from "./hosted.js";
import { pickLocale, tr } from "./i18n.js";
import { ideasFromSubjects } from "./ideas.js";
import { freeMax } from "./freecomputers.js";
import { guardedFetch } from "./net.js";
import type { Locale } from "./shared.js";
import { audit, bots, now, randomToken, sha256, users, type BotRecord, type UserRecord } from "./store.js";
import { commitTeamFile, previewTeamFile, templateList } from "./teamfile.js";

/** How long an unverified account lives (UNVERIFIED_ACCOUNT_TTL_HOURS, default 5 h, between 1 h and 30 days). */
export const unverifiedTtlMs = () => intEnv("UNVERIFIED_ACCOUNT_TTL_HOURS", 5, 1, 720) * 3_600_000;
export const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

// ── Settings (environment only: the operator's choice, read each time so tests can change them) ───────────────────
const env = (k: string) => (process.env[k] ?? "").trim();
const intEnv = (k: string, dflt: number, min: number, max: number) => { const n = Math.floor(Number(env(k))); return env(k) && Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : dflt; };
/** The public landing page and the anti-bot checks follow OPEN_SIGNUP. */
export const landingOn = () => config.openSignup;
/** Turnstile: both keys or nothing. The secret is only ever read here. */
export function turnstileKeys(): { siteKey: string; secret: string } | null {
  const siteKey = env("TURNSTILE_SITE_KEY"), secret = env("TURNSTILE_SECRET_KEY");
  return siteKey && secret ? { siteKey, secret } : null;
}
/** Verification is wanted on a public server (open sign-ups or hosted mode), unless EMAIL_VERIFICATION=0. */
export const verificationWanted = () => (config.openSignup || hostedMode()) && !["0", "false", "off"].includes(env("EMAIL_VERIFICATION").toLowerCase());
/** …and links can be sent only when this server can send e-mails (without SMTP, password sign-ups are refused). */
export const verificationActive = () => verificationWanted() && mailConfigured();
/** The server's owner: the oldest account (never held by the verification). */
const ownerIdOf = () => q.get<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1")?.id ?? null;

// ── Texts (English is the key) ───────────────────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "The anti-robot check is missing. Wait for it to finish, then try again.": "La vérification anti-robot manque. Attends qu'elle se termine, puis réessaie.",
  "The anti-robot check failed or expired. Do it again, then create your account.": "La vérification anti-robot a échoué ou a expiré. Refais-la, puis crée ton compte.",
  "The anti-robot check could not be done right now. Try again in a minute.": "La vérification anti-robot n'a pas pu se faire pour l'instant. Réessaie dans une minute.",
  "Use a permanent e-mail address: temporary addresses are not accepted here.": "Utilise une adresse e-mail permanente : les adresses temporaires ne sont pas acceptées ici.",
  "This link has expired or was already used. Sign in and ask for a new one.": "Ce lien a expiré ou a déjà servi. Connecte-toi et demandes-en un nouveau.",
  "This server cannot send e-mails, so there is nothing to confirm.": "Ce serveur ne peut pas envoyer d'e-mails : il n'y a rien à confirmer.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "That template does not exist.": "Ce modèle n'existe pas.",
  "The first run is already done.": "La première prise en main est déjà faite.",
  "Confirm your e-mail address first: open the link we sent to {email}. Your bots start working as soon as it is confirmed.":
    "Confirme d'abord ton adresse e-mail : ouvre le lien envoyé à {email}. Tes bots se mettent au travail dès qu'elle est confirmée.",
  "Confirm your e-mail address to use Sklubot: open the link we sent to {email}.": "Confirme ton adresse e-mail pour utiliser Sklubot : ouvre le lien envoyé à {email}.",
  "Sign-ups by e-mail are closed until this server's e-mails are set up — use “Continue with Google”.":
    "Les inscriptions par e-mail sont fermées tant que les e-mails du serveur ne sont pas réglés — utilise « Continuer avec Google ».",
};
const m = (loc: Locale | undefined, english: string, vars: Record<string, string | number> = {}) =>
  localize(loc, english, FR).replace(/\{(\w+)\}/g, (_x, k) => String(vars[k] ?? ""));

/** A refusal with its French text (routes.ts's onError treats it as a HostedError: status, text, code). */
export class PublicSignupError extends HostedError {
  constructor(status: 400 | 403 | 404 | 409, english: string, code: string, vars: Record<string, string | number> = {}) { super(status, english, vars, code); this.name = "PublicSignupError"; }
  override text(locale: Locale | undefined) { return m(locale, this.english, this.vars); }
}

// ── Disposable addresses ─────────────────────────────────────────────────────────────────────────────────────────
/** A short list of well-known throwaway-mail domains (and their subdomains). Not exhaustive; DISPOSABLE_EMAIL_BLOCK=0 turns it off. */
export const DISPOSABLE_DOMAINS = new Set([
  "mailinator.com", "guerrillamail.com", "guerrillamail.net", "guerrillamail.org", "sharklasers.com", "grr.la", "10minutemail.com",
  "10minutemail.net", "tempmail.com", "temp-mail.org", "temp-mail.io", "tempmailo.com", "tempail.com", "throwawaymail.com",
  "yopmail.com", "yopmail.fr", "yopmail.net", "trashmail.com", "trashmail.de", "getnada.com", "nada.email", "dispostable.com",
  "maildrop.cc", "mailnesia.com", "mintemail.com", "mohmal.com", "emailondeck.com", "fakeinbox.com", "spamgourmet.com",
  "mytemp.email", "tempr.email", "discard.email", "mailcatch.com", "moakt.com", "burnermail.io", "inboxkitten.com",
  "jetable.org", "spambox.us", "1secmail.com", "1secmail.net", "1secmail.org", "emailfake.com", "crazymailing.com",
]);
export function disposableEmail(email: string): boolean {
  if (["0", "false", "off"].includes(env("DISPOSABLE_EMAIL_BLOCK").toLowerCase())) return false;
  const domain = email.trim().toLowerCase().split("@").pop() ?? "";
  const parts = domain.split(".");
  for (let i = 0; i < parts.length - 1; i++) if (DISPOSABLE_DOMAINS.has(parts.slice(i).join("."))) return true;
  return false;
}

// ── Turnstile (Siteverify) ───────────────────────────────────────────────────────────────────────────────────────
export interface SiteverifyAnswer { success?: boolean; "error-codes"?: string[]; hostname?: string; action?: string }
type Siteverify = (body: { secret: string; response: string; remoteip?: string; idempotency_key: string }) => Promise<SiteverifyAnswer>;
const realSiteverify: Siteverify = async (body) => {
  // JSON is one of the two accepted request types (the other is application/x-www-form-urlencoded).
  const res = await guardedFetch(SITEVERIFY_URL, { method: "POST", headers: { "content-type": "application/json", accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
  if (!res.ok) throw new Error(`siteverify answered ${res.status}`);
  return (await res.json()) as SiteverifyAnswer;
};
let siteverify: Siteverify = realSiteverify;
/** Tests: a fake Siteverify (null puts the real one back). */
export const _setSiteverify = (fn: Siteverify | null) => { siteverify = fn ?? realSiteverify; };

const publicHost = () => { try { return new URL(config.publicUrl).hostname; } catch { return ""; } };
const LOCAL = /^(localhost|127\.|\[?::1\]?$)/;

/** Throws PublicSignupError unless the Turnstile token is good (no-op when Turnstile is not configured). */
export async function checkTurnstile(token: unknown, ip: string): Promise<void> {
  const keys = turnstileKeys();
  if (!keys) return;
  // "The token from the client-side widget" — at most 2048 characters.
  if (typeof token !== "string" || !token || token.length > 2048) throw new PublicSignupError(400, "The anti-robot check is missing. Wait for it to finish, then try again.", "turnstile");
  let answer: SiteverifyAnswer;
  try {
    answer = await siteverify({ secret: keys.secret, response: token, ...(ip ? { remoteip: ip } : {}), idempotency_key: randomUUID() });
  } catch (err) {
    console.error(`[signup] Turnstile Siteverify unreachable: ${(err as Error).message}`);
    throw new PublicSignupError(403, "The anti-robot check could not be done right now. Try again in a minute.", "turnstile");
  }
  const host = publicHost();
  // The widget must have been solved on this site, for this form (when the answer says so).
  const hostOk = !answer.hostname || !host || LOCAL.test(host) || answer.hostname === host || env("TURNSTILE_CHECK_HOSTNAME") === "0";
  const actionOk = !answer.action || answer.action === "signup";
  if (answer.success !== true || !hostOk || !actionOk) throw new PublicSignupError(403, "The anti-robot check failed or expired. Do it again, then create your account.", "turnstile");
}

// ── The sign-up gate ─────────────────────────────────────────────────────────────────────────────────────────────
export interface PublicSignupDeps { throttle(key: string, limit?: number): void; clientIp(c: Context): string }
let deps: PublicSignupDeps | null = null;

/**
 * Checks of an OPEN sign-up (OPEN_SIGNUP on, not the very first account, not an invitation), before anything is created:
 * rate limits, disposable address, then Turnstile (last: its token is single use). Google sign-ups only get the first two
 * (publicSignupChecks): Google's sign-in is its own proof of a person, and the widget cannot sit on Google's page.
 */
export async function publicSignupGate(c: Context, f: { email: string; token?: unknown; first: boolean; invited: boolean }): Promise<void> {
  if (!publicSignupChecks(c, f, false)) return;
  await checkTurnstile(f.token, deps!.clientIp(c));
  // Counted after Turnstile: robots without a valid token cannot use up everyone's quota.
  deps!.throttle("signup-pub-all", intEnv("SIGNUP_GLOBAL", 30, 1, 100_000));
}
/** The synchronous part (rate limits, disposable address): all Google sign-ups get. True when the sign-up is an open one. */
export function publicSignupChecks(c: Context, f: { email: string; first: boolean; invited: boolean }, global = true): boolean {
  if (!config.openSignup || f.first || f.invited || !deps) return false;
  const ip = deps.clientIp(c);
  deps.throttle(`signup-pub-ip:${ip}`, intEnv("SIGNUP_PER_IP", 5, 1, 1000));
  if (global) deps.throttle("signup-pub-all", intEnv("SIGNUP_GLOBAL", 30, 1, 100_000));
  if (disposableEmail(f.email)) throw new PublicSignupError(400, "Use a permanent e-mail address: temporary addresses are not accepted here.", "disposable_email");
  return true;
}

// ── After an account is created ──────────────────────────────────────────────────────────────────────────────────
/**
 * A new account made by sign-up (form or Google): the first run for public servers, and the verification link when it
 * applies. `verified`: the address is proven already (Google). The very first account (the owner) gets neither.
 * Returns true when the account must confirm its address first: then its first bot is NOT created now — `firstBot`
 * (the name and role chosen on the form) is kept and the bot is made by markVerified.
 */
export function accountOpened(user: UserRecord, o: { first: boolean; verified: boolean; firstBot?: { name: string; label: string } }): boolean {
  if (o.verified) q.run("UPDATE users SET email_verified_at = ? WHERE id = ?", now(), user.id);
  if (o.first) return false;
  if (config.openSignup || hostedMode()) q.run("UPDATE users SET onboarding_pending = 1 WHERE id = ?", user.id);
  if (!o.verified && verificationWanted()) {
    // Mandatory: held until the link is opened (signup refuses this case without SMTP, see emailSignupClosed).
    q.run("UPDATE users SET email_verify_pending = 1, first_bot = ? WHERE id = ?", JSON.stringify(o.firstBot ?? null), user.id);
    if (mailConfigured()) sendVerification(user);
    return true;
  }
  if (!o.verified) {
    // Verification turned off by the operator (EMAIL_VERIFICATION=0), or a private server: counted as verified.
    q.run("UPDATE users SET email_verified_at = ? WHERE id = ?", now(), user.id);
  }
  return false;
}

/**
 * Password sign-ups (not the very first account) need a verification e-mail: without SMTP they are refused, with a
 * clear way forward (Google proves the address by itself). Throws PublicSignupError (403, code "email_signup_closed").
 */
export function assertEmailSignupPossible(first: boolean) {
  if (!first && verificationWanted() && !mailConfigured())
    throw new PublicSignupError(403, "Sign-ups by e-mail are closed until this server's e-mails are set up — use “Continue with Google”.", "email_signup_closed");
}

/** When an unverified account is deleted: its creation time + UNVERIFIED_ACCOUNT_TTL_HOURS. */
export function verifyDeadline(userId: string): number | null {
  const r = q.get<{ created_at: number }>("SELECT created_at FROM users WHERE id = ?", userId);
  return r ? r.created_at + unverifiedTtlMs() : null;
}

const hoursLeft = (ms: number) => Math.max(1, Math.round(ms / 3_600_000));
const MAIL = {
  fr: (link: string, h: number) => ({ subject: "Sklubot : confirme ton adresse e-mail", text: `Bonjour,\n\nBienvenue sur Sklubot ! Pour confirmer ton adresse et pouvoir utiliser Sklubot, ouvre ce lien (une seule fois) :\n${link}\n\nSans confirmation dans les ${h} heure(s), le compte et ses données sont supprimés automatiquement.\nSi tu n'as pas créé de compte, ignore cet e-mail.\n\n— Sklubot (${config.publicUrl})` }),
  en: (link: string, h: number) => ({ subject: "Sklubot: confirm your e-mail address", text: `Hello,\n\nWelcome to Sklubot! To confirm your address and start using Sklubot, open this link (once):\n${link}\n\nWithout confirmation within ${h} hour(s), the account and its data are deleted automatically.\nIf you did not create an account, ignore this e-mail.\n\n— Sklubot (${config.publicUrl})` }),
  es: (link: string, h: number) => ({ subject: "Sklubot: confirma tu dirección de correo", text: `Hola:\n\n¡Te damos la bienvenida a Sklubot! Para confirmar tu dirección y empezar a usar Sklubot, abre este enlace (una sola vez):\n${link}\n\nSi no la confirmas en ${h} hora(s), la cuenta y sus datos se borrarán automáticamente.\nSi no has creado ninguna cuenta, ignora este correo.\n\n— Sklubot (${config.publicUrl})` }),
  de: (link: string, h: number) => ({ subject: "Sklubot: Bestätige deine E-Mail-Adresse", text: `Hallo,\n\nwillkommen bei Sklubot! Um deine Adresse zu bestätigen und Sklubot zu nutzen, öffne diesen Link (nur einmal):\n${link}\n\nOhne Bestätigung innerhalb von ${h} Stunde(n) werden das Konto und seine Daten automatisch gelöscht.\nWenn du kein Konto erstellt hast, ignoriere diese E-Mail.\n\n— Sklubot (${config.publicUrl})` }),
  it: (link: string, h: number) => ({ subject: "Sklubot: conferma il tuo indirizzo email", text: `Ciao,\n\nbenvenuto su Sklubot! Per confermare il tuo indirizzo e iniziare a usare Sklubot, apri questo link (una sola volta):\n${link}\n\nSenza conferma entro ${h} ora/e, l'account e i suoi dati vengono eliminati automaticamente.\nSe non hai creato un account, ignora questa email.\n\n— Sklubot (${config.publicUrl})` }),
  pt: (link: string, h: number) => ({ subject: "Sklubot: confirme seu endereço de e-mail", text: `Olá,\n\nBoas-vindas ao Sklubot! Para confirmar seu endereço e começar a usar o Sklubot, abra este link (uma vez só):\n${link}\n\nSem confirmação em ${h} hora(s), a conta e os dados dela são excluídos automaticamente.\nSe você não criou nenhuma conta, ignore este e-mail.\n\n— Sklubot (${config.publicUrl})` }),
  zh: (link: string, h: number) => ({ subject: "Sklubot：确认你的邮箱地址", text: `你好，\n\n欢迎使用 Sklubot！要确认你的地址并开始使用 Sklubot，请打开这个链接（只能用一次）：\n${link}\n\n如果 ${h} 小时内没有确认，账号及其数据会被自动删除。\n如果你没有创建账号，请忽略这封邮件。\n\n— Sklubot（${config.publicUrl}）` }),
};
function sendVerification(user: UserRecord) {
  const token = randomToken(32);
  // The link lives as long as the account may wait, never longer: a resend does not push the deadline back.
  const expires = verifyDeadline(user.id) ?? now() + unverifiedTtlMs();
  q.tx(() => {
    q.run("DELETE FROM email_verifications WHERE user_id = ? OR expires_at < ?", user.id, now());
    q.run("INSERT INTO email_verifications (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), user.id, now(), expires);
  });
  const mail = byLocale(user.locale, MAIL)(`${config.publicUrl}/?verify_email=${encodeURIComponent(token)}`, hoursLeft(expires - now()));
  audit(user.id, "account", "E-mail verification link sent");
  // Sent after answering; the token is never logged.
  setImmediate(() => { void sendSystemMail(user.email, mail.subject, mail.text).catch((err) => console.error(`[account-mail] verification e-mail not sent: ${(err as Error).message}`)); });
}

interface Flags { email_verify_pending: number; onboarding_pending: number; push_prompt: string }
const flagsOf = (userId: string) => q.get<Flags>("SELECT email_verify_pending, onboarding_pending, push_prompt FROM users WHERE id = ?", userId);
/**
 * Whether this account is held until its address is confirmed: verification applies on this server, the account is
 * pending, and it is not the owner. Read on every signed-in request (routes.ts's session middleware).
 */
export function emailGateBlocks(userId: string): boolean {
  if (!verificationWanted()) return false;
  if (flagsOf(userId)?.email_verify_pending !== 1) return false;
  return ownerIdOf() !== userId;
}
/** Kept for the agent loop (defence in depth): a held account's bots take no turns. */
export const emailUnverified = emailGateBlocks;

/**
 * What an unverified account may still do (paths under /api): sign out, read itself, resend the link, change its address
 * (the new address's link verifies it), choose its language, export its data, delete itself. Everything else: 403.
 */
const EMAIL_GATE_ALLOWED: { method: string; path: RegExp }[] = [
  { method: "GET", path: /^\/me$/ },
  { method: "*", path: /^\/auth\// },
  { method: "POST", path: /^\/account\/verify-email\/resend$/ },
  { method: "GET", path: /^\/account\/email$/ },
  { method: "POST", path: /^\/account\/email$/ },
  { method: "DELETE", path: /^\/account\/email\/pending$/ },
  { method: "DELETE", path: /^\/account$/ },
  { method: "GET", path: /^\/export\/data$/ },
  { method: "PUT", path: /^\/prefs$/ },
];
/** Whether a held account may call this route (`path` with or without the /api prefix). */
export function emailGateAllows(method: string, path: string): boolean {
  const p = path.replace(/^\/api(?=\/)/, "").replace(/\/+$/, "") || "/";
  const m = method === "HEAD" ? "GET" : method;
  return EMAIL_GATE_ALLOWED.some((r) => (r.method === "*" || r.method === m) && r.path.test(p));
}
/** The 403 answer of a held account. */
export const emailGateBody = (user: Pick<UserRecord, "email" | "locale">) =>
  ({ error: m(user.locale, "Confirm your e-mail address to use Sklubot: open the link we sent to {email}.", { email: user.email }), code: "email_unverified" as const });

/** Extra fields of the signed-in person (present only when true, so nothing changes for anyone else). */
export function accountFlags(userId: string): { emailUnverified?: true; emailVerifyDeadline?: number; onboarding?: true; pushPrompt?: "later" } {
  const f = flagsOf(userId);
  const held = emailGateBlocks(userId);
  return { ...(held ? { emailUnverified: true as const, emailVerifyDeadline: verifyDeadline(userId) ?? undefined } : {}), ...(f?.onboarding_pending === 1 ? { onboarding: true as const } : {}), ...(f?.push_prompt === "later" ? { pushPrompt: "later" as const } : {}) };
}
/** The address is proven (link opened, a sign-in with Google, a confirmed change of address): the account is let in. */
export function markVerified(userId: string) {
  q.run("UPDATE users SET email_verify_pending = 0, email_verified_at = ? WHERE id = ?", now(), userId);
  q.run("DELETE FROM email_verifications WHERE user_id = ?", userId);
  ensureFirstBot(userId);
}

/**
 * The first bot of an account whose creation waited for its address (first_bot, migration 14): made now, with the name
 * and role chosen on the sign-up form. A full team (MAX_BOTS) leaves the marker: the next try (first run) makes it.
 */
export function ensureFirstBot(userId: string): BotRecord | null {
  const r = q.get<{ first_bot: string | null; locale: string }>("SELECT first_bot, locale FROM users WHERE id = ?", userId);
  if (!r || r.first_bot === null) return null;
  const existing = bots.primary(userId);
  if (existing) { q.run("UPDATE users SET first_bot = NULL WHERE id = ?", userId); return existing; }
  const locale: Locale = isLocale(r.locale) ? r.locale : "en";
  let chosen: { name?: string; label?: string } | null = null;
  try { chosen = JSON.parse(r.first_bot); } catch { /* the defaults */ }
  const name = chosen?.name || config.firstBotName || "Juno";
  const label = chosen?.label || config.firstBotLabel || tr(locale, "Chief of staff");
  try {
    bots.assertRoom();
    const bot = bots.create(userId, {
      name, label, primary: true, shape: "pebble", color: "indigo",
      description: tr(locale, "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots."),
    });
    q.run("UPDATE users SET first_bot = NULL WHERE id = ?", userId);
    return bot;
  } catch (err) {
    console.error(`[signup] first bot not created yet: ${(err as Error).message}`);
    return null;
  }
}

// ── Deleting accounts that never confirmed ──────────────────────────────────────────────────────────────────────
type AccountRemover = (userId: string) => Promise<void>;
let removeAccount: AccountRemover = async (userId) => { q.run("DELETE FROM users WHERE id = ?", userId); };
/** routes.ts gives the full removal (bots, computers, connectors, team folder), the same as DELETE /account. */
export const setAccountRemover = (fn: AccountRemover) => { removeAccount = fn; };

/**
 * Deletes every account still unverified UNVERIFIED_ACCOUNT_TTL_HOURS after its creation (scheduler: every 10 minutes).
 * Only while verification applies; never the owner. Each deletion is written to the owner's activity log (the deleted
 * account's own log goes with it) and the server's log. Returns the deleted addresses.
 */
export async function sweepUnverified(at = now()): Promise<string[]> {
  if (!verificationWanted()) return [];
  const owner = ownerIdOf();
  const due = q.all<{ id: string; email: string; created_at: number }>(
    "SELECT id, email, created_at FROM users WHERE email_verify_pending = 1 AND created_at <= ? ORDER BY created_at LIMIT 200", at - unverifiedTtlMs());
  const done: string[] = [];
  for (const u of due) {
    if (u.id === owner) continue;
    try {
      await removeAccount(u.id);
      done.push(u.email);
      const hours = Math.round(unverifiedTtlMs() / 3_600_000);
      if (owner) audit(owner, "account", `Unverified account ${u.email} deleted automatically (address not confirmed within ${hours} h)`);
      console.info(`[signup] unverified account deleted after ${hours} h (created ${new Date(u.created_at).toISOString()})`);
    } catch (err) {
      console.error(`[signup] could not delete an unverified account: ${(err as Error).message}`);
    }
  }
  return done;
}

/** The text a bot's chat shows when a turn waits for the address to be confirmed. */
export const unverifiedText = (user: Pick<UserRecord, "email" | "locale">) =>
  m(user.locale, "Confirm your e-mail address first: open the link we sent to {email}. Your bots start working as soon as it is confirmed.", { email: user.email });

/** What /me adds for a signed-out visitor: the landing page and the Turnstile site key (never the secret). */
export function publicSignupInfo(): { landing?: true; turnstileSiteKey?: string } {
  const keys = turnstileKeys();
  return { ...(landingOn() ? { landing: true as const } : {}), ...(keys && config.openSignup ? { turnstileSiteKey: keys.siteKey } : {}) };
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
const NOT_FOUND = { error: "No such endpoint." };
const bodyOf = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b as Record<string, unknown> : {}; };
const errorJson = (c: Context, err: unknown, loc: Locale) => {
  if (err instanceof HostedError) return c.json({ error: err.text(loc), ...(err.code ? { code: err.code } : {}) }, err.status);
  if (isPlanLimit(err)) return c.json({ error: err.text(loc), code: "plan_limit", limit: err.kind }, 403);
  throw err;
};

/** Routes without a session (mounted before routes.ts's session check). */
export function registerPublicSignupPublic(api: Hono<any>, d: PublicSignupDeps) {
  deps = d;
  // The landing page's data: only on a server open to sign-ups (else exactly like an unknown address).
  api.get("/public/landing", (c) => {
    if (!landingOn()) return c.json(NOT_FOUND, 404);
    const loc = pickLocale(c.req.query("locale"), c.req.header("accept-language"));
    const templates = templateList().map((t) => ({ id: t.id, title: t.title, description: t.description, icon: t.icon, category: t.category, bots: t.bots.map((b) => ({ name: b.name, role: b.role, look: b.look })) }));
    const hosted = hostedMode()
      ? { plans: plans.offered(), credits: { packs: creditPacks(), payments: paymentsOn(), forSale: hostedSettings.get().creditsForSale }, trialDays: hostedSettings.get().trialDays, freeComputers: env("FREE_PLAN_COMPUTER").toLowerCase() === "personal" ? "personal" : freeMax() > 0 ? "pool" : "none", links: loc === "fr" ? { pricing: "/tarifs", terms: "/cgu", legal: "/mentions-legales", privacy: "/confidentialite" } : { pricing: "/pricing", terms: "/terms", legal: "/legal-notice", privacy: "/privacy" } }
      : null;
    return c.json({ templates, hosted, verification: verificationActive(), turnstile: !!turnstileKeys() }, 200, { "cache-control": "public, max-age=300" });
  });

  // The link of the verification e-mail. No session needed (it may be opened on another device); it signs nobody in.
  api.post("/auth/verify-email", async (c) => {
    const b = await bodyOf(c);
    const loc = pickLocale(b.locale, c.req.header("accept-language"));
    try {
      if (!originAllowed(c.req.header("origin"), c.req.header("host"))) throw new PublicSignupError(403, "Cross-site request refused.", "origin");
      d.throttle(`verify-ip:${d.clientIp(c)}`, 30);
      const token = typeof b.token === "string" && b.token.length <= 200 ? b.token : "";
      const h = token ? sha256(token) : "";
      const row = h ? q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?", h) : undefined;
      if (row) q.run("DELETE FROM email_verifications WHERE token_hash = ?", h);
      const user = row && row.expires_at >= now() ? users.byId(row.user_id) : null;
      if (!user) throw new PublicSignupError(400, "This link has expired or was already used. Sign in and ask for a new one.", "expired");
      markVerified(user.id);
      audit(user.id, "account", "E-mail address confirmed (verification link)");
      return c.json({ ok: true });
    } catch (err) { return errorJson(c, err, loc); }
  });
}

/** Routes for signed-in people (after the session check). */
export function registerPublicSignupPrivate(api: Hono<any>) {
  api.post("/account/verify-email/resend", (c) => {
    const user = c.get("user") as UserRecord;
    try {
      if (!emailGateBlocks(user.id)) return c.json({ ok: true, verified: true });
      if (!verificationActive()) throw new PublicSignupError(409, "This server cannot send e-mails, so there is nothing to confirm.", "no_mail");
      deps?.throttle(`verify-resend:${user.id}`, 3);
      sendVerification(user);
      return c.json({ ok: true, verified: false, email: user.email });
    } catch (err) { return errorJson(c, err, user.locale); }
  });

  /**
   * "Active les notifications" (first run, then once on Today): asked once, remembered here. "later": skipped during the
   * first run (Today shows one gentle banner); "enabled" / "dismissed": never asked again (users.push_prompt, migration 21).
   */
  api.put("/account/push-prompt", async (c) => {
    const user = c.get("user") as UserRecord;
    const b = await bodyOf(c);
    const status = b.status === "later" || b.status === "enabled" || b.status === "dismissed" ? b.status : null;
    if (!status) return c.json({ error: "status: later, enabled or dismissed." }, 400);
    // "later" never brings back a prompt the person already answered for good.
    q.run(status === "later" ? "UPDATE users SET push_prompt = 'later' WHERE id = ? AND push_prompt = ''" : "UPDATE users SET push_prompt = ? WHERE id = ?", ...(status === "later" ? [user.id] : [status, user.id]));
    return c.json({ ok: true });
  });

  api.post("/onboarding/skip", (c) => {
    const user = c.get("user") as UserRecord;
    q.run("UPDATE users SET onboarding_pending = 0 WHERE id = ?", user.id);
    return c.json({ ok: true });
  });

  /**
   * The guided first run: { template?: id, name?: string, label?: string }. Without a template ("un seul assistant") the main bot keeps its
   * place and may take a new name. With one, its bots are created through the team-file import (careful autonomy, draft
   * skills, paused routines), as many as the plan has room for, the first one named `name` when given.
   */
  api.post("/onboarding/commit", async (c) => {
    const user = c.get("user") as UserRecord;
    const b = await bodyOf(c);
    try {
      if (flagsOf(user.id)?.onboarding_pending !== 1) throw new PublicSignupError(409, "The first run is already done.", "done");
      const name = typeof b.name === "string" ? b.name.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      // The first bot's role ("Ton premier bot", asked here rather than on the sign-up form): optional.
      const label = typeof b.label === "string" ? b.label.replace(/\s+/g, " ").trim().slice(0, 60) : "";
      let botId: string;
      let created: { id: string; name: string }[] = [];
      if (typeof b.template === "string" && b.template) {
        if (!templateList().some((t) => t.id === b.template)) throw new PublicSignupError(404, "That template does not exist.", "not_found");
        const preview = await previewTeamFile(user, { template: b.template });
        const room = planRoom(user.id);
        const n = Math.min(preview.bots.length, room.bots ?? preview.bots.length);
        if (n < 1) throw planLimitError("bots", room.maxBots ?? 0);
        const choices = preview.bots.slice(0, n).map((_, index) => ({ index, include: true, ...(index === 0 && name ? { name } : {}) }));
        created = commitTeamFile(user, preview.previewId, choices).bots;
        botId = created[0].id;
      } else {
        const main = bots.primary(user.id) ?? ensureFirstBot(user.id);
        if (!main) throw new PublicSignupError(404, "That template does not exist.", "not_found");
        if (name && name.toLowerCase() !== main.name.toLowerCase() && !bots.byName(user.id, name)) bots.patch(main.id, { name });
        if (label && label !== main.label) bots.patch(main.id, { label });
        botId = main.id;
      }
      q.run("UPDATE users SET onboarding_pending = 0 WHERE id = ?", user.id);
      audit(user.id, "account", `First run done (${typeof b.template === "string" && b.template ? `template ${b.template}` : "one assistant"})`);
      return c.json({ botId, bots: created, ideas: ideasFromSubjects([], user.locale).slice(0, 3) });
    } catch (err) { return errorJson(c, err, user.locale); }
  });
}
