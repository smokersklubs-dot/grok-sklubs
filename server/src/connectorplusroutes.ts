/**
 * nod items 10 and 17 — connector routes (behind the session; another account's connector answers 404).
 *   PATCH /connectors/:id   { name }  renames an app added by hand
 *   GET   /connectors/:id/bots          L159: which bots may use the app ({ allBots, bots: {id: bool}, allowed: ids })
 *   PUT   /connectors/:id/bots          { allBots, bots: {id: bool} } « pour tous mes bots » with per-bot opt-out
 * A private address is accepted by POST /connectors with { privateNetwork: true } (routes.ts → privateOption): typed by
 * the user, self-hosted only (mcptransport.ts).
 */
import type { Hono } from "hono";
import { connectors } from "./connectors.js";
import { checkPrivateConnectorUrl } from "./mcptransport.js";
import { body, fail } from "./routeinput.js";
import { audit, bots, type UserRecord } from "./store.js";
import { botsAllowed, connectorBotAccess, setConnectorBotAccess } from "./connectorbots.js";
import { registerVaultSiteRoutes } from "./vaultsiteroutes.js";

type Env = { Variables: { user: UserRecord } };

/** The add option for a private address — only when the person ticked it in the app (a bot has no way to send this). */
export const privateOption = (b: Record<string, any>) => (b.privateNetwork === true ? { privateOrigin: checkPrivateConnectorUrl(String(b.url ?? "")) } : {});

export function registerConnectorPlusRoutes(api: Hono<Env>) {
  registerVaultSiteRoutes(api); // L159: contact cards in the vault, verified sites
  api.patch("/connectors/:id", async (c) => {
    const user = c.get("user");
    const before = connectors.list(user.id).find((k) => k.id === c.req.param("id"));
    if (!before) fail(404, "That connector does not exist.");
    let connector;
    try { connector = connectors.rename(user.id, c.req.param("id"), String((await body(c)).name ?? "")); } catch (err) { return fail(400, (err as Error).message); }
    audit(user.id, "apps", `App renamed: ${before!.name} → ${connector!.name}`);
    return c.json({ connector });
  });
  // L159 (connectorbots.ts): the owner's own bots only; another account's app answers 404.
  const access = (userId: string, id: string) => {
    const own = bots.list(userId).filter((b) => b.kind === "agent").map((b) => b.id);
    return { ...connectorBotAccess(id), allowed: botsAllowed(id, own) };
  };
  api.get("/connectors/:id/bots", (c) => {
    const user = c.get("user");
    if (!connectors.list(user.id).some((k) => k.id === c.req.param("id"))) return fail(404, "That connector does not exist.");
    return c.json(access(user.id, c.req.param("id")));
  });
  api.put("/connectors/:id/bots", async (c) => {
    const user = c.get("user");
    const app = connectors.list(user.id).find((k) => k.id === c.req.param("id"));
    if (!app) return fail(404, "That connector does not exist.");
    const b = await body(c);
    const own = new Set(bots.list(user.id).map((x) => x.id));
    const choice = b.bots && typeof b.bots === "object" && !Array.isArray(b.bots) ? (b.bots as Record<string, unknown>) : {};
    setConnectorBotAccess(user.id, app.id, b.allBots !== false, choice, own);
    const out = access(user.id, app.id);
    audit(user.id, "apps", `App ${app.name}: ${out.allBots ? "all bots" : "chosen bots"} (${out.allowed.length} allowed)`);
    return c.json(out);
  });
}
