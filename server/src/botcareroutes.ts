import type { Context, Hono } from "hono";
import { CareError, globalInstructions, identityDocs, personalityList, sharedRoles, GLOBAL_MAX } from "./botcare.js";
import { aside, capabilityGaps, shortcuts, startAsideSweep } from "./botcarework.js";
import { botPhotos, PhotoError, PHOTO_MAX_BYTES } from "./botphoto.js";
import { reachCard } from "./botreach.js";
import { tr } from "./i18n.js";
import { body, fail, HttpError } from "./routeinput.js";
import { audit, bots, clip, type UserRecord } from "./store.js";

/**
 * L161 owner routes (botcare.ts, botcarework.ts, botphoto.ts, botreach.ts), registered after the session check. Bots are
 * the caller's own agent bots (404 otherwise); lists are the caller's account only.
 *   GET/PUT  /global-instructions                 { text, updatedAt, max }         « Consignes pour tous les bots »
 *   GET      /shared-roles                        { roles }; POST adds { name, text }; PUT/DELETE /shared-roles/:rid
 *   GET/PUT  /bots/:id/shared-role                { roleId }
 *   GET      /bots/:id/identity                   { docs, personalities }; POST { title, body } ; PUT/DELETE /bots/:id/identity/:docId
 *   POST     /bots/:id/identity/personality       { personality } → the « Caractère » document
 *   GET/PUT  /bots/:id/aside                      { aside, asideAt, lastUse, never, eligible, days } ; PUT { never?, back? }
 *   GET      /bots/:id/reach                      « Ce que ce bot peut lire et écrire »
 *   GET/PUT/DELETE /bots/:id/photo                the photo (raw picture bytes on PUT) ; GET /bot-photos { photos }
 *   GET      /bot-shortcuts ; POST /bot-shortcuts/:sid/done ; DELETE /bot-shortcuts/:sid
 *   GET      /capability-gaps ; POST /capability-gaps/:gid/done
 */
export function registerBotCareRoutes(api: Hono<any>) {
  startAsideSweep();
  const me = (c: Context) => c.get("user") as UserRecord;
  const loc = (c: Context) => me(c).locale;
  const ownBot = (c: Context) => {
    const bot = bots.owned(me(c).id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") fail(404, tr(me(c).locale, "That bot does not exist."));
    return bot!;
  };
  /** CareError and PhotoError in the caller's language. */
  const care = async (c: Context, fn: () => unknown) => {
    try { return c.json(await fn()); } catch (e) {
      if (e instanceof CareError || e instanceof PhotoError) throw new HttpError(e.status, tr(me(c).locale, e.message));
      throw e;
    }
  };

  api.get("/global-instructions", (c) => { const g = globalInstructions.get(me(c).id); return c.json({ text: g?.text ?? "", updatedAt: g?.updated_at ?? null, max: GLOBAL_MAX }); });
  api.put("/global-instructions", (c) => care(c, async () => {
    const r = globalInstructions.set(me(c).id, (await body(c)).text);
    audit(me(c).id, "account", tr(me(c).locale, r.text ? "Instructions for every bot changed" : "Instructions for every bot removed"));
    return { ...r, max: GLOBAL_MAX };
  }));

  api.get("/shared-roles", (c) => c.json({ roles: sharedRoles.list(me(c).id, loc(c)) }));
  api.post("/shared-roles", (c) => care(c, async () => { const b = await body(c); return { role: sharedRoles.save(me(c).id, null, b.name, b.text, loc(c)) }; }));
  api.put("/shared-roles/:rid", (c) => care(c, async () => { const b = await body(c); return { role: sharedRoles.save(me(c).id, c.req.param("rid"), b.name, b.text, loc(c)) }; }));
  api.delete("/shared-roles/:rid", (c) => care(c, () => { sharedRoles.reset(me(c).id, c.req.param("rid"), loc(c)); return { roles: sharedRoles.list(me(c).id, loc(c)) }; }));
  api.get("/bots/:id/shared-role", (c) => c.json({ roleId: sharedRoles.of(ownBot(c).id) }));
  api.put("/bots/:id/shared-role", (c) => care(c, async () => ({ roleId: sharedRoles.assign(ownBot(c), (await body(c)).roleId ?? null, loc(c)) })));

  api.get("/bots/:id/identity", (c) => c.json({ docs: identityDocs.list(ownBot(c).id), personalities: personalityList(loc(c)) }));
  api.post("/bots/:id/identity", (c) => care(c, async () => { const b = await body(c); return { doc: identityDocs.save(ownBot(c).id, null, b.title, b.body), docs: identityDocs.list(ownBot(c).id) }; }));
  api.post("/bots/:id/identity/personality", (c) => care(c, async () => { const bot = ownBot(c); const doc = identityDocs.applyPersonality(bot.id, (await body(c)).personality, loc(c)); return { doc, docs: identityDocs.list(bot.id) }; }));
  api.put("/bots/:id/identity/:docId", (c) => care(c, async () => { const b = await body(c); const bot = ownBot(c); return { doc: identityDocs.save(bot.id, c.req.param("docId"), b.title, b.body), docs: identityDocs.list(bot.id) }; }));
  api.delete("/bots/:id/identity/:docId", (c) => care(c, () => { const bot = ownBot(c); identityDocs.remove(bot.id, c.req.param("docId")); return { docs: identityDocs.list(bot.id) }; }));

  api.get("/bots/:id/aside", (c) => c.json(aside.view(ownBot(c))));
  api.put("/bots/:id/aside", async (c) => {
    const bot = ownBot(c);
    const b = await body(c);
    if (b.never !== undefined && typeof b.never !== "boolean") fail(400, tr(me(c).locale, "never must be true or false."));
    return c.json(aside.set(bot, { never: b.never, back: b.back === true }));
  });

  api.get("/bots/:id/read-write", (c) => c.json(reachCard(ownBot(c))));

  api.get("/bot-photos", (c) => c.json({ photos: botPhotos.all(me(c).id) }));
  api.get("/bots/:id/photo", (c) => {
    const data = botPhotos.get(ownBot(c).id);
    if (!data) fail(404, tr(me(c).locale, "This bot has no photo."));
    return new Response(new Uint8Array(data!), { headers: { "content-type": "image/webp", "cache-control": "private, max-age=31536000, immutable", "x-content-type-options": "nosniff", "content-security-policy": "default-src 'none'" } });
  });
  api.put("/bots/:id/photo", (c) => care(c, async () => {
    const bot = ownBot(c);
    if (Number(c.req.header("content-length") ?? 0) > PHOTO_MAX_BYTES + 1024) throw new PhotoError(413, "This picture is too large (8 MB at most).");
    const r = await botPhotos.set(me(c).id, bot.id, Buffer.from(await c.req.arrayBuffer()));
    audit(me(c).id, "account", tr(me(c).locale, "{bot}: new photo", { bot: bot.name }), bot.id);
    return { url: r.url };
  }));
  api.delete("/bots/:id/photo", (c) => { const bot = ownBot(c); return c.json({ removed: botPhotos.remove(bot.id) }); });

  api.get("/bot-shortcuts", (c) => c.json({ items: shortcuts.list(me(c).id) }));
  api.post("/bot-shortcuts/:sid/done", (c) => { if (!shortcuts.close(me(c).id, c.req.param("sid"), "done")) fail(404, tr(me(c).locale, "That shortcut does not exist.")); return c.json({ items: shortcuts.list(me(c).id) }); });
  api.delete("/bot-shortcuts/:sid", (c) => { if (!shortcuts.close(me(c).id, c.req.param("sid"), "remove")) fail(404, tr(me(c).locale, "That shortcut does not exist.")); return c.json({ items: shortcuts.list(me(c).id) }); });

  api.get("/capability-gaps", (c) => c.json({ items: capabilityGaps.list(me(c).id) }));
  api.post("/capability-gaps/:gid/done", (c) => {
    const id = c.req.param("gid");
    const gap = capabilityGaps.list(me(c).id).find((g) => g.id === id);
    if (!gap || !capabilityGaps.close(me(c).id, id)) fail(404, tr(me(c).locale, "That missing capability does not exist."));
    audit(me(c).id, "account", `${tr(me(c).locale, "missing capability")} — ${clip(gap!.what, 160)}: ${tr(me(c).locale, "handled")}`, gap!.botId);
    return c.json({ items: capabilityGaps.list(me(c).id) });
  });
}
