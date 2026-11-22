import type { Block, ChatMessage } from "./types.js";

/**
 * Prompt caching layout (L57). Providers cache the longest unchanged prefix of a request, in the order tools → system →
 * messages: one changed byte invalidates everything after it. Anthropic: "Render order is tools -> system -> messages
 * [...] keep stable content first, put volatile content after the last cache_control breakpoint"; "Don't interpolate
 * [per-request context] into the system prompt [...] inject dynamic context later in messages instead, as text in a user
 * message" (docs.anthropic.com/en/docs/build-with-claude/prompt-caching, now platform.claude.com/docs/en/build-with-claude/prompt-caching). OpenAI caches the longest matching prefix
 * automatically, with no parameter (platform.openai.com/docs/guides/prompt-caching: "place static content like
 * instructions and examples at the beginning of your prompt, and put variable content [...] at the end").
 *
 * buildSystemPrompt (agent/prompt.ts) ends with what changes from turn to turn under TURN_CONTEXT_HEADING. The API
 * providers send the part before the heading as the system prompt and the rest as the first text of the turn's own
 * message ("rappel placé devant le message du tour"). It stays on that message for the whole turn, so within a turn
 * nothing already sent is ever edited (no cache miss, and reasoning blocks stay valid); the next turn moves it to the
 * new message, which only re-reads the one previous turn.
 */
export const TURN_CONTEXT_HEADING = "## For this turn only (refreshed with each new message)";

export function splitSystem(system: string): { stable: string; turn: string } {
  const at = system.indexOf(`\n\n${TURN_CONTEXT_HEADING}\n`);
  if (at < 0) return { stable: system, turn: "" };
  return { stable: system.slice(0, at), turn: system.slice(at + 2) };
}

/** A user message that starts a turn: something typed (or a notice), not the results of tool calls. */
const startsTurn = (m: ChatMessage) => m.role === "user" && !m.content.some((b) => b.type === "tool_result");

/** Index of the message the turn in progress started with (the last user message without tool results), or -1. */
export function turnStartIndex(messages: ChatMessage[]): number {
  for (let i = messages.length - 1; i >= 0; i--) if (startsTurn(messages[i])) return i;
  return -1;
}

/** The messages with the turn context put in front of the turn's own message (or the first message when there is none). */
export function withTurnContext(messages: ChatMessage[], turn: string): ChatMessage[] {
  if (!turn || !messages.length) return messages;
  let at = turnStartIndex(messages);
  if (at < 0) at = messages.findIndex((m) => m.role === "user");
  if (at < 0) return messages;
  const note: Block = { type: "text", text: `[${turn}]` };
  return messages.map((m, i) => (i === at ? { ...m, content: [note, ...m.content] } : m));
}

/** System and messages laid out for caching (the provider adds its own breakpoints where it has them). */
export function cacheLayout(system: string, messages: ChatMessage[]): { system: string; messages: ChatMessage[] } {
  const { stable, turn } = splitSystem(system);
  return { system: stable, messages: withTurnContext(messages, turn) };
}

/**
 * Where Anthropic's cache breakpoints go, given which messages of the final list start a turn: just before the
 * previous turn's own message (that prefix was written as a breakpoint one turn ago, so it is read back), just before
 * this turn's own message (the previous turn, written once), and the last message (each step of the tool loop reads all
 * earlier steps). With the one on the system prompt that makes 4, the documented maximum ("Max 4 cache_control
 * breakpoints per request"). A breakpoint "walks backward at most 20 positions to find a prior cache entry": the two
 * turn-boundary marks keep a read point within reach even after a long tool loop.
 */
export function messageBreakpoints(starts: boolean[]): number[] {
  const n = starts.length;
  if (!n) return [];
  const out = new Set<number>();
  const cur = starts.lastIndexOf(true);
  if (cur > 0) {
    out.add(cur - 1);
    const prev = starts.lastIndexOf(true, cur - 1);
    if (prev > 0) out.add(prev - 1);
  }
  out.add(n - 1);
  return [...out].sort((a, b) => a - b).slice(-3);
}

/** For messageBreakpoints: which messages start a turn. */
export const turnStarts = (messages: ChatMessage[]) => messages.map(startsTurn);
