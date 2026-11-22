/**
 * L162: the owner's settings of a bot's extra channels (Slack, Discord, IMAP) and of who else may talk to it (access
 * requests, allow-list), under /bots/:id/channels and /bots/:id/contacts. Owner only (ownAgent: a shared bot's members,
 * other accounts and API keys never reach these); tokens and passwords go in, never come back out.
 */
import type { Context, Hono } from "hono";
import { access, publicContact } from "./channelaccess.js";
import { CONTACT_CHANNELS, type BotChannels, type ContactChannel } from "./channeltypes.js";
import { discord, DiscordError } from "./discord.js";
import { checkMailbox, imap, ImapSetupError } from "./imapwatch.js";
import { slack, SlackError } from "./slack.js";
import { body } from "./routeinput.js";
import type { BotRecord, UserRecord } from "./store.js";

const ID_FORMAT: Record<ContactChannel, RegExp> = { telegram: /^\d{1,20}$/, slack: /^[UW][A-Z0-9]{6,20}$/, discord: /^\d{15,25}$/ };

const FR: [RegExp, string][] = [
  [/^The bot token starts with xoxb-/, "Le jeton du bot commence par xoxb- (OAuth & Permissions → Bot User OAuth Token)."],
  [/^The app-level token starts with xapp-/, "Le jeton d'application commence par xapp- (Basic Information → App-Level Tokens, autorisation connections:write)."],
  [/^Slack refused the bot token \((.*)\)\.$/, "Slack refuse le jeton du bot ($1)."],
  [/^Slack refused the app-level token \((.*)\)\. Is Socket Mode on\?$/, "Slack refuse le jeton d'application ($1). Le Socket Mode est-il activé ?"],
  [/^That does not look like a Discord bot token/, "Ce n'est pas un jeton de bot Discord (Developer Portal → ton application → Bot → Reset Token)."],
  [/^Discord refused this token \((.*)\)\.$/, "Discord refuse ce jeton ($1)."],
  [/^This token is not a bot's\.$/, "Ce jeton n'est pas celui d'un bot."],
  [/^Enter the IMAP server name/, "Indique le nom du serveur IMAP (ex. imap.exemple.fr)."],
  [/^Enter a valid port/, "Indique un port valide (souvent 993)."],
  [/^Enter the mailbox user name/, "Indique l'identifiant de la boîte (souvent l'adresse e-mail)."],
  [/^That folder name is too long\.$/, "Ce nom de dossier est trop long."],
  [/^Enter the password/, "Indique le mot de passe (un mot de passe d'application si le fournisseur en demande un)."],
  [/^The server refused this user name or password\.$/, "Le serveur refuse cet identifiant ou ce mot de passe."],
  [/^Could not open the mailbox: (.*)$/, "Impossible d'ouvrir la boîte : $1"],
  [/^The server (.*) cannot be found\.$/, "Le serveur $1 est introuvable."],
  [/^The server (.*) points to a private address: refused\.$/, "Le serveur $1 pointe vers une adresse privée : refusé."],
  [/^That is not an email address\.$/, "Ce n'est pas une adresse e-mail."],
  [/^No waiting request has this code/, "Aucune demande en attente n'a ce code (il a peut-être expiré : une demande dure 1 heure)."],
  [/^Choose Telegram, Slack or Discord\.$/, "Choisis Telegram, Slack ou Discord."],
  [/^That id does not look right for this service\.$/, "Cet identifiant ne correspond pas à ce service."],
  [/^That person is not on the list\.$/, "Cette personne n'est pas dans la liste."],
];
const say = (loc: string | undefined, msg: string) => {
  if (loc !== "fr") return msg;
  for (const [re, fr] of FR) { const m = re.exec(msg); if (m) return fr.replace(/\$(\d)/g, (_s, i: string) => m[Number(i)] ?? ""); }
  return msg;
};

export function registerChannelRoutes(api: Hono<any>, ownAgent: (c: Context) => BotRecord) {
  const refuse = (c: Context, err: unknown, status: 400 | 404 = 400) => {
    if (!(err instanceof SlackError || err instanceof DiscordError || err instanceof ImapSetupError || err instanceof ChannelInputError)) throw err;
    return c.json({ error: say((c.get("user") as UserRecord | undefined)?.locale, err.message) }, err instanceof ChannelInputError ? err.status : status);
  };
  const all = (bot: BotRecord): BotChannels => ({ slack: slack.status(bot), discord: discord.status(bot), imap: imap.status(bot), contacts: access.list(bot.id).map(publicContact) });

  api.get("/bots/:id/channels", (c) => c.json(all(ownAgent(c))));
  api.put("/bots/:id/channels/slack", async (c) => { const bot = ownAgent(c); try { await slack.connect(bot, await body(c)); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });
  api.delete("/bots/:id/channels/slack", (c) => { const bot = ownAgent(c); slack.disconnect(bot); return c.json(all(bot)); });
  api.put("/bots/:id/channels/discord", async (c) => { const bot = ownAgent(c); try { await discord.connect(bot, await body(c)); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });
  api.delete("/bots/:id/channels/discord", (c) => { const bot = ownAgent(c); discord.disconnect(bot); return c.json(all(bot)); });
  api.put("/bots/:id/channels/imap", async (c) => { const bot = ownAgent(c); try { await imap.connect(bot, await body(c)); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });
  api.delete("/bots/:id/channels/imap", (c) => { const bot = ownAgent(c); imap.disconnect(bot); return c.json(all(bot)); });
  api.post("/bots/:id/channels/imap/check", async (c) => { const bot = ownAgent(c); const taken = await checkMailbox(bot.id); return c.json({ taken, channels: all(bot) }); });
  api.post("/bots/:id/channels/imap/senders", async (c) => { const bot = ownAgent(c); try { imap.approveSender(bot, String((await body(c)).address ?? "")); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });

  // Access requests and the allow-list (channelaccess.ts).
  api.post("/bots/:id/contacts/approve", async (c) => {
    const bot = ownAgent(c);
    try {
      if (!access.approve(bot, String((await body(c)).code ?? ""))) throw new ChannelInputError("No waiting request has this code (it may have lapsed: a request lasts 1 hour).", 404);
      return c.json(all(bot));
    } catch (err) { return refuse(c, err); }
  });
  api.post("/bots/:id/contacts", async (c) => {
    const bot = ownAgent(c);
    try {
      const b = await body(c);
      const channel = String(b.channel ?? "") as ContactChannel;
      if (!(CONTACT_CHANNELS as readonly string[]).includes(channel)) throw new ChannelInputError("Choose Telegram, Slack or Discord.");
      const externalId = String(b.externalId ?? "").trim();
      if (!ID_FORMAT[channel].test(externalId)) throw new ChannelInputError("That id does not look right for this service.");
      access.allow(bot, channel, externalId, String(b.name ?? ""));
      return c.json(all(bot));
    } catch (err) { return refuse(c, err); }
  });
  api.post("/bots/:id/contacts/:cid/block", (c) => { const bot = ownAgent(c); try { if (!access.block(bot, c.req.param("cid") ?? "")) throw new ChannelInputError("That person is not on the list.", 404); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });
  api.delete("/bots/:id/contacts/:cid", (c) => { const bot = ownAgent(c); try { if (!access.remove(bot, c.req.param("cid") ?? "")) throw new ChannelInputError("That person is not on the list.", 404); return c.json(all(bot)); } catch (err) { return refuse(c, err); } });
}

class ChannelInputError extends Error { constructor(msg: string, readonly status: 400 | 404 = 400) { super(msg); } }

/** Starts the channels' connections at boot (index.ts), and stops them on shutdown. */
export const channels = {
  start() { slack.start(); discord.start(); imap.start(); },
  stopAll() { slack.stopAll(); discord.stopAll(); imap.stopAll(); },
};
