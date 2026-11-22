import type { Context, Hono } from "hono";
import { changeNote, historyOf, NoteError, restoreNote, trashNote } from "./agent/memorybook.js";
import { body } from "./routeinput.js";
import type { UserRecord } from "./store.js";

/**
 * One memory note of the owner's (agent/memorybook.ts), registered after the session check. Only the owner of the note's
 * bot reaches it; anyone else gets 404.
 *   PATCH  /memories/:id           { text?, status?, confidence? } edit the text (kept in its history), status, confidence
 *   DELETE /memories/:id           « Oublier »: into the bin for TRASH_DAYS days
 *   POST   /memories/:id/restore   « Annuler »: the same note back (same id and dates)
 *   GET    /memories/:id/history   what changed, oldest first
 */
export function registerMemoryNoteRoutes(api: Hono<any>) {
  const handle = (fn: (c: Context, user: UserRecord, id: string) => Promise<Response> | Response) => async (c: Context) => {
    const user = c.get("user") as UserRecord;
    try { return await fn(c, user, c.req.param("id") ?? ""); } catch (err) {
      if (err instanceof NoteError) return c.json({ error: err.message }, err.status);
      throw err;
    }
  };
  api.patch("/memories/:id", handle(async (c, user, id) => c.json({ memory: changeNote(user, id, await body(c)) })));
  api.delete("/memories/:id", handle((c, user, id) => { trashNote(user.id, id); return c.json({ ok: true }); }));
  api.post("/memories/:id/restore", handle((c, user, id) => c.json({ memory: restoreNote(user.id, id) })));
  api.get("/memories/:id/history", handle((c, user, id) => {
    const history = historyOf(user.id, id);
    return history ? c.json({ history }) : c.json({ error: "That memory does not exist." }, 404);
  }));
}
