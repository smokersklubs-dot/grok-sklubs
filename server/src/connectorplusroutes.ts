/**
 * nod items 10 and 17 — connector routes (behind the session; another account's connector answers 404).
 *   PATCH /connectors/:id   { name }  renames an app added by hand
 * A private address is accepted by POST /connectors with { privateNetwork: true } (routes.ts → privateOption): typed by
 * the user, self-hosted only (mcptransport.ts).
 */
import type { Hono } from "hono";
import { connectors } from "./connectors.js";
import { checkPrivateConnectorUrl } from "./mcptransport.js";
import { body, fail } from "./routeinput.js";
import { audit, type UserRecord } from "./store.js";

type Env = { Variables: { user: UserRecord } };

/** The add option for a private address — only when the person ticked it in the app (a bot has no way to send this). */
export const privateOption = (b: Record<string, any>) => (b.privateNetwork === true ? { privateOrigin: checkPrivateConnectorUrl(String(b.url ?? "")) } : {});

export function registerConnectorPlusRoutes(api: Hono<Env>) {
  api.patch("/connectors/:id", async (c) => {
    const user = c.get("user");
    const before = connectors.list(user.id).find((k) => k.id === c.req.param("id"));
    if (!before) fail(404, "That connector does not exist.");
    let connector;
    try { connector = connectors.rename(user.id, c.req.param("id"), String((await body(c)).name ?? "")); } catch (err) { return fail(400, (err as Error).message); }
    audit(user.id, "apps", `App renamed: ${before!.name} → ${connector!.name}`);
    return c.json({ connector });
  });
}
