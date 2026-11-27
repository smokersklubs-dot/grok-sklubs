import type { Context, Hono } from "hono";
import { tr } from "./i18n.js";
import { LiveDocError, liveDocs } from "./livedoc.js";
import { body, fail } from "./routeinput.js";
import type { UserRecord } from "./store.js";

/**
 * L178 « Document partagé » (livedoc.ts), registered after the session check. Only the owner's own documents.
 *   GET    /livedocs                     list
 *   POST   /livedocs                     { title, text? } create
 *   GET    /livedocs/:id                 the text and its revision
 *   PATCH  /livedocs/:id                 { title?, bots? } rename, share with bots
 *   DELETE /livedocs/:id
 *   POST   /livedocs/:id/ops             { revision, op, clientId? } a change (folded over newer ones) → { revision }
 *   GET    /livedocs/:id/history         the last changes (who, when, +/−)
 *   GET    /livedocs/:id/at/:rev         the text right after that change
 *   POST   /livedocs/:id/undo            { revision } undo that change (a new change)
 */
export function registerLiveDocRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const own = (c: Context) => {
    const u = user(c);
    const d = liveDocs.owned(u.id, c.req.param("id") ?? "");
    if (!d) fail(404, tr(u.locale, "No such document."));
    return { u, d: d! };
  };
  const guard = <T,>(c: Context, fn: () => T): T => {
    try { return fn(); } catch (e) { if (e instanceof LiveDocError) fail(e.status, tr(user(c).locale, e.message, { n: 100 })); throw e; }
  };
  const owner = (u: UserRecord) => ({ kind: "owner" as const, id: u.id, name: u.name || "Toi" });
  api.get("/livedocs", (c) => c.json({ docs: liveDocs.list(user(c).id) }));
  api.post("/livedocs", async (c) => { const b = await body(c); return c.json({ doc: guard(c, () => liveDocs.create(user(c).id, b)) }); });
  api.get("/livedocs/:id", (c) => c.json({ doc: own(c).d }));
  api.patch("/livedocs/:id", async (c) => { const { u, d } = own(c); const b = await body(c); return c.json({ doc: guard(c, () => liveDocs.update(u.id, d.id, b)) }); });
  api.delete("/livedocs/:id", (c) => { const { u, d } = own(c); guard(c, () => liveDocs.remove(u.id, d.id)); return c.json({ ok: true }); });
  api.post("/livedocs/:id/ops", async (c) => {
    const { u, d } = own(c);
    const b = await body(c);
    const r = guard(c, () => liveDocs.apply(d.id, Number(b.revision), b.op, owner(u), { clientId: typeof b.clientId === "string" ? b.clientId : undefined }));
    return c.json({ revision: r.revision });
  });
  api.get("/livedocs/:id/history", (c) => c.json({ changes: liveDocs.history(own(c).d.id) }));
  api.get("/livedocs/:id/at/:rev", (c) => { const { d } = own(c); return c.json({ revision: Number(c.req.param("rev")), text: guard(c, () => liveDocs.textAt(d.id, Number(c.req.param("rev")))) }); });
  api.post("/livedocs/:id/undo", async (c) => { const { u, d } = own(c); const b = await body(c); return c.json(guard(c, () => liveDocs.undo(d.id, Number(b.revision), owner(u)))); });
}
