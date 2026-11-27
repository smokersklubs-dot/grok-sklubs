import { randomBytes } from "node:crypto";
import type { Context, Hono } from "hono";
import { pickLocale, tr } from "./i18n.js";
import { registerLiveDocRoutes } from "./livedocroutes.js";
import { locationCsp, locationPage, phoneRequests } from "./phonerequests.js";
import { PluginError, plugins } from "./plugins.js";
import { RemoteAgentError, remoteAgents } from "./remoteagents.js";
import { body, fail } from "./routeinput.js";
import { bots, type UserRecord } from "./store.js";
import { LIVE_PROVIDERS, linkLive, listLive, liveLinks, liveStatus, removeLiveConfig, saveLiveConfig, type LiveProvider } from "./vaultlive.js";

/**
 * Wave 7 extensions (registered after the session check, except registerPhonePublic):
 *  - L178 shared documents: livedocroutes.ts
 *  - L177 phone requests:   GET /phone/requests · POST /phone/requests/:id/photo { data } · POST /phone/requests/:id/refuse
 *                           POST /phone/requests/:id/location-link → { url } (one-time page, opened on the phone)
 *  - L179 live vaults:      GET /vault-live · PUT /vault-live { provider, … } · DELETE /vault-live?provider=
 *                           GET /vault-live/items?provider=&q= · POST /vault-live/link { provider, ref, name? }
 *  - L172 other agents:     GET /remote-agents · POST /remote-agents { kind: "a2a", url, token?, name? } | { kind: "acp", name,
 *                           command, args, permissions } · PATCH /remote-agents/:id { permissions } · DELETE /remote-agents/:id
 *  - L174 plugins:          GET /bots/:id/plugins · POST /bots/:id/plugins { manifest } · POST /bots/:id/plugins/:pid/install
 *                           { accept? } · DELETE /bots/:id/plugins/:pid
 * Only the signed-in account's own things (account isolation): every id is checked against the user.
 */
export function registerExtensionRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  registerLiveDocRoutes(api);

  // ── Phone ──
  api.get("/phone/requests", (c) => c.json({ requests: phoneRequests.pending(user(c).id) }));
  api.post("/phone/requests/:id/refuse", (c) => { const u = user(c); if (!phoneRequests.refuse(u.id, c.req.param("id") ?? "")) fail(404, tr(u.locale, "This request is no longer waiting.")); return c.json({ ok: true }); });
  api.post("/phone/requests/:id/photo", async (c) => {
    const u = user(c);
    const r = await phoneRequests.photo(u.id, c.req.param("id") ?? "", (await body(c)).data);
    if (r === "gone") fail(404, tr(u.locale, "This request is no longer waiting."));
    if (r === "bad") fail(400, tr(u.locale, "This photo cannot be read."));
    return c.json({ ok: true });
  });
  api.post("/phone/requests/:id/location-link", (c) => {
    const u = user(c);
    const token = phoneRequests.locationLink(u.id, c.req.param("id") ?? "");
    if (!token) fail(404, tr(u.locale, "This request is no longer waiting."));
    return c.json({ url: `/api/phone/where/${token}` });
  });

  // ── Live vaults ── (no id in the path: everything is the caller's own; the provider comes in the body or the query)
  const provider = (c: Context, raw: unknown): LiveProvider => { const p = raw as LiveProvider; if (!LIVE_PROVIDERS.includes(p)) fail(400, tr(user(c).locale, "Unknown vault.")); return p; };
  const unreachable = (c: Context, e: unknown) => (e as Error).message === "not connected" ? fail(404, tr(user(c).locale, "This vault is not connected.")) : fail(502, tr(user(c).locale, "The vault could not be read: {why}", { why: (e as Error).message }));
  api.get("/vault-live", (c) => c.json({ providers: liveStatus(user(c).id), links: liveLinks(user(c).id) }));
  api.put("/vault-live", async (c) => { const u = user(c); const b = await body(c); const problem = saveLiveConfig(u.id, provider(c, b.provider), b); if (problem) fail(400, tr(u.locale, problem)); return c.json({ providers: liveStatus(u.id) }); });
  api.delete("/vault-live", (c) => { const u = user(c); removeLiveConfig(u.id, provider(c, c.req.query("provider"))); return c.json({ providers: liveStatus(u.id) }); });
  api.get("/vault-live/items", async (c) => {
    const u = user(c);
    try { return c.json({ items: await listLive(u.id, provider(c, c.req.query("provider")), c.req.query("q") ?? "") }); } catch (e) { return unreachable(c, e); }
  });
  api.post("/vault-live/link", async (c) => {
    const u = user(c);
    const b = await body(c);
    try { const item = await linkLive(u.id, provider(c, b.provider), String(b.ref ?? ""), typeof b.name === "string" ? b.name : undefined); return c.json({ item: { id: item.id, name: item.name, site: item.site } }); } catch (e) { return unreachable(c, e); }
  });

  // ── Other agents ──
  const agentErr = (c: Context, e: unknown) => { if (e instanceof RemoteAgentError) fail(400, tr(user(c).locale, e.message)); throw e; };
  api.get("/remote-agents", (c) => c.json({ agents: remoteAgents.list(user(c).id) }));
  api.post("/remote-agents", async (c) => {
    const u = user(c);
    const b = await body(c);
    try { return c.json({ agent: b.kind === "acp" ? remoteAgents.addAcp(u.id, b) : await remoteAgents.addA2A(u.id, b) }); } catch (e) { return agentErr(c, e); }
  });
  api.patch("/remote-agents/:id", async (c) => { const u = user(c); if (!remoteAgents.owned(u.id, c.req.param("id") ?? "")) fail(404, "Not found."); remoteAgents.setPermissions(u.id, c.req.param("id")!, (await body(c)).permissions); return c.json({ agents: remoteAgents.list(u.id) }); });
  api.delete("/remote-agents/:id", (c) => { const u = user(c); if (!remoteAgents.owned(u.id, c.req.param("id") ?? "")) fail(404, tr(u.locale, "Not found.")); remoteAgents.remove(u.id, c.req.param("id")!); return c.json({ agents: remoteAgents.list(u.id) }); });

  // ── Plugins ──
  const ownBot = (c: Context) => { const b = bots.owned(user(c).id, c.req.param("id") ?? ""); if (!b) fail(404, tr(user(c).locale, "Not found.")); return b!; };
  const pluginErr = (c: Context, e: unknown) => { if (e instanceof PluginError) fail(e.status, tr(user(c).locale, e.message)); throw e; };
  api.get("/bots/:id/plugins", (c) => c.json({ plugins: plugins.list(ownBot(c).id, user(c).locale) }));
  api.post("/bots/:id/plugins", async (c) => { const b = ownBot(c); try { return c.json({ plugin: plugins.propose(b, (await body(c)).manifest, "owner") }); } catch (e) { return pluginErr(c, e); } });
  api.post("/bots/:id/plugins/:pid/install", async (c) => { ownBot(c); try { return c.json({ plugin: plugins.approve(user(c).id, c.req.param("pid") ?? "", (await body(c)).accept === true) }); } catch (e) { return pluginErr(c, e); } });
  api.delete("/bots/:id/plugins/:pid", async (c) => { ownBot(c); try { await plugins.remove(user(c).id, c.req.param("pid") ?? ""); return c.json({ ok: true }); } catch (e) { return pluginErr(c, e); } });
}

/** The one-time « Partager ma position » page (before the session check: the phone's browser has no Sklubot cookie). */
export function registerPhonePublic(api: Hono<any>) {
  api.get("/phone/where/:token", (c) => {
    const token = c.req.param("token") ?? "";
    const req = phoneRequests.byToken(token);
    const locale = pickLocale(undefined, c.req.header("accept-language"));
    const headers = { "cache-control": "no-store", "referrer-policy": "no-referrer", "x-content-type-options": "nosniff", "x-robots-tag": "noindex" };
    if (!req) return c.text(tr(locale, "This request is no longer waiting."), 404, headers);
    const nonce = randomBytes(16).toString("base64");
    return c.html(locationPage(req, token, locale, nonce), 200, { ...headers, "content-security-policy": locationCsp(nonce) });
  });
  api.post("/phone/where/:token", async (c) => {
    const token = c.req.param("token") ?? "";
    const b = await body(c);
    if (b.refuse === true) return c.json({ ok: phoneRequests.locationRefused(token) });
    const r = phoneRequests.location(token, b);
    return r === "ok" ? c.json({ ok: true }) : c.json({ ok: false, error: r }, r === "gone" ? 404 : 400);
  });
}
