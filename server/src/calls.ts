import { ask } from "./agent/memory.js";
import { tr } from "./i18n.js";
import { clip, rows, type BotRecord } from "./store.js";
import type { Locale } from "./shared.js";

/**
 * The record of a voice call in the chat: a "call started" row, then a "call ended" row with the duration, the
 * transcript and (a moment later) a one-line summary. Used by browser calls (routes.ts) and server-mediated calls
 * (voice/session.ts) alike.
 */
const calls = new Map<string, { botId: string; startedAt: number }>();

export function callStarted(bot: BotRecord, locale: Locale): string {
  const callId = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  calls.set(callId, { botId: bot.id, startedAt: Date.now() });
  rows.append(bot, { kind: "event", event: "call", text: tr(locale, "Voice call with {bot} started", { bot: bot.name }), call: { id: callId, phase: "started" } });
  return callId;
}

/** Closes the record once (false when it was already closed or is unknown). */
export function callEnded(bot: BotRecord, callId: string, rawTranscript: unknown, locale: Locale): boolean {
  const live = calls.get(callId);
  if (!live || live.botId !== bot.id) return false;
  calls.delete(callId);
  const transcript = (Array.isArray(rawTranscript) ? rawTranscript : [])
    .filter((l: any) => l && (l.role === "user" || l.role === "assistant") && typeof l.text === "string" && l.text.trim())
    .slice(-200).map((l: any) => ({ role: l.role as "user" | "assistant", text: clip(l.text.trim(), 2000) }));
  const durationMs = Math.max(1000, Date.now() - live.startedAt);
  const secs = Math.round(durationMs / 1000);
  const duration = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const base = tr(locale, "Voice call ended · {duration}", { duration });
  const record = { id: callId, phase: "ended" as const, durationMs, transcript };
  const row = rows.append(bot, { kind: "event", event: "call", text: base, call: record });
  // A one-line summary is added to the row a moment later; the call is already recorded without it.
  if (transcript.length)
    void ask(bot, "You summarise voice calls between a user and their AI teammate.",
      `Write ONE sentence, past tense, third person, at most 25 words, in ${locale === "fr" ? "French" : "English"}, saying what the call was about and what was agreed.\n\n${transcript.map((l) => `${l.role === "user" ? "User" : bot.name}: ${l.text}`).join("\n").slice(-12_000)}`)
      .then((summary) => { if (summary) rows.rewrite(bot, row.generation, row.seq, { kind: "event", event: "call", text: base, call: { ...record, summary: clip(summary.replace(/\s+/g, " "), 240) } }); })
      .catch(() => {});
  return true;
}
