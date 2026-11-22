import { tr } from "../i18n.js";
import type { Engine } from "../shared.js";
import { clip, rows } from "../store.js";
import type { Turn } from "./loop.js";

/**
 * A subscription tool (Claude Code, Codex) keeps the conversation in a session of its own, in the bot's computer. When
 * that session is gone (the computer was reset, its files wiped, the session expired), the turn used to start a new one
 * with the current message only: the bot had forgotten everything, and nobody was told.
 *
 * Now the new session starts from a compact copy of the conversation as Sklubot stored it — the last messages of the
 * chat (or of the thread), oldest first, bounded in number and in size — and one line in the chat says the session was
 * restarted. A conversation that is not the owner's own (the Bot API, a workspace member) gets no copy: its session must
 * never see the owner's messages.
 */
export const REBUILD_MAX_MESSAGES = 30;
export const REBUILD_MAX_MESSAGE_CHARS = 1500;
export const REBUILD_MAX_CHARS = 12_000;

const toolName = (engine: Engine) => (engine === "codex" ? "Codex" : "Claude Code");

/** The recent conversation of a turn, for a brand-new session: "" when there is nothing stored before `prompt`. */
export function rebuiltContext(turn: Pick<Turn, "bot" | "generation" | "thread" | "engineCaller" | "origin">, prompt: string): string {
  if (turn.engineCaller || turn.origin === "api" || turn.origin === "member") return "";
  const lines = rows.recentMessages(turn.bot.id, turn.generation, REBUILD_MAX_MESSAGES, turn.thread).flatMap(({ body }) =>
    body.kind === "message" && body.text && !body.streaming ? [{ who: body.role === "user" ? (body.origin?.kind === "bot" ? body.origin.name : "User") : "You", text: body.text.replace(/\s+/g, " ").trim() }] : []);
  // The message this turn answers is already in the prompt: not said twice.
  const last = lines[lines.length - 1];
  if (last && last.who === "User" && prompt.includes(last.text.slice(0, 200))) lines.pop();
  const kept: string[] = [];
  let size = 0;
  // Newest first while filling the budget, so the most recent messages are the ones that stay.
  for (const l of lines.reverse()) {
    const line = `${l.who}: ${clip(l.text, REBUILD_MAX_MESSAGE_CHARS)}`;
    if (size + line.length > REBUILD_MAX_CHARS) break;
    kept.unshift(line);
    size += line.length + 1;
  }
  if (!kept.length) return "";
  return `[System: your earlier session with this tool was lost (your computer was reset, or the session expired), so this is a brand-new session and you remember nothing of it by yourself. Below is the recent conversation, oldest first, rebuilt from what Sklubot stored: older messages may be missing and long ones are shortened. Use it as context only. Do not redo work it shows as done — check the current state first when it matters. The message to answer comes after it.]\n${kept.join("\n")}\n[End of the rebuilt conversation.]\n\n`;
}

/**
 * The saved session of this turn is gone and a new one starts: the chat says so (once, for the owner's own conversation),
 * and the text to put in front of the prompt is returned.
 */
export function sessionLost(turn: Turn, engine: Engine, prompt: string): string {
  if (!turn.engineCaller && turn.origin !== "api" && turn.origin !== "member")
    rows.append(turn.bot, { kind: "notice", tone: "info", text: tr(turn.user.locale, "My session with {tool} was lost, so I started a new one. I picked the thread back up from our last messages here; older details may be missing — tell me if I forgot something.", { tool: toolName(engine) }) }, turn.thread || undefined);
  return rebuiltContext(turn, prompt);
}
