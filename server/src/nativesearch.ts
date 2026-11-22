import { hostedMode, operatorPaid } from "./hosted.js";
import { defaultModelRef, listProviders, userProvidersOf, type LlmProvider } from "./llm/index.js";
import { ProviderFailure, type WebHit } from "./providers.js";
import { clip, rowScope } from "./store.js";
import type { BotRecord } from "./store.js";
import { record } from "./usage.js";

/**
 * Web search through the bot's OWN model provider, with that provider's own key, before search_web says "no search is
 * set up" (audit DS-Bot #146, À faire n° 2). Only documented search features of the provider, on its own address:
 *  - DeepSeek Search API: POST https://api.deepseek.com/v1/tools/search, Bearer key, body { query (1–128 characters),
 *    count (1–50), need_content }, answer { results: [{ title, url, snippet, summary, date… }] }
 *    (https://api-docs.deepseek.com/guides/search, read 2026-11-22). No model call.
 *  - OpenAI Responses `web_search` tool: POST {base}/responses with tools [{ type: "web_search" }]; sources in
 *    web_search_call.action.sources (with include ["web_search_call.action.sources"]) and url_citation annotations
 *    (https://developers.openai.com/api/docs/guides/tools-web-search, read 2026-11-22). xAI serves the same tool on
 *    https://api.x.ai/v1/responses (https://docs.x.ai/docs/guides/tools/search-tools).
 *  - OpenRouter web plugin: plugins [{ id: "web" }] on a chat completion; citations as url_citation annotations on the
 *    message (https://openrouter.ai/docs/guides/features/plugins/web-search, read 2026-11-22).
 * Nothing else: no scraping of results pages (DS-Bot's keyless Bing / DuckDuckGo fallback is NOT ported), no guessing
 * an endpoint on a host that documents none. Never another route's key: each key bills its own account. Hosted mode: a
 * provider the operator pays for is never used for this (only the account's own providers).
 *
 * Portions adapted from Fei2411/DS-Bot (https://github.com/Fei2411/DS-Bot, commit d104d9ca18d69a35460f14e15dff4d553181433a),
 * ds-bot/web-search.js (readResponses, sourceOf, dedupe, the DeepSeek entry of SEARCH_APIS, the skip-after-refusal
 * idea), Copyright 2026 Fei2411 and the DS Bot contributors, Apache License 2.0; modified for Sklubot: TypeScript, only
 * the three documented features above, keys used inside the provider object (postOwn), Sklubot's provider chain.
 */

/** A provider whose own documented search can be called (OpenAiCompatProvider). */
interface OwnPoster extends LlmProvider { postOwn(path: string, body: unknown, signal?: AbortSignal): Promise<Response>; baseUrl: string }
const canPost = (p: LlmProvider | undefined): p is OwnPoster => !!p && typeof (p as Partial<OwnPoster>).postOwn === "function" && typeof (p as Partial<OwnPoster>).baseUrl === "string";

export type NativeKind = "deepseek" | "responses" | "openrouter";
const hostOf = (u: string) => { try { return new URL(u).hostname.toLowerCase(); } catch { return ""; } };
/** Which documented search a provider's address offers (null: none we know of). */
export function nativeKindOf(baseUrl: string): NativeKind | null {
  const h = hostOf(baseUrl);
  if (h === "api.deepseek.com") return "deepseek";
  if (h === "api.openai.com" || h === "api.x.ai") return "responses";
  if (h === "openrouter.ai") return "openrouter";
  return null;
}

/** The bot's own provider and model, when it offers a documented search this account may use. */
export function nativeRoute(bot: Pick<BotRecord, "model" | "userId">): { provider: OwnPoster; model: string; kind: NativeKind } | null {
  const ref = bot.model || defaultModelRef();
  const sep = ref.indexOf(":");
  if (sep <= 0) return null;
  const id = ref.slice(0, sep), model = ref.slice(sep + 1);
  const p = id.startsWith("up-") ? userProvidersOf(bot.userId).find((x) => x.id === id) : listProviders().find((x) => x.id === id);
  if (!canPost(p) || !p.available()) return null;
  if (hostedMode() && operatorPaid(bot.userId, p.id)) return null;
  const kind = nativeKindOf(p.baseUrl);
  return kind ? { provider: p, model, kind } : null;
}

const SKIP_MS = 30 * 60_000;
const skipped = new Map<string, number>();
export const resetNativeSkips = () => skipped.clear();

const http = (u: unknown) => { if (typeof u !== "string") return null; try { const x = new URL(u); return x.protocol === "http:" || x.protocol === "https:" ? x.href : null; } catch { return null; } };
const plain = (v: unknown) => (typeof v === "string" ? v.replace(/\s+/g, " ").trim() : "");
function dedupe(hits: (WebHit | null)[]): WebHit[] {
  const seen = new Map<string, WebHit>();
  for (const h of hits) if (h && !seen.has(h.url)) seen.set(h.url, h);
  return [...seen.values()];
}
const hit = (url: unknown, title?: unknown, snippet?: unknown): WebHit | null => { const u = http(url); return u ? { url: u, title: clip(plain(title) || u, 300), snippet: clip(plain(snippet), 500) } : null; };

/** DeepSeek Search API answer. */
export const readDeepSeek = (body: any): WebHit[] => dedupe((Array.isArray(body?.results) ? body.results : []).map((r: any) => hit(r?.url, r?.title, r?.summary || r?.snippet)));
/** OpenAI Responses answer (DS-Bot readResponses). */
export function readResponses(body: any): WebHit[] {
  const out = Array.isArray(body?.output) ? body.output : [];
  const found: (WebHit | null)[] = [];
  for (const call of out.filter((i: any) => i?.type === "web_search_call")) for (const s of Array.isArray(call.action?.sources) ? call.action.sources : []) found.push(hit(s?.url, s?.title));
  for (const item of out) if (item?.type === "message" && Array.isArray(item.content))
    for (const part of item.content) for (const n of Array.isArray(part?.annotations) ? part.annotations : []) if (n?.type === "url_citation") found.push(hit(n.url, n.title));
  return dedupe(found);
}
/** OpenRouter chat completion with the web plugin: url_citation annotations on the message. */
export const readOpenRouter = (body: any): WebHit[] => dedupe((body?.choices?.[0]?.message?.annotations ?? []).filter((n: any) => n?.type === "url_citation").map((n: any) => hit(n.url_citation?.url, n.url_citation?.title, n.url_citation?.content)));

/** One search through the bot's own provider. Throws a ProviderFailure the chain understands. */
export async function nativeSearch(bot: BotRecord, query: string, signal?: AbortSignal): Promise<WebHit[]> {
  const route = nativeRoute(bot);
  if (!route) throw new ProviderFailure("the bot's model offers no documented web search");
  const key = `${route.provider.id}:${route.kind}`;
  if ((skipped.get(key) ?? 0) > Date.now()) throw new ProviderFailure("its search was refused recently; not tried again yet");
  const sig = signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000);
  const prompt = `Perform a web search for the query: ${query}`;
  const [path, body] = route.kind === "deepseek"
    ? ["/v1/tools/search", { query: [...query].slice(0, 128).join(""), count: 8, need_content: false }]
    : route.kind === "responses"
      ? ["responses", { model: route.model, input: prompt, tools: [{ type: "web_search" }], include: ["web_search_call.action.sources"], max_output_tokens: 1024 }]
      : ["chat/completions", { model: route.model, messages: [{ role: "user", content: prompt }], plugins: [{ id: "web", max_results: 8 }], max_tokens: 512, stream: false }];
  const res = await route.provider.postOwn(path, body, sig);
  if (!res.ok) {
    const detail = (await res.text().catch(() => "")).slice(0, 160);
    if ([401, 402, 403, 404, 405, 501].includes(res.status)) skipped.set(key, Date.now() + SKIP_MS);
    throw new ProviderFailure(`${route.provider.label} answered ${res.status}${detail ? `: ${detail}` : ""}`, res.status === 400 || res.status === 422);
  }
  const json = (await res.json().catch(() => null)) as any;
  // What the call cost in tokens goes on the bot's usage like any model call (the DeepSeek Search API reports none).
  const u = json?.usage;
  const botId = rowScope.getStore()?.botId ?? bot.id;
  if (u && route.kind !== "deepseek") record(bot.userId, botId, route.model, { inputTokens: Number(u.input_tokens ?? u.prompt_tokens) || 0, outputTokens: Number(u.output_tokens ?? u.completion_tokens) || 0, cachedTokens: 0, ...(typeof u.cost === "number" ? { costUsd: u.cost } : {}) });
  return route.kind === "deepseek" ? readDeepSeek(json) : route.kind === "responses" ? readResponses(json) : readOpenRouter(json);
}

/** The step line's name for it ("served by DeepSeek (its own search)"). */
export const nativeLabel = (bot: Pick<BotRecord, "model" | "userId">) => { const r = nativeRoute(bot); return r ? `${r.provider.label} (recherche du modèle)` : "Recherche du modèle"; };
