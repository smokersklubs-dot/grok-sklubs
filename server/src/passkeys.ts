/**
 * L44 « Clés d'accès » (passkeys, WebAuthn): add one in Settings → Permissions → Sécurité, sign in with it, list,
 * rename, remove; a passkey also proves the approver on a floor approval card (floorapproval.ts) where the two-factor
 * code is asked today. Verification: webauthn.ts (W3C Web Authentication Level 3, https://www.w3.org/TR/webauthn-3/).
 *
 * Relying Party: the RP ID is the host name of PUBLIC_URL and the only accepted origin is PUBLIC_URL's origin (§5.4.3
 * "rp.id", §13.4.9 "Validating the origin of a credential"); behind the VPS reverse proxy PUBLIC_URL is the address the
 * browser shows, so it matches. For local development (PUBLIC_URL on localhost) any http://localhost:<port> origin is also
 * accepted, so the Vite dev server works (§5.1.3: "localhost" is a valid RP ID in a secure context). An IP address is
 * never a valid RP ID (§5.4.3), and outside localhost the page must be https: passkeys are then said to be unavailable.
 *
 * Security rules of this file:
 *  - challenges: 32 random bytes (§13.4.3 asks at least 16), single use (deleted before the answer is checked), 5 minutes,
 *    tied to their purpose ("register", "login", "floor:<approval id>", "floor-off") and, except for "login", to the account;
 *  - user verification is required on every ceremony (webauthn.ts): a passkey is possession + PIN/biometrics, so a
 *    passkey sign-in does not ask the two-factor code again (it is the second factor) — every other way in still does;
 *  - the signature counter must grow when it is used (§6.1.1), saved with compare-and-set so two racing answers cannot
 *    both pass;
 *  - adding or removing a passkey needs the account's password, or (accounts without one) a session opened less than 15
 *    minutes ago: a stolen session alone cannot plant its own passkey, nor remove the one guarding the floor and then turn
 *    the floor option off; every addition is audited and announced (newdevice.ts);
 *  - the user handle is 32 random bytes per account (§14.6.1: never the e-mail address);
 *  - losing every passkey never locks anyone out: password, Google, the e-mail link and the password reset still work.
 *
 * Routes (before the session check): POST /auth/passkey/options → { flow, options }; POST /auth/passkey/verify
 * { flow, response } → { user }. After it: GET /account/passkeys; POST /account/passkeys/options { password? };
 * POST /account/passkeys { flow, response, name? }; PATCH /account/passkeys/:pkId { name }; DELETE /account/passkeys/:pkId
 * { password? }; POST
 * /account/passkey-proof/options { purpose }; POST /account/passkey-proof { flow, response } → { proof }.
 */
import type { Context, Hono } from "hono"; import { localize } from "./lang/index.js";
import { getCookie } from "hono/cookie";
import { originAllowed, SESSION_COOKIE, verifyPassword } from "./auth.js";
import { config } from "./config.js";
import { db, q } from "./db.js";
import { pickLocale } from "./i18n.js";
import type { Locale } from "./shared.js";
import { audit, now, randomToken, sha256, users, type UserRecord } from "./store.js";
import { openSession } from "./twofactor.js";
import { b64url, SUPPORTED_ALGS, verifyAssertion, verifyRegistration, WebAuthnError } from "./webauthn.js";
import { notifySecurity } from "./newdevice.js";

db.exec(`
CREATE TABLE IF NOT EXISTS passkeys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL,
  public_key TEXT NOT NULL, alg INTEGER NOT NULL, counter INTEGER NOT NULL DEFAULT 0, transports TEXT NOT NULL DEFAULT '[]',
  backed_up INTEGER NOT NULL DEFAULT 0, multi_device INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, last_used_at INTEGER
);
CREATE INDEX IF NOT EXISTS passkeys_user ON passkeys(user_id);
CREATE TABLE IF NOT EXISTS passkey_handles (user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE, handle TEXT NOT NULL UNIQUE);
CREATE TABLE IF NOT EXISTS passkey_challenges (
  flow_hash TEXT PRIMARY KEY, user_id TEXT, purpose TEXT NOT NULL, challenge TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS passkey_proofs (
  proof_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, purpose TEXT NOT NULL, expires_at INTEGER NOT NULL
);`);

export const CHALLENGE_MS = 5 * 60_000;
export const PROOF_MS = 2 * 60_000;
export const MAX_PASSKEYS = 20;
const REAUTH_MS = 15 * 60_000;
const TIMEOUT_MS = 120_000;

// ── Words ────────────────────────────────────────────────────────────────────────────────────────────────────────
const FR: Record<string, string> = {
  "Passkeys need this server to be reached over https (PUBLIC_URL), or on localhost.": "Les clés d'accès demandent que ce serveur soit ouvert en https (PUBLIC_URL), ou sur localhost.",
  "This passkey request has expired. Try again.": "Cette demande de clé d'accès a expiré. Réessaie.",
  "This passkey is not known here. Sign in with your password, then add it in Settings → Security.": "Cette clé d'accès n'est pas connue ici. Connecte-toi avec ton mot de passe, puis ajoute-la dans Réglages → Sécurité.",
  "The passkey could not be checked. Try again.": "La clé d'accès n'a pas pu être vérifiée. Réessaie.",
  "Your device did not check that it is you (PIN, fingerprint or face). Try again and unlock it.": "Ton appareil n'a pas vérifié que c'est toi (code, empreinte ou visage). Réessaie en le déverrouillant.",
  "This passkey seems to have been copied (its counter went back). Remove it and add it again.": "Cette clé d'accès semble avoir été copiée (son compteur a reculé). Retire-la puis ajoute-la de nouveau.",
  "The password is wrong.": "Le mot de passe est faux.",
  "Type your password to add a passkey.": "Tape ton mot de passe pour ajouter une clé d'accès.",
  "Type your password to remove a passkey.": "Tape ton mot de passe pour retirer une clé d'accès.",
  "Sign in again, then remove the passkey within 15 minutes.": "Reconnecte-toi, puis retire la clé d'accès dans les 15 minutes.",
  "Sign in again, then add the passkey within 15 minutes.": "Reconnecte-toi, puis ajoute la clé d'accès dans les 15 minutes.",
  "You already have {n} passkeys. Remove one first.": "Tu as déjà {n} clés d'accès. Retires-en une d'abord.",
  "This passkey is already saved.": "Cette clé d'accès est déjà enregistrée.",
  "That passkey does not exist.": "Cette clé d'accès n'existe pas.",
  "Give the passkey a name.": "Donne un nom à la clé d'accès.",
  "You have no passkey yet.": "Tu n'as pas encore de clé d'accès.",
  "Unknown purpose.": "Usage inconnu.",
  "Cross-site request refused.": "Requête d'un autre site refusée.",
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes et réessaie.",
  "A passkey was added": "Une clé d'accès a été ajoutée",
  "The passkey « {name} » can now sign in to your account. If it was not you, remove it in Settings → Security and change your password.": "La clé d'accès « {name} » peut maintenant se connecter à ton compte. Si ce n'est pas toi, retire-la dans Réglages → Sécurité et change ton mot de passe.",
  "Passkey": "Clé d'accès",
};
const m = (locale: Locale, english: string, vars: Record<string, string | number> = {}) =>
  localize(locale, english, FR).replace(/\{(\w+)\}/g, (_x, k: string) => String(vars[k] ?? ""));
export class PasskeyError extends Error { constructor(public status: 400 | 401 | 403 | 404 | 409 | 410 | 429 | 503, message: string, public vars: Record<string, string | number> = {}) { super(message); } }

// ── Relying Party ────────────────────────────────────────────────────────────────────────────────────────────────
export interface RelyingParty { available: boolean; rpId: string; name: string; origins: (requestOrigin?: string | null) => string[] }
export function relyingParty(publicUrl = config.publicUrl): RelyingParty {
  let u: URL | null = null;
  try { u = new URL(publicUrl); } catch { /* unusable */ }
  const host = u?.hostname ?? "";
  const local = host === "localhost";
  const ip = /^[\d.]+$/.test(host) || host.includes(":") || host.startsWith("[");
  const available = !!u && !ip && (u.protocol === "https:" || (local && u.protocol === "http:"));
  return {
    available, rpId: host, name: "Sklubot",
    origins: (requestOrigin) => {
      const list = u ? [u.origin] : [];
      if (local && requestOrigin && /^http:\/\/localhost(:\d{1,5})?$/.test(requestOrigin) && !list.includes(requestOrigin)) list.push(requestOrigin);
      return list;
    },
  };
}

// ── Storage ──────────────────────────────────────────────────────────────────────────────────────────────────────
interface Row { id: string; user_id: string; name: string; public_key: string; alg: number; counter: number; transports: string; backed_up: number; multi_device: number; created_at: number; last_used_at: number | null }
export interface PasskeyView { id: string; name: string; createdAt: number; lastUsedAt: number | null; synced: boolean }
const view = (r: Row): PasskeyView => ({ id: r.id, name: r.name, createdAt: r.created_at, lastUsedAt: r.last_used_at, synced: !!r.multi_device });

export const hasPasskey = (userId: string): boolean => !!q.get("SELECT 1 FROM passkeys WHERE user_id = ? LIMIT 1", userId);
export const listPasskeys = (userId: string): PasskeyView[] => q.all<Row>("SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at", userId).map(view);
const rowsOf = (userId: string) => q.all<Row>("SELECT * FROM passkeys WHERE user_id = ? ORDER BY created_at", userId);

function userHandle(userId: string): string {
  const got = q.get<{ handle: string }>("SELECT handle FROM passkey_handles WHERE user_id = ?", userId);
  if (got) return got.handle;
  const handle = randomToken(32);
  q.run("INSERT OR IGNORE INTO passkey_handles (user_id, handle) VALUES (?, ?)", userId, handle);
  return q.get<{ handle: string }>("SELECT handle FROM passkey_handles WHERE user_id = ?", userId)!.handle;
}

/** A new challenge for one purpose; the flow token (returned to the page) is what finds it again. */
export function newChallenge(purpose: string, userId: string | null): { flow: string; challenge: string } {
  q.run("DELETE FROM passkey_challenges WHERE expires_at < ?", now());
  const flow = randomToken(32), challenge = randomToken(32);
  q.run("INSERT INTO passkey_challenges (flow_hash, user_id, purpose, challenge, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(flow), userId, purpose, challenge, now() + CHALLENGE_MS);
  return { flow, challenge };
}
/** Takes the challenge out (single use, whatever happens next); null when unknown, expired, for another purpose or account. */
export function takeChallenge(flow: unknown, purpose: string | ((p: string) => boolean), userId: string | null): { challenge: string; purpose: string } | null {
  if (typeof flow !== "string" || !flow) return null;
  const row = q.get<{ user_id: string | null; purpose: string; challenge: string; expires_at: number }>("SELECT * FROM passkey_challenges WHERE flow_hash = ?", sha256(flow));
  if (!row) return null;
  if (Number(q.run("DELETE FROM passkey_challenges WHERE flow_hash = ?", sha256(flow)).changes) !== 1) return null;
  const purposeOk = typeof purpose === "string" ? row.purpose === purpose : purpose(row.purpose);
  if (row.expires_at < now() || !purposeOk || row.user_id !== userId) return null;
  return { challenge: row.challenge, purpose: row.purpose };
}

const webauthnText = (err: WebAuthnError): string =>
  err.code === "user_verification" ? "Your device did not check that it is you (PIN, fingerprint or face). Try again and unlock it."
  : err.code === "counter" ? "This passkey seems to have been copied (its counter went back). Remove it and add it again."
  : "The passkey could not be checked. Try again.";

/** Checks an assertion against a saved passkey and moves its counter forward (compare-and-set). */
function checkAssertion(row: Row, response: unknown, challenge: string, requestOrigin: string | null | undefined): void {
  const rp = relyingParty();
  let r: { counter: number; backedUp: boolean };
  try { r = verifyAssertion(response, { challenge, origins: rp.origins(requestOrigin), rpId: rp.rpId }, { id: row.id, publicKey: row.public_key, counter: row.counter }); }
  catch (err) { if (err instanceof WebAuthnError) throw new PasskeyError(401, webauthnText(err)); throw err; }
  const moved = q.run("UPDATE passkeys SET counter = ?, backed_up = ?, last_used_at = ? WHERE id = ? AND counter = ?", r.counter, r.backedUp ? 1 : 0, now(), row.id, row.counter).changes;
  if (Number(moved) !== 1) throw new PasskeyError(401, "The passkey could not be checked. Try again.");
}

const credentialId = (response: unknown): string => { const id = (response as { id?: unknown } | null)?.id; return b64url.is(id) && id.length <= 1400 ? id : ""; };

/** Sign-in options: no credential list (the passkey on the device says who it is: a "discoverable credential", §6.2.2). */
export function loginOptions() {
  const rp = relyingParty();
  if (!rp.available) throw new PasskeyError(503, "Passkeys need this server to be reached over https (PUBLIC_URL), or on localhost.");
  const { flow, challenge } = newChallenge("login", null);
  return { flow, options: { challenge, rpId: rp.rpId, timeout: TIMEOUT_MS, userVerification: "required", allowCredentials: [] } };
}

/** Signs in with a passkey: returns the account (the caller opens the session). */
export function loginVerify(flow: unknown, response: unknown, requestOrigin?: string | null): UserRecord {
  const ch = takeChallenge(flow, "login", null);
  if (!ch) throw new PasskeyError(410, "This passkey request has expired. Try again.");
  const id = credentialId(response);
  const row = id ? q.get<Row>("SELECT * FROM passkeys WHERE id = ?", id) : undefined;
  const user = row ? users.byId(row.user_id) : null;
  if (!row || !user) throw new PasskeyError(401, "This passkey is not known here. Sign in with your password, then add it in Settings → Security.");
  // The user handle, when the device sends it, must be this account's (§7.2 step 6).
  const handle = (response as { response?: { userHandle?: unknown } }).response?.userHandle;
  if (handle !== undefined && handle !== null && handle !== "" && handle !== userHandle(user.id)) throw new PasskeyError(401, "The passkey could not be checked. Try again.");
  checkAssertion(row, response, ch.challenge, requestOrigin);
  return user;
}

/** Options to create a passkey for this account (its existing ones excluded, so the same device is not saved twice). */
export function registrationOptions(user: UserRecord) {
  const rp = relyingParty();
  if (!rp.available) throw new PasskeyError(503, "Passkeys need this server to be reached over https (PUBLIC_URL), or on localhost.");
  const mine = rowsOf(user.id);
  if (mine.length >= MAX_PASSKEYS) throw new PasskeyError(409, "You already have {n} passkeys. Remove one first.", { n: mine.length });
  const { flow, challenge } = newChallenge("register", user.id);
  return {
    flow,
    options: {
      challenge, rp: { id: rp.rpId, name: rp.name },
      user: { id: userHandle(user.id), name: user.email, displayName: user.name || user.email },
      pubKeyCredParams: SUPPORTED_ALGS.map((alg) => ({ type: "public-key", alg })),
      timeout: TIMEOUT_MS, attestation: "none",
      excludeCredentials: mine.map((r) => ({ id: r.id, type: "public-key", transports: JSON.parse(r.transports) as string[] })),
      authenticatorSelection: { residentKey: "required", requireResidentKey: true, userVerification: "required" },
      extensions: { credProps: true },
    },
  };
}

const cleanName = (v: unknown, fallback: string) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 60) : "") || fallback;

export function registrationVerify(user: UserRecord, flow: unknown, response: unknown, name: unknown, requestOrigin?: string | null): PasskeyView {
  const ch = takeChallenge(flow, "register", user.id);
  if (!ch) throw new PasskeyError(410, "This passkey request has expired. Try again.");
  const rp = relyingParty();
  let cred;
  try { cred = verifyRegistration(response, { challenge: ch.challenge, origins: rp.origins(requestOrigin), rpId: rp.rpId }); }
  catch (err) { if (err instanceof WebAuthnError) throw new PasskeyError(400, webauthnText(err)); throw err; }
  if (q.get("SELECT 1 FROM passkeys WHERE id = ?", cred.id)) throw new PasskeyError(409, "This passkey is already saved.");
  if (rowsOf(user.id).length >= MAX_PASSKEYS) throw new PasskeyError(409, "You already have {n} passkeys. Remove one first.", { n: MAX_PASSKEYS });
  const label = cleanName(name, `${m(user.locale, "Passkey")} ${rowsOf(user.id).length + 1}`);
  q.run("INSERT INTO passkeys (id, user_id, name, public_key, alg, counter, transports, backed_up, multi_device, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
    cred.id, user.id, label, cred.publicKey, cred.alg, cred.counter, JSON.stringify(cred.transports), cred.backedUp ? 1 : 0, cred.multiDevice ? 1 : 0, now());
  audit(user.id, "account", `Passkey added (${label})`);
  notifySecurity(user.id, m(user.locale, "A passkey was added"), m(user.locale, "The passkey « {name} » can now sign in to your account. If it was not you, remove it in Settings → Security and change your password.", { name: label }), "passkey-added");
  return view(q.get<Row>("SELECT * FROM passkeys WHERE id = ?", cred.id)!);
}

export function renamePasskey(userId: string, id: string, name: unknown): PasskeyView {
  const row = q.get<Row>("SELECT * FROM passkeys WHERE id = ? AND user_id = ?", id, userId);
  if (!row) throw new PasskeyError(404, "That passkey does not exist.");
  const label = cleanName(name, "");
  if (!label) throw new PasskeyError(400, "Give the passkey a name.");
  q.run("UPDATE passkeys SET name = ? WHERE id = ?", label, id);
  return view({ ...row, name: label });
}

export function removePasskey(userId: string, id: string): void {
  const row = q.get<Row>("SELECT name FROM passkeys WHERE id = ? AND user_id = ?", id, userId);
  if (!row) throw new PasskeyError(404, "That passkey does not exist.");
  q.run("DELETE FROM passkeys WHERE id = ? AND user_id = ?", id, userId);
  audit(userId, "account", `Passkey removed (${row.name})`);
}

// ── Proofs (floor approvals, turning the floor option off) ───────────────────────────────────────────────────────
const PURPOSE = /^(floor:[A-Za-z0-9_-]{1,80}|floor-off)$/;
export function proofOptions(userId: string, purpose: unknown) {
  if (typeof purpose !== "string" || !PURPOSE.test(purpose)) throw new PasskeyError(400, "Unknown purpose.");
  const rp = relyingParty();
  if (!rp.available) throw new PasskeyError(503, "Passkeys need this server to be reached over https (PUBLIC_URL), or on localhost.");
  const mine = rowsOf(userId);
  if (!mine.length) throw new PasskeyError(409, "You have no passkey yet.");
  const { flow, challenge } = newChallenge(`proof:${purpose}`, userId);
  return { flow, options: { challenge, rpId: rp.rpId, timeout: TIMEOUT_MS, userVerification: "required", allowCredentials: mine.map((r) => ({ id: r.id, type: "public-key", transports: JSON.parse(r.transports) as string[] })) } };
}
/** A checked passkey answer becomes a one-time proof ("pk:…", 2 minutes) for that purpose, sent with the approval. */
export function proofVerify(userId: string, flow: unknown, response: unknown, requestOrigin?: string | null): { proof: string; purpose: string } {
  const ch = takeChallenge(flow, (p) => p.startsWith("proof:"), userId);
  if (!ch) throw new PasskeyError(410, "This passkey request has expired. Try again.");
  const id = credentialId(response);
  const row = id ? q.get<Row>("SELECT * FROM passkeys WHERE id = ? AND user_id = ?", id, userId) : undefined;
  if (!row) throw new PasskeyError(401, "The passkey could not be checked. Try again.");
  checkAssertion(row, response, ch.challenge, requestOrigin);
  const token = randomToken(32);
  const purpose = ch.purpose.slice("proof:".length);
  q.run("DELETE FROM passkey_proofs WHERE expires_at < ?", now());
  q.run("INSERT INTO passkey_proofs (proof_hash, user_id, purpose, expires_at) VALUES (?, ?, ?, ?)", sha256(token), userId, purpose, now() + PROOF_MS);
  return { proof: `pk:${token}`, purpose };
}
/** Uses up a proof: true only once, for its own account and purpose, before it expires. */
export function consumeProof(userId: string, purpose: string, value: unknown): boolean {
  if (typeof value !== "string" || !value.startsWith("pk:") || value.length > 120) return false;
  const used = q.run("DELETE FROM passkey_proofs WHERE proof_hash = ? AND user_id = ? AND purpose = ? AND expires_at >= ?", sha256(value.slice(3)), userId, purpose, now()).changes;
  return Number(used) === 1;
}

// ── Routes ───────────────────────────────────────────────────────────────────────────────────────────────────────
export interface PasskeyDeps { throttle(key: string, limit?: number): void; clientIp(c: Context): string; publicUser(u: UserRecord): unknown }
const readBody = async (c: Context): Promise<Record<string, unknown>> => {
  const b = await c.req.json().catch(() => ({}));
  return b && typeof b === "object" ? (b as Record<string, unknown>) : {};
};
function handle(fn: (c: Context, b: Record<string, unknown>) => Promise<Response> | Response) {
  return async (c: Context) => {
    const b = c.req.method === "GET" ? {} : await readBody(c);
    const user = c.get("user") as UserRecord | undefined;
    const locale: Locale = user?.locale ?? pickLocale(b.locale, c.req.header("accept-language"));
    try { return await fn(c, b); } catch (err) {
      if (err instanceof PasskeyError) return c.json({ error: m(locale, err.message, err.vars) }, err.status);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return c.json({ error: m(locale, "Too many attempts. Wait a few minutes and try again.") }, 429);
      throw err;
    }
  };
}
const userOf = (c: Context) => c.get("user") as UserRecord;

export function registerPasskeyPublic(api: Hono<any>, deps: PasskeyDeps) {
  api.post("/auth/passkey/options", handle((c) => {
    deps.throttle(`pk-ip:${deps.clientIp(c)}`, 60);
    return c.json(loginOptions());
  }));
  api.post("/auth/passkey/verify", handle((c, b) => {
    if (!originAllowed(c.req.header("origin"), c.req.header("host"))) throw new PasskeyError(403, "Cross-site request refused.");
    deps.throttle(`pk-login:${deps.clientIp(c)}`, 30);
    const user = loginVerify(b.flow, b.response, c.req.header("origin"));
    audit(user.id, "account", "Signed in with a passkey");
    openSession(c, user.id, "passkey");
    return c.json({ user: deps.publicUser(user) });
  }));
}

/** Whether this session may add a passkey: the password, or a session opened less than 15 minutes ago (no password). */
function checkReauth(c: Context, user: UserRecord, password: unknown, what: "add" | "remove" = "add") {
  if (user.passHash.startsWith("scrypt$")) {
    if (typeof password !== "string" || !password) throw new PasskeyError(401, what === "add" ? "Type your password to add a passkey." : "Type your password to remove a passkey.");
    if (!verifyPassword(password, user.passHash)) throw new PasskeyError(401, "The password is wrong.");
    return;
  }
  const s = q.get<{ created_at: number }>("SELECT created_at FROM sessions WHERE token_hash = ?", sha256(getCookie(c, SESSION_COOKIE) ?? ""));
  if (!s || s.created_at < now() - REAUTH_MS) throw new PasskeyError(403, what === "add" ? "Sign in again, then add the passkey within 15 minutes." : "Sign in again, then remove the passkey within 15 minutes.");
}

export function registerPasskeyPrivate(api: Hono<any>, deps: PasskeyDeps) {
  api.get("/account/passkeys", handle((c) => {
    const user = userOf(c);
    const rp = relyingParty();
    return c.json({ available: rp.available, passkeys: listPasskeys(user.id), max: MAX_PASSKEYS, needsPassword: user.passHash.startsWith("scrypt$") });
  }));
  api.post("/account/passkeys/options", handle((c, b) => {
    const user = userOf(c);
    deps.throttle(`pk-add:${user.id}`, 20);
    checkReauth(c, user, b.password);
    return c.json(registrationOptions(user));
  }));
  api.post("/account/passkeys", handle((c, b) => {
    const user = userOf(c);
    deps.throttle(`pk-save:${user.id}`, 20);
    return c.json({ passkey: registrationVerify(user, b.flow, b.response, b.name, c.req.header("origin")), passkeys: listPasskeys(user.id) });
  }));
  api.patch("/account/passkeys/:pkId", handle((c, b) => c.json({ passkey: renamePasskey(userOf(c).id, c.req.param("pkId") ?? "", b.name) })));
  api.delete("/account/passkeys/:pkId", handle((c, b) => {
    const user = userOf(c);
    deps.throttle(`pk-remove:${user.id}`, 20);
    // Same proof as adding one: otherwise a stolen session could remove the passkey that guards the floor, then turn it off.
    if (!q.get("SELECT 1 FROM passkeys WHERE id = ? AND user_id = ?", c.req.param("pkId") ?? "", user.id)) throw new PasskeyError(404, "That passkey does not exist.");
    checkReauth(c, user, b.password, "remove");
    removePasskey(user.id, c.req.param("pkId") ?? "");
    return c.json({ passkeys: listPasskeys(userOf(c).id) });
  }));
  api.post("/account/passkey-proof/options", handle((c, b) => {
    deps.throttle(`pk-proof:${userOf(c).id}`, 30);
    return c.json(proofOptions(userOf(c).id, b.purpose));
  }));
  api.post("/account/passkey-proof", handle((c, b) => {
    deps.throttle(`pk-proof-check:${userOf(c).id}`, 30);
    return c.json(proofVerify(userOf(c).id, b.flow, b.response, c.req.header("origin")));
  }));
}
