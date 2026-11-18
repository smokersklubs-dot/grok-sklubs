import type { Context, Hono } from "hono";
import { modelLabel } from "../llm/index.js";
import type { Locale } from "../shared.js";
import { audit, bots, type BotRecord, type UserRecord } from "../store.js";
import { offerReaction, reroute, RerouteRefused, roomRouting, routingModelRef } from "./roomrouting.js";

/**
 * « Qui répond » in a group chat (agent/roomrouting.ts). Behind the session; /bots/:id is the caller's own group chat or a
 * 404 (a bot that is not a group: 400), so no one changes or re-routes someone else's group.
 *
 *  GET  /bots/:id/routing                   { routing: { discreet, askFirst }, model: label of the quick model | null }
 *  PUT  /bots/:id/routing                   { discreet?, askFirst? } → the same
 *  POST /bots/:id/rows/:seq/reroute         { botId } « Plutôt demander à… » under a routed message's line
 */
type Env = { Variables: { user: UserRecord } };
const FR: Record<string, string> = {
  "That group chat does not exist.": "Ce groupe n'existe pas.",
  "Only a group chat has this.": "Seul un groupe a ce réglage.",
  "There is no routed message here.": "Il n'y a pas de message aiguillé ici.",
  "That bot is not an available member of this group.": "Ce bot n'est pas un membre disponible de ce groupe.",
  "That bot already has the question.": "Ce bot a déjà la question.",
  "Too many tries. Wait a little and try again.": "Trop d'essais. Attends un peu et réessaie.",
  "The message is no longer there.": "Le message n'est plus là.",
  "discreet and askFirst must be true or false.": "discreet et askFirst doivent valoir true ou false.",
};
const say = (loc: Locale | undefined, en: string) => (loc === "fr" ? FR[en] ?? en : en);
const err = (c: Context<Env>, status: 400 | 404 | 409 | 429, en: string) => c.json({ error: say(c.get("user").locale, en) }, status);
const json = async (c: Context): Promise<Record<string, unknown>> => { const b = await c.req.json().catch(() => ({})); return b && typeof b === "object" ? b : {}; };
const ownRoom = (c: Context<Env>): BotRecord | "missing" | "agent" => {
  const b = bots.owned(c.get("user").id, c.req.param("id") ?? "");
  return !b ? "missing" : b.kind === "room" ? b : "agent";
};
const view = (room: BotRecord) => { const ref = routingModelRef(room.userId); return { routing: roomRouting.get(room.id), model: ref ? modelLabel(ref, room.userId) : null }; };

export function registerRoomRoutingRoutes(api: Hono<Env>) {
  api.get("/bots/:id/routing", (c) => {
    const room = ownRoom(c);
    if (room === "missing") return err(c, 404, "That group chat does not exist.");
    if (room === "agent") return err(c, 400, "Only a group chat has this.");
    return c.json(view(room));
  });

  api.put("/bots/:id/routing", async (c) => {
    const room = ownRoom(c);
    if (room === "missing") return err(c, 404, "That group chat does not exist.");
    if (room === "agent") return err(c, 400, "Only a group chat has this.");
    const b = await json(c);
    if ((b.discreet !== undefined && typeof b.discreet !== "boolean") || (b.askFirst !== undefined && typeof b.askFirst !== "boolean")) return err(c, 400, "discreet and askFirst must be true or false.");
    const next = roomRouting.set(room.id, { discreet: b.discreet as boolean | undefined, askFirst: b.askFirst as boolean | undefined });
    audit(room.userId, "account", `Group "${room.name}": discreet ${next.discreet ? "on" : "off"}, offer before starting ${next.askFirst ? "on" : "off"}`, room.id);
    return c.json(view(room));
  });

  api.post("/bots/:id/rows/:seq/reroute", async (c) => {
    const room = ownRoom(c);
    if (room === "missing") return err(c, 404, "That group chat does not exist.");
    if (room === "agent") return err(c, 400, "Only a group chat has this.");
    const botId = (await json(c)).botId;
    if (typeof botId !== "string") return err(c, 400, "That bot is not an available member of this group.");
    try { return c.json({ action: reroute(room, c.get("user"), Number(c.req.param("seq")), botId) }); }
    catch (e) {
      if (e instanceof RerouteRefused) return err(c, e.message.startsWith("Too many") ? 429 : 409, e.message);
      throw e;
    }
  });
}

/** A reaction in a group chat (routes.ts): a 👍 on a member's waiting offer says yes. */
export const roomReaction = (room: BotRecord, user: UserRecord, seq: number, emoji: string, on: boolean) => { if (on && room.kind === "room") offerReaction(room, user, seq, emoji); };
