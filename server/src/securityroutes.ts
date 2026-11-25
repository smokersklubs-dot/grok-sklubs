import type { Context, Hono } from "hono";
import { botRecipients } from "./botmailrecipients.js";
import { browserFreshness } from "./browserfreshness.js";
import { ownerId } from "./googlelogin.js";
import { hostJournal } from "./netjournal.js";
import { securityTargets } from "./offensive.js";
import { body, fail } from "./routeinput.js";
import { securitySettings } from "./securitysettings.js";
import { bots, vault, type UserRecord } from "./store.js";
import { twoFactorOn } from "./twofactor.js"; import { checkFloorFactor, hasFloorFactor } from "./floorapproval.js"; import { hasPasskey } from "./passkeys.js";
import { vaultAccess } from "./vaultaccess.js";

/**
 * Lot 1 security routes, registered after the session check (routes.ts):
 *   GET  /security/settings                 the account's switches (securitysettings.ts) and whether two-factor is on
 *   PUT  /security/settings                 { floorSecondFactor?, netAlerts?, code? } — the second factor before floor
 *                                           approvals (L44) can be turned on only with two-factor sign-in on or a passkey,
 *                                           and turned off only with a current code or passkey proof (a stolen session cannot)
 *   GET  /security/browser                  the server's owner only: is the bots' browser behind (browserfreshness.ts, L48)
 *   GET  /bots/:id/security                 a bot's network journal (L39) and the hosts it may test (L38)
 *   PUT  /bots/:id/security/test-hosts      { hosts } (L38)
 *   GET  /bots/:id/email/recipients         who the bot may write to (L42): the owner, then the list
 *   PUT  /bots/:id/email/recipients         { recipients }
 *   GET  /vault/:id/access                  an item's allowed bots, "ask every time" and usage history (L41)
 *   PUT  /vault/:id/access                  { bots?, askEveryTime? }
 * Only the account's own bots and vault items (404 otherwise).
 */
export function registerSecurityRoutes(api: Hono<any>) {
  const userOf = (c: Context) => c.get("user") as UserRecord;
  const ownBot = (c: Context) => {
    const user = userOf(c);
    const bot = bots.byId(c.req.param("id") ?? "");
    if (!bot || bot.userId !== user.id || bot.kind !== "agent") fail(404, "That bot does not exist.");
    return { user, bot: bot! };
  };
  const ownItem = (c: Context) => {
    const user = userOf(c);
    const item = vault.owned(user.id, c.req.param("id") ?? "");
    if (!item) fail(404, "That vault item does not exist.");
    return { user, item: item! };
  };

  api.get("/security/settings", (c) => { const user = userOf(c); return c.json({ settings: securitySettings.get(user.id), twoFactor: twoFactorOn(user.id), passkey: hasPasskey(user.id) }); });
  api.put("/security/settings", async (c) => {
    const user = userOf(c);
    const b = await body(c);
    const cur = securitySettings.get(user.id);
    if (b.floorSecondFactor !== undefined && typeof b.floorSecondFactor !== "boolean") fail(400, "floorSecondFactor must be true or false.");
    if (b.netAlerts !== undefined && typeof b.netAlerts !== "boolean") fail(400, "netAlerts must be true or false.");
    if (b.floorSecondFactor === true && !cur.floorSecondFactor && !hasFloorFactor(user.id)) fail(409, "Turn on two-factor sign-in (Settings → Account) or add a passkey first.");
    if (b.floorSecondFactor === false && cur.floorSecondFactor && hasFloorFactor(user.id) && !checkFloorFactor(user.id, b.code, "floor-off")) fail(401, "Type the current code of your two-factor app (or use your passkey) to turn this off.");
    return c.json({ settings: securitySettings.set(user.id, { floorSecondFactor: b.floorSecondFactor, netAlerts: b.netAlerts }), twoFactor: twoFactorOn(user.id), passkey: hasPasskey(user.id) });
  });
  api.get("/security/browser", async (c) => {
    if (ownerId() !== userOf(c).id) fail(403, "Only the owner of this server can see this.");
    return c.json({ browser: await browserFreshness(c.req.query("refresh") === "1") });
  });

  api.get("/bots/:id/security", (c) => { const { bot } = ownBot(c); return c.json({ hosts: hostJournal(bot.id), testHosts: securityTargets.get(bot.id) }); });
  api.put("/bots/:id/security/test-hosts", async (c) => { const { bot } = ownBot(c); return c.json({ testHosts: securityTargets.set(bot, (await body(c)).hosts) }); });
  api.get("/bots/:id/email/recipients", (c) => { const { bot } = ownBot(c); return c.json({ owner: botRecipients.owner(bot), recipients: botRecipients.get(bot.id) }); });
  api.put("/bots/:id/email/recipients", async (c) => { const { bot } = ownBot(c); return c.json({ owner: botRecipients.owner(bot), recipients: botRecipients.set(bot, (await body(c)).recipients) }); });

  api.get("/vault/:id/access", (c) => { const { item } = ownItem(c); return c.json({ access: vaultAccess.get(item.id), history: vaultAccess.history(item.id) }); });
  api.put("/vault/:id/access", async (c) => {
    const { user, item } = ownItem(c);
    const b = await body(c);
    if (b.bots !== undefined && !Array.isArray(b.bots)) fail(400, "bots must be a list.");
    if (b.askEveryTime !== undefined && typeof b.askEveryTime !== "boolean") fail(400, "askEveryTime must be true or false.");
    return c.json({ access: vaultAccess.set(user.id, item.id, { bots: b.bots, askEveryTime: b.askEveryTime }), history: vaultAccess.history(item.id) });
  });
}
