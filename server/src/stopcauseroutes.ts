import type { Hono } from "hono";
import { tr } from "./i18n.js";
import { bots, rows, type UserRecord } from "./store.js";
import { stopCauseOf, type StopCauseView } from "./stopcause.js";

/**
 * L142, registered after the session check (routes.ts):
 *   GET /bots/stop-causes   { causes: { [botId]: StopCauseView } } — why each of the caller's own agent bots stopped last
 *   (bots with nothing to say are left out). Reads the last 40 rows of each main chat; read-only.
 */
export function registerStopCauseRoutes(api: Hono<any>) {
  api.get("/bots/stop-causes", (c) => {
    const user = c.get("user") as UserRecord;
    const words = [...new Set(["Stopped.", tr("fr", "Stopped."), tr("en", "Stopped."), tr(user.locale, "Stopped.")])];
    const causes: Record<string, StopCauseView> = {};
    for (const b of bots.list(user.id)) {
      if (b.kind !== "agent") continue;
      const v = stopCauseOf(rows.list(b.id, b.generation, 40), words);
      if (v) causes[b.id] = v;
    }
    return c.json({ causes });
  });
}
