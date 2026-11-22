import { useContext, useState } from "react";
import { api, errText } from "../api";
import { useT } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { Icon } from "./Icon";
import { RowContext } from "./Transcript";
import { Modal } from "./ui";

/**
 * Lot 4 comfort (L136 / L141 in part): « Copier » the whole message (its Markdown text), « Partager » it with the
 * phone's share sheet when the browser offers one (Web Share API, https://developer.mozilla.org/docs/Web/API/Navigator/share),
 * and on your own message « Reprendre » — its text goes back into the composer to fix and send again.
 * L136 (rest, server agent/editmessage.ts): « Modifier » your message (a new version below, the old one kept and marked),
 * « Réécrire » the bot's latest reply (a new version below), « Brancher ici » (a thread that knows the conversation up to
 * this message). Nothing already said is rewritten.
 */
export function MessageMore({ row, mine }: { row: Row; mine: boolean }) {
  const t = useT();
  const { mode } = useContext(RowContext);
  const agent = useStore((s) => s.bots[row.botId]?.kind === "agent" && !s.bots[row.botId]?.access);
  const [copied, setCopied] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (row.body.kind !== "message" || !row.body.text.trim()) return null;
  const body = row.body;
  const text = body.text;
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { useStore.getState().showToast(t("msg.copyFailed")); }
  };
  const post = async (path: string, payload?: unknown) => {
    setBusy(true); setError(null);
    try { return await api<any>("POST", `/bots/${row.botId}/rows/${row.seq}/${path}`, payload); } catch (e) { const m = errText(e); setError(m); useStore.getState().showToast(m); return null; } finally { setBusy(false); }
  };
  const canShare = typeof navigator !== "undefined" && typeof navigator.share === "function";
  const live = mode !== "readonly" && agent && !body.streaming;
  const ownWords = mine && !body.origin;
  return (
    <>
      {(body.editedTo || body.editOf) && <span className="msg-edited muted">{t(body.editedTo ? "msg.editedOld" : "msg.editedNew")}</span>}
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
          <Icon name="history" size={15} />
        </button>
      )}
      {live && ownWords && !body.editedTo && (
        <button type="button" className="msg-action" aria-label={t("msg.edit")} title={t("msg.edit")} disabled={busy} onClick={() => setEditing(text)}>
          <Icon name="edit" size={15} />
        </button>
      )}
      {live && !mine && body.role === "assistant" && !body.origin && (
        <button type="button" className="msg-action" aria-label={t("msg.regenerate")} title={t("msg.regenerate")} disabled={busy} onClick={() => void post("regenerate")}>
          <Icon name="refresh" size={15} />
        </button>
      )}
      {live && mode === "main" && !(row.thread ?? 0) && (
        <button type="button" className="msg-action" aria-label={t("msg.branch")} title={t("msg.branch")} disabled={busy} onClick={async () => { const r = await post("branch"); if (r?.thread) useStore.getState().openThreadPanel(row.botId, r.thread); }}>
          <Icon name="thread" size={15} />
        </button>
      )}
      {editing !== null && (
        <Modal title={t("msg.editTitle")} onClose={() => setEditing(null)} size="md">
          <div className="modal-body">
            <p className="muted">{t("msg.editHint")}</p>
            <textarea className="input" rows={6} value={editing} autoFocus onChange={(e) => setEditing(e.target.value)} aria-label={t("msg.editTitle")} />
            {error && <p className="card-error" role="alert">{error}</p>}
          <div className="modal-foot">
            <button type="button" className="btn btn-ghost" onClick={() => setEditing(null)}>{t("common.cancel")}</button>
            <button type="button" className="btn btn-accent" disabled={busy || !editing.trim() || editing.trim() === text.trim()} onClick={async () => { if (await post("edit", { text: editing })) setEditing(null); }}>
              {t("msg.editSend")}
            </button>
          </div>
          </div>
        </Modal>
      )}
    </>
  );
}
