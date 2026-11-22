import { useContext, useEffect, useRef } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { addCopyButtons, jumpToQuoted, replyDraft, selectedText } from "../lib/messagecopy";
import { Icon } from "./Icon";
import { RowContext } from "./Transcript";
import "./ReplyAction.css";

/**
 * nod item 6 — « Répondre »: on a message of the main chat, quotes the selected passage of that message (or the start of
 * the message when nothing is selected) at the top of the draft, then puts the cursor in the composer. The quote is
 * plain Markdown ("> …"): the bot reads exactly what was quoted.
 */
export function ReplyAction({ row }: { row: Row }) {
  const t = useT();
  const { mode } = useContext(RowContext);
  if (mode !== "main" || row.body.kind !== "message" || !row.body.text.trim()) return null;
  const text = row.body.text;
  return (
    <button
      type="button"
      className="msg-action"
      aria-label={t("reply.action")}
      title={t("reply.action")}
      // Keep the selection: a mousedown on a button would clear it before the click reads it.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        const msg = (e.currentTarget.closest(".msg") as HTMLElement | null) ?? null;
        const picked = selectedText(msg).trim();
        const quote = picked || text.replace(/```[\s\S]*?```/g, "…").replace(/[#*_`>]/g, "").replace(/\s+/g, " ").trim().slice(0, 280);
        const s = useStore.getState();
        s.setDraft(row.botId, replyDraft(quote, s.drafts[row.botId] ?? ""));
        s.focusComposer();
        window.getSelection()?.removeAllRanges();
      }}
    >
      <Icon name="chat" size={15} />
    </button>
  );
}

/** A rendered message: « Copier » on its code blocks and tables; a click on a quote goes to the passage it quotes. */
export function useMessageEnhance(html: string) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    addCopyButtons(el);
    const onClick = (e: MouseEvent) => {
      const quote = (e.target as HTMLElement).closest("blockquote:not(.md-callout)") as HTMLElement | null;
      if (quote && el.contains(quote) && !(e.target as HTMLElement).closest("a,button")) jumpToQuoted(quote);
    };
    el.addEventListener("click", onClick);
    return () => el.removeEventListener("click", onClick);
  }, [html]);
  return ref;
}
