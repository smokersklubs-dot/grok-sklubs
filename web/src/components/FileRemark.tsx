import { useState } from "react";
import { useT } from "../i18n";
import { useStore } from "../store";
import { fileRemarkMessage, REMARK_MAX } from "../lib/remarks";
import { quickSend } from "../lib/quicksend";
import { Icon } from "./Icon";
import "./Remarks.css";

/**
 * L140 « Remarque sur ce fichier »: under one file of « Fichiers modifiés » (SecretsFilesProviders.tsx), a small button
 * opens a box; « Envoyer » tells the bot which file and what to change in it (lib/remarks.ts). Owner only.
 */
export function FileRemark({ botId, path }: { botId: string; path: string }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [remark, setRemark] = useState("");
  const [busy, setBusy] = useState(false);
  const send = async () => {
    const text = fileRemarkMessage(t("remarks.fileHead"), path, remark);
    if (!text) return;
    setBusy(true);
    const ok = await quickSend(botId, text);
    setBusy(false);
    if (ok) { setOpen(false); setRemark(""); useStore.getState().showToast(t("passage.sent")); }
  };
  if (!open) return (
    <div className="file-remark">
      <button type="button" className="btn btn-small btn-ghost" onClick={() => setOpen(true)}><Icon name="edit" size={13} /> {t("remarks.fileOpen")}</button>
    </div>
  );
  return (
    <form className="file-remark remark-form" onSubmit={(e) => { e.preventDefault(); void send(); }}>
      <textarea className="input remark-input" autoFocus rows={2} maxLength={REMARK_MAX} value={remark} placeholder={t("remarks.filePlaceholder", { path: `~/${path}` })} aria-label={t("remarks.filePlaceholder", { path: `~/${path}` })} onChange={(e) => setRemark(e.target.value)} />
      <div className="remark-actions">
        <button type="button" className="btn btn-small btn-ghost" onClick={() => { setOpen(false); setRemark(""); }}>{t("common.cancel")}</button>
        <button type="submit" className="btn btn-small btn-accent" disabled={busy || !remark.trim()}>{t("passage.send")}</button>
      </div>
    </form>
  );
}
