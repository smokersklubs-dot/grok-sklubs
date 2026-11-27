import { ProviderError } from "./llm/types.js"; import { byLocale, type LocaleTexts } from "./lang/index.js";
import { fetchProblem, guardedFetch } from "./net.js";
import type { ApiProviderModel, Locale } from "./shared.js";
import { audit, bots, rows, users } from "./store.js";

/**
 * OpenRouter as a ready-made model provider (Settings → Models → "Add a provider" → OpenRouter). Every account brings its
 * own OpenRouter account and key ("chacun son compte"): the key is sealed like any provider key (apimodels.ts) and never
 * sent back; OpenRouter bills the person directly. Facts from OpenRouter's official documentation (read 2026-11-18):
 *
 * - Base URL for OpenAI-style clients: https://openrouter.ai/api/v1; auth header `Authorization: Bearer <key>`
 *   (https://openrouter.ai/docs/quickstart, https://openrouter.ai/docs/api-reference/authentication).
 * - Chat completions are OpenAI-compatible, tools in the OpenAI `tools` format, nested under `function`
 *   (https://openrouter.ai/docs/features/tool-calling).
 * - GET /api/v1/models: the public catalog (auth optional). Query `supported_parameters` ("Comma-separated API parameters
 *   required (e.g. tools…)"). Each model has `id`, `name`, `created`, `context_length`, `architecture.input_modalities`,
 *   `pricing.prompt` / `pricing.completion` / `pricing.input_cache_read` (USD per token, as strings; "-1" = dynamic
 *   routers such as openrouter/auto, "0" = free), `supported_parameters`, `endpoints` (API paths it serves).
 *   ":batch" variants are discounted asynchronous batch endpoints (https://openrouter.ai/docs/api-reference/list-available-models,
 *   https://openrouter.ai/docs/api_reference/models.md).
 * - Usage: every chat response's `usage` carries `cost` ("Cost of the completion"), streaming included ("Full usage details
 *   are always included") (https://openrouter.ai/docs/api/api-reference/chat/create-a-chat-completion).
 * - GET /api/v1/key: checks a key; `data.limit_remaining` (null when unlimited), `data.usage`, `data.is_free_tier`
 *   (https://openrouter.ai/docs/api_reference/limits.md).
 * - 402: "Your account or API key has insufficient credits. Add more credits and retry the request."
 *   (https://openrouter.ai/docs/api_reference/errors-and-debugging.md). `error.metadata.limit_source`
 *   "openrouter_in_flight_budget" comes with a Retry-After header and is a wait-and-retry case; "openrouter_key_limit" and
 *   "openrouter_credits" are not (https://openrouter.ai/docs/api_reference/limits.md#handling-402-errors).
 * - App attribution: `HTTP-Referer` (the app's URL, its identifier) and `X-OpenRouter-Title` (its display name; `X-Title`
 *   is the older spelling) (https://openrouter.ai/docs/app-attribution). We send the project's public page, never the
 *   address of this server, so a self-hosted server stays private.
 */
export const OPENROUTER_PRESET = {
  preset: "openrouter",
  name: "OpenRouter",
  baseUrl: "https://openrouter.ai/api/v1",
  images: true,
  models: [] as ApiProviderModel[],
  keysUrl: "https://openrouter.ai/keys",
  creditsUrl: "https://openrouter.ai/settings/credits",
  signupUrl: "https://openrouter.ai/",
};
export const OPENROUTER_HEADERS: Record<string, string> = { "HTTP-Referer": "https://github.com/smokersklubs-dot/grok-sklubs", "X-OpenRouter-Title": "Sklubot" };

/** The base URL (OPENROUTER_BASE_URL only for tests with a fake OpenRouter). */
export const openRouterBase = () => (process.env.OPENROUTER_BASE_URL || OPENROUTER_PRESET.baseUrl).replace(/\/+$/, "");
export const isOpenRouterUrl = (base: string) => base.replace(/\/+$/, "") === openRouterBase();

export interface OpenRouterModel { id: string; name: string; contextWindow: number | null; input: number; output: number; cached: number | null; images: boolean; free: boolean; created: number }
export interface OpenRouterCatalog { models: OpenRouterModel[]; recommended: string[]; fetchedAt: number }

const CACHE_MS = 6 * 3_600_000;
let cache: OpenRouterCatalog | null = null;
let loading: Promise<OpenRouterCatalog> | null = null;

/** USD per token (a string) → USD per million tokens; null when absent, negative (a dynamic router) or unreadable. */
const perMillion = (v: unknown): number | null => {
  if (v === undefined || v === null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 1e6 * 1e6) / 1e6 : null;
};
const ID = /^[A-Za-z0-9._:/@+-]{1,100}$/;

/** Keeps the models a bot can work with: tools supported, a chat endpoint, a fixed price (no router, no batch-only variant). */
export function mapCatalog(raw: unknown): OpenRouterModel[] {
  const list = Array.isArray((raw as { data?: unknown })?.data) ? (raw as { data: any[] }).data : [];
  const out: OpenRouterModel[] = [];
  for (const m of list) {
    const id = typeof m?.id === "string" ? m.id : "";
    if (!ID.test(id) || id.endsWith(":batch") || id.startsWith("~")) continue;
    if (!Array.isArray(m.supported_parameters) || !m.supported_parameters.includes("tools")) continue;
    if (Array.isArray(m.endpoints) && !m.endpoints.includes("/api/v1/chat/completions")) continue;
    const input = perMillion(m.pricing?.prompt), output = perMillion(m.pricing?.completion);
    if (input === null || output === null) continue;
    const ctx = Number(m.context_length);
    const mods = m.architecture?.input_modalities;
    out.push({
      id, name: typeof m.name === "string" ? m.name.slice(0, 120) : id,
      contextWindow: Number.isInteger(ctx) && ctx > 0 ? ctx : null, input, output, cached: perMillion(m.pricing?.input_cache_read),
      images: Array.isArray(mods) && mods.includes("image"), free: input === 0 && output === 0, created: Number(m.created) || 0,
    });
  }
  return out;
}

/**
 * The short "Recommandés" list: cheap and good for agents, one per family, the newest model of the family that is in the
 * live catalog (a family with none is skipped). Families: a DeepSeek flash/chat model, a Gemini Flash, a Mistral Small,
 * Claude Sonnet, a Qwen and a Llama.
 */
const FAMILIES = [
  /^deepseek\/deepseek-(?:v[\d.]+-flash|chat(?:-v[\d.]+)?)$/,
  /^google\/gemini-[\d.]+-flash$/,
  /^mistralai\/mistral-small(?:-[\d.]+)?(?:-\d+b)?(?:-instruct)?(?:-\d{4})?$/,
  /^anthropic\/claude-sonnet-[\d.]+$/,
  /^qwen\/qwen[\d.]+-(?:flash|plus)$/,
  /^meta-llama\/llama-[\d.]+-(?:maverick|70b-instruct)$/,
];
export function recommendedOf(models: OpenRouterModel[]): string[] {
  const out: string[] = [];
  for (const re of FAMILIES) {
    const best = models.filter((m) => re.test(m.id) && !m.free).sort((a, b) => b.created - a.created)[0];
    if (best) out.push(best.id);
  }
  return out;
}

/** The catalog, read at most every 6 hours (server-side, through the outbound guard); a stale copy if a refresh fails. */
export async function openRouterCatalog(): Promise<OpenRouterCatalog> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache;
  loading ??= (async () => {
    try {
      const res = await guardedFetch(`${openRouterBase()}/models?supported_parameters=tools`, { headers: { ...OPENROUTER_HEADERS }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) { await res.body?.cancel().catch(() => {}); throw new Error(`OpenRouter answered ${res.status}.`); }
      const models = mapCatalog(await res.json());
      if (!models.length) throw new Error("OpenRouter sent no model list.");
      models.sort((a, b) => a.name.localeCompare(b.name));
      cache = { models, recommended: recommendedOf(models), fetchedAt: Date.now() };
      return cache;
    } catch (err) {
      if (cache) return cache;
      throw new Error(fetchProblem(err) ?? String((err as Error)?.message ?? err));
    } finally { loading = null; }
  })();
  return loading;
}
/** For tests: forget the cached catalog. */
export const resetOpenRouterCatalog = () => { cache = null; loading = null; };

/** The chosen model ids, with their prices and context taken from the catalog (never from the browser). */
export function modelsFromCatalog(ids: unknown, catalog: OpenRouterCatalog, max = 30): ApiProviderModel[] {
  const want = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const out: ApiProviderModel[] = [];
  for (const id of want) {
    const m = catalog.models.find((x) => x.id === id);
    if (!m || out.some((x) => x.id === id)) continue;
    out.push({ id, contextWindow: m.contextWindow, input: m.input, output: m.output, cached: m.cached, images: m.images });
    if (out.length >= max) break;
  }
  return out;
}

/** "Tester": GET /key with the key (no tokens used). */
export async function testOpenRouterKey(key: string): Promise<{ ok: boolean; detail: string; remainingUsd?: number | null }> {
  try {
    const res = await guardedFetch(`${openRouterBase()}/key`, { headers: { authorization: `Bearer ${key}`, ...OPENROUTER_HEADERS }, signal: AbortSignal.timeout(15_000) });
    const j = (await res.json().catch(() => null)) as { data?: { limit_remaining?: unknown } } | null;
    if (res.status === 401 || res.status === 403) return { ok: false, detail: "OpenRouter refused this key." };
    if (!res.ok) return { ok: false, detail: `OpenRouter answered ${res.status}.` };
    const left = j?.data?.limit_remaining;
    return { ok: true, detail: "The key works.", remainingUsd: typeof left === "number" ? left : null };
  } catch (err) {
    return { ok: false, detail: fetchProblem(err) ?? String((err as Error)?.message ?? err).slice(0, 200) };
  }
}

const TEXT: LocaleTexts<{ credit: string; wait: string }> = {
  fr: { credit: "Ton crédit OpenRouter est épuisé (ou la limite de ta clé est atteinte) : recharge sur openrouter.ai (https://openrouter.ai/settings/credits), puis redemande.", wait: "OpenRouter limite les requêtes en cours sur ton crédit : nouvel essai dans un instant." },
  en: { credit: "Your OpenRouter credit is used up (or your key's limit is reached): top up on openrouter.ai (https://openrouter.ai/settings/credits), then ask again.", wait: "OpenRouter is limiting the requests running on your credit: trying again in a moment." },
  es: { credit: "Tu crédito de OpenRouter se ha agotado (o se ha alcanzado el límite de tu clave): recárgalo en openrouter.ai (https://openrouter.ai/settings/credits) y vuelve a pedirlo.", wait: "OpenRouter está limitando las solicitudes en curso con tu crédito: lo intento de nuevo en un momento." },
  de: { credit: "Dein OpenRouter-Guthaben ist aufgebraucht (oder das Limit deines Schlüssels ist erreicht): Lade es auf openrouter.ai auf (https://openrouter.ai/settings/credits) und frag dann noch einmal.", wait: "OpenRouter begrenzt die laufenden Anfragen auf deinem Guthaben: neuer Versuch gleich." },
  it: { credit: "Il tuo credito OpenRouter è esaurito (o è stato raggiunto il limite della tua chiave): ricaricalo su openrouter.ai (https://openrouter.ai/settings/credits), poi chiedi di nuovo.", wait: "OpenRouter sta limitando le richieste in corso sul tuo credito: nuovo tentativo tra un momento." },
  pt: { credit: "Seu crédito do OpenRouter acabou (ou o limite da sua chave foi atingido): recarregue em openrouter.ai (https://openrouter.ai/settings/credits) e peça de novo.", wait: "O OpenRouter está limitando os pedidos em andamento no seu crédito: nova tentativa daqui a pouco." },
  zh: { credit: "你的 OpenRouter 额度已用完（或已达到密钥上限）：请在 openrouter.ai（https://openrouter.ai/settings/credits）充值，然后再问一次。", wait: "OpenRouter 正在限制使用你额度的进行中请求：稍后重试。" },
};
export const outOfCreditText = (loc: Locale) => byLocale(loc, TEXT).credit;

/** Owners already told (one notice per owner every 6 hours). */
const told = new Map<string, number>();
/** The key's owner hears of it on their main bot, with a link to Settings → Models. */
export function noteOutOfCredit(ownerId: string) {
  const last = told.get(ownerId) ?? 0;
  if (Date.now() - last < CACHE_MS) return;
  told.set(ownerId, Date.now());
  const main = bots.primary(ownerId);
  if (main) rows.append(main, { kind: "notice", tone: "warn", text: outOfCreditText(users.localeOf(ownerId)), action: { kind: "settings", section: "models" } });
  audit(ownerId, "system", "OpenRouter: credit used up (402)");
}
export const resetOutOfCreditNotices = () => told.clear();

/**
 * A failed OpenRouter call (apimodels.ts passes this to the provider): 402 with the in-flight budget and a Retry-After is
 * worth another try; any other 402 is the owner's credit, told once on their main bot, with a clear message.
 */
export function openRouterError(ownerId: string, status: number, detail: string, retryAfterMs: number | null): ProviderError | null {
  if (status !== 402) return null;
  const loc = users.localeOf(ownerId);
  if (/openrouter_in_flight_budget/.test(detail) && retryAfterMs !== null) return new ProviderError(byLocale(loc, TEXT).wait, { status, transient: true, retryAfterMs });
  noteOutOfCredit(ownerId);
  return new ProviderError(byLocale(loc, TEXT).credit, { status, transient: false, code: "out_of_credit" });
}
