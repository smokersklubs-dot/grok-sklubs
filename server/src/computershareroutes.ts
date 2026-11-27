import type { Context, Hono } from "hono";
import { decideApproval } from "./agent/loop.js";
import { allBotsControl, botDevice, isControlCard } from "./computershare.js";
import { tr } from "./i18n.js";
import { deviceKindOf, devices, labelOf, liveDevice } from "./relay.js";
import { body, fail } from "./routeinput.js";
import { approvals, audit, bots, type UserRecord } from "./store.js";

/**
 * « Un ordinateur pour tous mes bots » (computershare.ts), the owner's side. Behind the session like every /api route;
 * each account only ever sees and changes its own bots and computers (another account's id is a 404).
 *
 *  GET    /bots/:id/computer   « Ordinateur de ce bot »: the choice (null = « Celui qui est connecté ») and the linked devices
 *  PUT    /bots/:id/computer   { deviceId: string | null }
 *  GET    /relay/all-bots      { on }: may every bot take control without a new card (Settings → Computers)
 *  DELETE /relay/all-bots      « Retirer »: each bot is asked again (its own "Always" still counts)
 *
 * The yes itself comes through POST /approvals/:approvalId { decision: "allbots" } (routes.ts) → decideForAllBots.
 */
type Env = { Variables: { user: UserRecord } };

export function registerComputerShareRoutes(api: Hono<Env>) {
  const ownBot = (c: Context<Env>) => {
    const user = c.get("user");
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot) fail(404, tr(user.locale, "This bot does not exist."));
    return { user, bot: bot! };
  };
  const view = (userId: string, botId: string) => ({
    deviceId: botDevice.get(userId, botId),
    devices: devices.list(userId).map((d) => ({ id: d.id, name: d.name, label: labelOf(d), kind: deviceKindOf(d), online: !!liveDevice(userId, d.id) })),
  });
  api.get("/bots/:id/computer", (c) => { const { user, bot } = ownBot(c); return c.json(view(user.id, bot.id)); });
  api.put("/bots/:id/computer", async (c) => {
    const { user, bot } = ownBot(c);
    const raw = (await body(c)).deviceId;
    const deviceId = typeof raw === "string" && raw.trim() ? raw.trim() : null;
    if (raw !== null && raw !== undefined && typeof raw !== "string") fail(400, "deviceId must be a string or null.");
    const device = deviceId ? devices.owned(user.id, deviceId) : null;
    if (deviceId && !device) fail(404, tr(user.locale, "That computer is not linked to your account."));
    botDevice.set(bot.id, device ? device.id : null);
    audit(user.id, "computer", device ? tr(user.locale, "{bot} now uses the computer {device}.", { bot: bot.name, device: labelOf(device) }) : tr(user.locale, "{bot} now uses the computer that is connected.", { bot: bot.name }), bot.id);
    return c.json(view(user.id, bot.id));
  });
  api.get("/relay/all-bots", (c) => c.json({ on: allBotsControl.on(c.get("user").id) }));
  api.delete("/relay/all-bots", (c) => {
    const user = c.get("user");
    if (allBotsControl.on(user.id)) {
      allBotsControl.set(user.id, false);
      audit(user.id, "approval", tr(user.locale, "Your bots must ask again before taking control of a computer."));
    }
    return c.json({ on: false });
  });
}

/**
 * The owner pressed « Pour tous mes bots » on the card that asks to take control of a computer: a yes for this card
 * (decideApproval, as "once"), then the account policy — only when this answer allowed it, on a control card.
 * A workspace admin answering for the owner never reaches here (routes.ts counts their answer as once).
 */
export function decideForAllBots(user: UserRecord, approvalId: string): boolean {
  const before = approvals.byId(approvalId);
  if (!before || before.userId !== user.id) return false;
  if (!isControlCard(before.tool)) fail(400, tr(user.locale, "Only an approval to take control of a computer can be given for all your bots."));
  const wasPending = before.status === "pending";
  if (!decideApproval(user.id, approvalId, "allow")) return false;
  if (wasPending && approvals.byId(approvalId)?.status === "allowed") {
    allBotsControl.set(user.id, true);
    audit(user.id, "approval", tr(user.locale, "All your bots may now take control of your computers without a new card."), before.botId);
  }
  return true;
}
