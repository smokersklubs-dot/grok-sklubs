import { refuseCreditless } from "./modelplusroutes.js"; import { localize } from "./lang/index.js"; import { tr } from "./i18n.js";
import type { Context, Hono } from "hono";
import { apiProviders } from "./apimodels.js";
import { previewLocalImport } from "./localimport.js";
import { applyBrowserPolicies, applyBrowserPolicy, netPolicy, MAX_SITES } from "./netpolicy.js";
import { outWebhooks, WebhookError, WEBHOOK_EVENTS } from "./outwebhooks.js";
import { providerKeys, ProviderKeyError } from "./providerkeys.js";
import { body, fail } from "./routeinput.js"; import { registerBotRouteRoutes } from "./botrouteroutes.js";
import type { BotRecord, UserRecord } from "./store.js";

/**
 * The owner's routes of wave 6 (behind the session; another account's bot or provider answers 404):
 *   L82  GET/POST /api-providers/:id/keys · PATCH/DELETE /api-providers/:id/keys/:keyId   names only, never a key back
 *        GET /bots/:id/provider-keys · PUT /bots/:id/provider-keys { providerId, keyId | null }
 *   L169 GET/PUT /bots/:id/network { mode: all|list|none, hosts } · GET/PUT /network/blocked-sites { hosts }
 *   L170 GET/POST /bots/:id/webhooks · PATCH/DELETE /bots/:id/webhooks/:hookId · POST /bots/:id/webhooks/:hookId/test
 *   L181 POST /import/local/preview { files: [{ path, text }], source? } (commit: POST /import/grok/commit)
 */
const FR: Record<string, string> = {
  "That provider does not exist.": "Ce fournisseur n'existe pas.",
  "That key does not exist.": "Cette clé n'existe pas.",
  "That bot does not exist.": "Ce bot n'existe pas.",
  "Give the key a name (for example « Travail »).": "Donne un nom à la clé (par exemple « Travail »).",
  "Paste the API key (no spaces).": "Colle la clé d'API (sans espace).",
  "This provider already has 10 keys.": "Ce fournisseur a déjà 10 clés.",
  "A key already has this name.": "Une clé porte déjà ce nom.",
  "Give the full address (https://…).": "Donne l'adresse complète (https://…).",
  "That address is on a private or local network, which this server does not reach.": "Cette adresse est sur un réseau privé ou local, que ce serveur ne joint pas.",
  "Choose at least one event.": "Choisis au moins un événement.",
  "That webhook does not exist.": "Ce webhook n'existe pas.",
};
export function registerAccountNetRoutes(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const say = (c: Context, en: string) => localize(user(c).locale, en, FR);
  const guard = <T>(c: Context, fn: () => T): T => {
    try { return fn(); } catch (e) {
      if (e instanceof ProviderKeyError || e instanceof WebhookError) return fail(e.status, say(c, e.message));
      throw e;
    }
  };
  const provider = (c: Context) => apiProviders.get(user(c).id, c.req.param("id") ?? "") ?? fail(404, say(c, "That provider does not exist."));
  const keysOf = (c: Context, p: { id: string; hasKey: boolean }) => providerKeys.list(user(c).id, p.id, p.hasKey, tr(user(c).locale, "Main key"));

  // ── L82 ──
  api.get("/api-providers/:id/keys", (c) => { const p = provider(c); return c.json({ keys: keysOf(c, p) }); });
  api.post("/api-providers/:id/keys", async (c) => {
    const p = provider(c); const b = await body(c);
    if (typeof b.key === "string" && b.key.trim() && !/\s/.test(b.key.trim())) await refuseCreditless(c, p.baseUrl, b.key.trim(), p.preset ?? undefined); // L150 (modelplusroutes.ts)
    guard(c, () => providerKeys.add(user(c).id, p.id, b.name, b.key));
    return c.json({ keys: keysOf(c, p) });
  });
  api.patch("/api-providers/:id/keys/:keyId", async (c) => {
    const p = provider(c); const b = await body(c);
    if (!guard(c, () => providerKeys.update(user(c).id, p.id, c.req.param("keyId") ?? "", { name: b.name, position: b.position }))) fail(404, say(c, "That key does not exist."));
    return c.json({ keys: keysOf(c, p) });
  });
  api.delete("/api-providers/:id/keys/:keyId", (c) => {
    const p = provider(c);
    if (!providerKeys.remove(user(c).id, p.id, c.req.param("keyId") ?? "")) fail(404, say(c, "That key does not exist."));
    return c.json({ keys: keysOf(c, p) });
  });
  api.get("/bots/:id/provider-keys", (c) => {
    const bot = ownAgent(c);
    const providers = apiProviders.list(user(c).id).map((p) => ({ id: p.id, name: p.name, keys: keysOf(c, p).map((k) => ({ id: k.id, name: k.name, resting: k.resting })) })).filter((p) => p.keys.length > 1);
    return c.json({ choices: providerKeys.choicesOf(bot.id), providers });
  });
  api.put("/bots/:id/provider-keys", async (c) => {
    const bot = ownAgent(c); const b = await body(c);
    guard(c, () => providerKeys.choose(user(c).id, bot.id, String(b.providerId ?? ""), typeof b.keyId === "string" && b.keyId ? b.keyId : null));
    return c.json({ choices: providerKeys.choicesOf(bot.id) });
  });

  // ── L169 ──
  api.get("/bots/:id/network", (c) => c.json({ policy: netPolicy.get(ownAgent(c).id), blocked: netPolicy.blocked(user(c).id), max: MAX_SITES }));
  api.put("/bots/:id/network", async (c) => {
    const bot = ownAgent(c);
    const policy = netPolicy.set(bot, await body(c));
    void applyBrowserPolicy(bot);
    return c.json({ policy, blocked: netPolicy.blocked(user(c).id), max: MAX_SITES });
  });
  registerBotRouteRoutes(api, ownAgent); // L169 exit: proxy, home (Relais / Tailscale), Web Bot Auth (botrouteroutes.ts)
  api.get("/network/blocked-sites", (c) => c.json({ hosts: netPolicy.blocked(user(c).id), max: MAX_SITES }));
  api.put("/network/blocked-sites", async (c) => {
    const hosts = netPolicy.setBlocked(user(c).id, (await body(c)).hosts);
    void applyBrowserPolicies(user(c).id);
    return c.json({ hosts, max: MAX_SITES });
  });

  // ── L170 outgoing webhooks ──
  api.get("/bots/:id/webhooks", (c) => c.json({ webhooks: outWebhooks.list(ownAgent(c).id), events: WEBHOOK_EVENTS }));
  api.post("/bots/:id/webhooks", async (c) => {
    const bot = ownAgent(c); const b = await body(c);
    try {
      const made = await outWebhooks.create(bot, b.url, b.events);
      return c.json({ ...made, webhooks: outWebhooks.list(bot.id), events: WEBHOOK_EVENTS });
    } catch (e) { if (e instanceof WebhookError) return fail(e.status, say(c, e.message)); throw e; }
  });
  api.patch("/bots/:id/webhooks/:hookId", async (c) => {
    const bot = ownAgent(c); const b = await body(c);
    if (!outWebhooks.setActive(bot, c.req.param("hookId") ?? "", b.active !== false)) fail(404, say(c, "That webhook does not exist."));
    return c.json({ webhooks: outWebhooks.list(bot.id), events: WEBHOOK_EVENTS });
  });
  api.delete("/bots/:id/webhooks/:hookId", (c) => {
    const bot = ownAgent(c);
    if (!outWebhooks.remove(bot, c.req.param("hookId") ?? "")) fail(404, say(c, "That webhook does not exist."));
    return c.json({ webhooks: outWebhooks.list(bot.id), events: WEBHOOK_EVENTS });
  });
  api.post("/bots/:id/webhooks/:hookId/test", (c) => {
    const bot = ownAgent(c);
    if (!outWebhooks.test(bot, c.req.param("hookId") ?? "")) fail(404, say(c, "That webhook does not exist."));
    return c.json({ webhooks: outWebhooks.list(bot.id), events: WEBHOOK_EVENTS });
  });

  // ── L181 ──
  api.post("/import/local/preview", async (c) => {
    if (Number(c.req.header("content-length") ?? 0) > 3_000_000) fail(413, tr(user(c).locale, "Too large: 2 MB of text at most."));
    return c.json(previewLocalImport(user(c), await body(c)));
  });
}
