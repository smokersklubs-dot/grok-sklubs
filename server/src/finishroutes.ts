import type { Context, Hono } from "hono";
import { applyTheme, removeTheme, ThemeError, themesView } from "./botthemes.js";
import { globalRecap } from "./globalrecap.js";
import { notesArchive } from "./notesarchive.js";
import { fail } from "./routeinput.js";
import { audit, bots, type UserRecord } from "./store.js";

/**
 * L161 (second half), after the session check:
 *   GET    /themes                   the themes the bots proposed, the one applied (botthemes.ts)
 *   POST   /themes/:themeId/apply    apply one (refused if it fails the contrast check)
 *   POST   /themes/reset             back to the app's own colours
 *   DELETE /themes/:themeId          remove one
 *   GET    /recap?days=7             one recap of every bot (globalrecap.ts)
 *   GET    /bots/:id/notes.zip       the bot's notes as plain Markdown files (notesarchive.ts)
 * Each answers for the caller's own account only; anything else is 404.
 */
export function registerFinishRoutes(api: Hono<any>) {
  const user = (c: Context) => c.get("user") as UserRecord;
  const themed = (fn: (c: Context) => unknown) => (c: Context) => {
    try { return c.json(fn(c) as object); } catch (err) { if (err instanceof ThemeError) return c.json({ error: err.message }, err.status); throw err; }
  };
  api.get("/themes", themed((c) => themesView(user(c).id)));
  api.post("/themes/reset", themed((c) => applyTheme(user(c).id, null)));
  api.post("/themes/:themeId/apply", themed((c) => applyTheme(user(c).id, c.req.param("themeId") ?? "")));
  api.delete("/themes/:themeId", themed((c) => removeTheme(user(c).id, c.req.param("themeId") ?? "")));
  api.get("/recap", (c) => c.json(globalRecap(user(c).id, { days: c.req.query("days"), locale: user(c).locale })));
  api.get("/bots/:id/notes.zip", (c) => {
    const u = user(c);
    const bot = bots.owned(u.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") return fail(404, "That bot does not exist.");
    const a = notesArchive(bot!, u.locale);
    audit(u.id, "account", u.locale === "fr" ? `${bot!.name} : notes exportées en fichiers Markdown (${a.files.length} fichiers)` : `${bot!.name}: notes exported as Markdown files (${a.files.length} files)`, bot!.id);
    return new Response(new Uint8Array(a.zip), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="notes.zip"; filename*=UTF-8''${encodeURIComponent(a.name)}`, "cache-control": "no-store" } });
  });
}
