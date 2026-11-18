import type { Context, Hono } from "hono";
import { tr } from "../i18n.js";
import { FAILURE_REMEDIES } from "../shared.js";
import { audit, bots, type BotRecord, type UserRecord } from "../store.js";
import { screen } from "../computer.js";
import { engineLogin, engineOf, isEngineRef } from "./engine.js";
import { actOnFailure, FailureActionRefused, failures, retryOutage, type FailureAction } from "./failures.js";

/**
 * « Coordinateur d'échecs » (agent/failures.ts) — the routes. Behind the session like every /api route; /bots/:id is the
 * caller's own bot or a 404 (a group chat: 400), and an incident is acted on only through its own bot, so no account
 * ever sees or touches another's incidents.
 *
 *  GET  /bots/:id/failures                    the bot's « Incidents » (Activité tab), newest first
 *  POST /bots/:id/failures/:failureId         { action: retry | continue_without | restart_computer | handoff | reconnect | connect_account | switch_model | dismiss }
 *  POST /failures/outages/retry { provider }  « Réessayer maintenant » on an outage notice (Aujourd'hui): the account's bots waiting on it
 */
type Env = { Variables: { user: UserRecord } };
const err = (c: Context, status: 400 | 404 | 409 | 502, error: string) => c.json({ error }, status);
const ownAgent = (c: Context<Env>): BotRecord | "missing" | "room" => {
  const b = bots.owned(c.get("user").id, c.req.param("id") ?? "");
  return !b ? "missing" : b.kind === "agent" ? b : "room";
};
const ACTIONS = new Set<string>([...FAILURE_REMEDIES, "dismiss"]);

export function registerFailureRoutes(api: Hono<Env>) {
  api.get("/bots/:id/failures", (c) => {
    const bot = ownAgent(c);
    if (bot === "missing") return err(c, 404, "That bot does not exist.");
    if (bot === "room") return c.json({ failures: [] });
    return c.json({ failures: failures.list(bot.id) });
  });

  api.post("/bots/:id/failures/:failureId", async (c) => {
    const bot = ownAgent(c);
    if (bot === "missing") return err(c, 404, "That bot does not exist.");
    if (bot === "room") return err(c, 400, "A group chat cannot do that.");
    const b = await c.req.json().catch(() => ({}));
    const action = String((b as { action?: unknown })?.action ?? "");
    if (!ACTIONS.has(action)) return err(c, 400, "Unknown action.");
    const loc = c.get("user").locale;
    // « Reconnecter mon compte ChatGPT / Claude »: the engine's own sign-in on the bot's computer (engine.ts engineLogin).
    if (action === "reconnect") {
      if (!isEngineRef(bot.model)) return err(c, 409, tr(loc, "This bot does not run on a subscription."));
      const engine = engineOf(bot.model);
      try { await engineLogin(bot, engine); } catch (e) { return err(c, 502, (e as Error).message); }
      audit(bot.userId, "account", `${bot.name}: sign-in to ${engine === "codex" ? "ChatGPT" : "Claude"} started from an incident card`, bot.id);
    }
    try {
      const failure = await actOnFailure(bot, c.req.param("failureId") ?? "", action as FailureAction, { restart: async (x) => { await screen.sleep(x.id); } });
      return c.json({ failure, ...(action === "reconnect" ? { openViewer: true } : {}) });
    } catch (e) {
      if (e instanceof FailureActionRefused) return err(c, 409, e.message);
      throw e;
    }
  });

  api.post("/failures/outages/retry", async (c) => {
    const provider = (await c.req.json().catch(() => ({})) as { provider?: unknown })?.provider;
    if (typeof provider !== "string" || !provider) return err(c, 400, "provider is required.");
    return c.json({ retried: retryOutage(c.get("user").id, provider) });
  });
}
