import type { Context, Hono } from "hono";
import { RateWindow } from "./hardening.js";
import {
  AnnounceError, adminState, announceText, archiveAnnouncement, canAuthor, createAnnouncement, dismiss, dispatchSoon, markSeen,
  previewAnnouncement, readerState, setEmailOptIn, updateAnnouncement,
} from "./announcements.js";
import type { UserRecord } from "./store.js";

/**
 * « Annonces » (announcements.ts), registered after the session check.
 *
 * Readers (every signed-in account; they only ever see the announcements they are in the audience of):
 *   GET  /announcements                       what is up for me now, my unread count, the maintenance band, my e-mail choice
 *   POST /announcements/seen                  { ids } the bell was opened: these were seen
 *   POST /announcements/:annId/dismiss        "Fermer" / "J'ai lu" (404 when it is not mine or not up)
 *   PUT  /announcements/prefs                 { email } announcements by e-mail too, or not
 * Authors (the owner; in hosted mode, also the operators). Anyone else gets 404 on every one of these, like
 * Surveillance: the page does not exist for them.
 *   GET  /announcements-admin                 every announcement, audiences to choose from, the log
 *   POST /announcements-admin/preview         the cleaned announcement and how many accounts it reaches (nothing saved)
 *   POST /announcements-admin                 publish (or schedule)
 *   PUT  /announcements-admin/:annId          change
 *   POST /announcements-admin/:annId/archive  take down
 */
const readerHits = new RateWindow(120, 60_000);
const previews = new RateWindow(120, 3_600_000);

export function registerAnnouncementRoutes(api: Hono<any>) {
  const handle = (author: boolean, fn: (c: Context, user: UserRecord) => Promise<Response> | Response) => async (c: Context) => {
    const user = c.get("user") as UserRecord;
    try {
      if (author && !canAuthor(user.id)) throw new AnnounceError(404, "No such endpoint.");
      if (!author && c.req.method !== "GET" && readerHits.over(user.id)) throw new AnnounceError(429, "Too many requests. Wait a minute and try again.");
      return await fn(c, user);
    } catch (err) {
      if (err instanceof AnnounceError) return c.json({ error: announceText(user.locale, err.message, err.vars) }, err.status);
      throw err;
    }
  };
  const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" && !Array.isArray(b) ? b : {}; };
  const fresh = { "cache-control": "no-store" };

  api.get("/announcements", handle(false, (c, user) => c.json(readerState(user.id), 200, fresh)));
  api.post("/announcements/seen", handle(false, async (c, user) => { markSeen(user.id, (await json(c)).ids); return c.json(readerState(user.id)); }));
  api.put("/announcements/prefs", handle(false, async (c, user) => {
    const b = await json(c);
    if (typeof b.email !== "boolean") throw new AnnounceError(400, "Invalid value.");
    setEmailOptIn(user.id, b.email);
    return c.json(readerState(user.id));
  }));
  api.post("/announcements/:annId/dismiss", handle(false, (c, user) => { dismiss(user.id, c.req.param("annId") ?? ""); return c.json(readerState(user.id)); }));

  api.get("/announcements-admin", handle(true, (c, user) => c.json(adminState(user.id), 200, fresh)));
  api.post("/announcements-admin/preview", handle(true, async (c, user) => {
    if (previews.over(user.id)) throw new AnnounceError(429, "Too many requests. Wait a minute and try again.");
    const b = await json(c);
    return c.json({ ok: true, ...previewAnnouncement(b, Date.now(), typeof b.id === "string" ? b.id : undefined) });
  }));
  api.post("/announcements-admin", handle(true, async (c, user) => {
    const row = createAnnouncement(user.id, await json(c));
    dispatchSoon();
    return c.json({ id: row.id, ...adminState(user.id) });
  }));
  api.put("/announcements-admin/:annId", handle(true, async (c, user) => {
    const row = updateAnnouncement(user.id, c.req.param("annId") ?? "", await json(c));
    dispatchSoon();
    return c.json({ id: row.id, ...adminState(user.id) });
  }));
  api.post("/announcements-admin/:annId/archive", handle(true, (c, user) => { archiveAnnouncement(user.id, c.req.param("annId") ?? ""); return c.json(adminState(user.id)); }));
}
