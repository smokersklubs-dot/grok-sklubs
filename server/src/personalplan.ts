import { createHash, randomBytes, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { config } from "./config.js";

// An operator enables a single personal installation by placing its Sklubot user ID
// in this server-only directory. None of these files is mounted in a bot desktop.
const dir = path.join(config.dataDir, "personal-chatgpt");
const registration = path.join(dir, "registration.json");
const issuer = "https://auth.openai.com";
export const resource = "https://api.openai.com/v1";
const scope = "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct";
const nonce = () => randomBytes(32).toString("base64url");
export const personalEnabled = (id: string): boolean => {
  try { return !!id && config.botLink === "socket" && readFileSync(path.join(dir, "owner"), "utf8").trim() === id; }
  catch { return false; }
};

interface Registration {
  owner: string; client: string; sub: string; access: string; refresh: string;
  expires: number; models: string[];
}
function load(owner: string): Registration | null {
  if (!personalEnabled(owner) || !existsSync(registration)) return null;
  const r = JSON.parse(readFileSync(registration, "utf8")) as Registration;
  return r.owner === owner ? r : null;
}
function save(r: Registration) {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const tmp = registration + "." + randomUUID();
  writeFileSync(tmp, JSON.stringify(r), { mode: 0o600, flag: "wx" });
  renameSync(tmp, registration);
}
export const personalActive = (owner: string) => !!load(owner)?.refresh;
export const personalModels = (owner: string) => load(owner)?.models ?? [];
export async function verifyPersonal(owner: string) {
  if (!personalActive(owner)) return false;
  let access: string;
  try { access = await personalAccess(owner); }
  catch (e) { if (e instanceof ExpiredGrant) return false; throw e; }
  const res = await fetch(resource + "/models", { headers: { authorization: "Bearer " + access }, redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error("ChatGPT could not verify this account");
  return true;
}
function hostId() {
  const file = path.join(dir, "host-id");
  try { writeFileSync(file, "urn:uuid:" + randomUUID(), { flag: "wx", mode: 0o600 }); }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; }
  return readFileSync(file, "utf8").trim();
}
export function beginPersonal(owner: string, redirect: string) {
  if (!personalEnabled(owner)) throw new Error("Personal installation unavailable");
  const saved = load(owner);
  const state = nonce(), verifier = nonce(), oidcNonce = nonce();
  const url = new URL(issuer + "/api/accounts/authorize");
  url.search = new URLSearchParams({ client_id: saved?.client ?? "dynamic_agent_client",
    ...(saved ? {} : { agent_name_hint: "Sklubot" }), ext_agent_host_id: hostId(), redirect_uri: redirect,
    response_type: "code", scope, resource, state, nonce: oidcNonce, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url") }).toString();
  return { owner, url: url.href, state, verifier, nonce: oidcNonce, redirect, client: saved?.client, sub: saved?.sub };
}
type Attempt = ReturnType<typeof beginPersonal>;
class ExpiredGrant extends Error {}
async function tokens(params: Record<string, string>) {
  const res = await fetch(issuer + "/api/accounts/oauth/token", { method: "POST", redirect: "error",
    body: new URLSearchParams({ ...params, resource }), signal: AbortSignal.timeout(20_000) });
  if (!res.ok) {
    if (res.status === 400 && (await res.json().catch(() => ({})) as {error?: string}).error === "invalid_grant") throw new ExpiredGrant("ChatGPT sign-in needed");
    throw new Error("ChatGPT authorization failed (" + res.status + ")");
  }
  return await res.json() as { access_token: string; refresh_token?: string; id_token?: string; expires_in: number; scope?: string };
}
async function discovery() {
  const res = await fetch(issuer + "/.well-known/openid-configuration", { redirect: "error", signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error("ChatGPT identity service unavailable");
  const d = await res.json() as { issuer: string; jwks_uri: string; revocation_endpoint: string };
  if (d.issuer !== issuer || new URL(d.jwks_uri).origin !== issuer || new URL(d.revocation_endpoint).origin !== issuer) throw new Error("Unexpected identity service");
  return d;
}
export async function finishPersonal(a: Attempt, callback: URLSearchParams) {
  const client = callback.get("client_id") ?? a.client;
  const code = callback.get("code");
  if (!personalEnabled(a.owner) || callback.get("state") !== a.state || callback.has("error") || !code ||
      !client || client === "dynamic_agent_client" || (a.client && client !== a.client)) throw new Error("Authorization was not completed");
  const t = await tokens({ grant_type: "authorization_code", client_id: client, code, code_verifier: a.verifier, redirect_uri: a.redirect });
  if (!t.id_token || !t.refresh_token || !t.access_token || !Number.isFinite(t.expires_in) || !t.scope?.split(/\s+/).includes("chatgpt.tokens.use.direct"))
    throw new Error("ChatGPT plan access was not granted");
  const d = await discovery();
  const { payload } = await jwtVerify(t.id_token, createRemoteJWKSet(new URL(d.jwks_uri)), { issuer, audience: client, requiredClaims: ["exp", "sub", "nonce"] });
  if (payload.nonce !== a.nonce || !payload.sub || (a.sub && a.sub !== payload.sub)) throw new Error("Unexpected ChatGPT identity");
  const res = await fetch(resource + "/models", { headers: { Authorization: "Bearer " + t.access_token }, redirect: "error", signal: AbortSignal.timeout(20_000) });
  if (!res.ok) throw new Error("ChatGPT model catalog unavailable");
  const catalog = await res.json() as { models?: { slug: string; visibility: string }[] };
  const models = (catalog.models ?? []).filter((m) => m.visibility === "list" && /^[\w.-]{1,100}$/.test(m.slug)).map((m) => m.slug);
  if (!models.length) throw new Error("No models available on this account");
  save({ owner: a.owner, client, sub: payload.sub, access: t.access_token, refresh: t.refresh_token,
    expires: Date.now() + t.expires_in * 1000, models });
}
const renewing = new Map<string, Promise<string>>();
export async function personalAccess(owner: string): Promise<string> {
  const r = load(owner);
  if (!r?.refresh) throw new Error("ChatGPT sign-in needed");
  if (r.expires > Date.now() + 90_000) return r.access;
  const pending = renewing.get(owner);
  if (pending) return pending;
  const job = (async () => {
    const t = await tokens({ grant_type: "refresh_token", client_id: r.client, refresh_token: r.refresh });
    if (!t.access_token || !Number.isFinite(t.expires_in) || (t.scope && !t.scope.split(/\s+/).includes("chatgpt.tokens.use.direct")) ||
        load(owner)?.refresh !== r.refresh) throw new Error("ChatGPT sign-in needed");
    save({ ...r, access: t.access_token, refresh: t.refresh_token || r.refresh, expires: Date.now() + 1000 * t.expires_in });
    return t.access_token;
  })().finally(() => renewing.delete(owner));
  renewing.set(owner, job);
  return job;
}
export async function disconnectPersonal(owner: string) {
  await renewing.get(owner)?.catch(() => {});
  const r = load(owner);
  if (!r?.refresh) return;
  const { revocation_endpoint } = await discovery();
  const res = await fetch(revocation_endpoint, { method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    body: new URLSearchParams({ client_id: r.client, token: r.refresh, token_type_hint: "refresh_token" }) });
  if (!res.ok) throw new Error("Could not revoke the ChatGPT connection");
  save({ ...r, access: "", refresh: "", expires: 0, models: [] });
}
