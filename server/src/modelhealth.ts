import type { Context, Hono } from "hono";
import { getLive, setLive } from "./bus.js";
import { tr } from "./i18n.js";
import { defaultModelRef, modelLabel, ProviderError, resolveModel } from "./llm/index.js";
import { callHooks } from "./llm/timeouts.js";
import { bots, clip, rowScope, users, type BotRecord, type UserRecord } from "./store.js";

/**
 * Model health (nod items 3 and 4, L59, L60). A tiny real request to a model tells, before anyone sends a message,
 * whether it answers: done when a model is chosen (the web asks right after saving), at start-up for the models the
 * bots use, and by the first-run guide before it finishes. A refused key (HTTP 401/403) reads "à reconnecter", with the
 * settings page that fixes it; the reason shows above the composer. Results are kept a few minutes per account and model
 * (never shared between accounts: a user's own providers are resolved with their own id, as everywhere).
 *
 * Also here: the chat's "en attente du modèle" line, set when a turn's model call has been silent for a minute
 * (llm/timeouts.ts callHooks), and a refused key seen during a real turn, recorded as "à reconnecter" at once.
 *
 *  GET  /bots/:id/model-health[?fresh=1]   the bot's model (cached unless fresh)
 *  POST /models/check { ref? , botId? }    one model, checked now (the model picker, the first-run guide)
 */
export type HealthStatus = "ok" | "reconnect" | "no_credit" | "down" | "none" | "skipped";
/** `fix`: the page that repairs it — "models" (Settings → Models), "subscription" (credits), "bot" (the bot's own model). */
export interface ModelHealth { ref: string; label: string; status: HealthStatus; reason: string | null; ms: number | null; checkedAt: number; fix: "models" | "subscription" | "bot" | null }

const OK_TTL = 10 * 60_000;
const BAD_TTL = 2 * 60_000;
const CHECK_TIMEOUT = 30_000;
const cache = new Map<string, ModelHealth>();
const flying = new Map<string, Promise<ModelHealth>>();
const keyOf = (userId: string, ref: string) => `${userId}\n${ref}`;
/** Subscription tools (Claude Code, Codex) run their own sign-in and limits (agent/engine.ts isEngineRef). */
const isEngine = (ref: string) => /^(claude-code|codex):/.test(ref);

/** What a failed call means for the person, in their language. */
export function classify(err: unknown, locale: UserRecord["locale"]): Pick<ModelHealth, "status" | "reason" | "fix"> {
  const msg = String((err as Error)?.message ?? err);
  const status = err instanceof ProviderError ? err.status : undefined;
  if (status === 401 || status === 403 || /rejected the credentials|invalid.{0,12}api.?key|unauthori[sz]ed|authentication/i.test(msg))
    return { status: "reconnect", reason: tr(locale, "The key or account for this model was refused: it needs reconnecting."), fix: "models" };
  if ((err instanceof ProviderError && err.code === "out_of_credit") || status === 402 || /insufficient|credit|quota exceeded|billing/i.test(msg))
    return { status: "no_credit", reason: tr(locale, "This model's account has no credit left."), fix: "subscription" };
  if (/No model provider is configured/i.test(msg)) return { status: "none", reason: tr(locale, "No model is set up yet."), fix: "models" };
  if (err instanceof ProviderError && err.code === "timeout") return { status: "down", reason: tr(locale, "The model did not answer in time."), fix: null };
  return { status: "down", reason: tr(locale, "The model is not answering: {detail}", { detail: clip(msg.replace(/\s+/g, " "), 160) }), fix: null };
}

/** Checks one model for one account now (one in flight per account and model). */
export function checkModel(user: UserRecord, ref: string): Promise<ModelHealth> {
  const key = keyOf(user.id, ref);
  const running = flying.get(key);
  if (running) return running;
  const job = (async (): Promise<ModelHealth> => {
    const label = modelLabel(ref, user.id);
    const base = { ref, label, checkedAt: Date.now() };
    if (isEngine(ref)) return { ...base, status: "skipped", reason: null, ms: null, fix: null };
    const started = Date.now();
    try {
      const { provider, model } = resolveModel(ref, user.id);
      await provider.runTurn({ model, system: "Health check. Reply with the single word OK.", tools: [], effort: "low", maxTokens: 32, messages: [{ role: "user", content: [{ type: "text", text: "ping" }] }], signal: AbortSignal.timeout(CHECK_TIMEOUT) });
      return { ...base, status: "ok", reason: null, ms: Date.now() - started, fix: null };
    } catch (err) {
      return { ...base, ...classify(err, user.locale), ms: null };
    }
  })().then((h) => { cache.set(key, h); if (h.status === "ok") replayKept(user.id); return h; }).finally(() => flying.delete(key));
  flying.set(key, job);
  return job;
}

/** L59 (agent/heldfirst.ts): a model answers for this account — messages kept while no model could be reached go out. */
function replayKept(userId: string) {
  void Promise.all([import("./agent/heldfirst.js"), import("./agent/loop.js")]).then(([h, l]) => { if (h.heldCount(userId)) h.replayHeld(userId, l.enqueue); }).catch((err) => console.error("[held messages]", err));
}

/** The last result, if still fresh. */
export function cachedHealth(userId: string, ref: string, now = Date.now()): ModelHealth | null {
  const h = cache.get(keyOf(userId, ref));
  return h && now - h.checkedAt < (h.status === "ok" ? OK_TTL : BAD_TTL) ? h : null;
}

export const botModelRef = (bot: BotRecord) => bot.model || defaultModelRef();

/** The health of a bot's model: the fresh result if there is one, else checked now. */
export async function botHealth(bot: BotRecord, user: UserRecord, fresh = false): Promise<ModelHealth> {
  const ref = botModelRef(bot);
  return (!fresh && cachedHealth(user.id, ref)) || checkModel(user, ref);
}

/** Forget what is known (tests, or after the user changed a key). */
export const resetModelHealth = () => { cache.clear(); flying.clear(); };

/** At start-up: each distinct model the bots use, per account, a few seconds apart (at most `max`). */
export async function checkAtStartup(max = 20, gapMs = 2000): Promise<number> {
  const seen = new Set<string>();
  let n = 0;
  for (const u of users.all()) for (const b of bots.list(u.id)) {
    if (b.kind !== "agent" || n >= max) continue;
    const ref = botModelRef(b);
    if (isEngine(ref) || seen.has(keyOf(u.id, ref))) continue;
    seen.add(keyOf(u.id, ref));
    n++;
    await checkModel(u, ref).catch(() => null);
    if (gapMs) await new Promise((r) => setTimeout(r, gapMs).unref?.());
  }
  return n;
}

/** The turn behind a model call, from the chat scope the turn runs in (store.ts rowScope). */
function scopedBot(): { bot: BotRecord; user: UserRecord } | null {
  const s = rowScope.getStore();
  const bot = s ? bots.byId(s.botId) : null;
  const user = bot ? users.byId(bot.userId) : null;
  return bot && user ? { bot, user } : null;
}

callHooks.slow = ({ label, model }) => {
  const at = scopedBot();
  if (!at) return;
  const { bot, user } = at;
  const line = tr(user.locale, "Waiting for the model ({model})…", { model: `${label} ${model}`.trim() });
  setLive(user.id, bot.id, { caption: line });
  return () => { if (getLive(bot.id).caption === line) setLive(user.id, bot.id, { caption: null }); };
};
callHooks.failed = ({ providerId, model }, err) => {
  const status = err instanceof ProviderError ? err.status : undefined;
  if (status !== 401 && status !== 403) return;
  const at = scopedBot();
  if (!at) return;
  const ref = botModelRef(at.bot);
  // The turn's own model (or the one named by provider and model): marked "à reconnecter" without waiting for a check.
  const refs = new Set([ref, `${providerId}:${model}`]);
  for (const r of refs) cache.set(keyOf(at.user.id, r), { ref: r, label: modelLabel(r, at.user.id), ...classify(err, at.user.locale), ms: null, checkedAt: Date.now() });
};

type Env = { Variables: { user: UserRecord } };
const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b : {}; };

export function registerModelHealthRoutes(api: Hono<Env>) {
  api.get("/bots/:id/model-health", async (c) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") return c.json({ error: "That bot does not exist." }, 404);
    return c.json({ health: await botHealth(bot, user, c.req.query("fresh") === "1") });
  });
  api.post("/models/check", async (c) => {
    const user = c.get("user");
    const body = await json(c);
    const bot = typeof body.botId === "string" ? bots.owned(user.id, body.botId) : null;
    if (typeof body.botId === "string" && !bot) return c.json({ error: "That bot does not exist." }, 404);
    const ref = typeof body.ref === "string" && body.ref.trim() ? body.ref.trim().slice(0, 200) : bot ? botModelRef(bot) : defaultModelRef();
    return c.json({ health: await checkModel(user, ref) });
  });
  // At start-up, in the background (never in tests or with MODEL_HEALTH_AT_START=0).
  if (!process.env.NO_SCHEDULER && process.env.MODEL_HEALTH_AT_START !== "0") setTimeout(() => { void checkAtStartup().catch(() => undefined); }, 15_000).unref?.();
}
