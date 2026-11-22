import type { Hono } from "hono";
import { tr } from "./i18n.js";
import { body, fail } from "./routeinput.js";
import type { UserRecord } from "./store.js";
import { cleanCommands, COMMAND_LIMITS, personalCommands } from "./personalcommands.js";

/**
 * L152, registered after the session check (routes.ts):
 *   GET /me/commands   { commands: PersonalCommand[], limits }
 *   PUT /me/commands   { commands: PersonalCommand[] } → the saved list (400 with a sentence when a command is refused)
 * The caller's own list only.
 */
export function registerPersonalCommandRoutes(api: Hono<any>) {
  api.get("/me/commands", (c) => {
    const user = c.get("user") as UserRecord;
    return c.json({ commands: personalCommands.list(user.id), limits: COMMAND_LIMITS });
  });
  api.put("/me/commands", async (c) => {
    const user = c.get("user") as UserRecord;
    const b = await body(c);
    const r = cleanCommands(b.commands);
    if (!r.ok) return fail(400, tr(user.locale, r.error));
    personalCommands.save(user.id, r.list);
    return c.json({ commands: personalCommands.list(user.id), limits: COMMAND_LIMITS });
  });
}
