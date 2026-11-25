/**
 * The server's own e-mails (SK-P0-10): "Mot de passe oublié ?", change of an account's e-mail address, and the SMTP
 * account the instance sends them with.
 *
 * Sending: Nodemailer's SMTP transport (https://nodemailer.com/smtp): `secure: true` is TLS from the first byte (port
 * 465); `secure: false` + `requireTLS: true` demands a STARTTLS upgrade (port 587) and fails without it; `secure: false`
 * alone upgrades with STARTTLS when the server offers it. `tls.servername` checks the certificate against the host name
 * when we connect to its resolved address. `connectionTimeout` / `greetingTimeout` / `socketTimeout` bound each step.
 *
 * Where the SMTP account comes from: the SMTP_* environment variables when SMTP_HOST is set (they win), else what the
 * instance owner (the oldest account, as in googlelogin.ts) saved in Settings → Account; the password is sealed (auth.ts).
 * A saved host on this server's own network is refused (botmail.ts relayAddress), as for the bots' relays; one given in
 * the environment is the operator's choice and is used as it is.
 *
 * Security rules of this file:
 *  - no account enumeration: "forgot password" answers the same whether the address has an account or not, and sends
 *    the e-mail after answering (no timing difference); a change to an address already in use looks the same as any
 *    other change while e-mail works (the confirmation is simply never sent);
 *  - tokens are 32 random bytes, only their SHA-256 is stored, single use (deleted when used), 30 minutes; a new request
 *    replaces the previous one;
 *  - a password reset signs every device out (all sessions deleted), then signs this browser in;
 *  - rate limits reuse routes.ts's throttle (per client address and per account / address);
 *  - state-changing public routes check Origin like the rest of the API; tokens and passwords are never logged;
 *  - every change leaves an audit line on the account.
 *
 * Change of address and Google: a Google link is kept by Google's account id (`sub`, googlelogin.ts), not by address,
 * so changing the Sklubot address keeps "Continuer avec Google" working for the same Google account. Workspace members
 * are stored by account id; invitations are matched against the account's current address when they are accepted.
 */
import net from "node:net"; import { localize } from "./lang/index.js"; import { byLocale } from "./lang/index.js";
import type { Context, Hono } from "hono";
import nodemailer from "nodemailer";
import { hashPassword, originAllowed, seal, unseal, verifyPassword } from "./auth.js";
import { relayAddress } from "./botmail.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { hasPassword, ownerId } from "./googlelogin.js"; import { checkSecondFactor, twoFactorOn } from "./twofactor.js";
import { markVerified } from "./publicsignup.js";
import type { Locale } from "./shared.js";
import { audit, clip, now, randomToken, sha256, users, type UserRecord } from "./store.js";
import type { SecondStep } from "./twofactor.js";

export const TOKEN_MS = 30 * 60_000;
const EMAIL_RE = /^[^@\s<>"'(),;:\\]+@[^@\s<>"'(),;:\\]+\.[^@\s<>"'(),;:\\]+$/;
export type TlsMode = "tls" | "starttls" | "none";
const TLS_MODES: TlsMode[] = ["tls", "starttls", "none"];

// ── The instance's SMTP account ─────────────────────────────────────────────
export interface SmtpSettings { host: string; port: number; tlsMode: TlsMode; username: string; password: string | null; from: string; source: "env" | "saved" }
interface SmtpRow { host: string; port: number; tls_mode: string; username: string; pass_enc: string | null; from_addr: string }

const defaultMode = (port: number): TlsMode => (port === 465 ? "tls" : "starttls");

export function smtpSettings(): SmtpSettings | null {
  const envHost = (process.env.SMTP_HOST ?? "").trim();
  if (envHost) {
    const port = Math.floor(Number(process.env.SMTP_PORT)) || 587;
    const mode = (process.env.SMTP_TLS ?? "").trim().toLowerCase() as TlsMode;
    const username = (process.env.SMTP_USER ?? "").trim();
    const from = (process.env.SMTP_FROM ?? "").trim() || (EMAIL_RE.test(username) ? username : "");
    return { host: envHost, port, tlsMode: TLS_MODES.includes(mode) ? mode : defaultMode(port), username, password: process.env.SMTP_PASS ?? null, from, source: "env" };
  }
  const r = q.get<SmtpRow>("SELECT * FROM instance_smtp WHERE id = 1");
  if (!r) return null;
  return { host: r.host, port: r.port, tlsMode: (TLS_MODES.includes(r.tls_mode as TlsMode) ? r.tls_mode : defaultMode(r.port)) as TlsMode, username: r.username, password: r.pass_enc ? unseal(r.pass_enc) : null, from: r.from_addr, source: "saved" };
}
/** Whether the server can send its own e-mails (an SMTP host and a sender address). */
export const mailConfigured = () => { const s = smtpSettings(); return !!s && !!s.from; };

export class AccountMailError extends Error { constructor(public status: 400 | 401 | 403 | 409 | 502, message: string) { super(message); } }

/** Sends one plain-text e-mail with the instance's SMTP account. Throws AccountMailError with a readable reason. */
export async function sendSystemMail(to: string, subject: string, text: string): Promise<void> {
  const s = smtpSettings();
  if (!s || !s.from) throw new AccountMailError(409, "This server cannot send e-mails yet (no SMTP account).");
  let host = s.host;
  try {
    if (s.source === "saved") host = await relayAddress(s.host);
  } catch (err) { throw new AccountMailError(502, (err as Error).message); }
  const transport = nodemailer.createTransport({
    host, port: s.port, secure: s.tlsMode === "tls", requireTLS: s.tlsMode === "starttls",
    auth: s.username ? { user: s.username, pass: s.password ?? "" } : undefined,
    tls: { servername: net.isIP(s.host) ? undefined : s.host },
    connectionTimeout: 15_000, greetingTimeout: 15_000, socketTimeout: 30_000,
  });
  try {
    await transport.sendMail({ from: { name: "Sklubot", address: s.from }, to, subject, text });
  } catch (err) {
    // Nodemailer's message carries the server's answer (e.g. "Invalid login: 535 …"), never the password.
    throw new AccountMailError(502, clip(String((err as Error).message ?? "send failed").replace(/\s+/g, " "), 300));
  } finally { transport.close(); }
}

/** Logs a failed background send without the recipient's link (the token is never logged). */
const logFailure = (what: string) => (err: unknown) => console.error(`[account-mail] ${what} not sent: ${(err as Error).message}`);

// ── Texts (French and English; English is the key) ─────────────────────────
const FR: Record<string, string> = {
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes puis réessaie.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "Enter a valid email address.": "Entre une adresse e-mail valide.",
  "Choose a password of at least 8 characters.": "Choisis un mot de passe d'au moins 8 caractères.",
  "This link has expired or was already used. Ask for a new one.": "Ce lien a expiré ou a déjà servi. Demande-en un nouveau.",
  "This server cannot send e-mails yet (no SMTP account).": "Ce serveur ne peut pas encore envoyer d'e-mails (aucun compte SMTP).",
  "The password is wrong.": "Le mot de passe est faux.",
  "Choose a password first (above): changing your address needs it.": "Choisis d'abord un mot de passe (au-dessus) : il faut le donner pour changer d'adresse.",
  "This is already your address.": "C'est déjà ton adresse.",
  "This address is not allowed on this server.": "Cette adresse n'est pas autorisée sur ce serveur.",
  "This address is already used by another account.": "Cette adresse est déjà utilisée par un autre compte.",
  "Only the owner of this server can change this.": "Seule la personne qui gère ce serveur peut changer ça.",
  "These settings come from the server's environment (SMTP_HOST…): change them there.": "Ces réglages viennent de l'environnement du serveur (SMTP_HOST…) : change-les là-bas.",
  "Enter the SMTP server's name (e.g. smtp.gmail.com).": "Entre le nom du serveur SMTP (par exemple smtp.gmail.com).",
  "Enter a valid port (465 or 587 usually).": "Entre un port valide (465 ou 587 en général).",
  "Choose a security mode.": "Choisis un mode de sécurité.",
  "Enter the sender address (the From of the e-mails).": "Entre l'adresse d'expédition (l'expéditeur des e-mails).",
  "The SMTP server refused or did not answer: {detail}": "Le serveur SMTP a refusé ou n'a pas répondu : {detail}",
};
const m = (locale: Locale, english: string, vars: Record<string, string> = {}) =>
  localize(locale, english, FR).replace(/\{(\w+)\}/g, (_x, k: string) => vars[k] ?? "");
const pickLoc = (value: unknown, acceptLanguage?: string | null): Locale =>
  value === "fr" || value === "en" ? value : /^\s*fr/i.test(acceptLanguage ?? "") ? "fr" : "en";

/** The e-mails themselves, in the account's language. Plain text: nothing to render, nothing to inject. */
const MAILS = {
  reset: {
    fr: (link: string) => ({ subject: "Sklubot : choisis un nouveau mot de passe", text: `Bonjour,\n\nQuelqu'un (sans doute toi) a demandé à changer le mot de passe de ton compte Sklubot.\n\nPour choisir un nouveau mot de passe, ouvre ce lien (valable 30 minutes, une seule fois) :\n${link}\n\nTous les appareils connectés à ton compte seront déconnectés.\n\nSi ce n'est pas toi, ignore cet e-mail : ton mot de passe ne change pas.\n\n— Sklubot (${config.publicUrl})` }),
    en: (link: string) => ({ subject: "Sklubot: choose a new password", text: `Hello,\n\nSomeone (probably you) asked to change the password of your Sklubot account.\n\nTo choose a new password, open this link (valid 30 minutes, once):\n${link}\n\nEvery device signed in to your account will be signed out.\n\nIf it was not you, ignore this e-mail: your password does not change.\n\n— Sklubot (${config.publicUrl})` }),
    es: (link: string) => ({ subject: "Sklubot: elige una contraseña nueva", text: `Hola:\n\nAlguien (seguramente tú) ha pedido cambiar la contraseña de tu cuenta de Sklubot.\n\nPara elegir una contraseña nueva, abre este enlace (válido 30 minutos, una sola vez):\n${link}\n\nSe cerrará la sesión en todos los dispositivos conectados a tu cuenta.\n\nSi no has sido tú, ignora este correo: tu contraseña no cambia.\n\n— Sklubot (${config.publicUrl})` }),
  },
  confirm: {
    fr: (link: string) => ({ subject: "Sklubot : confirme ta nouvelle adresse", text: `Bonjour,\n\nTu as demandé à utiliser cette adresse pour ton compte Sklubot.\n\nPour confirmer, ouvre ce lien (valable 30 minutes, une seule fois) :\n${link}\n\nSi ce n'est pas toi, ignore cet e-mail : rien ne change.\n\n— Sklubot (${config.publicUrl})` }),
    en: (link: string) => ({ subject: "Sklubot: confirm your new address", text: `Hello,\n\nYou asked to use this address for your Sklubot account.\n\nTo confirm, open this link (valid 30 minutes, once):\n${link}\n\nIf it was not you, ignore this e-mail: nothing changes.\n\n— Sklubot (${config.publicUrl})` }),
    es: (link: string) => ({ subject: "Sklubot: confirma tu nueva dirección", text: `Hola:\n\nHas pedido usar esta dirección para tu cuenta de Sklubot.\n\nPara confirmarlo, abre este enlace (válido 30 minutos, una sola vez):\n${link}\n\nSi no has sido tú, ignora este correo: no cambia nada.\n\n— Sklubot (${config.publicUrl})` }),
  },
  notice: {
    fr: (next: string) => ({ subject: "Sklubot : changement d'adresse demandé", text: `Bonjour,\n\nUn changement de l'adresse de ton compte Sklubot vers ${next} vient d'être demandé, avec ton mot de passe. Il ne prendra effet que si le lien envoyé à cette nouvelle adresse est ouvert dans les 30 minutes.\n\nSi ce n'est pas toi : connecte-toi, change ton mot de passe (Réglages → Compte), puis annule le changement en attente.\n\n— Sklubot (${config.publicUrl})` }),
    en: (next: string) => ({ subject: "Sklubot: change of address requested", text: `Hello,\n\nA change of your Sklubot account's address to ${next} was just requested, with your password. It only takes effect if the link sent to that new address is opened within 30 minutes.\n\nIf it was not you: sign in, change your password (Settings → Account), then cancel the pending change.\n\n— Sklubot (${config.publicUrl})` }),
    es: (next: string) => ({ subject: "Sklubot: cambio de dirección solicitado", text: `Hola:\n\nSe acaba de solicitar, con tu contraseña, cambiar la dirección de tu cuenta de Sklubot a ${next}. Solo se aplicará si el enlace enviado a esa nueva dirección se abre en los próximos 30 minutos.\n\nSi no has sido tú: inicia sesión, cambia tu contraseña (Ajustes → Cuenta) y cancela el cambio pendiente.\n\n— Sklubot (${config.publicUrl})` }),
  },
  signIn: {
    fr: (link: string) => ({ subject: "Sklubot : ton lien de connexion", text: `Bonjour,\n\nVoici ton lien pour te connecter à Sklubot (valable 15 minutes, une seule fois) :\n${link}\n\nSi tu n'as rien demandé, ignore cet e-mail : personne ne peut se connecter sans ce lien.\n\n— Sklubot (${config.publicUrl})` }),
    en: (link: string) => ({ subject: "Sklubot: your sign-in link", text: `Hello,\n\nHere is your link to sign in to Sklubot (valid 15 minutes, once):\n${link}\n\nIf you did not ask for it, ignore this e-mail: nobody can sign in without this link.\n\n— Sklubot (${config.publicUrl})` }),
    es: (link: string) => ({ subject: "Sklubot: tu enlace para iniciar sesión", text: `Hola:\n\nAquí tienes tu enlace para iniciar sesión en Sklubot (válido 15 minutos, una sola vez):\n${link}\n\nSi no has pedido nada, ignora este correo: nadie puede iniciar sesión sin este enlace.\n\n— Sklubot (${config.publicUrl})` }),
  },
  signUp: {
    fr: (link: string) => ({ subject: "Sklubot : crée ton compte", text: `Bonjour,\n\nPour créer ton compte Sklubot avec cette adresse, ouvre ce lien (valable 15 minutes, une seule fois) :\n${link}\n\nSi tu n'as rien demandé, ignore cet e-mail : aucun compte n'est créé.\n\n— Sklubot (${config.publicUrl})` }),
    en: (link: string) => ({ subject: "Sklubot: create your account", text: `Hello,\n\nTo create your Sklubot account with this address, open this link (valid 15 minutes, once):\n${link}\n\nIf you did not ask for it, ignore this e-mail: no account is created.\n\n— Sklubot (${config.publicUrl})` }),
    es: (link: string) => ({ subject: "Sklubot: crea tu cuenta", text: `Hola:\n\nPara crear tu cuenta de Sklubot con esta dirección, abre este enlace (válido 15 minutos, una sola vez):\n${link}\n\nSi no has pedido nada, ignora este correo: no se crea ninguna cuenta.\n\n— Sklubot (${config.publicUrl})` }),
  },
  test: {
    fr: () => ({ subject: "Sklubot : e-mail de test", text: `Bonjour,\n\nCet e-mail de test confirme que ton serveur Sklubot sait envoyer des e-mails (mot de passe oublié, changement d'adresse).\n\n— Sklubot (${config.publicUrl})` }),
    en: () => ({ subject: "Sklubot: test e-mail", text: `Hello,\n\nThis test e-mail confirms that your Sklubot server can send e-mails (forgotten password, change of address).\n\n— Sklubot (${config.publicUrl})` }),
    es: () => ({ subject: "Sklubot: correo de prueba", text: `Hola:\n\nEste correo de prueba confirma que tu servidor de Sklubot puede enviar correos (contraseña olvidada, cambio de dirección).\n\n— Sklubot (${config.publicUrl})` }),
  },
};

/** "Recevoir un lien de connexion par e-mail" (emaillink.ts): sent after answering, never logged with its link. */
export function sendLinkMail(kind: "signIn" | "signUp", to: string, locale: Locale, link: string) {
  const mail = byLocale(locale, MAILS[kind])(link);
  setImmediate(() => { void sendSystemMail(to, mail.subject, mail.text).catch(logFailure(kind === "signIn" ? "sign-in link e-mail" : "sign-up link e-mail")); });
}

// ── Tokens ──────────────────────────────────────────────────────────────────
function newResetToken(userId: string): string {
  const token = randomToken(32);
  q.tx(() => {
    q.run("DELETE FROM password_resets WHERE user_id = ? OR expires_at < ?", userId, now());
    q.run("INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, now(), now() + TOKEN_MS);
  });
  return token;
}
/** The account a reset link belongs to, without using it up (to show the form or say it expired). */
function peekReset(token: string): string | null {
  if (!token || token.length > 200) return null;
  const r = q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?", sha256(token));
  return r && r.expires_at >= now() ? r.user_id : null;
}
/** Uses a reset link: it is deleted whatever happens next (single use). */
function takeReset(token: string): string | null {
  if (!token || token.length > 200) return null;
  const h = sha256(token);
  const r = q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM password_resets WHERE token_hash = ?", h);
  if (r) q.run("DELETE FROM password_resets WHERE token_hash = ?", h);
  return r && r.expires_at >= now() ? r.user_id : null;
}
/** Called whenever the password changes by any route: older reset links stop working. */
export const dropResetLinks = (userId: string) => q.run("DELETE FROM password_resets WHERE user_id = ?", userId);

interface PendingChange { email: string; expiresAt: number }
function pendingChange(userId: string): PendingChange | null {
  const r = q.get<{ new_email: string; expires_at: number }>("SELECT new_email, expires_at FROM email_changes WHERE user_id = ? AND expires_at >= ? ORDER BY created_at DESC LIMIT 1", userId, now());
  return r ? { email: r.new_email, expiresAt: r.expires_at } : null;
}

/** Changes the address (UNIQUE COLLATE NOCASE on users.email). False when another account took it. */
function applyEmail(userId: string, email: string): boolean {
  const other = users.byEmail(email);
  if (other && other.id !== userId) return false;
  try {
    q.tx(() => {
      q.run("UPDATE users SET email = ? WHERE id = ?", email, userId);
      // Links sent to the old address stop working.
      q.run("DELETE FROM password_resets WHERE user_id = ?", userId);
      q.run("DELETE FROM email_changes WHERE user_id = ?", userId);
    });
  } catch (err) {
    if (/UNIQUE/i.test((err as Error).message)) return false;
    throw err;
  }
  return true;
}

const cleanEmail = (v: unknown) => String(v ?? "").trim().toLowerCase();
const validEmail = (e: string) => e.length <= 200 && EMAIL_RE.test(e);
const allowedHere = (e: string) => !config.allowedEmails.length || config.allowedEmails.includes(e);

// ── Routes ──────────────────────────────────────────────────────────────────
/** What routes.ts lends us (the same helpers as googlelogin.ts). */
export interface AccountMailDeps {
  throttle(key: string, limit?: number): void;
  clientIp(c: Context): string;
  startSession(c: Context, userId: string, via?: string): SecondStep | null;
  publicUser(u: UserRecord): unknown;
}

/** Localised errors; the throttle's refusal (thrown by routes.ts) becomes a localised 403. */
function handle(localeOf: (c: Context, b: Record<string, unknown>) => Locale, fn: (c: Context, locale: Locale, b: Record<string, unknown>) => Promise<Response> | Response) {
  return async (c: Context) => {
    const b = c.req.method === "GET" || c.req.method === "DELETE" ? {} : ((await c.req.json().catch(() => ({}))) as Record<string, unknown>) ?? {};
    const locale = localeOf(c, b && typeof b === "object" ? b : {});
    try {
      return await fn(c, locale, b && typeof b === "object" ? b : {});
    } catch (err) {
      if (err instanceof AccountMailError) return c.json({ error: m(locale, err.message) }, err.status);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return c.json({ error: m(locale, "Too many attempts. Wait a few minutes and try again.") }, 403);
      throw err;
    }
  };
}
const publicLoc = (c: Context, b: Record<string, unknown>) => pickLoc(b.locale, c.req.header("accept-language"));
const userLoc = (c: Context) => (c.get("user") as UserRecord).locale;
const sameSite = (c: Context) => { if (!originAllowed(c.req.header("origin"), c.req.header("host"))) throw new AccountMailError(403, "Cross-site request refused."); };

/** Routes reachable without a session (mounted before the session middleware). */
export function registerAccountMailPublic(api: Hono<any>, deps: AccountMailDeps) {
  // Whether "forgot password" can send anything (instance-wide, says nothing about any account).
  api.get("/auth/password/status", (c) => c.json({ mail: mailConfigured() }));

  api.post("/auth/password/forgot", handle(publicLoc, (c, locale, b) => {
    sameSite(c);
    const email = cleanEmail(b.email);
    deps.throttle(`forgot-ip:${deps.clientIp(c)}`, 10);
    if (!validEmail(email)) throw new AccountMailError(400, "Enter a valid email address.");
    deps.throttle(`forgot:${email}`, 3);
    if (!mailConfigured()) throw new AccountMailError(409, "This server cannot send e-mails yet (no SMTP account).");
    const user = users.byEmail(email);
    if (user) {
      const token = newResetToken(user.id);
      const mail = byLocale(user.locale, MAILS.reset)(`${config.publicUrl}/?reset=${encodeURIComponent(token)}`);
      audit(user.id, "account", "Password reset e-mail requested");
      // Sent after answering: an existing account must not answer more slowly than an unknown address.
      setImmediate(() => { void sendSystemMail(user.email, mail.subject, mail.text).catch(logFailure("password reset e-mail")); });
    }
    return c.json({ ok: true });
  }));

  // Is this link still good? (Shown before the new-password form; it does not use the link up.)
  api.post("/auth/password/reset/check", handle(publicLoc, (c, _locale, b) => {
    sameSite(c);
    deps.throttle(`reset-ip:${deps.clientIp(c)}`, 30);
    return c.json({ valid: !!peekReset(String(b.token ?? "")) });
  }));

  api.post("/auth/password/reset", handle(publicLoc, (c, _locale, b) => {
    sameSite(c);
    deps.throttle(`reset-ip:${deps.clientIp(c)}`, 30);
    const password = String(b.password ?? "");
    // Checked before the link is used, so a too-short password does not burn it.
    if (password.length < 8 || password.length > 1024) throw new AccountMailError(400, "Choose a password of at least 8 characters.");
    const userId = takeReset(String(b.token ?? ""));
    const user = userId ? users.byId(userId) : null;
    if (!user) throw new AccountMailError(400, "This link has expired or was already used. Ask for a new one.");
    q.tx(() => {
      q.run("UPDATE users SET pass_hash = ? WHERE id = ?", hashPassword(password), user.id);
      // Every device is signed out, and every other way in that was handed out is withdrawn.
      q.run("DELETE FROM sessions WHERE user_id = ?", user.id);
      q.run("DELETE FROM password_resets WHERE user_id = ?", user.id);
      q.run("DELETE FROM sign_in_links WHERE user_id = ?", user.id);
    });
    audit(user.id, "account", "Password reset with an e-mail link (every device signed out)");
    // Two-factor stays on: the new password is saved, but signing in still needs the code (or a recovery code).
    const second = deps.startSession(c, user.id, "password reset");
    if (second) return c.json(second);
    return c.json({ user: deps.publicUser(users.byId(user.id)!) });
  }));

  // The link sent to a new address. No session needed (it may be opened on another device).
  api.post("/auth/email/confirm", handle(publicLoc, (c, _locale, b) => {
    sameSite(c);
    deps.throttle(`email-confirm-ip:${deps.clientIp(c)}`, 30);
    const token = String(b.token ?? "");
    const h = token && token.length <= 200 ? sha256(token) : "";
    const r = h ? q.get<{ user_id: string; new_email: string; expires_at: number }>("SELECT user_id, new_email, expires_at FROM email_changes WHERE token_hash = ?", h) : undefined;
    if (r) q.run("DELETE FROM email_changes WHERE token_hash = ?", h);
    const user = r && r.expires_at >= now() ? users.byId(r.user_id) : null;
    if (!r || !user) throw new AccountMailError(400, "This link has expired or was already used. Ask for a new one.");
    if (!allowedHere(r.new_email)) throw new AccountMailError(403, "This address is not allowed on this server.");
    const old = user.email;
    if (!applyEmail(user.id, r.new_email)) throw new AccountMailError(409, "This address is already used by another account.");
    // The link was opened from the new address: that address is proven (publicsignup.ts e-mail verification).
    markVerified(user.id);
    audit(user.id, "account", `E-mail address changed from ${old} to ${r.new_email} (confirmed by e-mail)`);
    return c.json({ ok: true, email: r.new_email });
  }));
}

/** Routes for signed-in people (after the session middleware, which sets c.get("user") and checks Origin). */
export function registerAccountMailPrivate(api: Hono<any>, deps: AccountMailDeps) {
  const ownerOnly = (c: Context) => {
    const user = c.get("user") as UserRecord;
    if (ownerId() !== user.id) throw new AccountMailError(403, "Only the owner of this server can change this.");
    return user;
  };
  const view = () => {
    const s = smtpSettings();
    return { configured: !!s && !!s.from, source: s?.source ?? null, host: s?.host ?? "", port: s?.port ?? 587, tlsMode: s?.tlsMode ?? "starttls", username: s?.username ?? "", hasPassword: !!s?.password, from: s?.from ?? "" };
  };

  // ── The account's address ──
  api.get("/account/email", (c) => {
    const user = c.get("user") as UserRecord;
    return c.json({ email: user.email, pending: pendingChange(user.id), mail: mailConfigured(), hasPassword: hasPassword(user) });
  });

  api.post("/account/email", handle(userLoc, (c, _locale, b) => {
    const user = c.get("user") as UserRecord;
    deps.throttle(`pw:${user.id}`);
    if (!hasPassword(user)) throw new AccountMailError(409, "Choose a password first (above): changing your address needs it.");
    if (!verifyPassword(String(b.password ?? ""), user.passHash)) throw new AccountMailError(401, "The password is wrong.");
    // L37: with two-factor sign-in on, a new address also needs a current code (a stolen session plus the password is not enough).
    if (twoFactorOn(user.id) && !checkSecondFactor(user.id, String(b.code ?? ""))) throw new AccountMailError(401, "Type the current code of your two-factor app to change your address.");
    const email = cleanEmail(b.email);
    if (!validEmail(email)) throw new AccountMailError(400, "Enter a valid email address.");
    if (email === user.email.toLowerCase()) throw new AccountMailError(400, "This is already your address.");
    if (!allowedHere(email)) throw new AccountMailError(403, "This address is not allowed on this server.");

    if (!mailConfigured()) {
      // No e-mail on this server: the password check is the only proof, and the change applies now (nobody is told).
      if (!applyEmail(user.id, email)) throw new AccountMailError(409, "This address is already used by another account.");
      audit(user.id, "account", `E-mail address changed from ${user.email} to ${email} (no e-mail server: applied after the password check)`);
      return c.json({ applied: true, user: deps.publicUser(users.byId(user.id)!), pending: null });
    }

    const token = randomToken(32);
    q.tx(() => {
      q.run("DELETE FROM email_changes WHERE user_id = ? OR expires_at < ?", user.id, now());
      q.run("INSERT INTO email_changes (token_hash, user_id, new_email, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), user.id, email, now(), now() + TOKEN_MS);
    });
    audit(user.id, "account", `E-mail address change to ${email} requested (confirmation link sent to the new address)`);
    const taken = !!users.byEmail(email);
    const confirm = byLocale(user.locale, MAILS.confirm)(`${config.publicUrl}/?email_change=${encodeURIComponent(token)}`);
    const notice = byLocale(user.locale, MAILS.notice)(email);
    setImmediate(() => {
      // An address that already has an account gets nothing (the answer above is the same, so nothing is revealed).
      if (!taken) void sendSystemMail(email, confirm.subject, confirm.text).catch(logFailure("address confirmation e-mail"));
      void sendSystemMail(user.email, notice.subject, notice.text).catch(logFailure("change-of-address notice"));
    });
    return c.json({ applied: false, pending: pendingChange(user.id) });
  }));

  api.delete("/account/email/pending", (c) => {
    const user = c.get("user") as UserRecord;
    const had = pendingChange(user.id);
    q.run("DELETE FROM email_changes WHERE user_id = ?", user.id);
    if (had) audit(user.id, "account", `Pending e-mail address change to ${had.email} cancelled`);
    return c.json({ pending: null });
  });

  // ── The owner's SMTP settings (the password is never sent back, only whether one is saved) ──
  api.get("/settings/smtp", handle(userLoc, (c) => { ownerOnly(c); return c.json(view()); }));

  api.put("/settings/smtp", handle(userLoc, (c, _locale, b) => {
    const user = ownerOnly(c);
    if (smtpSettings()?.source === "env") throw new AccountMailError(409, "These settings come from the server's environment (SMTP_HOST…): change them there.");
    const host = String(b.host ?? "").trim().toLowerCase();
    if (!/^[a-z0-9.-]+$/.test(host) || host.length > 200) throw new AccountMailError(400, "Enter the SMTP server's name (e.g. smtp.gmail.com).");
    const port = Number(b.port);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new AccountMailError(400, "Enter a valid port (465 or 587 usually).");
    const tlsMode = String(b.tlsMode ?? "") as TlsMode;
    if (!TLS_MODES.includes(tlsMode)) throw new AccountMailError(400, "Choose a security mode.");
    const from = cleanEmail(b.from);
    if (!validEmail(from)) throw new AccountMailError(400, "Enter the sender address (the From of the e-mails).");
    const username = String(b.username ?? "").trim().slice(0, 200);
    const cur = q.get<{ pass_enc: string | null }>("SELECT pass_enc FROM instance_smtp WHERE id = 1");
    // Empty keeps the saved password; null removes it.
    const pass = b.password === null ? null : typeof b.password === "string" && b.password ? seal(b.password.slice(0, 500)) : cur?.pass_enc ?? null;
    q.run(`INSERT INTO instance_smtp (id, host, port, tls_mode, username, pass_enc, from_addr, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET host = excluded.host, port = excluded.port, tls_mode = excluded.tls_mode, username = excluded.username, pass_enc = excluded.pass_enc,
      from_addr = excluded.from_addr, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, host, port, tlsMode, username, pass, from, now(), user.id);
    audit(user.id, "account", `Server e-mail (SMTP) settings saved: ${host}:${port} (${tlsMode})`);
    return c.json(view());
  }));

  // The owner's bot relay (Settings → E-mail) reused for the server's own e-mails: the sealed password is copied on the
  // server, never sent to the browser. Sender = the relay's user name, which must be an e-mail address.
  api.post("/settings/smtp/from-relay", handle(userLoc, (c) => {
    const user = ownerOnly(c);
    if (smtpSettings()?.source === "env") throw new AccountMailError(409, "These settings come from the server's environment (SMTP_HOST…): change them there.");
    const r = q.get<{ host: string; port: number; secure: number; username: string; pass_enc: string | null }>("SELECT host, port, secure, username, pass_enc FROM mail_relays WHERE user_id = ?", user.id);
    if (!r || !r.pass_enc) throw new AccountMailError(409, "Your bots' relay (Settings → E-mail) has no saved password.");
    const from = cleanEmail(r.username);
    if (!validEmail(from)) throw new AccountMailError(409, "Your bots' relay user name is not an e-mail address: fill in this form instead.");
    q.run(`INSERT INTO instance_smtp (id, host, port, tls_mode, username, pass_enc, from_addr, updated_at, updated_by) VALUES (1, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET host = excluded.host, port = excluded.port, tls_mode = excluded.tls_mode, username = excluded.username, pass_enc = excluded.pass_enc,
      from_addr = excluded.from_addr, updated_at = excluded.updated_at, updated_by = excluded.updated_by`, r.host, r.port, r.secure ? "tls" : "starttls", r.username.trim(), r.pass_enc, from, now(), user.id);
    audit(user.id, "account", `Server e-mail (SMTP) set from the bots' relay: ${r.host}:${r.port}`);
    return c.json(view());
  }));

  api.delete("/settings/smtp", handle(userLoc, (c) => {
    const user = ownerOnly(c);
    q.run("DELETE FROM instance_smtp WHERE id = 1");
    audit(user.id, "account", "Server e-mail (SMTP) settings removed");
    return c.json(view());
  }));

  // A test e-mail, to the owner's own address only (so this cannot be used to write to anyone).
  api.post("/settings/smtp/test", handle(userLoc, async (c, locale) => {
    const user = ownerOnly(c);
    deps.throttle(`smtp-test:${user.id}`, 10);
    const mail = byLocale(user.locale, MAILS.test)();
    try {
      await sendSystemMail(user.email, mail.subject, mail.text);
    } catch (err) {
      const detail = err instanceof AccountMailError && err.status === 409 ? null : (err as Error).message;
      audit(user.id, "account", "Server test e-mail failed");
      if (!detail) throw err;
      return c.json({ error: m(locale, "The SMTP server refused or did not answer: {detail}", { detail }) }, 502);
    }
    audit(user.id, "account", `Server test e-mail sent to ${user.email}`);
    return c.json({ ok: true, to: user.email });
  }));
}
