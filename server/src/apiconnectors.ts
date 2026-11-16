import { unseal } from "./auth.js";
import { emit } from "./bus.js";
import { q } from "./db.js";
import type { ToolSpec } from "./llm/types.js";
import { fetchProblem, guardedFetch } from "./net.js";
import type { ApiConnector, ApiEndpoint } from "./shared.js";
import { audit, bots, clip, newId, now, rows, vault, type VaultRecord } from "./store.js";
import type { BuiltinTool, ToolContext } from "./agent/tools.js";

/**
 * HTTP API connectors created on demand (spec 07 A16). For a service that is not in the catalogue, the bot describes
 * an access path — the API's base address, the vault secret that authenticates it, and the endpoints it needs (written
 * by the bot, or read from a small OpenAPI document) — with api_connector_propose. The user reviews it on a card,
 * types the token there if it is not in the vault yet (it goes straight to the vault, bound to that host only), and
 * approves. From then on:
 *  - only the declared endpoints can be called, only on that host, over https;
 *  - the server adds the secret in its own header (the secret_use design): the bot never sees it, redirects are not
 *    followed, and the secret is removed from responses under every form (raw, URL-encoded, JSON-escaped, base64);
 *  - responses are outside content (the turn becomes careful);
 *  - api_get reads freely; api_send (POST/PUT/PATCH/DELETE) changes things: grounded in the user's words, reviewed or
 *    asked like any action, reserved and possibly "uncertain"; DELETE always asks (the floor).
 * Command-line connectors from the spec are not implemented: the bot's own Linux computer already runs commands, and
 * a sealed install under a dedicated user is a separate project.
 */
export const MAX_ENDPOINTS = 40;
const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE"] as const;
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";

const toConnector = (r: any): ApiConnector => {
  let endpoints: ApiEndpoint[] = [];
  try { endpoints = JSON.parse(r.endpoints || "[]"); } catch { /* none */ }
  return { id: r.id, name: r.name, baseUrl: r.base_url, host: r.host, secret: r.secret, endpoints, status: r.status === "active" ? "active" : "pending", createdAt: r.created_at };
};

export const apiConnectors = {
  list: (userId: string) => q.all("SELECT * FROM api_connectors WHERE user_id = ? ORDER BY created_at", userId).map(toConnector),
  active: (userId: string) => q.all("SELECT * FROM api_connectors WHERE user_id = ? AND status = 'active' ORDER BY created_at", userId).map(toConnector),
  owned(userId: string, id: string) { const r = q.get("SELECT * FROM api_connectors WHERE id = ? AND user_id = ?", id, userId); return r ? toConnector(r) : null; },
  byName(userId: string, name: string) { const r = q.get("SELECT * FROM api_connectors WHERE user_id = ? AND name = ? COLLATE NOCASE AND status = 'active'", userId, name.trim()); return r ? toConnector(r) : null; },
  create(userId: string, botId: string, f: { name: string; baseUrl: string; host: string; secret: string; endpoints: ApiEndpoint[] }): ApiConnector {
    const id = newId("api");
    q.run("INSERT INTO api_connectors (id, user_id, bot_id, name, base_url, host, secret, endpoints, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)", id, userId, botId, f.name, f.baseUrl, f.host, f.secret, JSON.stringify(f.endpoints), now());
    return apiConnectors.owned(userId, id)!;
  },
  activate: (id: string) => q.run("UPDATE api_connectors SET status = 'active' WHERE id = ?", id),
  remove: (userId: string, id: string) => q.run("DELETE FROM api_connectors WHERE id = ? AND user_id = ?", id, userId),
};

/** A base address as accepted for a connector: https (http only for local tests), no credentials, no query. */
export function cleanBase(raw: string): { baseUrl: string; host: string } | null {
  let u: URL;
  try { u = new URL(raw.trim()); } catch { return null; }
  if (u.protocol !== "https:" && !(allowHttp() && u.protocol === "http:")) return null;
  if (u.username || u.password || u.search || u.hash) return null;
  return { baseUrl: `${u.protocol}//${u.host}${u.pathname.replace(/\/+$/, "")}`, host: u.hostname.toLowerCase() };
}

/** Endpoints from the bot's list, or from a small OpenAPI document (its `paths`). Bad entries are dropped. */
export function cleanEndpoints(list: unknown, openapi?: unknown): ApiEndpoint[] {
  const out: ApiEndpoint[] = [];
  const push = (method: unknown, path: unknown, description: unknown) => {
    const m = String(method ?? "").toUpperCase();
    const p = String(path ?? "").trim();
    if (!(METHODS as readonly string[]).includes(m) || !/^\/[A-Za-z0-9._~!$&'()*+,;=:@%/{}-]*$/.test(p) || p.includes("..") || p.length > 200) return;
    if (out.some((e) => e.method === m && e.path === p)) return;
    out.push({ method: m as ApiEndpoint["method"], path: p, description: clip(String(description ?? "").replace(/\s+/g, " ").trim(), 200) });
  };
  if (Array.isArray(list)) for (const e of list) if (e && typeof e === "object") push((e as any).method, (e as any).path, (e as any).description);
  if (typeof openapi === "string" && openapi.trim()) {
    try {
      const doc = JSON.parse(openapi);
      for (const [path, ops] of Object.entries(doc?.paths ?? {})) for (const [method, op] of Object.entries(ops as Record<string, any>)) push(method, path, op?.summary ?? op?.description ?? "");
    } catch { /* only JSON OpenAPI is read */ }
  }
  return out.slice(0, MAX_ENDPOINTS);
}

/** The declared endpoint a call is for: same method, and the path matches its template ({x} = one segment). */
export function matchEndpoint(c: ApiConnector, method: string, path: string): ApiEndpoint | null {
  const p = path.split("?")[0];
  for (const e of c.endpoints) {
    if (e.method !== method) continue;
    const re = new RegExp(`^${e.path.replace(/[.*+?^$()|[\]\\]/g, "\\$&").replace(/\{[^}/]+\}/g, "[^/]+")}$`);
    if (re.test(p)) return e;
  }
  return null;
}

/** Every form a secret can come back in: raw, URL-encoded, JSON-escaped, base64 (alone, or as "user:secret" basic auth). */
export function scrubSecret(text: string, secret: string): string {
  if (!secret || secret.length < 4) return text;
  const forms = new Set([secret, encodeURIComponent(secret), JSON.stringify(secret).slice(1, -1), Buffer.from(secret).toString("base64"), Buffer.from(secret).toString("base64url")]);
  let out = text;
  for (const f of [...forms].sort((a, b) => b.length - a.length)) if (f.length >= 4 && out.includes(f)) out = out.split(f).join("[hidden]");
  return out;
}

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });
const str = (description: string) => ({ type: "string", description });

async function callApi(c: ToolContext, a: Record<string, any>, method: string): Promise<{ content: string; isError?: boolean; summary?: string }> {
  const conn = apiConnectors.byName(c.user.id, String(a.connector ?? ""));
  if (!conn) return { content: `No approved API connector is called "${a.connector}". Approved: ${apiConnectors.active(c.user.id).map((x) => x.name).join(", ") || "none"}. Propose one with api_connector_propose.`, isError: true };
  const path = String(a.path ?? "");
  if (!path.startsWith("/") || path.includes("..") || /^\/\//.test(path)) return { content: "Give a path starting with / (relative to the connector's base address).", isError: true };
  const ep = matchEndpoint(conn, method, path);
  if (!ep) return { content: `${method} ${path.split("?")[0]} is not one of ${conn.name}'s approved endpoints: ${conn.endpoints.map((e) => `${e.method} ${e.path}`).join(", ")}. Nothing was sent.`, isError: true, summary: "not declared" };
  const item: VaultRecord | null = vault.byName(c.user.id, conn.secret);
  const value = item?.kind === "secret" && item.passwordEnc ? unseal(item.passwordEnc) : null;
  if (!item || !value) return { content: `The secret "${conn.secret}" of this connector is missing from the vault. Ask the user to save it (Settings → Vault).`, isError: true };
  if (!item.hosts.some((h) => conn.host === h || conn.host.endsWith(`.${h}`))) return { content: `The secret "${conn.secret}" is not bound to ${conn.host}: it was not sent.`, isError: true };
  const url = new URL(conn.baseUrl + path);
  if (url.hostname.toLowerCase() !== conn.host) return { content: "That path leaves the connector's host. Nothing was sent.", isError: true };
  if (a.query && typeof a.query === "object") for (const [k, v] of Object.entries(a.query as Record<string, unknown>)) if (v !== undefined && v !== null) url.searchParams.set(k, String(v).slice(0, 500));
  const headers = new Headers({ accept: "application/json, text/plain;q=0.9, */*;q=0.5" });
  headers.set(item.header || "Authorization", `${item.prefix}${value}`);
  const body = method !== "GET" && a.body !== undefined ? (typeof a.body === "string" ? a.body : JSON.stringify(a.body)) : undefined;
  if (body && body.length > 1_000_000) return { content: "That body is too large (1 MB at most).", isError: true };
  if (body) headers.set("content-type", /^\s*[[{]/.test(body) ? "application/json" : "text/plain");
  let res: Response;
  try { res = await guardedFetch(url.toString(), { method, headers, body, redirect: "manual", signal: AbortSignal.any([c.signal, AbortSignal.timeout(30_000)]) }); }
  catch (err) { const why = fetchProblem(err); if (why) return { content: `Could not reach ${conn.host}: ${why}`, isError: true, summary: "not reached" }; throw err; }
  const type = res.headers.get("content-type") ?? "";
  const text = /text|json|xml|javascript|html/.test(type) || !type ? await res.text() : `(${type} content, ${res.headers.get("content-length") ?? "?"} bytes, not shown)`;
  const where = res.headers.get("location");
  return { content: scrubSecret(`Status ${res.status}${where ? ` (redirect to ${where}, not followed)` : ""}\n\n${clip(text, 40_000)}`, value), summary: `${res.status} · ${conn.name}`, isError: res.status >= 400 };
}

export const apiTools: BuiltinTool[] = [
  {
    spec: {
      name: "api_connector_propose",
      description: "Propose an access path to a service that has no app in the catalogue: an HTTP API with a token. Give its base address, the name of the vault secret that will hold the token, and the endpoints you need (or a small OpenAPI document in JSON). The user reviews it on a card, types the token there if needed (you never see it) and approves. This ends your turn; once approved, call it with api_get / api_send.",
      inputSchema: obj({
        name: str("A short name, e.g. \"Acme CRM\""), base_url: str("The API's https base address, e.g. https://api.acme.com/v1"),
        secret: str("Name of the vault secret holding the token (existing or new), e.g. \"Acme API key\""),
        header: str("The header the token goes in (default Authorization)"), prefix: str("Text before the token in that header (default \"Bearer \" for Authorization)"),
        endpoints: { type: "array", description: "The endpoints you need: [{\"method\": \"GET\", \"path\": \"/contacts/{id}\", \"description\": \"…\"}]", items: { type: "object", properties: { method: { type: "string" }, path: { type: "string" }, description: { type: "string" } } } },
        openapi: str("Optional: a small OpenAPI document (JSON) whose paths list the endpoints"),
        reason: str("Why, in one sentence"),
      }, ["name", "base_url", "secret"]),
    },
    activity: "waiting", label: "Proposing an API connector", group: "apps", audited: true, detail: (a) => clip(String(a.name ?? ""), 40),
    run: async (a, c) => {
      const name = clip(String(a.name ?? "").trim(), 60);
      const base = cleanBase(String(a.base_url ?? ""));
      const secret = clip(String(a.secret ?? "").trim(), 80);
      if (!name || !secret) return { content: "A connector needs a name and the name of its secret.", isError: true };
      if (!base) return { content: "The base address must be a full https address without credentials or query.", isError: true };
      const endpoints = cleanEndpoints(a.endpoints, a.openapi);
      if (!endpoints.length) return { content: "List at least one endpoint (method and path), or give a JSON OpenAPI document with paths.", isError: true };
      if (apiConnectors.byName(c.user.id, name)) return { content: `An API connector is already called "${name}".`, isError: true };
      const conn = apiConnectors.create(c.user.id, c.bot.id, { name, baseUrl: base.baseUrl, host: base.host, secret, endpoints });
      const existing = vault.byName(c.user.id, secret);
      const header = String(a.header ?? "").trim() || existing?.header || "Authorization";
      const prefix = typeof a.prefix === "string" ? a.prefix.slice(0, 40) : existing?.prefix ?? (header.toLowerCase() === "authorization" ? "Bearer " : "");
      rows.append(c.bot, { kind: "card", card: { type: "apiconnector", connectorId: conn.id, name, baseUrl: base.baseUrl, host: base.host, secret, secretSaved: !!(existing?.kind === "secret" && existing.hasPassword && coversHost(existing.hosts, base.host)), endpoints, status: "pending" } });
      // The header and prefix to use if the user types a new token on the card.
      pendingHeaders.set(conn.id, { header, prefix });
      bots.bumpUnread(c.bot.id);
      emit(c.user.id, { type: "apiConnectors" });
      return { content: "The user has the connector in front of them to review. Stop here; you will be told when it is approved.", summary: name, endTurn: true };
    },
  },
  {
    spec: { name: "api_get", description: "Read from an approved API connector: a GET to one of its declared endpoints. The server adds the token; the response is outside content.", inputSchema: obj({ connector: str("The connector's name"), path: str("Path relative to its base address, e.g. /contacts/42"), query: { type: "object", description: "Query parameters, as name → value", additionalProperties: { type: "string" } } }, ["connector", "path"]) },
    activity: "connector", label: "Reading from an API", group: "apps", outside: true, detail: (a) => clip(String(a.connector ?? ""), 40),
    run: (a, c) => callApi(c, a, "GET"),
  },
  {
    spec: { name: "api_send", description: "Change something through an approved API connector: POST, PUT, PATCH or DELETE to one of its declared endpoints. Like any action, it needs the user's words or their approval.", inputSchema: obj({ connector: str("The connector's name"), method: { type: "string", enum: ["POST", "PUT", "PATCH", "DELETE"] }, path: str("Path relative to its base address"), body: { type: "object", description: "JSON body" } }, ["connector", "method", "path"]) },
    activity: "connector", label: "Sending to an API", group: "apps", outside: true, audited: true, sensitive: true, detail: (a) => clip(`${a.method ?? ""} ${a.connector ?? ""}`, 40),
    // A DELETE always asks, whatever the bot's trust or an earlier "Always" (the floor: deleting always asks).
    gate: (a) => String(a.method ?? "").toUpperCase() === "DELETE" ? {
      key: `api delete: ${String(a.connector ?? "").trim()}`, strict: true, once: true, source: "API connector",
      title: "Allow {bot} to delete {path} through {connector}?", reason: "delete through {connector}", vars: { connector: clip(String(a.connector ?? ""), 60), path: clip(String(a.path ?? ""), 120) },
    } : null,
    run: (a, c) => {
      const m = String(a.method ?? "").toUpperCase();
      if (!["POST", "PUT", "PATCH", "DELETE"].includes(m)) return Promise.resolve({ content: "method must be POST, PUT, PATCH or DELETE (use api_get to read).", isError: true });
      return callApi(c, a, m);
    },
  },
];

/** A secret bound to `hosts` may already go to `host` (the same host, or a subdomain of one, as the credential relay allows). */
export function coversHost(hosts: string[], host: string): boolean {
  const h = host.toLowerCase();
  return hosts.some((x) => { const b = x.toLowerCase(); return h === b || h.endsWith(`.${b}`); });
}

/** Header and prefix for a token typed on a connector's card (in memory; the card falls back to Authorization: Bearer). */
export const pendingHeaders = new Map<string, { header: string; prefix: string }>();

/**
 * The user approved a proposed connector on its card. With `token`, it is sealed into the vault as the connector's
 * secret, bound to its host only (or the host is added to an existing secret of that name, which the user approved
 * here). The bot is told it can use it.
 */
export function approveConnector(userId: string, conn: ApiConnector, sealed: string | null): { ok: true } | { ok: false; error: string } {
  const existing = vault.byName(userId, conn.secret);
  const h = pendingHeaders.get(conn.id) ?? { header: existing?.header || "Authorization", prefix: existing?.prefix ?? "Bearer " };
  if (existing && existing.kind !== "secret") return { ok: false, error: "A vault item with that name is not a secret." };
  if (!existing && !sealed) return { ok: false, error: "Type the token first." };
  // A bot's proposal must never send an existing secret to a new host on one click (a page or an email could steer it to
  // an attacker's address): the user types the token again on the card to bind it to this host too.
  if (existing && !sealed && !coversHost(existing.hosts, conn.host)) return { ok: false, error: `The secret "${existing.name}" is not used with ${conn.host} yet. Type the token again on the card to allow it there too.` };
  if (existing) {
    const hosts = existing.hosts.includes(conn.host) ? existing.hosts : [...existing.hosts, conn.host];
    vault.update(existing.id, { kind: "secret", name: existing.name, site: existing.site, username: existing.username, passwordEnc: sealed ?? existing.passwordEnc, note: existing.note, hosts, header: existing.header || h.header, prefix: existing.prefix ?? h.prefix, checkUrl: existing.checkUrl });
  } else vault.create(userId, { kind: "secret", name: conn.secret, site: "", username: "", passwordEnc: sealed, note: `API connector ${conn.name}`, hosts: [conn.host], header: h.header, prefix: h.prefix });
  apiConnectors.activate(conn.id);
  audit(userId, "apps", `API connector approved: ${conn.name} (${conn.host}, ${conn.endpoints.length} endpoints)`);
  emit(userId, { type: "apiConnectors" });
  emit(userId, { type: "vault" });
  return { ok: true };
}
