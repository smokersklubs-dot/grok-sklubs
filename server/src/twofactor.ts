/**
 * Two-factor sign-in ("Double authentification", Settings → Account) and session hardening.
 *
 * Codes: TOTP, RFC 6238 (https://www.rfc-editor.org/rfc/rfc6238) over HOTP, RFC 4226
 * (https://www.rfc-editor.org/rfc/rfc4226): SHA-1, 6 digits, 30-second steps, ±1 step accepted, a code works once
 * (totp.ts verifyTotp). The seed (20 random bytes, RFC 4226 §4 R6 recommends 160 bits) is shown as base32 and as an
 * otpauth:// URI in the Key Uri Format of Google Authenticator
 * (https://github.com/google/google-authenticator/wiki/Key-Uri-Format): otpauth://totp/<issuer>:<account>?secret=…
 * &issuer=…&algorithm=SHA1&digits=6&period=30. It is sealed with the data key (datakey.ts) and never sent again once
 * confirmed.
 *
 * Recovery codes: 10, each 12 base32 characters (60 bits) shown once as xxxx-xxxx-xxxx; only a SHA-256 of
 * "<account id>:<code>" is kept; each works once.
 *
 * Signing in: every way in (password, Google, the e-mail password reset, the one-time link printed on the server, the
 * mobile app's Google exchange) goes through `startSessionOrChallenge`. With two-factor on, no session is created:
 * the answer is { twoFactor: { token, expiresIn } } (and the same token in a short-lived httpOnly cookie, for the
 * redirect flows) and POST /api/auth/2fa { token?, code } opens the session once the code (or a recovery code) is right.
 * The pending token lives 5 minutes, allows 5 attempts, and both the address and the account are throttled.
 *  - Google: Google proves who the person is, not that they hold the code generator; the code is still asked.
 *  - Password reset by e-mail: the new password is saved, but signing in still needs the code (or a recovery code) —
 *    an e-mail box alone does not get past two-factor. Someone who lost both the phone and the recovery codes asks the
 *    server's owner: `node server/dist/reset-password.js <email> --disable-2fa` (command line only).
 */
import { randomBytes } from "node:crypto"; import { localize } from "./lang/index.js";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { createSession, originAllowed, seal, SESSION_COOKIE, unseal, verifyPassword } from "./auth.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { adminLog, hostedMode, isOperator } from "./hosted.js";
import { pickLocale } from "./i18n.js";
import type { Locale } from "./shared.js";
import { audit, now, randomToken, sha256, users, type UserRecord } from "./store.js";
import { base32Encode, verifyTotp } from "./totp.js";

export const TWO_FACTOR_COOKIE = "sklubot_2fa";
const CHALLENGE_MS = 5 * 60_000;
const CHALLENGE_ATTEMPTS = 5;
const PENDING_SETUP_MS = 30 * 60_000;
const RECOVERY_COUNT = 10;
const ISSUER = "Sklubot";

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "That code is not right. Check the time on your phone and try again.": "Ce code n'est pas le bon. Vérifie l'heure de ton téléphone et réessaie.",
  "This sign-in has expired. Sign in again.": "Cette connexion a expiré. Reconnecte-toi.",
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes et réessaie.",
  "Two-factor sign-in is already on.": "La double authentification est déjà activée.",
  "Two-factor sign-in is not on.": "La double authentification n'est pas activée.",
  "Start the set-up again: it was not finished in time.": "Recommence l'activation : elle n'a pas été terminée à temps.",
  "The password is wrong.": "Le mot de passe est faux.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "That account does not exist.": "Ce compte n'existe pas.",
  "No such endpoint.": "Adresse inconnue.",
  "The saved two-factor key cannot be read (data key changed?). Ask the server's owner.": "La clé de double authentification enregistrée ne se lit plus (clé de données changée ?). Demande au propriétaire du serveur.",
};
const m = (locale: Locale, english: string) => localize(locale, english, FR);
class TwoFactorError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 410 | 429, message: string) { super(message); } }

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Row { user_id: string; secret_enc: string | null; pending_enc: string | null; pending_at: number | null; enabled_at: number | null; last_step: number }
const rowOf = (userId: string) => q.get<Row>("SELECT * FROM two_factor WHERE user_id = ?", userId);
const recoveryHash = (userId: string, code: string) => sha256(`${userId}:${code.toUpperCase().replace(/[^A-Z2-7]/g, "")}`);

/** Whether signing in to this account needs a code. */
export const twoFactorOn = (userId: string): boolean => !!rowOf(userId)?.secret_enc;

export interface TwoFactorStatus { enabled: boolean; enabledAt: number | null; recoveryLeft: number; hasPassword: boolean }
export function twoFactorStatus(user: UserRecord): TwoFactorStatus {
  const r = rowOf(user.id);
  const left = q.get<{ n: number }>("SELECT COUNT(*) AS n FROM two_factor_recovery WHERE user_id = ? AND used_at IS NULL", user.id)?.n ?? 0;
  return { enabled: !!r?.secret_enc, enabledAt: r?.secret_enc ? r.enabled_at : null, recoveryLeft: r?.secret_enc ? left : 0, hasPassword: user.passHash.startsWith("scrypt$") };
}

/** The otpauth:// URI (Key Uri Format): label "Issuer:account", issuer repeated as a parameter, default settings spelt out. */
export function otpauthUri(secret: string, account: string, issuer = ISSUER): string {
  const label = `${encodeURIComponent(issuer)}:${encodeURIComponent(account)}`;
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=30`;
}

/** Step 1 of turning it on: a new seed, kept sealed until a code proves the app has it. */
export function beginSetup(user: UserRecord): { secret: string; uri: string } {
  if (twoFactorOn(user.id)) throw new TwoFactorError(409, "Two-factor sign-in is already on.");
  const secret = base32Encode(randomBytes(20));
  q.run(`INSERT INTO two_factor (user_id, pending_enc, pending_at, updated_at) VALUES (?, ?, ?, ?)
    ON CONFLICT(user_id) DO UPDATE SET pending_enc = excluded.pending_enc, pending_at = excluded.pending_at, updated_at = excluded.updated_at`, user.id, seal(secret), now(), now());
  return { secret, uri: otpauthUri(secret, user.email) };
}

function newRecoveryCodes(userId: string): string[] {
  const codes = Array.from({ length: RECOVERY_COUNT }, () => base32Encode(randomBytes(8)).slice(0, 12).replace(/(.{4})(?=.)/g, "$1-").toLowerCase());
  q.run("DELETE FROM two_factor_recovery WHERE user_id = ?", userId);
  for (const c of codes) q.run("INSERT INTO two_factor_recovery (user_id, code_hash, created_at) VALUES (?, ?, ?)", userId, recoveryHash(userId, c), now());
  return codes;
}

/** Step 2: the first code from the app turns it on; the recovery codes are returned once. */
export function confirmSetup(user: UserRecord, code: string, at = Date.now()): { recoveryCodes: string[] } {
  const r = rowOf(user.id);
  if (r?.secret_enc) throw new TwoFactorError(409, "Two-factor sign-in is already on.");
  if (!r?.pending_enc || !r.pending_at || r.pending_at + PENDING_SETUP_MS < now()) throw new TwoFactorError(409, "Start the set-up again: it was not finished in time.");
  const secret = unseal(r.pending_enc);
  if (!secret) throw new TwoFactorError(409, "Start the set-up again: it was not finished in time.");
  const step = verifyTotp(secret, code, at);
  if (step === null) throw new TwoFactorError(400, "That code is not right. Check the time on your phone and try again.");
  return q.tx(() => {
    q.run("UPDATE two_factor SET secret_enc = pending_enc, pending_enc = NULL, pending_at = NULL, enabled_at = ?, last_step = ?, updated_at = ? WHERE user_id = ?", now(), step, now(), user.id);
    const recoveryCodes = newRecoveryCodes(user.id);
    audit(user.id, "account", "Two-factor sign-in turned on");
    return { recoveryCodes };
  });
}

/**
 * Checks a code for an account with two-factor on: a 6-digit code from the app (once per step), or an unused recovery
 * code (then used up). Returns how it was proven, or null.
 */
export function checkSecondFactor(userId: string, code: string, at = Date.now()): "totp" | "recovery" | null {
  const r = rowOf(userId);
  if (!r?.secret_enc) return null;
  const clean = String(code ?? "").trim();
  if (/^[\d\s-]{6,9}$/.test(clean)) {
    const secret = unseal(r.secret_enc);
    if (!secret) throw new TwoFactorError(409, "The saved two-factor key cannot be read (data key changed?). Ask the server's owner.");
    const step = verifyTotp(secret, clean, at, r.last_step);
    if (step === null) return null;
    // Compare-and-set: two requests racing with the same code cannot both pass.
    const changed = q.run("UPDATE two_factor SET last_step = ? WHERE user_id = ? AND last_step < ?", step, userId, step).changes;
    return Number(changed) === 1 ? "totp" : null;
  }
  if (clean.replace(/[^A-Za-z2-7]/g, "").length !== 12) return null;
  const used = q.run("UPDATE two_factor_recovery SET used_at = ? WHERE user_id = ? AND code_hash = ? AND used_at IS NULL", now(), userId, recoveryHash(userId, clean)).changes;
  return Number(used) === 1 ? "recovery" : null;
}

/** Turning it off needs the password (when the account has one) and a code: a stolen session alone cannot. */
export function disableTwoFactor(user: UserRecord, password: string, code: string): void {
  if (!twoFactorOn(user.id)) throw new TwoFactorError(409, "Two-factor sign-in is not on.");
  if (user.passHash.startsWith("scrypt$") && !verifyPassword(password, user.passHash)) throw new TwoFactorError(401, "The password is wrong.");
  if (!checkSecondFactor(user.id, code)) throw new TwoFactorError(400, "That code is not right. Check the time on your phone and try again.");
  removeTwoFactor(user.id);
  audit(user.id, "account", "Two-factor sign-in turned off");
}

/** Removes two-factor from an account (also the server's command line: reset-password.ts --disable-2fa). */
export function removeTwoFactor(userId: string): void {
  q.tx(() => {
    q.run("DELETE FROM two_factor WHERE user_id = ?", userId);
    q.run("DELETE FROM two_factor_recovery WHERE user_id = ?", userId);
    q.run("DELETE FROM login_challenges WHERE user_id = ?", userId);
  });
}

export function regenerateRecovery(user: UserRecord, code: string): { recoveryCodes: string[] } {
  if (!twoFactorOn(user.id)) throw new TwoFactorError(409, "Two-factor sign-in is not on.");
  if (checkSecondFactor(user.id, code) !== "totp") throw new TwoFactorError(400, "That code is not right. Check the time on your phone and try again.");
  const recoveryCodes = q.tx(() => newRecoveryCodes(user.id));
  audit(user.id, "account", "Two-factor recovery codes replaced");
  return { recoveryCodes };
}

// ── Sessions ─────────────────────────────────────────────────────────────────────────────────────────────────────
const secure = () => config.publicUrl.startsWith("https://");

/** L44: told of every session opened here (newdevice.ts: the « nouvel appareil » alert). A listener never blocks a sign-in. */
export type SessionOpened = { c: Context; userId: string; tokenHash: string; via: string };
const sessionListeners: ((e: SessionOpened) => void)[] = [];
export const onSessionOpened = (fn: (e: SessionOpened) => void) => { sessionListeners.push(fn); };

/** Creates the session and its cookie (the only place that does, besides the tests). */
export function openSession(c: Context, userId: string, via = "sign-in"): void {
  const s = createSession(userId);
  setCookie(c, SESSION_COOKIE, s.token, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: s.maxAgeSec, secure: secure() });
  for (const fn of sessionListeners) { try { fn({ c, userId, tokenHash: sha256(s.token), via }); } catch (err) { console.error("[sessions]", err); } }
}

export interface SecondStep { twoFactor: { token: string; expiresIn: number } }

/** A sign-in that passed its first step: a session, or — with two-factor on — a pending challenge and no session. */
export function startSessionOrChallenge(c: Context, userId: string, via = "sign-in"): SecondStep | null {
  if (!twoFactorOn(userId)) { openSession(c, userId, via); return null; }
  const token = randomToken(32);
  q.run("DELETE FROM login_challenges WHERE expires_at < ?", now());
  q.run("INSERT INTO login_challenges (token_hash, user_id, via, created_at, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(token), userId, via, now(), now() + CHALLENGE_MS);
  setCookie(c, TWO_FACTOR_COOKIE, token, { httpOnly: true, sameSite: "Lax", path: "/api/auth", maxAge: CHALLENGE_MS / 1000, secure: secure() });
  return { twoFactor: { token, expiresIn: CHALLENGE_MS / 1000 } };
}

/** "Se déconnecter de tous les appareils": every session of the account but this one (and pending sign-ins) ends. */
export function dropOtherSessions(userId: string, keepToken: string | undefined): number {
  return q.tx(() => {
    const n = Number(q.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", userId, sha256(keepToken ?? "")).changes);
    q.run("DELETE FROM login_challenges WHERE user_id = ?", userId);
    return n;
  });
}
export function dropAllSessions(userId: string): number {
  return q.tx(() => {
    const n = Number(q.run("DELETE FROM sessions WHERE user_id = ?", userId).changes);
    q.run("DELETE FROM login_challenges WHERE user_id = ?", userId);
    return n;
  });
}
export const sessionCount = (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM sessions WHERE user_id = ? AND expires_at > ?", userId, now())?.n ?? 0;

/** Expired sessions, pending sign-ins and one-time links are deleted (at start-up, then every hour). */
export function sweepExpired(at = now()): { sessions: number; challenges: number } {
  const sessions = Number(q.run("DELETE FROM sessions WHERE expires_at < ?", at).changes);
  const challenges = Number(q.run("DELETE FROM login_challenges WHERE expires_at < ?", at).changes);
  q.run("DELETE FROM sign_in_links WHERE expires_at < ?", at);
  q.run("UPDATE two_factor SET pending_enc = NULL, pending_at = NULL WHERE pending_at IS NOT NULL AND pending_at < ?", at - PENDING_SETUP_MS);
  q.run("DELETE FROM two_factor WHERE secret_enc IS NULL AND pending_enc IS NULL");
  return { sessions, challenges };
}
export function startSessionSweep(): void {
  const run = () => { try { sweepExpired(); } catch (e) { console.error("[sessions]", e); } };
  run();
  setInterval(run, 3600_000).unref();
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface TwoFactorDeps {
  throttle(key: string, limit?: number): void;
  clientIp(c: Context): string;
  publicUser(u: UserRecord): unknown;
}
const readBody = async (c: Context): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
};
function handle(fn: (c: Context, locale: Locale, b: Record<string, unknown>) => Promise<Response> | Response) {
  return async (c: Context) => {
    const b = c.req.method === "GET" ? {} : await readBody(c);
    const user = c.get("user") as UserRecord | undefined;
    const locale: Locale = user?.locale ?? pickLocale(b.locale, c.req.header("accept-language"));
    try { return await fn(c, locale, b); } catch (err) {
      if (err instanceof TwoFactorError) return c.json({ error: m(locale, err.message) }, err.status);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return c.json({ error: m(locale, "Too many attempts. Wait a few minutes and try again.") }, 429);
      throw err;
    }
  };
}
const userOf = (c: Context) => c.get("user") as UserRecord;
const str = (v: unknown) => (typeof v === "string" ? v.slice(0, 200) : "");

/** Wrong second-step codes per account (memory, bounded): 10 per quarter hour, cleared by a right code. */
const failures = (() => {
  const map = new Map<string, { n: number; until: number }>();
  const LIMIT = 10, WINDOW = 15 * 60_000;
  return {
    blocked: (id: string) => { const f = map.get(id); return !!f && f.until > Date.now() && f.n >= LIMIT; },
    note: (id: string) => {
      const f = map.get(id);
      map.set(id, f && f.until > Date.now() ? { n: f.n + 1, until: f.until } : { n: 1, until: Date.now() + WINDOW });
      if (map.size > 10_000) for (const [k, v] of map) if (v.until <= Date.now() || map.size > 10_000) map.delete(k);
    },
    clear: (id: string) => { map.delete(id); },
  };
})();

/** Before the session check: the second step of a sign-in. */
export function registerTwoFactorPublic(api: Hono<any>, deps: TwoFactorDeps) {
  api.post("/auth/2fa", handle((c, locale, b) => {
    const token = str(b.token) || getCookie(c, TWO_FACTOR_COOKIE) || "";
    // The cookie form is a browser's: it must come from our own pages. The app sends the token in the body.
    if (!str(b.token) && !originAllowed(c.req.header("origin"), c.req.header("host"))) throw new TwoFactorError(403, "Cross-site request refused.");
    deps.throttle(`2fa-ip:${deps.clientIp(c)}`, 30);
    const ch = token ? q.get<{ user_id: string; via: string; attempts: number; expires_at: number }>("SELECT user_id, via, attempts, expires_at FROM login_challenges WHERE token_hash = ?", sha256(token)) : undefined;
    const user = ch && ch.expires_at >= now() ? users.byId(ch.user_id) : null;
    if (!ch || !user) { deleteCookie(c, TWO_FACTOR_COOKIE, { path: "/api/auth" }); throw new TwoFactorError(410, "This sign-in has expired. Sign in again."); }
    // Per account: 10 wrong codes in a quarter hour (across pending sign-ins) and it waits, even with the right code.
    if (failures.blocked(user.id)) throw new TwoFactorError(429, "Too many attempts. Wait a few minutes and try again.");
    const how = checkSecondFactor(user.id, str(b.code));
    if (!how) {
      failures.note(user.id);
      // Each wrong code uses an attempt; the last one ends the sign-in (back to the password).
      const left = CHALLENGE_ATTEMPTS - ch.attempts - 1;
      if (left <= 0) { q.run("DELETE FROM login_challenges WHERE token_hash = ?", sha256(token)); deleteCookie(c, TWO_FACTOR_COOKIE, { path: "/api/auth" }); throw new TwoFactorError(410, "This sign-in has expired. Sign in again."); }
      q.run("UPDATE login_challenges SET attempts = attempts + 1 WHERE token_hash = ?", sha256(token));
      return c.json({ error: m(locale, "That code is not right. Check the time on your phone and try again."), attemptsLeft: left }, 400);
    }
    failures.clear(user.id);
    q.run("DELETE FROM login_challenges WHERE token_hash = ?", sha256(token));
    deleteCookie(c, TWO_FACTOR_COOKIE, { path: "/api/auth" });
    audit(user.id, "account", how === "recovery" ? `Signed in (${ch.via}) with a recovery code` : `Signed in (${ch.via}) with a two-factor code`);
    openSession(c, user.id, ch.via);
    return c.json({ user: deps.publicUser(user), ...(how === "recovery" ? { recoveryLeft: twoFactorStatus(user).recoveryLeft } : {}) });
  }));
}

/** After the session check (c.get("user") is the signed-in account; Origin already checked for changes). */
export function registerTwoFactorPrivate(api: Hono<any>, deps: TwoFactorDeps) {
  api.get("/account/2fa", handle((c) => c.json({ twoFactor: twoFactorStatus(userOf(c)), sessions: sessionCount(userOf(c).id) })));
  api.post("/account/2fa/setup", handle((c) => {
    deps.throttle(`2fa-setup:${userOf(c).id}`, 10);
    return c.json(beginSetup(userOf(c)));
  }));
  api.post("/account/2fa/confirm", handle((c, _l, b) => {
    deps.throttle(`2fa-set:${userOf(c).id}`, 10);
    const r = confirmSetup(userOf(c), str(b.code));
    return c.json({ ...r, twoFactor: twoFactorStatus(userOf(c)) });
  }));
  api.post("/account/2fa/disable", handle((c, _l, b) => {
    deps.throttle(`2fa-set:${userOf(c).id}`, 10);
    disableTwoFactor(userOf(c), str(b.password), str(b.code));
    return c.json({ twoFactor: twoFactorStatus(userOf(c)) });
  }));
  api.post("/account/2fa/recovery", handle((c, _l, b) => {
    deps.throttle(`2fa-set:${userOf(c).id}`, 10);
    const r = regenerateRecovery(userOf(c), str(b.code));
    return c.json({ ...r, twoFactor: twoFactorStatus(userOf(c)) });
  }));
  // "Se déconnecter de tous les appareils": this device stays signed in.
  api.post("/account/sessions/revoke-others", handle((c) => {
    const n = dropOtherSessions(userOf(c).id, getCookie(c, SESSION_COOKIE));
    audit(userOf(c).id, "account", `Signed out of every other device (${n})`);
    return c.json({ ok: true, revoked: n, sessions: sessionCount(userOf(c).id) });
  }));
  // Hosted mode, operators only (anyone else: the same 404 as an unknown address): sign an account out everywhere.
  api.post("/admin/customers/:uid/sessions/revoke", handle((c) => {
    const me = userOf(c);
    if (!hostedMode() || !isOperator(me.id)) throw new TwoFactorError(404, "No such endpoint.");
    const target = users.byId(c.req.param("uid") ?? "");
    if (!target) throw new TwoFactorError(404, "That account does not exist.");
    const n = dropAllSessions(target.id);
    adminLog({ id: me.id, label: me.email }, target.id, "sessions-revoke", `signed out of every device (${n} session${n === 1 ? "" : "s"})`);
    audit(target.id, "account", "Signed out of every device by the service's operator");
    return c.json({ ok: true, revoked: n });
  }));
}
