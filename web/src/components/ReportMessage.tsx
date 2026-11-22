import { useId, useState } from "react";
import { api, enc, errText } from "../api";
import { useT, type Key } from "../i18n";
import { useStore } from "../store";
import type { Row } from "../types";
import { Icon } from "./Icon";
import { ErrorNote, Modal } from "./ui";
import "./ReportMessage.css";

/**
 * L31 — « Signaler cette réponse » on a bot's reply (server: reports.ts). A short list of reasons and a few words; the
 * report stays on the server, masked, for whoever runs it (Surveillance → Réponses signalées). Only on the bots the
 * person owns (not on a bot shared with them).
 */
export const REPORT_REASONS = ["wrong", "harmful", "offensive", "private", "other"] as const;

export function ReportAction({ row }: { row: Row }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const owned = useStore((s) => { const b = s.bots[row.botId]; return !!b && !b.access; });
  const b = row.body;
  if (!owned || b.kind !== "message" || b.role !== "assistant" || b.streaming) return null;
  return (
    <>
      <button type="button" className="msg-action" aria-label={t("report.action")} title={t("report.action")} onClick={() => setOpen(true)}>
        <Icon name="alert" size={15} />
      </button>
      {open && <ReportDialog row={row} onClose={() => setOpen(false)} />}
    </>
  );
}

export function ReportDialog({ row, onClose }: { row: Row; onClose: () => void }) {
  const t = useT();
  const uid = useId();
  const [reason, setReason] = useState<(typeof REPORT_REASONS)[number] | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const send = async () => {
    if (!reason) return;
    setBusy(true); setError(null);
    try {
      await api("POST", `/bots/${enc(row.botId)}/rows/${row.seq}/report`, { reason, note: note.trim() });
      useStore.getState().showToast(t("report.sent"));
      onClose();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  return (
    <Modal title={t("report.title")} onClose={onClose} size="sm">
      <form className="modal-body report-dialog" onSubmit={(e) => { e.preventDefault(); void send(); }}>
        <p className="field-hint">{t("report.intro")}</p>
        <fieldset className="field report-reasons">
          <legend className="field-label">{t("report.reason")}</legend>
          {REPORT_REASONS.map((r) => (
            <label key={r} className="report-reason">
              <input type="radio" name={`${uid}r`} value={r} checked={reason === r} onChange={() => setReason(r)} />
              <span>{t(`report.reason.${r}` as Key)}</span>
            </label>
          ))}
        </fieldset>
        <div className="field">
          <label className="field-label" htmlFor={`${uid}n`}>{t("report.note")}</label>
          <textarea id={`${uid}n`} className="input" rows={3} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} />
        </div>
        <ErrorNote onDismiss={() => setError(null)}>{error}</ErrorNote>
        <div className="modal-foot">
          <button type="submit" className="btn btn-primary" disabled={!reason || busy}>{t("report.send")}</button>
          <button type="button" className="btn" onClick={onClose}>{t("common.cancel")}</button>
        </div>
      </form>
    </Modal>
  );
}
