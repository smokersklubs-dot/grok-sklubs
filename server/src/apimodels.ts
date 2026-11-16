import { randomUUID } from "node:crypto";
import { seal, unseal } from "./auth.js";
import { q } from "./db.js";
import { OpenAiCompatProvider } from "./llm/openai-compat.js";
import { setUserProviderSource, type LlmProvider } from "./llm/index.js";
import { assertPublicUrl, fetchProblem, guardedFetch } from "./net.js";
import type { ApiProvider, ApiProviderModel } from "./shared.js";
import { now } from "./store.js";
import { setPriceSource } from "./usage.js";
import { lentProviderIds } from "./hosted.js";

/**
 * Model providers a user sets up in Settings → Models: any endpoint speaking the OpenAI chat-completions format, with
 * its own key. They belong to one account: only that account's bots, pickers and backup lists see them. The key is
 * sealed like the connectors' tokens (auth.ts seal) and never sent back to the browser. Every request to the address
 * goes through the outbound guard (net.ts), like connectors: a user cannot point the server at its own network.
 */

/**
 * DeepSeek, as its official documentation gives it (checked 2026-11-16):
 * - base URL for the OpenAI format: https://api.deepseek.com (https://api-docs.deepseek.com/ — "base_url");
 * - models deepseek-flash and deepseek-v4-pro, 1M context (https://api-docs.deepseek.com/quick_start/pricing);
 * - prices in $ per 1M tokens, peak hours (off-peak is half): flash 0.3 input (cache miss) / 1.2 output / 0.006 cache
 *   hit; v4-pro 1.32 / 3.96 / 0.044 (same page). The peak prices are used so the shown cost is never below the real one.
 * - GET /models lists the models (https://api-docs.deepseek.com/api/list-models).
 * - Thinking is on by default and its reasoning_content must be sent back once tools are used
 *   (https://api-docs.deepseek.com/guides/thinking_mode); images are not read by these models.
 */
export const DEEPSEEK_PRESET = {
  preset: "deepseek",
  name: "DeepSeek",
  baseUrl: "https://api.deepseek.com",
  images: false,
  models: [
    { id: "deepseek-flash", contextWindow: 1_000_000, input: 0.3, output: 1.2, cached: 0.006 },
    { id: "deepseek-v4-pro", contextWindow: 1_000_000, input: 1.32, output: 3.96, cached: 0.044 },
  ] as ApiProviderModel[],
};
export const PRESETS = { deepseek: DEEPSEEK_PRESET } as const;

interface Row { id: string; user_id: string; name: string; base_url: string; key_enc: string | null; models: string; preset: string; images: number; created_at: number; updated_at: number; shared_hosted?: number }

const MAX_PROVIDERS = 10;
const MAX_MODELS = 30;

const price = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? Math.round(n * 1_000_000) / 1_000_000 : null;
};

/** Keeps well-formed models: an id a model reference can carry, an optional context window and prices. */
export function cleanModels(raw: unknown): ApiProviderModel[] {
  if (!Array.isArray(raw)) return [];
  const out: ApiProviderModel[] = [];
  for (const m of raw) {
    const id = typeof m === "string" ? m.trim() : typeof m?.id === "string" ? m.id.trim() : "";
    if (!id || id.length > 100 || !/^[A-Za-z0-9._:/@+-]+$/.test(id) || out.some((x) => x.id === id)) continue;
    const ctx = Number(m?.contextWindow);
    out.push({ id, contextWindow: Number.isInteger(ctx) && ctx > 0 && ctx <= 100_000_000 ? ctx : null, input: price(m?.input), output: price(m?.output), cached: price(m?.cached) });
    if (out.length >= MAX_MODELS) break;
  }
  return out;
}

/** The address of an OpenAI-compatible API: https (http only when private fetches are allowed for local testing). */
export function cleanBaseUrl(raw: unknown): string | null {
  const t = String(raw ?? "").trim();
  let u: URL;
  try { u = new URL(t); } catch { return null; }
  const httpOk = process.env.ALLOW_PRIVATE_FETCH === "1" || process.env.ALLOW_PRIVATE_FETCH === "true";
  if (!(u.protocol === "https:" || (httpOk && u.protocol === "http:")) || u.username || u.password || u.search || u.hash) return null;
  return u.toString().replace(/\/+$/, "");
}

const toPublic = (r: Row): ApiProvider => ({
  id: r.id, name: r.name, baseUrl: r.base_url, hasKey: !!r.key_enc, models: cleanModels(safe(r.models)), preset: r.preset || null, images: !!r.images, createdAt: r.created_at, updatedAt: r.updated_at,
});
function safe(s: string): unknown { try { return JSON.parse(s); } catch { return []; } }

const rowsOf = (userId: string) => q.all<Row>("SELECT * FROM user_providers WHERE user_id = ? ORDER BY created_at", userId);
const rowOf = (userId: string, id: string) => q.get<Row>("SELECT * FROM user_providers WHERE user_id = ? AND id = ?", userId, id);
/**
 * Hosted mode: an operator's own providers lent to this account (hosted.ts lentProviderIds — only for plans that use the
 * operator's keys, never "bring your own key"). Used to run and price turns only: they never appear in the account's
 * Settings → Models list, and their keys and addresses are never sent to it.
 */
const lentRows = (userId: string): Row[] => lentProviderIds(userId).map((id) => q.get<Row>("SELECT * FROM user_providers WHERE id = ?", id)).filter((r): r is Row => !!r);

/** One provider object per saved version (rebuilt when the provider changes). */
const instances = new Map<string, { at: number; provider: OpenAiCompatProvider }>();

function instanceOf(r: Row): OpenAiCompatProvider {
  const cached = instances.get(r.id);
  if (cached && cached.at === r.updated_at) return cached.provider;
  const keyEnc = r.key_enc;
  const provider = new OpenAiCompatProvider({
    id: r.id, label: r.name, baseUrl: r.base_url, apiKeyEnv: "", models: cleanModels(safe(r.models)).map((m) => m.id),
    apiKey: () => (keyEnc ? unseal(keyEnc) : null),
    fetch: (url, init) => guardedFetch(url, init),
    echoReasoning: r.preset === "deepseek" || /(^|\.)deepseek\.com$/i.test(hostOf(r.base_url)),
    images: !!r.images,
  });
  instances.set(r.id, { at: r.updated_at, provider });
  return provider;
}
const hostOf = (u: string) => { try { return new URL(u).hostname; } catch { return ""; } };

export const apiProviders = {
  list: (userId: string): ApiProvider[] => rowsOf(userId).map(toPublic),
  get: (userId: string, id: string): ApiProvider | null => { const r = rowOf(userId, id); return r ? toPublic(r) : null; },
  /** The providers a user's turns may use (ids start with "up-"; see llm/index.ts). */
  providersOf: (userId: string): LlmProvider[] => [...rowsOf(userId), ...lentRows(userId)].filter((r) => r.key_enc).map(instanceOf),
  /** Hosted mode: the providers an operator lends to hosted accounts (by name and models only). */
  lentTo: (userId: string): { id: string; name: string; models: string[] }[] => lentRows(userId).map((r) => ({ id: r.id, name: r.name, models: cleanModels(safe(r.models)).map((m) => m.id) })),
  /** Hosted mode: whether an operator's provider is lent to hosted accounts. */
  setLent(userId: string, id: string, on: boolean): boolean {
    return q.run("UPDATE user_providers SET shared_hosted = ? WHERE id = ? AND user_id = ?", on ? 1 : 0, id, userId).changes > 0;
  },
  lentFlags: (userId: string): Record<string, boolean> => Object.fromEntries(rowsOf(userId).map((r) => [r.id, !!r.shared_hosted])),
  create(userId: string, f: { name: string; baseUrl: string; key: string | null; models: ApiProviderModel[]; preset: string; images: boolean }): ApiProvider {
    if (rowsOf(userId).length >= MAX_PROVIDERS) throw new Error(`At most ${MAX_PROVIDERS} providers.`);
    const id = `up-${randomUUID().replace(/-/g, "").slice(0, 12)}`;
    const t = now();
    q.run("INSERT INTO user_providers (id, user_id, name, base_url, key_enc, models, preset, images, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      id, userId, f.name, f.baseUrl, f.key ? seal(f.key) : null, JSON.stringify(f.models), f.preset, f.images ? 1 : 0, t, t);
    return apiProviders.get(userId, id)!;
  },
  /** `key`: a new key (sealed), `null` removes it, undefined keeps the saved one. */
  update(userId: string, id: string, f: Partial<{ name: string; baseUrl: string; key: string | null; models: ApiProviderModel[]; images: boolean }>): ApiProvider | null {
    const cur = rowOf(userId, id);
    if (!cur) return null;
    // A new address never inherits the old key: the key was given for the old address.
    const moved = f.baseUrl !== undefined && f.baseUrl !== cur.base_url;
    const keyEnc = f.key === undefined ? (moved ? null : cur.key_enc) : f.key === null ? null : seal(f.key);
    q.run("UPDATE user_providers SET name = ?, base_url = ?, key_enc = ?, models = ?, images = ?, updated_at = ? WHERE id = ? AND user_id = ?",
      f.name ?? cur.name, f.baseUrl ?? cur.base_url, keyEnc, f.models ? JSON.stringify(f.models) : cur.models, f.images === undefined ? cur.images : f.images ? 1 : 0,
      Math.max(now(), cur.updated_at + 1), id, userId);
    return apiProviders.get(userId, id);
  },
  remove(userId: string, id: string): boolean {
    instances.delete(id);
    return q.run("DELETE FROM user_providers WHERE user_id = ? AND id = ?", userId, id).changes > 0;
  },
  /** Prices of a model of this user's providers, by its bare name (the usage table records the bare model name). */
  priceOf(userId: string, model: string): [number, number, number] | null {
    for (const p of [...apiProviders.list(userId), ...lentRows(userId).map(toPublic)]) {
      const m = p.models.find((x) => x.id === model);
      if (m && (m.input !== null || m.output !== null)) return [m.input ?? 0, m.output ?? 0, m.cached ?? m.input ?? 0];
    }
    return null;
  },
  /** The context window of a model reference "up-…:model", when the user gave one. */
  contextOf(userId: string, ref: string): number | null {
    const sep = ref.indexOf(":");
    if (!ref.startsWith("up-") || sep < 0) return null;
    return apiProviders.get(userId, ref.slice(0, sep))?.models.find((m) => m.id === ref.slice(sep + 1))?.contextWindow ?? null;
  },
};

setUserProviderSource((userId) => apiProviders.providersOf(userId));
setPriceSource((userId, model) => apiProviders.priceOf(userId, model));

/** The key to try: the one typed now, else the saved one. Never returned anywhere. */
function keyFor(userId: string, id: string | null, typed: string | null): string | null {
  if (typed) return typed;
  if (!id) return null;
  const r = rowOf(userId, id);
  return r?.key_enc ? unseal(r.key_enc) : null;
}

const short = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 200);

/**
 * The provider's model list: GET {base}/models, the OpenAI-compatible listing (DeepSeek documents it:
 * https://api-docs.deepseek.com/api/list-models — `data[].id`, and `context_window` per model).
 */
export async function fetchModels(userId: string, baseUrl: string, id: string | null, typedKey: string | null): Promise<{ ok: true; models: ApiProviderModel[] } | { ok: false; error: string }> {
  const key = keyFor(userId, id, typedKey);
  if (!key) return { ok: false, error: "Type the API key first." };
  try {
    await assertPublicUrl(baseUrl);
    const res = await guardedFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    if (!res.ok) { await res.body?.cancel().catch(() => {}); return { ok: false, error: res.status === 401 || res.status === 403 ? "The provider refused this key." : `The provider answered ${res.status}.` }; }
    const j = (await res.json().catch(() => null)) as { data?: { id?: unknown; context_window?: unknown }[] } | null;
    const list = Array.isArray(j?.data) ? j!.data : null;
    if (!list) return { ok: false, error: "The provider did not send a model list." };
    return { ok: true, models: cleanModels(list.map((m) => ({ id: m?.id, contextWindow: m?.context_window }))) };
  } catch (err) {
    return { ok: false, error: fetchProblem(err) ?? short(String((err as Error)?.message ?? err)) };
  }
}

/**
 * "Tester": the cheapest documented call that proves the key works — GET {base}/models (no tokens used). When the
 * provider has no such listing (404/405), one chat completion of at most 1 output token on the first model
 * (POST {base}/chat/completions with `max_tokens`, the OpenAI-compatible request DeepSeek documents at
 * https://api-docs.deepseek.com/api/create-chat-completion).
 */
export async function testProvider(userId: string, baseUrl: string, id: string | null, typedKey: string | null, model: string | null): Promise<{ ok: boolean; detail: string }> {
  const key = keyFor(userId, id, typedKey);
  if (!key) return { ok: false, detail: "Type the API key first." };
  try {
    await assertPublicUrl(baseUrl);
    const res = await guardedFetch(`${baseUrl}/models`, { headers: { authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(15_000) });
    await res.body?.cancel().catch(() => {});
    if (res.ok) return { ok: true, detail: "The key works." };
    if (res.status === 401 || res.status === 403) return { ok: false, detail: "The provider refused this key." };
    if ((res.status === 404 || res.status === 405) && model) {
      const r = await guardedFetch(`${baseUrl}/chat/completions`, {
        method: "POST", headers: { authorization: `Bearer ${key}`, "content-type": "application/json" },
        body: JSON.stringify({ model, messages: [{ role: "user", content: "ping" }], max_tokens: 1, stream: false }), signal: AbortSignal.timeout(30_000),
      });
      await r.body?.cancel().catch(() => {});
      if (r.ok) return { ok: true, detail: "The key works." };
      return { ok: false, detail: r.status === 401 || r.status === 403 ? "The provider refused this key." : `The provider answered ${r.status}.` };
    }
    return { ok: false, detail: `The provider answered ${res.status}.` };
  } catch (err) {
    return { ok: false, detail: fetchProblem(err) ?? short(String((err as Error)?.message ?? err)) };
  }
}
