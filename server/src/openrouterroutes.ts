import type { Context, Hono } from "hono"; import { localize } from "./lang/index.js";
import { apiProviders } from "./apimodels.js";
import { refuseCreditless } from "./modelplusroutes.js";
import { unseal } from "./auth.js";
import { q } from "./db.js";
import { RateWindow } from "./hardening.js";
import { modelsFromCatalog, OPENROUTER_PRESET, openRouterBase, openRouterCatalog, testOpenRouterKey } from "./openrouter.js";
import type { ApiProviderModel, Locale } from "./shared.js";
import { audit, type UserRecord } from "./store.js";

/**
 * OpenRouter in Settings → Models, onboarding and "Mes comptes IA" (openrouter.ts). Behind the session; everything acts on
 * the caller's own OpenRouter provider only (at most one per account). Its key is write-only: no answer carries it.
 *   GET  /openrouter/catalog            the live tool-capable catalog (cached 6 h) and the "Recommandés" ids
 *   GET  /openrouter                    the account's OpenRouter provider (or null)
 *   PUT  /openrouter                    { key?, models? } creates or updates it (models: ids from the catalog)
 *   POST /openrouter/test               { key? } checks the typed key, else the saved one (GET /key: no tokens used)
 */
const FR: Record<string, string> = {
  "OpenRouter could not be reached. Try again in a moment.": "OpenRouter ne répond pas. Réessaie dans un moment.",
  "Paste your OpenRouter key first.": "Colle d'abord ta clé OpenRouter.",
  "That key does not look right.": "Cette clé ne semble pas correcte.",
  "Too many tries. Wait a little and try again.": "Trop d'essais. Attends un peu et réessaie.",
  "OpenRouter refused this key.": "OpenRouter a refusé cette clé.",
  "The key works.": "La clé fonctionne.",
  "At most 10 providers.": "10 fournisseurs au plus.",
};
const say = (loc: Locale | undefined, en: string) => localize(loc, en, FR);
const checks = new RateWindow(20, 60_000);

/** The account's own OpenRouter provider row (never a lent one). */
const ownRow = (userId: string) => q.get<{ id: string; key_enc: string | null }>("SELECT id, key_enc FROM user_providers WHERE user_id = ? AND preset = 'openrouter' ORDER BY created_at LIMIT 1", userId);

const cleanKey = (v: unknown): string | null | "bad" => {
  if (typeof v !== "string" || !v.trim()) return null;
  const k = v.trim();
  return k.length > 400 || /[\s\0-\x1f]/.test(k) ? "bad" : k;
};

export function registerOpenRouterRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const bad = (c: Context, status: 400 | 429 | 502, en: string) => c.json({ error: say(user(c).locale, en) }, status);
  const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };

  api.get("/openrouter/catalog", async (c) => {
    try { return c.json(await openRouterCatalog()); }
    catch { return bad(c, 502, "OpenRouter could not be reached. Try again in a moment."); }
  });
  api.get("/openrouter", (c) => {
    const r = ownRow(user(c).id);
    return c.json({ provider: r ? apiProviders.get(user(c).id, r.id) : null, links: { keys: OPENROUTER_PRESET.keysUrl, credits: OPENROUTER_PRESET.creditsUrl, signup: OPENROUTER_PRESET.signupUrl } });
  });
  api.put("/openrouter", async (c) => {
    const u = user(c);
    const b = await json(c);
    const key = cleanKey(b.key);
    if (key === "bad") return bad(c, 400, "That key does not look right.");
    if (key) await refuseCreditless(c, openRouterBase(), key, "openrouter"); // L150: a key with no credit is refused (providercredit.ts)
    let models: ApiProviderModel[] | undefined;
    if (b.models !== undefined) {
      try { models = modelsFromCatalog(b.models, await openRouterCatalog()); }
      catch { return bad(c, 502, "OpenRouter could not be reached. Try again in a moment."); }
    }
    const cur = ownRow(u.id);
    if (cur) {
      const p = apiProviders.update(u.id, cur.id, { ...(key ? { key } : {}), ...(models ? { models } : {}) });
      audit(u.id, "apps", `OpenRouter changed${key ? " (new key)" : ""}${models ? ` (${models.length} models)` : ""}`);
      return c.json({ provider: p });
    }
    if (!key) return bad(c, 400, "Paste your OpenRouter key first.");
    // A first key with no choice yet: the "Recommandés" models, so the bots can use OpenRouter at once.
    if (!models) { try { const cat = await openRouterCatalog(); models = modelsFromCatalog(cat.recommended, cat); } catch { models = []; } }
    try {
      const p = apiProviders.create(u.id, { name: OPENROUTER_PRESET.name, baseUrl: openRouterBase(), key, models: models ?? [], preset: "openrouter", images: true });
      audit(u.id, "apps", "Model provider added: OpenRouter");
      return c.json({ provider: p });
    } catch (err) { return bad(c, 400, (err as Error).message); }
  });
  api.post("/openrouter/test", async (c) => {
    const u = user(c);
    if (checks.over(u.id)) return bad(c, 429, "Too many tries. Wait a little and try again.");
    const typed = cleanKey((await json(c)).key);
    if (typed === "bad") return bad(c, 400, "That key does not look right.");
    const saved = ownRow(u.id)?.key_enc;
    const key = typed ?? (saved ? unseal(saved) : null);
    if (!key) return bad(c, 400, "Paste your OpenRouter key first.");
    const r = await testOpenRouterKey(key);
    return c.json({ ...r, detail: say(u.locale, r.detail) });
  });
}
