import { voiceNoteText } from "./telegramvoice.js";
import { seal, unseal } from "./auth.js";
import { getLive } from "./bus.js";
import { decideApproval, interrupt, isPaused, onTurnEvent, submitUserMessage } from "./agent/loop.js";
import { holdAndOffer, screen as screenSecrets } from "./pastedsecrets.js";
import { config } from "./config.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import type { ReactionEmoji, TelegramStatus } from "./shared.js";
import { REACTIONS } from "./shared.js";
import { approvalKeyboard, downloadFile, incomingFile, parseApprovalCallback, sendFile, sendMethodFor, splitTelegram, tgText, TooLargeError, type TgMessageFiles } from "./telegramplus.js";
import { readLibraryFile, storeBytes } from "./computer.js";
import { onApproved } from "./channelaccess.js"; import { chText } from "./channeltext.js";
import { groupSaid, registerContactSink, strangerMessage } from "./channelrelay.js";
import { registerGroupSink } from "./channelgroups.js";
import { retryDelay } from "./channelretry.js";
import { approvals, audit, bots, clip, feedback, memories, now, randomToken, rows, tasks, users, type BotRecord } from "./store.js";

/**
 * Lets a bot be reached through a Telegram bot of the user's own (created with Telegram's BotFather).
 * The chat that sent the link code is the owner's; anyone else gets an access code and talks to the bot only once the
 * owner approved them, as a member (L162, channelaccess.ts / channelrelay.ts). Messages are fetched by
 * asking Telegram for news, so the server needs no public address for this.
 *
 * Wave 5b (spec 07 A17, adapted): channel commands — /taches, /etat, /stop, /usage, /memoire (and /aide) — answered
 * by the server itself without calling the model; reactions both ways: 👍/👎 on an approval request answers it (never
 * for a payment or a file on the user's computer: those must be answered in the app), any other reaction on a bot's
 * reply becomes feedback for the bot, as in the app; and the bot puts 👀 on a message that arrives while it works.
 * WhatsApp is not implemented: its official Cloud API needs a Meta business account and a paid, template-bound setup,
 * and unofficial QR clients break WhatsApp's terms (the number can be banned) — see docs/COUVERTURE.md.
 *
 * nod item 5 (telegramplus.ts, partly adapted from n8n-io/nod, Apache-2.0): ✅/❌ buttons under an approval question,
 * photos / voice notes / files received into the bot's library, files the bot attaches sent back, long replies split at
 * paragraphs, "typing…" while it works.
 *
 * Bot API methods used (https://core.telegram.org/bots/api): getMe, getUpdates (allowed_updates "message",
 * "message_reaction" and "callback_query"), sendMessage, setMessageReaction, answerCallbackQuery, editMessageReplyMarkup,
 * getFile, sendPhoto, sendVoice, sendAudio, sendDocument, sendChatAction. Telegram documents message_reaction updates as sent to bots
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
  // Telegram refuses messages over 4096 characters: split at paragraphs / lines, code blocks kept readable (telegramplus.ts).
  const parts = splitTelegram(text);
  for (const [i, part] of parts.entries()) {
    // nod item 5: an approval question carries ✅ / ❌ buttons (on its last part), in the user's language.
    const markup = meaning?.kind === "approval" && i === parts.length - 1 ? { reply_markup: approvalKeyboard(meaning.approvalId, users.localeOf(bot.userId)) } : {};
    const m = await call<{ message_id: number }>(token, "sendMessage", { chat_id: bot.telegramChatId, text: part, ...markup }).catch((err) => { console.error("[telegram send]", err.message); return null; });
    if (m?.message_id) { ids.push(m.message_id); if (meaning) remember(bot.id, m.message_id, meaning); }
  }
  return ids;
}

/** Approvals a phone channel never answers: payments, and files or control of the user's own computer. */
export const privateApproval = (tool: string) => /^(card:|myfiles:|mycomputer:|vault:|secret:|totp:|email code:)/.test(tool);

const polls = new Map<string, AbortController>();

interface Update {
  update_id: number;
  message?: { message_id: number; text?: string; caption?: string; chat: { id: number; type: string; title?: string }; from?: TgFrom; reply_to_message?: { message_id: number; from?: TgFrom & { is_bot?: boolean } }; entities?: { type: string; offset: number; length: number; user?: { id: number } }[] } & TgMessageFiles;
  callback_query?: { id: string; data?: string; from: { id: number }; message?: { message_id: number; chat: { id: number; type: string } } };
  message_reaction?: { chat: { id: number; type: string }; message_id: number; new_reaction?: { type: string; emoji?: string }[]; old_reaction?: { type: string; emoji?: string }[] };
}

function startPolling(botId: string) {
  stopPolling(botId);
  const stop = new AbortController();
  polls.set(botId, stop);
  void (async () => {
    let failures = 0;
    while (!stop.signal.aborted) {
      const bot = bots.byId(botId);
      const token = bot ? tokenOf(bot) : null;
      if (!bot || !token) break;
      try {
        const updates: Update[] = await call<Update[]>(token, "getUpdates", { offset: bot.telegramOffset, timeout: 25, allowed_updates: ["message", "message_reaction", "callback_query"] }, stop.signal);
        for (const u of updates) {
          bots.setTelegramOffset(botId, u.update_id + 1);
          failures = 0;
          if (u.message && (u.message.chat.type === "group" || u.message.chat.type === "supergroup")) await receiveGroup(botId, u.message, token);
          else if (u.message?.text && u.message.chat.type === "private") await receive(botId, String(u.message.chat.id), u.message.text.trim(), token, u.message.message_id, u.message.from);
          else if (u.message && u.message.chat.type === "private" && incomingFile(u.message)) await receiveFile(botId, String(u.message.chat.id), u.message, token);
          else if (u.callback_query) await pressed(botId, u.callback_query, token);
          else if (u.message_reaction && u.message_reaction.chat.type === "private") await reacted(botId, String(u.message_reaction.chat.id), u.message_reaction, token);
        }
      } catch {
        if (stop.signal.aborted) break;
        await new Promise((r) => setTimeout(r, retryDelay(failures++)));
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

/** L162: who wrote (a private chat's id is the person's id); its name for the owner's list of access requests. */
interface TgFrom { id: number; first_name?: string; last_name?: string; username?: string }
const nameOf = (f: TgFrom | undefined, chatId: string) => [f?.first_name, f?.last_name].filter(Boolean).join(" ") || (f?.username ? `@${f.username}` : chatId);

async function receive(botId: string, chatId: string, text: string, token: string, messageId?: number, from?: TgFrom) {
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
  // L162: anyone else gets an access code; once the owner approved them, they talk to the bot as a member (channelrelay.ts).
  if (chatId !== bot.telegramChatId) { await strangerMessage(bot, "telegram", { id: chatId, name: nameOf(from, chatId), replyTo: chatId }, text.replace(/^\/start\b\s*/, ""), false, reply); return; }
  if (text.startsWith("/start")) return;
  const cmd = /^\/([\p{L}]+)(?:@\w+)?\s*$/u.exec(text)?.[1]?.toLowerCase();
  if (cmd && COMMANDS[cmd]) { await reply(commandAnswer(bot, COMMANDS[cmd])); audit(bot.userId, "channel", `${bot.name}: Telegram /${cmd}`, bot.id); return; }
  // Received while the bot works: 👀, so the user knows it was seen and will be folded into the work.
  if (messageId && getLive(bot.id).running) void call(token, "setMessageReaction", { chat_id: chatId, message_id: messageId, reaction: [{ type: "emoji", emoji: "👀" }] }).catch(() => {});
  // A pasted secret is masked before it is stored or sent to a model; the card to save it waits in the web chat.
  const screened = screenSecrets(text, users.localeOf(bot.userId));
  rows.append(bot, { kind: "message", role: "user", text: screened.text });
  if (screened.secrets.length) holdAndOffer(bot, bot.userId, screened.secrets);
  // "Pause": the message is kept and waits in the bot's queue; the sender hears it now, not when it is resumed.
  if (isPaused(bot)) await reply(tr(users.localeOf(bot.userId), "⏸ {bot} is paused: your message is kept and will be handled when it is resumed.", { bot: bot.name }));
  submitUserMessage(bot, screened.text, false, [], "telegram");
  keepTyping(bot.id, token, chatId);
}

/**
 * DS-Bot item 4 (channelgroups.ts): a message in a Telegram group. It counts as calling the bot when it @mentions it,
 * replies to one of its messages, or is a /command@bot. With Telegram's privacy mode on (the default), a bot only gets
 * commands meant for it and replies to its messages; to be called by @mention, or to read every message, the owner turns
 * privacy off with BotFather's /setprivacy (or makes the bot an admin), then adds it to the group again
 * (https://core.telegram.org/bots/features#privacy-mode). A reply answers the message that called the bot
 * (sendMessage reply_parameters, https://core.telegram.org/bots/api#replyparameters).
 */
const lastCall = new Map<string, number>();
async function receiveGroup(botId: string, m: NonNullable<Update["message"]>, token: string) {
  const bot = bots.byId(botId);
  if (!bot || !m.from || (m.from as { is_bot?: boolean }).is_bot) return;
  const me = (bot.telegram ?? "").toLowerCase();
  const raw = String(m.text ?? m.caption ?? "");
  const words = (e: { offset: number; length: number }) => raw.slice(e.offset, e.offset + e.length).toLowerCase();
  const addressed = !!me && (
    (m.entities ?? []).some((e) => (e.type === "mention" && words(e) === `@${me}`) || (e.type === "bot_command" && words(e).endsWith(`@${me}`)))
    || (!!m.reply_to_message?.from?.is_bot && (m.reply_to_message.from.username ?? "").toLowerCase() === me));
  const text = me ? raw.replace(new RegExp(`@${me.replace(/[^\w]/g, "")}\\b`, "gi"), "").trim() : raw.trim();
  const chatId = String(m.chat.id);
  const said = await groupSaid(bot, "telegram", {
    chatId, chatName: m.chat.title ?? "", sender: { id: String(m.from.id), name: nameOf(m.from, String(m.from.id)) },
    isOwner: !!bot.telegramChatId && String(m.from.id) === bot.telegramChatId, text, addressed, hasFile: !!incomingFile(m),
  }, (t) => call(token, "sendMessage", { chat_id: chatId, text: t, reply_parameters: { message_id: m.message_id, allow_sending_without_reply: true } }).catch(() => {}));
  if (said === "taken") { lastCall.set(`${bot.id}:${chatId}`, m.message_id); keepTyping(bot.id, token, chatId); }
}

/**
 * nod item 5: a photo, a voice note or a file sent on Telegram reaches the bot like a file attached in the app (stored in
 * its library, caption as the message). Over 20 MB Telegram does not let bots download it: said, nothing stored.
 */
async function receiveFile(botId: string, chatId: string, m: NonNullable<Update["message"]>, token: string) {
  const bot = bots.byId(botId);
  if (!bot) return;
  const loc = users.localeOf(bot.userId);
  const reply = (t: string) => call(token, "sendMessage", { chat_id: chatId, text: t }).catch(() => {});
  if (!bot.telegramChatId) { await reply("🔒"); return; }
  if (chatId !== bot.telegramChatId) { await strangerMessage(bot, "telegram", { id: chatId, name: nameOf(m.from, chatId), replyTo: chatId }, String(m.caption ?? ""), true, reply); return; }
  const f = incomingFile(m)!;
  let bytes: Buffer;
  try { bytes = await downloadFile(token, f); } catch (err) {
    await reply(tgText(loc, err instanceof TooLargeError ? "This file is over 20 MB: Telegram does not let bots download it. Send it from the app instead." : "I could not get this file from Telegram. Try again, or send it from the app."));
    return;
  }
  const file = storeBytes(bot.id, "uploads", f.name, bytes);
  const attachment = { ...file, mime: f.mime };
  const caption = screenSecrets(String(m.caption ?? "").trim(), loc);
  // Optional (owner setting, off by default): the words of a voice note, written out by the account's speech-to-text.
  const spoken = f.voice ? await voiceNoteText(bot, file.path) : null;
  const heard = spoken ? screenSecrets(tgText(loc, "🎤 Voice message (written out): {text}", { text: spoken }), loc) : null;
  if (heard?.secrets.length) holdAndOffer(bot, bot.userId, heard.secrets);
  const text = [caption.text, heard?.text].filter(Boolean).join("\n\n") || tgText(loc, f.voice ? "(voice message: {name})" : "(file: {name})", { name: file.name });
  rows.append(bot, { kind: "message", role: "user", text, attachments: [attachment] });
  if (caption.secrets.length) holdAndOffer(bot, bot.userId, caption.secrets);
  audit(bot.userId, "channel", `${bot.name}: Telegram ${f.voice ? "voice message" : "file"} received (${file.name})`, bot.id);
  submitUserMessage(bot, text, false, [attachment], "telegram");
  keepTyping(bot.id, token, chatId);
}

/** "typing…" in the Telegram chat while the bot works on a message from it (shown 5 s per call), at most 10 minutes. */
function keepTyping(botId: string, token: string, chatId: string) {
  const started = Date.now();
  const tick = () => {
    // Stops once the bot is idle again (after a short grace for the turn to start), or after 10 minutes.
    if (Date.now() - started > 10 * 60_000 || (Date.now() - started > 8000 && !getLive(botId).running)) return;
    void call(token, "sendChatAction", { chat_id: chatId, action: "typing" }).catch(() => {});
    setTimeout(tick, 4500).unref();
  };
  tick();
}

/** nod item 5: ✅ / ❌ pressed under an approval question. Same rules as a reaction: never a payment or a local file. */
async function pressed(botId: string, cb: NonNullable<Update["callback_query"]>, token: string) {
  const bot = bots.byId(botId);
  const chatId = cb.message ? String(cb.message.chat.id) : "";
  const answer = (text?: string) => call(token, "answerCallbackQuery", { callback_query_id: cb.id, ...(text ? { text } : {}) }).catch(() => {});
  if (!bot || !bot.telegramChatId || chatId !== bot.telegramChatId || String(cb.from.id) !== bot.telegramChatId) { await answer("🔒"); return; }
  const loc = users.localeOf(bot.userId);
  const parsed = parseApprovalCallback(cb.data);
  const meaning = cb.message ? meaningOf(bot.id, cb.message.message_id) : null;
  if (!parsed || meaning?.kind !== "approval" || meaning.approvalId !== parsed.approvalId) { await answer(); return; }
  const a = approvals.byId(parsed.approvalId);
  const clear = () => call(token, "editMessageReplyMarkup", { chat_id: chatId, message_id: cb.message!.message_id, reply_markup: { inline_keyboard: [] } }).catch(() => {});
  if (!a || a.status !== "pending" || a.botId !== bot.id) { await answer(tgText(loc, "This request was already answered.")); await clear(); return; }
  if (privateApproval(a.tool)) { await answer(tgText(loc, "🔒 This one must be answered in the app.")); return; }
  decideApproval(bot.userId, a.id, parsed.allow ? "allow" : "deny");
  audit(bot.userId, "channel", `${bot.name}: approval answered from Telegram (${parsed.allow ? "button yes" : "button no"})`, bot.id);
  await answer(tgText(loc, parsed.allow ? "✅ Allowed" : "❌ Refused"));
  await clear();
}

/** nod item 5: files the bot attached to its reply go to Telegram too (a photo, a voice note, a document; 50 MB at most). */
const sentFiles = new Set<string>();
async function forwardFiles(bot: BotRecord, target: BotRecord) {
  const token = tokenOf(target);
  if (!token || !target.telegramChatId) return;
  const recent = rows.list(bot.id, bot.generation, 20);
  const lastUser = recent.map((r) => r.body.kind === "message" && r.body.role === "user").lastIndexOf(true);
  for (const r of recent.slice(lastUser + 1)) {
    if (r.body.kind !== "message" || r.body.role !== "assistant" || !r.body.attachments?.length) continue;
    for (const a of r.body.attachments) {
      const key = `${bot.id}:${r.generation}:${r.seq}:${a.path}`;
      if (sentFiles.has(key)) continue;
      sentFiles.add(key);
      if (sentFiles.size > 2000) sentFiles.delete(sentFiles.values().next().value!);
      if (!sendMethodFor(a)) { void send(target, tgText(users.localeOf(bot.userId), "“{name}” is over 50 MB: Telegram refuses it. It is in the app.", { name: a.name })); continue; }
      try { await sendFile(token, target.telegramChatId, a, readLibraryFile(bot.id, a.path)); } catch (err) { console.error("[telegram file]", (err as Error).message); }
    }
  }
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
    // DS-Bot item 4: a group's replies go back to that group, as an answer to the message that called the bot.
    registerGroupSink("telegram", (bot, g) => {
      const token = tokenOf(bots.byId(bot.id) ?? bot);
      if (!token) return null;
      return { text: async (t) => { const at = lastCall.get(`${bot.id}:${g.chatId}`); for (const [i, part] of splitTelegram(t).entries()) await call(token, "sendMessage", { chat_id: g.chatId, text: part, ...(at && i === 0 ? { reply_parameters: { message_id: at, allow_sending_without_reply: true } } : {}) }).catch(() => {}); } };
    });
    // L162: an approved person's replies go to their own private chat with the Telegram bot.
    registerContactSink("telegram", (bot, c) => {
      const token = tokenOf(bots.byId(bot.id) ?? bot);
      if (!token || !c.replyTo) return null;
      return { text: async (t) => { for (const part of splitTelegram(t)) await call(token, "sendMessage", { chat_id: c.replyTo, text: part }).catch(() => {}); }, file: async (a, bytes) => (await sendFile(token, c.replyTo!, a, bytes)) !== null };
    });
    onApproved("telegram", (bot, c) => { const token = tokenOf(bot); if (token && c.replyTo) void call(token, "sendMessage", { chat_id: c.replyTo, text: chText(users.localeOf(bot.userId), "✅ The owner approved you: you can now write to {bot}.", { bot: bot.name }) }).catch(() => {}); });
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
      void send(target, `${prefix}${e.text}`, at ? { kind: "reply", ...at } : undefined).then(() => (own ? forwardFiles(own, target) : undefined));
    });
  },
  stopAll() { for (const id of [...polls.keys()]) stopPolling(id); },
  /** A short message to the user's phone through their main bot, if it is linked. */
  notifyUser(userId: string, text: string) {
    const main = bots.primary(userId);
    if (main?.telegramChatId) void send(main, text);
  },
};
