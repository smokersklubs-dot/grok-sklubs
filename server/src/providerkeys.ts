import { AsyncLocalStorage } from "node:async_hooks";
import { seal, unseal } from "./auth.js";
import { q } from "./db.js";
import { ProviderError, type LlmProvider, type TurnRequest, type TurnResult } from "./llm/types.js";
import { audit, bots, newId, now, rowScope } from "./store.js";

/**
 * L82 — several named keys per model provider (Settings → Models → a provider → « Clés »), a choice per bot, and the switch
 * to the next available key when one is refused or out of quota.
 *
 * What it covers: the account's OWN API providers (apimodels.ts, ids "up-…"), whose keys the account pasted itself — for
 * example a « Perso » and a « Travail » DeepSeek key, or two OpenRouter accounts of the same person or company. The key the
 * provider was created with is the key "main" (« Clé principale »); extra keys sit in `provider_keys`, sealed like it
 * (auth.ts seal, re-sealed by the data-key rotation like every *_enc column) and never sent back to the browser.
 *
 * What it never covers: a consumer subscription (ChatGPT, Claude: subscriptionconnect.ts). A subscription belongs to one
 * person, signed in on one bot's computer, and its terms forbid sharing it between people or accounts: nothing here pools,
 * lends or rotates subscriptions, and a key always belongs to the account that typed it (every query is by user id; a bot
 * may only pick a key of its own owner's provider). Hosted mode: an operator's lent provider (hosted.ts) keeps its own keys;
 * a customer's bot cannot pick one of them (the bot's owner is not the provider's owner).
 *
 * Order of a call: the bot's chosen key (if any, and still there), then the main key, then the extra keys in the order the
 * owner set. A key that answered 401/403 (refused), 402 or "out of credit", or 429 (limit reached) rests for a while
 * (Retry-After when the provider sent one, else 1 minute for a 429 and 1 hour otherwise) and the same call goes on with the
 * next key; when every key rests, they are tried in the same order anyway (a rest is a guess, not a ban). The switch is
 * written in the account's journal (by key NAME, never its value).
 */
q.run(`CREATE TABLE IF NOT EXISTS provider_keys (
  id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, provider_id TEXT NOT NULL,
  name TEXT NOT NULL, key_enc TEXT NOT NULL, position INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL)`);
q.run("CREATE INDEX IF NOT EXISTS provider_keys_by_provider ON provider_keys (user_id, provider_id, position)");
q.run(`CREATE TABLE IF NOT EXISTS bot_provider_keys (
  bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE, provider_id TEXT NOT NULL, key_id TEXT NOT NULL,
  PRIMARY KEY (bot_id, provider_id))`);

export const MAIN_KEY = "main";
export const MAX_EXTRA_KEYS = 9;
const REST_429_MS = 60_000;
const REST_REFUSED_MS = 3600_000;

export interface ProviderKeyView { id: string; name: string; position: number; resting: boolean; restUntil: number | null; lastError: string | null; createdAt: number }
export class ProviderKeyError extends Error { constructor(public status: 400 | 404 | 409, message: string) { super(message); } }

/** Rests are kept in memory: after a restart every key is tried again. Key: `${providerId}|${keyId}`. */
const rests = new Map<string, { until: number; why: string }>();
const restOf = (providerId: string, keyId: string) => { const r = rests.get(`${providerId}|${keyId}`); return r && r.until > Date.now() ? r : null; };

interface Row { id: string; user_id: string; provider_id: string; name: string; key_enc: string; position: number; created_at: number }
const rowsOf = (userId: string, providerId: string) => q.all<Row>("SELECT * FROM provider_keys WHERE user_id = ? AND provider_id = ? ORDER BY position, created_at", userId, providerId);
const ownsProvider = (userId: string, providerId: string) => !!q.get("SELECT 1 FROM user_providers WHERE id = ? AND user_id = ?", providerId, userId);
const cleanName = (raw: unknown) => String(raw ?? "").replace(/\s+/g, " ").trim().slice(0, 40);

export const providerKeys = {
  /** The main key (when the provider has one) and the extra keys, as the owner sees them: names only. */
  list(userId: string, providerId: string, hasMain: boolean, mainName = "Clé principale"): ProviderKeyView[] {
    const view = (id: string, name: string, position: number, createdAt: number): ProviderKeyView => {
      const r = restOf(providerId, id);
      return { id, name, position, resting: !!r, restUntil: r?.until ?? null, lastError: r?.why ?? null, createdAt };
    };
    return [...(hasMain ? [view(MAIN_KEY, mainName, -1, 0)] : []), ...rowsOf(userId, providerId).map((r) => view(r.id, r.name, r.position, r.created_at))];
  },
  add(userId: string, providerId: string, rawName: unknown, rawKey: unknown): ProviderKeyView {
    if (!ownsProvider(userId, providerId)) throw new ProviderKeyError(404, "That provider does not exist.");
    const name = cleanName(rawName);
    const key = typeof rawKey === "string" ? rawKey.trim() : "";
    if (!name) throw new ProviderKeyError(400, "Give the key a name (for example « Travail »).");
    if (!key || key.length > 500 || /\s/.test(key)) throw new ProviderKeyError(400, "Paste the API key (no spaces).");
    const list = rowsOf(userId, providerId);
    if (list.length >= MAX_EXTRA_KEYS) throw new ProviderKeyError(409, "This provider already has 10 keys.");
    if (list.some((r) => r.name.toLowerCase() === name.toLowerCase())) throw new ProviderKeyError(409, "A key already has this name.");
    const id = newId("pk");
    q.run("INSERT INTO provider_keys (id, user_id, provider_id, name, key_enc, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)", id, userId, providerId, name, seal(key), list.length, now());
    audit(userId, "apps", `Model provider key added: ${name}`);
    return providerKeys.list(userId, providerId, false).find((k) => k.id === id)!;
  },
  /** Renames and/or moves a key (position: its new rank among the extra keys). */
  update(userId: string, providerId: string, keyId: string, f: { name?: unknown; position?: unknown }): boolean {
    const list = rowsOf(userId, providerId);
    const cur = list.find((r) => r.id === keyId);
    if (!cur) return false;
    if (f.name !== undefined) {
      const name = cleanName(f.name);
      if (!name) throw new ProviderKeyError(400, "Give the key a name (for example « Travail »).");
      if (list.some((r) => r.id !== keyId && r.name.toLowerCase() === name.toLowerCase())) throw new ProviderKeyError(409, "A key already has this name.");
      q.run("UPDATE provider_keys SET name = ? WHERE id = ? AND user_id = ?", name, keyId, userId);
    }
    if (f.position !== undefined && Number.isInteger(Number(f.position))) {
      const to = Math.max(0, Math.min(list.length - 1, Number(f.position)));
      const order = list.filter((r) => r.id !== keyId);
      order.splice(to, 0, cur);
      q.tx(() => order.forEach((r, i) => q.run("UPDATE provider_keys SET position = ? WHERE id = ? AND user_id = ?", i, r.id, userId)));
    }
    return true;
  },
  remove(userId: string, providerId: string, keyId: string): boolean {
    const ok = q.run("DELETE FROM provider_keys WHERE id = ? AND user_id = ? AND provider_id = ?", keyId, userId, providerId).changes > 0;
    if (ok) { q.run("DELETE FROM bot_provider_keys WHERE provider_id = ? AND key_id = ?", providerId, keyId); rests.delete(`${providerId}|${keyId}`); }
    return ok;
  },
  /** Everything of a removed provider. */
  forget(userId: string, providerId: string) {
    q.run("DELETE FROM provider_keys WHERE user_id = ? AND provider_id = ?", userId, providerId);
    q.run("DELETE FROM bot_provider_keys WHERE provider_id = ? AND bot_id IN (SELECT id FROM bots WHERE user_id = ?)", providerId, userId);
  },
  hasExtra: (providerId: string) => !!q.get("SELECT 1 FROM provider_keys WHERE provider_id = ?", providerId),
  /** The bot's chosen key per provider ({ providerId: keyId }). */
  choicesOf: (botId: string): Record<string, string> => Object.fromEntries(q.all<{ provider_id: string; key_id: string }>("SELECT provider_id, key_id FROM bot_provider_keys WHERE bot_id = ?", botId).map((r) => [r.provider_id, r.key_id])),
  /** Sets (or clears, keyId null) the key a bot uses first for a provider. Only the bot's owner's own keys. */
  choose(userId: string, botId: string, providerId: string, keyId: string | null) {
    const bot = bots.owned(userId, botId);
    if (!bot) throw new ProviderKeyError(404, "That bot does not exist.");
    if (!ownsProvider(userId, providerId)) throw new ProviderKeyError(404, "That provider does not exist.");
    if (keyId === null) { q.run("DELETE FROM bot_provider_keys WHERE bot_id = ? AND provider_id = ?", botId, providerId); return; }
    if (keyId !== MAIN_KEY && !rowsOf(userId, providerId).some((r) => r.id === keyId)) throw new ProviderKeyError(404, "That key does not exist.");
    q.run("INSERT INTO bot_provider_keys (bot_id, provider_id, key_id) VALUES (?, ?, ?) ON CONFLICT(bot_id, provider_id) DO UPDATE SET key_id = excluded.key_id", botId, providerId, keyId);
  },
};

export interface RingKey { id: string; name: string; value: string }
/**
 * The keys of a provider, in the order a call tries them, for the bot whose turn is running (store.ts rowScope) when that
 * bot belongs to the provider's owner. Resting keys go last (kept, in case all rest).
 */
export function keyOrder(p: { id: string; userId: string; mainKeyEnc: string | null }, botId = rowScope.getStore()?.botId): RingKey[] {
  const all: RingKey[] = [];
  if (p.mainKeyEnc) { const v = unseal(p.mainKeyEnc); if (v) all.push({ id: MAIN_KEY, name: "Clé principale", value: v }); }
  for (const r of rowsOf(p.userId, p.id)) { const v = unseal(r.key_enc); if (v) all.push({ id: r.id, name: r.name, value: v }); }
  const bot = botId ? bots.byId(botId.split("~")[0]) : null;
  const chosen = bot && bot.userId === p.userId ? providerKeys.choicesOf(bot.id)[p.id] : undefined;
  if (chosen) { const i = all.findIndex((k) => k.id === chosen); if (i > 0) all.unshift(...all.splice(i, 1)); }
  return [...all.filter((k) => !restOf(p.id, k.id)), ...all.filter((k) => restOf(p.id, k.id))];
}

/** The key the current call uses (set around each try). */
const current = new AsyncLocalStorage<string>();
export const currentKey = () => current.getStore() ?? null;

/** Whether a failure means "this key, not the request": the next key may work. */
export function keyFailure(err: unknown): { restMs: number; why: string } | null {
  if (!(err instanceof ProviderError)) return null;
  const s = err.status;
  if (s === 429) return { restMs: err.opts.retryAfterMs ?? REST_429_MS, why: "limit reached (429)" };
  if (s === 401 || s === 403) return { restMs: REST_REFUSED_MS, why: `refused (${s})` };
  if (s === 402 || err.opts.code === "out_of_credit") return { restMs: err.opts.retryAfterMs ?? REST_REFUSED_MS, why: "out of credit" };
  return null;
}

/**
 * Wraps a user provider's runTurn so a call goes through its keys in order (see above). With one key only, the call is
 * exactly as before. Must be applied before the timeouts guard (llm/timeouts.ts), which then covers the whole call.
 */
export function withKeyRing(provider: LlmProvider & { runTurn(req: TurnRequest): Promise<TurnResult> }, p: { id: string; userId: string; mainKeyEnc: string | null }): void {
  const inner = provider.runTurn.bind(provider);
  provider.runTurn = async (req: TurnRequest) => {
    const keys = keyOrder(p);
    if (keys.length <= 1) return keys[0] ? current.run(keys[0].value, () => inner(req)) : inner(req);
    let last: unknown = null;
    for (const [i, k] of keys.entries()) {
      try { return await current.run(k.value, () => inner(req)); } catch (err) {
        const f = keyFailure(err);
        if (!f || req.signal?.aborted) throw err;
        rests.set(`${p.id}|${k.id}`, { until: Date.now() + Math.max(1000, f.restMs), why: f.why });
        last = err;
        const next = keys[i + 1];
        if (next) audit(p.userId, "apps", `Model provider key "${k.name}" ${f.why}: switched to "${next.name}"`);
      }
    }
    throw last;
  };
}

/** Tests: forget every rest. */
export const _resetKeyRests = () => rests.clear();
