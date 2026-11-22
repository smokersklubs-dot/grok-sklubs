import { useContext, useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { Icon } from "./Icon";
import { RowContext } from "./Transcript";

/**
 * Lot 4 comfort (L136 / L141 in part): « Copier » the whole message (its Markdown text), « Partager » it with the
 * phone's share sheet when the browser offers one (Web Share API, https://developer.mozilla.org/docs/Web/API/Navigator/share),
 * and on your own message « Reprendre » — its text goes back into the composer to fix and send again. A real "edit in
 * place / regenerate" (rewriting the conversation the bot remembers) needs the agent loop and is not done here.
 */
export function MessageMore({ row, mine }: { row: Row; mine: boolean }) {
  const t = useT();
  const { mode } = useContext(RowContext);
  const [copied, setCopied] = useState(false);
  if (row.body.kind !== "message" || !row.body.text.trim()) return null;
  const text = row.body.text;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { useStore.getState().showToast(t("msg.copyFailed")); }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  return (
    <>
      <button type="button" className="msg-action" aria-label={t(copied ? "msg.copied" : "msg.copy")} title={t(copied ? "msg.copied" : "msg.copy")} onClick={() => void copy()}>
        <Icon name={copied ? "check" : "copy"} size={15} />
      </button>
      {canShare && (
        <button type="button" className="msg-action" aria-label={t("msg.share")} title={t("msg.share")} onClick={() => void navigator.share({ text }).catch(() => {})}>
          <Icon name="send" size={15} />
        </button>
      )}
      {mine && mode === "main" && (
        <button
          type="button"
          className="msg-action"
          aria-label={t("msg.reuse")}
          title={t("msg.reuse")}
          onClick={() => { const s = useStore.getState(); s.setDraft(row.botId, text); s.focusComposer(); }}
        >
          <Icon name="edit" size={15} />
        </button>
      )}
    </>
  );
}
