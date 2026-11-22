import type { Context, Hono } from "hono";
import { tr } from "./i18n.js";
import { body, fail } from "./routeinput.js";
import { audit, bots, type UserRecord } from "./store.js";
import { telegramVoiceText } from "./telegramvoice.js";
import { commandStops } from "./commandstop.js";
import { chatMutes, MUTE_HOURS, type MuteChoice } from "./chatmute.js";

/**
 * Small owner settings added in the 22/11 comfort batch, registered after the session check (routes.ts):
 *   GET /bots/:id/telegram/voice-text   { enabled, provider, cost, maxSeconds } — Telegram voice notes written out (off by default)
 *   PUT /bots/:id/telegram/voice-text   { enabled: boolean }
 *   POST /bots/:id/commands/:ref/stop   the Stop button on a running command's line (commandstop.ts) → { stopped }
 *   GET /bots/:id/mute   { muted, until } — « Sourdine » for that chat's notifications (chatmute.ts)
 *   PUT /bots/:id/mute   { mute: "8h" | "forever" | "off" }
 * Only the bot's owner (404 otherwise).
 */
export function registerComfortRoutes(api: Hono<any>) {
  const ownBot = (c: Context) => {
    const user = c.get("user") as UserRecord;
    const bot = bots.owned(user.id, c.req.param("id") ?? "");
    if (!bot || bot.kind !== "agent") fail(404, "That bot does not exist.");
    return { user, bot: bot! };
  };
  api.get("/bots/:id/telegram/voice-text", (c) => { const { bot } = ownBot(c); return c.json(telegramVoiceText.view(bot)); });
  api.put("/bots/:id/telegram/voice-text", async (c) => {
    const { user, bot } = ownBot(c);
    const b = await body(c);
    if (typeof b.enabled !== "boolean") fail(400, "enabled must be true or false.");
    telegramVoiceText.set(bot.id, b.enabled === true);
    audit(user.id, "channel", tr(user.locale, b.enabled ? "{bot}: Telegram voice notes will be written out" : "{bot}: Telegram voice notes no longer written out", { bot: bot.name }), bot.id);
    return c.json(telegramVoiceText.view(bot));
  });
  api.get("/bots/:id/mute", (c) => { const { user, bot } = ownBot(c); return c.json(chatMutes.view(user.id, bot.id)); });
  api.put("/bots/:id/mute", async (c) => {
    const { user, bot } = ownBot(c);
    const b = await body(c);
    const choice = b.mute as MuteChoice;
    if (choice !== "off" && !Object.hasOwn(MUTE_HOURS, String(choice))) fail(400, "mute must be 8h, forever or off.");
    chatMutes.set(user.id, bot.id, choice);
    return c.json(chatMutes.view(user.id, bot.id));
  });
  api.post("/bots/:id/commands/:ref/stop", (c) => {
    const { user, bot } = ownBot(c);
    return c.json({ stopped: commandStops.stop(user.id, bot.id, c.req.param("ref") ?? "") });
  });
}
