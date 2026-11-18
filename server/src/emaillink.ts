/**
 * "Recevoir un lien de connexion par e-mail": sign in — or sign up — without a password, with a one-time link. The web
 * app's single "Connexion ou inscription" screen (SignIn.tsx) asks for the address first, then offers the password and
 * this link to everyone alike: nothing on the screen or in an answer says whether an account uses the address.
 *
 *  - POST /api/auth/email-link { email, locale?, plan?, planInvite?, turnstileToken? } always answers { ok: true }
 *    (no enumeration). An account that uses the address gets a sign-in link; an unknown address gets a "create your
 *    account" link when an account could be created for it right now (sign-ups open or a plan invitation for it, not
 *    the very first account, ALLOWED_EMAILS), else nothing. The checks that can refuse depend only on the request and
 *    the server, never on the account: rate limits per address (3 per quarter hour) and per IP (10), the server's SMTP
 *    (409), and on open servers the disposable-domain block and Turnstile when configured (publicsignup.ts).
 *  - The link is `${PUBLIC_URL}/?email_link=<token>`: 32 random bytes, valid 15 minutes, single use, only its SHA-256
 *    stored (sign_in_links for an account — the same table as the command-line link of sign-in-link.ts — or
 *    email_link_signups for an address with no account yet, migration 21). It opens the web app, which POSTs it to
 *    /api/auth/email-link/use: a mail scanner that only fetches the address uses nothing up.
 *  - POST /api/auth/email-link/use { token, profile?, name?, acceptTerms? }: an account's link is deleted at once and
 *    the account signed in through the two-factor gate (twofactor.ts startSessionOrChallenge, like every other way in).
 *    A new address's link first answers { profile: { email, terms } } WITHOUT using it up, so the person gives a name
 *    and accepts the terms of service (hosted mode) on the next step; that call ({ profile: true, … }) uses the link,
 *    checks the sign-up rules again (sign-ups still open, the plan invitation still valid, the terms, room for a bot)
 *    and creates the account. The link proves the address: the account counts as verified. Each use is in the
 *    account's activity log.
 */
import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { mailConfigured, sendLinkMail } from "./accountmail.js";
import { originAllowed, setupCodeRequired, signupOpen } from "./auth.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { NO_PASSWORD_PREFIX, type GoogleDeps } from "./googlelogin.js";
import { accountCreated, HostedError, hostedMode, planInviteOpens, signupChoice } from "./hosted.js";
import { pickLocale, tr } from "./i18n.js";
import { accountOpened, checkTurnstile, disposableEmail, markVerified, PublicSignupError } from "./publicsignup.js";
import type { Locale } from "./shared.js";
import { audit, bots, now, randomToken, sha256, users } from "./store.js";

export const EMAIL_LINK_MS = 15 * 60_000;
const EMAIL_RE = /^[^@\s<>"'(),;:\\]+@[^@\s<>"'(),;:\\]+\.[^@\s<>"'(),;:\\]+$/;

const FR: Record<string, string> = {
  "Enter a valid email address.": "Indique une adresse e-mail valide.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "This server cannot send e-mails yet (no SMTP account).": "Ce serveur ne peut pas encore envoyer d'e-mails (pas de compte SMTP).",
  "New accounts are closed on this server.": "Les nouveaux comptes sont fermés sur ce serveur.",
  "The very first account of this server is created with the form and the setup code.": "Le tout premier compte de ce serveur se crée avec le formulaire et le code d'installation.",
  "This address is not allowed to create an account on this server.": "Cette adresse n'est pas autorisée à créer un compte sur ce serveur.",
  "This link has expired or was already used. Ask for a new one.": "Ce lien a expiré ou a déjà servi. Demandes-en un nouveau.",
  "Too many attempts. Wait a few minutes and try again.": "Trop de tentatives. Attends quelques minutes puis réessaie.",
  "The team is full on this server: no new account can be created.": "L'équipe est complète sur ce serveur : aucun nouveau compte ne peut être créé.",
};
class LinkError extends Error { constructor(public status: 400 | 403 | 409, message: string) { super(message); this.name = "LinkError"; } }
const say = (loc: Locale, english: string) => (loc === "fr" ? FR[english] ?? english : english);

interface Pending { name?: string; locale?: Locale; plan?: string; planInvite?: string; acceptTerms?: boolean }
const str = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\0-\x1f]/g, "").trim().slice(0, max) : "");

function respond(c: Context, loc: Locale, err: unknown): Response {
  if (err instanceof LinkError) return c.json({ error: say(loc, err.message) }, err.status);
  if (err instanceof HostedError) return c.json({ error: err.text(loc), ...(err.code ? { code: err.code } : {}) }, err.status);
  if (err instanceof Error && /Too many attempts/.test(err.message)) return c.json({ error: say(loc, "Too many attempts. Wait a few minutes and try again.") }, 403);
  throw err;
}

export function registerEmailLinkPublic(api: Hono<any>, deps: GoogleDeps) {
  api.post("/auth/email-link", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const loc = pickLocale(b.locale, c.req.header("accept-language"));
    try {
      if (!originAllowed(c.req.header("origin"), c.req.header("host"))) throw new LinkError(403, "Cross-site request refused.");
      deps.throttle(`email-link-ip:${deps.clientIp(c)}`, 10);
      const email = str(b.email, 200).toLowerCase();
      if (!EMAIL_RE.test(email)) throw new LinkError(400, "Enter a valid email address.");
      deps.throttle(`email-link:${email}`, 3);
      if (!mailConfigured()) throw new LinkError(409, "This server cannot send e-mails yet (no SMTP account).");
      const pending: Pending = { locale: loc, plan: str(b.plan, 40) || undefined, planInvite: str(b.planInvite, 200) || undefined };
      // Open servers (publicsignup.ts): the same anti-robot checks for every address, so they say nothing about accounts.
      if (config.openSignup) {
        if (disposableEmail(email)) throw new PublicSignupError(400, "Use a permanent e-mail address: temporary addresses are not accepted here.", "disposable_email");
        await checkTurnstile(b.turnstileToken, deps.clientIp(c));
      }
      const user = users.byEmail(email);
      const canCreate = !user && !setupCodeRequired() && (signupOpen() || planInviteOpens(pending.planInvite, email)) && (!config.allowedEmails.length || config.allowedEmails.includes(email));
      const token = randomToken(32);
      const link = `${config.publicUrl}/?email_link=${encodeURIComponent(token)}`;
      if (user) {
        q.run("DELETE FROM sign_in_links WHERE expires_at < ?", now());
        q.run("INSERT INTO sign_in_links (token_hash, user_id, expires_at) VALUES (?, ?, ?)", sha256(token), user.id, now() + EMAIL_LINK_MS);
        audit(user.id, "account", "Sign-in link sent by e-mail");
        sendLinkMail("signIn", user.email, user.locale, link);
      } else if (canCreate) {
        q.run("DELETE FROM email_link_signups WHERE expires_at < ? OR email = ?", now(), email);
        q.run("INSERT INTO email_link_signups (token_hash, email, payload, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), email, JSON.stringify(pending), now(), now() + EMAIL_LINK_MS);
        sendLinkMail("signUp", email, loc, link);
      }
      return c.json({ ok: true });
    } catch (err) { return respond(c, loc, err); }
  });

  api.post("/auth/email-link/use", async (c) => {
    const b = ((await c.req.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    let loc = pickLocale(b.locale, c.req.header("accept-language"));
    try {
      if (!originAllowed(c.req.header("origin"), c.req.header("host"))) throw new LinkError(403, "Cross-site request refused.");
      deps.throttle(`email-link-use-ip:${deps.clientIp(c)}`, 30);
      const token = typeof b.token === "string" && b.token.length <= 200 ? b.token : "";
      const h = token ? sha256(token) : "";
      const expired = new LinkError(400, "This link has expired or was already used. Ask for a new one.");
      if (!h) throw expired;
      // An existing account's link (also the command-line one of sign-in-link.ts).
      const link = q.get<{ user_id: string; expires_at: number }>("SELECT user_id, expires_at FROM sign_in_links WHERE token_hash = ?", h);
      if (link) {
        q.run("DELETE FROM sign_in_links WHERE token_hash = ?", h);
        const user = link.expires_at >= now() ? users.byId(link.user_id) : null;
        if (!user) throw expired;
        return signIn(c, deps, user.id, "Signed in with an e-mail link");
      }
      // An address with no account yet: the person finishes their profile, then the account is created.
      const pend = q.get<{ email: string; payload: string; expires_at: number }>("SELECT email, payload, expires_at FROM email_link_signups WHERE token_hash = ?", h);
      if (!pend) throw expired;
      if (pend.expires_at < now()) { q.run("DELETE FROM email_link_signups WHERE token_hash = ?", h); throw expired; }
      let p: Pending = {};
      try { p = JSON.parse(pend.payload) as Pending; } catch { /* the defaults */ }
      loc = p.locale === "fr" || p.locale === "en" ? p.locale : loc;
      const existing = users.byEmail(pend.email);
      if (existing) { q.run("DELETE FROM email_link_signups WHERE token_hash = ?", h); return signIn(c, deps, existing.id, "Signed in with an e-mail link"); }
      // First answer: what the next step needs (the link is not used up yet).
      if (b.profile !== true) return c.json({ profile: { email: pend.email, terms: hostedMode() && users.count() > 0 } });
      p.name = str(b.name, 80);
      p.acceptTerms = b.acceptTerms === true;
      // Checked before the link is used, so a missing tick does not burn it.
      signupChoice({ plan: p.plan, planInvite: p.planInvite, acceptTerms: p.acceptTerms, email: pend.email, first: users.count() === 0 });
      q.run("DELETE FROM email_link_signups WHERE token_hash = ?", h);
      if (setupCodeRequired()) throw new LinkError(403, "The very first account of this server is created with the form and the setup code.");
      if (!signupOpen() && !planInviteOpens(p.planInvite, pend.email)) throw new LinkError(403, "New accounts are closed on this server.");
      if (config.allowedEmails.length && !config.allowedEmails.includes(pend.email.toLowerCase())) throw new LinkError(403, "This address is not allowed to create an account on this server.");
      const firstAccount = users.count() === 0;
      const choice = signupChoice({ plan: p.plan, planInvite: p.planInvite, acceptTerms: p.acceptTerms, email: pend.email, first: firstAccount });
      try { bots.assertRoom(); } catch { throw new LinkError(409, "The team is full on this server: no new account can be created."); }
      const user = users.create(pend.email, p.name ?? "", NO_PASSWORD_PREFIX + randomBytes(32).toString("base64url"), loc);
      accountCreated(user.id, choice);
      // The link was opened from the address: it is proven (no confirmation e-mail to wait for).
      accountOpened(user, { first: firstAccount, verified: true });
      const first = deps.firstBotIdentity(loc);
      bots.create(user.id, {
        name: first.name, label: first.label, primary: true, shape: "pebble", color: "indigo",
        description: tr(loc, "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots."),
      });
      audit(user.id, "account", "Account created with an e-mail link");
      return signIn(c, deps, user.id, null);
    } catch (err) { return respond(c, loc, err); }
  });
}

function signIn(c: Context, deps: GoogleDeps, userId: string, line: string | null): Response {
  // The address answered: an account still waiting for its confirmation is let in.
  markVerified(userId);
  const second = deps.startSession(c, userId, "e-mail link");
  if (second) return c.json(second);
  if (line) audit(userId, "account", line);
  return c.json({ user: deps.publicUser(users.byId(userId)!) });
}
