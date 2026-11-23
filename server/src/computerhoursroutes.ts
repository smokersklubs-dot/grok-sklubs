import type { Context, Hono } from "hono";
import { hoursView, setOwnCap } from "./computerhours.js";
import { emit } from "./bus.js";
import { fail } from "./routeinput.js";
import { tr } from "./i18n.js";
import { audit, type UserRecord } from "./store.js";

type E = { Variables: { user: UserRecord } };

/**
 * L95 — the account's computer hours this month and its own cap (computerhours.ts): GET; PUT { hours } sets it
 * (null, "" or 0 removes it). The operator's cap for hosted customers is set with COMPUTER_HOURS_MONTH and only shown.
 */
export function registerComputerHoursRoutes(api: Hono<E>) {
  api.get("/usage/computer-hours", (c) => c.json(hoursView(c.get("user").id)));
  api.put("/usage/computer-hours", async (c: Context<E>) => {
    const user = c.get("user");
    const b = (await c.req.json().catch(() => ({}))) as { hours?: unknown };
    let view;
    try { view = setOwnCap(user.id, b.hours); } catch { return fail(400, tr(user.locale, "Give a number of hours between 0 and 744 (0: no cap).")); }
    audit(user.id, "account", view.ownCapHours === null ? "Computer hours cap removed" : `Computer hours cap set: ${view.ownCapHours} h per month`);
    emit(user.id, { type: "usage" });
    return c.json(view);
  });
}
