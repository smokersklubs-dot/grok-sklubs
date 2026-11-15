import { createHash } from "node:crypto";
import { seal, unseal } from "../auth.js";
import { emit } from "../bus.js";
import { q } from "../db.js";
import { fetchProblem, guardedFetch } from "../net.js";
import { audit, newId, now, randomToken, sha256 } from "../store.js";
import type { NativeAccount, NativeAppId, NativeVendor } from "../shared.js";
import { appOf, nativeRedirectUri, vendorUrl, VENDOR_NAMES } from "./vendors.js";

/**
 * Signed-in accounts of the built-in apps: OAuth 2.0 authorization code flow with the client the user created in their
 * own console. Google and Microsoft: with PKCE (S256) and the client secret (a confidential web client). Slack: with the
 * client secret only — turning PKCE on in a Slack app marks it as a public client for good
 * (https://docs.slack.dev/authentication/using-pkce), so a server that can keep a secret does not ask for it.
 * Tokens are sealed in native_accounts.tokens_enc, refreshed before they expire, and never returned by any API.
 */

interface Tokens { access: string; refresh?: string; expiresAt?: number }
export interface ClientRecord { clientId: string; secret: string | null; tenant: string; appToken: string | null }
export interface AccountRecord extends NativeAccount { userId: string; vendor: NativeVendor; meta: { teamId?: string; botUserId?: string } }

/** Thrown when the account must be signed in again (refresh refused, token revoked). */
export class NativeAuthError extends Error {}

const vendorOfApp = (app: string): NativeVendor => appOf(app)?.vendor ?? "google";
const appName = (app: string) => appOf(app)?.name ?? app;
export const accountName = (app: string, label: string) => `${appName(app)} — ${label}`;

const toAccount = (r: any): AccountRecord => {
  let meta = {};
  try { meta = JSON.parse(r.meta || "{}"); } catch { /* keep empty */ }
  return {
    id: r.id, userId: r.user_id, app: r.app, vendor: vendorOfApp(r.app), label: r.label, name: accountName(r.app, r.label), identity: r.identity ?? null,
    status: r.status === "ready" ? "ready" : "needs_auth", error: r.error ?? null, createdAt: r.created_at, meta,
  };
};
export const publicAccount = ({ userId, vendor, meta, ...rest }: AccountRecord): NativeAccount => rest;

const changed = (userId: string) => emit(userId, { type: "native" });

// ── OAuth clients ────────────────────────────────────────────────────────────
export const clients = {
  get(userId: string, vendor: NativeVendor): ClientRecord | null {
    const r = q.get<any>("SELECT * FROM native_clients WHERE user_id = ? AND vendor = ?", userId, vendor);
    if (!r) return null;
    return { clientId: r.client_id, secret: r.secret_enc ? unseal(r.secret_enc) : null, tenant: r.tenant || "common", appToken: r.app_token_enc ? unseal(r.app_token_enc) : null };
  },
  /** Saves the client. A secret or app token left empty keeps the one already saved (so the form never shows them back). */
  set(userId: string, vendor: NativeVendor, f: { clientId: string; clientSecret?: string; tenant?: string; appToken?: string | null }) {
    const clientId = f.clientId.trim().slice(0, 300);
    if (!clientId || /\s/.test(clientId)) throw new Error("Enter the client ID exactly as the console shows it.");
    const tenant = (f.tenant ?? "").trim();
    if (tenant && !/^[a-zA-Z0-9.-]{1,100}$/.test(tenant)) throw new Error("The directory must be “common”, “organizations”, “consumers”, a tenant ID or a domain.");
    const appToken = f.appToken?.trim();
    if (appToken && !/^xapp-[\w-]{10,400}$/.test(appToken)) throw new Error("A Slack app-level token starts with xapp-.");
    const cur = q.get<any>("SELECT * FROM native_clients WHERE user_id = ? AND vendor = ?", userId, vendor);
    const secretEnc = f.clientSecret?.trim() ? seal(f.clientSecret.trim().slice(0, 500)) : cur && cur.client_id === clientId ? cur.secret_enc : null;
    if (!secretEnc) throw new Error("Enter the client secret too.");
    const appEnc = f.appToken === null ? null : appToken ? seal(appToken) : cur?.app_token_enc ?? null;
    q.run(`INSERT INTO native_clients (user_id, vendor, client_id, secret_enc, tenant, app_token_enc, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(user_id, vendor) DO UPDATE SET client_id = excluded.client_id, secret_enc = excluded.secret_enc, tenant = excluded.tenant, app_token_enc = excluded.app_token_enc, updated_at = excluded.updated_at`,
      userId, vendor, clientId, secretEnc, tenant, appEnc, now());
    audit(userId, "apps", `${VENDOR_NAMES[vendor]} OAuth client saved`);
    changed(userId);
  },
  remove(userId: string, vendor: NativeVendor) {
    q.run("DELETE FROM native_clients WHERE user_id = ? AND vendor = ?", userId, vendor);
    audit(userId, "apps", `${VENDOR_NAMES[vendor]} OAuth client removed`);
    changed(userId);
  },
};

// ── Accounts ─────────────────────────────────────────────────────────────────
const tokensOf = (id: string): Tokens | null => {
  const r = q.get<{ tokens_enc: string | null }>("SELECT tokens_enc FROM native_accounts WHERE id = ?", id);
  const plain = r?.tokens_enc ? unseal(r.tokens_enc) : null;
  try { return plain ? (JSON.parse(plain) as Tokens) : null; } catch { return null; }
};
const saveTokens = (id: string, t: Tokens | null) => q.run("UPDATE native_accounts SET tokens_enc = ? WHERE id = ?", t ? seal(JSON.stringify(t)) : null, id);

export const labelKey = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 20);

export const accounts = {
  list: (userId: string) => q.all("SELECT * FROM native_accounts WHERE user_id = ? ORDER BY created_at, rowid", userId).map(toAccount),
  byId: (id: string) => { const r = q.get("SELECT * FROM native_accounts WHERE id = ?", id); return r ? toAccount(r) : null; },
  owned: (userId: string, id: string) => { const r = q.get("SELECT * FROM native_accounts WHERE id = ? AND user_id = ?", id, userId); return r ? toAccount(r) : null; },
  /** A new account, waiting for its sign-in. Labels are unique per app, so "Gmail — perso" always means one account. */
  create(userId: string, app: NativeAppId, label: string): AccountRecord {
    if (!appOf(app)) throw new Error("Unknown app.");
    const clean = label.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!labelKey(clean)) throw new Error("Give this account a short label, e.g. “perso” or “pro”.");
    if (accounts.list(userId).some((a) => a.app === app && labelKey(a.label) === labelKey(clean))) throw new Error(`There is already a ${appName(app)} account labelled “${clean}”. Pick another label.`);
    const id = newId("nac");
    q.run("INSERT INTO native_accounts (id, user_id, app, label, created_at) VALUES (?, ?, ?, ?, ?)", id, userId, app, clean, now());
    audit(userId, "apps", `App account added, waiting for sign-in: ${accountName(app, clean)}`);
    changed(userId);
    return accounts.byId(id)!;
  },
  rename(userId: string, id: string, label: string): AccountRecord {
    const cur = accounts.owned(userId, id);
    if (!cur) throw new Error("That account does not exist.");
    const clean = label.trim().replace(/\s+/g, " ").slice(0, 30);
    if (!labelKey(clean)) throw new Error("Give this account a short label, e.g. “perso” or “pro”.");
    if (accounts.list(userId).some((a) => a.id !== id && a.app === cur.app && labelKey(a.label) === labelKey(clean))) throw new Error(`There is already a ${appName(cur.app)} account labelled “${clean}”.`);
    q.run("UPDATE native_accounts SET label = ? WHERE id = ?", clean, id);
    changed(userId);
    return accounts.byId(id)!;
  },
  ready: (userId: string) => accounts.list(userId).filter((a) => a.status === "ready"),
};

export function markNeedsAuth(acc: AccountRecord, why: string) {
  if (acc.status !== "ready" && acc.error === why) return;
  q.run("UPDATE native_accounts SET status = 'needs_auth', error = ? WHERE id = ?", why, acc.id);
  audit(acc.userId, "apps", `${acc.name} needs signing in again (${why})`);
  changed(acc.userId);
}

// ── Sign-in ──────────────────────────────────────────────────────────────────
const b64url = (b: Buffer) => b.toString("base64url");

/** The vendor's sign-in page for this account. The PKCE verifier waits in native_pending, keyed by a hash of the state. */
export function startSignIn(userId: string, accountId: string): string {
  const acc = accounts.owned(userId, accountId);
  if (!acc) throw new Error("That account does not exist.");
  const client = clients.get(userId, acc.vendor);
  if (!client) throw new Error(`Set up your ${VENDOR_NAMES[acc.vendor]} OAuth client first.`);
  const app = appOf(acc.app)!;
  const state = randomToken(24);
  const redirect = nativeRedirectUri(acc.vendor);
  let url: URL;
  let verifier: string | null = null;
  if (acc.vendor === "slack") {
    // https://docs.slack.dev/authentication/installing-with-oauth/ — bot scopes go in `scope`, comma-separated.
    url = new URL(vendorUrl("slack", "https://slack.com/oauth/v2/authorize"));
    url.search = new URLSearchParams({ client_id: client.clientId, scope: app.scopes.join(","), redirect_uri: redirect, state }).toString();
  } else {
    verifier = b64url(Buffer.from(randomToken(48)));
    const challenge = b64url(createHash("sha256").update(verifier).digest());
    const common = { client_id: client.clientId, redirect_uri: redirect, response_type: "code", scope: app.scopes.join(" "), state, code_challenge: challenge, code_challenge_method: "S256" };
    if (acc.vendor === "google") {
      // https://developers.google.com/identity/protocols/oauth2/web-server: access_type=offline for a refresh token,
      // prompt=consent so a refresh token is issued again, select_account so the right one of several accounts is picked.
      url = new URL(vendorUrl("google", "https://accounts.google.com/o/oauth2/v2/auth"));
      url.search = new URLSearchParams({ ...common, access_type: "offline", prompt: "consent select_account" }).toString();
    } else {
      // https://learn.microsoft.com/en-us/entra/identity-platform/v2-oauth2-auth-code-flow
      url = new URL(vendorUrl("microsoft", `https://login.microsoftonline.com/${encodeURIComponent(client.tenant)}/oauth2/v2.0/authorize`));
      url.search = new URLSearchParams({ ...common, response_mode: "query", prompt: "select_account" }).toString();
    }
  }
  q.run("DELETE FROM native_pending WHERE expires_at < ?", now());
  q.run("INSERT INTO native_pending (state_hash, user_id, account_id, verifier_enc, expires_at) VALUES (?, ?, ?, ?, ?)", sha256(state), userId, acc.id, verifier ? seal(verifier) : null, now() + 10 * 60_000);
  audit(userId, "apps", `Sign-in started: ${acc.name}`);
  return url.toString();
}

/** A short, safe reason from a token endpoint's answer: only the standard error code, never its free text. */
const codeOf = (j: any): string => (typeof j?.error === "string" && /^[a-z_.]{1,60}$/i.test(j.error) ? j.error : "");

async function tokenRequest(vendor: NativeVendor, client: ClientRecord, params: Record<string, string>): Promise<any> {
  const headers: Record<string, string> = { "content-type": "application/x-www-form-urlencoded", accept: "application/json" };
  let url: string;
  const form = new URLSearchParams(params);
  if (vendor === "slack") {
    // oauth.v2.access: HTTP Basic with client_id:client_secret is preferred (https://docs.slack.dev/reference/methods/oauth.v2.access/).
    url = vendorUrl("slack", "https://slack.com/api/oauth.v2.access");
    headers.authorization = `Basic ${Buffer.from(`${client.clientId}:${client.secret ?? ""}`).toString("base64")}`;
  } else {
    url = vendor === "google" ? vendorUrl("google", "https://oauth2.googleapis.com/token") : vendorUrl("microsoft", `https://login.microsoftonline.com/${encodeURIComponent(client.tenant)}/oauth2/v2.0/token`);
    form.set("client_id", client.clientId);
    form.set("client_secret", client.secret ?? "");
  }
  const res = await guardedFetch(url, { method: "POST", headers, body: form.toString(), signal: AbortSignal.timeout(20_000) });
  const j = await res.json().catch(() => ({}));
  if (vendor === "slack" ? !j.ok : !res.ok || !j.access_token) {
    const err = new Error(`the sign-in server answered ${codeOf(j) ? `“${codeOf(j)}”` : `HTTP ${res.status}`}`) as Error & { code?: string };
    err.code = codeOf(j);
    throw err;
  }
  return j;
}

const asTokens = (j: any, keepRefresh?: string): Tokens => ({
  access: String(j.access_token), refresh: j.refresh_token ? String(j.refresh_token) : keepRefresh,
  expiresAt: Number(j.expires_in) > 0 ? now() + Number(j.expires_in) * 1000 : undefined,
});

/** The browser came back from the vendor. The state is consumed whatever happens next. */
export async function finishSignIn(vendor: NativeVendor, params: { state: string; code?: string; error?: string }, sessionUserId?: string): Promise<AccountRecord & { alreadyDone?: boolean }> {
  const row = params.state ? q.get<{ user_id: string; account_id: string; verifier_enc: string | null; expires_at: number; used_at: number | null }>("SELECT * FROM native_pending WHERE state_hash = ?", sha256(params.state)) : undefined;
  if (!row || row.expires_at < now()) throw new Error("This sign-in link has expired or was already used. Start again from Sklubot.");
  if (sessionUserId && sessionUserId !== row.user_id) throw new Error("This sign-in was started from another account.");
  const acc = accounts.owned(row.user_id, row.account_id);
  if (!acc || acc.vendor !== vendor) throw new Error("That connector does not exist any more.");
  if (row.used_at) {
    // The same callback arriving twice: nothing is exchanged again; it only reports how the first arrival went.
    if (acc.status === "ready") return Object.assign(acc, { alreadyDone: true });
    throw new Error("This sign-in link has expired or was already used. Start again from Sklubot.");
  }
  q.run("UPDATE native_pending SET used_at = ? WHERE state_hash = ?", now(), sha256(params.state));
  const fail = (why: string) => { audit(acc.userId, "apps", `Sign-in failed: ${acc.name} (${why.slice(0, 120)})`); return new Error(why); };
  if (params.error) throw fail(`The app refused the sign-in: ${params.error.slice(0, 100)}`);
  if (!params.code) throw fail("The app did not send a sign-in code.");
  const client = clients.get(acc.userId, vendor);
  if (!client) throw fail(`Set up your ${VENDOR_NAMES[vendor]} OAuth client first.`);
  const verifier = row.verifier_enc ? unseal(row.verifier_enc) : null;
  if (vendor !== "slack" && !verifier) throw fail("The sign-in could not be read back.");
  let j: any;
  try {
    j = await tokenRequest(vendor, client, {
      grant_type: "authorization_code", code: params.code, redirect_uri: nativeRedirectUri(vendor),
      ...(verifier ? { code_verifier: verifier } : {}),
      ...(vendor === "microsoft" ? { scope: appOf(acc.app)!.scopes.join(" ") } : {}),
    });
  } catch (err) { throw fail(`The app did not accept the sign-in: ${fetchProblem(err) ?? (err as Error).message}`); }
  const tokens = asTokens(j);
  const meta: AccountRecord["meta"] = {};
  let identity: string | null = null;
  if (vendor === "slack") {
    // oauth.v2.access answers with the bot token, the bot's user id and the workspace (team).
    meta.teamId = j.team?.id ? String(j.team.id) : undefined;
    meta.botUserId = j.bot_user_id ? String(j.bot_user_id) : undefined;
    identity = j.team?.name ? String(j.team.name).slice(0, 120) : null;
  }
  q.run("UPDATE native_accounts SET status = 'ready', error = NULL, meta = ?, identity = COALESCE(?, identity) WHERE id = ?", JSON.stringify(meta), identity, acc.id);
  saveTokens(acc.id, tokens);
  if (vendor !== "slack") {
    const ready = accounts.byId(acc.id)!;
    try {
      // Google: OpenID Connect userinfo (https://developers.google.com/identity/openid-connect/openid-connect#obtaininguserprofileinformation).
      // Microsoft: GET /me (https://learn.microsoft.com/en-us/graph/api/user-get).
      const who = vendor === "google"
        ? (await callApi(ready, "GET", vendorUrl("google", "https://openidconnect.googleapis.com/v1/userinfo"))).json?.email
        : ((r) => r?.mail || r?.userPrincipalName)((await callApi(ready, "GET", vendorUrl("microsoft", "https://graph.microsoft.com/v1.0/me?$select=mail,userPrincipalName"))).json);
      if (typeof who === "string" && who) q.run("UPDATE native_accounts SET identity = ? WHERE id = ?", who.slice(0, 200), acc.id);
    } catch { /* the account works without knowing its address */ }
  }
  audit(acc.userId, "apps", `App signed in: ${acc.name}`);
  changed(acc.userId);
  return accounts.byId(acc.id)!;
}

/** Disconnects: asks the vendor to revoke the token where it offers that, then forgets everything locally. */
export async function disconnect(userId: string, id: string): Promise<boolean> {
  const acc = accounts.owned(userId, id);
  if (!acc) return false;
  const t = tokensOf(id);
  if (t) {
    try {
      if (acc.vendor === "google") {
        // https://developers.google.com/identity/protocols/oauth2/web-server#tokenrevoke
        await guardedFetch(vendorUrl("google", `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(t.refresh ?? t.access)}`), { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, signal: AbortSignal.timeout(10_000) });
      } else if (acc.vendor === "slack") {
        // https://docs.slack.dev/reference/methods/auth.revoke/
        await guardedFetch(vendorUrl("slack", "https://slack.com/api/auth.revoke"), { method: "POST", headers: { authorization: `Bearer ${t.access}` }, signal: AbortSignal.timeout(10_000) });
      }
      // Microsoft offers no per-app revocation of a delegated refresh token: it is forgotten here, and the user can remove the
      // app's access from their account's app permissions.
    } catch { /* forgetting locally is what matters */ }
  }
  q.run("DELETE FROM native_accounts WHERE id = ?", id);
  // Routines bound to it stop; they stay listed so the user sees what happened.
  const bound = q.all<{ id: string }>("SELECT id FROM routines WHERE native_account_id = ?", id);
  for (const r of bound) q.run("UPDATE routines SET enabled = 0 WHERE id = ?", r.id);
  audit(userId, "apps", `App disconnected and forgotten: ${acc.name}`);
  changed(userId);
  return true;
}

// ── Calling the vendor's API ─────────────────────────────────────────────────
const refreshing = new Map<string, Promise<string>>();

async function refreshNow(acc: AccountRecord, t: Tokens): Promise<string> {
  const client = clients.get(acc.userId, acc.vendor);
  if (!client) { markNeedsAuth(acc, "its OAuth client was removed"); throw new NativeAuthError(signInAgain(acc)); }
  if (!t.refresh) { markNeedsAuth(acc, "the sign-in expired"); throw new NativeAuthError(signInAgain(acc)); }
  try {
    const j = await tokenRequest(acc.vendor, client, { grant_type: "refresh_token", refresh_token: t.refresh, ...(acc.vendor === "microsoft" ? { scope: appOf(acc.app)!.scopes.join(" ") } : {}) });
    const next = asTokens(j, t.refresh);
    saveTokens(acc.id, next);
    return next.access;
  } catch (err) {
    // invalid_grant (Google, Microsoft) / invalid_refresh_token (Slack): the user must sign in again. Anything else (the
    // network, the vendor down) is passed on as it is, and the account keeps its sign-in.
    const code = (err as { code?: string }).code ?? "";
    if (/invalid_grant|invalid_refresh_token|invalid_client|unauthorized_client|token_revoked|token_expired/.test(code) || (err as Error).message.includes("HTTP 400") || (err as Error).message.includes("HTTP 401")) {
      markNeedsAuth(acc, "the sign-in could not be renewed");
      throw new NativeAuthError(signInAgain(acc));
    }
    throw err;
  }
}

export const signInAgain = (acc: AccountRecord) => `${acc.name} needs the user to sign in again: ask them to open Settings → Apps and click "Sign in again" on ${acc.name}.`;

/** A valid access token for this account, refreshed a minute before it expires (or now, when `force`). */
export async function accessToken(acc: AccountRecord, force = false): Promise<string> {
  const t = tokensOf(acc.id);
  if (!t || acc.status !== "ready") throw new NativeAuthError(signInAgain(acc));
  if (!force && (!t.expiresAt || now() < t.expiresAt - 60_000)) return t.access;
  let p = refreshing.get(acc.id);
  if (!p) { p = refreshNow(acc, t).finally(() => refreshing.delete(acc.id)); refreshing.set(acc.id, p); }
  return p;
}

export interface ApiAnswer { status: number; json: any; text: string; bytes?: Buffer; contentType: string }

/**
 * One call to the vendor's API, as this account. A 401 (or Slack's invalid_auth) gets one refresh and one retry; after
 * that the account is marked as needing a new sign-in. Errors carry only the status and the vendor's error code.
 */
export async function callApi(acc: AccountRecord, method: string, url: string, opts: { json?: unknown; form?: Record<string, string>; raw?: { body: Buffer; type: string }; headers?: Record<string, string>; binary?: boolean } = {}): Promise<ApiAnswer> {
  const attempt = async (token: string) => {
    const headers: Record<string, string> = { authorization: `Bearer ${token}`, accept: "application/json", ...(opts.headers ?? {}) };
    let body: string | Uint8Array | undefined;
    if (opts.json !== undefined) { headers["content-type"] = "application/json; charset=utf-8"; body = JSON.stringify(opts.json); }
    else if (opts.form) { headers["content-type"] = "application/x-www-form-urlencoded"; body = new URLSearchParams(opts.form).toString(); }
    else if (opts.raw) { headers["content-type"] = opts.raw.type; body = new Uint8Array(opts.raw.body); }
    const res = await guardedFetch(url, { method, headers, body: body as BodyInit | undefined, signal: AbortSignal.timeout(30_000), redirect: "follow" });
    const contentType = res.headers.get("content-type") ?? "";
    if (opts.binary && res.ok) { const bytes = Buffer.from(await res.arrayBuffer()); return { status: res.status, json: null, text: "", bytes, contentType }; }
    const text = await res.text();
    let json: any = null;
    try { json = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
    return { status: res.status, json, text, contentType };
  };
  const slackAuthFailed = (a: ApiAnswer) => acc.vendor === "slack" && a.json?.ok === false && /^(invalid_auth|token_revoked|token_expired|account_inactive|not_authed)$/.test(a.json.error);
  let a = await attempt(await accessToken(acc));
  if (a.status === 401 || slackAuthFailed(a)) {
    const fresh = tokensOf(acc.id);
    if (fresh?.refresh) a = await attempt(await accessToken(acc, true));
    if (a.status === 401 || slackAuthFailed(a)) { markNeedsAuth(acc, "the sign-in expired"); throw new NativeAuthError(signInAgain(acc)); }
  }
  return a;
}

/** The vendor's error in a few safe words (status and error code only). */
export function apiProblem(a: ApiAnswer): string {
  const j = a.json;
  const code = typeof j?.error === "string" ? j.error : typeof j?.error?.code === "string" ? j.error.code : typeof j?.error?.status === "string" ? j.error.status : "";
  const safe = /^[A-Za-z_.]{1,60}$/.test(code) ? ` (${code})` : "";
  return `the app answered with an error: HTTP ${a.status}${safe}`;
}
