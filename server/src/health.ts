import { unseal } from "./auth.js";
import { apiConnectors, scrubSecret } from "./apiconnectors.js";
import { emit } from "./bus.js";
import { connectors } from "./connectors.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { accounts as nativeAccounts } from "./native/accounts.js";
import { guardedFetch } from "./net.js";
import { pushLater } from "./push.js";
import { routines } from "./routines.js";
import { unschedule } from "./scheduler.js";
import type { CredentialHealth, HealthState } from "./shared.js";
import { audit, bots, clip, now, rows, users, vault, type VaultRecord } from "./store.js";

/**
 * Wave 7 (spec 08 A2) — health of keys and connections.
 *
 * For every vault secret, API connector, built-in app account and MCP connector: works / reconnect / key refused /
 * uncertain / never checked, with the date of the last check. A check is one read-only request that costs nothing:
 *  - a vault secret: the address the user gave for it (its "check address", on one of its hosts), else a known free
 *    endpoint of that API (table below, each from the provider's own reference), else nothing — "never" rather than an
 *    invented call;
 *  - an API connector: its first declared GET endpoint without a {placeholder};
 *  - a built-in app account and an MCP connector: their sign-in state (renewal is done by their own code).
 * 2xx = works; 401/403 = refused ("broken"); 429 = rate limited (not a failure: the state stays); 5xx, timeout or no
 * answer = "uncertain" (tried again at the next round). A key typed by the user is checked before it is saved (routes.ts:
 * "save anyway" when it fails). Checks run once a day (HEALTH_EVERY_MIN) and on demand. When something goes from
 * working (or unknown) to broken, the user is told once — a push notification and a line in the main bot's chat — and
 * the routines that depend on it pause ("connection to redo"), before they fail on it.
 */

interface KnownCheck { host: string; path: string; headers?: Record<string, string>; okWhen?: (body: string) => boolean }
const KNOWN: KnownCheck[] = [
  // GET /v1/models — https://platform.openai.com/docs/api-reference/models/list
  { host: "api.openai.com", path: "/v1/models" },
  // GET /v1/models with anthropic-version — https://docs.anthropic.com/en/api/models-list
  { host: "api.anthropic.com", path: "/v1/models", headers: { "anthropic-version": "2023-06-01" } },
  // GET /user — https://docs.github.com/en/rest/users/users#get-the-authenticated-user
  { host: "api.github.com", path: "/user", headers: { "x-github-api-version": "2022-11-28" } },
  // GET /v1/balance (read-only) — https://docs.stripe.com/api/balance/balance_retrieve
  { host: "api.stripe.com", path: "/v1/balance" },
  // GET /v1/models — https://docs.mistral.ai/api/#tag/models
  { host: "api.mistral.ai", path: "/v1/models" },
  // GET /openai/v1/models — https://console.groq.com/docs/api-reference#models-list
  { host: "api.groq.com", path: "/openai/v1/models" },
  // GET /v1/models — https://docs.x.ai/docs/api-reference#list-models
  { host: "api.x.ai", path: "/v1/models" },
  // GET /v1/user — https://elevenlabs.io/docs/api-reference/user/get
  { host: "api.elevenlabs.io", path: "/v1/user" },
  // GET /api/whoami-v2 — https://huggingface.co/docs/hub/api
  { host: "huggingface.co", path: "/api/whoami-v2" },
  // GET /v1/users/me with Notion-Version — https://developers.notion.com/reference/get-self
  { host: "api.notion.com", path: "/v1/users/me", headers: { "notion-version": "2022-06-28" } },
  // POST-free check: GET https://slack.com/api/auth.test answers 200 with ok:false for a bad token — https://api.slack.com/methods/auth.test
  { host: "slack.com", path: "/api/auth.test", okWhen: (b) => /"ok"\s*:\s*true/.test(b) },
];
const allowHttp = () => process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
const sameSite = (here: string, wanted: string) => here === wanted || here.endsWith("." + wanted);

/** The address a secret is checked at, or null when no zero-cost check is known. */
export function checkTarget(item: Pick<VaultRecord, "hosts" | "checkUrl">): { url: string; headers: Record<string, string>; how: string; okWhen?: (b: string) => boolean } | null {
  if (item.checkUrl) {
    try {
      const u = new URL(item.checkUrl);
      if ((u.protocol === "https:" || (allowHttp() && u.protocol === "http:")) && item.hosts.some((h) => sameSite(u.hostname.toLowerCase(), h))) return { url: u.toString(), headers: {}, how: `GET ${u.hostname}${u.pathname}` };
    } catch { /* not a URL */ }
  }
  for (const h of item.hosts) {
    const k = KNOWN.find((c) => sameSite(c.host, h) || sameSite(h, c.host));
    if (k) return { url: `https://${k.host}${k.path}`, headers: k.headers ?? {}, how: `GET ${k.host}${k.path}`, okWhen: k.okWhen };
  }
  return null;
}

export interface CheckResult { state: HealthState; detail: string; how: string; rateLimited?: boolean }

/** One read-only request with the secret in its header; never a write, never a redirect followed. */
export async function probe(url: string, header: string, value: string, extra: Record<string, string> = {}, okWhen?: (b: string) => boolean): Promise<Omit<CheckResult, "how">> {
  const headers = new Headers({ accept: "application/json", ...extra });
  headers.set(header || "Authorization", value);
  let res: Response;
  try { res = await guardedFetch(url, { method: "GET", headers, redirect: "manual", signal: AbortSignal.timeout(15_000) }); }
  catch (err) { return { state: "uncertain", detail: clip(String((err as Error)?.message ?? err), 120) }; }
  const body = await res.text().catch(() => "");
  if (res.status === 429) return { state: "ok", detail: "rate limited (not a failure)", rateLimited: true };
  if (res.status === 401 || res.status === 403) return { state: "broken", detail: `refused (${res.status})` };
  if (res.status >= 500) return { state: "uncertain", detail: `provider error (${res.status})` };
  if (res.status >= 200 && res.status < 300) return okWhen && !okWhen(body) ? { state: "broken", detail: clip(scrubSecret(body, value), 120) } : { state: "ok", detail: `${res.status}` };
  return { state: "uncertain", detail: `unexpected answer (${res.status})` };
}

/** Checks a secret (with a value about to be saved, or the one in the vault). */
export async function checkSecret(item: Pick<VaultRecord, "hosts" | "checkUrl" | "header" | "prefix" | "passwordEnc">, plain?: string): Promise<CheckResult> {
  const target = checkTarget(item);
  if (!target) return { state: "never", detail: "no free check is known for this API", how: "" };
  const value = plain ?? (item.passwordEnc ? unseal(item.passwordEnc) : null);
  if (!value) return { state: "never", detail: "no value saved", how: target.how };
  const r = await probe(target.url, item.header || "Authorization", `${item.prefix ?? ""}${value}`, target.headers, target.okWhen);
  return { ...r, how: target.how };
}

interface Row { kind: CredentialHealth["kind"]; ref_id: string; name: string; state: HealthState; detail: string; how: string; rate_limited: number; checked_at: number | null; alerted_state: string }
const rowOf = (userId: string, kind: string, id: string) => q.get<Row>("SELECT * FROM credential_health WHERE user_id = ? AND kind = ? AND ref_id = ?", userId, kind, id);

/** Saves a check's result; tells the user once when something stopped working. */
export function recordHealth(userId: string, kind: CredentialHealth["kind"], id: string, name: string, r: CheckResult, opts: { quiet?: boolean } = {}) {
  const prev = rowOf(userId, kind, id);
  // A rate limit says nothing about the key: keep what we knew.
  const state = r.rateLimited && prev ? prev.state : r.state;
  q.run(`INSERT INTO credential_health (user_id, kind, ref_id, name, state, detail, how, rate_limited, checked_at, alerted_state) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, '')
    ON CONFLICT(user_id, kind, ref_id) DO UPDATE SET name = excluded.name, state = excluded.state, detail = excluded.detail, how = excluded.how, rate_limited = excluded.rate_limited, checked_at = excluded.checked_at`,
    userId, kind, id, name, state, clip(r.detail, 200), r.how, r.rateLimited ? 1 : 0, now());
  const broken = state === "broken" || state === "reconnect";
  // Checked while the user saves it ("save anyway"): they already know — no alert now, nor at the next rounds.
  if (broken && opts.quiet) q.run("UPDATE credential_health SET alerted_state = ? WHERE user_id = ? AND kind = ? AND ref_id = ?", state, userId, kind, id);
  else if (broken && (!prev || (prev.alerted_state !== state && prev.state !== state))) alert(userId, kind, id, name, state, r.detail);
  if (state === "ok") q.run("UPDATE credential_health SET alerted_state = '' WHERE user_id = ? AND kind = ? AND ref_id = ?", userId, kind, id);
}

function alert(userId: string, kind: CredentialHealth["kind"], id: string, name: string, state: HealthState, detail: string) {
  q.run("UPDATE credential_health SET alerted_state = ? WHERE user_id = ? AND kind = ? AND ref_id = ?", state, userId, kind, id);
  const loc = users.localeOf(userId);
  const text = tr(loc, state === "reconnect" ? "The connection “{name}” needs a new sign-in." : "The key “{name}” stopped working ({detail}).", { name, detail });
  const paused = pauseDependents(userId, kind, id, name);
  const main = bots.primary(userId);
  if (main) rows.append(main, { kind: "notice", tone: "warn", text: paused.length ? `${text} ${tr(loc, "Paused until it is fixed: {list}.", { list: paused.join(", ") })}` : text, action: { kind: "settings", section: "keys" } });
  pushLater(userId, { kind: "needs", title: tr(loc, "A connection broke"), body: text, tag: `health-${kind}-${id}` });
  audit(userId, "apps", `Health: ${name} → ${state} (${clip(detail, 100)})`);
}

/** Routines that rely on this key or connection: the account they read, or its name in their instruction. */
function pauseDependents(userId: string, kind: CredentialHealth["kind"], id: string, name: string): string[] {
  const out: string[] = [];
  const loc = users.localeOf(userId);
  for (const b of bots.list(userId, true)) for (const r of routines.forBot(b.id)) {
    if (!r.enabled) continue;
    const uses = (kind === "native" && r.native?.accountId === id) || (name.length >= 3 && r.prompt.toLowerCase().includes(name.toLowerCase()));
    if (!uses) continue;
    routines.pauseFor(r.id, tr(loc, "Paused — connection to redo: {name}", { name }));
    unschedule(r.id);
    out.push(r.name);
  }
  if (out.length) emit(userId, { type: "routines", botId: "" });
  return out;
}

/** Runs every check of one account (once a day, and from "Check now"). */
export async function checkAll(userId: string): Promise<CredentialHealth[]> {
  for (const item of vault.list(userId).filter((i) => i.kind === "secret")) recordHealth(userId, "vault", item.id, item.name, await checkSecret(item));
  for (const conn of apiConnectors.active(userId)) recordHealth(userId, "api", conn.id, conn.name, await checkConnector(userId, conn.id));
  for (const a of nativeAccounts.list(userId)) recordHealth(userId, "native", a.id, a.name, a.status === "ready" ? { state: "ok", detail: "signed in", how: "sign-in state" } : { state: "reconnect", detail: "sign in again", how: "sign-in state" });
  for (const k of connectors.list(userId)) recordHealth(userId, "connector", k.id, k.name, k.status === "ready" ? { state: "ok", detail: `${k.tools.length} tools`, how: "connection state" } : k.status === "needs_auth" ? { state: "reconnect", detail: "sign in again", how: "connection state" } : k.status === "error" ? { state: "broken", detail: clip(k.error ?? "error", 120), how: "connection state" } : { state: "uncertain", detail: "connecting", how: "connection state" });
  emit(userId, { type: "health" });
  return healthList(userId);
}

export async function checkConnector(userId: string, id: string): Promise<CheckResult> {
  const conn = apiConnectors.owned(userId, id);
  if (!conn) return { state: "never", detail: "missing", how: "" };
  const ep = conn.endpoints.find((e) => e.method === "GET" && !e.path.includes("{"));
  if (!ep) return { state: "never", detail: "no GET endpoint without parameters to check with", how: "" };
  const item = vault.byName(userId, conn.secret);
  if (!item?.passwordEnc) return { state: "broken", detail: "its secret is missing", how: `GET ${conn.host}${ep.path}` };
  const value = unseal(item.passwordEnc);
  if (!value) return { state: "broken", detail: "its secret is missing", how: "" };
  const r = await probe(conn.baseUrl + ep.path, item.header || "Authorization", `${item.prefix}${value}`);
  return { ...r, how: `GET ${conn.host}${ep.path}` };
}

/** Everything the user has, with its last known state ("never" for what was not checked yet). */
export function healthList(userId: string): CredentialHealth[] {
  const known = new Map(q.all<Row>("SELECT * FROM credential_health WHERE user_id = ?", userId).map((r) => [`${r.kind}|${r.ref_id}`, r]));
  const one = (kind: CredentialHealth["kind"], id: string, name: string, extra: Partial<CredentialHealth> = {}): CredentialHealth => {
    const r = known.get(`${kind}|${id}`);
    return { kind, id, name, state: r?.state ?? "never", detail: r?.detail ?? "", checkedAt: r?.checked_at ?? null, how: r?.how ?? "", rateLimited: !!r?.rate_limited, ...extra };
  };
  return [
    ...vault.list(userId).filter((i) => i.kind === "secret").map((i) => one("vault", i.id, i.name, { manualToken: true })),
    ...apiConnectors.active(userId).map((c) => one("api", c.id, c.name)),
    ...nativeAccounts.list(userId).map((a) => one("native", a.id, a.name)),
    ...connectors.list(userId).map((k) => one("connector", k.id, k.name)),
  ];
}

/** Once a day (HEALTH_EVERY_MIN), every account is checked. Not started with NO_SCHEDULER (tests). */
let timer: NodeJS.Timeout | null = null;
export function startHealthChecks() {
  if (timer || process.env.NO_SCHEDULER === "1") return;
  const every = Math.max(5, Number(process.env.HEALTH_EVERY_MIN) || 24 * 60) * 60_000;
  const round = async () => { for (const u of q.all<{ id: string }>("SELECT id FROM users")) await checkAll(u.id).catch((err) => console.error("[health]", (err as Error).message)); };
  timer = setInterval(() => void round(), every);
  timer.unref();
  setTimeout(() => void round(), 60_000).unref();
}
