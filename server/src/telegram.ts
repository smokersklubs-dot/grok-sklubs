import { seal, unseal } from "./auth.js";
import { onTurnEvent, submitUserMessage } from "./agent/loop.js";
import { config } from "./config.js";
import { audit, bots, randomToken, rows, type BotRecord } from "./store.js";
import type { TelegramStatus } from "./shared.js";

/**
 * Lets a bot be reached through a Telegram bot of the user's own (created with Telegram's BotFather).
 * Only one Telegram chat — the one that sent the link code — can talk to it. Messages are fetched by
 * asking Telegram for news, so the server needs no public address for this.
 */
async function call<T>(token: string, method: string, body?: Record<string, unknown>, signal?: AbortSignal): Promise<T> {
  const res = await fetch(`${config.telegramApi}/bot${token}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}),
    signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(40_000)]) : AbortSignal.timeout(40_000),
  });
  const data = (await res.json().catch(() => ({}))) as { ok?: boolean; result?: T; description?: string };
  if (!res.ok || !data.ok) throw new Error(data.description ?? `Telegram answered ${res.status}`);
  return data.result as T;
}

const tokenOf = (bot: BotRecord) => (bot.telegramTokenEnc ? unseal(bot.telegramTokenEnc) : null);

export async function send(bot: BotRecord, text: string) {
  const token = tokenOf(bot);
  if (!token || !bot.telegramChatId) return;
  // Telegram refuses messages over 4096 characters.
  for (let i = 0; i < text.length; i += 4000) await call(token, "sendMessage", { chat_id: bot.telegramChatId, text: text.slice(i, i + 4000) }).catch((err) => console.error("[telegram send]", err.message));
}

const polls = new Map<string, AbortController>();

function startPolling(botId: string) {
  stopPolling(botId);
  const stop = new AbortController();
  polls.set(botId, stop);
  void (async () => {
    while (!stop.signal.aborted) {
      const bot = bots.byId(botId);
      const token = bot ? tokenOf(bot) : null;
      if (!bot || !token) break;
      try {
        const updates = await call<{ update_id: number; message?: { text?: string; chat: { id: number; type: string } } }[]>(token, "getUpdates", { offset: bot.telegramOffset, timeout: 25, allowed_updates: ["message"] }, stop.signal);
        for (const u of updates) {
          bots.setTelegramOffset(botId, u.update_id + 1);
          if (u.message?.text && u.message.chat.type === "private") await receive(botId, String(u.message.chat.id), u.message.text.trim(), token);
        }
      } catch (err) {
        if (stop.signal.aborted) break;
        await new Promise((r) => setTimeout(r, 5000));
      }
    }
  })();
}
function stopPolling(botId: string) {
  polls.get(botId)?.abort();
  polls.delete(botId);
}

async function receive(botId: string, chatId: string, text: string, token: string) {
  const bot = bots.byId(botId);
  if (!bot) return;
  const reply = (t: string) => call(token, "sendMessage", { chat_id: chatId, text: t }).catch(() => {});
  if (!bot.telegramChatId) {
    // Not linked yet: only the person who has the code from the Sklubot screen can claim this bot.
    if (bot.telegramCode && text === `/start ${bot.telegramCode}`) {
      bots.linkTelegram(botId, chatId);
      audit(bot.userId, "channel", `${bot.name}: Telegram linked`, bot.id);
      bots.announce(bot);
      await reply(`✅ ${bot.name}`);
    } else await reply("🔒 /start <code>");
    return;
  }
  if (chatId !== bot.telegramChatId) { await reply("🔒"); return; }
  if (text.startsWith("/start")) return;
  rows.append(bot, { kind: "message", role: "user", text });
  submitUserMessage(bot, text, false, [], "telegram");
}

export const telegram = {
  status(bot: BotRecord): TelegramStatus {
    return { connected: !!bot.telegramTokenEnc, username: bot.telegram, linked: !!bot.telegramChatId, linkCode: bot.telegramChatId ? null : bot.telegramCode };
  },
  async connect(bot: BotRecord, token: string): Promise<TelegramStatus> {
    const me = await call<{ username?: string }>(token.trim(), "getMe");
    if (!me.username) throw new Error("Telegram did not recognise this token.");
    bots.setTelegram(bot.id, { tokenEnc: seal(token.trim()), username: me.username, code: randomToken(6) });
    audit(bot.userId, "channel", `${bot.name}: Telegram bot @${me.username} connected`, bot.id);
    startPolling(bot.id);
    bots.announce(bot);
    return telegram.status(bots.byId(bot.id)!);
  },
  disconnect(bot: BotRecord) {
    stopPolling(bot.id);
    bots.setTelegram(bot.id, { tokenEnc: null, username: null });
    audit(bot.userId, "channel", `${bot.name}: Telegram disconnected`, bot.id);
    bots.announce(bot);
  },
  start() {
    for (const bot of bots.withTelegram()) startPolling(bot.id);
    // What a bot says on its own initiative, and what it is waiting for, reaches the user's phone.
    onTurnEvent((e) => {
      const own = bots.byId(e.bot.id);
      if (own?.telegramChatId) { void send(own, e.type === "waiting" ? `⏳ ${e.text}` : e.text); return; }
      const main = bots.primary(e.bot.userId);
      if (main?.telegramChatId && main.id !== e.bot.id) void send(main, `${e.type === "waiting" ? "⏳ " : ""}[${e.bot.name}] ${e.text}`);
    });
  },
  stopAll() { for (const id of [...polls.keys()]) stopPolling(id); },
  /** A short message to the user's phone through their main bot, if it is linked. */
  notifyUser(userId: string, text: string) {
    const main = bots.primary(userId);
    if (main?.telegramChatId) void send(main, text);
  },
};
