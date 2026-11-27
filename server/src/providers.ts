import { connectors } from "./connectors.js";
import { computerKind, workspaceOf } from "./computer.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { linuxExec } from "./linux.js";
import { nativeRoute, nativeSearch } from "./nativesearch.js";
import { guardedFetch } from "./net.js";
import { reachAvailable, reachSubtitles, reachWebSearch } from "./reach.js";
import { unseal } from "./auth.js";
import type { Connector, Locale, ProviderAttempt } from "./shared.js";
import { bots, clip, now, vault, type BotRecord } from "./store.js";
import { idemKeyOf, release, reserve, settle } from "./thirdparty.js";
import { sttFor, voiceSettings } from "./voice/providers.js";

/**
 * Wave 7 (spec 08 A3) — one task, several ways to do it. For a capability with several providers, Sklubot tries them in
 * an announced order — what the user already owns (their keys and subscriptions, never billed on top), then the free
 * ones, then the paid ones from the cheapest — moves on when one fails (provider error, outage) or finds nothing, stops
 * when the request itself is wrong (the next would fail too), tries at most two more after the first, never goes past
 * the per-call cost cap, and says who answered, what was tried and what it cost ("served by / tried").
 *
 * Never a silent switch to paid: a paid provider runs only for a bot the user allowed it for (asked once per bot and
 * capability, then remembered in paid_consents); otherwise the chain stops and says so, and the bot can ask
 * (allow_paid: true raises an approval card that announces the cost). A paid step reserves its cost before the call and
 * settles the real cost after (thirdparty.ts, A4); a paid provider without a known price is never run without that yes.
 */

export type Tier = "owned" | "free" | "paid";
export class ProviderFailure extends Error {
  /** The request itself is wrong (bad parameter): the next provider would fail too, so the chain stops. */
  final: boolean;
  constructor(message: string, final = false) { super(message); this.final = final; }
}
export interface ChainCtx { bot: BotRecord; signal?: AbortSignal }
export interface Provider<A, R> {
  id: string; label: string; tier: Tier;
  /** Estimated cost of one call in USD: 0 for owned and free, null when unknown (then the user is always asked first). */
  estimateUsd: (args: A) => number | null;
  available: (ctx: ChainCtx) => boolean;
  run: (args: A, ctx: ChainCtx) => Promise<R>;
  empty: (r: R) => boolean;
  /** The real cost, when the provider reports it (else the estimate is settled). */
  actualUsd?: (r: R) => number | null;
  /** Bills failed calls too (none of ours does). */
  billsFailures?: boolean;
}
export interface ChainOptions { maxCostUsd?: number; prefer?: string; exclude?: string[]; allowPaid?: boolean }
export interface ChainOutcome<R> { result: R | null; servedBy: string | null; attempts: ProviderAttempt[]; costUsd: number; needsConsent: { provider: string; label: string; estimateUsd: number | null } | null; refusal: string | null }

const TIER_ORDER: Record<Tier, number> = { owned: 0, free: 1, paid: 2 };
export const MAX_EXTRA = 2;
export const DEFAULT_MAX_COST_USD = 1;

export const paidConsents = {
  has: (botId: string, capability: string, provider: string) => !!q.get("SELECT 1 FROM paid_consents WHERE bot_id = ? AND capability = ? AND provider = ?", botId, capability, provider),
  add: (botId: string, capability: string, provider: string) => q.run("INSERT OR IGNORE INTO paid_consents (bot_id, capability, provider, created_at) VALUES (?, ?, ?, ?)", botId, capability, provider, now()),
  list: (botId: string) => q.all<{ capability: string; provider: string }>("SELECT capability, provider FROM paid_consents WHERE bot_id = ?", botId),
  clear: (botId: string) => q.run("DELETE FROM paid_consents WHERE bot_id = ?", botId),
};

/** The order a chain tries its providers in (exported for the tests and the "servi par" line). */
export function orderProviders<A, R>(list: Provider<A, R>[], args: A, opts: ChainOptions = {}): Provider<A, R>[] {
  const out = list.filter((p) => !(opts.exclude ?? []).includes(p.id)).sort((a, b) => {
    const t = TIER_ORDER[a.tier] - TIER_ORDER[b.tier];
    if (t) return t;
    const ea = a.estimateUsd(args), eb = b.estimateUsd(args);
    return (ea ?? Number.POSITIVE_INFINITY) - (eb ?? Number.POSITIVE_INFINITY);
  });
  if (opts.prefer) { const i = out.findIndex((p) => p.id === opts.prefer); if (i > 0) out.unshift(...out.splice(i, 1)); }
  return out;
}

export async function runChain<A, R>(capability: string, list: Provider<A, R>[], args: A, ctx: ChainCtx, opts: ChainOptions = {}): Promise<ChainOutcome<R>> {
  const attempts: ProviderAttempt[] = [];
  const cap = opts.maxCostUsd ?? DEFAULT_MAX_COST_USD;
  let cost = 0, ran = 0;
  const out = (result: R | null, servedBy: string | null, extra: Partial<ChainOutcome<R>> = {}): ChainOutcome<R> => ({ result, servedBy, attempts, costUsd: cost, needsConsent: null, refusal: null, ...extra });
  for (const p of orderProviders(list, args, opts)) {
    if (!p.available(ctx)) { attempts.push({ provider: p.label, tier: p.tier, outcome: "skipped", detail: "not set up", costUsd: 0 }); continue; }
    if (ran > MAX_EXTRA) break;
    const estimate = p.tier === "paid" ? p.estimateUsd(args) : 0;
    if (p.tier === "paid") {
      if (estimate !== null && cost + estimate > cap) { attempts.push({ provider: p.label, tier: p.tier, outcome: "too_expensive", detail: `about ${estimate.toFixed(2)} $, over the ${cap.toFixed(2)} $ cap`, costUsd: 0 }); continue; }
      if (!paidConsents.has(ctx.bot.id, capability, p.id)) {
        if (!opts.allowPaid) { attempts.push({ provider: p.label, tier: p.tier, outcome: "needs_consent", detail: estimate === null ? "paid, price unknown" : `paid, about ${estimate.toFixed(2)} $`, costUsd: 0 }); return out(null, null, { needsConsent: { provider: p.id, label: p.label, estimateUsd: estimate } }); }
        paidConsents.add(ctx.bot.id, capability, p.id);
      }
    }
    ran++;
    let reservation: string | null = null;
    if (p.tier === "paid") {
      const r = reserve({ userId: ctx.bot.userId, botId: ctx.bot.id, tool: capability, provider: p.id, maxUsd: estimate ?? cap - cost, idemKey: idemKeyOf(ctx.bot.id, capability, p.id, args) });
      if (r.kind === "refused") { attempts.push({ provider: p.label, tier: p.tier, outcome: "too_expensive", detail: r.reason === "daily_cap" ? "daily cap reached" : r.reason === "usage_cap" ? "usage cap reached" : "monthly budget reached", costUsd: 0 }); return out(null, null, { refusal: r.message }); }
      if (r.kind === "busy") { attempts.push({ provider: p.label, tier: p.tier, outcome: "error", detail: "the same request is still running", costUsd: 0 }); return out(null, null); }
      if (r.kind === "replay") { attempts.push({ provider: p.label, tier: p.tier, outcome: "served", detail: "same request: earlier result, not charged again", costUsd: 0 }); return out(JSON.parse(r.result) as R, p.label); }
      reservation = r.id;
    }
    try {
      const result = await p.run(args, ctx);
      if (p.empty(result)) {
        if (reservation) settle(reservation, p.actualUsd?.(result) ?? estimate ?? 0, JSON.stringify(result));
        const paid = reservation ? p.actualUsd?.(result) ?? estimate ?? 0 : 0;
        cost += paid;
        attempts.push({ provider: p.label, tier: p.tier, outcome: "empty", detail: "nothing found", costUsd: paid });
        continue;
      }
      const paid = reservation ? p.actualUsd?.(result) ?? estimate ?? 0 : 0;
      if (reservation) settle(reservation, paid, JSON.stringify(result));
      cost += paid;
      attempts.push({ provider: p.label, tier: p.tier, outcome: "served", detail: "", costUsd: paid });
      return out(result, p.label);
    } catch (err) {
      if (reservation) { if (p.billsFailures) settle(reservation, estimate ?? 0, "null"); else release(reservation); }
      if (ctx.signal?.aborted) throw err;
      const final = err instanceof ProviderFailure ? err.final : !!(err as { final?: boolean })?.final;
      attempts.push({ provider: p.label, tier: p.tier, outcome: "error", detail: clip(String((err as Error)?.message ?? err), 160), costUsd: 0 });
      if (final) return out(null, null);
    }
  }
  return out(null, null);
}

/** "servi par SearXNG · essayé : Brave (vide), Agent Reach (erreur) · 0,00 $" — for the step line and the model. */
export function servedLine(loc: Locale | undefined, o: Pick<ChainOutcome<unknown>, "servedBy" | "attempts" | "costUsd">): string {
  const word: Record<ProviderAttempt["outcome"], string> = { served: "served", empty: "empty", error: "error", skipped: "not set up", too_expensive: "too expensive", needs_consent: "paid: needs your yes" };
  const tried = o.attempts.filter((a) => a.outcome !== "served" && a.outcome !== "skipped").map((a) => `${a.provider} (${tr(loc, word[a.outcome])})`);
  return [o.servedBy ? tr(loc, "served by {who}", { who: o.servedBy }) : tr(loc, "nobody answered"), tried.length ? tr(loc, "tried: {list}", { list: tried.join(", ") }) : "", o.costUsd > 0 ? `${o.costUsd.toFixed(2)} $` : ""].filter(Boolean).join(" · ");
}
/** The same, in full, for the model. */
export function attemptsText(o: Pick<ChainOutcome<unknown>, "servedBy" | "attempts" | "costUsd">): string {
  const tried = o.attempts.filter((a) => a.outcome !== "skipped");
  const off = o.attempts.filter((a) => a.outcome === "skipped").map((a) => a.provider);
  return `[${o.servedBy ? `Served by ${o.servedBy}` : "No provider answered"}. Tried in order: ${tried.map((a) => `${a.provider} (${a.tier}) → ${a.outcome}${a.detail ? `: ${a.detail}` : ""}`).join("; ") || "none"}.${off.length ? ` Not set up: ${off.join(", ")}.` : ""} Cost: ${o.costUsd.toFixed(2)} $.]`;
}

// ── Web search ──────────────────────────────────────────────────────────────
export interface WebHit { title: string; url: string; snippet: string }
interface SearchArgs { query: string }
const braveBase = () => (process.env.BRAVE_API_URL ?? "https://api.search.brave.com").replace(/\/$/, "");
/** Brave Search API: GET /res/v1/web/search?q=… with the X-Subscription-Token header (https://api-dashboard.search.brave.com/app/documentation/web-search/get-started). */
async function brave(query: string, token: string, signal?: AbortSignal): Promise<WebHit[]> {
  const res = await guardedFetch(`${braveBase()}/res/v1/web/search?q=${encodeURIComponent(query)}&count=8`, { headers: { accept: "application/json", "x-subscription-token": token }, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
  if (res.status === 422 || res.status === 400) throw new ProviderFailure(`Brave refused the query (${res.status})`, true);
  if (!res.ok) throw new ProviderFailure(`Brave answered ${res.status}`);
  const data = (await res.json()) as { web?: { results?: { title?: string; url?: string; description?: string }[] } };
  return (data.web?.results ?? []).filter((r) => r.url).map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: (r.description ?? "").replace(/<[^>]+>/g, "") }));
}
/** The user's own Brave key, saved in the vault and bound to the Brave API host. */
function braveVaultKey(userId: string): string | null {
  const host = (() => { try { return new URL(braveBase()).hostname; } catch { return "api.search.brave.com"; } })();
  const item = vault.list(userId).find((i) => i.kind === "secret" && i.hosts.some((h) => host === h || host.endsWith(`.${h}`)) && i.passwordEnc);
  return item?.passwordEnc ? unseal(item.passwordEnc) : null;
}
/** A connected tool router called "treg" (an MCP connector), if the user added one: paid per call, price unknown here. */
export function tregConnector(userId: string): Connector | null {
  return connectors.list(userId).find((k) => /treg/i.test(k.name) && k.status === "ready" && k.tools.length > 0) ?? null;
}
const tregTool = (k: Connector, re: RegExp) => k.tools.find((t) => re.test(t.name))?.name ?? null;

export function searchProviders(): Provider<SearchArgs, WebHit[]>[] {
  const hits = (r: WebHit[]) => r.length === 0;
  return [
    { id: "brave-mine", label: "Brave (ta clé)", tier: "owned", estimateUsd: () => 0, available: (c) => !!braveVaultKey(c.bot.userId), run: (a, c) => brave(a.query, braveVaultKey(c.bot.userId)!, c.signal), empty: hits },
    { id: "brave", label: "Brave", tier: "owned", estimateUsd: () => 0, available: () => !!process.env.BRAVE_API_KEY, run: (a, c) => brave(a.query, process.env.BRAVE_API_KEY!, c.signal), empty: hits },
    // Audit DS-Bot #146: the documented search of the bot's own model provider, with its own key (nativesearch.ts).
    { id: "model-search", label: "Recherche du modèle du bot", tier: "owned", estimateUsd: () => 0, available: (c) => !!nativeRoute(c.bot) && !c.bot.disabledTools.includes("web"), run: (a, c) => nativeSearch(c.bot, a.query, c.signal), empty: hits },
    {
      id: "searxng", label: "SearXNG", tier: "free", estimateUsd: () => 0, available: () => !!process.env.SEARXNG_URL, empty: hits,
      run: async (a, c) => {
        // SearXNG's JSON API: GET /search?q=…&format=json (https://docs.searxng.org/dev/search_api.html).
        const res = await guardedFetch(`${process.env.SEARXNG_URL!.replace(/\/$/, "")}/search?q=${encodeURIComponent(a.query)}&format=json`, { headers: { accept: "application/json" }, signal: c.signal ? AbortSignal.any([c.signal, AbortSignal.timeout(20_000)]) : AbortSignal.timeout(20_000) });
        if (!res.ok) throw new ProviderFailure(`SearXNG answered ${res.status}`);
        const data = (await res.json()) as { results?: { title?: string; url?: string; content?: string }[] };
        return (data.results ?? []).filter((r) => r.url).slice(0, 8).map((r) => ({ title: r.title ?? r.url!, url: r.url!, snippet: r.content ?? "" }));
      },
    },
    { id: "agent-reach", label: "Agent Reach", tier: "free", estimateUsd: () => 0, available: (c) => reachAvailable() && !c.bot.disabledTools.includes("reach"), run: (a, c) => reachWebSearch(c.bot, a.query, c.signal), empty: hits },
    {
      id: "treg", label: "Treg", tier: "paid", estimateUsd: () => null, empty: hits,
      available: (c) => { const k = tregConnector(c.bot.userId); return !!k && !!tregTool(k, /search/i) && !c.bot.disabledTools.includes("apps"); },
      run: async (a, c) => {
        const k = tregConnector(c.bot.userId)!;
        const r = await connectors.call(k.id, tregTool(k, /search/i)!, { query: a.query });
        if (r.isError) throw new ProviderFailure(clip(r.text, 200));
        return [...r.text.matchAll(/https?:\/\/[^\s"'<>)]+/g)].slice(0, 8).map((m) => ({ title: m[0], url: m[0], snippet: clip(r.text, 300) }));
      },
    },
  ];
}
export const searchChainAvailable = () => !!(process.env.BRAVE_API_KEY || process.env.SEARXNG_URL) || reachAvailable();

// ── Transcription ───────────────────────────────────────────────────────────
interface TranscribeArgs { url: string; lang?: string }
const isYouTube = (u: string) => { try { return /(^|\.)youtube\.com$|(^|\.)youtu\.be$/.test(new URL(u).hostname); } catch { return false; } };
/** The audio of a video, as 16 kHz mono WAV, fetched on the bot's own computer (yt-dlp from Agent Reach, then ffmpeg). */
async function audioOf(bot: BotRecord, url: string, signal?: AbortSignal): Promise<Buffer> {
  // The address is passed as "$1", never written into the script.
  const script = 'set -o pipefail; Y=$(ls /opt/agent-reach/tools/*/bin/yt-dlp 2>/dev/null | head -1); "${Y:-yt-dlp}" -q -f bestaudio -o - -- "$1" | ffmpeg -loglevel error -i pipe:0 -t 1800 -ar 16000 -ac 1 -f wav pipe:1';
  const r = await linuxExec(bot.id, bot.userId, workspaceOf(bot.id), ["bash", "-c", script, "audio", url], 600, { signal, maxBytes: 80_000_000 });
  if (r.code !== 0 || r.raw.length < 1000) throw new ProviderFailure(/confirm you|not a bot/i.test(r.stderr) ? "YouTube blocks this server" : `could not get the audio: ${clip(r.stderr.trim(), 160)}`);
  return r.raw;
}
export function transcribeProviders(): Provider<TranscribeArgs, string>[] {
  const nothing = (t: string) => !t.trim();
  const sttKind = (userId: string) => voiceSettings(userId).stt.provider;
  return [
    { id: "subtitles", label: "Sous-titres (Agent Reach)", tier: "free", estimateUsd: () => 0, empty: nothing, available: (c) => reachAvailable() && !c.bot.disabledTools.includes("reach"), run: async (a, c) => { if (!isYouTube(a.url)) throw new ProviderFailure("subtitles are read for YouTube addresses only"); return (await reachSubtitles(c.bot, a.url, a.lang, c.signal)).text; } },
    {
      id: "whisper", label: "Whisper (ton serveur)", tier: "owned", estimateUsd: () => 0, empty: nothing,
      available: (c) => computerKind() === "linux" && sttKind(c.bot.userId) === "whisper-cpp" && !!sttFor(c.bot.userId),
      run: async (a, c) => sttFor(c.bot.userId, a.lang)!(await audioOf(c.bot, a.url, c.signal), c.signal ?? AbortSignal.timeout(600_000)),
    },
    {
      id: "openai-stt", label: "OpenAI (transcription)", tier: "paid", empty: nothing,
      // Priced per minute of audio by OpenAI; the length is not known before downloading, so no estimate: the user is asked.
      estimateUsd: () => null,
      available: (c) => computerKind() === "linux" && sttKind(c.bot.userId) === "openai" && !!sttFor(c.bot.userId),
      run: async (a, c) => sttFor(c.bot.userId, a.lang)!(await audioOf(c.bot, a.url, c.signal), c.signal ?? AbortSignal.timeout(600_000)),
    },
  ];
}

/**
 * The approval card for a chain call with allow_paid: true, when the next paid provider has no yes for this bot yet.
 * It announces the provider and its estimated cost (or that the price is unknown); "Always" is not needed — a yes is
 * remembered for this bot and capability (paid_consents).
 */
export function paidGate<A, R>(capability: string, label: string, list: Provider<A, R>[], args: A, botId: string, allowPaid: boolean) {
  if (!allowPaid) return null;
  const bot = bots.byId(botId);
  if (!bot) return null;
  const next = orderProviders(list, args).find((p) => p.tier === "paid" && p.available({ bot }) && !paidConsents.has(botId, capability, p.id));
  if (!next) return null;
  const est = next.estimateUsd(args);
  return {
    key: `paid: ${capability}: ${bot.name}`, once: true, source: "Paid provider",
    title: `Allow {bot} to use {provider} (paid) for ${label}?`, reason: "use a paid provider",
    vars: { provider: next.label, what: label, cost: est === null ? "" : est.toFixed(2) },
    note: est === null ? "The price of one call is not known in advance. The free ways found nothing. Your yes is remembered for this bot." : "Estimated cost: {cost} $ per call, reserved before the call and settled at the real cost. The free ways found nothing. Your yes is remembered for this bot.",
  };
}
