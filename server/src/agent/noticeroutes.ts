import type { Context, Hono } from "hono";
import { bots, type BotRecord, type UserRecord } from "../store.js";
import { setLimitNotify } from "./sublimit.js";
import { chooseWatch, WatchChoiceRefused } from "./watch.js";

/**
 * The buttons under a bot's notices that are not cards (moved out of routes.ts). Behind the session like every /api
 * route; /bots/:id is the caller's own bot or a 404 (a group chat: 400), so no one acts on someone else's notice.
 *
 *  POST /bots/:id/rows/:seq/watch    { choice: "wait" | "switch" | "stop" }   the turn watch's notice (agent/watch.ts)
 *  POST /bots/:id/rows/:seq/sublimit { notify: boolean }                      "Me prévenir à la reprise" (agent/sublimit.ts)
 */
type Env = { Variables: { user: UserRecord } };
const err = (c: Context, status: 400 | 404 | 409, error: string) => c.json({ error }, status);
const ownAgent = (c: Context<Env>): BotRecord | "missing" | "room" => {
  const b = bots.owned(c.get("user").id, c.req.param("id") ?? "");
  return !b ? "missing" : b.kind === "agent" ? b : "room";
};
const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b : {}; };

export function registerNoticeRoutes(api: Hono<Env>) {
  /**
   * A choice under a notice of the turn watch (agent/watch.ts): "wait", "switch" (this message goes on with the next model
   * of the bot's chain) or "stop" (stopped after no progress, and picked back up).
   */
  api.post("/bots/:id/rows/:seq/watch", async (c) => {
    const bot = ownAgent(c);
    if (bot === "missing") return err(c, 404, "That bot does not exist.");
    if (bot === "room") return err(c, 400, "A group chat cannot do that.");
    const choice = (await json(c)).choice;
    if (choice !== "wait" && choice !== "switch" && choice !== "stop") return err(c, 400, "choice must be wait, switch or stop.");
    try { chooseWatch(bot, Number(c.req.param("seq")), choice); }
    catch (e) { if (e instanceof WatchChoiceRefused) return err(c, 409, e.message); throw e; }
    return c.json({ ok: true });
  });

  /** "Me prévenir à la reprise" under "your subscription is at its limit, your work waits": on or off. */
  api.post("/bots/:id/rows/:seq/sublimit", async (c) => {
    const bot = ownAgent(c);
    if (bot === "missing") return err(c, 404, "That bot does not exist.");
    if (bot === "room") return err(c, 400, "A group chat cannot do that.");
    const notify = (await json(c)).notify;
    if (typeof notify !== "boolean") return err(c, 400, "notify must be true or false.");
    if (!setLimitNotify(bot, Number(c.req.param("seq")), notify)) return err(c, 409, "There is no waiting subscription notice here.");
    return c.json({ ok: true, notify });
  });
}
