import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport, StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { auth, discoverOAuthProtectedResourceMetadata, UnauthorizedError, type OAuthClientProvider, type OAuthDiscoveryState } from "@modelcontextprotocol/sdk/client/auth.js";
import type { OAuthClientInformationMixed, OAuthClientMetadata, OAuthTokens } from "@modelcontextprotocol/sdk/shared/auth.js";
import { q } from "./db.js";
import { emit } from "./bus.js";
import { seal, unseal } from "./auth.js";
import { config } from "./config.js";
import { audit, newId, now, randomToken, sha256 } from "./store.js";
import type { ToolSpec } from "./llm/types.js";
import type { Connector, ConnectorAuth } from "./shared.js";

/**
 * A connector is a remote tool server speaking the open Model Context Protocol over HTTP.
 * Any app that offers such an endpoint (many do, directly or through a gateway) can be plugged in.
 *
 * Three ways to prove who we are: nothing, an access token the user pasted, or an OAuth sign-in
 * following the MCP authorization spec (https://modelcontextprotocol.io/specification/2025-06-18/basic/authorization):
 * protected-resource and authorization-server metadata discovery, PKCE, and dynamic client
 * registration when the server offers it — all driven by the SDK's own `auth()`.
 */

interface LiveConnector { client: Client; provider: ConnectorOAuth | null; tools: { name: string; description: string; readOnly: boolean; schema: ToolSpec["inputSchema"] }[] }
interface Entry { record: ConnectorRecord; live: LiveConnector | null; error: string | null; connecting: Promise<void> | null; needsAuth: boolean }
interface ConnectorRecord { id: string; userId: string; name: string; url: string; tokenEnc: string | null; auth: ConnectorAuth }

const entries = new Map<string, Entry>();
const authOf = (r: any): ConnectorAuth => (r.auth === "oauth" ? "oauth" : r.token_enc ? "token" : "none");
const toRecord = (r: any): ConnectorRecord => ({ id: r.id, userId: r.user_id, name: r.name, url: r.url, tokenEnc: r.token_enc, auth: authOf(r) });

const READ_WORDS = new Set(["get", "list", "search", "fetch", "find", "read", "retrieve", "query", "lookup", "check", "describe", "view", "count", "show"]);
/** A tool is treated as read-only when the server says so, or when its name reads like a lookup. */
export function looksReadOnly(name: string, hint?: boolean): boolean {
  if (hint !== undefined) return hint;
  return name.split(/[^a-zA-Z0-9]+|(?<=[a-z])(?=[A-Z])/).some((word) => READ_WORDS.has(word.toLowerCase()));
}

// ── OAuth ────────────────────────────────────────────────────────────────────

/** Where providers send the browser back after sign-in. Must be registered as is with apps that need a client ID. */
export const oauthRedirectUri = () => `${config.publicUrl}/api/connectors/oauth/callback`;

/** Everything OAuth keeps for one connector, sealed as a whole in connectors.oauth_enc. Never sent to the browser. */
interface OAuthData {
  tokens?: OAuthTokens; savedAt?: number;
  client?: OAuthClientInformationMixed; manualClient?: boolean;
  discovery?: OAuthDiscoveryState;
}
function loadOAuth(id: string): OAuthData {
  const r = q.get<{ oauth_enc: string | null }>("SELECT oauth_enc FROM connectors WHERE id = ?", id);
  const plain = r?.oauth_enc ? unseal(r.oauth_enc) : null;
  try { return plain ? (JSON.parse(plain) as OAuthData) : {}; } catch { return {}; }
}
function saveOAuth(id: string, change: (d: OAuthData) => OAuthData) {
  const next = change(loadOAuth(id));
  q.run("UPDATE connectors SET oauth_enc = ? WHERE id = ?", Object.keys(next).length ? seal(JSON.stringify(next)) : null, id);
}
/** Expired, or about to: refresh a little before the end (a tenth of the lifetime, at most 30 s). */
function tokenExpired(d: OAuthData): boolean {
  const life = Number(d.tokens?.expires_in);
  if (!d.tokens || !d.savedAt || !Number.isFinite(life) || life <= 0) return false;
  return now() >= d.savedAt + life * 1000 - Math.min(30_000, life * 100);
}

type ProviderMode = { kind: "background" } | { kind: "start"; state: string } | { kind: "callback"; verifier: string };

/**
 * The SDK's OAuthClientProvider, backed by the sealed per-connector record.
 * "background": used by live connections; it refreshes tokens, and when a new sign-in would be needed
 * it only notes it (no browser here). "start" captures the authorization URL and PKCE verifier.
 * "callback" hands the verifier back to exchange the code.
 */
class ConnectorOAuth implements OAuthClientProvider {
  authorizeUrl: URL | null = null;
  verifier: string | null = null;
  needsSignIn = false;
  constructor(private readonly id: string, private readonly mode: ProviderMode) {}
  get redirectUrl() { return oauthRedirectUri(); }
  get clientMetadata(): OAuthClientMetadata {
    // RFC 7591 client metadata, used only for dynamic registration. A public client: PKCE, no secret.
    return { client_name: "Sklubot", redirect_uris: [oauthRedirectUri()], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" };
  }
  state() { return this.mode.kind === "start" ? this.mode.state : randomToken(24); }
  clientInformation() { return loadOAuth(this.id).client; }
  saveClientInformation(client: OAuthClientInformationMixed) { saveOAuth(this.id, (d) => ({ ...d, client })); }
  tokens() { return loadOAuth(this.id).tokens; }
  saveTokens(tokens: OAuthTokens) { saveOAuth(this.id, (d) => ({ ...d, tokens, savedAt: now() })); }
  redirectToAuthorization(url: URL) {
    if (this.mode.kind === "start") this.authorizeUrl = url;
    else this.needsSignIn = true;
  }
  saveCodeVerifier(verifier: string) { this.verifier = verifier; }
  codeVerifier() {
    if (this.mode.kind !== "callback") throw new Error("no sign-in is under way");
    return this.mode.verifier;
  }
  invalidateCredentials(scope: "all" | "client" | "tokens" | "verifier" | "discovery") {
    saveOAuth(this.id, (d) => {
      const keepClient = d.manualClient; // a client ID the user pasted stays until they change it
      const out = { ...d };
      if (scope === "all" || scope === "tokens") { delete out.tokens; delete out.savedAt; }
      if (scope === "all" || scope === "discovery") delete out.discovery;
      if ((scope === "all" || scope === "client") && !keepClient) { delete out.client; delete out.manualClient; }
      return out;
    });
  }
  saveDiscoveryState(state: OAuthDiscoveryState) { saveOAuth(this.id, (d) => ({ ...d, discovery: state })); }
  discoveryState() { return loadOAuth(this.id).discovery; }
}

/** Raised by startSignIn when the app has no dynamic registration and the user has not given a client ID yet. */
export class NeedsClientIdError extends Error {}

function markNeedsAuth(entry: Entry, why: string) {
  const was = entry.needsAuth;
  entry.live = null; entry.needsAuth = true; entry.error = null;
  if (!was && why) audit(entry.record.userId, "apps", `${entry.record.name} needs signing in again (${why})`);
}

// ── Connections ──────────────────────────────────────────────────────────────

async function connect(entry: Entry) {
  const { record } = entry;
  let provider: ConnectorOAuth | null = null;
  let transport: StreamableHTTPClientTransport;
  if (record.auth === "oauth") {
    const data = loadOAuth(record.id);
    // Never signed in (or signed out): nothing to try until the user signs in.
    if (!data.tokens) { entry.live = null; entry.needsAuth = true; entry.error = null; return; }
    provider = new ConnectorOAuth(record.id, { kind: "background" });
    if (tokenExpired(data)) {
      try { await auth(provider, { serverUrl: record.url }); } catch { provider.needsSignIn = true; }
      if (provider.needsSignIn) return markNeedsAuth(entry, "the sign-in could not be renewed");
    }
    transport = new StreamableHTTPClientTransport(new URL(record.url), { authProvider: provider });
  } else {
    const token = record.tokenEnc ? unseal(record.tokenEnc) : null;
    transport = new StreamableHTTPClientTransport(new URL(record.url), {
      requestInit: token ? { headers: { authorization: `Bearer ${token}` } } : undefined,
    });
  }
  const client = new Client({ name: "sklubot", version: "0.1.0" });
  try {
    await client.connect(transport);
  } catch (err) {
    if (provider && (err instanceof UnauthorizedError || provider.needsSignIn)) return markNeedsAuth(entry, "the sign-in expired");
    // An app added by its address that answers 401 and publishes OAuth metadata wants a sign-in.
    if (record.auth === "none" && err instanceof StreamableHTTPError && err.code === 401 && (await wantsOAuth(record.url))) {
      q.run("UPDATE connectors SET auth = 'oauth' WHERE id = ?", record.id);
      record.auth = "oauth";
      entry.live = null; entry.needsAuth = true; entry.error = null;
      return;
    }
    throw err;
  }
  const listed = await client.listTools();
  entry.live = {
    client, provider,
    tools: listed.tools.map((t) => ({
      name: t.name,
      description: (t.description ?? "").slice(0, 1000),
      readOnly: looksReadOnly(t.name, t.annotations?.readOnlyHint),
      schema: { type: "object", properties: (t.inputSchema?.properties ?? {}) as Record<string, unknown>, required: t.inputSchema?.required },
    })),
  };
  entry.error = null;
  entry.needsAuth = false;
}

/** RFC 9728: a server that wants OAuth publishes protected-resource metadata naming its authorization server. */
async function wantsOAuth(url: string): Promise<boolean> {
  try { return !!(await discoverOAuthProtectedResourceMetadata(url)).authorization_servers?.length; } catch { return false; }
}

function ensure(record: ConnectorRecord): Entry {
  let entry = entries.get(record.id);
  if (!entry) entries.set(record.id, (entry = { record, live: null, error: null, connecting: null, needsAuth: false }));
  // A connector waiting for a sign-in stays put until the user signs in (or asks to retry).
  if (!entry.live && !entry.connecting && !entry.needsAuth) {
    const e = entry;
    e.connecting = connect(e)
      .catch((err) => { e.error = String(err?.message ?? err).slice(0, 300); })
      .finally(() => { e.connecting = null; emit(record.userId, { type: "connectors" }); });
  }
  return entry;
}

const view = (e: Entry): Connector => {
  const oauth = e.record.auth === "oauth" ? loadOAuth(e.record.id) : null;
  return {
    id: e.record.id, name: e.record.name, url: e.record.url, hasToken: !!e.record.tokenEnc, auth: e.record.auth,
    status: e.live ? "ready" : e.connecting ? "connecting" : e.needsAuth ? "needs_auth" : "error", error: e.live || e.needsAuth ? null : e.error,
    tools: (e.live?.tools ?? []).map(({ name, description, readOnly }) => ({ name, description, readOnly })),
    ...(oauth ? { oauth: { signedIn: !!oauth.tokens, customClient: !!oauth.manualClient } } : {}),
  };
};

const recordsFor = (userId: string) => q.all("SELECT * FROM connectors WHERE user_id = ? ORDER BY created_at", userId).map(toRecord);
const recordOf = (userId: string, id: string) => { const r = q.get("SELECT * FROM connectors WHERE id = ? AND user_id = ?", id, userId); return r ? toRecord(r) : null; };
const slug = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 24) || "app";

export interface AddOptions { token?: string; auth?: "oauth"; clientId?: string; clientSecret?: string }

function setManualClient(id: string, clientId: string, clientSecret?: string) {
  const client: OAuthClientInformationMixed = { client_id: clientId.trim().slice(0, 500), ...(clientSecret?.trim() ? { client_secret: clientSecret.trim().slice(0, 500) } : {}) };
  // A new client means new sign-in: tokens issued to the previous client are dropped.
  saveOAuth(id, (d) => ({ discovery: d.discovery, client, manualClient: true }));
}

export const connectors = {
  list: (userId: string): Connector[] => recordsFor(userId).map((r) => view(ensure(r))),
  async add(userId: string, name: string, url: string, opts: AddOptions | string = {}): Promise<Connector> {
    const o: AddOptions = typeof opts === "string" ? { token: opts } : opts;
    let parsed: URL;
    try { parsed = new URL(url); } catch { throw new Error("That does not look like a valid URL."); }
    if (!/^https?:$/.test(parsed.protocol)) throw new Error("Connector URLs must start with http:// or https://");
    const id = newId("con");
    const oauth = o.auth === "oauth";
    q.run("INSERT INTO connectors (id, user_id, name, url, token_enc, auth, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      id, userId, name.trim().slice(0, 60) || parsed.hostname, parsed.toString(), !oauth && o.token ? seal(o.token) : null, oauth ? "oauth" : o.token ? "token" : "none", now());
    if (oauth && o.clientId?.trim()) setManualClient(id, o.clientId, o.clientSecret);
    const entry = ensure(toRecord(q.get("SELECT * FROM connectors WHERE id = ?", id)));
    await entry.connecting;
    return view(entry);
  },
  async refresh(userId: string, id: string): Promise<Connector | null> {
    const r = recordOf(userId, id);
    if (!r) return null;
    await connectors.drop(id);
    const entry = ensure(r);
    await entry.connecting;
    return view(entry);
  },
  async drop(id: string) {
    const entry = entries.get(id);
    entries.delete(id);
    try { await entry?.live?.client.close(); } catch { /* closing a dead connection is fine */ }
  },
  async remove(userId: string, id: string) {
    q.run("DELETE FROM connectors WHERE id = ? AND user_id = ?", id, userId);
    await connectors.drop(id);
    emit(userId, { type: "connectors" });
  },
  closeAll: () => Promise.all([...entries.keys()].map((id) => connectors.drop(id))),

  /**
   * Begins an OAuth sign-in. Returns the provider's page to open in the browser, or the connector when
   * the stored sign-in could simply be renewed. The PKCE verifier waits in oauth_pending for 10 minutes,
   * keyed by a hash of the state parameter, and can be used once.
   */
  async startSignIn(userId: string, id: string, opts: { clientId?: string; clientSecret?: string; botId?: string; seq?: number } = {}): Promise<{ authorizeUrl: string } | { connector: Connector }> {
    const record = recordOf(userId, id);
    if (!record) throw new Error("That connector does not exist.");
    if (record.auth !== "oauth") {
      if (record.tokenEnc) throw new Error("This app uses an access token, not a sign-in.");
      q.run("UPDATE connectors SET auth = 'oauth' WHERE id = ?", id);
      record.auth = "oauth";
    }
    if (opts.clientId?.trim()) setManualClient(id, opts.clientId, opts.clientSecret);
    const state = randomToken(24);
    const provider = new ConnectorOAuth(id, { kind: "start", state });
    let result;
    try { result = await auth(provider, { serverUrl: record.url }); }
    catch (err) {
      const msg = String((err as Error)?.message ?? err);
      if (/dynamic client registration/i.test(msg)) throw new NeedsClientIdError(msg);
      throw new Error(`The app's sign-in could not start: ${msg.slice(0, 200)}`);
    }
    if (result === "AUTHORIZED") return { connector: (await connectors.refresh(userId, id))! };
    if (!provider.authorizeUrl || !provider.verifier) throw new Error("The app's sign-in could not start.");
    q.run("DELETE FROM oauth_pending WHERE expires_at < ?", now());
    q.run("INSERT INTO oauth_pending (state_hash, user_id, connector_id, verifier_enc, bot_id, seq, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      sha256(state), userId, id, seal(provider.verifier), opts.botId ?? null, Number.isInteger(opts.seq) ? opts.seq! : null, now() + 10 * 60_000);
    audit(userId, "apps", `Sign-in started: ${record.name}`);
    return { authorizeUrl: provider.authorizeUrl.toString() };
  },

  /**
   * The browser came back from the provider. The state is consumed whatever happens next.
   * `iss` (RFC 9207), when the provider sends it, must name the authorization server we used.
   */
  async finishSignIn(params: { state: string; code?: string; error?: string; iss?: string }, sessionUserId?: string): Promise<{ userId: string; connector: Connector; botId: string | null; seq: number | null }> {
    const row = params.state ? q.get<{ user_id: string; connector_id: string; verifier_enc: string; bot_id: string | null; seq: number | null; expires_at: number }>("SELECT * FROM oauth_pending WHERE state_hash = ?", sha256(params.state)) : undefined;
    if (row) q.run("DELETE FROM oauth_pending WHERE state_hash = ?", sha256(params.state));
    if (!row || row.expires_at < now()) throw new Error("This sign-in link has expired or was already used. Start again from Sklubot.");
    if (sessionUserId && sessionUserId !== row.user_id) throw new Error("This sign-in was started from another account.");
    const record = recordOf(row.user_id, row.connector_id);
    if (!record) throw new Error("That connector does not exist any more.");
    const fail = (why: string) => { audit(row.user_id, "apps", `Sign-in failed: ${record.name} (${why.slice(0, 120)})`); return new Error(why); };
    if (params.error) throw fail(`The app refused the sign-in: ${params.error.slice(0, 100)}`);
    if (!params.code) throw fail("The app did not send a sign-in code.");
    const issuer = loadOAuth(record.id).discovery?.authorizationServerMetadata?.issuer;
    if (params.iss && issuer && params.iss.replace(/\/$/, "") !== issuer.replace(/\/$/, "")) throw fail("The sign-in answer came from an unexpected server.");
    const verifier = unseal(row.verifier_enc);
    if (!verifier) throw fail("The sign-in could not be read back.");
    const provider = new ConnectorOAuth(record.id, { kind: "callback", verifier });
    try { await auth(provider, { serverUrl: record.url, authorizationCode: params.code }); }
    catch (err) { throw fail(`The app did not accept the sign-in: ${String((err as Error)?.message ?? err).slice(0, 200)}`); }
    audit(row.user_id, "apps", `App signed in: ${record.name}`);
    const connector = (await connectors.refresh(row.user_id, record.id))!;
    emit(row.user_id, { type: "connectors" });
    return { userId: row.user_id, connector, botId: row.bot_id, seq: row.seq };
  },

  /** Signs out: tokens are forgotten (a client ID the user pasted is kept). */
  async signOut(userId: string, id: string): Promise<Connector | null> {
    const record = recordOf(userId, id);
    if (!record) return null;
    saveOAuth(id, (d) => { const out = { ...d }; delete out.tokens; delete out.savedAt; return out; });
    q.run("DELETE FROM oauth_pending WHERE connector_id = ?", id);
    audit(userId, "apps", `App signed out: ${record.name}`);
    const c = await connectors.refresh(userId, id);
    emit(userId, { type: "connectors" });
    return c;
  },

  /** Tools from every ready connector, namespaced so two servers can expose the same tool name. */
  async toolsFor(userId: string): Promise<{ spec: ToolSpec; connectorId: string; connectorName: string; remoteName: string; readOnly: boolean }[]> {
    const out = [];
    for (const record of recordsFor(userId)) {
      const entry = ensure(record);
      if (entry.connecting) await entry.connecting;
      for (const t of entry.live?.tools ?? []) {
        out.push({
          spec: { name: `app_${slug(record.name)}__${t.name}`.replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 64), description: `[${record.name}] ${t.description}`, inputSchema: t.schema },
          connectorId: record.id, connectorName: record.name, remoteName: t.name, readOnly: t.readOnly,
        });
      }
    }
    return out;
  },
  async call(connectorId: string, tool: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
    const entry = entries.get(connectorId);
    if (!entry?.live) throw new Error("this connector is not connected right now");
    const signInAgain = () => {
      markNeedsAuth(entry, "the sign-in expired");
      emit(entry.record.userId, { type: "connectors" });
      return new Error(`${entry.record.name} needs the user to sign in again: ask them to open Settings → Apps and click "Sign in" on ${entry.record.name}`);
    };
    if (entry.record.auth === "oauth" && tokenExpired(loadOAuth(connectorId))) {
      const provider = new ConnectorOAuth(connectorId, { kind: "background" });
      try { await auth(provider, { serverUrl: entry.record.url }); } catch { provider.needsSignIn = true; }
      if (provider.needsSignIn) throw signInAgain();
    }
    const live = entry.live;
    let res;
    try { res = await live.client.callTool({ name: tool, arguments: args }); }
    catch (err) { if (err instanceof UnauthorizedError || live.provider?.needsSignIn) throw signInAgain(); throw err; }
    const parts = Array.isArray(res.content) ? res.content : [];
    const text = parts.map((p: any) => (p.type === "text" ? p.text : `[${p.type} content]`)).join("\n") || JSON.stringify(res.structuredContent ?? {});
    return { text: text.length > 60_000 ? text.slice(0, 60_000) + "\n…[truncated]" : text, isError: res.isError === true };
  },
};
