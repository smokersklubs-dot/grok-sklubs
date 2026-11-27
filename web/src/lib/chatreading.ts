/**
 * L147 « Rendu du chat »: two small reading comforts of the main chat (ideas from Hermes and CopilotKit; our own code).
 *  - stableMarkdown: while a reply is still being written, an unfinished code block or bold mark would make the whole end
 *    of the message jump from plain text to code and back at each new word. The unfinished mark is closed (or left out)
 *    for the display only; the stored text is never changed.
 *  - the « NOUVEAU » line: when you open a chat with unread replies, a line marks where the new ones start (it stays
 *    until you open another chat).
 */
import { create } from "zustand";
import type { Row } from "../types";

/** The text as it should be drawn while it streams: an open ``` fence is closed, a dangling `**`, `__` or backtick left out. */
export function stableMarkdown(text: string): string {
  let out = text;
  const fences = out.match(/^\s*(```|~~~)/gm)?.length ?? 0;
  if (fences % 2 === 1) return out.endsWith("\n") ? `${out}\`\`\`` : `${out}\n\`\`\``;
  // Outside code: the last line's unmatched emphasis or inline-code mark is dropped until its pair arrives.
  const nl = out.lastIndexOf("\n");
  const head = out.slice(0, nl + 1);
  let last = out.slice(nl + 1);
  for (const mark of ["**", "__", "`"]) {
    const n = last.split(mark).length - 1;
    if (n % 2 === 1) {
      const at = last.lastIndexOf(mark);
      last = last.slice(0, at) + last.slice(at + mark.length);
    }
  }
  // A table row still being typed ("| a | b") would turn the table back into text: hold the half row back.
  if (/^\s*\|/.test(last) && !/\|\s*$/.test(last) && /\n\s*\|.*\|\s*\n?$/.test(head)) last = "";
  out = head + last;
  return out;
}

/** The first message of the unread ones: the `count` latest replies of others (bot or teammates) in the main chat. */
export function firstNewSeq(rows: Row[], count: number): number | null {
  if (count <= 0) return null;
  let seen = 0;
  for (let i = rows.length - 1; i >= 0; i--) {
    const r = rows[i];
    if (r.thread) continue;
    if (r.body.kind === "message" && r.body.role === "assistant" && r.body.text.trim()) {
      seen++;
      if (seen === count) return r.seq;
    }
  }
  return null;
}

interface NewMark { botId: string; count: number }
/** Set when the open chat's unread count drops to 0 (it was just read): how many were unread. */
export const useNewMark = create<{ mark: NewMark | null }>(() => ({ mark: null }));

/** Keeps `useNewMark` in step with the app's store: call once with the store's `subscribe`. */
export function trackUnread(subscribe: (fn: (s: { selectedId: string | null; bots: Record<string, { unread: number }> }, prev: { selectedId: string | null; bots: Record<string, { unread: number }> }) => void) => () => void): () => void {
  return subscribe((s, prev) => {
    const id = s.selectedId;
    if (id !== prev.selectedId) useNewMark.setState({ mark: null });
    if (!id) return;
    const before = prev.bots[id]?.unread ?? 0;
    const now = s.bots[id]?.unread ?? 0;
    if (before > 0 && now === 0) useNewMark.setState({ mark: { botId: id, count: before } });
  });
}

/** The seq the « NOUVEAU » line goes above in this chat, or null (no unread replies when it was opened). */
export function useNewLineSeq(botId: string, rows: Row[]): number | null {
  const mark = useNewMark((s) => (s.mark?.botId === botId ? s.mark.count : 0));
  return mark ? firstNewSeq(rows, mark) : null;
}

type Itemish = { t: string; key: string; rows?: Row[]; row?: Row };
/** The chat's items with the « NOUVEAU » divider above the group that holds message `seq` (unchanged when absent). */
export function withNewLine<T extends Itemish>(items: T[], seq: number | null, label: string): T[] {
  if (seq === null) return items;
  const at = items.findIndex((it) => (it.rows ?? (it.row ? [it.row] : [])).some((r) => r.seq === seq));
  if (at < 0) return items;
  return [...items.slice(0, at), { t: "divider", key: "new", label } as unknown as T, ...items.slice(at)];
}
