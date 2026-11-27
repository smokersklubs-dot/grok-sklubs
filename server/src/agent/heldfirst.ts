import { q } from "../db.js";
import { tr } from "../i18n.js";
import { defaultModelRef, resolveModel } from "../llm/index.js";
import { botQueue, bots, rows, users, type BotRecord } from "../store.js";
import { isEngineRef } from "./engine.js";
import type { Trigger } from "./turn-request.js";

/**
 * L59 — the first message is kept, then sent once a brain is connected (backlog A-FAIRE L59; behaviour from the Agent Zero
 * audit: "the first message goes out even without a model, then picks up by itself once the model is connected"; our own
 * code).
 *
 * The owner's message to a bot when NO model can be reached at all (no provider set up on the server nor in the account:
 * llm/index.ts "No model provider is configured") used to end on an error. Now it is kept on disk (held_messages), the
 * chat says so in plain words with where to connect one, and it goes out by itself, in its conversation, the moment a
 * model answers a real request for that account (modelhealth.ts checkModel "ok": the model picker and the first-run guide
 * check right after a model is saved). Only the owner's own messages (never a member's, the Bot API's, a routine's), and
 * never for a subscription bot (Claude Code, Codex: they have their own sign-in).
 */
q.run("CREATE TABLE IF NOT EXISTS held_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL, bot_id TEXT NOT NULL, trigger TEXT NOT NULL, created_at INTEGER NOT NULL)");

/** Whether no model at all can be reached for this bot's account right now. */
export function noBrain(bot: Pick<BotRecord, "model" | "userId">): boolean {
  if (isEngineRef(bot.model)) return false;
  try { resolveModel(bot.model || defaultModelRef(), bot.userId); return false; } catch (err) { return /No model provider is configured/i.test(String((err as Error)?.message ?? err)); }
}

/** loop.ts runQueued, before a turn starts: keeps the owner's message when there is no brain. True when it was kept. */
export function holdNoBrain(id: number | null, bot: BotRecord | null, trigger: Trigger): boolean {
  if (!bot || bot.kind !== "agent" || trigger.kind !== "user" || trigger.member || trigger.api || !noBrain(bot)) return false;
  q.run("INSERT INTO held_messages (user_id, bot_id, trigger, created_at) VALUES (?, ?, ?, ?)", bot.userId, bot.id, JSON.stringify(trigger), Date.now());
  if (id !== null) botQueue.done(id);
  rows.append(bot, { kind: "notice", tone: "warn", text: tr(users.localeOf(bot.userId), "No AI model is connected yet, so I kept your message. It will go out by itself as soon as a model answers: connect one in Settings → Models.") }, trigger.thread || undefined);
  return true;
}

export const heldCount = (userId: string) => q.get<{ n: number }>("SELECT COUNT(*) AS n FROM held_messages WHERE user_id = ?", userId)?.n ?? 0;

/**
 * A model answered for this account (modelhealth.ts): every kept message whose bot can now reach a model goes out, in its
 * order and conversation. `enqueue` is loop.ts's (imported lazily by the caller). Returns how many went out.
 */
export function replayHeld(userId: string, enqueue: (botId: string, t: Trigger) => void): number {
  const list = q.all<{ id: number; bot_id: string; trigger: string }>("SELECT id, bot_id, trigger FROM held_messages WHERE user_id = ? ORDER BY id", userId);
  let n = 0;
  for (const r of list) {
    const bot = bots.byId(r.bot_id);
    if (!bot || bot.kind !== "agent") { q.run("DELETE FROM held_messages WHERE id = ?", r.id); continue; }
    if (noBrain(bot)) continue;
    let trigger: Trigger | null = null;
    try { trigger = JSON.parse(r.trigger) as Trigger; } catch { /* unreadable: dropped */ }
    q.run("DELETE FROM held_messages WHERE id = ?", r.id);
    if (!trigger || trigger.kind !== "user") continue;
    rows.append(bot, { kind: "notice", tone: "info", text: tr(users.localeOf(bot.userId), "A model answers now: I am sending the message I kept.") }, trigger.thread || undefined);
    enqueue(bot.id, trigger);
    n++;
  }
  return n;
}
