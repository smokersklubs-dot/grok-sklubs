import { q } from "../db.js";
import { tr } from "../i18n.js";
import type { ToolSpec } from "../llm/index.js";
import { bots, clip, rows } from "../store.js";
import type { Turn } from "./loop.js";
import type { BuiltinTool, ToolContext } from "./tools.js";

/**
 * L97 — « repasse plus tard »: wait_until, a bounded wait that frees the bot meanwhile (backlog A-FAIRE L97; behaviour from
 * the Agent Zero and OMB audits, our own code).
 *
 * A bot that had to wait for something slow (a build, a delivery, a reply, a page that updates) either polled in a loop,
 * burning steps, or stopped and forgot. wait_until ends the turn at once — the conversation's lane is free for other work
 * and the owner's messages — and wakes the bot IN THE SAME CONVERSATION after the delay, with its own reason, as a queued
 * follow-up (so its history and context are kept). Bounds: MIN..MAX_MINUTES per wait and at most MAX_CHAIN waits in a
 * row in one conversation (a message from the owner starts a new count). The wake is on disk (wake_later), so a restart
 * does not lose it; a wake for a bot that is gone is dropped. The follow-up carries the turn's origin and outside-content
 * mark, so it never gets more rights than the turn that asked for it.
 */
q.run("CREATE TABLE IF NOT EXISTS wake_later (id INTEGER PRIMARY KEY AUTOINCREMENT, bot_id TEXT NOT NULL, thread INTEGER NOT NULL DEFAULT 0, due_at INTEGER NOT NULL, reason TEXT NOT NULL, origin TEXT NOT NULL DEFAULT '', tainted INTEGER NOT NULL DEFAULT 0, depth INTEGER NOT NULL DEFAULT 0, spend TEXT, chain INTEGER NOT NULL DEFAULT 1, created_at INTEGER NOT NULL)");

export const MIN_MINUTES = 1;
export const MAX_MINUTES = 360;
export const MAX_CHAIN = 6;

/** The chain length of the conversation's waits: the last wake's chain + 1 when this turn is itself a wake, else 1. */
const chains = new Map<string, number>();
const chainKey = (botId: string, thread: number) => `${botId}~${thread}`;

export function scheduleWake(o: { botId: string; thread: number; minutes: number; reason: string; origin?: string; tainted?: boolean; depth?: number; spend?: string; chain: number }, at = Date.now()): number {
  const due = at + o.minutes * 60_000;
  return Number(q.run("INSERT INTO wake_later (bot_id, thread, due_at, reason, origin, tainted, depth, spend, chain, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", o.botId, o.thread, due, clip(o.reason, 400), o.origin ?? "", o.tainted ? 1 : 0, o.depth ?? 0, o.spend ?? null, o.chain, at).lastInsertRowid);
}

export const WAKE_PREFIX = "[You asked to be woken up here";
const wakeText = (reason: string, minutes: number) => `${WAKE_PREFIX} after about ${minutes} min. Your reason: ${reason}]\nCheck now whether what you were waiting for has happened, and carry on with the work. If it still has not, you may wait again with wait_until, or tell the user where things stand.`;

/** Wakes that are due (or all of them with `now` far ahead, for tests): each one queued once, then forgotten. */
export async function fireDueWakes(now = Date.now()): Promise<number> {
  const due = q.all<{ id: number; bot_id: string; thread: number; due_at: number; created_at: number; reason: string; origin: string; tainted: number; depth: number; spend: string | null; chain: number }>("SELECT * FROM wake_later WHERE due_at <= ? ORDER BY due_at", now);
  if (!due.length) return 0;
  const { enqueue } = await import("./loop.js");
  for (const w of due) {
    q.run("DELETE FROM wake_later WHERE id = ?", w.id);
    const bot = bots.byId(w.bot_id);
    if (!bot || bot.kind !== "agent") continue;
    chains.set(chainKey(bot.id, w.thread), w.chain);
    enqueue(bot.id, { kind: "system", text: wakeText(w.reason, Math.round((w.due_at - w.created_at) / 60_000)), thread: w.thread || undefined, tainted: !!w.tainted || undefined, depth: w.depth, origin: w.origin || "system", ...(w.spend ? { spendScope: w.spend } : {}) });
  }
  return due.length;
}

/** The owner wrote in this conversation: the next wait starts a new chain. */
export const resetWaitChain = (botId: string, thread: number) => { chains.delete(chainKey(botId, thread)); };
/** Waits planned for this bot (the chat lists them; "Tout arrêter" may drop them). */
export const plannedWakes = (botId: string) => q.all<{ id: number; thread: number; due_at: number; reason: string }>("SELECT id, thread, due_at, reason FROM wake_later WHERE bot_id = ? ORDER BY due_at", botId);
export const dropWakes = (botId: string) => Number(q.run("DELETE FROM wake_later WHERE bot_id = ?", botId).changes);

const obj = (properties: Record<string, unknown>, required: string[] = []): ToolSpec["inputSchema"] => ({ type: "object", properties, required });

export const waitTools: BuiltinTool[] = [{
  spec: {
    name: "wait_until",
    description: `Come back later: end your turn now and be woken up in this same conversation after a delay (${MIN_MINUTES} to ${MAX_MINUTES} minutes), with your reason. Use it when you must wait for something slow (a build, a delivery, an email reply, a page that updates) instead of checking again and again. Meanwhile you are free for other work and the user's messages. Tell the user in one sentence what you are waiting for before calling it.`,
    inputSchema: obj({ minutes: { type: "integer", description: `How long to wait, ${MIN_MINUTES}-${MAX_MINUTES}` }, reason: { type: "string", description: "What you are waiting for and what you will do then" } }, ["minutes", "reason"]),
  },
  activity: "waiting", label: "Coming back later",
  async run(a: Record<string, any>, c: ToolContext) {
    const minutes = Math.round(Number(a.minutes));
    const reason = String(a.reason ?? "").trim();
    if (!reason) return { content: "Say what you are waiting for.", isError: true };
    if (!Number.isFinite(minutes) || minutes < MIN_MINUTES || minutes > MAX_MINUTES) return { content: `minutes must be between ${MIN_MINUTES} and ${MAX_MINUTES}.`, isError: true };
    const thread = c.thread ?? 0;
    const turn = (c.turn ?? null) as Pick<Turn, "spendKey"> | null;
    const woken = c.origin !== "user" && chains.get(chainKey(c.bot.id, thread));
    const chain = woken ? woken + 1 : 1;
    if (chain > MAX_CHAIN) return { content: `You already waited ${MAX_CHAIN} times in a row in this conversation. Do not wait again: tell the user where things stand and what you are waiting for.`, isError: true, summary: "too many waits" };
    scheduleWake({ botId: c.bot.id, thread, minutes, reason, origin: c.origin, tainted: c.tainted, depth: c.depth, spend: turn?.spendKey, chain });
    const at = new Date(Date.now() + minutes * 60_000);
    rows.append(c.bot, { kind: "notice", tone: "info", text: tr(c.user.locale, "⏰ I will come back to this in {min} min (around {time} UTC): {reason}", { min: minutes, time: at.toISOString().slice(11, 16), reason: clip(reason, 200) }) }, thread || undefined);
    return { content: `Done: you will be woken up here in about ${minutes} minutes. End your turn now.`, summary: tr(c.user.locale, "back in {min} min", { min: minutes }), endTurn: true };
  },
}];

// The wake-up clock: every 30 s (not in tests, which call fireDueWakes themselves).
if (!process.env.NO_SCHEDULER) setInterval(() => { void fireDueWakes().catch((err) => console.error("[wake later]", err)); }, 30_000).unref();
