import { tr } from "../i18n.js";
import type { Block } from "../llm/index.js";
import { bots, laneKey, rows, users, type BotRecord } from "../store.js";
import { bgTaskHooks } from "./bgtasks.js";
import { steer } from "./steering.js";

/**
 * L25 — your message reaches the helper at work (backlog A-FAIRE L25; behaviour from the Agent Zero and Noah audits: an
 * intervention goes to the agent that is running right now; our own code).
 *
 * Before, only a typed « stop » reached a helper working for a bot (stopcommand.ts). Now a message the OWNER types in a
 * bot's chat while one of its helpers has a turn running is also passed to that helper, as a note it takes in at its next
 * step (steering.ts, the same path as a note typed in its own chat; kept on disk until read). The bot itself still gets
 * the message as usual. The chat says which helper(s) got it.
 *
 * Never for a workspace member's or a Bot API message (they are not the owner's words), never to a background task's
 * worker (it has its own card, where the owner writes to it: bgtasks.ts replyToTask), never to a paused helper. The note
 * is information in the helper's turn: it does not authorise anything by itself (every approval works as before).
 */
export const RELAY_PREFIX = "[Your owner wrote the message below in {parent}'s chat while you are working for {parent}. It is for you too: take it into account in the work under way (it may add to or change your goal; a question in it is answered first). Your report still goes back to {parent}.]";

/** The note a helper reads (exported for the tests). */
export const relayText = (parent: string, words: string) => `${RELAY_PREFIX.replaceAll("{parent}", parent)}\n${words}`;

/**
 * Passes the owner's words to every helper of `bot` that has a turn running now (`runningThreads`: loop.ts, passed in so
 * this module does not import the loop). Returns the names of the helpers that got it.
 */
export function relayToHelpers(bot: BotRecord, words: string, runningThreads: (botId: string) => number[], paused: (b: BotRecord) => boolean): string[] {
  if (bot.kind !== "agent" || bot.parentId || !words.trim()) return [];
  const got: string[] = [];
  for (const h of bots.children(bot.id)) {
    if (h.kind !== "agent" || bgTaskHooks.isTaskHelper(h.id) || paused(h)) continue;
    const threads = runningThreads(h.id);
    if (!threads.length) continue;
    const thread = threads.includes(0) ? 0 : threads[0];
    const note = relayText(bot.name, words);
    steer(h, laneKey(h.id, thread), thread, note, [], async (): Promise<Block[]> => [{ type: "text", text: note }]);
    got.push(h.name);
  }
  if (got.length) rows.append(bot, { kind: "notice", tone: "info", text: tr(users.localeOf(bot.userId), "Also passed to the helper at work: {names}.", { names: got.join(", ") }) });
  return got;
}
