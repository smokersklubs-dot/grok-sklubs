import { seal, unseal } from "./auth.js";
import { getLive } from "./bus.js";
import { decideApproval, interrupt, onTurnEvent, submitUserMessage } from "./agent/loop.js";
import { holdAndOffer, screen as screenSecrets } from "./pastedsecrets.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import type { ReactionEmoji, TelegramStatus } from "./shared.js";
import { REACTIONS } from "./shared.js";
import { approvals, audit, bots, clip, feedback, memories, now, randomToken, rows, tasks, users, type BotRecord } from "./store.js";

/**
 * Lets a bot be reached through a Telegram bot of the user's own (created with Telegram's BotFather).
 * Only one Telegram chat — the one that sent the link code — can talk to it. Messages are fetched by
 * asking Telegram for news, so the server needs no public address for this.
 *
 * Wave 5b (spec 07 A17, adapted): channel commands — /taches, /etat, /stop, /usage, /memoire (and /aide) — answered
 * by the server itself without calling the model; reactions both ways: 👍/👎 on an approval request answers it (never
 * for a payment or a file on the user's computer: those must be answered in the app), any other reaction on a bot's
 * reply becomes feedback for the bot, as in the app; and the bot puts 👀 on a message that arrives while it works.
 * WhatsApp is not implemented: its official Cloud API needs a Meta business account and a paid, template-bound setup,
 * and unofficial QR clients break WhatsApp's terms (the number can be banned) — see docs/COUVERTURE.md.
 *
 * Bot API methods used (https://core.telegram.org/bots/api): getMe, getUpdates (allowed_updates "message" and
 * "message_reaction"), sendMessage, setMessageReaction. Telegram documents message_reaction updates as sent to bots
 * that are administrators of a chat; in a private chat with the bot they are delivered to the bot as well.
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

/** What a message the bot sent means when the user reacts to it: an approval it asked, or one of its replies. */
type Meaning = { kind: "approval"; approvalId: string } | { kind: "reply"; seq: number; generation: number };
const remember = (botId: string, messageId: number, m: Meaning) =>
  q.run("INSERT OR REPLACE INTO telegram_messages (bot_id, message_id, kind, ref, created_at) VALUES (?, ?, ?, ?, ?)", botId, messageId, m.kind, m.kind === "approval" ? m.approvalId : `${m.generation}:${m.seq}`, now());
function meaningOf(botId: string, messageId: number): Meaning | null {
  const r = q.get<{ kind: string; ref: string }>("SELECT kind, ref FROM telegram_messages WHERE bot_id = ? AND message_id = ?", botId, messageId);
  if (!r) return null;
  if (r.kind === "approval") return { kind: "approval", approvalId: r.ref };
  const [g, s] = r.ref.split(":").map(Number);
  return { kind: "reply", generation: g, seq: s };
}

export async function send(bot: BotRecord, text: string, meaning?: Meaning): Promise<number[]> {
  const token = tokenOf(bot);
  if (!token || !bot.telegramChatId) return [];
  const ids: number[] = [];
  // Telegram refuses messages over 4096 characters.
  for (let i = 0; i < text.length; i += 4000) {
    const m = await call<{ message_id: number }>(token, "sendMessage", { chat_id: bot.telegramChatId, text: text.slice(i, i + 4000) }).catch((err) => { console.error("[telegram send]", err.message); return null; });
    if (m?.message_id) { ids.push(m.message_id); if (meaning) remember(bot.id, m.message_id, meaning); }
  }
  return ids;
}

/** Approvals a phone channel never answers: payments, and files or control of the user's own computer. */
export const privateApproval = (tool: string) => /^(card:|myfiles:|mycomputer:|vault:|secret:|totp:|email code:)/.test(tool);

const polls = new Map<string, AbortController>();

interface Update {
  update_id: number;
  message?: { message_id: number; text?: string; chat: { id: number; type: string }; reply_to_message?: { message_id: number } };
  message_reaction?: { chat: { id: number; type: string }; message_id: number; new_reaction?: { type: string; emoji?: string }[]; old_reaction?: { type: string; emoji?: string }[] };
}

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
        const updates = await call<Update[]>(token, "getUpdates", { offset: bot.telegramOffset, timeout: 25, allowed_updates: ["message", "message_reaction"] }, stop.signal);
        for (const u of updates) {
          bots.setTelegramOffset(botId, u.update_id + 1);
          if (u.message?.text && u.message.chat.type === "private") await receive(botId, String(u.message.chat.id), u.message.text.trim(), token, u.message.message_id);
          else if (u.message_reaction && u.message_reaction.chat.type === "private") await reacted(botId, String(u.message_reaction.chat.id), u.message_reaction, token);
        }
      } catch {
        if (stop.signal.aborted) break;
        await new Promise((r) => setTimeout(r, Number(process.env.TELEGRAM_RETRY_MS ?? 5000)));
      }
    }
  })();
}
function stopPolling(botId: string) {
  polls.get(botId)?.abort();
  polls.delete(botId);
}

const COMMANDS: Record<string, "tasks" | "status" | "stop" | "usage" | "memory" | "help"> = {
  taches: "tasks", "tâches": "tasks", tasks: "tasks", etat: "status", "état": "status", status: "status", stop: "stop", usage: "usage",
  memoire: "memory", "mémoire": "memory", memory: "memory", aide: "help", help: "help",
};

async function receive(botId: string, chatId: string, text: string, token: string, messageId?: number) {
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
  const cmd = /^\/([\p{L}]+)(?:@\w+)?\s*$/u.exec(text)?.[1]?.toLowerCase();
  if (cmd && COMMANDS[cmd]) { await reply(commandAnswer(bot, COMMANDS[cmd])); audit(bot.userId, "channel", `${bot.name}: Telegram /${cmd}`, bot.id); return; }
  // Received while the bot works: 👀, so the user knows it was seen and will be folded into the work.
  if (messageId && getLive(bot.id).running) void call(token, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
  // A pasted secret is masked before it is stored or sent to a model; the card to save it waits in the web chat.
  const screened = screenSecrets(text, users.localeOf(bot.userId));
  rows.append(bot, { kind: "message", role: "user", text: screened.text });
  if (screened.secrets.length) holdAndOffer(bot, bot.userId, screened.secrets);
  submitUserMessage(bot, screened.text, false, [], "telegram");
}

/** A channel command, answered by the server from its own records (no model call). */
export function commandAnswer(bot: BotRecord, cmd: "tasks" | "status" | "stop" | "usage" | "memory" | "help"): string {
  const loc = users.localeOf(bot.userId);
  if (cmd === "help") return tr(loc, "Commands: /taches (tasks under way), /etat (what {bot} is doing), /stop (stop its work), /usage (this month's spend), /memoire (what it remembers). Anything else is a message to {bot}.", { bot: bot.name });
  if (cmd === "stop") {
    interrupt(bot.id);
    let n = 0;
    for (const t of q.all<{ helper_id: string | null }>("SELECT helper_id FROM bg_tasks WHERE bot_id = ? AND state IN ('running','waiting')", bot.id)) if (t.helper_id) { interrupt(t.helper_id); n++; }
    q.run("UPDATE bg_tasks SET state = 'stopped', updated_at = ? WHERE bot_id = ? AND state IN ('running','waiting')", now(), bot.id);
    return n ? tr(loc, "⏹ {bot} stopped, with {n} background tasks.", { bot: bot.name, n }) : tr(loc, "⏹ {bot} stopped.", { bot: bot.name });
  }
  if (cmd === "tasks") {
    const bg = q.all<{ title: string; state: string; steps: number }>("SELECT title, state, steps FROM bg_tasks WHERE bot_id = ? AND state IN ('running','waiting') ORDER BY created_at DESC LIMIT 10", bot.id);
    const tracked = tasks.forBot(bot.id).filter((t) => t.state !== "done").slice(0, 10);
    if (!bg.length && !tracked.length) return tr(loc, "No task under way for {bot}.", { bot: bot.name });
    return [
      ...bg.map((t) => `• ${t.title} — ${tr(loc, t.state === "waiting" ? "waiting for you" : "running")} (${t.steps})`),
      ...tracked.map((t) => `• ${t.title} — ${tr(loc, t.state === "needs_input" ? "waiting for you" : "running")}${t.note ? ` · ${clip(t.note, 80)}` : ""}`),
    ].join("\n");
  }
  if (cmd === "status") {
    const live = getLive(bot.id);
    const waiting = approvals.pendingForUser(bot.userId).filter((a) => a.botId === bot.id).length;
    const state = live.awaiting ? tr(loc, "waiting for you: {reason}", { reason: live.awaiting.reason }) : live.running ? tr(loc, "working ({steps} steps so far)", { steps: live.steps ?? 0 }) : tr(loc, "idle");
    return [`${bot.name}: ${state}`, waiting ? tr(loc, "{n} approvals to answer in the app.", { n: waiting }) : ""].filter(Boolean).join("\n");
  }
  if (cmd === "usage") {
    const d = new Date();
    const since = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1);
    const all = q.get<{ c: number | null; n: number }>("SELECT SUM(cost_usd) AS c, COUNT(*) AS n FROM usage WHERE user_id = ? AND at >= ?", bot.userId, since);
    const mine = q.get<{ c: number | null }>("SELECT SUM(cost_usd) AS c FROM usage WHERE bot_id = ? AND at >= ?", bot.id, since);
    const budget = q.get<{ budget_usd: number | null }>("SELECT budget_usd FROM settings WHERE user_id = ?", bot.userId)?.budget_usd ?? null;
    return tr(loc, "This month: {total} $ spent ({n} model calls), {mine} $ by {bot}.", { total: (all?.c ?? 0).toFixed(2), n: all?.n ?? 0, mine: (mine?.c ?? 0).toFixed(2), bot: bot.name }) + (budget !== null ? ` ${tr(loc, "Budget: {budget} $.", { budget: budget.toFixed(2) })}` : "");
  }
  const notes = memories.usable(bot.id, 10);
  return notes.length ? [tr(loc, "What {bot} remembers (latest):", { bot: bot.name }), ...notes.map((m) => `• ${clip(m.text, 160)}`)].join("\n") : tr(loc, "{bot} remembers nothing yet.", { bot: bot.name });
}

/** A reaction the user put on one of the bot's Telegram messages. */
async function reacted(botId: string, chatId: string, r: NonNullable<Update["message_reaction"]>, token: string) {
  const bot = bots.byId(botId);
  if (!bot || chatId !== bot.telegramChatId) return;
  const emoji = (r.new_reaction ?? []).find((x) => x.type === "emoji")?.emoji;
  const meaning = meaningOf(bot.id, r.message_id);
  if (!meaning) return;
  const loc = users.localeOf(bot.userId);
  if (meaning.kind === "approval") {
    if (emoji !== "👍" && emoji !== "👎") return;
    const a = approvals.byId(meaning.approvalId);
    if (!a || a.status !== "pending") return;
    if (privateApproval(a.tool)) { await call(token, "sendMessage", { chat_id: chatId, text: tr(loc, "🔒 This one must be answered in the app.") }).catch(() => {}); return; }
    decideApproval(bot.userId, a.id, emoji === "👍" ? "allow" : "deny");
    audit(bot.userId, "channel", `${bot.name}: approval answered from Telegram (${emoji})`, bot.id);
    return;
  }
  // A reaction on a reply: the same feedback as in the app (or taken back when the reaction is removed).
  const row = rows.get(bot.id, meaning.generation, meaning.seq);
  if (!row || row.body.kind !== "message" || meaning.generation !== bot.generation) return;
  const user = users.byId(bot.userId);
  const old = (r.old_reaction ?? []).find((x) => x.type === "emoji")?.emoji;
  if (old && (REACTIONS as readonly string[]).includes(old) && old !== emoji) {
    rows.react(bot, bot.generation, row.seq, { emoji: old as ReactionEmoji, by: "user", name: user?.name ?? "" }, false);
    feedback.drop(bot.id, bot.generation, row.seq, old);
  }
  if (!emoji || !(REACTIONS as readonly string[]).includes(emoji)) return;
  rows.react(bot, bot.generation, row.seq, { emoji: emoji as ReactionEmoji, by: "user", name: user?.name ?? "" }, true);
  feedback.add(bot.id, bot.generation, row.thread ?? 0, row.seq, emoji, `The user reacted ${emoji} (on Telegram) to your message "${clip(row.body.text.replace(/\s+/g, " ").trim() || "(a file)", 100)}".`);
}

/** The latest reply of a bot in its main chat (what a "reply" event is about). */
function lastReplyRow(bot: BotRecord): { seq: number; generation: number } | null {
  const r = [...rows.list(bot.id, bot.generation, 20)].reverse().find((x) => x.body.kind === "message" && x.body.role === "assistant" && !x.body.streaming);
  return r ? { seq: r.seq, generation: r.generation } : null;
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
      const target = own?.telegramChatId ? own : bots.primary(e.bot.userId);
      if (!target?.telegramChatId) return;
      const loc = users.localeOf(e.bot.userId);
      const prefix = target.id === e.bot.id ? "" : `[${e.bot.name}] `;
      if (e.type === "waiting") {
        const answerable = !!e.approvalId && !privateApproval(e.tool ?? "");
        const hint = e.approvalId ? (answerable ? `\n${tr(loc, "👍 = yes · 👎 = no")}` : `\n${tr(loc, "🔒 Answer in the app.")}`) : "";
        void send(target, `⏳ ${prefix}${e.text}${hint}`, answerable ? { kind: "approval", approvalId: e.approvalId! } : undefined);
        return;
      }
      const at = own?.telegramChatId ? lastReplyRow(own) : null;
      void send(target, `${prefix}${e.text}`, at ? { kind: "reply", ...at } : undefined);
    });
  },
  stopAll() { for (const id of [...polls.keys()]) stopPolling(id); },
  /** A short message to the user's phone through their main bot, if it is linked. */
  notifyUser(userId: string, text: string) {
    const main = bots.primary(userId);
    if (main?.telegramChatId) void send(main, text);
  },
};
