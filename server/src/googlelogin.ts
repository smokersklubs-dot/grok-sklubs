/**
 * "Continuer avec Google": signing in to Sklubot with a Google account (OpenID Connect, authorization code flow).
 *
 * Sources (Google's official documentation):
 *  - OpenID Connect: https://developers.google.com/identity/openid-connect/openid-connect
 *    ("Server flow": authentication request with client_id, response_type=code, scope, redirect_uri, state, nonce;
 *    "Exchange code for access token and ID token": code, client_id, client_secret, redirect_uri, grant_type;
 *    "Validating an ID token": signature with Google's public keys (jwks_uri), iss = https://accounts.google.com or
 *    accounts.google.com, aud = our client ID, exp not passed; "An ID token's payload": `sub` is the account's
 *    identifier, `email` may change, `email_verified`).
 *  - Discovery document: https://accounts.google.com/.well-known/openid-configuration — every endpoint
 *    (authorization_endpoint, token_endpoint, jwks_uri) and the issuer are read from it, never written here.
 *  - PKCE: https://developers.google.com/identity/protocols/oauth2/native-app ("Step 1: Generate a code verifier and
 *    challenge", "Step 2": code_challenge + code_challenge_method=S256, "Step 5": code_verifier), and the discovery
 *    document's code_challenge_methods_supported (S256).
 *  - prompt=select_account: https://developers.google.com/identity/protocols/oauth2/web-server ("Step 1: Set
 *    authorization parameters", prompt).
 *
 * Even though the ID token comes straight from Google's token endpoint over TLS (which the OIDC doc says is enough),
 * its signature is verified as well, with the JWKS keys, and so are iss, aud, exp and nonce.
 *
 * The flow's state, nonce and PKCE verifier are kept server-side (memory, 10 minutes, single use) and bound to the
 * browser that started it by a short-lived httpOnly cookie: a callback without that cookie is refused.
 *
 * Mobile app (server side only, for a later app update): GET /api/auth/google/start?app=1&code_challenge=<S256 of a
 * random verifier>&code_challenge_method=S256 opens Google in the system browser; on success the browser goes to
 * sklubot://auth?code=<one-time code> (60 s, single use). The app then calls POST /api/auth/app/exchange
 * { code, verifier } and receives its session cookie (Set-Cookie), exactly like POST /api/auth/login. Another app that
 * intercepts the sklubot:// address gets the code but not the verifier, which never leaves the app that started.
 */
import { createHash, createPublicKey, randomBytes, timingSafeEqual, verify as verifySignature, type KeyObject } from "node:crypto";
import type { Context, Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { hashPassword, originAllowed, seal, SESSION_COOKIE, setupCodeMatches, setupCodeRequired, signupOpen, unseal } from "./auth.js";
import { invalidateAudience } from "./bus.js";
import { config } from "./config.js";
import { db, q } from "./db.js";
import { guardedFetch } from "./net.js";
import type { Locale } from "./shared.js";
import { audit, bots, now, sha256, users, type UserRecord } from "./store.js";
import { invites } from "./workspaces.js";

// ── Storage (additive) ──────────────────────────────────────────────────────
db.exec(`
CREATE TABLE IF NOT EXISTS google_login (
  id INTEGER PRIMARY KEY CHECK (id = 1), client_id TEXT NOT NULL, secret_enc TEXT NOT NULL,
  updated_at INTEGER NOT NULL, updated_by TEXT
);
CREATE TABLE IF NOT EXISTS google_identities (
  sub TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  email TEXT NOT NULL, linked_at INTEGER NOT NULL
);`);

export const GOOGLE_SCOPES = "openid email profile";
const GOOGLE_DISCOVERY = "https://accounts.google.com/.well-known/openid-configuration";
const FLOW_COOKIE = "sklubot_google_flow";
const FLOW_MS = 10 * 60_000;
const APP_CODE_MS = 60_000;
const APP_REDIRECT = "sklubot://auth";
/** Accounts created with Google get this instead of a password hash: it never matches (verifyPassword wants scrypt$…). */
const NO_PASSWORD_PREFIX = "google$";

export const hasPassword = (u: UserRecord) => u.passHash.startsWith("scrypt$");
export const callbackUrl = () => `${config.publicUrl}/api/auth/google/callback`;

/** The server's owner: the earliest account (Sklubot has no separate admin role). */
export function ownerId(): string | null {
  return q.get<{ id: string }>("SELECT id FROM users ORDER BY created_at ASC, rowid ASC LIMIT 1")?.id ?? null;
}

/** The discovery address. Only tests may point it at a fake Google (NODE_ENV=test). */
function discoveryUrl(): string {
  const override = process.env.GOOGLE_OIDC_DISCOVERY_URL;
  return process.env.NODE_ENV === "test" && override ? override : GOOGLE_DISCOVERY;
}

interface Credentials { clientId: string; clientSecret: string; source: "env" | "saved" }
export function credentials(): Credentials | null {
  const envId = (process.env.GOOGLE_LOGIN_CLIENT_ID ?? "").trim();
  const envSecret = (process.env.GOOGLE_LOGIN_CLIENT_SECRET ?? "").trim();
  if (envId && envSecret) return { clientId: envId, clientSecret: envSecret, source: "env" };
  const row = q.get<{ client_id: string; secret_enc: string }>("SELECT client_id, secret_enc FROM google_login WHERE id = 1");
  const secret = row ? unseal(row.secret_enc) : null;
  return row && secret ? { clientId: row.client_id, clientSecret: secret, source: "saved" } : null;
}
export const googleEnabled = () => !!credentials();

// ── Texts (French and English; English is the key) ─────────────────────────
const FR: Record<string, string> = {
  "Google sign-in is not set up on this server.": "La connexion avec Google n'est pas configurée sur ce serveur.",
  "This Google sign-in has expired or was started in another browser. Try again.": "Cette connexion avec Google a expiré ou a été commencée dans un autre navigateur. Réessaie.",
  "The Google sign-in was cancelled.": "La connexion avec Google a été annulée.",
  "Google did not confirm this sign-in. Try again.": "Google n'a pas confirmé cette connexion. Réessaie.",
  "Google could not be reached. Try again in a moment.": "Google ne répond pas. Réessaie dans un instant.",
  "This Google account's email address is not verified by Google.": "L'adresse e-mail de ce compte Google n'est pas vérifiée par Google.",
  "New accounts are closed on this server. Ask its owner for an invitation.": "La création de comptes est fermée sur ce serveur. Demande une invitation à la personne qui le gère.",
  "This address is not allowed to create an account on this server.": "Cette adresse n'a pas le droit de créer un compte sur ce serveur.",
  "The setup code is missing or wrong. It was shown at the end of the installation, and is in the server's .env file (SKLUBOT_SETUP_CODE).": "Le code d'installation manque ou est faux. Il a été affiché à la fin de l'installation et se trouve dans le fichier .env du serveur (SKLUBOT_SETUP_CODE).",
  "The very first account of this server must be created on the website, with the setup code.": "Le tout premier compte de ce serveur doit être créé sur le site, avec le code d'installation.",
  "This Google account is already linked to another Sklubot account.": "Ce compte Google est déjà lié à un autre compte Sklubot.",
  "Your Sklubot account with this address is linked to another Google account.": "Ton compte Sklubot avec cette adresse est lié à un autre compte Google.",
  "The team is full on this server: no new account can be created.": "L'équipe est complète sur ce serveur : aucun nouveau compte ne peut être créé.",
  "Too many attempts. Wait a few minutes and try again.": "Trop d'essais. Attends quelques minutes puis réessaie.",
  "Google sign-in did not finish": "La connexion avec Google n'a pas abouti",
  "Back to Sklubot": "Retour à Sklubot",
  "Only the owner of this server can change this.": "Seule la personne qui gère ce serveur peut changer ça.",
  "Enter the client ID from Google Cloud Console (it ends in .apps.googleusercontent.com).": "Colle l'ID client de Google Cloud Console (il se termine par .apps.googleusercontent.com).",
  "Enter the client secret from Google Cloud Console.": "Colle le code secret du client de Google Cloud Console.",
  "These keys are set in the server's environment (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET): change them there.": "Ces clés sont réglées dans l'environnement du serveur (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET) : change-les là-bas.",
  "Choose a password first: without it, you could no longer sign in.": "Choisis d'abord un mot de passe : sans lui, tu ne pourrais plus te connecter.",
  "Your account already has a password. Change it with your current password.": "Ton compte a déjà un mot de passe. Change-le avec ton mot de passe actuel.",
  "Choose a password of at least 8 characters.": "Choisis un mot de passe d'au moins 8 caractères.",
  "This code is wrong, used or expired. Sign in again.": "Ce code est faux, déjà utilisé ou expiré. Reconnecte-toi.",
  "The app did not send a valid code_challenge (S256).": "L'application n'a pas envoyé de code_challenge valide (S256).",
};
const m = (locale: Locale, english: string) => (locale === "fr" ? FR[english] ?? english : english);
const pickLoc = (value: unknown, acceptLanguage?: string | null): Locale =>
  value === "fr" || value === "en" ? value : /^\s*fr/i.test(acceptLanguage ?? "") ? "fr" : "en";

class GoogleError extends Error { constructor(public status: 400 | 403 | 404 | 409 | 502, message: string) { super(message); } }

// ── Discovery and keys (cached one hour) ────────────────────────────────────
interface Discovery { issuer: string; authorization_endpoint: string; token_endpoint: string; jwks_uri: string }
let discoveryCache: { url: string; at: number; doc: Discovery } | null = null;
let jwksCache: { uri: string; at: number; keys: Map<string, KeyObject> } | null = null;
const HOUR = 3600_000;

async function getJson(url: string, init: RequestInit = {}): Promise<{ status: number; json: any }> {
  const res = await guardedFetch(url, { ...init, signal: AbortSignal.timeout(10_000), headers: { accept: "application/json", ...(init.headers as Record<string, string> | undefined) } });
  const text = await res.text();
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* not JSON */ }
  return { status: res.status, json };
}

async function discovery(): Promise<Discovery> {
  const url = discoveryUrl();
  if (discoveryCache && discoveryCache.url === url && Date.now() - discoveryCache.at < HOUR) return discoveryCache.doc;
  const { status, json } = await getJson(url);
  const ok = status === 200 && json && ["issuer", "authorization_endpoint", "token_endpoint", "jwks_uri"].every((k) => typeof json[k] === "string");
  if (!ok) throw new GoogleError(502, "Google could not be reached. Try again in a moment.");
  discoveryCache = { url, at: Date.now(), doc: json as Discovery };
  return discoveryCache.doc;
}

async function signingKey(doc: Discovery, kid: string): Promise<KeyObject | null> {
  const fresh = jwksCache && jwksCache.uri === doc.jwks_uri && Date.now() - jwksCache.at < HOUR;
  if (fresh && jwksCache!.keys.has(kid)) return jwksCache!.keys.get(kid)!;
  // Unknown key id: Google rotates its keys, so fetch the set again (at most once a minute).
  if (fresh && Date.now() - jwksCache!.at < 60_000) return null;
  const { status, json } = await getJson(doc.jwks_uri);
  if (status !== 200 || !Array.isArray(json?.keys)) throw new GoogleError(502, "Google could not be reached. Try again in a moment.");
  const keys = new Map<string, KeyObject>();
  for (const k of json.keys) {
    if (k?.kty !== "RSA" || typeof k.kid !== "string" || (k.use && k.use !== "sig")) continue;
    try { keys.set(k.kid, createPublicKey({ key: { kty: "RSA", n: k.n, e: k.e }, format: "jwk" })); } catch { /* skip a malformed key */ }
  }
  jwksCache = { uri: doc.jwks_uri, at: Date.now(), keys };
  return keys.get(kid) ?? null;
}

const b64url = (b: Buffer) => b.toString("base64url");
const s256 = (verifier: string) => b64url(createHash("sha256").update(verifier).digest());
const sameText = (a: string, b: string) => { const x = Buffer.from(a); const y = Buffer.from(b); return x.length === y.length && timingSafeEqual(x, y); };

export interface GoogleClaims { sub: string; email: string; name: string }

/** "Validating an ID token" (Google OIDC doc): RS256 signature with the JWKS key, iss, aud, exp; plus our nonce. */
export async function verifyIdToken(idToken: string, clientId: string, nonce: string): Promise<GoogleClaims> {
  const bad = () => new GoogleError(403, "Google did not confirm this sign-in. Try again.");
  const parts = idToken.split(".");
  if (parts.length !== 3) throw bad();
  let header: any; let claims: any;
  try { header = JSON.parse(Buffer.from(parts[0], "base64url").toString("utf8")); claims = JSON.parse(Buffer.from(parts[1], "base64url").toString("utf8")); } catch { throw bad(); }
  if (header?.alg !== "RS256" || typeof header.kid !== "string") throw bad();
  const doc = await discovery();
  const key = await signingKey(doc, header.kid);
  if (!key || !verifySignature("RSA-SHA256", Buffer.from(`${parts[0]}.${parts[1]}`), key, Buffer.from(parts[2], "base64url"))) throw bad();
  const issuers = doc.issuer === "https://accounts.google.com" ? ["https://accounts.google.com", "accounts.google.com"] : [doc.issuer];
  if (!issuers.includes(claims.iss)) throw bad();
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!aud.includes(clientId) || (aud.length > 1 && claims.azp !== clientId)) throw bad();
  const t = Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== "number" || claims.exp < t - 60) throw bad();
  if (typeof claims.iat === "number" && claims.iat > t + 300) throw bad();
  if (typeof claims.nonce !== "string" || !sameText(claims.nonce, nonce)) throw bad();
  if (typeof claims.sub !== "string" || !claims.sub || typeof claims.email !== "string" || !claims.email.includes("@")) throw bad();
  if (claims.email_verified !== true && claims.email_verified !== "true") throw new GoogleError(403, "This Google account's email address is not verified by Google.");
  return { sub: claims.sub, email: claims.email.trim().toLowerCase(), name: typeof claims.name === "string" ? claims.name.slice(0, 80) : "" };
}

// ── Flows in progress (memory, single use) ──────────────────────────────────
interface Flow {
  browserHash: string; nonce: string; verifier: string; expires: number; locale: Locale;
  invite: string | null; setupOk: boolean; linkUserId: string | null; appChallenge: string | null;
}
const flows = new Map<string, Flow>();
interface AppCode { userId: string; challenge: string; expires: number }
const appCodes = new Map<string, AppCode>();
const MAX_PENDING = 5000;
function prune<T extends { expires: number }>(map: Map<string, T>) {
  const t = Date.now();
  for (const [k, v] of map) if (v.expires <= t) map.delete(k);
  for (const k of map.keys()) { if (map.size < MAX_PENDING) break; map.delete(k); }
}

// ── Accounts ────────────────────────────────────────────────────────────────
const identityOf = (userId: string) => q.get<{ sub: string; email: string }>("SELECT sub, email FROM google_identities WHERE user_id = ?", userId) ?? null;
const userOfSub = (sub: string) => q.get<{ user_id: string }>("SELECT user_id FROM google_identities WHERE sub = ?", sub)?.user_id ?? null;
function linkIdentity(userId: string, c: GoogleClaims) {
  q.tx(() => {
    q.run("DELETE FROM google_identities WHERE user_id = ?", userId);
    q.run("INSERT INTO google_identities (sub, user_id, email, linked_at) VALUES (?, ?, ?, ?)", c.sub, userId, c.email, now());
  });
}

/** What routes.ts lends us, so sessions, throttling and new accounts work exactly as for passwords. */
export interface GoogleDeps {
  throttle(key: string, limit?: number): void;
  clientIp(c: Context): string;
  startSession(c: Context, userId: string): void;
  publicUser(u: UserRecord): unknown;
  firstBotIdentity(locale: Locale, name?: unknown, label?: unknown): { name: string; label: string };
}

function escHtml(s: string) { return s.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!); }

function errorPage(c: Context, locale: Locale, message: string, status: 400 | 403 | 404 | 409 | 502, back = "/") {
  const title = m(locale, "Google sign-in did not finish");
  return c.html(`<!doctype html><html lang="${locale}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Sklubot</title><style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f6f6f8;color:#1d1d24}main{max-width:440px;text-align:center;line-height:1.5}h1{font-size:1.15rem}a{color:#4f46e5}@media(prefers-color-scheme:dark){body{background:#15151b;color:#ececf1}a{color:#a5b4fc}}</style></head><body><main><h1>${escHtml(title)}</h1><p>${escHtml(m(locale, message))}</p><p><a href="${escHtml(back)}">${escHtml(m(locale, "Back to Sklubot"))}</a></p></main></body></html>`,
    status, { "cache-control": "no-store", "referrer-policy": "no-referrer" });
}

const cookieOpts = () => ({ httpOnly: true, sameSite: "Lax" as const, path: "/api/auth/google", secure: config.publicUrl.startsWith("https://") });

/** Prepares a flow and returns Google's authorization address (all parameters from Google's docs, see the top). */
async function beginFlow(c: Context, f: Omit<Flow, "browserHash" | "nonce" | "verifier" | "expires">): Promise<string> {
  const cred = credentials();
  if (!cred) throw new GoogleError(404, "Google sign-in is not set up on this server.");
  const doc = await discovery();
  const state = b64url(randomBytes(32));
  const browser = b64url(randomBytes(32));
  const flow: Flow = { ...f, browserHash: sha256(browser), nonce: b64url(randomBytes(24)), verifier: b64url(randomBytes(48)), expires: Date.now() + FLOW_MS };
  prune(flows);
  flows.set(state, flow);
  setCookie(c, FLOW_COOKIE, browser, { ...cookieOpts(), maxAge: FLOW_MS / 1000 });
  const url = new URL(doc.authorization_endpoint);
  url.search = new URLSearchParams({
    client_id: cred.clientId, response_type: "code", scope: GOOGLE_SCOPES, redirect_uri: callbackUrl(), state, nonce: flow.nonce,
    code_challenge: s256(flow.verifier), code_challenge_method: "S256", prompt: "select_account",
  }).toString();
  return url.toString();
}

/** "Exchange code for access token and ID token" (Google OIDC doc) + code_verifier (PKCE, native-app doc step 5). */
async function exchange(code: string, flow: Flow): Promise<GoogleClaims> {
  const cred = credentials();
  if (!cred) throw new GoogleError(404, "Google sign-in is not set up on this server.");
  const doc = await discovery();
  let res: { status: number; json: any };
  try {
    res = await getJson(doc.token_endpoint, {
      method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ code, client_id: cred.clientId, client_secret: cred.clientSecret, redirect_uri: callbackUrl(), grant_type: "authorization_code", code_verifier: flow.verifier }).toString(),
    });
  } catch { throw new GoogleError(502, "Google could not be reached. Try again in a moment."); }
  if (res.status !== 200 || typeof res.json?.id_token !== "string") throw new GoogleError(403, "Google did not confirm this sign-in. Try again.");
  return verifyIdToken(res.json.id_token, cred.clientId, flow.nonce);
}

/** Finds (or, when sign-ups allow it, creates) the Sklubot account for these Google claims. */
function resolveAccount(c: Context, deps: GoogleDeps, flow: Flow, claims: GoogleClaims): { user: UserRecord; created: boolean } {
  const bySub = userOfSub(claims.sub);
  if (bySub) { const u = users.byId(bySub); if (u) return { user: u, created: false }; }
  const existing = users.byEmail(claims.email);
  if (existing) {
    const linked = identityOf(existing.id);
    if (linked && linked.sub !== claims.sub) throw new GoogleError(409, "Your Sklubot account with this address is linked to another Google account.");
    linkIdentity(existing.id, claims);
    return { user: existing, created: false };
  }
  // A new account: the same rules as POST /auth/signup.
  const invite = flow.invite ? invites.peek(flow.invite) : null;
  const invited = !!invite && invite.email.toLowerCase() === claims.email;
  if (!signupOpen() && !invited) throw new GoogleError(403, "New accounts are closed on this server. Ask its owner for an invitation.");
  deps.throttle(`signup:${deps.clientIp(c)}`, 20);
  if (setupCodeRequired() && !flow.setupOk) throw new GoogleError(403, flow.appChallenge ? "The very first account of this server must be created on the website, with the setup code." : "The setup code is missing or wrong. It was shown at the end of the installation, and is in the server's .env file (SKLUBOT_SETUP_CODE).");
  if (config.allowedEmails.length && !config.allowedEmails.includes(claims.email) && !invited) throw new GoogleError(403, "This address is not allowed to create an account on this server.");
  try { bots.assertRoom(); } catch { throw new GoogleError(409, "The team is full on this server: no new account can be created."); }
  const user = users.create(claims.email, claims.name, NO_PASSWORD_PREFIX + b64url(randomBytes(32)), flow.locale);
  const first = deps.firstBotIdentity(flow.locale);
  bots.create(user.id, {
    name: first.name, label: first.label, primary: true, shape: "pebble", color: "indigo",
    description: flow.locale === "fr"
      ? "Ton interlocuteur principal. Garde le fil de ce qui est en cours, te prévient quand quelque chose a besoin de toi et coordonne les autres bots."
      : "Your main point of contact. Keeps track of what is open, checks in when something needs you, and coordinates the other bots.",
  });
  linkIdentity(user.id, claims);
  audit(user.id, "account", "Account created with Google");
  return { user, created: true };
}

/** Routes reachable without a session (mounted before the session middleware). */
export function registerGooglePublic(api: Hono<any>, deps: GoogleDeps) {
  api.get("/auth/google/status", (c) => c.json({ enabled: googleEnabled() }));

  // Web: POST (so the setup code never sits in an address). Body: { invite?, setupCode?, locale? }.
  api.post("/auth/google/start", async (c) => {
    if (!originAllowed(c.req.header("origin"), c.req.header("host"))) return c.json({ error: "Cross-site request refused." }, 403);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const locale = pickLoc(b.locale, c.req.header("accept-language"));
    try {
      deps.throttle(`google:${deps.clientIp(c)}`, 30);
      let setupOk = false;
      if (setupCodeRequired()) {
        if (!setupCodeMatches(String(b.setupCode ?? ""))) throw new GoogleError(403, "The setup code is missing or wrong. It was shown at the end of the installation, and is in the server's .env file (SKLUBOT_SETUP_CODE).");
        setupOk = true;
      }
      const url = await beginFlow(c, { locale, invite: typeof b.invite === "string" && b.invite ? b.invite.slice(0, 200) : null, setupOk, linkUserId: null, appChallenge: null });
      return c.json({ url });
    } catch (err) {
      if (err instanceof GoogleError) return c.json({ error: m(locale, err.message) }, err.status);
      throw err;
    }
  });

  // Links and the mobile app: GET, then straight to Google. ?app=1&code_challenge=…&code_challenge_method=S256[&invite=…]
  api.get("/auth/google/start", async (c) => {
    const locale = pickLoc(c.req.query("locale"), c.req.header("accept-language"));
    const app = c.req.query("app") === "1";
    try {
      deps.throttle(`google:${deps.clientIp(c)}`, 30);
      const challenge = c.req.query("code_challenge") ?? "";
      if (app && (c.req.query("code_challenge_method") !== "S256" || !/^[A-Za-z0-9_-]{43}$/.test(challenge))) throw new GoogleError(400, "The app did not send a valid code_challenge (S256).");
      const url = await beginFlow(c, { locale, invite: c.req.query("invite")?.slice(0, 200) || null, setupOk: false, linkUserId: null, appChallenge: app ? challenge : null });
      return c.redirect(url, 302);
    } catch (err) {
      if (err instanceof GoogleError) return errorPage(c, locale, err.message, err.status);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return errorPage(c, locale, "Too many attempts. Wait a few minutes and try again.", 403);
      throw err;
    }
  });

  api.get("/auth/google/callback", async (c) => {
    const state = c.req.query("state") ?? "";
    const flow = state ? flows.get(state) : undefined;
    if (flow) flows.delete(state); // single use, whatever happens next
    const browser = getCookie(c, FLOW_COOKIE);
    deleteCookie(c, FLOW_COOKIE, cookieOpts());
    let locale = flow?.locale ?? pickLoc(undefined, c.req.header("accept-language"));
    const back = flow?.invite ? `/?invite=${encodeURIComponent(flow.invite)}` : "/";
    try {
      if (!flow || flow.expires < Date.now() || !browser || !sameText(sha256(browser), flow.browserHash)) throw new GoogleError(400, "This Google sign-in has expired or was started in another browser. Try again.");
      if (c.req.query("error")) throw new GoogleError(400, "The Google sign-in was cancelled.");
      const code = c.req.query("code") ?? "";
      if (!code) throw new GoogleError(400, "Google did not confirm this sign-in. Try again.");
      deps.throttle(`ip:${deps.clientIp(c)}`, 30);
      const claims = await exchange(code, flow);

      // Linking from Settings → Account: the signed-in account gets this Google account.
      if (flow.linkUserId) {
        const user = users.byId(flow.linkUserId);
        if (!user) throw new GoogleError(400, "This Google sign-in has expired or was started in another browser. Try again.");
        locale = user.locale;
        const other = userOfSub(claims.sub);
        if (other && other !== user.id) throw new GoogleError(409, "This Google account is already linked to another Sklubot account.");
        linkIdentity(user.id, claims);
        audit(user.id, "account", `Google account linked (${claims.email})`);
        return c.redirect("/?google=linked", 302);
      }

      const { user } = resolveAccount(c, deps, flow, claims);
      // An invitation for this address is accepted on the way in (new or existing account).
      if (flow.invite) { try { invites.accept(flow.invite, user.id); invalidateAudience(); } catch { /* used, expired or for another address */ } }
      audit(user.id, "account", "Signed in with Google");
      if (flow.appChallenge) {
        prune(appCodes);
        const one = b64url(randomBytes(32));
        appCodes.set(sha256(one), { userId: user.id, challenge: flow.appChallenge, expires: Date.now() + APP_CODE_MS });
        return c.redirect(`${APP_REDIRECT}?code=${encodeURIComponent(one)}`, 302);
      }
      deps.startSession(c, user.id);
      return c.redirect("/", 302);
    } catch (err) {
      if (err instanceof GoogleError) return errorPage(c, locale, err.message, err.status, back);
      if (err instanceof Error && /Too many attempts/.test(err.message)) return errorPage(c, locale, "Too many attempts. Wait a few minutes and try again.", 403, back);
      console.error("[google-login]", err);
      return errorPage(c, locale, "Google did not confirm this sign-in. Try again.", 502, back);
    }
  });

  // The mobile app trades its one-time code (and the verifier only it knows) for a session, like POST /auth/login.
  api.post("/auth/app/exchange", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const locale = pickLoc(b.locale, c.req.header("accept-language"));
    deps.throttle(`ip:${deps.clientIp(c)}`, 30);
    const code = typeof b.code === "string" ? b.code : "";
    const verifier = typeof b.verifier === "string" ? b.verifier : "";
    const key = code ? sha256(code) : "";
    const entry = key ? appCodes.get(key) : undefined;
    if (entry) appCodes.delete(key); // single use: a wrong verifier burns the code too
    if (!entry || entry.expires < Date.now() || verifier.length < 43 || verifier.length > 128 || !sameText(s256(verifier), entry.challenge)) {
      return c.json({ error: m(locale, "This code is wrong, used or expired. Sign in again.") }, 400);
    }
    const user = users.byId(entry.userId);
    if (!user) return c.json({ error: m(locale, "This code is wrong, used or expired. Sign in again.") }, 400);
    deps.startSession(c, user.id);
    return c.json({ user: deps.publicUser(user) });
  });
}

/** Routes for signed-in people (mounted after the session middleware, which sets c.get("user") and checks Origin). */
export function registerGooglePrivate(api: Hono<any>, deps: GoogleDeps) {
  const ownerOnly = (c: Context) => {
    const user = c.get("user") as UserRecord;
    if (ownerId() !== user.id) throw new GoogleError(403, "Only the owner of this server can change this.");
    return user;
  };
  const handle = (fn: (c: Context) => Promise<Response> | Response) => async (c: Context) => {
    try { return await fn(c); } catch (err) {
      if (err instanceof GoogleError) return c.json({ error: m((c.get("user") as UserRecord).locale, err.message) }, err.status);
      throw err;
    }
  };
  const view = () => {
    const cred = credentials();
    return { configured: !!cred, source: cred?.source ?? null, clientId: cred?.clientId ?? "", hasSecret: !!cred, redirectUri: callbackUrl(), publicUrl: config.publicUrl, scopes: GOOGLE_SCOPES };
  };

  // The owner's settings: the client secret is never sent back, only whether one is saved.
  api.get("/settings/google-login", handle((c) => { ownerOnly(c); return c.json(view()); }));
  api.put("/settings/google-login", handle(async (c) => {
    const user = ownerOnly(c);
    if (credentials()?.source === "env") throw new GoogleError(409, "These keys are set in the server's environment (GOOGLE_LOGIN_CLIENT_ID / GOOGLE_LOGIN_CLIENT_SECRET): change them there.");
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const clientId = String(b.clientId ?? "").trim();
    const secret = String(b.clientSecret ?? "").trim();
    if (!/^[A-Za-z0-9._-]{1,200}\.apps\.googleusercontent\.com$/.test(clientId)) throw new GoogleError(400, "Enter the client ID from Google Cloud Console (it ends in .apps.googleusercontent.com).");
    const saved = q.get<{ secret_enc: string }>("SELECT secret_enc FROM google_login WHERE id = 1");
    if (!secret && !saved) throw new GoogleError(400, "Enter the client secret from Google Cloud Console.");
    if (secret.length > 500) throw new GoogleError(400, "Enter the client secret from Google Cloud Console.");
    const enc = secret ? seal(secret) : saved!.secret_enc;
    q.run("INSERT INTO google_login (id, client_id, secret_enc, updated_at, updated_by) VALUES (1, ?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET client_id = excluded.client_id, secret_enc = excluded.secret_enc, updated_at = excluded.updated_at, updated_by = excluded.updated_by", clientId, enc, now(), user.id);
    audit(user.id, "account", "Google sign-in settings saved");
    return c.json(view());
  }));
  api.delete("/settings/google-login", handle((c) => {
    const user = ownerOnly(c);
    q.run("DELETE FROM google_login WHERE id = 1");
    audit(user.id, "account", "Google sign-in settings removed");
    return c.json(view());
  }));

  // The account's own Google link.
  api.get("/account/google", (c) => {
    const user = c.get("user") as UserRecord;
    const id = identityOf(user.id);
    return c.json({ enabled: googleEnabled(), linked: !!id, email: id?.email ?? null, hasPassword: hasPassword(user) });
  });
  api.post("/account/google/link", handle(async (c) => {
    const user = c.get("user") as UserRecord;
    deps.throttle(`google:${deps.clientIp(c)}`, 30);
    const url = await beginFlow(c, { locale: user.locale, invite: null, setupOk: false, linkUserId: user.id, appChallenge: null });
    return c.json({ url });
  }));
  api.delete("/account/google", handle((c) => {
    const user = c.get("user") as UserRecord;
    if (!hasPassword(user)) throw new GoogleError(409, "Choose a password first: without it, you could no longer sign in.");
    q.run("DELETE FROM google_identities WHERE user_id = ?", user.id);
    audit(user.id, "account", "Google account unlinked");
    return c.json({ ok: true });
  }));
  // An account created with Google has no password: it can choose one here (no current password to give).
  api.post("/account/google/password", handle(async (c) => {
    const user = c.get("user") as UserRecord;
    deps.throttle(`pw:${user.id}`);
    if (hasPassword(user)) throw new GoogleError(409, "Your account already has a password. Change it with your current password.");
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const next = String(b.next ?? "");
    if (next.length < 8) throw new GoogleError(400, "Choose a password of at least 8 characters.");
    q.run("UPDATE users SET pass_hash = ? WHERE id = ?", hashPassword(next), user.id);
    // Like a password change: every other device is signed out, this one stays in.
    q.run("DELETE FROM sessions WHERE user_id = ? AND token_hash != ?", user.id, sha256(getCookie(c, SESSION_COOKIE) ?? ""));
    q.run("DELETE FROM password_resets WHERE user_id = ?", user.id); // older "forgot password" links stop working
    audit(user.id, "account", "Password set");
    return c.json({ ok: true });
  }));
}

/** For tests only: forget cached discovery and keys. */
export function resetGoogleCaches() { discoveryCache = null; jwksCache = null; flows.clear(); appCodes.clear(); }
