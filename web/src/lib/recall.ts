import type { Row } from "../types";

/**
 * L136 — « ↑ » in an empty message box brings back your last message, then the one before (like a terminal or a
 * messaging app); « ↓ » goes forward again and, past the newest, gives back what you were typing. Only your own
 * messages of this chat, newest first, without repeats; nothing is sent.
 */
export const RECALL_MAX = 50;

/** Your own messages of this chat, newest first, without repeats or empty ones. */
export function ownMessages(rows: readonly Row[]): string[] {
  const out: string[] = [];
  for (let i = rows.length - 1; i >= 0 && out.length < RECALL_MAX; i--) {
    const b = rows[i].body;
    if (b.kind !== "message" || b.role !== "user" || b.deleted || b.origin) continue; // a routine, a webhook, another bot: not your own words
    const text = b.text.trim();
    if (text && !out.includes(text)) out.push(text);
  }
  return out;
}

export interface RecallState { index: number; saved: string }

/**
 * One press of ↑ ("up") or ↓ ("down"). `state` null: not recalling yet (↑ only starts when the box is empty, or holds
 * exactly the message last brought back). Returns the new text and state, or null when the key should do its usual job.
 */
export function recallStep(history: readonly string[], state: RecallState | null, draft: string, dir: "up" | "down"): { text: string; state: RecallState | null } | null {
  if (!history.length) return null;
  if (state && draft !== history[state.index]) state = null; // the user edited the recalled text: start again from here
  if (!state) {
    if (dir !== "up" || draft.trim() !== "") return null;
    return { text: history[0], state: { index: 0, saved: draft } };
  }
  if (dir === "up") {
    if (state.index >= history.length - 1) return { text: history[state.index], state };
    return { text: history[state.index + 1], state: { ...state, index: state.index + 1 } };
  }
  if (state.index === 0) return { text: state.saved, state: null };
  return { text: history[state.index - 1], state: { ...state, index: state.index - 1 } };
}
