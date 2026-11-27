import { ask } from "./agent/memory.js"; import { languageName } from "./clientshared/locales.js";
import { q } from "./db.js";
import { tr } from "./i18n.js";
import { bots, clip, rows, users, type BotRecord } from "./store.js";
import type { Locale } from "./shared.js";

/**
 * The record of a voice call in the chat: a "call started" row, then a "call ended" row with the duration, the
 * transcript and (a moment later) a one-line summary. Used by browser calls (routes.ts) and server-mediated calls
 * (voice/session.ts) alike.
 */
const calls = new Map<string, { botId: string; startedAt: number }>();

/**
 * L154 « compte rendu gardé au redémarrage »: every open call is also written to `call_live`, with its transcript so far
 * (server calls: updated while it goes, callProgress). After a restart of the server, a server call (its WebSocket went
 * with the old process) is closed at once with the transcript it had, and « (le serveur a redémarré) »; a browser call
 * keeps its record open, waiting for the app's end (sent again from the app's outbox, web/src/lib/calloutbox.ts), and is
 * closed after an hour and five minutes without news.
 */
q.run(`CREATE TABLE IF NOT EXISTS call_live (call_id TEXT PRIMARY KEY, bot_id TEXT NOT NULL REFERENCES bots(id) ON DELETE CASCADE,
  source TEXT NOT NULL, started_at INTEGER NOT NULL, transcript TEXT NOT NULL DEFAULT '[]', updated_at INTEGER NOT NULL)`);
export const BROWSER_CALL_GRACE_MS = 65 * 60_000;
const saved = new Map<string, string>();

export function callStarted(bot: BotRecord, locale: Locale, source: "browser" | "server" = "browser"): string {
  const callId = `call_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  calls.set(callId, { botId: bot.id, startedAt: Date.now() });
  q.run("INSERT INTO call_live (call_id, bot_id, source, started_at, updated_at) VALUES (?, ?, ?, ?, ?)", callId, bot.id, source, Date.now(), Date.now());
  rows.append(bot, { kind: "event", event: "call", text: tr(locale, "Voice call with {bot} started", { bot: bot.name }), call: { id: callId, phase: "started" } });
  return callId;
}

/** The transcript so far of an open call, kept on disk when it changed (cheap to call often). */
export function callProgress(callId: string, transcript: { role: string; text: string }[]) {
  if (!calls.has(callId)) return;
  const sig = `${transcript.length}:${transcript.at(-1)?.text.length ?? 0}`;
  if (saved.get(callId) === sig) return;
  saved.set(callId, sig);
  q.run("UPDATE call_live SET transcript = ?, updated_at = ? WHERE call_id = ?", JSON.stringify(transcript.slice(-200)), Date.now(), callId);
}

/** Closes the record once (false when it was already closed or is unknown). */
export function callEnded(bot: BotRecord, callId: string, rawTranscript: unknown, locale: Locale, note = ""): boolean {
  const kept = q.get<{ bot_id: string; started_at: number }>("SELECT bot_id, started_at FROM call_live WHERE call_id = ?", callId);
  const live = calls.get(callId) ?? (kept ? { botId: kept.bot_id, startedAt: kept.started_at } : undefined);
  if (!live || live.botId !== bot.id) return false;
  calls.delete(callId);
  saved.delete(callId);
  q.run("DELETE FROM call_live WHERE call_id = ?", callId);
  const transcript = (Array.isArray(rawTranscript) ? rawTranscript : [])
    .filter((l: any) => l && (l.role === "user" || l.role === "assistant") && typeof l.text === "string" && l.text.trim())
    .slice(-200).map((l: any) => ({ role: l.role as "user" | "assistant", text: clip(l.text.trim(), 2000) }));
  const durationMs = Math.max(1000, Date.now() - live.startedAt);
  const secs = Math.round(durationMs / 1000);
  const duration = secs < 60 ? `${secs} s` : `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`;
  const base = tr(locale, "Voice call ended · {duration}", { duration }) + (note ? ` ${tr(locale, note)}` : "");
  const record = { id: callId, phase: "ended" as const, durationMs, transcript };
  const row = rows.append(bot, { kind: "event", event: "call", text: base, call: record });
  // A one-line summary is added to the row a moment later; the call is already recorded without it.
  if (transcript.length)
    void ask(bot, "You summarise voice calls between a user and their AI teammate. Answer with the sentence only, in plain words: no JSON, no list, no quotes, no preamble.",
      `Write ONE sentence, past tense, third person, at most 25 words, in ${languageName(locale)}, saying what the call was about and what was agreed.\n\n${transcript.map((l) => `${l.role === "user" ? "User" : bot.name}: ${l.text}`).join("\n").slice(-12_000)}`)
      .then((answer) => {
        // Only a short human sentence is shown; anything else (an empty memory list, JSON, code) leaves the row as it is.
        const summary = callSummaryText(answer);
        if (summary) rows.rewrite(bot, row.generation, row.seq, { kind: "event", event: "call", text: base, call: { ...record, summary } });
      })
      .catch(() => {});
  return true;
}

/**
 * Records left by an earlier server process (see call_live above). Returns how many calls were closed. A browser call
 * waits for the app's own end until `BROWSER_CALL_GRACE_MS` after its last news.
 */
export function recoverCalls(at = Date.now()): number {
  let closed = 0;
  for (const r of q.all<{ call_id: string; bot_id: string; source: string; transcript: string; updated_at: number }>("SELECT * FROM call_live")) {
    if (calls.has(r.call_id)) continue;
    if (r.source === "browser" && at - r.updated_at < BROWSER_CALL_GRACE_MS) continue;
    const bot = bots.byId(r.bot_id);
    if (!bot) { q.run("DELETE FROM call_live WHERE call_id = ?", r.call_id); continue; }
    let lines: unknown = [];
    try { lines = JSON.parse(r.transcript); } catch { /* kept empty */ }
    if (callEnded(bot, r.call_id, lines, users.localeOf(bot.userId), "(the server restarted)")) closed++;
  }
  return closed;
}
/** Shortly after start, then every 10 minutes. Not under NO_SCHEDULER (tests call recoverCalls themselves). */
if (process.env.NO_SCHEDULER !== "1") {
  setTimeout(() => { try { recoverCalls(); } catch (err) { console.error("[calls]", err); } }, 15_000).unref();
  setInterval(() => { try { recoverCalls(); } catch (err) { console.error("[calls]", err); } }, 10 * 60_000).unref();
}

/**
 * The side model's answer as a call summary, or "" when it is not a plain sentence: a side answer meant for something
 * else (the memory pass's {"facts": [...]}), any JSON or code, a list, or no words at all is never shown in the chat.
 */
export function callSummaryText(raw: unknown): string {
  let s = String(raw ?? "").trim();
  if (!s) return "";
  // A sentence wrapped in quotes or a single code span is unwrapped; a fenced block is code, never a summary.
  if (/^```/.test(s) || /"\w+"\s*:/.test(s)) return "";
  s = s.replace(/^["'«“`]+|["'»”`]+$/gu, "").trim();
  if (!s || /^[[{<]/.test(s) || /[{}]/.test(s)) return "";
  try { const j = JSON.parse(s); if (j !== null && typeof j === "object") return ""; } catch { /* not JSON: good */ }
  if (!/\p{L}{2,}/u.test(s) || s.length > 600) return "";
  return clip(s.replace(/\s+/g, " "), 240);
}

/** Tests only: what a restart of the server forgets (the open calls kept in memory). */
export const _forgetLiveCalls = () => { calls.clear(); saved.clear(); };
