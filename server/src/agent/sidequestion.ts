import { tr } from "../i18n.js";
import { clip, rows, users, type BotRecord } from "../store.js";
import { ask } from "./memory.js";

/**
 * L78 — a side question (« /btw ») answered without touching the work under way, and « traite ça après » (backlog A-FAIRE
 * L78; behaviour from the Nightly, OpenClaw, Craft Anything, ECC and Noah audits, our own code).
 *
 * - "/btw <question>" (also "/question", "/aside"): one short model call with no tools, on the bot's own model, that sees
 *   the recent messages of this conversation as text. Its answer is written in the chat only (rows), never into the
 *   history the running turn works from, so the work is not steered, stopped or changed. Works whether the bot is busy
 *   or not.
 * - "/apres <message>" (also "/après", "/later", "traite ça après : …"): the message never joins the running turn as a
 *   note (steering); it waits in the queue and starts its own turn once the current work is over.
 */
export type SideCommand = { kind: "btw"; text: string } | { kind: "later"; text: string };

export function sideCommand(raw: string): SideCommand | null {
  const s = String(raw ?? "").trim();
  const btw = /^\/(?:btw|question|aside)\b[\s:]*([\s\S]*)$/i.exec(s);
  if (btw) return btw[1].trim() ? { kind: "btw", text: btw[1].trim() } : null;
  const later = /^(?:\/(?:apr[eè]s|later)\b|trait(?:e|er) (?:ça|ca|cela) (?:après|apres)\s*:)[\s:]*([\s\S]*)$/i.exec(s);
  if (later) return later[1].trim() ? { kind: "later", text: later[1].trim() } : null;
  return null;
}

const SIDE_SYSTEM = (name: string) =>
  `You are ${name}. While you are busy with other work, the user asks you a quick side question. Answer it briefly (a few sentences at most), from the conversation shown and what you know. You cannot use any tool here, and this answer does not start, stop or change the work under way: never say you will do something now. If the question really needs work, say so and suggest sending it with /apres so it is handled after the current task.`;

/** The side answer, written in the chat as the bot's message (in the same thread). Never throws. */
export async function answerSide(bot: BotRecord, question: string, thread: number, run: typeof ask = ask): Promise<string> {
  const loc = users.localeOf(bot.userId);
  const recent = rows.recentMessages(bot.id, bot.generation, 30, thread)
    .filter((r) => r.body.kind === "message" && !r.body.streaming)
    .map((r) => (r.body.kind === "message" ? `${r.body.role === "user" ? "User" : bot.name}: ${clip(r.body.text.replace(/\s+/g, " "), 600)}` : ""));
  const transcript = clip(recent.join("\n"), 8000);
  try {
    const answer = (await run(bot, SIDE_SYSTEM(bot.name), `Recent conversation:\n${transcript || "(nothing yet)"}\n\nSide question: ${question}`, true)).trim();
    const text = answer ? `${tr(loc, "↪ Side answer:")} ${answer}` : tr(loc, "↪ I have no quick answer to that. Send it with /apres and I will look into it after the current task.");
    rows.append(bot, { kind: "message", role: "assistant", text }, thread || undefined);
    return text;
  } catch (err) {
    const text = tr(loc, "I could not answer the side question just now ({detail}). The work under way is not affected.", { detail: clip(String((err as Error)?.message ?? err), 120) });
    rows.append(bot, { kind: "notice", tone: "warn", text }, thread || undefined);
    return text;
  }
}
