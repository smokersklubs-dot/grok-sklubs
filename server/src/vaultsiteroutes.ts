/**
 * L159 routes (behind the session; another account's data answers 404):
 *   GET    /vault/contacts            the owner's contact cards (fields included: they are the owner's own details)
 *   POST   /vault/contacts            { label, fullName, company, address1, address2, postalCode, city, country, phone, email, bots }
 *   PUT    /vault/contacts/:id        same body
 *   DELETE /vault/contacts/:id
 *   GET    /sites                     the verified registry of sites where a bot signed in (siteregistry.ts)
 *   DELETE /sites/:botId/:host        forget one line
 * Registered from connectorplusroutes.ts (routes.ts is at its size limit).
 */
import type { Hono } from "hono";
import { body, fail } from "./routeinput.js";
import { siteRegistry } from "./siteregistry.js";
import type { UserRecord } from "./store.js";
import { contacts } from "./vaultcontacts.js";

type Env = { Variables: { user: UserRecord } };

export function registerVaultSiteRoutes(api: Hono<Env>) {
  api.get("/vault/contacts", (c) => c.json({ contacts: contacts.list(c.get("user").id) }));
  api.post("/vault/contacts", async (c) => {
    try { return c.json({ contact: contacts.save(c.get("user").id, await body(c)) }); } catch (e) { return fail(400, (e as Error).message); }
  });
  api.put("/vault/contacts/:id", async (c) => {
    if (!contacts.list(c.get("user").id).some((k) => k.id === c.req.param("id"))) return fail(404, "That contact card does not exist.");
    let saved;
    try { saved = contacts.save(c.get("user").id, await body(c), c.req.param("id")); } catch (e) { return fail(400, (e as Error).message); }
    return saved ? c.json({ contact: saved }) : fail(404, "That contact card does not exist.");
  });
  api.delete("/vault/contacts/:id", (c) => (contacts.remove(c.get("user").id, c.req.param("id")) ? c.json({ ok: true }) : fail(404, "That contact card does not exist.")));
  api.get("/sites", (c) => c.json({ sites: siteRegistry.list(c.get("user").id) }));
  api.delete("/sites/:botId/:host", (c) => (siteRegistry.forget(c.get("user").id, c.req.param("botId"), c.req.param("host")) ? c.json({ ok: true }) : fail(404, "Nothing to forget here.")));
}
